/**
 * Börse Frankfurt adapter – Xetra top momentum stocks via Twelve Data
 *
 * Twelve Data free tier: 800 credits/day, 8 credits/minute.
 * Each symbol in a batch = 1 credit → max 8 symbols per minute.
 * Strategy: single batch of 8 blue-chip DAX stocks → no rate-limit issues.
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
const DAYS_BACK = 7;

// 8 representative DAX blue chips (1 API call = exactly the free-tier per-minute limit)
const TICKERS = ['SAP', 'SIE', 'ALV', 'BMW', 'MUV2', 'RWE', 'DTE', 'DBK'];

export async function fetchCandidates() {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    log('error', 'boerse-frankfurt: TWELVEDATA_API_KEY not set');
    return [];
  }

  // mic_code=XETR is the correct parameter for Twelve Data (not exchange=XETR)
  const url =
    `https://api.twelvedata.com/time_series` +
    `?symbol=${TICKERS.join(',')}` +
    `&mic_code=XETR` +
    `&interval=1day` +
    `&outputsize=${DAYS_BACK}` +
    `&apikey=${apiKey}`;

  log('info', 'boerse-frankfurt: fetching time series', { tickers: TICKERS.length, url: url.replace(apiKey, '***') });

  let data;
  try {
    const res = await fetch(url);
    if (res.status === 429) {
      log('error', 'boerse-frankfurt: rate limit hit (429) – reduce batch or wait', {});
      return [];
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    log('error', 'boerse-frankfurt: fetch failed', { error: err.message });
    return [];
  }

  // Log raw structure of first symbol for diagnostics
  const firstKey = Object.keys(data)[0];
  if (firstKey) {
    const sample = data[firstKey];
    log('debug', 'boerse-frankfurt: sample response', {
      symbol: firstKey,
      status: sample?.status,
      valuesCount: sample?.values?.length ?? 'n/a',
      firstValue: sample?.values?.[0] ?? sample,
    });
  }

  const scores = [];

  for (const ticker of TICKERS) {
    const entry = TICKERS.length === 1 ? data : data[ticker];
    if (!entry) { log('warn', 'boerse-frankfurt: no entry', { ticker }); continue; }
    if (entry.status === 'error') {
      log('warn', 'boerse-frankfurt: symbol error', { ticker, msg: entry.message });
      continue;
    }
    const vals = entry.values;
    if (!Array.isArray(vals) || vals.length < 2) {
      log('warn', 'boerse-frankfurt: insufficient data', { ticker, vals: vals?.length });
      continue;
    }

    // values[] is newest-first
    const latest = parseFloat(vals[0].close);
    const prior  = parseFloat(vals[vals.length - 1].close);
    if (!latest || !prior) continue;

    const momentum = (latest / prior) - 1;
    const name = entry.meta?.name ?? ticker;
    scores.push({ ticker, name, momentum, latest });
    log('debug', 'boerse-frankfurt: scored', { ticker, momentum: (momentum * 100).toFixed(2) + '%' });
  }

  scores.sort((a, b) => b.momentum - a.momentum);
  const top = scores.filter((s) => s.momentum > 0);

  log('info', 'boerse-frankfurt: results', { scored: scores.length, positive: top.length });
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
          momentum_pct: parseFloat((s.momentum * 100).toFixed(2)),
          period_days: DAYS_BACK,
        },
        info_snippet: `Xetra Momentum #${rank + 1}: ${s.name} +${(s.momentum * 100).toFixed(1)}% (${DAYS_BACK}d)`,
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
