import { icons } from '../lib/icons.js';

const TV_LOGO = 'https://s3.tradingview.com/userpics/6171439-mFQX_big.png';
const ST_LOGO = 'https://avatars.githubusercontent.com/u/30304?s=200&v=4';
const YH_LOGO = 'https://s.yimg.com/os/creatr-uploaded-images/2021-04/05009f00-a857-11eb-bfd7-56b7773a2529';

const STATE_LABELS = {
  new: 'Neu',
  reviewed: 'Gesehen',
  promoted: 'Promoted',
  dismissed: 'Abgelehnt',
  imported: 'Importiert',
};

const STATE_ORDER = ['new', 'reviewed', 'promoted', 'dismissed', 'imported'];

const ADAPTER_COLORS = {
  openinsider:              '#e67e22',
  'boerse-frankfurt':       '#3498db',
  'etf-holdings':           '#2ecc71',
  stocktwits:               '#1d9bf0',
  'yahoo-trending':         '#6001d2',
  'tradingview-screener':   '#2962ff',
};

const SORT_LABELS = {
  state: '',
  symbol: 'Symbol',
  name: 'Name',
  discovered: 'Entdeckt',
  sources: 'Quellen',
};

function timeAgo(isoStr) {
  if (!isoStr) return '–';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function getLatestSignal(candidate) {
  if (!candidate.sources?.length) return '';
  return candidate.sources[candidate.sources.length - 1].info_snippet ?? '';
}

function renderSourceBadges(sources) {
  const adapters = [...new Set(sources.map((s) => s.adapter))];
  return adapters
    .map((a) => {
      const color = ADAPTER_COLORS[a] ?? '#888';
      return `<span class="badge" style="background:${color}18;color:${color};border:1px solid ${color}55">${a}</span>`;
    })
    .join(' ');
}

function sortValue(c, col) {
  switch (col) {
    case 'symbol':     return c.symbol.toLowerCase();
    case 'name':       return c.name.toLowerCase();
    case 'discovered': return new Date(c.first_discovered_at).getTime();
    case 'state':      return STATE_ORDER.indexOf(c.workspace_state);
    case 'sources':    return c.sources.length;
    default:           return '';
  }
}

// Singleton popover – only one open at a time
let _activePopover = null;

function closePopover() {
  if (_activePopover) {
    _activePopover.remove();
    _activePopover = null;
  }
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
    <div class="lep-field">
      <label>TradingView</label>
      <input type="url" data-field="tradingview" value="${links.tradingview ?? ''}" placeholder="https://www.tradingview.com/…">
    </div>
    <div class="lep-field">
      <label>StockTwits</label>
      <input type="url" data-field="stocktwits" value="${links.stocktwits ?? ''}" placeholder="https://stocktwits.com/…">
    </div>
    <div class="lep-field">
      <label>Yahoo Finance</label>
      <input type="url" data-field="yahoo" value="${links.yahoo ?? ''}" placeholder="https://finance.yahoo.com/…">
    </div>
    <div class="lep-actions">
      <button class="btn btn-sm lep-cancel">Abbrechen</button>
      <button class="btn btn-sm btn-primary lep-save">Speichern</button>
    </div>
  `;
  document.body.appendChild(pop);
  _activePopover = pop;

  // Position below anchor, clamp to viewport
  const rect = anchorEl.getBoundingClientRect();
  const popW = 290;
  let left = rect.left;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  pop.style.cssText = `position:fixed;top:${rect.bottom + 6}px;left:${left}px;width:${popW}px;z-index:400`;

  pop.querySelector('.lep-close').addEventListener('pointerup', closePopover);
  pop.querySelector('.lep-cancel').addEventListener('pointerup', closePopover);
  pop.querySelector('.lep-save').addEventListener('pointerup', () => {
    const newLinks = {};
    pop.querySelectorAll('[data-field]').forEach((inp) => {
      newLinks[inp.dataset.field] = inp.value.trim();
    });
    onSave(newLinks);
    closePopover();
  });

  // Close on outside click (deferred so this pointerup doesn't immediately close it)
  setTimeout(() => {
    const onOutside = (e) => {
      if (!pop.contains(e.target) && e.target !== anchorEl) {
        closePopover();
        document.removeEventListener('pointerdown', onOutside);
      }
    };
    document.addEventListener('pointerdown', onOutside);
  }, 0);
}

export class CandidateList {
  constructor(container, { onSelect, onAction, onBulkAction }) {
    this.container = container;
    this.onSelect = onSelect;
    this.onAction = onAction;
    this.onBulkAction = onBulkAction;
    this.candidates = [];
    this.filters = {
      blobType: 'inbox',
      state: '',
      adapters: [],
      region: '',
      dateRange: 'all',
      search: '',
    };
    this.sort = { column: 'discovered', direction: 'desc' };
    this.selected = new Set();
    this.render();
  }

  setData(candidates) {
    this.candidates = candidates;
    this.selected.clear();
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

  sortIcon(column) {
    if (this.sort.column !== column) {
      return `<span class="sort-icon">${icons.arrowUpDown}</span>`;
    }
    return `<span class="sort-icon sort-icon--active">${this.sort.direction === 'asc' ? icons.arrowUp : icons.arrowDown}</span>`;
  }

  getFiltered() {
    const { state, adapters, region, dateRange, search } = this.filters;
    const now = Date.now();

    return this.candidates.filter((c) => {
      if (state && c.workspace_state !== state) return false;

      if (adapters.length > 0) {
        const cAdapters = c.sources.map((s) => s.adapter);
        if (!adapters.some((a) => cAdapters.includes(a))) return false;
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

      if (search) {
        const q = search.toLowerCase();
        if (!c.symbol.toLowerCase().includes(q) && !c.name.toLowerCase().includes(q)) return false;
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

  thSortable(col) {
    return `<span class="th-sort" data-sort="${col}">${SORT_LABELS[col]} ${this.sortIcon(col)}</span>`;
  }

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
          <label>Zeitraum</label>
          <select id="filter-date">
            <option value="all">Alle</option>
            <option value="24h">24h</option>
            <option value="7d">7 Tage</option>
            <option value="30d">30 Tage</option>
          </select>
        </div>
        <div class="filter-group filter-search">
          <label>Suche</label>
          <input type="search" id="filter-search" placeholder="Symbol / Name…">
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
          <thead>
            <tr>
              <th class="col-check"><input type="checkbox" id="select-all"></th>
              <th class="col-state">
                <div class="th-state-head">
                  ${this.thSortable('state')}
                  <span class="state-info-trigger" tabindex="0">
                    ${icons.info}
                    <div class="state-legend-tip">
                      <div class="slt-row"><span class="state-dot state-dot--new"></span>Neu – frisch entdeckt, unbearbeitet</div>
                      <div class="slt-row"><span class="state-dot state-dot--reviewed"></span>Gesehen – angeschaut, noch offen</div>
                      <div class="slt-row"><span class="state-dot state-dot--promoted"></span>Promoted – für Merkliste vorgemerkt</div>
                      <div class="slt-row"><span class="state-dot state-dot--dismissed"></span>Abgelehnt – verworfen</div>
                      <div class="slt-row"><span class="state-dot state-dot--imported"></span>Importiert – in Merkliste übernommen</div>
                    </div>
                  </span>
                </div>
              </th>
              <th class="col-symbol">${this.thSortable('symbol')}</th>
              <th class="col-name">${this.thSortable('name')}</th>
              <th class="col-links">Links</th>
              <th class="col-signal">Letztes Signal</th>
              <th class="col-time">${this.thSortable('discovered')}</th>
              <th class="col-actions">Aktion</th>
              <th class="col-sources">${this.thSortable('sources')}</th>
            </tr>
          </thead>
          <tbody id="candidate-tbody"></tbody>
        </table>
        <div id="empty-state" class="empty-state" style="display:none">
          <p>Keine Kandidaten gefunden.</p>
        </div>
      </div>
    `;

    this.tbody = this.container.querySelector('#candidate-tbody');
    this.emptyState = this.container.querySelector('#empty-state');
    this.bulkBar = this.container.querySelector('#bulk-bar');
    this.bulkCount = this.container.querySelector('#bulk-count');

    this.bindFilters();
    this.bindBulkActions();
    this.bindSortHeaders();
  }

  bindSortHeaders() {
    this.container.querySelectorAll('.th-sort[data-sort]').forEach((el) => {
      el.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        this.setSort(el.dataset.sort);
      });
    });
  }

  updateSortIcons() {
    this.container.querySelectorAll('.th-sort[data-sort]').forEach((el) => {
      const col = el.dataset.sort;
      el.innerHTML = `${SORT_LABELS[col]} ${this.sortIcon(col)}`;
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

    this.container.querySelector('#filter-state').addEventListener('change', (e) => {
      this.setFilter('state', e.target.value);
    });
    this.container.querySelector('#filter-region').addEventListener('change', (e) => {
      this.setFilter('region', e.target.value);
    });
    this.container.querySelector('#filter-date').addEventListener('change', (e) => {
      this.setFilter('dateRange', e.target.value);
    });

    let searchTimer;
    this.container.querySelector('#filter-search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => this.setFilter('search', e.target.value), 200);
    });

    this.container.querySelector('#select-all').addEventListener('change', (e) => {
      const rows = this.getSorted(this.getFiltered());
      if (e.target.checked) rows.forEach((c) => this.selected.add(c.id));
      else this.selected.clear();
      this.renderRows();
      this.renderBulkBar();
    });
  }

  bindBulkActions() {
    this.container.querySelector('#bulk-dismiss').addEventListener('pointerup', () => {
      this.onBulkAction?.('dismiss', [...this.selected]);
    });
    this.container.querySelector('#bulk-promote').addEventListener('pointerup', () => {
      this.onBulkAction?.('promote', [...this.selected]);
    });
    this.container.querySelector('#bulk-enrich').addEventListener('pointerup', () => {
      this.onBulkAction?.('enrich', [...this.selected]);
    });
    this.container.querySelector('#bulk-tv-data').addEventListener('pointerup', () => {
      this.onBulkAction?.('tv-data', [...this.selected]);
    });
    this.container.querySelector('#bulk-delete').addEventListener('pointerup', () => {
      this.onBulkAction?.('delete', [...this.selected]);
    });
    this.container.querySelector('#bulk-clear').addEventListener('pointerup', () => {
      this.selected.clear();
      this.renderRows();
      this.renderBulkBar();
    });
  }

  renderRows() {
    const rows = this.getSorted(this.getFiltered());
    this.tbody.innerHTML = '';
    this.updateSortIcons();

    if (rows.length === 0) {
      this.emptyState.style.display = 'block';
      return;
    }
    this.emptyState.style.display = 'none';

    for (const c of rows) {
      const tr = document.createElement('tr');
      tr.className = `candidate-row state-${c.workspace_state}`;
      tr.dataset.id = c.id;
      if (this.selected.has(c.id)) tr.classList.add('selected');

      const links = c.links ?? {};
      const canPromote = !['promoted', 'imported'].includes(c.workspace_state);
      const canDismiss = c.workspace_state !== 'dismissed';

      tr.innerHTML = `
        <td class="col-check">
          <input type="checkbox" class="row-check" ${this.selected.has(c.id) ? 'checked' : ''}>
        </td>
        <td class="col-state">
          <span class="state-dot state-dot--${c.workspace_state}" title="${STATE_LABELS[c.workspace_state] ?? c.workspace_state}"></span>
        </td>
        <td class="col-symbol">
          <div class="symbol-cell">
            <strong>${c.symbol}</strong>
            <span class="exchange-tag">${c.exchange}</span>
            ${c.enrichment ? `<span class="enrich-badge" title="AI Enrichment vorhanden">${icons.sparkles}</span>` : ''}
          </div>
        </td>
        <td class="col-name">${c.name}</td>
        <td class="col-links">
          <div class="link-cluster">
            ${links.tradingview
              ? `<a href="${links.tradingview}" class="link-chip link-chip--tv" target="_blank" rel="noopener" title="TradingView"><img src="${TV_LOGO}" class="link-logo" alt="TV" loading="lazy"></a>`
              : `<span class="link-chip link-chip--missing" title="Kein TV-Link"><img src="${TV_LOGO}" class="link-logo" alt="TV" loading="lazy"></span>`}
            ${links.stocktwits
              ? `<a href="${links.stocktwits}" class="link-chip link-chip--st" target="_blank" rel="noopener" title="StockTwits"><img src="${ST_LOGO}" class="link-logo" alt="ST" loading="lazy"></a>`
              : `<span class="link-chip link-chip--missing" title="Kein StockTwits-Link"><img src="${ST_LOGO}" class="link-logo" alt="ST" loading="lazy"></span>`}
            ${links.yahoo
              ? `<a href="${links.yahoo}" class="link-chip link-chip--yahoo" target="_blank" rel="noopener" title="Yahoo Finance"><img src="${YH_LOGO}" class="link-logo" alt="Y!" loading="lazy"></a>`
              : `<span class="link-chip link-chip--missing" title="Kein Yahoo-Link"><img src="${YH_LOGO}" class="link-logo" alt="Y!" loading="lazy"></span>`}
            <button class="link-chip link-chip--edit" data-action="editLinks" title="Links manuell bearbeiten">${icons.pencil}</button>
          </div>
        </td>
        <td class="col-signal"><span class="signal-text">${getLatestSignal(c)}</span></td>
        <td class="col-time">
          <span class="time-chip" title="${c.first_discovered_at}">${timeAgo(c.first_discovered_at)}</span>
        </td>
        <td class="col-actions">
          ${canPromote
            ? `<button class="btn-icon btn-icon--promote" data-action="promote" title="Promoten">${icons.check}</button>`
            : ''}
          ${canDismiss
            ? `<button class="btn-icon btn-icon--dismiss" data-action="dismiss" title="Ablehnen">${icons.xMark}</button>`
            : ''}
          ${this.filters.blobType === 'archive'
            ? `<button class="btn-icon btn-icon--delete" data-action="delete" title="Endgültig löschen">${icons.trash}</button>`
            : ''}
        </td>
        <td class="col-sources">${renderSourceBadges(c.sources)}</td>
      `;

      tr.querySelector('.row-check').addEventListener('change', (e) => {
        if (e.target.checked) this.selected.add(c.id);
        else this.selected.delete(c.id);
        tr.classList.toggle('selected', e.target.checked);
        this.renderBulkBar();
      });

      tr.querySelector('[data-action="editLinks"]').addEventListener('pointerup', (e) => {
        e.stopPropagation();
        showLinkEditPopover(c, e.currentTarget, (newLinks) => {
          c.links = { ...c.links, ...newLinks };
          this.onAction?.('saveLinks', c, { links: c.links });
          this.renderRows();
        });
      });

      tr.querySelector('[data-action="promote"]')?.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        this.onAction?.('promote', c);
      });

      tr.querySelector('[data-action="dismiss"]')?.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        this.onAction?.('dismiss', c);
      });

      tr.querySelector('[data-action="delete"]')?.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        this.onAction?.('delete', c);
      });

      // Row click opens detail
      tr.addEventListener('pointerup', (e) => {
        if (['INPUT', 'BUTTON', 'A'].includes(e.target.tagName)) return;
        this.onSelect?.(c);
      });

      this.tbody.appendChild(tr);
    }
  }

  renderBulkBar() {
    const count = this.selected.size;
    if (count === 0) {
      this.bulkBar.style.display = 'none';
    } else {
      this.bulkBar.style.display = 'flex';
      this.bulkCount.textContent = `${count} ausgewählt`;
    }
  }
}
