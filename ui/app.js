/**
 * Discovery Workspace – Main App
 */

import { CandidateList } from './components/candidate-list.js?v=20260707e';
import { CandidateDetail } from './components/candidate-detail.js?v=20260708a';
import { renderSettingsModal, isConfigured, loadSettings } from './components/settings-modal.js';
import { renderUploadModal } from './components/upload-modal.js';
import { renderScreenerModal } from './components/screener-modal.js?v=20260621a';
import { renderExportModal } from './components/export-modal.js';
import { renderAlertModal } from './components/alert-modal.js?v=20260704e';
import { openTriggerEditor } from './components/trigger-modal.js?v=20260704k';
import { triggeredCount } from './lib/alerts.js?v=20260704e';
import { renderMarketsModal } from './components/markets-modal.js?v=20260707d';
import { renderDashboardModal } from './components/dashboard-modal.js?v=20260707c';
import { loadStorageClient } from './lib/storage-client.js?v=20260702d';
import { enrichBulk } from './lib/claude-api.js';
import { fetchTVEnrichment, fetchFxRate, fetchMarketIndicators } from './lib/tv-enrichment.js?v=20260707e';
import { trackSignals } from './lib/signal-tracker.js?v=20260707c';
import { fetchCompanyProfile } from './lib/company-profile.js?v=20260708a';
import { fetchLsQuote } from './lib/ls-intraday.js?v=20260626d';
import { buildResearchPrompt } from './lib/research-prompt.js?v=20260616a';
import { resolvePrimaryByIsin } from './lib/symbol-search.js?v=20260614c';
import { buildLinks } from './lib/link-builder.js';
import { normalizeExchange } from './lib/exchange-map.js';
import { MOCK_INBOX, MOCK_ARCHIVE, MOCK_EXPORT, MOCK_WATCH } from './lib/schema.js';
import { icons } from './lib/icons.js?v=20260702a';
import { ADAPTERS, triggerAdapter, hasGithubPat } from './lib/adapter-trigger.js?v=20260604b';
import { fetchMerklisteEntries, applyMerklisteEntries } from './lib/merkliste-import.js?v=20260625c';
import { fetchSwingAnalysis, isUsTicker, swingErrorText } from './lib/tv-swings.js?v=20260704i';

// ── Inline Lucide SVG for shell icons ─────────────────────────────────────────
const luc = (d, s = 20) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const L = {
  refresh:  luc('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
  zap:      luc('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  upload:   luc('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'),
  scope:    luc('<circle cx="17" cy="3" r="2"/><path d="M2 22 13 11"/><path d="m10.3 10.3 10.7-7 2.7 2.7-7 10.7"/><path d="m5.3 15.3 3.4 3.4"/>'),
  sun:      luc('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>'),
  moon:     luc('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
  download: luc('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  settings: luc('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
  home:     luc('<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
  intraday: luc('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>'),
  bell:     luc('<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>'),
  inbox:    luc('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
  portfolio:luc('<rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>'),
  markets:  luc('<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>'),
  archive:  luc('<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>'),
  checkSq:  luc('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>'),
  bookmark: luc('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>'),
  activity: luc('<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>', 16),
};

// ── UI state (persisted) ───────────────────────────────────────────────────────
const UI_KEY = 'discovery.ui.v1';
const uiState = (() => {
  const def = { view: 'standard', bucket: 'inbox', theme: 'light', fState: '', fCap: '', fSector: '', fBroker: '', fScore: '', fTr: '', fAlerts: '', currency: 'USD' };
  let s;
  try { s = { ...def, ...JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') }; }
  catch { s = { ...def }; }
  // Migrate persisted view modes from the old 3-view layout
  if (!['standard', 'trade', 'score', 'meta', 'price', 'fundamentals'].includes(s.view)) s.view = 'standard';
  return s;
})();
function saveUiState() {
  try { localStorage.setItem(UI_KEY, JSON.stringify(uiState)); } catch {}
}

// ── App globals ────────────────────────────────────────────────────────────────
let useMock = !isConfigured();
let currentBlobType = uiState.bucket ?? 'inbox';
let allBlobs = { inbox: null, archive: null, export: null, watch: null };
let candidateList = null;
let candidateDetail = null;
let storageClient = null;
let merklisteMaps = null; // { bySym } of entry_price_manual from merkliste "main"

// Sheet open-state tracking (avoids querying class lists in conditionals)
let detailSheetOpen = false;
let returnToMonitor = null; // set when a detail sheet is opened from the Monitor dashboard
let bucketSheetOpen = false;
let runSheetOpen = false;

// ── Toast ──────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ── EUR/USD exchange rate ──────────────────────────────────────────────────────
// Live rate (cached from the TV forex scanner) takes precedence over the
// manual value from the settings modal.
function resolveFxRate() {
  const live = parseFloat(localStorage.getItem('discovery_fx_eurusd_live') ?? '');
  if (Number.isFinite(live) && live > 0) return live;
  const manual = parseFloat((localStorage.getItem('discovery_fx_eurusd') ?? '').replace(',', '.'));
  return Number.isFinite(manual) && manual > 0 ? manual : null;
}

async function refreshFxRate() {
  const backendUrl = localStorage.getItem('discovery_backend_url');
  const secret     = localStorage.getItem('discovery_secret');
  if (!backendUrl || !secret) return;
  const rate = await fetchFxRate({ backendUrl, secret });
  if (rate) {
    localStorage.setItem('discovery_fx_eurusd_live', String(rate));
    candidateList?.setFxRate(rate);
  }
}

// ── Momentum-Check für ausgewählte Ticker ──────────────────────────────────────
async function runMomentumCheckForSelection() {
  if (!candidateList) return;
  const ids = [...candidateList.selected];
  if (ids.length === 0) {
    toast('Ticker per Checkbox auswählen, dann Momentum-Check starten', 'info', 3500);
    return;
  }
  const updates = candidateList.runMomentumCheck(ids);
  const verdicts = updates.map((u) => u.updates.momentum_check?.verdict);
  const g = verdicts.filter((v) => v === 'green').length;
  const y = verdicts.filter((v) => v === 'yellow').length;
  const r = verdicts.filter((v) => v === 'red').length;
  const n = verdicts.filter((v) => v == null).length;
  toast(`Momentum-Check: 🟢 ${g} · 🟡 ${y} · 🔴 ${r}${n ? ` · ${n}× zu wenig Daten` : ''}`, 'success', 5000);

  if (!useMock) {
    try {
      await storageClient.bulkUpdateCandidates(currentBlobType, updates);
    } catch (err) {
      toast(`Speichern fehlgeschlagen (UI bleibt aktuell): ${err.message}`, 'error');
    }
  }
}

// ── Trade Republic check für ausgewählte Ticker ─────────────────────────────────
async function runTrCheckForSelection(idsArg) {
  if (!candidateList) return;
  const ids = idsArg ?? [...candidateList.selected];
  if (ids.length === 0) {
    toast('Ticker per Checkbox auswählen, dann TR-Check starten', 'info', 3500);
    return;
  }
  if (useMock) { toast('TR-Check nicht im Mock-Modus verfügbar (Backend nötig)', 'error'); return; }
  const backendUrl = localStorage.getItem('discovery_backend_url');
  const secret     = localStorage.getItem('discovery_secret');
  if (!backendUrl || !secret) { toast('Backend nicht konfiguriert', 'error'); return; }

  // LS matching needs an ISIN. Backfill missing ISINs via the TV scanner first
  // so a single TR-Check works without a separate "TV Daten" run.
  const blob = allBlobs[currentBlobType];
  const isISIN = (v) => /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(String(v ?? '').toUpperCase());
  const missing = (blob?.candidates ?? []).filter((c) => ids.includes(c.id) && !isISIN(c.isin));
  if (missing.length) {
    toast(`🔍 Lade ISIN via TV für ${missing.length} Ticker…`, 'info', 10000);
    try {
      const enr = await fetchTVEnrichment(missing, { backendUrl, secret });
      const tvUpdates = [];
      for (const [cid, upd] of enr) {
        const c = missing.find((x) => x.id === cid);
        if (c) { Object.assign(c, upd); tvUpdates.push({ candidate_id: cid, updates: upd }); }
      }
      if (tvUpdates.length) await storageClient.bulkUpdateCandidates(currentBlobType, tvUpdates).catch(() => {});
    } catch (err) {
      console.warn('[TR] ISIN backfill failed:', err.message);
    }
  }

  toast(`🛒 Prüfe Trade-Republic-Handelbarkeit für ${ids.length} Ticker…`, 'info', 12000);
  let updates;
  try {
    updates = await candidateList.runTrCheck(ids, { backendUrl, secret });
  } catch (err) {
    toast(`TR-Check fehlgeschlagen: ${err.message}`, 'error');
    return;
  }
  const yes = updates.filter((u) => u.updates.tr_check?.tradable === true).length;
  const no  = updates.filter((u) => u.updates.tr_check?.tradable === false).length;
  const unk = updates.length - yes - no;
  toast(`TR-Check: ✓ ${yes} handelbar · ✗ ${no} nicht · ${unk ? `? ${unk} unklar` : ''}`.trim(), 'success', 6000);

  try {
    await storageClient.bulkUpdateCandidates(currentBlobType, updates);
  } catch (err) {
    toast(`Speichern fehlgeschlagen (UI bleibt aktuell): ${err.message}`, 'error');
  }
}

// ── Lang & Schwarz Echtzeitkurs für ausgewählte Ticker ──────────────────────────
async function runLsQuoteForSelection(idsArg) {
  if (!candidateList) return;
  const ids = idsArg ?? [...candidateList.selected];
  if (ids.length === 0) {
    toast('Ticker per Checkbox auswählen, dann LS-Kurs starten', 'info', 3500);
    return;
  }
  if (useMock) { toast('LS-Kurs nicht im Mock-Modus verfügbar (Backend nötig)', 'error'); return; }
  const backendUrl = localStorage.getItem('discovery_backend_url');
  const secret     = localStorage.getItem('discovery_secret');
  if (!backendUrl || !secret) { toast('Backend nicht konfiguriert', 'error'); return; }

  // LS resolves via the cached ls_id (from a prior TR-Check) or, failing that, the
  // ISIN. Backfill missing ISINs via TV so the lookup can succeed in one click.
  const blob = allBlobs[currentBlobType];
  const isISIN = (v) => /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(String(v ?? '').toUpperCase());
  const missing = (blob?.candidates ?? []).filter(
    (c) => ids.includes(c.id) && c.tr_check?.ls_id == null && !isISIN(c.isin),
  );
  if (missing.length) {
    toast(`🔍 Lade ISIN via TV für ${missing.length} Ticker…`, 'info', 10000);
    try {
      const enr = await fetchTVEnrichment(missing, { backendUrl, secret });
      const tvUpdates = [];
      for (const [cid, upd] of enr) {
        const c = missing.find((x) => x.id === cid);
        if (c) { Object.assign(c, upd); tvUpdates.push({ candidate_id: cid, updates: upd }); }
      }
      if (tvUpdates.length) await storageClient.bulkUpdateCandidates(currentBlobType, tvUpdates).catch(() => {});
    } catch (err) { console.warn('[LS] ISIN backfill failed:', err.message); }
  }

  toast(`📈 Lade LS-Echtzeitkurse für ${ids.length} Ticker…`, 'info', 12000);
  let updates;
  try {
    updates = await candidateList.runLsQuote(ids, { backendUrl, secret });
  } catch (err) {
    toast(`LS-Kurs fehlgeschlagen: ${err.message}`, 'error');
    return;
  }
  const ok   = updates.filter((u) => u.updates.ls_quote?.price != null).length;
  const fail = updates.length - ok;
  toast(`LS-Kurs: 📈 ${ok} geladen${fail ? ` · ${fail} ohne Kurs` : ''} · Spalte „LS“ in der Preis-Ansicht`, 'success', 6000);

  try {
    await storageClient.bulkUpdateCandidates(currentBlobType, updates);
  } catch (err) {
    toast(`Speichern fehlgeschlagen (UI bleibt aktuell): ${err.message}`, 'error');
  }
}

// ── Alert-Overview modal (Home nav slot) ────────────────────────────────────────
// Replaces the former Intra-Day modal: lists every candidate that has alerts,
// with a global mute and per-alert enable/disable. Persists enabled-changes.
function persistAlerts(id, alerts) {
  if (useMock || !storageClient) return Promise.resolve();
  return storageClient.updateCandidate(currentBlobType, id, { alerts });
}

function openAlertModal() {
  const blob = allBlobs[currentBlobType];
  const candidates = candidateList ? candidateList.candidates : (blob?.candidates ?? []);
  renderAlertModal({
    candidates,
    toast,
    onSaveAlerts: (id, alerts) => { const p = persistAlerts(id, alerts); candidateList?.renderRows(); updateAlertBadge(); return p; },
    onSetMute: (m) => (useMock || !storageClient ? Promise.resolve() : storageClient.writeConfig({ alerts_muted: m })),
    // Tap a row → open the alert editor (add / modify alerts).
    onOpenEditor: (candidate) => {
      openTriggerEditor(candidate, {
        onSaveAlerts: (id, alerts) => { const p = persistAlerts(id, alerts); candidateList?.renderRows(); updateAlertBadge(); return p; },
        onSaved: () => { candidateList?.renderRows(); updateAlertBadge(); },
        toast,
      });
    },
  });
}

// Red sub-nav badge: number of currently-triggered alerts (hidden when 0).
function updateAlertBadge() {
  const badge = document.getElementById('alert-badge-count');
  if (!badge) return;
  const n = candidateList ? triggeredCount(candidateList.candidates) : 0;
  badge.textContent = String(n);
  badge.hidden = n === 0;
}

// ── LS snapshot history (Trade view: Breakout/Breakdown/Bottom signals) ────────
// The nightly snapshot-ls function keeps a 10-day rolling history per
// watch-bucket ticker. Loaded once per session (single blob read), attached to
// the candidates as `c.ls_history` (snapshot array) for the Trade-view signals.
let lsHistoryMap = null;

async function loadLsHistory(force = false) {
  if (useMock || !storageClient) return;
  if (force || !lsHistoryMap) {
    try {
      const doc = await storageClient.readLsHistory();
      lsHistoryMap = doc?.history ?? {};
    } catch (err) {
      console.warn('[ls-history] load failed:', err.message);
      return;
    }
  }
  const blob = allBlobs[currentBlobType];
  if (!blob?.candidates || !candidateList) return;
  for (const c of blob.candidates) c.ls_history = lsHistoryMap[c.id]?.snapshots ?? null;
  candidateList.renderRows();
}

// ── Merkliste portfolio import (Einstand column) ────────────────────────────────
// Pull entry_price_manual from the merkliste "main" blob and attach it to the
// matching candidates as `mk_entry` (matched by symbol). Held in memory only
// (merkliste stays the source of truth); re-fetched on load and manual refresh.
async function loadMerklisteEntries(force = false) {
  if (useMock) return;
  const backendUrl = localStorage.getItem('discovery_backend_url');
  const secret     = localStorage.getItem('discovery_secret');
  if (!backendUrl || !secret) return;
  if (force || !merklisteMaps) {
    try {
      merklisteMaps = await fetchMerklisteEntries({ backendUrl, secret });
    } catch (err) {
      console.warn('[merkliste] entry import failed:', err.message);
      return;
    }
  }
  const blob = allBlobs[currentBlobType];
  if (!merklisteMaps || !blob?.candidates || !candidateList) return;
  applyMerklisteEntries(blob.candidates, merklisteMaps);
  candidateList.renderRows(); // mutate-in-place re-render; keeps selection intact
}

// ── Mode badge ─────────────────────────────────────────────────────────────────
function updateMockBadge() {
  const badge = document.getElementById('mode-badge');
  if (!badge) return;
  if (useMock) {
    badge.textContent = 'Mock';
    badge.className = 'mode-badge mode-badge--mock';
  } else {
    badge.textContent = 'Live';
    badge.className = 'mode-badge mode-badge--live';
  }
}

// ── Theme ──────────────────────────────────────────────────────────────────────
function applyTheme() {
  document.documentElement.setAttribute('data-theme', uiState.theme);
  const btn = document.getElementById('btn-theme');
  if (btn) btn.innerHTML = uiState.theme === 'dark' ? L.sun : L.moon;
}

function toggleTheme() {
  uiState.theme = uiState.theme === 'dark' ? 'light' : 'dark';
  saveUiState();
  applyTheme();
}

// ── Shell rendering ────────────────────────────────────────────────────────────
function renderTopbar() {
  document.getElementById('btn-refresh').innerHTML  = L.refresh;
  document.getElementById('btn-run').innerHTML      = L.zap;
  document.getElementById('btn-screener').innerHTML = L.scope;
  document.getElementById('btn-upload').innerHTML   = L.upload;
  document.getElementById('btn-theme').innerHTML    = uiState.theme === 'dark' ? L.sun : L.moon;
  document.getElementById('btn-export').innerHTML   = L.download;
  document.getElementById('btn-settings').innerHTML = L.settings;
}

function renderSubbar() {
  const tabs = [
    { key: 'standard',     label: 'Standard' },
    { key: 'trade',        label: 'Trade' },
    { key: 'score',        label: 'Score' },
    { key: 'meta',         label: 'Meta' },
    { key: 'price',        label: 'Preis' },
    { key: 'fundamentals', label: 'Fundamental' },
  ];
  const vs = document.getElementById('view-switch');
  vs.innerHTML =
    tabs.map(({ key, label }) =>
      `<button class="seg-btn${uiState.view === key ? ' seg-btn--active' : ''}" data-view="${key}" role="tab" aria-selected="${uiState.view === key}">${label}</button>`
    ).join('') +
    `<button class="seg-btn seg-btn--currency" id="currency-toggle" title="Preisanzeige USD/EUR umschalten (nur USD↔EUR wird umgerechnet)">${uiState.currency === 'EUR' ? '€ EUR' : '$ USD'}</button>`;
  vs.querySelector('#currency-toggle').addEventListener('click', () => {
    uiState.currency = uiState.currency === 'EUR' ? 'USD' : 'EUR';
    saveUiState();
    document.getElementById('currency-toggle').textContent = uiState.currency === 'EUR' ? '€ EUR' : '$ USD';
    if (!candidateList.hasFxRate() && resolveFxRate() == null) {
      toast('Kein EUR/USD-Kurs verfügbar – Kurs in Einstellungen eintragen oder TV Daten laden', 'error', 4500);
    }
    candidateList.setDisplayCurrency(uiState.currency);
  });
  vs.querySelectorAll('.seg-btn[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      uiState.view = btn.dataset.view;
      saveUiState();
      candidateList.setViewMode(uiState.view);
      vs.querySelectorAll('.seg-btn').forEach((b) => {
        b.classList.toggle('seg-btn--active', b.dataset.view === uiState.view);
        b.setAttribute('aria-selected', String(b.dataset.view === uiState.view));
      });
    });
  });

  // Sub-nav alert button (static element) — wire once.
  const alertBtn = document.getElementById('subnav-alert');
  if (alertBtn && !alertBtn.dataset.wired) {
    alertBtn.dataset.wired = '1';
    document.getElementById('subnav-alert-icon').innerHTML = L.bell;
    alertBtn.addEventListener('pointerup', openAlertModal);
  }
  updateAlertBadge();
}

function renderFilterbar() {
  const fb = document.getElementById('filterbar');
  const sectors = candidateList ? candidateList.getSectors() : [];

  fb.innerHTML = `
    <span id="pill-selected-wrap"></span>
    <button class="filter-star${uiState.fBroker === 'star' ? ' is-active' : ''}" id="portfolio-toggle" aria-pressed="${uiState.fBroker === 'star'}" title="Nur Portfolio-Ticker (★) anzeigen">★</button>
    <button class="filter-star${uiState.fAlerts === 'active' ? ' is-active' : ''}" id="alerts-toggle" aria-pressed="${uiState.fAlerts === 'active'}" title="Nur Ticker mit aktiven Alerts anzeigen">🔔</button>
    <select class="filter-select" id="filter-score" title="Filter nach Overall-Score">
      <option value="">Score</option>
      <option value="80"${uiState.fScore === '80' ? ' selected' : ''}>Score ≥ 80</option>
      <option value="70"${uiState.fScore === '70' ? ' selected' : ''}>Score 70–79</option>
      <option value="60"${uiState.fScore === '60' ? ' selected' : ''}>Score 60–69</option>
      <option value="40"${uiState.fScore === '40' ? ' selected' : ''}>Score 40–59</option>
      <option value="0"${uiState.fScore === '0' ? ' selected' : ''}>Score &lt; 40</option>
    </select>
    <select class="filter-select" id="filter-sector" title="Filter nach Sektor">
      <option value="">Sectors</option>
      <option value="__no_sector__"${uiState.fSector === '__no_sector__' ? ' selected' : ''}>— Ohne Sektor</option>
      ${sectors.map((s) => `<option value="${s}"${uiState.fSector === s ? ' selected' : ''}>${s}</option>`).join('')}
    </select>
    <select class="filter-select" id="filter-cap" title="Filter nach Marktkapitalisierung">
      <option value="">Size</option>
      <option value="micro"${uiState.fCap === 'micro' ? ' selected' : ''}>Micro</option>
      <option value="small"${uiState.fCap === 'small' ? ' selected' : ''}>Small</option>
      <option value="mid"${uiState.fCap === 'mid' ? ' selected' : ''}>Mid</option>
      <option value="large"${uiState.fCap === 'large' ? ' selected' : ''}>Large</option>
    </select>
    <select class="filter-select" id="filter-tr" title="Filter nach Trade-Republic-Handelbarkeit">
      <option value="">TR</option>
      <option value="no"${uiState.fTr === 'no' ? ' selected' : ''}>✗ nicht handelbar</option>
      <option value="yes"${uiState.fTr === 'yes' ? ' selected' : ''}>✓ handelbar</option>
      <option value="unchecked"${uiState.fTr === 'unchecked' ? ' selected' : ''}>? ungeprüft</option>
    </select>`;

  fb.querySelector('#portfolio-toggle').addEventListener('click', () => {
    const on = uiState.fBroker !== 'star';
    uiState.fBroker = on ? 'star' : '';
    saveUiState();
    candidateList.setFilter('broker', uiState.fBroker);
    const btn = fb.querySelector('#portfolio-toggle');
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', String(on));
  });

  fb.querySelector('#alerts-toggle').addEventListener('click', () => {
    const on = uiState.fAlerts !== 'active';
    uiState.fAlerts = on ? 'active' : '';
    saveUiState();
    candidateList.setFilter('alerts', uiState.fAlerts);
    const btn = fb.querySelector('#alerts-toggle');
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', String(on));
  });

  fb.querySelector('#filter-score').addEventListener('change', (e) => {
    uiState.fScore = e.target.value;
    saveUiState();
    candidateList.setFilter('score', uiState.fScore);
  });

  fb.querySelector('#filter-sector').addEventListener('change', (e) => {
    uiState.fSector = e.target.value;
    saveUiState();
    candidateList.setFilter('sector', uiState.fSector);
  });

  fb.querySelector('#filter-cap').addEventListener('change', (e) => {
    uiState.fCap = e.target.value;
    saveUiState();
    candidateList.setFilter('capSize', uiState.fCap);
  });

  fb.querySelector('#filter-tr').addEventListener('change', (e) => {
    uiState.fTr = e.target.value;
    saveUiState();
    candidateList.setFilter('tr', uiState.fTr);
  });

  renderSelectedPill();
}

/**
 * "Nur ausgewählte" filter pill — auto-appears in the filterbar when the
 * selection is non-empty. Body click toggles the filter; the × clears it.
 */
function renderSelectedPill() {
  const wrap = document.getElementById('pill-selected-wrap');
  if (!wrap || !candidateList) return;
  const count = candidateList.selected.size;
  if (count === 0) { wrap.innerHTML = ''; return; }

  const active = candidateList.showSelectedOnly;
  wrap.innerHTML =
    `<button class="pill pill--select${active ? ' pill--active' : ''}" id="pill-selected" title="Nur ausgewählte anzeigen">
      <span>✔️ (${count})</span>
      <span class="pill__x" id="pill-selected-clear" role="button" aria-label="Auswahl leeren">×</span>
    </button>`;

  document.getElementById('pill-selected').addEventListener('click', (e) => {
    if (e.target.closest('#pill-selected-clear')) {
      candidateList.clearSelection(); // fires onSelectionChange → re-renders this pill
      return;
    }
    candidateList.setShowSelectedOnly(!candidateList.showSelectedOnly);
    renderSelectedPill();
  });
}

function renderBotnav() {
  const bucketIcons  = { inbox: L.inbox, archive: L.archive, export: L.checkSq, watch: L.bookmark };
  const bucketLabels = { inbox: 'Inbox', archive: 'Archiv', export: 'Export', watch: 'Watch' };
  document.getElementById('nav-home-icon').innerHTML   = L.bell;
  document.getElementById('nav-bucket-icon').innerHTML = bucketIcons[currentBlobType] ?? L.inbox;
  document.getElementById('nav-bucket-label').textContent = bucketLabels[currentBlobType] ?? 'Inbox';
  document.getElementById('nav-portfolio-icon').innerHTML = L.portfolio;
  document.getElementById('nav-markets-icon').innerHTML   = L.markets;
  document.getElementById('nav-monitor-icon').innerHTML   = L.activity;
}

// ── Sheet management ───────────────────────────────────────────────────────────
function updateScrim() {
  document.getElementById('scrim').classList.toggle('is-open', detailSheetOpen || bucketSheetOpen || runSheetOpen);
}

function openDetailSheet() {
  detailSheetOpen = true;
  document.getElementById('detail-sheet').classList.add('is-open');
  updateScrim();
}

function closeDetailSheet() {
  detailSheetOpen = false;
  document.getElementById('detail-sheet').classList.remove('is-open');
  updateScrim();
  // If the sheet was opened from the Monitor dashboard, restore it (X or swipe).
  if (returnToMonitor) { const back = returnToMonitor; returnToMonitor = null; back(); }
}

// Mobile swipe navigation for the detail sheet: swipe left → next candidate,
// swipe right → previous. Gives a small damped drag feedback, then snaps back
// and steps to the neighbour. Only acts on clearly-horizontal gestures so
// vertical scrolling still works.
function initSheetSwipe(el, { onPrev, onNext } = {}) {
  let startX = 0, startY = 0, dx = 0, dragging = false, decided = false, horizontal = false;
  const THRESHOLD = 60;

  el.addEventListener('touchstart', (e) => {
    if (!el.classList.contains('is-open') || e.touches.length !== 1) return;
    // Don't hijack gestures that start inside the interactive Lightweight chart —
    // let it pan/zoom (horizontal drag would otherwise trigger prev/next).
    if (e.target.closest?.('.ls-chart')) { dragging = false; return; }
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    dx = 0; dragging = true; decided = false; horizontal = false;
    el.style.transition = 'none';
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      decided = true;
      horizontal = Math.abs(dx) > Math.abs(dy);
    }
    if (!horizontal) return;                  // vertical scroll → leave alone
    el.style.transform = `translateX(${(dx * 0.35).toFixed(0)}px)`; // damped feedback
  }, { passive: true });

  const end = () => {
    if (!dragging) return;
    dragging = false;
    el.style.transition = '';
    el.style.transform = '';                  // always snap back; navigation swaps content
    if (!horizontal) return;
    if (dx <= -THRESHOLD) onNext?.();
    else if (dx >= THRESHOLD) onPrev?.();
  };
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
}

function renderBucketSheet() {
  const buckets = [
    { key: 'inbox',   label: 'Inbox',  icon: L.inbox },
    { key: 'watch',   label: 'Watch',  icon: L.bookmark },
    { key: 'archive', label: 'Archiv', icon: L.archive },
    { key: 'export',  label: 'Export', icon: L.checkSq },
  ];
  const bs = document.getElementById('bucket-sheet');
  bs.innerHTML = `
    <h2 class="bucket-sheet__title">Bucket wählen</h2>
    ${buckets.map(({ key, label, icon }) =>
      `<button class="bucket-opt${currentBlobType === key ? ' bucket-opt--active' : ''}" data-bucket="${key}">
        ${icon}<span>${label}</span>
      </button>`
    ).join('')}`;
  bs.querySelectorAll('.bucket-opt[data-bucket]').forEach((btn) => {
    btn.addEventListener('pointerup', async () => {
      closeBucketSheet();
      await switchBlob(btn.dataset.bucket);
    });
  });
}

function openBucketSheet() {
  bucketSheetOpen = true;
  renderBucketSheet();
  document.getElementById('bucket-sheet').classList.add('is-open');
  updateScrim();
}

function closeBucketSheet() {
  bucketSheetOpen = false;
  document.getElementById('bucket-sheet').classList.remove('is-open');
  updateScrim();
}

// ── Run-adapter sheet ────────────────────────────────────────────────────────
// Manually dispatch an adapter's GitHub Action. Requires a GitHub PAT in
// Settings; the scrape itself runs on GitHub's runners and lands in the inbox.
function renderRunSheet() {
  const rs = document.getElementById('run-sheet');
  rs.innerHTML = `
    <h2 class="bucket-sheet__title">Adapter ausführen</h2>
    ${ADAPTERS.map(({ workflow, label }) =>
      `<button class="bucket-opt" data-wf="${workflow}" data-label="${label}">
        ${L.zap}<span>${label}</span>
      </button>`
    ).join('')}`;
  rs.querySelectorAll('.bucket-opt[data-wf]').forEach((btn) => {
    btn.addEventListener('pointerup', async () => {
      const { wf, label } = btn.dataset;
      closeRunSheet();

      if (!hasGithubPat()) {
        toast('GitHub PAT nicht konfiguriert (Einstellungen → GitHub PAT)', 'error', 4500);
        return;
      }

      toast(`⏳ Starte „${label}"…`, 'info', 4000);
      try {
        await triggerAdapter(wf);
        toast(`🚀 „${label}" gestartet – läuft via GitHub Actions. Später „Aktualisieren".`, 'success', 5000);
      } catch (err) {
        toast(`Start fehlgeschlagen: ${err.message}`, 'error', 6000);
      }
    });
  });
}

function openRunSheet() {
  runSheetOpen = true;
  renderRunSheet();
  document.getElementById('run-sheet').classList.add('is-open');
  updateScrim();
}

function closeRunSheet() {
  runSheetOpen = false;
  document.getElementById('run-sheet').classList.remove('is-open');
  updateScrim();
}

// ── Data loading ───────────────────────────────────────────────────────────────
async function loadBlob(blobType) {
  if (useMock) {
    const map = { inbox: MOCK_INBOX, archive: MOCK_ARCHIVE, export: MOCK_EXPORT, watch: MOCK_WATCH };
    return structuredClone(map[blobType] ?? { schema_version: 'discovery-1.0', blob_type: blobType, updated_at: new Date().toISOString(), candidates: [] });
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
  uiState.bucket = blobType;
  saveUiState();
  await ensureBlob(blobType);
  // Carry merkliste entry prices onto this bucket's candidates before first render.
  if (merklisteMaps) applyMerklisteEntries(allBlobs[blobType].candidates, merklisteMaps);
  // Attach the 10-day LS history (Trade-view signals) before first render;
  // if it isn't loaded yet, fetch it once in the background (re-renders rows).
  if (lsHistoryMap) {
    for (const c of allBlobs[blobType].candidates) c.ls_history = lsHistoryMap[c.id]?.snapshots ?? null;
  } else {
    loadLsHistory();
  }
  candidateList.setData(allBlobs[blobType].candidates);
  renderBotnav();
  renderFilterbar();
}

/** Candidate id from a `#c=<id>` deep link (ntfy push → detail sheet). */
function candidateIdFromHash() {
  const m = /[#&]c=([^&]+)/.exec(location.hash || '');
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Open a candidate's detail sheet by id, switching to whichever bucket holds
 * it (search order: current bucket first, then the alert-scanned buckets).
 * Used by the ntfy push deep link. Toasts when the candidate is gone (e.g.
 * dismissed between push and tap).
 */
async function openCandidateById(id) {
  if (!id) return false;
  const order = [currentBlobType, 'watch', 'inbox', 'export'].filter((b, i, a) => a.indexOf(b) === i);
  for (const bucket of order) {
    const blob = await ensureBlob(bucket).catch(() => null);
    if (blob?.candidates?.some((c) => c.id === id)) {
      if (bucket !== currentBlobType) await switchBlob(bucket);
      const cand = allBlobs[bucket]?.candidates?.find((c) => c.id === id);
      if (cand) {
        candidateDetail.show(cand);
        openDetailSheet();
        // Clear the hash (no reload, no hashchange) so tapping the same push
        // again re-triggers the deep link.
        history.replaceState(null, '', location.pathname + location.search);
        return true;
      }
    }
  }
  toast('Kandidat nicht mehr im Workspace', 'info', 3500);
  return false;
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

  if (action === 'isinCopied') {
    toast(`📋 ${extras.value} kopiert – in TR-Suche einfügen`, 'success', 2500);
    return;
  }

  // Detail toolbar: LS live quote for exactly this candidate, then repaint the sheet.
  if (action === 'lsQuote') {
    await runLsQuoteForSelection([candidate.id]);
    if (candidateDetail.candidate?.id === candidate.id) candidateDetail.render();
    return;
  }

  // Detail sheet: Firmenprofil lazy nachladen (Wikipedia de→en, CORS-direkt,
  // kein Proxy — läuft auch im Mock-Modus). {error:true} verhindert Re-Fire.
  if (action === 'loadProfile') {
    if (candidate._profile_loading || candidate.company_profile) return;
    const rerender = () => { if (candidateDetail.candidate?.id === candidate.id) candidateDetail.render(); };
    candidate._profile_loading = true; rerender();
    let profile = null;
    try { profile = await fetchCompanyProfile(candidate); }
    catch (err) { console.warn('[profile] fetch fehlgeschlagen:', err.message); }
    candidate._profile_loading = false;
    candidate.company_profile = profile ?? { error: true };
    rerender();
    return;
  }

  // Detail toolbar: Swing-Check (TwelveData OHLC → support/resistance zones).
  // On-demand, US-only (TD Free), persisted on the candidate as swing_analysis.
  if (action === 'tdQuote') {
    if (!isUsTicker(candidate)) { toast(swingErrorText('not_us'), 'info', 3500); return; }
    if (!localStorage.getItem('discovery_twelvedata_key')) { toast(swingErrorText('no_key'), 'error', 4000); return; }
    const rerender = () => { if (candidateDetail.candidate?.id === candidate.id) candidateDetail.render(); };
    candidate._swing_loading = true; rerender();
    let result;
    try {
      result = await fetchSwingAnalysis(candidate, { eurUsd: resolveFxRate() });
    } catch (err) {
      result = { error: 'td_error', message: err.message };
    }
    candidate._swing_loading = false;
    if (result?.error) { toast(swingErrorText(result.error), result.error === 'not_us' ? 'info' : 'error', 4000); rerender(); return; }
    candidate.swing_analysis = result;
    rerender();
    if (!useMock) {
      try {
        await storageClient.updateCandidate(currentBlobType, candidate.id, { swing_analysis: result });
      } catch (err) {
        toast(`Swing-Analyse nicht gespeichert: ${err.message}`, 'error');
      }
    }
    toast(`📐 Swing-Zonen aktualisiert (${result.bars} Bars)`, 'success', 2500);
    return;
  }

  if (action === 'export') {
    if (currentBlobType === 'export') {
      toast('Bereits im Export-Bucket', 'info', 2000);
      return;
    }
    if (!useMock) {
      try {
        await storageClient.moveCandidate(candidate.id, currentBlobType, 'export');
        allBlobs.export = null;
      } catch (err) {
        toast(`Export fehlgeschlagen: ${err.message}`, 'error');
        return;
      }
    } else {
      await mockInsert('export', candidate);
    }
    blob.candidates = blob.candidates.filter((c) => c.id !== candidate.id);
    candidateList.setData(blob.candidates);
    candidateDetail.hide();
    toast(`↗ ${candidate.symbol} → Export`, 'success');
    return;
  }

  if (action === 'setUserPrice') {
    const { field, value } = extras;
    if (!['my_entry', 'my_target'].includes(field)) return;
    const prev = candidate[field];
    candidate[field] = value;
    if (!useMock) {
      try {
        await storageClient.updateCandidate(currentBlobType, candidate.id, { [field]: value });
      } catch (err) {
        toast(`Speichern fehlgeschlagen: ${err.message}`, 'error');
        candidate[field] = prev; // revert
        candidateList.renderRows();
        return;
      }
    }
    // No re-render: the input already shows the value, and re-rendering would steal focus.
    return;
  }

  if (action === 'promote') {
    candidate.workspace_state = 'promoted';
    if (!useMock) {
      try {
        await storageClient.moveCandidate(candidate.id, currentBlobType, 'watch');
        allBlobs.watch = null;
      } catch (err) {
        toast(`Promote fehlgeschlagen: ${err.message}`, 'error');
        return;
      }
    } else {
      await mockInsert('watch', candidate);
    }
    blob.candidates = blob.candidates.filter((c) => c.id !== candidate.id);
    candidateList.setData(blob.candidates);
    candidateDetail.hide();
    toast(`✓ ${candidate.symbol} → Watch (Tab „Watch")`, 'success');
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

  if (action === 'toggleStar') {
    candidate.in_portfolio = !candidate.in_portfolio;
    if (!useMock) {
      try {
        await storageClient.updateCandidate(currentBlobType, candidate.id, { in_portfolio: candidate.in_portfolio });
      } catch (err) {
        toast(`Speichern fehlgeschlagen: ${err.message}`, 'error');
        candidate.in_portfolio = !candidate.in_portfolio; // revert
        return;
      }
    }
    candidateList.renderRows();
    return;
  }

  if (action === 'toggleBroker') {
    candidate.broker_armed = !candidate.broker_armed;
    if (!useMock) {
      try {
        await storageClient.updateCandidate(currentBlobType, candidate.id, { broker_armed: candidate.broker_armed });
      } catch (err) {
        toast(`Speichern fehlgeschlagen: ${err.message}`, 'error');
        candidate.broker_armed = !candidate.broker_armed; // revert
        return;
      }
    }
    candidateList.renderRows();
    return;
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

  if (action === 'openTrigger') {
    openTriggerEditor(candidate, {
      onSaveAlerts: persistAlerts,
      onSaved: () => candidateList.renderRows(),
      toast,
    });
    return;
  }

  // Tap on the detail chart → open the Trigger editor with the tapped price
  // (EUR) pre-filled into the manual-price field.
  if (action === 'chartAlert') {
    openTriggerEditor(candidate, {
      onSaveAlerts: persistAlerts,
      onSaved: () => candidateList.renderRows(),
      toast,
      prefillPriceEur: extras.priceEur,
    });
    return;
  }

  if (action === 'saveMerklisteSymbol') {
    candidate.merkliste_symbol = extras.value;
    if (!useMock) {
      try {
        await storageClient.updateCandidate(currentBlobType, candidate.id, { merkliste_symbol: extras.value });
      } catch (err) {
        toast(`Mapping speichern fehlgeschlagen: ${err.message}`, 'error');
        return;
      }
    }
    // Re-apply the merkliste portfolio map so Einstand/P/L pick up the new key.
    if (merklisteMaps) {
      applyMerklisteEntries(blob.candidates, merklisteMaps);
      candidateList.renderRows();
    }
    toast('Merkliste-Mapping gespeichert', 'success', 1500);
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

  if (action === 'export') {
    if (currentBlobType === 'export') {
      toast('Bereits im Export-Bucket', 'info', 2000);
      return;
    }
    for (const c of targets) {
      if (!useMock) {
        try {
          await storageClient.moveCandidate(c.id, currentBlobType, 'export');
          allBlobs.export = null;
        } catch (err) {
          toast(`Export fehlgeschlagen: ${c.symbol} – ${err.message}`, 'error');
          continue;
        }
      } else {
        await mockInsert('export', c);
      }
      blob.candidates = blob.candidates.filter((x) => x.id !== c.id);
    }
    candidateList.setData(blob.candidates);
    candidateDetail.hide();
    toast(`↗ ${targets.length} Ticker → Export`, 'success');
    return;
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

  if (action === 'copy-prompt') {
    const prompt = buildResearchPrompt(targets);
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // Clipboard API unavailable (e.g. file:// without permission) → textarea fallback
      const ta = document.createElement('textarea');
      ta.value = prompt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) { toast('Kopieren fehlgeschlagen – Clipboard nicht verfügbar', 'error'); return; }
    }
    toast(`📋 Research-Prompt für ${targets.length} Ticker kopiert – in AI-Suche einfügen`, 'success', 4000);
    return;
  }

  if (action === 'tr-check') {
    await runTrCheckForSelection(ids);
    return;
  }

  if (action === 'ls-quote') {
    await runLsQuoteForSelection(ids);
    return;
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

    // Feedback loop: record today's signals + evaluate matured ones, and let
    // the touched signal_logs ride the same bulk save (no extra request).
    const tracked = trackSignals(targets);
    for (const id of tracked.changedIds) {
      const c = targets.find((x) => x.id === id);
      if (!c) continue;
      const u = bulkUpdates.find((b) => b.candidate_id === id);
      if (u) u.updates.signal_log = c.signal_log;
      else bulkUpdates.push({ candidate_id: id, updates: { signal_log: c.signal_log } });
    }

    // Re-render immediately — data is already in memory
    candidateList.renderRows();
    const sigNote = tracked.recorded || tracked.evaluated
      ? ` · ${tracked.recorded} Signale erfasst${tracked.evaluated ? `, ${tracked.evaluated} ausgewertet` : ''}`
      : '';
    toast(`📊 ${enrichments.size} Kandidaten mit TV Daten angereichert${sigNote}`, 'success');

    // Persist to backend best-effort
    try {
      await storageClient.bulkUpdateCandidates(currentBlobType, bulkUpdates);
    } catch (err) {
      toast(`Speichern fehlgeschlagen (UI bleibt aktuell): ${err.message}`, 'error');
    }
  }
}

// Foreign ADRs/stocks that only have German regional listings (e.g. UMCB on
// Frankfurt/Gettex) are not in the TV scanner. Resolve them to their primary
// listing via the ISIN (UMCB → NYSE:UMC) so TV data can be fetched, and store
// the primary. Only foreign ISINs on a German venue are touched.
const GERMAN_VENUE_CODES = new Set([
  'XETR', 'FWB', 'XFRA', 'FRA', 'F', 'MUN', 'XMUN', 'STU', 'XSTU', 'SWB',
  'DUS', 'XDUS', 'BER', 'XBER', 'GETTEX', 'TRADEGATE', 'GAT', 'HAM', 'HAN', 'UNKNOWN',
]);

async function resolveForeignPrimaries(candidates) {
  for (const c of candidates) {
    if (!c.isin) continue;
    const home = String(c.isin).slice(0, 2).toUpperCase();
    const code = String(c.exchange ?? '').toUpperCase();
    const germanOrUnknown = GERMAN_VENUE_CODES.has(code) || normalizeExchange(c.exchange) === 'XETR' || !c.exchange;
    if (home === 'DE' || !germanOrUnknown) continue; // only foreign-on-German venues
    try {
      const p = await resolvePrimaryByIsin(c.isin);
      if (p && p.exchange && (p.symbol !== c.symbol || p.exchange !== c.exchange)) {
        c.sources?.push?.({
          adapter: 'system', source_url: '', discovered_at: new Date().toISOString(),
          signal_type: 'note', raw_signal: {},
          info_snippet: `Primärlisting via ISIN aufgelöst: ${c.exchange}:${c.symbol} → ${p.exchange}:${p.symbol}`,
        });
        c.symbol = p.symbol;
        c.exchange = p.exchange;
        c.yahoo_symbol = p.yahoo_symbol;
        c.links = buildLinks({ symbol: p.symbol, exchange: p.exchange, yahooSymbol: p.yahoo_symbol });
      }
    } catch { /* best-effort – keep original listing */ }
  }
  return candidates;
}

/** Import candidates into inbox (mock = in-memory dedup, real = backend). */
async function importCandidates(candidates) {
  let added = 0, merged = 0, skipped = 0, errors = 0;

  await resolveForeignPrimaries(candidates);

  if (useMock) {
    const inbox = await ensureBlob('inbox');
    // Inbox is a raw capture: always add, never merge on import.
    for (const cand of candidates) {
      inbox.candidates.push(cand);
      added++;
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
    if (!storageClient) useMock = true;
  }

  // Apply theme before anything renders
  applyTheme();

  // Render static shell parts
  renderTopbar();
  renderSubbar();
  renderBotnav();

  // Init components
  candidateList = new CandidateList({
    onSelect: (candidate) => {
      candidateDetail.show(candidate);
      openDetailSheet();
    },
    onAction: handleAction,
    onBulkAction: handleBulkAction,
    onSelectionChange: () => renderSelectedPill(),
    onAfterRender: () => updateAlertBadge(),
  });

  candidateDetail = new CandidateDetail(document.getElementById('detail-sheet'), {
    onAction: handleAction,
    onClose: closeDetailSheet,
    // Siblings = the candidates in the current table sort order, for prev/next.
    getSiblings: () => (candidateList ? candidateList.getSorted(candidateList.getFiltered()) : []),
  });
  initSheetSwipe(document.getElementById('detail-sheet'), {
    onPrev: () => candidateDetail.navigate(-1),
    onNext: () => candidateDetail.navigate(1),
  });

  // Apply saved view mode before first data load
  if (uiState.view !== 'standard') {
    candidateList.setViewMode(uiState.view);
  }

  // Apply saved filters directly (before setData so first render uses them)
  // State filter removed — state pills were removed from filterbar
  uiState.fState = '';
  candidateList.filters = {
    state:   '',
    sector:  uiState.fSector ?? '',
    capSize: uiState.fCap    ?? '',
    broker:  uiState.fBroker ?? '',
    score:   uiState.fScore  ?? '',
    tr:      uiState.fTr     ?? '',
    alerts:  uiState.fAlerts ?? '',
  };

  // Currency display: saved preference + best available EUR/USD rate,
  // then refresh the live rate from TV in the background.
  const fx = resolveFxRate();
  if (fx) candidateList.setFxRate(fx);
  if (uiState.currency !== 'USD') candidateList.setDisplayCurrency(uiState.currency);
  refreshFxRate();

  // Load initial data (also calls renderBotnav + renderFilterbar)
  await switchBlob(currentBlobType);

  updateMockBadge();

  // On load: pull merkliste "Einstand"/shares only. LS quotes are fetched
  // on demand (LS-Kurs button) — no automatic LS fetch on load.
  loadMerklisteEntries(true);

  // Deep link from an ntfy push (`#c=<id>`): open that candidate's detail
  // sheet on load, and on later hash changes (second push while app is open).
  if (candidateIdFromHash()) openCandidateById(candidateIdFromHash());
  window.addEventListener('hashchange', () => {
    const id = candidateIdFromHash();
    if (id) openCandidateById(id);
  });

  // ── Scrim + ESC ──────────────────────────────────────────────────────────────
  document.getElementById('scrim').addEventListener('pointerup', () => {
    if (detailSheetOpen) { candidateDetail.hide(); return; }
    if (bucketSheetOpen) { closeBucketSheet(); return; }
    if (runSheetOpen)    { closeRunSheet(); return; }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (detailSheetOpen) { candidateDetail.hide(); return; }
    if (bucketSheetOpen) { closeBucketSheet(); return; }
    if (runSheetOpen)    { closeRunSheet(); return; }
  });

  // ── Topbar buttons ───────────────────────────────────────────────────────────
  document.getElementById('btn-refresh').addEventListener('pointerup', async () => {
    allBlobs[currentBlobType] = null;
    await switchBlob(currentBlobType);
    await loadMerklisteEntries(true); // re-pull merkliste Einstand prices
    await loadLsHistory(true);        // re-pull the 10-day LS history (Trade view)
    toast('Aktualisiert', 'info', 1500);
  });

  document.getElementById('btn-run').addEventListener('pointerup', openRunSheet);

  document.getElementById('btn-upload').addEventListener('pointerup', () => {
    renderUploadModal({ onImport: importCandidates });
  });

  document.getElementById('btn-screener').addEventListener('pointerup', () => {
    if (useMock) {
      toast('Screener braucht ein Backend – Einstellungen öffnen.', 'error', 4000);
      return;
    }
    renderScreenerModal({
      storageClient,
      backendUrl: localStorage.getItem('discovery_backend_url'),
      secret: localStorage.getItem('discovery_secret'),
      onImport: importCandidates,
      toast,
    });
  });

  document.getElementById('btn-theme').addEventListener('pointerup', toggleTheme);

  document.getElementById('btn-export').addEventListener('pointerup', handleExport);

  document.getElementById('btn-settings').addEventListener('pointerup', () => {
    renderSettingsModal(async () => {
      useMock = !isConfigured();
      storageClient = isConfigured() ? loadStorageClient() : null;
      allBlobs = { inbox: null, archive: null, export: null, watch: null };
      updateMockBadge();
      await switchBlob(currentBlobType);
      toast('Einstellungen gespeichert', 'success');
    });
  });

  // ── Botnav ───────────────────────────────────────────────────────────────────
  document.getElementById('nav-home').addEventListener('pointerup', () => {
    document.getElementById('content').scrollTo({ top: 0, behavior: 'smooth' });
    openAlertModal();
  });

  document.getElementById('nav-bucket').addEventListener('pointerup', openBucketSheet);

  // Markets slot → open the Markets modal (indices + embedded Markets sub-page).
  document.getElementById('nav-markets').addEventListener('pointerup', () => {
    renderMarketsModal({
      onFetchIndicators: async () => {
        const backendUrl = localStorage.getItem('discovery_backend_url');
        const secret     = localStorage.getItem('discovery_secret');
        if (useMock || !backendUrl || !secret) return null;
        return fetchMarketIndicators({ backendUrl, secret });
      },
    });
  });

  // Monitor slot → dashboard for the active bucket (score movers, perf, signals).
  document.getElementById('nav-monitor').addEventListener('pointerup', () => {
    const candidates = allBlobs[currentBlobType]?.candidates ?? [];
    renderDashboardModal({
      candidates,
      bucket: currentBlobType,
      onOpenDetail: (candidate, ctrl) => {
        ctrl?.hide();                        // keep the dashboard mounted, just hidden
        returnToMonitor = () => ctrl?.show(); // restored when the detail sheet closes
        candidateDetail.show(candidate);
        openDetailSheet();
      },
    });
  });

  // ── First run hint ───────────────────────────────────────────────────────────
  if (!isConfigured()) {
    toast('Willkommen! Läuft im Mock-Modus. Einstellungen für echtes Backend.', 'info', 5000);
  }
}

document.addEventListener('DOMContentLoaded', init);
