/**
 * tv-news.js — Headlines aus dem TradingView-News-Feed für den News-Tab.
 *
 * Endpoint: `news-headlines.tradingview.com/v2/headlines?client=web&lang=…&symbol=…`
 * Inoffiziell, ohne Key, ohne CORS-Header — läuft daher über die scrape-proxy.
 *
 * **Die Sprache entscheidet über die Quellen, nicht nur über den Text** (gemessen):
 * `lang=de` bringt dpa-AFX, darunter die Analysten-Flashes zu deutschen Titeln,
 * `lang=en` Dow Jones und `tradingview_analyst_updates`. NYSE:BMI ist unter `de`
 * leer und hat unter `en` volle 200 Einträge; XETR:EOAN hat unter `en` keine
 * aktuellen Analystenmeldungen. Deshalb XETR → `de`, alles andere → `en`.
 *
 * Getrennt von ROIC (`company-profile.js`): eigener Cache, eigenes Feld, gemischt
 * wird erst bei der Anzeige (`mergeNews`). So überschreibt keine Quelle die andere
 * und ein ROIC-Rate-Limit lässt die TV-Headlines stehen.
 *
 * `parseAnalystHeadline` ist rein und ohne Browser-Abhängigkeit, damit dieselbe
 * Logik später die Analysten-Ereignisse im Monitor-Lauf speisen kann.
 */

import { normalizeExchange } from './exchange-map.js';
import { TV_PREFIX_MAP } from './tv-enrichment.js?v=20260831a';

const ENDPOINT = 'https://news-headlines.tradingview.com/v2/headlines';
const CACHE_PREFIX = 'discovery_tvnews1_';
const TTL_MS = 30 * 60e3;          // wie der ROIC-News-Cache
const MAX_ITEMS = 40;              // der Feed liefert bis zu 200, teils Jahre zurück
const MAX_ANALYST = 15;            // Rating-/Kursziel-Meldungen zählen extra
const SKIP_PROVIDERS = new Set(['binance_news', 'cryptoprowl']);   // Krypto-Rauschen an Aktien

/* ── Analystenmeldungen ──────────────────────────────────────────────────── */

/** `rank`: je Haus und Tag bleibt nur die gewichtigste Meldung (siehe dedupeAnalyst). */
export const ANALYST_ACTIONS = {
  upgrade:     { label: 'Hochstufung',     tone: 'pos', rank: 6 },
  downgrade:   { label: 'Abstufung',       tone: 'neg', rank: 6 },
  list_add:    { label: 'Empfehlungsliste', tone: 'pos', rank: 5 },
  list_remove: { label: 'Von Liste',       tone: 'neg', rank: 5 },
  init:        { label: 'Erstbewertung',   tone: null,  rank: 4 },
  target_up:   { label: 'Ziel ↑',          tone: 'pos', rank: 3 },
  target_down: { label: 'Ziel ↓',          tone: 'neg', rank: 3 },
  reiterate:   { label: 'Bestätigt',       tone: null,  rank: 1 },
};

const DPA_RATING = /(?:auf|mit|-)\s+['‘’"]([^'‘’"]+)['‘’"]/;

/* dpa-AFX: „ANALYSE-FLASH: UBS hebt Eon auf 'Buy' - Ziel hoch auf 20 Euro".
 * Rating-Änderung und Kurszieländerung nutzen dieselben Verben; der Unterschied
 * steckt darin, ob vor „auf '…'" schon Ziel/Wert steht. */
function parseDpa(title) {
  const body = /^ANALYSE-FLASH:\s*(.+)$/.exec(title)?.[1];
  if (!body) return null;
  const m = /^(.+?)\s+(hebt|senkt|belässt|lässt|bestätigt|startet|beginnt|nimmt|setzt|streicht|stuft)\s+(.+)$/.exec(body);
  if (!m) return null;
  const [, firm, verb, rest] = m;
  const onList = /liste\b/i.test(rest);
  let action = null;
  if (verb === 'hebt' || verb === 'senkt') {
    const up = verb === 'hebt';
    const beforeRating = /^(.*?)\bauf\s+['‘"]/.exec(rest)?.[1];
    if (beforeRating != null && !/ziel|wert/i.test(beforeRating)) action = up ? 'upgrade' : 'downgrade';
    else if (/ziel|wert/i.test(rest)) action = up ? 'target_up' : 'target_down';
  } else if (verb === 'stuft') {
    action = /\bab\b/.test(rest) ? 'downgrade' : /\b(hoch|herauf)\b/.test(rest) ? 'upgrade' : null;
  } else if (verb === 'setzt') {
    action = onList ? 'list_add' : null;
  } else if (verb === 'streicht') {
    action = onList ? 'list_remove' : null;
  } else if (verb === 'nimmt') {
    action = onList && /\bvon\b/.test(rest) ? 'list_remove' : /\bmit\b.*\bauf\b/.test(rest) ? 'init' : null;
  } else if (verb === 'startet' || verb === 'beginnt') {
    action = 'init';
  } else {
    action = 'reiterate';
  }
  if (!action) return null;
  const target = /(?:ziel|wert)\b[^\d]{0,40}?(\d[\d.]*(?:,\d+)?\s*(?:US-)?(?:Euro|Dollar|Pfund|Franken|Kronen|Cent))/i.exec(rest)?.[1] ?? null;
  return { action, firm, rating: DPA_RATING.exec(rest)?.[1] ?? null, target };
}

/* TradingView: „UBS maintains Intel at Neutral, lowers price target to $80 from $100". */
function parseTvUpdate(title) {
  const m = /^(.+?)\s+(upgrades|downgrades|initiates|assumes|resumes|reinstates|maintains|reiterates)\s+(.+)$/.exec(title);
  if (!m) return null;
  const [, firm, verb, rest] = m;
  let action;
  if (verb === 'upgrades') action = 'upgrade';
  else if (verb === 'downgrades') action = 'downgrade';
  else if (verb === 'maintains' || verb === 'reiterates') {
    action = /\b(raises|boosts) price target/.test(rest) ? 'target_up'
      : /\b(lowers|cuts) price target/.test(rest) ? 'target_down' : 'reiterate';
  } else action = 'init';
  const rating = /\b(?:to|at)\s+([A-Z][\w-]*(?:[ -][A-Z][\w-]*)*)/.exec(rest)?.[1] ?? null;
  const target = /price target to (\$?[\d.,]*\d)/.exec(rest)?.[1] ?? /(\$[\d.,]*\d) price target/.exec(rest)?.[1] ?? null;
  return { action, firm, rating, target };
}

/* Dow Jones: „Intel Cut to Hold From Buy by Freedom Broker",
 * „Intel Price Target Cut to $80.00/Share From $85.00 by JP Morgan".
 * Kursziel zuerst prüfen: „Price Target Cut to" passt sonst auch aufs Rating-Muster. */
function parseDowJones(title) {
  let m = /\bPrice Target (Raised|Boosted|Cut|Lowered|Maintained|Announced)\b(?: to| With a| at)? (\$?[\d.,]*\d)(?:\/Share)?.*? by (.+)$/.exec(title);
  if (m) {
    const action = m[1] === 'Maintained' ? 'reiterate' : m[1] === 'Announced' ? 'init'
      : /Raised|Boosted/.test(m[1]) ? 'target_up' : 'target_down';
    return { action, firm: m[3], rating: null, target: m[2] };
  }
  m = /\b(Raised|Upgraded|Cut|Lowered|Downgraded) to (.+?) From .+? by (.+)$/.exec(title);
  if (m) return { action: /Raised|Upgraded/.test(m[1]) ? 'upgrade' : 'downgrade', firm: m[3], rating: m[2], target: null };
  m = /\b(?:Initiated|Resumed|Reinstated|Assumed) at (.+?) by (.+)$/.exec(title);
  if (m) return { action: 'init', firm: m[2], rating: m[1], target: null };
  m = /\bIs (?:Maintained|Reiterated) at (.+?) by (.+)$/.exec(title);
  if (m) return { action: 'reiterate', firm: m[2], rating: m[1], target: null };
  return null;
}

/**
 * Erkennt Analystenmeldungen an Anbieter und Titelmuster.
 * @returns {{action:string, firm:string, rating:?string, target:?string}|null}
 */
export function parseAnalystHeadline({ title, provider } = {}) {
  const t = String(title ?? '').trim();
  if (provider === 'dpa_afx') return parseDpa(t);
  if (provider === 'tradingview_analyst_updates') return parseTvUpdate(t);
  if (provider === 'dow-jones') return parseDowJones(t);
  return null;
}

/* ── Abbildung ───────────────────────────────────────────────────────────── */

/** Unter `lang=de` wirken Reuters-Titel maschinell übersetzt, daher keine exakte Phrase. */
export function googleNewsUrl(title) {
  return `https://www.google.com/search?tbm=nws&q=${encodeURIComponent(String(title ?? '').trim())}`;
}

export function mapTvNewsItem(x) {
  if (!x?.title || SKIP_PROVIDERS.has(x.provider)) return null;
  const story = x.storyPath ? `https://www.tradingview.com${x.storyPath}` : null;
  return {
    origin: 'tv',
    title: String(x.title),
    date: Number.isFinite(x.published) ? new Date(x.published * 1000).toISOString() : null,
    source: x.source ?? x.provider ?? null,
    search_url: googleNewsUrl(x.title),
    source_url: x.link || story,
    analyst: parseAnalystHeadline(x),
  };
}

const normKey = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const dayOf = (it) => String(it.date ?? '').slice(0, 10);
const newestFirst = (a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''));

/* Dasselbe Haus erscheint je Tag oft mehrfach: Dow Jones meldet Einstufung und
 * Kursziel einzeln, TradingView beides in einer Zeile. Eine Zeile je Haus und Tag
 * genügt; es bleibt die gewichtigste Aktion. */
function dedupeAnalyst(items) {
  const best = new Map();
  for (const it of items) {
    if (!it.analyst) continue;
    const key = `${dayOf(it)}|${normKey(it.analyst.firm)}`;
    const cur = best.get(key);
    const rank = ANALYST_ACTIONS[it.analyst.action].rank;
    if (!cur || rank > ANALYST_ACTIONS[cur.analyst.action].rank) best.set(key, it);
  }
  const keep = new Set(best.values());
  return items.filter((it) => !it.analyst || keep.has(it));
}

/* Bei viel Nachrichtenfluss rutscht die letzte Abstufung sonst aus dem Fenster.
 * Analystenaktionen haben deshalb ein eigenes Kontingent; Bestätigungen nicht. */
function capNews(items, limit) {
  const counts = (it) => it.analyst && it.analyst.action !== 'reiterate';
  const plain = items.filter((it) => !counts(it)).slice(0, limit);
  const analyst = items.filter(counts).slice(0, MAX_ANALYST);
  return [...plain, ...analyst].sort(newestFirst);
}

/** Rohantwort des Feeds → Einträge für die Anzeige, neueste zuerst. */
export function buildTvNews(raw) {
  const items = (Array.isArray(raw?.items) ? raw.items : []).map(mapTvNewsItem).filter(Boolean);
  return capNews(dedupeAnalyst(items).sort(newestFirst), MAX_ITEMS);
}

/**
 * Mischt ROIC und TV für die Anzeige. Gleicher Titel am selben Tag gilt als
 * Dublette, ROIC gewinnt (hat Text und Originallink). Sprachgrenzen erkennt das nicht.
 */
export function mergeNews(roicItems, tvItems, limit = 30) {
  const seen = new Set();
  const out = [];
  for (const it of [...(roicItems ?? []).map((x) => ({ ...x, origin: 'roic' })), ...(tvItems ?? [])]) {
    const key = `${dayOf(it)}|${normKey(it.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return capNews(out.sort(newestFirst), limit);
}

/* ── Abruf ───────────────────────────────────────────────────────────────── */

export function tvNewsLang(exchange) {
  return normalizeExchange(exchange) === 'XETR' ? 'de' : 'en';
}

export function tvNewsSymbol({ symbol, exchange } = {}) {
  const ex = normalizeExchange(exchange);
  return symbol ? `${TV_PREFIX_MAP[ex] ?? ex}:${symbol}` : null;
}

/**
 * @returns {Promise<{items:Array, fetched_at:string}>} wirft bei Fehlern;
 * der Aufrufer zeigt die Meldung an. Fehler werden nicht gecacht.
 */
export async function fetchTvNews(candidate, { backendUrl, secret } = {}, { force = false } = {}) {
  const ticker = tvNewsSymbol(candidate);
  if (!ticker) throw new Error('Kein Symbol');
  if (!backendUrl) throw new Error('Kein Backend konfiguriert');
  const key = `${CACHE_PREFIX}${ticker}`;
  if (!force) {
    try {
      const raw = JSON.parse(localStorage.getItem(key));
      if (raw && Date.now() - (raw.at ?? 0) < TTL_MS) return raw.news;
    } catch { /* ignore */ }
  }
  const url = `${ENDPOINT}?client=web&lang=${tvNewsLang(candidate.exchange)}&symbol=${encodeURIComponent(ticker)}`;
  const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
    body: JSON.stringify({ url, method: 'GET', headers: {} }),
  });
  if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
  const wrapper = await res.json();
  if (!wrapper.ok) throw new Error(`Proxy: ${wrapper.error}`);
  if (wrapper.status !== 200) throw new Error(`TV-News HTTP ${wrapper.status}`);
  const news = { items: buildTvNews(JSON.parse(wrapper.body)), fetched_at: new Date().toISOString() };
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), news })); } catch { /* Quota */ }
  return news;
}
