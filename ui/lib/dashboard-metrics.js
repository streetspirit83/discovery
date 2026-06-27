/**
 * dashboard-metrics.js — pure, DOM-free aggregations for the Monitor dashboard.
 *
 * Every function takes the raw candidate list of the active bucket and returns
 * small, ready-to-render result objects. Scores are computed live from each
 * candidate's `tv_data`; score deltas use the most recent `tv_data.snapshot`
 * entry (written by tv-enrichment on the previous fetch).
 */

import { computeOverallScore }  from './tv-overall-score.js';
import { computeEntryScore }    from './tv-entry-score.js';
import { computeHealthScore }   from './tv-health-score.js';
import { computeMomentumCheck } from './tv-momentum-check.js';
import { monthlyGrowthRate }    from './tv-upside.js';
import { isAlertTriggered }     from './alerts.js';
import { alertDir }             from './status-logic.js?v=20260626f';

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

/* ── Internal: one derived row per candidate ──────────────────────────────── */

function derive(candidates) {
  return (candidates ?? [])
    .filter((c) => c && c.tv_data)
    .map((c) => {
      const tv = c.tv_data;
      const ov = liveOverallScore(tv);
      const snap = Array.isArray(tv.snapshot) ? tv.snapshot[0] : null;
      const overall = ov?.total ?? null;
      const prev = snap?.overall ?? null;
      return {
        c,
        tv,
        symbol:   c.symbol,
        exchange: c.exchange,
        overall,
        label:    ov?.labelCode ?? null,
        prev,
        delta:    overall != null && prev != null ? overall - prev : null,
      };
    });
}

const byDeltaDesc = (a, b) => b.delta - a.delta;

/* ── Pulse line (header aggregate) ────────────────────────────────────────── */

export function pulse(candidates) {
  const all = candidates ?? [];
  const rows = derive(all).filter((r) => r.overall != null);
  const avg = rows.length
    ? Math.round(rows.reduce((s, r) => s + r.overall, 0) / rows.length)
    : null;

  let improved = 0, declined = 0, stable = 0;
  for (const r of rows) {
    if (r.delta == null) continue;
    if (r.delta > 0) improved++;
    else if (r.delta < 0) declined++;
    else stable++;
  }

  let buy = 0, sell = 0;
  for (const c of all) {
    for (const a of (c.alerts ?? [])) {
      if (a.enabled === false) continue;
      try {
        if (!isAlertTriggered(c, a)) continue;
      } catch { continue; }
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

/* ── ② Score dynamics (Δ overall vs. last fetch) ──────────────────────────── */

export function scoreMovers(candidates, n = 3) {
  const rows = derive(candidates).filter((r) => r.delta != null && r.delta !== 0);
  const risers  = rows.filter((r) => r.delta > 0).sort(byDeltaDesc).slice(0, n);
  const fallers = rows.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, n);
  return { risers, fallers };
}

/* ── ④ Performance momentum (1W / 1M / 3M) ────────────────────────────────── */

const PERF_KEYS = { '1W': 'perf_w', '1M': 'perf_1m', '3M': 'perf_3m' };

export function perfLeaders(candidates, window = '1W', n = 3) {
  const key = PERF_KEYS[window] ?? 'perf_w';
  const rows = derive(candidates)
    .map((r) => ({ ...r, perf: r.tv[key] }))
    .filter((r) => r.perf != null);
  const gainers = rows.slice().sort((a, b) => b.perf - a.perf).slice(0, n);
  const losers  = rows.slice().sort((a, b) => a.perf - b.perf).filter((r) => r.perf < 0).slice(0, n);
  return { gainers, losers };
}

/* ── ⑤ Signals & extremes ─────────────────────────────────────────────────── */

export function signals(candidates, n = 4) {
  const rows = derive(candidates);

  const momTop = rows
    .map((r) => ({ ...r, mom: computeMomentumCheck(r.tv) }))
    .filter((r) => r.mom?.total != null)
    .sort((a, b) => b.mom.total - a.mom.total)
    .slice(0, n);

  const rsiOversold = rows
    .filter((r) => r.tv.rsi != null && r.tv.rsi <= 30)
    .sort((a, b) => a.tv.rsi - b.tv.rsi)
    .slice(0, n);

  const rsiOverbought = rows
    .filter((r) => r.tv.rsi != null && r.tv.rsi >= 70)
    .sort((a, b) => b.tv.rsi - a.tv.rsi)
    .slice(0, n);

  const blueSky = rows
    .filter((r) => ['ATH', 'HIGH'].includes(r.tv.cycle_score?.labelCode))
    .sort((a, b) => (b.tv.cycle_score?.total ?? 0) - (a.tv.cycle_score?.total ?? 0))
    .slice(0, n);

  return { momTop, rsiOversold, rsiOverbought, blueSky };
}

/* ── ⑧ Clean trends: positive across 1W/1M/3M, ranked by avg monthly growth ─ */

export function cleanTrends(candidates, n = 5) {
  return derive(candidates)
    .filter((r) => r.tv.perf_w > 0 && r.tv.perf_1m > 0 && r.tv.perf_3m > 0)
    .map((r) => ({ ...r, ogrm: monthlyGrowthRate(r.tv.perf_6m, 6) }))
    .sort((a, b) => (b.ogrm ?? -Infinity) - (a.ogrm ?? -Infinity))
    .slice(0, n);
}
