/**
 * Financial Health Score (0–20 pts)
 * Spec: TradingView Financial Health Score — JS Developer Briefing v1.0
 *
 * Input:  object keyed by verbatim TradingView field names
 * Output: { total, breakdown, label, labelCode, flags }
 *
 * TV percent fields are raw numbers (15.3 = 15.3%, not 0.153).
 * TV ratio fields (current_ratio, debt_to_equity) are plain decimals.
 */
export function computeHealthScore(r) {
  const breakdown = {};
  const flags     = []; // qualitative warnings, not deducted from score

  const ttmOrFy = (ttm, fy) => (ttm != null ? ttm : (fy ?? null));

  // ── Category A: Profitability (0–5 pts) ──────────────────────────────────
  let a = 0;
  const roe = r.return_on_equity;
  if (roe != null) {
    const roeCapped = Math.min(roe, 100); // cap distorted near-zero-equity values
    if (roeCapped > 15)     a += 2;
    else if (roeCapped > 8) a += 1;
    else if (roeCapped < 0) flags.push('NEGATIVE_ROE');
  }
  const netMargin = r.after_tax_margin;
  if (netMargin != null) {
    if (netMargin > 15) a += 1;
    if (netMargin < 0)  flags.push('NEGATIVE_NET_MARGIN');
  }
  const roic = r.return_on_invested_capital;
  if (roic != null) {
    if (roic > 12)     a += 1;
    else if (roic < 0) flags.push('NEGATIVE_ROIC');
  }
  const opMargin = r.operating_margin;
  if (opMargin != null && opMargin > 15) a += 1;
  breakdown.A_Profitability = Math.min(a, 5);

  // ── Category B: Liquidity & Solvency (0–5 pts) ───────────────────────────
  let b = 0;
  const cr = r.current_ratio;
  if (cr != null) {
    if (cr >= 2.0)      b += 2;
    else if (cr >= 1.5) b += 1;
    else if (cr < 1.0)  flags.push('LOW_CURRENT_RATIO');
  }
  const qr = r.quick_ratio;
  if (qr != null) {
    if (qr >= 1.0) b += 1;
    else flags.push('QUICK_RATIO_BELOW_1');
  }
  const de = r.debt_to_equity;
  if (de != null) {
    if (de < 0.5)      b += 2;
    else if (de < 1.5) b += 1;
    else if (de > 3.0) flags.push('HIGH_LEVERAGE');
  }
  breakdown.B_LiquiditySolvency = Math.min(b, 5);

  // ── Category C: Growth Quality (0–4 pts) ─────────────────────────────────
  let c = 0;
  const revGrowth = ttmOrFy(r.total_revenue_yoy_growth_ttm, r.total_revenue_yoy_growth_fy);
  if (revGrowth != null) {
    if (revGrowth > 20)     c += 2;
    else if (revGrowth > 8) c += 1;
    else if (revGrowth < 0) flags.push('REVENUE_SHRINKING');
  }
  const epsGrowth = ttmOrFy(
    r.earnings_per_share_diluted_yoy_growth_ttm,
    r.earnings_per_share_diluted_yoy_growth_fy,
  );
  if (epsGrowth != null) {
    if (epsGrowth > 20)       c += 2;
    else if (epsGrowth > 8)   c += 1;
    else if (epsGrowth < -10) flags.push('EPS_DECLINING');
  }
  breakdown.C_Growth = Math.min(c, 4);

  // ── Category D: Cash Flow Strength (0–3 pts) ─────────────────────────────
  let d = 0;
  const fcfMargin = ttmOrFy(r.free_cash_flow_margin_ttm, r.free_cash_flow_margin_fy);
  if (fcfMargin != null) {
    if (fcfMargin > 20)     d += 2;
    else if (fcfMargin > 8) d += 1;
    else if (fcfMargin < 0) flags.push('NEGATIVE_FCF');
  }
  const fcfGrowth = ttmOrFy(r.free_cash_flow_yoy_growth_ttm, r.free_cash_flow_yoy_growth_fy);
  if (fcfGrowth != null && fcfGrowth > 0) d += 1;
  breakdown.D_CashFlow = Math.min(d, 3);

  // ── Category E: Earnings Quality (0–3 pts) ───────────────────────────────
  let e = 0;
  const eps = r.earnings_per_share_basic_ttm;
  if (eps != null) {
    if (eps > 0) e += 1;
    else flags.push('NEGATIVE_EPS');
  }
  const evEbitda = r.enterprise_value_ebitda_ttm;
  if (evEbitda != null) {
    if (evEbitda > 0 && evEbitda <= 25) e += 1;
    else if (evEbitda > 25)             flags.push('HIGH_EV_EBITDA');
    else if (evEbitda < 0)              flags.push('NEGATIVE_EBITDA');
  }
  const pFcf = r.price_free_cash_flow_ttm;
  if (pFcf != null && pFcf > 0 && pFcf <= 30) e += 1;
  breakdown.E_EarningsQuality = Math.min(e, 3);

  // ── Total ─────────────────────────────────────────────────────────────────
  const total =
    breakdown.A_Profitability +
    breakdown.B_LiquiditySolvency +
    breakdown.C_Growth +
    breakdown.D_CashFlow +
    breakdown.E_EarningsQuality;

  let label, labelCode;
  if      (total >= 16) { label = 'Financially Strong'; labelCode = 'STRONG'; }
  else if (total >= 11) { label = 'Financially Sound';  labelCode = 'SOUND'; }
  else if (total >= 6)  { label = 'Mixed Health';       labelCode = 'MIXED'; }
  else                  { label = 'Financial Weakness'; labelCode = 'WEAK'; }

  return { total, breakdown, label, labelCode, flags };
}
