/**
 * dashboard-metrics.js — pure, DOM-free aggregations for the Monitor dashboard.
 *
 * Every function takes the raw candidate list of the active bucket. Scores are
 * computed live from each candidate's `tv_data`; day-over-day dynamics use the
 * per-day closing series in `tv_data.snapshot` (written by tv-enrichment): the
 * delta of any score is its live value minus the most recent *previous-day*
 * closing value, yielding a gapless time series.
 *
 * Functions return fully-sorted arrays (no slicing) so the modal can grow each
 * list on demand ("mehr").
 */

import { computeOverallScore }  from './tv-overall-score.js';
import { computeEntryScore }    from './tv-entry-score.js';
import { computeHealthScore }   from './tv-health-score.js';
import { computeMomentumCheck } from './tv-momentum-check.js';
import { monthlyGrowthRate }    from './tv-upside.js';
import { isAlertTriggered }     from './alerts.js';
import { alertDir }             from './status-logic.js?v=20260704e';

/* ── Live score helpers (mirror candidate-list's live* derivations) ───────── */

export function liveEntryScore(tv) {
  if (!tv) return null;
  if (tv.entry_score) return tv.entry_score;
  return computeEntryScore({
    RSI:           tv.rsi,
    'MACD.macd':   tv.macd,
    'MACD.signal': tv.macd_signal,
    'Stoch.K':     tv.stoch_k,
    'Stoch.D':     tv.stoch_d,
    close:         tv.close,
    EMA20:         tv.ema20,
    'BB.lower':    tv.bb_lower,
  });
}

export function liveHealthScore(tv) {
  if (!tv) return null;
  const hs = tv.health_score;
  if (hs && hs.breakdown && 'A_Size' in hs.breakdown) return hs;
  return computeHealthScore({
    market_cap_basic:              tv.market_cap,
    ebitda:                        tv.ebitda,
    total_revenue_yoy_growth_ttm:  tv.total_revenue_yoy_growth_ttm,
    ebitda_yoy_growth_ttm:         tv.ebitda_yoy_growth_ttm,
    free_cash_flow_yoy_growth_ttm: tv.free_cash_flow_yoy_growth_ttm,
    operating_margin:              tv.operating_margin,
    debt_to_equity:                tv.debt_to_equity,
    total_debt_to_ebitda_fy:       tv.total_debt_to_ebitda_fy,
  });
}

export function liveOverallScore(tv) {
  if (!tv) return null;
  return computeOverallScore({
    perfW:         tv.perf_w,
    perf1M:        tv.perf_1m,
    change1D:      tv.change_1d,
    ebitdaGrowth:  tv.ebitda_yoy_growth_fy ?? tv.ebitda_yoy_growth_ttm,
    rating1M:      tv.recommend_all_1m,
    trendStrength: tv.trend_strength_score?.total,
    entry:         liveEntryScore(tv)?.total,
    health:        liveHealthScore(tv)?.total,
    cycle:         tv.cycle_score?.total,
  });
}

export const macdHist = (tv) =>
  (tv?.macd != null && tv?.macd_signal != null ? +(tv.macd - tv.macd_signal).toFixed(4) : null);

/* ── Internal: one derived row per candidate, with day-over-day deltas ────── */

const dayOf = (s) => s?.d ?? (s?.at ? String(s.at).slice(0, 10) : null);
const delta = (a, b) => (a != null && b != null ? a - b : null);

function derive(candidates) {
  return (candidates ?? [])
    .filter((c) => c && c.tv_data)
    .map((c) => {
      const tv = c.tv_data;
      const snap = Array.isArray(tv.snapshot) ? tv.snapshot : [];
      const today = (tv.fetched_at ?? '').slice(0, 10);
      const prev = (key) => {
        const r = snap.find((s) => dayOf(s) !== today);
        return r ? (r[key] ?? null) : null;
      };
      const ov = liveOverallScore(tv);
      const mc = computeMomentumCheck(tv);
      const overall = ov?.total ?? null;
      const mom = mc?.total ?? null;
      const pchs = tv.cycle_score?.total ?? null;
      const mh = macdHist(tv);
      return {
        c, tv, symbol: c.symbol, exchange: c.exchange,
        overall, overallLabel: ov?.labelCode ?? null,
        mom, momVerdict: mc?.verdict ?? null,
        pchs, pchsLabel: tv.cycle_score?.labelCode ?? null,
        rsi: tv.rsi ?? null,
        mh, mhPrev: prev('macd_hist'),
        dOverall: delta(overall, prev('overall')),
        dMom:     delta(mom, prev('mom')),
        dPchs:    delta(pchs, prev('cycle')),
      };
    });
}

/* Split rows into risers/fallers by a delta field; plus a `leaders` fallback
 * (sorted by the current value) so a card is never empty on day one. */
function movers(rows, deltaKey, valueKey) {
  const withDelta = rows.filter((r) => r[deltaKey] != null && r[deltaKey] !== 0);
  return {
    risers:  withDelta.filter((r) => r[deltaKey] > 0).sort((a, b) => b[deltaKey] - a[deltaKey]),
    fallers: withDelta.filter((r) => r[deltaKey] < 0).sort((a, b) => a[deltaKey] - b[deltaKey]),
    leaders: rows.filter((r) => r[valueKey] != null).sort((a, b) => b[valueKey] - a[valueKey]),
  };
}

/* ── Pulse line (header aggregate) ────────────────────────────────────────── */

export function pulse(candidates) {
  const all = candidates ?? [];
  const rows = derive(all).filter((r) => r.overall != null);
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.overall, 0) / rows.length) : null;

  let improved = 0, declined = 0, stable = 0;
  for (const r of rows) {
    if (r.dOverall == null) continue;
    if (r.dOverall > 0) improved++;
    else if (r.dOverall < 0) declined++;
    else stable++;
  }

  let buy = 0, sell = 0;
  for (const c of all) {
    for (const a of (c.alerts ?? [])) {
      if (a.enabled === false) continue;
      try { if (!isAlertTriggered(c, a)) continue; } catch { continue; }
      const d = alertDir(a);
      if (d === 'buy') buy++;
      else if (d === 'sell') sell++;
    }
  }

  let lastFetch = null;
  for (const c of all) {
    const at = c.tv_data?.fetched_at;
    if (at && (!lastFetch || at > lastFetch)) lastFetch = at;
  }

  return { total: all.length, scored: rows.length, avg, improved, declined, stable, buy, sell, lastFetch };
}

/* ── Score / Momentum / PCHS dynamics (Δ vs. previous day) ────────────────── */

export const scoreMovers = (candidates) => movers(derive(candidates), 'dOverall', 'overall');
export const momMovers   = (candidates) => movers(derive(candidates), 'dMom', 'mom');
export const pchsMovers   = (candidates) => movers(derive(candidates), 'dPchs', 'pchs');

/* ── Performance momentum (1W / 1M / 3M) ──────────────────────────────────── */

const PERF_KEYS = { '1W': 'perf_w', '1M': 'perf_1m', '3M': 'perf_3m' };

export function perfLeaders(candidates, window = '1W') {
  const key = PERF_KEYS[window] ?? 'perf_w';
  const rows = derive(candidates).map((r) => ({ ...r, perf: r.tv[key] })).filter((r) => r.perf != null);
  return {
    gainers: rows.slice().sort((a, b) => b.perf - a.perf).filter((r) => r.perf > 0),
    losers:  rows.slice().sort((a, b) => a.perf - b.perf).filter((r) => r.perf < 0),
  };
}

/* ── MACD flips (sign change of the histogram vs. previous day) ───────────── */

export function macdFlips(candidates) {
  const rows = derive(candidates).filter((r) => r.mh != null && r.mhPrev != null);
  return {
    bullish: rows.filter((r) => r.mhPrev <= 0 && r.mh > 0).sort((a, b) => b.mh - a.mh),
    bearish: rows.filter((r) => r.mhPrev > 0 && r.mh <= 0).sort((a, b) => a.mh - b.mh),
  };
}

/* ── RSI extremes ─────────────────────────────────────────────────────────── */

export function rsiExtremes(candidates) {
  const rows = derive(candidates).filter((r) => r.rsi != null);
  return {
    oversold:   rows.filter((r) => r.rsi <= 30).sort((a, b) => a.rsi - b.rsi),
    overbought: rows.filter((r) => r.rsi >= 70).sort((a, b) => b.rsi - a.rsi),
  };
}

/* ── SMA crosses (price × SMA and SMA × SMA, vs. previous day) ────────────────
 * Price crosses work from day one: the previous close is taken from the snapshot
 * or derived from today's 1D change; the SMA line itself drifts so slowly that
 * falling back to today's value barely moves it. SMA×SMA crosses need yesterday's
 * SMAs in the snapshot, so they appear from the second enrichment day onward. */

const SMA_PERIODS = [20, 50, 100, 200];
const SMA_PAIRS = [[20, 50], [50, 100], [50, 200], [100, 200]];

// Ranking weight: heavier lines first (Golden/Death > Kurs×200 > … > Kurs×20).
const PRICE_WEIGHT = { 200: 90, 100: 70, 50: 60, 20: 30 };
const PAIR_WEIGHT  = { '50x200': 100, '100x200': 80, '50x100': 50, '20x50': 40 };

export function smaCrosses(candidates) {
  const bullish = [], bearish = [];
  for (const c of candidates ?? []) {
    const tv = c?.tv_data;
    if (!tv || tv.close == null) continue;
    const snap = Array.isArray(tv.snapshot) ? tv.snapshot : [];
    const today = (tv.fetched_at ?? '').slice(0, 10);
    const prevRec = snap.find((s) => dayOf(s) !== today) ?? null;
    const prevClose = prevRec?.close ??
      (tv.change_1d != null ? tv.close / (1 + tv.change_1d / 100) : null);

    const crosses = [];
    for (const p of SMA_PERIODS) {
      const sma = tv['sma' + p];
      if (sma == null || prevClose == null) continue;
      const prevSma = prevRec?.['sma' + p] ?? sma;
      const now = tv.close - sma, before = prevClose - prevSma;
      const dist = ((tv.close - sma) / sma) * 100;
      if (before <= 0 && now > 0)
        crosses.push({ dir: 1, label: `Kurs↑SMA${p}`, weight: PRICE_WEIGHT[p], dist });
      else if (before >= 0 && now < 0)
        crosses.push({ dir: -1, label: `Kurs↓SMA${p}`, weight: PRICE_WEIGHT[p], dist });
    }
    for (const [f, s] of SMA_PAIRS) {
      const fv = tv['sma' + f], sv = tv['sma' + s];
      const pf = prevRec?.['sma' + f], ps = prevRec?.['sma' + s];
      if (fv == null || sv == null || pf == null || ps == null) continue;
      const now = fv - sv, before = pf - ps;
      const weight = PAIR_WEIGHT[`${f}x${s}`];
      const golden = f === 50 && s === 200;
      const dist = ((fv - sv) / sv) * 100;
      if (before <= 0 && now > 0)
        crosses.push({ dir: 1, label: golden ? 'Golden Cross' : `SMA${f}↑SMA${s}`, weight, dist });
      else if (before >= 0 && now < 0)
        crosses.push({ dir: -1, label: golden ? 'Death Cross' : `SMA${f}↓SMA${s}`, weight, dist });
    }

    // One row per candidate & direction: heaviest cross is the headline,
    // further same-day crosses are only counted (`more`).
    for (const dir of [1, -1]) {
      const hits = crosses
        .filter((x) => x.dir === dir)
        .sort((a, b) => b.weight - a.weight || Math.abs(b.dist) - Math.abs(a.dist));
      if (!hits.length) continue;
      (dir > 0 ? bullish : bearish).push({
        c, tv, symbol: c.symbol, exchange: c.exchange,
        label: hits[0].label, dist: hits[0].dist, weight: hits[0].weight,
        more: hits.length - 1,
      });
    }
  }
  const rank = (a, b) => b.weight - a.weight || Math.abs(b.dist) - Math.abs(a.dist);
  return { bullish: bullish.sort(rank), bearish: bearish.sort(rank) };
}

/* ── Trends: positive / negative across 1W·1M·3M, ranked by avg monthly growth */

export function trends(candidates) {
  const rows = derive(candidates).map((r) => ({ ...r, ogrm: monthlyGrowthRate(r.tv.perf_6m, 6) }));
  return {
    clean:  rows.filter((r) => r.tv.perf_w > 0 && r.tv.perf_1m > 0 && r.tv.perf_3m > 0)
                .sort((a, b) => (b.ogrm ?? -Infinity) - (a.ogrm ?? -Infinity)),
    broken: rows.filter((r) => r.tv.perf_w < 0 && r.tv.perf_1m < 0 && r.tv.perf_3m < 0)
                .sort((a, b) => (a.ogrm ?? Infinity) - (b.ogrm ?? Infinity)),
  };
}
