/**
 * Discovery Workspace – Main App
 */

import { CandidateList } from './components/candidate-list.js';
import { CandidateDetail } from './components/candidate-detail.js';
import { renderSettingsModal, isConfigured, loadSettings } from './components/settings-modal.js';
import { renderUploadModal } from './components/upload-modal.js';
import { renderExportModal } from './components/export-modal.js';
import { loadStorageClient } from './lib/storage-client.js';
import { enrichBulk } from './lib/claude-api.js';
import { fetchTVEnrichment } from './lib/tv-enrichment.js';
import { MOCK_INBOX, MOCK_ARCHIVE, MOCK_EXPORT } from './lib/schema.js';
import { icons } from './lib/icons.js';

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
    badge.innerHTML = `${icons.sparkles} Mock-Modus`;
    badge.className = 'header-badge mock';
  } else {
    badge.innerHTML = `${icons.check} Backend verbunden`;
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

async function ensureBlob(blobType) {
  if (!allBlobs[blobType]) {
    allBlobs[blobType] = await loadBlob(blobType);
  }
  return allBlobs[blobType];
}

async function switchBlob(blobType) {
  currentBlobType = blobType;
  await ensureBlob(blobType);
  candidateList.setData(allBlobs[blobType].candidates);
}

/** Insert a candidate clone into a target blob's in-memory copy (mock mode). */
async function mockInsert(blobType, candidate) {
  const target = await ensureBlob(blobType);
  const clone = structuredClone(candidate);
  clone.last_updated_at = new Date().toISOString();
  target.candidates.push(clone);
  target.updated_at = new Date().toISOString();
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
    } else {
      await mockInsert('export', candidate);
    }
    blob.candidates = blob.candidates.filter((c) => c.id !== candidate.id);
    candidateList.setData(blob.candidates);
    candidateDetail.hide();
    toast(`✓ ${candidate.symbol} → Export (Tab „Export")`, 'success');
  }

  if (action === 'delete') {
    if (!confirm(`${candidate.symbol} endgültig aus „${currentBlobType}" löschen?`)) return;
    if (!useMock) {
      try {
        // Inbox delete → move to archive so the adapter won't re-add on next run.
        // Archive/export delete → true hard delete (adapters never write there).
        if (currentBlobType === 'inbox') {
          await storageClient.moveCandidate(candidate.id, 'inbox', 'archive');
          allBlobs.archive = null;
        } else {
          await storageClient.deleteCandidate(currentBlobType, candidate.id);
        }
      } catch (err) {
        toast(`Löschen fehlgeschlagen: ${err.message}`, 'error');
        return;
      }
    }
    blob.candidates = blob.candidates.filter((c) => c.id !== candidate.id);
    candidateList.setData(blob.candidates);
    candidateDetail.hide();
    toast(`🗑 ${candidate.symbol} gelöscht`, 'info');
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
    } else {
      await mockInsert('archive', candidate);
    }
    blob.candidates = blob.candidates.filter((c) => c.id !== candidate.id);
    candidateList.setData(blob.candidates);
    candidateDetail.hide();
    toast(`✗ ${candidate.symbol} → Archiv`, 'info');
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

  if (action === 'saveLinks') {
    candidate.links = extras.links;
    if (!useMock) {
      try {
        await storageClient.updateCandidate(currentBlobType, candidate.id, { links: extras.links });
      } catch (err) {
        toast(`Links speichern fehlgeschlagen: ${err.message}`, 'error');
        return;
      }
    }
    toast('Links aktualisiert', 'success', 1500);
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

  if (action === 'delete') {
    if (!confirm(`${targets.length} Kandidat(en) endgültig aus „${currentBlobType}" löschen?`)) return;
    for (const c of targets) {
      if (!useMock) {
        try {
          if (currentBlobType === 'inbox') {
            await storageClient.moveCandidate(c.id, 'inbox', 'archive');
            allBlobs.archive = null;
          } else {
            await storageClient.deleteCandidate(currentBlobType, c.id);
          }
        } catch (err) {
          toast(`Löschen fehlgeschlagen: ${c.symbol} – ${err.message}`, 'error');
          continue;
        }
      }
      blob.candidates = blob.candidates.filter((x) => x.id !== c.id);
    }
    candidateList.setData(blob.candidates);
    candidateDetail.hide();
    toast(`🗑 ${targets.length} Kandidat(en) gelöscht`, 'info');
    return;
  }

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

  if (action === 'tv-data') {
    if (useMock) { toast('TV Daten nicht im Mock-Modus verfügbar', 'error'); return; }

    const backendUrl = localStorage.getItem('discovery_backend_url');
    const secret     = localStorage.getItem('discovery_secret');
    if (!backendUrl || !secret) { toast('Backend nicht konfiguriert', 'error'); return; }

    toast(`📊 Lade TV Daten für ${targets.length} Kandidaten…`, 'info', 12000);

    let enrichments;
    try {
      enrichments = await fetchTVEnrichment(targets, {
        backendUrl,
        secret,
        onProgress: (msg) => toast(msg, 'info', 2000),
      });
    } catch (err) {
      toast(`TV Enrichment fehlgeschlagen: ${err.message}`, 'error');
      return;
    }

    // Apply updates in-memory
    const bulkUpdates = [];
    for (const [candidateId, updates] of enrichments) {
      const candidate = targets.find((c) => c.id === candidateId);
      if (!candidate) continue;
      Object.assign(candidate, updates);
      bulkUpdates.push({ candidate_id: candidateId, updates });
    }

    // Re-render immediately — data is already in memory
    candidateList.renderRows();
    toast(`📊 ${enrichments.size} Kandidaten mit TV Daten angereichert`, 'success');

    // Persist to backend best-effort
    try {
      await storageClient.bulkUpdateCandidates(currentBlobType, bulkUpdates);
    } catch (err) {
      toast(`Speichern fehlgeschlagen (UI bleibt aktuell): ${err.message}`, 'error');
    }
  }
}

/** Import candidates into inbox (mock = in-memory dedup, real = backend). */
async function importCandidates(candidates) {
  let added = 0, merged = 0, skipped = 0, errors = 0;

  if (useMock) {
    const inbox = await ensureBlob('inbox');
    for (const cand of candidates) {
      const existing = inbox.candidates.find(
        (c) => c.symbol === cand.symbol && c.exchange === cand.exchange,
      );
      if (existing) {
        existing.sources.push(...cand.sources);
        existing.last_updated_at = new Date().toISOString();
        merged++;
      } else {
        inbox.candidates.push(cand);
        added++;
      }
    }
  } else {
    for (const cand of candidates) {
      try {
        const result = await storageClient.appendCandidate(cand);
        if (result.action === 'inserted' || result.action === 'added') added++;
        else if (result.action === 'merged') merged++;
        else skipped++;
      } catch {
        errors++;
      }
    }
    allBlobs.inbox = null;
  }

  if (currentBlobType === 'inbox') await switchBlob('inbox');
  toast(`Import: ${added} neu, ${merged} gemergt${skipped ? `, ${skipped} übersprungen` : ''}`, 'success');
  return { added, merged, skipped, errors };
}

/** Open the Merkliste Schema-A export modal for the export blob. */
async function handleExport() {
  const exp = await ensureBlob('export');
  renderExportModal(exp.candidates, toast);
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

  // Inject Lucide icons into header buttons
  document.getElementById('btn-refresh').innerHTML = `${icons.refreshCw} Refresh`;
  document.getElementById('btn-upload').innerHTML = `${icons.upload} Import`;
  document.getElementById('btn-export').innerHTML = `${icons.download} Export`;
  document.getElementById('btn-settings').innerHTML = `${icons.settings} Einstellungen`;

  document.getElementById('btn-export').addEventListener('pointerup', handleExport);

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
    renderUploadModal({ onImport: importCandidates });
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
