/**
 * Yahoo Finance Trending adapter – US and DE regions
 *
 * Fetches Yahoo Finance trending tickers (page-view velocity signal).
 * Trending is driven by Yahoo Finance user research activity:
 * which stock pages are being visited significantly above their rolling
 * baseline. Order is meaningful – rank 1 = strongest spike.
 *
 * Auth: trending endpoint is served unauthenticated. No crumb/cookie needed.
 * Cloud IPs: untested – 403 is logged clearly; no silent failure.
 *
 * Regions:
 *   US – raw alphabetic tickers, exchange resolved via FMP/TD/static
 *   DE – symbols arrive as "SAP.DE"; strip suffix, exchange = XETR
 */

import { v4 as uuidv4 } from 'uuid';
import { buildLinks } from './_shared/link-builder.js';
import { resolveUSExchange } from './_shared/us-exchange-resolver.js';

const log = (level, msg, data = {}) =>
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const YF_BASE = 'https://query1.finance.yahoo.com/v1/finance/trending';
const COUNT = 20;

// Browser-like headers per spec recommendation
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.5',
};

const REGIONS = [
  { code: 'US', exchange: null,   yahooSuffix: '',    stripSuffix: null   },
  { code: 'DE', exchange: 'XETR', yahooSuffix: '.DE', stripSuffix: /\.DE$/i },
];

// ─── Fetch one region ─────────────────────────────────────────────────────────

async function fetchRegion(region) {
  const url = `${YF_BASE}/${region.code}?count=${COUNT}`;
  log('info', 'yahoo-trending: fetching', { region: region.code, url });

  let res;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch (err) {
    log('error', 'yahoo-trending: network error', { region: region.code, error: err.message });
    return [];
  }

  if (res.status === 403) {
    log('error', 'yahoo-trending: 403 – endpoint blocked (cloud IP or auth required)', { region: region.code });
    return [];
  }
  if (res.status === 429) {
    log('error', 'yahoo-trending: 429 – rate limited', { region: region.code });
    return [];
  }
  if (!res.ok) {
    log('error', 'yahoo-trending: HTTP error', { region: region.code, status: res.status });
    return [];
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    log('error', 'yahoo-trending: invalid JSON', { region: region.code, error: err.message });
    return [];
  }

  const result = data?.finance?.result?.[0];
  if (!result) {
    log('warn', 'yahoo-trending: empty result', { region: region.code, raw: JSON.stringify(data).slice(0, 200) });
    return [];
  }

  const quotes = result.quotes ?? [];
  log('info', 'yahoo-trending: received', {
    region: region.code,
    count: quotes.length,
    jobTimestamp: result.jobTimestamp,
    startInterval: result.startInterval,
  });

  return quotes;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchCandidates() {
  log('info', 'yahoo-trending: starting', { regions: REGIONS.map((r) => r.code) });

  const now = new Date().toISOString();
  const candidates = [];

  for (const region of REGIONS) {
    const quotes = await fetchRegion(region);

    for (let i = 0; i < quotes.length; i++) {
      const raw = quotes[i].symbol ?? '';
      if (!raw) continue;

      // Derive base ticker and yahoo symbol
      const yahooSymbol = raw;
      const baseTicker = region.stripSuffix ? raw.replace(region.stripSuffix, '') : raw;

      // Skip anything that doesn't look like a real equity ticker after stripping
      if (!/^[A-Z0-9.]{1,10}$/.test(baseTicker)) {
        log('debug', 'yahoo-trending: skipping non-standard symbol', { raw, baseTicker });
        continue;
      }

      const rank = i + 1;

      // Resolve exchange: known for DE, dynamic for US
      const exchange = region.exchange ?? await resolveUSExchange(baseTicker).catch(() => 'NASDAQ');

      log('debug', 'yahoo-trending: resolved', { region: region.code, baseTicker, exchange, rank });

      candidates.push({
        id: uuidv4(),
        symbol: baseTicker,
        exchange,
        yahoo_symbol: yahooSymbol,
        isin: null,
        name: baseTicker, // Yahoo trending returns no name – enrichment fills this in
        sources: [{
          adapter: 'yahoo-trending',
          source_url: `https://finance.yahoo.com/trending-tickers/`,
          discovered_at: now,
          signal_type: 'page_view_trending',
          raw_signal: {
            region: region.code,
            rank,
            yahoo_symbol: yahooSymbol,
          },
          info_snippet: `Yahoo Finance Trending ${region.code} #${rank}`,
        }],
        links: buildLinks({ exchange, symbol: baseTicker, yahooSymbol }),
        workspace_state: 'new',
        notes: '',
        enrichment: null,
        first_discovered_at: now,
        last_updated_at: now,
      });

      await sleep(50);
    }

    log('info', 'yahoo-trending: region done', { region: region.code, candidates: candidates.length });

    // Polite pause between region fetches
    if (region !== REGIONS[REGIONS.length - 1]) await sleep(1000);
  }

  log('info', 'yahoo-trending: candidates ready', { count: candidates.length });
  return candidates;
}
