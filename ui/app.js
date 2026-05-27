/**
 * Discovery Workspace – Main App
 */

import { CandidateList } from './components/candidate-list.js';
import { CandidateDetail } from './components/candidate-detail.js';
import { renderSettingsModal, isConfigured, loadSettings } from './components/settings-modal.js';
import { renderUploadModal } from './components/upload-modal.js';
import { loadStorageClient } from './lib/storage-client.js';
import { enrichBulk } from './lib/claude-api.js';
import { MOCK_INBOX, MOCK_ARCHIVE, MOCK_EXPORT } from './lib/schema.js';

let useMock = !isConfigured();
let currentBlobType = 'inbox';
let allBlobs = { inbox: null, archive: null, export: null };
let candidateList = null;
let candidateDetail = null;
let storageClient = null;

function toast(msg, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function updateMockBadge() {
  const badge = document.getElementById('mode-badge');
  if (!badge) return;
  if (useMock) {
    badge.textContent = '🔶 Mock-Modus';
    badge.className = 'header-badge mock';
  } else {
    badge.textContent = '✓ Backend verbunden';
    badge.className = 'header-badge';
  }
}

async function loadBlob(blobType) {
  if (useMock) {
    const map = { inbox: MOCK_INBOX, archive: MOCK_ARCHIVE, export: MOCK_EXPORT };
    return structuredClone(map[blobType]);
  }
  try {
    return await storageClient.readBlob(blobType);
  } catch (err) {
    toast(`Fehler beim Laden: ${err.message}`, 'error');
    return { schema_version: 'discovery-1.0', blob_type: blobType, updated_at: new Date().toISOString(), candidates: [] };
  }
}

async function switchBlob(blobType) {
  currentBlobType = blobType;
  if (!allBlobs[blobType]) {
    allBlobs[blobType] = await loadBlob(blobType);
  }
  candidateList.setData(allBlobs[blobType].candidates);
}

async function handleAction(action, candidate, extras = {}) {
  const blob = allBlobs[currentBlobType];
  if (!blob) return;

  if (action === 'blobSwitch') {
    await switchBlob(candidate); // candidate = blobType string in this case
    return;
  }

  if (action === 'promote') {
    candidate.workspace_state = 'promoted';
    if (!useMock) {
      try {
        await storageClient.moveCandidate(candidate.id, currentBlobType, 'export');
        allBlobs.export = null;
      } catch (err) {
        toast(`Promote fehlgeschlagen: ${err.message}`, 'error');
        return;
      }
    }
    blob.candidates = blob.candidates.filter((c) => c.id !== candidate.id);
    candidateList.setData(blob.candidates);
    toast(`✓ ${candidate.symbol} promoted`, 'success');
  }

  if (action === 'dismiss') {
    candidate.workspace_state = 'dismissed';
    if (!useMock) {
      try {
        await storageClient.moveCandidate(candidate.id, currentBlobType, 'archive');
        allBlobs.archive = null;
      } catch (err) {
        toast(`Dismiss fehlgeschlagen: ${err.message}`, 'error');
        return;
      }
    }
    blob.candidates = blob.candidates.filter((c) => c.id !== candidate.id);
    candidateList.setData(blob.candidates);
    toast(`✗ ${candidate.symbol} abgelehnt`, 'info');
  }

  if (action === 'review') {
    candidate.workspace_state = 'reviewed';
    if (!useMock) {
      try {
        await storageClient.updateCandidate(currentBlobType, candidate.id, { workspace_state: 'reviewed' });
      } catch (err) {
        toast(`Update fehlgeschlagen: ${err.message}`, 'error');
      }
    }
    candidateList.renderRows();
  }

  if (action === 'saveNotes') {
    if (!useMock) {
      try {
        await storageClient.updateCandidate(currentBlobType, candidate.id, { notes: extras.notes });
      } catch (err) {
        toast(`Notiz speichern fehlgeschlagen: ${err.message}`, 'error');
        return;
      }
    }
    toast('Notiz gespeichert', 'success');
  }

  if (action === 'enriched') {
    candidate.enrichment = extras.enrichment;
    if (!useMock) {
      try {
        await storageClient.updateCandidate(currentBlobType, candidate.id, { enrichment: extras.enrichment });
      } catch (err) {
        toast(`Enrichment speichern fehlgeschlagen: ${err.message}`, 'error');
        return;
      }
    }
    candidateList.renderRows();
    toast(`✨ ${candidate.symbol} enriched`, 'success');
  }
}

async function handleBulkAction(action, ids) {
  const blob = allBlobs[currentBlobType];
  if (!blob) return;
  const targets = blob.candidates.filter((c) => ids.includes(c.id));

  if (action === 'dismiss') {
    for (const c of targets) await handleAction('dismiss', c);
  }

  if (action === 'promote') {
    for (const c of targets) await handleAction('promote', c);
  }

  if (action === 'enrich') {
    const apiKey = localStorage.getItem('discovery_claude_key');
    if (!apiKey) {
      toast('Claude API Key nicht konfiguriert. Öffne die Einstellungen.', 'error');
      return;
    }

    toast(`✨ Enriching ${targets.length} Kandidaten…`, 'info', 8000);

    await enrichBulk(targets, {
      onProgress: (msg) => toast(msg, 'info', 2000),
      onResult: async (candidate, enrichment) => {
        candidate.enrichment = enrichment;
        if (!useMock) {
          try {
            await storageClient.updateCandidate(currentBlobType, candidate.id, { enrichment });
          } catch {
            // best-effort
          }
        }
      },
    });

    candidateList.renderRows();
    toast('✨ Bulk-Enrichment abgeschlossen', 'success');
  }
}

async function init() {
  // Init storage client
  if (!useMock) {
    storageClient = loadStorageClient();
    if (!storageClient) {
      useMock = true;
    }
  }

  updateMockBadge();

  // Init components
  const listPanel = document.getElementById('list-panel');
  const detailPanel = document.getElementById('detail-panel');

  candidateList = new CandidateList(listPanel, {
    onSelect: (candidate) => candidateDetail.show(candidate),
    onAction: handleAction,
    onBulkAction: handleBulkAction,
  });

  candidateDetail = new CandidateDetail(detailPanel, {
    onAction: handleAction,
  });

  // Load initial data
  await switchBlob('inbox');

  // Header buttons
  document.getElementById('btn-settings').addEventListener('pointerup', () => {
    renderSettingsModal(async () => {
      useMock = !isConfigured();
      storageClient = isConfigured() ? loadStorageClient() : null;
      allBlobs = { inbox: null, archive: null, export: null };
      updateMockBadge();
      await switchBlob(currentBlobType);
      toast('Einstellungen gespeichert', 'success');
    });
  });

  document.getElementById('btn-upload').addEventListener('pointerup', () => {
    renderUploadModal(async () => {
      allBlobs.inbox = null;
      if (currentBlobType === 'inbox') await switchBlob('inbox');
    });
  });

  document.getElementById('btn-refresh').addEventListener('pointerup', async () => {
    allBlobs[currentBlobType] = null;
    await switchBlob(currentBlobType);
    toast('Aktualisiert', 'info', 1500);
  });

  // Show settings on first run
  if (!isConfigured()) {
    toast('Willkommen! Läuft im Mock-Modus. Einstellungen für echtes Backend.', 'info', 5000);
  }
}

document.addEventListener('DOMContentLoaded', init);
