/**
 * Yahoo Finance Trending adapter – US and DE regions
 *
 * Fetches Yahoo Finance trending tickers (page-view velocity signal).
 * Trending reflects which stock pages receive above-baseline visits on
 * Yahoo Finance. Order is meaningful – rank 1 = strongest spike.
 *
 * Auth: Yahoo now gates the trending endpoint with a crumb/cookie flow
 * even though it was previously unauthenticated. Flow:
 *   1. GET fc.yahoo.com        → consent cookie
 *   2. GET /v1/test/getcrumb   → crumb token (using that cookie)
 *   3. GET /v1/finance/trending/{region}?crumb=… + Cookie header
 *
 * Crumb is cached for the duration of one adapter run (single process).
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
const COUNT   = 20;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

const REGIONS = [
  { code: 'US', exchange: null,   stripSuffix: null     },
  { code: 'DE', exchange: 'XETR', stripSuffix: /\.DE$/i },
];

// ─── Crumb / cookie acquisition ───────────────────────────────────────────────

let _crumb = null;
let _cookie = '';

async function acquireCrumb() {
  if (_crumb) return true; // already have it for this run

  log('info', 'yahoo-trending: acquiring crumb');

  // Step 1: consent cookie from fc.yahoo.com
  try {
    const gateRes = await fetch('https://fc.yahoo.com', {
      headers: HEADERS,
      redirect: 'follow',
    });
    // Node 18+ getSetCookie(); older Node fallback via get()
    const setCookies = typeof gateRes.headers.getSetCookie === 'function'
      ? gateRes.headers.getSetCookie()
      : [gateRes.headers.get('set-cookie')].filter(Boolean);
    _cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
    log('debug', 'yahoo-trending: gate cookie acquired', { cookieLen: _cookie.length });
  } catch (err) {
    log('warn', 'yahoo-trending: fc.yahoo.com failed, continuing without cookie', { error: err.message });
  }

  // Step 2: crumb token
  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { ...HEADERS, ...(_cookie ? { Cookie: _cookie } : {}) },
  });

  if (!crumbRes.ok) {
    log('error', 'yahoo-trending: crumb request failed', { status: crumbRes.status });
    return false;
  }

  const text = (await crumbRes.text()).trim();
  if (!text || text.toLowerCase().includes('too many') || text.startsWith('<')) {
    log('error', 'yahoo-trending: crumb response invalid', { preview: text.slice(0, 80) });
    return false;
  }

  _crumb = text;
  log('info', 'yahoo-trending: crumb ready', { crumbLen: _crumb.length });
  return true;
}

// ─── Fetch one region ─────────────────────────────────────────────────────────

async function fetchRegion(region) {
  const url = `${YF_BASE}/${region.code}?count=${COUNT}&crumb=${encodeURIComponent(_crumb ?? '')}`;
  log('info', 'yahoo-trending: fetching', { region: region.code });

  let res;
  try {
    res = await fetch(url, {
      headers: { ...HEADERS, ...(_cookie ? { Cookie: _cookie } : {}) },
    });
  } catch (err) {
    log('error', 'yahoo-trending: network error', { region: region.code, error: err.message });
    return [];
  }

  if (res.status === 401 || res.status === 403) {
    log('error', 'yahoo-trending: auth rejected', { region: region.code, status: res.status });
    return [];
  }
  if (res.status === 429) {
    log('error', 'yahoo-trending: rate limited', { region: region.code });
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

  const ok = await acquireCrumb();
  if (!ok) {
    log('error', 'yahoo-trending: cannot proceed without crumb – aborting');
    return [];
  }

  const now = new Date().toISOString();
  const candidates = [];

  for (const region of REGIONS) {
    const quotes = await fetchRegion(region);

    for (let i = 0; i < quotes.length; i++) {
      const raw = quotes[i]?.symbol ?? '';
      if (!raw) continue;

      const yahooSymbol = raw;
      const baseTicker  = region.stripSuffix ? raw.replace(region.stripSuffix, '') : raw;

      if (!/^[A-Z0-9.]{1,10}$/.test(baseTicker)) {
        log('debug', 'yahoo-trending: skipping non-standard symbol', { raw });
        continue;
      }

      const rank     = i + 1;
      const exchange = region.exchange ?? await resolveUSExchange(baseTicker).catch(() => 'NASDAQ');

      log('debug', 'yahoo-trending: resolved', { region: region.code, baseTicker, exchange, rank });

      candidates.push({
        id: uuidv4(),
        symbol: baseTicker,
        exchange,
        yahoo_symbol: yahooSymbol,
        isin: null,
        name: baseTicker, // no name in response – AI enrichment fills it in
        sources: [{
          adapter: 'yahoo-trending',
          source_url: 'https://finance.yahoo.com/trending-tickers/',
          discovered_at: now,
          signal_type: 'page_view_trending',
          raw_signal: { region: region.code, rank, yahoo_symbol: yahooSymbol },
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
    if (region !== REGIONS[REGIONS.length - 1]) await sleep(1000);
  }

  log('info', 'yahoo-trending: candidates ready', { count: candidates.length });
  return candidates;
}
