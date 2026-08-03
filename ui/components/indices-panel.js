/**
 * Indices-Panel – Inhalt des "Indices"-Tabs im Markets-Modal.
 *
 * Zwei Sub-Tabs (`Branchen` / `Länder`, Definition in `lib/tv-indices.js`), je
 * eine Tabelle:
 *   Kürzel · Index (+ Branche/Land · Stand) · TV · Δ1T · PerfW · Perf1M ·
 *   Perf3M · Perf6M · ØGr/M
 *
 * Geladen wird beim ersten Öffnen des Tabs – ein gemeinsamer Scanner-Request
 * für beide Gruppen, damit der Sub-Tab-Wechsel ohne Nachladen läuft. Der
 * Refresh-Button lädt neu; noch nicht aufgelöste Ticker werden dabei erneut
 * gesucht (bestätigte kommen aus dem localStorage-Cache).
 *
 * Alle Spalten ausser dem TV-Link sind sortierbar (Kürzel, Index und die sechs
 * Zahlenspalten); die Sortierung gilt für beide Sub-Tabs gemeinsam.
 *
 * TV-Link als Icon-Only-Chip (STYLEGUIDE §4) – ohne aufgelösten Ticker als
 * ausgegrauter `.link-chip--missing`. Prozente über `.pos`/`.neg` (§8).
 */

import { icons } from '../lib/icons.js?v=20260803a';
import { INDEX_GROUPS, allIndexEntries, emptyIndexRow, clearSearchBackoff, getResolveReport } from '../lib/tv-indices.js?v=20260730c';

const TV_LOGO = 'https://s3.tradingview.com/userpics/6171439-mFQX_big.png';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const fmtPct = (v) => (v == null || Number.isNaN(v) ? '–' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`);
const posNeg = (v) => (v == null ? '' : v >= 0 ? 'pos' : 'neg');
const fmtVal = (v) => (v == null ? null : Number(v).toLocaleString('de-DE', { maximumFractionDigits: 2 }));

const COLUMNS = [
  { key: 'change',   label: 'Δ1T',    title: 'Veränderung heute' },
  { key: 'perf_w',   label: 'PerfW',  title: 'Performance 1 Woche' },
  { key: 'perf_1m',  label: 'Perf1M', title: 'Performance 1 Monat' },
  { key: 'perf_3m',  label: 'Perf3M', title: 'Performance 3 Monate' },
  { key: 'perf_6m',  label: 'Perf6M', title: 'Performance 6 Monate' },
  { key: 'growth_m', label: 'ØGr/M',  title: 'Ø monatliche Growth Rate der letzten 6 Monate (geometrisch aus Perf.6M)' },
];

/* ── Sortierung ────────────────────────────────────────────────────────────
 * Gilt für beide Sub-Tabs gemeinsam. Erster Klick auf eine Zahlenspalte
 * sortiert absteigend (beste Performance oben), auf Text aufsteigend; erneuter
 * Klick dreht um. Leere Werte stehen immer hinten – egal in welche Richtung,
 * sonst verdrängen "–"-Zeilen die tatsächlichen Extremwerte.
 */
const SORTABLE = [
  { key: 'code',  num: false },
  { key: 'name',  num: false },
  ...COLUMNS.map((c) => ({ key: c.key, num: true })),
];

export function sortRows(rows, sort) {
  if (!sort?.key) return rows;
  const num = SORTABLE.find((s) => s.key === sort.key)?.num;
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    const xe = x == null || (num && Number.isNaN(x));
    const ye = y == null || (num && Number.isNaN(y));
    if (xe || ye) return xe && ye ? 0 : xe ? 1 : -1;    // Leeres immer ans Ende
    return (num ? x - y : String(x).localeCompare(String(y), 'de')) * dir;
  });
}

function sortGlyph(key, sort) {
  if (sort?.key !== key) return '';
  return `<span class="sort-glyph" aria-hidden="true">${sort.dir === 'asc' ? '▲' : '▼'}</span>`;
}
const ariaSort = (key, sort) => (sort?.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');

function tvChip(row) {
  if (!row.url) {
    return `<span class="link-chip link-chip--tv link-chip--missing" title="Kein TV-Ticker aufgelöst"><img src="${TV_LOGO}" alt=""></span>`;
  }
  const tip = `${row.code}${row.ticker ? ` (${row.ticker})` : ''} auf TradingView öffnen`;
  return `<a class="link-chip link-chip--tv" href="${esc(row.url)}" target="_blank" rel="noopener"
    title="${esc(tip)}" aria-label="${esc(tip)}"><img src="${TV_LOGO}" alt=""></a>`;
}

function row(r) {
  const sub = [r.label, fmtVal(r.value)].filter(Boolean).join(' · ');
  // Der Scanner führt einige Branchen-Indizes nicht; dort stehen die Zahlen des
  // Stellvertreter-ETF. Das MUSS in der Zeile sichtbar sein – ETF-Performance
  // enthält Gebühren und Tracking-Abweichung, ist also nicht der Indexstand.
  const etfTag = r.viaEtf
    ? `<span class="idx-etf" title="Kein Index-Datenstrom im TV-Scanner – Zahlen stammen vom Stellvertreter-ETF ${esc(r.viaEtf)} (${esc(r.ticker ?? '')}). Enthält Gebühren und Tracking-Abweichung; der TV-Link zeigt weiterhin auf den Index.">ETF ${esc(r.viaEtf)}</span>`
    : '';
  return `<tr>
    <td class="idx-code"><span class="idx-code__txt" title="${esc(r.ticker ?? 'nicht aufgelöst')}">${esc(r.code)}</span></td>
    <td class="idx-name">
      <span class="idx-name__row"><span class="idx-name__txt" title="${esc(r.tvName || r.name)}">${esc(r.name)}</span>${etfTag}</span>
      <span class="idx-name__sub">${esc(sub)}</span>
    </td>
    <td class="idx-link">${tvChip(r)}</td>
    ${COLUMNS.map((c) => `<td class="num"><span class="${posNeg(r[c.key])}">${fmtPct(r[c.key])}</span></td>`).join('')}
  </tr>`;
}

function sortableTh(key, label, title, cls) {
  return `<th class="${cls}" ${title ? `title="${esc(title)}"` : ''} aria-sort="${ariaSort(key, CURRENT_SORT)}">
    <button class="sort-btn" data-idxsort="${key}">${label} ${sortGlyph(key, CURRENT_SORT)}</button></th>`;
}

/* Von renderIndicesPanel() vor jedem tableHtml()-Aufruf gesetzt – hält die
 * Header-Helfer frei von Durchreich-Parametern. */
let CURRENT_SORT = null;

function tableHtml(rows) {
  return `<div class="idx-tablewrap">
    <table class="idx-table">
      <thead>
        <tr>
          ${sortableTh('code', 'Kürzel', 'Index-Kürzel', 'idx-code')}
          ${sortableTh('name', 'Index', 'Indexname', 'idx-name')}
          <th class="idx-link">TV</th>
          ${COLUMNS.map((c) => sortableTh(c.key, c.label, c.title, 'num')).join('')}
        </tr>
      </thead>
      <tbody>${rows.map(row).join('')}</tbody>
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
        <button class="icon-btn idx-refresh" id="idx-diag" title="Diagnose der Ticker-Auflösung in die Zwischenablage kopieren" aria-label="Diagnose kopieren">${icons.clipboard}</button>
        <button class="icon-btn idx-refresh" id="idx-refresh" title="Neu laden" aria-label="Neu laden">${icons.refreshCw}</button>
      </div>
      <div class="idx-status" id="idx-status"></div>
      <div class="idx-panes">
        ${INDEX_GROUPS.map((g, i) => `<div class="idx-pane${i === 0 ? ' active' : ''}" data-idxpane="${g.key}" role="tabpanel"></div>`).join('')}
      </div>
    </div>`;

  const statusEl = container.querySelector('#idx-status');
  const refreshBtn = container.querySelector('#idx-refresh');
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

  let sort = null;          // { key, dir } – gilt für beide Sub-Tabs
  let lastRows = null;      // zuletzt geladene Zeilen, für das Neusortieren

  /** Beide Gruppen aus einem Ergebnis-Array rendern (Zuordnung über `code`). */
  const paint = (rows) => {
    lastRows = rows;
    CURRENT_SORT = sort;
    const byCode = new Map(rows.map((r) => [r.code, r]));
    for (const g of INDEX_GROUPS) {
      const groupRows = g.entries.map((e) => byCode.get(e.code) ?? emptyIndexRow(e));
      paneOf(g.key).innerHTML = tableHtml(sortRows(groupRows, sort));
    }
    bindSortHandlers();
  };

  /** Klick auf einen Spaltenkopf: erste Richtung nach Spaltentyp, dann drehen. */
  function bindSortHandlers() {
    container.querySelectorAll('[data-idxsort]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.dataset.idxsort;
        const isNum = SORTABLE.find((s) => s.key === key)?.num;
        sort = sort?.key === key
          ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
          : { key, dir: isNum ? 'desc' : 'asc' };
        if (lastRows) paint(lastRows);
      });
    });
  }

  let loading = false;
  /** @param {boolean} retrySearch manueller Refresh: 24-h-Sperre für erfolglose Suchen lösen */
  const load = async (retrySearch = false) => {
    if (loading) return;
    loading = true;
    if (retrySearch) clearSearchBackoff();
    refreshBtn.disabled = true;
    statusEl.textContent = 'Indizes werden geladen …';
    let rows = null;
    try { rows = await onFetchIndexRows?.(allIndexEntries()); } catch { /* Fallback unten */ }

    if (!rows?.length) {
      paint(allIndexEntries().map((e) => emptyIndexRow(e)));
      statusEl.textContent = 'Keine Live-Daten – Backend-URL/Secret in den Einstellungen prüfen.';
    } else {
      paint(rows);
      const missing = rows.filter((r) => !r.ok).map((r) => r.code);
      const t = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      // Ein 403 der Symbolsuche (Host nicht in der Proxy-Allowlist / Netlify noch
      // nicht neu deployt) sieht sonst aus wie "nichts gefunden" – explizit machen.
      const searchErr = getResolveReport()?.searchErrors ?? [];
      statusEl.textContent = `Stand ${t} · ${rows.length - missing.length}/${rows.length} Indizes`
        + (missing.length ? ` · ohne Daten: ${missing.join(', ')}` : '')
        + (searchErr.length ? ` · Symbolsuche nicht erreichbar (${searchErr.length}×, z. B. ${searchErr[0]})` : '');
    }
    refreshBtn.disabled = false;
    loading = false;
  };

  refreshBtn.addEventListener('pointerup', () => load(true));

  // Diagnose: das Protokoll des letzten Auflösungslaufs in die Zwischenablage.
  container.querySelector('#idx-diag').addEventListener('pointerup', async () => {
    const text = JSON.stringify(getResolveReport() ?? { note: 'noch kein Auflösungslauf' }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      statusEl.textContent = 'Diagnose in der Zwischenablage.';
    } catch {
      console.info('[TV] Index-Diagnose:\n' + text);
      statusEl.textContent = 'Zwischenablage nicht verfügbar – Diagnose steht in der Konsole.';
    }
  });

  load();
}
