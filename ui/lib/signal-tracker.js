/**
 * signal-tracker.js — the feedback loop for the Monitor's signals.
 *
 * Every "TV Daten" enrichment run records the signals that fired that day
 * (SMA crosses, MACD flips, RSI extremes — the same detectors the Monitor
 * shows) into the candidate's `signal_log`, then lazily evaluates matured
 * entries against later prices (1W/2W/4W horizons). The log lives on the
 * candidate itself, so it persists through the normal blob save — no new
 * storage. `scoreboard()` aggregates hit rates per signal type so the
 * Monitor can show which signals actually work in this universe.
 *
 * Log entry: { t, dir, d, p, o }
 *   t   signal type/label (e.g. "Golden Cross", "Kurs↑SMA200", "MACD bullish")
 *   dir +1 bullish / −1 bearish (defines what counts as a hit)
 *   d   YYYY-MM-DD the signal fired, p = tv close that day (native currency)
 *   o   outcomes per horizon: { "7": { r, at }, "14": …, "28": … } — r is the
 *       raw % return since d; a hit is dir·r > 0. Evaluated at the first app
 *       use on/after d+h, preferring the snapshot close nearest the target
 *       day (±grace), else the live close.
 */

import { smaCrosses, macdFlips, rsiExtremes } from './dashboard-metrics.js?v=20260807a';

export const HORIZONS = [7, 14, 28];                 // calendar days
export const HORIZON_LABELS = { 7: '1W', 14: '2W', 28: '4W' };
const LOG_MAX = 40;                                   // entries kept per candidate
const COOLDOWN_DAYS = { rsi: 14, default: 1 };        // RSI extremes persist for days

const dayNow = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

/* ── Recording ────────────────────────────────────────────────────────────── */

function firedSignals(candidates) {
  const per = new Map(); // candidate id → [{t, dir}]
  const add = (c, t, dir) => {
    if (!per.has(c.id)) per.set(c.id, []);
    per.get(c.id).push({ t, dir });
  };
  const sma = smaCrosses(candidates);
  for (const r of sma.bullish) add(r.c, r.label, 1);
  for (const r of sma.bearish) add(r.c, r.label, -1);
  const macd = macdFlips(candidates);
  for (const r of macd.bullish) add(r.c, 'MACD bullish', 1);
  for (const r of macd.bearish) add(r.c, 'MACD bearish', -1);
  const rsi = rsiExtremes(candidates);
  for (const r of rsi.oversold)   add(r.c, 'RSI ≤ 30', 1);   // rebound thesis
  for (const r of rsi.overbought) add(r.c, 'RSI ≥ 70', -1);  // exhaustion thesis
  return per;
}

const cooldownOf = (t) => (t.startsWith('RSI') ? COOLDOWN_DAYS.rsi : COOLDOWN_DAYS.default);

/* ── Evaluation ───────────────────────────────────────────────────────────── */

/* Best price for `targetDay`: the snapshot close dated nearest the target
 * (within ±3 days), else the live close (dated today). */
function priceAround(tv, targetDay, today) {
  const snaps = (Array.isArray(tv.snapshot) ? tv.snapshot : [])
    .filter((s) => s.close != null && s.d)
    .map((s) => ({ d: s.d, close: s.close, dist: Math.abs(daysBetween(s.d, targetDay)) }))
    .sort((a, b) => a.dist - b.dist);
  if (snaps.length && snaps[0].dist <= 3) return { price: snaps[0].close, at: snaps[0].d };
  return tv.close != null ? { price: tv.close, at: today } : null;
}

/* ── Main entry: record today's signals + evaluate matured entries ─────────
 * Mutates the candidates' `signal_log`. Returns { recorded, evaluated,
 * changedIds } so the caller can persist exactly the touched candidates. */
export function trackSignals(candidates) {
  const today = dayNow();
  const fired = firedSignals(candidates);
  let recorded = 0, evaluated = 0;
  const changedIds = new Set();

  for (const c of candidates ?? []) {
    const tv = c?.tv_data;
    if (!tv) continue;
    let log = Array.isArray(c.signal_log) ? c.signal_log : [];

    // 1) record new signals (respecting per-type cooldown)
    for (const { t, dir } of fired.get(c.id) ?? []) {
      if (tv.close == null) continue;
      const recent = log.find((e) => e.t === t && daysBetween(e.d, today) < cooldownOf(t));
      if (recent) continue;
      log = [{ t, dir, d: today, p: tv.close, o: {} }, ...log].slice(0, LOG_MAX);
      recorded++;
      changedIds.add(c.id);
    }

    // 2) evaluate matured horizons
    for (const e of log) {
      if (e.p == null) continue;
      for (const h of HORIZONS) {
        if (e.o?.[h]) continue;
        if (daysBetween(e.d, today) < h) continue;
        const target = new Date(new Date(e.d).getTime() + h * 864e5).toISOString().slice(0, 10);
        const hit = priceAround(tv, target, today);
        if (!hit) continue;
        e.o = e.o ?? {};
        e.o[h] = { r: +(((hit.price - e.p) / e.p) * 100).toFixed(2), at: hit.at };
        evaluated++;
        changedIds.add(c.id);
      }
    }

    if (changedIds.has(c.id)) c.signal_log = log;
  }
  return { recorded, evaluated, changedIds };
}

/* ── Aggregation for the Monitor card ─────────────────────────────────────
 * Returns rows sorted by evidence: { t, dir, n, horizons: { 7: { n, win,
 * avg }, … } } where win = share of dir·r > 0 and avg = mean dir·r (return
 * in signal direction — positive means the signal worked). */
export function scoreboard(candidates) {
  const byType = new Map();
  for (const c of candidates ?? []) {
    const close = c?.tv_data?.close ?? null;
    for (const e of c?.signal_log ?? []) {
      if (!byType.has(e.t)) byType.set(e.t, { t: e.t, dir: e.dir, n: 0, live: [], samples: { 7: [], 14: [], 28: [] } });
      const g = byType.get(e.t);
      g.n++;
      // Live: aktueller Verlauf aller noch nicht voll ausgereiften Signale in
      // Signalrichtung — macht das Scoreboard vom ersten Tag an aussagekräftig.
      if (close != null && e.p > 0 && !e.o?.[28]) {
        g.live.push(e.dir * ((close - e.p) / e.p) * 100);
      }
      for (const h of HORIZONS) {
        const r = e.o?.[h]?.r;
        if (r != null) g.samples[h].push(e.dir * r);
      }
    }
  }
  const agg = (s) => (s.length ? {
    n: s.length,
    win: Math.round((s.filter((v) => v > 0).length / s.length) * 100),
    avg: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1),
  } : null);
  const rows = [...byType.values()].map((g) => {
    const horizons = {};
    let evaluated = 0;
    for (const h of HORIZONS) {
      horizons[h] = agg(g.samples[h]);
      evaluated += g.samples[h].length;
    }
    return { t: g.t, dir: g.dir, n: g.n, evaluated, live: agg(g.live), horizons };
  });
  return rows.sort((a, b) => b.evaluated - a.evaluated || b.n - a.n);
}
