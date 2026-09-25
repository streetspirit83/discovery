/**
 * Lang & Schwarz intraday quote.
 *
 * LS (Lang & Schwarz Exchange) is the venue Trade Republic executes on. It quotes
 * in EUR ~07:30–23:00 CET, so its last price is close to the EUR price you'd
 * actually pay on TR — fresher and broader-hours than the TV scanner snapshot.
 *
 * Its public chart RPC returns minute-resolution intraday data plus the
 * previous-day close, no auth/key required. Note the path has NO `.lstc` segment
 * (unlike the instrument search), and any non-default User-Agent is required.
 *
 * Flow: resolve the LS instrumentId (reuse the one the TR-check already cached as
 * `ls_id`, else look it up by ISIN), fetch the intraday series, take the last
 * point, and derive Δ% vs. the previous close.
 *
 * Browser → LS has no CORS, so calls go through the scrape-proxy.
 *
 * Output: { price, prev_close, change_pct, ts, instrument_id, checked_at }   (EUR)
 *       | { no_isin:true, checked_at }
 *       | { error, checked_at }
 */

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

// Evenly downsample an intraday [ts, price][] to ~n prices (first + last kept),
// small enough to store per candidate yet enough to draw a recognisable shape.
function downsample(points, n) {
  const prices = points.map((p) => (Array.isArray(p) ? p[1] : null)).filter((v) => v != null);
  if (prices.length <= n) return prices;
  const step = (prices.length - 1) / (n - 1);
  const out = [];
  for (let i = 0; i < n; i++) out.push(prices[Math.round(i * step)]);
  return out;
}

async function proxyGet(url, { backendUrl, secret }) {
  const proxyUrl = `${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`;
  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
    body: JSON.stringify({ url, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' } }),
  });
  const wrapper = await res.json();
  if (!wrapper?.ok || wrapper.status !== 200) return null;
  return wrapper.body;
}

/* Die Instrument-ID ist bei LS stabil — sie einmal aufzulösen und danach
   wiederzuverwenden spart JEDEN zweiten Request. Quellen in dieser Reihenfolge:
   der TR-Check (der sucht ohnehin über die ISIN) und die letzte LS-Quote, die
   ihre `instrument_id` längst mitliefert. Letztere wurde vorher nie gelesen —
   ohne TR-Check zahlte damit jeder Abruf für jeden Titel dauerhaft zwei
   Proxy-Runden statt einer. */
async function resolveInstrumentId(candidate, auth) {
  const cached = candidate.tr_check?.ls_id ?? candidate.ls_quote?.instrument_id;
  if (cached != null && cached !== '') return cached;

  const isin = String(candidate.isin ?? '').trim().toUpperCase();
  if (!ISIN_RE.test(isin)) return null;

  const body = await proxyGet(
    `https://www.ls-tc.de/_rpc/json/.lstc/instrument/search/main?q=${encodeURIComponent(isin)}&localeId=2`,
    auth,
  );
  if (!body) return null;
  let arr; try { arr = JSON.parse(body); } catch { arr = null; }
  if (!Array.isArray(arr)) return null;
  // Exact ISIN match (LS search is fuzzy otherwise).
  const hit = arr.find((x) => String(x.isin ?? '').toUpperCase() === isin);
  return hit?.instrumentId ?? null;
}

export async function fetchLsQuote(candidate, { backendUrl, secret }) {
  const auth = { backendUrl, secret };
  const now = new Date().toISOString();

  let instrumentId;
  try {
    instrumentId = await resolveInstrumentId(candidate, auth);
  } catch (err) {
    return { error: err.message, checked_at: now };
  }
  if (instrumentId == null) return { no_isin: true, checked_at: now };

  const url = `https://www.ls-tc.de/_rpc/json/instrument/chart/dataForInstrument?instrumentId=${encodeURIComponent(instrumentId)}&series=intraday`;
  let body;
  try {
    body = await proxyGet(url, auth);
  } catch (err) {
    return { error: err.message, instrument_id: instrumentId, checked_at: now };
  }
  if (!body) return { error: 'LS nicht erreichbar', instrument_id: instrumentId, checked_at: now };

  let data; try { data = JSON.parse(body); } catch { data = null; }
  const points = data?.series?.intraday?.data;
  if (!Array.isArray(points) || points.length === 0) {
    return { error: 'Keine Intraday-Daten', instrument_id: instrumentId, checked_at: now };
  }

  const last = points[points.length - 1];
  const price = Array.isArray(last) ? last[1] : null;
  const ts    = Array.isArray(last) ? last[0] : null;

  const prevLine = (data?.info?.plotlines ?? []).find((p) => p.id === 'previousDay');
  const prevClose = prevLine?.value ?? null;
  const changePct = (price != null && prevClose != null && prevClose !== 0)
    ? (price - prevClose) / prevClose * 100
    : null;

  // Keep the day's shape (downsampled) + range for the sparkline column.
  const allPrices = points.map((p) => (Array.isArray(p) ? p[1] : null)).filter((v) => v != null);
  const series = downsample(points, 40);
  const dayLow  = allPrices.length ? Math.min(...allPrices) : null;
  const dayHigh = allPrices.length ? Math.max(...allPrices) : null;

  return {
    price,
    prev_close: prevClose,
    change_pct: changePct,
    series,
    day_low: dayLow,
    day_high: dayHigh,
    ts,
    instrument_id: instrumentId,
    checked_at: now,
  };
}
