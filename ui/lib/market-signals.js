/**
 * Signale und Färbungen für das Monitor-Dashboard (reine Logik, kein DOM).
 *
 * `signalColumns` fasst die bisherigen Signal-Karten zu Spalten einer Matrix zusammen
 * (Bullisch · Bärisch · Extreme); jede Spalte kennt ihre Titel samt Anzeigewert. Die
 * Zeilen (Sektoren, Sub-Sektoren, Länder, Titel) liefert lib/market-scope.js.
 *
 * `COLOR_MODES` / `metricFn` färben die Treemap wahlweise nach Performance,
 * Score-Veränderung gegen Vortag, RSI, Abstand zur SMA200 oder Bias.
 */

import {
  scoreMovers, momMovers, pchsMovers, macdFlips, rsiExtremes, smaCrosses, trends,
} from './dashboard-metrics.js?v=20261103h';
import { trendRadar } from './trend-radar.js?v=20261103h';
import { sma200DistPct } from './sma200-extremes.js?v=20261106b';
import { computeBias } from './tv-sentiment.js?v=20260807a';

/* Schwellen der beiden SMA200-Spalten (Abstand des Kurses zur 200-Tage-Linie in %). */
export const S200_HIGH = 30;
export const S200_LOW = -20;

const sgn = (v, dec = 0) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(dec)}`;
const pct = (v, dec = 0) => `${sgn(v, dec)}%`;

export const SIGNAL_GROUPS = [
  { key: 'bull', label: 'Bullisch' },
  { key: 'bear', label: 'Bärisch' },
  { key: 'extreme', label: 'Extreme' },
];

/**
 * @returns {Array<{key, group, label, title, rows:Array<{c, val:string}>}>}
 *   `label` = kurzer Spaltenkopf (Zeilenumbruch mit \n), `title` = ausgeschriebene Bedeutung.
 */
export function signalColumns(cands) {
  const score = scoreMovers(cands), mom = momMovers(cands), pchs = pchsMovers(cands);
  const macd = macdFlips(cands), rsi = rsiExtremes(cands), sma = smaCrosses(cands), tr = trends(cands);
  const radar = trendRadar(cands);
  const s200 = (cands ?? []).map((c) => ({ c, dist: sma200DistPct(c?.tv_data) })).filter((r) => r.dist != null);
  const delta = (rows, key) => rows.map((r) => ({ c: r.c, val: sgn(r[key]) }));
  const cross = (rows) => rows.map((r) => ({ c: r.c, val: r.label + (r.more ? ` +${r.more}` : '') }));
  const trend = (rows) => rows.map((r) => ({ c: r.c, val: r.ogrm != null ? `Ø ${pct(r.ogrm, 1)}/M` : '–' }));
  const col = (key, group, label, title, rows) => ({ key, group, label, title, rows });
  return [
    col('score_up', 'bull', 'Score', 'Score gestiegen · Δ vs. Vortag', delta(score.risers, 'dOverall')),
    col('mom_up', 'bull', 'Mom.', 'Momentum gestiegen · Δ vs. Vortag', delta(mom.risers, 'dMom')),
    col('pchs_up', 'bull', 'PCHS', 'PCHS / Zyklus gestiegen · Δ vs. Vortag', delta(pchs.risers, 'dPchs')),
    col('macd_up', 'bull', 'MACD', 'MACD bullish gedreht', macd.bullish.map((r) => ({ c: r.c, val: 'gedreht' }))),
    col('sma_up', 'bull', 'SMA×', 'SMA-Kreuzung nach oben · vs. Vortag', cross(sma.bullish)),
    col('trend_up', 'bull', 'Trend', 'Trend stark · 1W, 1M und 3M positiv', trend(tr.clean)),
    col('radar', 'bull', 'Radar', 'Trend-Radar · Kurzfrist-Score ≥ 40', radar.rising.map((r) => ({ c: r.c, val: String(r.score) }))),
    col('score_dn', 'bear', 'Score', 'Score gefallen · Δ vs. Vortag', delta(score.fallers, 'dOverall')),
    col('mom_dn', 'bear', 'Mom.', 'Momentum gefallen · Δ vs. Vortag', delta(mom.fallers, 'dMom')),
    col('pchs_dn', 'bear', 'PCHS', 'PCHS / Zyklus gefallen · Δ vs. Vortag', delta(pchs.fallers, 'dPchs')),
    col('macd_dn', 'bear', 'MACD', 'MACD bearish gedreht', macd.bearish.map((r) => ({ c: r.c, val: 'gedreht' }))),
    col('sma_dn', 'bear', 'SMA×', 'SMA-Kreuzung nach unten · vs. Vortag', cross(sma.bearish)),
    col('trend_dn', 'bear', 'Trend', 'Trend schwach · 1W, 1M und 3M negativ', trend(tr.broken)),
    col('rsi_lo', 'extreme', 'RSI\n≤30', 'Überverkauft · RSI ≤ 30', rsi.oversold.map((r) => ({ c: r.c, val: `RSI ${Math.round(r.rsi)}` }))),
    col('rsi_hi', 'extreme', 'RSI\n≥70', 'Überkauft · RSI ≥ 70', rsi.overbought.map((r) => ({ c: r.c, val: `RSI ${Math.round(r.rsi)}` }))),
    col('s200_hi', 'extreme', 'S200\nhoch', `Weit über der SMA200 · ab ${pct(S200_HIGH)} (überdehnt)`,
      s200.filter((r) => r.dist >= S200_HIGH).sort((a, b) => b.dist - a.dist).map((r) => ({ c: r.c, val: pct(r.dist) }))),
    col('s200_lo', 'extreme', 'S200\ntief', `Weit unter der SMA200 · ab ${pct(S200_LOW)} (abgestraft)`,
      s200.filter((r) => r.dist <= S200_LOW).sort((a, b) => a.dist - b.dist).map((r) => ({ c: r.c, val: pct(r.dist) }))),
  ];
}

/* ── Färbung der Treemap ──────────────────────────────────────────────────── */

/* `mid` = neutraler Wert, `cap` = Abstand zu `mid` mit voller Sättigung. Bei `perf`
 * kommt `cap` aus dem gewählten Horizont. */
export const COLOR_MODES = [
  { key: 'perf',   label: 'Perf.',  title: 'Performance im gewählten Horizont', mid: 0,  fmt: (v) => pct(v, 1) },
  { key: 'dscore', label: 'ΔScore', title: 'Score-Veränderung gegen Vortag',    mid: 0,  cap: 8,  fmt: (v) => `Δ ${sgn(v, Number.isInteger(v) ? 0 : 1)}` },
  { key: 'rsi',    label: 'RSI',    title: 'RSI (14) · neutral bei 50',          mid: 50, cap: 25, fmt: (v) => `RSI ${Math.round(v)}` },
  { key: 's200',   label: 'SMA200', title: 'Abstand des Kurses zur SMA200',     mid: 0,  cap: 30, fmt: (v) => pct(v) },
  { key: 'bias',   label: 'Bias',   title: 'Bias −100 … +100',                  mid: 0,  cap: 60, fmt: (v) => `Bias ${sgn(v)}` },
];

/** Kennzahl je Titel für eine Färbung (ohne `perf` – die kommt aus dem Horizont). */
export function metricFn(mode, cands) {
  if (mode === 'rsi') return (c) => c?.tv_data?.rsi ?? null;
  if (mode === 's200') return (c) => sma200DistPct(c?.tv_data);
  if (mode === 'bias') return (c) => computeBias(c?.tv_data)?.score ?? null;
  if (mode === 'dscore') {
    const mv = scoreMovers(cands);
    const map = new Map();
    for (const r of mv.leaders) if (r.dOverall != null) map.set(r.c, r.dOverall);
    return (c) => map.get(c) ?? null;
  }
  return null;
}
