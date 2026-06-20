/**
 * Trade Republic tradability check (via Lang & Schwarz).
 *
 * Trade Republic executes via the LS Exchange (Lang & Schwarz). Their public
 * instrument search is queryable by ISIN/WKN/name and is the most reliable
 * free signal for "is this on TR":
 *   - found on LS  → very likely tradable on Trade Republic
 *   - not on LS    → definitely NOT on Trade Republic
 * (LS-listing is a necessary condition; the per-row deep link lets the user
 * confirm the last mile in one click.)
 *
 * Browser → LS has no CORS, so the call goes through the scrape-proxy.
 *
 * Output: { tradable:boolean|null, ls_id, ls_link, ls_name, checked_at }
 */

export async function checkTradeRepublic(candidate, { backendUrl, secret }) {
  const isin = String(candidate.isin ?? '').trim().toUpperCase();
  const q = isin || String(candidate.symbol ?? '').trim();
  if (!q) return null;

  const lsUrl = `https://www.ls-tc.de/_rpc/json/.lstc/instrument/search/main?q=${encodeURIComponent(q)}&localeId=2`;
  const proxyUrl = `${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`;

  let wrapper;
  try {
    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
      body: JSON.stringify({ url: lsUrl, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' } }),
    });
    wrapper = await res.json();
  } catch (err) {
    return { tradable: null, error: err.message, checked_at: new Date().toISOString() };
  }

  if (!wrapper?.ok || wrapper.status !== 200) {
    return { tradable: null, checked_at: new Date().toISOString() };
  }

  let arr;
  try { arr = JSON.parse(wrapper.body); } catch { arr = null; }
  if (!Array.isArray(arr)) return { tradable: null, checked_at: new Date().toISOString() };

  // With an ISIN, require an exact match (avoids fuzzy name hits); otherwise
  // accept the first stock entry.
  let hit = null;
  if (isin) hit = arr.find((x) => String(x.isin ?? '').toUpperCase() === isin);
  if (!hit && !isin) hit = arr.find((x) => x.categorySymbol === 'STK') ?? arr[0] ?? null;

  return {
    tradable: !!hit,
    ls_id: hit?.instrumentId ?? hit?.id ?? null,
    ls_link: hit?.link ? `https://www.ls-tc.de${hit.link}` : null,
    ls_name: hit?.displayname ?? null,
    checked_at: new Date().toISOString(),
  };
}
