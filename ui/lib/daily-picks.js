/**
 * Tagessieger – Treffer-Check, Lernschleife und Bestenliste. Reine Logik ohne I/O,
 * genutzt vom Monitor-Lauf (tools/monitor-report/run.mjs) und von der App
 * (Monitor-Reiter „Tagessieger", components/daily-picks-panel.js).
 *
 * Ein Eintrag `kind: 'picks'` im market-Blob (geschrieben von der geplanten Aufgabe
 * über market-briefing.yml) trägt:
 *   day            Tag der Auswahl (JJJJ-MM-TT, werktags 8 Uhr)
 *   trading_day    Handelstag der Schlusskurse, auf denen die Auswahl beruht
 *   picks[5]       {rank, symbol, exchange, name, close, score, setup, catalyst, risk, reason}
 *   pool[≈15]      Vorauswahl 1:1 aus „Discovery Rankings.json“ → daily_picks.pool
 *                  {symbol, exchange, close, score, factors}
 *
 * Der nächtliche Monitor-Lauf ergänzt je Pool-Titel `perf_1d` und `perf_5d`
 * (Schlusskurs nach 1 bzw. 5 Handelstagen gegen `close`), und zwar einmal: wer
 * später gemessen wird (Lauf ausgefallen), bekommt den Wert beim nächsten Lauf,
 * `late: true` markiert das. Die 5 Tagessieger sind Pool-Titel mit `chosen: true`.
 *
 * Lernschleife (`reviewPicks` → `nextMethod`): Rangkorrelation je Faktor gegen
 * perf_5d über alle gereiften Pool-Titel; je Schritt höchstens ±0,02 je Gewicht,
 * frühestens alle 5 Handelstage und erst ab MIN_SAMPLE Messungen.
 */

export const MIN_SAMPLE = 30;
export const STEP = 0.02;
export const MIN_WEIGHT = 0.03;
export const REVIEW_WINDOW = 60;     // so viele Tagessieger-Einträge fliessen in den Check

const keyOf = (x) => `${String(x.symbol ?? '').toUpperCase()}:${String(x.exchange ?? '').toUpperCase()}`;
const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Handelstage (Mo–Fr) nach `from` bis einschliesslich `to`. Feiertage zählen mit – genau genug. */
export function tradingDaysBetween(from, to) {
  if (!from || !to || to <= from) return 0;
  let n = 0;
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

export const picksOf = (briefings) => (briefings ?? []).filter((b) => b.kind === 'picks')
  .sort((a, b) => (a.day < b.day ? 1 : -1));

/** Pool-Einträge eines Tages mit `chosen` markiert. Fehlt der Pool, gelten die Picks als Pool. */
export function poolOf(entry) {
  const chosen = new Map((entry.picks ?? []).map((p) => [keyOf(p), p]));
  const pool = (entry.pool?.length ? entry.pool : entry.picks ?? []).map((x) => ({ ...x }));
  for (const x of pool) x.chosen = chosen.has(keyOf(x));
  return pool;
}

/**
 * Trägt perf_1d / perf_5d nach. `priceOf(symbol, exchange)` liefert den heutigen
 * Schlusskurs oder null. Ändert die Einträge in place; Rückgabe = Anzahl Messungen.
 */
export function updateOutcomes(briefings, priceOf, today) {
  let n = 0;
  for (const e of picksOf(briefings)) {
    const base = e.trading_day ?? e.day;
    const days = tradingDaysBetween(base, today);
    if (days < 1) continue;
    const rows = [...(e.pool ?? []), ...(e.picks ?? [])];
    for (const x of rows) {
      if (!(x.close > 0)) continue;
      const need1 = x.perf_1d == null;
      const need5 = x.perf_5d == null && days >= 5;
      if (!need1 && !need5) continue;
      const p = priceOf(x.symbol, x.exchange);
      if (!(p > 0)) continue;
      const perf = round((p / x.close - 1) * 100, 2);
      if (need1) { x.perf_1d = perf; if (days > 1) x.late_1d = true; n++; }
      if (need5) { x.perf_5d = perf; if (days > 5) x.late_5d = true; n++; }
    }
    if (days >= 5 && !e.matured) e.matured = rows.every((x) => x.perf_5d != null || !(x.close > 0));
  }
  return n;
}

/* Spearman-Rangkorrelation; gleiche Werte bekommen den mittleren Rang. */
function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}
export function spearman(x, y) {
  if (x.length < 3) return null;
  const rx = ranks(x), ry = ranks(y);
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

/**
 * Treffer-Check über die letzten REVIEW_WINDOW Einträge.
 * Treffer = Kurs nach 5 Handelstagen höher. „Vorsprung" = Tagessieger gegen den
 * übrigen Pool desselben Tages: zeigt, ob die KI-Auswahl mehr bringt als der Filter.
 */
export function reviewPicks(briefings, weights) {
  const entries = picksOf(briefings).slice(0, REVIEW_WINDOW);
  const chosen = [], rest = [], pool = [];
  for (const e of entries) for (const x of poolOf(e)) {
    pool.push(x);
    (x.chosen ? chosen : rest).push(x);
  }
  const vals = (a, k) => a.map((x) => x[k]).filter((v) => v != null);
  const stats = (a) => {
    const p1 = vals(a, 'perf_1d'), p5 = vals(a, 'perf_5d');
    return {
      n_1d: p1.length, n_5d: p5.length,
      hit_1d_pct: p1.length ? round((p1.filter((v) => v > 0).length / p1.length) * 100, 0) : null,
      hit_5d_pct: p5.length ? round((p5.filter((v) => v > 0).length / p5.length) * 100, 0) : null,
      avg_1d: round(mean(p1)), avg_5d: round(mean(p5)), median_5d: round(median(p5)),
    };
  };
  const matured = pool.filter((x) => x.perf_5d != null && x.factors);
  const factor_corr = {};
  for (const k of Object.keys(weights ?? {})) {
    const pairs = matured.filter((x) => x.factors[k] != null);
    factor_corr[k] = pairs.length >= 10 ? round(spearman(pairs.map((x) => x.factors[k]), pairs.map((x) => x.perf_5d)), 3) : null;
  }
  const chosenStats = stats(chosen), restStats = stats(rest);
  return {
    entries: entries.length,
    since: entries.at(-1)?.day ?? null,
    chosen: chosenStats,
    rest: restStats,
    pool: stats(pool),
    edge_5d: chosenStats.avg_5d != null && restStats.avg_5d != null ? round(chosenStats.avg_5d - restStats.avg_5d) : null,
    score_corr_5d: matured.length >= 10 ? round(spearman(matured.map((x) => x.score ?? 0), matured.map((x) => x.perf_5d)), 3) : null,
    factor_corr,
    sample: matured.length,
  };
}

/**
 * Neue Gewichte aus dem Check. Gibt null zurück, wenn (noch) nichts angepasst wird.
 * Positive Korrelation → Gewicht steigt um STEP, negative → sinkt (nie unter
 * MIN_WEIGHT, Vorzeichen bleibt), danach Normierung auf Summe |w| = 1.
 */
export function nextMethod(method, review, today) {
  if (!review || review.sample < MIN_SAMPLE) return null;
  if (method?.updated_day && tradingDaysBetween(method.updated_day, today) < 5) return null;
  const old = method.weights;
  const changes = [];
  const w = {};
  for (const [k, v] of Object.entries(old)) {
    const c = review.factor_corr[k];
    let mag = Math.abs(v);
    if (c != null && Math.abs(c) >= 0.05) mag = Math.max(MIN_WEIGHT, mag + (c > 0 ? STEP : -STEP));
    w[k] = Math.sign(v || 1) * mag;
  }
  const sum = Object.values(w).reduce((a, v) => a + Math.abs(v), 0);
  for (const k of Object.keys(w)) {
    w[k] = round(w[k] / sum, 3);
    if (Math.abs(w[k] - old[k]) >= 0.005) changes.push({ factor: k, old: old[k], new: w[k], corr: review.factor_corr[k] });
  }
  if (!changes.length) return null;
  return {
    version: (method.version ?? 0) + 1,
    weights: w,
    updated_day: today,
    sample: review.sample,
    history: [...(method.history ?? []), { version: method.version ?? 0, weights: old, until: today }].slice(-20),
    last_changes: changes,
  };
}

/**
 * Bestenliste: wie oft war ein Titel Tagessieger, wie lief er danach.
 * Sortiert nach Anzahl, dann nach Ø 5 Tage.
 */
export function leaderboard(briefings, { limit = 20 } = {}) {
  const map = new Map();
  for (const e of picksOf(briefings)) for (const x of poolOf(e)) {
    if (!x.chosen) continue;
    const k = keyOf(x);
    const pick = (e.picks ?? []).find((p) => keyOf(p) === k) ?? x;
    const r = map.get(k) ?? { symbol: x.symbol, exchange: x.exchange, name: pick.name ?? null, wins: 0, last: null, first: null, p1: [], p5: [] };
    r.wins++;
    r.last = r.last && r.last > e.day ? r.last : e.day;
    r.first = r.first && r.first < e.day ? r.first : e.day;
    r.name ??= pick.name ?? null;
    if (x.perf_1d != null) r.p1.push(x.perf_1d);
    if (x.perf_5d != null) r.p5.push(x.perf_5d);
    map.set(k, r);
  }
  return [...map.values()].map((r) => ({
    symbol: r.symbol, exchange: r.exchange, name: r.name, wins: r.wins, first: r.first, last: r.last,
    avg_1d: round(mean(r.p1)), avg_5d: round(mean(r.p5)),
    hits_5d: r.p5.filter((v) => v > 0).length, n_5d: r.p5.length,
  })).sort((a, b) => b.wins - a.wins || (b.avg_5d ?? -1e9) - (a.avg_5d ?? -1e9) || a.symbol.localeCompare(b.symbol))
    .slice(0, limit);
}
