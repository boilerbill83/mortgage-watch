#!/usr/bin/env node
/**
 * fetch-and-notify.js
 * 1. Calls Anthropic API (with web search) to get today's mortgage rates
 * 2. Loads data/history.json, computes 7/14/30-day changes for 30yr fixed
 * 3. Appends today's entry to history
 * 4. Sends an SMS via Twilio with the summary
 */

import Anthropic from '@anthropic-ai/sdk';
import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = path.join(__dirname, '..', 'data', 'history.json');

// ── 1. Fetch today's rates via Anthropic + web search ────────────────────────

async function fetchRates() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const prompt = `Today is ${today}. Search the web for the most current US mortgage interest rates: 30-year fixed, 15-year fixed, 5/1 ARM, and FHA 30-year.

Respond with ONLY a single valid JSON object, no markdown, no preamble:
{
  "rates": {
    "30yr": { "rate": "X.XX", "change": "brief note e.g. down 0.04% this week" },
    "15yr": { "rate": "X.XX", "change": "brief note" },
    "5arm": { "rate": "X.XX", "change": "brief note" },
    "fha":  { "rate": "X.XX", "change": "brief note" }
  },
  "analysis": "1-2 plain-language sentences on what is driving rates right now.",
  "outlook": "1 sentence: lock now or wait?"
}
The rate values must be numeric strings like "6.81" (no % symbol).`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompt }]
  });

  // Extract last text block (after tool_use blocks)
  let jsonText = '';
  for (const block of response.content) {
    if (block.type === 'text') jsonText = block.text;
  }
  if (!jsonText) throw new Error('No text block in Anthropic response');

  const match = jsonText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in response');

  const parsed = JSON.parse(match[0]);
  if (!parsed.rates?.['30yr']) throw new Error('Missing expected rates in response');

  return parsed;
}

// ── 2. Load / save history ────────────────────────────────────────────────────

function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) return [];
  return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
}

function saveHistory(history) {
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

function getRateOnOrBefore(history, daysAgo) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysAgo);
  // Walk backwards to find the most recent entry on or before the cutoff
  for (let i = history.length - 1; i >= 0; i--) {
    if (new Date(history[i].date) <= cutoff) return parseFloat(history[i].rate30yr);
  }
  return null;
}

function formatChange(current, previous) {
  if (previous === null) return 'no data';
  const diff = (current - previous).toFixed(2);
  const sign = diff > 0 ? '▲' : diff < 0 ? '▼' : '–';
  const abs = Math.abs(diff).toFixed(2);
  return `${sign}${abs}%`;
}

// ── 3. Build SMS message ──────────────────────────────────────────────────────

function buildSMS(data, history) {
  const today30yr = parseFloat(data.rates['30yr'].rate);
  const c7  = formatChange(today30yr, getRateOnOrBefore(history, 7));
  const c14 = formatChange(today30yr, getRateOnOrBefore(history, 14));
  const c30 = formatChange(today30yr, getRateOnOrBefore(history, 30));

  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return [
    `🏠 MortgageWatch — ${date}`,
    ``,
    `30yr:  ${data.rates['30yr'].rate}%`,
    `15yr:  ${data.rates['15yr'].rate}%`,
    `5/1 ARM: ${data.rates['5arm'].rate}%`,
    `FHA:   ${data.rates['fha'].rate}%`,
    ``,
    `30yr changes:`,
    `  7d:  ${c7}`,
    `  14d: ${c14}`,
    `  30d: ${c30}`,
    ``,
    `${data.analysis}`,
    ``,
    `Outlook: ${data.outlook}`
  ].join('\n');
}

// ── 4. Send SMS via Twilio ────────────────────────────────────────────────────

async function sendSMS(message) {
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  const result = await client.messages.create({
    body: message,
    from: process.env.TWILIO_FROM_NUMBER,
    to: process.env.TWILIO_TO_NUMBER
  });

  console.log('SMS sent:', result.sid);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching mortgage rates…');
  const data = await fetchRates();
  console.log('Rates fetched:', data.rates['30yr'].rate + '% (30yr)');

  const history = loadHistory();
  const sms = buildSMS(data, history);
  console.log('\nSMS preview:\n' + sms);

  // Append today to history
  history.push({
    date: new Date().toISOString().split('T')[0],
    rate30yr: data.rates['30yr'].rate,
    rate15yr: data.rates['15yr'].rate,
    rate5arm: data.rates['5arm'].rate,
    rateFha:  data.rates['fha'].rate
  });
  saveHistory(history);
  console.log('\nHistory saved, entries:', history.length);

  await sendSMS(sms);
  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
