/**
 * ls-quote.js — server-side quote source for the alert push.
 *
 * Primary: Lang & Schwarz (the Trade-Republic venue, EUR). Same RPC the browser
 * uses, but fetched directly here (Netlify Functions reach ls-tc.de — that's how
 * the scrape-proxy already works). Fallback: Yahoo (native → caller converts).
 *
 * LS returns EUR. Yahoo returns the instrument's native currency.
 */

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

async function lsGet(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

async function resolveInstrumentId(candidate) {
  const cached = candidate.tr_check?.ls_id;
  if (cached != null && cached !== '') return cached;
  const isin = String(candidate.isin ?? '').trim().toUpperCase();
  if (!ISIN_RE.test(isin)) return null;
  const body = await lsGet(`https://www.ls-tc.de/_rpc/json/.lstc/instrument/search/main?q=${encodeURIComponent(isin)}&localeId=2`);
  if (!body) return null;
  let arr; try { arr = JSON.parse(body); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  const hit = arr.find((x) => String(x.isin ?? '').toUpperCase() === isin);
  return hit?.instrumentId ?? null;
}

/* Shared: resolve + fetch the intraday chart. → { id, points, prevClose } | null */
async function fetchLsChart(candidate) {
  const id = await resolveInstrumentId(candidate);
  if (id == null) return null;
  const body = await lsGet(`https://www.ls-tc.de/_rpc/json/instrument/chart/dataForInstrument?instrumentId=${encodeURIComponent(id)}&series=intraday`);
  if (!body) return null;
  let data; try { data = JSON.parse(body); } catch { return null; }
  const points = data?.series?.intraday?.data;
  if (!Array.isArray(points) || !points.length) return null;
  const prevLine = (data?.info?.plotlines ?? []).find((p) => p.id === 'previousDay');
  return { id, points, prevClose: prevLine?.value ?? null };
}

/* Evenly downsample [ts,price][] to ~n prices (first + last kept). */
function downsample(points, n) {
  const prices = points.map((p) => (Array.isArray(p) ? p[1] : null)).filter((v) => v != null);
  if (prices.length <= n) return prices;
  const step = (prices.length - 1) / (n - 1);
  const out = [];
  for (let i = 0; i < n; i++) out.push(prices[Math.round(i * step)]);
  return out;
}

/* LS intraday last price (EUR) + previous close. null when unavailable. */
export async function fetchLsPrice(candidate) {
  const chart = await fetchLsChart(candidate);
  if (!chart) return null;
  const last = chart.points[chart.points.length - 1];
  const price = Array.isArray(last) ? last[1] : null;
  if (price == null) return null;
  const prevClose = chart.prevClose;
  const change_pct = (prevClose != null && prevClose !== 0) ? (price - prevClose) / prevClose * 100 : null;
  return { price, prev_close: prevClose, change_pct, ls_id: chart.id, source: 'ls' };
}

/* Full intraday snapshot for the daily history: downsampled series + day range. */
export async function fetchLsSnapshot(candidate, n = 40) {
  const chart = await fetchLsChart(candidate);
  if (!chart) return null;
  const all = chart.points.map((p) => (Array.isArray(p) ? p[1] : null)).filter((v) => v != null);
  if (!all.length) return null;
  const last = chart.points[chart.points.length - 1];
  const close = Array.isArray(last) ? last[1] : null;
  const ts    = Array.isArray(last) ? last[0] : null;
  const prevClose = chart.prevClose;
  const change_pct = (prevClose != null && prevClose !== 0 && close != null) ? (close - prevClose) / prevClose * 100 : null;
  return {
    close,
    prev_close: prevClose,
    change_pct,
    day_low: Math.min(...all),
    day_high: Math.max(...all),
    series: downsample(chart.points, n),
    ts,
  };
}

/* ── Yahoo fallback ─────────────────────────────────────────────────── */

const YAHOO_BASES = [
  'https://query2.finance.yahoo.com/v8/finance/chart',
  'https://query1.finance.yahoo.com/v8/finance/chart',
];
const UA_POOL = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

async function yahooMeta(symbol) {
  const params = new URLSearchParams({ interval: '1d', range: '1d', includePrePost: 'false' });
  for (let i = 0; i < YAHOO_BASES.length; i++) {
    try {
      const res = await fetch(`${YAHOO_BASES[i]}/${encodeURIComponent(symbol)}?${params}`,
        { headers: { 'User-Agent': UA_POOL[i % UA_POOL.length], Referer: 'https://finance.yahoo.com/' } });
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (result) return result;
    } catch { /* try next base */ }
  }
  return null;
}

/* Yahoo last price in the instrument's native currency. null when unavailable. */
export async function fetchYahooPrice(symbol) {
  const result = await yahooMeta(symbol);
  const p = result?.meta?.regularMarketPrice;
  return p != null ? +p : null;
}

/* Yahoo day's regular-market volume (share count, currency-agnostic). LS's
   intraday RPC is price-only, so daily volume for the snapshot comes from here. */
export async function fetchYahooVolume(symbol) {
  const result = await yahooMeta(symbol);
  const v = result?.meta?.regularMarketVolume;
  return v != null ? +v : null;
}

/* EUR/USD (USD per 1 EUR) via Yahoo. null → no conversion. */
export async function fetchEurUsd() {
  const result = await yahooMeta('EURUSD=X');
  const rate = result?.meta?.regularMarketPrice;
  return rate && rate > 0 ? rate : null;
}
