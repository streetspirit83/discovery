/**
 * price-cluster.js — confluence zones ("Price Cluster") from all known levels.
 *
 * Collects every price level we already have per ticker (structural extremes,
 * SMAs, classic 1W/1M pivots, Demark, Donchian 20d, Bollinger, LS-history
 * lows) and merges nearby levels into support/resistance zones. The more —
 * and the more *diverse* — the levels inside a zone, the stronger it is.
 *
 * Pure module: no fetches, computed live from tv_data (+ optional LS history),
 * never persisted (SMAs/BB/pivots move with every TV fetch). All prices in the
 * ticker's native currency; the caller passes a native reference price.
 *
 * Start weights are transparent heuristics (not backtest-calibrated).
 */

// One level: { price, label, family, w }
function lvl(price, label, family, w) {
  return price != null && Number.isFinite(price) && price > 0 ? { price, label, family, w } : null;
}

/**
 * lsToNative: LS prices are ALWAYS EUR; TV levels are native currency. The
 * factor converts LS-derived levels into the levels' currency (EUR native →
 * 1, USD native → EUR/USD rate). `null` = no rate known → LS levels are
 * skipped rather than clustered at the wrong scale.
 */
export function collectLevels(tv, lsHistory = null, extraLevels = [], lsToNative = 1) {
  if (!tv) return [];
  const p = [];

  // Structural extremes (long-lived anchors)
  p.push(lvl(tv.high_all, 'ATH', 'struct', 3));
  p.push(lvl(tv.price_52_week_high, '52W-H', 'struct', 3));
  p.push(lvl(tv.price_52_week_low, '52W-T', 'struct', 3));
  p.push(lvl(tv.high_6m, 'H6M', 'struct', 2.5));
  p.push(lvl(tv.low_6m, 'L6M', 'struct', 2.5));
  p.push(lvl(tv.high_3m, 'H3M', 'struct', 2));
  p.push(lvl(tv.low_3m, 'L3M', 'struct', 2));
  p.push(lvl(tv.high_1m, 'H1M', 'struct', 1.5));
  p.push(lvl(tv.low_1m, 'L1M', 'struct', 1.5));

  // Moving averages (dynamic)
  p.push(lvl(tv.sma200, 'SMA200', 'ma', 3));
  p.push(lvl(tv.sma100, 'SMA100', 'ma', 2));
  p.push(lvl(tv.sma50, 'SMA50', 'ma', 1.5));
  p.push(lvl(tv.sma20, 'SMA20', 'ma', 1));

  // Classic pivots — monthly carries more weight than weekly
  p.push(lvl(tv.pivot_r1, 'R1|1M', 'pivotM', 2));
  p.push(lvl(tv.pivot_s1, 'S1|1M', 'pivotM', 2));
  p.push(lvl(tv.pivot_r2, 'R2|1M', 'pivotM', 1.5));
  p.push(lvl(tv.pivot_s2, 'S2|1M', 'pivotM', 1.5));
  p.push(lvl(tv.pivot_r3, 'R3|1M', 'pivotM', 1));
  p.push(lvl(tv.pivot_s3, 'S3|1M', 'pivotM', 1));
  p.push(lvl(tv.pivot_r1_1w, 'R1|1W', 'pivotW', 1));
  p.push(lvl(tv.pivot_s1_1w, 'S1|1W', 'pivotW', 1));
  p.push(lvl(tv.pivot_r2_1w, 'R2|1W', 'pivotW', 0.75));
  p.push(lvl(tv.pivot_s2_1w, 'S2|1W', 'pivotW', 0.75));
  p.push(lvl(tv.pivot_r3_1w, 'R3|1W', 'pivotW', 0.5));
  p.push(lvl(tv.pivot_s3_1w, 'S3|1W', 'pivotW', 0.5));
  p.push(lvl(tv.pivot_demark_r1_1w, 'DeM R1|1W', 'demark', 1.5));
  p.push(lvl(tv.pivot_demark_s1_1w, 'DeM S1|1W', 'demark', 1.5));

  // Breakout window + volatility bands
  p.push(lvl(tv.high_20d, 'high|20', 'donch', 1.5));
  p.push(lvl(tv.low_20d, 'low|20', 'donch', 1.5));
  p.push(lvl(tv.bb_upper, 'BB↑', 'bb', 1));
  p.push(lvl(tv.bb_lower, 'BB↓', 'bb', 1));

  // LS history: really-traded lows of the last 2 weeks (EUR → native via factor)
  if (Array.isArray(lsHistory) && lsHistory.length && lsToNative != null) {
    const dayLows = lsHistory.map((s) => s.day_low).filter((v) => v != null);
    if (dayLows.length) p.push(lvl(Math.min(...dayLows) * lsToNative, 'low|10 (LS)', 'ls', 1.5));
    let intraMin = null;
    for (const s of lsHistory) {
      for (const v of [s.day_low, ...(Array.isArray(s.series) ? s.series : [])]) {
        if (v != null && (intraMin == null || v < intraMin)) intraMin = v;
      }
    }
    if (intraMin != null) p.push(lvl(intraMin * lsToNative, '2W-Low (LS)', 'ls', 1.5));
  }

  // Caller-provided extras (e.g. confirmed bottom price, later: TD swing zones).
  // Extras marked lsPrice are EUR and follow the same conversion rule.
  for (const e of extraLevels) {
    if (e.lsPrice) {
      if (lsToNative != null) p.push(lvl(e.price * lsToNative, e.label, e.family ?? 'extra', e.w ?? 2));
    } else {
      p.push(lvl(e.price, e.label, e.family ?? 'extra', e.w ?? 2));
    }
  }

  return p.filter(Boolean);
}

/**
 * computePriceClusters(tv, { lsHistory, extraLevels, refPrice })
 * → { ref, atr, clusters:[{lo,hi,mid,score,side,members,distPct,distAtr}],
 *     nearestSup, nearestRes }
 *
 * Merge tolerance is ATR-normalised: neighbouring levels join a cluster while
 * the gap ≤ max(0.25×ATR, 0.3% of price) AND the zone stays narrower than
 * max(0.75×ATR, 1%) — the width cap stops chain-merging half the range.
 * Score = Σ weights × diversity bonus (+20% per additional level family,
 * capped at ×2): SMA200 + S1|1M + L3M beats three same-method pivots.
 */
export function computePriceClusters(tv, { lsHistory = null, extraLevels = [], refPrice = null, lsToNative = 1 } = {}) {
  const ref = refPrice ?? tv?.close_1m ?? tv?.close;
  if (ref == null) return null;
  const levels = collectLevels(tv, lsHistory, extraLevels, lsToNative).sort((a, b) => a.price - b.price);
  if (levels.length < 2) return null;

  const atr = tv.atr ?? null;
  const tol = Math.max(atr != null ? 0.25 * atr : 0, 0.003 * ref);
  const widthCap = Math.max(atr != null ? 0.75 * atr : 0, 0.01 * ref);

  const groups = [];
  let cur = [levels[0]];
  for (let i = 1; i < levels.length; i++) {
    const gap = levels[i].price - cur[cur.length - 1].price;
    const width = levels[i].price - cur[0].price;
    if (gap <= tol && width <= widthCap) cur.push(levels[i]);
    else { groups.push(cur); cur = [levels[i]]; }
  }
  groups.push(cur);

  const clusters = groups
    .filter((g) => g.length >= 2) // a lone level is no cluster
    .map((g) => {
      const lo = g[0].price, hi = g[g.length - 1].price;
      const wSum = g.reduce((s, x) => s + x.w, 0);
      const mid = g.reduce((s, x) => s + x.price * x.w, 0) / wSum;
      const famCount = new Set(g.map((x) => x.family)).size;
      const score = +(wSum * Math.min(2, 1 + 0.2 * (famCount - 1))).toFixed(1);
      const side = hi < ref ? 'sup' : lo > ref ? 'res' : 'at';
      const distPct = (mid - ref) / ref * 100;
      const distAtr = atr ? (mid - ref) / atr : null;
      return { lo, hi, mid, score, side, distPct, distAtr, members: g.map(({ label, price }) => ({ label, price })) };
    })
    .sort((a, b) => a.mid - b.mid);

  if (!clusters.length) return null;
  const sups = clusters.filter((c) => c.side === 'sup');
  const ress = clusters.filter((c) => c.side === 'res');
  return {
    ref,
    atr,
    clusters,
    nearestSup: sups.length ? sups[sups.length - 1] : null,
    nearestRes: ress.length ? ress[0] : null,
  };
}
