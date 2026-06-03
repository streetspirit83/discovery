/**
 * Composite Trend Beginning Score (0–20 pts)
 * Spec: TradingView Composite Trend Score — JS Developer Briefing v1.0
 *
 * Input:  object keyed by verbatim TradingView field names
 * Output: { total, breakdown, label, labelCode, weeklyAlign }
 */
export function computeTrendScore(r) {
  let score = 0;
  const breakdown = {};

  // ── Category A: MA Stack Alignment (0–5 pts) ─────────────────────────────
  let a = 0;
  if (r.close  != null && r.EMA20  != null && r.close  > r.EMA20)  a++;
  if (r.EMA20  != null && r.EMA50  != null && r.EMA20  > r.EMA50)  a++;
  if (r.EMA50  != null && r.EMA200 != null && r.EMA50  > r.EMA200) a++;
  if (r.close  != null && r.EMA200 != null && r.close  > r.EMA200) a++;
  // 5th point: price near but above EMA20 (within 3% = early-stage, not extended)
  if (r.close && r.EMA20 && r.close > r.EMA20 && ((r.close - r.EMA20) / r.EMA20) < 0.03) a++;
  breakdown.A_MAStack = Math.min(a, 5);
  score += breakdown.A_MAStack;

  // ── Category B: Trend Strength — ADX (0–4 pts) ───────────────────────────
  let b = 0;
  const adx = r.ADX;
  if (adx != null) {
    if (adx > 20) b = 1;
    if (adx > 25) b = 2;
    if (adx > 30) b = 3;
  }
  if (r['ADX+DI'] != null && r['ADX-DI'] != null && r['ADX+DI'] > r['ADX-DI']) b++;
  breakdown.B_ADX = Math.min(b, 4);
  score += breakdown.B_ADX;

  // ── Category C: Momentum (0–5 pts) ───────────────────────────────────────
  let c = 0;
  const rsi = r.RSI;
  if (rsi != null) {
    if (rsi > 50)              c++;
    if (rsi >= 50 && rsi <= 65) c++; // sweet spot: not yet overbought
  }
  const macd = r['MACD.macd'];
  const msig = r['MACD.signal'];
  if (macd != null && msig != null && macd > msig) c++; // MACD crossover
  if (macd != null && macd > 0)                    c++; // above zero line
  breakdown.C_Momentum = Math.min(c, 5);
  score += breakdown.C_Momentum;

  // ── Category D: Oscillators (0–3 pts) ────────────────────────────────────
  let d = 0;
  const sk = r['Stoch.K'];
  const sd = r['Stoch.D'];
  if (sk != null && sd != null && sk > sd && sk < 80) d++; // bullish cross, not overbought
  if (sk != null && sk > 50)                          d++; // above midline
  if (r.CCI20 != null && r.CCI20 > 0)                d++;
  breakdown.D_Oscillators = Math.min(d, 3);
  score += breakdown.D_Oscillators;

  // ── Category E: TradingView Rating (0–3 pts) ─────────────────────────────
  let e = 0;
  const recAll = r['Recommend.All'];
  const recMA  = r['Recommend.MA'];
  if (recAll != null && recAll > 0)   e++;
  if (recAll != null && recAll > 0.1) e++; // confirmed Buy (not just barely positive)
  if (recMA  != null && recMA  > 0)   e++;
  breakdown.E_TVRating = Math.min(e, 3);
  score += breakdown.E_TVRating;

  // ── Weekly Cross-Confirmation (informational only – not in score) ─────────
  const weeklyAlign = !!(
    r['EMA20|1W'] && r['EMA50|1W'] && r['EMA200|1W'] &&
    r.close > r['EMA20|1W'] &&
    r['EMA20|1W'] > r['EMA50|1W'] &&
    r['EMA50|1W'] > r['EMA200|1W']
  );

  // ── Label ─────────────────────────────────────────────────────────────────
  const total = Math.min(score, 20);
  let label, labelCode;
  if      (total >= 16) { label = 'Strong Trend Beginning'; labelCode = 'STRONG'; }
  else if (total >= 11) { label = 'Moderate Trend Signal';  labelCode = 'MODERATE'; }
  else if (total >= 6)  { label = 'Neutral / Developing';   labelCode = 'NEUTRAL'; }
  else                  { label = 'No Trend / Downtrend';   labelCode = 'WEAK'; }

  return { total, breakdown, label, labelCode, weeklyAlign };
}
