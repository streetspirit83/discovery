/**
 * company-profile.js — Firmenprofil (Business Description) für das Detail-Modal.
 *
 * Quellen-Kaskade:
 *   1. ROIC.ai `/v2/company/profile/{identifier}` — deckt alle börsennotierten
 *      Firmen ab, Lookup bevorzugt per ISIN (löst das EU-Symbol-Mapping),
 *      liefert description + Fakten (CEO, Mitarbeiter, IPO, Industry).
 *      Braucht einen API-Key (Settings → ROIC.ai API Key, localStorage
 *      `discovery_roic_key`). Erst Direkt-Fetch (falls CORS offen), sonst
 *      über den scrape-proxy (api.roic.ai ist allowlisted).
 *   2. Wikipedia (de → en) als Fallback ohne Key — REST-API ist CORS-offen,
 *      läuft direkt aus dem Browser; deckt Nebenwerte aber nicht immer ab.
 *
 * Treffer werden 30 Tage, Fehlversuche 3 Tage in localStorage gecacht.
 */

import { normalizeExchange } from './exchange-map.js';

const CACHE_PREFIX = 'discovery_profile3_';
const TTL_HIT = 30 * 864e5;
const TTL_MISS = 3 * 864e5;

// Caches älterer Versionen einmalig wegräumen (dort liegen u. a. gecachte
// Wikipedia-Misses, die sonst den ROIC-Upgrade-Pfad 3–30 Tage blockieren).
try {
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('discovery_profile_') || k.startsWith('discovery_profile2_')) localStorage.removeItem(k);
  }
} catch { /* ignore */ }

const isISIN = (v) => /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(String(v ?? '').toUpperCase());

/* ── scrape-proxy (nur für den ROIC-Fallback nötig) ───────────────────────── */

async function proxyFetch({ backendUrl, secret }, url) {
  const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
    body: JSON.stringify({ url, method: 'GET', headers: {} }),
  });
  if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
  const wrapper = await res.json();
  if (!wrapper.ok) throw new Error(`Proxy: ${wrapper.error}`);
  if (wrapper.status !== 200) throw new Error(`ROIC HTTP ${wrapper.status}`);
  return wrapper.body;
}

/* ── Quelle 1: ROIC.ai ────────────────────────────────────────────────────── */

async function fromRoic(candidate, auth) {
  const key = localStorage.getItem('discovery_roic_key');
  if (!key) return null;
  const ident = isISIN(candidate.isin) ? String(candidate.isin).toUpperCase() : candidate.symbol;
  const url = `https://api.roic.ai/v2/company/profile/${encodeURIComponent(ident)}?apikey=${encodeURIComponent(key)}`;

  let text;
  try {
    const res = await fetch(url);                 // direkt, falls CORS offen
    if (!res.ok) throw new Error(`ROIC HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    // CORS/Netzwerk → über den scrape-proxy (Domain ist allowlisted).
    if (!auth?.backendUrl || !auth?.secret) throw err;
    text = await proxyFetch(auth, url);
  }

  const raw = JSON.parse(text);
  const d = Array.isArray(raw) ? raw[0] : raw;
  const description = typeof d?.description === 'string' && d.description.trim().length > 40
    ? d.description.trim() : null;
  if (!description) return null;
  return {
    description,
    website: d.website || null,
    source: 'roic',
    facts: {
      ceo: d.ceo || null,
      employees: d.employees ?? null,
      ipo_date: d.ipo_date || null,
      sector: d.sector || null,
      industry: d.industry || null,
      country: d.country || null,
    },
  };
}

/* ── Quelle 2: Wikipedia (de → en) ────────────────────────────────────────── */

const LEGAL_SUFFIX = /\b(incorporated|inc|corporation|corp|company|co|limited|ltd|plc|ag|se|sa|nv|oyj|ab|asa|spa|kgaa|holdings?|group|adr|the)\.?\b/gi;
const cleanName = (s) => String(s ?? '')
  .replace(LEGAL_SUFFIX, ' ')
  .replace(/[.,()]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/* Sanity-Filter: der Extract muss nach einem Unternehmensartikel klingen. */
const COMPANYISH = /unternehmen|konzern|hersteller|anbieter|gesellschaft|holding|bank|betreiber|entwickler|produzent|dienstleister|company|corporation|manufacturer|provider|operator|firm|maker|retailer|producer|developer|conglomerate|enterprise/i;

async function wikiJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fromWikipedia(candidate) {
  const name = cleanName(candidate.name) || String(candidate.symbol ?? '');
  if (!name) return null;
  for (const lang of ['de', 'en']) {
    let titles = [];
    try {
      const os = await wikiJson(
        `https://${lang}.wikipedia.org/w/api.php?action=opensearch&limit=3&format=json&origin=*&search=${encodeURIComponent(name)}`);
      titles = Array.isArray(os?.[1]) ? os[1] : [];
    } catch (err) {
      console.warn(`[profile] ${lang}.wikipedia opensearch:`, err.message);
      continue;
    }
    for (const title of titles.slice(0, 3)) {
      try {
        const s = await wikiJson(
          `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(String(title).replace(/ /g, '_'))}`);
        if (s?.type === 'disambiguation') continue;
        const text = String(s?.extract ?? '').trim();
        if (text.length > 80 && COMPANYISH.test(text)) {
          return {
            description: text,
            url: s.content_urls?.desktop?.page ?? null,
            source: `wikipedia-${lang}`,
          };
        }
      } catch { /* nächster Titel */ }
    }
  }
  return null;
}

/* ── Cache + Export ───────────────────────────────────────────────────────── */

function cacheGet(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key));
    if (!raw) return undefined;
    const ttl = raw.profile ? TTL_HIT : TTL_MISS;
    if (Date.now() - (raw.at ?? 0) < ttl) return raw.profile;
  } catch { /* ignore */ }
  return undefined;
}
function cacheSet(key, profile) {
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), profile })); } catch { /* quota */ }
}

/**
 * @param {object} candidate
 * @param {{backendUrl?:string, secret?:string}} [auth] nur für den ROIC-Proxy-Fallback
 * @returns {Promise<{description, source, ...}|null>} null = keine Quelle lieferte.
 */
export async function fetchCompanyProfile(candidate, auth) {
  if (!candidate?.symbol) return null;
  const key = `${CACHE_PREFIX}${normalizeExchange(candidate.exchange)}:${candidate.symbol}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  let profile = null;
  for (const src of [fromRoic, fromWikipedia]) {
    try {
      profile = await src(candidate, auth);
      if (profile) break;
    } catch (err) {
      console.warn(`[profile] ${src.name}:`, err.message);
    }
  }
  if (profile) profile.fetched_at = new Date().toISOString();
  cacheSet(key, profile);
  return profile;
}
