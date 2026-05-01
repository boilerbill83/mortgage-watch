#!/usr/bin/env node
/**
 * fetch-and-notify.js
 * 1. Fetches 30yr + 15yr fixed from FRED API (Freddie Mac authoritative data)
 * 2. Fetches 5/1 ARM + FHA + analysis via Anthropic API + web search
 * 3. Computes 7/14/30-day changes from FRED historical data directly
 * 4. Sends SMS via Twilio
 */

import Anthropic from '@anthropic-ai/sdk';
import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = path.join(__dirname, '..', 'data', 'history.json');

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

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
  "analysis": "2-3 plain-language sentences on what is driving mortgage rates rig
