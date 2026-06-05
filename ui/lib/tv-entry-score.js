/**
 * Entry Timing Score v2 (0–100 pts)
 *
 * Spec: docs/tvtrendscoringspec.md
 *
 * Grades whether *right now* is a favourable short-term moment to enter a position.
 * Rewards oversold-but-curling-up conditions over chasing extended price.
 * Five indicators:
 *   RSI (14)            (25 pts) — 30–50 bullish reversal sweet spot
 *   MACD                (20 pts) — MACD line > signal line
 *   Stochastic (%K/%D)  (20 pts) — bullish cross emerging from oversold
 *   Price vs EMA20      (20 pts) — entering near the short-term mean
 *   Bollinger Bands     (15 pts) — price at/under lower band (bounce setup)
 *
 * Labels: PRIME ≥80, NEUTRAL ≥40, BAD <40
 *
 * TV percent/oscillator fields are raw numbers. Prices are absolute.
 *
 * Input:  object keyed by verbatim TradingView field names
 * Output: { total, breakdown, label, labelCode, flags }
 */
export function computeEntryScore(r) {
  const breakdown = {};
  const flags     = []; // qualitative warnings, not deducted from score

  // ── RSI (14) — 0–25 pts ──────────────────────────────────────────────────
  // Sweet spot 30–50: oversold pressure releasing, momentum curling up.
  let rsiPts = 0;
  const rsi = r.RSI;
  if (rsi != null) {
    if (rsi >= 30 && rsi <= 50)      rsiPts = 25;  // bullish reversal setup
    else if (rsi > 50 && rsi <= 60)  rsiPts = 15;  // momentum building, slightly late
    else if (rsi >= 25 && rsi < 30)  rsiPts = 12;  // oversold, may keep dropping
    else if (rsi > 60 && rsi <= 70)  rsiPts = 5;   // getting extended
    else if (rsi > 70)               flags.push('RSI_OVERBOUGHT');
    else                             flags.push('RSI_DEEP_OVERSOLD'); // < 25
  }
  breakdown.RSI = rsiPts;

  // ── MACD — 0–20 pts ──────────────────────────────────────────────────────
  // Line above signal = short-term bullish acceleration.
  let macdPts = 0;
  const macd = r['MACD.macd'];
  const sig  = r['MACD.signal'];
  if (macd != null && sig != null) {
    if (macd > sig)                                                macdPts = 20;  // bullish crossover state
    else if ((sig - macd) / Math.max(Math.abs(sig), 1e-6) < 0.05) macdPts = 10;  // converging, near cross
    else                                                          flags.push('MACD_BEARISH');
  }
  breakdown.MACD = macdPts;

  // ── Stochastic (%K vs %D) — 0–20 pts ─────────────────────────────────────
  // Bullish cross emerging out of oversold (<20) is ideal.
  let stochPts = 0;
  const k = r['Stoch.K'];
  const d = r['Stoch.D'];
  if (k != null && d != null) {
    if (k > d && k < 20)       stochPts = 20;  // crossing up from oversold
    else if (k > d && k < 50)  stochPts = 12;  // bullish cross, mid-range
    else if (k > d)            stochPts = 6;   // bullish cross but elevated
    else if (k >= 80)          flags.push('STOCH_OVERBOUGHT');
  }
  breakdown.Stochastic = stochPts;

  // ── Price vs EMA20 — 0–20 pts ────────────────────────────────────────────
  // Entering near the short-term mean avoids chasing extended moves.
  let emaPts = 0;
  const close = r.close;
  const ema20 = r.EMA20;
  if (close != null && ema20 != null && ema20 !== 0) {
    const dist = Math.abs(close - ema20) / ema20;
    if (dist <= 0.02)       emaPts = 20;  // within ±2%
    else if (dist <= 0.05)  emaPts = 10;  // within ±5%
    else if (close > ema20) flags.push('EXTENDED_ABOVE_EMA20');
  }
  breakdown.PriceVsEMA20 = emaPts;

  // ── Bollinger Bands — 0–15 pts ───────────────────────────────────────────
  // Price at/under the lower band = asymmetric bounce setup.
  let bbPts = 0;
  const bbLower = r['BB.lower'];
  if (close != null && bbLower != null && bbLower !== 0) {
    if (close <= bbLower)                         bbPts = 15;  // touch / cross lower band
    else if ((close - bbLower) / bbLower <= 0.02) bbPts = 8;   // just above lower band
  }
  breakdown.BollingerBands = bbPts;

  // ── Total ─────────────────────────────────────────────────────────────────
  const total =
    breakdown.RSI +
    breakdown.MACD +
    breakdown.Stochastic +
    breakdown.PriceVsEMA20 +
    breakdown.BollingerBands;

  let label, labelCode;
  if      (total >= 80) { label = 'Prime Entry';   labelCode = 'PRIME'; }
  else if (total >= 40) { label = 'Neutral Entry'; labelCode = 'NEUTRAL'; }
  else                  { label = 'Bad Entry';     labelCode = 'BAD'; }

  return { total, breakdown, label, labelCode, flags };
}
