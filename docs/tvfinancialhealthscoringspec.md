# TradingView Financial Health Score — JS Developer Briefing

**Version:** 2.0
**Last updated:** 2026-06-05
**Companion to:** `tvtrendscoringspec.md`
**Scope:** Field definitions, scoring algorithm, JS implementation — no API/backend sections.

> **Changelog v1.0 → v2.0:** Rescaled from 0–20 (5 categories) to **0–100 (4 categories)**.
> The model is now growth-and-solvency oriented: it rewards institutional scale, double-digit
> top- and bottom-line expansion, margin/cash conversion quality, and a conservative balance
> sheet. **Target grade: 75+ for safe allocations.**

---

## 1. Overview

This document specifies a **Financial Health Score** (0–100 pts) built from TradingView
fundamental screener fields. The score evaluates the intrinsic financial quality of a ticker
across four independent categories, independent of price action or trend state.

Intended use: run in parallel with the Composite Trend Score and the Price Cycle Score. A strong
signal requires the health score to be elevated — a trending ticker with poor financial health is
a significantly higher-risk position.

---

## 2. Scoring Categories

| Category | Targeted Metrics | Max Pts | Threshold Goal |
|---|---|---|---|
| A – Size & Scale | `market_cap_basic`, `ebitda` | 15 | Positive & institutional scale |
| B – YoY Core Growth | `total_revenue_yoy_growth_ttm`, `ebitda_yoy_growth_ttm` | 35 | >10% expansion + operational leverage |
| C – Cash & Efficiency | `free_cash_flow_yoy_growth_ttm`, `operating_margin` | 25 | Expanding margins + robust capital conversion |
| D – Leverage & Risk | `debt_to_equity`, `total_debt_to_ebitda_fy` | 25 | D/E < 1.0, Debt/EBITDA < 2.0x |
| **Total** | | **100** | **75+ for Safe Allocations** |

---

## 3. Exact Field Names

All names are verbatim TradingView screener field identifiers. Case-sensitive.

### 3.1 Category A — Size & Scale

| TV Field Name | Display Name | Type |
|---|---|---|
| `market_cap_basic` | Market Capitalization | fundamental_price |
| `ebitda` | EBITDA (TTM) | fundamental_price |

### 3.2 Category B — YoY Core Growth

| TV Field Name | Display Name | Type |
|---|---|---|
| `total_revenue_yoy_growth_ttm` | Revenue YoY Growth (TTM) | percent |
| `ebitda_yoy_growth_ttm` | EBITDA YoY Growth (TTM) | percent |

### 3.3 Category C — Cash & Efficiency

| TV Field Name | Display Name | Type |
|---|---|---|
| `free_cash_flow_yoy_growth_ttm` | Free Cash Flow YoY Growth (TTM) | percent |
| `operating_margin` | Operating Margin (TTM) | percent |

### 3.4 Category D — Leverage & Risk

| TV Field Name | Display Name | Type |
|---|---|---|
| `debt_to_equity` | Debt to Equity Ratio (MRQ) | number |
| `total_debt_to_ebitda_fy` | Total Debt / EBITDA (FY) | number |

---

## 4. Complete `HEALTH_COLUMNS` Array

```js
const HEALTH_COLUMNS = [
  // Category A — Size & Scale
  "market_cap_basic", "ebitda",
  // Category B — YoY Core Growth
  "total_revenue_yoy_growth_ttm", "ebitda_yoy_growth_ttm",
  // Category C — Cash & Efficiency
  "free_cash_flow_yoy_growth_ttm", "operating_margin",
  // Category D — Leverage & Risk
  "debt_to_equity", "total_debt_to_ebitda_fy"
];
```

---

## 5. Scoring Algorithm

```js
/**
 * Computes the Financial Health Score (0–100).
 * Input: a parsed row object (keys = TV field names, values = numbers or null).
 * Returns: { total, breakdown, label, labelCode, flags }
 *
 * TV percent fields are returned as raw numbers (e.g. 15.3 = 15.3%, NOT 0.153).
 * TV ratio fields (debt_to_equity, total_debt_to_ebitda_fy) are plain decimals.
 * market_cap_basic and ebitda are absolute currency amounts.
 */
function computeHealthScore(r) {
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
    else                    flags.push("NANO_CAP");
  }
  const ebitda = r.ebitda;
  if (ebitda != null) {
    if (ebitda > 1e9)        a += 7;
    else if (ebitda > 100e6) a += 5;
    else if (ebitda > 0)     a += 3;
    else                     flags.push("NEGATIVE_EBITDA");
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
    else                     flags.push("REVENUE_SHRINKING");
  }
  const ebitdaGrowth = r.ebitda_yoy_growth_ttm;
  if (ebitdaGrowth != null) {
    if (ebitdaGrowth > 25)      b += 18;  // operational leverage
    else if (ebitdaGrowth > 15) b += 14;
    else if (ebitdaGrowth > 10) b += 10;
    else if (ebitdaGrowth > 0)  b += 5;
    else                        flags.push("EBITDA_DECLINING");
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
    else                    flags.push("NEGATIVE_OP_MARGIN");
  }
  const fcfGrowth = r.free_cash_flow_yoy_growth_ttm;
  if (fcfGrowth != null) {
    if (fcfGrowth > 20)      c += 12;
    else if (fcfGrowth > 10) c += 9;
    else if (fcfGrowth > 0)  c += 5;
    else                     flags.push("FCF_DECLINING");
  }
  breakdown.C_Cash = Math.min(c, 25);

  // ── Category D: Leverage & Risk (0–25 pts) ───────────────────────────────
  let d = 0;
  const de = r.debt_to_equity;
  if (de != null) {
    if (de < 0.5)      d += 13;
    else if (de < 1.0) d += 10;
    else if (de < 2.0) d += 5;
    else               flags.push("HIGH_LEVERAGE");
  }
  const debtEbitda = r.total_debt_to_ebitda_fy;
  if (debtEbitda != null) {
    if (debtEbitda < 0)        flags.push("NEGATIVE_DEBT_EBITDA");
    else if (debtEbitda < 1.0) d += 12;
    else if (debtEbitda < 2.0) d += 9;
    else if (debtEbitda < 4.0) d += 4;
    else                       flags.push("HIGH_DEBT_EBITDA");
  }
  breakdown.D_Leverage = Math.min(d, 25);

  // ── Total ─────────────────────────────────────────────────────────────────
  const total =
    breakdown.A_Size +
    breakdown.B_Growth +
    breakdown.C_Cash +
    breakdown.D_Leverage;

  let label, labelCode;
  if      (total >= 75) { label = "Safe Allocation"; labelCode = "STRONG"; }
  else if (total >= 55) { label = "Solide";          labelCode = "SOUND"; }
  else if (total >= 35) { label = "Gemischt";        labelCode = "MIXED"; }
  else                  { label = "Fragil";          labelCode = "WEAK"; }

  return { total, breakdown, label, labelCode, flags };
}
```

---

## 6. Score Reference Table

### Category Thresholds

| Category A — Size & Scale | Points |
|---|---|
| Market Cap ≥ $10B | +8 |
| Market Cap $2B–10B | +6 |
| Market Cap $300M–2B | +4 |
| Market Cap $50M–300M | +2 |
| EBITDA > $1B | +7 |
| EBITDA $100M–1B | +5 |
| EBITDA $0–100M | +3 |
| **Max** | **15** |

| Category B — YoY Core Growth | Points |
|---|---|
| Revenue YoY Growth > 25% | +17 |
| Revenue YoY Growth 15–25% | +13 |
| Revenue YoY Growth 10–15% | +9 |
| Revenue YoY Growth 0–10% | +4 |
| EBITDA YoY Growth > 25% | +18 |
| EBITDA YoY Growth 15–25% | +14 |
| EBITDA YoY Growth 10–15% | +10 |
| EBITDA YoY Growth 0–10% | +5 |
| **Max** | **35** |

| Category C — Cash & Efficiency | Points |
|---|---|
| Operating Margin > 25% | +13 |
| Operating Margin 15–25% | +10 |
| Operating Margin 8–15% | +6 |
| Operating Margin 0–8% | +3 |
| FCF YoY Growth > 20% | +12 |
| FCF YoY Growth 10–20% | +9 |
| FCF YoY Growth 0–10% | +5 |
| **Max** | **25** |

| Category D — Leverage & Risk | Points |
|---|---|
| Debt/Equity < 0.5 | +13 |
| Debt/Equity 0.5–1.0 | +10 |
| Debt/Equity 1.0–2.0 | +5 |
| Debt/EBITDA < 1.0x | +12 |
| Debt/EBITDA 1.0–2.0x | +9 |
| Debt/EBITDA 2.0–4.0x | +4 |
| **Max** | **25** |

### Signal Interpretation

| Score | Label | labelCode | Meaning |
|---|---|---|---|
| 75–100 | Safe Allocation | `STRONG` | Institutional scale, strong growth, conservative balance sheet |
| 55–74 | Solide | `SOUND` | Solid fundamentals, minor weaknesses acceptable |
| 35–54 | Gemischt | `MIXED` | Investigate flags before acting |
| 0–34 | Fragil | `WEAK` | Structural risk — high-conviction pass unless turnaround thesis |

---

## 7. Flags Reference

Flags are qualitative warnings appended to the result. They do **not** subtract points from the
score — they exist separately so the UI can surface them alongside the numeric grade.

| Flag | Trigger | Risk Level |
|---|---|---|
| `NANO_CAP` | Market Cap < $50M | High |
| `NEGATIVE_EBITDA` | EBITDA ≤ 0 | High |
| `REVENUE_SHRINKING` | Revenue YoY Growth < 0% | Medium |
| `EBITDA_DECLINING` | EBITDA YoY Growth ≤ 0% | Medium |
| `NEGATIVE_OP_MARGIN` | Operating Margin ≤ 0% | High |
| `FCF_DECLINING` | FCF YoY Growth ≤ 0% | Medium |
| `HIGH_LEVERAGE` | Debt/Equity ≥ 2.0 | High |
| `HIGH_DEBT_EBITDA` | Debt/EBITDA ≥ 4.0x | High |
| `NEGATIVE_DEBT_EBITDA` | Debt/EBITDA < 0 (negative-EBITDA distortion) | High |

---

## 8. Null Handling Strategy

TV returns `null` for fields that are unavailable (e.g. non-reporting periods, crypto, newly
listed). The scoring function skips null fields silently — they contribute 0 points to that
category rather than breaking the calculation. A ticker with no fundamentals at all therefore
scores 0 and lands in the `WEAK` band; treat a 0 with empty `breakdown` categories as
"Insufficient Data" in the UI if you want to distinguish it from a genuinely weak balance sheet.

---

*End of briefing*
