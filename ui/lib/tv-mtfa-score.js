/**
 * tv-mtfa-score.js — Multi-Timeframe-Alignment (MTFA), inspired by TrendSpider's
 * multi-timeframe confluence: a high-quality idea is one where the daily, weekly
 * AND monthly picture agree. This turns the three horizons into one comparable
 * signal so the table can surface aligned setups first.
 *
 * Pure module: verbatim tv_data in, no DOM/fetch. All three timeframes are
 * scored from fields we already store (no extra TV request):
 *   Daily   — EMA stack close>EMA20>EMA50>EMA200 (fast trend)
 *   Weekly  — EMA stack EMA20|1W>EMA50|1W>EMA200|1W (medium trend)
 *   Monthly — perf_1m, mom_1m, close vs SMA200 (slow trend / long-term filter)
 *
 * Each timeframe collapses to a direction in {+1 bull, 0 neutral, −1 bear} by
 * majority of its sub-checks. The sortable score is (bullCount − bearCount),
 * range −3…+3, so a desc sort floats 3/3-bullish confluence to the top.
 */

const DIR = { bull: 1, neutral: 0, bear: -1 };

/* Majority vote over a list of booleans-with-a-null-skip:
   more true than false → bull, more false → bear, tie/empty → neutral. */
function vote(checks) {
  let up = 0, dn = 0;
  for (const c of checks) { if (c === true) up++; else if (c === false) dn++; }
  if (up === 0 && dn === 0) return null;      // no data → unknown
  return up > dn ? 'bull' : dn > up ? 'bear' : 'neutral';
}

/* Daily EMA stack (fast trend). null when the EMAs aren't loaded. */
function dailyDir(tv) {
  const close = tv.close_1m ?? tv.close;
  return vote([
    close != null && tv.ema20 != null ? close > tv.ema20 : null,
    tv.ema20 != null && tv.ema50 != null ? tv.ema20 > tv.ema50 : null,
    tv.ema50 != null && tv.ema200 != null ? tv.ema50 > tv.ema200 : null,
  ]);
}

/* Weekly EMA stack (medium trend). */
function weeklyDir(tv) {
  const close = tv.close_1m ?? tv.close;
  return vote([
    close != null && tv.ema20_1w != null ? close > tv.ema20_1w : null,
    tv.ema20_1w != null && tv.ema50_1w != null ? tv.ema20_1w > tv.ema50_1w : null,
    tv.ema50_1w != null && tv.ema200_1w != null ? tv.ema50_1w > tv.ema200_1w : null,
  ]);
}

/* Monthly / long-term (slow trend): month performance, month momentum, and the
   200-day line as the durable regime filter. */
function monthlyDir(tv) {
  const close = tv.close_1m ?? tv.close;
  return vote([
    tv.perf_1m != null ? tv.perf_1m > 0 : null,
    tv.mom_1m != null ? tv.mom_1m > 0 : null,
    close != null && tv.sma200 != null ? close > tv.sma200 : null,
  ]);
}

/**
 * computeMtfa(tv) → {
 *   daily, weekly, monthly,   // 'bull' | 'bear' | 'neutral' | null (no data)
 *   bullCount, bearCount,     // 0..3
 *   score,                    // bullCount − bearCount, −3..+3 (sort key)
 *   aligned,                  // true when all 3 known and same non-neutral dir
 *   label                     // "3/3 bullish" | "2/3 bearish" | "gemischt" | "—"
 * }  or null when no timeframe has data.
 */
export function computeMtfa(tv) {
  if (!tv) return null;
  const daily = dailyDir(tv), weekly = weeklyDir(tv), monthly = monthlyDir(tv);
  const dirs = [daily, weekly, monthly];
  if (dirs.every((d) => d == null)) return null;

  const bullCount = dirs.filter((d) => d === 'bull').length;
  const bearCount = dirs.filter((d) => d === 'bear').length;
  const known = dirs.filter((d) => d != null).length;
  const aligned = known === 3 && (bullCount === 3 || bearCount === 3);

  let label;
  if (bullCount > bearCount)      label = `${bullCount}/${known} bullish`;
  else if (bearCount > bullCount) label = `${bearCount}/${known} bearish`;
  else                            label = 'gemischt';

  return { daily, weekly, monthly, bullCount, bearCount, score: bullCount - bearCount, aligned, label };
}
