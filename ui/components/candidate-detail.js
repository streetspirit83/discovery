import { enrichCandidate } from '../lib/claude-api.js';
import {
  scoreRingSVG, priceLadderSVG, priceLadderLegend,
  perfBarsHTML, rangeBandsHTML, bollingerGaugeHTML,
} from '../lib/price-viz.js?v=20260702h';
import { liveOverallScore } from '../lib/dashboard-metrics.js?v=20260627b';
import { icons } from '../lib/icons.js?v=20260702a';
import { computePriceClusters } from '../lib/price-cluster.js?v=20260702h';
import { detectBottomSignal, detectBreakoutSetup, detectBreakdownRisk, MIN_SNAPSHOTS, MAX_SNAPSHOTS } from '../lib/ls-history-signals.js?v=20260702e';
import { classifyCluster, tradeTarget, breakoutEntry, exitLevels } from '../lib/trade-setup.js?v=20260702h';
import { EXCHANGE_CURRENCY } from '../lib/tv-enrichment.js?v=20260702d';
import { normalizeExchange } from '../lib/exchange-map.js';

const TV_LOGO  = 'https://s3.tradingview.com/userpics/6171439-mFQX_big.png';
const ST_LOGO  = 'https://avatars.githubusercontent.com/u/30304?s=200&v=4';
const YH_LOGO  = 'https://s.yimg.com/os/creatr-uploaded-images/2021-04/05009f00-a857-11eb-bfd7-56b7773a2529';

const TABS = [
  { key: 'performance', label: 'Performance' },
  { key: 'trade',       label: 'Trade' },
  { key: 'fundamental', label: 'Fundamental' },
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
  // Single row: external links · edit · | · quick actions. All direct flex
  // children so they shrink to fit one line even on a narrow phone (§5).
  return `
    <div class="detail-toolbar">
      ${chipLink(links.tradingview, `<img src="${TV_LOGO}" alt="">`, 'TradingView', 'link-chip--tv')}
      ${chipLink(links.stocktwits,  `<img src="${ST_LOGO}" alt="">`, 'StockTwits',  'link-chip--st')}
      ${chipLink(links.yahoo,       `<img src="${YH_LOGO}" alt="">`, 'Yahoo Finance', 'link-chip--yahoo')}
      ${chipLink(scUrl, icons.stethoscope, 'StockConsultant', 'link-chip--sc')}
      ${chipBtn('detail-edit-links', icons.pencil, 'Links bearbeiten', 'link-chip--edit')}
      <span class="detail-toolbar__sep"></span>
      ${chipBtn('detail-trigger', icons.bellPlus, 'Trigger-Alert anlegen/bearbeiten')}
      ${chipBtn('detail-ls', icons.activity, 'LS-Echtzeitkurs laden (EUR)')}
      ${chipBtn('detail-td', icons.candlestick, 'TwelveData Swing-Kurse – folgt (Mockup)', 'link-chip--mock')}
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

function renderHeroPanel(c, disp, pc, tl) {
  if (!tl || tl.kurs == null) return '';
  const sym = disp.cur === 'EUR' ? '€' : disp.cur === 'USD' ? '$' : disp.cur;
  const isLive = c.ls_quote?.price != null && tl.lsF != null;
  const chg = isLive ? c.ls_quote.change_pct : disp.tv?.change_1d;
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

  return `<div class="hero">
    <div class="hero__price-row">
      <span class="hero__price">${fmtNum(tl.kurs)} ${sym}</span>
      <span class="hero__chg ${chg == null ? '' : chg >= 0 ? 'pos' : 'neg'}">${fmtPct(chg)}</span>
      <span class="hero__src">${isLive ? `LS live${c.ls_quote?.checked_at ? ` · ${formatDate(c.ls_quote.checked_at).slice(-5)}` : ''}` : 'TV Close'}</span>
      ${tl.rr != null ? `<span class="hero__rr" title="Chance-Risiko (Long): (Target − Entry) / (Entry − Stop)">R:R <b>${fmtNum(tl.rr, 1)}</b></span>` : ''}
      ${curToggle(disp, 'hero__cur')}
    </div>
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

function renderPerformanceTab(c, disp, pc, tl) {
  const tv = disp.tv;
  const parts = [];
  if (!tv) parts.push(`<p class="pv-empty">Keine TV-Daten – „TV Daten" in der Tabelle laden.</p>`);

  // 1. Hero: Kurs → Stop/Sup/Res/Target → Volumen-Spikes auf einen Blick.
  parts.push(renderHeroPanel(c, disp, pc, tl));

  // 2. Interactive 10-day price/volume chart (Lightweight Charts, vendored);
  //    the SVG band stays as fallback when the lib or the history is missing.
  const canChart = typeof window !== 'undefined' && window.LightweightCharts
    && Array.isArray(c.ls_history) && c.ls_history.length >= 2;
  if (canChart) {
    const hasLive = Array.isArray(c.ls_quote?.series) && c.ls_quote.series.length > 1;
    parts.push(`<h4 class="pv-subhead">10-Tage-Verlauf + Volumen (LS)${hasLive ? ' · heute live' : ''}</h4>
      <div id="ls-chart" class="ls-chart"></div>
      <p class="ph-note">Linie = LS-Intraday${hasLive ? ' inkl. heutigem Live-Verlauf' : ''} · Balken = Tagesvolumen · gestrichelt = Ø V10d / Ø V30d · Linien = Sup/Res-Cluster &amp; Target · Pinch/Ziehen zum Zoomen</p>`);
  } else {
    parts.push(ls10dChartHTML(c, disp));
  }

  // 3. Renditen, Range/Volatilität (der Live-Intraday-Verlauf steckt bereits
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
    // 4. Detail-Level-Leiter auf Abruf (eingeklappt) statt als Einstieg.
    const ladder = priceLadderSVG(tv, pc?.clusters ?? null);
    if (!ladder.includes('pv-empty')) {
      parts.push(`<details class="pv-ladder-details">
        <summary class="pv-subhead">Trend-Band im Detail (ATH · SMAs · 52W · Pivots · Cluster)</summary>
        <div class="pv-ladder-row"><div class="pv-ladder-wrap">${ladder}</div>${priceLadderLegend(!!pc?.clusters?.length)}</div>
      </details>`);
    }
  }
  return parts.join('');
}

/* ── Tab 2: Trade (live values from trade-setup / ls-history-signals) ─────── */

function phCard(title, tag, note) {
  return `<div class="ph-card">
    <div class="ph-card__head">${title}${tag ? `<span class="ph-tag">${tag}</span>` : ''}</div>
    <p>${note}</p>
  </div>`;
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
    <div class="tab-bar ticket__seg" role="tablist">
      <button class="tab-btn${side === 'long' ? ' active' : ''}" data-side="long" role="tab" aria-selected="${side === 'long'}">Long</button>
      <button class="tab-btn${side === 'short' ? ' active' : ''}" data-side="short" role="tab" aria-selected="${side === 'short'}">Short</button>
    </div>
    <div class="ticket">
      ${ticket.map(([lbl, v, cls, tip]) => ticketRow(lbl, v, kurs, cls, tip)).join('')}
    </div>
    ${otherExits ? `<h4 class="pv-subhead">Weitere Exits</h4>${otherExits}` : ''}
    <h4 class="pv-subhead">Ausbruchs-Signale (nächste ~10 T)</h4>
    ${probBar('Brk↑', bo, 'breakoutProbabilityPct', { extendedNarrowRange: 'Range', volumeConfirmation: 'Vol', moneyFlowBullish: 'Money-Flow', flatTopBullFlag: 'Flat-Top/Flag' }, c.ls_history, 'pos')}
    ${probBar('Brk↓', bd, 'breakdownProbabilityPct', { volumeSpikeNoFollowThrough: 'Spike o. Follow-Through', distributionDay: 'Distribution-Day', nearRecentHigh: 'Nähe Hoch' }, c.ls_history, 'neg')}
    ${phCard('Swing-Check', 'TwelveData', 'Platzhalter – Umsetzung folgt (docs/SWING_CHECK_HANDOVER.md).')}
    ${phCard('Analyst Targets', '', 'Platzhalter – Datenquelle folgt.')}
  `;
}

/* ── Tab 3: Fundamentaldaten (TV) ─────────────────────────────────────────── */

function kv(label, value, cls = '') {
  return `<div class="tv-kv"><span>${label}</span><strong class="${cls}">${value}</strong></div>`;
}

function renderFundamentalTab(c, disp) {
  const tv = disp?.tv ?? c.tv_data;
  if (!tv) return `<p class="pv-empty">Keine TV-Daten – „TV Daten" in der Tabelle laden.</p>`;
  const ratingClass = tvRatingClass(tv.rating);
  return `
    <div class="tv-data-grid">
      ${kv('Rating', `<span class="tv-rating tv-rating--${ratingClass}">${tvRatingLabel(tv.rating)}${tv.rating != null ? ` (${tv.rating.toFixed(2)})` : ''}</span>`)}
      ${kv('Stand', formatDate(tv.fetched_at) || '—')}
    </div>
    <h4 class="pv-subhead">Markt</h4>
    <div class="tv-data-grid">
      ${kv('Kurs', fmtNum(tv.close))}
      ${kv('Market Cap', formatMarketCap(tv.market_cap))}
      ${kv('Beta', tv.beta != null ? tv.beta.toFixed(2) : '—')}
      ${kv('Nächste Earnings', tv.earnings_next_date ? formatDate(new Date(tv.earnings_next_date * 1000).toISOString()) : '—')}
    </div>
    <h4 class="pv-subhead">Kennzahlen</h4>
    <div class="tv-data-grid">
      ${kv('KGV (TTM)', tv.pe_ttm != null ? tv.pe_ttm.toFixed(1) : '—')}
      ${kv('ROE', pctVal(tv.return_on_equity))}
      ${kv('Dividende', tv.dividend_yield != null ? `${tv.dividend_yield.toFixed(2)}%` : '—')}
      ${kv('Debt/Equity', ratioVal(tv.debt_to_equity))}
    </div>
    <h4 class="pv-subhead">Wachstum</h4>
    <div class="tv-data-grid">
      ${kv('Umsatz YoY', pctVal(tv.total_revenue_yoy_growth_ttm), growthCls(tv.total_revenue_yoy_growth_ttm))}
      ${kv('OP-Marge', pctVal(tv.operating_margin))}
      ${kv('EBITDA YoY', pctVal(tv.ebitda_yoy_growth_ttm), growthCls(tv.ebitda_yoy_growth_ttm))}
      ${kv('EV/EBITDA', ratioVal(tv.enterprise_value_ebitda_ttm))}
    </div>
  `;
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
    this.activeTab = 'performance';
    this.altCurrency = false; // false = native currency, true = USD↔EUR switched
    this.tradeSide = 'long';  // Trade-Ticket side (Long | Short segmented control)
    this._chart = null;       // Lightweight Charts instance (destroyed on re-render)
  }

  destroyChart() {
    try { this._chart?.remove(); } catch { /* already gone */ }
    this._chart = null;
  }

  // Interactive 10-day LS chart (Lightweight Charts): area price series from
  // the per-day intraday snapshots, volume histogram with Ø10d/Ø30d reference
  // lines, and price lines for Sup/Res clusters + target. Display currency.
  initLsChart(c, disp, pc, tl) {
    const el = this.el.querySelector('#ls-chart');
    if (!el || !window.LightweightCharts) return;
    const hist = c.ls_history;
    const lsF = lsDisplayFactor(disp);
    if (!Array.isArray(hist) || hist.length < 2 || lsF == null) return;

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
      if (liveDay && s.date === liveDay) continue; // live series covers this day
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
    if (clean.length < 2) {
      chart.remove();
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

    chart.timeScale().fitContent();
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
    if (this.candidate?.id !== candidate.id) this.activeTab = 'performance'; // Tab 1 onload
    this.candidate = candidate;
    this.render();
  }

  hide() {
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

    this.destroyChart();
    const disp = this.displayInfo(c);
    const pc = priceClustersDisp(c, disp);
    const tl = tradeLevels(c, disp);
    const tabPanels = {
      performance: renderPerformanceTab(c, disp, pc, tl),
      trade:       renderTradeTab(c, disp, pc, tl, this.tradeSide),
      fundamental: renderFundamentalTab(c, disp),
      meta:        renderMetaTab(c),
    };

    this.el.innerHTML = `
      <div class="sheet__header">
        <div class="detail-title">
          <h2>${c.symbol} <span class="exchange-tag">${c.exchange}</span></h2>
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
          ${(() => { const ov = liveOverallScore(c.tv_data); return scoreRingSVG(ov?.total ?? null, ov?.labelCode ?? null); })()}
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

      ${renderToolbar(c)}

      <div class="tab-bar detail-tabs" role="tablist">
        ${TABS.map(({ key, label }) =>
          `<button class="tab-btn${this.activeTab === key ? ' active' : ''}" data-tab="${key}"
            role="tab" aria-selected="${this.activeTab === key}">${label}</button>`).join('')}
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

    // Tabs
    this.el.querySelectorAll('.detail-tabs .tab-btn').forEach((btn) => {
      btn.addEventListener('pointerup', () => this.setTab(btn.dataset.tab));
    });

    // Trade-Ticket: Long | Short segmented control
    this.el.querySelectorAll('.ticket__seg .tab-btn').forEach((btn) => {
      btn.addEventListener('pointerup', () => {
        if (this.tradeSide === btn.dataset.side) return;
        this.tradeSide = btn.dataset.side;
        this.render();
      });
    });

    // Interactive LS chart (after the container exists in the DOM)
    this.initLsChart(c, disp, pc, tl);

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
  }
}
