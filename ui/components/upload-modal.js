/**
 * Upload Modal – manual JSON blob upload
 */

import { loadStorageClient } from '../lib/storage-client.js';

function validateBlob(blob) {
  const errors = [];
  if (!blob || typeof blob !== 'object') return { valid: false, errors: ['Not a JSON object'] };
  if (blob.schema_version !== 'discovery-1.0') errors.push('schema_version must be "discovery-1.0"');
  if (!['inbox', 'archive', 'export'].includes(blob.blob_type)) errors.push(`Invalid blob_type: ${blob.blob_type}`);
  if (!Array.isArray(blob.candidates)) errors.push('candidates must be an array');
  return { valid: errors.length === 0, errors };
}

export function renderUploadModal(onComplete) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal upload-modal">
      <div class="modal-header">
        <h2>📤 JSON Upload</h2>
        <button class="modal-close" id="upload-close">✕</button>
      </div>
      <div class="modal-body">
        <p>Lade eine Discovery-Blob-JSON-Datei hoch. Kandidaten werden einzeln mit Dedup-Logik in den Inbox geschoben.</p>
        <div class="upload-area" id="upload-dropzone">
          <div class="upload-icon">📂</div>
          <p>JSON-Datei hier ablegen oder klicken</p>
          <input type="file" id="upload-file" accept=".json" style="display:none">
        </div>
        <div id="upload-status" class="upload-status" style="display:none"></div>
        <div id="upload-errors" class="upload-errors" style="display:none"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="upload-cancel">Schließen</button>
        <button class="btn btn-primary" id="upload-submit" disabled>Hochladen</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  let parsedBlob = null;

  const fileInput = overlay.querySelector('#upload-file');
  const dropzone = overlay.querySelector('#upload-dropzone');
  const statusEl = overlay.querySelector('#upload-status');
  const errorsEl = overlay.querySelector('#upload-errors');
  const submitBtn = overlay.querySelector('#upload-submit');

  function showErrors(errors) {
    errorsEl.innerHTML = `<strong>Fehler:</strong><ul>${errors.map((e) => `<li>${e}</li>`).join('')}</ul>`;
    errorsEl.style.display = 'block';
    statusEl.style.display = 'none';
    submitBtn.disabled = true;
    parsedBlob = null;
  }

  function showStatus(msg, type = 'info') {
    statusEl.textContent = msg;
    statusEl.className = `upload-status upload-status--${type}`;
    statusEl.style.display = 'block';
    errorsEl.style.display = 'none';
  }

  function processFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      let blob;
      try {
        blob = JSON.parse(e.target.result);
      } catch {
        showErrors(['Ungültige JSON-Datei']);
        return;
      }
      const { valid, errors } = validateBlob(blob);
      if (!valid) {
        showErrors(errors);
        return;
      }
      parsedBlob = blob;
      showStatus(`✓ ${blob.candidates.length} Kandidaten bereit zum Upload`, 'success');
      submitBtn.disabled = false;
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

  submitBtn.addEventListener('pointerup', async () => {
    if (!parsedBlob) return;
    submitBtn.disabled = true;
    showStatus('Uploading…', 'info');

    const client = loadStorageClient();
    if (!client) {
      showErrors(['Backend nicht konfiguriert. Gehe zu Einstellungen.']);
      return;
    }

    let added = 0, merged = 0, skipped = 0, errors = 0;
    for (const candidate of parsedBlob.candidates) {
      try {
        const result = await client.appendCandidate(candidate);
        if (result.action === 'added') added++;
        else if (result.action === 'merged') merged++;
        else skipped++;
      } catch {
        errors++;
      }
    }

    showStatus(
      `✓ Fertig: ${added} neu, ${merged} gemergt, ${skipped} übersprungen${errors ? `, ${errors} Fehler` : ''}`,
      errors > 0 ? 'warning' : 'success',
    );
    onComplete?.();
  });

  overlay.querySelector('#upload-close').addEventListener('pointerup', () => overlay.remove());
  overlay.querySelector('#upload-cancel').addEventListener('pointerup', () => overlay.remove());
  overlay.addEventListener('pointerup', (e) => { if (e.target === overlay) overlay.remove(); });
}
