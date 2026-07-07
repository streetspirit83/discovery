/**
 * TradingView bulk enrichment – browser-side
 *
 * Uses the scanner API's symbols.tickers batch lookup:
 * POST https://scanner.tradingview.com/scan
 * Body: { markets: ["america"], symbols: { tickers: ["NASDAQ:AAPL", ...] }, columns: [...] }
 *
 * This is the correct per-ticker API — no filter needed, no client-side matching.
 */

import { computeTrendScore }         from './tv-trend-score.js';
import { computeHealthScore }        from './tv-health-score.js';
import { computeCycleScore }         from './tv-cycle-score.js';
import { computeTrendStrengthScore } from './tv-trend-strength-score.js';
import { computeEntryScore }         from './tv-entry-score.js';
import { computeEntryPrices }        from './tv-entry-prices.js';
import { computeOverallScore }       from './tv-overall-score.js';
import { computeMomentumCheck }      from './tv-momentum-check.js';
import { normalizeExchange }         from './exchange-map.js';

const SNAPSHOT_MAX = 5; // keep up to 5 days of score history per candidate

/* MACD histogram (macd − signal) — the value whose sign-flip we track. */
function macdHist(tv) {
  return tv.macd != null && tv.macd_signal != null ? +(tv.macd - tv.macd_signal).toFixed(4) : null;
}

/* Build the per-day closing record from the freshly computed tv_data. Every
 * tracked score is captured so the dashboard can derive a gapless day-over-day
 * time series for each of them (the last fetch of a day is the closing value). */
function snapshotRecord(tv) {
  const overall = computeOverallScore({
    perfW:         tv.perf_w,
    perf1M:        tv.perf_1m,
    change1D:      tv.change_1d,
    ebitdaGrowth:  tv.ebitda_yoy_growth_fy ?? tv.ebitda_yoy_growth_ttm,
    rating1M:      tv.recommend_all_1m,
    trendStrength: tv.trend_strength_score?.total,
    entry:         tv.entry_score?.total,
    health:        tv.health_score?.total,
    cycle:         tv.cycle_score?.total,
  })?.total ?? null;
  return {
    d:              (tv.fetched_at ?? new Date().toISOString()).slice(0, 10),
    overall,
    trend_strength: tv.trend_strength_score?.total ?? null,
    entry:          tv.entry_score?.total ?? null,
    health:         tv.health_score?.total ?? null,
    cycle:          tv.cycle_score?.total ?? null,
    trend:          tv.trend_score?.total ?? null,
    mom:            computeMomentumCheck(tv)?.total ?? null,
    rsi:            tv.rsi ?? null,
    macd_hist:      macdHist(tv),
    close:          tv.close  ?? null,
    sma20:          tv.sma20  ?? null,
    sma50:          tv.sma50  ?? null,
    sma100:         tv.sma100 ?? null,
    sma200:         tv.sma200 ?? null,
  };
}

const dayOf = (s) => s?.d ?? (s?.at ? String(s.at).slice(0, 10) : null);

/* Upsert today's closing record into the per-day series (newest first). A later
 * same-day fetch replaces the head ("letzter Wert zählt"); a new day prepends.
 * Capped at SNAPSHOT_MAX so consecutive days net into a gapless time series. */
function upsertSnapshot(history, rec) {
  const hist = Array.isArray(history) ? history.slice() : [];
  if (hist[0] && dayOf(hist[0]) === rec.d) hist[0] = rec;
  else hist.unshift(rec);
  return hist.slice(0, SNAPSHOT_MAX);
}

const EXCHANGE_TO_MARKET = {
  NASDAQ:   'america',
  NYSE:     'america',
  AMEX:     'america',
  XETR:     'germany',
  LSE:      'uk',
  EURONEXT: 'france',
  MIL:      'italy',
  BME:      'spain',
  VIE:      'austria',
  OMXSTO:   'sweden',
  SIX:      'switzerland',
  OMXCOP:   'denmark',
  OSL:      'norway',
  OMXHEX:   'finland',
};

const TV_PREFIX_MAP = {
  NASDAQ:   'NASDAQ',
  NYSE:     'NYSE',
  AMEX:     'AMEX',
  XETR:     'XETR',
  LSE:      'LSE',
  EURONEXT: 'EURONEXT',
  MIL:      'MIL',
  BME:      'BME',
  VIE:      'VIE',
  OMXSTO:   'OMXSTO',
  SIX:      'SIX',
  OMXCOP:   'OMXCOP',
  OSL:      'OSL',
  OMXHEX:   'OMXHEX',
};

const EXCHANGE_CURRENCY = {
  NASDAQ: 'USD', NYSE: 'USD', AMEX: 'USD',
  XETR: 'EUR', EURONEXT: 'EUR', MIL: 'EUR', BME: 'EUR', VIE: 'EUR',
  OMXSTO: 'SEK', OMXCOP: 'DKK', OSL: 'NOK', OMXHEX: 'EUR',
  LSE: 'GBP', SIX: 'CHF',
};
export { EXCHANGE_CURRENCY };

const TV_COLUMNS = [
  'description',               // 0
  'sector',                    // 1
  'industry',                  // 2
  'close',                     // 3
  'change',                    // 4
  'change|1W',                 // 5
  'change|1M',                 // 6
  'Volatility.D',              // 7
  'beta_1_year',               // 8
  'average_volume_10d_calc',   // 9
  'market_cap_basic',          // 10
  'price_earnings_ttm',        // 11
  'dividend_yield_recent',     // 12
  'Recommend.All',             // 13
  'RSI',                       // 14
  'EMA20',                     // 15
  'EMA50',                     // 16
  'EMA200',                    // 17
  'MACD.macd',                 // 18
  'ADX',                       // 19
  'high|52W',                  // 20
  'earnings_release_next_date',// 21
  'beta_3_year',// 22
 'change_abs|1W', // 23
'change_abs|1M', // 24
'Recommend.All|1M', // 25
'High.1M', // 26
'Low.1M', // 27
'price_52_week_high', // 28
'price_52_week_low', // 29
'High.All', // 30
'Low.All', // 31
'Perf.All', // 32
'Aroon.Down|120', // 33
'Aroon.Down|1M', // 34
'Aroon.Up|120', // 35
'Aroon.Up|1M', // 36
'average_volume_30d_calc', // 37
'basic_eps_net_income', // 38
'CCI20|1M', // 39
'DonchCh20.Lower|1M', // 40
'DonchCh20.Upper|1M', // 41
'ebitda_yoy_growth_fy', // 42
'ebitda', // 43
'EMA20', // 44
'EMA50', // 45
'EMA100', // 46
'EMA200', // 47
'gross_margin', // 48
'gross_profit_yoy_growth_fy', // 49
'MACD.signal', // 50
'Mom|1M', // 51
'Perf.1M', // 52
'Recommend.MA|1M', // 53
  // Scoring fields (new)
  'ADX+DI',         // 54
  'ADX-DI',         // 55
  'Stoch.K',        // 56
  'Stoch.D',        // 57
  'CCI20',          // 58 — daily (scoring uses daily, not 1M)
  'Recommend.MA',   // 59 — daily
  'EMA20|1W',       // 60
  'EMA50|1W',       // 61
  'EMA200|1W',      // 62
  'Perf.W',         // 63 — rolling ~5 trading days (equivalent of Perf.1M for 1 week)
  // Financial Health Score fields
  'return_on_equity',                          // 64
  'return_on_invested_capital',                // 65
  'after_tax_margin',                          // 66
  'operating_margin',                          // 67
  'current_ratio',                             // 68
  'quick_ratio',                               // 69
  'debt_to_equity',                            // 70
  'total_revenue_yoy_growth_ttm',              // 71
  'total_revenue_yoy_growth_fy',               // 72
  'earnings_per_share_diluted_yoy_growth_ttm', // 73
  'earnings_per_share_diluted_yoy_growth_fy',  // 74
  'free_cash_flow_margin_ttm',                 // 75
  'free_cash_flow_margin_fy',                  // 76
  'free_cash_flow_yoy_growth_ttm',             // 77
  'free_cash_flow_yoy_growth_fy',              // 78
  'earnings_per_share_basic_ttm',              // 79
  'enterprise_value_ebitda_ttm',               // 80
  'price_free_cash_flow_ttm',                  // 81
  // Cycle score fields
  'High.6M',                                   // 82
  'Low.6M',                                    // 83
  // Health score v2 fields
  'ebitda_yoy_growth_ttm',                     // 84
  'total_debt_to_ebitda_fy',                   // 85
  // Trend Strength Score fields
  'Aroon.Up',                                  // 86
  'Aroon.Down',                                // 87
  'SMA50',                                     // 88
  'SMA200',                                    // 89
  'EMA10',                                     // 90
  'volume',                                    // 91
  // Entry Score fields
  'BB.lower',                                  // 92
  'BB.upper',                                  // 93
  // Entry Price fields
  'Pivot.M.Classic.S1',                        // 94
  'Pivot.M.Classic.R1',                        // 95
  'ATR',                                       // 96
  // Intraday price fields
  'close|1',                                   // 97 — 1-Minuten Intraday-Kurs
  'open',                                      // 98 — heutiger Open
  'change_from_open',                          // 99 — Intraday-Performance seit Open
  // Upside v2 fields
  'Volatility.M',                              // 100 — Ø Tagesvolatilität über 1 Monat (%)
  'ATRP',                                      // 101 — ATR in Prozent
  'Perf.3M',                                   // 102
  'Perf.6M',                                   // 103
  'Pivot.M.Classic.R2',                        // 104
  'Pivot.M.Classic.S2',                        // 105
  'High.3M',                                   // 106
  'Low.3M',                                    // 107
  'recommendation_total',                      // 108 — Anzahl Analysten
  'isin',                                      // 109 — ISIN (für TR/LS-Abgleich)
  'SMA20',                                     // 110 — SMA 20 (Preis-Tabelle)
  'SMA100',                                    // 111 — SMA 100 (Preis-Tabelle)
  // Trade view: weekly + monthly classic pivots, Demark 1W, 20-day Donchian (daily)
  'Pivot.M.Classic.R1|1W',                     // 112
  'Pivot.M.Classic.R2|1W',                     // 113
  'Pivot.M.Classic.R3|1W',                     // 114
  'Pivot.M.Classic.S1|1W',                     // 115
  'Pivot.M.Classic.S2|1W',                     // 116
  'Pivot.M.Classic.S3|1W',                     // 117
  'Pivot.M.Classic.R3',                        // 118 — 1M R3 (R1/R2/S1/S2 existieren schon)
  'Pivot.M.Classic.S3',                        // 119 — 1M S3
  'Pivot.M.Demark.R1|1W',                      // 120 — Breakout-Referenz
  'Pivot.M.Demark.S1|1W',                      // 121
  'DonchCh20.Upper',                           // 122 — high|20 (Tages-Timeframe)
  'DonchCh20.Lower',                           // 123 — low|20 (Tages-Timeframe)
];

const COL = {
  description:   0,
  sector:        1,
  industry:      2,
  close:         3,
  change:        4,
  change1W:      5,
  change1M:      6,
  volatility:    7,
  beta:          8,
  avgVol10d:     9,
  marketCap:     10,
  pe:            11,
  dividendYield: 12,
  rating:        13,
  rsi:           14,
  ema20:         15,
  ema50:         16,
  ema200:        17,
  macd:          18,
  adx:           19,
  high52w:       20,
  earningsDate:  21,
  beta_3_year:  22,
 changeAbs1W: 23,
changeAbs1M: 24,
recommendAll1M: 25,
high1M: 26,
low1M: 27,
price52WeekHigh: 28,
price52WeekLow: 29,
highAll: 30,
lowAll: 31,
perfAll: 32,
aroonDown120: 33,
aroonDown1M: 34,
aroonUp120: 35,
aroonUp1M: 36,
averageVolume30dCalc: 37,
basicEpsNetIncome: 38,
cci20_1M: 39,
donchCh20Lower1M: 40,
donchCh20Upper1M: 41,
ebitdaYoyGrowthFy: 42,
ebitda: 43,
ema20: 44,
ema50: 45,
ema100: 46,
ema200: 47,
grossMargin: 48,
grossProfitYoyGrowthFy: 49,
macdSignal: 50,
mom1M: 51,
perf1M: 52,
recommendMA1M: 53,
  adxPlusDI:    54,
  adxMinusDI:   55,
  stochK:       56,
  stochD:       57,
  cci20d:       58,
  recommendMAd: 59,
  ema20_1w:     60,
  ema50_1w:     61,
  ema200_1w:    62,
  perfW:        63,
  // health score fields
  roe:                   64,
  roic:                  65,
  afterTaxMargin:        66,
  operatingMargin:       67,
  currentRatio:          68,
  quickRatio:            69,
  debtToEquity:          70,
  revGrowthTtm:          71,
  revGrowthFy:           72,
  epsDilutedGrowthTtm:   73,
  epsDilutedGrowthFy:    74,
  fcfMarginTtm:          75,
  fcfMarginFy:           76,
  fcfGrowthTtm:          77,
  fcfGrowthFy:           78,
  epsBasicTtm:           79,
  evEbitdaTtm:           80,
  pFcfTtm:               81,
  high6m:                82,
  low6m:                 83,
  ebitdaYoyGrowthTtm:    84,
  totalDebtToEbitdaFy:   85,
  // Trend Strength Score fields
  aroonUpD:              86,
  aroonDownD:            87,
  sma50:                 88,
  sma200:                89,
  ema10:                 90,
  volume:                91,
  // Entry Score fields
  bbLower:               92,
  bbUpper:               93,
  // Entry Price fields
  pivotS1:               94,
  pivotR1:               95,
  atr:                   96,
  // Intraday price fields
  close1m:               97,
  openD:                 98,
  changeFromOpen:        99,
  // Upside v2 fields
  volatilityM:           100,
  atrp:                  101,
  perf3M:                102,
  perf6M:                103,
  pivotR2:               104,
  pivotS2:               105,
  high3M:                106,
  low3M:                 107,
  recommendationTotal:   108,
  isin:                  109,
  sma20:                 110,
  sma100:                111,
  // Trade view fields
  pivotR1_1w:            112,
  pivotR2_1w:            113,
  pivotR3_1w:            114,
  pivotS1_1w:            115,
  pivotS2_1w:            116,
  pivotS3_1w:            117,
  pivotR3:               118,
  pivotS3:               119,
  pivotDemarkR1_1w:      120,
  pivotDemarkS1_1w:      121,
  donch20UpperD:         122,
  donch20LowerD:         123,
};

// ─── Proxy POST ───────────────────────────────────────────────────────────────

async function proxyPost(backendUrl, secret, url, requestBody) {
  const proxyUrl = `${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`;

  console.group(`[TV] POST ${url}`);
  console.log('[TV] Proxy URL:', proxyUrl);
  console.log('[TV] Request body:', JSON.stringify(requestBody, null, 2));

  let res;
  try {
    res = await fetch(proxyUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
      body: JSON.stringify({
        url,
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    requestBody,
      }),
    });
  } catch (fetchErr) {
    console.error('[TV] Proxy fetch failed (network):', fetchErr);
    console.groupEnd();
    throw new Error(`Proxy network error: ${fetchErr.message}`);
  }

  console.log('[TV] Proxy response status:', res.status);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[TV] Proxy HTTP error body:', text);
    console.groupEnd();
    throw new Error(`Proxy HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  let wrapper;
  try {
    wrapper = await res.json();
  } catch (jsonErr) {
    console.error('[TV] Proxy response not JSON:', jsonErr);
    console.groupEnd();
    throw new Error('Proxy returned non-JSON');
  }

  console.log('[TV] Proxy wrapper:', { ok: wrapper.ok, status: wrapper.status, error: wrapper.error, bodyLen: wrapper.body?.length });

  if (!wrapper.ok) {
    console.error('[TV] Proxy error:', wrapper.error);
    console.groupEnd();
    throw new Error(`Proxy: ${wrapper.error}`);
  }
  if (wrapper.status !== 200) {
    console.error('[TV] Upstream HTTP error. Body preview:', wrapper.body?.slice(0, 500));
    console.groupEnd();
    throw new Error(`TV HTTP ${wrapper.status} – ${wrapper.body?.slice(0, 200)}`);
  }

  console.log('[TV] Upstream body (first 500 chars):', wrapper.body?.slice(0, 500));
  console.groupEnd();

  return wrapper.body;
}

// ─── Schema A mapping ─────────────────────────────────────────────────────────

function marketCapBucket(mc) {
  if (mc < 300e6)  return 'micro';
  if (mc < 2e9)    return 'small';
  if (mc < 10e9)   return 'mid';
  if (mc < 200e9)  return 'large';
  return 'mega';
}

function formatEarningsDate(ts) {
  if (!ts) return null;
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  if (isNaN(d)) return null;
  return `Earnings: ${d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function buildUpdates(d, candidate) {
  const updates = {
    asset_type: 'Stock',
    scan_date:  new Date().toISOString().split('T')[0],
    // Backfill ISIN from TV so the Trade Republic / LS check can match reliably.
    isin: d[COL.isin] || candidate.isin || null,
    tv_data: {
      rating:        d[COL.rating]       ?? null,
      pe_ttm:        d[COL.pe]           ?? null,
      market_cap:    d[COL.marketCap]    ?? null,
      close:         d[COL.close]        ?? null,
      change_1d:     d[COL.change]       ?? null,
      change_1w:     d[COL.change1W]     ?? null,
      change_1m:     d[COL.change1M]     ?? null,
      volatility:    d[COL.volatility]   ?? null,
      beta:          d[COL.beta]         ?? null,
      avg_vol_10d:   d[COL.avgVol10d]    ?? null,
      dividend_yield:d[COL.dividendYield]?? null,
      rsi:           d[COL.rsi]          ?? null,
      ema20:         d[COL.ema20]        ?? null,
      ema50:         d[COL.ema50]        ?? null,
      ema200:        d[COL.ema200]       ?? null,
      macd:          d[COL.macd]         ?? null,
      adx:           d[COL.adx]          ?? null,
      high_52w:           d[COL.high52w]      ?? null,
      earnings_next_date: d[COL.earningsDate] ?? null,
      beta_3_year:        d[COL.beta_3_year]  ?? null,
   change_abs_1w: d[COL.changeAbs1W] ?? null,
change_abs_1m: d[COL.changeAbs1M] ?? null,
recommend_all_1m: d[COL.recommendAll1M] ?? null,
high_1m: d[COL.high1M] ?? null,
low_1m: d[COL.low1M] ?? null,
price_52_week_high: d[COL.price52WeekHigh] ?? null,
price_52_week_low: d[COL.price52WeekLow] ?? null,
high_all: d[COL.highAll] ?? null,
low_all: d[COL.lowAll] ?? null,
perf_all: d[COL.perfAll] ?? null,
aroon_down_120: d[COL.aroonDown120] ?? null,
aroon_down_1m: d[COL.aroonDown1M] ?? null,
aroon_up_120: d[COL.aroonUp120] ?? null,
aroon_up_1m: d[COL.aroonUp1M] ?? null,
average_volume_30d_calc: d[COL.averageVolume30dCalc] ?? null,
basic_eps_net_income: d[COL.basicEpsNetIncome] ?? null,
cci20_1m: d[COL.cci20_1M] ?? null,
donch_ch20_lower_1m: d[COL.donchCh20Lower1M] ?? null,
donch_ch20_upper_1m: d[COL.donchCh20Upper1M] ?? null,
ebitda_yoy_growth_fy: d[COL.ebitdaYoyGrowthFy] ?? null,
ebitda: d[COL.ebitda] ?? null,
ema20: d[COL.ema20] ?? null,
ema50: d[COL.ema50] ?? null,
ema100: d[COL.ema100] ?? null,
ema200: d[COL.ema200] ?? null,
gross_margin: d[COL.grossMargin] ?? null,
gross_profit_yoy_growth_fy: d[COL.grossProfitYoyGrowthFy] ?? null,
macd_signal: d[COL.macdSignal] ?? null,
mom_1m: d[COL.mom1M] ?? null,
perf_1m: d[COL.perf1M] ?? null,
recommend_ma_1m: d[COL.recommendMA1M] ?? null,
      // Scoring fields
      adx_plus_di:  d[COL.adxPlusDI]    ?? null,
      adx_minus_di: d[COL.adxMinusDI]   ?? null,
      stoch_k:      d[COL.stochK]        ?? null,
      stoch_d:      d[COL.stochD]        ?? null,
      cci20_d:      d[COL.cci20d]        ?? null,
      recommend_ma_d: d[COL.recommendMAd] ?? null,
      ema20_1w:     d[COL.ema20_1w]      ?? null,
      ema50_1w:     d[COL.ema50_1w]      ?? null,
      ema200_1w:    d[COL.ema200_1w]     ?? null,
      perf_w:       d[COL.perfW]         ?? null,
      // Health Score fields
      return_on_equity:                          d[COL.roe]                 ?? null,
      return_on_invested_capital:                d[COL.roic]                ?? null,
      after_tax_margin:                          d[COL.afterTaxMargin]      ?? null,
      operating_margin:                          d[COL.operatingMargin]     ?? null,
      current_ratio:                             d[COL.currentRatio]        ?? null,
      quick_ratio:                               d[COL.quickRatio]          ?? null,
      debt_to_equity:                            d[COL.debtToEquity]        ?? null,
      total_revenue_yoy_growth_ttm:              d[COL.revGrowthTtm]        ?? null,
      total_revenue_yoy_growth_fy:               d[COL.revGrowthFy]         ?? null,
      earnings_per_share_diluted_yoy_growth_ttm: d[COL.epsDilutedGrowthTtm] ?? null,
      earnings_per_share_diluted_yoy_growth_fy:  d[COL.epsDilutedGrowthFy]  ?? null,
      free_cash_flow_margin_ttm:                 d[COL.fcfMarginTtm]        ?? null,
      free_cash_flow_margin_fy:                  d[COL.fcfMarginFy]         ?? null,
      free_cash_flow_yoy_growth_ttm:             d[COL.fcfGrowthTtm]        ?? null,
      free_cash_flow_yoy_growth_fy:              d[COL.fcfGrowthFy]         ?? null,
      earnings_per_share_basic_ttm:              d[COL.epsBasicTtm]         ?? null,
      enterprise_value_ebitda_ttm:               d[COL.evEbitdaTtm]         ?? null,
      price_free_cash_flow_ttm:                  d[COL.pFcfTtm]             ?? null,
      high_6m:      d[COL.high6m] ?? null,
      low_6m:       d[COL.low6m]  ?? null,
      ebitda_yoy_growth_ttm:   d[COL.ebitdaYoyGrowthTtm]  ?? null,
      total_debt_to_ebitda_fy: d[COL.totalDebtToEbitdaFy] ?? null,
      // Trend Strength Score fields
      aroon_up:   d[COL.aroonUpD]   ?? null,
      aroon_down: d[COL.aroonDownD] ?? null,
      sma20:      d[COL.sma20]      ?? null,
      sma50:      d[COL.sma50]      ?? null,
      sma100:     d[COL.sma100]     ?? null,
      sma200:     d[COL.sma200]     ?? null,
      ema10:      d[COL.ema10]      ?? null,
      volume:     d[COL.volume]     ?? null,
      // Entry Score fields
      bb_lower:   d[COL.bbLower]    ?? null,
      bb_upper:   d[COL.bbUpper]    ?? null,
      pivot_s1:   d[COL.pivotS1]   ?? null,
      pivot_r1:   d[COL.pivotR1]   ?? null,
      atr:        d[COL.atr]       ?? null,
      // Intraday price fields
      close_1m:         d[COL.close1m]        ?? null,
      open:             d[COL.openD]          ?? null,
      change_from_open: d[COL.changeFromOpen] ?? null,
      // Upside v2 fields
      volatility_m:         d[COL.volatilityM]         ?? null,
      atrp:                 d[COL.atrp]                ?? null,
      perf_3m:              d[COL.perf3M]              ?? null,
      perf_6m:              d[COL.perf6M]              ?? null,
      pivot_r2:             d[COL.pivotR2]             ?? null,
      pivot_s2:             d[COL.pivotS2]             ?? null,
      high_3m:              d[COL.high3M]              ?? null,
      low_3m:               d[COL.low3M]               ?? null,
      recommendation_total: d[COL.recommendationTotal] ?? null,
      // Trade view fields (weekly/monthly pivots, Demark 1W, 20-day Donchian)
      pivot_r1_1w:          d[COL.pivotR1_1w]          ?? null,
      pivot_r2_1w:          d[COL.pivotR2_1w]          ?? null,
      pivot_r3_1w:          d[COL.pivotR3_1w]          ?? null,
      pivot_s1_1w:          d[COL.pivotS1_1w]          ?? null,
      pivot_s2_1w:          d[COL.pivotS2_1w]          ?? null,
      pivot_s3_1w:          d[COL.pivotS3_1w]          ?? null,
      pivot_r3:             d[COL.pivotR3]             ?? null,
      pivot_s3:             d[COL.pivotS3]             ?? null,
      pivot_demark_r1_1w:   d[COL.pivotDemarkR1_1w]    ?? null,
      pivot_demark_s1_1w:   d[COL.pivotDemarkS1_1w]    ?? null,
      high_20d:             d[COL.donch20UpperD]       ?? null,
      low_20d:              d[COL.donch20LowerD]       ?? null,
      fetched_at:   new Date().toISOString(),
    },
  };

  // Compute scores from the freshly built tv_data
  updates.tv_data.trend_score = computeTrendScore({
    close:           updates.tv_data.close,
    EMA20:           updates.tv_data.ema20,
    EMA50:           updates.tv_data.ema50,
    EMA200:          updates.tv_data.ema200,
    ADX:             updates.tv_data.adx,
    'ADX+DI':        updates.tv_data.adx_plus_di,
    'ADX-DI':        updates.tv_data.adx_minus_di,
    RSI:             updates.tv_data.rsi,
    'MACD.macd':     updates.tv_data.macd,
    'MACD.signal':   updates.tv_data.macd_signal,
    'Stoch.K':       updates.tv_data.stoch_k,
    'Stoch.D':       updates.tv_data.stoch_d,
    CCI20:           updates.tv_data.cci20_d,
    'Recommend.All': updates.tv_data.rating,
    'Recommend.MA':  updates.tv_data.recommend_ma_d,
    'EMA20|1W':      updates.tv_data.ema20_1w,
    'EMA50|1W':      updates.tv_data.ema50_1w,
    'EMA200|1W':     updates.tv_data.ema200_1w,
  });

  updates.tv_data.entry_score = computeEntryScore({
    RSI:           updates.tv_data.rsi,
    'MACD.macd':   updates.tv_data.macd,
    'MACD.signal': updates.tv_data.macd_signal,
    'Stoch.K':     updates.tv_data.stoch_k,
    'Stoch.D':     updates.tv_data.stoch_d,
    close:         updates.tv_data.close,
    EMA20:         updates.tv_data.ema20,
    'BB.lower':    updates.tv_data.bb_lower,
  });

  updates.tv_data.entry_prices = computeEntryPrices({
    'BB.lower':             updates.tv_data.bb_lower,
    'BB.upper':             updates.tv_data.bb_upper,
    'Pivot.M.Classic.S1':   updates.tv_data.pivot_s1,
    'Pivot.M.Classic.R1':   updates.tv_data.pivot_r1,
    close:                  updates.tv_data.close,
    ATR:                    updates.tv_data.atr,
  });

  updates.tv_data.health_score = computeHealthScore({
    market_cap_basic:              updates.tv_data.market_cap,
    ebitda:                        updates.tv_data.ebitda,
    total_revenue_yoy_growth_ttm:  updates.tv_data.total_revenue_yoy_growth_ttm,
    ebitda_yoy_growth_ttm:         updates.tv_data.ebitda_yoy_growth_ttm,
    free_cash_flow_yoy_growth_ttm: updates.tv_data.free_cash_flow_yoy_growth_ttm,
    operating_margin:              updates.tv_data.operating_margin,
    debt_to_equity:                updates.tv_data.debt_to_equity,
    total_debt_to_ebitda_fy:       updates.tv_data.total_debt_to_ebitda_fy,
  });

  updates.tv_data.trend_strength_score = computeTrendStrengthScore({
    ADX:                     updates.tv_data.adx,
    'Aroon.Up':              updates.tv_data.aroon_up,
    'Aroon.Down':            updates.tv_data.aroon_down,
    SMA50:                   updates.tv_data.sma50,
    SMA200:                  updates.tv_data.sma200,
    close:                   updates.tv_data.close,
    EMA10:                   updates.tv_data.ema10,
    EMA20:                   updates.tv_data.ema20,
    volume:                  updates.tv_data.volume,
    average_volume_10d_calc: updates.tv_data.avg_vol_10d,
  });

  updates.tv_data.cycle_score = computeCycleScore({
    close:               updates.tv_data.close,
    'High.All':          updates.tv_data.high_all,
    'Low.All':           updates.tv_data.low_all,
    price_52_week_high:  updates.tv_data.price_52_week_high,
    price_52_week_low:   updates.tv_data.price_52_week_low,
    'High.6M':           updates.tv_data.high_6m,
    'Low.6M':            updates.tv_data.low_6m,
  });

  if (d[COL.description] && (!candidate.name || candidate.name === candidate.symbol)) {
    updates.name = d[COL.description];
  }
  if (d[COL.sector])    updates.sector          = d[COL.sector];
  if (d[COL.industry])  updates.sub_sector      = d[COL.industry];
  if (d[COL.marketCap]) updates.market_cap_size = marketCapBucket(d[COL.marketCap]);

  const earningsStr = formatEarningsDate(d[COL.earningsDate]);
  if (earningsStr) updates.next_catalysts = earningsStr;

  if (d[COL.rating] != null) {
    updates.priority = d[COL.rating] > 0.3 ? 'high' : d[COL.rating] < -0.3 ? 'low' : 'medium';
  }

  const currency = EXCHANGE_CURRENCY[candidate.exchange];
  if (currency) updates.currency = currency;

  // Append today's closing scores to the per-day series so the dashboard can
  // derive a gapless day-over-day time series (deltas) for every score.
  updates.tv_data.snapshot = upsertSnapshot(candidate.tv_data?.snapshot, snapshotRecord(updates.tv_data));

  return updates;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetches the current EUR/USD rate (USD per 1 EUR) via the TV forex scanner.
 * Verified response shape: {"totalCount":1,"data":[{"s":"FX_IDC:EURUSD","d":[1.15588]}]}
 * @returns {Promise<number|null>}
 */
export async function fetchFxRate({ backendUrl, secret }) {
  try {
    const bodyStr = await proxyPost(backendUrl, secret,
      'https://scanner.tradingview.com/forex/scan',
      { symbols: { tickers: ['FX_IDC:EURUSD'] }, columns: ['close'] },
    );
    const rate = JSON.parse(bodyStr)?.data?.[0]?.d?.[0];
    return typeof rate === 'number' && rate > 0 ? rate : null;
  } catch (err) {
    console.warn('[TV] FX rate fetch failed:', err.message);
    return null;
  }
}

/**
 * Market indicators for the Intra-Day header. Verified TV tickers:
 *   XETR:DAX · NASDAQ:IXIC (Composite) · TVC:NI225 · TVC:VIX
 * `change` is today's move %, `perf1m` the trailing 1-month performance %.
 * @returns {Promise<{label:string,value:number|null,change:number|null,perf1m:number|null}[]>}
 */
const MARKET_INDICATORS = [
  { label: 'DAX',    ticker: 'XETR:DAX' },
  { label: 'NASDAQ', ticker: 'NASDAQ:IXIC' },
  { label: 'NIKKEI', ticker: 'TVC:NI225' },
  { label: 'VIX',    ticker: 'TVC:VIX' },
];

export async function fetchMarketIndicators({ backendUrl, secret }) {
  const fallback = MARKET_INDICATORS.map(({ label }) => ({ label, value: null, change: null, perf1m: null }));
  try {
    const bodyStr = await proxyPost(backendUrl, secret,
      'https://scanner.tradingview.com/global/scan',
      { symbols: { tickers: MARKET_INDICATORS.map((i) => i.ticker), query: { types: [] } }, columns: ['close', 'change', 'Perf.1M'] },
    );
    const rows = JSON.parse(bodyStr)?.data ?? [];
    const byTicker = new Map(rows.map((r) => [r.s, r.d]));
    return MARKET_INDICATORS.map(({ label, ticker }) => {
      const d = byTicker.get(ticker);
      return { label, value: d?.[0] ?? null, change: d?.[1] ?? null, perf1m: d?.[2] ?? null };
    });
  } catch (err) {
    console.warn('[TV] market indicators fetch failed:', err.message);
    return fallback;
  }
}

/**
 * German regional venue (original exchange code) → TV prefix, all in the
 * "germany" market. Used as a fallback when the Xetra-normalised lookup
 * returns no data (value listed only on a regional exchange). Verified
 * against the TV scanner: FWB, SWB, MUN, DUS, GETTEX, TRADEGATE.
 */
const GERMAN_REGIONAL_TV = {
  FWB: 'FWB', XFRA: 'FWB', FRA: 'FWB', F: 'FWB',
  STU: 'SWB', XSTU: 'SWB', SWB: 'SWB',
  MUN: 'MUN', XMUN: 'MUN',
  DUS: 'DUS', XDUS: 'DUS',
  GETTEX: 'GETTEX', GAT: 'TRADEGATE', TRADEGATE: 'TRADEGATE',
  HAM: 'HAM', XHAM: 'HAM', HAN: 'HAN', XHAN: 'HAN',
};

/**
 * Euronext is one TV prefix (EURONEXT) spanning several national scanner
 * markets. A symbols.tickers lookup is scoped to the market in the URL, so
 * the primary `france` lookup only resolves Paris listings. Amsterdam,
 * Brussels and Lisbon listings must be retried against their own markets.
 * Order roughly follows listing volume; the first market that returns data
 * wins. (`france` is the primary lookup and is intentionally omitted here.)
 */
const EURONEXT_FALLBACK_MARKETS = ['netherlands', 'belgium', 'portugal'];


/**
 * Fetches one market group and writes hits into `results`.
 * @returns {Promise<object[]>} candidates that returned no data
 */
async function fetchMarketGroup(market, entries, { backendUrl, secret }, onProgress, results, label) {
  const tvTickers   = entries.map((e) => e.tvTicker);
  const tvTickerMap = new Map(entries.map((e) => [e.tvTicker, e.candidate]));
  onProgress?.(`📊 ${label} – ${market}: ${tvTickers.join(', ')}…`);

  const requestBody = { markets: [market], symbols: { tickers: tvTickers }, columns: TV_COLUMNS };

  let bodyStr;
  try {
    bodyStr = await proxyPost(backendUrl, secret, `https://scanner.tradingview.com/${market}/scan`, requestBody);
  } catch (err) {
    console.warn(`[TV] ${market} failed:`, err.message);
    onProgress?.(`⚠️ ${market}: ${err.message}`);
    return entries.map((e) => e.candidate);
  }

  let parsed;
  try {
    parsed = JSON.parse(bodyStr);
  } catch {
    console.warn(`[TV] ${market}: JSON parse error on body:`, bodyStr?.slice(0, 300));
    onProgress?.(`⚠️ ${market}: JSON parse fehlgeschlagen`);
    return entries.map((e) => e.candidate);
  }

  const rows = parsed?.data ?? [];
  console.log(`[TV] ${market} (${label}): totalCount=${parsed?.totalCount}, rows=${rows.length}`);
  onProgress?.(`✅ ${market}: ${rows.length} Treffer für ${tvTickers.length} Ticker`);

  for (const row of rows) {
    const candidate = tvTickerMap.get(row.s);
    if (candidate) results.set(candidate.id, buildUpdates(row.d ?? [], candidate));
    else console.warn('[TV] No candidate for ticker:', row.s);
  }

  const missing = entries.filter((e) => !rows.find((r) => r.s === e.tvTicker));
  if (missing.length) {
    console.warn('[TV] No TV data for:', missing.map((e) => e.tvTicker));
  }
  return missing.map((e) => e.candidate);
}

/**
 * @param {object[]} candidates
 * @param {{ backendUrl: string, secret: string, onProgress?: (msg: string) => void }} opts
 * @returns {Promise<Map<string, object>>}  candidateId → updates
 */
export async function fetchTVEnrichment(candidates, { backendUrl, secret, onProgress }) {
  console.group('[TV] fetchTVEnrichment start');
  console.log('[TV] candidates:', candidates.map((c) => `${c.exchange}:${c.symbol}`));

  // Group by TV market
  const groups   = new Map(); // market → [{candidate, tvTicker}]
  const noMarket = [];

  for (const c of candidates) {
    // Normalise legacy/regional codes (e.g. FWB, XSTU) so already-stored
    // candidates resolve without re-import. Original c.exchange is kept for
    // the regional fallback below.
    const ex = normalizeExchange(c.exchange);
    const market = EXCHANGE_TO_MARKET[ex];
    const prefix = TV_PREFIX_MAP[ex];
    if (!market || !prefix) {
      console.warn('[TV] Unknown exchange:', c.exchange, 'for', c.symbol);
      noMarket.push(`${c.symbol}(${c.exchange ?? '?'})`);
      continue;
    }
    if (!groups.has(market)) groups.set(market, []);
    groups.get(market).push({ candidate: c, tvTicker: `${prefix}:${c.symbol}` });
  }

  console.log('[TV] groups:', Object.fromEntries([...groups.entries()].map(([m, e]) => [m, e.map((x) => x.tvTicker)])));
  console.log('[TV] noMarket:', noMarket);
  console.groupEnd();

  if (groups.size === 0) {
    throw new Error(`Keine bekannten Exchanges – ${noMarket.join(', ')}`);
  }

  const results = new Map();
  const stillMissing = [];
  let marketIdx = 0;

  for (const [market, entries] of groups) {
    marketIdx++;
    const missing = await fetchMarketGroup(
      market, entries, { backendUrl, secret }, onProgress, results, `${marketIdx}/${groups.size}`,
    );
    stillMissing.push(...missing);
  }

  // Fallback: values that returned no data on (Xetra-normalised) lookup but
  // are listed on a German regional venue → retry with the correct TV prefix.
  const fbEntries = [];
  for (const c of stillMissing) {
    if (results.has(c.id)) continue;
    const prefix = GERMAN_REGIONAL_TV[String(c.exchange ?? '').toUpperCase()];
    if (prefix) fbEntries.push({ candidate: c, tvTicker: `${prefix}:${c.symbol}` });
  }
  if (fbEntries.length) {
    onProgress?.(`↩︎ Fallback Regionalbörse: ${fbEntries.length} Ticker…`);
    await fetchMarketGroup('germany', fbEntries, { backendUrl, secret }, onProgress, results, 'Fallback');
  }

  // Fallback: Euronext listings missing after the primary `france` lookup are
  // likely Amsterdam/Brussels/Lisbon — retry against those markets in turn.
  let euronextMissing = stillMissing.filter(
    (c) => !results.has(c.id) && normalizeExchange(c.exchange) === 'EURONEXT',
  );
  for (const mkt of EURONEXT_FALLBACK_MARKETS) {
    if (!euronextMissing.length) break;
    const fb = euronextMissing.map((c) => ({ candidate: c, tvTicker: `EURONEXT:${c.symbol}` }));
    onProgress?.(`↩︎ Euronext-Fallback ${mkt}: ${fb.length} Ticker…`);
    await fetchMarketGroup(mkt, fb, { backendUrl, secret }, onProgress, results, `Euronext/${mkt}`);
    euronextMissing = euronextMissing.filter((c) => !results.has(c.id));
  }

  if (results.size === 0) {
    const detail = noMarket.length === candidates.length
      ? `Keine bekannten Exchanges: ${noMarket.join(', ')}`
      : 'Keine TV-Daten – Exchange/Symbol prüfen (Details im Browser Console)';
    throw new Error(detail);
  }

  return results;
}
