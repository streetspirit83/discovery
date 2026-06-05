/**
 * Financial Health Score v2 (0–100 pts)
 *
 * Spec: docs/tvfinancialhealthscoringspec.md
 *
 * A growth-and-solvency oriented model on a 0–100 scale. Four categories:
 *   A. Size & Scale        (15 pts) — market_cap_basic, ebitda
 *   B. YoY Core Growth     (35 pts) — total_revenue_yoy_growth_ttm, ebitda_yoy_growth_ttm
 *   C. Cash & Efficiency   (25 pts) — free_cash_flow_yoy_growth_ttm, operating_margin
 *   D. Leverage & Risk     (25 pts) — debt_to_equity, total_debt_to_ebitda_fy
 *
 * Target grade: 75+ for "safe allocation".
 *
 * TV percent fields are raw numbers (15.3 = 15.3%, not 0.153).
 * TV ratio fields (debt_to_equity, total_debt_to_ebitda_fy) are plain decimals.
 *
 * Input:  object keyed by verbatim TradingView field names
 * Output: { total, breakdown, label, labelCode, flags }
 */
export function computeHealthScore(r) {
  const breakdown = {};
  const flags     = []; // qualitative warnings, not deducted from score

  // ── Category A: Size & Scale (0–15 pts) ──────────────────────────────────
  let a = 0;
  const mcap = r.market_cap_basic;
  if (mcap != null) {
    if (mcap >= 10e9)       a += 8;  // large / mega
    else if (mcap >= 2e9)   a += 6;  // mid
    else if (mcap >= 300e6) a += 4;  // small
    else if (mcap >= 50e6)  a += 2;  // micro
    else                    flags.push('NANO_CAP');
  }
  const ebitda = r.ebitda;
  if (ebitda != null) {
    if (ebitda > 1e9)        a += 7;
    else if (ebitda > 100e6) a += 5;
    else if (ebitda > 0)     a += 3;
    else                     flags.push('NEGATIVE_EBITDA');
  }
  breakdown.A_Size = Math.min(a, 15);

  // ── Category B: YoY Core Growth (0–35 pts) ───────────────────────────────
  let b = 0;
  const revGrowth = r.total_revenue_yoy_growth_ttm;
  if (revGrowth != null) {
    if (revGrowth > 25)      b += 17;
    else if (revGrowth > 15) b += 13;
    else if (revGrowth > 10) b += 9;
    else if (revGrowth > 0)  b += 4;
    else                     flags.push('REVENUE_SHRINKING');
  }
  const ebitdaGrowth = r.ebitda_yoy_growth_ttm;
  if (ebitdaGrowth != null) {
    if (ebitdaGrowth > 25)      b += 18;  // operational leverage
    else if (ebitdaGrowth > 15) b += 14;
    else if (ebitdaGrowth > 10) b += 10;
    else if (ebitdaGrowth > 0)  b += 5;
    else                        flags.push('EBITDA_DECLINING');
  }
  breakdown.B_Growth = Math.min(b, 35);

  // ── Category C: Cash & Efficiency (0–25 pts) ─────────────────────────────
  let c = 0;
  const opMargin = r.operating_margin;
  if (opMargin != null) {
    if (opMargin > 25)      c += 13;
    else if (opMargin > 15) c += 10;
    else if (opMargin > 8)  c += 6;
    else if (opMargin > 0)  c += 3;
    else                    flags.push('NEGATIVE_OP_MARGIN');
  }
  const fcfGrowth = r.free_cash_flow_yoy_growth_ttm;
  if (fcfGrowth != null) {
    if (fcfGrowth > 20)      c += 12;
    else if (fcfGrowth > 10) c += 9;
    else if (fcfGrowth > 0)  c += 5;
    else                     flags.push('FCF_DECLINING');
  }
  breakdown.C_Cash = Math.min(c, 25);

  // ── Category D: Leverage & Risk (0–25 pts) ───────────────────────────────
  let d = 0;
  const de = r.debt_to_equity;
  if (de != null) {
    if (de < 0.5)      d += 13;
    else if (de < 1.0) d += 10;
    else if (de < 2.0) d += 5;
    else               flags.push('HIGH_LEVERAGE');
  }
  const debtEbitda = r.total_debt_to_ebitda_fy;
  if (debtEbitda != null) {
    if (debtEbitda < 0)        flags.push('NEGATIVE_DEBT_EBITDA'); // negative EBITDA distortion
    else if (debtEbitda < 1.0) d += 12;
    else if (debtEbitda < 2.0) d += 9;
    else if (debtEbitda < 4.0) d += 4;
    else                       flags.push('HIGH_DEBT_EBITDA');
  }
  breakdown.D_Leverage = Math.min(d, 25);

  // ── Total ─────────────────────────────────────────────────────────────────
  const total =
    breakdown.A_Size +
    breakdown.B_Growth +
    breakdown.C_Cash +
    breakdown.D_Leverage;

  let label, labelCode;
  if      (total >= 75) { label = 'Safe Allocation'; labelCode = 'STRONG'; }
  else if (total >= 55) { label = 'Solide';          labelCode = 'SOUND'; }
  else if (total >= 35) { label = 'Gemischt';        labelCode = 'MIXED'; }
  else                  { label = 'Fragil';          labelCode = 'WEAK'; }

  return { total, breakdown, label, labelCode, flags };
}
