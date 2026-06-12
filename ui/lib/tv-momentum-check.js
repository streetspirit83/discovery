/**
 * Momentum-Check Ampel (Nutzer-Definition)
 *
 * GRÜN — alle Kriterien erfüllt:
 *   · ØGr/M > 10 %        (geometrische Monatsrate aus Perf.6M)
 *   · Score > 80           (Overall Score)
 *   · PerfW > Perf1M / 4   (Beschleunigung)
 *   · Δ1T ≤ +5 %
 *   · ADX > 25             (aktiver Trend)
 *   · RSI 50–68
 *   · Aroon↑1M deutlich > Aroon↓1M (Abstand > 30 Punkte – frische Hochs)
 *   · V10d > V30d
 *
 * GELB — alle Kriterien erfüllt:
 *   · ØGr/M > 10 % · Score > 80 · PerfW > Perf1M/4 · Δ1T ≤ +2 % ·
 *   · ADX > 25 · Aroon↑1M > Aroon↓1M
 *
 * Sonst ROT. Earnings im 1M-Fenster deckelt grün weiterhin auf gelb.
 * Fehlende Werte gelten als nicht erfüllt; fehlen die Basisdaten
 * (Perf.6M/Score/ADX), gibt es keine Ampel (null).
 *
 * Output: { verdict, green_fails, yellow_fails, ko, checked_at } | null
 */

import { computeUpsidePotential, monthlyGrowthRate } from './tv-upside.js';

export function computeMomentumCheck(tv, { overallScore } = {}) {
  if (!tv) return null;
  const growthM = monthlyGrowthRate(tv.perf_6m, 6);
  if (growthM == null && overallScore == null && tv.adx == null) return null;

  const aroonUp   = tv.aroon_up_1m   ?? tv.aroon_up;
  const aroonDown = tv.aroon_down_1m ?? tv.aroon_down;
  const accel = tv.perf_w != null && tv.perf_1m != null && tv.perf_w > tv.perf_1m / 4;

  // [label, erfüllt] — fehlende Daten gelten als nicht erfüllt
  const greenChecks = [
    ['ØGr/M>10%',   growthM != null && growthM > 10],
    ['Score>80',    overallScore != null && overallScore > 80],
    ['PerfW>1M/4',  accel],
    ['Δ1T≤5%',      tv.change_1d != null && tv.change_1d <= 5],
    ['ADX>25',      tv.adx != null && tv.adx > 25],
    ['RSI 50–68',   tv.rsi != null && tv.rsi >= 50 && tv.rsi <= 68],
    ['Ar↑≫Ar↓',     aroonUp != null && aroonDown != null && aroonUp > aroonDown + 30],
    ['V10d>V30d',   tv.avg_vol_10d != null && tv.average_volume_30d_calc != null && tv.avg_vol_10d > tv.average_volume_30d_calc],
  ];
  const yellowChecks = [
    ['ØGr/M>10%',   growthM != null && growthM > 10],
    ['Score>80',    overallScore != null && overallScore > 80],
    ['PerfW>1M/4',  accel],
    ['Δ1T≤2%',      tv.change_1d != null && tv.change_1d <= 2],
    ['ADX>25',      tv.adx != null && tv.adx > 25],
    ['Ar↑>Ar↓',     aroonUp != null && aroonDown != null && aroonUp > aroonDown],
  ];

  const greenFails  = greenChecks.filter(([, ok]) => !ok).map(([l]) => l);
  const yellowFails = yellowChecks.filter(([, ok]) => !ok).map(([l]) => l);

  let verdict = greenFails.length === 0 ? 'green'
              : yellowFails.length === 0 ? 'yellow'
              : 'red';

  let ko = null;
  const up = computeUpsidePotential(tv);
  if (up?.earningsSoon) {
    ko = 'Earnings im 1M-Fenster';
    if (verdict === 'green') verdict = 'yellow';
  }

  return {
    verdict,
    green_fails: greenFails,
    yellow_fails: yellowFails,
    ko,
    checked_at: new Date().toISOString(),
  };
}
