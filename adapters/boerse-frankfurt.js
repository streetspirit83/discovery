/**
 * Börse Frankfurt adapter – Xetra top momentum stocks
 *
 * Replaces direct Börse Frankfurt API scraping (blocked on cloud IPs).
 * Uses Twelve Data batch time-series to compute 5-day price momentum
 * for DAX 40 components and returns the top 20 by performance.
 *
 * Requires env var: TWELVEDATA_API_KEY
 */

import { v4 as uuidv4 } from 'uuid';
import { buildLinks } from './_shared/link-builder.js';

const log = (level, msg, data = {}) =>
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );

const EXCHANGE = 'XETR';
const TOP_N = 20;
const BATCH_SIZE = 8;
const DAYS_BACK = 7; // enough trading days for a 5-day return
const DELAY_MS = 300;

// DAX 40 constituents (as of early 2025; rarely changes)
const DAX_TICKERS = [
  'ADS', 'AIR', 'ALV', 'BAYN', 'BEI', 'BMW', 'BNR', 'CBK', 'CON',
  'DB1', 'DBK', 'DHL', 'DTE', 'EOAN', 'ENR', 'FME', 'FRE', 'HEI',
  'HEN3', 'HFG', 'HNR1', 'IFX', 'KION', 'MRK', 'MTX', 'MUV2',
  'P911', 'PAH3', 'PUM', 'QIA', 'RHM', 'RWE', 'SAP', 'SHL', 'SIE',
  'SRT3', 'SY1', 'VNA', 'VOW3', 'ZAL',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchBatch(tickers, apiKey) {
  const url =
    `https://api.twelvedata.com/time_series` +
    `?symbol=${tickers.join(',')}` +
    `&exchange=${EXCHANGE}` +
    `&interval=1day` +
    `&outputsize=${DAYS_BACK}` +
    `&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Twelve Data error: ${res.status}`);
  return res.json();
}

export async function fetchCandidates() {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    log('error', 'boerse-frankfurt: TWELVEDATA_API_KEY not set');
    return [];
  }

  log('info', 'boerse-frankfurt: fetching Xetra momentum', { tickers: DAX_TICKERS.length });

  const scores = [];

  for (let i = 0; i < DAX_TICKERS.length; i += BATCH_SIZE) {
    const batch = DAX_TICKERS.slice(i, i + BATCH_SIZE);
    let data;
    try {
      data = await fetchBatch(batch, apiKey);
    } catch (err) {
      log('warn', 'boerse-frankfurt: batch failed', { batch, error: err.message });
      continue;
    }

    // Single-symbol response is wrapped differently from multi-symbol
    const results = batch.length === 1 ? { [batch[0]]: data } : data;

    for (const ticker of batch) {
      const entry = results[ticker];
      if (!entry || entry.status === 'error') continue;
      const vals = entry.values;
      if (!Array.isArray(vals) || vals.length < 2) continue;

      // values[] is newest-first; use first vs last for period return
      const latest = parseFloat(vals[0].close);
      const prior  = parseFloat(vals[vals.length - 1].close);
      if (!latest || !prior) continue;

      const momentum = (latest / prior) - 1;
      const name = entry.meta?.name ?? ticker;
      scores.push({ ticker, name, momentum, latest });
    }

    if (i + BATCH_SIZE < DAX_TICKERS.length) await sleep(DELAY_MS);
  }

  scores.sort((a, b) => b.momentum - a.momentum);
  const top = scores.filter((s) => s.momentum > 0).slice(0, TOP_N);

  log('info', 'boerse-frankfurt: top movers', { count: top.length });
  if (top.length === 0) return [];

  const now = new Date().toISOString();
  return top.map((s, rank) => {
    const yahooSymbol = `${s.ticker}.DE`;
    return {
      id: uuidv4(),
      symbol: s.ticker,
      exchange: EXCHANGE,
      yahoo_symbol: yahooSymbol,
      isin: null,
      name: s.name,
      sources: [{
        adapter: 'boerse-frankfurt',
        source_url: 'https://twelvedata.com',
        discovered_at: now,
        signal_type: 'trend_indicator',
        raw_signal: {
          rank: rank + 1,
          ticker: s.ticker,
          price: s.latest,
          momentum_5d_pct: parseFloat((s.momentum * 100).toFixed(2)),
        },
        info_snippet: `Xetra momentum #${rank + 1}: ${s.name} +${(s.momentum * 100).toFixed(1)}% in ${DAYS_BACK - 1} days`,
      }],
      links: buildLinks({ exchange: EXCHANGE, symbol: s.ticker, yahooSymbol }),
      workspace_state: 'new',
      notes: '',
      enrichment: null,
      first_discovered_at: now,
      last_updated_at: now,
    };
  });
}
