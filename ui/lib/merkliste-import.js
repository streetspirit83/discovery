/**
 * Merkliste portfolio import.
 *
 * Reads the merkliste app's public "main" blob (the watchlist/portfolio) and
 * extracts each ticker's manual entry price (`user.entry_price_manual`, stored
 * in EUR — the Trade-Republic display currency). Used to surface the user's
 * cost basis ("Einstand") next to the LS live quote in the Discovery table.
 *
 * Browser → merkliste-app.netlify.app has no CORS, so the read goes through the
 * Discovery scrape-proxy (the merkliste blob URL is on the proxy allowlist).
 *
 * Match key: ISIN first (most reliable), then SYMBOL:EXCHANGE as a fallback.
 */

const MERKLISTE_BLOB_URL = 'https://merkliste-app.netlify.app/.netlify/functions/blob';
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

const up = (v) => String(v ?? '').trim().toUpperCase();

/**
 * Fetch the merkliste blob through the proxy and build lookup maps of
 * entry_price_manual keyed by ISIN and by SYMBOL:EXCHANGE.
 * @returns {{ byIsin: Map<string,number>, bySymEx: Map<string,number> } | null}
 */
export async function fetchMerklisteEntries({ backendUrl, secret }) {
  const proxyUrl = `${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`;
  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
    body: JSON.stringify({ url: MERKLISTE_BLOB_URL, method: 'GET' }),
  });
  const wrapper = await res.json();
  if (!wrapper?.ok || wrapper.status !== 200) return null;

  let data; try { data = JSON.parse(wrapper.body); } catch { return null; }
  const tickers = Array.isArray(data?.tickers) ? data.tickers : [];

  const byIsin = new Map();
  const bySymEx = new Map();
  for (const t of tickers) {
    const entry = t?.user?.entry_price_manual;
    if (entry == null) continue;
    const isin = up(t?.stamm?.isin);
    const sym  = up(t?.stamm?.symbol);
    const exch = up(t?.stamm?.exchange);
    if (ISIN_RE.test(isin)) byIsin.set(isin, entry);
    if (sym) bySymEx.set(`${sym}:${exch}`, entry);
  }
  return { byIsin, bySymEx };
}

/**
 * Attach `mk_entry` (EUR, or null) to each candidate from the merkliste maps.
 * @returns {number} count of candidates that matched a portfolio entry
 */
export function applyMerklisteEntries(candidates, maps) {
  if (!maps || !Array.isArray(candidates)) return 0;
  let matched = 0;
  for (const c of candidates) {
    const isin = up(c.isin);
    const key  = `${up(c.symbol)}:${up(c.exchange)}`;
    let entry = null;
    if (ISIN_RE.test(isin) && maps.byIsin.has(isin)) entry = maps.byIsin.get(isin);
    else if (maps.bySymEx.has(key))                  entry = maps.bySymEx.get(key);
    c.mk_entry = entry;
    if (entry != null) matched++;
  }
  return matched;
}
