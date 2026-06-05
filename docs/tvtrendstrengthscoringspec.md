# TradingView Trend Strength Score — JS Developer Briefing

**Version:** 1.0
**Last updated:** 2026-06-05
**Companion to:** `tvfinancialhealthscoringspec.md`, `tvtrendscoringspec.md`
**Scope:** Field definitions, scoring algorithm, JS implementation — no API/backend sections.

---

## 1. Overview

This document specifies a **Trend Strength Score** (0–100 pts) built from TradingView technical
screener fields. It measures whether a confirmed macro uptrend is structurally intact and
well-supported — i.e., whether short-term, medium-term, and multi-week indicators are all firing
simultaneously.

This score is **complementary** to the Entry Timing Score:
- **Trend Strength Score** → is the macro trend real and powerful?
- **Entry Timing Score** → is this a good short-term moment to enter?

A stock scoring high on both is an ideal candidate: strong structural trend + a temporarily
oversold entry window.

---

## 2. Scoring Indicators

| Indicator / Metric | Condition for Max Points | Max Pts | Rationale |
|---|---|---|---|
| ADX (14) | ADX > 25 | 25 | Confirms an active macro trend is occurring, regardless of the directional indicator. |
| Aroon Up / Down Alignment | Aroon.Up ≥ 70 AND Aroon.Down ≤ 30 | 20 | Captures whether the stock is making fresh structural highs quicker than fresh structural lows. Explicitly filters out consolidating or decaying trends. |
| SMA Long-Term Alignment | SMA50 > SMA200 (Golden Cross state) | 20 | Confirms institutional backing where long-term buyers are continuously supporting the higher baseline. |
| Price vs SMA50 | Current Price (close) > SMA50 | 15 | Ensures the asset is trading above its primary intermediate psychological floor. |
| EMA Short-Term Alignment | EMA10 > EMA20 | 10 | Shows that immediate micro-momentum remains positive and aligned with the larger macro trend. |
| Volume Confirmation | Current Volume > average_volume_10d_calc | 10 | Verifies that the directional movement is backed by expanding transaction activity, ruling out low-liquidity spikes. |
| **Total** | | **100** | **85+ for a Structural Power-Trend** |

---

## 3. Aroon Scoring — Graduated Tiers

The Aroon indicator has three explicit tiers:

| Condition | Points |
|---|---|
| Aroon.Up ≥ 70 AND Aroon.Down ≤ 30 | **+20** — Strong bullish trend: fresh highs firing fast, lows dormant |
| Aroon.Up > Aroon.Down AND Aroon.Up ≥ 50 | **+10** — Emerging / weak bullish trend: positive bias but winding up |
| Aroon.Down ≥ Aroon.Up or both < 50 | **+0** — Bearish or consolidated: choppy, sideways market |

---

## 4. ADX Scoring — Graduated Tiers

The spec defines ADX > 25 as the "active trend" threshold. An intermediate tier rewards
emerging trends:

| Condition | Points |
|---|---|
| ADX > 25 | **+25** — Active macro trend confirmed |
| ADX 20–25 | **+12** — Trend emerging, building strength |
| ADX ≤ 20 | **+0** — No directional trend |

---

## 5. Exact Field Names

All names are verbatim TradingView screener field identifiers. Case-sensitive.

| TV Field Name | Display Name | Type |
|---|---|---|
| `ADX` | Average Directional Index (14) | number |
| `Aroon.Up` | Aroon Up (14) | number (0–100) |
| `Aroon.Down` | Aroon Down (14) | number (0–100) |
| `SMA50` | Simple Moving Average (50) | price |
| `SMA200` | Simple Moving Average (200) | price |
| `close` | Price | price |
| `EMA10` | Exponential Moving Average (10) | price |
| `EMA20` | Exponential Moving Average (20) | price |
| `volume` | Volume | number |
| `average_volume_10d_calc` | Average Volume (10d) | number |

---

## 6. Complete `TREND_STRENGTH_COLUMNS` Array

```js
const TREND_STRENGTH_COLUMNS = [
  // Trend power
  "ADX",
  // Structural high/low cadence
  "Aroon.Up", "Aroon.Down",
  // Long-term alignment
  "SMA50", "SMA200",
  // Price floor check + micro-momentum
  "close", "EMA10", "EMA20",
  // Volume
  "volume", "average_volume_10d_calc",
];
```

Note: `close`, `EMA20`, and `ADX` are almost certainly already in your columns array from other
score modules; add only the missing ones (`Aroon.Up`, `Aroon.Down`, `SMA50`, `SMA200`, `EMA10`,
`volume`).

---

## 7. Scoring Algorithm

```js
/**
 * Computes the Trend Strength Score (0–100).
 * Input: a parsed row object (keys = TV field names, values = numbers or null).
 * Returns: { total, breakdown, label, labelCode, flags }
 *
 * 'close', 'EMA20', 'ADX', 'average_volume_10d_calc' are typically already
 * present from other score modules — pass them through the same row object.
 */
export function computeTrendStrengthScore(r) {
  const breakdown = {};
  const flags     = [];

  // ── ADX (14) — 0–25 pts ──────────────────────────────────────────────────
  let adxPts = 0;
  const adx = r.ADX;
  if (adx != null) {
    if (adx > 25)      adxPts = 25;
    else if (adx > 20) adxPts = 12;
    else               flags.push('WEAK_ADX');
  }
  breakdown.ADX = adxPts;

  // ── Aroon Up / Down Alignment — 0–20 pts ─────────────────────────────────
  let aroonPts = 0;
  const aroonUp   = r['Aroon.Up'];
  const aroonDown = r['Aroon.Down'];
  if (aroonUp != null && aroonDown != null) {
    if (aroonUp >= 70 && aroonDown <= 30)          aroonPts = 20;
    else if (aroonUp > aroonDown && aroonUp >= 50) aroonPts = 10;
    else                                            flags.push('AROON_BEARISH');
  }
  breakdown.Aroon = aroonPts;

  // ── SMA Long-Term Alignment — 0–20 pts ───────────────────────────────────
  let smaPts = 0;
  const sma50  = r.SMA50;
  const sma200 = r.SMA200;
  if (sma50 != null && sma200 != null) {
    if (sma50 > sma200) smaPts = 20;
    else                flags.push('DEATH_CROSS');
  }
  breakdown.SMA_Alignment = smaPts;

  // ── Price vs SMA50 — 0–15 pts ────────────────────────────────────────────
  let priceSma50Pts = 0;
  const close = r.close;
  if (close != null && sma50 != null) {
    if (close > sma50) priceSma50Pts = 15;
    else               flags.push('BELOW_SMA50');
  }
  breakdown.Price_vs_SMA50 = priceSma50Pts;

  // ── EMA Short-Term Alignment — 0–10 pts ──────────────────────────────────
  let emaPts = 0;
  const ema10 = r.EMA10;
  const ema20 = r.EMA20;
  if (ema10 != null && ema20 != null) {
    if (ema10 > ema20) emaPts = 10;
  }
  breakdown.EMA_ShortTerm = emaPts;

  // ── Volume Confirmation — 0–10 pts ───────────────────────────────────────
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
  if      (total >= 85) { label = 'Structural Power-Trend'; labelCode = 'POWER'; }
  else if (total >= 55) { label = 'Moderate Trend';         labelCode = 'MODERATE'; }
  else                  { label = 'Non-Trending / Weak';    labelCode = 'WEAK'; }

  return { total, breakdown, label, labelCode, flags };
}
```

---

## 8. Score Reference Table

### Signal Interpretation

| Score | Label | labelCode | Meaning |
|---|---|---|---|
| 85–100 | Structural Power-Trend | `POWER` | Pristine trend alignment. Short-term, medium-term, and multi-week structural highs firing simultaneously. |
| 55–84 | Moderate Trend | `MODERATE` | Trend is positive but experiencing a cooling-off period or minor moving average divergence. |
| 0–54 | Non-Trending / Weak | `WEAK` | Caught in sideways chop or a definitive downtrend. Do not employ trend-following breakout strategies. |

---

## 9. Flags Reference

Flags are qualitative warnings appended to the result. They do **not** subtract points from the
score — they exist separately so the UI can surface them alongside the numeric grade.

| Flag | Trigger | Meaning |
|---|---|---|
| `WEAK_ADX` | ADX ≤ 20 | No directional trend — move may be random/sideways |
| `AROON_BEARISH` | Aroon.Down ≥ Aroon.Up or both < 50 | Structural lows firing faster than highs |
| `DEATH_CROSS` | SMA50 ≤ SMA200 | Long-term institutional support below baseline |
| `BELOW_SMA50` | close ≤ SMA50 | Price below intermediate psychological floor |
| `LOW_VOLUME` | volume ≤ avg_volume_10d | Move not backed by transaction activity |

---

## 10. Null Handling Strategy

TV returns `null` for fields that are unavailable. The scoring function skips null fields
silently — they contribute 0 points. A ticker with no technicals scores 0 and lands in the
`WEAK` band; treat a 0 with empty breakdown categories as "Insufficient Data" in the UI if
you need to distinguish it from a genuinely weak trend.

---

*End of briefing*
