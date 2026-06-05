# TradingView Entry Price Calculator — JS Developer Briefing

**Version:** 1.0
**Last updated:** 2026-06-05
**Companion to:** `tvtrendscoringspec.md`, `tvtrendstrengthscoringspec.md`
**Scope:** Field definitions, algorithm, JS implementation — no API/backend sections.

---

## 1. Overview

This module derives a single **Long Entry Price** and a single **Short Entry Price** by blending
three independent execution strategies. Each strategy anchors the entry to a different market
mechanic; combining them into a simple average produces a price that is simultaneously
defensible by mean-reversion logic, institutional order-block awareness, and momentum
confirmation.

> **Usage:** compare both prices against the current `close` to decide whether a trade is
> in range. Pair with the Entry Timing Score to confirm the *when*; use the Trend Strength Score
> to confirm the *trend direction*.

---

## 2. Execution Methods

| Execution Type | Long Entry Price | Short Entry Price | Underlying Logic |
|---|---|---|---|
| Mean Reversion | `BB.lower` | `BB.upper` | Dynamic statistical extremes (±2 Std Dev) |
| Floor Pivots | `Pivot.M.Classic.S1` | `Pivot.M.Classic.R1` | Standard institutional order blocks |
| Trend Breakout | `close + (0.5 × ATR)` | `close − (0.5 × ATR)` | Momentum confirmation beyond baseline noise |

The **published price** is the simple average of all available method values. If a TV field
returns `null` (e.g. crypto has no pivot data), that method is excluded and the remaining values
are averaged.

---

## 3. Exact Field Names

| TV Field Name | Display Name | Type |
|---|---|---|
| `BB.lower` | Bollinger Lower Band (20, 2σ) | price |
| `BB.upper` | Bollinger Upper Band (20, 2σ) | price |
| `Pivot.M.Classic.S1` | Monthly Classic Pivot — Support 1 | price |
| `Pivot.M.Classic.R1` | Monthly Classic Pivot — Resistance 1 | price |
| `close` | Last Price | price |
| `ATR` | Average True Range (14) | price-delta |

`BB.lower`, `BB.upper`, and `close` are typically already fetched for other score modules.
The new fields to add are: `Pivot.M.Classic.S1`, `Pivot.M.Classic.R1`, `ATR`.

---

## 4. Complete `ENTRY_PRICE_COLUMNS` Array

```js
const ENTRY_PRICE_COLUMNS = [
  "BB.lower", "BB.upper",          // Mean Reversion (likely already present)
  "Pivot.M.Classic.S1",            // Floor Pivots — long
  "Pivot.M.Classic.R1",            // Floor Pivots — short
  "close",                         // Trend Breakout base (already present)
  "ATR",                           // Trend Breakout offset
];
```

---

## 5. Algorithm

```js
/**
 * Computes the blended Long and Short entry price targets.
 * Input: object keyed by verbatim TV field names.
 * Output: { longEntry, shortEntry, breakdown, methodCount }
 *
 * longEntry / shortEntry are null when no methods are available.
 * methodCount = number of strategies that contributed to both prices (0–3).
 */
export function computeEntryPrices(r) {
  const breakdown = {
    meanRevLong: null,  meanRevShort: null,
    pivotLong:   null,  pivotShort:   null,
    breakoutLong: null, breakoutShort: null,
  };

  // Mean Reversion
  if (r['BB.lower'] != null) breakdown.meanRevLong  = r['BB.lower'];
  if (r['BB.upper'] != null) breakdown.meanRevShort = r['BB.upper'];

  // Floor Pivots
  if (r['Pivot.M.Classic.S1'] != null) breakdown.pivotLong  = r['Pivot.M.Classic.S1'];
  if (r['Pivot.M.Classic.R1'] != null) breakdown.pivotShort = r['Pivot.M.Classic.R1'];

  // Trend Breakout
  if (r.close != null && r.ATR != null) {
    breakdown.breakoutLong  = r.close + 0.5 * r.ATR;
    breakdown.breakoutShort = r.close - 0.5 * r.ATR;
  }

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const longValues  = [breakdown.meanRevLong,  breakdown.pivotLong,  breakdown.breakoutLong ].filter(v => v != null);
  const shortValues = [breakdown.meanRevShort, breakdown.pivotShort, breakdown.breakoutShort].filter(v => v != null);

  return {
    longEntry:   avg(longValues),
    shortEntry:  avg(shortValues),
    breakdown,
    methodCount: Math.min(longValues.length, shortValues.length),
  };
}
```

---

## 6. Breakdown Keys

| Key | Method | Side |
|---|---|---|
| `breakdown.meanRevLong` | Mean Reversion | Long |
| `breakdown.meanRevShort` | Mean Reversion | Short |
| `breakdown.pivotLong` | Floor Pivots | Long |
| `breakdown.pivotShort` | Floor Pivots | Short |
| `breakdown.breakoutLong` | Trend Breakout | Long |
| `breakdown.breakoutShort` | Trend Breakout | Short |

---

## 7. Null Handling Strategy

Any field returning `null` excludes that method silently. A ticker with all three methods
available (`methodCount = 3`) gives the most balanced price. A ticker with only one method
available still produces a price but it reflects only that method's anchor.

Tickers with `methodCount = 0` for either side return `null` for that price — display as `—`
in the UI.

---

## 8. Interpretation Guide

| Condition | Meaning |
|---|---|
| `close ≈ longEntry` (within 2%) | Stock is trading near or below the blended long entry zone — favourable entry window |
| `close ≫ longEntry` | Price has run above entry targets — risk of chasing |
| `close ≈ shortEntry` (within 2%) | Price is approaching the blended resistance zone |
| `longEntry < close < shortEntry` | Inside the fair-value range — neutral zone |

---

*End of briefing*
