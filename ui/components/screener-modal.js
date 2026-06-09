/**
 * Screener Studio – build / preview / import TradingView screens on demand,
 * with named presets that sync across devices (server-side discovery-config blob).
 */

import { FIELDS, OPERATORS, MARKETS, SECTORS, fieldLabel } from '../lib/tv-fields.js';
import { runScreen, rowsToCandidates } from '../lib/tv-screener.js';
import { loadPresets, savePreset, deletePreset } from '../lib/screener-presets.js';
import { uuid } from '../lib/import-parser.js';

// ─── Small helpers ──────────────────────────────────────────────────────────────
function fmt(v) {
  if (v == null || v === '') return '–';
  if (typeof v !== 'number') return String(v);
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function fieldSelectHTML(selected) {
  const groups = [...new Set(FIELDS.map((f) => f.group))];
  return groups.map((g) => {
    const opts = FIELDS.filter((f) => f.group === g)
      .map((f) => `<option value="${f.value}"${f.value === selected ? ' selected' : ''}>${f.label}</option>`)
      .join('');
    return `<optgroup label="${g}">${opts}</optgroup>`;
  }).join('');
}

function opSelectHTML(selected) {
  return OPERATORS.map((o) =>
    `<option value="${o.value}"${o.value === selected ? ' selected' : ''}>${o.label}</option>`
  ).join('');
}

function opArity(op) {
  return OPERATORS.find((o) => o.value === op)?.arity ?? 1;
}

// ─── Component ──────────────────────────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {object|null} opts.storageClient
 * @param {string} opts.backendUrl
 * @param {string} opts.secret
 * @param {(candidates:object[]) => Promise<object>} opts.onImport
 * @param {(msg:string,type?:string)=>void} opts.toast
 */
export async function renderScreenerModal({ storageClient, backendUrl, secret, onImport, toast }) {
  // Builder state
  const state = {
    presetId: null,
    label: '',
    market: 'america',
    sector: '',
    filter: [{ field: 'relative_volume_10d_calc', op: 'greater', v1: '2.5', v2: '' }],
    sortBy: 'relative_volume_10d_calc',
    sortOrder: 'desc',
    count: 50,
  };

  let presets = [];
  try {
    presets = await loadPresets(storageClient);
  } catch {
    presets = [];
  }

  // Preview cache (for import)
  let lastRows = null;
  let lastColumns = null;
  let lastEffectiveFilter = null;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal screener-modal">
      <div class="modal-header">
        <h2>🔭 Screener Studio</h2>
        <button class="modal-close" id="scr-close">✕</button>
      </div>
      <div class="modal-body">
        <div class="scr-presetbar">
          <select class="filter-select" id="scr-preset"></select>
          <button class="btn btn-sm btn-secondary" id="scr-save">Speichern</button>
          <button class="btn btn-sm btn-secondary" id="scr-saveas">Als neu…</button>
          <button class="btn btn-sm btn-secondary" id="scr-delete">Löschen</button>
        </div>

        <div class="scr-grid">
          <label class="scr-field">
            <span>Markt</span>
            <select class="filter-select" id="scr-market">
              ${MARKETS.map((m) => `<option value="${m.slug}">${m.label}</option>`).join('')}
            </select>
          </label>
          <label class="scr-field">
            <span>Sektor (optional)</span>
            <select class="filter-select" id="scr-sector">
              <option value="">Alle Sektoren</option>
              ${SECTORS.map((s) => `<option value="${s}">${s}</option>`).join('')}
            </select>
          </label>
        </div>

        <div class="scr-section-title">Filter</div>
        <div id="scr-filters" class="scr-filters"></div>
        <button class="btn btn-sm btn-secondary" id="scr-add-filter">+ Filter</button>

        <div class="scr-grid scr-grid--3">
          <label class="scr-field">
            <span>Sortieren nach</span>
            <select class="filter-select" id="scr-sortby">${fieldSelectHTML(state.sortBy)}</select>
          </label>
          <label class="scr-field">
            <span>Richtung</span>
            <select class="filter-select" id="scr-sortorder">
              <option value="desc">absteigend</option>
              <option value="asc">aufsteigend</option>
            </select>
          </label>
          <label class="scr-field">
            <span>Max. Treffer</span>
            <input type="number" id="scr-count" min="1" max="200" value="${state.count}">
          </label>
        </div>

        <div id="scr-status" class="upload-status" style="display:none"></div>
        <div id="scr-results" class="scr-results"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="scr-cancel">Schließen</button>
        <button class="btn btn-tv" id="scr-preview">Vorschau</button>
        <button class="btn btn-primary" id="scr-import" disabled>Importieren</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const $ = (sel) => overlay.querySelector(sel);
  const statusEl  = $('#scr-status');
  const resultsEl = $('#scr-results');
  const importBtn = $('#scr-import');

  function setStatus(msg, type = 'info') {
    if (!msg) { statusEl.style.display = 'none'; return; }
    statusEl.textContent = msg;
    statusEl.className = `upload-status upload-status--${type}`;
    statusEl.style.display = 'block';
  }

  // ── Preset dropdown ────────────────────────────────────────────────────────
  function renderPresetOptions() {
    const sel = $('#scr-preset');
    sel.innerHTML =
      `<option value="">— Neuer Screen —</option>` +
      presets.map((p) => `<option value="${p.id}"${p.id === state.presetId ? ' selected' : ''}>${p.label}${p.built_in ? ' ·' : ''}</option>`).join('');
  }

  function loadPresetIntoState(preset) {
    state.presetId = preset.id;
    state.label    = preset.label;
    state.market   = preset.market ?? 'america';
    state.sector   = preset.sector ?? '';
    state.filter   = (preset.filter ?? []).map((f) => ({
      field: f.left,
      op: f.operation,
      v1: Array.isArray(f.right) ? (f.right[0] ?? '') : (f.right ?? ''),
      v2: Array.isArray(f.right) ? (f.right[1] ?? '') : '',
    }));
    if (state.filter.length === 0) state.filter.push({ field: 'close', op: 'greater', v1: '5', v2: '' });
    state.sortBy    = preset.sort?.sortBy ?? state.filter[0].field;
    state.sortOrder = preset.sort?.sortOrder ?? 'desc';
    state.count     = preset.count ?? 50;
    syncControls();
  }

  function syncControls() {
    $('#scr-market').value    = state.market;
    $('#scr-sector').value    = state.sector;
    $('#scr-sortby').value    = state.sortBy;
    $('#scr-sortorder').value = state.sortOrder;
    $('#scr-count').value     = state.count;
    renderFilters();
    renderPresetOptions();
  }

  // ── Filter rows ────────────────────────────────────────────────────────────
  function renderFilters() {
    const wrap = $('#scr-filters');
    wrap.innerHTML = '';
    state.filter.forEach((row, i) => {
      const div = document.createElement('div');
      div.className = 'scr-filter-row';
      const two = opArity(row.op) === 2;
      div.innerHTML = `
        <select class="filter-select scr-f-field" data-i="${i}">${fieldSelectHTML(row.field)}</select>
        <select class="filter-select scr-f-op" data-i="${i}">${opSelectHTML(row.op)}</select>
        <input type="number" step="any" class="scr-f-v1" data-i="${i}" value="${row.v1}" placeholder="Wert">
        <input type="number" step="any" class="scr-f-v2" data-i="${i}" value="${row.v2}" placeholder="bis" style="display:${two ? 'block' : 'none'}">
        <button class="btn-icon scr-f-del" data-i="${i}" title="Entfernen">✕</button>
      `;
      wrap.appendChild(div);
    });

    wrap.querySelectorAll('.scr-f-field').forEach((el) =>
      el.addEventListener('change', (e) => { state.filter[+e.target.dataset.i].field = e.target.value; }));
    wrap.querySelectorAll('.scr-f-op').forEach((el) =>
      el.addEventListener('change', (e) => {
        const i = +e.target.dataset.i;
        state.filter[i].op = e.target.value;
        renderFilters(); // toggle 2nd input visibility
      }));
    wrap.querySelectorAll('.scr-f-v1').forEach((el) =>
      el.addEventListener('input', (e) => { state.filter[+e.target.dataset.i].v1 = e.target.value; }));
    wrap.querySelectorAll('.scr-f-v2').forEach((el) =>
      el.addEventListener('input', (e) => { state.filter[+e.target.dataset.i].v2 = e.target.value; }));
    wrap.querySelectorAll('.scr-f-del').forEach((el) =>
      el.addEventListener('pointerup', (e) => {
        state.filter.splice(+e.currentTarget.dataset.i, 1);
        if (state.filter.length === 0) state.filter.push({ field: 'close', op: 'greater', v1: '', v2: '' });
        renderFilters();
      }));
  }

  // ── Build the scanner request from state ───────────────────────────────────
  function buildRequest() {
    const filter = [];
    for (const r of state.filter) {
      if (!r.field || r.v1 === '' || r.v1 == null) continue;
      const arity = opArity(r.op);
      const right = arity === 2 ? [Number(r.v1), Number(r.v2)] : Number(r.v1);
      if (arity === 2 && (Number.isNaN(right[0]) || Number.isNaN(right[1]))) continue;
      if (arity === 1 && Number.isNaN(right)) continue;
      filter.push({ left: r.field, operation: r.op, right });
    }
    if (state.sector) filter.push({ left: 'sector', operation: 'equal', right: state.sector });

    // Columns: description first (for name), then close + sector + all referenced fields.
    const cols = ['description', 'close', 'sector'];
    for (const r of state.filter) if (r.field && !cols.includes(r.field)) cols.push(r.field);
    if (!cols.includes(state.sortBy)) cols.push(state.sortBy);

    return {
      market: state.market,
      filter,
      columns: cols,
      sort: { sortBy: state.sortBy, sortOrder: state.sortOrder },
      count: Math.max(1, Math.min(200, Number(state.count) || 50)),
    };
  }

  // ── Preview ────────────────────────────────────────────────────────────────
  function renderResults(rows, columns) {
    if (!rows.length) { resultsEl.innerHTML = '<p class="hint">Keine Treffer.</p>'; return; }
    // Show symbol + name + the filtered/sorted fields.
    const showCols = [...new Set([state.sortBy, ...state.filter.map((r) => r.field).filter(Boolean)])].slice(0, 5);
    const head = `<th>Symbol</th><th>Name</th>` + showCols.map((c) => `<th>${fieldLabel(c)}</th>`).join('');
    const body = rows.slice(0, 100).map((row) => {
      const d = row.d ?? [];
      const sym = row.s ?? '';
      const name = d[columns.indexOf('description')] ?? '';
      const cells = showCols.map((c) => `<td>${fmt(d[columns.indexOf(c)])}</td>`).join('');
      return `<tr><td><strong>${sym}</strong></td><td class="scr-name">${name}</td>${cells}</tr>`;
    }).join('');
    resultsEl.innerHTML = `<div class="scr-table-wrap"><table class="scr-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  $('#scr-preview').addEventListener('pointerup', async () => {
    if (!backendUrl || !secret) { setStatus('Backend nicht konfiguriert (Einstellungen).', 'warning'); return; }
    const req = buildRequest();
    setStatus('⏳ Lade Treffer von TradingView…', 'info');
    importBtn.disabled = true;
    resultsEl.innerHTML = '';
    try {
      const { totalCount, rows } = await runScreen(req, { backendUrl, secret });
      lastRows = rows;
      lastColumns = req.columns;
      lastEffectiveFilter = req.filter;
      renderResults(rows, req.columns);
      setStatus(`✅ ${rows.length} Treffer${totalCount > rows.length ? ` (von ${totalCount})` : ''}`, 'success');
      importBtn.disabled = rows.length === 0;
    } catch (err) {
      setStatus(`Fehler: ${err.message}`, 'warning');
    }
  });

  // ── Import ─────────────────────────────────────────────────────────────────
  $('#scr-import').addEventListener('pointerup', async () => {
    if (!lastRows?.length) return;
    importBtn.disabled = true;
    setStatus('⏳ Importiere…', 'info');
    const candidates = rowsToCandidates(lastRows, {
      market: state.market,
      columns: lastColumns,
      presetId: state.presetId,
      presetLabel: state.label || 'Custom',
      filter: lastEffectiveFilter,
    });
    try {
      const res = await onImport(candidates);
      const { added = 0, merged = 0, skipped = 0 } = res || {};
      setStatus(`✓ ${added} neu, ${merged} gemergt${skipped ? `, ${skipped} übersprungen` : ''}`, 'success');
    } catch (err) {
      setStatus(`Import fehlgeschlagen: ${err.message}`, 'warning');
    } finally {
      importBtn.disabled = false;
    }
  });

  // ── Preset actions ─────────────────────────────────────────────────────────
  $('#scr-preset').addEventListener('change', (e) => {
    const id = e.target.value;
    if (!id) { // new empty screen
      state.presetId = null; state.label = '';
      state.filter = [{ field: 'close', op: 'greater', v1: '5', v2: '' }];
      syncControls();
      return;
    }
    const p = presets.find((x) => x.id === id);
    if (p) loadPresetIntoState(p);
  });

  function currentPresetDoc(id, label, built_in = false) {
    const req = buildRequest();
    // Store user filter rows (without the injected sector filter) for clean re-editing.
    const filter = req.filter.filter((f) => f.left !== 'sector');
    return {
      id, label, market: state.market, sector: state.sector || null,
      filter, sort: req.sort, count: req.count,
      signal_type: 'custom_screen', built_in,
    };
  }

  $('#scr-save').addEventListener('pointerup', async () => {
    const current = presets.find((p) => p.id === state.presetId);
    if (!current || current.built_in) {
      setStatus('Vordefinierte Screens nicht überschreibbar – „Als neu…" nutzen.', 'warning');
      return;
    }
    const doc = currentPresetDoc(current.id, current.label, false);
    try {
      presets = await savePreset(storageClient, doc);
      state.label = doc.label;
      renderPresetOptions();
      setStatus(`✓ „${doc.label}" gespeichert`, 'success');
    } catch (err) {
      setStatus(`Speichern fehlgeschlagen: ${err.message}`, 'warning');
    }
  });

  $('#scr-saveas').addEventListener('pointerup', async () => {
    const label = prompt('Name für den neuen Screen:', state.label || 'Mein Screen');
    if (!label) return;
    const doc = currentPresetDoc(uuid(), label.trim(), false);
    try {
      presets = await savePreset(storageClient, doc);
      state.presetId = doc.id; state.label = doc.label;
      renderPresetOptions();
      setStatus(`✓ „${doc.label}" angelegt`, 'success');
    } catch (err) {
      setStatus(`Speichern fehlgeschlagen: ${err.message}`, 'warning');
    }
  });

  $('#scr-delete').addEventListener('pointerup', async () => {
    const current = presets.find((p) => p.id === state.presetId);
    if (!current) { setStatus('Kein gespeicherter Screen ausgewählt.', 'warning'); return; }
    if (current.built_in) { setStatus('Vordefinierte Screens können nicht gelöscht werden.', 'warning'); return; }
    if (!confirm(`„${current.label}" löschen?`)) return;
    try {
      presets = await deletePreset(storageClient, current.id);
      state.presetId = null; state.label = '';
      renderPresetOptions();
      $('#scr-preset').value = '';
      setStatus('Gelöscht.', 'info');
    } catch (err) {
      setStatus(`Löschen fehlgeschlagen: ${err.message}`, 'warning');
    }
  });

  // ── Control bindings ───────────────────────────────────────────────────────
  $('#scr-market').addEventListener('change', (e) => { state.market = e.target.value; });
  $('#scr-sector').addEventListener('change', (e) => { state.sector = e.target.value; });
  $('#scr-sortby').addEventListener('change', (e) => { state.sortBy = e.target.value; });
  $('#scr-sortorder').addEventListener('change', (e) => { state.sortOrder = e.target.value; });
  $('#scr-count').addEventListener('input', (e) => { state.count = e.target.value; });
  $('#scr-add-filter').addEventListener('pointerup', () => {
    state.filter.push({ field: 'volume', op: 'greater', v1: '', v2: '' });
    renderFilters();
  });

  // ── Close ──────────────────────────────────────────────────────────────────
  const close = () => overlay.remove();
  $('#scr-close').addEventListener('pointerup', close);
  $('#scr-cancel').addEventListener('pointerup', close);
  overlay.addEventListener('pointerup', (e) => { if (e.target === overlay) close(); });

  // ── Init: load first preset if any ─────────────────────────────────────────
  if (presets.length) loadPresetIntoState(presets[0]);
  else syncControls();
}
