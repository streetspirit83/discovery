import { icons } from '../lib/icons.js';

const TV_LOGO = 'https://s3.tradingview.com/userpics/6171439-mFQX_big.png';
const ST_LOGO = 'https://avatars.githubusercontent.com/u/30304?s=200&v=4';
const YH_LOGO = 'https://s.yimg.com/os/creatr-uploaded-images/2021-04/05009f00-a857-11eb-bfd7-56b7773a2529';

const STATE_LABELS = {
  new: 'Neu', reviewed: 'Gesehen', promoted: 'Promoted',
  dismissed: 'Abgelehnt', imported: 'Importiert',
};
const STATE_ORDER = ['new', 'reviewed', 'promoted', 'dismissed', 'imported'];

const ADAPTER_COLORS = {
  openinsider:            '#e67e22',
  'boerse-frankfurt':     '#3498db',
  'etf-holdings':         '#2ecc71',
  stocktwits:             '#1d9bf0',
  'yahoo-trending':       '#6001d2',
  'tradingview-screener': '#2962ff',
};

const SORT_LABELS = {
  state: '', symbol: 'Symbol', name: 'Name', discovered: 'Entdeckt', sources: 'Quellen',
  tv_close: 'Kurs', tv_chg1d: 'Δ1D', tv_chg1w: 'Δ1W', tv_chg1m: 'Δ1M',
  tv_vol: 'Vola', tv_rsi: 'RSI', tv_ema20: 'EMA20', tv_ema50: 'EMA50',
  tv_ema200: 'EMA200', tv_macd: 'MACD', tv_adx: 'ADX',
  tv_rating: 'Rating', tv_mcap: 'Mkt Cap', tv_pe: 'KGV', tv_div: 'Div%',
  tv_beta: 'Beta', tv_vol10d: 'V10d',
  // Technicals
  tv_h1m: 'H1M', tv_l1m: 'L1M', tv_h52hi: '52W↑', tv_h52lo: '52W↓',
  tv_hall: 'ATH', tv_lall: 'ATL', tv_perfall: '%ATH',
  tv_aroondn120: 'Ar↓120', tv_aroondn1m: 'Ar↓1M',
  tv_aroonup120: 'Ar↑120', tv_aroonup1m: 'Ar↑1M',
  tv_macdsig: 'MACD·S', tv_cci: 'CCI', tv_donchlo: 'DC↓', tv_donchhi: 'DC↑',
  // Fundamentals
  tv_eps: 'EPS', tv_earnings: 'Earnings',
  tv_ebitdagrowth: 'EBITDA%', tv_ebitda: 'EBITDA',
  tv_grossmargin: 'GM%', tv_grossgrowth: 'Gross%',
  tv_mom1m: 'Mom', tv_beta3y: 'β3Y', tv_vol30d: 'V30d', tv_rating1m: 'Rat1M',
};

// ── Formatters ──────────────────────────────────────────────────────────────

function fmtPct(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
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
function posNeg(v) {
  if (v == null) return '';
  return v > 0 ? ' tv-pos' : v < 0 ? ' tv-neg' : '';
}
function rsiClass(v) {
  if (v == null) return '';
  if (v >= 70) return ' tv-neg';
  if (v <= 30) return ' tv-pos';
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
function tvRatingLabel(r) {
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
      const color = ADAPTER_COLORS[a] ?? '#888';
      return `<span class="badge" style="background:${color}18;color:${color};border:1px solid ${color}55">${a}</span>`;
    }).join(' ');
}

function sortValue(c, col) {
  const tv = c.tv_data;
  switch (col) {
    case 'symbol':    return c.symbol.toLowerCase();
    case 'name':      return (c.name ?? '').toLowerCase();
    case 'discovered':return new Date(c.first_discovered_at).getTime();
    case 'state':     return STATE_ORDER.indexOf(c.workspace_state);
    case 'sources':   return c.sources.length;
    case 'tv_close':  return tv?.close ?? -Infinity;
    case 'tv_chg1d':  return tv?.change_1d ?? -Infinity;
    case 'tv_chg1w':  return tv?.change_1w ?? -Infinity;
    case 'tv_chg1m':  return tv?.change_1m ?? -Infinity;
    case 'tv_vol':    return tv?.volatility ?? -Infinity;
    case 'tv_rsi':    return tv?.rsi ?? -Infinity;
    case 'tv_ema20':  return tv?.ema20 ?? -Infinity;
    case 'tv_ema50':  return tv?.ema50 ?? -Infinity;
    case 'tv_ema200': return tv?.ema200 ?? -Infinity;
    case 'tv_macd':   return tv?.macd ?? -Infinity;
    case 'tv_adx':    return tv?.adx ?? -Infinity;
    case 'tv_h52':    return tv?.high_52w ?? -Infinity;
    case 'tv_rating': return tv?.rating ?? -Infinity;
    case 'tv_mcap':   return tv?.market_cap ?? -Infinity;
    case 'tv_pe':     return tv?.pe_ttm ?? -Infinity;
    case 'tv_div':    return tv?.dividend_yield ?? -Infinity;
    case 'tv_beta':   return tv?.beta ?? -Infinity;
    case 'tv_vol10d': return tv?.avg_vol_10d ?? -Infinity;
    // Technicals
    case 'tv_h1m':    return tv?.high_1m ?? -Infinity;
    case 'tv_l1m':    return tv?.low_1m ?? -Infinity;
    case 'tv_h52hi':  return tv?.price_52_week_high ?? -Infinity;
    case 'tv_h52lo':  return tv?.price_52_week_low ?? -Infinity;
    case 'tv_hall':   return tv?.high_all ?? -Infinity;
    case 'tv_lall':   return tv?.low_all ?? -Infinity;
    case 'tv_perfall':return tv?.perf_all ?? -Infinity;
    case 'tv_aroondn120': return tv?.aroon_down_120 ?? -Infinity;
    case 'tv_aroondn1m':  return tv?.aroon_down_1m ?? -Infinity;
    case 'tv_aroonup120': return tv?.aroon_up_120 ?? -Infinity;
    case 'tv_aroonup1m':  return tv?.aroon_up_1m ?? -Infinity;
    case 'tv_macdsig':    return tv?.macd_signal ?? -Infinity;
    case 'tv_cci':    return tv?.cci20_1m ?? -Infinity;
    case 'tv_donchlo':return tv?.donch_ch20_lower_1m ?? -Infinity;
    case 'tv_donchhi':return tv?.donch_ch20_upper_1m ?? -Infinity;
    // Fundamentals
    case 'tv_eps':    return tv?.basic_eps_net_income ?? -Infinity;
    case 'tv_earnings':   return tv?.earnings_next_date ?? -Infinity;
    case 'tv_ebitdagrowth': return tv?.ebitda_yoy_growth_fy ?? -Infinity;
    case 'tv_ebitda': return tv?.ebitda ?? -Infinity;
    case 'tv_grossmargin': return tv?.gross_margin ?? -Infinity;
    case 'tv_grossgrowth': return tv?.gross_profit_yoy_growth_fy ?? -Infinity;
    case 'tv_mom1m':  return tv?.mom_1m ?? -Infinity;
    case 'tv_beta3y': return tv?.beta_3_year ?? -Infinity;
    case 'tv_vol30d': return tv?.average_volume_30d_calc ?? -Infinity;
    case 'tv_rating1m': return tv?.recommend_all_1m ?? -Infinity;
    default:          return '';
  }
}

// ── Link edit popover ────────────────────────────────────────────────────────

let _activePopover = null;
function closePopover() {
  if (_activePopover) { _activePopover.remove(); _activePopover = null; }
}

function showLinkEditPopover(candidate, anchorEl, onSave) {
  closePopover();
  const links = candidate.links ?? {};
  const pop = document.createElement('div');
  pop.className = 'link-edit-popover';
  pop.innerHTML = `
    <div class="lep-header">
      <span>Links bearbeiten</span>
      <button class="lep-close" title="Schließen">${icons.xMark}</button>
    </div>
    <div class="lep-field"><label>TradingView</label>
      <input type="url" data-field="tradingview" value="${links.tradingview ?? ''}" placeholder="https://www.tradingview.com/…"></div>
    <div class="lep-field"><label>StockTwits</label>
      <input type="url" data-field="stocktwits" value="${links.stocktwits ?? ''}" placeholder="https://stocktwits.com/…"></div>
    <div class="lep-field"><label>Yahoo Finance</label>
      <input type="url" data-field="yahoo" value="${links.yahoo ?? ''}" placeholder="https://finance.yahoo.com/…"></div>
    <div class="lep-actions">
      <button class="btn btn-sm lep-cancel">Abbrechen</button>
      <button class="btn btn-sm btn-primary lep-save">Speichern</button>
    </div>`;
  document.body.appendChild(pop);
  _activePopover = pop;
  const rect = anchorEl.getBoundingClientRect();
  const popW = 290;
  let left = rect.left;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  pop.style.cssText = `position:fixed;top:${rect.bottom + 6}px;left:${left}px;width:${popW}px;z-index:400`;
  pop.querySelector('.lep-close').addEventListener('pointerup', closePopover);
  pop.querySelector('.lep-cancel').addEventListener('pointerup', closePopover);
  pop.querySelector('.lep-save').addEventListener('pointerup', () => {
    const newLinks = {};
    pop.querySelectorAll('[data-field]').forEach((inp) => { newLinks[inp.dataset.field] = inp.value.trim(); });
    onSave(newLinks);
    closePopover();
  });
  setTimeout(() => {
    const onOutside = (e) => {
      if (!pop.contains(e.target) && e.target !== anchorEl) { closePopover(); document.removeEventListener('pointerdown', onOutside); }
    };
    document.addEventListener('pointerdown', onOutside);
  }, 0);
}

// ── Component ────────────────────────────────────────────────────────────────

export class CandidateList {
  constructor(container, { onSelect, onAction, onBulkAction }) {
    this.container = container;
    this.onSelect = onSelect;
    this.onAction = onAction;
    this.onBulkAction = onBulkAction;
    this.candidates = [];
    this.filters = { blobType: 'inbox', state: '', adapters: [], region: '', dateRange: 'all', sector: '', capSize: '' };
    this.sort = { column: 'discovered', direction: 'desc' };
    this.selected = new Set();
    this.viewMode = 'standard';
    this.render();
  }

  setData(candidates) {
    this.candidates = candidates;
    this.selected.clear();
    this.updateSectorFilter();
    this.renderRows();
    this.renderBulkBar();
  }

  setFilter(key, value) {
    this.filters[key] = value;
    this.selected.clear();
    this.renderRows();
    this.renderBulkBar();
  }

  setSort(column) {
    if (this.sort.column === column) {
      this.sort.direction = this.sort.direction === 'asc' ? 'desc' : 'asc';
    } else {
      this.sort.column = column;
      this.sort.direction = column === 'discovered' ? 'desc' : 'asc';
    }
    this.renderRows();
  }

  setViewMode(mode) {
    this.viewMode = mode;
    this.sort = { column: mode === 'standard' ? 'discovered' : 'tv_mcap', direction: 'desc' };
    this.renderThead();
    this.renderRows();
  }

  sortIcon(column) {
    if (this.sort.column !== column) return `<span class="sort-icon">${icons.arrowUpDown}</span>`;
    return `<span class="sort-icon sort-icon--active">${this.sort.direction === 'asc' ? icons.arrowUp : icons.arrowDown}</span>`;
  }

  thSortable(col, label) {
    const lbl = label ?? SORT_LABELS[col] ?? col;
    return `<span class="th-sort" data-sort="${col}">${lbl} ${this.sortIcon(col)}</span>`;
  }

  getFiltered() {
    const { state, adapters, region, dateRange, sector, capSize } = this.filters;
    const now = Date.now();
    return this.candidates.filter((c) => {
      if (state && c.workspace_state !== state) return false;
      if (adapters.length > 0) {
        if (!adapters.some((a) => c.sources.map((s) => s.adapter).includes(a))) return false;
      }
      if (region) {
        const exch = c.exchange ?? '';
        const isUS = ['NASDAQ', 'NYSE', 'AMEX'].includes(exch);
        const isDE = exch === 'XETR';
        const isEU = ['EURONEXT', 'LSE', 'MIL', 'BME', 'SIX', 'VIE', 'OMXSTO', 'OMXCOP', 'OMXHEX', 'OSE'].includes(exch);
        if (region === 'US' && !isUS) return false;
        if (region === 'DE' && !isDE) return false;
        if (region === 'EU' && !isEU) return false;
        if (region === 'other' && (isUS || isDE || isEU)) return false;
      }
      if (dateRange !== 'all') {
        const ms = { '24h': 86400000, '7d': 604800000, '30d': 2592000000 }[dateRange];
        if (ms && now - new Date(c.first_discovered_at).getTime() > ms) return false;
      }
      if (sector && c.sector !== sector) return false;
      if (capSize) {
        if (capSizeFromMC(c.tv_data?.market_cap) !== capSize) return false;
      }
      return true;
    });
  }

  getSorted(candidates) {
    const { column, direction } = this.sort;
    if (!column) return [...candidates];
    return [...candidates].sort((a, b) => {
      const va = sortValue(a, column);
      const vb = sortValue(b, column);
      if (va < vb) return direction === 'asc' ? -1 : 1;
      if (va > vb) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }

  updateSectorFilter() {
    const sel = this.container.querySelector('#filter-sector');
    if (!sel) return;
    const sectors = [...new Set(this.candidates.filter((c) => c.sector).map((c) => c.sector))].sort();
    const cur = sel.value;
    sel.innerHTML = `<option value="">Alle Sektoren</option>` +
      sectors.map((s) => `<option value="${s}" ${s === cur ? 'selected' : ''}>${s}</option>`).join('');
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render() {
    this.container.innerHTML = `
      <div class="filter-bar">
        <div class="filter-group">
          <label>Ansicht</label>
          <div class="blob-switch">
            <button class="blob-btn active" data-blob="inbox">Inbox</button>
            <button class="blob-btn" data-blob="archive">Archiv</button>
            <button class="blob-btn" data-blob="export">Export</button>
          </div>
        </div>
        <div class="filter-group">
          <label>Spalten</label>
          <div class="view-switch">
            <button class="view-btn active" data-view="standard">Standard</button>
            <button class="view-btn" data-view="technicals">Technicals</button>
            <button class="view-btn" data-view="fundamentals">Fundamentals</button>
          </div>
        </div>
        <div class="filter-group">
          <label>Status</label>
          <select id="filter-state">
            <option value="">Alle</option>
            <option value="new">Neu</option>
            <option value="reviewed">Gesehen</option>
            <option value="promoted">Promoted</option>
            <option value="dismissed">Abgelehnt</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Region</label>
          <select id="filter-region">
            <option value="">Alle</option>
            <option value="US">US</option>
            <option value="DE">DE (Xetra)</option>
            <option value="EU">EU</option>
            <option value="other">Andere</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Sektor</label>
          <select id="filter-sector"><option value="">Alle Sektoren</option></select>
        </div>
        <div class="filter-group">
          <label>Marktkapitalisierung</label>
          <select id="filter-capsize">
            <option value="">Alle</option>
            <option value="micro">Micro (&lt;300M)</option>
            <option value="small">Small (300M–2B)</option>
            <option value="mid">Mid (2–50B)</option>
            <option value="large">Large (&gt;50B)</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Zeitraum</label>
          <select id="filter-date">
            <option value="all">Alle</option>
            <option value="24h">24h</option>
            <option value="7d">7 Tage</option>
            <option value="30d">30 Tage</option>
          </select>
        </div>
      </div>

      <div class="bulk-bar" id="bulk-bar" style="display:none">
        <span id="bulk-count">0 ausgewählt</span>
        <button class="btn btn-sm btn-danger" id="bulk-dismiss">${icons.xMark} Ablehnen</button>
        <button class="btn btn-sm btn-success" id="bulk-promote">${icons.check} Promoten</button>
        <button class="btn btn-sm btn-ai" id="bulk-enrich">${icons.sparkles} Enrich</button>
        <button class="btn btn-sm btn-tv" id="bulk-tv-data">${icons.barChart2} TV Daten</button>
        <button class="btn btn-sm btn-danger" id="bulk-delete">${icons.trash} Löschen</button>
        <button class="btn btn-sm" id="bulk-clear">Auswahl leeren</button>
      </div>

      <div class="table-wrapper">
        <table class="candidate-table">
          <thead id="candidate-thead"></thead>
          <tbody id="candidate-tbody"></tbody>
        </table>
        <div id="empty-state" class="empty-state" style="display:none">
          <p>Keine Kandidaten gefunden.</p>
        </div>
      </div>
    `;

    this.tbody = this.container.querySelector('#candidate-tbody');
    this.thead = this.container.querySelector('#candidate-thead');
    this.emptyState = this.container.querySelector('#empty-state');
    this.bulkBar = this.container.querySelector('#bulk-bar');
    this.bulkCount = this.container.querySelector('#bulk-count');

    this.renderThead();
    this.bindFilters();
    this.bindBulkActions();
  }

  renderThead() {
    const stateTh = `
      <th class="col-state">
        <div class="th-state-head">
          ${this.thSortable('state')}
          <span class="state-info-trigger" tabindex="0">
            ${icons.info}
            <div class="state-legend-tip">
              <div class="slt-row"><span class="state-dot state-dot--new"></span>Neu – frisch entdeckt</div>
              <div class="slt-row"><span class="state-dot state-dot--reviewed"></span>Gesehen – angeschaut</div>
              <div class="slt-row"><span class="state-dot state-dot--promoted"></span>Promoted – vorgemerkt</div>
              <div class="slt-row"><span class="state-dot state-dot--dismissed"></span>Abgelehnt – verworfen</div>
              <div class="slt-row"><span class="state-dot state-dot--imported"></span>Importiert – übernommen</div>
            </div>
          </span>
        </div>
      </th>`;

    if (this.viewMode === 'technicals') {
      this.thead.innerHTML = `<tr>
        <th class="col-check"><input type="checkbox" id="select-all"></th>
        ${stateTh}
        <th class="col-symbol">${this.thSortable('symbol')}</th>
        <th class="tv-col">${this.thSortable('tv_chg1w')}</th>
        <th class="tv-col">${this.thSortable('tv_chg1m')}</th>
        <th class="tv-col">${this.thSortable('tv_h1m')}</th>
        <th class="tv-col">${this.thSortable('tv_l1m')}</th>
        <th class="tv-col">${this.thSortable('tv_h52hi')}</th>
        <th class="tv-col">${this.thSortable('tv_h52lo')}</th>
        <th class="tv-col">${this.thSortable('tv_hall')}</th>
        <th class="tv-col">${this.thSortable('tv_lall')}</th>
        <th class="tv-col">${this.thSortable('tv_perfall')}</th>
        <th class="tv-col">${this.thSortable('tv_aroondn120')}</th>
        <th class="tv-col">${this.thSortable('tv_aroondn1m')}</th>
        <th class="tv-col">${this.thSortable('tv_aroonup120')}</th>
        <th class="tv-col">${this.thSortable('tv_aroonup1m')}</th>
        <th class="tv-col">${this.thSortable('tv_macdsig')}</th>
        <th class="tv-col">${this.thSortable('tv_rsi')}</th>
        <th class="tv-col">${this.thSortable('tv_ema20')}</th>
        <th class="tv-col">${this.thSortable('tv_ema50')}</th>
        <th class="tv-col">${this.thSortable('tv_ema200')}</th>
        <th class="tv-col">${this.thSortable('tv_macd')}</th>
        <th class="tv-col">${this.thSortable('tv_adx')}</th>
        <th class="tv-col">${this.thSortable('tv_cci')}</th>
        <th class="tv-col">${this.thSortable('tv_donchlo')}</th>
        <th class="tv-col">${this.thSortable('tv_donchhi')}</th>
        <th class="col-actions">Aktion</th>
      </tr>`;
    } else if (this.viewMode === 'fundamentals') {
      this.thead.innerHTML = `<tr>
        <th class="col-check"><input type="checkbox" id="select-all"></th>
        ${stateTh}
        <th class="col-symbol">${this.thSortable('symbol')}</th>
        <th class="tv-col">${this.thSortable('tv_pe')}</th>
        <th class="tv-col">${this.thSortable('tv_div')}</th>
        <th class="tv-col">${this.thSortable('tv_eps')}</th>
        <th class="tv-col">${this.thSortable('tv_earnings')}</th>
        <th class="tv-col">${this.thSortable('tv_ebitdagrowth')}</th>
        <th class="tv-col">${this.thSortable('tv_ebitda')}</th>
        <th class="tv-col">${this.thSortable('tv_grossmargin')}</th>
        <th class="tv-col">${this.thSortable('tv_grossgrowth')}</th>
        <th class="tv-col">${this.thSortable('tv_mom1m')}</th>
        <th class="tv-col">${this.thSortable('tv_vol')}</th>
        <th class="tv-col">${this.thSortable('tv_beta')}</th>
        <th class="tv-col">${this.thSortable('tv_beta3y')}</th>
        <th class="tv-col">${this.thSortable('tv_vol10d')}</th>
        <th class="tv-col">${this.thSortable('tv_vol30d')}</th>
        <th class="tv-col">${this.thSortable('tv_rating1m')}</th>
        <th class="col-actions">Aktion</th>
      </tr>`;
    } else {
      this.thead.innerHTML = `<tr>
        <th class="col-check"><input type="checkbox" id="select-all"></th>
        ${stateTh}
        <th class="col-symbol">${this.thSortable('symbol')}</th>
        <th class="col-name">${this.thSortable('name')}</th>
        <th class="col-links">Links</th>
        <th class="col-signal">Letztes Signal</th>
        <th class="col-time">${this.thSortable('discovered')}</th>
        <th class="col-actions">Aktion</th>
        <th class="col-sources">${this.thSortable('sources')}</th>
      </tr>`;
    }

    // Bind sort headers
    this.thead.querySelectorAll('.th-sort[data-sort]').forEach((el) => {
      el.addEventListener('pointerup', (e) => { e.stopPropagation(); this.setSort(el.dataset.sort); });
    });
  }

  updateSortIcons() {
    this.thead.querySelectorAll('.th-sort[data-sort]').forEach((el) => {
      const col = el.dataset.sort;
      const lbl = SORT_LABELS[col] ?? col;
      el.innerHTML = `${lbl} ${this.sortIcon(col)}`;
    });
  }

  bindFilters() {
    this.container.querySelectorAll('.blob-btn').forEach((btn) => {
      btn.addEventListener('pointerup', () => {
        this.container.querySelectorAll('.blob-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.filters.blobType = btn.dataset.blob;
        this.onAction?.('blobSwitch', btn.dataset.blob);
      });
    });

    this.container.querySelectorAll('.view-btn').forEach((btn) => {
      btn.addEventListener('pointerup', () => {
        this.container.querySelectorAll('.view-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.setViewMode(btn.dataset.view);
      });
    });

    this.container.querySelector('#filter-state').addEventListener('change', (e) => this.setFilter('state', e.target.value));
    this.container.querySelector('#filter-region').addEventListener('change', (e) => this.setFilter('region', e.target.value));
    this.container.querySelector('#filter-sector').addEventListener('change', (e) => this.setFilter('sector', e.target.value));
    this.container.querySelector('#filter-capsize').addEventListener('change', (e) => this.setFilter('capSize', e.target.value));
    this.container.querySelector('#filter-date').addEventListener('change', (e) => this.setFilter('dateRange', e.target.value));

    // select-all via delegation (survives thead re-renders)
    this.container.addEventListener('change', (e) => {
      if (e.target.id === 'select-all') {
        const rows = this.getSorted(this.getFiltered());
        if (e.target.checked) rows.forEach((c) => this.selected.add(c.id));
        else this.selected.clear();
        this.renderRows();
        this.renderBulkBar();
      }
    });
  }

  bindBulkActions() {
    this.container.querySelector('#bulk-dismiss').addEventListener('pointerup', () => this.onBulkAction?.('dismiss', [...this.selected]));
    this.container.querySelector('#bulk-promote').addEventListener('pointerup', () => this.onBulkAction?.('promote', [...this.selected]));
    this.container.querySelector('#bulk-enrich').addEventListener('pointerup', () => this.onBulkAction?.('enrich', [...this.selected]));
    this.container.querySelector('#bulk-tv-data').addEventListener('pointerup', () => this.onBulkAction?.('tv-data', [...this.selected]));
    this.container.querySelector('#bulk-delete').addEventListener('pointerup', () => this.onBulkAction?.('delete', [...this.selected]));
    this.container.querySelector('#bulk-clear').addEventListener('pointerup', () => { this.selected.clear(); this.renderRows(); this.renderBulkBar(); });
  }

  renderRows() {
    const rows = this.getSorted(this.getFiltered());
    this.tbody.innerHTML = '';
    this.updateSortIcons();

    if (rows.length === 0) { this.emptyState.style.display = 'block'; return; }
    this.emptyState.style.display = 'none';

    for (const c of rows) {
      const tr = document.createElement('tr');
      tr.className = `candidate-row state-${c.workspace_state}`;
      tr.dataset.id = c.id;
      if (this.selected.has(c.id)) tr.classList.add('selected');

      const tv = c.tv_data;
      const links = c.links ?? {};
      const canPromote = !['promoted', 'imported'].includes(c.workspace_state);
      const canDismiss = c.workspace_state !== 'dismissed';

      const symbolTd = `
        <td class="col-symbol">
          <div class="symbol-cell">
            <strong>${c.symbol}</strong>
            <span class="exchange-tag">${c.exchange}</span>
            ${c.enrichment ? `<span class="enrich-badge" title="AI Enrichment">${icons.sparkles}</span>` : ''}
            ${tv ? `<span class="tv-rating-badge tv-rating-badge--${tvRatingClass(tv.rating)}" title="TV Rating: ${tv.rating?.toFixed(2) ?? '?'}">${tvRatingLabel(tv.rating)}</span>` : ''}
          </div>
        </td>`;

      const actionTd = `
        <td class="col-actions">
          ${canPromote ? `<button class="btn-icon btn-icon--promote" data-action="promote" title="Promoten">${icons.check}</button>` : ''}
          ${canDismiss ? `<button class="btn-icon btn-icon--dismiss" data-action="dismiss" title="Ablehnen">${icons.xMark}</button>` : ''}
          ${this.filters.blobType === 'archive' ? `<button class="btn-icon btn-icon--delete" data-action="delete" title="Löschen">${icons.trash}</button>` : ''}
        </td>`;

      let dataCols;
      if (this.viewMode === 'technicals') {
        dataCols = `
          <td class="tv-col tv-num${posNeg(tv?.change_1w)}">${fmtPct(tv?.change_1w)}</td>
          <td class="tv-col tv-num${posNeg(tv?.change_1m)}">${fmtPct(tv?.change_1m)}</td>
          <td class="tv-col tv-num">${fmtNum(tv?.high_1m, 2)}</td>
          <td class="tv-col tv-num">${fmtNum(tv?.low_1m, 2)}</td>
          <td class="tv-col tv-num">${fmtNum(tv?.price_52_week_high, 2)}</td>
          <td class="tv-col tv-num">${fmtNum(tv?.price_52_week_low, 2)}</td>
          <td class="tv-col tv-num">${fmtNum(tv?.high_all, 2)}</td>
          <td class="tv-col tv-num">${fmtNum(tv?.low_all, 2)}</td>
          <td class="tv-col tv-num${posNeg(tv?.perf_all)}">${tv?.perf_all != null ? fmtNum(tv.perf_all, 1) + '%' : '—'}</td>
          <td class="tv-col tv-num">${fmtNum(tv?.aroon_down_120, 1)}</td>
          <td class="tv-col tv-num">${fmtNum(tv?.aroon_down_1m, 1)}</td>
          <td class="tv-col tv-num">${fmtNum(tv?.aroon_up_120, 1)}</td>
          <td class="tv-col tv-num">${fmtNum(tv?.aroon_up_1m, 1)}</td>
          <td class="tv-col tv-num${posNeg(tv?.macd_signal)}">${fmtNum(tv?.macd_signal, 3)}</td>
          <td class="tv-col tv-num${rsiClass(tv?.rsi)}">${fmtNum(tv?.rsi, 1)}</td>
          <td class="tv-col tv-num">${fmtNum(tv?.ema20, 2)}</td>
          <td class="tv-col tv-num">${fmtNum(tv?.ema50, 2)}</td>
          <td class="tv-col tv-num">${fmtNum(tv?.ema200, 2)}</td>
          <td class="tv-col tv-num${posNeg(tv?.macd)}">${fmtNum(tv?.macd, 3)}</td>
          <td class="tv-col tv-num">${fmtNum(tv?.adx, 1)}</td>
          <td class="tv-col tv-num${posNeg(tv?.cci20_1m)}">${fmtNum(tv?.cci20_1m, 1)}</td>
          <td class="tv-col tv-num">${fmtNum(tv?.donch_ch20_lower_1m, 2)}</td>
          <td class="tv-col tv-num">${fmtNum(tv?.donch_ch20_upper_1m, 2)}</td>
          ${actionTd}`;
      } else if (this.viewMode === 'fundamentals') {
        dataCols = `
          <td class="tv-col tv-num">${fmtNum(tv?.pe_ttm, 1)}</td>
          <td class="tv-col tv-num${posNeg(tv?.dividend_yield)}">${tv?.dividend_yield != null ? fmtNum(tv.dividend_yield, 2) + '%' : '—'}</td>
          <td class="tv-col tv-num${posNeg(tv?.basic_eps_net_income)}">${fmtNum(tv?.basic_eps_net_income, 2)}</td>
          <td class="tv-col">${tv?.earnings_next_date ? fmtDate(tv.earnings_next_date) : '—'}</td>
          <td class="tv-col tv-num${posNeg(tv?.ebitda_yoy_growth_fy)}">${tv?.ebitda_yoy_growth_fy != null ? fmtNum(tv.ebitda_yoy_growth_fy, 1) + '%' : '—'}</td>
          <td class="tv-col tv-num">${fmtMCap(tv?.ebitda)}</td>
          <td class="tv-col tv-num${posNeg(tv?.gross_margin)}">${tv?.gross_margin != null ? fmtNum(tv.gross_margin, 1) + '%' : '—'}</td>
          <td class="tv-col tv-num${posNeg(tv?.gross_profit_yoy_growth_fy)}">${tv?.gross_profit_yoy_growth_fy != null ? fmtNum(tv.gross_profit_yoy_growth_fy, 1) + '%' : '—'}</td>
          <td class="tv-col tv-num${posNeg(tv?.mom_1m)}">${fmtNum(tv?.mom_1m, 2)}</td>
          <td class="tv-col tv-num">${fmtNum(tv?.volatility, 1)}</td>
          <td class="tv-col tv-num">${fmtNum(tv?.beta, 2)}</td>
          <td class="tv-col tv-num">${fmtNum(tv?.beta_3_year, 2)}</td>
          <td class="tv-col tv-num">${fmtMCap(tv?.avg_vol_10d)}</td>
          <td class="tv-col tv-num">${fmtMCap(tv?.average_volume_30d_calc)}</td>
          <td class="tv-col tv-num tv-rating-txt--${tvRatingClass(tv?.recommend_all_1m)}">${fmtNum(tv?.recommend_all_1m, 2)}</td>
          ${actionTd}`;
      } else {
        dataCols = `
          <td class="col-name">${c.name}</td>
          <td class="col-links">
            <div class="link-cluster">
              ${links.tradingview
                ? `<a href="${links.tradingview}" class="link-chip link-chip--tv" target="_blank" rel="noopener" title="TradingView"><img src="${TV_LOGO}" class="link-logo" alt="TV" loading="lazy"></a>`
                : `<span class="link-chip link-chip--missing"><img src="${TV_LOGO}" class="link-logo" alt="TV" loading="lazy"></span>`}
              ${links.stocktwits
                ? `<a href="${links.stocktwits}" class="link-chip link-chip--st" target="_blank" rel="noopener" title="StockTwits"><img src="${ST_LOGO}" class="link-logo" alt="ST" loading="lazy"></a>`
                : `<span class="link-chip link-chip--missing"><img src="${ST_LOGO}" class="link-logo" alt="ST" loading="lazy"></span>`}
              ${links.yahoo
                ? `<a href="${links.yahoo}" class="link-chip link-chip--yahoo" target="_blank" rel="noopener" title="Yahoo Finance"><img src="${YH_LOGO}" class="link-logo" alt="Y!" loading="lazy"></a>`
                : `<span class="link-chip link-chip--missing"><img src="${YH_LOGO}" class="link-logo" alt="Y!" loading="lazy"></span>`}
              <button class="link-chip link-chip--edit" data-action="editLinks" title="Links bearbeiten">${icons.pencil}</button>
            </div>
          </td>
          <td class="col-signal"><span class="signal-text">${getLatestSignal(c)}</span></td>
          <td class="col-time"><span class="time-chip" title="${c.first_discovered_at}">${timeAgo(c.first_discovered_at)}</span></td>
          ${actionTd}
          <td class="col-sources">${renderSourceBadges(c.sources)}</td>`;
      }

      tr.innerHTML = `
        <td class="col-check"><input type="checkbox" class="row-check" ${this.selected.has(c.id) ? 'checked' : ''}></td>
        <td class="col-state"><span class="state-dot state-dot--${c.workspace_state}" title="${STATE_LABELS[c.workspace_state] ?? c.workspace_state}"></span></td>
        ${symbolTd}
        ${dataCols}`;

      tr.querySelector('.row-check').addEventListener('change', (e) => {
        if (e.target.checked) this.selected.add(c.id);
        else this.selected.delete(c.id);
        tr.classList.toggle('selected', e.target.checked);
        this.renderBulkBar();
      });

      tr.querySelector('[data-action="editLinks"]')?.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        showLinkEditPopover(c, e.currentTarget, (newLinks) => {
          c.links = { ...c.links, ...newLinks };
          this.onAction?.('saveLinks', c, { links: c.links });
          this.renderRows();
        });
      });

      tr.querySelector('[data-action="promote"]')?.addEventListener('pointerup', (e) => { e.stopPropagation(); this.onAction?.('promote', c); });
      tr.querySelector('[data-action="dismiss"]')?.addEventListener('pointerup', (e) => { e.stopPropagation(); this.onAction?.('dismiss', c); });
      tr.querySelector('[data-action="delete"]')?.addEventListener('pointerup', (e) => { e.stopPropagation(); this.onAction?.('delete', c); });

      tr.addEventListener('pointerup', (e) => {
        if (['INPUT', 'BUTTON', 'A'].includes(e.target.tagName)) return;
        this.onSelect?.(c);
      });

      this.tbody.appendChild(tr);
    }
  }

  renderBulkBar() {
    const count = this.selected.size;
    if (count === 0) { this.bulkBar.style.display = 'none'; return; }
    this.bulkBar.style.display = 'flex';
    this.bulkCount.textContent = `${count} ausgewählt`;
  }
}
