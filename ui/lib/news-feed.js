/**
 * News-Feed – Datenschicht für den News-Tab im Markets-Modal.
 *
 * Live-Quellen (Item-Form wie `company-profile.js`:
 * `{ title, url, date, source, text, symbols?, industry? }`):
 * - Marketaux `/v1/news/all` (Key `discovery_marketaux_key`; Free-Tier:
 *   3 Artikel/Request, 100 Requests/Tag → 30-min-Cache, max. 2 Requests)
 * - TradingView Data API `/api/news` via RapidAPI (`discovery_rapidapi_key`;
 *   Response-Form aus dem Repo tradingview-api-integration-skill,
 *   references/examples/06-news.md)
 * - ROIC.ai Company-News je ★-Wert (bestehendes `fetchCompanyNews`, eigener
 *   30-min-Cache + 429-Backoff)
 * - RSS-/Google-Alert-Feeds aus `news-sources.js` (Atom + RSS 2.0)
 *
 * Alle HTTP-Zugriffe: erst direkt (falls CORS offen), dann über den
 * scrape-proxy (Hosts müssen dort in ALLOWED_DOMAINS stehen).
 */

import { fetchCompanyNews } from './company-profile.js?v=20260711b';
import { loadNewsSources } from './news-sources.js?v=20260712c';

const CACHE_TTL = 30 * 60e3;
const MAX_ITEMS = 40;

/* ── Helper: Kandidaten/Sektoren ─────────────────────────────────────────── */

/** Die n häufigsten Sektoren eines Kandidaten-Buckets (für die Sektor-Chips). */
export function topSectors(candidates, n = 4) {
  const counts = new Map();
  for (const c of candidates ?? []) {
    const s = c?.sector;
    if (!s) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([sector, count]) => ({ sector, count }));
}

/** Kandidaten mit Stern (Portfolio-Marker) – Basis des Portfolio-Feeds. */
export function portfolioCandidates(candidates) {
  return (candidates ?? []).filter((c) => c?.in_portfolio);
}

/** Sub-Sektoren der Portfolio-Werte (dedupliziert, Reihenfolge stabil). */
export function portfolioSubSectors(candidates) {
  const seen = new Set();
  for (const c of portfolioCandidates(candidates)) {
    if (c?.sub_sector) seen.add(c.sub_sector);
  }
  return [...seen];
}

/* TV-Sektor (Watch-Bucket) → Marketaux-Industry (deren GICS-nahe Taxonomie).
 * Wird für den `industries`-Request-Filter UND den Sektor-Chip-Filter genutzt. */
const SECTOR_TO_INDUSTRY = {
  'Electronic Technology': 'Technology',
  'Technology Services': 'Technology',
  'Health Technology': 'Healthcare',
  'Health Services': 'Healthcare',
  'Energy Minerals': 'Energy',
  'Industrial Services': 'Energy',
  'Finance': 'Financial Services',
  'Consumer Durables': 'Consumer Cyclical',
  'Consumer Services': 'Consumer Cyclical',
  'Retail Trade': 'Consumer Cyclical',
  'Consumer Non-Durables': 'Consumer Defensive',
  'Producer Manufacturing': 'Industrials',
  'Transportation': 'Industrials',
  'Commercial Services': 'Industrials',
  'Distribution Services': 'Industrials',
  'Non-Energy Minerals': 'Basic Materials',
  'Process Industries': 'Basic Materials',
  'Utilities': 'Utilities',
  'Communications': 'Communication Services',
};
export const sectorToIndustry = (sector) => SECTOR_TO_INDUSTRY[sector] ?? null;

/* ── Keys / Verfügbarkeit ────────────────────────────────────────────────── */

export const hasMarketauxKey = () => !!localStorage.getItem('discovery_marketaux_key');
export const hasRapidApiKey  = () => !!localStorage.getItem('discovery_rapidapi_key');
export const hasMarketNewsKeys = () => hasMarketauxKey() || hasRapidApiKey();
export const hasRoicKey = () => !!localStorage.getItem('discovery_roic_key');

/* ── HTTP: direkt → scrape-proxy ─────────────────────────────────────────── */

function proxyAuth() {
  return {
    backendUrl: localStorage.getItem('discovery_backend_url'),
    secret: localStorage.getItem('discovery_secret'),
  };
}

/** GET als Text; wirft mit sprechender Meldung (Status/Proxy-Fehler). */
async function getText(url, headers = {}) {
  let res = null;
  try {
    res = await fetch(url, { headers });          // direkt, falls CORS offen
  } catch {
    const { backendUrl, secret } = proxyAuth();
    if (!backendUrl || !secret) throw new Error('CORS blockiert und kein Backend konfiguriert (Settings)');
    const pres = await fetch(`${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
      body: JSON.stringify({ url, method: 'GET', headers }),
    });
    if (!pres.ok) throw new Error(`Proxy HTTP ${pres.status}`);
    const wrapper = await pres.json();
    if (!wrapper.ok) throw new Error(`Proxy: ${wrapper.error}`);
    if (wrapper.status !== 200) throw new Error(`HTTP ${wrapper.status}`);
    return wrapper.body;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/* ── Cache (localStorage, 30 min) ────────────────────────────────────────── */

function cacheGet(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key));
    if (raw && Date.now() - (raw.at ?? 0) < CACHE_TTL) return raw.v;
  } catch { /* ignore */ }
  return null;
}
function cacheSet(key, v) {
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), v })); } catch { /* quota */ }
}

/* ── Item-Utilities ──────────────────────────────────────────────────────── */

const stripTags = (s) => String(s ?? '').replace(/<[^>]*>/g, '').trim();

function dedupSort(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const k = (it.url ?? it.title ?? '').toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  out.sort((a, b) => new Date(b.date ?? 0) - new Date(a.date ?? 0));
  return out.slice(0, MAX_ITEMS);
}

/* ── Quelle: Marketaux ───────────────────────────────────────────────────── */

async function marketauxNews({ industries } = {}) {
  const key = localStorage.getItem('discovery_marketaux_key');
  const params = new URLSearchParams({
    api_token: key,
    language: 'en',
    filter_entities: 'true',
    group_similar: 'true',
    limit: '3',                                   // Free-Tier-Maximum pro Request
  });
  if (industries?.length) params.set('industries', industries.join(','));
  const text = await getText(`https://api.marketaux.com/v1/news/all?${params}`);
  const raw = JSON.parse(text);
  if (raw.error) throw new Error(raw.error.message ?? raw.error.code ?? 'Marketaux-Fehler');
  return (Array.isArray(raw.data) ? raw.data : []).map((x) => ({
    title: x.title ?? null,
    url: x.url ?? null,
    date: x.published_at ?? null,
    source: x.source ?? 'Marketaux',
    text: stripTags(x.description ?? x.snippet ?? '').slice(0, 300) || null,
    symbols: (x.entities ?? []).map((e) => e.symbol).filter(Boolean).slice(0, 4),
    industry: (x.entities ?? []).map((e) => e.industry).find((i) => i && i !== 'N/A') ?? null,
  })).filter((it) => it.title);
}

/* ── Quelle: TradingView Data API (RapidAPI) ─────────────────────────────── */

async function tvNews() {
  const key = localStorage.getItem('discovery_rapidapi_key');
  const text = await getText(
    'https://tradingview-data1.p.rapidapi.com/api/news?lang=en&market=stock&market_country=US',
    { 'x-rapidapi-host': 'tradingview-data1.p.rapidapi.com', 'x-rapidapi-key': key },
  );
  const raw = JSON.parse(text);
  if (raw.success === false) throw new Error(raw.msg ?? raw.message ?? 'TradingView-API-Fehler');
  const items = raw?.data?.items ?? [];
  return items.map((x) => ({
    title: x.title ?? null,
    url: x.link ?? (x.storyPath ? `https://www.tradingview.com${x.storyPath}` : null),
    date: x.published ? new Date(x.published * 1000).toISOString() : null,
    source: x.provider?.name ?? 'TradingView',
    text: null,
    symbols: (x.relatedSymbols ?? []).map((s) => String(s.symbol ?? '').split(':').pop()).filter(Boolean).slice(0, 4),
    industry: null,
  })).filter((it) => it.title);
}

/* ── Märkte-Feed: Marketaux + TV kombiniert ──────────────────────────────── */

/**
 * @param {{ sectors?: Array<{sector:string}>, force?: boolean }} opts
 * @returns {Promise<{items:Array, errors:Array<{source:string,message:string}>, fetched_at:string}>}
 */
export async function fetchMarketNews({ sectors = [], force = false } = {}) {
  const cacheKey = 'discovery_newsfeed_markets';
  if (!force) {
    const hit = cacheGet(cacheKey);
    if (hit) return { ...hit, cached: true };
  }
  const industries = [...new Set(sectors.map((s) => sectorToIndustry(s.sector)).filter(Boolean))];
  const jobs = [];
  if (hasMarketauxKey()) {
    jobs.push(['Marketaux', marketauxNews()]);
    // Zweiter Request nur, wenn ein Sektor-Fokus existiert (Budget: 100/Tag).
    if (industries.length) jobs.push(['Marketaux (Sektoren)', marketauxNews({ industries })]);
  }
  if (hasRapidApiKey()) jobs.push(['TradingView', tvNews()]);

  const errors = [];
  const collected = [];
  const results = await Promise.allSettled(jobs.map(([, p]) => p));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') collected.push(...r.value);
    else errors.push({ source: jobs[i][0], message: r.reason?.message ?? String(r.reason) });
  });

  const out = { items: dedupSort(collected), errors, fetched_at: new Date().toISOString() };
  if (out.items.length) cacheSet(cacheKey, out);
  return out;
}

/* ── RSS / Google Alerts (Atom) ──────────────────────────────────────────── */

function parseFeed(xmlText, label) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Feed nicht lesbar (kein gültiges XML)');
  const pick = (el, sel) => el.querySelector(sel)?.textContent ?? null;
  // RSS 2.0
  const rss = [...doc.querySelectorAll('item')].map((el) => ({
    title: stripTags(pick(el, 'title')),
    url: pick(el, 'link'),
    date: pick(el, 'pubDate'),
    text: stripTags(pick(el, 'description')).slice(0, 300) || null,
  }));
  // Atom (Google Alerts)
  const atom = [...doc.querySelectorAll('entry')].map((el) => ({
    title: stripTags(pick(el, 'title')),
    url: el.querySelector('link')?.getAttribute('href') ?? null,
    date: pick(el, 'published') ?? pick(el, 'updated'),
    text: stripTags(pick(el, 'content') ?? pick(el, 'summary')).slice(0, 300) || null,
  }));
  return [...rss, ...atom]
    .filter((it) => it.title)
    .map((it) => {
      // Google-Alert-Links sind Redirects (…/url?…&url=ZIEL&…) → Ziel auspacken.
      let url = it.url;
      try {
        const u = new URL(url);
        if (u.hostname.endsWith('google.com') && u.searchParams.get('url')) url = u.searchParams.get('url');
      } catch { /* URL lassen wie sie ist */ }
      const d = it.date ? new Date(it.date) : null;
      return {
        title: it.title,
        url,
        date: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
        source: label,
        text: it.text,
        symbols: [],
        industry: null,
      };
    });
}

async function customSourceNews(src, force) {
  const cacheKey = `discovery_newsfeed_src_${src.id}`;
  if (!force) {
    const hit = cacheGet(cacheKey);
    if (hit) return hit;
  }
  const xml = await getText(src.url);
  const items = parseFeed(xml, src.label).slice(0, 10);
  cacheSet(cacheKey, items);
  return items;
}

/* ── Portfolio-Feed: ROIC je ★-Wert + eigene Feeds ───────────────────────── */

const MAX_PORTFOLIO_SYMBOLS = 6;                  // ROIC Free-Tier: 5 Req/min

/**
 * @param {{ candidates?: Array, force?: boolean }} opts  candidates = Watch-Bucket
 * @returns {Promise<{items:Array, errors:Array<{source:string,message:string}>, fetched_at:string}>}
 */
export async function fetchPortfolioNews({ candidates = [], force = false } = {}) {
  const port = portfolioCandidates(candidates).slice(0, MAX_PORTFOLIO_SYMBOLS);
  const errors = [];
  const collected = [];

  // ROIC sequentiell (Rate-Limit); fetchCompanyNews cached selbst 30 min.
  if (hasRoicKey()) {
    const auth = proxyAuth();
    for (const c of port) {
      try {
        const news = await fetchCompanyNews(c, auth, { force });
        for (const it of news?.items ?? []) {
          collected.push({ ...it, symbols: [c.symbol], industry: null, sub_sector: c.sub_sector ?? null });
        }
      } catch (err) {
        errors.push({ source: `ROIC ${c.symbol}`, message: err.message });
        if (err.transient) break;                 // 429-Backoff: Rest überspringen
      }
    }
  }

  // Eigene RSS-/Google-Alert-Quellen parallel.
  const sources = loadNewsSources();
  const results = await Promise.allSettled(sources.map((s) => customSourceNews(s, force)));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') collected.push(...r.value);
    else errors.push({ source: sources[i].label, message: r.reason?.message ?? String(r.reason) });
  });

  return { items: dedupSort(collected), errors, fetched_at: new Date().toISOString() };
}

/* ── Demo-Daten (Fallback ohne Keys) ─────────────────────────────────────── */

const demoDate = (hoursAgo) => new Date(Date.now() - hoursAgo * 36e5).toISOString();

/** Demo-Items für den Märkte-Sub-Tab (bis Marketaux/TV-Keys hinterlegt sind). */
export function demoMarketNews(sectors = []) {
  const [s1, s2] = [sectors[0]?.sector ?? 'Technology', sectors[1]?.sector ?? 'Health Technology'];
  return [
    { title: 'Demo: Fed signalisiert Zinspause – Futures drehen ins Plus', source: 'Marketaux', date: demoDate(2), url: null, sector: null, text: 'Beispiel-Schlagzeile für Markt-News. Erscheint, bis ein Marketaux- oder TradingView-Key hinterlegt ist.' },
    { title: `Demo: ${s1}-Werte führen die Erholung an`, source: 'TradingView', date: demoDate(5), url: null, sector: s1, text: null },
    { title: `Demo: Sektor-Rotation – Kapital fließt in ${s2}`, source: 'Marketaux', date: demoDate(9), url: null, sector: s2, text: null },
    { title: 'Demo: Ölpreis fällt nach Lagerbestandsdaten unter 80 $', source: 'TradingView', date: demoDate(14), url: null, sector: 'Energy Minerals', text: null },
  ];
}

/** Demo-Items für den Portfolio-Sub-Tab (bis ROIC-Key/Feeds da sind). */
export function demoPortfolioNews(symbols = []) {
  const [a, b] = [symbols[0] ?? 'AAPL', symbols[1] ?? 'ENPH'];
  return [
    { title: `Demo: ${a} übertrifft Erwartungen im Quartalsbericht`, source: 'ROIC.ai', date: demoDate(3), url: null, symbols: [a], text: 'Beispiel-Schlagzeile für Portfolio-News der mit ★ markierten Werte.' },
    { title: `Demo: Analysten heben Kursziel für ${b} an`, source: 'ROIC.ai', date: demoDate(8), url: null, symbols: [b], text: null },
    { title: 'Demo: Google-Alert-Treffer aus eigener Quelle', source: 'Google Alert', date: demoDate(12), url: null, symbols: [], text: 'RSS-/Google-Alert-Quellen lassen sich im Sub-Tab „Quellen" pflegen.' },
  ];
}
