/**
 * trade-setup.js — Trade-view evaluation logic (pure, no network).
 *
 * Cluster classification (ATRP + MCap) drives the per-stock trade parameters
 * (ATR multiplier, profit target, volume basis), from which target price and
 * the long/short exit ladders are derived. Entry levels come from TV pivot
 * fields (1W/1M classic pivots) and the 20-day breakout level.
 *
 * Approximations (documented, since the TV scanner has no 22-bar fields):
 *   high|22 ≈ High.1M · low|22 ≈ Low.1M (1 Monat ≈ 21–22 Handelstage)
 *   ATR|22  ≈ ATR (TV liefert nur die Standard-ATR(14))
 */

// Technical stops must sit just below their support, never on it (native units).
export const STOP_PAD = 0.02;

export const CLUSTERS = [
  { key: 'stable',   label: 'Stable',   atrMult: 1.5, gainPct: 5,  volBasis: '30d' },
  { key: 'moderate', label: 'Moderate', atrMult: 2.0, gainPct: 10, volBasis: '30d' },
  { key: 'momentum', label: 'Momentum', atrMult: 2.1, gainPct: 18, volBasis: '10d' },
  { key: 'hyper',    label: 'Hyper',    atrMult: 1.0, gainPct: 30, volBasis: '10d' },
];

// ATRP bands: <4 · 4–6 · 6.1–10 · >10  (fully covering, no gaps)
function atrpIdx(atrp) {
  if (atrp < 4)  return 0;
  if (atrp <= 6) return 1;
  if (atrp <= 10) return 2;
  return 3;
}

// MCap bands: >50B · 10–50B · 2–10B · <2B
function mcapIdx(mc) {
  if (mc > 50e9) return 0;
  if (mc >= 10e9) return 1;
  if (mc >= 2e9)  return 2;
  return 3;
}

/**
 * Classify a stock into a trade cluster from tv_data.
 * ATRP is weighted double (volatility defines the trade regime), MCap single —
 * when the two bands disagree the blended index is rounded to the nearest
 * cluster. Falls back to the single available metric if one is missing.
 */
export function classifyCluster(tv) {
  if (!tv) return null;
  const a = tv.atrp       != null ? atrpIdx(tv.atrp)       : null;
  const m = tv.market_cap != null ? mcapIdx(tv.market_cap) : null;
  if (a == null && m == null) return null;
  const idx = a == null ? m : m == null ? a : Math.round((2 * a + m) / 3);
  const cl = CLUSTERS[idx];
  const avgVol = cl.volBasis === '30d'
    ? (tv.average_volume_30d_calc ?? tv.avg_vol_10d ?? null)
    : (tv.avg_vol_10d ?? tv.average_volume_30d_calc ?? null);
  return { ...cl, idx, atrpIdx: a, mcapIdx: m, avgVol };
}

/** Target: Kurs + 1 × Cluster-Gewinnziel (native currency). */
export function tradeTarget(tv, cluster = classifyCluster(tv)) {
  const close = tv?.close_1m ?? tv?.close;
  if (close == null || cluster == null) return null;
  return close * (1 + cluster.gainPct / 100);
}

/** 20-day breakout entry: high|20 + 0.01 %. */
export function breakoutEntry(tv) {
  return tv?.high_20d != null ? tv.high_20d * 1.0001 : null;
}

/** Classic pivots (1W + 1M) as fetched from TV. R1|1M etc. reuse the existing
 *  monthly pivot fields (pivot_r1/r2/s1/s2 were always Pivot.M.Classic|1M). */
export function pivotSet(tv) {
  if (!tv) return null;
  const w = {
    r1: tv.pivot_r1_1w ?? null, r2: tv.pivot_r2_1w ?? null, r3: tv.pivot_r3_1w ?? null,
    s1: tv.pivot_s1_1w ?? null, s2: tv.pivot_s2_1w ?? null, s3: tv.pivot_s3_1w ?? null,
  };
  const m = {
    r1: tv.pivot_r1 ?? null, r2: tv.pivot_r2 ?? null, r3: tv.pivot_r3 ?? null,
    s1: tv.pivot_s1 ?? null, s2: tv.pivot_s2 ?? null, s3: tv.pivot_s3 ?? null,
  };
  const any = [...Object.values(w), ...Object.values(m)].some((v) => v != null);
  return any ? { w, m } : null;
}

/* LS-history helpers for the short-exit ladder (10 trading days ≈ 2 weeks). */
function lsLow10(snapshots) {
  const lows = (snapshots ?? []).map((s) => s.day_low).filter((v) => v != null);
  return lows.length ? Math.min(...lows) : null;
}
// Absolute lowest intraday print over the LS 2-week window (finer than day_low
// where the downsampled series dips below it; both are considered).
function ls2wLow(snapshots) {
  let min = null;
  for (const s of snapshots ?? []) {
    for (const v of [s.day_low, ...(Array.isArray(s.series) ? s.series : [])]) {
      if (v != null && (min == null || v < min)) min = v;
    }
  }
  return min;
}

/**
 * Exit ladders. Each entry: { key, label, value }.
 * Support-derived stops get the −0.02 pad; Chandelier/momentum formulas do not
 * (they are computed trigger levels, not support levels).
 */
export function exitLevels(tv, cluster = classifyCluster(tv), snapshots = null) {
  if (!tv) return null;
  const atr = tv.atr;
  const half = atr != null ? 0.5 * atr : null;
  const mult = cluster?.atrMult ?? null;

  const long = [];
  if (tv.low_3m != null && half != null)  long.push({ key: 'l3m',      label: 'L3M − 0,5×ATR',    value: tv.low_3m - half - STOP_PAD });
  if (tv.sma200 != null && half != null)  long.push({ key: 'sma200',   label: 'SMA200 − 0,5×ATR', value: tv.sma200 - half - STOP_PAD });
  if (tv.high_1m != null && atr != null && mult != null)
    long.push({ key: 'chand', label: `Chandelier (high|22 − ${mult}×ATR)`, value: tv.high_1m - atr * mult });

  const short = [];
  const l10 = lsLow10(snapshots);
  if (l10 != null)                        short.push({ key: 'low10',   label: 'low|10 (LS)',      value: l10 - STOP_PAD });
  if (tv.sma20 != null && half != null)   short.push({ key: 'sma20mom',label: 'SMA20-MOM (SMA20 − 0,5×ATR)', value: tv.sma20 - half });
  const l2w = ls2wLow(snapshots);
  if (l2w != null)                        short.push({ key: 'low2w',   label: '2W-Low (LS, absolut)', value: l2w - STOP_PAD });
  if (tv.low_1m != null && half != null)  short.push({ key: 'l1m',     label: 'L1M − 0,5×ATR',    value: tv.low_1m - half - STOP_PAD });
  if (tv.low_1m != null && atr != null && mult != null)
    short.push({ key: 'chand', label: `Chandelier (low|22 + ${mult}×ATR)`, value: tv.low_1m + atr * mult });

  if (!long.length && !short.length) return null;
  // Primary stops must sit on the correct side of the current price: a long
  // stop below it (tightest = highest), a short stop above it (tightest =
  // lowest). Levels on the wrong side (e.g. Chandelier when the price sits far
  // off the 1M extreme) stay in the list/tooltip but can't be the headline.
  const close = tv.close_1m ?? tv.close;
  const below = close != null ? long.filter((x) => x.value < close) : long;
  const above = close != null ? short.filter((x) => x.value > close) : short;
  const primaryLong = below.length ? below.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const primaryShort = above.length ? above.reduce((a, b) => (b.value < a.value ? b : a))
    : (short.find((x) => x.key === 'chand') ?? null);
  return { long, short, primaryLong, primaryShort };
}
