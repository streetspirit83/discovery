/**
 * Entry Price Calculator
 *
 * Spec: docs/tventrypricesspec.md
 *
 * Derives one long entry price and one short entry price by blending three
 * execution methods:
 *
 *   Mean Reversion  — long: BB.lower        | short: BB.upper
 *   Floor Pivots    — long: Pivot.M.Classic.S1 | short: Pivot.M.Classic.R1
 *   Trend Breakout  — long: close + 0.5×ATR | short: close − 0.5×ATR
 *
 * The published prices are the simple average of all available method values
 * (null fields are excluded). If no methods are available the price is null.
 *
 * Input:  object keyed by verbatim TradingView field names
 * Output: { longEntry, shortEntry, breakdown, methodCount }
 */
export function computeEntryPrices(r) {
  const breakdown = {
    meanRevLong:   null,
    meanRevShort:  null,
    pivotLong:     null,
    pivotShort:    null,
    breakoutLong:  null,
    breakoutShort: null,
  };

  // ── Mean Reversion ────────────────────────────────────────────────────────
  if (r['BB.lower'] != null) breakdown.meanRevLong  = r['BB.lower'];
  if (r['BB.upper'] != null) breakdown.meanRevShort = r['BB.upper'];

  // ── Floor Pivots ──────────────────────────────────────────────────────────
  if (r['Pivot.M.Classic.S1'] != null) breakdown.pivotLong  = r['Pivot.M.Classic.S1'];
  if (r['Pivot.M.Classic.R1'] != null) breakdown.pivotShort = r['Pivot.M.Classic.R1'];

  // ── Trend Breakout ────────────────────────────────────────────────────────
  if (r.close != null && r.ATR != null) {
    breakdown.breakoutLong  = r.close + 0.5 * r.ATR;
    breakdown.breakoutShort = r.close - 0.5 * r.ATR;
  }

  // ── Average of available methods ──────────────────────────────────────────
  const longValues  = [breakdown.meanRevLong,  breakdown.pivotLong,  breakdown.breakoutLong ].filter(v => v != null);
  const shortValues = [breakdown.meanRevShort, breakdown.pivotShort, breakdown.breakoutShort].filter(v => v != null);

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  return {
    longEntry:   avg(longValues),
    shortEntry:  avg(shortValues),
    breakdown,
    methodCount: Math.min(longValues.length, shortValues.length),
  };
}
