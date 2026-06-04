# TradingView Financial Health Score — JS Developer Briefing

**Version:** 1.0  
**Last updated:** 2026-06-03  
**Companion to:** `tv-trend-scoring-spec.md`  
**Scope:** Field definitions, scoring algorithm, JS implementation — no API/backend sections.

---

## 1. Overview

This document specifies a **Financial Health Score** (0–20 pts) built from TradingView fundamental screener fields. The score evaluates the intrinsic financial quality of a ticker across five independent categories, independent of price action or trend state.

Intended use: run in parallel with the Composite Trend Score. A strong signal requires **both** scores to be elevated — a trending ticker with poor financial health is a significantly higher-risk position.

---

## 2. Scoring Categories

| Category | Max Pts | Measures |
|---|---|---|
| A – Profitability | 5 | Margins, ROE, ROA, ROIC |
| B – Liquidity & Solvency | 5 | Current/Quick ratio, Debt/Equity, Net Debt |
| C – Growth Quality | 4 | Revenue growth, EPS growth, EBITDA growth |
| D – Cash Flow Strength | 3 | FCF margin, FCF growth |
| E – Earnings Quality | 3 | EPS polarity, EV/EBITDA range, P/FCF |
| **Total** | **20** | |

---

## 3. Exact Field Names

All names are verbatim TradingView screener field identifiers. Case-sensitive.

### 3.1 Context Fields (always include)

| TV Field Name | Display Name | Type |
|---|---|---|
| `sector` | Group (Sector) | text |
| `industry` | Industry | text |
| `market_cap_basic` | Market Capitalization | fundamental_price |

### 3.2 Category A — Profitability

| TV Field Name | Display Name | Type |
|---|---|---|
| `return_on_equity` | Return on Equity (TTM) | percent |
| `return_on_assets` | Return on Assets (TTM) | percent |
| `return_on_invested_capital` | Return on Invested Capital (TTM) | percent |
| `gross_margin` | Gross Margin (TTM) | percent |
| `after_tax_margin` | Net Margin (TTM) | percent |
| `operating_margin` | Operating Margin (TTM) | percent |

### 3.3 Category B — Liquidity & Solvency

| TV Field Name | Display Name | Type |
|---|---|---|
| `current_ratio` | Current Ratio (MRQ) | number |
| `quick_ratio` | Quick Ratio (MRQ) | number |
| `debt_to_equity` | Debt to Equity Ratio (MRQ) | number |
| `net_debt` | Net Debt (MRQ) | fundamental_price |
| `total_debt` | Total Debt (MRQ) | fundamental_price |
| `cash_n_short_term_invest_fq` | Cash and Short Term Investments (MRQ) | fundamental_price |

### 3.4 Category C — Growth Quality

| TV Field Name | Display Name | Type |
|---|---|---|
| `total_revenue_yoy_growth_ttm` | Revenue YoY Growth (TTM) | percent |
| `total_revenue_yoy_growth_fy` | Revenue YoY Growth (FY) | percent |
| `earnings_per_share_diluted_yoy_growth_ttm` | EPS Diluted YoY Growth (TTM) | percent |
| `earnings_per_share_diluted_yoy_growth_fy` | EPS Diluted YoY Growth (FY) | percent |
| `net_income_yoy_growth_ttm` | Net Income YoY Growth (TTM) | percent |
| `ebitda_yoy_growth_ttm` | EBITDA YoY Growth (TTM) | percent |

> **TTM preferred over FY.** Fall back to `_fy` variant only when TTM is null (some non-US exchanges report less frequently).

### 3.5 Category D — Cash Flow Strength

| TV Field Name | Display Name | Type |
|---|---|---|
| `free_cash_flow_margin_ttm` | Free Cash Flow Margin (TTM) | percent |
| `free_cash_flow_margin_fy` | Free Cash Flow Margin (FY) | percent |
| `free_cash_flow_yoy_growth_ttm` | Free Cash Flow YoY Growth (TTM) | percent |
| `free_cash_flow_yoy_growth_fy` | Free Cash Flow YoY Growth (FY) | percent |

### 3.6 Category E — Earnings Quality

| TV Field Name | Display Name | Type |
|---|---|---|
| `earnings_per_share_basic_ttm` | Basic EPS (TTM) | fundamental_price |
| `ebitda` | EBITDA (TTM) | fundamental_price |
| `enterprise_value_ebitda_ttm` | Enterprise Value / EBITDA (TTM) | number |
| `price_free_cash_flow_ttm` | Price to Free Cash Flow (TTM) | number |
| `price_earnings_ttm` | Price to Earnings Ratio (TTM) | number |

---

## 4. Complete `HEALTH_COLUMNS` Array

```js
const HEALTH_COLUMNS = [
  // Context
  "sector", "industry", "market_cap_basic",
  // Category A — Profitability
  "return_on_equity", "return_on_assets", "return_on_invested_capital",
  "gross_margin", "after_tax_margin", "operating_margin",
  // Category B — Liquidity & Solvency
  "current_ratio", "quick_ratio", "debt_to_equity",
  "net_debt", "total_debt", "cash_n_short_term_invest_fq",
  // Category C — Growth Quality
  "total_revenue_yoy_growth_ttm", "total_revenue_yoy_growth_fy",
  "earnings_per_share_diluted_yoy_growth_ttm", "earnings_per_share_diluted_yoy_growth_fy",
  "net_income_yoy_growth_ttm", "ebitda_yoy_growth_ttm",
  // Category D — Cash Flow
  "free_cash_flow_margin_ttm", "free_cash_flow_margin_fy",
  "free_cash_flow_yoy_growth_ttm", "free_cash_flow_yoy_growth_fy",
  // Category E — Earnings Quality
  "earnings_per_share_basic_ttm", "ebitda",
  "enterprise_value_ebitda_ttm", "price_free_cash_flow_ttm", "price_earnings_ttm"
];
```

---

## 5. Scoring Algorithm

```js
/**
 * Computes the Financial Health Score (0–20).
 * Input: a parsed row object (keys = TV field names, values = numbers or null).
 * Returns: { total, breakdown, label, labelCode, flags }
 *
 * TV percent fields are returned as raw numbers (e.g. 15.3 = 15.3%, NOT 0.153).
 * TV ratio fields (current_ratio, debt_to_equity) are plain decimals (e.g. 2.1).
 */
function computeHealthScore(r) {
  const breakdown = {};
  const flags     = [];   // qualitative warnings, not deducted from score

  // Helper: TTM with FY fallback
  const ttmOrFy = (ttm, fy) => (ttm !== null ? ttm : fy);

  // ── Category A: Profitability (0–5 pts) ──────────────────────────────────
  let a = 0;

  // ROE — cap at 100% to exclude distorted values from near-zero equity
  const roe = r.return_on_equity;
  if (roe !== null) {
    const roeCapped = Math.min(roe, 100);
    if (roeCapped > 15) a += 2;
    else if (roeCapped > 8) a += 1;
    else if (roeCapped < 0) flags.push("NEGATIVE_ROE");
  }

  // Net Margin
  const netMargin = r.after_tax_margin;
  if (netMargin !== null) {
    if (netMargin > 15)  a += 1;
    if (netMargin < 0)   flags.push("NEGATIVE_NET_MARGIN");
  }

  // ROIC — best single indicator of capital efficiency
  const roic = r.return_on_invested_capital;
  if (roic !== null) {
    if (roic > 12)  a += 1;
    else if (roic < 0) flags.push("NEGATIVE_ROIC");
  }

  // Operating Margin — structural health, harder to manipulate than net
  const opMargin = r.operating_margin;
  if (opMargin !== null && opMargin > 15) a += 1;

  breakdown.A_Profitability = Math.min(a, 5);

  // ── Category B: Liquidity & Solvency (0–5 pts) ───────────────────────────
  let b = 0;

  // Current Ratio
  const cr = r.current_ratio;
  if (cr !== null) {
    if (cr >= 2.0)  b += 2;
    else if (cr >= 1.5) b += 1;
    else if (cr < 1.0)  flags.push("LOW_CURRENT_RATIO");
  }

  // Quick Ratio (acid test — excludes inventory)
  const qr = r.quick_ratio;
  if (qr !== null) {
    if (qr >= 1.0)  b += 1;
    else flags.push("QUICK_RATIO_BELOW_1");
  }

  // Debt / Equity
  const de = r.debt_to_equity;
  if (de !== null) {
    if (de < 0.5)        b += 2;
    else if (de < 1.5)   b += 1;
    else if (de > 3.0)   flags.push("HIGH_LEVERAGE");
  }

  breakdown.B_LiquiditySolvency = Math.min(b, 5);

  // ── Category C: Growth Quality (0–4 pts) ──────────────────────────────────
  let c = 0;

  // Revenue growth (TTM preferred)
  const revGrowth = ttmOrFy(r.total_revenue_yoy_growth_ttm, r.total_revenue_yoy_growth_fy);
  if (revGrowth !== null) {
    if (revGrowth > 20)  c += 2;
    else if (revGrowth > 8) c += 1;
    else if (revGrowth < 0) flags.push("REVENUE_SHRINKING");
  }

  // EPS growth (TTM preferred)
  const epsGrowth = ttmOrFy(
    r.earnings_per_share_diluted_yoy_growth_ttm,
    r.earnings_per_share_diluted_yoy_growth_fy
  );
  if (epsGrowth !== null) {
    if (epsGrowth > 20)  c += 2;
    else if (epsGrowth > 8) c += 1;
    else if (epsGrowth < -10) flags.push("EPS_DECLINING");
  }

  breakdown.C_Growth = Math.min(c, 4);

  // ── Category D: Cash Flow Strength (0–3 pts) ──────────────────────────────
  let d = 0;

  // FCF Margin — shows how much of revenue converts to free cash
  const fcfMargin = ttmOrFy(r.free_cash_flow_margin_ttm, r.free_cash_flow_margin_fy);
  if (fcfMargin !== null) {
    if (fcfMargin > 20)  d += 2;
    else if (fcfMargin > 8) d += 1;
    else if (fcfMargin < 0) flags.push("NEGATIVE_FCF");
  }

  // FCF growth — confirms cash generation is expanding
  const fcfGrowth = ttmOrFy(r.free_cash_flow_yoy_growth_ttm, r.free_cash_flow_yoy_growth_fy);
  if (fcfGrowth !== null && fcfGrowth > 0) d += 1;

  breakdown.D_CashFlow = Math.min(d, 3);

  // ── Category E: Earnings Quality (0–3 pts) ────────────────────────────────
  let e = 0;

  // EPS positive — basic profitability gate
  const eps = r.earnings_per_share_basic_ttm;
  if (eps !== null) {
    if (eps > 0) e += 1;
    else flags.push("NEGATIVE_EPS");
  }

  // EV/EBITDA — reasonable range signals neither distressed nor bubble
  // Negative = pre-profit (no point); > 40 = very expensive; sweet spot 8–25
  const evEbitda = r.enterprise_value_ebitda_ttm;
  if (evEbitda !== null) {
    if (evEbitda > 0 && evEbitda <= 25) e += 1;
    else if (evEbitda > 25)             flags.push("HIGH_EV_EBITDA");
    else if (evEbitda < 0)              flags.push("NEGATIVE_EBITDA");
  }

  // P/FCF — paying a reasonable price for cash generation
  const pFcf = r.price_free_cash_flow_ttm;
  if (pFcf !== null && pFcf > 0 && pFcf <= 30) e += 1;

  breakdown.E_EarningsQuality = Math.min(e, 3);

  // ── Total ─────────────────────────────────────────────────────────────────
  const total =
    breakdown.A_Profitability +
    breakdown.B_LiquiditySolvency +
    breakdown.C_Growth +
    breakdown.D_CashFlow +
    breakdown.E_EarningsQuality;

  let label, labelCode;
  if      (total >= 16) { label = "Financially Strong";   labelCode = "STRONG"; }
  else if (total >= 11) { label = "Financially Sound";    labelCode = "SOUND"; }
  else if (total >= 6)  { label = "Mixed Health";         labelCode = "MIXED"; }
  else                  { label = "Financial Weakness";   labelCode = "WEAK"; }

  return { total, breakdown, label, labelCode, flags };
}
```

---

## 6. Score Reference Table

### Category Thresholds

| Category A — Profitability | Points |
|---|---|
| ROE > 15% (capped at 100%) | +2 |
| ROE 8–15% | +1 |
| Net Margin > 15% | +1 |
| ROIC > 12% | +1 |
| Operating Margin > 15% | +1 |
| **Max** | **5** |

| Category B — Liquidity & Solvency | Points |
|---|---|
| Current Ratio ≥ 2.0 | +2 |
| Current Ratio 1.5–1.99 | +1 |
| Quick Ratio ≥ 1.0 | +1 |
| D/E < 0.5 | +2 |
| D/E 0.5–1.49 | +1 |
| **Max** | **5** |

| Category C — Growth Quality | Points |
|---|---|
| Revenue YoY Growth > 20% | +2 |
| Revenue YoY Growth 8–20% | +1 |
| EPS Diluted YoY Growth > 20% | +2 |
| EPS Diluted YoY Growth 8–20% | +1 |
| **Max** | **4** |

| Category D — Cash Flow | Points |
|---|---|
| FCF Margin > 20% | +2 |
| FCF Margin 8–20% | +1 |
| FCF YoY Growth > 0% | +1 |
| **Max** | **3** |

| Category E — Earnings Quality | Points |
|---|---|
| EPS (TTM) > 0 | +1 |
| EV/EBITDA between 0 and 25 | +1 |
| P/FCF between 0 and 30 | +1 |
| **Max** | **3** |

### Signal Interpretation

| Score | Label | Meaning |
|---|---|---|
| 16–20 | Financially Strong | High-quality balance sheet, profitable, cash-generative |
| 11–15 | Financially Sound | Solid fundamentals, minor weaknesses acceptable |
| 6–10 | Mixed Health | Investigate flags before acting |
| 0–5 | Financial Weakness | Structural risk — high-conviction pass unless turnaround thesis |

---

## 7. Flags Reference

Flags are qualitative warnings appended to the result. They do **not** subtract points from the score — they exist separately so the UI can surface them alongside the numeric grade.

| Flag | Trigger | Risk Level |
|---|---|---|
| `NEGATIVE_ROE` | ROE < 0 | High |
| `NEGATIVE_NET_MARGIN` | Net Margin < 0 | High |
| `NEGATIVE_ROIC` | ROIC < 0 | High |
| `LOW_CURRENT_RATIO` | Current Ratio < 1.0 | High |
| `QUICK_RATIO_BELOW_1` | Quick Ratio < 1.0 | Medium |
| `HIGH_LEVERAGE` | D/E > 3.0 | High |
| `REVENUE_SHRINKING` | Revenue YoY Growth < 0% | Medium |
| `EPS_DECLINING` | EPS YoY Growth < −10% | Medium |
| `NEGATIVE_FCF` | FCF Margin < 0 | High |
| `NEGATIVE_EPS` | Basic EPS (TTM) < 0 | High |
| `HIGH_EV_EBITDA` | EV/EBITDA > 25 | Medium |
| `NEGATIVE_EBITDA` | EV/EBITDA < 0 (pre-profit) | High |

---

## 8. Sector Adjustment Notes

Financial health thresholds are not universal. The scoring function above uses general-market defaults. Apply these sector-specific overrides using the `sector` field.

```js
const SECTOR_OVERRIDES = {
  // Financials: high leverage is structural, not a warning
  "Finance": {
    debtToEquityHighThreshold: null,   // disable HIGH_LEVERAGE flag entirely
    currentRatioMin: null,             // not meaningful for banks
    roicMinForPoint: 8                 // lower ROIC bar (capital-heavy business)
  },
  // Utilities: low growth and high debt are normal
  "Utilities": {
    revGrowthForTwoPoints: 8,          // lower bar
    debtToEquityHighThreshold: 5.0,
    roicMinForPoint: 6
  },
  // Consumer Staples: stable margins, low growth acceptable
  "Consumer Staples": {
    revGrowthForTwoPoints: 10,
    revGrowthForOnePoint: 4
  }
};
```

> The `sector` field returns TV's sector grouping (e.g. `"Technology"`, `"Finance"`, `"Healthcare"`). It maps to the `Group` display name in the field dictionary.

---

## 9. Null Handling Strategy

TV returns `null` for fields that are unavailable (e.g. non-reporting periods, crypto, newly listed). The scoring function skips null fields silently — they contribute 0 points to that category rather than breaking the calculation.

A minimum data threshold is recommended before running the scorer:

```js
// Minimum required fields for a valid health score
const REQUIRED_FIELDS = [
  "return_on_equity",
  "after_tax_margin",
  "current_ratio",
  "debt_to_equity",
  "earnings_per_share_basic_ttm"
];

function hasMinimumData(r) {
  return REQUIRED_FIELDS.every(f => r[f] !== null);
}
```

Tickers failing `hasMinimumData()` should be excluded from ranked output or labeled as `"Insufficient Data"`.

---

## 10. Combined Scoring (Trend + Health)

When used together with the Trend Score from `tv-trend-scoring-spec.md`, compute a single **Combined Score** to surface the highest-conviction candidates:

```js
function computeCombinedScore(trendResult, healthResult) {
  // Weight: trend 50%, health 50% — adjust to taste
  const combined = (trendResult.total / 20) * 10 + (healthResult.total / 20) * 10;

  const bothStrong =
    trendResult.labelCode  === "STRONG" &&
    healthResult.labelCode === "STRONG";

  const criticalFlags = healthResult.flags.filter(f =>
    ["NEGATIVE_EPS","NEGATIVE_FCF","HIGH_LEVERAGE","NEGATIVE_EBITDA"].includes(f)
  );

  return {
    combined: +combined.toFixed(1),    // 0–10 scale
    bothStrong,
    criticalFlags,
    // Highest conviction: combined ≥ 8.0, bothStrong = true, no critical flags
    isHighConviction: combined >= 8.0 && bothStrong && criticalFlags.length === 0
  };
}
```

---

*End of briefing*
