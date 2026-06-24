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
 * Match key: SYMBOL only. Merkliste tickers carry no ISIN, and the exchange
 * strings differ between the two apps, so symbol+exchange is unreliable. We
 * index each merkliste entry under its symbol plus its yahoo/twelvedata symbol
 * aliases, then look up Discovery candidates by symbol (and yahoo_symbol).
 */

const MERKLISTE_BLOB_URL = 'https://merkliste-app.netlify.app/.netlify/functions/blob';

const up = (v) => String(v ?? '').trim().toUpperCase();

/**
 * Fetch the merkliste blob through the proxy and build a symbol → entry map.
 * @returns {{ bySym: Map<string,number> } | null}
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

  const bySym = new Map();
  for (const t of tickers) {
    const entry = t?.user?.entry_price_manual;
    if (entry == null) continue;
    const shares = t?.user?.entry_shares ?? null;
    const s = t?.stamm ?? {};
    for (const alias of [s.symbol, s.yahoo_symbol, s.twelvedata_symbol]) {
      const key = up(alias);
      if (key) bySym.set(key, { entry, shares });
    }
  }
  return { bySym };
}

/**
 * Attach `mk_entry` (EUR) and `mk_shares` (count, or null) to each candidate by
 * symbol match. Sets null when the ticker isn't in the portfolio.
 * @returns {number} count of candidates that matched a portfolio entry
 */
export function applyMerklisteEntries(candidates, maps) {
  if (!maps?.bySym || !Array.isArray(candidates)) return 0;
  let matched = 0;
  for (const c of candidates) {
    let hit = null;
    for (const alias of [c.symbol, c.yahoo_symbol]) {
      const key = up(alias);
      if (key && maps.bySym.has(key)) { hit = maps.bySym.get(key); break; }
    }
    c.mk_entry  = hit ? hit.entry : null;
    c.mk_shares = hit ? hit.shares : null;
    if (hit) matched++;
  }
  return matched;
}
