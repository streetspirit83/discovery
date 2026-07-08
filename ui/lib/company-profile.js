/**
 * company-profile.js — Firmenprofil (Business Description) für das Detail-Modal.
 *
 * Quellen-Kaskade über den vorhandenen scrape-proxy (beide Hosts sind bereits
 * allowlisted, kein Backend-Deploy nötig):
 *   1. TradingView scanner: symbols-Scan mit der Spalte `business_description`
 *      (deckt alle Märkte ab, gleiche Infrastruktur wie das TV-Enrichment).
 *   2. Yahoo quoteSummary `assetProfile.longBusinessSummary` (crumb-frei
 *      versucht — Yahoo verlangt den Crumb je nach Region/IP; wenn 401/403
 *      kommt, bleibt es beim TV-Ergebnis bzw. "kein Profil").
 *
 * Ergebnis wird 30 Tage in localStorage gecacht (Profiltexte ändern sich
 * praktisch nie) — pro Kandidat genau ein Netz-Roundtrip.
 */

import { EXCHANGE_TO_MARKET, TV_PREFIX_MAP } from './tv-enrichment.js?v=20260707e';
import { normalizeExchange } from './exchange-map.js';

const CACHE_PREFIX = 'discovery_profile_';
const CACHE_TTL = 30 * 864e5;

async function proxyFetch(backendUrl, secret, { url, method = 'GET', body = null }) {
  const proxyUrl = `${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`;
  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
    body: JSON.stringify({
      url, method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
      ...(body != null ? { body } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
  const wrapper = await res.json();
  if (!wrapper.ok) throw new Error(`Proxy: ${wrapper.error}`);
  if (wrapper.status !== 200) throw new Error(`Upstream HTTP ${wrapper.status}`);
  return wrapper.body;
}

function cacheGet(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key));
    if (raw && Date.now() - (raw.at ?? 0) < CACHE_TTL) return raw.profile;
  } catch { /* ignore */ }
  return undefined;
}
function cacheSet(key, profile) {
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), profile })); } catch { /* quota */ }
}

async function fromTradingView(candidate, auth) {
  const exch = normalizeExchange(candidate.exchange);
  const market = EXCHANGE_TO_MARKET[exch];
  const prefix = TV_PREFIX_MAP[exch];
  if (!market || !prefix) return null;
  const body = JSON.stringify({
    symbols: { tickers: [`${prefix}:${candidate.symbol}`] },
    columns: ['business_description', 'web_site_url'],
  });
  const text = await proxyFetch(auth.backendUrl, auth.secret, {
    url: `https://scanner.tradingview.com/${market}/scan`, method: 'POST', body,
  });
  const d = JSON.parse(text)?.data?.[0]?.d;
  const description = typeof d?.[0] === 'string' && d[0].trim().length > 40 ? d[0].trim() : null;
  if (!description) return null;
  return { description, website: d?.[1] || null, source: 'tv' };
}

async function fromYahoo(candidate, auth) {
  const exch = normalizeExchange(candidate.exchange);
  const ySym = candidate.yahoo_symbol
    ?? (['NASDAQ', 'NYSE', 'AMEX'].includes(exch) ? candidate.symbol : null);
  if (!ySym) return null;
  const text = await proxyFetch(auth.backendUrl, auth.secret, {
    url: `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ySym)}?modules=assetProfile`,
  });
  const ap = JSON.parse(text)?.quoteSummary?.result?.[0]?.assetProfile;
  const description = typeof ap?.longBusinessSummary === 'string' && ap.longBusinessSummary.trim().length > 40
    ? ap.longBusinessSummary.trim() : null;
  if (!description) return null;
  return { description, website: ap.website || null, source: 'yahoo' };
}

/**
 * @returns {Promise<{description, website, source, fetched_at}|null>} null = keine Quelle lieferte.
 */
export async function fetchCompanyProfile(candidate, auth) {
  if (!candidate?.symbol || !auth?.backendUrl || !auth?.secret) return null;
  const key = `${CACHE_PREFIX}${normalizeExchange(candidate.exchange)}:${candidate.symbol}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  let profile = null;
  for (const src of [fromTradingView, fromYahoo]) {
    try {
      profile = await src(candidate, auth);
      if (profile) break;
    } catch (err) {
      console.warn(`[profile] ${src.name} fehlgeschlagen:`, err.message);
    }
  }
  if (profile) profile.fetched_at = new Date().toISOString();
  cacheSet(key, profile);   // auch null cachen → kein Re-Hammering toter Quellen
  return profile;
}
