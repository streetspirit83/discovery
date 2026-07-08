/**
 * company-profile.js — Firmenprofil (Business Description) für das Detail-Modal.
 *
 * v2: Wikipedia als Quelle (de → en Fallback) — die REST-API ist CORS-offen
 * (Access-Control-Allow-Origin: *), läuft also DIREKT aus dem Browser, ganz
 * ohne scrape-proxy, Key oder Limit. Titel-Suche via opensearch (origin=*),
 * dann /api/rest_v1/page/summary/{title} → `extract` (erster Artikelabsatz).
 *
 * v1-Historie: TradingView kennt keine business_description-Spalte (HTTP 400)
 * und Yahoo quoteSummary verlangt Cookie+Crumb (401) — beide entfernt.
 *
 * Treffer werden 30 Tage, Fehlversuche 3 Tage in localStorage gecacht.
 */

import { normalizeExchange } from './exchange-map.js';

const CACHE_PREFIX = 'discovery_profile2_';
const TTL_HIT = 30 * 864e5;
const TTL_MISS = 3 * 864e5;

// v1-Caches (inkl. 30 Tage gecachter Fehlversuche) einmalig wegräumen.
try {
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('discovery_profile_')) localStorage.removeItem(k);
  }
} catch { /* ignore */ }

/* Firmenname → Suchbegriff: Rechtsform-Suffixe stören die Artikelsuche. */
const LEGAL_SUFFIX = /\b(incorporated|inc|corporation|corp|company|co|limited|ltd|plc|ag|se|sa|nv|oyj|ab|asa|spa|kgaa|holdings?|group|adr|the)\.?\b/gi;
const cleanName = (s) => String(s ?? '')
  .replace(LEGAL_SUFFIX, ' ')
  .replace(/[.,()]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/* Sanity-Filter: der Extract muss nach einem Unternehmensartikel klingen —
 * sonst war der Treffer z. B. ein gleichnamiger Begriff/Ort. */
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
 * @returns {Promise<{description, url, source, fetched_at}|null>} null = keine Quelle lieferte.
 */
export async function fetchCompanyProfile(candidate) {
  if (!candidate?.symbol) return null;
  const key = `${CACHE_PREFIX}${normalizeExchange(candidate.exchange)}:${candidate.symbol}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  let profile = null;
  try { profile = await fromWikipedia(candidate); }
  catch (err) { console.warn('[profile] Wikipedia fehlgeschlagen:', err.message); }

  if (profile) profile.fetched_at = new Date().toISOString();
  cacheSet(key, profile);
  return profile;
}
