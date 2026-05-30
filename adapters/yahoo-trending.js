/**
 * Yahoo Finance Trending adapter – US and DE regions
 *
 * Fetches via the Netlify scrape-proxy (AWS IP, browser headers).
 * GitHub Actions (Azure) is range-blocked by Yahoo; Netlify is not.
 *
 * Method 1 – API endpoint (preferred):
 *   query1.finance.yahoo.com/v1/finance/trending/{region}
 *   Requires Origin + Referer to pass Yahoo's bot filter.
 *
 * Method 2 – HTML fallback:
 *   finance.yahoo.com/markets/stocks/trending/
 *   Yahoo embeds full page data as window.__context JSON in the HTML.
 *   Extracted via brace-counting (not regex) to handle arbitrary size.
 *
 * Signal: page-view velocity – rank 1 = strongest attention spike.
 * Order is meaningful; not alphabetical, not price/volume sorted.
 */

import { v4 as uuidv4 } from 'uuid';
import { buildLinks } from './_shared/link-builder.js';
import { resolveUSExchange } from './_shared/us-exchange-resolver.js';

const log = (level, msg, data = {}) =>
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COUNT = 20;

const REGIONS = [
  { code: 'US', exchange: null,   stripSuffix: null     },
  { code: 'DE', exchange: 'XETR', stripSuffix: /\.DE$/i },
];

// Browser headers that pass Yahoo's bot filter (per spec)
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Origin': 'https://finance.yahoo.com',
  'Referer': 'https://finance.yahoo.com/',
};

// ─── Proxy helper ─────────────────────────────────────────────────────────────

async function proxyFetch(url, extraHeaders = {}) {
  const backendUrl = process.env.DISCOVERY_BACKEND_URL;
  const secret     = process.env.DISCOVERY_SECRET;
  if (!backendUrl || !secret) throw new Error('DISCOVERY_BACKEND_URL / DISCOVERY_SECRET not set');

  const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
    body: JSON.stringify({
      url,
      method: 'GET',
      headers: { ...BROWSER_HEADERS, ...extraHeaders },
    }),
  });

  if (!res.ok) throw new Error(`Proxy responded ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`Proxy error: ${data.error}`);
  return data; // { status, body, content_type }
}

// ─── Method 1: API endpoint ───────────────────────────────────────────────────

async function fetchViaAPI(region) {
  const url = `https://query1.finance.yahoo.com/v1/finance/trending/${region}?count=${COUNT}`;
  log('info', 'yahoo-trending: method1 API', { region, url });

  let proxy;
  try {
    proxy = await proxyFetch(url, { Accept: 'application/json' });
  } catch (err) {
    log('warn', 'yahoo-trending: proxy call failed', { region, error: err.message });
    return null;
  }

  log('debug', 'yahoo-trending: method1 upstream status', { region, status: proxy.status });

  if (proxy.status !== 200) return null;

  try {
    const data = JSON.parse(proxy.body);
    const quotes = data?.finance?.result?.[0]?.quotes ?? [];
    log('info', 'yahoo-trending: method1 success', { region, count: quotes.length });
    return quotes.length > 0 ? quotes : null;
  } catch {
    log('warn', 'yahoo-trending: method1 JSON parse failed', { region });
    return null;
  }
}

// ─── Method 2: HTML + window.__context fallback ───────────────────────────────

// Brace-counting JSON extractor – handles arbitrarily large embedded objects
function extractBracedJson(text, startMarker) {
  const idx = text.indexOf(startMarker);
  if (idx === -1) return null;

  const objStart = text.indexOf('{', idx);
  if (objStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = objStart; i < text.length; i++) {
    const ch = text[i];
    if (escape)           { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true;  continue; }
    if (ch === '"')       { inString = !inString; continue; }
    if (inString)         { continue; }
    if (ch === '{')       { depth++; }
    else if (ch === '}')  { depth--; if (depth === 0) return text.slice(objStart, i + 1); }
  }
  return null;
}

// Navigate the context object looking for an array of { symbol } objects
function findQuotesInContext(ctx) {
  const topKeys = Object.keys(ctx ?? {});
  log('debug', 'yahoo-trending: context top-level keys', { keys: topKeys.slice(0, 30) });

  // Known paths – extended as we discover the live structure
  const PATHS = [
    ['dispatcher', 'stores', 'TrendingTickersStore', 'tickers'],
    ['dispatcher', 'stores', 'TrendingStore', 'tickers'],
    ['dispatcher', 'stores', 'StreamDataStore', 'quoteData'],
    ['context', 'dispatcher', 'stores', 'TrendingTickersStore', 'tickers'],
  ];

  for (const path of PATHS) {
    let node = ctx;
    for (const key of path) { node = node?.[key]; }
    if (!node) continue;

    if (Array.isArray(node) && node.length > 0) {
      const symbols = node.map((t) => ({ symbol: t?.symbol ?? t })).filter((t) => t.symbol);
      if (symbols.length > 0) {
        log('info', 'yahoo-trending: found quotes via path', { path: path.join('.'), count: symbols.length });
        return symbols;
      }
    }

    if (node && typeof node === 'object' && !Array.isArray(node)) {
      const symbols = Object.keys(node)
        .filter((k) => /^[A-Z]/.test(k))
        .map((k) => ({ symbol: k }));
      if (symbols.length > 0) {
        log('info', 'yahoo-trending: found quotes via object keys', { path: path.join('.'), count: symbols.length });
        return symbols;
      }
    }
  }

  // Last resort: log a structured sample so we can identify the correct path
  log('warn', 'yahoo-trending: context path unknown – logging structure for diagnostics', {
    topKeys: topKeys.slice(0, 20),
    dispatcherKeys: Object.keys(ctx?.dispatcher ?? {}).slice(0, 20),
    storeKeys: Object.keys(ctx?.dispatcher?.stores ?? {}).slice(0, 30),
  });
  return null;
}

async function fetchViaHTML() {
  const url = 'https://finance.yahoo.com/markets/stocks/trending/';
  log('info', 'yahoo-trending: method2 HTML fallback', { url });

  let proxy;
  try {
    proxy = await proxyFetch(url);
  } catch (err) {
    log('warn', 'yahoo-trending: method2 proxy failed', { error: err.message });
    return null;
  }

  log('debug', 'yahoo-trending: method2 upstream status', { status: proxy.status, size: proxy.body?.length });

  if (proxy.status !== 200) return null;

  const html = proxy.body ?? '';

  const jsonStr = extractBracedJson(html, 'window.__context');
  if (!jsonStr) {
    log('warn', 'yahoo-trending: window.__context not found', {
      htmlPreview: html.slice(0, 500),
    });
    return null;
  }

  log('debug', 'yahoo-trending: context JSON extracted', { bytes: jsonStr.length });

  let ctx;
  try {
    ctx = JSON.parse(jsonStr);
  } catch (err) {
    log('error', 'yahoo-trending: context JSON parse failed', { error: err.message });
    return null;
  }

  return findQuotesInContext(ctx);
}

// ─── Fetch one region ─────────────────────────────────────────────────────────

async function fetchRegion(region) {
  // Method 1 first – lighter, structured response
  let quotes = await fetchViaAPI(region.code);

  // Method 2 – HTML fallback if API is blocked or empty
  if (!quotes) {
    log('info', 'yahoo-trending: falling back to HTML method', { region: region.code });
    quotes = await fetchViaHTML();
  }

  return quotes ?? [];
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchCandidates() {
  log('info', 'yahoo-trending: starting', { regions: REGIONS.map((r) => r.code) });

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

      candidates.push({
        id: uuidv4(),
        symbol: baseTicker,
        exchange,
        yahoo_symbol: yahooSymbol,
        isin: null,
        name: baseTicker, // no name in trending response – AI enrichment fills it in
        sources: [{
          adapter: 'yahoo-trending',
          source_url: 'https://finance.yahoo.com/markets/stocks/trending/',
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

    log('info', 'yahoo-trending: region done', { region: region.code, added: candidates.length });
    if (region !== REGIONS[REGIONS.length - 1]) await sleep(1000);
  }

  log('info', 'yahoo-trending: candidates ready', { count: candidates.length });
  return candidates;
}
