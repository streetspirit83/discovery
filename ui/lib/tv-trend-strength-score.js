/**
 * Trend Strength Score v1 (0–100 pts)
 *
 * Spec: docs/tvtrendstrengthscoringspec.md
 *
 * Measures whether a confirmed macro uptrend is intact and well-supported.
 * Six independent indicators:
 *   ADX (14)                   (25 pts) — trend power, regardless of direction
 *   Aroon Up / Down Alignment  (20 pts) — structural high cadence vs. structural lows
 *   SMA Long-Term Alignment    (20 pts) — Golden Cross state (SMA50 > SMA200)
 *   Price vs SMA50             (15 pts) — trading above primary intermediate floor
 *   EMA Short-Term Alignment   (10 pts) — EMA10 > EMA20 micro-momentum
 *   Volume Confirmation        (10 pts) — current volume > 10-day average
 *
 * Labels: POWER ≥85, MODERATE ≥55, WEAK <55
 *
 * Input:  object keyed by verbatim TradingView field names + 'volume' + 'average_volume_10d_calc'
 * Output: { total, breakdown, label, labelCode, flags }
 */
export function computeTrendStrengthScore(r) {
  const breakdown = {};
  const flags     = [];

  // ── ADX (14) — 0–25 pts ──────────────────────────────────────────────────
  // ADX measures trend magnitude regardless of direction.
  // Graduated: strong trend = 25, emerging trend = 12, flat/choppy = 0.
  let adxPts = 0;
  const adx = r.ADX;
  if (adx != null) {
    if (adx > 25)      adxPts = 25;
    else if (adx > 20) adxPts = 12;
    else               flags.push('WEAK_ADX');
  }
  breakdown.ADX = adxPts;

  // ── Aroon Up / Down Alignment — 0–20 pts ─────────────────────────────────
  // Full 20: Aroon.Up 70–100 AND Aroon.Down 0–30 → strong bullish structure.
  // Partial 10: Aroon.Up > Aroon.Down but Up < 70 → emerging or winding up.
  // 0: Aroon.Down ≥ Aroon.Up or both < 50 → bearish / choppy.
  let aroonPts = 0;
  const aroonUp   = r['Aroon.Up'];
  const aroonDown = r['Aroon.Down'];
  if (aroonUp != null && aroonDown != null) {
    if (aroonUp >= 70 && aroonDown <= 30)         aroonPts = 20;
    else if (aroonUp > aroonDown && aroonUp >= 50) aroonPts = 10;
    else                                           flags.push('AROON_BEARISH');
  }
  breakdown.Aroon = aroonPts;

  // ── SMA Long-Term Alignment — 0–20 pts ───────────────────────────────────
  // Golden Cross state (SMA50 > SMA200) = institutional buyers supporting.
  let smaPts = 0;
  const sma50  = r.SMA50;
  const sma200 = r.SMA200;
  if (sma50 != null && sma200 != null) {
    if (sma50 > sma200) smaPts = 20;
    else                flags.push('DEATH_CROSS');
  }
  breakdown.SMA_Alignment = smaPts;

  // ── Price vs SMA50 — 0–15 pts ────────────────────────────────────────────
  // Price above the intermediate psychological floor.
  let priceSma50Pts = 0;
  const close = r.close;
  if (close != null && sma50 != null) {
    if (close > sma50) priceSma50Pts = 15;
    else               flags.push('BELOW_SMA50');
  }
  breakdown.Price_vs_SMA50 = priceSma50Pts;

  // ── EMA Short-Term Alignment — 0–10 pts ──────────────────────────────────
  // EMA10 > EMA20 = immediate micro-momentum positive.
  let emaPts = 0;
  const ema10 = r.EMA10;
  const ema20 = r.EMA20;
  if (ema10 != null && ema20 != null) {
    if (ema10 > ema20) emaPts = 10;
  }
  breakdown.EMA_ShortTerm = emaPts;

  // ── Volume Confirmation — 0–10 pts ───────────────────────────────────────
  // Current volume above 10-day average = directional move is backed by activity.
  let volPts = 0;
  const vol    = r.volume;
  const avgVol = r.average_volume_10d_calc;
  if (vol != null && avgVol != null && avgVol > 0) {
    if (vol > avgVol) volPts = 10;
    else              flags.push('LOW_VOLUME');
  }
  breakdown.Volume = volPts;

  // ── Total ─────────────────────────────────────────────────────────────────
  const total =
    breakdown.ADX +
    breakdown.Aroon +
    breakdown.SMA_Alignment +
    breakdown.Price_vs_SMA50 +
    breakdown.EMA_ShortTerm +
    breakdown.Volume;

  let label, labelCode;
  if      (total >= 85) { label = 'Structural Power-Trend';   labelCode = 'POWER'; }
  else if (total >= 55) { label = 'Moderate Trend';           labelCode = 'MODERATE'; }
  else                  { label = 'Non-Trending / Weak';      labelCode = 'WEAK'; }

  return { total, breakdown, label, labelCode, flags };
}
