/**
 * TradingView Screener – browser-side, on-demand.
 *
 * Runs a screen (filter + columns + sort) against the scanner endpoint through
 * the Netlify scrape-proxy (scanner.tradingview.com is already allowlisted), and
 * maps result rows into Discovery candidate objects ready for import.
 *
 * Scanner request:  POST https://scanner.tradingview.com/{market}/scan
 * Body: { filter:[{left,operation,right}], columns:[...], sort:{sortBy,sortOrder}, range:[0,count] }
 * Response: { totalCount, data: [ { s: "NASDAQ:AAPL", d: [...columnValues] } ] }
 */

import { buildLinks } from './link-builder.js';
import { uuid } from './import-parser.js';
import { MARKET_BY_SLUG } from './tv-fields.js';
import { normalizeExchange } from './exchange-map.js';

// ─── Proxy POST (same pattern as tv-enrichment.js) ──────────────────────────────
async function proxyPost(backendUrl, secret, url, requestBody) {
  const proxyUrl = `${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`;

  let res;
  try {
    res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
      body: JSON.stringify({
        url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      }),
    });
  } catch (err) {
    throw new Error(`Proxy network error: ${err.message}`);
  }

  if (res.status === 401) throw new Error('Unauthorized – Shared Secret prüfen');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Proxy HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const wrapper = await res.json();
  if (!wrapper.ok) throw new Error(`Proxy: ${wrapper.error}`);
  if (wrapper.status !== 200) {
    throw new Error(`TradingView HTTP ${wrapper.status} – ${String(wrapper.body).slice(0, 200)}`);
  }
  return wrapper.body;
}

// ─── Run a screen ───────────────────────────────────────────────────────────────
/**
 * @param {object} screen { market, filter, columns, sort, count }
 * @param {{ backendUrl: string, secret: string }} auth
 * @returns {Promise<{ totalCount: number, rows: {s:string,d:any[]}[] }>}
 */
export async function runScreen({ market, filter, columns, sort, count }, { backendUrl, secret }) {
  // Always constrain to common stock unless the caller already set a type filter.
  const hasType = (filter ?? []).some((f) => f.left === 'type');
  const effectiveFilter = hasType
    ? filter
    : [{ left: 'type', operation: 'equal', right: 'stock' }, ...(filter ?? [])];

  const requestBody = {
    filter: effectiveFilter,
    columns,
    sort: sort ?? { sortBy: columns[0], sortOrder: 'desc' },
    range: [0, count ?? 50],
  };

  const bodyStr = await proxyPost(
    backendUrl, secret,
    `https://scanner.tradingview.com/${market}/scan`,
    requestBody,
  );

  let parsed;
  try {
    parsed = JSON.parse(bodyStr);
  } catch {
    throw new Error('TradingView lieferte ungültiges JSON');
  }

  if (!Array.isArray(parsed?.data)) {
    throw new Error('Unerwartetes TradingView-Schema (data fehlt)');
  }

  return { totalCount: parsed.totalCount ?? parsed.data.length, rows: parsed.data };
}

// ─── Fetch specific index/symbol tickers ────────────────────────────────────────
/**
 * Fetch a fixed set of tickers via TradingView's *global* scan (not a per-market
 * screen). Used for the macro barometer, which tracks named benchmark indices
 * (DAX, Nasdaq, Nikkei, VIX) rather than a screened stock universe.
 * @param {string[]} tickers  e.g. ['XETR:DAX','NASDAQ:IXIC','TVC:NI225']
 * @param {string[]} columns  e.g. ['change','Perf.W','Perf.1M']
 * @param {{ backendUrl: string, secret: string }} auth
 * @returns {Promise<Map<string, any[]>>} ticker → row.d column values
 */
export async function fetchGlobalQuotes(tickers, columns, { backendUrl, secret }) {
  const bodyStr = await proxyPost(
    backendUrl, secret,
    'https://scanner.tradingview.com/global/scan',
    { symbols: { tickers, query: { types: [] } }, columns },
  );
  let parsed;
  try {
    parsed = JSON.parse(bodyStr);
  } catch {
    throw new Error('TradingView lieferte ungültiges JSON');
  }
  const rows = Array.isArray(parsed?.data) ? parsed.data : [];
  return new Map(rows.map((r) => [r.s, r.d]));
}

// ─── Map rows → candidates ──────────────────────────────────────────────────────
function parseTicker(s) {
  const colon = s.indexOf(':');
  if (colon === -1) return null;
  const tvExch = s.slice(0, colon);
  const symbol = s.slice(colon + 1);
  // Regional/alias venue prefixes (TRADEGATE, GETTEX, FWB, STU, ...) collapse onto
  // the canonical exchange (e.g. XETR) instead of being dropped as unrecognised.
  const exchange = normalizeExchange(tvExch) || null;
  return exchange ? { symbol, exchange, tvExch } : null;
}

/**
 * @param {{s:string,d:any[]}[]} rows
 * @param {object} meta { market, columns, presetId, presetLabel, filter, sourceUrl }
 * @returns {object[]} Discovery candidate objects
 */
export function rowsToCandidates(rows, { market, columns, presetId, presetLabel, filter, sourceUrl }) {
  const marketDef = MARKET_BY_SLUG.get(market);
  const yahooSuffix = marketDef?.yahooSuffix ?? '';
  const descIdx = columns.indexOf('description');
  const now = new Date().toISOString();
  const seen = new Set();
  const out = [];

  rows.forEach((row, i) => {
    const parsed = parseTicker(row.s ?? '');
    if (!parsed) return;
    const { symbol, exchange, tvExch } = parsed;
    if (!/^[A-Z0-9.]{1,15}$/.test(symbol)) return;

    const key = `${symbol}:${exchange}`;
    if (seen.has(key)) return;
    seen.add(key);

    const d = row.d ?? [];
    const name = (descIdx !== -1 && d[descIdx]) ? d[descIdx] : symbol;
    const yahooSymbol = `${symbol}${yahooSuffix}`;

    // Snapshot the requested column values for the source record.
    const values = {};
    columns.forEach((col, idx) => { values[col] = d[idx] ?? null; });

    out.push({
      id: uuid(),
      symbol,
      exchange,
      yahoo_symbol: yahooSymbol,
      isin: null,
      name,
      sources: [{
        adapter: 'tradingview-screener',
        source_url: sourceUrl ?? `https://scanner.tradingview.com/${market}/scan`,
        discovered_at: now,
        signal_type: 'custom_screen',
        raw_signal: { preset: presetId ?? null, preset_label: presetLabel ?? null, rank: i + 1, market, filter, values, tvExch },
        info_snippet: `Screener „${presetLabel ?? 'Custom'}" #${i + 1}`,
      }],
      links: buildLinks({ exchange, symbol, yahooSymbol }),
      workspace_state: 'new',
      notes: '',
      enrichment: null,
      first_discovered_at: now,
      last_updated_at: now,
    });
  });

  return out;
}
