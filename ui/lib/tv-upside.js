/**
 * 1M Upside / Downside Potential (in %)
 *
 * Estimates how much room price has over the next ~21 trading days,
 * combining two caps:
 *
 *   1. Volatility budget — ATR × √21 (fallback: Volatility.D × √21),
 *      the statistically plausible 1-month move.
 *   2. Structural target — nearest resistance above (Pivot R1, BB.upper,
 *      Donchian 1M upper, High.1M, High.6M, 52W-High) resp. nearest
 *      support below (mirrored fields).
 *
 *   upside  = min(structural distance, volatility budget)
 *   blue-sky (no level above) → volatility budget alone.
 *   downside symmetric, returned as negative %.
 *
 * This is a range estimate, not a forecast. `earningsSoon` flags an
 * earnings date inside the window, which can blow past the ATR budget.
 *
 * Output: { upside, downside, upTarget, downTarget, volBudget, earningsSoon } | null
 */

const TRADING_DAYS = 21;
const SQRT_DAYS = Math.sqrt(TRADING_DAYS);

function nearestAbove(price, levels) {
  const above = levels.filter((l) => l != null && l > price);
  return above.length ? Math.min(...above) : null;
}

function nearestBelow(price, levels) {
  const below = levels.filter((l) => l != null && l < price && l > 0);
  return below.length ? Math.max(...below) : null;
}

export function computeUpsidePotential(tv) {
  if (!tv) return null;
  const price = tv.close_1m ?? tv.close;
  if (price == null || price <= 0) return null;

  // Volatility budget in % for ~1 month
  let volBudget = null;
  if (tv.atr != null && tv.atr > 0)             volBudget = (tv.atr * SQRT_DAYS / price) * 100;
  else if (tv.volatility != null && tv.volatility > 0) volBudget = tv.volatility * SQRT_DAYS;

  const upTarget = nearestAbove(price, [
    tv.pivot_r1, tv.bb_upper, tv.donch_ch20_upper_1m,
    tv.high_1m, tv.high_6m, tv.price_52_week_high,
  ]);
  const downTarget = nearestBelow(price, [
    tv.pivot_s1, tv.bb_lower, tv.donch_ch20_lower_1m,
    tv.low_1m, tv.low_6m, tv.price_52_week_low,
  ]);

  const structUp   = upTarget   != null ? ((upTarget - price) / price) * 100   : null;
  const structDown = downTarget != null ? ((price - downTarget) / price) * 100 : null;

  // Each side: structural distance capped by the volatility budget;
  // missing structure (blue sky / no support) → budget alone.
  const cap = (struct) => {
    if (struct != null && volBudget != null) return Math.min(struct, volBudget);
    return struct ?? volBudget; // whichever exists, else null
  };
  const upside   = cap(structUp);
  const downsideMag = cap(structDown);

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
    volBudget,
    earningsSoon,
  };
}
