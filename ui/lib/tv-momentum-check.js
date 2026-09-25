/**
 * Momentum-Check (Punktemodell, 0–100)
 *
 * Statt harter Alles-oder-nichts-Gates vergibt jedes Kriterium anteilige
 * Punkte — „fast erfüllt" zählt mit, und ein einzelner Ausreißer kippt
 * die Ampel nicht mehr komplett:
 *
 *   ØGr/M (aus Perf.6M)    25 P — linear 0 % … 10 %/Monat
 *   Beschleunigung         15 P — PerfW − Perf1M/4, linear −2 … +4 Punkte
 *   ADX                    20 P — linear 15 … 40
 *   RSI                    15 P — voll bei 50–68, linear auslaufend (±15)
 *   Aroon↑−Aroon↓ (1M)     15 P — linear 0 … +40 Punkte Abstand
 *   Volumen V10d/V30d      10 P — linear 0.8 … 1.3
 *
 * Fehlende Inputs werden ausgelassen und die Summe auf 0–100 renormalisiert
 * (alte tv_data ohne Perf.6M fallen also nicht mehr automatisch durch).
 * Unter 40 von 100 Punkten Datenabdeckung → keine Ampel (null).
 *
 * Ampel: ≥65 grün · ≥40 gelb · sonst rot.
 * Earnings im 1M-Fenster deckelt grün auf gelb.
 *
 * Output: { verdict, total, breakdown, coverage, ko, checked_at } | null
 */

import { computeUpsidePotential, monthlyGrowthRate } from './tv-upside.js';

function scale(v, lo, hi, max) {
  if (v == null) return null;
  const t = (v - lo) / (hi - lo);
  return Math.round(Math.max(0, Math.min(1, t)) * max);
}

// RSI: volle Punkte im Band 50–68, außerhalb linear auslaufend über 15 Punkte
function rsiPoints(rsi, max) {
  if (rsi == null) return null;
  const d = rsi < 50 ? 50 - rsi : rsi > 68 ? rsi - 68 : 0;
  return Math.round(Math.max(0, 1 - d / 15) * max);
}

export function computeMomentumCheck(tv) {
  if (!tv) return null;

  const growthM   = monthlyGrowthRate(tv.perf_6m, 6);
  const accel     = tv.perf_w != null && tv.perf_1m != null ? tv.perf_w - tv.perf_1m / 4 : null;
  const aroonUp   = tv.aroon_up_1m   ?? tv.aroon_up;
  const aroonDown = tv.aroon_down_1m ?? tv.aroon_down;
  const aroonGap  = aroonUp != null && aroonDown != null ? aroonUp - aroonDown : null;
  const volRatio  = tv.avg_vol_10d != null && tv.average_volume_30d_calc > 0
    ? tv.avg_vol_10d / tv.average_volume_30d_calc : null;

  const parts = [
    ['ØGr/M',     scale(growthM, 0, 10, 25),    25],
    ['Beschl.',   scale(accel, -2, 4, 15),      15],
    ['ADX',       scale(tv.adx, 15, 40, 20),    20],
    ['RSI',       rsiPoints(tv.rsi, 15),        15],
    ['Aroon',     scale(aroonGap, 0, 40, 15),   15],
    ['Volumen',   scale(volRatio, 0.8, 1.3, 10), 10],
  ];

  const breakdown = {};
  let earned = 0;
  let coverage = 0;
  for (const [label, pts, max] of parts) {
    if (pts == null) continue;
    breakdown[label] = `${pts}/${max}`;
    earned   += pts;
    coverage += max;
  }
  if (coverage < 40) return null; // zu wenig Daten für eine Ampel

  const total = Math.round((earned / coverage) * 100);
  let verdict = total >= 65 ? 'green' : total >= 40 ? 'yellow' : 'red';

  let ko = null;
  const up = computeUpsidePotential(tv);
  if (up?.earningsSoon) {
    ko = 'Earnings im 1M-Fenster';
    if (verdict === 'green') verdict = 'yellow';
  }

  return {
    verdict,
    total,
    breakdown,
    coverage,
    ko,
    checked_at: new Date().toISOString(),
  };
}
