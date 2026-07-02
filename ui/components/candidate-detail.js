import { enrichCandidate } from '../lib/claude-api.js';
import {
  scoreRingSVG, priceLadderSVG, priceLadderLegend,
  perfBarsHTML, rangeBandsHTML, bollingerGaugeHTML,
} from '../lib/price-viz.js?v=20260702h';
import { liveOverallScore } from '../lib/dashboard-metrics.js?v=20260627b';
import { sparklineSVG } from '../lib/spark.js?v=20260626e';
import { icons } from '../lib/icons.js?v=20260702a';
import { computePriceClusters } from '../lib/price-cluster.js?v=20260702h';
import { detectBottomSignal } from '../lib/ls-history-signals.js?v=20260702e';
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

function renderToolbar(c, disp) {
  const links = c.links ?? {};
  const scUrl = c.symbol
    ? `https://www.stockconsultant.com/consultnow/basicplus.cgi?symbol=${encodeURIComponent(c.symbol)}`
    : null;
  const curTip = disp.canSwitch
    ? `Preisanzeige umschalten: ${disp.cur} → ${disp.cur === 'USD' ? 'EUR' : 'USD'}`
    : (disp.fx == null ? 'Kein EUR/USD-Kurs – in Einstellungen eintragen oder TV Daten laden' : `Währung ${disp.cur} (nur USD↔EUR umschaltbar)`);
  return `
    <div class="detail-toolbar">
      <div class="detail-toolbar__links">
        ${chipLink(links.tradingview, `<img src="${TV_LOGO}" alt="">`, 'TradingView', 'link-chip--tv')}
        ${chipLink(links.stocktwits,  `<img src="${ST_LOGO}" alt="">`, 'StockTwits',  'link-chip--st')}
        ${chipLink(links.yahoo,       `<img src="${YH_LOGO}" alt="">`, 'Yahoo Finance', 'link-chip--yahoo')}
        ${chipLink(scUrl, icons.stethoscope, 'StockConsultant', 'link-chip--sc')}
        ${chipBtn('detail-edit-links', icons.pencil, 'Links bearbeiten', 'link-chip--edit')}
      </div>
      <span class="detail-toolbar__sep"></span>
      <div class="detail-toolbar__actions">
        ${chipBtn('detail-currency', `<span class="cur-label">${disp.cur === 'USD' ? '$' : disp.cur === 'EUR' ? '€' : disp.cur}</span>`, curTip, disp.canSwitch ? (disp.factor !== 1 ? 'is-active' : '') : 'link-chip--mock')}
        ${chipBtn('detail-trigger', icons.bellPlus, 'Trigger-Alert anlegen/bearbeiten')}
        ${chipBtn('detail-ls', icons.activity, 'LS-Echtzeitkurs laden (EUR)')}
        ${chipBtn('detail-td', icons.candlestick, 'TwelveData Swing-Kurse – folgt (Mockup)', 'link-chip--mock')}
      </div>
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

/* ── Tab 1: Performance ───────────────────────────────────────────────────── */

function lsIntradayHTML(c, disp) {
  const q = c.ls_quote;
  // LS quotes are EUR; convert to the display currency where a rate exists.
  const f = disp.cur === 'EUR' ? 1 : (disp.cur === 'USD' && disp.fx ? disp.fx : null);
  const sym = f == null ? '€' : disp.cur === 'EUR' ? '€' : '$';
  const conv = (v) => (v == null || f == null ? v : v * f);
  const followUp = `<p class="ph-note">10-Tage-Verlauf + Volumen-% (Tagesvolumen / Ø Vol 10T): folgt.</p>`;
  if (!Array.isArray(q?.series) || q.series.length < 2) {
    return `<h4 class="pv-subhead">Intraday (LS · ${sym})</h4>
      <p class="pv-empty">Kein LS-Tagesverlauf – über das Live-Icon in der Symbolleiste laden.</p>${followUp}`;
  }
  const chg = q.change_pct;
  const chgCls = chg == null ? '' : chg >= 0 ? 'pos' : 'neg';
  return `<h4 class="pv-subhead">Intraday (LS · ${sym})</h4>
    <div class="detail-ls" title="Tagesspanne ${fmtNum(conv(q.day_low))}–${fmtNum(conv(q.day_high))}">
      ${sparklineSVG(q.series, q.prev_close, chg)}
      <div class="detail-ls__stat">
        <span class="detail-ls__price">${fmtNum(conv(q.price))} ${sym}</span>
        <span class="detail-ls__meta ${chgCls}">${fmtPct(chg)} · ${formatDate(q.checked_at)}</span>
      </div>
    </div>${followUp}`;
}

function volStatsHTML(tv) {
  if (!tv || (tv.rsi == null && tv.atr == null)) return '';
  return `<div class="pv-volstats">
    <span>RSI <b>${tv.rsi != null ? tv.rsi.toFixed(1) : '—'}</b></span>
    <span>ATR <b>${tv.atr != null ? fmtNum(tv.atr) : '—'}${tv.atrp != null ? ` (${tv.atrp.toFixed(1)}%)` : ''}</b></span>
  </div>`;
}

function renderPerformanceTab(c, disp) {
  const tv = disp.tv;
  const parts = [];
  if (!tv) parts.push(`<p class="pv-empty">Keine TV-Daten – „TV Daten" in der Tabelle laden.</p>`);
  if (tv) {
    // Price clusters (confluence zones) as coloured bands in the trend band.
    // LS levels are EUR → factor into the display currency; unknown rate for
    // other native currencies → LS levels are skipped, TV levels still cluster.
    const bottom = detectBottomSignal(c.ls_history);
    const extraLevels = bottom?.isBottom && bottom.bottomPrice != null
      ? [{ price: bottom.bottomPrice, label: 'Bottom (LS)', family: 'ls', w: 3, lsPrice: true }]
      : [];
    const lsF = disp.cur === 'EUR' ? 1 : (disp.cur === 'USD' && disp.fx ? disp.fx : null);
    const refPrice = (c.ls_quote?.price != null && lsF != null) ? c.ls_quote.price * lsF : null;
    const pc = computePriceClusters(tv, { lsHistory: c.ls_history, extraLevels, refPrice, lsToNative: lsF });
    const ladder = priceLadderSVG(tv, pc?.clusters ?? null);
    if (!ladder.includes('pv-empty')) {
      parts.push(`<h4 class="pv-subhead">Trend-Band (ATH · SMAs · 52W · Pivots · Cluster)</h4>
        <div class="pv-ladder-row"><div class="pv-ladder-wrap">${ladder}</div>${priceLadderLegend(!!pc?.clusters?.length)}</div>`);
    }
  }
  parts.push(lsIntradayHTML(c, disp));
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

/* ── Tab 2: Trade (UI-Mockup, Berechnung folgt) ───────────────────────────── */

function tradeRow(label) {
  return `<div class="trade-row" title="Platzhalter – Berechnung folgt">
    <span>${label}</span><span class="trade-val">–</span>
  </div>`;
}

function phCard(title, tag, note) {
  return `<div class="ph-card">
    <div class="ph-card__head">${title}${tag ? `<span class="ph-tag">${tag}</span>` : ''}</div>
    <p>${note}</p>
  </div>`;
}

function renderTradeTab() {
  return `
    <h4 class="pv-subhead">Setup-Box (Platzhalter – Berechnung folgt)</h4>
    <div class="trade-grid">
      <div class="trade-col trade-col--long">
        <h5 class="trade-col__head">Long Setup</h5>
        <div class="trade-sub">Entry-Trigger</div>
        ${tradeRow('Pivot R1 (1W)')}
        ${tradeRow('Pivot R2 / R3')}
        ${tradeRow('Pivot R1 (1M)')}
        <div class="trade-sub">Exits &amp; Hard Stops <small>(unter Support −0,02 €)</small></div>
        ${tradeRow('L3M − 0,5 × ATR')}
        ${tradeRow('SMA200 − 0,5 × ATR')}
        ${tradeRow('Chandelier (High|22 − ATR|22 × Mult)')}
      </div>
      <div class="trade-col trade-col--short">
        <h5 class="trade-col__head">Short Setup</h5>
        <div class="trade-sub">Entry-Trigger</div>
        ${tradeRow('Breakout: High|20 + 0,01 %')}
        ${tradeRow('Bottom-Signal (Trend/Vol/Candle/Kompression)')}
        <div class="trade-sub">Exits &amp; Trailing Stops</div>
        ${tradeRow('Low|10')}
        ${tradeRow('SMA20-MOM (&lt; SMA20 − 0,5 × ATR)')}
        ${tradeRow('2W-Low (absolut)')}
        ${tradeRow('L1M − 0,5 × ATR')}
        ${tradeRow('Chandelier (Low|22 + ATR|22 × Mult)')}
      </div>
    </div>
    ${phCard('Breakout-Wahrscheinlichkeit', 'Nächste 10 T', 'Platzhalter – Berechnung folgt (docs/BREAKOUT_PROBABILITY_SPEC.md).')}
    ${phCard('Breakdown-Wahrscheinlichkeit', 'Nächste 10 T', 'Platzhalter – Berechnung folgt (docs/BREAKDOWN_PROBABILITY_SPEC.md).')}
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

    const disp = this.displayInfo(c);
    const tabPanels = {
      performance: renderPerformanceTab(c, disp),
      trade:       renderTradeTab(c),
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
            <span class="tag tag--ph" title="Cluster – folgt">Cluster</span>
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

      ${renderToolbar(c, disp)}

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

    // Toolbar: edit-toggle + quick actions
    const editBtn = this.el.querySelector('#detail-edit-links');
    editBtn.addEventListener('pointerup', () => {
      const panel = this.el.querySelector('#detail-links-edit');
      panel.hidden = !panel.hidden;
      editBtn.classList.toggle('is-active', !panel.hidden);
    });
    this.el.querySelector('#detail-currency').addEventListener('pointerup', () => {
      if (!this.displayInfo(c).canSwitch) return;
      this.altCurrency = !this.altCurrency;
      this.render();
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
