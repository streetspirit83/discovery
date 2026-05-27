/**
 * Candidate List Component
 * Renders the main table with filter bar and bulk actions.
 */

const STATE_ICONS = {
  new: '🔵',
  reviewed: '⚪',
  promoted: '🟢',
  dismissed: '🔴',
  imported: '✅',
};

const STATE_LABELS = {
  new: 'Neu',
  reviewed: 'Gesehen',
  promoted: 'Promoted',
  dismissed: 'Abgelehnt',
  imported: 'Importiert',
};

const ADAPTER_COLORS = {
  openinsider: '#e67e22',
  'boerse-frankfurt': '#3498db',
  'etf-holdings': '#2ecc71',
};

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `vor ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `vor ${hours}h`;
  const days = Math.floor(hours / 24);
  return `vor ${days}d`;
}

function getLatestSignal(candidate) {
  if (!candidate.sources?.length) return '';
  return candidate.sources[candidate.sources.length - 1].info_snippet ?? '';
}

function renderSourceBadges(sources) {
  const adapters = [...new Set(sources.map((s) => s.adapter))];
  return adapters
    .map((a) => {
      const color = ADAPTER_COLORS[a] ?? '#666';
      return `<span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}66">${a}</span>`;
    })
    .join(' ');
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
        const isDE = exch.startsWith('X') && exch !== 'NYSE';
        const isEU = ['EURONEXT', 'LSE', 'MIL', 'BME', 'SIX', 'VIE', 'OMXSTO', 'OMXCOP', 'OMXHEX', 'OSE'].includes(exch);
        if (region === 'US' && !isUS) return false;
        if (region === 'DE' && exch !== 'XETR') return false;
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
          <input type="search" id="filter-search" placeholder="Symbol / Name suchen…">
        </div>
      </div>
      <div class="bulk-bar" id="bulk-bar" style="display:none">
        <span id="bulk-count">0 ausgewählt</span>
        <button class="btn btn-sm btn-danger" id="bulk-dismiss">✗ Ablehnen</button>
        <button class="btn btn-sm btn-success" id="bulk-promote">✓ Promoten</button>
        <button class="btn btn-sm btn-ai" id="bulk-enrich">✨ Enrich</button>
        <button class="btn btn-sm" id="bulk-clear">Auswahl leeren</button>
      </div>
      <div class="table-wrapper">
        <table class="candidate-table">
          <thead>
            <tr>
              <th class="col-check"><input type="checkbox" id="select-all"></th>
              <th class="col-state"></th>
              <th class="col-symbol">Symbol</th>
              <th class="col-name">Name</th>
              <th class="col-sources">Quellen</th>
              <th class="col-signal">Letztes Signal</th>
              <th class="col-time">Entdeckt</th>
              <th class="col-actions">Aktionen</th>
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
      const filtered = this.getFiltered();
      if (e.target.checked) {
        filtered.forEach((c) => this.selected.add(c.id));
      } else {
        this.selected.clear();
      }
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
    this.container.querySelector('#bulk-clear').addEventListener('pointerup', () => {
      this.selected.clear();
      this.renderRows();
      this.renderBulkBar();
    });
  }

  renderRows() {
    const filtered = this.getFiltered();
    this.tbody.innerHTML = '';

    if (filtered.length === 0) {
      this.emptyState.style.display = 'block';
      return;
    }
    this.emptyState.style.display = 'none';

    for (const c of filtered) {
      const tr = document.createElement('tr');
      tr.className = `candidate-row state-${c.workspace_state}`;
      tr.dataset.id = c.id;
      if (this.selected.has(c.id)) tr.classList.add('selected');

      const hasEnrichment = !!c.enrichment;

      tr.innerHTML = `
        <td class="col-check"><input type="checkbox" class="row-check" ${this.selected.has(c.id) ? 'checked' : ''}></td>
        <td class="col-state" title="${STATE_LABELS[c.workspace_state] ?? c.workspace_state}">
          ${STATE_ICONS[c.workspace_state] ?? '⚫'}
        </td>
        <td class="col-symbol">
          <strong>${c.symbol}</strong><br>
          <small class="exchange">${c.exchange}</small>
          ${hasEnrichment ? '<span class="enrich-dot" title="Enriched">✨</span>' : ''}
        </td>
        <td class="col-name">${c.name}</td>
        <td class="col-sources">${renderSourceBadges(c.sources)}</td>
        <td class="col-signal"><small>${getLatestSignal(c)}</small></td>
        <td class="col-time"><small>${timeAgo(c.first_discovered_at)}</small></td>
        <td class="col-actions">
          <button class="btn-icon" data-action="detail" title="Details">🔍</button>
          ${c.workspace_state !== 'promoted' && c.workspace_state !== 'imported'
            ? `<button class="btn-icon" data-action="promote" title="Promoten">✓</button>`
            : ''}
          ${c.workspace_state !== 'dismissed'
            ? `<button class="btn-icon" data-action="dismiss" title="Ablehnen">✗</button>`
            : ''}
        </td>
      `;

      tr.querySelector('.row-check').addEventListener('change', (e) => {
        if (e.target.checked) this.selected.add(c.id);
        else this.selected.delete(c.id);
        tr.classList.toggle('selected', e.target.checked);
        this.renderBulkBar();
      });

      tr.querySelector('[data-action="detail"]').addEventListener('pointerup', (e) => {
        e.stopPropagation();
        this.onSelect?.(c);
      });

      tr.querySelector('[data-action="promote"]')?.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        this.onAction?.('promote', c);
      });

      tr.querySelector('[data-action="dismiss"]')?.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        this.onAction?.('dismiss', c);
      });

      tr.addEventListener('pointerup', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
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
