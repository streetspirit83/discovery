/**
 * Import Modal – robust manual import.
 * Three input modes: file upload, paste (JSON/CSV/Schema A), symbol search.
 * All modes feed a common staging list; "Importieren" pushes via onImport().
 */

import { parseImport } from '../lib/import-parser.js';
import { searchSymbols, searchResultToCandidate } from '../lib/symbol-search.js';

/**
 * @param {object} opts
 * @param {(candidates: object[]) => Promise<{added:number,merged:number,skipped:number,errors:number}>} opts.onImport
 */
export function renderUploadModal({ onImport }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal upload-modal">
      <div class="modal-header">
        <h2>Import</h2>
        <button class="modal-close" id="upload-close">✕</button>
      </div>
      <div class="modal-body">
        <div class="tab-bar">
          <button class="tab-btn active" data-tab="paste">Einfügen</button>
          <button class="tab-btn" data-tab="file">Datei</button>
          <button class="tab-btn" data-tab="search">Symbol-Suche</button>
        </div>

        <div class="tab-panel active" data-panel="paste">
          <p class="hint">JSON (Discovery-Blob, Candidate-Array, Schema A) oder CSV einfügen.
          CSV braucht mind. eine Spalte <code>symbol</code> oder <code>ticker</code>.</p>
          <textarea id="paste-input" class="paste-area" rows="8"
            placeholder='[{"symbol":"AAPL","exchange":"NASDAQ","name":"Apple Inc."}]  — oder —  symbol,exchange,name&#10;AAPL,NASDAQ,Apple Inc.'></textarea>
          <button class="btn btn-sm btn-secondary" id="paste-parse">Parsen</button>
        </div>

        <div class="tab-panel" data-panel="file">
          <div class="upload-area" id="upload-dropzone">
            <div class="upload-icon">⇪</div>
            <p>JSON/CSV-Datei hier ablegen oder klicken</p>
            <input type="file" id="upload-file" accept=".json,.csv,.txt" style="display:none">
          </div>
        </div>

        <div class="tab-panel" data-panel="search">
          <p class="hint">Symbol-Suche via Twelve Data – funktioniert ohne Key. Für mehr Anfragen (800/Tag) optional einen Key in den Einstellungen hinterlegen.</p>
          <div class="search-wrap">
            <input type="search" id="symbol-input" class="symbol-search-input"
              placeholder="Firmenname oder Symbol… (z.B. Apple, BMW)" autocomplete="off">
            <div id="symbol-results" class="symbol-results" style="display:none"></div>
          </div>
        </div>

        <div id="upload-errors" class="upload-errors" style="display:none"></div>

        <div class="staged-area" id="staged-area" style="display:none">
          <h3>Bereit zum Import (<span id="staged-count">0</span>)</h3>
          <div id="staged-list" class="staged-list"></div>
        </div>
        <div id="upload-status" class="upload-status" style="display:none"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="upload-cancel">Schließen</button>
        <button class="btn btn-primary" id="upload-submit" disabled>Importieren</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  /** @type {Map<string, object>} keyed by symbol|exchange to dedup the staging list */
  const staged = new Map();

  const errorsEl = overlay.querySelector('#upload-errors');
  const statusEl = overlay.querySelector('#upload-status');
  const stagedArea = overlay.querySelector('#staged-area');
  const stagedList = overlay.querySelector('#staged-list');
  const stagedCount = overlay.querySelector('#staged-count');
  const submitBtn = overlay.querySelector('#upload-submit');

  function showErrors(errors) {
    if (!errors?.length) {
      errorsEl.style.display = 'none';
      return;
    }
    errorsEl.innerHTML = `<strong>Hinweis:</strong><ul>${errors.map((e) => `<li>${e}</li>`).join('')}</ul>`;
    errorsEl.style.display = 'block';
  }

  function keyOf(c) {
    return `${c.symbol}|${c.exchange}`;
  }

  function renderStaged() {
    stagedCount.textContent = String(staged.size);
    stagedArea.style.display = staged.size ? 'block' : 'none';
    submitBtn.disabled = staged.size === 0;
    stagedList.innerHTML = '';
    for (const [key, c] of staged) {
      const row = document.createElement('div');
      row.className = 'staged-row';
      row.innerHTML = `
        <span class="staged-sym"><strong>${c.symbol}</strong>${c.exchange ? ` <span class="exchange-tag">${c.exchange}</span>` : ''}</span>
        <span class="staged-name">${c.name}</span>
        <button class="btn-icon staged-remove" title="Entfernen">✕</button>
      `;
      row.querySelector('.staged-remove').addEventListener('pointerup', () => {
        staged.delete(key);
        renderStaged();
      });
      stagedList.appendChild(row);
    }
  }

  function addCandidates(candidates) {
    let n = 0;
    for (const c of candidates) {
      if (!c) continue;
      staged.set(keyOf(c), c);
      n++;
    }
    renderStaged();
    return n;
  }

  // ── Tabs ──────────────────────────────────────────────────
  overlay.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('pointerup', () => {
      overlay.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      overlay.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      overlay.querySelector(`.tab-panel[data-panel="${btn.dataset.tab}"]`).classList.add('active');
    });
  });

  // ── Paste ─────────────────────────────────────────────────
  overlay.querySelector('#paste-parse').addEventListener('pointerup', () => {
    const text = overlay.querySelector('#paste-input').value;
    const { candidates, format, errors } = parseImport(text);
    showErrors(errors);
    if (candidates.length) {
      const n = addCandidates(candidates);
      showErrors([`${n} Kandidat(en) erkannt (Format: ${format}).`]);
    }
  });

  // ── File ──────────────────────────────────────────────────
  const fileInput = overlay.querySelector('#upload-file');
  const dropzone = overlay.querySelector('#upload-dropzone');

  function processFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const { candidates, format, errors } = parseImport(e.target.result);
      showErrors(errors);
      if (candidates.length) {
        const n = addCandidates(candidates);
        showErrors([`${n} Kandidat(en) erkannt (Format: ${format}).`]);
      }
    };
    reader.readAsText(file);
  }

  dropzone.addEventListener('pointerup', () => fileInput.click());
  fileInput.addEventListener('change', () => processFile(fileInput.files[0]));
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    processFile(e.dataTransfer.files[0]);
  });

  // ── Symbol search (autocomplete) ──────────────────────────
  const symInput = overlay.querySelector('#symbol-input');
  const symResults = overlay.querySelector('#symbol-results');
  let searchTimer;
  let searchSeq = 0;

  function renderResults(results) {
    if (!results.length) {
      symResults.innerHTML = '<div class="symbol-result empty">Keine Treffer</div>';
      symResults.style.display = 'block';
      return;
    }
    symResults.innerHTML = '';
    for (const r of results) {
      const item = document.createElement('div');
      item.className = 'symbol-result';
      item.innerHTML = `
        <span class="sr-symbol">${r.symbol}</span>
        <span class="sr-name">${r.name}</span>
        <span class="sr-region">${r.exchange || r.region || ''}</span>
      `;
      item.addEventListener('pointerup', () => {
        const cand = searchResultToCandidate(r);
        if (cand) {
          addCandidates([cand]);
          showErrors([`${cand.symbol} hinzugefügt.`]);
        }
        symResults.style.display = 'none';
        symInput.value = '';
      });
      symResults.appendChild(item);
    }
    symResults.style.display = 'block';
  }

  symInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = symInput.value.trim();
    if (q.length < 2) {
      symResults.style.display = 'none';
      return;
    }
    searchTimer = setTimeout(async () => {
      const seq = ++searchSeq;
      symResults.innerHTML = '<div class="symbol-result empty">Suche…</div>';
      symResults.style.display = 'block';
      try {
        const results = await searchSymbols(q);
        if (seq === searchSeq) renderResults(results);
      } catch (err) {
        if (seq === searchSeq) {
          symResults.style.display = 'none';
          showErrors([err.message]);
        }
      }
    }, 350);
  });

  // ── Import ────────────────────────────────────────────────
  submitBtn.addEventListener('pointerup', async () => {
    if (!staged.size) return;
    submitBtn.disabled = true;
    statusEl.textContent = 'Importiere…';
    statusEl.className = 'upload-status upload-status--info';
    statusEl.style.display = 'block';

    const result = await onImport([...staged.values()]);
    const { added = 0, merged = 0, skipped = 0, errors = 0 } = result || {};
    statusEl.textContent = `✓ Fertig: ${added} neu, ${merged} gemergt, ${skipped} übersprungen${errors ? `, ${errors} Fehler` : ''}`;
    statusEl.className = `upload-status upload-status--${errors ? 'warning' : 'success'}`;
    staged.clear();
    renderStaged();
  });

  overlay.querySelector('#upload-close').addEventListener('pointerup', () => overlay.remove());
  overlay.querySelector('#upload-cancel').addEventListener('pointerup', () => overlay.remove());
  overlay.addEventListener('pointerup', (e) => { if (e.target === overlay) overlay.remove(); });
}
