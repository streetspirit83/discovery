/**
 * ls-history-signals.js — signals derived from the nightly LS snapshot history
 * (docs/BREAKOUT_PROBABILITY_SPEC.md · docs/BREAKDOWN_PROBABILITY_SPEC.md).
 *
 * Input: `history[candidateId].snapshots[]` from the discovery-ls-history blob
 * (written by netlify snapshot-ls, 10-day rolling window, oldest → newest):
 *   { date, close, prev_close, change_pct, day_low, day_high, series, volume }
 *
 * All functions are pure — no API calls. The probability numbers are
 * HEURISTICS (start weights per spec, not backtest-calibrated) and never a
 * statistically calibrated probability; they are capped at 90.
 */

// Minimum history window for meaningful stats (bottom detection needs 6).
// The nightly snapshot adds one day per weekday — a freshly started history
// needs about a trading week before the signals switch on.
export const MIN_SNAPSHOTS = 5;
export const MIN_SNAPSHOTS_BOTTOM = 6;
export const MAX_SNAPSHOTS = 10; // rolling window size written by snapshot-ls

function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Least-squares slope over index positions (per-day change of the metric).
function slope(values) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return null;
  const n = pts.length;
  const sx = pts.reduce((s, [x]) => s + x, 0);
  const sy = pts.reduce((s, [, y]) => s + y, 0);
  const sxy = pts.reduce((s, [x, y]) => s + x * y, 0);
  const sxx = pts.reduce((s, [x]) => s + x * x, 0);
  const den = n * sxx - sx * sx;
  return den === 0 ? null : (n * sxy - sx * sy) / den;
}

/* 1-Day Money Flow approximation (no native MFI/OBV/AD in the TV scanner):
 * MFM = ((close−low)−(high−close)) / (high−low);  MFV = MFM × volume.
 * Shared by breakout AND breakdown detection (spec: reuse, don't duplicate). */
function moneyFlowMultiplier(s) {
  if (s.close == null || s.day_high == null || s.day_low == null) return null;
  const range = s.day_high - s.day_low;
  if (range <= 0) return 0;
  return ((s.close - s.day_low) - (s.day_high - s.close)) / range;
}
function moneyFlowVolume(s) {
  const m = moneyFlowMultiplier(s);
  return m != null && s.volume != null ? m * s.volume : null;
}

function dayRanges(snapshots) {
  return snapshots
    .map((s) => (s.day_high != null && s.day_low != null && s.close ? (s.day_high - s.day_low) / s.close : null))
    .filter((v) => v != null && v >= 0);
}

function volumes(snapshots) {
  return snapshots.map((s) => s.volume).filter((v) => v != null && v > 0);
}

/**
 * detectBreakoutSetup(snapshots, avgVolRef?) → probability of a breakout in
 * the next ~10 days. avgVolRef = external volume basis (e.g. the cluster's
 * avg V10d/V30d from TV); falls back to the window median.
 */
export function detectBreakoutSetup(snapshots, avgVolRef = null) {
  if (!Array.isArray(snapshots) || snapshots.length < MIN_SNAPSHOTS) return null;

  const ranges = dayRanges(snapshots);
  const vols = volumes(snapshots);
  const last = snapshots[snapshots.length - 1];

  // 1. Extended narrow range: window consistently tight, no outlier days.
  //    (Blob window is 10D; the "2+ weeks" of the spec maxes out this window.)
  const medRange = median(ranges);
  const extendedNarrowRange = ranges.length >= MIN_SNAPSHOTS && medRange > 0
    && Math.max(...ranges) < 1.5 * medRange;

  // 2. Volume confirmation: upside outlier at the end of the window vs. the
  //    reference average (cluster basis or window median).
  const volRef = avgVolRef ?? median(vols);
  const lastVol = last.volume ?? null;
  const last3 = vols.slice(-3);
  const volSpikeRatio = lastVol != null && volRef > 0 ? lastVol / volRef : null;
  const avg3Ratio = last3.length === 3 && volRef > 0 ? (last3.reduce((a, b) => a + b, 0) / 3) / volRef : null;
  const volumeConfirmation = (volSpikeRatio != null && volSpikeRatio >= 1.5)
    || (avg3Ratio != null && avg3Ratio >= 1.3);

  // Bullish 1-day money flow on the last day (clearly positive MFM, not just >0).
  const lastMFM = moneyFlowMultiplier(last);
  const lastDayMFV = moneyFlowVolume(last);
  const moneyFlowBullish = lastMFM != null && lastMFM > 0.2;

  // 4. Flat top + rising lows = bull flag / ascending triangle.
  const highs = snapshots.map((s) => s.day_high).filter((v) => v != null);
  const lows = snapshots.map((s) => s.day_low).filter((v) => v != null);
  const cluster = highs.slice(-4);
  const cMean = cluster.length ? cluster.reduce((a, b) => a + b, 0) / cluster.length : null;
  const flatTop = cluster.length >= 3 && cMean > 0
    && cluster.every((h) => Math.abs(h - cMean) / cMean <= 0.01);
  const lowsSlope = slope(lows);
  const risingLows = lowsSlope != null && lowsSlope > 0;
  const flatTopBullFlag = flatTop && risingLows;

  // NOTE: high RSI / overbought is deliberately NOT penalised — overbought
  // stocks can and do break out even higher (spec §3). No RSI term here.

  // Heuristic start weights (flat-top pattern + volume weighted highest).
  let pct = 0;
  if (extendedNarrowRange) pct += 20;
  if (volumeConfirmation)  pct += 30;
  if (moneyFlowBullish)    pct += 15;
  if (flatTopBullFlag)     pct += 30;
  pct = Math.min(90, pct); // never 100 — heuristic, no guarantee

  return {
    breakoutProbabilityPct: pct,
    criteria: { extendedNarrowRange, volumeConfirmation, moneyFlowBullish, flatTopBullFlag },
    details: {
      rangeStats: { min: ranges.length ? Math.min(...ranges) : null, max: ranges.length ? Math.max(...ranges) : null, median: medRange },
      volSpikeRatio,
      lastDayMFV,
      highsCluster: cluster,
      lowsSlope,
    },
  };
}

/**
 * detectBreakdownRisk(snapshots, avgVolRef?) → probability of a breakdown in
 * the next ~10 days (exhaustion patterns after a rally).
 */
export function detectBreakdownRisk(snapshots, avgVolRef = null) {
  if (!Array.isArray(snapshots) || snapshots.length < MIN_SNAPSHOTS) return null;

  const vols = snapshots.map((s) => s.volume ?? null);
  const volRef = avgVolRef ?? median(volumes(snapshots));
  const changes = snapshots.map((s) => s.change_pct ?? null);
  const last = snapshots[snapshots.length - 1];

  // 1. Single high-volume day without follow-through: spike (>2× ref),
  //    ideally in the last 5-7 days, then weak volume + no price progress.
  let volumeSpikeIdx = null;
  for (let i = snapshots.length - 2; i >= 0; i--) { // need ≥1 follow day
    const v = vols[i];
    if (v != null && volRef > 0 && v > 2 * volRef) { volumeSpikeIdx = i; break; }
  }
  let spikeVolume = null, followVolumeAvg = null, followPriceChangeAvg = null;
  let volumeSpikeNoFollowThrough = false;
  if (volumeSpikeIdx != null) {
    spikeVolume = vols[volumeSpikeIdx];
    const fVols = vols.slice(volumeSpikeIdx + 1).filter((v) => v != null);
    const fChgs = changes.slice(volumeSpikeIdx + 1).filter((v) => v != null);
    if (fVols.length) followVolumeAvg = fVols.reduce((a, b) => a + b, 0) / fVols.length;
    if (fChgs.length) followPriceChangeAvg = fChgs.reduce((a, b) => a + b, 0) / fChgs.length;
    const spikeDir = Math.sign(snapshots[volumeSpikeIdx].change_pct ?? 0) || 1;
    volumeSpikeNoFollowThrough = fVols.length >= 1
      && fVols.every((v) => v < 0.6 * spikeVolume)
      && followPriceChangeAvg != null
      && spikeDir * followPriceChangeAvg <= 0.1; // no progress in spike direction
  }

  // 2. Distribution day: high volume but flat price (and MFV ≈ 0 / negative)
  //    within the last 5 days of the window.
  const distributionDays = [];
  for (const s of snapshots.slice(-5)) {
    const volRatio = s.volume != null && volRef > 0 ? s.volume / volRef : null;
    const priceMove = s.change_pct != null ? Math.abs(s.change_pct) : null;
    if (volRatio != null && priceMove != null && volRatio > 1.5 && priceMove < 0.5) {
      distributionDays.push({ date: s.date, volRatio, priceMove, mfv: moneyFlowVolume(s) });
    }
  }
  const distributionDay = distributionDays.length > 0;

  // 3. Context: price still near the window high — weighting factor only,
  //    counted solely when an exhaustion criterion (1/2) fired.
  const maxHigh = Math.max(...snapshots.map((s) => s.day_high ?? -Infinity));
  const lastClose = last.close ?? null;
  const distFromHighPct = (Number.isFinite(maxHigh) && maxHigh > 0 && lastClose != null)
    ? (maxHigh - lastClose) / maxHigh * 100 : null;
  const nearRecentHigh = distFromHighPct != null && distFromHighPct < 3
    && (volumeSpikeNoFollowThrough || distributionDay);

  // Heuristic start weights per spec: +35 / +35 / +20, capped at 90.
  let pct = 0;
  if (volumeSpikeNoFollowThrough) pct += 35;
  if (distributionDay)            pct += 35;
  if (nearRecentHigh)             pct += 20;
  pct = Math.min(90, pct);

  return {
    breakdownProbabilityPct: pct,
    criteria: { volumeSpikeNoFollowThrough, distributionDay, nearRecentHigh },
    details: { volumeSpikeIdx, spikeVolume, followVolumeAvg, followPriceChangeAvg, distributionDays, distFromHighPct },
  };
}

/**
 * detectBottomSignal(snapshots) → bottom-stabilization label from the 10-day
 * LS history: all four sub-criteria must hold —
 *   1. trend flattening (downtrend levelling out)
 *   2. declining volume near support
 *   3. candle shift bearish → neutral/positive
 *   4. intraday range compression
 * Bottom price = confirmed swing low (reaction low with ≥2 higher follow-up
 * closes), else the capitulation low (day_low of the highest-volume day).
 */
export function detectBottomSignal(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length < MIN_SNAPSHOTS_BOTTOM) return null;

  const closes = snapshots.map((s) => s.close ?? null);
  const vols = snapshots.map((s) => s.volume ?? null);
  const lows = snapshots.map((s) => s.day_low ?? null);
  const half = Math.floor(snapshots.length / 2);

  // 1. Trend flattening: first half clearly falling, last 3 days flat or up.
  const earlySlope = slope(closes.slice(0, half + 1));
  const lateSlope = slope(closes.slice(-3));
  const lastClose = closes[closes.length - 1];
  const flatTol = lastClose != null ? lastClose * 0.002 : 0; // ~0.2 %/day
  const trendFlattening = earlySlope != null && lateSlope != null
    && earlySlope < 0 && lateSlope >= -flatTol;

  // 2. Declining volume near support: volume trending down over the last 5
  //    days AND price within 3 % of the window low.
  const volSlope = slope(vols.slice(-5));
  const minLow = Math.min(...lows.filter((v) => v != null));
  const decliningVolumeNearSupport = volSlope != null && volSlope < 0
    && Number.isFinite(minLow) && lastClose != null && lastClose <= minLow * 1.03;

  // 3. Candle shift: majority of the first half bearish, last 2 days
  //    neutral/positive (change_pct and money-flow multiplier both non-negative-ish).
  const earlyChgs = snapshots.slice(0, half).map((s) => s.change_pct).filter((v) => v != null);
  const bearishEarly = earlyChgs.length >= 2
    && earlyChgs.filter((v) => v < 0).length > earlyChgs.length / 2;
  const lastTwo = snapshots.slice(-2);
  const candleShift = bearishEarly && lastTwo.every((s) => {
    const chgOk = s.change_pct == null || s.change_pct >= -0.2;
    const mfm = moneyFlowMultiplier(s);
    const mfmOk = mfm == null || mfm >= -0.1;
    return chgOk && mfmOk && (s.change_pct != null || mfm != null);
  });

  // 4. Range compression: avg intraday range of the last 3 days < 0.7× before.
  const ranges = dayRanges(snapshots);
  const lastR = ranges.slice(-3);
  const priorR = ranges.slice(0, -3);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const rangeCompression = lastR.length === 3 && priorR.length >= 2
    && avg(lastR) < 0.7 * avg(priorR);

  const isBottom = trendFlattening && decliningVolumeNearSupport && candleShift && rangeCompression;

  // Bottom price: confirmed swing low — the reaction low followed by ≥2
  // consecutively higher closes; fallback: capitulation low (max-volume day).
  let bottomPrice = null, basis = null;
  let lowIdx = -1;
  lows.forEach((v, i) => { if (v != null && (lowIdx < 0 || v < lows[lowIdx])) lowIdx = i; });
  if (lowIdx >= 0 && lowIdx <= closes.length - 3
      && closes[lowIdx + 1] != null && closes[lowIdx + 2] != null
      && closes[lowIdx + 1] > closes[lowIdx] && closes[lowIdx + 2] > closes[lowIdx + 1]) {
    bottomPrice = lows[lowIdx];
    basis = 'swing-low';
  } else {
    let volIdx = -1;
    vols.forEach((v, i) => { if (v != null && (volIdx < 0 || v > vols[volIdx])) volIdx = i; });
    if (volIdx >= 0 && lows[volIdx] != null) { bottomPrice = lows[volIdx]; basis = 'capitulation'; }
  }

  return {
    isBottom,
    bottomPrice,
    basis,
    criteria: { trendFlattening, decliningVolumeNearSupport, candleShift, rangeCompression },
  };
}
