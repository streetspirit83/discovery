/**
 * 1M Upside / Downside Potential v2 (in %)
 *
 * Directional range estimate for the next ~21 trading days from three parts:
 *
 *   1. Drift μ — damped average monthly growth rate, blended from
 *      Perf.1M (50%), Perf.3M (30%) and Perf.6M (20%), each geometrically
 *      broken down to one month, then halved (momentum mean-reverts).
 *   2. Volatility σ — daily volatility × √21. Daily vol from ATRP,
 *      fallback ATR/price, fallback Volatility.M (smoother monthly avg
 *      of daily vol), fallback Volatility.D.
 *   3. Structural caps — nearest resistance above (Pivot R1/R2, BB.upper,
 *      Donchian 1M, High 1M/3M/6M, 52W-High) resp. nearest support below
 *      (mirrored fields).
 *
 *   upside   = min(structural distance up,   max(0, μ + σ))
 *   downside = −min(structural distance down, max(0, σ − μ))
 *   Missing structure (blue sky / no support) → statistical band alone.
 *
 * Drift shifts the band asymmetrically: an uptrend enlarges the upside
 * and shrinks the downside. Still a range estimate, not a forecast.
 * `earningsSoon` flags an earnings date inside the window.
 *
 * Output: { upside, downside, upTarget, downTarget, sigma, drift, earningsSoon } | null
 */

const TRADING_DAYS = 21;
const SQRT_DAYS = Math.sqrt(TRADING_DAYS);
const DRIFT_DAMPING = 0.5;

function nearestAbove(price, levels) {
  const above = levels.filter((l) => l != null && l > price);
  return above.length ? Math.min(...above) : null;
}

function nearestBelow(price, levels) {
  const below = levels.filter((l) => l != null && l < price && l > 0);
  return below.length ? Math.max(...below) : null;
}

/** Geometric average monthly growth rate (%) from a performance over n months. */
export function monthlyGrowthRate(perfPct, months) {
  if (perfPct == null || perfPct <= -100) return null;
  return (Math.pow(1 + perfPct / 100, 1 / months) - 1) * 100;
}

// Weighted blend of the available monthly rates, renormalized.
function blendedDrift(tv) {
  const parts = [
    [monthlyGrowthRate(tv.perf_1m, 1), 0.5],
    [monthlyGrowthRate(tv.perf_3m, 3), 0.3],
    [monthlyGrowthRate(tv.perf_6m, 6), 0.2],
  ].filter(([v]) => v != null);
  if (!parts.length) return null;
  const wSum = parts.reduce((s, [, w]) => s + w, 0);
  return parts.reduce((s, [v, w]) => s + v * w, 0) / wSum;
}

function dailyVolPct(tv, price) {
  if (tv.atrp != null && tv.atrp > 0) return tv.atrp;
  if (tv.atr != null && tv.atr > 0 && price > 0) return (tv.atr / price) * 100;
  if (tv.volatility_m != null && tv.volatility_m > 0) return tv.volatility_m;
  if (tv.volatility != null && tv.volatility > 0) return tv.volatility;
  return null;
}

export function computeUpsidePotential(tv) {
  if (!tv) return null;
  const price = tv.close_1m ?? tv.close;
  if (price == null || price <= 0) return null;

  const dVol  = dailyVolPct(tv, price);
  const sigma = dVol != null ? dVol * SQRT_DAYS : null;
  const rawDrift = blendedDrift(tv);
  const drift = rawDrift != null ? rawDrift * DRIFT_DAMPING : 0;

  // Statistical band, shifted by drift
  const statUp   = sigma != null ? Math.max(0, drift + sigma) : null;
  const statDown = sigma != null ? Math.max(0, sigma - drift) : null;

  const upTarget = nearestAbove(price, [
    tv.pivot_r1, tv.pivot_r2, tv.bb_upper, tv.donch_ch20_upper_1m,
    tv.high_1m, tv.high_3m, tv.high_6m, tv.price_52_week_high,
  ]);
  const downTarget = nearestBelow(price, [
    tv.pivot_s1, tv.pivot_s2, tv.bb_lower, tv.donch_ch20_lower_1m,
    tv.low_1m, tv.low_3m, tv.low_6m, tv.price_52_week_low,
  ]);

  const structUp   = upTarget   != null ? ((upTarget - price) / price) * 100   : null;
  const structDown = downTarget != null ? ((price - downTarget) / price) * 100 : null;

  // Each side: statistical estimate capped by the nearest structural level;
  // missing structure (blue sky / no support) → statistical band alone.
  const cap = (struct, stat) => {
    if (struct != null && stat != null) return Math.min(struct, stat);
    return struct ?? stat; // whichever exists, else null
  };
  const upside      = cap(structUp, statUp);
  const downsideMag = cap(structDown, statDown);

  if (upside == null && downsideMag == null) return null;

  // Earnings inside the next ~1 month window?
  let earningsSoon = false;
  if (tv.earnings_next_date) {
    const ts = typeof tv.earnings_next_date === 'number'
      ? tv.earnings_next_date * 1000
      : new Date(tv.earnings_next_date).getTime();
    const days = (ts - Date.now()) / 86400000;
    earningsSoon = days >= 0 && days <= 31;
  }

  return {
    upside,
    downside: downsideMag != null ? -downsideMag : null,
    upTarget,
    downTarget,
    sigma,
    drift,
    earningsSoon,
  };
}
