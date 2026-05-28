/**
 * Export Modal – shows the Merkliste Schema-A JSON for the export blob,
 * auto-copies it to the clipboard, and offers a download.
 */

import { toMerklisteSchemaA } from '../lib/merkliste-export.js';

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  // Fallback for file:// / non-secure contexts
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function renderExportModal(candidates, toast) {
  const schemaA = toMerklisteSchemaA(candidates);
  const json = JSON.stringify(schemaA, null, 2);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal export-modal">
      <div class="modal-header">
        <h2>Export → Merkliste (Schema A)</h2>
        <button class="modal-close" id="export-close">✕</button>
      </div>
      <div class="modal-body">
        <p>${candidates.length} Kandidat(en) aus dem Export-Blob im Merkliste-JSON-Format.
        Inhalt wurde automatisch in die Zwischenablage kopiert.</p>
        <div id="export-copy-status" class="upload-status upload-status--info" style="display:none"></div>
        <textarea id="export-json" class="export-textarea" readonly>${json}</textarea>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="export-download">Download .json</button>
        <button class="btn btn-primary" id="export-copy">In Zwischenablage kopieren</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const statusEl = overlay.querySelector('#export-copy-status');
  const setStatus = (msg, ok = true) => {
    statusEl.textContent = msg;
    statusEl.className = `upload-status upload-status--${ok ? 'success' : 'warning'}`;
    statusEl.style.display = 'block';
  };

  const doCopy = async () => {
    const ok = await copyText(json);
    if (ok) setStatus('✓ In Zwischenablage kopiert.', true);
    else setStatus('Kopieren nicht möglich – Text manuell markieren.', false);
  };

  // Auto-copy on open (per spec: "auto copy in Zwischenablage")
  if (candidates.length > 0) doCopy();
  else setStatus('Export-Blob ist leer – nichts zu kopieren.', false);

  overlay.querySelector('#export-copy').addEventListener('pointerup', doCopy);

  overlay.querySelector('#export-download').addEventListener('pointerup', () => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `merkliste-import-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast?.('Download gestartet', 'info', 1500);
  });

  overlay.querySelector('#export-close').addEventListener('pointerup', () => overlay.remove());
  overlay.addEventListener('pointerup', (e) => { if (e.target === overlay) overlay.remove(); });
}
