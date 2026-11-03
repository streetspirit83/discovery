/**
 * analyst-events.js — Analystenaktionen und Konsens für den Monitor-Lauf.
 * Rein und ohne I/O: `tools/monitor-report/run.mjs` holt die Daten und hält den
 * Zustand im Blob `analyst`; das Detail-Sheet liest die Aktionen direkt aus
 * `tv_news`, damit sie für jeden Titel da sind, nicht nur für den Monitor-Ausschnitt.
 *
 * Bestätigungen fliegen hier raus: Sie sind die grosse Mehrheit und ändern nichts.
 */

import { ANALYST_ACTIONS, collapseAnalyst } from './tv-news.js?v=20261103b';

const KEEP_DAYS = 180;             // Historie je Titel
const MAX_PER_TITLE = 40;
const AFTER_EARNINGS_DAYS = 2;     // Kursziel-Nachlauf nach Zahlen
const CLUSTER_DAYS = 5;
const CLUSTER_MIN = 3;             // ab so vielen Häusern gleicher Richtung
const MIN_RATINGS = 5;             // Konsens-Drift erst ab dieser Abdeckung
const MIN_MARK_MOVE = 0.03;        // Skala 1 (Strong Buy) bis 3 (Strong Sell)
const MAX_ACTIONS = 30;
const MAX_SHIFTS = 15;
const DAY_MS = 864e5;

export const actionDir = (action) => {
  const tone = ANALYST_ACTIONS[action]?.tone;
  return tone === 'pos' ? 'up' : tone === 'neg' ? 'down' : null;
};

const round = (v, d) => (v == null || !Number.isFinite(+v) ? null : +(+v).toFixed(d));

/** `tv_news`-Einträge → Ereignisse, neueste zuerst. */
export function eventsFromNews(items) {
  return (items ?? [])
    .filter((it) => it.analyst && it.analyst.action !== 'reiterate' && it.date)
    .map((it) => ({
      at: it.date,
      firm: it.analyst.firm,
      action: it.analyst.action,
      rating: it.analyst.rating ?? null,
      target: it.analyst.target ?? null,
      title: it.title,
      url: it.source_url ?? null,
    }));
}

/** Fügt Ereignisse zusammen: je Haus und Ereignis eines, die gewichtigste Aktion gewinnt. */
export function mergeEvents(existing, fresh, now = new Date()) {
  const seen = new Map();                    // gleiche Meldung aus altem und neuem Stand
  for (const e of [...(existing ?? []), ...(fresh ?? [])]) seen.set(`${e.at}|${e.firm}|${e.action}`, e);
  const all = [...seen.values()];
  const keep = collapseAnalyst(all, (e) => e);
  const cutoff = new Date(now.getTime() - KEEP_DAYS * DAY_MS).toISOString();
  return all
    .filter((e) => keep.has(e) && e.at >= cutoff)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_PER_TITLE);
}

/** Liegt das Ereignis im Nachlauf der letzten Zahlen? `earnings` = Epoch in Sekunden. */
export function isAfterEarnings(at, earnings) {
  if (!(earnings > 0)) return false;
  const gap = (new Date(at).getTime() - earnings * 1000) / DAY_MS;
  return gap >= -0.5 && gap <= AFTER_EARNINGS_DAYS;
}

/** Stand des Konsens aus `tv_data`, kompakt für den Blob. */
export function consensusOf(tv, day) {
  if (!tv || !(tv.recommendation_total > 0) || tv.rec_mark == null) return null;
  return {
    d: day, mark: round(tv.rec_mark, 3), n: tv.recommendation_total,
    sb: tv.rec_buy ?? 0, b: tv.rec_over ?? 0, h: tv.rec_hold ?? 0, s: tv.rec_under ?? 0, ss: tv.rec_sell ?? 0,
    pt: round(tv.pt_median, 2),
  };
}

/** Neuer Stand je Titel; beim zweiten Lauf am selben Tag bleibt der Vergleichswert erhalten. */
export function rollConsensus(stored, cur) {
  if (!cur) return stored ?? null;
  if (stored?.cur?.d === cur.d) return { cur, prev: stored.prev ?? null };
  return { cur, prev: stored?.cur ?? null };
}

export function consensusShift({ cur, prev } = {}) {
  if (!cur || !prev || cur.n < MIN_RATINGS || prev.n < MIN_RATINGS) return null;
  const dMark = cur.mark - prev.mark;
  if (Math.abs(dMark) < MIN_MARK_MOVE) return null;
  return {
    mark: cur.mark, d_mark: round(dMark, 3), dir: dMark < 0 ? 'up' : 'down',
    ratings: cur.n, d_ratings: cur.n - prev.n,
    buy: cur.sb + cur.b, hold: cur.h, sell: cur.s + cur.ss,
    d_buy: cur.sb + cur.b - prev.sb - prev.b, d_hold: cur.h - prev.h, d_sell: cur.s + cur.ss - prev.s - prev.ss,
    pt_median: cur.pt,
    d_pt_pct: cur.pt > 0 && prev.pt > 0 ? round((cur.pt / prev.pt - 1) * 100, 1) : null,
  };
}

/** Mehrere Häuser in dieselbe Richtung; Kursziel-Nachlauf nach Zahlen zählt nicht mit. */
export function clusterOf(events, earnings, now = new Date()) {
  const cutoff = new Date(now.getTime() - CLUSTER_DAYS * DAY_MS).toISOString();
  const firms = { up: new Set(), down: new Set() };
  for (const e of events ?? []) {
    const dir = actionDir(e.action);
    if (!dir || e.at < cutoff) continue;
    if (e.action.startsWith('target') && isAfterEarnings(e.at, earnings)) continue;
    firms[dir].add(e.firm);
  }
  const dir = firms.up.size >= firms.down.size ? 'up' : 'down';
  return firms[dir].size >= CLUSTER_MIN ? { dir, n: firms[dir].size, days: CLUSTER_DAYS, firms: [...firms[dir]] } : null;
}

/** Bilanz eines Titels für den Wochenausblick. */
export function tally(events, now = new Date()) {
  const within = (days) => (events ?? []).filter((e) => e.at >= new Date(now.getTime() - days * DAY_MS).toISOString());
  const count = (list, dir) => list.filter((e) => actionDir(e.action) === dir).length;
  const w = within(7), m = within(30);
  return {
    up_7d: count(w, 'up'), down_7d: count(w, 'down'), up_30d: count(m, 'up'), down_30d: count(m, 'down'),
    recent: w.slice(0, 5).map(({ at, firm, action, rating, target }) => ({
      date: at.slice(0, 10), firm, action, label: ANALYST_ACTIONS[action]?.label ?? action, rating, target,
    })),
  };
}

/**
 * Baut den Block `analyst` des Berichts.
 * @param titles [{ key, ref, chg_1d, earnings, events, consensus:{cur,prev} }]
 * @param since  ISO-Zeitpunkt: nur jüngere Ereignisse gelten als neu
 */
export function buildAnalystBlock(titles, { since, scanned = 0, failed = 0, now = new Date() } = {}) {
  const actions = [], clusters = [], consensus_shifts = [];
  for (const t of titles) {
    for (const e of t.events ?? []) {
      if (e.at <= since) continue;
      actions.push({
        ...t.ref, date: e.at.slice(0, 10), firm: e.firm, action: e.action,
        label: ANALYST_ACTIONS[e.action]?.label ?? e.action, dir: actionDir(e.action),
        rating: e.rating, target: e.target, title: e.title, chg_1d: t.chg_1d ?? null,
        ...(isAfterEarnings(e.at, t.earnings) ? { after_earnings: true } : {}),
      });
    }
    const cl = clusterOf(t.events, t.earnings, now);
    if (cl) clusters.push({ ...t.ref, ...cl });
    const sh = consensusShift(t.consensus);
    if (sh) consensus_shifts.push({ ...t.ref, ...sh });
  }
  const weight = (a) => (ANALYST_ACTIONS[a.action]?.rank ?? 0) * 2 - (a.after_earnings ? 3 : 0) + (a.eye ? 1 : 0);
  actions.sort((a, b) => weight(b) - weight(a) || b.date.localeCompare(a.date));
  clusters.sort((a, b) => b.n - a.n);
  consensus_shifts.sort((a, b) => Math.abs(b.d_mark) - Math.abs(a.d_mark));
  return {
    available: true, since, scanned, failed,
    actions: actions.slice(0, MAX_ACTIONS),
    actions_total: actions.length,
    clusters,
    consensus_shifts: consensus_shifts.slice(0, MAX_SHIFTS),
  };
}
