/**
 * Setup-Matrix im Monitor-Reiter „Dynamik“ (reine Logik, kein DOM).
 *
 * `priceSituation` ist die Setup-Spalte der Trade-Ansicht (vorher fest in candidate-list.js):
 * 🚀 Blue-Sky · 🎯 Breakout-Nähe · 🔄 Pullback im Trend · 📉 Unter Trend · ➖ Range (= kein Setup),
 * ⚠ hängt bei Earnings im 1M-Fenster an. Tabelle und Dashboard nutzen genau diese Stelle.
 *
 * Die Matrix kreuzt die vier Setup-Typen mit drei festen Signalen:
 *   V/Ø30d > 100 %  (aktuelles Volumen ÷ Ø 30 Tage, wie Spalte „V/Ø30d“)
 *   Brk↑%  > 50 %   (Breakout-Wahrscheinlichkeit aus der LS-Historie, wie Spalte „Brk↑%“)
 *   Rat1M  > 0,6    (TradingView-Rating 1 Monat, −1…1, ab 0,6 „Strong Buy“)
 * Dazu %S200 (TV-Schluss gegen TV-SMA200, wie die S200-Spalten der Signal-Matrix) in
 * Quintilen über den gezeigten Ausschnitt und EPS-Wachstum YoY in % (TTM, sonst FY).
 */

import { classifyCluster } from './trade-setup.js?v=20260807a';
import { detectBreakoutSetup } from './ls-history-signals.js?v=20260807a';
import { sma200DistPct } from './sma200-extremes.js?v=20261106b';
import { smaReversal, smaTrendScore } from './sma-trend-score.js?v=20261127b';

/* ── Setup-Spalte ─────────────────────────────────────────────────────────── */

const SITUATION = {
  bluesky:  { icon: '🚀', label: 'Blue-Sky: Kurs über 52W-Hoch – kein struktureller Widerstand' },
  breakout: { icon: '🎯', label: 'Breakout-Nähe: Kurs ≤2% unter dem 1M/3M-Hoch' },
  pullback: { icon: '🔄', label: 'Pullback im Trend: Kurs unter SMA20, über SMA50' },
  below:    { icon: '📉', label: 'Unter Trend: Kurs unter SMA50' },
  range:    { icon: '➖', label: 'Range: kein klares Setup' },
};

/** Setup-Typ eines Titels: 'bluesky' | 'breakout' | 'pullback' | 'below' | 'range' | null (ohne Kurs). */
export function situationKey(tv) {
  if (!tv) return null;
  const close = tv.close_1m ?? tv.close;
  if (close == null) return null;
  const nearHigh = Math.max(tv.high_1m ?? 0, tv.high_3m ?? 0) || null;
  if (tv.price_52_week_high != null && close > tv.price_52_week_high) return 'bluesky';
  if (nearHigh != null && close >= nearHigh * 0.98) return 'breakout';
  if (tv.sma20 != null && tv.sma50 != null && close < tv.sma20 && close >= tv.sma50) return 'pullback';
  if (tv.sma50 != null && close < tv.sma50) return 'below';
  return 'range';
}

/** Earnings innerhalb der nächsten 31 Tage. */
export function earningsSoon(tv) {
  if (!tv?.earnings_next_date) return false;
  const ts = typeof tv.earnings_next_date === 'number'
    ? tv.earnings_next_date * 1000 : new Date(tv.earnings_next_date).getTime();
  const days = (ts - Date.now()) / 86400000;
  return days >= 0 && days <= 31;
}

/** Zelle der Setup-Spalte: { key, icon, label } oder null. */
export function priceSituation(tv) {
  const key = situationKey(tv);
  if (!key) return null;
  let { icon, label } = SITUATION[key];
  if (earningsSoon(tv)) { icon += '⚠'; label += ' · Earnings im 1M-Fenster'; }
  return { key, icon, label };
}

/* ── Kennzahlen ───────────────────────────────────────────────────────────── */

/** Aktuelles Volumen (letzter LS-History-Snapshot) ÷ Ø-Volumen 10 oder 30 Tage, in %. */
export function volRatioPct(c, days) {
  const h = c?.ls_history;
  const v = Array.isArray(h) && h.length ? h[h.length - 1]?.volume ?? null : null;
  const avg = days === 30 ? c?.tv_data?.average_volume_30d_calc : c?.tv_data?.avg_vol_10d;
  return v != null && avg > 0 ? (v / avg) * 100 : null;
}

/** Breakout-Wahrscheinlichkeit in % wie Spalte „Brk↑%“ (braucht die LS-Historie). */
export function breakoutPct(c) {
  return detectBreakoutSetup(c?.ls_history, classifyCluster(c?.tv_data)?.avgVol)?.breakoutProbabilityPct ?? null;
}

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
export const epsGrowthPct = (tv) => num(tv?.earnings_per_share_diluted_yoy_growth_ttm) ?? num(tv?.earnings_per_share_diluted_yoy_growth_fy);

/* ── Matrix ───────────────────────────────────────────────────────────────── */

/** Die vier Setup-Typen (➖ Range zählt nicht als Setup). `tone` = CSS-Token der Farbe. */
export const SETUP_TYPES = [
  { key: 'bluesky',  label: 'Blue-Sky',      icon: 'rocket',       tone: '--ai' },
  { key: 'breakout', label: 'Breakout-Nähe', icon: 'target',       tone: '--accent' },
  { key: 'pullback', label: 'Pullback',      icon: 'refreshCw',    tone: '--pos' },
  { key: 'below',    label: 'Unter Trend',   icon: 'trendingDown', tone: '--neg' },
];

export const THRESH = { vol: 100, brk: 50, rat: 0.6 };

/* Zusatzzeilen der Setup-Matrix (seit 27.11.2026): Titel mit SMA-Trendumkehr ab „früh“ (|r| ≥ 25), je Richtung.
   Anders als die vier Setups schliessen sie sich nicht aus (ein Titel steht im Setup UND in einer Umkehr-Zeile). */
export const REV_ROWS = [
  { key: 'rev_up', label: 'Umkehr ↑', icon: 'trendingUp',   tone: '--pos', dir: 1,  test: (m) => m.rev?.dir > 0 },
  { key: 'rev_dn', label: 'Umkehr ↓', icon: 'trendingDown', tone: '--neg', dir: -1, test: (m) => m.rev?.dir < 0 },
];

/** Spalten der Matrix. `test(m)` prüft die Kennzahlen eines Titels. */
export const SETUP_COLS = [
  { key: 'n',    label: 'Titel',        title: 'Alle Titel des Typs',                          test: () => true },
  { key: 'vol',  label: 'V/Ø30d\n>100%', title: 'Volumen über dem 30-Tage-Schnitt (V/Ø30d > 100 %)', test: (m) => m.vol > THRESH.vol },
  { key: 'brk',  label: 'Brk↑\n>50%',   title: 'Breakout-Wahrscheinlichkeit über 50 % (Brk↑%)',  test: (m) => m.brk > THRESH.brk },
  { key: 'rat',  label: 'Rat1M\n>0,6',  title: 'TV-Rating 1 Monat über 0,6 (Strong Buy)',        test: (m) => m.rat > THRESH.rat },
  { key: 'all3', label: 'alle 3',        title: 'Volumen, Breakout und Rating zugleich',          test: (m) => m.vol > THRESH.vol && m.brk > THRESH.brk && m.rat > THRESH.rat },
];

/** Kennzahlen je Titel. `setup` = Typ-Key oder null (kein Setup / kein Kurs). */
export function setupMetrics(cands) {
  return (cands ?? []).map((c) => {
    const tv = c?.tv_data;
    const k = situationKey(tv);
    return {
      c,
      setup: k && k !== 'range' ? k : null,
      earn: earningsSoon(tv),
      vol: volRatioPct(c, 30),
      brk: breakoutPct(c),
      rat: num(tv?.recommend_all_1m),
      s200: sma200DistPct(tv),
      eps: epsGrowthPct(tv),
      rev: smaReversal(c),                 // SMA-Trendumkehr (Zeilen „Umkehr ↑/↓“, Zeitleiste)
      score: smaTrendScore(c)?.score ?? null,
    };
  });
}

/** Grenzen der fünf %S200-Quintile über die übergebenen Kennzahlen: [min, q20, q40, q60, q80, max] oder null. */
export function quintileEdges(metrics) {
  const v = metrics.map((m) => m.s200).filter((x) => x != null).sort((a, b) => a - b);
  if (v.length < 5) return null;
  const q = (p) => { const i = (v.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
  return [0, 0.2, 0.4, 0.6, 0.8, 1].map(q);
}

/** Quintil 0…4 eines %S200-Werts (Grenzwert gehört zum unteren Quintil). */
export function quintileOf(v, edges) {
  if (v == null || !edges) return null;
  for (let i = 1; i < 5; i++) if (v <= edges[i]) return i - 1;
  return 4;
}

/** Perzentil-Rang 0…1 eines Werts in einer sortierten Liste. */
function rankIn(sorted, v) {
  if (!sorted.length || v == null) return null;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
  let eq = lo; while (eq < sorted.length && sorted[eq] === v) eq++;
  return ((lo + eq) / 2) / sorted.length;
}
const median = (arr) => {
  const v = arr.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export const SPIDER_AXES = [
  { key: 'vol',  label: 'V/Ø30d' },
  { key: 'brk',  label: 'Brk↑%' },
  { key: 'rat',  label: 'Rat1M' },
  { key: 's200', label: '%S200' },
  { key: 'eps',  label: 'EPS↑' },
];

/**
 * Spider-Profil je Setup-Typ: Median der Kennzahl im Typ als Perzentil-Rang (0…1) innerhalb
 * des ganzen Ausschnitts. 0,5 = wie der Durchschnittstitel. Achsen ohne Daten bleiben null.
 * → [{ key, n, values:[rank|null], medians:[wert|null] }]
 */
export function spiderProfiles(metrics) {
  const sorted = Object.fromEntries(SPIDER_AXES.map(({ key }) =>
    [key, metrics.map((m) => m[key]).filter((x) => x != null).sort((a, b) => a - b)]));
  return SETUP_TYPES.map((t) => {
    const sub = metrics.filter((m) => m.setup === t.key);
    const medians = SPIDER_AXES.map(({ key }) => median(sub.map((m) => m[key])));
    return { key: t.key, n: sub.length, medians, values: SPIDER_AXES.map(({ key }, i) => rankIn(sorted[key], medians[i])) };
  });
}

/** Quantil einer unsortierten Liste (für die Achsengrenzen des Scatters). */
export function quantile(values, p) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = (v.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
}
