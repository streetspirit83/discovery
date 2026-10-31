/**
 * Overall Score (0–100 pts)
 *
 * Composite ranking over all standard-view metrics, weighted toward
 * recent performance and growth:
 *
 *   Perf.W (week)            15 pts — linear −8% … +8%
 *   Perf.1M (month)          15 pts — linear −15% … +15%
 *   Δ1T (change today)        5 pts — linear −3% … +3%
 *   EBITDA growth YoY        15 pts — linear −20% … +40% (FY, Fallback TTM)
 *   Trend rating 1M          10 pts — TV Recommend.All|1M (−1 … +1)
 *   Trend Strength Score     12 pts — sub-score /100
 *   Entry Timing Score       10 pts — sub-score /100
 *   Health Score             10 pts — sub-score /100
 *   Cycle Score (PCHS)        8 pts — sub-score /100
 *
 * Missing inputs are excluded and the total is renormalized to 0–100 so
 * candidates with partial data stay comparable. Returns null when less
 * than 40 of the 100 weight points have data.
 *
 * Labels: STRONG ≥70, GOOD ≥55, MIXED ≥40, WEAK <40
 *
 * Input:  { perfW, perf1M, change1D, ebitdaGrowth, rating1M,
 *           trendStrength, entry, health, cycle }  (sub-scores as 0–100 totals)
 * Output: { total, breakdown, label, labelCode, coverage } | null
 */

// Linear scale: value at `lo` → 0 pts, at `hi` → max pts, clamped.
function scaleLinear(v, lo, hi, max) {
  if (v == null) return null;
  const t = (v - lo) / (hi - lo);
  return Math.round(Math.max(0, Math.min(1, t)) * max);
}

export function computeOverallScore(r) {
  const parts = [
    ['PerfW',    scaleLinear(r.perfW,         -8,  8,  15), 15],
    ['Perf1M',   scaleLinear(r.perf1M,       -15, 15,  15), 15],
    ['Chg1T',    scaleLinear(r.change1D,      -3,  3,   5),  5],
    ['EBITDA',   scaleLinear(r.ebitdaGrowth, -20, 40,  15), 15],
    ['Trend',    scaleLinear(r.rating1M,      -1,  1,  10), 10],
    ['Staerke',  scaleLinear(r.trendStrength,  0, 100, 12), 12],
    ['Entry',    scaleLinear(r.entry,          0, 100, 10), 10],
    ['Health',   scaleLinear(r.health,         0, 100, 10), 10],
    ['PCHS',     scaleLinear(r.cycle,          0, 100,  8),  8],
  ];

  const breakdown = {};
  let earned = 0;
  let availableMax = 0;
  for (const [key, pts, max] of parts) {
    if (pts == null) continue;
    breakdown[key] = pts;
    earned       += pts;
    availableMax += max;
  }

  if (availableMax < 40) return null; // too little data for a meaningful score

  const total = Math.round((earned / availableMax) * 100);

  let label, labelCode;
  if      (total >= 70) { label = 'Strong';   labelCode = 'STRONG'; }
  else if (total >= 55) { label = 'Good';     labelCode = 'GOOD'; }
  else if (total >= 40) { label = 'Mixed';    labelCode = 'MIXED'; }
  else                  { label = 'Weak';     labelCode = 'WEAK'; }

  return { total, breakdown, label, labelCode, coverage: availableMax };
}
