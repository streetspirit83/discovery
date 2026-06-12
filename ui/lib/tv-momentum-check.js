/**
 * Momentum-Check (5-Minuten-Feinprüfung, Schritte 1–3)
 *
 * Codifies the quick momentum screen:
 *   Schritt 1 (Vorfilter):     Score ≥70 · Trend-Rating ↑ · Stärke ≥70 · Entry ≥40
 *   Schritt 2 (Beschleunigung): PerfW & Perf1M > 0 · PerfW > Perf1M/4 ·
 *                               Perf3M > 0 · POT-Verhältnis ≥ 2:1 · Δ1T ≤ +5 %
 *   Schritt 3 (Bestätigung):    ADX > 25 · RSI 45–69 · MACD > Signal ·
 *                               Aroon↑ > Aroon↓ · V10d > V30d
 *
 * Ampel: Anteil bestandener Checks ≥80 % → grün, ≥55 % → gelb, sonst rot.
 * K.O.s: Trend-Rating ↓ → rot · Earnings im 1M-Fenster → max. gelb.
 * Checks ohne Daten werden ausgelassen; unter 6 auswertbaren Checks → null.
 *
 * Output: { verdict:'green'|'yellow'|'red', passed, total, fails, ko, checked_at } | null
 */

import { computeUpsidePotential } from './tv-upside.js';

export function computeMomentumCheck(tv, { overallScore, entryScore } = {}) {
  if (!tv) return null;
  const up = computeUpsidePotential(tv);
  const aroonUp   = tv.aroon_up_1m   ?? tv.aroon_up;
  const aroonDown = tv.aroon_down_1m ?? tv.aroon_down;
  const perf3 = tv.perf_3m ?? tv.perf_6m;

  // [label, pass|fail|null(no data)]
  const checks = [
    ['Score≥70',       overallScore == null ? null : overallScore >= 70],
    ['Trend↑',         tv.recommend_all_1m == null ? null : tv.recommend_all_1m > 0.1],
    ['Stärke≥70',      tv.trend_strength_score?.total == null ? null : tv.trend_strength_score.total >= 70],
    ['Entry≥40',       entryScore == null ? null : entryScore >= 40],
    ['PerfW&1M>0',     tv.perf_w == null || tv.perf_1m == null ? null : tv.perf_w > 0 && tv.perf_1m > 0],
    ['Beschleunigung', tv.perf_w == null || tv.perf_1m == null ? null : tv.perf_w > tv.perf_1m / 4],
    ['Perf3M>0',       perf3 == null ? null : perf3 > 0],
    ['POT≥2:1',        up?.upside == null || up?.downside == null || up.downside === 0 ? null : up.upside / Math.abs(up.downside) >= 2],
    ['Δ1T≤5%',         tv.change_1d == null ? null : tv.change_1d <= 5],
    ['ADX>25',         tv.adx == null ? null : tv.adx > 25],
    ['RSI 45–69',      tv.rsi == null ? null : tv.rsi >= 45 && tv.rsi < 70],
    ['MACD>Signal',    tv.macd == null || tv.macd_signal == null ? null : tv.macd > tv.macd_signal],
    ['Aroon↑>↓',       aroonUp == null || aroonDown == null ? null : aroonUp > aroonDown],
    ['Volumen↑',       tv.avg_vol_10d == null || tv.average_volume_30d_calc == null ? null : tv.avg_vol_10d > tv.average_volume_30d_calc],
  ];

  const evaluated = checks.filter(([, r]) => r !== null);
  if (evaluated.length < 6) return null; // zu wenig Daten für eine Ampel

  const passed = evaluated.filter(([, r]) => r === true).length;
  const fails  = evaluated.filter(([, r]) => r === false).map(([l]) => l);
  const ratio  = passed / evaluated.length;

  let verdict = ratio >= 0.8 ? 'green' : ratio >= 0.55 ? 'yellow' : 'red';
  let ko = null;

  if (tv.recommend_all_1m != null && tv.recommend_all_1m < -0.1) {
    verdict = 'red';
    ko = 'Trend-Rating ↓';
  } else if (up?.earningsSoon && verdict === 'green') {
    verdict = 'yellow';
    ko = 'Earnings im 1M-Fenster';
  } else if (up?.earningsSoon) {
    ko = 'Earnings im 1M-Fenster';
  }

  return {
    verdict,
    passed,
    total: evaluated.length,
    fails,
    ko,
    checked_at: new Date().toISOString(),
  };
}
