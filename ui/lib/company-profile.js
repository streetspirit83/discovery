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
  if (wrapper.status === 429) throw roicRateLimited();
  if (wrapper.status !== 200) throw new Error(`ROIC HTTP ${wrapper.status}`);
  return wrapper.body;
}

/* 429 = transient (Rate-Limit, 5 req/min im Free-Plan): 2 min Backoff setzen
 * und das Ergebnis NICHT als Miss cachen, damit der nächste Versuch nach dem
 * Fenster wieder bei ROIC landet. */
const ROIC_BACKOFF_KEY = 'discovery_roic_backoff_until';
function roicRateLimited() {
  try { localStorage.setItem(ROIC_BACKOFF_KEY, String(Date.now() + 120e3)); } catch { /* ignore */ }
  const e = new Error('ROIC HTTP 429 (Rate-Limit) — eigenen Account-Key prüfen, nicht den Doku-Beispiel-Key');
  e.transient = true;
  return e;
}

/* ── Quelle 1: ROIC.ai ────────────────────────────────────────────────────── */

/* Gemeinsamer ROIC-GET: Key + Backoff prüfen, Direkt-Fetch (falls CORS offen),
 * bei echten Netz-/CORS-Fehlern über den scrape-proxy. HTTP-Fehler (401/429/…)
 * werden NICHT über den Proxy wiederholt — das würde dieselbe Antwort nur
 * doppelt vom Rate-Limit abbuchen. Wirft bei fehlendem Key. */
function roicIdent(candidate) {
  return isISIN(candidate.isin) ? String(candidate.isin).toUpperCase() : candidate.symbol;
}

async function roicGet(path, auth) {
  const key = localStorage.getItem('discovery_roic_key');
  if (!key) { const e = new Error('Kein ROIC.ai API Key (Settings)'); e.noKey = true; throw e; }
  if (Date.now() < +(localStorage.getItem(ROIC_BACKOFF_KEY) ?? 0)) {
    const e = new Error('ROIC im 429-Backoff — übersprungen');
    e.transient = true;
    throw e;
  }
  const url = `https://api.roic.ai${path}${path.includes('?') ? '&' : '?'}apikey=${encodeURIComponent(key)}`;
  let text;
  let res = null;
  try {
    res = await fetch(url);                       // direkt, falls CORS offen
  } catch (err) {
    if (!auth?.backendUrl || !auth?.secret) throw err;
    text = await proxyFetch(auth, url);
  }
  if (res) {
    if (res.status === 429) throw roicRateLimited();
    if (!res.ok) throw new Error(`ROIC HTTP ${res.status}`);
    text = await res.text();
  }
  return text;
}

async function fromRoic(candidate, auth) {
  if (!localStorage.getItem('discovery_roic_key')) return null;   // ohne Key still zu Wikipedia
  const text = await roicGet(`/v2/company/profile/${encodeURIComponent(roicIdent(candidate))}`, auth);

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

/* ── Earnings-Call-Transcript (ROIC.ai "Get Latest Transcript") ───────────────
 * Pfad defensiv: mehrere plausible Endpoint-Varianten werden bei 404 der Reihe
 * nach probiert (Doku nennt nur "Get Latest Transcript"); Felder defensiv
 * gemappt. 7-Tage-Cache (Transcripts ändern sich quartalsweise). */

const TRANSCRIPT_CACHE_PREFIX = 'discovery_transcript1_';
const TRANSCRIPT_TTL = 7 * 864e5;

function mapTranscript(raw) {
  const d = Array.isArray(raw) ? raw[0] : (raw?.data?.[0] ?? raw?.transcripts?.[0] ?? raw);
  if (!d || typeof d !== 'object') return null;
  const text = d.content ?? d.transcript ?? d.text ?? d.body ?? null;
  if (typeof text !== 'string' || text.trim().length < 200) return null;
  const q = d.quarter ?? d.period ?? null;
  const y = d.year ?? d.fiscal_year ?? null;
  return {
    title: d.title ?? (q && y ? `Q${String(q).replace(/^Q/i, '')} ${y} Earnings Call` : 'Earnings Call'),
    date: d.date ?? d.published_at ?? d.publishedDate ?? null,
    text: text.trim(),
  };
}

export async function fetchLatestTranscript(candidate, auth) {
  if (!candidate?.symbol) throw new Error('Kein Symbol');
  const key = `${TRANSCRIPT_CACHE_PREFIX}${normalizeExchange(candidate.exchange)}:${candidate.symbol}`;
  try {
    const raw = JSON.parse(localStorage.getItem(key));
    if (raw && Date.now() - (raw.at ?? 0) < TRANSCRIPT_TTL && raw.tr) return raw.tr;
  } catch { /* ignore */ }

  const ident = encodeURIComponent(roicIdent(candidate));
  const paths = [
    `/v2/company/transcripts/latest/${ident}`,
    `/v2/company/transcripts/${ident}?limit=1`,
    `/v2/company/transcript/${ident}`,
  ];
  let lastErr = null;
  for (const path of paths) {
    try {
      const text = await roicGet(path, auth);
      const tr = mapTranscript(JSON.parse(text));
      if (tr) {
        try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), tr })); } catch { /* quota */ }
        return tr;
      }
      lastErr = new Error('Antwort ohne Transcript-Text');
    } catch (err) {
      lastErr = err;
      if (!/HTTP 404/.test(err.message)) throw err;   // nur bei 404 nächste Pfad-Variante
    }
  }
  throw lastErr ?? new Error('Kein Transcript');
}

/* Analyse-Prompt für den LLM-Copy-Button (Guidance vom Nutzer). */
export function transcriptLlmText(candidate, tr) {
  return `You are analysing an earnings call transcript for ${candidate.name ?? candidate.symbol} (${candidate.symbol}). Focus:

1. Skip the safe-harbor disclaimer. Boilerplate.
2. Skim the CFO section for next-quarter guidance and any change in capex, buybacks, or margin commentary.
3. Read the Q&A in full. This is where analysts push on what management didn't volunteer. The question itself often tells you what the smart money is worried about.
4. Watch the dodges. When an exec answers a different question than the one asked, mark it. Repeat dodges across two or three quarters on the same topic = a thread to pull.

Transcript — ${tr.title}${tr.date ? ` (${tr.date})` : ''}:
---
${tr.text}`;
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
  let transient = false;
  for (const src of [fromRoic, fromWikipedia]) {
    try {
      profile = await src(candidate, auth);
      if (profile) break;
    } catch (err) {
      if (err?.transient) transient = true;
      console.warn(`[profile] ${src.name}:`, err.message);
    }
  }
  if (profile) profile.fetched_at = new Date().toISOString();
  // Transiente Fehler (429/Backoff) ohne Ergebnis nicht cachen — der nächste
  // Öffnen-Versuch soll ROIC nach dem Rate-Limit-Fenster erneut probieren.
  if (profile || !transient) cacheSet(key, profile);
  return profile;
}

/* ── Company News (ROIC.ai /v2/company/news) ──────────────────────────────────
 * On-demand vom News-Tab; 30 min localStorage-Cache (force=true umgeht ihn).
 * Feldnamen defensiv gemappt (title/headline, url/link, date/published_at, …),
 * bis das echte Antwortformat verifiziert ist. */

const NEWS_CACHE_PREFIX = 'discovery_news2_';
const NEWS_TTL = 30 * 60e3;

/* Datum → ISO normalisieren: ISO-Strings, 'YYYY-MM-DD HH:MM:SS' (Space statt
 * T), Epoch in Sekunden oder Millisekunden (Zahl oder String). */
function parseNewsDate(d) {
  if (d == null) return null;
  if (typeof d === 'number') {
    const t = new Date(d > 1e12 ? d : d * 1000);
    return Number.isNaN(+t) ? null : t.toISOString();
  }
  const s = String(d).trim();
  if (/^\d{13}$/.test(s)) return new Date(+s).toISOString();
  if (/^\d{10}$/.test(s)) return new Date(+s * 1000).toISOString();
  const t = new Date(/^\d{4}-\d{2}-\d{2} /.test(s) ? s.replace(' ', 'T') : s);
  return Number.isNaN(+t) ? null : t.toISOString();
}

function mapNewsItem(x) {
  if (!x || typeof x !== 'object') return null;
  const title = x.title ?? x.headline ?? null;
  if (!title) return null;
  const text = x.text ?? x.summary ?? x.description ?? x.content ?? null;
  return {
    title: String(title),
    url: x.url ?? x.link ?? x.article_url ?? null,
    date: parseNewsDate(x.date ?? x.publishedDate ?? x.published_date ?? x.published_at
      ?? x.published ?? x.datetime ?? x.pub_date ?? x.time ?? x.created_at ?? null),
    source: x.source ?? x.site ?? x.publisher ?? x.provider ?? null,
    text: text ? String(text).slice(0, 400) : null,
  };
}

/**
 * @returns {Promise<{items:Array, fetched_at:string}>} wirft bei Fehlern
 * (kein Key, 429-Backoff, HTTP-Fehler) — der Aufrufer zeigt die Meldung an.
 */
export async function fetchCompanyNews(candidate, auth, { force = false } = {}) {
  if (!candidate?.symbol) throw new Error('Kein Symbol');
  const key = `${NEWS_CACHE_PREFIX}${normalizeExchange(candidate.exchange)}:${candidate.symbol}`;
  if (!force) {
    try {
      const raw = JSON.parse(localStorage.getItem(key));
      if (raw && Date.now() - (raw.at ?? 0) < NEWS_TTL) return raw.news;
    } catch { /* ignore */ }
  }
  const text = await roicGet(`/v2/company/news/${encodeURIComponent(roicIdent(candidate))}`, auth);
  const raw = JSON.parse(text);
  const arr = Array.isArray(raw) ? raw
    : Array.isArray(raw?.data) ? raw.data
    : Array.isArray(raw?.news) ? raw.news
    : Array.isArray(raw?.items) ? raw.items : [];
  const news = { items: arr.map(mapNewsItem).filter(Boolean).slice(0, 20), fetched_at: new Date().toISOString() };
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), news })); } catch { /* quota */ }
  return news;
}
