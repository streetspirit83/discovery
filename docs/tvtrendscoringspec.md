# TradingView Composite Trend Score — JS Developer Briefing

**Version:** 1.0  
**Last updated:** 2026-06-03  

---

##  Overview

This document specifies the full implementation of a **Composite Trend Beginning Score** (0–20 pts) derived from TradingView screener data. 
The score identifies assets that are at or near the beginning of a confirmed uptrend by converging signals across five independent categories.

The system works on any market supported by TradingView's scanner endpoint (`america`, `germany`, `crypto`, `forex`, etc.).

---

##  Exact Field Names to Request

These are the **verbatim TradingView field names** (from the screener field dictionary). Use them exactly as shown in the `columns` array — casing is significant.

### 1 Core Fields (always include)

| TV Field Name | Display Name | Type |
|---|---|---|
| `name` | Ticker Symbol | text |
| `description` | Company Name | text |
| `close` | Price | price |
| `change` | Change % | percent |
| `volume` | Volume | number |
| `market_cap_basic` | Market Capitalization | fundamental_price |

### 2 Category A — MA Stack

| TV Field Name | Display Name |
|---|---|
| `EMA20` | Exponential Moving Average (20) |
| `EMA50` | Exponential Moving Average (50) |
| `EMA200` | Exponential Moving Average (200) |

### 3 Category B — Trend Strength

| TV Field Name | Display Name |
|---|---|
| `ADX` | Average Directional Index (14) |
| `ADX+DI` | Positive Directional Indicator (14) |
| `ADX-DI` | Negative Directional Indicator (14) |

### 4 Category C — Momentum

| TV Field Name | Display Name |
|---|---|
| `RSI` | Relative Strength Index (14) |
| `MACD.macd` | MACD Level (12, 26) |
| `MACD.signal` | MACD Signal (12, 26) |

### 5 Category D — Oscillators

| TV Field Name | Display Name |
|---|---|
| `Stoch.K` | Stochastic %K (14, 3, 3) |
| `Stoch.D` | Stochastic %D (14, 3, 3) |
| `CCI20` | Commodity Channel Index (20) |

### 6 Category E — TradingView Rating

| TV Field Name | Display Name | Range |
|---|---|---|
| `Recommend.All` | Technical Rating | −1.0 to +1.0 |
| `Recommend.MA` | Moving Averages Rating | −1.0 to +1.0 |
| `Recommend.Other` | Oscillators Rating | −1.0 to +1.0 |

### 7 Supporting Context Fields

| TV Field Name | Display Name |
|---|---|
| `ATR` | Average True Range (14) |
| `BB.upper` | Bollinger Upper Band (20) |
| `BB.lower` | Bollinger Lower Band (20) |
| `High.1M` | 1-Month High |
| `Low.1M` | 1-Month Low |
| `price_52_week_high` | 52 Week High |
| `price_52_week_low` | 52 Week Low |

### 8 Multi-Timeframe Suffix Convention

Append a pipe + timeframe code to any field to get a different resolution:

| Suffix | Timeframe |
|---|---|
| *(none)* | Daily (default) |
| `\|60` | 1 Hour |
| `\|240` | 4 Hours |
| `\|1W` | 1 Week |
| `\|1M` | 1 Month |

**Example:** `EMA20|240` = EMA(20) on the 4H chart. `RSI|1W` = RSI(14) on the Weekly.

For cross-timeframe confirmation, request both daily and weekly variants in the same call:

```js
columns: ["close", "EMA20", "EMA50", "EMA200", "EMA20|1W", "EMA50|1W", "RSI", "RSI|1W", ...]
```

---

##  Complete `columns` Array (copy-paste ready)

```js
const TV_COLUMNS = [
  // Core
  "name", "description", "close", "change", "volume", "market_cap_basic",
  // Category A — MA Stack (Daily)
  "EMA20", "EMA50", "EMA200",
  // Category B — Trend Strength (Daily)
  "ADX", "ADX+DI", "ADX-DI",
  // Category C — Momentum (Daily)
  "RSI", "MACD.macd", "MACD.signal",
  // Category D — Oscillators (Daily)
  "Stoch.K", "Stoch.D", "CCI20",
  // Category E — TV Rating (Daily)
  "Recommend.All", "Recommend.MA", "Recommend.Other",
  // Supporting
  "ATR", "BB.upper", "BB.lower", "price_52_week_high", "price_52_week_low",
  // Weekly cross-confirmation
  "EMA20|1W", "EMA50|1W", "EMA200|1W",
  "RSI|1W", "ADX|1W", "ADX+DI|1W", "ADX-DI|1W",
  "Recommend.All|1W"
];
```

---

##  Response Parsing — Field Map Builder

```js
/**
 * Builds a field-name → value map from a single TV scan row.
 * @param {string[]} columns  - the columns array sent in the request
 * @param {any[]}    d        - the d[] array from a single response row
 * @returns {Object}
 */
function parseRow(columns, d) {
  return Object.fromEntries(columns.map((col, i) => [col, d[i] ?? null]));
}

// Usage
const rows = response.data.map(row => ({
  symbol: row.s,
  ...parseRow(TV_COLUMNS, row.d)
}));
```

---

## Composite Scoring Algorithm

```js
/**
 * Computes the Composite Trend Beginning Score (0–20).
 * Input: a parsed row object (keys = TV field names, values = numbers or null).
 * Returns: { total, breakdown, label, labelCode }
 */
function computeTrendScore(r) {
  let score = 0;
  const breakdown = {};

  // ── Category A: MA Stack Alignment (0–5 pts) ──────────────────────────────
  let a = 0;
  if (r.close  !== null && r.EMA20  !== null && r.close  > r.EMA20)  a++;
  if (r.EMA20  !== null && r.EMA50  !== null && r.EMA20  > r.EMA50)  a++;
  if (r.EMA50  !== null && r.EMA200 !== null && r.EMA50  > r.EMA200) a++;
  if (r.close  !== null && r.EMA200 !== null && r.close  > r.EMA200) a++;
  if (r.EMA20  !== null && r.EMA50  !== null && r.EMA20  > r.EMA50)  {} // already counted
  // 5th point: price near but above EMA20 (within 3% = early-stage, not extended)
  if (r.close && r.EMA20 && r.close > r.EMA20 && ((r.close - r.EMA20) / r.EMA20) < 0.03) a++;
  a = Math.min(a, 5);
  breakdown.A_MAStack = a;
  score += a;

  // ── Category B: Trend Strength — ADX (0–4 pts) ───────────────────────────
  let b = 0;
  const adx = r.ADX;
  if (adx !== null) {
    if (adx > 20) b = 1;
    if (adx > 25) b = 2;
    if (adx > 30) b = 3;
  }
  if (r["ADX+DI"] !== null && r["ADX-DI"] !== null && r["ADX+DI"] > r["ADX-DI"]) b++;
  b = Math.min(b, 4);
  breakdown.B_ADX = b;
  score += b;

  // ── Category C: Momentum (0–5 pts) ───────────────────────────────────────
  let c = 0;
  const rsi = r.RSI;
  if (rsi !== null) {
    if (rsi > 50) c++;
    if (rsi >= 50 && rsi <= 65) c++;   // sweet spot: not yet overbought
  }
  const macd  = r["MACD.macd"];
  const msig  = r["MACD.signal"];
  if (macd !== null && msig !== null && macd > msig)  c++;   // MACD crossover
  if (macd !== null && macd > 0)                       c++;   // above zero line
  breakdown.C_Momentum = Math.min(c, 5);
  score += breakdown.C_Momentum;

  // ── Category D: Oscillators (0–3 pts) ────────────────────────────────────
  let d = 0;
  const sk = r["Stoch.K"];
  const sd = r["Stoch.D"];
  if (sk !== null && sd !== null && sk > sd && sk < 80) d++;    // bullish cross, not overbought
  if (sk !== null && sk > 50)                           d++;    // above midline
  if (r.CCI20 !== null && r.CCI20 > 0)                 d++;
  breakdown.D_Oscillators = Math.min(d, 3);
  score += breakdown.D_Oscillators;

  // ── Category E: TradingView Rating (0–3 pts) ─────────────────────────────
  let e = 0;
  const recAll = r["Recommend.All"];
  const recMA  = r["Recommend.MA"];
  if (recAll !== null && recAll > 0)   e++;
  if (recAll !== null && recAll > 0.1) e++;   // confirmed Buy (not just barely positive)
  if (recMA  !== null && recMA  > 0)   e++;
  breakdown.E_TVRating = Math.min(e, 3);
  score += breakdown.E_TVRating;

  // ── Weekly Cross-Confirmation Bonus (informational, not in score) ─────────
  const weeklyAlign =
    r["EMA20|1W"] && r["EMA50|1W"] && r["EMA200|1W"] &&
    r.close > r["EMA20|1W"] &&
    r["EMA20|1W"] > r["EMA50|1W"] &&
    r["EMA50|1W"] > r["EMA200|1W"];

  // ── Label ─────────────────────────────────────────────────────────────────
  const total = Math.min(score, 20);
  let label, labelCode;
  if      (total >= 16) { label = "Strong Trend Beginning";   labelCode = "STRONG"; }
  else if (total >= 11) { label = "Moderate Trend Signal";    labelCode = "MODERATE"; }
  else if (total >= 6)  { label = "Neutral / Developing";     labelCode = "NEUTRAL"; }
  else                  { label = "No Trend / Downtrend";     labelCode = "WEAK"; }

  return { total, breakdown, label, labelCode, weeklyAlign };
}
```



##  Scoring Reference Table

| Category | Max Pts | Key Logic |
|---|---|---|
| A – MA Stack | 5 | close > EMA20 > EMA50 > EMA200; price within 3% of EMA20 |
| B – ADX Strength | 4 | ADX tiers (20/25/30) + `+DI > -DI` |
| C – Momentum | 5 | RSI > 50 (+1), RSI 50–65 (+2), MACD cross (+1), MACD > 0 (+1) |
| D – Oscillators | 3 | Stoch K > D & < 80 (+1), K > 50 (+1), CCI > 0 (+1) |
| E – TV Rating | 3 | Recommend.All > 0 (+1), > 0.1 (+2), Recommend.MA > 0 (+1) |
| **Total** | **20** | |

| Score | Label | Action |
|---|---|---|
| 16–20 | Strong Trend Beginning | Act — full signal convergence |
| 11–15 | Moderate Trend Signal | Watchlist / reduced position size |
| 6–10 | Neutral / Developing | Wait for confirmation |
| 0–5 | No Trend / Downtrend | Skip |

---

##  Null Handling

All TV screener fields can return `null` for illiquid tickers or newly listed assets. The scoring function above guards every field access with a `!== null` check. Additionally, consider filtering the raw results before scoring:

```js
const MIN_MARKET_CAP  = 500_000_000;   // $500M minimum
const MIN_VOLUME      = 200_000;       // 200k shares/day

const filtered = rows.filter(r =>
  r.market_cap_basic >= MIN_MARKET_CAP &&
  r.volume           >= MIN_VOLUME     &&
  r.close            !== null          &&
  r.EMA200           !== null           // needs enough history
);
```


##  Filter Operation Reference

Useful `operation` values for the `filter` array:

| Operation | Meaning |
|---|---|
| `greater` | field > right |
| `less` | field < right |
| `equal` | field == right |
| `in_range` | field value in array |
| `between` | right = [min, max] |
| `crosses_above` | current > prev (crossover) |

---

*End of briefing*
