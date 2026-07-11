/**
 * trend-radar.js — "Welcher Einzelwert trendet GERADE?" (kurzfristig, ≤1M).
 *
 * Trend-Score 0–100 pro Kandidat aus vorhandenen Daten (kein Fetch):
 *   30%  LS-10T-Regressionsrate (lsTrend, 1,5 %/Tag = volle Punktzahl)
 *   20%  Richtungs-Alignment: Δ1T, PerfW, Perf1M positiv (Anteil)
 *   15%  Kurzfrist-SMA-Stack: Kurs>SMA20, SMA20>SMA50, Kurs>SMA50
 *   15%  Beschleunigung: 1W-Monatsrate > 1M-Monatsrate (Trend wird schneller)
 *   10%  Volumen-Bestätigung: ØVol10d > ØVol30d
 *   10%  Frischer Trigger heute: bullishe SMA-Kreuzung oder Kurs kreuzt
 *        die LS-Trendlinie nach oben
 * Fehlende Komponenten werden renormalisiert (ein Titel ohne LS-Historie
 * kann trotzdem über TV-Daten punkten). Bewusst KEINE 3M/6M-Fenster —
 * das Radar soll junge Bewegungen zeigen, nicht etablierte Dauerläufer.
 */

import { lsTrend } from './ls-trend.js?v=20260709b';
import { smaCrosses } from './dashboard-metrics.js?v=20260707a';
import { monthlyGrowthRate } from './tv-upside.js';

export function trendScore(c) {
  const tv = c?.tv_data;
  if (!tv) return null;
  const t = lsTrend(c);

  const sLs = t ? Math.max(0, Math.min(1, t.ratePct / 1.5)) : null;

  const winds = [tv.change_1d, tv.perf_w, tv.perf_1m].filter((v) => v != null);
  const sAlign = winds.length ? winds.filter((v) => v > 0).length / winds.length : null;

  const close = tv.close_1m ?? tv.close;
  const checks = [];
  if (close != null && tv.sma20 != null) checks.push(close > tv.sma20);
  if (tv.sma20 != null && tv.sma50 != null) checks.push(tv.sma20 > tv.sma50);
  if (close != null && tv.sma50 != null) checks.push(close > tv.sma50);
  const sStack = checks.length ? checks.filter(Boolean).length / checks.length : null;

  const rW = monthlyGrowthRate(tv.perf_w, 12 / 52);
  const r1 = monthlyGrowthRate(tv.perf_1m, 1);
  const sAccel = (rW != null && r1 != null) ? (rW > r1 ? (rW > 0 ? 1 : 0.5) : 0) : null;

  const v10 = tv.avg_vol_10d, v30 = tv.average_volume_30d_calc;
  const sVol = (v10 != null && v30 != null) ? (v10 > v30 ? 1 : 0) : null;

  const smaUp = smaCrosses([c]).bullish;
  const lsUp = !!t?.crossedUp;
  const sTrig = (smaUp.length || lsUp) ? 1 : 0;

  const parts = [[sLs, 30], [sAlign, 20], [sStack, 15], [sAccel, 15], [sVol, 10], [sTrig, 10]]
    .filter(([v]) => v != null);
  if (!parts.length) return null;
  const wSum = parts.reduce((s, [, w]) => s + w, 0);
  const score = Math.round((parts.reduce((s, [v, w]) => s + v * w, 0) / wSum) * 100);

  const badges = [];
  if (t && t.ratePct > 0) badges.push(`LS↗${t.ratePct.toFixed(1)}`);
  if (sStack === 1) badges.push('Stack');
  if (sAccel === 1) badges.push('Accel');
  if (sVol === 1) badges.push('Vol');
  if (smaUp.length) badges.push(smaUp[0].label);
  if (lsUp) badges.push('kreuzt LS-Trend↑');

  return { score, badges, fresh: !!(smaUp.length || lsUp), ratePct: t?.ratePct ?? null };
}

/* Karten-Modell: nur steigende Trends (Score ≥ 40), plus "Frisch gedreht"
 * (heutiger Kreuzungs-Trigger), beide absteigend nach Score. */
export function trendRadar(candidates) {
  const rows = (candidates ?? []).map((c) => {
    const s = trendScore(c);
    return s ? { c, symbol: c.symbol, exchange: c.exchange, ...s } : null;
  }).filter(Boolean);
  return {
    rising: rows.filter((r) => r.score >= 40).sort((a, b) => b.score - a.score),
    fresh:  rows.filter((r) => r.fresh).sort((a, b) => b.score - a.score),
  };
}
