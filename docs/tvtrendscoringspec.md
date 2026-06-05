# TradingView Entry Timing Score — JS Developer Briefing

**Version:** 2.0
**Last updated:** 2026-06-05
**Companion to:** `tvfinancialhealthscoringspec.md`
**Scope:** Field definitions, scoring algorithm, JS implementation — no API/backend sections.

> **Changelog v1.0 → v2.0:** Repurposed from the 0–20 *Composite Trend Beginning Score* into a
> **0–100 Entry Timing Score**. The previous model graded whether a confirmed uptrend was *forming*;
> this model grades whether *right now* is a good short-term moment to **enter** a position. It
> rewards oversold-but-curling-up conditions and penalises chasing overextended price.
> **Target grade: 80+ for a prime entry.**

---

## 1. Overview

This document specifies an **Entry Timing Score** (0–100 pts) built from TradingView technical
screener fields. It helps determine the best short-term moment to enter a trade by identifying
oversold conditions or accelerating momentum — so you avoid buying at the top.

The score is **independent of financial quality** (see the Financial Health Score) and of the
longer-horizon price cycle (see the Price Cycle Score). A strong overall signal pairs a healthy,
well-positioned company with a favourable entry window.

---

## 2. Scoring Indicators

| Indicator / Metric | Condition for Max Points | Max Pts | Rationale |
|---|---|---|---|
| RSI (14) | Between 30 and 50 (bullish reversal setup) | 25 | RSI < 30 is oversold but can keep dropping; 30–50 shows momentum curling up. |
| MACD | MACD Line > Signal Line (or recent crossover) | 20 | Indicates short-term bullish momentum acceleration. |
| Stochastic (%K vs %D) | %K > %D and %K crossing up from below 20 | 20 | Confirms an exit from oversold territory. |
| Price vs EMA20 | Price within ±2% of the EMA20 | 20 | Buying near the short-term mean prevents chasing overextended pullbacks. |
| Bollinger Bands | Price touches or crosses the Lower Band | 15 | Provides an asymmetric risk/reward entry point for a bounce. |
| **Total** | | **100** | **80+ for a prime entry** |

---

## 3. Exact Field Names

All names are verbatim TradingView screener field identifiers. Case-sensitive.

| TV Field Name | Display Name | Type |
|---|---|---|
| `RSI` | Relative Strength Index (14) | number |
| `MACD.macd` | MACD Level (12, 26) | number |
| `MACD.signal` | MACD Signal (12, 26) | number |
| `Stoch.K` | Stochastic %K (14, 3, 3) | number |
| `Stoch.D` | Stochastic %D (14, 3, 3) | number |
| `close` | Price | price |
| `EMA20` | Exponential Moving Average (20) | price |
| `BB.lower` | Bollinger Lower Band (20) | price |
| `BB.upper` | Bollinger Upper Band (20) | price |

---

## 4. Complete `ENTRY_COLUMNS` Array

```js
const ENTRY_COLUMNS = [
  // Momentum
  "RSI", "MACD.macd", "MACD.signal",
  // Oscillator
  "Stoch.K", "Stoch.D",
  // Mean reversion
  "close", "EMA20", "BB.lower", "BB.upper"
];
```

---

## 5. Scoring Algorithm

```js
/**
 * Computes the Entry Timing Score (0–100).
 * Input: a parsed row object (keys = TV field names, values = numbers or null).
 * Returns: { total, breakdown, label, labelCode, flags }
 *
 * The score grades how favourable the *current* moment is for a short-term entry.
 * Conditions are graduated: full points for the ideal setup, partial credit for
 * near-setups, zero for overextended/overbought conditions.
 */
function computeEntryScore(r) {
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
    else if (rsi > 70)               flags.push("RSI_OVERBOUGHT");
    else                             flags.push("RSI_DEEP_OVERSOLD"); // < 25
  }
  breakdown.RSI = rsiPts;

  // ── MACD — 0–20 pts ──────────────────────────────────────────────────────
  // Line above signal = short-term bullish acceleration.
  let macdPts = 0;
  const macd = r["MACD.macd"];
  const sig  = r["MACD.signal"];
  if (macd != null && sig != null) {
    if (macd > sig)                       macdPts = 20;            // bullish crossover state
    else if ((sig - macd) / Math.max(Math.abs(sig), 1e-6) < 0.05) macdPts = 10; // converging, near cross
    else                                  flags.push("MACD_BEARISH");
  }
  breakdown.MACD = macdPts;

  // ── Stochastic (%K vs %D) — 0–20 pts ─────────────────────────────────────
  // Bullish cross emerging out of oversold (<20) is ideal.
  let stochPts = 0;
  const k = r["Stoch.K"];
  const d = r["Stoch.D"];
  if (k != null && d != null) {
    if (k > d && k < 20)       stochPts = 20;  // crossing up from oversold
    else if (k > d && k < 50)  stochPts = 12;  // bullish cross, mid-range
    else if (k > d)            stochPts = 6;    // bullish cross but elevated
    else if (k >= 80)          flags.push("STOCH_OVERBOUGHT");
  }
  breakdown.Stochastic = stochPts;

  // ── Price vs EMA20 — 0–20 pts ────────────────────────────────────────────
  // Entering near the short-term mean avoids chasing extended moves.
  let emaPts = 0;
  const close = r.close;
  const ema20 = r.EMA20;
  if (close != null && ema20 != null && ema20 !== 0) {
    const dist = Math.abs(close - ema20) / ema20;
    if (dist <= 0.02)      emaPts = 20;  // within ±2%
    else if (dist <= 0.05) emaPts = 10;  // within ±5%
    else if (close > ema20) flags.push("EXTENDED_ABOVE_EMA20");
  }
  breakdown.PriceVsEMA20 = emaPts;

  // ── Bollinger Bands — 0–15 pts ───────────────────────────────────────────
  // Price at/under the lower band = asymmetric bounce setup.
  let bbPts = 0;
  const bbLower = r["BB.lower"];
  if (close != null && bbLower != null && bbLower !== 0) {
    if (close <= bbLower)                       bbPts = 15;  // touch / cross lower band
    else if ((close - bbLower) / bbLower <= 0.02) bbPts = 8; // just above lower band
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
  if      (total >= 80) { label = "Prime Entry";   labelCode = "PRIME"; }
  else if (total >= 40) { label = "Neutral Entry"; labelCode = "NEUTRAL"; }
  else                  { label = "Bad Entry";     labelCode = "BAD"; }

  return { total, breakdown, label, labelCode, flags };
}
```

---

## 6. Score Reference Table

### Indicator Thresholds

| RSI (14) | Points |
|---|---|
| 30–50 (bullish reversal setup) | +25 |
| 50–60 (momentum building) | +15 |
| 25–30 (oversold, may keep dropping) | +12 |
| 60–70 (getting extended) | +5 |
| **Max** | **25** |

| MACD | Points |
|---|---|
| MACD Line > Signal Line | +20 |
| Converging (< 5% below signal, near crossover) | +10 |
| **Max** | **20** |

| Stochastic (%K vs %D) | Points |
|---|---|
| %K > %D and %K < 20 (crossing up from oversold) | +20 |
| %K > %D and %K < 50 (bullish cross, mid-range) | +12 |
| %K > %D (bullish cross, elevated) | +6 |
| **Max** | **20** |

| Price vs EMA20 | Points |
|---|---|
| Within ±2% of EMA20 | +20 |
| Within ±5% of EMA20 | +10 |
| **Max** | **20** |

| Bollinger Bands | Points |
|---|---|
| Price touches or crosses Lower Band | +15 |
| Price within 2% above Lower Band | +8 |
| **Max** | **15** |

### Signal Interpretation

| Score | Label | labelCode | Meaning |
|---|---|---|---|
| 80–100 | Prime Entry | `PRIME` | Prime entry zone. Momentum is shifting bullish. |
| 40–79 | Neutral Entry | `NEUTRAL` | Neutral entry. Wait for better confirmation. |
| 0–39 | Bad Entry | `BAD` | Overextended / bad entry. Stock likely overbought and due for a pullback. |

---

## 7. Flags Reference

Flags are qualitative warnings appended to the result. They do **not** subtract points from the
score — they exist separately so the UI can surface them alongside the numeric grade.

| Flag | Trigger | Meaning |
|---|---|---|
| `RSI_OVERBOUGHT` | RSI > 70 | Momentum stretched; high pullback risk |
| `RSI_DEEP_OVERSOLD` | RSI < 25 | Oversold but falling knife — can keep dropping |
| `MACD_BEARISH` | MACD Line < Signal Line (not near cross) | No short-term bullish acceleration |
| `STOCH_OVERBOUGHT` | %K ≥ 80 | Oscillator in overbought territory |
| `EXTENDED_ABOVE_EMA20` | Price > 5% above EMA20 | Chasing an extended move |

---

## 8. Null Handling Strategy

TV returns `null` for fields that are unavailable (e.g. illiquid or newly listed tickers). The
scoring function skips null fields silently — they contribute 0 points to that indicator rather
than breaking the calculation. A ticker with no technicals at all therefore scores 0 and lands in
the `BAD` band; treat a 0 with an empty `breakdown` as "Insufficient Data" in the UI if you want
to distinguish it from a genuinely poor entry.

---

*End of briefing*
