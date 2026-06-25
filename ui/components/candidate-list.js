import { icons } from '../lib/icons.js';
import { computeHealthScore } from '../lib/tv-health-score.js';
import { computeEntryScore }  from '../lib/tv-entry-score.js';
import { computeEntryPrices } from '../lib/tv-entry-prices.js';
import { computeOverallScore } from '../lib/tv-overall-score.js';
import { computeUpsidePotential, monthlyGrowthRate } from '../lib/tv-upside.js';
import { EXCHANGE_CURRENCY } from '../lib/tv-enrichment.js';
import { computeMomentumCheck } from '../lib/tv-momentum-check.js';
import { checkTradeRepublic } from '../lib/tr-check.js?v=20260616b';
import { fetchLsQuote } from '../lib/ls-intraday.js?v=20260622f';
import { normalizeExchange } from '../lib/exchange-map.js';
import { sparkCellHTML, atrpCellHTML } from '../lib/spark.js?v=20260625c';

// ── Currency display (USD/EUR switch in subbar) ─────────────────────────────
let displayCurrency = 'USD';
let fxEurUsd = null; // USD per 1 EUR

function nativeCurrency(c) {
  return EXCHANGE_CURRENCY[normalizeExchange(c.exchange)] ?? 'USD';
}

// Conversion factor native → display. Only USD↔EUR is convertible;
// other currencies stay native (the Wä column shows which).
function convFactor(c) {
  const native = nativeCurrency(c);
  if (native === displayCurrency || !fxEurUsd) return 1;
  if (native === 'USD' && displayCurrency === 'EUR') return 1 / fxEurUsd;
  if (native === 'EUR' && displayCurrency === 'USD') return fxEurUsd;
  return 1;
}

function fmtPrice(c, v, dec = 2) {
  return v == null ? '—' : fmtNum(v * convFactor(c), dec);
}

// LS quotes are always in EUR (the Trade-Republic venue), independent of the
// stock's home exchange. Convert to the active display currency (EUR→USD only).
function convFromEur() {
  if (displayCurrency === 'EUR' || !fxEurUsd) return 1;
  return fxEurUsd;
}

// ── Price setup situation (Preis view) ──────────────────────────────────────
function priceSituation(tv) {
  if (!tv) return null;
  const close = tv.close_1m ?? tv.close;
  if (close == null) return null;

  let earningsSoon = false;
  if (tv.earnings_next_date) {
    const ts = typeof tv.earnings_next_date === 'number'
      ? tv.earnings_next_date * 1000 : new Date(tv.earnings_next_date).getTime();
    const days = (ts - Date.now()) / 86400000;
    earningsSoon = days >= 0 && days <= 31;
  }

  let icon, label;
  const nearHigh = Math.max(tv.high_1m ?? 0, tv.high_3m ?? 0) || null;
  if (tv.price_52_week_high != null && close > tv.price_52_week_high) {
    icon = '🚀'; label = 'Blue-Sky: Kurs über 52W-Hoch – kein struktureller Widerstand';
  } else if (nearHigh != null && close >= nearHigh * 0.98) {
    icon = '🎯'; label = 'Breakout-Nähe: Kurs ≤2% unter dem 1M/3M-Hoch';
  } else if (tv.ema20 != null && tv.ema50 != null && close < tv.ema20 && close >= tv.ema50) {
    icon = '🔄'; label = 'Pullback im Trend: Kurs unter EMA20, über EMA50';
  } else if (tv.ema50 != null && close < tv.ema50) {
    icon = '📉'; label = 'Unter Trend: Kurs unter EMA50';
  } else {
    icon = '➖'; label = 'Range: kein klares Setup';
  }
  if (earningsSoon) { icon += '⚠'; label += ' · Earnings im 1M-Fenster'; }
  return { icon, label };
}

// Initial suggestions for the editable entry/target fields:
// Entry orientiert sich an der EMA20 (kurzfristige Mittellinie, Fallback Kurs),
// Ziel = Entry × 1,2 (mind. 20 % Upside).
function suggestedEntry(c) {
  const tv = c.tv_data;
  if (!tv) return null;
  const v = tv.ema20 ?? tv.close_1m ?? tv.close;
  return v != null ? Math.round(v * 100) / 100 : null;
}
function suggestedTarget(c) {
  const base = c.my_entry ?? suggestedEntry(c);
  return base != null ? Math.round(base * 1.2 * 100) / 100 : null;
}
function priceInput(c, field) {
  const own = c[field];
  const nativeVal = own ?? (field === 'my_entry' ? suggestedEntry(c) : suggestedTarget(c));
  // Display in the selected currency; storage stays native (the change
  // handler converts back via convFactor).
  const val = nativeVal != null ? Math.round(nativeVal * convFactor(c) * 100) / 100 : '';
  return `<input type="number" step="any" class="price-input${own == null ? ' is-suggested' : ''}" data-field="${field}" value="${val}" placeholder="—" title="${own == null ? 'Vorschlag (kursiv) – editierbar, wird beim Ändern gespeichert' : 'Eigener Wert'} · Anzeige in ${displayCurrency}, gespeichert in ${nativeCurrency(c)}">`;
}

const TV_LOGO = 'https://s3.tradingview.com/userpics/6171439-mFQX_big.png';
const ST_LOGO = 'https://avatars.githubusercontent.com/u/30304?s=200&v=4';
const YH_LOGO = 'https://s.yimg.com/os/creatr-uploaded-images/2021-04/05009f00-a857-11eb-bfd7-56b7773a2529';

const STATE_LABELS = {
  new: 'Neu', reviewed: 'Gesehen', promoted: 'Promoted',
  dismissed: 'Abgelehnt', imported: 'Importiert',
};
const STATE_ORDER  = ['new', 'reviewed', 'promoted', 'dismissed', 'imported'];

const COL_WIDTH_KEY = 'discovery.colwidths.v1';

const ADAPTER_COLORS = {
  openinsider:            '#e67e22',
  'boerse-frankfurt':     '#3498db',
  'etf-holdings':         '#2ecc71',
  stocktwits:             '#1d9bf0',
  'yahoo-trending':       '#6001d2',
  'yahoo-growth':         '#9b59b6',
  'tradingview-screener': '#2962ff',
};

// ── Formatters ───────────────────────────────────────────────────────────────

function fmtPct(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%';
}
function fmtNum(v, dec = 2) {
  if (v == null) return '—';
  return Number(v).toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtMCap(mc) {
  if (mc == null) return '—';
  if (mc >= 1e12) return `${(mc / 1e12).toFixed(1)}T`;
  if (mc >= 1e9)  return `${(mc / 1e9).toFixed(1)}B`;
  if (mc >= 1e6)  return `${(mc / 1e6).toFixed(0)}M`;
  return mc.toLocaleString();
}
function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function posNegClass(v) {
  if (v == null) return '';
  return v > 0 ? ' pos' : v < 0 ? ' neg' : '';
}
function rsiClass(v) {
  if (v == null) return '';
  if (v >= 70) return ' neg';
  if (v <= 30) return ' pos';
  return '';
}
function capSizeFromMC(mc) {
  if (mc == null) return null;
  if (mc < 300e6) return 'micro';
  if (mc < 2e9)   return 'small';
  if (mc < 50e9)  return 'mid';
  return 'large';
}
function tvRatingClass(r) {
  if (r == null) return 'neutral';
  if (r > 0.5)   return 'strong-buy';
  if (r > 0.1)   return 'buy';
  if (r < -0.5)  return 'strong-sell';
  if (r < -0.1)  return 'sell';
  return 'neutral';
}
function tvRatingGlyph(r) {
  if (r == null) return '?';
  if (r > 0.5)   return '↑↑';
  if (r > 0.1)   return '↑';
  if (r < -0.5)  return '↓↓';
  if (r < -0.1)  return '↓';
  return '→';
}
function timeAgo(isoStr) {
  if (!isoStr) return '–';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
function getLatestSignal(c) {
  if (!c.sources?.length) return '';
  return c.sources[c.sources.length - 1].info_snippet ?? '';
}
function renderSourceBadges(sources) {
  return [...new Set(sources.map((s) => s.adapter))]
    .map((a) => {
      // TradingView labels: black background, white ink.
      if (a === 'tradingview-screener') {
        return `<span class="badge" style="background:#000;color:#fff;border:1px solid #000">${a}</span>`;
      }
      const color = ADAPTER_COLORS[a] ?? '#888';
      return `<span class="badge" style="background:${color}18;color:${color};border:1px solid ${color}55">${a}</span>`;
    }).join(' ');
}

function sortValue(c, col) {
  const tv = c.tv_data;
  switch (col) {
    case 'symbol':    return c.symbol.toLowerCase();
    case 'name':      return c.name ? c.name.toLowerCase() : null;
    case 'sector':    return c.sector ? c.sector.toLowerCase() : null;
    case 'discovered':return c.first_discovered_at ? new Date(c.first_discovered_at).getTime() : null;
    case 'state':     return STATE_ORDER.indexOf(c.workspace_state);
    case 'sources':   return c.sources.length;
    case 'tv_chg1d':  return tv?.change_1d ?? null;
    case 'tv_close':  return tv?.close_1m ?? tv?.close ?? null;
    case 'tv_chg1w':  return tv?.change_1w ?? null;
    case 'tv_chg1m':  return tv?.change_1m ?? null;
    case 'tv_perfw':  return tv?.perf_w ?? null;
    case 'tv_perf1m': return tv?.perf_1m ?? null;
    case 'tv_h1m':    return tv?.high_1m ?? null;
    case 'tv_l1m':    return tv?.low_1m ?? null;
    case 'tv_h52hi':  return tv?.price_52_week_high ?? null;
    case 'tv_h52lo':  return tv?.price_52_week_low ?? null;
    case 'tv_hall':   return tv?.high_all ?? null;
    case 'tv_lall':   return tv?.low_all ?? null;
    case 'tv_perfall':return tv?.perf_all ?? null;
    case 'tv_aroondn120': return tv?.aroon_down_120 ?? null;
    case 'tv_aroondn1m':  return tv?.aroon_down_1m ?? null;
    case 'tv_aroonup120': return tv?.aroon_up_120 ?? null;
    case 'tv_aroonup1m':  return tv?.aroon_up_1m ?? null;
    case 'tv_macdsig': return tv?.macd_signal ?? null;
    case 'tv_rsi':         return tv?.rsi ?? null;
    case 'tv_trend_score':          return tv?.trend_score?.total          ?? null;
    case 'tv_entry_score':          return liveEntryScore(tv)?.total       ?? null;
    case 'tv_overall_score':        return liveOverallScore(tv)?.total     ?? null;
    case 'tv_upside':   return computeUpsidePotential(tv)?.upside   ?? null;
    case 'tv_downside': return computeUpsidePotential(tv)?.downside ?? null;
    case 'tv_perf3m':   return tv?.perf_3m ?? null;
    case 'tv_perf6m':   return tv?.perf_6m ?? null;
    case 'tv_growth6m': return monthlyGrowthRate(tv?.perf_6m, 6);
    case 'tv_volm':     return tv?.volatility_m ?? null;
    case 'tv_atrp':     return tv?.atrp ?? null;
    case 'tv_pivr2':    return tv?.pivot_r2 ?? null;
    case 'tv_pivs2':    return tv?.pivot_s2 ?? null;
    case 'tv_h3m':      return tv?.high_3m ?? null;
    case 'tv_l3m':      return tv?.low_3m ?? null;
    case 'tv_analysts': return tv?.recommendation_total ?? null;
    case 'currency':    return nativeCurrency(c);
    case 'my_entry':    return c.my_entry ?? null;
    case 'my_target':   return c.my_target ?? null;
    case 'setup':       return priceSituation(tv)?.icon ?? null;
    case 'momentum':    return c.momentum_check?.total ?? ({ green: 3, yellow: 2, red: 1 }[c.momentum_check?.verdict] ?? null);
    case 'tr_check':    return c.tr_check == null ? null : (c.tr_check.tradable ? 2 : c.tr_check.tradable === false ? 1 : 0);
    case 'ls_price':    return c.ls_quote?.price ?? null;
    case 'ls_chg':      return c.ls_quote?.change_pct ?? null;
    case 'mk_entry':    return c.mk_entry ?? null;
    case 'mk_pl':       return plData(c)?.pct ?? null;
    case 'range52':     return rangePos(c.tv_data) ?? null;
    case 'atrp': {       // sort by current spread: today's move relative to one ATR
      const a = c.tv_data?.atrp;
      const ch = c.ls_quote?.change_pct ?? c.tv_data?.change_1d;
      return (a > 0 && ch != null) ? Math.abs(ch) / a : null;
    }
    case 'signal':      return c.momentum_check?.total ?? (c.tv_data?.recommend_all_1m ?? null);
    case 'tv_health_score':         return tv?.health_score?.total         ?? null;
    case 'tv_cycle_score':          return tv?.cycle_score?.total          ?? null;
    case 'tv_trend_strength_score': return tv?.trend_strength_score?.total ?? null;
    case 'tv_ema20':  return tv?.ema20 ?? null;
    case 'tv_ema50':  return tv?.ema50 ?? null;
    case 'tv_ema200': return tv?.ema200 ?? null;
    case 'tv_macd':   return tv?.macd ?? null;
    case 'tv_adx':    return tv?.adx ?? null;
    case 'tv_cci':    return tv?.cci20_1m ?? null;
    case 'tv_donchlo':return tv?.donch_ch20_lower_1m ?? null;
    case 'tv_donchhi':return tv?.donch_ch20_upper_1m ?? null;
    case 'tv_pe':          return tv?.pe_ttm ?? null;
    case 'tv_div':         return tv?.dividend_yield ?? null;
    case 'tv_eps':         return tv?.basic_eps_net_income ?? null;
    case 'tv_long_entry':  return liveEntryPrices(tv)?.longEntry  ?? null;
    case 'tv_short_entry': return liveEntryPrices(tv)?.shortEntry ?? null;
    case 'tv_earnings':    return tv?.earnings_next_date ?? null;
    case 'tv_ebitdagrowth':return tv?.ebitda_yoy_growth_fy ?? null;
    case 'tv_ebitda': return tv?.ebitda ?? null;
    case 'tv_grossmargin': return tv?.gross_margin ?? null;
    case 'tv_grossgrowth': return tv?.gross_profit_yoy_growth_fy ?? null;
    case 'tv_mom1m':  return tv?.mom_1m ?? null;
    case 'tv_vol':    return tv?.volatility ?? null;
    case 'tv_beta':   return tv?.beta ?? null;
    case 'tv_beta3y': return tv?.beta_3_year ?? null;
    case 'tv_vol10d': return tv?.avg_vol_10d ?? null;
    case 'tv_vol30d': return tv?.average_volume_30d_calc ?? null;
    case 'tv_rating1m':return tv?.recommend_all_1m ?? null;
    case 'tv_mcap':   return tv?.market_cap ?? null;
    case 'star':      return c.in_portfolio ? 1 : 0;
    case 'broker':    return c.broker_armed ? 1 : 0;
    default:          return '';
  }
}

// ── Column definitions ───────────────────────────────────────────────────────

const VIEWS = {
  performance: [
    { key:'tv_upside',  label:'▲POT1M', title:'Upside-Potenzial ~1 Monat: Drift + σ, gedeckelt am nächsten Widerstand · ⚠ = Earnings im Zeitfenster', num:true, fmt:c=>renderUpside(computeUpsidePotential(c.tv_data),'up') },
    { key:'tv_downside',label:'▼POT1M', title:'Downside-Risiko ~1 Monat: σ − Drift, gedeckelt an der nächsten Unterstützung', num:true, fmt:c=>renderUpside(computeUpsidePotential(c.tv_data),'down') },
    { key:'tv_chg1d',   label:'Δ1T',    title:'Veränderung heute (1 Tag)',        num:true, fmt:c=>`<span class="${posNegClass(c.tv_data?.change_1d)}">${fmtPct(c.tv_data?.change_1d)}</span>` },
    { key:'tv_chg1w',   label:'Δ1W',    title:'Veränderung 1 Woche',              num:true, fmt:c=>`<span class="${posNegClass(c.tv_data?.change_1w)}">${fmtPct(c.tv_data?.change_1w)}</span>` },
    { key:'tv_chg1m',   label:'Δ1M',    title:'Veränderung 1 Monat',              num:true, fmt:c=>`<span class="${posNegClass(c.tv_data?.change_1m)}">${fmtPct(c.tv_data?.change_1m)}</span>` },
    { key:'tv_perfw',   label:'PerfW',  title:'Perf.W – rollierend ~5 Handelstage', num:true, fmt:c=>`<span class="${posNegClass(c.tv_data?.perf_w)}">${fmtPct(c.tv_data?.perf_w)}</span>` },
    { key:'tv_perf1m',  label:'Perf1M', title:'Perf.1M – rollierend ~21 Handelstage', num:true, fmt:c=>`<span class="${posNegClass(c.tv_data?.perf_1m)}">${fmtPct(c.tv_data?.perf_1m)}</span>` },
    { key:'tv_perf3m',  label:'Perf3M', title:'Performance 3 Monate',             num:true, fmt:c=>`<span class="${posNegClass(c.tv_data?.perf_3m)}">${fmtPct(c.tv_data?.perf_3m)}</span>` },
    { key:'tv_perf6m',  label:'Perf6M', title:'Performance 6 Monate',             num:true, fmt:c=>`<span class="${posNegClass(c.tv_data?.perf_6m)}">${fmtPct(c.tv_data?.perf_6m)}</span>` },
    { key:'tv_growth6m',label:'ØGr/M',  title:'Ø monatliche Growth Rate der letzten 6 Monate (geometrisch aus Perf.6M)', num:true, fmt:c=>{const g=monthlyGrowthRate(c.tv_data?.perf_6m,6);return `<span class="${posNegClass(g)}">${fmtPct(g)}</span>`;} },
    { key:'tv_perfall', label:'%ATH',   title:'Performance seit Beginn',          num:true, fmt:c=>`<span class="${posNegClass(c.tv_data?.perf_all)}">${c.tv_data?.perf_all!=null?fmtNum(c.tv_data.perf_all,1)+'%':'—'}</span>` },
    { key:'tv_volm',    label:'VolaM',  title:'Ø Tagesvolatilität über 1 Monat (%)', num:true, fmt:c=>fmtNum(c.tv_data?.volatility_m,2) },
    { key:'tv_atrp',    label:'ATRP',   title:'Average True Range in Prozent',    num:true, fmt:c=>fmtNum(c.tv_data?.atrp,2) },
  ],
  price: [
    { key:'currency',  label:'W\u00e4',  title:'W\u00e4hrung der B\u00f6rse (Preise werden nach USD/EUR umgerechnet, andere W\u00e4hrungen bleiben nativ)', num:false, fmt:c=>`<span class="currency-tag">${nativeCurrency(c)}</span>` },
    { key:'setup',     label:'Setup', title:'Preis-Situation: \ud83d\ude80 Blue-Sky \u00b7 \ud83c\udfaf Breakout-N\u00e4he \u00b7 \ud83d\udd04 Pullback im Trend \u00b7 \ud83d\udcc9 unter Trend \u00b7 \u2796 Range \u00b7 \u26a0 Earnings im 1M-Fenster', num:false, fmt:c=>{const s=priceSituation(c.tv_data);return s?`<span class="setup-icon" title="${s.label}">${s.icon}</span>`:'\u2014';} },
    { key:'my_entry',  label:'Mein Entry', title:'Entry-Preis (Vorschlag: EMA20, kursiv) \u2013 editierbar, wird gespeichert', num:true, fmt:c=>priceInput(c,'my_entry') },
    { key:'my_target', label:'Mein Ziel',  title:'Kursziel (Vorschlag: Entry \u00d7 1,2 = mind. 20% Upside, kursiv) \u2013 editierbar, wird gespeichert \u00b7 native W\u00e4hrung', num:true, fmt:c=>priceInput(c,'my_target') },
    { key:'tv_long_entry',  label:'Long',  title:'Long Entry Preis: \u00d8 aus BB.lower + Pivot S1 + (close + 0.5\u00d7ATR)', num:true, fmt:c=>renderEntryPrice(liveEntryPrices(c.tv_data),'long',convFactor(c)) },
    { key:'tv_close',       label:'Kurs',  title:'Aktueller Kurs (1-Min Intraday, Fallback: Tagesschluss)', num:true, fmt:c=>fmtPrice(c, c.tv_data?.close_1m ?? c.tv_data?.close) },
    { key:'tv_short_entry', label:'Short', title:'Short Entry Preis: \u00d8 aus BB.upper + Pivot R1 + (close \u2212 0.5\u00d7ATR)', num:true, fmt:c=>renderEntryPrice(liveEntryPrices(c.tv_data),'short',convFactor(c)) },
    { key:'tv_ema20',   label:'EMA20',  title:'EMA 20',                           num:true, fmt:c=>fmtPrice(c, c.tv_data?.ema20) },
    { key:'tv_ema50',   label:'EMA50',  title:'EMA 50',                           num:true, fmt:c=>fmtPrice(c, c.tv_data?.ema50) },
    { key:'tv_ema200',  label:'EMA200', title:'EMA 200',                          num:true, fmt:c=>fmtPrice(c, c.tv_data?.ema200) },
    { key:'tv_h1m',     label:'H1M',    title:'Hoch 1 Monat',                     num:true, fmt:c=>fmtPrice(c, c.tv_data?.high_1m) },
    { key:'tv_l1m',     label:'L1M',    title:'Tief 1 Monat',                     num:true, fmt:c=>fmtPrice(c, c.tv_data?.low_1m) },
    { key:'tv_h3m',     label:'H3M',    title:'Hoch 3 Monate',                    num:true, fmt:c=>fmtPrice(c, c.tv_data?.high_3m) },
    { key:'tv_l3m',     label:'L3M',    title:'Tief 3 Monate',                    num:true, fmt:c=>fmtPrice(c, c.tv_data?.low_3m) },
    { key:'tv_h52hi',   label:'52W\u2191',   title:'52-Wochen-Hoch',             num:true, fmt:c=>fmtPrice(c, c.tv_data?.price_52_week_high) },
    { key:'tv_h52lo',   label:'52W\u2193',   title:'52-Wochen-Tief',             num:true, fmt:c=>fmtPrice(c, c.tv_data?.price_52_week_low) },
    { key:'tv_hall',    label:'ATH',    title:'All-Time-High',                    num:true, fmt:c=>fmtPrice(c, c.tv_data?.high_all) },
    { key:'tv_lall',    label:'ATL',    title:'All-Time-Low',                     num:true, fmt:c=>fmtPrice(c, c.tv_data?.low_all) },
    { key:'tv_pivr2',   label:'PivR2',  title:'Pivot Monthly Classic R2',         num:true, fmt:c=>fmtPrice(c, c.tv_data?.pivot_r2) },
    { key:'tv_pivs2',   label:'PivS2',  title:'Pivot Monthly Classic S2',         num:true, fmt:c=>fmtPrice(c, c.tv_data?.pivot_s2) },
    { key:'tv_donchlo', label:'DC\u2193',    title:'Donchian Channel 20 Lower (1M)', num:true, fmt:c=>fmtPrice(c, c.tv_data?.donch_ch20_lower_1m) },
    { key:'tv_donchhi', label:'DC\u2191',    title:'Donchian Channel 20 Upper (1M)', num:true, fmt:c=>fmtPrice(c, c.tv_data?.donch_ch20_upper_1m) },
  ],
  metrics: [
    { key:'tv_rsi',     label:'RSI',    title:'Relative Strength Index',          num:true, fmt:c=>`<span class="${rsiClass(c.tv_data?.rsi)}">${fmtNum(c.tv_data?.rsi,1)}</span>` },
    { key:'tv_macd',    label:'MACD',   title:'MACD',                             num:true, fmt:c=>`<span class="${posNegClass(c.tv_data?.macd)}">${fmtNum(c.tv_data?.macd,3)}</span>` },
    { key:'tv_macdsig', label:'MACD·S', title:'MACD Signal',                      num:true, fmt:c=>`<span class="${posNegClass(c.tv_data?.macd_signal)}">${fmtNum(c.tv_data?.macd_signal,3)}</span>` },
    { key:'tv_adx',     label:'ADX',    title:'Average Directional Index',        num:true, fmt:c=>fmtNum(c.tv_data?.adx,1) },
    { key:'tv_cci',     label:'CCI',    title:'Commodity Channel Index 20 (1M)',  num:true, fmt:c=>`<span class="${posNegClass(c.tv_data?.cci20_1m)}">${fmtNum(c.tv_data?.cci20_1m,1)}</span>` },
    { key:'tv_aroonup120',label:'Ar↑120',title:'Aroon Up 120',                    num:true, fmt:c=>fmtNum(c.tv_data?.aroon_up_120,1) },
    { key:'tv_aroondn120',label:'Ar↓120',title:'Aroon Down 120',                  num:true, fmt:c=>fmtNum(c.tv_data?.aroon_down_120,1) },
    { key:'tv_aroonup1m', label:'Ar↑1M', title:'Aroon Up 1 Monat',                num:true, fmt:c=>fmtNum(c.tv_data?.aroon_up_1m,1) },
    { key:'tv_aroondn1m', label:'Ar↓1M', title:'Aroon Down 1 Monat',              num:true, fmt:c=>fmtNum(c.tv_data?.aroon_down_1m,1) },
    { key:'tv_mom1m',   label:'Mom',    title:'Momentum 1 Monat',                 num:true, fmt:c=>`<span class="${posNegClass(c.tv_data?.mom_1m)}">${fmtNum(c.tv_data?.mom_1m,2)}</span>` },
    { key:'tv_vol',     label:'Vola',   title:'Volatilität (Tag)',                num:true, fmt:c=>fmtNum(c.tv_data?.volatility,1) },
    { key:'tv_beta',    label:'Beta',   title:'Beta (1 Jahr)',                    num:true, fmt:c=>fmtNum(c.tv_data?.beta,2) },
    { key:'tv_beta3y',  label:'β3Y',    title:'Beta (3 Jahre)',                   num:true, fmt:c=>fmtNum(c.tv_data?.beta_3_year,2) },
    { key:'tv_vol10d',  label:'V10d',   title:'Ø Volumen 10 Tage',                num:true, fmt:c=>fmtMCap(c.tv_data?.avg_vol_10d) },
    { key:'tv_vol30d',  label:'V30d',   title:'Ø Volumen 30 Tage',                num:true, fmt:c=>fmtMCap(c.tv_data?.average_volume_30d_calc) },
    { key:'tv_rating1m',label:'Rat1M',  title:'Empfehlung 1 Monat',               num:true, fmt:c=>`<span class="tv-rating-txt--${tvRatingClass(c.tv_data?.recommend_all_1m)}">${fmtNum(c.tv_data?.recommend_all_1m,2)}</span>` },
  ],
  fundamentals: [
    { key:'tv_pe',          label:'KGV',    title:'Kurs-Gewinn-Verhältnis (TTM)',  num:true,  fmt:c=>fmtNum(c.tv_data?.pe_ttm,1) },
    { key:'tv_div',         label:'Div%',   title:'Dividendenrendite',             num:true,  fmt:c=>`<span class="${posNegClass(c.tv_data?.dividend_yield)}">${c.tv_data?.dividend_yield!=null?fmtNum(c.tv_data.dividend_yield,2)+'%':'—'}</span>` },
    { key:'tv_eps',         label:'EPS',    title:'Gewinn je Aktie',               num:true,  fmt:c=>`<span class="${posNegClass(c.tv_data?.basic_eps_net_income)}">${fmtNum(c.tv_data?.basic_eps_net_income,2)}</span>` },
    { key:'tv_earnings',    label:'Earnings',title:'Nächster Earnings-Termin',    num:false, fmt:c=>c.tv_data?.earnings_next_date?fmtDate(c.tv_data.earnings_next_date):'—' },
    { key:'tv_ebitdagrowth',label:'EBITDA%',title:'EBITDA YoY Wachstum',          num:true,  fmt:c=>`<span class="${posNegClass(c.tv_data?.ebitda_yoy_growth_fy)}">${c.tv_data?.ebitda_yoy_growth_fy!=null?fmtNum(c.tv_data.ebitda_yoy_growth_fy,1)+'%':'—'}</span>` },
    { key:'tv_ebitda',      label:'EBITDA', title:'EBITDA',                        num:true,  fmt:c=>fmtMCap(c.tv_data?.ebitda) },
    { key:'tv_grossmargin', label:'GM%',    title:'Bruttomarge',                   num:true,  fmt:c=>`<span class="${posNegClass(c.tv_data?.gross_margin)}">${c.tv_data?.gross_margin!=null?fmtNum(c.tv_data.gross_margin,1)+'%':'—'}</span>` },
    { key:'tv_grossgrowth', label:'Gross%', title:'Bruttogewinn YoY Wachstum',    num:true,  fmt:c=>`<span class="${posNegClass(c.tv_data?.gross_profit_yoy_growth_fy)}">${c.tv_data?.gross_profit_yoy_growth_fy!=null?fmtNum(c.tv_data.gross_profit_yoy_growth_fy,1)+'%':'—'}</span>` },
    { key:'tv_mcap',        label:'MCap',   title:'Marktkapitalisierung',          num:true,  fmt:c=>fmtMCap(c.tv_data?.market_cap) },
    { key:'tv_analysts',    label:'Analysten', title:'Anzahl Analysten mit Empfehlung', num:true, fmt:c=>fmtNum(c.tv_data?.recommendation_total,0) },
  ],
};

// Score view: all scoring columns (Standard keeps only the headline Score) plus
// the performance + raw-metric columns folded in for a single analytical deep-dive.
VIEWS.score = [
  { key:'tv_overall_score',        label:'Score',  title:'Overall Score 0–100', num:true, fmt:c=>renderOverallScore(liveOverallScore(c.tv_data)) },
  { key:'tv_trend_strength_score', label:'Stärke', title:'Trend Strength Score 0–100', num:true, fmt:c=>renderTrendStrengthScore(c.tv_data?.trend_strength_score) },
  { key:'tv_health_score',         label:'Health', title:'Financial Health Score 0–100', num:true, fmt:c=>renderHealthScore(liveHealthScore(c.tv_data)) },
  { key:'tv_cycle_score',          label:'PCHS',   title:'Price Cycle & Historical Position Score 0–100', num:true, fmt:c=>renderCycleScore(c.tv_data?.cycle_score) },
  { key:'momentum',                label:'Mom',    title:'Momentum-Punkte 0–100', num:true, fmt:c=>renderMomentumCheck(c.momentum_check) },
  { key:'tv_entry_score',          label:'Entry',  title:'Entry Timing Score 0–100', num:true, fmt:c=>renderEntryScore(liveEntryScore(c.tv_data)) },
  { key:'tv_rating1m',             label:'Trend',  title:'Empfehlung 1 Monat (Trend)', num:true, fmt:c=>{ const r=c.tv_data?.recommend_all_1m; return `<span class="tv-rating-txt--${tvRatingClass(r)}">${r!=null?`${tvRatingGlyph(r)} ${fmtNum(r,2)}`:'—'}</span>`; } },
  ...VIEWS.performance,
  ...VIEWS.metrics,
];

// Meta view: identity + context columns moved out of the Standard view.
VIEWS.meta = [
  { key:'name',        label:'Name',           title:'Firmenname', num:false, fmt:c=>`<span class="name-cell" title="${c.name ?? ''}">${c.name ?? '—'}</span>` },
  { key:'sector',      label:'Sektor',         title:'Sektor', num:false, fmt:c=>`<span class="sector-cell">${c.sector ?? '—'}</span>` },
  { key:'sources',     label:'Quellen',        title:'Signal-Quellen', num:false, fmt:c=>renderSourceBadges(c.sources) },
  { key:'links',       label:'Links',          title:'Externe Links', num:false, fmt:c=>`<div class="link-cluster">${chipLink(c.links?.tradingview,TV_LOGO,'TradingView','link-chip--tv')}${chipLink(c.links?.stocktwits,ST_LOGO,'StockTwits','link-chip--st')}${chipLink(c.links?.yahoo,YH_LOGO,'Yahoo Finance','link-chip--yahoo')}</div>` },
  { key:'discovered',  label:'in',             title:'Erstmals entdeckt', num:false, fmt:c=>`<span class="time-chip" title="${c.first_discovered_at}">${timeAgo(c.first_discovered_at)}</span>` },
  { key:'signal_text', label:'Letztes Signal', title:'Letztes Signal aus den Quellen', num:false, fmt:c=>`<span class="signal-text">${getLatestSignal(c)}</span>` },
  { key:'currency',    label:'Wä',        title:'Börsenwährung', num:false, fmt:c=>`<span class="currency-tag">${nativeCurrency(c)}</span>` },
];

// ── Component ────────────────────────────────────────────────────────────────

export class CandidateList {
  constructor({ onSelect, onAction, onBulkAction, onSelectionChange }) {
    this.onSelect          = onSelect;
    this.onAction          = onAction;
    this.onBulkAction      = onBulkAction;
    this.onSelectionChange = onSelectionChange;
    this.candidates        = [];
    this.filters           = { state: '', sector: '', capSize: '', broker: '', score: '' };
    this.sort              = { column: 'discovered', direction: 'desc' };
    this.selected          = new Set();
    this.showSelectedOnly  = false;
    this.viewMode          = 'standard';

    this.thead     = document.getElementById('candidate-thead');
    this.tbody     = document.getElementById('candidate-tbody');
    this.emptyState = document.getElementById('empty-state');
    this.bulkBar   = document.getElementById('bulk-bar');
    this.bulkCount = document.getElementById('bulk-count');

    this.renderBulkActions();
    this.renderThead();
    this.bindSelectAll();
  }

  setData(candidates) {
    this.candidates = candidates;
    this.selected.clear();
    this.showSelectedOnly = false;
    this.renderRows();
    this.renderBulkBar();
  }

  setFilter(key, value) {
    this.filters[key] = value;
    this.selected.clear();
    this.showSelectedOnly = false;
    this.renderRows();
    this.renderBulkBar();
  }

  setShowSelectedOnly(value) {
    this.showSelectedOnly = value;
    this.renderRows();
  }

  setDisplayCurrency(cur) {
    displayCurrency = cur === 'EUR' ? 'EUR' : 'USD';
    this.renderRows();
  }

  setFxRate(rate) {
    if (typeof rate === 'number' && rate > 0) {
      fxEurUsd = rate;
      this.renderRows();
    }
  }

  hasFxRate() { return fxEurUsd != null; }

  // Momentum-Check für die angegebenen Kandidaten berechnen.
  // Returns bulk-update list for persistence; null-results clear stale checks.
  runMomentumCheck(ids) {
    const updates = [];
    for (const c of this.candidates) {
      if (!ids.includes(c.id)) continue;
      const tv = c.tv_data;
      c.momentum_check = computeMomentumCheck(tv);
      updates.push({ candidate_id: c.id, updates: { momentum_check: c.momentum_check } });
    }
    this.renderRows();
    return updates;
  }

  // Trade Republic / Lang & Schwarz tradability check for the given candidates.
  // Async (network via proxy); returns a bulk-update list for persistence.
  async runTrCheck(ids, opts) {
    const updates = [];
    for (const c of this.candidates) {
      if (!ids.includes(c.id)) continue;
      c.tr_check = await checkTradeRepublic(c, opts);
      updates.push({ candidate_id: c.id, updates: { tr_check: c.tr_check } });
    }
    this.renderRows();
    return updates;
  }

  // Lang & Schwarz intraday quote (EUR, the Trade-Republic venue) for the given
  // candidates. Async (network via proxy); returns a bulk-update list.
  async runLsQuote(ids, opts) {
    const updates = [];
    for (const c of this.candidates) {
      if (!ids.includes(c.id)) continue;
      c.ls_quote = await fetchLsQuote(c, opts);
      updates.push({ candidate_id: c.id, updates: { ls_quote: c.ls_quote } });
    }
    this.renderRows();
    return updates;
  }

  clearSelection() {
    this.selected.clear();
    this.showSelectedOnly = false;
    this.renderRows();
    this.renderBulkBar();
  }

  setSort(column) {
    const textCols = new Set(['symbol', 'name']);
    if (this.sort.column === column) {
      this.sort.direction = this.sort.direction === 'asc' ? 'desc' : 'asc';
    } else {
      this.sort.column    = column;
      this.sort.direction = textCols.has(column) ? 'asc' : 'desc';
    }
    this.renderRows();
  }

  setViewMode(mode) {
    // Sort + filter stay consistent across view toggles: keep the active
    // sort so the same tickers stay in the same order in every view.
    // Guard against stale persisted modes (e.g. removed 'technicals' view).
    this.viewMode = mode === 'standard' || VIEWS[mode] ? mode : 'standard';
    this.renderThead();
    this.renderRows();
  }

  // Returns ▲/▼ glyph only for the active sort column, nothing for others.
  sortGlyph(col) {
    if (this.sort.column !== col) return '';
    return `<span class="sort-glyph" aria-hidden="true">${this.sort.direction === 'asc' ? '▲' : '▼'}</span>`;
  }

  ariaSort(col) {
    if (this.sort.column !== col) return 'none';
    return this.sort.direction === 'asc' ? 'ascending' : 'descending';
  }

  th(col, label, extra = '') {
    return `<th ${extra} aria-sort="${this.ariaSort(col)}">
      <button class="sort-btn" data-sort="${col}">${label} ${this.sortGlyph(col)}</button></th>`;
  }
  thNum(col, label, title = '', extraClass = '') {
    return `<th class="num ${extraClass}" ${title ? `title="${title}"` : ''} aria-sort="${this.ariaSort(col)}">
      <button class="sort-btn" data-sort="${col}">${label} ${this.sortGlyph(col)}</button></th>`;
  }

  getFiltered() {
    const { state, sector, capSize, broker, score } = this.filters;
    return this.candidates.filter((c) => {
      if (this.showSelectedOnly && !this.selected.has(c.id))    return false;
      if (state   && c.workspace_state !== state)               return false;
      if (sector === '__no_sector__' && c.sector)               return false;
      if (sector && sector !== '__no_sector__' && c.sector !== sector) return false;
      if (capSize && capSizeFromMC(c.tv_data?.market_cap) !== capSize) return false;
      if (broker === 'broker' && !c.broker_armed)               return false;
      if (broker === 'star'   && !c.in_portfolio)               return false;
      if (broker === 'none'   && c.broker_armed)                return false;
      if (score) {
        const s = liveOverallScore(c.tv_data)?.total;
        if (s == null) return false;
        if (score === '80' && s < 80)             return false;
        if (score === '70' && (s < 70 || s > 79)) return false;
        if (score === '60' && (s < 60 || s > 69)) return false;
        if (score === '40' && (s < 40 || s > 59)) return false;
        if (score === '0'  && s >= 40)            return false;
      }
      return true;
    });
  }

  getSorted(candidates) {
    const { column, direction } = this.sort;
    if (!column) return [...candidates];
    const isEmpty = (v) => v == null || v === '';
    return [...candidates].sort((a, b) => {
      const va = sortValue(a, column), vb = sortValue(b, column);
      const ea = isEmpty(va), eb = isEmpty(vb);
      // Unpopulated cells always sort to the end, regardless of direction.
      if (ea && eb) return 0;
      if (ea) return 1;
      if (eb) return -1;
      if (va < vb) return direction === 'asc' ? -1 : 1;
      if (va > vb) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }

  getSectors() {
    return [...new Set(this.candidates.filter((c) => c.sector).map((c) => c.sector))].sort();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  renderThead() {
    let cols = '';
    cols += `<th class="col-check"><input type="checkbox" id="select-all" aria-label="Alle auswählen"></th>`;
    cols += this.th('symbol', 'Symbol', 'class="col-anchor"');

    if (this.viewMode === 'standard') {
      // Lean decision view. Entry + P/L are always in the DOM but hidden via
      // CSS unless the \u2605 (portfolio) filter is active (keeps header/row parity).
      cols += this.thNum('mk_entry', 'Entry', 'Entry: manueller Entry-Preis aus dem Merkliste-Portfolio (EUR) \u00b7 Zuordnung \u00fcber Symbol \u00b7 leer wenn nicht im Portfolio', 'col-portfolio');
      cols += this.thNum('ls_price', 'LS', 'Lang & Schwarz Echtzeitkurs (Handelsplatz Trade Republic, EUR) \u00b7 \u201eLS-Kurs\u201c-Button in der Subbar');
      cols += this.thNum('ls_chg', 'LS\u0394', 'Lang & Schwarz Ver\u00e4nderung vs. Vortag');
      cols += this.thNum('mk_pl', 'P/L', 'Gewinn/Verlust des Portfolio-Tickers: (LS-Kurs \u2212 Entry) \u00b7 % oben, absolut in \u20ac (mit entry_shares) darunter \u00b7 braucht LS-Kurs + Entry', 'col-portfolio');
      cols += this.thNum('range52', '52W', 'Position des aktuellen Kurses in der 52-Wochen-Spanne (Tief \u2026 Hoch)');
      cols += `<th class="num">Verlauf</th>`;
      cols += this.thNum('atrp', 'ATRP', 'Average True Range % (Tagesvolatilit\u00e4t) \u00b7 Balken = heutige Bewegung vs. typische ATR-Spanne \u00b7 Sortierung nach aktueller Spread (heutige Bewegung \u00f7 ATR)');
      cols += this.thNum('signal', 'Signal', 'Signal: Momentum-Ampel (gr\u00fcn/gelb/rot) + Trend-Richtung (Empfehlung 1M)');
      cols += this.thNum('tv_overall_score', 'Score', 'Overall Score 0\u2013100 \u00b7 alle weiteren Scores in der \u201eScore\u201c-Ansicht, Metadaten in \u201eMeta\u201c');
      cols += this.thNum('star', '\u2605', 'Im Portfolio (Benchmark-Marker)');
      cols += `<th class="num">Aktion</th>`;
    } else {
      cols += VIEWS[this.viewMode].map((d) =>
        `<th class="${d.num ? 'num' : ''}" aria-sort="${this.ariaSort(d.key)}" title="${d.title}">
          <button class="sort-btn" data-sort="${d.key}">${d.label} ${this.sortGlyph(d.key)}</button></th>`
      ).join('');
      cols += `<th class="num">Aktion</th>`;
      cols += this.thNum('star', '\u2605', 'Im Portfolio (Benchmark-Marker)');
      cols += this.thNum('broker', '\u2713', 'Im Broker handelbar & Alert scharf');
      cols += this.thNum('tr_check', 'TR', 'Trade-Republic-Handelbarkeit (via Lang & Schwarz): \u2713 auf LS gelistet = sehr wahrscheinlich auf TR \u00b7 \u2717 nicht auf LS = nicht auf TR \u00b7 ? ungepr\u00fcft \u00b7 Klick \u00f6ffnet die LS-Seite \u00b7 Check-Button (Einkaufstasche) in der Subbar f\u00fcr ausgew\u00e4hlte Ticker');
    }

    this.thead.innerHTML = `<tr>${cols}</tr>`;
    this.thead.querySelectorAll('.sort-btn[data-sort]').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.setSort(btn.dataset.sort); });
    });
    this.initColumnResizers();
    this.bindSelectAll();
  }

  // ── Column resizing (drag on header edge, persisted per view) ──────────────

  loadColWidths() {
    try { return JSON.parse(localStorage.getItem(COL_WIDTH_KEY) ?? '{}'); }
    catch { return {}; }
  }

  saveColWidths(widths, sig) {
    const all = this.loadColWidths();
    all[this.viewMode] = { sig, widths };
    try { localStorage.setItem(COL_WIDTH_KEY, JSON.stringify(all)); } catch {}
  }

  clearColWidths(ths) {
    const all = this.loadColWidths();
    delete all[this.viewMode];
    try { localStorage.setItem(COL_WIDTH_KEY, JSON.stringify(all)); } catch {}
    ths.forEach((th) => { th.style.width = ''; });
    this.table.classList.remove('candidate-table--fixed');
  }

  // Stable identity of the current column set: widths saved for an older
  // column layout must not be applied by index to a shifted layout.
  colSignature(ths) {
    return ths.map((th) => th.querySelector('.sort-btn')?.dataset.sort ?? th.textContent.trim()).join('|');
  }

  // Freeze every column at its current rendered width so adjusting one
  // column doesn't reflow the others (requires table-layout: fixed).
  freezeColWidths(ths) {
    const widths = {};
    ths.forEach((th, i) => {
      widths[i] = th.offsetWidth;
      th.style.width = `${th.offsetWidth}px`;
    });
    this.table.classList.add('candidate-table--fixed');
    return widths;
  }

  initColumnResizers() {
    this.table = this.table ?? this.thead.closest('table');
    const ths = [...this.thead.querySelectorAll('th')];
    const sig = this.colSignature(ths);

    // Re-apply saved widths only when they belong to exactly this column set
    const entry = this.loadColWidths()[this.viewMode];
    const saved = entry?.sig === sig ? entry.widths : null;
    if (saved && Object.keys(saved).length === ths.length) {
      ths.forEach((th, i) => { if (saved[i]) th.style.width = `${saved[i]}px`; });
      this.table.classList.add('candidate-table--fixed');
    } else {
      ths.forEach((th) => { th.style.width = ''; });
      this.table.classList.remove('candidate-table--fixed');
    }

    ths.forEach((th, i) => {
      const grip = document.createElement('span');
      grip.className = 'col-resizer';
      grip.title = 'Ziehen: Spaltenbreite · Doppelklick: alle Breiten zurücksetzen';
      grip.addEventListener('click', (e) => e.stopPropagation());
      grip.addEventListener('dblclick', (e) => { e.stopPropagation(); this.clearColWidths(ths); });
      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const entryNow = this.loadColWidths()[this.viewMode];
        let widths = (entryNow?.sig === sig && this.table.classList.contains('candidate-table--fixed'))
          ? { ...entryNow.widths }
          : this.freezeColWidths(ths);
        const startX = e.clientX;
        const startW = th.offsetWidth;
        grip.setPointerCapture(e.pointerId);
        const onMove = (ev) => {
          const w = Math.max(36, startW + (ev.clientX - startX));
          th.style.width = `${w}px`;
          widths[i] = w;
        };
        const onUp = () => {
          grip.removeEventListener('pointermove', onMove);
          grip.removeEventListener('pointerup', onUp);
          this.saveColWidths(widths, sig);
        };
        grip.addEventListener('pointermove', onMove);
        grip.addEventListener('pointerup', onUp);
      });
      th.appendChild(grip);
    });
  }

  renderRows() {
    // Show the Einstand/P/L columns only in Standard view with the ★ filter on.
    this.thead.closest('table')?.classList.toggle(
      'show-portfolio-cols', this.viewMode === 'standard' && this.filters.broker === 'star');
    const rows = this.getSorted(this.getFiltered());
    this.tbody.innerHTML = '';

    if (rows.length === 0) {
      this.emptyState.style.display = 'block';
      this.emptyState.className = 'empty-state';
      this.emptyState.innerHTML = '<p>Keine Kandidaten gefunden.</p>';
      this.renderBulkBar();
      return;
    }
    this.emptyState.style.display = 'none';

    for (const c of rows) {
      const tv    = c.tv_data;
      const links = c.links ?? {};
      const canPromote = !['promoted', 'imported'].includes(c.workspace_state);
      const canDismiss = c.workspace_state !== 'dismissed';
      const isSelected = this.selected.has(c.id);

      const symHtml = `<div class="sym-cell">
        <div class="sym-cell__top">
          <span class="sym-strong">${c.symbol}</span>
          ${chipLink(links.tradingview, TV_LOGO, 'TradingView', 'link-chip--tv')}
          ${c.enrichment ? `<span class="ai-badge" title="AI Enrichment">${icons.sparkles}</span>` : ''}
        </div>
        <span class="exch-tag exch-tag--sub">${c.exchange}</span>
      </div>`;

      const trigSet = !!(c.intraday_trigger && (c.intraday_trigger.markers || c.intraday_trigger.stop_loss));
      const actionTd = `<td class="num"><div class="row-actions">
        ${canPromote ? `<button class="act-btn act-btn--promote" data-action="promote" aria-label="Promoten">${icons.check}</button>` : ''}
        ${canDismiss ? `<button class="act-btn act-btn--dismiss" data-action="dismiss" aria-label="Ablehnen">${icons.xMark}</button>` : ''}
        <button class="act-btn act-btn--trigger${trigSet ? ' is-active' : ''}" data-action="openTrigger" title="${trigSet ? 'Trigger bearbeiten (Marker / Stop-Loss)' : 'Trigger hinzufügen (Marker / Stop-Loss)'}">${trigSet ? '✓' : '+'}</button>
      </div></td>`;

      const starTd = `<td class="num"><button class="act-btn act-btn--star${c.in_portfolio ? ' is-active' : ''}" data-action="toggleStar" title="${c.in_portfolio ? 'Portfolio-Marker entfernen' : 'Als Portfolio-Ticker markieren'}">${c.in_portfolio ? icons.starFilled : icons.starEmpty}</button></td>`;

      const brokerTd = `<td class="num"><button class="act-btn act-btn--broker${c.broker_armed ? ' is-active' : ''}" data-action="toggleBroker" title="${c.broker_armed ? 'Broker-Marker entfernen' : 'Im Broker handelbar & Alert scharf'}">${icons.check}</button></td>`;

      const trCheckTd = `<td class="num">${renderTrCheck(c)}</td>`;

      let dataCols;
      if (this.viewMode === 'standard') {
        dataCols =
          `<td class="num col-portfolio">${renderMkEntry(c)}</td>` +
          `<td class="num">${lsPriceCell(c)}</td>` +
          `<td class="num">${lsChgCell(c)}</td>` +
          `<td class="num col-portfolio">${renderPL(c)}</td>` +
          `<td class="num">${render52wRange(tv)}</td>` +
          `<td class="num">${sparkCellHTML(c, fmtNum)}</td>` +
          `<td class="num">${atrpCellHTML(c, fmtNum)}</td>` +
          `<td class="num">${renderSignal(c)}</td>` +
          `<td class="num">${renderOverallScore(liveOverallScore(tv))}</td>` +
          starTd + actionTd;
      } else {
        dataCols = VIEWS[this.viewMode].map((d) => {
          const heat = HEAT_KEYS.has(d.key) ? heatStyle(sortValue(c, d.key)) : '';
          return `<td class="${d.num ? 'num' : ''}"${heat}>${d.fmt(c)}</td>`;
        }).join('') + actionTd + starTd + brokerTd + trCheckTd;
      }

      const tr = document.createElement('tr');
      tr.className = `candidate-row state-${c.workspace_state}${isSelected ? ' is-selected' : ''}`;
      tr.dataset.id = c.id;
      tr.setAttribute('tabindex', '0');
      tr.setAttribute('role', 'button');
      tr.setAttribute('aria-label', `${c.symbol} ${c.name}, ${STATE_LABELS[c.workspace_state] ?? ''}`);
      tr.innerHTML = `
        <td class="col-check"><input type="checkbox" class="row-check" ${isSelected ? 'checked' : ''} aria-label="${c.symbol} auswählen"></td>
        <td class="col-anchor">${symHtml}</td>
        ${dataCols}`;

      // Row click → open detail
      tr.addEventListener('pointerup', (e) => {
        if (['INPUT', 'BUTTON', 'A'].includes(e.target.tagName)) return;
        if (e.target.closest('.tr-check')) return; // ISIN-copy cell handles its own click
        this.onSelect?.(c);
      });
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.onSelect?.(c); }
      });

      // Checkbox
      tr.querySelector('.row-check').addEventListener('change', (e) => {
        if (e.target.checked) this.selected.add(c.id);
        else this.selected.delete(c.id);
        tr.classList.toggle('is-selected', e.target.checked);
        this.renderBulkBar();
        this.syncSelectAll();
      });

      // Promote / Dismiss / Star
      tr.querySelector('[data-action="promote"]')?.addEventListener('pointerup', (e) => { e.stopPropagation(); this.onAction?.('promote', c); });
      tr.querySelector('[data-action="dismiss"]')?.addEventListener('pointerup', (e) => { e.stopPropagation(); this.onAction?.('dismiss', c); });
      tr.querySelector('[data-action="toggleStar"]')?.addEventListener('pointerup', (e) => { e.stopPropagation(); this.onAction?.('toggleStar', c); });
      tr.querySelector('[data-action="toggleBroker"]')?.addEventListener('pointerup', (e) => { e.stopPropagation(); this.onAction?.('toggleBroker', c); });
      tr.querySelector('[data-action="openTrigger"]')?.addEventListener('pointerup', (e) => { e.stopPropagation(); this.onAction?.('openTrigger', c); });

      // TR cell: click copies the ISIN (fallback symbol) to the clipboard so
      // it can be pasted into the Trade Republic app search.
      const trCell = tr.querySelector('.tr-check');
      if (trCell) {
        const copyIsin = (e) => {
          e.stopPropagation();
          const val = trCell.dataset.copy;
          if (!val) return;
          if (navigator.clipboard) navigator.clipboard.writeText(val).catch(() => {});
          this.onAction?.('isinCopied', c, { value: val });
        };
        trCell.addEventListener('pointerup', (e) => e.stopPropagation());
        trCell.addEventListener('click', copyIsin);
        trCell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') copyIsin(e); });
      }

      // User price inputs (Mein Entry / Mein Ziel in the Preis view)
      tr.querySelectorAll('.price-input').forEach((inp) => {
        inp.addEventListener('pointerup', (e) => e.stopPropagation());
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
        inp.addEventListener('change', () => {
          // Input is shown in the display currency → convert back to native for storage.
          let value = inp.value === '' ? null : Number(inp.value);
          if (Number.isFinite(value)) value = Math.round((value / convFactor(c)) * 100) / 100;
          this.onAction?.('setUserPrice', c, { field: inp.dataset.field, value: Number.isFinite(value) ? value : null });
        });
      });

      this.tbody.appendChild(tr);
    }

    this.syncSelectAll();
    this.renderBulkBar();
  }

  renderBulkBar() {
    const count = this.selected.size;
    this.bulkCount.textContent = `${count} ausgewählt`;
    this.bulkBar.classList.toggle('is-open', count > 0);
    this.onSelectionChange?.(count);
  }

  renderBulkActions() {
    const ba = document.getElementById('bulk-actions');
    if (!ba) return;
    ba.innerHTML = `
      <button class="bulk-btn bulk-btn--accent" id="bulk-tv-data">${icons.barChart2} TV Daten</button>
      <button class="bulk-btn bulk-btn--accent" id="bulk-tr-check">🛒 TR-Check</button>
      <button class="bulk-btn bulk-btn--accent" id="bulk-ls-quote">📈 LS-Kurs</button>
      <button class="bulk-btn bulk-btn--neg"    id="bulk-dismiss">${icons.xMark} Ablehnen</button>
      <button class="bulk-btn bulk-btn--pos"    id="bulk-promote">${icons.check} Promoten</button>
      <button class="bulk-btn bulk-btn--accent" id="bulk-export">↗ Export</button>
      <button class="bulk-btn bulk-btn--ai"     id="bulk-enrich">${icons.sparkles} Enrich</button>
      <button class="bulk-btn bulk-btn--accent" id="bulk-copy-prompt">📋 Research-Prompt</button>
      <button class="bulk-btn bulk-btn--neg"    id="bulk-delete">${icons.trash} Löschen</button>
      <button class="bulk-btn bulk-btn--neutral" id="bulk-clear" aria-label="Auswahl leeren">${icons.xMark}</button>`;
    ba.querySelector('#bulk-dismiss').addEventListener('pointerup', () => this.onBulkAction?.('dismiss', [...this.selected]));
    ba.querySelector('#bulk-promote').addEventListener('pointerup', () => this.onBulkAction?.('promote', [...this.selected]));
    ba.querySelector('#bulk-export').addEventListener('pointerup',  () => this.onBulkAction?.('export',  [...this.selected]));
    ba.querySelector('#bulk-enrich').addEventListener('pointerup',  () => this.onBulkAction?.('enrich',  [...this.selected]));
    ba.querySelector('#bulk-tv-data').addEventListener('pointerup', () => this.onBulkAction?.('tv-data', [...this.selected]));
    ba.querySelector('#bulk-tr-check').addEventListener('pointerup', () => this.onBulkAction?.('tr-check', [...this.selected]));
    ba.querySelector('#bulk-ls-quote').addEventListener('pointerup', () => this.onBulkAction?.('ls-quote', [...this.selected]));
    ba.querySelector('#bulk-copy-prompt').addEventListener('pointerup', () => this.onBulkAction?.('copy-prompt', [...this.selected]));
    ba.querySelector('#bulk-delete').addEventListener('pointerup',  () => this.onBulkAction?.('delete',  [...this.selected]));
    ba.querySelector('#bulk-clear').addEventListener('pointerup',   () => this.clearSelection());
  }

  bindSelectAll() {
    const sa = document.getElementById('select-all');
    if (!sa) return;
    sa.addEventListener('change', (e) => {
      const rows = this.getSorted(this.getFiltered());
      if (e.target.checked) rows.forEach((c) => this.selected.add(c.id));
      else this.selected.clear();
      this.renderRows();
      this.renderBulkBar();
    });
  }

  syncSelectAll() {
    const sa = document.getElementById('select-all');
    if (!sa) return;
    const rows = this.getSorted(this.getFiltered());
    const sel  = rows.filter((c) => this.selected.has(c.id)).length;
    sa.checked       = rows.length > 0 && sel === rows.length;
    sa.indeterminate = sel > 0 && sel < rows.length;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderTrendScore(ts) {
  if (!ts) return '<span class="muted-dash">—</span>';
  const weekly = ts.weeklyAlign ? ' 🗓' : '';
  const tip = `${ts.label} (${Object.entries(ts.breakdown).map(([k, v]) => `${k.split('_')[0]}:${v}`).join(' ')})${ts.weeklyAlign ? ' · Wochentrend bestätigt' : ''}`;
  return `<span class="trend-score trend-score--${ts.labelCode}" title="${tip}">${ts.total}${weekly}</span>`;
}

function renderCycleScore(cs) {
  if (!cs) return '<span class="muted-dash">—</span>';
  const { s_lt, s_ath, s_52w, s_6m } = cs.components;
  const tip = `${cs.label} · LT:${s_lt} ATH:${s_ath} 52W:${s_52w} 6M:${s_6m}`;
  return `<span class="cycle-score cycle-score--${cs.labelCode}" title="${tip}">${cs.total}</span>`;
}

// Returns an entry score, re-computing from stored tv_data if not yet cached.
function liveEntryScore(tv) {
  if (!tv) return null;
  if (tv.entry_score) return tv.entry_score;
  // Derive on the fly from whatever fields are already stored (BB.lower may be absent → 0 pts there)
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

// Returns an entry-prices result, re-computing from stored tv_data if not yet cached.
function liveEntryPrices(tv) {
  if (!tv) return null;
  if (tv.entry_prices) return tv.entry_prices;
  return computeEntryPrices({
    'BB.lower':           tv.bb_lower,
    'BB.upper':           tv.bb_upper,
    'Pivot.M.Classic.S1': tv.pivot_s1,
    'Pivot.M.Classic.R1': tv.pivot_r1,
    close:                tv.close,
    ATR:                  tv.atr,
  });
}

function renderEntryPrice(ep, side, factor = 1) {
  if (!ep) return '<span class="muted-dash">—</span>';
  const price = side === 'long' ? ep.longEntry : ep.shortEntry;
  if (price == null) return '<span class="muted-dash">—</span>';
  const bd = ep.breakdown;
  const f = (v) => (v != null ? fmtNum(v * factor) : null);
  const tipLines = side === 'long'
    ? [bd.meanRevLong != null  && `MR:${f(bd.meanRevLong)}`,
       bd.pivotLong   != null  && `Pivot:${f(bd.pivotLong)}`,
       bd.breakoutLong != null && `BO:${f(bd.breakoutLong)}`]
    : [bd.meanRevShort  != null  && `MR:${f(bd.meanRevShort)}`,
       bd.pivotShort    != null  && `Pivot:${f(bd.pivotShort)}`,
       bd.breakoutShort != null  && `BO:${f(bd.breakoutShort)}`];
  const tip = `${side === 'long' ? 'Long' : 'Short'} Entry · ${tipLines.filter(Boolean).join(' · ')} → Ø ${f(price)}`;
  return `<span class="entry-price entry-price--${side}" title="${tip}">${f(price)}</span>`;
}

function renderEntryScore(es) {
  if (!es) return '<span class="muted-dash">—</span>';
  const flags = es.flags?.length ? ` · ⚠ ${es.flags.join(', ')}` : '';
  const tip = `${es.label} (${Object.entries(es.breakdown).map(([k, v]) => `${k}:${v}`).join(' ')})${flags}`;
  return `<span class="entry-score entry-score--${es.labelCode}" title="${tip}">${es.total}</span>`;
}

function renderTrendStrengthScore(ts) {
  if (!ts) return '<span class="muted-dash">—</span>';
  const flags = ts.flags?.length ? ` · ⚠ ${ts.flags.join(', ')}` : '';
  const tip = `${ts.label} (${Object.entries(ts.breakdown).map(([k, v]) => `${k.split('_')[0]}:${v}`).join(' ')})${flags}`;
  return `<span class="trend-strength-score trend-strength-score--${ts.labelCode}" title="${tip}">${ts.total}</span>`;
}

// Returns a v2 health score, re-computing from stored tv_data if the cached value is v1 (0–20).
function liveHealthScore(tv) {
  if (!tv) return null;
  const hs = tv.health_score;
  const isV2 = hs && hs.breakdown && 'A_Size' in hs.breakdown;
  if (isV2) return hs;
  // Derive v2 on the fly from whatever fields are already stored
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

function renderHealthScore(hs) {
  if (!hs) return '<span class="muted-dash">—</span>';
  const flags = hs.flags?.length ? ` · ⚠ ${hs.flags.join(', ')}` : '';
  const tip = `${hs.label} (${Object.entries(hs.breakdown).map(([k, v]) => `${k.split('_')[0]}:${v}`).join(' ')})${flags}`;
  return `<span class="health-score health-score--${hs.labelCode}" title="${tip}">${hs.total}</span>`;
}

// Composite score over all standard-view metrics, computed live from tv_data.
function liveOverallScore(tv) {
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

function renderTrCheck(c) {
  const t = c.tr_check;
  const copyVal = c.isin || c.symbol || '';
  // Click copies the ISIN (fallback symbol) to the clipboard – paste into the
  // Trade Republic app search. Works in every state (green/red/grey).
  const btn = (cls, glyph, title) =>
    `<span class="tr-check tr-check--${cls}" role="button" tabindex="0" data-copy="${copyVal}" title="${title}">${glyph}</span>`;
  const copyHint = copyVal ? `Klick: ISIN kopieren (${copyVal})` : 'Keine ISIN/Symbol zum Kopieren';
  if (!t) return btn('unknown', '?', `Ungeprüft – „TR-Check" in der Bulk-Leiste ausführen · ${copyHint}`);
  if (t.tradable) return btn('yes', '✓', `Handelbar${t.ls_name ? ' – ' + t.ls_name : ''} · ${copyHint}`);
  if (t.tradable === false) return btn('no', '✗', `Nicht über Trade Republic handelbar · ${copyHint}`);
  if (t.no_isin) return btn('unknown', '?', `Keine ISIN – erst „TV Daten" laden · ${copyHint}`);
  return btn('unknown', '?', `Check fehlgeschlagen · ${copyHint}`);
}

// LS price cell (Standard view). EUR venue price, converted to the active
// display currency; carries the informative state tooltip.
function lsPriceCell(c) {
  const q = c.ls_quote;
  if (!q)         return '<span class="muted-dash" title="Ungeprüft – „LS-Kurs“ in der Bulk-Leiste ausführen">—</span>';
  if (q.no_isin)  return '<span class="muted-dash" title="Keine ISIN – erst „TV Daten“ laden">—</span>';
  if (q.price == null) return `<span class="muted-dash" title="${q.error ?? 'Kein LS-Kurs'}">—</span>`;
  const sym = displayCurrency === 'USD' ? '$' : '€';
  const age = q.ts ? timeAgo(new Date(q.ts).toISOString()) : '';
  const tip = `LS-Kurs (Handelsplatz Trade Republic, EUR)${q.prev_close != null ? ` · Vortag ${fmtNum(q.prev_close, 2)}€` : ''}${age ? ` · Stand vor ${age}` : ''}`;
  return `<span title="${tip}">${sym}${fmtNum(q.price * convFromEur(), 2)}</span>`;
}

// LS change-vs-previous-close cell (Standard view).
function lsChgCell(c) {
  const q = c.ls_quote;
  if (!q || q.change_pct == null) return '<span class="muted-dash">—</span>';
  return `<span class="${posNegClass(q.change_pct)}">${fmtPct(q.change_pct)}</span>`;
}

// Merkliste cost basis ("Einstand") — the manual entry price from the merkliste
// portfolio (stored in EUR). Blank when the ticker isn't in the portfolio.
function renderMkEntry(c) {
  if (c.mk_entry == null) {
    return '<span class="muted-dash" title="Nicht im Merkliste-Portfolio / kein Entry gepflegt">—</span>';
  }
  const sym = displayCurrency === 'USD' ? '$' : '€';
  const px  = fmtNum(c.mk_entry * convFromEur(), 2);
  return `<span title="Entry: manueller Entry-Preis aus dem Merkliste-Portfolio (EUR)">${sym}${px}</span>`;
}

// ── Decision-view derived values + visuals ───────────────────────────────────

// P/L of a portfolio ticker: live LS price (EUR) vs. merkliste Einstand (EUR).
// pct needs entry+LS; absEur additionally needs entry_shares.
function plData(c) {
  const entry = c.mk_entry;
  const ls    = c.ls_quote?.price;
  if (entry == null || entry === 0 || ls == null) return null;
  const pct    = (ls - entry) / entry * 100;
  const absEur = c.mk_shares != null ? (ls - entry) * c.mk_shares : null;
  return { pct, absEur };
}

function renderPL(c) {
  const d = plData(c);
  if (!d) return '<span class="muted-dash" title="Braucht Entry (Merkliste) + LS-Kurs">—</span>';
  const cls = posNegClass(d.pct);
  const sym = displayCurrency === 'USD' ? '$' : '€';
  // Cell shows the % only; the absolute € lives in the tooltip.
  const tip = `P/L ${fmtPct(d.pct)}`
    + (d.absEur != null ? ` · ${d.absEur >= 0 ? '+' : '−'}${fmtNum(Math.abs(d.absEur * convFromEur()), 2)}${sym}` : '')
    + ` · Entry ${fmtNum(c.mk_entry * convFromEur(), 2)}${sym}`
    + (c.mk_shares != null ? ` · ${c.mk_shares} St.` : ' · keine Stückzahl');
  return `<span class="pl ${cls}" title="${tip}">${fmtPct(d.pct)}</span>`;
}

// Position of the current price within its 52-week range (0..1). Native currency
// throughout (price + 52W hi/lo are all TV native), so no FX conversion needed.
function rangePos(tv) {
  const close = tv?.close_1m ?? tv?.close;
  const hi = tv?.price_52_week_high, lo = tv?.price_52_week_low;
  if (close == null || hi == null || lo == null || hi <= lo) return null;
  return Math.min(1, Math.max(0, (close - lo) / (hi - lo)));
}

function render52wRange(tv) {
  const pos = rangePos(tv);
  if (pos == null) return '<span class="muted-dash">—</span>';
  const close = tv.close_1m ?? tv.close;
  const pct = Math.round(pos * 100);
  const tip = `52W-Spanne: ${fmtNum(tv.price_52_week_low, 2)} … ${fmtNum(tv.price_52_week_high, 2)} · Kurs ${fmtNum(close, 2)} (${pct}% der Spanne)`;
  return `<span class="range52" title="${tip}"><span class="range52__track"><span class="range52__dot" style="left:${pct}%"></span></span></span>`;
}

// Consolidated direction chip: momentum traffic-light + 1M trend arrow.
function renderSignal(c) {
  const v = c.momentum_check?.verdict ?? null;
  const r = c.tv_data?.recommend_all_1m ?? null;
  if (v == null && r == null) return '<span class="muted-dash">—</span>';
  const dot   = `<span class="signal__dot signal__dot--${v ?? 'none'}"></span>`;
  const arrow = r != null ? `<span class="tv-rating-txt--${tvRatingClass(r)}">${tvRatingGlyph(r)}</span>` : '';
  const tip = `Momentum: ${v ?? 'n/a'} · Trend (1M): ${r != null ? fmtNum(r, 2) : 'n/a'}`;
  return `<span class="signal" title="${tip}">${dot}${arrow}</span>`;
}

// % cell with a magnitude-scaled red/green background tint (heat-strip effect).
function heatStyle(v) {
  if (v == null) return '';
  const a = Math.min(Math.abs(v) / 8, 1) * 0.30; // cap tint at ±8%
  const rgb = v > 0 ? '34,197,94' : v < 0 ? '239,68,68' : '0,0,0';
  return ` style="background:rgba(${rgb},${a.toFixed(3)})"`;
}
// Performance/change columns that get the heat-strip background in data views.
const HEAT_KEYS = new Set(['tv_chg1d','tv_chg1w','tv_chg1m','tv_perfw','tv_perf1m','tv_perf3m','tv_perf6m','tv_growth6m']);
function heatPctTd(v) {
  return `<td class="num"${heatStyle(v)}><span class="${posNegClass(v)}">${fmtPct(v)}</span></td>`;
}

function renderMomentumCheck(mc) {
  if (!mc) return '<span class="muted-dash">—</span>';
  const age = mc.checked_at ? timeAgo(mc.checked_at) : '';
  // Old persisted shapes (pre points model) have no total → plain dot.
  if (mc.total == null) {
    return `<span class="momcheck momcheck--${mc.verdict}" title="Altes Format – Puls-Button erneut drücken">●</span>`;
  }
  const tipParts = [
    Object.entries(mc.breakdown ?? {}).map(([k, v]) => `${k}:${v}`).join(' '),
    mc.coverage != null && mc.coverage < 100 ? `Datenabdeckung ${mc.coverage}/100` : null,
    mc.ko ? `K.O.: ${mc.ko}` : null,
    age ? `geprüft vor ${age}` : null,
  ].filter(Boolean);
  return `<span class="momcheck momcheck--badge momcheck--${mc.verdict}" title="${tipParts.join(' · ')}">${mc.total}</span>`;
}

function renderOverallScore(os) {
  if (!os) return '<span class="muted-dash">—</span>';
  const tip = `${os.label} (${Object.entries(os.breakdown).map(([k, v]) => `${k}:${v}`).join(' ')}) · Datenabdeckung ${os.coverage}/100`;
  const w = Math.max(0, Math.min(100, os.total));
  return `<span class="overall-score overall-score--${os.labelCode}" title="${tip}">${os.total}` +
    `<span class="score-gauge"><span class="score-gauge__fill" style="width:${w}%"></span></span></span>`;
}

function renderUpside(up, side) {
  const v = side === 'up' ? up?.upside : up?.downside;
  if (v == null) return '<span class="muted-dash">—</span>';
  const target = side === 'up' ? up.upTarget : up.downTarget;
  const tipParts = [
    target != null ? `Level: ${fmtNum(target)}` : 'kein Level (Range offen)',
    up.drift != null ? `Drift: ${fmtPct(up.drift)}/M` : null,
    up.sigma != null ? `σ: ±${fmtNum(up.sigma, 1)}%` : null,
    up.earningsSoon ? '⚠ Earnings innerhalb ~1 Monat' : null,
  ].filter(Boolean);
  const warn = up.earningsSoon ? ' ⚠' : '';
  return `<span class="${posNegClass(v)}" title="${tipParts.join(' · ')}">${fmtPct(v)}${warn}</span>`;
}

function chipLink(href, logo, label, extraClass = '') {
  if (href) {
    return `<a href="${href}" class="link-chip ${extraClass}" target="_blank" rel="noopener" title="${label}" aria-label="${label}">
      <img src="${logo}" alt=""></a>`;
  }
  return `<span class="link-chip link-chip--missing ${extraClass}" aria-hidden="true"><img src="${logo}" alt=""></span>`;
}
