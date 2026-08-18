import { enrichCandidate } from '../lib/claude-api.js';
import {
  scoreRingSVG, priceBandHorizontalSVG, priceLevelsTable,
  perfBarsHTML, rangeBandsHTML, bollingerGaugeHTML,
} from '../lib/price-viz.js?v=20260807a';
import { liveOverallScore, liveHealthScore } from '../lib/dashboard-metrics.js?v=20260807a';
import { icons } from '../lib/icons.js?v=20260807a';
import { computePriceClusters } from '../lib/price-cluster.js?v=20260807a';
import { detectBottomSignal, detectBreakoutSetup, detectBreakdownRisk, MIN_SNAPSHOTS, MAX_SNAPSHOTS } from '../lib/ls-history-signals.js?v=20260807a';
import { classifyCluster, tradeTarget, breakoutEntry, exitLevels } from '../lib/trade-setup.js?v=20260807a';
import { EXCHANGE_CURRENCY } from '../lib/tv-enrichment.js?v=20260807a';
import { normalizeExchange } from '../lib/exchange-map.js';
import { swingLadderSVG, isUsTicker, detectPivots, yahooChartSymbol } from '../lib/tv-swings.js?v=20260814j';
import { computeBias, trendAge, biasLabel, biasRingSVG, BIAS_LEVELS } from '../lib/tv-sentiment.js?v=20260807a';
import { regimeStats, detectDivergence, WARMUP as BIAS_WARMUP } from '../lib/tv-bias-history.js?v=20260807a';
import { bollinger, supertrend, cci } from '../lib/chart-indicators.js?v=20260807a';
import { transcriptLlmText } from '../lib/company-profile.js?v=20260807a';
import { reverseDcf, growthDemandLabel, growthLadder, impliedGrowthForValue } from '../lib/tv-reverse-dcf.js?v=20260814j';
import { fmpErrorText } from '../lib/fmp-valuation.js?v=20260814m';

const TV_LOGO  = 'https://s3.tradingview.com/userpics/6171439-mFQX_big.png';
const ST_LOGO  = 'https://avatars.githubusercontent.com/u/30304?s=200&v=4';
const YH_LOGO  = 'https://s.yimg.com/os/creatr-uploaded-images/2021-04/05009f00-a857-11eb-bfd7-56b7773a2529';

const TABS = [
  { key: 'performance', label: 'Perf.' },
  { key: 'trend',       label: 'Trend' },
  { key: 'trade',       label: 'Trade' },
  { key: 'fundamental', label: 'Fund.' },
  { key: 'news',        label: 'News' },
  { key: 'meta',        label: 'Meta' },
];

function formatDate(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatMarketCap(mc) {
  if (mc == null) return '—';
  if (mc >= 1e12) return `${(mc / 1e12).toFixed(1)}T`;
  if (mc >= 1e9)  return `${(mc / 1e9).toFixed(1)}B`;
  if (mc >= 1e6)  return `${(mc / 1e6).toFixed(0)}M`;
  return mc.toLocaleString('de-DE');
}

const fmtNum = (v, dec = 2) => (v == null || Number.isNaN(v) ? '—'
  : Number(v).toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
const fmtPct = (v, dec = 1) => (v == null || Number.isNaN(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(dec)}%`);

// ── Display currency (native ↔ USD/EUR toggle) ────────────────────────────────

function nativeCur(c) { return EXCHANGE_CURRENCY[normalizeExchange(c.exchange)] ?? 'USD'; }

// Same resolution order as the table: live TV rate, then the manual setting.
function resolveFx() {
  const live = parseFloat(localStorage.getItem('discovery_fx_eurusd_live') ?? '');
  if (Number.isFinite(live) && live > 0) return live;
  const manual = parseFloat((localStorage.getItem('discovery_fx_eurusd') ?? '').replace(',', '.'));
  return Number.isFinite(manual) && manual > 0 ? manual : null;
}

// tv_data fields carrying absolute prices (percentages/ratios must NOT scale).
const PRICE_FIELDS = [
  'close', 'close_1m', 'open', 'atr',
  'sma20', 'sma50', 'sma100', 'sma200', 'ema10', 'ema20', 'ema50', 'ema100', 'ema200',
  'bb_upper', 'bb_lower', 'donch_ch20_lower_1m', 'donch_ch20_upper_1m', 'high_20d', 'low_20d',
  'pivot_r1', 'pivot_r2', 'pivot_r3', 'pivot_s1', 'pivot_s2', 'pivot_s3',
  'pivot_r1_1w', 'pivot_r2_1w', 'pivot_r3_1w', 'pivot_s1_1w', 'pivot_s2_1w', 'pivot_s3_1w',
  'pivot_demark_r1_1w', 'pivot_demark_s1_1w',
  'high_1m', 'low_1m', 'high_3m', 'low_3m', 'high_6m', 'low_6m',
  'price_52_week_high', 'price_52_week_low', 'high_all', 'low_all', 'high_52w',
];

function convertTv(tv, factor) {
  if (!tv || factor === 1) return tv;
  const out = { ...tv };
  for (const f of PRICE_FIELDS) if (out[f] != null) out[f] = out[f] * factor;
  return out;
}

// Percent-unit fundamentals (already in %, e.g. 25.3 → "25.3%").
function pctVal(v) { return v == null ? '—' : `${v.toFixed(1)}%`; }
// Plain decimal ratios (e.g. debt/equity, EV/EBITDA).
function ratioVal(v) { return v == null ? '—' : v.toFixed(2); }
// Colour growth figures green/red.
function growthCls(v) { return v == null ? '' : v >= 0 ? 'tv-pos' : 'tv-neg'; }

function tvRatingClass(r) {
  if (r == null) return 'neutral';
  if (r > 0.5)  return 'strong-buy';
  if (r > 0.1)  return 'buy';
  if (r < -0.5) return 'strong-sell';
  if (r < -0.1) return 'sell';
  return 'neutral';
}

function tvRatingLabel(r) {
  if (r == null) return '—';
  if (r > 0.5)  return 'Strong Buy ↑↑';
  if (r > 0.1)  return 'Buy ↑';
  if (r < -0.5) return 'Strong Sell ↓↓';
  if (r < -0.1) return 'Sell ↓';
  return 'Neutral →';
}

/* ── Sub-header toolbar (icon-only links + quick actions) ─────────────────── */

function chipLink(href, inner, label, extraClass = '') {
  if (href) {
    return `<a href="${href}" class="link-chip ${extraClass}" target="_blank" rel="noopener"
      title="${label}" aria-label="${label}">${inner}</a>`;
  }
  return `<span class="link-chip link-chip--missing ${extraClass}" title="${label} – kein Link" aria-hidden="true">${inner}</span>`;
}

function chipBtn(id, inner, label, extraClass = '') {
  return `<button type="button" class="link-chip ${extraClass}" id="${id}"
    title="${label}" aria-label="${label}">${inner}</button>`;
}

// Currency toggle rendered inline next to the price in the Performance hero and
// the Trade head (class, not id — several instances live in the DOM at once).
function curToggle(disp, extraClass = '') {
  const tip = disp.canSwitch
    ? `Preisanzeige umschalten: ${disp.cur} → ${disp.cur === 'USD' ? 'EUR' : 'USD'}`
    : (disp.fx == null ? 'Kein EUR/USD-Kurs – in Einstellungen eintragen oder TV Daten laden' : `Währung ${disp.cur} (nur USD↔EUR umschaltbar)`);
  const cls = disp.canSwitch ? (disp.factor !== 1 ? ' is-active' : '') : ' cur-toggle--off';
  const glyph = disp.cur === 'USD' ? '$' : disp.cur === 'EUR' ? '€' : disp.cur;
  return `<button type="button" class="cur-toggle${cls} ${extraClass}" title="${tip}" aria-label="${tip}">${glyph}</button>`;
}

function renderToolbar(c) {
  const links = c.links ?? {};
  const scUrl = c.symbol
    ? `https://www.stockconsultant.com/consultnow/basicplus.cgi?symbol=${encodeURIComponent(c.symbol)}`
    : null;
  const tfUrl = c.isin
    ? `https://aktie.traderfox.com/visualizations/${encodeURIComponent(c.isin)}`
    : null;
  // Single row: external links · edit · | · quick actions. All direct flex
  // children so they shrink to fit one line even on a narrow phone (§5).
  return `
    <div class="detail-toolbar">
      ${chipLink(links.tradingview, `<img src="${TV_LOGO}" alt="">`, 'TradingView', 'link-chip--tv')}
      ${chipLink(links.stocktwits,  `<img src="${ST_LOGO}" alt="">`, 'StockTwits',  'link-chip--st')}
      ${chipLink(links.yahoo,       `<img src="${YH_LOGO}" alt="">`, 'Yahoo Finance', 'link-chip--yahoo')}
      ${chipLink(scUrl, icons.stethoscope, 'StockConsultant', 'link-chip--sc')}
      ${chipLink(tfUrl, icons.barChart2, 'TraderFox Visualisierung', 'link-chip--tf')}
      ${chipBtn('detail-edit-links', icons.pencil, 'Links bearbeiten', 'link-chip--edit')}
      <span class="detail-toolbar__sep"></span>
      ${chipBtn('detail-trigger', icons.bellPlus, 'Trigger-Alert anlegen/bearbeiten')}
      ${chipBtn('detail-ls', icons.activity, 'LS-Echtzeitkurs laden (EUR)')}
      ${chipBtn('detail-td', icons.candlestick, 'Swing-Check (TwelveData) – Support/Resistance-Zonen aus echtem OHLC')}
    </div>
    <div class="detail-links-edit" id="detail-links-edit" hidden>
      <div class="link-url-fields">
        <div class="link-url-row">
          <label>TradingView URL</label>
          <input type="url" id="lf-tv" value="${links.tradingview ?? ''}" placeholder="https://www.tradingview.com/…">
        </div>
        <div class="link-url-row">
          <label>StockTwits URL</label>
          <input type="url" id="lf-st" value="${links.stocktwits ?? ''}" placeholder="https://stocktwits.com/…">
        </div>
        <div class="link-url-row">
          <label>Yahoo Finance URL</label>
          <input type="url" id="lf-yahoo" value="${links.yahoo ?? ''}" placeholder="https://finance.yahoo.com/…">
        </div>
        <button class="btn btn-sm btn-secondary" id="detail-save-links">Links speichern</button>
      </div>
    </div>
  `;
}

/* ── Trade levels (shared by hero panel, ticket and chart) ────────────────── */

// LS (EUR) → display-currency factor; null = unknown rate (skip LS values).
function lsDisplayFactor(disp) {
  return disp.cur === 'EUR' ? 1 : (disp.cur === 'USD' && disp.fx ? disp.fx : null);
}

// Bar-Währung → Anzeigewährung. Die Bars kommen je nach Titel von TwelveData
// (USD) oder Yahoo (EUR/CHF/JPY/…), deshalb steht die Währung in der Analyse.
// Ältere, vor dem Yahoo-Umbau gespeicherte Analysen haben kein `currency` —
// die stammen zwangsläufig von TD und sind damit USD.
// null = nicht umrechenbar (nur USD↔EUR haben wir als Kurs).
function barsDisplayFactor(disp, analysis) {
  const native = analysis?.currency ?? 'USD';
  if (native === disp.cur) return 1;
  if (native === 'USD' && disp.cur === 'EUR' && disp.fx) return 1 / disp.fx;
  if (native === 'EUR' && disp.cur === 'USD' && disp.fx) return disp.fx;
  return null;
}

// Which Performance-chart horizon can/should render: 10T LS-Intraday vs. 1J
// TD daily candles. `active` honours the requested horizon when available,
// else falls back to whatever data exists (null = neither → SVG fallback).
function resolveChartHorizon(c, disp, horizon) {
  const lw = typeof window !== 'undefined' && window.LightweightCharts;
  // LS-Chart schon ab 1 Snapshot-Tag ODER einer frischen Intraday-Serie —
  // vorher blieb der Chart leer, bis 2 Nacht-Snapshots existierten.
  const liveOk = Array.isArray(c.ls_quote?.series) && c.ls_quote.series.length > 1;
  const canLs = !!(lw && (liveOk || (Array.isArray(c.ls_history) && c.ls_history.length >= 1)));
  const canTd = !!(lw && Array.isArray(c.swing_analysis?.ohlc) && c.swing_analysis.ohlc.length >= 2 && barsDisplayFactor(disp, c.swing_analysis) != null);
  const active = (horizon === '1J' && canTd) ? '1J' : (canLs ? '10T' : (canTd ? '1J' : null));
  return { canLs, canTd, active };
}

// Day anchor time on the Lightweight time scale (15:00 within the day window —
// same offset the volume bars use, so trendlines line up with the daily bars).
const dayAnchorTime = (dateStr) => Date.parse(dateStr) / 1000 + 15 * 3600;

/**
 * Auto-trendlines from the 10-day LS snapshot history (TrendSpider-style, but on
 * our short window): find swing lows / highs (local extrema vs. immediate
 * neighbours), fit a line through the last two of each, and project it to the
 * final day. Support = lows, resistance = highs. Returns display-currency line
 * data (2 points each) or null when there aren't two swings to define a line.
 *
 * Honest scope: 10 trading days is a *micro*-trend, not a multi-month channel —
 * labelled as such in the chart. `field` picks day_low|day_high; `lsF` converts
 * the EUR snapshot prices to the active display currency.
 */
function autoTrendline(hist, field, lsF) {
  const rows = hist
    .filter((s) => s[field] != null && Number.isFinite(Date.parse(s.date)))
    .map((s) => ({ t: dayAnchorTime(s.date), v: s[field] * lsF }));
  if (rows.length < 3) return null;

  const low = field === 'day_low';
  const swings = [];
  for (let i = 1; i < rows.length - 1; i++) {
    const isSwing = low
      ? rows[i].v <= rows[i - 1].v && rows[i].v <= rows[i + 1].v
      : rows[i].v >= rows[i - 1].v && rows[i].v >= rows[i + 1].v;
    if (isSwing) swings.push(rows[i]);
  }
  // Fall back to the two window extremes if we can't find two interior swings.
  if (swings.length < 2) {
    const sorted = [...rows].sort((a, b) => (low ? a.v - b.v : b.v - a.v));
    const two = sorted.slice(0, 2).sort((a, b) => a.t - b.t);
    if (two.length < 2 || two[0].t === two[1].t) return null;
    swings.length = 0; swings.push(two[0], two[1]);
  }
  const A = swings[swings.length - 2], B = swings[swings.length - 1];
  if (A.t === B.t) return null;
  const slope = (B.v - A.v) / (B.t - A.t);
  const lastT = rows[rows.length - 1].t;
  // Straight segment through both swings, extended to the final day (unless the
  // last swing already is the final day).
  const end = lastT > B.t ? { time: lastT, value: A.v + slope * (lastT - A.t) } : { time: B.t, value: B.v };
  if (end.time <= A.t) return null;
  return [{ time: A.t, value: A.v }, end];
}

function tradeLevels(c, disp) {
  const tv = disp.tv;
  if (!tv) return null;
  const cl = classifyCluster(tv);
  const lsF = lsDisplayFactor(disp);
  const ex = exitLevels(tv, cl ?? undefined, c.ls_history, lsF);
  const kurs = (c.ls_quote?.price != null && lsF != null)
    ? c.ls_quote.price * lsF
    : (tv.close_1m ?? tv.close ?? null);
  const target = tradeTarget(tv, cl ?? undefined);
  const entryL = tv.pivot_r1_1w ?? tv.pivot_r1 ?? null;
  const stopL = ex?.primaryLong?.value ?? null;
  // R:R (long): chance per unit of risk — the one number a trader wants first.
  const rr = (target != null && entryL != null && stopL != null && entryL > stopL)
    ? (target - entryL) / (entryL - stopL) : null;
  return { cl, ex, kurs, target, entryL, stopL, rr, brk: breakoutEntry(tv), lsF };
}

// Merkliste-Einstand (EUR) in Display-Währung; null wenn nicht im Portfolio.
function mkEntryDisp(c, disp) {
  const lsF = lsDisplayFactor(disp);
  return (c.mk_entry != null && lsF != null) ? c.mk_entry * lsF : null;
}

function priceClustersDisp(c, disp) {
  const tv = disp.tv;
  if (!tv) return null;
  const bottom = detectBottomSignal(c.ls_history);
  const extraLevels = bottom?.isBottom && bottom.bottomPrice != null
    ? [{ price: bottom.bottomPrice, label: 'Bottom (LS)', family: 'ls', w: 3, lsPrice: true }]
    : [];
  const lsF = lsDisplayFactor(disp);
  const refPrice = (c.ls_quote?.price != null && lsF != null) ? c.ls_quote.price * lsF : null;
  return computePriceClusters(tv, { lsHistory: c.ls_history, extraLevels, refPrice, lsToNative: lsF });
}

/* ── Hero panel (Performance tab): price → S/R → target at a glance ───────── */

function heroStation(label, value, kurs, cls = '') {
  const has = value != null;
  const delta = has && kurs != null && kurs > 0 ? (value - kurs) / kurs * 100 : null;
  return `<div class="hero__st ${cls}">
    <span class="hero__st-lbl">${label}</span>
    <span class="hero__st-val">${has ? fmtNum(value) : '—'}</span>
    <span class="hero__st-delta ${delta == null ? '' : delta >= 0 ? 'pos' : 'neg'}">${delta != null ? fmtPct(delta) : '&nbsp;'}</span>
  </div>`;
}

// Hero price row (Perf tab): current price + change + source, R:R and the €/$
// toggle. The level stations + volume chips moved to the Trade tab (heroLevels).
function heroPriceRow(c, disp, tl) {
  if (!tl || tl.kurs == null) return '';
  const sym = disp.cur === 'EUR' ? '€' : disp.cur === 'USD' ? '$' : disp.cur;
  const isLive = c.ls_quote?.price != null && tl.lsF != null;
  const chg = isLive ? c.ls_quote.change_pct : disp.tv?.change_1d;
  return `<div class="hero hero--pricerow">
    <div class="hero__price-row">
      <span class="hero__price">${fmtNum(tl.kurs)} ${sym}</span>
      <span class="hero__chg ${chg == null ? '' : chg >= 0 ? 'pos' : 'neg'}">${fmtPct(chg)}</span>
      <span class="hero__src">${isLive ? `LS live${c.ls_quote?.checked_at ? ` · ${formatDate(c.ls_quote.checked_at).slice(-5)}` : ''}` : 'TV Close'}</span>
      ${tl.rr != null ? `<span class="hero__rr" title="Chance-Risiko (Long): (Target − Entry) / (Entry − Stop)">R:R <b>${fmtNum(tl.rr, 1)}</b></span>` : ''}
      ${curToggle(disp, 'hero__cur')}
    </div>
  </div>`;
}

// Hero level stations (Trade tab): Stop/Support/Kurs/Resist/Target stat-blocks,
// proportional track, and the Vol Ø10d/Ø30d chips.
function heroLevels(c, disp, pc, tl) {
  if (!tl || tl.kurs == null) return '';
  const sup = pc?.nearestSup?.mid ?? null;
  const res = pc?.nearestRes?.mid ?? null;

  // Thin proportional track: where the price sits between stop and target.
  const stations = [
    ['Stop', tl.stopL, 'hero__st--stop'],
    ['Support', sup, ''],
    ['Kurs', tl.kurs, 'hero__st--kurs'],
    ['Resist', res, ''],
    ['Target', tl.target, 'hero__st--target'],
  ];
  const present = stations.map(([, v]) => v).filter((v) => v != null);
  let track = '';
  if (present.length >= 3) {
    const lo = Math.min(...present), hi = Math.max(...present);
    if (hi > lo) {
      const pad = (hi - lo) * 0.04;
      const pos = (v) => ((v - lo + pad) / (hi - lo + 2 * pad) * 100).toFixed(1);
      track = `<div class="hero__track">${stations.filter(([, v]) => v != null).map(([lbl, v, cls]) =>
        `<span class="hero__dot ${cls}" style="left:${pos(v)}%" title="${lbl} ${fmtNum(v)}"></span>`).join('')}</div>`;
    }
  }

  // Volume vs the 10d/30d averages (last snapshot day; LS history = EUR-venue volume).
  const lastSnap = Array.isArray(c.ls_history) && c.ls_history.length ? c.ls_history[c.ls_history.length - 1] : null;
  const v = lastSnap?.volume ?? null;
  const r10 = v != null && c.tv_data?.avg_vol_10d > 0 ? v / c.tv_data.avg_vol_10d * 100 : null;
  const r30 = v != null && c.tv_data?.average_volume_30d_calc > 0 ? v / c.tv_data.average_volume_30d_calc * 100 : null;
  const spike = (r10 != null && r10 >= 150) || (r30 != null && r30 >= 150);
  const volRow = (r10 != null || r30 != null)
    ? `<div class="hero__vol" title="Volumen des letzten Snapshot-Tags (${lastSnap?.date ?? ''}) vs. Ø-Volumen aus TV">
        <span class="hero__vol-lbl">Vol</span>
        ${r10 != null ? `<span class="hero__vol-chip ${r10 >= 150 ? 'is-spike' : ''}">${r10.toFixed(0)}% <small>Ø10d</small></span>` : ''}
        ${r30 != null ? `<span class="hero__vol-chip ${r30 >= 150 ? 'is-spike' : ''}">${r30.toFixed(0)}% <small>Ø30d</small></span>` : ''}
        ${spike ? '<span class="hero__spike">SPIKE</span>' : ''}
      </div>` : '';

  return `<div class="hero hero--levels">
    <div class="hero__stations">${stations.map(([lbl, v2, cls]) => heroStation(lbl, v2, tl.kurs, cls)).join('')}</div>
    ${track}
    ${volRow}
  </div>`;
}

/* ── Tab 1: Performance ───────────────────────────────────────────────────── */

/* 10-day LS history band: per-day intraday price segments (coloured by day
 * direction) with volume-% bars below (day volume ÷ Ø V10d from TV, fallback
 * median of the history window). Dashed line = 100 % of the reference. */
function ls10dChartHTML(c, disp) {
  const hist = c.ls_history;
  const head = `<h4 class="pv-subhead">10-Tage-Verlauf + Volumen-% (LS)</h4>`;
  if (!Array.isArray(hist) || hist.length < 2) {
    const note = Array.isArray(hist) && hist.length
      ? `Erst ${hist.length}/${MAX_SNAPSHOTS} Snapshot-Tage – wächst werktags um 21:30 UTC.`
      : 'Keine LS-Historie – nightly Snapshot läuft nur für den Watch-Bucket.';
    return `${head}<p class="pv-empty">${note}</p>`;
  }
  const f = disp.cur === 'EUR' ? 1 : (disp.cur === 'USD' && disp.fx ? disp.fx : null);
  const sym = f == null ? '€' : disp.cur === 'EUR' ? '€' : '$';
  const conv = (v) => (v == null || f == null ? v : v * f);

  const vols = hist.map((s) => s.volume).filter((v) => v != null && v > 0);
  const medVol = vols.length ? [...vols].sort((a, b) => a - b)[Math.floor(vols.length / 2)] : null;
  const volRef = c.tv_data?.avg_vol_10d ?? medVol;

  const W = 300, H = 88, priceH = 56, volTop = 64, volH = 22;
  let lo = Infinity, hi = -Infinity;
  for (const s of hist) {
    for (const v of [s.day_low, s.day_high, s.close, ...(Array.isArray(s.series) ? s.series : [])]) {
      if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
  }
  if (!(hi > lo)) return `${head}<p class="pv-empty">Zu wenig Kursdaten in der Historie.</p>`;
  const y = (v) => 3 + (1 - (v - lo) / (hi - lo)) * (priceH - 6);
  const dayW = W / hist.length;

  const days = hist.map((s, i) => {
    const x0 = i * dayW + 1, x1 = (i + 1) * dayW - 1;
    const ser = Array.isArray(s.series) && s.series.length > 1 ? s.series : [s.close, s.close];
    const pts = ser.filter((v) => v != null).map((v, j, arr) =>
      `${(x0 + (j / Math.max(1, arr.length - 1)) * (x1 - x0)).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const dir = s.change_pct == null ? '' : s.change_pct >= 0 ? 'ls10d--pos' : 'ls10d--neg';
    const volPct = s.volume != null && volRef > 0 ? (s.volume / volRef) * 100 : null;
    // Bar scale: 200 % of the reference fills the full bar height.
    const bh = volPct != null ? Math.max(1.5, Math.min(volH, (volPct / 200) * volH)) : 0;
    const volBar = volPct != null
      ? `<rect x="${x0.toFixed(1)}" y="${(volTop + volH - bh).toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${bh.toFixed(1)}" class="ls10d__vol ${dir}"/>` : '';
    const tip = `${s.date} · Close ${fmtNum(conv(s.close))} ${sym} · ${fmtPct(s.change_pct)}`
      + (volPct != null ? ` · Volumen ${volPct.toFixed(0)}% von Ø` : '');
    return `<g><title>${tip}</title>
      <polyline points="${pts}" class="ls10d__line ${dir}"/>${volBar}
      <rect x="${(i * dayW).toFixed(1)}" y="0" width="${dayW.toFixed(1)}" height="${H}" fill="transparent"/>
    </g>`;
  }).join('');

  const refY = volTop + volH - (100 / 200) * volH; // 100 %-Linie
  return `${head}
    <svg class="ls10d" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" role="img"
         aria-label="10-Tage-LS-Verlauf mit Volumen-Prozent">
      <line x1="0" y1="${refY.toFixed(1)}" x2="${W}" y2="${refY.toFixed(1)}" class="ls10d__ref"/>
      ${days}
    </svg>
    <p class="ph-note">Linie = LS-Intraday je Tag · Balken = Tagesvolumen ÷ Ø V10d (${c.tv_data?.avg_vol_10d != null ? 'TV' : 'Median Historie'}) · gestrichelt = 100 % · ${hist.length}/${MAX_SNAPSHOTS} Tage</p>`;
}

function volStatsHTML(tv) {
  if (!tv || (tv.rsi == null && tv.atr == null)) return '';
  return `<div class="pv-volstats">
    <span>RSI <b>${tv.rsi != null ? tv.rsi.toFixed(1) : '—'}</b></span>
    <span>ATR <b>${tv.atr != null ? fmtNum(tv.atr) : '—'}${tv.atrp != null ? ` (${tv.atrp.toFixed(1)}%)` : ''}</b></span>
  </div>`;
}

function renderPerformanceTab(c, disp, pc, tl, horizon = '10T', ui = {}) {
  const tv = disp.tv;
  const parts = [];
  if (!tv) parts.push(`<p class="pv-empty">Keine TV-Daten – „TV Daten" in der Tabelle laden.</p>`);

  // 1. Kurs + Δ + Quelle + R:R + €/$-Umschalter (die Level-Stationen liegen im
  //    Trade-Tab).
  parts.push(heroPriceRow(c, disp, tl));

  // 2. Interactive price/volume chart (Lightweight Charts, vendored): 10-day LS
  //    intraday area, OR — when a Swing-Check has fetched them — 1-year TD daily
  //    candles (both converted to the display currency). Toggle when both exist;
  //    the SVG band stays as fallback when the lib/data is missing.
  const { canLs, canTd } = resolveChartHorizon(c, disp, horizon);
  // Kerzen sind holbar, wenn eine Quelle greift: US → TwelveData, sonst Yahoo
  // (das braucht ein auflösbares Börsensuffix, siehe yahooChartSymbol).
  const barsLoadable = isUsTicker(c) || yahooChartSymbol(c) != null;
  const tdReachable = canTd || barsLoadable;    // 1J shown (data) or loadable
  // Show 1J when explicitly picked, or when there's no LS chart to fall back to.
  const want1J = tdReachable && (horizon === '1J' || !canLs);
  const hasLive = Array.isArray(c.ls_quote?.series) && c.ls_quote.series.length > 1;

  if (want1J || canLs) {
    const btns = [];
    if (canLs) btns.push(`<button class="seg-btn${!want1J ? ' active' : ''}" data-horizon="10T" role="tab" aria-selected="${!want1J}">10T LS</button>`);
    // "⤓" zeigt an, dass die Kerzen erst geholt werden. Das Kürzel benennt die
    // Quelle, weil sie sich je Titel unterscheidet (TD für US, Yahoo sonst) —
    // und damit auch, welches Limit gilt.
    const srcTag = c.swing_analysis?.source === 'yahoo' ? 'YF'
      : c.swing_analysis?.source === 'twelvedata' ? 'TD'
      : isUsTicker(c) ? 'TD' : 'YF';
    if (tdReachable) btns.push(`<button class="seg-btn${want1J ? ' active' : ''}" data-horizon="1J" role="tab" aria-selected="${want1J}">1J ${srcTag}${canTd ? '' : ' ⤓'}</button>`);
    const toggle = btns.length >= 2 || (btns.length === 1 && !canLs)
      ? `<div class="chart-horizon" role="tablist">${btns.join('')}</div>` : '';
    // Vollbild nur wenn wirklich ein Chart gezeichnet wird (nicht über dem
    // „Kerzen laden"-Prompt).
    const hasChart = !(want1J && !canTd);   // gilt auch für den Währungs-Hinweis
    const fsBtn = hasChart
      ? `<button class="icon-btn chart-fs__btn" id="chart-fs-btn" title="Chart im Vollbild" aria-label="Chart im Vollbild">${icons.maximize}</button>`
      : '';

    // Quelle benennen statt TwelveData zu unterstellen: die Kerzen kommen je
    // nach Titel von TD (US) oder Yahoo — geladene Analysen sagen es selbst,
    // vorher entscheidet der Ticker.
    const barSrc = c.swing_analysis?.source === 'yahoo' ? 'Yahoo'
      : c.swing_analysis?.source === 'twelvedata' ? 'TwelveData'
      : isUsTicker(c) ? 'TwelveData' : 'Yahoo';
    const head = want1J ? `1 Jahr Tageskerzen (${barSrc})` : `10-Tage-Verlauf + Volumen (LS)${hasLive ? ' · heute live' : ''}`;

    // Kerzen da, aber ihre Währung lässt sich nicht in die Anzeigewährung
    // bringen (wir haben nur USD↔EUR). Ohne diesen Zweig führte der Ladebutton
    // in eine Schleife: laden klappt, der Chart erscheint trotzdem nie.
    const barsUnconvertible = !canTd
      && Array.isArray(c.swing_analysis?.ohlc) && c.swing_analysis.ohlc.length >= 2;

    let body;
    if (want1J && barsUnconvertible) {
      body = `<div class="ls-chart chart-loading">Kerzen liegen in
        ${c.swing_analysis?.currency ?? '?'} vor, die Anzeige steht auf ${disp.cur} —
        umrechnen können wir nur USD↔EUR.</div>`;
    } else if (want1J && !canTd) {
      // 1J picked but candles not fetched yet → load prompt / spinner.
      body = c._swing_loading
        ? `<div class="ls-chart chart-loading"><span class="ls-loading"></span> Lade Tageskerzen (${barSrc}) …</div>`
        : `<button class="ls-chart chart-loading chart-loading--btn" id="td-load">📊 1 Jahr Tageskerzen laden (${barSrc})</button>`;
    } else {
      // Real chart → add the "Level" bar below it: the readout follows the
      // pointer over the chart, the ＋-button sets an alert at that level.
      body = `<div id="ls-chart" class="ls-chart"></div>
        <div class="chart-level" id="chart-level">
          <span class="chart-level__lbl">Level</span>
          <span class="chart-level__price" id="chart-level-price">—</span>
          <button class="btn btn-sm btn-primary" id="chart-level-add" disabled>＋ Alert setzen</button>
        </div>`;
    }
    // Unter dem TD-Chart: Zoom-Presets + Indikator-Toggle, dann das Firmenprofil
    // (ersetzt die frühere Legende); unter dem LS-Chart bleibt die Legende, das
    // Profil folgt nur wenn es keine TD-Ansicht gibt.
    const zoomRow = (want1J && canTd)
      ? `<div class="chart-zoom" role="toolbar" aria-label="Chart-Zoom">
          ${['1M', '3M', '6M', 'ALL'].map((z) =>
            `<button class="seg-btn${(ui.zoom ?? 'ALL') === z ? ' active' : ''}" data-zoom="${z}">${z}</button>`).join('')}
          <button class="seg-btn chart-zoom__ind${ui.showInd ? ' active' : ''}" id="chart-ind"
            title="Indikatoren ein-/ausblenden: Bollinger (20,2) · Supertrend (10,3) · CCI 20 (untere Skala)">ƒ Ind.</button>
        </div>`
      : '';
    // Kopf + Chart + Level-Bar + Zoom-Zeile liegen zusammen in `#chart-fs` —
    // dieser Block wandert im Vollbild als Ganzes in den <body> (siehe
    // `enterChartFs`), damit Titel, Horizont-Umschalter und Zoom mitkommen.
    const profile = want1J || !tdReachable ? profileHTML(c) : '';
    parts.push(`<div class="chart-fs" id="chart-fs">
        <div class="chart-head-row">
          <h4 class="pv-subhead"><span class="chart-fs__sym">${c.symbol}</span>${head}</h4>
          <div class="chart-fs__act">${toggle}${fsBtn}</div>
        </div>${body}${zoomRow}
      </div>${profile}`);
  } else {
    parts.push(ls10dChartHTML(c, disp) + profileHTML(c));
  }

  // 3. Trend-Band (horizontal): 52W-Range + ATH-Cap, SMAs/Bollinger/Pivots/
  //    Donchian-Ticks, Cluster. Darunter alle Kurs-Level als ausklappbare
  //    Tabelle (ersetzt Legende + Fußnote).
  if (tv) {
    const band = priceBandHorizontalSVG(tv, pc?.clusters ?? null);
    if (!band.includes('pv-empty')) {
      parts.push(`<div class="chart-head-row"><h4 class="pv-subhead">Trend-Band im Detail</h4></div>
        <div class="pv-hband-wrap">${band}</div>
        <details class="pv-levels-details"><summary>Kurs-Daten</summary>${priceLevelsTable(tv)}</details>`);
    }
  }

  // 4. Renditen, Range/Volatilität (der Live-Intraday-Verlauf steckt bereits
  //    im Chart oben — keine separate Sparkline mehr).
  if (tv) {
    const perf = perfBarsHTML(tv);
    if (perf) parts.push(`<h4 class="pv-subhead">Rendite je Zeitraum</h4>${perf}`);
    const ranges = rangeBandsHTML(tv);
    const vol = volStatsHTML(tv);
    const gauge = bollingerGaugeHTML(tv);
    if (ranges || vol || gauge) {
      parts.push(`<h4 class="pv-subhead">Range &amp; Volatilität (1M–52W)</h4>${ranges}${vol}${gauge}`);
    }
  }
  return parts.join('');
}

/* ── Firmenprofil unter dem Chart (TV business_description / Yahoo) ────────── */

const escProfile = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

function profileHTML(c) {
  if (c._profile_loading) {
    return `<p class="id-profile id-profile--loading"><span class="ls-loading"></span> Lade Firmenprofil …</p>`;
  }
  const p = c.company_profile;
  if (!p?.description) {
    // Manueller Abruf (spart ROIC-Rate-Limit): Button statt Auto-Fetch;
    // nach einem Fehlversuch bleibt er als "erneut versuchen" stehen.
    return `<div class="id-profile"><button class="btn btn-sm btn-secondary" id="profile-load">📇 Firmenprofil laden${p?.error ? ' (erneut versuchen)' : ''}</button></div>`;
  }
  const src = String(p.source ?? '').startsWith('wikipedia') ? 'Wikipedia'
    : p.source === 'roic' ? 'ROIC.ai' : 'Quelle';
  const link = p.url ?? p.website;
  const site = link ? ` · <a href="${escProfile(link)}" target="_blank" rel="noopener">${p.url ? 'Artikel' : 'Website'}</a>` : '';
  const f = p.facts ?? {};
  const facts = [
    f.ceo ? `CEO ${f.ceo}` : null,
    f.employees ? `${Number(f.employees).toLocaleString('de-DE')} MA` : null,
    f.ipo_date ? `IPO ${String(f.ipo_date).slice(0, 4)}` : null,
    f.industry ?? null,
    f.country ?? null,
  ].filter(Boolean);
  const factsLine = facts.length
    ? `<p class="id-profile__facts">${facts.map(escProfile).join(' · ')}</p>` : '';
  return `<div class="id-profile">
    <p class="id-profile__text" id="profile-text">${escProfile(p.description)}</p>
    ${factsLine}
    <div class="id-profile__foot">
      <button class="id-profile__more" id="profile-more">mehr</button>
      <span class="id-profile__src">Profil: ${src}${site}</span>
    </div>
  </div>`;
}

/* ── Tab: News (ROIC.ai /v2/company/news, on-demand beim Tab-Öffnen) ───────── */

function renderNewsTab(c) {
  if (c._news_loading) {
    return `<p class="id-profile--loading"><span class="ls-loading"></span> Lade News (ROIC.ai) …</p>`;
  }
  const n = c.company_news;
  if (!n || n.error) {
    return `<div class="news-empty">
      <button class="btn btn-sm btn-secondary" id="news-load">📰 News laden (ROIC.ai)${n?.error ? ' — erneut' : ''}</button>
      ${n?.error && n.message ? `<p class="pv-muted">Letzter Versuch: ${escProfile(n.message)}</p>` : ''}
    </div>`;
  }
  if (!n.items?.length) {
    return `<p class="pv-muted">Keine News gefunden.</p>
      <button class="btn btn-sm btn-secondary" id="news-load">Aktualisieren</button>`;
  }
  const fmtDay = (iso) => {
    if (!iso) return '';
    const t = new Date(iso);
    if (Number.isNaN(+t)) return '';
    const day = t.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
    // Uhrzeit nur anzeigen, wenn die Quelle eine mitliefert (nicht 00:00).
    return (t.getHours() || t.getMinutes())
      ? `${day} ${t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
      : day;
  };
  const rows = n.items.map((it) => `<article class="news-item">
    <div class="news-item__meta">${fmtDay(it.date)}${it.source ? ` · ${escProfile(it.source)}` : ''}</div>
    <div class="news-item__title">${it.url
      ? `<a href="${escProfile(it.url)}" target="_blank" rel="noopener">${escProfile(it.title)}</a>`
      : escProfile(it.title)}</div>
    ${it.text ? `<p class="news-item__text">${escProfile(it.text)}</p>` : ''}
  </article>`).join('');
  const when = n.fetched_at
    ? new Date(n.fetched_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
  return `${rows}
    <div class="news-foot">
      <span class="pv-muted">Quelle: ROIC.ai${when ? ` · Stand ${when}` : ''}</span>
      <button class="btn btn-sm btn-secondary" id="news-load" data-force="1">Aktualisieren</button>
    </div>`;
}

/* ── Tab 2: Trade (live values from trade-setup / ls-history-signals) ─────── */

function phCard(title, tag, note) {
  return `<div class="ph-card">
    <div class="ph-card__head">${title}${tag ? `<span class="ph-tag">${tag}</span>` : ''}</div>
    <p>${note}</p>
  </div>`;
}

// Swing-Analyse card (TwelveData). Shows the zone ladder when computed, else a
// hint to run the 📐 Swing-Check button in the toolbar. Non-US tickers get a
// clear "US only" note (TwelveData Free is US-only). Marks a stale result
// (older than ~1 trading day for daily, ~1 week for weekly).
function swingAgeStale(a) {
  const t = Date.parse(a.checked_at);
  if (!Number.isFinite(t)) return false;
  const ageH = (Date.now() - t) / 3.6e6;
  return a.interval === 'weekly' ? ageH > 24 * 7 : ageH > 24;
}
function swingCard(c) {
  const a = c.swing_analysis;
  const head = (extra = '') => `<div class="ph-card__head">Swing-Analyse<span class="ph-tag">TwelveData</span>${extra}</div>`;
  if (c._swing_loading) {
    return `<div class="ph-card">${head()}<p><span class="ls-loading" title="lädt…"></span> Lade OHLC & berechne Zonen …</p></div>`;
  }
  if (a && !a.error) {
    const stale = swingAgeStale(a);
    const when = a.checked_at ? new Date(a.checked_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    return `<div class="ph-card ph-card--swing">
      ${head(stale ? '<span class="sw-stale" title="Älter als 1 Handelstag – neu berechnen">veraltet</span>' : '')}
      <div class="sw-viz">${swingLadderSVG(a)}</div>
      <p class="pv-muted">Stand ${when} · ${a.bars} Bars (${a.interval}). Zonen gelten bis gebrochen; Kursposition live via LS.</p>
    </div>`;
  }
  const hint = !isUsTicker(c)
    ? 'Nur US-Titel (TwelveData Free). Für diesen Titel nicht verfügbar.'
    : '📐 Swing-Check oben in der Leiste laden – berechnet Support/Resistance-Zonen aus ~1 Jahr echtem OHLC.';
  return `<div class="ph-card">${head()}<p>${hint}</p></div>`;
}

// One row of the vertical ticket scale: label · price · Δ% vs Kurs.
function ticketRow(label, value, kurs, cls = '', title = '') {
  const has = value != null;
  const delta = has && kurs != null && kurs > 0 && cls !== 'ticket__row--kurs'
    ? (value - kurs) / kurs * 100 : null;
  return `<div class="ticket__row ${cls}"${title ? ` title="${title}"` : ''}>
    <span class="ticket__lbl">${label}</span>
    <span class="ticket__val">${has ? fmtNum(value) : '—'}</span>
    <span class="ticket__delta ${delta == null ? '' : delta >= 0 ? 'pos' : 'neg'}">${delta != null ? fmtPct(delta) : ''}</span>
  </div>`;
}

function exitChips(list, skipKey = null) {
  if (!list?.length) return '';
  return `<div class="ticket__chips">${list.filter((x) => x.key !== skipKey).map((x) =>
    `<span class="ticket__chip" title="${x.label}">${x.label.split(' ')[0]} <b>${fmtNum(x.value)}</b></span>`).join('')}</div>`;
}

// Heuristic probability as a labelled progress bar (mobile-scannable).
function probBar(label, r, pctKey, codeMap, hist, dir) {
  if (!r) {
    const note = Array.isArray(hist) && hist.length
      ? `${hist.length}/${MAX_SNAPSHOTS}T Historie – ab ${MIN_SNAPSHOTS} Tagen`
      : 'keine LS-Historie (Watch-Bucket)';
    return `<div class="prob-row"><span class="prob-row__lbl">${label}</span>
      <span class="prob-row__note">${note}</span></div>`;
  }
  const pct = r[pctKey];
  const codes = Object.entries(codeMap).filter(([k]) => r.criteria[k]).map(([, v]) => v).join(' + ') || 'keine Kriterien';
  return `<div class="prob-row" title="Heuristik (max 90%) · Kriterien: ${codes}">
    <span class="prob-row__lbl">${label}</span>
    <div class="prob-row__track"><div class="prob-row__fill ${dir}" style="width:${pct}%"></div></div>
    <span class="prob-row__val ${pct >= 50 ? dir : ''}">${pct}%</span>
  </div>`;
}

function renderTradeTab(c, disp, pc, tl, side) {
  const tv = disp.tv;
  if (!tv || !tl) return `<p class="pv-empty">Keine TV-Daten – „TV Daten" in der Tabelle laden.</p>`;
  const { cl, ex, kurs, target, entryL, stopL, rr, brk, lsF } = tl;
  const sup = pc?.nearestSup?.mid ?? null;
  const res = pc?.nearestRes?.mid ?? null;
  const bottom = detectBottomSignal(c.ls_history);
  const bottomVal = bottom?.isBottom && bottom.bottomPrice != null && lsF != null ? bottom.bottomPrice * lsF : null;
  const bottomTip = bottom == null
    ? 'Braucht ≥6 Tage LS-Historie'
    : bottom.isBottom
      ? (bottom.basis === 'swing-low' ? 'Bestätigtes Swing-Low' : 'Kapitulations-Tief')
      : `Kein Bottom · Trend ${bottom.criteria.trendFlattening ? '✓' : '✗'} · Vol@Support ${bottom.criteria.decliningVolumeNearSupport ? '✓' : '✗'} · Candle ${bottom.criteria.candleShift ? '✓' : '✗'} · Range ${bottom.criteria.rangeCompression ? '✓' : '✗'}`;
  const chandS = ex?.short?.find((x) => x.key === 'chand')?.value ?? null;
  const bo = detectBreakoutSetup(c.ls_history, cl?.avgVol);
  const bd = detectBreakdownRisk(c.ls_history, cl?.avgVol);

  // Ticket scale: ordered top→bottom by price side, Kurs highlighted.
  const ticket = side === 'long'
    ? [
      ['Target', target, 'ticket__row--target', `Kurs + ${cl?.gainPct ?? '–'}% (Cluster)`],
      ['Res-Cluster', res, '', pc?.nearestRes ? `Score ${pc.nearestRes.score} · ${pc.nearestRes.members.map((m) => m.label).join(' · ')}` : ''],
      ['Entry · Pivot R1|1W', entryL, 'ticket__row--entry', 'Long-Entry-Trigger'],
      ['KURS', kurs, 'ticket__row--kurs', ''],
      ['Sup-Cluster', sup, '', pc?.nearestSup ? `Score ${pc.nearestSup.score} · ${pc.nearestSup.members.map((m) => m.label).join(' · ')}` : ''],
      ['Stop', stopL, 'ticket__row--stop', ex?.primaryLong ? ex.primaryLong.label : ''],
    ]
    : [
      ['Chandelier-Stop', chandS, 'ticket__row--stop', `low|22 + ${cl?.atrMult ?? '–'}×ATR`],
      ['Entry · Breakout', brk, 'ticket__row--entry', 'high|20 + 0,01 %'],
      ['KURS', kurs, 'ticket__row--kurs', ''],
      ['Sup-Cluster', sup, '', pc?.nearestSup ? `Score ${pc.nearestSup.score}` : ''],
      ['Bottom-Signal', bottomVal, 'ticket__row--target', bottomTip],
    ];

  const otherExits = side === 'long' ? exitChips(ex?.long, ex?.primaryLong?.key) : exitChips(ex?.short, 'chand');

  return `
    <div class="trade-head">
      ${cl ? `<span class="cluster-badge cluster-badge--${cl.key}" title="ATRP ${fmtNum(c.tv_data?.atrp, 1)}% · MCap ${formatMarketCap(c.tv_data?.market_cap)} · ATR-Mult ${cl.atrMult} · Vol-Basis ØV${cl.volBasis}">${cl.label}</span>` : ''}
      ${side === 'long' && rr != null ? `<span class="trade-head__target" title="Chance-Risiko: (Target − Entry) / (Entry − Stop)">R:R <b>${fmtNum(rr, 1)}</b></span>` : ''}
      ${curToggle(disp, 'trade-head__cur')}
    </div>
    ${heroLevels(c, disp, pc, tl)}
    <div class="tab-bar ticket__seg" role="tablist">
      <button class="tab-btn${side === 'long' ? ' active' : ''}" data-side="long" role="tab" aria-selected="${side === 'long'}">Long</button>
      <button class="tab-btn${side === 'short' ? ' active' : ''}" data-side="short" role="tab" aria-selected="${side === 'short'}">Short</button>
    </div>
    <div class="ticket">
      ${(() => {
        const rows = ticket.map(([lbl, v, cls, tip]) => ticketRow(lbl, v, kurs, cls, tip));
        // Portfolio-Einstand direkt unter KURS, mit echtem P/L (Kurs vs. Einstand)
        // statt der üblichen Δ-Lesart (Level vs. Kurs).
        const mkE = mkEntryDisp(c, disp);
        if (mkE != null) {
          const pl = kurs != null && mkE > 0 ? ((kurs - mkE) / mkE) * 100 : null;
          const mkRow = `<div class="ticket__row ticket__row--mk" title="Einstand aus dem Merkliste-Portfolio (EUR → Anzeigewährung)${c.mk_shares ? ` · ${c.mk_shares} Stk` : ''} · Δ = P/L des Kurses vs. Einstand">
            <span class="ticket__lbl">★ Einstand</span>
            <span class="ticket__val">${fmtNum(mkE)}</span>
            <span class="ticket__delta ${pl == null ? '' : pl >= 0 ? 'pos' : 'neg'}">${pl != null ? fmtPct(pl) : ''}</span>
          </div>`;
          const kursIdx = ticket.findIndex(([, , cls]) => cls === 'ticket__row--kurs');
          rows.splice((kursIdx < 0 ? rows.length : kursIdx + 1), 0, mkRow);
        }
        return rows.join('');
      })()}
    </div>
    ${otherExits ? `<h4 class="pv-subhead">Weitere Exits</h4>${otherExits}` : ''}
    <h4 class="pv-subhead">Ausbruchs-Signale (nächste ~10 T)</h4>
    ${probBar('Brk↑', bo, 'breakoutProbabilityPct', { extendedNarrowRange: 'Range', volumeConfirmation: 'Vol', moneyFlowBullish: 'Money-Flow', flatTopBullFlag: 'Flat-Top/Flag' }, c.ls_history, 'pos')}
    ${probBar('Brk↓', bd, 'breakdownProbabilityPct', { volumeSpikeNoFollowThrough: 'Spike o. Follow-Through', distributionDay: 'Distribution-Day', nearRecentHigh: 'Nähe Hoch' }, c.ls_history, 'neg')}
    ${swingCard(c)}
    ${phCard('Analyst Targets', '', 'Platzhalter – Datenquelle folgt.')}
  `;
}

/* ── Tab 2: Trend ─────────────────────────────────────────────────────────────
 * Erklärt die Bias-Grafik aus der Tabelle und vertieft sie. Der obere Teil
 * (Bias-Kopf, Ebenen, Ring-Legende, Trendalter-Proxy) läuft für JEDEN Ticker
 * aus tv_data. Alles darunter braucht die TwelveData-Historie, die es auf dem
 * Free-Tier nur für US-Titel gibt — deshalb der klar getrennte zweite Block.
 */

const fmtN = (v, d = 1) => (v == null || Number.isNaN(v) ? '—'
  : Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtPctS = (v, d = 1) =>
  (v == null || Number.isNaN(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}%`);
const deDate = (s) => (s ? new Date(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');

/* Balken für einen Ebenen-Score −1…+1: Nulllinie in der Mitte, Ausschlag nach
   rechts (grün) oder links (rot) — ein reiner Füllstand könnte die Richtung
   nicht zeigen. */
function levelBar(v) {
  if (v == null) return '<span class="tb-bar tb-bar--empty"></span>';
  const w = Math.min(Math.abs(v), 1) * 50;
  const side = v >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%`;
  return `<span class="tb-bar"><i class="tb-bar__fill ${v >= 0 ? 'pos' : 'neg'}" style="${side}"></i></span>`;
}

/* Die Einzelchecks je Ebene als Klartext — das ist die eigentliche Erklärung,
   warum ein Ring-Segment rot oder grün ist. */
function levelChecks(key, tv) {
  const close = tv.close_1m ?? tv.close;
  const relTxt = (a, b) => (a == null || b == null || !b ? null : fmtPctS((a - b) / Math.abs(b) * 100));
  if (key === 'regime') {
    return [
      relTxt(close, tv.sma200) && `Kurs ${relTxt(close, tv.sma200)} zur SMA200`,
      tv.sma50 != null && tv.sma200 != null && `SMA50 ${tv.sma50 > tv.sma200 ? '>' : '<'} SMA200 (${tv.sma50 > tv.sma200 ? 'Golden' : 'Death'} Cross)`,
      tv.ema20_1w != null && tv.ema50_1w != null && `Weekly-Stack ${tv.ema20_1w > tv.ema50_1w ? '▲' : '▼'}`,
    ].filter(Boolean);
  }
  if (key === 'trend') {
    const up = tv.aroon_up ?? tv.aroon_up_1m, dn = tv.aroon_down ?? tv.aroon_down_1m;
    return [
      tv.ema20 != null && tv.ema50 != null && `EMA-Stack ${tv.ema20 > tv.ema50 ? '▲' : '▼'}`,
      tv.adx != null && `ADX ${fmtN(tv.adx)}${tv.adx_plus_di != null ? ` (DI+ ${fmtN(tv.adx_plus_di, 0)} / DI− ${fmtN(tv.adx_minus_di, 0)})` : ''}`,
      up != null && dn != null && `Aroon ${fmtPctS(up - dn, 0).replace('%', '')}`,
      tv.perf_1m != null && `Perf1M ${fmtPctS(tv.perf_1m)}`,
    ].filter(Boolean);
  }
  const hist = tv.macd != null && tv.macd_signal != null ? tv.macd - tv.macd_signal : null;
  return [
    tv.perf_w != null && `PerfW ${fmtPctS(tv.perf_w)}`,
    tv.change_1d != null && `Δ1T ${fmtPctS(tv.change_1d)}`,
    hist != null && `MACD-Hist ${hist >= 0 ? '▲' : '▼'}`,
    tv.rsi != null && `RSI ${fmtN(tv.rsi, 0)}`,
  ].filter(Boolean);
}

/* Bias-Verlauf als Fläche um die Nulllinie. Bewusst kein Liniendiagramm: die
   Frage ist „wann war es positiv/negativ und wie lange", nicht der exakte Wert. */
function biasSparkSVG(series, w = 320, h = 56) {
  if (!series?.length) return '';
  const n = series.length, mid = h / 2;
  const x = (i) => (i / (n - 1)) * w;
  const y = (b) => mid - (Math.max(-100, Math.min(100, b)) / 100) * (mid - 2);
  const areaFor = (positive) => {
    // Nur den jeweiligen Halbraum füllen — an der Nulllinie abgeschnitten.
    let d = `M0 ${mid}`;
    series.forEach((p, i) => {
      const v = positive ? Math.max(0, p.b) : Math.min(0, p.b);
      d += ` L${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    });
    return `${d} L${w} ${mid} Z`;
  };
  return `<svg class="tb-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img"
      aria-label="Bias-Verlauf ${n} Handelstage">
    <path class="tb-spark__pos" d="${areaFor(true)}"/>
    <path class="tb-spark__neg" d="${areaFor(false)}"/>
    <line class="tb-spark__zero" x1="0" y1="${mid}" x2="${w}" y2="${mid}"/>
  </svg>`;
}

function trendStat(label, value, sub = '', cls = '') {
  return `<div class="tb-stat"><span class="tb-stat__lbl">${label}</span>
    <span class="tb-stat__val ${cls}">${value}</span>
    ${sub ? `<span class="tb-stat__sub">${sub}</span>` : ''}</div>`;
}

/* Fragilität: Frühwarnung, ausdrücklich KEINE Prognose eines Wendepunkts. */
function fragilityItems(c, tv, bars) {
  const out = [];
  const close = tv.close_1m ?? tv.close;

  const div = bars ? detectDivergence(bars, detectPivots(bars, 3)) : null;
  if (div) {
    out.push({ warn: true, kind: 'div', div, txt: div.kind === 'bear'
      ? `Bearishe Divergenz: höheres Kurshoch am ${deDate(div.date)}, aber RSI ${fmtN(div.rsiLast, 0)} statt ${fmtN(div.rsiPrev, 0)}`
      : `Bullishe Divergenz: tieferes Tief am ${deDate(div.date)}, aber RSI ${fmtN(div.rsiLast, 0)} statt ${fmtN(div.rsiPrev, 0)}` });
  }

  if (tv.adx != null) {
    out.push({ warn: tv.adx < 20, kind: 'adx', adx: tv.adx,
      txt: tv.adx < 20 ? `ADX ${fmtN(tv.adx)} — Trend verliert Struktur` : `ADX ${fmtN(tv.adx)} — Struktur intakt` });
  }

  // Abstand zur Regime-Linie in ATR: „wie weit bis zum Bruch", vergleichbar
  // über Papiere hinweg (Prozent wäre bei volatilen Werten irreführend).
  const atr = tv.atr ?? (tv.atrp != null && close != null ? tv.atrp / 100 * close : null);
  for (const [lbl, sma] of [['SMA50', tv.sma50], ['SMA200', tv.sma200]]) {
    if (close == null || sma == null || !atr) continue;
    const d = (close - sma) / atr;
    out.push({ warn: Math.abs(d) < 1, kind: lbl === 'SMA200' ? 'sma200' : 'sma50', lbl, dist: d,
      txt: `Abstand zur ${lbl}: ${fmtN(Math.abs(d))} ATR ${d >= 0 ? 'darüber' : 'darunter'}` });
  }
  return out;
}

/* ── Fazit-Satz ───────────────────────────────────────────────────────────────
 * Ersetzt den früheren „Frühwarnung, keine Prognose"-Absatz: statt eines
 * Disclaimers eine Aussage, die alles darüber zusammenfasst. Bewusst
 * BESCHREIBEND formuliert („mahnt zur Vorsicht", „zieht noch nicht mit") und
 * nie vorhersagend — die Einordnung steckt damit in der Wortwahl statt in
 * einem eigenen Absatz.
 */
const LEVEL_NOUN = { regime: 'das Regime', trend: 'die Trend-Ebene', momentum: 'das Momentum' };

function trendSummary(b, age, frag, st) {
  const num = `${b.score > 0 ? '+' : b.score < 0 ? '−' : ''}${Math.abs(b.score)}`;
  if (b.neutral) {
    return `Kein klarer Trend: die Ebenen tragen sich gegenseitig nicht, das Bias liegt bei ${num}.`;
  }

  const want = b.sign > 0 ? 'up' : 'dn';
  const dirWord = b.sign > 0 ? 'Aufwärts' : 'Abwärts';
  let s = `${dirWord}trend${age ? ` seit ${age.label}` : ''}`;

  // Einigkeit der drei Ebenen
  const known = BIAS_LEVELS.filter(([k]) => b.dirs[k]);
  const agree = known.filter(([k]) => b.dirs[k] === want);
  const off   = known.filter(([k]) => b.dirs[k] !== want);
  if (off.length === 0) s += ', alle drei Ebenen einig';
  else if (agree.length >= 2) {
    const [k] = off[0];
    s += `, aber ${LEVEL_NOUN[k]} ${b.dirs[k] === 'flat' ? 'ist neutral' : 'zieht noch nicht mit'}`;
  } else if (agree.length === 1) s += `, getragen nur von ${LEVEL_NOUN[agree[0][0]]}`;
  else s += ', die Ebenen widersprechen sich';

  // Reifegrad aus der gemessenen Historie (nur wenn Richtung dazu passt)
  if (st?.percentile != null && st.current?.dir === b.sign) {
    s += ` und länger als ${st.percentile}% der bisherigen ${dirWord}phasen`;
  }

  // Stärkste Einschränkung, nach Gewicht sortiert
  const warn = ['div', 'adx', 'sma200', 'sma50']
    .map((k) => frag.find((f) => f.warn && f.kind === k)).find(Boolean);
  let tail = '';
  if (warn?.kind === 'div') {
    tail = warn.div.kind === 'bear'
      ? `die bearishe Divergenz am letzten Hoch (${deDate(warn.div.date)}) mahnt zur Vorsicht`
      : `die bullishe Divergenz am letzten Tief (${deDate(warn.div.date)}) stützt gegen den Trend`;
  } else if (warn?.kind === 'adx') {
    tail = `ADX ${fmtN(warn.adx, 0)}, die Struktur lässt nach`;
  } else if (warn) {
    tail = `der Kurs steht nur ${fmtN(Math.abs(warn.dist))} ATR ${warn.dist >= 0 ? 'über' : 'unter'} der ${warn.lbl}`;
  } else if (off.length === 0) {
    // „Struktur intakt" nur, wenn es nichts anderes zu sagen gibt — hängt man
    // es an eine bereits genannte Uneinigkeit, widerspricht es sich selbst.
    tail = 'Struktur intakt';
  }

  return `${s}${tail ? ` — ${tail}` : ''}.`;
}

function renderTrendTab(c) {
  const tv = c.tv_data;
  const b = tv ? computeBias(tv) : null;
  if (!b) {
    // Die Retail-Stimmung hängt nicht an den TV-Daten — sie bleibt auch ohne
    // berechenbares Bias sichtbar, sonst wäre der Tab hier komplett leer.
    return `<p class="pv-empty">Kein Bias berechenbar – „TV Daten" in der Subbar laden.</p>`
      + renderStocktwitsBlock(c);
  }

  const age  = b.neutral ? null : trendAge(tv, b.sign);
  const tone = b.neutral ? 'flat' : b.sign > 0 ? 'pos' : 'neg';
  const num  = `${b.score > 0 ? '+' : b.score < 0 ? '−' : ''}${Math.abs(b.score)}`;

  /* 1 · Kopf */
  const head = `<div class="tb-head">
    ${biasRingSVG(b, { size: 96, icon: b.sign > 0 ? icons.bull : icons.bear })}
    <div class="tb-head__txt">
      <div class="tb-head__val ${tone}">${num}</div>
      <div class="tb-head__lbl">${biasLabel(b.score)}</div>
      ${age ? `<div class="tb-head__age">${b.sign > 0 ? 'aufwärts' : 'abwärts'} seit ${age.label}${age.exact ? '' : ' (Untergrenze)'}</div>` : ''}
    </div>
  </div>`;

  /* 2 · Ebenen-Aufschlüsselung */
  const weights = { regime: 40, trend: 35, momentum: 25 };
  const levels = BIAS_LEVELS.map(([key, label]) => {
    const v = b.levels[key];
    return `<div class="tb-level">
      <div class="tb-level__top">
        <span class="tb-level__dot bias-seg--${b.dirs[key] ?? 'flat'}"></span>
        <span class="tb-level__name">${label}</span>
        ${levelBar(v)}
        <span class="tb-level__val ${v == null ? '' : v >= 0 ? 'pos' : 'neg'}">${v == null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2)}</span>
        <span class="tb-level__w">${weights[key]}%</span>
      </div>
      <div class="tb-level__checks">${levelChecks(key, tv).join(' · ') || '—'}</div>
    </div>`;
  }).join('');

  const meta = `<div class="tb-meta">
    Volumen ×${b.volBoost}${b.volBoost > 1 ? ' (bestätigt)' : b.volBoost < 1 ? ' (dünn)' : ''}
    · Datenabdeckung ${Math.round(b.coverage * 100)}%</div>`;

  /* 3 · Ring-Legende — eingeklappt: der Text erklärt einmal, danach steht er
     nur im Weg. <details> statt eigenem Toggle, wie bei .pv-levels-details. */
  const legend = `<details class="tb-legend">
    <summary>Was der Ring zeigt</summary>
    <p>Drei Segmente im Uhrzeigersinn ab 12 Uhr: <b>Regime</b> → <b>Trend</b> → <b>Momentum</b>.
    Grün = aufwärts, rot = abwärts, grau = neutral. Ein durchgehend grüner Ring heißt,
    dass alle drei Ebenen einig sind; ein gemischter Ring zeigt, dass eine Ebene bereits
    dreht — ein frischer Ausbruch gegen ein noch negatives Regime liest sich als rot/grün/grün.
    Die Zahl daneben ist die gewichtete Summe (−100…+100), das Icon ihre Richtung.</p>
  </details>`;

  /* 4 · Historie (TwelveData) */
  const hist = c.swing_analysis?.bias_history;
  const bars = Array.isArray(c.swing_analysis?.ohlc)
    ? c.swing_analysis.ohlc.map((o) => ({ date: o.date, open: o.o, high: o.h, low: o.l, close: o.c, volume: o.v }))
    : null;

  // Vor dem Historien-Block berechnet, weil der Fazit-Satz unten den Reifegrad
  // mitnimmt.
  const st = hist?.series?.length ? regimeStats(hist.series) : null;

  let histBlock;
  if (hist?.series?.length) {
    const cur = st?.current;
    const dirTxt = cur ? (cur.dir > 0 ? 'bullish' : 'bearish') : '—';
    /* Live-Bias und Verlaufsende können auseinanderlaufen: tv_data ist von
       heute, der letzte TD-Bar oft einen Tag oder mehr älter. Das kommentarlos
       nebeneinander zu stellen (Kopf „bullish", Historie „bearish seit …")
       wäre irreführend — also benennen. */
    const mismatch = cur && !b.neutral && cur.dir !== b.sign;
    histBlock = `
      <h4 class="pv-subhead">Bias-Verlauf · ${hist.series.length} Handelstage</h4>
      ${mismatch ? `<p class="tb-hint is-warn">Der Verlauf endet am ${deDate(hist.to)}
        ${dirTxt}, das aktuelle Bias oben ist ${b.sign > 0 ? 'bullish' : 'bearish'} —
        die Wende liegt nach dem letzten geladenen Kurstag. Verlauf neu laden für
        ein aktuelles Alter.</p>` : ''}
      ${biasSparkSVG(hist.series)}
      <div class="tb-spark__axis"><span>${deDate(hist.from)}</span><span>${deDate(hist.to)}</span></div>
      <div class="tb-stats">
        ${trendStat('Gemessenes Alter', cur ? `${cur.days} T` : '—', cur ? `${dirTxt} seit ${deDate(cur.start)}` : '')}
        ${trendStat('Reifegrad', st?.percentile != null ? `${st.percentile}%` : '—',
          st?.percentile != null ? `länger als ${st.percentile}% der bisherigen ${dirTxt}en Phasen` : 'keine Vergleichsphase')}
        ${trendStat('Ø-Dauer', `${st?.avgBull != null ? Math.round(st.avgBull) : '—'} / ${st?.avgBear != null ? Math.round(st.avgBear) : '—'} T`,
          `bull / bear · ${st?.countBull ?? 0} + ${st?.countBear ?? 0} Phasen`)}
        ${trendStat('Richtungswechsel', `${st?.flips ?? 0}`, 'im Auswertungsfenster')}
        ${trendStat('Marktstruktur', STRUCT_LABEL[c.swing_analysis.structure] ?? '—', 'aus den Swing-Punkten')}
      </div>`;
  } else if (isUsTicker(c) || yahooChartSymbol(c) != null) {
    const src = isUsTicker(c) ? 'TwelveData' : 'Yahoo';
    histBlock = `<h4 class="pv-subhead">Gemessenes Trendalter</h4>
      <p class="tb-hint">Noch kein Verlauf geladen. Der 1-Jahres-Abruf im
      <b>Perf.</b>-Tab („1J ${isUsTicker(c) ? 'TD' : 'YF'}") holt die Tageskerzen — daraus wird das Bias für jeden
      vergangenen Tag nachgerechnet und das Trendalter gemessen statt geschätzt.</p>
      <button class="btn btn-sm btn-secondary" id="tb-load">${icons.candlestick} Verlauf laden (${src})</button>`;
  } else {
    // Übrig bleiben Titel ohne auflösbares Yahoo-Suffix — praktisch nur
    // Euronext-Notierungen ohne `yahoo_symbol`, weil unser kanonischer Code
    // Paris/Amsterdam/Brüssel zusammenfasst und Yahoo sie trennt.
    histBlock = `<h4 class="pv-subhead">Gemessenes Trendalter</h4>
      <p class="tb-hint">Für diesen Titel fehlt das Yahoo-Symbol samt Börsensuffix
      (z. B. <code>.PA</code> oder <code>.AS</code>) — ohne das lassen sich keine
      Tageskerzen holen. Im Abschnitt „Links" lässt sich die Yahoo-URL ergänzen.
      Das Trendalter oben bleibt so lange die Untergrenze aus den
      Performance-Fenstern.</p>`;
  }

  /* 5 · Fragilität */
  const frag = fragilityItems(c, tv, bars);
  const fragBlock = frag.length
    ? `<h4 class="pv-subhead">Fragilität</h4>
       <ul class="tb-frag">${frag.map((f) =>
         `<li class="${f.warn ? 'is-warn' : ''}">${f.warn ? '⚠' : '·'} ${f.txt}</li>`).join('')}</ul>
       <p class="tb-summary">${trendSummary(b, age, frag, st)}</p>`
    : `<p class="tb-summary">${trendSummary(b, age, [], st)}</p>`;

  return head + `<div class="tb-levels">${levels}${meta}</div>` + legend + histBlock + fragBlock
    + renderStocktwitsBlock(c);
}

const STRUCT_LABEL = { up: '▲ Aufwärts (HH/HL)', down: '▼ Abwärts (LH/LL)', range: '↔ Seitwärts' };

/* ── StockTwits: Retail-Stimmung ──────────────────────────────────────────────
   Bewusst unter dem Bias-Block, aber klar abgesetzt: das hier ist die Meinung
   der Menge, kein Qualitätsmaß und kein Score. Es wird deshalb nirgends mit den
   TV-Ebenen verrechnet — es steht daneben und darf ihnen widersprechen.
   Die Sparkline teilt sich die Grafik mit dem Bias-Verlauf darüber (Nulllinie =
   50% neutral), damit beide Verläufe in derselben Bildsprache lesbar sind. */
function renderStocktwitsBlock(c) {
  const head = `<h4 class="pv-subhead">Retail-Stimmung · StockTwits</h4>`;
  const s = c.st_sentiment;

  if (c._st_loading) return head + `<p class="tb-hint">Lade Bull/Bear-Quote …</p>`;

  if (!s) {
    if (!isUsTicker(c)) {
      return head + `<p class="tb-hint">Nur für US-Titel: StockTwits führt für
        europäische Notierungen keine Sentiment-Reihe.</p>`;
    }
    return head + `<p class="tb-hint">Öffentliche Bull/Bear-Quote der letzten
      ~60 Tage — zeigt, ob die Netz-Stimmung den Kurs bestätigt oder ihm
      widerspricht.</p>
      <button class="btn btn-sm btn-secondary" id="st-load">${icons.messageSquare} Stimmung laden (StockTwits)</button>`;
  }

  if (s.unsupported) {
    return head + `<p class="tb-hint">Nur für US-Titel: StockTwits führt für
      europäische Notierungen keine Sentiment-Reihe.</p>`;
  }
  if (s.error) {
    return head + `<p class="tb-hint is-warn">${s.error}</p>
      <button class="btn btn-sm btn-secondary" id="st-load">${icons.messageSquare} Erneut versuchen</button>`;
  }

  const bullCls = s.bullish >= 50 ? 'pos' : 'neg';
  const dCls    = s.delta7 == null ? '' : s.delta7 >= 0 ? 'pos' : 'neg';
  const dTxt    = s.delta7 == null ? '—'
    : `${s.delta7 >= 0 ? '+' : '−'}${fmtNum(Math.abs(s.delta7), 1)} pp`;

  /* Bull/Bear-Prozent (0…100, neutral 50) auf die Bias-Skala (−100…+100,
     neutral 0) mappen, damit dieselbe Sparkline-Funktion greift. */
  const spark = s.series?.length
    ? biasSparkSVG(s.series.map((v) => ({ b: (v - 50) * 2 })))
    : '';

  const extremeHint = s.extreme
    ? `<p class="tb-hint is-warn">Die Menge steht mit ${fmtNum(s.bullish, 0)}%
       ${s.extreme === 'bull' ? 'bullish' : 'bearish'} sehr einseitig. Einseitige
       Retail-Positionierung ist historisch eher Kontra-Indikator als Bestätigung —
       als Warnsignal lesen, nicht als Rückenwind.</p>`
    : '';

  return head + spark + `
    <div class="tb-stats">
      ${trendStat('Bullen', `${fmtNum(s.bullish, 1)}%`, `${fmtNum(s.bearish, 1)}% bearish`, bullCls)}
      ${trendStat('Ø 7 Tage', s.avg7 == null ? '—' : `${fmtNum(s.avg7, 1)}%`,
        s.avg30 == null ? '' : `Ø 30 T ${fmtNum(s.avg30, 1)}%`)}
      ${trendStat('Momentum', dTxt, 'heute vs. Ø 7 Tage', dCls)}
    </div>
    ${extremeHint}
    <p class="tb-hint">${s.days} Tage Reihe${s.date ? ` bis ${deDate(s.date)}` : ''} ·
      Stimmung der StockTwits-Nutzer, kein Qualitätsmaß — sie fließt in keinen Score ein.</p>
    <button class="btn btn-sm btn-secondary" id="st-load">${icons.refreshCw} Aktualisieren</button>`;
}

/* ── Tab 3: Fundamentaldaten (TV) ─────────────────────────────────────────── */

function kv(label, value, cls = '') {
  return `<div class="tv-kv"><span>${label}</span><strong class="${cls}">${value}</strong></div>`;
}

/* FMP-Zweitmeinung: ein mechanischer DCF aus fremder Hand. Der Mehrwert liegt
   nicht im absoluten Wert, sondern im Vergleich — deshalb wird FMPs Fair Value
   durch UNSERE Bisektion zurückgerechnet: welches Wachstum müsste gelten,
   damit unser Modell auf FMPs Zahl kommt? Erst dadurch stehen Markt, eigenes
   Modell und FMP auf derselben Skala statt Betrag gegen Prozent. */
function renderFmpRow(c, tv, disp, { standalone = false } = {}) {
  // Eigene Überschrift nur, wenn die Zeile allein steht — sonst gehört sie
  // sichtbar zum Reverse-DCF-Block darüber.
  const head = standalone ? `<h4 class="pv-subhead">Bewertung · FMP</h4>` : '';
  const f = c.fmp_valuation;
  if (c._fmp_loading) return head + `<p class="tb-hint">Lade FMP-Bewertung …</p>`;

  if (!f) {
    if (!isUsTicker(c)) return '';                       // stumm: FMP kann Nicht-US nicht
    return head + `<p class="tb-hint"><button class="btn btn-sm btn-secondary" id="fmp-load">${icons.scale} FMP-Zweitmeinung laden</button></p>`;
  }
  if (f.unsupported) return '';
  if (f.error) {
    // Originalmeldung mitzeigen: die gemappte Fassung allein hat schon einmal
    // in die falsche Richtung gewiesen.
    return head + `<p class="tb-hint is-warn">${fmpErrorText(f.error)}${f.symbol ? ` (${f.symbol})` : ''}
      ${f.detail ? `<br><span class="pv-muted">FMP: ${String(f.detail).replace(/[<>]/g, '')}</span>` : ''}
      <button class="btn btn-sm btn-secondary" id="fmp-load">${icons.refreshCw} Erneut</button></p>`;
  }

  const pct = (v, dec = 1) => (v == null ? '—' : `${fmtNum(v * 100, dec)} %`);
  const upCls = f.upside == null ? '' : f.upside >= 0 ? 'pos' : 'neg';
  const upTxt = f.upside == null ? '—'
    : `${f.upside >= 0 ? '+' : '−'}${fmtNum(Math.abs(f.upside) * 100, 0)} %`;

  // FMPs Wert je Aktie → Eigenkapitalwert, damit unsere Rechnung greifen kann.
  // Ohne TV-Daten entfällt nur der Vergleich, nicht die Zeile.
  const rd = tv ? reverseDcf(tv) : { error: 'no_data' };
  const fmpValue = (!rd.error && f.upside != null) ? rd.market_cap * (1 + f.upside) : null;
  const fmpGrowth = fmpValue == null ? null : impliedGrowthForValue(tv, fmpValue);

  return head + `
    <div class="tb-stats">
      ${trendStat('FMP Fair Value', f.dcf == null ? '—' : `${fmtNum(f.dcf)} ${disp.cur}`,
        f.date ? `Stand ${deDate(f.date)}` : 'mechanischer DCF')}
      ${trendStat('zum Kurs', upTxt, f.price == null ? '' : `Kurs ${fmtNum(f.price)}`, upCls)}
      ${trendStat('FMP-Rating', f.rating ?? '—',
        f.scores?.overall == null ? '' : `${f.scores.overall} von 5`)}
    </div>
    <p class="tb-hint">${fmpGrowth == null ? ''
      : `Auf unsere Skala gebracht: FMPs Wert entspräche <b>${fmtNum(fmpGrowth * 100, 1)} % Wachstum</b>,
         der Markt preist ${fmtNum(rd.implied_growth * 100, 1)} % ein.
         ${Math.abs(fmpGrowth - rd.implied_growth) > 0.05
           ? 'Die beiden Modelle sind sich deutlich uneinig — die Differenz steckt in FMPs Annahmen, nicht in den Zahlen.'
           : 'Beide Modelle liegen nah beieinander.'} `}
      FMPs DCF ist mechanisch und mit konservativen Standardannahmen gerechnet, kein Analysten-Fair-Value.
      <button class="btn btn-sm btn-secondary" id="fmp-load">${icons.refreshCw} Aktualisieren</button></p>`;
}

/* Szenario-Leiter: derselbe Rechenkern vorwärts. Eingeklappt, damit der
   Fund.-Tab nicht länger wird — wie die Ring-Legende im Trend-Tab.
   Der Balken ist bei ±150 % gekappt: die Spanne reicht real bis weit über
   +800 %, linear ungekappt wären alle unteren Zeilen unsichtbar. */
function renderLadderDetails(tv, disp) {
  const L = growthLadder(tv);
  if (L.error || !L.rows?.length) return '';   // Fehler meldet schon der Hauptblock

  const CAP = 1.5;
  const rows = L.rows.map((r) => {
    const dir = r.upside >= 0 ? 'pos' : 'neg';
    const w = (Math.min(Math.abs(r.upside), CAP) / CAP) * 50;
    const up = `${r.upside >= 0 ? '+' : '−'}${fmtNum(Math.abs(r.upside) * 100, 0)} %`;
    return `<div class="fm-row">
      <span class="fm-label">${fmtNum(r.growth * 100, 0)} %</span>
      <span class="fm-price">${r.fair_price == null ? '—' : fmtNum(r.fair_price)}</span>
      <span class="fm-bar fm-bar--signed"><i class="${dir}" style="${
        r.upside >= 0 ? 'left:50%' : 'right:50%'};width:${w.toFixed(1)}%"></i></span>
      <b class="fm-val ${dir}">${up}</b>
    </div>`;
  }).join('');

  // Erste Zeile mit nicht-negativem Auf-/Abschlag — dort kippt es.
  const cross = L.rows.find((r) => r.upside >= 0);

  return `<details class="tb-legend dcf-ladder">
    <summary>Szenarien: was wäre die Aktie wert?</summary>
    ${rows}
    <p class="tb-hint">Fairer Kurs in ${disp.cur}. ${cross
      ? `Ab rund ${fmtNum(cross.growth * 100, 0)} % Wachstum liegt der faire Kurs über dem aktuellen —
         die eingepreiste Rate von ${fmtNum(L.implied_growth * 100, 1)} % ist genau der Punkt, an dem er ihn trifft.`
      : `Selbst bei ${fmtNum(L.rows[L.rows.length - 1].growth * 100, 0)} % Wachstum bliebe der faire Kurs unter dem aktuellen.`}
      ${L.terminal_share == null ? '' : `<b>${fmtNum(L.terminal_share * 100, 0)} % des Werts stammen aus der ewigen Rente</b> —
      das Ergebnis hängt damit stärker am Diskontsatz (${fmtNum(L.rate * 100, 1)} %) und am ewigen Wachstum
      als an der Wachstumsannahme selbst.`}</p>
  </details>`;
}

/* ── Reverse-DCF: welches FCF-Wachstum preist der Markt ein? ─────────────────
   Kontextwert, kein Score — er fliesst in keine der TV-Kennzahlen ein. Die
   Annahmenzeile ist Pflicht, nicht Deko: die eingepreiste Rate reagiert
   deutlich auf den Diskontsatz (ERP 4 statt 6 % verschiebt sie um rund 4 pp),
   und ohne sichtbare Annahmen liest sich eine Rechnung wie eine Messung. */
function renderReverseDcfBlock(c, tv, disp) {
  const head = `<h4 class="pv-subhead">Eingepreistes Wachstum · Reverse-DCF</h4>`;
  const d = reverseDcf(tv);

  if (d.error === 'negative_fcf') {
    return head + `<p class="tb-hint">Der freie Cashflow ist negativ — ein Wachstumspfad
      darauf ergäbe jeden Barwert negativ. Für diesen Titel lässt sich nichts einpreisen.</p>`;
  }
  if (d.error) {
    return head + `<p class="tb-hint">Nicht berechenbar: es fehlen Marktkapitalisierung
      oder P/FCF aus den TV-Daten.</p>`;
  }

  const pct = (v, dec = 1) => (v == null ? '—' : `${fmtNum(v * 100, dec)} %`);
  const label = growthDemandLabel(d.implied_growth);
  // Liefert die Firma mehr, als der Kurs verlangt, ist die Lücke positiv gemeint.
  const gapCls = d.gap == null ? '' : d.gap <= 0 ? 'pos' : 'neg';
  const gapTxt = d.gap == null ? '—'
    : `${d.gap >= 0 ? '+' : '−'}${fmtNum(Math.abs(d.gap) * 100, 1)} pp`;

  const cur = nativeCur(c);
  const a = d.assumptions;

  return head + `
    <div class="tb-stats">
      ${trendStat('Eingepreist', pct(d.implied_growth),
        `p. a. · ${a.years} J · ${label?.text ?? ''}${d.bounded ? ' · ausserhalb der Skala' : ''}`,
        d.implied_growth > 0.20 ? 'neg' : d.implied_growth <= 0.05 ? 'pos' : '')}
      ${trendStat('Beobachtet', pct(d.observed_growth), 'FCF TTM y/y')}
      ${trendStat('Lücke', gapTxt,
        d.gap == null ? '' : d.gap <= 0 ? 'Firma liefert mehr' : 'Firma liefert weniger', gapCls)}
    </div>
    ${d.leverage_warn ? `<p class="tb-hint is-warn">Debt/Equity über 1,5: die Rechnung
      diskontiert den gesamten FCF mit Eigenkapitalkosten. Bei dieser Verschuldung
      fällt die eingepreiste Rate dadurch zu niedrig aus — als untere Grenze lesen.</p>` : ''}
    <p class="tb-hint">Annahmen: Diskontsatz ${pct(d.rate)} (β ${fmtNum(d.beta, 2)}${
      d.beta_raw != null && d.beta_raw !== d.beta ? ` · gedämpft von ${fmtNum(d.beta_raw, 2)}` : ''
    } · risikofrei ${pct(a.riskFree, 1)} · Risikoprämie ${pct(a.erp, 1)}) ·
      ewiges Wachstum ${pct(a.terminalGrowth, 1)} · FCF ${formatMarketCap(d.fcf)} ${cur}.
      Kein Score — steht neben den Kennzahlen, nicht in ihnen.</p>
    ${renderFmpRow(c, tv, disp)}
    ${renderLadderDetails(tv, disp)}`;
}

function renderFundamentalTab(c, disp) {
  const tv = disp?.tv ?? c.tv_data;
  if (!tv) {
    // Kennzahlen, Reverse-DCF und Szenarien brauchen die TV-Felder (Marktkap.,
    // P/FCF). Die FMP-Zeile nicht — die fragt FMP direkt per Symbol und bleibt
    // deshalb sichtbar, statt mit auszusteigen.
    return `<p class="pv-empty">Keine TV-Daten – „TV Daten" in der Tabelle laden.
      Kennzahlen, Reverse-DCF und Szenarien brauchen sie (Marktkapitalisierung + P/FCF).</p>`
      + renderFmpRow(c, null, disp, { standalone: true });
  }

  const hs = liveHealthScore(tv);
  const ratingClass = tvRatingClass(tv.rating);
  const fmtSigned = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;

  // Signierter Meter (Wachstum): Nulllinie in der Mitte, Balken nach rechts/links.
  const meter = (label, v, max = 50) => {
    if (v == null) return '';
    const w = (Math.min(Math.abs(v), max) / max) * 50;
    const dir = v >= 0 ? 'pos' : 'neg';
    return `<div class="fm-row">
      <span class="fm-label">${label}</span>
      <span class="fm-bar fm-bar--signed"><i class="${dir}" style="${v >= 0 ? `left:50%` : `right:50%`};width:${w.toFixed(1)}%"></i></span>
      <b class="fm-val ${dir}">${fmtSigned(v)}</b>
    </div>`;
  };
  // Absoluter Meter (Margen): 0 → max, Farbe nach Güte.
  const meterAbs = (label, v, { max = 50, good = 15 } = {}) => {
    if (v == null) return '';
    const cls = v < 0 ? 'neg' : v >= good ? 'pos' : 'mid';
    const w = (Math.min(Math.max(v, 0), max) / max) * 100;
    return `<div class="fm-row">
      <span class="fm-label">${label}</span>
      <span class="fm-bar"><i class="${cls}" style="left:0;width:${w.toFixed(1)}%"></i></span>
      <b class="fm-val ${cls}">${v.toFixed(1)}%</b>
    </div>`;
  };
  const stat = (v, label, cls = '') =>
    `<div class="fund-stat"><b class="${cls}">${v ?? '—'}</b><span>${label}</span></div>`;
  const band = (v, bands) => {           // [posMax, neutralMax, midMax] aufsteigend
    if (v == null) return '';
    return v < bands[0] ? 'pos' : v <= bands[1] ? '' : v <= bands[2] ? 'mid' : 'neg';
  };
  const roeCls = (v) => (v == null ? '' : v < 0 ? 'neg' : v >= 15 ? 'pos' : 'mid');

  const meters = (rows) => rows.filter(Boolean).join('');
  const growth = meters([
    meter('Umsatz YoY', tv.total_revenue_yoy_growth_ttm),
    meter('EBITDA YoY', tv.ebitda_yoy_growth_ttm),
    meter('FCF YoY', tv.free_cash_flow_yoy_growth_ttm, 100),
    meter('EPS YoY (dil.)', tv.earnings_per_share_diluted_yoy_growth_ttm, 100),
  ]);
  const margins = meters([
    meterAbs('Brutto-Marge', tv.gross_margin, { max: 80, good: 40 }),
    meterAbs('OP-Marge', tv.operating_margin, { max: 50, good: 15 }),
    meterAbs('Netto-Marge', tv.after_tax_margin, { max: 40, good: 10 }),
    meterAbs('FCF-Marge', tv.free_cash_flow_margin_ttm, { max: 40, good: 10 }),
  ]);

  return `
    <div class="fund-head">
      ${scoreRingSVG(hs?.total ?? null, hs?.labelCode ?? null)}
      <div class="fund-head__info">
        <div class="fund-head__title">Financial Health${hs?.label ? ` · <span class="fund-head__label">${hs.label}</span>` : ''}</div>
        <div class="fund-head__meta">
          <span class="tv-rating tv-rating--${ratingClass}">${tvRatingLabel(tv.rating)}${tv.rating != null ? ` (${tv.rating.toFixed(2)})` : ''}</span>
          ${tv.earnings_next_date ? `<span class="fund-earn" title="Nächste Earnings">📅 ${formatDate(new Date(tv.earnings_next_date * 1000).toISOString())}</span>` : ''}
        </div>
        <div class="fund-head__sub">MCap ${formatMarketCap(tv.market_cap)} · Beta ${tv.beta != null ? tv.beta.toFixed(2) : '—'} · Stand ${formatDate(tv.fetched_at) || '—'}</div>
      </div>
    </div>

    ${growth ? `<h4 class="pv-subhead">Wachstum YoY (TTM)</h4>${growth}` : ''}
    ${margins ? `<h4 class="pv-subhead">Profitabilität</h4>${margins}` : ''}

    <h4 class="pv-subhead">Bewertung &amp; Rendite</h4>
    <div class="fund-stats">
      ${stat(tv.pe_ttm != null ? tv.pe_ttm.toFixed(1) : null, 'KGV TTM', band(tv.pe_ttm, [15, 30, 50]))}
      ${stat(tv.enterprise_value_ebitda_ttm != null ? tv.enterprise_value_ebitda_ttm.toFixed(1) : null, 'EV/EBITDA', band(tv.enterprise_value_ebitda_ttm, [10, 18, 25]))}
      ${stat(tv.price_free_cash_flow_ttm != null ? tv.price_free_cash_flow_ttm.toFixed(1) : null, 'P/FCF', band(tv.price_free_cash_flow_ttm, [15, 30, 50]))}
      ${stat(tv.dividend_yield != null ? tv.dividend_yield.toFixed(2) + '%' : null, 'Dividende')}
      ${stat(tv.return_on_equity != null ? tv.return_on_equity.toFixed(1) + '%' : null, 'ROE', roeCls(tv.return_on_equity))}
      ${stat(tv.return_on_invested_capital != null ? tv.return_on_invested_capital.toFixed(1) + '%' : null, 'ROIC', roeCls(tv.return_on_invested_capital))}
      ${stat(ratioVal(tv.debt_to_equity), 'Debt/Eq', band(tv.debt_to_equity, [0.5, 1.5, 3]))}
      ${stat(ratioVal(tv.total_debt_to_ebitda_fy), 'Debt/EBITDA', band(tv.total_debt_to_ebitda_fy, [2, 4, 6]))}
    </div>

    ${renderReverseDcfBlock(c, tv, disp)}

    <h4 class="pv-subhead">Earnings Call</h4>
    ${transcriptHTML(c)}
  `;
}

/* Earnings-Call-Transcript (ROIC): Headline + Datum, Copy-Button kopiert
 * Analyse-Prompt + Volltext für den LLM. Manueller Abruf (Rate-Limit). */
function transcriptHTML(c) {
  if (c._transcript_loading) {
    return `<p class="id-profile--loading"><span class="ls-loading"></span> Lade Transcript (ROIC.ai) …</p>`;
  }
  const tr = c.company_transcript;
  if (!tr || tr.error) {
    return `<div class="news-empty">
      <button class="btn btn-sm btn-secondary" id="transcript-load">🎙 Letztes Transcript laden (ROIC)${tr?.error ? ' — erneut' : ''}</button>
      ${tr?.error && tr.message ? `<p class="pv-muted">Letzter Versuch: ${escProfile(tr.message)}</p>` : ''}
    </div>`;
  }
  const day = tr.date ? new Date(tr.date) : null;
  const dayStr = day && !Number.isNaN(+day)
    ? day.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : (tr.date ?? '');
  return `<div class="tr-call">
    <div class="tr-call__head"><b>${escProfile(tr.title)}</b>${dayStr ? ` <span class="pv-muted">· ${dayStr}</span>` : ''}</div>
    <div class="tr-call__actions">
      <button class="btn btn-sm btn-primary" id="transcript-copy">📋 Für LLM kopieren</button>
      <span class="pv-muted">${Math.round(tr.text.length / 1000)}k Zeichen · Prompt: CFO-Guidance, Q&amp;A, Ausweichmanöver</span>
    </div>
  </div>`;
}

/* ── Tab 4: Meta (Quellen + Merkliste-Mapping) ────────────────────────────── */

function renderSource(source, idx) {
  const rawJson = JSON.stringify(source.raw_signal ?? {}, null, 2);
  return `
    <details class="source-item" ${idx === 0 ? 'open' : ''}>
      <summary>
        <span class="source-adapter">${source.adapter}</span>
        <span class="source-signal">${source.signal_type}</span>
        <small>${formatDate(source.discovered_at)}</small>
      </summary>
      <div class="source-body">
        <p class="source-snippet">${source.info_snippet ?? ''}</p>
        <a href="${source.source_url}" target="_blank" rel="noopener">Quelle öffnen ↗</a>
        <details class="raw-signal">
          <summary>Raw Signal</summary>
          <pre>${rawJson}</pre>
        </details>
      </div>
    </details>
  `;
}

function renderMetaTab(c) {
  return `
    <h4 class="pv-subhead">Screener / Signal-Herkunft (${c.sources.length})</h4>
    <div class="sources-list">
      ${c.sources.map((s, i) => renderSource(s, i)).join('')}
    </div>
    <h4 class="pv-subhead">Merkliste-Mapping</h4>
    <div class="link-url-fields">
      <div class="link-url-row">
        <label>Merkliste-Symbol (Fallback)</label>
        <input type="text" id="lf-merkliste" value="${c.merkliste_symbol ?? ''}" placeholder="z. B. RHM oder RHM.DE">
      </div>
      <button class="btn btn-sm btn-secondary" id="detail-save-merkliste">Mapping speichern</button>
      <p class="detail-hint">Zusätzlicher Schlüssel, um diesen Kandidaten dem Merkliste-Portfolio zuzuordnen (Einstand &amp; P/L), falls Symbol/Yahoo-Symbol nicht matchen.</p>
    </div>
  `;
}

/* ── Enrichment (footer) ──────────────────────────────────────────────────── */

function renderEnrichment(enrichment) {
  if (!enrichment) return '';
  const confidenceColor = { high: '#2ecc71', medium: '#f39c12', low: '#e74c3c' }[enrichment.confidence] ?? '#999';
  const upsideProb = enrichment.upside_20pct_probability;
  const upsideColor = upsideProb == null ? '#999' : upsideProb >= 60 ? '#2ecc71' : upsideProb >= 30 ? '#f39c12' : '#e74c3c';
  return `
    <div class="enrichment-result">
      <div class="enrichment-meta">
        <span class="badge" style="background:#6c3483;color:#fff">${enrichment.model}</span>
        <span class="badge confidence" style="color:${confidenceColor}">
          ${enrichment.confidence} confidence
        </span>
        ${upsideProb != null ? `
        <span class="badge confidence" style="color:${upsideColor}" title="${enrichment.upside_reasoning ?? ''}">
          ${upsideProb}% Chance auf +20% (1M)
        </span>
        ` : ''}
        <small>${formatDate(enrichment.enriched_at)}</small>
      </div>
      <div class="enrichment-tags">
        ${enrichment.sector ? `<span class="tag">${enrichment.sector}</span>` : ''}
        ${enrichment.industry ? `<span class="tag">${enrichment.industry}</span>` : ''}
        ${enrichment.market_cap_bucket ? `<span class="tag">${enrichment.market_cap_bucket} cap</span>` : ''}
        ${enrichment.region ? `<span class="tag">${enrichment.region}</span>` : ''}
      </div>
      <div class="enrichment-thesis">
        <p><strong>These:</strong> ${enrichment.thesis_short ?? ''}</p>
        ${enrichment.thesis_long ? `<details><summary>Ausführliche These</summary><div class="thesis-long">${enrichment.thesis_long.replace(/\n/g, '<br>')}</div></details>` : ''}
        ${upsideProb != null && enrichment.upside_reasoning ? `<p><strong>Upside-Einschätzung:</strong> ${enrichment.upside_reasoning}</p>` : ''}
      </div>
      ${enrichment.risks?.length ? `
        <div class="enrichment-section">
          <strong>Risiken:</strong>
          <ul>${enrichment.risks.map((r) => `<li>${r}</li>`).join('')}</ul>
        </div>
      ` : ''}
      ${enrichment.catalysts?.length ? `
        <div class="enrichment-section">
          <strong>Katalysatoren:</strong>
          <ul>${enrichment.catalysts.map((c) => `<li>${c}</li>`).join('')}</ul>
        </div>
      ` : ''}
      ${enrichment.recent_news?.length ? `
        <div class="enrichment-section">
          <strong>Aktuelle News:</strong>
          <ul>${enrichment.recent_news.map((n) => `<li>${n}</li>`).join('')}</ul>
        </div>
      ` : ''}
      ${enrichment.sentiment ? `
        <div class="enrichment-section">
          <strong>Sentiment:</strong> <span class="tag">${enrichment.sentiment}</span>
        </div>
      ` : ''}
    </div>
  `;
}

/* ── Component ────────────────────────────────────────────────────────────── */

export class CandidateDetail {
  constructor(sheetEl, { onAction, onClose, getSiblings }) {
    this.el = sheetEl;
    this.onAction = onAction;
    this.onClose = onClose;
    this.getSiblings = getSiblings;   // () => ordered candidate list (current table sort)
    this.candidate = null;
    this.bucket = null;       // aktiver Blob (Watch-Label-Toggle nur im Watch-Bucket)
    this.activeTab = 'performance';
    this.altCurrency = false; // false = native currency, true = USD↔EUR switched
    this.tradeSide = 'long';  // Trade-Ticket side (Long | Short segmented control)
    this.chartHorizon = '10T'; // Performance chart: '10T' LS-Intraday | '1J' TD-Tageskerzen
    this.chartZoom = 'ALL';    // TD-Chart Zoom-Preset (1M/3M/6M/ALL)
    this.showInd = localStorage.getItem('discovery_chart_ind') === '1'; // BB/Supertrend/CCI
    this._chart = null;       // Lightweight Charts instance (destroyed on re-render)
    this.chartFs = false;     // Perf-Chart im Vollbild (LS wie TD)
    this._chartWrap = null;   // #chart-fs (auch wenn er gerade im <body> hängt)
    this._fsAnchor = null;    // Platzhalter, an den der Block zurückwandert
    this._fsKey = null;       // Escape-Handler des Vollbilds
  }

  destroyChart() {
    try { this._chart?.remove(); } catch { /* already gone */ }
    this._chart = null;
  }

  /* ── Chart-Vollbild ──────────────────────────────────────────────────────
   * Der Chart-Block wird nach `document.body` verschoben statt nur per CSS
   * aufgezogen: die Detail-Sheet trägt ein `transform`, damit wäre ein
   * `position:fixed`-Kind auf die Sheet-Breite (max. 480px) eingesperrt.
   * Verschieben erhält die bereits gebundenen Listener; Lightweight Charts
   * läuft mit `autoSize` und wächst per ResizeObserver von selbst mit.
   * Kein natives `requestFullscreen()` — iOS Safari kennt es für Nicht-Video
   * nicht, das CSS-Overlay funktioniert überall gleich. */
  setFsBtn(wrap, on) {
    const btn = wrap?.querySelector('#chart-fs-btn');
    if (!btn) return;
    const label = on ? 'Vollbild beenden' : 'Chart im Vollbild';
    btn.innerHTML = on ? icons.minimize : icons.maximize;
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }

  enterChartFs() {
    const wrap = this._chartWrap;
    if (!wrap || wrap.classList.contains('is-fs') || !wrap.parentNode) return;
    this._fsAnchor = document.createComment('chart-fs');
    wrap.parentNode.insertBefore(this._fsAnchor, wrap);
    document.body.appendChild(wrap);
    wrap.classList.add('is-fs');
    document.body.classList.add('has-chart-fs');
    this.setFsBtn(wrap, true);
    this.chartFs = true;
    // Escape schließt nur das Vollbild, nicht die Detail-Sheet darunter — außer
    // ein Modal liegt darüber (z. B. der Alert-Editor), das hat Vorrang.
    this._fsKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.modal-overlay')) return;
      e.preventDefault();
      e.stopPropagation();
      this.exitChartFs();
    };
    document.addEventListener('keydown', this._fsKey, true);
  }

  // `keepFlag` = das Vollbild soll den Re-Render überleben: der Block wandert
  // zurück in die (gleich ersetzte) Sheet, `chartFs` bleibt gesetzt, und
  // `render()` betritt das Vollbild danach mit dem neuen Block erneut.
  exitChartFs(keepFlag = false) {
    if (this._fsKey) { document.removeEventListener('keydown', this._fsKey, true); this._fsKey = null; }
    document.body.classList.remove('has-chart-fs');
    const wrap = this._chartWrap;
    if (wrap?.classList.contains('is-fs')) {
      wrap.classList.remove('is-fs');
      if (this._fsAnchor?.parentNode) this._fsAnchor.parentNode.insertBefore(wrap, this._fsAnchor);
      else wrap.remove();
      this.setFsBtn(wrap, false);
    }
    this._fsAnchor?.remove();
    this._fsAnchor = null;
    if (!keepFlag) this.chartFs = false;
  }

  // Interactive 10-day LS chart (Lightweight Charts): area price series from
  // the per-day intraday snapshots, volume histogram with Ø10d/Ø30d reference
  // lines, and price lines for Sup/Res clusters + target. Display currency.
  initLsChart(c, disp, pc, tl) {
    const el = this.el.querySelector('#ls-chart');
    if (!el || !window.LightweightCharts) return;
    const lsF = lsDisplayFactor(disp);
    if (lsF == null) return;
    // Historie darf leer sein — die Live-Intraday-Serie allein trägt den Chart.
    // Dedupe nach Datum, damit doppelte Snapshot-Tage nicht doppelt gezeichnet
    // werden; bei Duplikaten gewinnt der Eintrag mit Intraday-Serie (reicher).
    const hasSeries = (s) => Array.isArray(s?.series) && s.series.length > 1;
    const byDate = new Map();
    for (const s of (Array.isArray(c.ls_history) ? c.ls_history : [])) {
      if (!s?.date) continue;
      const prev = byDate.get(s.date);
      if (!prev || hasSeries(s) || !hasSeries(prev)) byDate.set(s.date, s);
    }
    const hist = [...byDate.values()];

    const css = getComputedStyle(document.documentElement);
    const col = (n) => css.getPropertyValue(n).trim();
    const chart = window.LightweightCharts.createChart(el, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: col('--muted'), fontSize: 11 },
      grid: { vertLines: { color: col('--surface-3') }, horzLines: { color: col('--surface-3') } },
      rightPriceScale: { borderColor: col('--border') },
      timeScale: { borderColor: col('--border'), timeVisible: false },
      crosshair: { mode: 0 },
    });

    const area = chart.addAreaSeries({
      lineColor: col('--accent'), lineWidth: 2,
      topColor: `${col('--accent')}33`, bottomColor: `${col('--accent')}05`,
      priceLineVisible: true, lastValueVisible: true,
    });
    // Today's LIVE intraday series (ls_quote.series, EUR) is appended as the
    // freshest segment. If the nightly snapshot already captured today, the
    // live series supersedes it (skip that history day below).
    const q = c.ls_quote;
    const liveSeries = Array.isArray(q?.series) && q.series.length > 1 ? q.series : null;
    const liveDay = liveSeries ? String(q.checked_at ?? '').slice(0, 10) : null;
    const spread = (base, arr, j) => base + 8 * 3600 + (arr.length > 1 ? j / (arr.length - 1) : 0) * 14 * 3600;

    const points = [];
    for (const s of hist) {
      const base = Date.parse(s.date) / 1000;
      if (!Number.isFinite(base)) continue;
      // Live-Serie ist für ihren Tag (und alles danach) maßgeblich — Snapshots
      // desselben Tages würden sonst doppelt über die Live-Kurve gezeichnet.
      if (liveDay && s.date >= liveDay) continue;
      const ser = Array.isArray(s.series) && s.series.length > 1 ? s.series : [s.close];
      ser.forEach((v, j, arr) => { if (v != null) points.push({ time: spread(base, arr, j), value: v * lsF }); });
    }
    if (liveSeries && Number.isFinite(Date.parse(liveDay))) {
      const base = Date.parse(liveDay) / 1000;
      liveSeries.forEach((v, j, arr) => { if (v != null) points.push({ time: spread(base, arr, j), value: v * lsF }); });
    }
    // Lightweight Charts needs strictly-ascending unique times; sort + dedupe.
    points.sort((a, b) => a.time - b.time);
    const clean = [];
    for (const p of points) if (!clean.length || p.time > clean[clean.length - 1].time) clean.push(p);

    // Defensive: unparsable dates would leave an empty chart — SVG fallback.
    // Ohne interaktiven Chart ergibt auch das Vollbild keinen Sinn.
    if (clean.length < 2) {
      chart.remove();
      el.closest('.chart-fs')?.querySelector('#chart-fs-btn')?.remove();
      el.outerHTML = ls10dChartHTML(c, disp);
      return;
    }
    area.setData(clean);

    const vol = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    vol.setData(hist.filter((s) => Number.isFinite(Date.parse(s.date))).map((s) => ({
      time: Date.parse(s.date) / 1000 + 15 * 3600,
      value: s.volume ?? 0,
      color: (s.change_pct ?? 0) >= 0 ? `${col('--pos')}77` : `${col('--neg')}77`,
    })));
    const v10 = c.tv_data?.avg_vol_10d, v30 = c.tv_data?.average_volume_30d_calc;
    if (v10 > 0) vol.createPriceLine({ price: v10, color: col('--muted'), lineWidth: 1, lineStyle: 2, title: 'Ø10d' });
    if (v30 > 0) vol.createPriceLine({ price: v30, color: col('--muted'), lineWidth: 1, lineStyle: 3, title: 'Ø30d' });

    // S/R clusters + target as price lines (all already in display currency).
    const line = (price, color, title, style = 0, width = 2) => {
      if (price != null) area.createPriceLine({ price, color, lineWidth: width, lineStyle: style, title });
    };
    if (pc?.nearestSup) line(pc.nearestSup.mid, col('--pos'), `Sup ${pc.nearestSup.score}`);
    if (pc?.nearestRes) line(pc.nearestRes.mid, col('--neg'), `Res ${pc.nearestRes.score}`);
    if (tl?.target != null) line(tl.target, col('--pos'), 'Target', 2, 1);
    if (tl?.stopL != null) line(tl.stopL, col('--neg'), 'Stop', 2, 1);

    // Portfolio-Einstand (Merkliste, EUR → Anzeige) — violett, klar getrennt
    // von Sup/Res (grün/rot) und den SMAs (blau).
    const mkE = mkEntryDisp(c, disp);
    const mkCol = document.documentElement.dataset.theme === 'dark' ? '#c084fc' : '#9333ea';
    if (mkE != null) line(mkE, mkCol, '★ Einstand', 0, 2);

    // SMA 20/50/200 (TV daily values, already display currency via disp.tv) —
    // dark-blue ink, told apart by dash pattern: 200 solid, 50 dashed, 20
    // dotted. True blue-900 ink vanishes on the dark theme → lighter ink there.
    const smaCol = document.documentElement.dataset.theme === 'dark' ? '#6b8afd' : '#1e40af';
    const smaTv = disp?.tv ?? {};
    line(smaTv.sma200, smaCol, 'SMA200', 0, 1);
    line(smaTv.sma50, smaCol, 'SMA50', 2, 1);
    line(smaTv.sma20, smaCol, 'SMA20', 1, 1);

    // Auto-trendlines from the LS swing points (diagonal, dashed — distinct from
    // the horizontal SMA/cluster lines). Support green, resistance red.
    const trend = (data, color) => {
      if (!data) return;
      const s = chart.addLineSeries({ color, lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
      s.setData(data);
    };
    trend(autoTrendline(hist, 'day_low', lsF), col('--pos'));
    trend(autoTrendline(hist, 'day_high', lsF), col('--neg'));

    this.wireChartLevelReadout(el, area, disp);
    chart.timeScale().fitContent();
    this._chart = chart;
  }

  // Move over the chart → live-update the price readout in the "Level" bar
  // below it (no tap in the chart opens anything, so pan/zoom stays free). The
  // ＋-button in that bar opens the Trigger editor with the shown level.
  // `series.coordinateToPrice(y)` maps the container-relative y to a price; the
  // chart runs in display currency → divide by the EUR→display factor for EUR.
  wireChartLevelReadout(el, series, disp) {
    const lsF = lsDisplayFactor(disp);
    if (!el || lsF == null) return;
    const priceEl = this.el.querySelector('#chart-level-price');
    const addBtn = this.el.querySelector('#chart-level-add');
    const sym = disp.cur === 'EUR' ? '€' : disp.cur === 'USD' ? '$' : disp.cur;
    const setLevel = (dispPrice) => {
      if (dispPrice == null || !Number.isFinite(dispPrice) || dispPrice <= 0) return;
      this._chartLevelEur = +(dispPrice / lsF).toFixed(4);
      if (priceEl) priceEl.textContent = `${fmtNum(dispPrice, 2)} ${sym}`;
      if (addBtn) addBtn.disabled = false;
    };
    // Seed with the live price so the bar is meaningful before any move.
    const seedEur = this.candidate?.ls_quote?.price ?? null;
    if (seedEur != null) setLevel(seedEur * lsF);
    else { const close = disp.tv?.close_1m ?? disp.tv?.close; if (close != null) setLevel(close); }

    el.addEventListener('pointermove', (e) => {
      const rect = el.getBoundingClientRect();
      let d; try { d = series.coordinateToPrice(e.clientY - rect.top); } catch { return; }
      setLevel(d);
    }, true);
    addBtn?.addEventListener('pointerup', () => {
      if (this._chartLevelEur != null) this.onAction?.('chartAlert', this.candidate, { priceEur: this._chartLevelEur });
    });
  }

  // Dispatch the Performance chart to LS-intraday (10T) or TD daily candles (1J)
  // per the resolved horizon.
  initChart(c, disp, pc, tl) {
    const { active } = resolveChartHorizon(c, disp, this.chartHorizon);
    if (active === '1J') this.initTdChart(c, disp);
    else if (active === '10T') this.initLsChart(c, disp, pc, tl);
  }

  // 1-year TwelveData daily candlestick chart, converted to the display currency
  // (USD native → ×1 / ÷fx), with volume, the swing support/resistance zones as
  // price lines, the TV SMAs, and the live LS price as a marker line.
  initTdChart(c, disp) {
    const el = this.el.querySelector('#ls-chart');
    const a = c.swing_analysis;
    const f = barsDisplayFactor(disp, a);
    if (!el || !window.LightweightCharts || !Array.isArray(a?.ohlc) || a.ohlc.length < 2 || f == null) return;

    const css = getComputedStyle(document.documentElement);
    const col = (n) => css.getPropertyValue(n).trim();
    const chart = window.LightweightCharts.createChart(el, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: col('--muted'), fontSize: 11 },
      grid: { vertLines: { color: col('--surface-3') }, horzLines: { color: col('--surface-3') } },
      rightPriceScale: { borderColor: col('--border') },
      timeScale: { borderColor: col('--border'), timeVisible: false },
      crosshair: { mode: 0 },
    });

    // Candles need strictly-ascending unique daily times ('YYYY-MM-DD').
    const seen = new Set();
    const candles = [];
    const bars = [];   // Roh-Bars parallel zu candles (für Indikator-Berechnung)
    for (const b of a.ohlc) {
      if (!b.date || seen.has(b.date) || b.o == null || b.h == null || b.l == null || b.c == null) continue;
      seen.add(b.date);
      candles.push({ time: b.date, open: b.o * f, high: b.h * f, low: b.l * f, close: b.c * f });
      bars.push(b);
    }
    if (candles.length < 2) { chart.remove(); return; }
    const candle = chart.addCandlestickSeries({
      upColor: col('--pos'), downColor: col('--neg'), borderVisible: false,
      wickUpColor: col('--pos'), wickDownColor: col('--neg'),
    });
    candle.setData(candles);

    const vol = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    vol.setData(a.ohlc.filter((b) => b.date && seen.has(b.date)).map((b) => ({
      time: b.date, value: b.v ?? 0,
      color: (b.c ?? 0) >= (b.o ?? 0) ? `${col('--pos')}77` : `${col('--neg')}77`,
    })));

    // Swing zones (USD → display) as price lines; opacity by touches is not
    // available on price lines, so width marks the stronger (more-tested) zones.
    const zoneLine = (z, color) => candle.createPriceLine({
      price: z.mid * f, color, lineWidth: z.touches >= 3 ? 2 : 1, lineStyle: 0,
      title: `${color === col('--pos') ? 'S' : 'R'} ${z.touches}×`,
    });
    (a.support ?? []).forEach((z) => zoneLine(z, col('--pos')));
    (a.resistance ?? []).forEach((z) => zoneLine(z, col('--neg')));

    // TV SMAs (already display currency via disp.tv).
    const smaCol = document.documentElement.dataset.theme === 'dark' ? '#6b8afd' : '#1e40af';
    const smaTv = disp?.tv ?? {};
    const sma = (price, title, style) => { if (price != null) candle.createPriceLine({ price, color: smaCol, lineWidth: 1, lineStyle: style, title }); };
    sma(smaTv.sma200, 'SMA200', 0); sma(smaTv.sma50, 'SMA50', 2); sma(smaTv.sma20, 'SMA20', 1);

    // Live LS price (EUR → display) as a distinct marker line.
    const lsF = lsDisplayFactor(disp);
    if (c.ls_quote?.price != null && lsF != null) {
      candle.createPriceLine({ price: c.ls_quote.price * lsF, color: col('--accent'), lineWidth: 2, lineStyle: 0, title: 'LS live' });
    }

    // Portfolio-Einstand (Merkliste) — violett wie im LS-Chart.
    const mkE = mkEntryDisp(c, disp);
    if (mkE != null) {
      const mkCol = document.documentElement.dataset.theme === 'dark' ? '#c084fc' : '#9333ea';
      candle.createPriceLine({ price: mkE, color: mkCol, lineWidth: 2, lineStyle: 0, title: '★ Einstand' });
    }

    // Optionale Indikatoren (ƒ Ind.-Toggle): Bollinger + Supertrend als Overlays,
    // CCI 20 auf eigener unterer Skala. Whitespace-Punkte ({time}) für Warmup.
    if (this.showInd && bars.length >= 21) {
      const ws = (b) => ({ time: b.date });
      const lineSeries = (opts) => chart.addLineSeries({
        lineWidth: 1, lastValueVisible: false, priceLineVisible: false,
        crosshairMarkerVisible: false, ...opts,
      });
      const bb = bollinger(bars);
      const bbCol = document.documentElement.dataset.theme === 'dark' ? '#94a3b8' : '#64748b';
      const bbData = (k) => bars.map((b, i) => (bb[i] ? { time: b.date, value: bb[i][k] * f } : ws(b)));
      lineSeries({ color: bbCol, lineStyle: 2, title: 'BB↑' }).setData(bbData('upper'));
      lineSeries({ color: bbCol, lineStyle: 1 }).setData(bbData('mid'));
      lineSeries({ color: bbCol, lineStyle: 2, title: 'BB↓' }).setData(bbData('lower'));

      const st = supertrend(bars);
      const stData = (up) => bars.map((b, i) => (st[i] && st[i].up === up ? { time: b.date, value: st[i].value * f } : ws(b)));
      lineSeries({ color: col('--pos'), lineWidth: 2, title: 'ST' }).setData(stData(true));
      lineSeries({ color: col('--neg'), lineWidth: 2 }).setData(stData(false));

      const cciVals = cci(bars);
      const cciSeries = lineSeries({ color: '#a855f7', priceScaleId: 'cci', title: 'CCI20' });
      chart.priceScale('cci').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
      cciSeries.setData(bars.map((b, i) => (cciVals[i] != null ? { time: b.date, value: cciVals[i] } : ws(b))));
      cciSeries.createPriceLine({ price: 100, color: '#a855f766', lineWidth: 1, lineStyle: 2, title: '' });
      cciSeries.createPriceLine({ price: -100, color: '#a855f766', lineWidth: 1, lineStyle: 2, title: '' });
    }

    this.wireChartLevelReadout(el, candle, disp);

    // Zoom-Presets unter dem Chart (1M/3M/6M/ALL, Handelstage). Gesucht wird ab
    // dem Chart-Block, nicht ab der Sheet — im Vollbild hängt er im <body>.
    const root = el.closest('.chart-fs') ?? this.el;
    const applyZoom = (z) => {
      this.chartZoom = z;
      const ts = chart.timeScale();
      const days = { '1M': 22, '3M': 66, '6M': 132 }[z];
      if (!days || candles.length <= days) ts.fitContent();
      else ts.setVisibleRange({ from: candles[candles.length - days].time, to: candles[candles.length - 1].time });
      root.querySelectorAll('.chart-zoom [data-zoom]').forEach((b) =>
        b.classList.toggle('active', b.dataset.zoom === z));
    };
    root.querySelectorAll('.chart-zoom [data-zoom]').forEach((btn) =>
      btn.addEventListener('pointerup', () => applyZoom(btn.dataset.zoom)));
    root.querySelector('#chart-ind')?.addEventListener('pointerup', () => {
      this.showInd = !this.showInd;
      try { localStorage.setItem('discovery_chart_ind', this.showInd ? '1' : '0'); } catch { /* ignore */ }
      this.render();
    });

    chart.timeScale().fitContent();
    if (this.chartZoom && this.chartZoom !== 'ALL') applyZoom(this.chartZoom);
    this._chart = chart;
  }

  // Display-currency context for the current candidate: converted tv_data,
  // active currency code and the EUR/USD rate (USD per 1 EUR).
  displayInfo(c) {
    const nat = nativeCur(c);
    const fx = resolveFx();
    const canSwitch = (nat === 'USD' || nat === 'EUR') && fx != null;
    const cur = this.altCurrency && canSwitch ? (nat === 'USD' ? 'EUR' : 'USD') : nat;
    const factor = cur === nat ? 1 : (nat === 'USD' ? 1 / fx : fx);
    return { tv: convertTv(c.tv_data, factor), cur, factor, fx, canSwitch };
  }

  // Step to the prev/next candidate in the current sort order (swipe / arrows).
  navigate(dir) {
    const list = this.getSiblings?.() ?? [];
    if (list.length < 2 || !this.candidate) return;
    const i = list.findIndex((c) => c.id === this.candidate.id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    this.show(list[j]);
    this.el.scrollTop = 0;
  }

  show(candidate) {
    if (this.candidate?.id !== candidate.id) {
      this.activeTab = 'performance'; // Tab 1 onload
      this.chartHorizon = '10T';      // reset chart horizon per candidate
      this.exitChartFs();             // Vollbild nicht auf den nächsten Ticker mitnehmen
    }
    this.candidate = candidate;
    this.render();
  }

  hide() {
    this.exitChartFs();
    this.destroyChart();
    this.candidate = null;
    this.onClose?.();
  }

  setTab(tab) {
    this.activeTab = tab;
    this.el.querySelectorAll('.detail-tabs .tab-btn').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    this.el.querySelectorAll('.detail-tabpanes > .tab-panel').forEach((p) => {
      p.classList.toggle('active', p.dataset.panel === tab);
    });
  }

  render() {
    if (!this.candidate) return;
    const c = this.candidate;

    this.exitChartFs(true);   // Block zurückholen, Flag behalten (s. u.)
    this.destroyChart();
    const disp = this.displayInfo(c);
    const pc = priceClustersDisp(c, disp);
    const tl = tradeLevels(c, disp);
    const tabPanels = {
      performance: renderPerformanceTab(c, disp, pc, tl, this.chartHorizon, { zoom: this.chartZoom, showInd: this.showInd }),
      trend:       renderTrendTab(c),
      trade:       renderTradeTab(c, disp, pc, tl, this.tradeSide),
      fundamental: renderFundamentalTab(c, disp),
      news:        renderNewsTab(c),
      meta:        renderMetaTab(c),
    };

    this.el.innerHTML = `
      <div class="sheet__header">
        <div class="detail-title">
          <h2>${c.symbol}
            ${c.mk_entry != null
              ? `<span class="detail-star is-active" title="Im Portfolio (Merkliste) · Einstand ${fmtNum(c.mk_entry)} €${c.mk_shares ? ` · ${c.mk_shares} Stk` : ''}">${icons.starFilled}</span>`
              : `<button class="detail-star${c.in_portfolio ? ' is-active' : ''}" id="detail-star" title="${c.in_portfolio ? 'Portfolio-Marker entfernen' : 'Als Portfolio-Ticker markieren'}">${c.in_portfolio ? icons.starFilled : icons.starEmpty}</button>`}
            <span class="exchange-tag">${c.exchange}</span></h2>
          <p class="detail-name">${c.tv_data?.description ?? c.name}</p>
          ${c.isin ? `<small class="isin isin--copy" id="detail-isin" role="button" tabindex="0" title="ISIN kopieren">ISIN: ${c.isin} ${icons.clipboard}</small>` : ''}
          <div class="detail-tags">
            ${(() => {
              const cl = classifyCluster(c.tv_data);
              return cl
                ? `<span class="cluster-badge cluster-badge--${cl.key}" title="Trade-Cluster: ATRP ${fmtNum(c.tv_data?.atrp, 1)}% · MCap ${formatMarketCap(c.tv_data?.market_cap)} · ATR-Mult ${cl.atrMult} · Gewinnziel +${cl.gainPct}% · Vol-Basis ØV${cl.volBasis}">${cl.label}</span>`
                : `<span class="tag tag--ph" title="Trade-Cluster braucht TV-Daten (ATRP/MCap)">Cluster</span>`;
            })()}
            ${c.sector ? `<span class="tag">${c.sector}</span>` : ''}
            ${c.sub_sector ? `<span class="tag">${c.sub_sector}</span>` : ''}
          </div>
        </div>
        <div class="detail-header-right">
          <div class="detail-score-stack">
            ${(() => { const ov = liveOverallScore(c.tv_data); return scoreRingSVG(ov?.total ?? null, ov?.labelCode ?? null); })()}
            ${this.bucket === 'watch'
              ? `<button class="detail-watch${c.watch_flag ? ' is-active' : ''}" id="detail-watch"
                  aria-pressed="${c.watch_flag ? 'true' : 'false'}"
                  title="${c.watch_flag ? 'Watch-Label entfernen' : 'Als aktiv beobachtet markieren'}">
                  ${icons.eye}<span class="detail-watch__lbl">Watch</span></button>`
              : ''}
          </div>
          <button class="icon-btn" id="detail-close" aria-label="Schließen">${icons.xMark}</button>
        </div>
      </div>

      ${(() => {
        const list = this.getSiblings?.() ?? [];
        const idx = list.findIndex((x) => x.id === c.id);
        if (list.length < 2 || idx < 0) return '';
        return `<div class="detail-nav">
          <button class="detail-nav__btn" id="detail-prev" ${idx <= 0 ? 'disabled' : ''} aria-label="Vorheriger Kandidat">${icons.chevronLeft} Zurück</button>
          <span class="detail-nav__pos">${idx + 1} / ${list.length}</span>
          <button class="detail-nav__btn" id="detail-next" ${idx >= list.length - 1 ? 'disabled' : ''} aria-label="Nächster Kandidat">Weiter ${icons.chevronRight}</button>
        </div>`;
      })()}

      <div class="detail-state">
        ${c.workspace_state !== 'promoted' && c.workspace_state !== 'imported'
          ? `<button class="btn btn-sm btn-success" id="detail-promote">${icons.check} <span class="btn__label">Promoten</span></button>`
          : ''}
        ${c.workspace_state !== 'dismissed'
          ? `<button class="btn btn-sm btn-danger" id="detail-dismiss">${icons.xMark} <span class="btn__label">Ablehnen</span></button>`
          : ''}
        <button class="btn btn-sm btn-secondary" id="detail-export">${icons.download} <span class="btn__label">Export</span></button>
      </div>

      <div class="detail-sticky">
        ${renderToolbar(c)}

        <div class="tab-bar detail-tabs" role="tablist">
          ${TABS.map(({ key, label }) =>
            `<button class="tab-btn${this.activeTab === key ? ' active' : ''}" data-tab="${key}"
              role="tab" aria-selected="${this.activeTab === key}">${label}</button>`).join('')}
        </div>
      </div>
      <div class="detail-tabpanes">
        ${TABS.map(({ key }) =>
          `<div class="tab-panel${this.activeTab === key ? ' active' : ''}" data-panel="${key}" role="tabpanel">${tabPanels[key]}</div>`).join('')}
      </div>

      <div class="detail-section">
        <h3>Notizen</h3>
        <textarea id="detail-notes" class="notes-editor" placeholder="Notizen…" rows="3">${c.notes ?? ''}</textarea>
        <button class="btn btn-sm btn-secondary" id="detail-save-notes">Speichern</button>
      </div>

      <div class="detail-section" id="enrichment-section">
        <h3>AI-Enrichment</h3>
        ${c.enrichment
          ? renderEnrichment(c.enrichment)
          : `<p class="no-enrichment">Noch kein Enrichment vorhanden.</p>`
        }
        <button class="btn btn-sm btn-ai" id="detail-enrich">
          ${icons.sparkles} ${c.enrichment ? 'Neu enrichen' : 'AI-Enrichment ausführen'}
        </button>
        <div id="enrich-status" class="enrich-status" style="display:none"></div>
      </div>
    `;

    this.el.querySelector('#detail-close').addEventListener('pointerup', () => this.hide());

    const isinEl = this.el.querySelector('#detail-isin');
    if (isinEl) {
      const copyIsin = () => {
        if (!c.isin) return;
        navigator.clipboard?.writeText(c.isin).catch(() => {});
        this.onAction?.('isinCopied', c, { value: c.isin });
      };
      isinEl.addEventListener('pointerup', copyIsin);
      isinEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copyIsin(); } });
    }

    this.el.querySelector('#detail-promote')?.addEventListener('pointerup', () => {
      this.onAction?.('promote', c);
      c.workspace_state = 'promoted';
      this.render();
    });

    this.el.querySelector('#detail-dismiss')?.addEventListener('pointerup', () => {
      this.onAction?.('dismiss', c);
      c.workspace_state = 'dismissed';
      this.render();
    });

    this.el.querySelector('#detail-export')?.addEventListener('pointerup', () => {
      this.onAction?.('export', c);
    });

    this.el.querySelector('#detail-prev')?.addEventListener('pointerup', () => this.navigate(-1));
    this.el.querySelector('#detail-next')?.addEventListener('pointerup', () => this.navigate(1));

    // Tabs — News-Tab lädt beim ersten Öffnen automatisch (einmal pro Cache-TTL).
    this.el.querySelectorAll('.detail-tabs .tab-btn').forEach((btn) => {
      btn.addEventListener('pointerup', () => {
        this.setTab(btn.dataset.tab);
        if (btn.dataset.tab === 'news' && !c.company_news && !c._news_loading) {
          this.onAction?.('loadNews', c);
        }
      });
    });
    // News: manuelles Laden / Aktualisieren (data-force umgeht den Cache).
    this.el.querySelector('#news-load')?.addEventListener('pointerup', (e) => {
      this.onAction?.('loadNews', c, { force: e.currentTarget.dataset.force === '1' });
    });

    // Trade-Ticket: Long | Short segmented control
    this.el.querySelectorAll('.ticket__seg .tab-btn').forEach((btn) => {
      btn.addEventListener('pointerup', () => {
        if (this.tradeSide === btn.dataset.side) return;
        this.tradeSide = btn.dataset.side;
        this.render();
      });
    });

    // Interactive price chart — LS-intraday (10T) or TD candles (1J) per horizon.
    this.initChart(c, disp, pc, tl);

    // Vollbild-Umschalter (das Betreten selbst passiert am Ende von `render()`,
    // wenn alle Listener im Block hängen — danach verlässt er `this.el`).
    this._chartWrap = this.el.querySelector('#chart-fs');
    this._chartWrap?.querySelector('#chart-fs-btn')?.addEventListener('pointerup', () => {
      if (this.chartFs) this.exitChartFs(); else this.enterChartFs();
    });

    // Performance chart horizon toggle (10T LS ⟷ 1J TD candles). Picking 1J
    // when the candles aren't fetched yet runs the Swing-Check on demand.
    const tdLoaded = () => Array.isArray(c.swing_analysis?.ohlc) && c.swing_analysis.ohlc.length >= 2;
    const pick1J = () => { this.chartHorizon = '1J'; if (tdLoaded()) this.render(); else this.onAction?.('tdQuote', c); };
    this.el.querySelectorAll('.chart-horizon [data-horizon]').forEach((btn) => {
      btn.addEventListener('pointerup', () => {
        const h = btn.dataset.horizon;
        if (h === '1J') { pick1J(); return; }
        if (this.chartHorizon === h) return;
        this.chartHorizon = h;
        this.render();
      });
    });
    this.el.querySelector('#td-load')?.addEventListener('pointerup', pick1J);
    // Gleicher Abruf aus dem Trend-Tab: swing_analysis wird persistiert, ein
    // Fetch versorgt also beide Tabs. Hier NICHT über pick1J, damit der
    // Perf-Chart nicht ungefragt auf 1J umschaltet.
    this.el.querySelector('#tb-load')?.addEventListener('pointerup', () => {
      this.onAction?.('tdQuote', c);
    });

    // Retail-Stimmung (StockTwits) — on demand, damit kein Sheet-Aufruf
    // ungefragt eine Proxy-Runde auslöst.
    this.el.querySelector('#st-load')?.addEventListener('pointerup', () => {
      this.onAction?.('stSentiment', c);
    });

    // FMP-Zweitmeinung (nur US-Titel, 250 Anfragen/Tag) — ebenfalls on demand.
    this.el.querySelector('#fmp-load')?.addEventListener('pointerup', () => {
      this.onAction?.('fmpValuation', c);
    });

    // Earnings-Call-Transcript: Laden + LLM-Copy (Prompt + Volltext).
    this.el.querySelector('#transcript-load')?.addEventListener('pointerup', () => this.onAction?.('loadTranscript', c));
    this.el.querySelector('#transcript-copy')?.addEventListener('pointerup', async (e) => {
      const btn = e.currentTarget;
      const text = transcriptLlmText(c, c.company_transcript);
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fallback */ }
      if (!ok) {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        ok = document.execCommand('copy'); ta.remove();
      }
      btn.textContent = ok ? '✓ kopiert' : '✗ Kopieren fehlgeschlagen';
      setTimeout(() => { btn.textContent = '📋 Für LLM kopieren'; }, 2000);
    });

    // Portfolio-Stern (nur manueller Marker ist toggelbar; Merkliste-Match ist fix).
    this.el.querySelector('#detail-star')?.addEventListener('pointerup', () => this.onAction?.('toggleStar', c));

    // Watch-Label (nur Watch-Bucket): aktiv beobachtete Ticker markieren.
    this.el.querySelector('#detail-watch')?.addEventListener('pointerup', () => this.onAction?.('toggleWatch', c));

    // Firmenprofil: manueller Abruf per Button (app.js cached in localStorage),
    // danach "mehr/weniger"-Toggle; Toggle verschwindet wenn nichts geklemmt ist.
    this.el.querySelector('#profile-load')?.addEventListener('pointerup', () => this.onAction?.('loadProfile', c));
    const pText = this.el.querySelector('#profile-text');
    if (pText) {
      const moreBtn = this.el.querySelector('#profile-more');
      if (pText.scrollHeight <= pText.clientHeight + 2) moreBtn.style.display = 'none';
      moreBtn?.addEventListener('pointerup', () => {
        const open = pText.classList.toggle('is-open');
        moreBtn.textContent = open ? 'weniger' : 'mehr';
      });
    }

    // Toolbar: edit-toggle + quick actions
    const editBtn = this.el.querySelector('#detail-edit-links');
    editBtn.addEventListener('pointerup', () => {
      const panel = this.el.querySelector('#detail-links-edit');
      panel.hidden = !panel.hidden;
      editBtn.classList.toggle('is-active', !panel.hidden);
    });
    // Currency toggle(s) — one per price-bearing tab (Performance hero, Trade head).
    this.el.querySelectorAll('.cur-toggle').forEach((btn) => {
      btn.addEventListener('pointerup', () => {
        if (!this.displayInfo(c).canSwitch) return;
        this.altCurrency = !this.altCurrency;
        this.render();
      });
    });
    this.el.querySelector('#detail-trigger').addEventListener('pointerup', () => {
      this.onAction?.('openTrigger', c);
    });
    this.el.querySelector('#detail-ls').addEventListener('pointerup', () => {
      this.onAction?.('lsQuote', c);
    });
    this.el.querySelector('#detail-td').addEventListener('pointerup', () => {
      this.onAction?.('tdQuote', c);
    });

    this.el.querySelector('#detail-save-links').addEventListener('pointerup', () => {
      const newLinks = {
        tradingview: this.el.querySelector('#lf-tv').value.trim(),
        stocktwits:  this.el.querySelector('#lf-st').value.trim(),
        yahoo:       this.el.querySelector('#lf-yahoo').value.trim(),
      };
      c.links = newLinks;
      this.onAction?.('saveLinks', c, { links: newLinks });
      this.render();
    });

    this.el.querySelector('#detail-save-notes').addEventListener('pointerup', () => {
      const notes = this.el.querySelector('#detail-notes').value;
      c.notes = notes;
      this.onAction?.('saveNotes', c, { notes });
    });

    this.el.querySelector('#detail-save-merkliste')?.addEventListener('pointerup', () => {
      const value = this.el.querySelector('#lf-merkliste').value.trim() || null;
      c.merkliste_symbol = value;
      this.onAction?.('saveMerklisteSymbol', c, { value });
    });

    this.el.querySelector('#detail-enrich').addEventListener('pointerup', async () => {
      const btn = this.el.querySelector('#detail-enrich');
      const statusEl = this.el.querySelector('#enrich-status');
      btn.disabled = true;
      statusEl.style.display = 'block';
      statusEl.textContent = 'Claude analysiert…';
      statusEl.className = 'enrich-status enrich-status--info';

      try {
        const enrichment = await enrichCandidate(c, {
          onProgress: (msg) => { statusEl.textContent = msg; },
        });
        c.enrichment = enrichment;
        this.onAction?.('enriched', c, { enrichment });
        this.render();
      } catch (err) {
        statusEl.textContent = `Fehler: ${err.message}`;
        statusEl.className = 'enrich-status enrich-status--error';
        btn.disabled = false;
      }
    });

    // Zuletzt: war der Chart im Vollbild (Horizont-, Zoom- oder Indikator-
    // Wechsel rendern neu), wird der frische Block wieder ins Vollbild gehoben.
    // Muss ans Ende — danach hängt er im <body>, `this.el.querySelector` findet
    // die Chart-Steuerung also nicht mehr.
    if (this.chartFs) {
      if (this._chartWrap?.querySelector('#chart-fs-btn')) this.enterChartFs();
      else this.chartFs = false;
    }
  }
}
