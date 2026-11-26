/**
 * upgrade-scout.js — Analysten-Scout: neue Titel aus Hochstufungen finden (reine Logik).
 *
 * Quelle ist der **marktweite** TradingView-News-Feed (ohne `symbol`, gefiltert nach Anbieter):
 *   - `lang=en&provider=tradingview_analyst_updates` (US, „HSBC upgrades Cisco to Buy from Hold …“)
 *   - `lang=de&provider=dpa_afx` (Deutschland, „ANALYSE-FLASH: Berenberg hebt Siltronic auf 'Buy' …“)
 * Gemessen (18.11.2026): Der Feed liefert immer die neuesten 200 Einträge und kennt keine Seiten
 * (`to`, `before`, `cursor`, `offset`, `page` werden ignoriert). Bei TradingView decken 200 Einträge
 * nur rund 7 Stunden ab, bei dpa-AFX rund 20. Der Sammler muss deshalb mehrmals am Tag laufen und
 * hält die Ereignisse selbst fest (Blob `scout`). `gap` im Bericht zeigt, ob zwischen zwei Läufen
 * etwas durchgerutscht sein kann.
 *
 * Yahoo `upgradeDowngradeHistory` (nur US, Cookie + Crumb) dient als Gegencheck für die Häufung über
 * 14 und 90 Tage. Es hinkt dem Feed ein bis zwei Tage hinterher und kennt keine deutschen Titel.
 *
 * Wichtig für die Einordnung (docs/ANALYST_BACKTEST.md): Eine Hochstufung bewegt den Kurs am Tag
 * selbst, eine verlässliche Nachdrift gibt es nicht. Der Scout ist deshalb ein **Fundort**, kein
 * Kaufsignal: Er bringt Titel in die Inbox, ob sie bleiben, entscheidet die Auto-Rotation mit ihrem
 * eigenen Score. Der Bericht zeigt dafür den Rotations-Score neben der Schwelle.
 */

import { parseAnalystHeadline, ANALYST_ACTIONS, googleNewsUrl } from './tv-news.js?v=20261126a';
import { normalizeExchange } from './exchange-map.js';

export { googleNewsUrl };

export const SCOUT_RULES = {
  version: 1,
  keepDays: 30,          // so lange hält der Blob ein Ereignis (Bestätigungen werden gar nicht erst gespeichert)
  knownDays: 4,          // „Bestand neu bewertet“: Meldungen der letzten Tage (deckt ein Wochenende ab)
  windowDays: 14,        // Häufung und Gegenwind
  freshDays: 3,          // ein Auslöser muss so jung sein, damit der Titel heute im Bericht steht
  minCapUsd: 1e9,        // kleinere Titel reagieren stark, sind aber selten etwas für die Watchlist
  clusterFirms: 2,       // ab so vielen Häusern mit positiver Aktion im Fenster gilt es als Häufung
  targetBig: 10,         // Kursziel-Erhöhung ab so viel Prozent zählt voll
  weights: {
    upgrade: 3, upgrade_from_bear: 1, list_add: 3, init_bull: 2, target_up: 0.5, target_up_big: 1,
    downgrade: -3, list_remove: -3, init_bear: -2, target_down: -1, cluster: 2, yahoo_cluster: 1, assume: 0.5,
  },
  // Abstand zur Rotations-Schwelle (Score des Momentum-Rangs `enter`): ab hier „knapp“.
  nearGap: 8,
};

/* Feeds, die der Sammler abfragt. `lang` wählt bei TradingView die Quellen (siehe tv-news.js). */
export const SCOUT_FEEDS = [
  { key: 'tv', lang: 'en', provider: 'tradingview_analyst_updates' },
  { key: 'dpa', lang: 'de', provider: 'dpa_afx' },
];
export const feedUrl = (f) => `https://news-headlines.tradingview.com/v2/headlines?client=web&streaming=false&lang=${f.lang}&provider=${f.provider}`;

const BULL = /\b(strong[ -]buy|buy|outperform|overweight|accumulate|add|positive|kaufen|übergewichten|top pick)\b/i;
const BEAR = /\b(strong[ -]sell|sell|underperform|underweight|reduce|negative|verkaufen|untergewichten)\b/i;
/** 1 = positiv, −1 = negativ, 0 = neutral/unbekannt. „Market Perform“ und „Sector Perform“ sind neutral. */
export function ratingTone(r) {
  const s = String(r ?? '');
  if (!s) return 0;
  if (/\b(market|sector|in[- ]line|peer)[ -]perform\b/i.test(s)) return 0;
  if (BEAR.test(s)) return -1;
  if (BULL.test(s)) return 1;
  return 0;
}

// Indizes und Futures stehen bei dpa-AFX oft neben dem Firmenticker.
const NOT_STOCK = /^(XETR:(DAX|MDAX|SDAX|TECDAX|DAX40)|TVC:|NYMEX:|COMEX:|CME|CBOT|FX:|OANDA:|BINANCE|SP:|DJ:|NASDAQ:(NDX|IXIC)$|INDEX:)/;
// TradingView-Präfix → Börsencode der App (nur Börsen, die die Anreicherung kennt).
const TV_EX = { NASDAQ: 'NASDAQ', NYSE: 'NYSE', AMEX: 'AMEX', XETR: 'XETR', FWB: 'XETR', LSE: 'LSE', EURONEXT: 'EURONEXT',
  MIL: 'MIL', BME: 'BME', VIE: 'VIE', OMXSTO: 'OMXSTO', SIX: 'SIX', OMXCOP: 'OMXCOP', OSL: 'OSL', OMXHEX: 'OMXHEX' };

function subjectOf(item) {
  for (const s of item.relatedSymbols ?? []) {
    const tv = String(s?.symbol ?? '');
    if (!tv || NOT_STOCK.test(tv)) continue;
    const [pre, sym] = tv.split(':');
    const ex = TV_EX[pre];
    if (ex && /^[A-Z0-9.\-_]{1,12}$/.test(sym ?? '')) return { tv, symbol: sym, exchange: normalizeExchange(ex) || ex };
    return null;   // erstes Symbol ist kein bekannter Börsenplatz → nicht raten
  }
  return null;
}

const money = (s) => {
  const m = /([\d.,]*\d)/.exec(String(s ?? ''));
  if (!m) return null;
  let t = m[1];
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');   // 1.234,50 (de)
  else t = t.replace(/,/g, '');
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : null;
};

/** Kursziel-Text („$133“, „90 Euro“) → Zahl und Währung, sonst null. */
export function targetValue(t) {
  const s = String(t ?? '');
  const v = money(s);
  if (v == null) return null;
  const cur = /\$|Dollar/.test(s) ? 'USD' : /€|Euro/.test(s) ? 'EUR' : /£|Pfund/.test(s) ? 'GBP' : /Franken/.test(s) ? 'CHF' : null;
  return { value: v, currency: cur };
}

/** Abstand Kursziel zu Kurs in %, nur wenn die Währungen zusammenpassen (oder das Ziel keine nennt). */
export function targetGap(target, close, currency) {
  const t = targetValue(target);
  if (!t || !(close > 0)) return null;
  if (t.currency && currency && t.currency !== String(currency).toUpperCase()) return null;
  return Math.round((t.value / close - 1) * 1000) / 10;
}

/** Zusatzangaben aus dem Titel, die `parseAnalystHeadline` nicht liefert: altes Rating, altes Kursziel. */
function extras(title) {
  const t = String(title ?? '');
  const from = /\bto\s+[A-Z][\w-]*(?:[ -][A-Z][\w-]*)*\s+from\s+([A-Z][\w-]*(?:[ -][A-Z][\w-]*)*)/.exec(t)?.[1] ?? null;
  const pt = /price target to (\$?[\d.,]*\d) from (\$?[\d.,]*\d)/.exec(t);
  const de = /Ziel (?:hoch|runter) (?:von [\d.,]+ )?auf ([\d.,]+)/.exec(t);
  return { from, target_new: money(pt?.[1] ?? de?.[1]), target_old: money(pt?.[2]) };
}

/** Feed-Einträge → Analysten-Ereignisse mit Titel und Börse. Ohne erkennbares Subjekt fällt der Eintrag weg. */
export function eventsFromFeed(items, feedKey) {
  const out = [];
  for (const x of Array.isArray(items) ? items : []) {
    const a = parseAnalystHeadline(x);
    if (!a || a.action === 'reiterate' || !Number.isFinite(x.published)) continue;
    const subj = subjectOf(x);
    if (!subj) continue;
    const ex = extras(x.title);
    const tone = ratingTone(a.rating);
    let kind = a.action;
    // „assumes coverage“ ist ein Analystenwechsel im selben Haus, keine neue Meinung: zählt kaum.
    if (kind === 'init' && /\b(assumes|transfers)\b/.test(x.title)) kind = 'assume';
    else if (kind === 'init') kind = tone > 0 ? 'init_bull' : tone < 0 ? 'init_bear' : 'init';
    const tPct = ex.target_new && ex.target_old ? Math.round((ex.target_new / ex.target_old - 1) * 1000) / 10 : null;
    out.push({
      id: String(x.id ?? `${feedKey}:${x.published}:${subj.tv}:${a.firm}`),
      at: new Date(x.published * 1000).toISOString(),
      feed: feedKey, tv: subj.tv, symbol: subj.symbol, exchange: subj.exchange,
      firm: a.firm, kind, rating: a.rating ?? null, from: ex.from, from_bear: ratingTone(ex.from) < 0,
      // „sets/keeps price target at $42“ erkennt parseAnalystHeadline nicht.
      target: a.target ?? /price target (?:at|of) (\$?[\d.,]*\d)/.exec(x.title)?.[1] ?? null, target_pct: tPct, title: String(x.title).slice(0, 220),
      url: x.storyPath ? `https://www.tradingview.com${x.storyPath}` : (x.link || null),
    });
  }
  return out;
}

/** Neue Ereignisse in den Bestand mischen (nach id), alte über `keepDays` abwerfen. */
export function mergeEvents(stored, fresh, now = new Date(), rules = SCOUT_RULES) {
  const map = new Map((stored ?? []).map((e) => [e.id, e]));
  let added = 0;
  for (const e of fresh) if (!map.has(e.id)) { map.set(e.id, e); added++; }
  const cut = now.getTime() - rules.keepDays * 864e5;
  const events = [...map.values()].filter((e) => Date.parse(e.at) >= cut).sort((a, b) => b.at.localeCompare(a.at));
  return { events, added };
}

const POSITIVE = new Set(['upgrade', 'list_add', 'init_bull', 'target_up']);
const TRIGGER = new Set(['upgrade', 'list_add', 'init_bull']);
const NEGATIVE = new Set(['downgrade', 'list_remove', 'init_bear', 'target_down']);

function eventPoints(e, rules) {
  const W = rules.weights;
  switch (e.kind) {
    case 'upgrade': return W.upgrade + (e.from_bear ? W.upgrade_from_bear : 0);
    case 'list_add': return W.list_add;
    case 'init_bull': return W.init_bull;
    case 'target_up': return e.target_pct != null && e.target_pct >= rules.targetBig ? W.target_up_big : W.target_up;
    case 'downgrade': return W.downgrade;
    case 'list_remove': return W.list_remove;
    case 'init_bear': return W.init_bear;
    case 'target_down': return W.target_down;
    case 'assume': return ratingTone(e.rating) * W.assume;
    default: return 0;
  }
}

/* Je Haus und Titel zählt im Fenster nur die gewichtigste Meldung (TV meldet Rating und Ziel oft doppelt). */
function perFirm(events, rules) {
  const best = new Map();
  for (const e of events) {
    const k = String(e.firm ?? '').toLowerCase().replace(/[^a-z0-9äöü]/g, '');
    const p = eventPoints(e, rules);
    const cur = best.get(k);
    if (!cur || Math.abs(p) > Math.abs(cur.p) || (Math.abs(p) === Math.abs(cur.p) && e.at > cur.e.at)) best.set(k, { e, p });
  }
  return [...best.values()];
}

/**
 * Ereignisse → Signale je Titel. Ein Titel steht im Bericht, wenn er in den letzten `freshDays` einen
 * Auslöser hatte (Hochstufung, Empfehlungsliste, Erstbewertung positiv) oder im Fenster eine Häufung
 * von Kurszielerhöhungen (≥ `clusterFirms` Häuser) zeigt.
 * `yahoo` (optional): Map `SYMBOL:BÖRSE` → { up14, down14, firms14, up90, down90 }.
 */
export function signalsOf(events, { now = new Date(), yahoo = null, rules = SCOUT_RULES } = {}) {
  const t = now.getTime();
  const win = events.filter((e) => t - Date.parse(e.at) <= rules.windowDays * 864e5);
  const bySym = new Map();
  for (const e of win) {
    const k = `${e.symbol}:${e.exchange}`;
    if (!bySym.has(k)) bySym.set(k, []);
    bySym.get(k).push(e);
  }
  const out = [];
  for (const [key, list] of bySym) {
    const fresh = list.filter((e) => t - Date.parse(e.at) <= rules.freshDays * 864e5);
    const firms = perFirm(list, rules);
    const pos = firms.filter((f) => POSITIVE.has(f.e.kind));
    const neg = firms.filter((f) => NEGATIVE.has(f.e.kind));
    const trigger = fresh.find((e) => TRIGGER.has(e.kind));
    const cluster = pos.length >= rules.clusterFirms;
    if (!trigger && !(cluster && fresh.some((e) => POSITIVE.has(e.kind)))) continue;
    const y = yahoo?.get(key) ?? null;
    let points = firms.reduce((s, f) => s + f.p, 0);
    const reasons = [];
    if (cluster) { points += rules.weights.cluster; reasons.push(`${pos.length} Häuser positiv in ${rules.windowDays} Tagen`); }
    if (y && y.firms14 >= rules.clusterFirms + 1 && y.up14 > y.down14) { points += rules.weights.yahoo_cluster; reasons.push(`Yahoo: ${y.up14} Hoch-, ${y.down14} Abstufungen in 14 Tagen`); }
    if (neg.length) reasons.push(`Gegenwind: ${neg.map((f) => `${f.e.firm} (${KIND_LABEL[f.e.kind]})`).join(', ')}`);
    const head = trigger ?? fresh.find((e) => POSITIVE.has(e.kind));
    const [symbol, exchange] = [head.symbol, head.exchange];
    out.push({
      key, symbol, exchange, tv: head.tv,
      points: Math.round(points * 10) / 10,
      trigger: trigger ? head.kind : 'target_cluster', trigger_label: trigger ? KIND_LABEL[head.kind] : KIND_LABEL.target_cluster, firm: head.firm, rating: head.rating, from: head.from,
      target: head.target, target_pct: head.target_pct, at: head.at, title: head.title,
      pos_firms: pos.length, neg_firms: neg.length, cluster,
      url: head.url ?? null,
      events: list.slice(0, 4).map((e) => ({ at: e.at, firm: e.firm, kind: e.kind, rating: e.rating, target: e.target })),
      yahoo: y, reasons,
    });
  }
  return out.sort((a, b) => b.points - a.points || b.at.localeCompare(a.at));
}

export const KIND_LABEL = {
  upgrade: 'Hochstufung', downgrade: 'Abstufung', list_add: 'Empfehlungsliste', list_remove: 'Von Liste',
  init_bull: 'Erstbewertung positiv', init_bear: 'Erstbewertung negativ', init: 'Erstbewertung', assume: 'Coverage übernommen',
  target_up: 'Ziel ↑', target_down: 'Ziel ↓', reiterate: 'Bestätigt', target_cluster: 'Kursziel-Häufung',
};

/** Yahoo upgradeDowngradeHistory → Kennzahlen für 14 und 90 Tage. */
export function yahooStats(history, now = new Date()) {
  const t = now.getTime() / 1000;
  const h = (Array.isArray(history) ? history : []).filter((x) => Number.isFinite(x?.epochGradeDate));
  const within = (d) => h.filter((x) => t - x.epochGradeDate <= d * 86400);
  const count = (list, a) => list.filter((x) => x.action === a).length;
  const h14 = within(14), h90 = within(90);
  return {
    up14: count(h14, 'up'), down14: count(h14, 'down'), firms14: new Set(h14.map((x) => x.firm)).size,
    up90: count(h90, 'up'), down90: count(h90, 'down'), n90: h90.length,
  };
}

/**
 * Bewertung gegen die Auto-Rotation. `row` = rowOf(c) aus tools/auto-rotation/select.mjs,
 * `cutoff` = Score des Momentum-Rangs `enter` im neuesten Rotationsbericht.
 * → 'stark' (würde einziehen) · 'knapp' · 'schwach' · 'klein' · 'ohne Daten'.
 */
export function verdictOf(row, capUsd, cutoff, rules = SCOUT_RULES) {
  if (!row || row.score == null) return 'ohne Daten';
  if (capUsd != null && capUsd < rules.minCapUsd) return 'klein';
  if (cutoff == null) return row.score >= 60 ? 'stark' : row.score >= 50 ? 'knapp' : 'schwach';
  if (row.score >= cutoff) return 'stark';
  if (row.score >= cutoff - rules.nearGap) return 'knapp';
  return 'schwach';
}

/* Aktionsnamen der App (tv-news.js) für die Scout-Arten. */
const APP_ACTION = { init_bull: 'init', init_bear: 'init', assume: 'init' };
const toneOf = (kind) => ANALYST_ACTIONS[APP_ACTION[kind] ?? kind]?.tone ?? null;
const rankOf = (kind) => (kind === 'assume' ? 0 : ANALYST_ACTIONS[APP_ACTION[kind] ?? kind]?.rank ?? 0);

/**
 * „Bestand neu bewertet“: je Titel aus Watchlist, Inbox und Archiv eine Zeile mit der gewichtigsten
 * Analystenmeldung der letzten `knownDays` Tage. Quellen: die marktweiten Scout-Ereignisse und der
 * analyst-Blob des Monitor-Laufs (Spalte „Ana“, Format { at, firm, action, rating, target, title, url }).
 * `known` = Map `SYMBOL:BÖRSE` → { bucket, name, eye, star }.
 */
export function knownUpdates(scoutEvents, analystEvents, known, { now = new Date(), rules = SCOUT_RULES } = {}) {
  const cut = now.getTime() - rules.knownDays * 864e5;
  const byKey = new Map();
  const add = (key, e) => {
    if (!known.has(key) || !(Date.parse(e.at) >= cut) || e.kind === 'reiterate') return;
    const list = byKey.get(key) ?? [];
    const firm = String(e.firm ?? '').toLowerCase().replace(/[^a-z0-9äöü]/g, '');
    const dup = list.find((x) => x.firmKey === firm && Math.abs(Date.parse(x.at) - Date.parse(e.at)) < 18 * 3600e3);
    if (dup) { if (!dup.title && e.title) Object.assign(dup, { title: e.title, url: dup.url ?? e.url }); if (rankOf(e.kind) > rankOf(dup.kind)) Object.assign(dup, { kind: e.kind, rating: e.rating ?? dup.rating, target: e.target ?? dup.target }); return; }
    list.push({ ...e, firmKey: firm });
    byKey.set(key, list);
  };
  for (const e of scoutEvents ?? []) add(`${e.symbol}:${e.exchange}`, e);
  for (const [key, list] of Object.entries(analystEvents ?? {})) {
    for (const e of list ?? []) add(key, { at: e.at, firm: e.firm, kind: e.action, rating: e.rating ?? null, target: e.target ?? null, title: e.title ?? null, url: e.url ?? null });
  }
  const BUCKET_ORDER = { watch: 0, inbox: 1, archive: 2 };
  const out = [];
  for (const [key, list] of byKey) {
    const k = known.get(key);
    list.sort((a, b) => rankOf(b.kind) - rankOf(a.kind) || b.at.localeCompare(a.at));
    const lead = list[0];
    if (lead.kind === 'assume' && list.length === 1) continue;   // reiner Analystenwechsel
    const [symbol, exchange] = key.split(':');
    const up = list.filter((e) => toneOf(e.kind) === 'pos').length;
    const down = list.filter((e) => toneOf(e.kind) === 'neg').length;
    out.push({
      symbol, exchange, name: k.name ?? symbol, bucket: k.bucket, eye: !!k.eye, star: !!k.star,
      kind: lead.kind, label: KIND_LABEL[lead.kind] ?? lead.kind, tone: toneOf(lead.kind),
      firm: lead.firm, rating: lead.rating ?? null, target: lead.target ?? null, at: lead.at,
      title: lead.title ?? `${lead.firm}: ${KIND_LABEL[lead.kind] ?? lead.kind}${lead.rating ? ` · ${lead.rating}` : ''}`,
      url: lead.url ?? null, more: list.length - 1, up, down,
      latest: list.reduce((m, e) => (e.at > m ? e.at : m), lead.at),
    });
  }
  return out.sort((a, b) => (BUCKET_ORDER[a.bucket] ?? 9) - (BUCKET_ORDER[b.bucket] ?? 9) || (b.eye - a.eye) || b.latest.localeCompare(a.latest));
}
