/**
 * Indices-Panel – Inhalt des "Indices"-Tabs im Markets-Modal.
 *
 * Zwei Sub-Tabs (`Branchen` / `Länder`, Definition in `lib/tv-indices.js`), je
 * eine Tabelle:
 *   Kürzel · Indexname · TV · Δ1T · PerfW · Perf1M · Perf3M · Perf6M · ØGr/M
 *
 * Geladen wird beim ersten Öffnen des Tabs – ein gemeinsamer Scanner-Request
 * für beide Gruppen, damit der Sub-Tab-Wechsel ohne Nachladen läuft. Der
 * Refresh-Button erzwingt einen neuen Fetch.
 *
 * TV-Link als Icon-Only-Chip (STYLEGUIDE §4), Prozente über `.pos`/`.neg` (§8).
 */

import { icons } from '../lib/icons.js?v=20260722j';
import { INDEX_GROUPS, allIndexEntries, emptyIndexRow } from '../lib/tv-indices.js?v=20260729a';

const TV_LOGO = 'https://s3.tradingview.com/userpics/6171439-mFQX_big.png';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const fmtPct = (v) => (v == null || Number.isNaN(v) ? '–' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`);
const posNeg = (v) => (v == null ? '' : v >= 0 ? 'pos' : 'neg');
const fmtVal = (v) => (v == null ? '–' : Number(v).toLocaleString('de-DE', { maximumFractionDigits: 2 }));

const COLUMNS = [
  { key: 'change',   label: 'Δ1T',    title: 'Veränderung heute' },
  { key: 'perf_w',   label: 'PerfW',  title: 'Performance 1 Woche' },
  { key: 'perf_1m',  label: 'Perf1M', title: 'Performance 1 Monat' },
  { key: 'perf_3m',  label: 'Perf3M', title: 'Performance 3 Monate' },
  { key: 'perf_6m',  label: 'Perf6M', title: 'Performance 6 Monate' },
  { key: 'growth_m', label: 'ØGr/M',  title: 'Ø monatliche Growth Rate der letzten 6 Monate (geometrisch aus Perf.6M)' },
];

function tvChip(row) {
  return `<a class="link-chip link-chip--tv" href="${esc(row.url)}" target="_blank" rel="noopener"
    title="${esc(row.code)} auf TradingView öffnen" aria-label="${esc(row.code)} auf TradingView öffnen"><img src="${TV_LOGO}" alt=""></a>`;
}

function tableHtml(rows) {
  return `<div class="idx-tablewrap">
    <table class="idx-table">
      <thead>
        <tr>
          <th class="idx-code">Kürzel</th>
          <th class="idx-name">Index</th>
          <th class="idx-link">TV</th>
          ${COLUMNS.map((c) => `<th class="num" title="${esc(c.title)}">${c.label}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td class="idx-code"><span class="idx-code__txt" title="${esc(r.ticker)}">${esc(r.code)}</span></td>
            <td class="idx-name">
              <span class="idx-name__txt" title="${esc(r.name)}">${esc(r.name)}</span>
              <span class="idx-name__val">${fmtVal(r.value)}</span>
            </td>
            <td class="idx-link">${tvChip(r)}</td>
            ${COLUMNS.map((c) => `<td class="num"><span class="${posNeg(r[c.key])}">${fmtPct(r[c.key])}</span></td>`).join('')}
          </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

/**
 * @param {HTMLElement} container leerer Host (Indices-Pane im Markets-Modal)
 * @param {{ onFetchIndexRows?: (entries:Array) => Promise<Array|null> }} opts
 */
export function renderIndicesPanel(container, { onFetchIndexRows } = {}) {
  container.innerHTML = `
    <div class="idx-panel">
      <div class="idx-head">
        <div class="tab-bar idx-subtabs" role="tablist">
          ${INDEX_GROUPS.map((g, i) => `<button class="tab-btn${i === 0 ? ' active' : ''}" data-idxtab="${g.key}"
            role="tab" aria-selected="${i === 0}">${esc(g.label)}</button>`).join('')}
        </div>
        <span class="idx-spacer"></span>
        <button class="icon-btn idx-refresh" id="idx-refresh" title="Neu laden" aria-label="Neu laden">${icons.refreshCw}</button>
      </div>
      <div class="idx-status" id="idx-status"></div>
      <div class="idx-panes">
        ${INDEX_GROUPS.map((g, i) => `<div class="idx-pane${i === 0 ? ' active' : ''}" data-idxpane="${g.key}" role="tabpanel"></div>`).join('')}
      </div>
    </div>`;

  const statusEl = container.querySelector('#idx-status');
  const paneOf = (key) => container.querySelector(`[data-idxpane="${key}"]`);

  container.querySelectorAll('[data-idxtab]').forEach((btn) => {
    btn.addEventListener('pointerup', () => {
      container.querySelectorAll('[data-idxtab]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      });
      container.querySelectorAll('[data-idxpane]').forEach((p) => p.classList.toggle('active', p.dataset.idxpane === btn.dataset.idxtab));
    });
  });

  /** Beide Gruppen aus einem Ergebnis-Array (Reihenfolge = allIndexEntries) rendern. */
  const paint = (rows) => {
    const byTicker = new Map(rows.map((r) => [r.ticker, r]));
    for (const g of INDEX_GROUPS) {
      paneOf(g.key).innerHTML = tableHtml(g.entries.map((e) => byTicker.get(e.ticker) ?? emptyIndexRow(e)));
    }
  };

  const load = async () => {
    statusEl.textContent = 'Indizes werden geladen …';
    let rows = null;
    try { rows = await onFetchIndexRows?.(allIndexEntries()); } catch { /* Fallback unten */ }
    if (!rows?.length) {
      paint(allIndexEntries().map(emptyIndexRow));
      statusEl.textContent = 'Keine Live-Daten – Backend-URL/Secret in den Einstellungen prüfen.';
      return;
    }
    paint(rows);
    const missing = rows.filter((r) => !r.ok).map((r) => r.ticker);
    const t = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    statusEl.textContent = `Stand ${t} · ${rows.length - missing.length}/${rows.length} Indizes`
      + (missing.length ? ` · ohne Daten: ${missing.join(', ')}` : '');
  };

  container.querySelector('#idx-refresh').addEventListener('pointerup', load);
  load();
}
