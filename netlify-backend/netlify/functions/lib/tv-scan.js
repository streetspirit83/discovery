/**
 * tv-scan.js — server-side TradingView indicator fetch (lean).
 *
 * Faithful port of the browser enrichment's market/prefix tables and request
 * shape (ui/lib/tv-enrichment.js + exchange-map.js), trimmed to just the columns
 * the alerts need. Netlify Functions reach scanner.tradingview.com directly (the
 * scrape-proxy already does), so no proxy here.
 *
 * Request:  POST https://scanner.tradingview.com/{market}/scan
 *           { markets:[market], symbols:{ tickers:["NASDAQ:AAPL",…] }, columns:[…] }
 * Response: { data: [ { s:"NASDAQ:AAPL", d:[…values in column order…] } ] }
 */

// alias / regional code → canonical internal exchange (copy of exchange-map.js)
const ALIASES = {
  XETRA: 'XETR', ETR: 'XETR', GER: 'XETR', DE: 'XETR',
  FWB: 'XETR', XFRA: 'XETR', FRA: 'XETR', F: 'XETR',
  STU: 'XETR', XSTU: 'XETR', SWB: 'XETR',
  MUN: 'XETR', XMUN: 'XETR',
  BER: 'XETR', XBER: 'XETR',
  DUS: 'XETR', XDUS: 'XETR',
  HAM: 'XETR', XHAM: 'XETR', HAN: 'XETR', XHAN: 'XETR',
  GAT: 'XETR', TRADEGATE: 'XETR', GETTEX: 'XETR',
  XNGS: 'NASDAQ', XNMS: 'NASDAQ', XNCM: 'NASDAQ', XNAS: 'NASDAQ',
  XNYS: 'NYSE', ARCX: 'NYSE', XASE: 'AMEX', BATS: 'AMEX',
  STO: 'OMXSTO', XSTO: 'OMXSTO',
  HEL: 'OMXHEX', XHEL: 'OMXHEX',
  OMXCO: 'OMXCOP', CPH: 'OMXCOP', XCSE: 'OMXCOP', KFX: 'OMXCOP',
  OMXNO: 'OSL', OSE: 'OSL', XOSL: 'OSL', OL: 'OSL',
  WBAG: 'VIE', XWBO: 'VIE',
};
function normalizeExchange(code) {
  if (!code) return code;
  return ALIASES[String(code).trim().toUpperCase()] ?? String(code).trim().toUpperCase();
}

const EXCHANGE_TO_MARKET = {
  NASDAQ: 'america', NYSE: 'america', AMEX: 'america',
  XETR: 'germany', LSE: 'uk', EURONEXT: 'france', MIL: 'italy', BME: 'spain',
  VIE: 'austria', OMXSTO: 'sweden', SIX: 'switzerland', OMXCOP: 'denmark',
  OSL: 'norway', OMXHEX: 'finland',
};
const TV_PREFIX_MAP = {
  NASDAQ: 'NASDAQ', NYSE: 'NYSE', AMEX: 'AMEX', XETR: 'XETR', LSE: 'LSE',
  EURONEXT: 'EURONEXT', MIL: 'MIL', BME: 'BME', VIE: 'VIE', OMXSTO: 'OMXSTO',
  SIX: 'SIX', OMXCOP: 'OMXCOP', OSL: 'OSL', OMXHEX: 'OMXHEX',
};
const GERMAN_REGIONAL_TV = {
  FWB: 'FWB', XFRA: 'FWB', FRA: 'FWB', F: 'FWB',
  STU: 'SWB', XSTU: 'SWB', SWB: 'SWB',
  MUN: 'MUN', XMUN: 'MUN', DUS: 'DUS', XDUS: 'DUS',
  GETTEX: 'GETTEX', GAT: 'TRADEGATE', TRADEGATE: 'TRADEGATE',
  HAM: 'HAM', XHAM: 'HAM', HAN: 'HAN', XHAN: 'HAN',
};
const EURONEXT_FALLBACK_MARKETS = ['netherlands', 'belgium', 'portugal'];

const LEAN_COLUMNS = ['close', 'RSI', 'EMA20', 'EMA50', 'EMA200', 'MACD.macd', 'MACD.signal'];
const rowToTv = (d = []) => ({
  close: d[0] ?? null, rsi: d[1] ?? null,
  ema20: d[2] ?? null, ema50: d[3] ?? null, ema200: d[4] ?? null,
  macd: d[5] ?? null, macd_signal: d[6] ?? null,
});

async function scanMarket(market, entries, results) {
  const tickerMap = new Map(entries.map((e) => [e.tvTicker, e.candidate]));
  const body = { markets: [market], symbols: { tickers: entries.map((e) => e.tvTicker) }, columns: LEAN_COLUMNS };
  let parsed;
  try {
    const res = await fetch(`https://scanner.tradingview.com/${market}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; DiscoveryBot/1.0)' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { console.warn(`[tv-scan] ${market} HTTP ${res.status}`); return entries.map((e) => e.candidate); }
    parsed = await res.json();
  } catch (err) {
    console.warn(`[tv-scan] ${market} failed:`, err.message);
    return entries.map((e) => e.candidate);
  }
  const rows = parsed?.data ?? [];
  for (const row of rows) {
    const c = tickerMap.get(row.s);
    if (c) results.set(c.id, rowToTv(row.d));
  }
  return entries.filter((e) => !rows.find((r) => r.s === e.tvTicker)).map((e) => e.candidate);
}

/**
 * @param {object[]} candidates
 * @returns {Promise<Map<string, {close,rsi,ema20,ema50,ema200,macd,macd_signal}>>} id → indicators
 */
export async function fetchTvIndicators(candidates) {
  const groups = new Map();
  for (const c of candidates) {
    const ex = normalizeExchange(c.exchange);
    const market = EXCHANGE_TO_MARKET[ex];
    const prefix = TV_PREFIX_MAP[ex];
    if (!market || !prefix) continue;
    if (!groups.has(market)) groups.set(market, []);
    groups.get(market).push({ candidate: c, tvTicker: `${prefix}:${c.symbol}` });
  }

  const results = new Map();
  const stillMissing = [];
  for (const [market, entries] of groups) {
    stillMissing.push(...await scanMarket(market, entries, results));
  }

  // German regional fallback (Xetra-normalised miss → original regional venue).
  const regional = [];
  for (const c of stillMissing) {
    if (results.has(c.id)) continue;
    const prefix = GERMAN_REGIONAL_TV[String(c.exchange ?? '').toUpperCase()];
    if (prefix) regional.push({ candidate: c, tvTicker: `${prefix}:${c.symbol}` });
  }
  if (regional.length) await scanMarket('germany', regional, results);

  // Euronext fallback markets (france is the primary lookup above).
  const euronextMissing = stillMissing.filter(
    (c) => !results.has(c.id) && normalizeExchange(c.exchange) === 'EURONEXT',
  );
  for (const market of EURONEXT_FALLBACK_MARKETS) {
    const pending = euronextMissing.filter((c) => !results.has(c.id));
    if (!pending.length) break;
    await scanMarket(market, pending.map((c) => ({ candidate: c, tvTicker: `EURONEXT:${c.symbol}` })), results);
  }

  return results;
}
