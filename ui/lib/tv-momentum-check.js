/**
 * Momentum-Check (5-Minuten-Feinprüfung, Schritte 1–3)
 *
 * Zweistufiges Modell:
 *
 *   KERN (hart — jeder verletzte Kern-Check = rot):
 *     · Trend-Rating ↑ (Recommend.All|1M > 0.1)
 *     · PerfW & Perf1M > 0 (Momentum vorhanden)
 *     · ADX > 25 (aktiver Trend)
 *
 *   NEBEN (nur Abzüge — zählen erst in Summe):
 *     Score ≥60 · Stärke ≥60 · Entry ≥30 · Beschleunigung (PerfW > Perf1M/4) ·
 *     Perf3M > 0 · POT ≥ 1.5:1 · Δ1T ≤ +5 % · RSI 45–69 · MACD > Signal ·
 *     Aroon↑ > Aroon↓ · V10d ≥ 0.9×V30d
 *
 * Ampel (bei intaktem Kern): ≤3 Neben-Fails → grün · ≤6 → gelb · sonst rot.
 * K.O.: Earnings im 1M-Fenster deckelt grün auf gelb.
 * Checks ohne Daten werden ausgelassen; unter 2 auswertbaren Kern-Checks
 * oder unter 4 auswertbaren Neben-Checks → null (keine Schein-Ampel).
 *
 * Output: { verdict, passed, total, fails, core_fails, ko, checked_at } | null
 */

import { computeUpsidePotential } from './tv-upside.js';

export function computeMomentumCheck(tv, { overallScore, entryScore } = {}) {
  if (!tv) return null;
  const up = computeUpsidePotential(tv);
  const aroonUp   = tv.aroon_up_1m   ?? tv.aroon_up;
  const aroonDown = tv.aroon_down_1m ?? tv.aroon_down;
  const perf3 = tv.perf_3m ?? tv.perf_6m;

  // [label, pass|fail|null(no data)]
  const core = [
    ['Trend↑',     tv.recommend_all_1m == null ? null : tv.recommend_all_1m > 0.1],
    ['PerfW&1M>0', tv.perf_w == null || tv.perf_1m == null ? null : tv.perf_w > 0 && tv.perf_1m > 0],
    ['ADX>25',     tv.adx == null ? null : tv.adx > 25],
  ];
  const secondary = [
    ['Score≥60',       overallScore == null ? null : overallScore >= 60],
    ['Stärke≥60',      tv.trend_strength_score?.total == null ? null : tv.trend_strength_score.total >= 60],
    ['Entry≥30',       entryScore == null ? null : entryScore >= 30],
    ['Beschleunigung', tv.perf_w == null || tv.perf_1m == null ? null : tv.perf_w > tv.perf_1m / 4],
    ['Perf3M>0',       perf3 == null ? null : perf3 > 0],
    ['POT≥1.5:1',      up?.upside == null || up?.downside == null || up.downside === 0 ? null : up.upside / Math.abs(up.downside) >= 1.5],
    ['Δ1T≤5%',         tv.change_1d == null ? null : tv.change_1d <= 5],
    ['RSI 45–69',      tv.rsi == null ? null : tv.rsi >= 45 && tv.rsi < 70],
    ['MACD>Signal',    tv.macd == null || tv.macd_signal == null ? null : tv.macd > tv.macd_signal],
    ['Aroon↑>↓',       aroonUp == null || aroonDown == null ? null : aroonUp > aroonDown],
    ['Volumen↑',       tv.avg_vol_10d == null || tv.average_volume_30d_calc == null ? null : tv.avg_vol_10d >= 0.9 * tv.average_volume_30d_calc],
  ];

  const coreEval = core.filter(([, r]) => r !== null);
  const secEval  = secondary.filter(([, r]) => r !== null);
  if (coreEval.length < 2 || secEval.length < 4) return null; // zu wenig Daten

  const coreFails = coreEval.filter(([, r]) => r === false).map(([l]) => l);
  const secFails  = secEval.filter(([, r]) => r === false).map(([l]) => l);
  const passed = coreEval.length + secEval.length - coreFails.length - secFails.length;
  const total  = coreEval.length + secEval.length;

  let verdict;
  if (coreFails.length > 0) {
    verdict = 'red';
  } else {
    verdict = secFails.length <= 3 ? 'green' : secFails.length <= 6 ? 'yellow' : 'red';
  }

  let ko = null;
  if (up?.earningsSoon) {
    ko = 'Earnings im 1M-Fenster';
    if (verdict === 'green') verdict = 'yellow';
  }

  return {
    verdict,
    passed,
    total,
    fails: secFails,
    core_fails: coreFails,
    ko,
    checked_at: new Date().toISOString(),
  };
}
