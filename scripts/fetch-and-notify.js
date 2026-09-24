#!/usr/bin/env node
/**
 * fetch-and-notify.js
 * 1. Fetches 30yr + 15yr fixed from FRED API (Freddie Mac authoritative data)
 * 2. Fetches 5/1 ARM + FHA + analysis via Anthropic API + web search
 * 3. Computes 7/14/30-day changes from FRED historical data directly
 * 4. Computes refi breakeven against your own loan (from secrets, never committed)
 * 5. Sends SMS via Twilio
 */

import Anthropic from '@anthropic-ai/sdk';
import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = path.join(__dirname, '..', 'data', 'history.json');

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const DASHBOARD_URL = 'https://boilerbill83.github.io/mortgage-watch/';

// ── 1. Fetch from FRED API ────────────────────────────────────────────────────

async function fetchFRED(seriesId, limit = 35) {
  const url = new URL(FRED_BASE);
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', process.env.FRED_API_KEY);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'desc');
  url.searchParams.set('limit', limit);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`FRED API error: ${res.status} ${res.statusText}`);
  const data = await res.json();

  if (!data.observations?.length) throw new Error(`No observations for ${seriesId}`);

  return data.observations
    .filter(o => o.value !== '.')
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function getLatest(observations) {
  return observations[observations.length - 1];
}

function getRateOnOrBefore(observations, daysAgo) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysAgo);
  for (let i = observations.length - 1; i >= 0; i--) {
    if (new Date(observations[i].date) <= cutoff) {
      return parseFloat(observations[i].value);
    }
  }
  return null;
}

function formatChange(current, previous) {
  if (previous === null) return 'no data yet';
  const diff = current - previous;
  const sign = diff > 0 ? '▲' : diff < 0 ? '▼' : '–';
  return `${sign}${Math.abs(diff).toFixed(2)}%`;
}

// ── 2. Fetch ARM, FHA + analysis via Anthropic web search ────────────────────

async function fetchAIRates() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const prompt = `Today is ${today}. Search the web for the most current US mortgage rates for these two specific products: 5/1 ARM and FHA 30-year fixed. Also write a brief market analysis.

Respond with ONLY a single valid JSON object, no markdown, no preamble:
{
  "5arm": { "rate": "X.XX", "change": "brief note e.g. up 0.03% this week" },
  "fha":  { "rate": "X.XX", "change": "brief note" },
  "analysis": "2-3 plain-language sentences on what is driving mortgage rates right now (Fed policy, bond yields, inflation).",
  "outlook": "1 sentence: should a buyer consider locking now or waiting?"
}
Rate values must be numeric strings like "6.81" with no % symbol.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 800,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompt }]
  });

  let jsonText = '';
  for (const block of response.content) {
    if (block.type === 'text') jsonText = block.text;
  }
  if (!jsonText) throw new Error('No text block in Anthropic response');

  const match = jsonText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in Anthropic response');

  const parsed = JSON.parse(match[0]);
  if (!parsed['5arm'] || !parsed['fha']) throw new Error('Missing ARM/FHA data in response');
  return parsed;
}

// ── 3. Refi breakeven vs. your own loan ───────────────────────────────────────
// Loan details live in data/mortgage-config.json, committed to the repo.

const MORTGAGE_CONFIG_PATH = path.join(__dirname, '..', 'data', 'mortgage-config.json');

function loadMortgageConfig() {
  if (!fs.existsSync(MORTGAGE_CONFIG_PATH)) return null; // refi tracking is optional
  return JSON.parse(fs.readFileSync(MORTGAGE_CONFIG_PATH, 'utf8'));
}

function monthsBetween(from, to) {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

function amortizedPayment(principal, annualRatePct, termMonths) {
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / termMonths;
  const growth = Math.pow(1 + r, termMonths);
  return principal * r * growth / (growth - 1);
}

function computeRefi(currentRate30yr, config) {
  const elapsed = monthsBetween(new Date(config.asOfDate), new Date());
  const remainingMonths = Math.max(config.paymentsRemaining - elapsed, 1);

  const spread = config.yourRate - currentRate30yr; // positive = market is cheaper than you
  const newPayment = amortizedPayment(config.loanBalance, currentRate30yr, remainingMonths);
  const monthlySavings = config.monthlyPI - newPayment;
  const closingCosts = config.loanBalance * config.closingCostPct;
  const breakevenMonths = monthlySavings > 0 ? closingCosts / monthlySavings : null;

  let verdict;
  if (spread >= config.refiThresholdPct && breakevenMonths !== null && breakevenMonths <= 36) {
    verdict = 'worth-it';
  } else if (spread > 0) {
    verdict = 'getting-closer';
  } else {
    verdict = 'hold';
  }

  return { spread, verdict, newPayment, monthlySavings, closingCosts, breakevenMonths, remainingMonths };
}

function buildRefiBlock(refi, config) {
  if (!refi) return '';

  const verdictText = {
    'worth-it':      `🎯 Worth checking — market is ${refi.spread.toFixed(2)}% below your ${config.yourRate}%`,
    'getting-closer': `Getting closer — market is ${refi.spread.toFixed(2)}% below your ${config.yourRate}% (threshold: ${config.refiThresholdPct}%)`,
    'hold':          `Hold — market is at or above your ${config.yourRate}% rate`,
  }[refi.verdict];

  const lines = ['', 'Your refi status:', verdictText];
  if (refi.monthlySavings > 0) {
    const breakeven = refi.breakevenMonths !== null ? `${Math.round(refi.breakevenMonths)} mo` : '—';
    lines.push(`Est. savings: $${refi.monthlySavings.toFixed(0)}/mo · breakeven ~${breakeven} on ~$${refi.closingCosts.toFixed(0)} closing costs`);
  }
  return lines.join('\n');
}

// ── 4. Build SMS ──────────────────────────────────────────────────────────────

function buildSMS({ obs30, obs15, aiData, refi, mortgageConfig }) {
  const latest30 = getLatest(obs30);
  const latest15 = getLatest(obs15);
  const rate30 = parseFloat(latest30.value);
  const rate15 = parseFloat(latest15.value);

  const c7  = formatChange(rate30, getRateOnOrBefore(obs30, 7));
  const c14 = formatChange(rate30, getRateOnOrBefore(obs30, 14));
  const c30 = formatChange(rate30, getRateOnOrBefore(obs30, 30));

  const surveyDate = new Date(latest30.date).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric'
  });

  return [
    `🏠 MortgageWatch — ${surveyDate}`,
    `(Freddie Mac weekly survey)`,
    ``,
    `30yr fixed: ${rate30.toFixed(2)}%`,
    `15yr fixed: ${rate15.toFixed(2)}%`,
    `5/1 ARM:    ${aiData['5arm'].rate}%`,
    `FHA 30yr:   ${aiData['fha'].rate}%`,
    ``,
    `30yr changes:`,
    `  7d:  ${c7}`,
    `  14d: ${c14}`,
    `  30d: ${c30}`,
    ``,
    `${aiData.analysis}`,
    ``,
    `Outlook: ${aiData.outlook}`,
    buildRefiBlock(refi, mortgageConfig),
    ``,
    `Dashboard: ${DASHBOARD_URL}`
  ].join('\n');
}

// ── 5. Save history ───────────────────────────────────────────────────────────

function saveHistory({ obs30, obs15, aiData, refi, mortgageConfig }) {
  const latest30 = getLatest(obs30);
  const latest15 = getLatest(obs15);

  let history = [];
  if (fs.existsSync(HISTORY_PATH)) {
    history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
  }

  const alreadyExists = history.some(h => h.date === latest30.date);
  if (!alreadyExists) {
    history.push({
      date: latest30.date,
      rate30yr: latest30.value,
      rate15yr: latest15.value,
      rate5arm: aiData['5arm'].rate,
      rateFha:  aiData['fha'].rate,
      source30yr: 'FRED/Freddie Mac',
      source5arm: 'AI web search',
      analysis: aiData.analysis,
      outlook: aiData.outlook,
      ...(refi ? {
        yourRate: mortgageConfig.yourRate,
        loanBalance: mortgageConfig.loanBalance,
        refiSpread: +refi.spread.toFixed(3),
        refiVerdict: refi.verdict,
        refiMonthlySavings: +refi.monthlySavings.toFixed(2),
        refiBreakevenMonths: refi.breakevenMonths !== null ? Math.round(refi.breakevenMonths) : null,
        refiClosingCosts: +refi.closingCosts.toFixed(2),
      } : {})
    });
    fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
    console.log('History saved, entries:', history.length);
  } else {
    console.log('Entry for', latest30.date, 'already exists, skipping.');
  }
}

// ── 6. Send SMS ───────────────────────────────────────────────────────────────

async function sendSMS(message) {
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  const result = await client.messages.create({
    body: message,
    from: process.env.TWILIO_FROM_NUMBER,
    to:   process.env.TWILIO_TO_NUMBER
  });
  console.log('SMS sent:', result.sid);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching FRED data (30yr, 15yr)…');
  const [obs30, obs15] = await Promise.all([
    fetchFRED('MORTGAGE30US'),
    fetchFRED('MORTGAGE15US'),
  ]);
  console.log(`30yr: ${getLatest(obs30).value}% (survey: ${getLatest(obs30).date})`);
  console.log(`15yr: ${getLatest(obs15).value}% (survey: ${getLatest(obs15).date})`);

  console.log('Fetching ARM/FHA + analysis via Anthropic…');
  const aiData = await fetchAIRates();
  console.log(`5/1 ARM: ${aiData['5arm'].rate}%, FHA: ${aiData['fha'].rate}%`);

  const mortgageConfig = loadMortgageConfig();
  const refi = mortgageConfig ? computeRefi(parseFloat(getLatest(obs30).value), mortgageConfig) : null;
  if (refi) {
    console.log(`Refi: spread ${refi.spread.toFixed(2)}%, verdict ${refi.verdict}`);
  } else {
    console.log('Refi tracking not configured (set YOUR_MORTGAGE_RATE etc. to enable) — skipping.');
  }

  const sms = buildSMS({ obs30, obs15, aiData, refi, mortgageConfig });
  console.log('\nSMS preview:\n' + sms);
  console.log('\nCharacter count:', sms.length, '| Segments:', Math.ceil(sms.length / 153));

  saveHistory({ obs30, obs15, aiData, refi, mortgageConfig });

  await sendSMS(sms);
  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
