import { icons } from '../lib/icons.js';

const TV_LOGO = 'https://s3.tradingview.com/userpics/6171439-mFQX_big.png';
const ST_LOGO = 'https://avatars.githubusercontent.com/u/30304?s=200&v=4';
const YH_LOGO = 'https://s.yimg.com/os/creatr-uploaded-images/2021-04/05009f00-a857-11eb-bfd7-56b7773a2529';

const STATE_LABELS = {
  new: 'Neu', reviewed: 'Gesehen', promoted: 'Promoted',
  dismissed: 'Abgelehnt', imported: 'Importiert',
};
const STATE_ORDER  = ['new', 'reviewed', 'promoted', 'dismissed', 'imported'];

const ADAPTER_COLORS = {
  openinsider:            '#e67e22',
  'boerse-frankfurt':     '#3498db',
  'etf-holdings':         '#2ecc71',
  stocktwits:             '#1d9bf0',
  'yahoo-trending':       '#6001d2',
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
    case 'tv_trend_score':  return tv?.trend_score?.total  ?? null;
    case 'tv_health_score': return tv?.health_score?.total ?? null;
    case 'tv_ema20':  return tv?.ema20 ?? null;
    case 'tv_ema50':  return tv?.ema50 ?? null;
    case 'tv_ema200': return tv?.ema200 ?? null;
    case 'tv_macd':   return tv?.macd ?? null;
    case 'tv_adx':    return tv?.adx ?? null;
    case 'tv_cci':    return tv?.cci20_1m ?? null;
    case 'tv_donchlo':return tv?.donch_ch20_lower_1m ?? null;
    case 'tv_donchhi':return tv?.donch_ch20_upper_1m ?? null;
    case 'tv_pe':     return tv?.pe_ttm ?? null;
    case 'tv_div':    return tv?.dividend_yield ?? null;
    case 'tv_eps':    return tv?.basic_eps_net_income ?? null;
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
    default:          return '';
  }
}

// ── Column definitions ───────────────────────────────────────────────────────

const VIEWS = {
  technicals: [
    { key:'tv_chg1w',   label:'Δ1W',    title:'Veränderung 1 Woche',              num:true, fmt:c=>`<span class="${posNegClass(c.tv_data?.change_1w)}">${fmtPct(c.tv_data?.change_1w)}</span>` },
    { key:'tv_chg1m',   label:'Δ1M',    title:'Veränderung 1 Monat',              num:true, fmt:c=>`<span class="${posNegClass(c.tv_data?.change_1m)}">${fmtPct(c.tv_data?.change_1m)}</span>` },
    { key:'tv_h1m',     label:'H1M',    title:'Hoch 1 Monat',                     num:true, fmt:c=>fmtNum(c.tv_data?.high_1m) },
    { key:'tv_l1m',     label:'L1M',    title:'Tief 1 Monat',                     num:true, fmt:c=>fmtNum(c.tv_data?.low_1m) },
    { key:'tv_h52hi',   label:'52W↑',   title:'52-Wochen-Hoch',                   num:true, fmt:c=>fmtNum(c.tv_data?.price_52_week_high) },
    { key:'tv_h52lo',   label:'52W↓',   title:'52-Wochen-Tief',                   num:true, fmt:c=>fmtNum(c.tv_data?.price_52_week_low) },
    { key:'tv_hall',    label:'ATH',    title:'All-Time-High',                    num:true, fmt:c=>fmtNum(c.tv_data?.high_all) },
    { key:'tv_lall',    label:'ATL',    title:'All-Time-Low',                     num:true, fmt:c=>fmtNum(c.tv_data?.low_all) },
    { key:'tv_perfall', label:'%ATH',   title:'Performance seit Beginn',          num:true, fmt:c=>`<span class="${posNegClass(c.tv_data?.perf_all)}">${c.tv_data?.perf_all!=null?fmtNum(c.tv_data.perf_all,1)+'%':'—'}</span>` },
    { key:'tv_aroondn120',label:'Ar↓120',title:'Aroon Down 120',                  num:true, fmt:c=>fmtNum(c.tv_data?.aroon_down_120,1) },
    { key:'tv_aroondn1m', label:'Ar↓1M', title:'Aroon Down 1 Monat',              num:true, fmt:c=>fmtNum(c.tv_data?.aroon_down_1m,1) },
    { key:'tv_aroonup120',label:'Ar↑120',title:'Aroon Up 120',                    num:true, fmt:c=>fmtNum(c.tv_data?.aroon_up_120,1) },
    { key:'tv_aroonup1m', label:'Ar↑1M', title:'Aroon Up 1 Monat',               num:true, fmt:c=>fmtNum(c.tv_data?.aroon_up_1m,1) },
    { key:'tv_macdsig', label:'MACD·S', title:'MACD Signal',                      num:true, fmt:c=>`<span class="${posNegClass(c.tv_data?.macd_signal)}">${fmtNum(c.tv_data?.macd_signal,3)}</span>` },
    { key:'tv_rsi',     label:'RSI',    title:'Relative Strength Index',          num:true, fmt:c=>`<span class="${rsiClass(c.tv_data?.rsi)}">${fmtNum(c.tv_data?.rsi,1)}</span>` },
    { key:'tv_ema20',   label:'EMA20',  title:'EMA 20',                           num:true, fmt:c=>fmtNum(c.tv_data?.ema20) },
    { key:'tv_ema50',   label:'EMA50',  title:'EMA 50',                           num:true, fmt:c=>fmtNum(c.tv_data?.ema50) },
    { key:'tv_ema200',  label:'EMA200', title:'EMA 200',                          num:true, fmt:c=>fmtNum(c.tv_data?.ema200) },
    { key:'tv_macd',    label:'MACD',   title:'MACD',                             num:true, fmt:c=>`<span class="${posNegClass(c.tv_data?.macd)}">${fmtNum(c.tv_data?.macd,3)}</span>` },
    { key:'tv_adx',     label:'ADX',    title:'Average Directional Index',        num:true, fmt:c=>fmtNum(c.tv_data?.adx,1) },
    { key:'tv_cci',     label:'CCI',    title:'Commodity Channel Index 20 (1M)',  num:true, fmt:c=>`<span class="${posNegClass(c.tv_data?.cci20_1m)}">${fmtNum(c.tv_data?.cci20_1m,1)}</span>` },
    { key:'tv_donchlo', label:'DC↓',    title:'Donchian Channel 20 Lower (1M)',   num:true, fmt:c=>fmtNum(c.tv_data?.donch_ch20_lower_1m) },
    { key:'tv_donchhi', label:'DC↑',    title:'Donchian Channel 20 Upper (1M)',   num:true, fmt:c=>fmtNum(c.tv_data?.donch_ch20_upper_1m) },
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
    { key:'tv_mom1m',       label:'Mom',    title:'Momentum 1 Monat',              num:true,  fmt:c=>`<span class="${posNegClass(c.tv_data?.mom_1m)}">${fmtNum(c.tv_data?.mom_1m,2)}</span>` },
    { key:'tv_vol',         label:'Vola',   title:'Volatilität',                   num:true,  fmt:c=>fmtNum(c.tv_data?.volatility,1) },
    { key:'tv_beta',        label:'Beta',   title:'Beta (1 Jahr)',                 num:true,  fmt:c=>fmtNum(c.tv_data?.beta,2) },
    { key:'tv_beta3y',      label:'β3Y',    title:'Beta (3 Jahre)',                num:true,  fmt:c=>fmtNum(c.tv_data?.beta_3_year,2) },
    { key:'tv_vol10d',      label:'V10d',   title:'Ø Volumen 10 Tage',            num:true,  fmt:c=>fmtMCap(c.tv_data?.avg_vol_10d) },
    { key:'tv_vol30d',      label:'V30d',   title:'Ø Volumen 30 Tage',            num:true,  fmt:c=>fmtMCap(c.tv_data?.average_volume_30d_calc) },
    { key:'tv_rating1m',    label:'Rat1M',  title:'Empfehlung 1 Monat',           num:true,  fmt:c=>`<span class="tv-rating-txt--${tvRatingClass(c.tv_data?.recommend_all_1m)}">${fmtNum(c.tv_data?.recommend_all_1m,2)}</span>` },
  ],
};

// ── Component ────────────────────────────────────────────────────────────────

export class CandidateList {
  constructor({ onSelect, onAction, onBulkAction, onSelectionChange }) {
    this.onSelect          = onSelect;
    this.onAction          = onAction;
    this.onBulkAction      = onBulkAction;
    this.onSelectionChange = onSelectionChange;
    this.candidates        = [];
    this.filters           = { state: '', sector: '', capSize: '' };
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
    this.viewMode = mode;
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
  thNum(col, label, title = '') {
    return `<th class="num" ${title ? `title="${title}"` : ''} aria-sort="${this.ariaSort(col)}">
      <button class="sort-btn" data-sort="${col}">${label} ${this.sortGlyph(col)}</button></th>`;
  }

  getFiltered() {
    const { state, sector, capSize } = this.filters;
    return this.candidates.filter((c) => {
      if (this.showSelectedOnly && !this.selected.has(c.id))    return false;
      if (state   && c.workspace_state !== state)               return false;
      if (sector  && c.sector !== sector)                       return false;
      if (capSize && capSizeFromMC(c.tv_data?.market_cap) !== capSize) return false;
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
      cols += this.th('name', 'Name', 'class="col-name-data"');
      cols += this.th('sector', 'Sektor');
      cols += this.th('sources', 'Quellen');
      cols += this.th('discovered', 'in');
      cols += `<th class="num">Aktion</th>`;
      cols += this.thNum('tv_rating1m',    'Trend',   'Empfehlung 1 Monat (Trend)');
      cols += this.thNum('tv_perfw',        'PerfW',   'Perf.W – rollierend ~5 Handelstage zurück');
      cols += this.thNum('tv_perf1m',      'Perf1M',  'Perf.1M – rollierend ~21 Handelstage zurück');
      cols += this.thNum('tv_trend_score',  'Score',   'Composite Trend Score 0–20: MA Stack + ADX + Momentum + Oscillators + TV Rating');
      cols += this.thNum('tv_pe',          'KGV',     'Kurs-Gewinn-Verhältnis (TTM)');
      cols += this.thNum('tv_eps',         'EPS',     'Gewinn je Aktie');
      cols += this.thNum('tv_ebitdagrowth','EBITDA%', 'EBITDA YoY Wachstum');
      cols += this.thNum('tv_health_score','Health',  'Financial Health Score 0–20: Profitabilität + Liquidität + Wachstum + Cashflow + Earnings');
      cols += `<th>Links</th>`;
      cols += `<th>Letztes Signal</th>`;
    } else {
      cols += VIEWS[this.viewMode].map((d) =>
        `<th class="${d.num ? 'num' : ''}" aria-sort="${this.ariaSort(d.key)}" title="${d.title}">
          <button class="sort-btn" data-sort="${d.key}">${d.label} ${this.sortGlyph(d.key)}</button></th>`
      ).join('');
      cols += `<th class="num">Aktion</th>`;
    }

    this.thead.innerHTML = `<tr>${cols}</tr>`;
    this.thead.querySelectorAll('.sort-btn[data-sort]').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.setSort(btn.dataset.sort); });
    });
    this.bindSelectAll();
  }

  renderRows() {
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
        <span class="sym-strong">${c.symbol}</span>
        <span class="exch-tag">${c.exchange}</span>
        ${c.enrichment ? `<span class="ai-badge" title="AI Enrichment">${icons.sparkles}</span>` : ''}
      </div>`;

      const actionTd = `<td class="num"><div class="row-actions">
        ${canPromote ? `<button class="act-btn act-btn--promote" data-action="promote" aria-label="Promoten">${icons.check}</button>` : ''}
        ${canDismiss ? `<button class="act-btn act-btn--dismiss" data-action="dismiss" aria-label="Ablehnen">${icons.xMark}</button>` : ''}
      </div></td>`;

      let dataCols;
      if (this.viewMode === 'standard') {
        const r = tv?.recommend_all_1m;
        const trendCell = `<span class="tv-rating-txt--${tvRatingClass(r)}">${r != null ? `${tvRatingGlyph(r)} ${fmtNum(r, 2)}` : '—'}</span>`;
        dataCols =
          `<td class="col-name-data"><span class="name-cell" title="${c.name}">${c.name}</span></td>` +
          `<td><span class="sector-cell">${c.sector ?? '—'}</span></td>` +
          `<td>${renderSourceBadges(c.sources)}</td>` +
          `<td><span class="time-chip" title="${c.first_discovered_at}">${timeAgo(c.first_discovered_at)}</span></td>` +
          actionTd +
          `<td class="num">${trendCell}</td>` +
          `<td class="num"><span class="${posNegClass(tv?.perf_w)}">${fmtPct(tv?.perf_w)}</span></td>` +
          `<td class="num"><span class="${posNegClass(tv?.perf_1m)}">${fmtPct(tv?.perf_1m)}</span></td>` +
          `<td class="num">${renderTrendScore(tv?.trend_score)}</td>` +
          `<td class="num">${fmtNum(tv?.pe_ttm, 1)}</td>` +
          `<td class="num"><span class="${posNegClass(tv?.basic_eps_net_income)}">${fmtNum(tv?.basic_eps_net_income, 2)}</span></td>` +
          `<td class="num"><span class="${posNegClass(tv?.ebitda_yoy_growth_fy)}">${tv?.ebitda_yoy_growth_fy != null ? fmtNum(tv.ebitda_yoy_growth_fy, 1) + '%' : '—'}</span></td>` +
          `<td class="num">${renderHealthScore(tv?.health_score)}</td>` +
          `<td><div class="link-cluster">
            ${chipLink(links.tradingview, TV_LOGO, 'TradingView', 'link-chip--tv')}
            ${chipLink(links.stocktwits,  ST_LOGO, 'StockTwits',  'link-chip--st')}
            ${chipLink(links.yahoo,       YH_LOGO, 'Yahoo Finance','link-chip--yahoo')}
          </div></td>` +
          `<td><span class="signal-text">${getLatestSignal(c)}</span></td>`;
      } else {
        dataCols = VIEWS[this.viewMode].map((d) =>
          `<td class="${d.num ? 'num' : ''}">${d.fmt(c)}</td>`
        ).join('') + actionTd;
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

      // Promote / Dismiss
      tr.querySelector('[data-action="promote"]')?.addEventListener('pointerup', (e) => { e.stopPropagation(); this.onAction?.('promote', c); });
      tr.querySelector('[data-action="dismiss"]')?.addEventListener('pointerup', (e) => { e.stopPropagation(); this.onAction?.('dismiss', c); });

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
      <button class="bulk-btn bulk-btn--neg"    id="bulk-dismiss">${icons.xMark} Ablehnen</button>
      <button class="bulk-btn bulk-btn--pos"    id="bulk-promote">${icons.check} Promoten</button>
      <button class="bulk-btn bulk-btn--ai"     id="bulk-enrich">${icons.sparkles} Enrich</button>
      <button class="bulk-btn bulk-btn--accent" id="bulk-tv-data">${icons.barChart2} TV Daten</button>
      <button class="bulk-btn bulk-btn--neg"    id="bulk-delete">${icons.trash} Löschen</button>
      <button class="bulk-btn bulk-btn--neutral" id="bulk-clear" aria-label="Auswahl leeren">${icons.xMark}</button>`;
    ba.querySelector('#bulk-dismiss').addEventListener('pointerup', () => this.onBulkAction?.('dismiss', [...this.selected]));
    ba.querySelector('#bulk-promote').addEventListener('pointerup', () => this.onBulkAction?.('promote', [...this.selected]));
    ba.querySelector('#bulk-enrich').addEventListener('pointerup',  () => this.onBulkAction?.('enrich',  [...this.selected]));
    ba.querySelector('#bulk-tv-data').addEventListener('pointerup', () => this.onBulkAction?.('tv-data', [...this.selected]));
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

function renderHealthScore(hs) {
  if (!hs) return '<span class="muted-dash">—</span>';
  const flags = hs.flags?.length ? ` · ⚠ ${hs.flags.join(', ')}` : '';
  const tip = `${hs.label} (${Object.entries(hs.breakdown).map(([k, v]) => `${k.split('_')[0]}:${v}`).join(' ')})${flags}`;
  return `<span class="health-score health-score--${hs.labelCode}" title="${tip}">${hs.total}</span>`;
}

function chipLink(href, logo, label, extraClass = '') {
  if (href) {
    return `<a href="${href}" class="link-chip ${extraClass}" target="_blank" rel="noopener" title="${label}" aria-label="${label}">
      <img src="${logo}" alt=""></a>`;
  }
  return `<span class="link-chip link-chip--missing ${extraClass}" aria-hidden="true"><img src="${logo}" alt=""></span>`;
}
