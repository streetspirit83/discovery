/**
 * Discovery Workspace – Main App
 */

import { CandidateList, dupKey, segmentOf } from './components/candidate-list.js?v=20261107b';
import { filterMultiSelect } from './components/filter-multiselect.js?v=20261103f';
import { CandidateDetail } from './components/candidate-detail.js?v=20261111a';
import { renderSettingsModal, isConfigured, loadSettings } from './components/settings-modal.js?v=20260814m';
import { renderUploadModal } from './components/upload-modal.js';
import { renderScreenerModal } from './components/screener-modal.js?v=20260807a';
import { renderExportModal } from './components/export-modal.js';
import { renderAlertModal } from './components/alert-modal.js?v=20261103h';
import { openTriggerEditor } from './components/trigger-modal.js?v=20261104b';
import { openNachkaufModal } from './components/nachkauf-modal.js?v=20261103f';
import { openAiPromptModal } from './components/ai-prompt-modal.js?v=20261103f';
import { openPeerImportModal } from './components/peer-import-modal.js?v=20261104k';
import { triggeredCount } from './lib/alerts.js?v=20261103h';
import { renderMarketsModal } from './components/markets-modal.js?v=20261103f';
import { renderDashboardModal } from './components/dashboard-modal.js?v=20261110c';
import { latestPickKeys } from './components/daily-picks-panel.js?v=20261107a';
import { loadCharts } from './lib/lwc-loader.js?v=20261107b';
import { cacheGet, cachePut } from './lib/blob-cache.js?v=20261107f';
import { renderMarketBriefingModal } from './components/market-briefing-modal.js?v=20261104k';
import { openRangesModal } from './components/ranges-modal.js?v=20261104b';
import { fetchEurBasis, needsEurBasis, eurBasisFresh } from './lib/eur-basis.js?v=20261103h';
import { rangeInputs, rangeView, rangeOverride, resolveLevels } from './lib/range-levels.js?v=20261104a';
import { rangeAlarmPatch, rangeAlarmOn } from './lib/range-alarm.js?v=20261104b';
import { renderControlModal } from './components/control-modal.js?v=20261107b';
import { renderCompareModal } from './components/compare-modal.js?v=20261103h';
import { loadStorageClient } from './lib/storage-client.js?v=20261107f';
import { enrichBulk } from './lib/claude-api.js';
import { fetchTVEnrichment, fetchFxRate, fetchMarketIndicators } from './lib/tv-enrichment.js?v=20261103b';
import { fetchIndexRows } from './lib/tv-indices.js?v=20261023a';
import { trackSignals } from './lib/signal-tracker.js?v=20261103h';
import { fetchCompanyProfile, fetchCompanyNews, fetchLatestTranscript, compactProfile, cachedCompanyProfile } from './lib/company-profile.js?v=20261101b';
import { fetchTvNews } from './lib/tv-news.js?v=20261103b';
import { netBalance } from './lib/analyst-events.js?v=20261103c';
import { fetchStocktwitsSentiment } from './lib/stocktwits-sentiment.js?v=20260818a';
import { fetchFmpValuation } from './lib/fmp-valuation.js?v=20260818a';
import { fetchYahooTargets, yahooSymbol, yahooFresh } from './lib/analyst-targets.js?v=20260819g';
import { fetchLsQuote } from './lib/ls-intraday.js?v=20261026a';
import { checkTradeRepublic } from './lib/tr-check.js?v=20260807a';
import { autoFetchPlan } from './lib/detail-autofetch.js?v=20260918a';
import { buildResearchPrompt, PROMPT_TEMPLATES } from './lib/research-prompt.js?v=20261026b';
import { promptUrl } from './lib/quick-take-prompt.js?v=20261106c';
import { resolvePrimaryByIsin } from './lib/symbol-search.js?v=20260807a';
import { parsePeerHash, candidateKey } from './lib/peer-import.js?v=20261104k';
import { buildLinks } from './lib/link-builder.js';
import { normalizeExchange } from './lib/exchange-map.js';
import { MOCK_INBOX, MOCK_ARCHIVE, MOCK_EXPORT, MOCK_WATCH } from './lib/schema.js';
import { icons } from './lib/icons.js?v=20261103f';
import { MEGA_CLUSTERS } from './lib/sector-clusters.js?v=20260807a';
import { ADAPTERS, triggerAdapter, hasGithubPat } from './lib/adapter-trigger.js?v=20260807a';
import { fetchMerklisteEntries, applyMerklisteEntries } from './lib/merkliste-import.js?v=20260807a';
import { fetchSwingAnalysis, isUsTicker, swingErrorText } from './lib/tv-swings.js?v=20260818a';

// ── Inline Lucide SVG for shell icons ─────────────────────────────────────────
const luc = (d, s = 20) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const L = {
  refresh:  luc('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
  zap:      luc('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  upload:   luc('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'),
  scope:    luc('<circle cx="17" cy="3" r="2"/><path d="M2 22 13 11"/><path d="m10.3 10.3 10.7-7 2.7 2.7-7 10.7"/><path d="m5.3 15.3 3.4 3.4"/>'),
  briefing: luc('<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>'),
  ranges:   luc('<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>'),
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
  layers:   luc('<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>'),
  bookmark: luc('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>'),
  activity: luc('<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>', 16),
};

// ── UI state (persisted) ───────────────────────────────────────────────────────
const UI_KEY = 'discovery.ui.v1';
const uiState = (() => {
  // Dropdown-Filter (fCap/fSector/fScore/fTr/fLsTrend) sind Mehrfachauswahl →
  // Arrays. fBroker/fAlerts/fDup bleiben Toggles (String).
  const def = { view: 'standard', bucket: 'inbox', theme: 'light', fState: '', fCap: [], fSector: [], fMega: [], fBroker: '', fScore: [], fTr: [], fAlerts: '', fLsTrend: [], fDup: '', fSeg: '', currency: 'USD' };
  let s;
  try { s = { ...def, ...JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') }; }
  catch { s = { ...def }; }
  // Migrate persisted view modes from the old 3-view layout
  if (!['standard', 'trade', 'score', 'meta', 'price', 'fundamentals'].includes(s.view)) s.view = 'standard';
  // Migrate the multi-select filters from the old single-value strings to arrays.
  const toArr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  s.fCap = toArr(s.fCap); s.fSector = toArr(s.fSector); s.fMega = toArr(s.fMega); s.fScore = toArr(s.fScore);
  s.fTr = toArr(s.fTr); s.fLsTrend = toArr(s.fLsTrend);
  // Start immer mit der ★-Liste (Portfolio); abschalten gilt nur für die laufende Sitzung.
  s.fBroker = 'star';
  return s;
})();
function saveUiState() {
  try { localStorage.setItem(UI_KEY, JSON.stringify(uiState)); } catch {}
}

// ── App globals ────────────────────────────────────────────────────────────────
let useMock = !isConfigured();
let currentBlobType = uiState.bucket ?? 'inbox';
let allBlobs = { inbox: null, archive: null, export: null, watch: null, all: null };
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

/* Start: LS-Livekurse der ★-Liste still nachladen (kein Toast, kein ISIN-Nachschlag).
   Wartet, bis der Hintergrund-Abgleich des Blob-Caches durch ist – sonst ersetzt
   der frische Stand die Objekte mitten im Abruf. Ein Fehlversuch behält den alten
   Kurs; gespeichert werden nur Treffer. */
async function refreshStarLsOnLoad() {
  if (useMock || !storageClient || !candidateList) return;
  const backendUrl = localStorage.getItem('discovery_backend_url');
  const secret     = localStorage.getItem('discovery_secret');
  if (!backendUrl || !secret) return;
  for (let i = 0; i < 40 && revalidating > 0; i++) await new Promise((r) => setTimeout(r, 250));
  await new Promise((r) => setTimeout(r, 400)); // Neuzeichnung nach dem Abgleich abwarten
  if (candidateList.filters.broker !== 'star') return;
  const bucket = currentBlobType;
  const rows = candidateList.getFiltered();
  if (!rows.length) return;
  const prev = new Map(rows.map((c) => [c.id, c.ls_quote]));
  let updates;
  try {
    updates = await candidateList.runLsQuote(rows.map((c) => c.id), { backendUrl, secret });
  } catch (err) {
    console.warn('[LS] Start-Aktualisierung fehlgeschlagen:', err.message);
    updates = [];
  }
  const ok = updates.filter((u) => u.updates.ls_quote?.price != null);
  const okIds = new Set(ok.map((u) => u.candidate_id));
  let restored = false;
  for (const c of rows) {
    if (okIds.has(c.id)) continue;
    const old = prev.get(c.id);
    if (old?.price != null) { c.ls_quote = old; restored = true; }
  }
  if (restored) candidateList.renderRowsSoon();
  if (ok.length && currentBlobType === bucket) {
    storageClient.bulkUpdateCandidates(bucket, ok).catch((err) => console.warn('[LS] Speichern:', err.message));
  }
}

// ── Alert-Overview modal (Home nav slot) ────────────────────────────────────────
// Replaces the former Intra-Day modal: lists every candidate that has alerts,
// with a global mute and per-alert enable/disable. Persists enabled-changes.
function persistAlerts(id, alerts, extra = {}) {
  if (useMock || !storageClient) return Promise.resolve();
  return storageClient.updateCandidate(currentBlobType, id, { alerts, ...extra });
}

/* Levels eines Titels für das Alert-Fenster (EUR). null = keine Range rechenbar. */
function rangeLevelInfo(c) {
  try {
    const { it, ov, lp, hist } = rangeInputs(c, resolveFxRate());
    const p = lp ?? it.p;
    if (!(p > 0)) return null;
    const v = rangeView(it, ov, { p }, hist);
    return { sup: v.sup, res: v.res, supM: v.supM, resM: v.resM, autoSup: it.as, autoRes: it.ar };
  } catch (err) {
    console.warn('[range]', c.symbol, err.message);
    return null;
  }
}

/* Manuelle Levels speichern. `arm` schaltet den Range-Alarm ein, `meta` gibt der Seite `side`
   Art und Notiz aus dem Alert-Fenster. Ein aktiver Alarm zieht immer mit. */
async function applyRangeLevels(candidate, sup, res, { arm = false, side = null, meta = null } = {}) {
  const bucket = currentBlobType === 'all' ? bucketOfId(candidate.id) : currentBlobType;
  const fx = resolveFxRate();
  const before = { range_override: candidate.range_override, alerts: candidate.alerts, range_alarm: candidate.range_alarm };
  const refresh = () => { candidateDetail.render(); candidateList.renderRows(); updateAlertBadge(); };
  const patch = { range_override: rangeOverride(rangeInputs(candidate, fx).it, sup, res) };
  candidate.range_override = patch.range_override;
  if (bucket !== 'archive' && (arm || rangeAlarmOn(candidate))) {
    const { it, ov, lp, hist } = rangeInputs(candidate, fx);
    Object.assign(patch, rangeAlarmPatch(candidate, rangeView(it, ov, { p: lp ?? it.p }, hist), true).patch);
    const al = side && meta ? patch.alerts.find((a) => a.id === `wr_${side}_${candidate.id}`) : null;
    if (al) { al.kind = meta.kind; al.dir = meta.dir; if (meta.note) al.note = meta.note; }
  }
  Object.assign(candidate, patch);
  refresh();
  try {
    if (!useMock && storageClient) await storageClient.updateCandidate(bucket, candidate.id, patch);
    toast(patch.range_override ? 'Levels gespeichert.' : 'Zurück auf auto.', 'success', 2000);
  } catch (e) {
    Object.assign(candidate, before);
    refresh();
    toast(`Levels nicht gespeichert: ${e.message}`, 'error', 4000);
  }
}

/* Eine Seite aus dem Alert-Fenster setzen, `value` null = zurück auf auto. Die andere bleibt. */
async function saveRangeLevel(c, side, value, meta) {
  const { it, ov, lp, hist } = rangeInputs(c, resolveFxRate());
  const v = rangeView(it, ov, { p: lp ?? it.p }, hist);
  const keep = (s) => (s === 'sup' ? (v.supM ? v.bSup : null) : (v.resM ? v.bRes : null));
  const sup = side === 'sup' ? value : keep('sup'), res = side === 'res' ? value : keep('res');
  const fmt = (x) => `${x.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const lv = resolveLevels(v, sup, res, fmt);
  if (lv.err) return lv;
  await applyRangeLevels(c, lv.sup, lv.res, { arm: true, side, meta });
  return {};
}

const rangeEditorOpts = { info: rangeLevelInfo, save: saveRangeLevel };

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
        range: rangeEditorOpts,
        onSaveAlerts: (id, alerts, extra) => { const p = persistAlerts(id, alerts, extra); candidateList?.renderRows(); updateAlertBadge(); return p; },
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

let analystEventMap = null;
/* Laufende Abrufe teilen: init() startet die Zusatzdaten parallel zum Bucket-Blob,
   switchBlob() fragt sie erneut an – ohne diese Sperre gingen sie doppelt raus. */
const inflight = new Map();
function shared(key, fn, force = false) {
  if (force) inflight.delete(key);
  if (!inflight.has(key)) inflight.set(key, Promise.resolve().then(fn).finally(() => setTimeout(() => inflight.delete(key), 0)));
  return inflight.get(key);
}

async function loadLsHistory(force = false) {
  if (useMock || !storageClient) return;
  if (force || !lsHistoryMap) {
    try {
      const doc = await shared('ls_history', () => storageClient.readLsHistory(), force);
      lsHistoryMap = doc?.history ?? {};
    } catch (err) {
      console.warn('[ls-history] load failed:', err.message);
      return;
    }
  }
  const blob = allBlobs[currentBlobType];
  if (!blob?.candidates || !candidateList) return;
  for (const c of blob.candidates) c.ls_history = lsHistoryMap[c.id]?.snapshots ?? null;
  candidateList.renderRowsSoon();
}

// ── Analysten-Spalte: Blob `analyst`, gefüllt vom Monitor-Lauf ───────────────
function attachAnalystEvents(candidates) {
  for (const c of candidates) {
    const key = `${String(c.symbol ?? '').toUpperCase()}:${normalizeExchange(c.exchange) || c.exchange || ''}`;
    // Nicht-aufzählbar: abgeleitet, gehört in keinen Blob-Schreibvorgang.
    Object.defineProperty(c, 'analyst_30d', { value: netBalance(analystEventMap[key]), enumerable: false, writable: true, configurable: true });
  }
}

/* EUR-Basis für Titel in Fremdwährung (SEK, GBX, …): im Hintergrund, in Wellen von 6,
   je Titel höchstens ein Versuch pro Sitzung. Ohne Basis rechnet die App über LS/TV-Schluss. */
const eurBasisTried = new Set();
async function loadEurBasis(cands, blobType) {
  const backendUrl = localStorage.getItem('discovery_backend_url');
  const secret     = localStorage.getItem('discovery_secret');
  if (useMock || !storageClient || !backendUrl || !secret) return;
  const due = cands.filter((c) => needsEurBasis(c) && !eurBasisFresh(c) && !eurBasisTried.has(c.id));
  if (!due.length) return;
  for (let i = 0; i < due.length; i += 6) {
    await Promise.allSettled(due.slice(i, i + 6).map(async (c) => {
      eurBasisTried.add(c.id);
      const r = await fetchEurBasis(c, { backendUrl, secret });
      if (r?.error) return;
      c.eur_basis = r;
      await storageClient.updateCandidate(blobType, c.id, { eur_basis: r }).catch((e) => console.warn('[eur-basis] speichern:', e.message));
    }));
  }
  candidateList.renderRowsSoon();
  if (candidateDetail.candidate && due.includes(candidateDetail.candidate)) candidateDetail.render();
}

// ── Tagessieger-Abzeichen: neueste Einträge `picks` im market-Blob ───────────
let dailyPickMap = null;
function attachDailyPicks(candidates) {
  for (const c of candidates) {
    const key = `${String(c.symbol ?? '').toUpperCase()}:${String(c.exchange ?? '').toUpperCase()}`;
    // Nicht-aufzählbar: abgeleitet, gehört in keinen Blob-Schreibvorgang. Nur Watchlist.
    const hit = c._bucket === 'archive' || (currentBlobType !== 'watch' && currentBlobType !== 'all') ? null : dailyPickMap?.get(key) ?? null;
    Object.defineProperty(c, 'daily_pick', { value: hit, enumerable: false, writable: true, configurable: true });
  }
}
async function loadDailyPicks(force = false) {
  if (useMock || !storageClient) return;
  if (force || !dailyPickMap) {
    try { dailyPickMap = latestPickKeys((await shared('market', () => storageClient.readBlob('market'), force))?.briefings ?? []); }
    catch (err) { console.warn('[daily-picks] load failed:', err.message); return; }
  }
  const blob = allBlobs[currentBlobType];
  if (!blob?.candidates || !candidateList) return;
  attachDailyPicks(blob.candidates);
  candidateList.renderRowsSoon();
}

async function loadAnalystEvents(force = false) {
  if (useMock || !storageClient) return;
  if (force || !analystEventMap) {
    try {
      analystEventMap = (await shared('analyst', () => storageClient.readBlob('analyst'), force))?.events ?? {};
    } catch (err) {
      console.warn('[analyst] load failed:', err.message);
      return;
    }
  }
  const blob = allBlobs[currentBlobType];
  if (!blob?.candidates || !candidateList) return;
  attachAnalystEvents(blob.candidates);
  candidateList.renderRowsSoon();
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
      merklisteMaps = await shared('merkliste', () => fetchMerklisteEntries({ backendUrl, secret }), force);
    } catch (err) {
      console.warn('[merkliste] entry import failed:', err.message);
      return;
    }
  }
  const blob = allBlobs[currentBlobType];
  if (!merklisteMaps || !blob?.candidates || !candidateList) return;
  applyMerklisteEntries(blob.candidates, merklisteMaps);
  candidateList.renderRowsSoon(); // mutate-in-place re-render; keeps selection intact
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
  document.getElementById('topbar-search-icon').innerHTML = icons.search;
  document.getElementById('btn-refresh').innerHTML  = L.refresh;
  document.getElementById('btn-run').innerHTML      = L.zap;
  document.getElementById('btn-screener').innerHTML = L.scope;
  document.getElementById('btn-ranges').innerHTML   = L.ranges;
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

  // Kontroll-Center: Kandidaten des aktiven Buckets nach Kriterien auswählen
  // (Score-Slider + Multi-Selects) → Selektion setzen → Bulk-Bar erscheint.
  const controlBtn = document.getElementById('subnav-control');
  if (controlBtn && !controlBtn.dataset.wired) {
    controlBtn.dataset.wired = '1';
    document.getElementById('subnav-control-icon').innerHTML = icons.sliders;
    controlBtn.addEventListener('pointerup', () => {
      renderControlModal({
        candidates: allBlobs[currentBlobType]?.candidates ?? [],
        bucket: currentBlobType,
        onApply: (ids) => candidateList.setSelection(ids),
      });
    });
  }

  // Watch-Filter (nur Watch-Bucket): schaltet die Liste auf Watch-Label-Ticker.
  const watchBtn = document.getElementById('subnav-watch');
  if (watchBtn && !watchBtn.dataset.wired) {
    watchBtn.dataset.wired = '1';
    document.getElementById('subnav-watch-icon').innerHTML = icons.eye;
    watchBtn.addEventListener('pointerup', () => {
      const on = candidateList.filters.watch !== 'yes';
      candidateList.setWatchOnly(on);
      watchBtn.classList.toggle('is-active', on);
      renderSegbar();
    });
  }
  updateWatchSubnav();
  updateAlertBadge();
}

function renderFilterbar() {
  const fb = document.getElementById('filterbar');
  const sectors = candidateList ? candidateList.getSectors() : [];

  // Toggles bleiben Buttons; die Dropdowns sind jetzt Mehrfachauswahl-Popover.
  fb.innerHTML = `
    <span id="pill-selected-wrap"></span>
    ${(currentBlobType === 'inbox' || currentBlobType === 'archive')
      ? `<button class="filter-star filter-dup${uiState.fDup === 'yes' ? ' is-active' : ''}" id="dup-toggle" aria-pressed="${uiState.fDup === 'yes'}" title="Nur Werte, die bereits in einem anderen Bucket liegen (Dubletten) – wählt sie direkt für Bulk-Aktionen aus">⧉</button>`
      : ''}
    <button class="filter-star${uiState.fBroker === 'star' ? ' is-active' : ''}" id="portfolio-toggle" aria-pressed="${uiState.fBroker === 'star'}" title="Nur Portfolio-Ticker (★) anzeigen">★</button>
    <button class="filter-star${uiState.fAlerts === 'active' ? ' is-active' : ''}" id="alerts-toggle" aria-pressed="${uiState.fAlerts === 'active'}" title="Nur Ticker mit aktiven Alerts anzeigen">🔔</button>`;

  // Multi-Select-Buttons in der bisherigen Reihenfolge anhängen.
  const mkFilter = (cfg) => fb.appendChild(filterMultiSelect(cfg));
  mkFilter({
    id: 'filter-score', label: 'Score', title: 'Filter nach Overall-Score (Mehrfachauswahl)',
    options: [
      { value: '80', label: 'Score ≥ 80' },
      { value: '70', label: 'Score 70–79' },
      { value: '60', label: 'Score 60–69' },
      { value: '40', label: 'Score 40–59' },
      { value: '0',  label: 'Score < 40' },
    ],
    selected: uiState.fScore,
    onChange: (v) => { uiState.fScore = v; saveUiState(); candidateList.setFilter('score', v); },
  });
  // Watch + Archiv: dort ist die Sektor-Leiste (Einfachauswahl) der einzige Sektor-Filter.
  const segView = currentBlobType === 'all';
  if (!segView) mkFilter({
    id: 'filter-mega', label: 'Mega', title: 'Filter nach Mega-Cluster (5 Sektor-Gruppen, Mehrfachauswahl)',
    options: MEGA_CLUSTERS.map((m) => ({ value: m.key, label: m.label })),
    selected: uiState.fMega,
    onChange: (v) => { uiState.fMega = v; saveUiState(); candidateList.setFilter('mega', v); },
  });
  if (!segView) mkFilter({
    id: 'filter-sector', label: 'Sectors', title: 'Filter nach Sektor (Mehrfachauswahl)',
    options: [{ value: '__no_sector__', label: '— Ohne Sektor' }, ...sectors.map((s) => ({ value: s, label: s }))],
    selected: uiState.fSector,
    onChange: (v) => { uiState.fSector = v; saveUiState(); candidateList.setFilter('sector', v); },
  });
  mkFilter({
    id: 'filter-cap', label: 'Size', title: 'Filter nach Marktkapitalisierung (Mehrfachauswahl)',
    options: [
      { value: 'micro', label: 'Micro' },
      { value: 'small', label: 'Small' },
      { value: 'mid',   label: 'Mid' },
      { value: 'large', label: 'Large' },
    ],
    selected: uiState.fCap,
    onChange: (v) => { uiState.fCap = v; saveUiState(); candidateList.setFilter('capSize', v); },
  });
  mkFilter({
    id: 'filter-tr', label: 'TR', title: 'Filter nach Trade-Republic-Handelbarkeit (Mehrfachauswahl)',
    options: [
      { value: 'no',        label: '✗ nicht handelbar' },
      { value: 'yes',       label: '✓ handelbar' },
      { value: 'unchecked', label: '? ungeprüft' },
    ],
    selected: uiState.fTr,
    onChange: (v) => { uiState.fTr = v; saveUiState(); candidateList.setFilter('tr', v); },
  });
  mkFilter({
    id: 'filter-lstrend', label: 'LS-Trend', title: 'Filter nach LS-10T-Trend (Regressionsgerade durch die Tages-Schlusskurse; Mehrfachauswahl)',
    options: [
      { value: 'pos',     label: '↗ Trend positiv' },
      { value: 'crossUp', label: '⤴ Kurs kreuzt Trend' },
    ],
    selected: uiState.fLsTrend,
    onChange: (v) => { uiState.fLsTrend = v; saveUiState(); candidateList.setFilter('lsTrend', v); },
  });

  fb.querySelector('#dup-toggle')?.addEventListener('click', () => {
    const on = uiState.fDup !== 'yes';
    uiState.fDup = on ? 'yes' : '';
    saveUiState();
    candidateList.setFilter('dup', uiState.fDup);
    const btn = fb.querySelector('#dup-toggle');
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', String(on));
  });

  fb.querySelector('#portfolio-toggle').addEventListener('click', () => {
    const on = uiState.fBroker !== 'star';
    uiState.fBroker = on ? 'star' : '';
    saveUiState();
    candidateList.setFilter('broker', uiState.fBroker);
    renderSegbar();
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
  const bucketIcons  = { inbox: L.inbox, archive: L.archive, export: L.checkSq, watch: L.bookmark, all: L.layers };
  const bucketLabels = { inbox: 'Inbox', archive: 'Archiv', export: 'Export', watch: 'Watch', all: 'All' };
  document.getElementById('nav-home-icon').innerHTML   = L.bell;
  document.getElementById('nav-bucket-icon').innerHTML = bucketIcons[currentBlobType] ?? L.inbox;
  document.getElementById('nav-bucket-label').textContent = bucketLabels[currentBlobType] ?? 'Inbox';
  document.getElementById('nav-portfolio-icon').innerHTML = L.portfolio;
  document.getElementById('nav-markets-icon').innerHTML   = L.markets;
  document.getElementById('nav-monitor-icon').innerHTML   = L.activity;
  document.getElementById('nav-briefing-icon').innerHTML  = L.briefing;
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
    { key: 'all',     label: 'Watch + Archiv', icon: L.layers },
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
/* Schneller Start: beim ERSTEN Laden eines Buckets in dieser Sitzung den letzten Stand
   aus IndexedDB zeigen (lib/blob-cache.js) und den frischen im Hintergrund holen.
   Jedes spätere Laden (nach Verschieben, Löschen, Aktualisieren) geht direkt an den
   Server – sonst blitzte nach einer Aktion kurz der alte Stand auf. */
const blobSeen = new Set();
const backendBase = () => localStorage.getItem('discovery_backend_url') ?? '';

/* Liest frisch vom Server. Mit `etag` (aus dem Cache) nur, wenn sich der Blob
   geändert hat – dann kommt `null` zurück und es gibt nichts zu tun. Kam während
   des Lesens ein Schreibvorgang dazwischen, wird nach dessen Ende nachgelesen. */
async function fetchBlob(blobType, etag = null) {
  const seq = storageClient.writeSeq;
  let r = await storageClient.readBlobIfChanged(blobType, etag);
  if (storageClient.writeSeq !== seq || storageClient.pending) {
    await storageClient.writesSettled?.();
    r = await storageClient.readBlobIfChanged(blobType, null);
  }
  if (r.unchanged) return null;
  const blob = r.data;
  idle(() => cachePut(backendBase(), blobType, blob, r.etag));
  return blob;
}
const idle = (f) => (window.requestIdleCallback ?? ((g) => setTimeout(g, 300)))(f);

async function loadBlob(blobType) {
  if (useMock) {
    const map = { inbox: MOCK_INBOX, archive: MOCK_ARCHIVE, export: MOCK_EXPORT, watch: MOCK_WATCH };
    return structuredClone(map[blobType] ?? { schema_version: 'discovery-1.0', blob_type: blobType, updated_at: new Date().toISOString(), candidates: [] });
  }
  const first = !blobSeen.has(blobType);
  blobSeen.add(blobType);
  if (first) {
    performance.mark(`blob:${blobType}:cache-start`);
    const cached = await cacheGet(backendBase(), blobType);
    performance.mark(`blob:${blobType}:cache-${cached ? 'hit' : 'miss'}`);
    if (cached?.blob?.candidates) {
      revalidateBlob(blobType, cached.blob, cached.etag);
      return cached.blob;
    }
  }
  try {
    const b = await fetchBlob(blobType);
    performance.mark(`blob:${blobType}:fetched`);
    return b;
  } catch (err) {
    toast(`Fehler beim Laden: ${err.message}`, 'error');
    return { schema_version: 'discovery-1.0', blob_type: blobType, updated_at: new Date().toISOString(), candidates: [] };
  }
}

/* Frischen Stand nachladen und die Sicht damit neu aufbauen, wenn der Bucket
   (oder „Watch + Archiv“ für watch/archive) gerade angezeigt wird. */
let revalidating = 0, revalidated = false;
async function revalidateBlob(blobType, shown, etag = null) {
  revalidating++;
  try {
    const fresh = await fetchBlob(blobType, etag);
    performance.mark(`blob:${blobType}:${fresh ? 'revalidated' : 'unchanged'}`);
    // Unverändert (Server oder Zeitstempel) oder inzwischen anders geladen → nichts tun.
    if (fresh && allBlobs[blobType] === shown && fresh.updated_at !== shown?.updated_at) {
      allBlobs[blobType] = fresh;
      revalidated = true;
    }
  } catch (err) {
    console.warn(`[cache] ${blobType} nicht aktualisiert:`, err.message);
  } finally {
    // Erst neu zeichnen, wenn alle gleichzeitig angestossenen Buckets da sind
    // (bei „Watch + Archiv“ beide) – eine Neuzeichnung statt zwei.
    if (--revalidating === 0 && revalidated) { revalidated = false; scheduleViewRefresh(); }
  }
}
let viewRefreshT = 0;
function scheduleViewRefresh() {
  clearTimeout(viewRefreshT);
  viewRefreshT = setTimeout(async () => {
    const b = currentBlobType;
    const inView = (t) => t === b || (b === 'all' && (t === 'watch' || t === 'archive'));
    if (!['inbox', 'archive', 'export', 'watch'].some((t) => inView(t) && allBlobs[t])) return;
    const y = window.scrollY, openId = candidateDetail?.candidate?.id;
    const sel = new Set(candidateList.selected);
    await switchBlob(b);
    for (const id of sel) candidateList.selected.add(id);
    if (sel.size) { candidateList.renderRows(); }
    window.scrollTo(0, y);
    if (openId) {
      const c = allBlobs[b]?.candidates?.find((x) => x.id === openId);
      if (c && candidateDetail.candidate?.id === openId) { candidateDetail.candidate = c; candidateDetail.render(); }
    }
  }, 60);
}

// ── Watch + Archiv (Bucket „all") ──────────────────────────────────────────────
// Kein eigener Blob: eine gemeinsame Sicht auf die geladenen Watch- und Archiv-
// Kandidaten (dieselben Objekte, Änderungen wirken in beiden Buckets). Dubletten
// nach Symbol+Börse zeigt sie einmal, Watch gewinnt. Die Herkunft trägt jedes
// Objekt als nicht-aufzählbares `_bucket` — es landet so nie im Blob.
async function buildAllBlob() {
  const [watch, archive] = await Promise.all([ensureBlob('watch'), ensureBlob('archive')]);
  const seen = new Set(), candidates = [];
  for (const [bucket, blob] of [['watch', watch], ['archive', archive]]) {
    for (const c of blob?.candidates ?? []) {
      const k = dupKey(c);
      if (seen.has(k)) continue;
      seen.add(k);
      Object.defineProperty(c, '_bucket', { value: bucket, writable: true, configurable: true, enumerable: false });
      candidates.push(c);
    }
  }
  return { schema_version: 'discovery-1.0', blob_type: 'all', updated_at: new Date().toISOString(), candidates };
}

const bucketOfId = (id) => (allBlobs.all?.candidates ?? []).find((c) => c.id === id)?._bucket ?? 'watch';

// Nach Verschieben/Löschen in „Watch + Archiv" beide Blobs frisch lesen und die Sicht neu bauen.
function rebuildAllView() {
  allBlobs.watch = null; allBlobs.archive = null; allBlobs.all = null;
  if (currentBlobType === 'all') switchBlob('all');
}

/* Schreibzugriffe auf den Pseudo-Bucket „all" gehen an den echten Bucket des
 * jeweiligen Titels — so bleiben alle Aktionen (Notiz, Alarm, Stern, Promote,
 * Dismiss, Bulk …) unverändert `storageClient.x(currentBlobType, …)`. */
function routeAll(sc) {
  if (!sc) return sc;
  const group = (ids) => {
    const m = new Map();
    for (const id of ids) { const b = bucketOfId(id); if (!m.has(b)) m.set(b, []); m.get(b).push(id); }
    return m;
  };
  const after = () => setTimeout(rebuildAllView, 0);
  const route = {
    updateCandidate: (b, id, u) => sc.updateCandidate(b === 'all' ? bucketOfId(id) : b, id, u),
    bulkUpdateCandidates: async (b, ups) => {
      if (b !== 'all') return sc.bulkUpdateCandidates(b, ups);
      for (const [bk, ids] of group(ups.map((u) => u.candidate_id))) {
        await sc.bulkUpdateCandidates(bk, ups.filter((u) => ids.includes(u.candidate_id)));
      }
    },
    moveCandidate: async (id, from, to) => {
      if (from !== 'all') return sc.moveCandidate(id, from, to);
      const fb = bucketOfId(id);
      if (fb !== to) await sc.moveCandidate(id, fb, to);
      after();
    },
    moveCandidates: async (ids, from, to) => {
      if (from !== 'all') return sc.moveCandidates(ids, from, to);
      for (const [fb, part] of group(ids)) if (fb !== to) await sc.moveCandidates(part, fb, to);
      after();
    },
    deleteCandidate: async (b, id) => {
      if (b !== 'all') return sc.deleteCandidate(b, id);
      await sc.deleteCandidate(bucketOfId(id), id); after();
    },
    deleteCandidates: async (b, ids) => {
      if (b !== 'all') return sc.deleteCandidates(b, ids);
      for (const [bk, part] of group(ids)) await sc.deleteCandidates(bk, part);
      after();
    },
  };
  return new Proxy(sc, {
    get(t, k) {
      if (k in route) return route[k];
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

async function ensureBlob(blobType) {
  if (blobType === 'all') {
    allBlobs.all = await buildAllBlob();
    return allBlobs.all;
  }
  if (!allBlobs[blobType]) {
    allBlobs[blobType] = await loadBlob(blobType);
  }
  return allBlobs[blobType];
}

async function switchBlob(blobType) {
  currentBlobType = blobType;
  uiState.bucket = blobType;
  // Dubletten-Filter gilt nur in Inbox/Archiv — beim Verlassen zurücksetzen,
  // sonst filtert er (mit dann leerer dupMap) alle Zeilen weg.
  if (blobType !== 'inbox' && blobType !== 'archive' && uiState.fDup) {
    uiState.fDup = '';
    candidateList.filters.dup = '';
  }
  // Watch-Label-Feature gilt nur im Watch-Bucket (und in Watch + Archiv) — Filter beim Verlassen lösen.
  if (blobType !== 'watch' && blobType !== 'all') candidateList.filters.watch = '';
  // Mega/Sectors (Mehrfachauswahl) ruhen in Watch + Archiv, die Sektor-Leiste ersetzt sie.
  candidateList.filters.mega   = blobType === 'all' ? [] : (uiState.fMega ?? []);
  candidateList.filters.sector = blobType === 'all' ? [] : (uiState.fSector ?? []);
  candidateDetail.bucket = blobType;
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
  if (analystEventMap) attachAnalystEvents(allBlobs[blobType].candidates);
  else loadAnalystEvents();
  if (dailyPickMap) attachDailyPicks(allBlobs[blobType].candidates);
  else loadDailyPicks();
  // Daten, Bucket und Sektor-Leiste setzen – gezeichnet wird einmal am Ende.
  candidateList.batch(() => {
    candidateList.setData(allBlobs[blobType].candidates);
    candidateList.setBucket(blobType);               // Watch-Label-Spalte (Meta)
    renderBotnav();
    renderFilterbar();
    updateWatchSubnav();                             // Watch-Filter-Icon nur im Watch-Bucket
    renderSegbar();                                  // Sektor-Buttons nur in Watch + Archiv
    if (blobType !== 'inbox' && blobType !== 'archive') candidateList.setDupMap(null);
  });
  loadEurBasis(allBlobs[blobType].candidates, blobType);
  refreshDupMarkers();                               // fire & forget
  if (blobType === 'inbox') autoTrCheckNewInbox();   // fire & forget
}

// Watch-Filter-Button (Subbar) nur im Watch-Bucket zeigen; beim Verlassen den
// aktiven Filter/Highlight zurücksetzen.
function updateWatchSubnav() {
  const btn = document.getElementById('subnav-watch');
  if (!btn) return;
  const onWatch = currentBlobType === 'watch' || currentBlobType === 'all';
  btn.hidden = !onWatch;
  btn.classList.toggle('is-active', onWatch && candidateList?.filters?.watch === 'yes');
}

// ── Sektor-Buttons (nur Watch + Archiv) ─────────────────────────────────────────
// Fünf Icon-Buttons in der Subleiste, je Mega-Cluster einer (wie die Sektor-
// Heatmap im Markets-Modal). Einfachauswahl: Tipp wählt den Sektor, nochmal
// tippen = wieder alle. Stern oder Auge aktiv → Buttons treten zurück, die Liste
// zeigt alle markierten Titel ohne Sektor-Trennung.
const SECTOR_ICONS = { tech: 'cpu', health: 'heartPulse', consumer: 'shoppingCart', industry: 'factory', finance: 'landmark' };
function renderSegbar() {
  const box = document.getElementById('sector-btns');
  if (!box) return;
  const on = currentBlobType === 'all';
  box.hidden = !on;
  candidateList.setSegment(on ? (uiState.fSeg ?? '') : '');
  if (!on) return;
  const cands = allBlobs.all?.candidates ?? [];
  const overridden = uiState.fBroker === 'star' || candidateList.filters.watch === 'yes';
  const cur = uiState.fSeg ?? '';
  box.classList.toggle('sector-btns--off', overridden);
  box.innerHTML = MEGA_CLUSTERS.map((m) => {
    const n = cands.filter((c) => segmentOf(c) === m.key).length;
    const act = !overridden && m.key === cur;
    const tip = overridden ? `${m.label} (${n}) · Stern/Auge aktiv: alle markierten Titel` : act ? `${m.label} (${n}) · nochmal tippen: alle Sektoren` : `Nur ${m.label} (${n})`;
    return `<button class="subnav-alert${act ? ' is-active' : ''}" data-seg="${m.key}" aria-pressed="${act}" title="${tip}" aria-label="${tip}"${overridden ? ' disabled' : ''}>${icons[SECTOR_ICONS[m.key]]}</button>`;
  }).join('');
  box.querySelectorAll('[data-seg]').forEach((b) => b.addEventListener('click', () => {
    uiState.fSeg = uiState.fSeg === b.dataset.seg ? '' : b.dataset.seg;
    saveUiState();
    renderSegbar();
  }));
}

// ── Dup-Marker für Inbox/Archiv ─────────────────────────────────────────────────
// Werte, die bereits in einem anderen Bucket liegen, bekommen eine eigene
// Zeilen-Hintergrundfarbe. Gilt nur für die Inbox- und Archiv-Ansicht.
const BUCKET_LABELS = { inbox: 'Inbox', archive: 'Archiv', export: 'Export', watch: 'Watch' };
async function refreshDupMarkers() {
  if (currentBlobType !== 'inbox' && currentBlobType !== 'archive') {
    candidateList.setDupMap(null);
    return;
  }
  const shown  = currentBlobType;
  const others = ['inbox', 'archive', 'export', 'watch'].filter((b) => b !== shown);
  const map = new Map();
  for (const b of others) {
    const blob = await ensureBlob(b).catch(() => null);
    for (const c of blob?.candidates ?? []) {
      const k = dupKey(c);
      if (!map.has(k)) map.set(k, BUCKET_LABELS[b]);
    }
  }
  // Der Nutzer kann während der Blob-Loads den Bucket gewechselt haben.
  if (currentBlobType === shown) candidateList.setDupMap(map);
}

// ── Auto-TR-Check für neue Inbox-Kandidaten ─────────────────────────────────────
// Neuzugänge (state=new, noch kein tr_check) werden automatisch auf LS-Handel-
// barkeit geprüft; explizit NICHT handelbare werden gelöscht (das Archiv bleibt
// dem Wieder-auf-Watch-Setzen vorbehalten). Adapter können Gelöschte beim
// nächsten Lauf re-importieren — der Check greift dann erneut und löscht wieder.
// Unklare Ergebnisse bleiben liegen.
let autoTrRunning = false;
async function autoTrCheckNewInbox() {
  if (useMock || autoTrRunning || currentBlobType !== 'inbox' || !storageClient) return;
  const blob = allBlobs.inbox;
  const targets = (blob?.candidates ?? []).filter((c) => c.workspace_state === 'new' && c.tr_check == null);
  if (!targets.length) return;
  const backendUrl = localStorage.getItem('discovery_backend_url');
  const secret     = localStorage.getItem('discovery_secret');
  if (!backendUrl || !secret) return;
  autoTrRunning = true;
  try {
    await runTrCheckForSelection(targets.map((c) => c.id));
    const out = targets.filter((c) => c.tr_check?.tradable === false);
    let removed = 0;
    for (const c of out) {
      try {
        await storageClient.deleteCandidate('inbox', c.id);
        blob.candidates = blob.candidates.filter((x) => x.id !== c.id);
        removed++;
      } catch (err) {
        console.warn(`[autoTR] Löschen fehlgeschlagen (${c.symbol}):`, err.message);
      }
    }
    if (removed) {
      candidateList.setData(blob.candidates);
      toast(`🧹 Auto-TR-Check: ${removed} neue ohne LS-Handel gelöscht`, 'success', 5000);
    }
  } finally {
    autoTrRunning = false;
  }
}

/** Dossier-Auftrag an die Netlify-Function dossier-trigger (→ GitHub Action). */
async function postDossierTrigger(payload) {
  const backendUrl = localStorage.getItem('discovery_backend_url');
  const secret     = localStorage.getItem('discovery_secret');
  const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/dossier-trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error ? `${json.error}${json.detail ? ` – ${json.detail}` : ''}` : `HTTP ${res.status}`);
  return json;
}

/* ── AI Research aus der App (Warteschlange) ────────────────────────────────────
 * Prompt-Liste = die Prompts des Artefakts „Dossier Research", die die geplante
 * Aufgabe bei jedem Lauf an /api/research meldet; ohne Meldung die eingebauten
 * Vorlagen (gleiche Schlüssel). Der Auftrag ist ein Feld am Watch-Titel. */
async function loadResearchCatalog() {
  const fallback = PROMPT_TEMPLATES.map(({ key, label }) => ({ key, label }));
  try {
    const backendUrl = localStorage.getItem('discovery_backend_url');
    const secret     = localStorage.getItem('discovery_secret');
    const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/research?catalog=1`, { headers: { 'x-discovery-secret': secret } });
    const json = await res.json();
    return json?.ok && json.prompts?.length ? json.prompts : fallback;
  } catch {
    return fallback;
  }
}

async function enqueueResearch(candidate, keys) {
  const keep = new Set([...(candidate.research_request?.keys ?? []), ...keys]);
  const now = new Date().toISOString();
  const updates = { research_request: { keys: [...keep], at: candidate.research_request?.at ?? now } };
  // Noch kein Dossier → mit anlegen; die Ergebnisse landen dann gleich darin.
  const needDoc = !candidate.dossier?.doc_id && !candidate.dossier_flag;
  if (needDoc) Object.assign(updates, { dossier_flag: true, dossier: { ...(candidate.dossier ?? {}), status: 'queued', error: null, queued_at: now } });
  await storageClient.updateCandidate('watch', candidate.id, updates);
  Object.assign(candidate, updates);
  candidateList.renderRows();
  toast(`AI Research ${candidate.symbol}: ${keys.length} Prompt${keys.length === 1 ? '' : 's'} in der Warteschlange (Lauf alle 2 h)`, 'success', 4000);
  if (needDoc) {
    try { await postDossierTrigger({ candidate_id: candidate.id, mode: 'create' }); pollDossiers(); }
    catch (err) { toast(`Dossier-Start fehlgeschlagen (${err.message}) — der tägliche Lauf holt es nach`, 'error', 6000); }
  }
}

/* Nach einem Anstoss den Watch-Blob alle 20 s nachlesen (max. 6 min), bis kein
   Dossier mehr wartet — dann steht der Link am Icon ohne Neuladen. */
let dossierPoll = null;
function pollDossiers() {
  if (dossierPoll) return;
  const until = Date.now() + 6 * 60e3;
  dossierPoll = setInterval(async () => {
    try {
      const fresh = (await storageClient.readBlob('watch'))?.candidates ?? [];
      const local = allBlobs.watch?.candidates ?? [];
      let open = 0, changed = false;
      for (const f of fresh) {
        const c = local.find((x) => x.id === f.id);
        if (!c) continue;
        if (JSON.stringify(c.dossier) !== JSON.stringify(f.dossier) || c.dossier_update !== f.dossier_update) {
          c.dossier = f.dossier; c.dossier_update = f.dossier_update; c.dossier_flag = f.dossier_flag; changed = true;
          if (f.dossier?.status === 'done') toast(`Dossier ${f.symbol} fertig`, 'success', 3000);
          if (f.dossier?.status === 'error') toast(`Dossier ${f.symbol} fehlgeschlagen: ${f.dossier.error ?? ''}`, 'error', 6000);
        }
        if (f.dossier?.status === 'queued' || f.dossier?.status === 'running' || f.dossier_update) open++;
      }
      if (changed && (currentBlobType === 'watch' || currentBlobType === 'all')) candidateList.renderRows();
      if (!open || Date.now() > until) { clearInterval(dossierPoll); dossierPoll = null; }
    } catch { /* nächster Tick */ }
  }, 20e3);
}

/* ── Marktbriefing ─────────────────────────────────────────────────────────── */

/** Schlanke Kandidatenliste über alle Buckets für die Symbol-Auflösung (Watch zuerst). */
async function briefingCandidates() {
  const out = [];
  for (const bucket of ['watch', 'archive', 'export', 'inbox']) {
    const blob = await ensureBlob(bucket).catch(() => null);
    for (const c of blob?.candidates ?? []) out.push({ id: c.id, symbol: c.symbol, exchange: normalizeExchange(c.exchange) || c.exchange, bucket });
  }
  return out;
}

/**
 * Monitor-Reiter „Rotation“: einen Vorschlag auf Tippen verschieben
 * (Archiv → Watchlist oder Watchlist → Archiv). `hit` stammt aus
 * `briefingCandidates` und trägt den echten Bucket. Liefert true bei Erfolg.
 */
async function moveRotationHit(hit, to) {
  if (!hit || !hit.bucket || hit.bucket === to) return false;
  if (useMock) { toast('Im Demo-Modus nicht möglich', 'info'); return false; }
  try {
    await storageClient.moveCandidate(hit.id, hit.bucket, to);
  } catch (err) {
    toast(`Verschieben fehlgeschlagen: ${err.message}`, 'error');
    return false;
  }
  const from = hit.bucket;
  allBlobs[from] = null; allBlobs[to] = null; allBlobs.all = null;
  if ([from, to, 'all'].includes(currentBlobType)) switchBlob(currentBlobType);
  toast(`${hit.symbol} → ${to === 'watch' ? 'Watchlist' : 'Archiv'}`, 'success');
  return true;
}

/** Wie moveRotationHit, aber alle Vorschläge einer Richtung in einem Rutsch (je Ausgangs-Bucket ein moveCandidates). */
async function moveRotationHits(hits, to) {
  const todo = (hits ?? []).filter((h) => h?.bucket && h.bucket !== to);
  if (!todo.length) return false;
  if (useMock) { toast('Im Demo-Modus nicht möglich', 'info'); return false; }
  const byFrom = new Map();
  for (const h of todo) { if (!byFrom.has(h.bucket)) byFrom.set(h.bucket, []); byFrom.get(h.bucket).push(h.id); }
  try {
    for (const [from, ids] of byFrom) await storageClient.moveCandidates(ids, from, to);
  } catch (err) {
    toast(`Verschieben fehlgeschlagen: ${err.message}`, 'error');
    return false;
  }
  for (const b of [...byFrom.keys(), to, 'all']) allBlobs[b] = null;
  if ([...byFrom.keys(), to, 'all'].includes(currentBlobType)) switchBlob(currentBlobType);
  toast(`${todo.length} Titel → ${to === 'watch' ? 'Watchlist' : 'Archiv'}`, 'success');
  return true;
}

/**
 * Detail-Sheet zu einem Treffer der Symbol-Auflösung öffnen. Watch- und
 * Archiv-Titel erscheinen in „Watch + Archiv“, wenn der aktuelle Bucket sie
 * nicht enthält; `ctrl` (optional) ist das aufrufende Modal, das beim
 * Schliessen des Sheets zurückkehrt.
 */
async function openBriefingHit(hit, ctrl = null) {
  if (!hit) return false;
  let target = hit.bucket;
  if (hit.bucket === 'watch' || hit.bucket === 'archive') {
    target = currentBlobType === hit.bucket || currentBlobType === 'all' ? currentBlobType : 'all';
  }
  if (target !== currentBlobType) await switchBlob(target);
  const cand = (allBlobs[currentBlobType]?.candidates ?? []).find((c) => c.id === hit.id);
  if (!cand) { toast('Titel nicht mehr im Workspace', 'info', 3500); return false; }
  if (ctrl) { ctrl.hide(); returnToMonitor = () => ctrl.show(); }
  candidateDetail.show(cand);
  openDetailSheet();
  return true;
}

function openMarketBriefing(kind = null) {
  if (useMock || !storageClient) {
    toast('Marktbriefing braucht ein Backend – Einstellungen öffnen.', 'error', 4000);
    return;
  }
  renderMarketBriefingModal({
    loadBriefings: async () => (await storageClient.readBlob('market'))?.briefings ?? [],
    loadCandidates: briefingCandidates,
    onOpenCandidate: (hit, ctrl) => openBriefingHit(hit, ctrl),
    onScoutAdd: openScoutImport,
    kind,
  });
}

/* Neueste Rankings und Rotation aus dem market-Blob, dazu die Symbol-Auflösung. */
async function loadRankings() {
  const [market, cands] = await Promise.all([storageClient.readBlob('market'), briefingCandidates()]);
  const latest = (kind) => (market?.briefings ?? []).filter((b) => b.kind === kind).sort((a, b) => (a.day < b.day ? 1 : -1))[0] ?? null;
  const byId = new Map(cands.map((c) => [c.id, c]));
  const find = (symbol, exchange) => {
    const list = cands.filter((c) => String(c.symbol ?? '').toUpperCase() === String(symbol ?? '').toUpperCase());
    return list.find((c) => String(c.exchange ?? '').toUpperCase() === String(exchange ?? '').toUpperCase()) ?? list[0] ?? null;
  };
  return { ranking: latest('ranking'), rotation: latest('rotation'), find, byId,
    briefings: market?.briefings ?? [], method: market?.picks_method ?? null };
}

/** Scout-Titel: dasselbe Prüffenster wie die Alternativen aus dem Chat. */
function openScoutImport(item) {
  if (!item?.symbol) return;
  openImportCheck({
    items: [{ symbol: String(item.symbol).toUpperCase(), exchange: normalizeExchange(item.exchange) || '', adapter: 'ai-scout', note: item.thesis ?? 'KI-Scout' }],
    peer: null,
  }, 'Scout-Titel');
}

/**
 * Deep links aus dem Claude-Artefakt „Marktbriefing“:
 *   #briefing[=preview|watch] → Marktbriefing-Modal (optional mit Reiter)
 *   #s=SYMBOL[:BÖRSE]  → Detail-Sheet des Titels (Watch zuerst)
 */
async function handleBriefingHash() {
  const h = location.hash || '';
  const m = /[#&]s=([^&]+)/.exec(h);
  const bm = /^#briefing(?:=(\w+))?/.exec(h);
  if (!bm && !m) return false;
  history.replaceState(null, '', location.pathname + location.search);
  if (!m) { openMarketBriefing(bm[1] ?? null); return true; }
  const [sym, ex] = decodeURIComponent(m[1]).toUpperCase().split(':');
  const list = (await briefingCandidates()).filter((c) => String(c.symbol ?? '').toUpperCase() === sym);
  const hit = (ex && list.find((c) => String(c.exchange ?? '').toUpperCase() === ex)) || list[0];
  if (!hit) { toast(`${sym} liegt nicht im Workspace`, 'info', 3500); return false; }
  return openBriefingHit(hit);
}

/** Link aus dem Claude-Chat (`#add=…&peer=…`): Prüffenster für die Alternativen. */
function handlePeerHash() {
  const request = parsePeerHash(location.hash);
  if (!request) return false;
  history.replaceState(null, '', location.pathname + location.search);
  openImportCheck(request);
  return true;
}

function openImportCheck(request, title) {
  openPeerImportModal({
    request,
    title,
    blocked: useMock
      ? 'Dieser Browser ist nicht mit deinem Discovery-Backend verbunden. Öffne den Link in dem Browser, in dem die App eingerichtet ist.'
      : null,
    backend: {
      backendUrl: localStorage.getItem('discovery_backend_url'),
      secret: localStorage.getItem('discovery_secret'),
    },
    loadExisting: async () => {
      const labels = { inbox: 'Inbox', watch: 'Watch', export: 'Export', archive: 'Archiv' };
      const found = new Map();
      for (const [bucket, label] of Object.entries(labels)) {
        const blob = await ensureBlob(bucket);
        for (const c of blob?.candidates ?? []) found.set(candidateKey(c), `liegt in ${label}`);
      }
      return found;
    },
    onImport: async (candidates) => {
      await importCandidates(candidates);
      await switchBlob('inbox');
    },
  });
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

/* Yahoo-Kursziele im Anreicherungslauf: sechs gleichzeitig, wie bei den
   LS-Abrufen — genug Tempo, ohne dass unsere Funktion eine Salve sieht. */
const YH_BATCH = 6;


/* Firmenprofil am Kandidaten speichern (ein Feld, ein Schreibvorgang). Im
   Mock-Modus nur im Speicher. */
async function saveProfile(candidate, profile) {
  if (useMock) return;
  try { await storageClient.updateCandidate(currentBlobType, candidate.id, { company_profile: profile }); }
  catch (err) { console.warn('[profile] speichern fehlgeschlagen:', err.message); }
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

  // Detail sheet: Firmenprofil auf Knopfdruck laden (ROIC.ai mit Key, sonst
  // Wikipedia de→en; beide browserseitig). Ein Treffer wird gekürzt als
  // company_profile am Kandidaten im Blob gespeichert — danach steht er auf
  // jedem Gerät ohne erneuten Abruf im Sheet. „neu laden“ (force) holt frisch.
  // Fehlversuche bleiben nur im Speicher (Button erlaubt Retry), nie im Blob.
  if (action === 'loadProfile') {
    const force = extras?.force === true;
    if (candidate._profile_loading || (!force && candidate.company_profile?.description)) return;
    const rerender = () => { if (candidateDetail.candidate?.id === candidate.id) candidateDetail.render(); };
    const before = candidate.company_profile;
    candidate._profile_loading = true; rerender();
    let profile = null;
    try {
      profile = await fetchCompanyProfile(candidate, {
        backendUrl: localStorage.getItem('discovery_backend_url'),
        secret:     localStorage.getItem('discovery_secret'),
      }, { force });
    } catch (err) { console.warn('[profile] fetch fehlgeschlagen:', err.message); }
    candidate._profile_loading = false;
    const compact = compactProfile(profile);
    // Neu laden ohne Ergebnis: das gespeicherte Profil behalten.
    candidate.company_profile = compact ?? (before?.description ? before : { error: true });
    rerender();
    if (compact) await saveProfile(candidate, compact);
    else if (force) toast('Kein neueres Profil gefunden – das gespeicherte bleibt.', 'info', 3000);
    return;
  }

  // Detail sheet: News-Tab. ROIC und TV laden unabhängig (je 30-min-Cache,
  // force = Aktualisieren-Button): fällt eine Quelle aus, bleibt die andere stehen.
  if (action === 'loadNews') {
    const auth = {
      backendUrl: localStorage.getItem('discovery_backend_url'),
      secret:     localStorage.getItem('discovery_secret'),
    };
    const force = extras?.force === true;
    const rerender = () => { if (candidateDetail.candidate?.id === candidate.id) candidateDetail.render(); };
    // Nicht-aufzählbar: flüchtige Anzeigedaten dürfen in keinen Blob-Schreibvorgang geraten.
    const keep = (field, value) => Object.defineProperty(candidate, field, {
      value, enumerable: false, writable: true, configurable: true,
    });
    const load = async (flag, field, fetcher) => {
      if (candidate[flag]) return;
      if (!force && candidate[field] && !candidate[field].error) return;
      keep(flag, true); rerender();
      let news;
      try {
        news = await fetcher(candidate, auth, { force });
      } catch (err) {
        console.warn(`[news] ${field} fehlgeschlagen:`, err.message);
        news = { error: true, message: err.message };
      }
      keep(field, news);
      keep(flag, false);
      rerender();
    };
    // Der Prog.-Tab braucht nur die Analystenmeldungen, das schont das ROIC-Limit.
    await Promise.all([
      ...(extras?.tvOnly ? [] : [load('_news_loading', 'company_news', fetchCompanyNews)]),
      load('_tv_news_loading', 'tv_news', fetchTvNews),
    ]);
    return;
  }

  // Fund-Tab: letztes Earnings-Call-Transcript (ROIC), 7-Tage-Cache.
  if (action === 'loadTranscript') {
    if (candidate._transcript_loading) return;
    const rerender = () => { if (candidateDetail.candidate?.id === candidate.id) candidateDetail.render(); };
    candidate._transcript_loading = true; rerender();
    try {
      candidate.company_transcript = await fetchLatestTranscript(candidate, {
        backendUrl: localStorage.getItem('discovery_backend_url'),
        secret:     localStorage.getItem('discovery_secret'),
      });
    } catch (err) {
      console.warn('[transcript] fetch fehlgeschlagen:', err.message);
      candidate.company_transcript = { error: true, message: err.message };
    }
    candidate._transcript_loading = false;
    rerender();
    return;
  }

  // Fund.-Tab: FMP-Zweitmeinung (DCF + Rating). Nur US-Titel — der Free-Plan
  // sperrt alles andere mit 402. Nicht persistiert: 250 Anfragen/Tag sind knapp,
  // aber der Client cacht 24 h in localStorage, was fürs Blättern reicht.
  if (action === 'fmpValuation') {
    if (candidate._fmp_loading) return;
    const backendUrl = localStorage.getItem('discovery_backend_url');
    const secret     = localStorage.getItem('discovery_secret');
    if (!backendUrl || !secret) { toast('Backend nicht konfiguriert', 'error'); return; }
    const rerender = () => { if (candidateDetail.candidate?.id === candidate.id) candidateDetail.render(); };
    candidate._fmp_loading = true; rerender();
    try {
      candidate.fmp_valuation = await fetchFmpValuation(candidate, { backendUrl, secret });
    } catch (err) {
      console.warn('[fmp] fetch fehlgeschlagen:', err.message);
      candidate.fmp_valuation = { error: 'http', checked_at: new Date().toISOString() };
    }
    candidate._fmp_loading = false;
    rerender();
    return;
  }

  /* Prog.-Tab: Analysten-Kursziel von Yahoo — nur als Fallback, wenn TV für den
     Titel keins hat. Wie beim Sentiment nur im Speicher plus localStorage-Cache
     (12 h) in `analyst-targets.js`; ein Kursziel im Blob würde nur veralten. */
  if (action === 'yahooTargets') {
    if (candidate._yh_loading) return;
    const backendUrl = localStorage.getItem('discovery_backend_url');
    const secret     = localStorage.getItem('discovery_secret');
    if (!backendUrl || !secret) { toast('Backend nicht konfiguriert', 'error'); return; }
    const rerender = () => { if (candidateDetail.candidate?.id === candidate.id) candidateDetail.render(); };
    candidate._yh_loading = true; rerender();
    try {
      candidate.yh_targets = await fetchYahooTargets(candidate, { backendUrl, secret, force: extras?.force });
      if (candidate.yh_targets?.error === 'none') toast('Yahoo kennt für diesen Titel kein Kursziel', 'info');
      else if (candidate.yh_targets?.error) toast(`Yahoo-Kursziel fehlgeschlagen (${candidate.yh_targets.error})`, 'error');
    } catch (err) {
      console.warn('[yahoo-targets] fetch fehlgeschlagen:', err.message);
      candidate.yh_targets = { error: 'http', detail: err.message };
    }
    candidate._yh_loading = false;
    rerender();
    return;
  }

  // Trend-Tab: Retail-Stimmung (StockTwits Bull/Bear-Tagesreihe).
  // Bewusst nur im Speicher, nicht persistiert: die Quote ist tagesaktuell und
  // in 60 min ohnehin neu zu holen — sie im Blob abzulegen würde nur veralten.
  if (action === 'stSentiment') {
    if (candidate._st_loading) return;
    const backendUrl = localStorage.getItem('discovery_backend_url');
    const secret     = localStorage.getItem('discovery_secret');
    if (!backendUrl || !secret) { toast('Backend nicht konfiguriert', 'error'); return; }
    const rerender = () => { if (candidateDetail.candidate?.id === candidate.id) candidateDetail.render(); };
    candidate._st_loading = true; rerender();
    try {
      candidate.st_sentiment = await fetchStocktwitsSentiment(candidate, { backendUrl, secret });
    } catch (err) {
      console.warn('[stocktwits] fetch fehlgeschlagen:', err.message);
      candidate.st_sentiment = { error: err.message, checked_at: new Date().toISOString() };
    }
    candidate._st_loading = false;
    rerender();
    return;
  }

  // Detail toolbar: Swing-Check (OHLC → support/resistance zones + Bias-Historie).
  // On-demand, persistiert als swing_analysis. Quelle nach Titel: US →
  // TwelveData (Key nötig), sonst Yahoo über die scrape-proxy (Backend nötig).
  if (action === 'tdQuote') {
    const us = isUsTicker(candidate);
    if (us && !localStorage.getItem('discovery_twelvedata_key')) { toast(swingErrorText('no_key'), 'error', 4000); return; }
    const backendUrl = localStorage.getItem('discovery_backend_url');
    const secret     = localStorage.getItem('discovery_secret');
    if (!us && (!backendUrl || !secret)) { toast(swingErrorText('no_backend'), 'error', 4000); return; }
    const rerender = () => { if (candidateDetail.candidate?.id === candidate.id) candidateDetail.render(); };
    candidate._swing_loading = true; rerender();
    let result;
    try {
      result = await fetchSwingAnalysis(candidate, { eurUsd: resolveFxRate(), backendUrl, secret });
    } catch (err) {
      result = { error: us ? 'td_error' : 'yf_error', message: err.message };
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
    if (!confirm(`${candidate.symbol} endgültig aus „${candidate._bucket ?? currentBlobType}" löschen?`)) return;
    if (!useMock) {
      try {
        // Löschen = echtes Hard-Delete. Inbox: zusätzlich Tombstone (Re-Add-
        // Schutz), aber NICHT ins Archiv (Archiv = nur manuell verworfene).
        // Archive/export: reines Hard-Delete (Adapter schreiben dort nie).
        if (currentBlobType === 'inbox') {
          try { await storageClient.deleteAndTombstone('inbox', [candidate.id]); }
          catch { await storageClient.deleteCandidate('inbox', candidate.id); }
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
    if (candidateDetail?.candidate?.id === candidate.id) candidateDetail.render();
    return;
  }

  // Dossier (Google Doc je Watch-Ticker): Flag am Kandidaten setzen, dann die
  // GitHub Action über /api/dossier-trigger anstossen. Geht der Anstoss schief,
  // bleibt der Auftrag am Kandidaten stehen und der tägliche Sweep holt ihn nach.
  // Alle offenen Dossiers sofort erstellen (Sweep, ohne Kandidaten-ID).
  if (action === 'runDossiers') {
    if (useMock) return;
    try {
      await postDossierTrigger({ mode: 'sweep' });
      toast('Dossier-Lauf gestartet — offene Aufträge werden erstellt (≈ 2 min)', 'success', 3500);
      pollDossiers();
    } catch (err) {
      toast(`Dossier-Lauf fehlgeschlagen: ${err.message}`, 'error', 6000);
    }
    return;
  }

  if (action === 'toggleDossier' || action === 'updateDossier') {
    const dos = candidate.dossier ?? {};
    if (dos.status === 'queued' || dos.status === 'running') { toast('Dossier wird gerade erstellt …', 'info', 2500); return; }
    if (action === 'updateDossier' && !dos.doc_id) return;
    // Haken raus (angelegt, kein Fehler): nur das Flag entfernen — das Doc bleibt in Drive.
    const unflag = action === 'toggleDossier' && candidate.dossier_flag && dos.status !== 'error';
    const mode = action === 'updateDossier' ? 'update' : 'create';
    const updates = unflag
      ? { dossier_flag: false }
      : {
          dossier_flag: true,
          ...(mode === 'update' ? { dossier_update: true } : {}),
          dossier: { ...dos, status: 'queued', error: null, queued_at: new Date().toISOString() },
        };
    const before = { dossier_flag: candidate.dossier_flag, dossier_update: candidate.dossier_update, dossier: candidate.dossier };
    Object.assign(candidate, updates);
    candidateList.renderRows();
    if (useMock) return;
    try {
      await storageClient.updateCandidate(currentBlobType, candidate.id, updates);
    } catch (err) {
      Object.assign(candidate, before);
      candidateList.renderRows();
      toast(`Speichern fehlgeschlagen: ${err.message}`, 'error');
      return;
    }
    if (unflag) return;
    try {
      await postDossierTrigger({ candidate_id: candidate.id, mode });
      pollDossiers();
      toast(`Dossier ${candidate.symbol}: ${mode === 'update' ? 'Update' : 'Anlage'} gestartet (≈ 2 min)`, 'success', 3500);
    } catch (err) {
      toast(`Dossier-Start fehlgeschlagen (${err.message}) — der tägliche Lauf holt es nach`, 'error', 6000);
    }
    return;
  }

  if (action === 'toggleWatch') {
    candidate.watch_flag = !candidate.watch_flag;
    if (!useMock) {
      try {
        await storageClient.updateCandidate(currentBlobType, candidate.id, { watch_flag: candidate.watch_flag });
      } catch (err) {
        toast(`Speichern fehlgeschlagen: ${err.message}`, 'error');
        candidate.watch_flag = !candidate.watch_flag; // revert
        return;
      }
    }
    candidateList.renderRows();
    if (candidateDetail?.candidate?.id === candidate.id) candidateDetail.render();
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
    // Der eigene Research-Prompt reitet auf demselben Speichern wie die Links —
    // beides steht im selben Bearbeiten-Feld, also gehört es in einen Request.
    candidate.links = extras.links;
    const patch = { links: extras.links };
    const mappingChanged = 'merkliste_symbol' in extras && (extras.merkliste_symbol ?? null) !== (candidate.merkliste_symbol ?? null);
    if (mappingChanged) {
      candidate.merkliste_symbol = extras.merkliste_symbol;
      patch.merkliste_symbol = extras.merkliste_symbol;
    }
    if ('research_prompt' in extras) {
      candidate.research_prompt = extras.research_prompt;
      patch.research_prompt = extras.research_prompt;
    }
    if (!useMock) {
      try {
        await storageClient.updateCandidate(currentBlobType, candidate.id, patch);
      } catch (err) {
        toast(`Speichern fehlgeschlagen: ${err.message}`, 'error');
        return;
      }
    }
    // Neues Mapping: Einstand und P/L sofort über den neuen Schlüssel zuordnen.
    if (mappingChanged && merklisteMaps) {
      applyMerklisteEntries(allBlobs[currentBlobType]?.candidates ?? [], merklisteMaps);
      candidateList.renderRows();
    }
    toast('Gespeichert', 'success', 1500);
  }

  /* Detail-Sheet geöffnet: alle vier Quellen frisch holen — LS-Kurs, Kerzen
     (TD/Yahoo), TR-Handelbarkeit und die Yahoo-Kursziele. Das gilt überall
     gleich, am Desktop wie am Handy: wer ein Sheet öffnet, will die aktuellen
     Zahlen sehen, nicht die vom letzten Blick. Deshalb `force` — die Fristen
     aus detail-autofetch.js greifen hier nicht mehr, nur noch die harten
     Bedingungen (kein Backend/Mock, US-Kerzen ohne TwelveData-Key, Kursziele
     ohne Yahoo-Symbol) und die Sperre gegen eine doppelte laufende Runde.
     Bewusst OHNE Toasts — der Nutzer hat nichts angefordert, er hat nur ein
     Sheet geöffnet; die Ladezustände stehen in den Tabs selbst. Fehler landen
     in der Konsole, nicht auf dem Bildschirm. */
  if (action === 'detailOpened') {
    const backendUrl = localStorage.getItem('discovery_backend_url');
    const secret     = localStorage.getItem('discovery_secret');
    const c = candidate;
    // Firmenprofil, das nur im Gerätecache liegt (vor der Blob-Speicherung
    // geladen): ohne Netz übernehmen und einmalig in den Blob schreiben.
    if (!c.company_profile?.description) {
      const hit = compactProfile(cachedCompanyProfile(c));
      if (hit) { c.company_profile = hit; candidateDetail.render(); saveProfile(c, hit); }
    }
    // Steht direkt unter dem Chart: fehlt es, einmal selbst holen. Ein Treffer landet
    // im Blob, ein Fehlversuch bleibt für diese Sitzung beim Knopf (spart ROIC-Limit).
    if (!useMock && !c.company_profile?.description && !c.company_profile?.error) {
      handleAction('loadProfile', c);
    }
    const plan = autoFetchPlan(c, {
      force: true,
      busy: !!c._auto_busy,
      hasBackend: !!(backendUrl && secret),
      isMock: useMock,
      isUs: isUsTicker(c),
      hasTdKey: !!localStorage.getItem('discovery_twelvedata_key'),
      hasYahooSymbol: !!yahooSymbol(c),
    });
    if (plan.skip) return;
    c._auto_at = Date.now();
    c._auto_busy = true;

    const rerender = () => { if (candidateDetail.candidate?.id === c.id) candidateDetail.render(); };
    const patch = {};
    const jobs = [];

    if (plan.ls) {
      jobs.push((async () => {
        c.ls_quote = { ...(c.ls_quote ?? {}), _fetching: true };
        const q = await fetchLsQuote(c, { backendUrl, secret });
        c.ls_quote = q;
        if (q?.price != null) patch.ls_quote = q;
      })());
    }

    if (plan.bars) {
      jobs.push((async () => {
        c._swing_loading = true;
        try {
          const r = await fetchSwingAnalysis(c, { eurUsd: resolveFxRate(), backendUrl, secret });
          if (!r?.error) { c.swing_analysis = r; patch.swing_analysis = r; }
        } finally { c._swing_loading = false; }
      })());
    }

    if (plan.tr) {
      jobs.push((async () => {
        const t = await checkTradeRepublic(c, { backendUrl, secret });
        if (t) { c.tr_check = t; patch.tr_check = t; }
      })());
    }

    if (plan.yh) {
      jobs.push((async () => {
        c._yh_loading = true;
        try {
          const r = await fetchYahooTargets(c, { backendUrl, secret });
          c.yh_targets = r;
          patch.yh_targets = r;
        } finally { c._yh_loading = false; }
      })());
    }

    if (!jobs.length) { c._auto_busy = false; return; }
    rerender();   // Ladezustände sichtbar machen, bevor gewartet wird
    const done = await Promise.allSettled(jobs);
    c._auto_busy = false;
    loadEurBasis([c], currentBlobType);             // nach den Kerzen: die schärfen den Faktor
    done.filter((d) => d.status === 'rejected')
      .forEach((d) => console.warn('[auto-fetch]', c.symbol, d.reason?.message ?? d.reason));
    rerender();
    candidateList.renderRows();

    // Ein Schreibvorgang für alles, was sich geändert hat.
    if (Object.keys(patch).length) {
      try { await storageClient.updateCandidate(currentBlobType, c.id, patch); }
      catch (err) { console.warn('[auto-fetch] speichern fehlgeschlagen:', err.message); }
    }
    return;
  }

  // ✨-Knopf im Detail-Sheet: Modal mit den Recherche-Prompts.
  // Dazu oben der Bereich „AI Research ins Dossier" (nur Watch-Titel mit Backend).
  if (action === 'openPrompts') {
    const onWatch = currentBlobType === 'watch' || (currentBlobType === 'all' && candidate._bucket === 'watch');
    const canQueue = !useMock && onWatch;
    openAiPromptModal(candidate, {
      currency: extras?.currency,
      hint: useMock ? '' : onWatch ? '' : 'AI Research ins Dossier gibt es nur für Watchlist-Titel.',
      queue: canQueue ? { catalog: loadResearchCatalog, enqueue: (keys) => enqueueResearch(candidate, keys) } : null,
    });
    return;
  }

  if (action === 'openTrigger') {
    openTriggerEditor(candidate, {
      onSaveAlerts: persistAlerts,
      range: rangeEditorOpts,
      presetSide: extras?.side ?? null,
      onSaved: () => candidateList.renderRows(),
      toast,
    });
    return;
  }

  // Nachkauf-Kalkulator (★-Zeilen der Standard-Ansicht). Reiner Rechner —
  // Einstand/Stückzahl bleiben in der Merkliste, es wird nichts persistiert.
  if (action === 'openNachkauf') {
    openNachkaufModal(candidate);
    return;
  }

  // Tap on the detail chart → open the Trigger editor with the tapped price
  // (EUR) pre-filled into the manual-price field.
  // Alarm auf Support/Resistance aus dem Kerzen-Chart — dieselbe Rechnung wie im Range-Modal.
  if (action === 'rangeAlarm') {
    const bucket = currentBlobType === 'all' ? bucketOfId(candidate.id) : currentBlobType;
    if (bucket === 'archive') { toast('Im Archiv laufen keine Alarme.', 'error', 3000); return; }
    const { it, ov, lp, hist } = rangeInputs(candidate, resolveFxRate());
    const { patch } = rangeAlarmPatch(candidate, rangeView(it, ov, { p: lp ?? it.p }, hist), extras.on);
    const before = { alerts: candidate.alerts, range_alarm: candidate.range_alarm };
    const refresh = () => { candidateDetail.render(); candidateList.renderRows(); updateAlertBadge(); };
    Object.assign(candidate, patch);
    refresh();
    try {
      if (!useMock && storageClient) await storageClient.updateCandidate(bucket, candidate.id, patch);
    } catch (e) {
      Object.assign(candidate, before);
      refresh();
      toast(`Alarm nicht gespeichert: ${e.message}`, 'error', 4000);
    }
    return;
  }

  if (action === 'chartAlert') {
    openTriggerEditor(candidate, {
      onSaveAlerts: persistAlerts,
      range: rangeEditorOpts,
      onSaved: () => candidateList.renderRows(),
      toast,
      prefillPriceEur: extras.priceEur,
    });
    return;
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

/** TD-Tageskerzen für EINEN Kandidaten laden und persistieren (US-only, TD-Free).
 *  Gibt das Ergebnis zurück – inkl. `{ error }`, damit Aufrufer bei einem
 *  Rate-Limit abbrechen können, statt weiter Credits zu verbrennen. */
async function fetchTdBars(candidate) {
  if (!isUsTicker(candidate)) return { error: 'not_us' };
  if (!localStorage.getItem('discovery_twelvedata_key')) {
    toast(swingErrorText('no_key'), 'error', 4000);
    return { error: 'no_key' };
  }
  let result;
  try {
    result = await fetchSwingAnalysis(candidate, { eurUsd: resolveFxRate() });
  } catch (err) {
    result = { error: 'td_error', message: err.message };
  }
  if (result?.error) {
    toast(`${candidate.symbol}: ${swingErrorText(result.error)}`, 'error', 4000);
    return result;
  }
  candidate.swing_analysis = result;
  if (!useMock) {
    try {
      await storageClient.updateCandidate(currentBlobType, candidate.id, { swing_analysis: result });
    } catch { /* Anzeige funktioniert auch ohne Persistenz */ }
  }
  return result;
}

const AI_URL_MAX = 12000;   // längere Links kappen die Chat-Seiten bzw. Proxys

/** Text in die Zwischenablage, mit Textarea-Fallback (file:// ohne Clipboard-API). */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* Fallback */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

async function handleBulkAction(action, ids) {
  const blob = allBlobs[currentBlobType];
  if (!blob) return;
  const targets = blob.candidates.filter((c) => ids.includes(c.id));

  /* Research-Prompt der Auswahl direkt als neuen Chat öffnen (Claude / Perplexity).
     Synchron vor jedem await, sonst fällt die Nutzergeste weg und der Popup-Blocker greift.
     Zu lange Links (viele Titel) öffnen den leeren Chat; der Prompt liegt dann in der Zwischenablage. */
  if (action === 'ai-claude' || action === 'ai-perplexity') {
    if (!targets.length) return;
    const target = action === 'ai-claude' ? 'claude' : 'perplexity';
    const prompt = buildResearchPrompt(targets);
    let url = promptUrl(target, prompt);
    const tooLong = url.length > AI_URL_MAX;
    if (tooLong) { url = promptUrl(target, ''); copyText(prompt); }
    window.open(url, '_blank', 'noopener');
    toast(tooLong
      ? `Prompt für ${targets.length} Ticker zu lang für den Link – kopiert, im Chat einfügen`
      : `Research-Prompt für ${targets.length} Ticker in ${target === 'claude' ? 'Claude' : 'Perplexity'} geöffnet`,
    tooLong ? 'info' : 'success', 4000);
    return;
  }

  // Vergleich: reine Ansicht auf bereits geladenen Daten – kein Schreibzugriff.
  if (action === 'compare') {
    if (targets.length < 2) { toast('Mindestens zwei Kandidaten auswählen', 'info', 2500); return; }
    renderCompareModal(targets, {
      onLoadTv: () => handleBulkAction('tv-data', ids),
      onFetchTd: (c) => fetchTdBars(c),
    });
    return;
  }

  if (action === 'delete') {
    if (!confirm(`${targets.length} Kandidat(en) endgültig aus „${currentBlobType}" löschen?`)) return;
    const ids = targets.map((c) => c.id);
    if (!useMock) {
      // Löschen ist ein echtes Hard-Delete. In der Inbox zusätzlich Tombstone,
      // damit die Adapter den Wert nicht neu anlegen — OHNE ihn ins Archiv zu
      // schieben (Archiv = nur manuell verworfene Werte). Fallback auf Hard-
      // Delete ohne Tombstone, falls das Backend die neue Op noch nicht kennt.
      try {
        if (currentBlobType === 'inbox') {
          await storageClient.deleteAndTombstone('inbox', ids);
        } else {
          await storageClient.deleteCandidates(currentBlobType, ids);
        }
      } catch {
        try {
          await storageClient.deleteCandidates(currentBlobType, ids);
        } catch (err) {
          toast(`Löschen fehlgeschlagen: ${err.message}`, 'error');
        }
      }
    }
    const idSet = new Set(ids);
    blob.candidates = blob.candidates.filter((x) => !idSet.has(x.id));
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
    const ids = targets.map((c) => c.id);
    if (!useMock) {
      try {
        await storageClient.moveCandidates(ids, currentBlobType, 'export');
        allBlobs.export = null;
      } catch {
        // Fallback: Einzel-Ops (altes Backend ohne Bulk-Op)
        for (const c of targets) {
          try {
            await storageClient.moveCandidate(c.id, currentBlobType, 'export');
            allBlobs.export = null;
          } catch (err) {
            toast(`Export fehlgeschlagen: ${c.symbol} – ${err.message}`, 'error');
          }
        }
      }
    } else {
      for (const c of targets) await mockInsert('export', c);
    }
    const idSet = new Set(ids);
    blob.candidates = blob.candidates.filter((x) => !idSet.has(x.id));
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
    if (!(await copyText(prompt))) { toast('Kopieren fehlgeschlagen – Clipboard nicht verfügbar', 'error'); return; }
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

    /* Analysten-Kursziele von Yahoo gehören zur Anreicherung, nicht in einen
       Notfallpfad: sie liefern als Einzige die Anzahl der Schätzungen und eine
       zweite Meinung neben TV. Sie laufen deshalb hier mit — in Wellen von
       YH_BATCH, und nur für Titel, deren letztes Ergebnis älter als 12 h ist
       (auch eine Fehlanzeige zählt, sonst fragt jeder Lauf dieselben Titel
       erneut). Ein Fehler bremst den TV-Lauf nicht aus: die Kursziele sind
       Beiwerk, die TV-Daten sind der Zweck. */
    const yhTargets = targets.filter((c) => yahooSymbol(c) && !yahooFresh(c));
    if (yhTargets.length) {
      toast(`🔎 Analysten-Kursziele (Yahoo) für ${yhTargets.length} Titel…`, 'info', 8000);
      let done = 0;
      for (let i = 0; i < yhTargets.length; i += YH_BATCH) {
        await Promise.all(yhTargets.slice(i, i + YH_BATCH).map(async (c) => {
          try {
            const res = await fetchYahooTargets(c, { backendUrl, secret });
            c.yh_targets = res;
            if (res?.mean != null) done++;
            const u = bulkUpdates.find((b) => b.candidate_id === c.id);
            if (u) u.updates.yh_targets = res;
            else bulkUpdates.push({ candidate_id: c.id, updates: { yh_targets: res } });
          } catch (err) {
            console.warn('[yahoo-targets]', c.symbol, err.message);
          }
        }));
      }
      console.log(`[yahoo-targets] ${done}/${yhTargets.length} mit Kursziel`);
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
  performance.mark('app:init');
  // Init storage client
  if (!useMock) {
    storageClient = routeAll(loadStorageClient());
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
  uiState.fDup = '';   // Dubletten-Filter ist transient (bucket-abhängig, dupMap lädt async)
  candidateList.filters = {
    state:   '',
    sector:  uiState.fSector ?? [],
    mega:    uiState.fMega ?? [],
    capSize: uiState.fCap    ?? [],
    broker:  uiState.fBroker ?? '',
    score:   uiState.fScore  ?? [],
    tr:      uiState.fTr     ?? [],
    alerts:  uiState.fAlerts ?? '',
    lsTrend: uiState.fLsTrend ?? [],
    dup:     '',
    search:  '',
  };

  // Currency display: saved preference + best available EUR/USD rate,
  // then refresh the live rate from TV in the background.
  const fx = resolveFxRate();
  if (fx) candidateList.setFxRate(fx);
  if (uiState.currency !== 'USD') candidateList.setDisplayCurrency(uiState.currency);
  refreshFxRate();

  // Zusatzdaten parallel zum Bucket-Blob anstossen: sind sie vor dem Blob da, hängt
  // switchBlob sie vor der ersten Zeichnung an – eine Zeichnung statt fünf.
  loadMerklisteEntries(true);
  loadLsHistory();
  loadAnalystEvents();
  loadDailyPicks();

  // Load initial data (also calls renderBotnav + renderFilterbar)
  await switchBlob(currentBlobType);
  performance.mark('app:first-render');
  // Chart-Bibliothek im Leerlauf vorladen (Detail-Sheet, Watch Ranges).
  (window.requestIdleCallback ?? ((f) => setTimeout(f, 1500)))(() => loadCharts());

  updateMockBadge();

  // Merkliste ("Einstand"/Stückzahl) lädt oben parallel zum Blob. LS-Kurse
  // holt der Start nur für die ★-Liste selbst, sonst auf Abruf (LS-Kurs-Knopf).
  refreshStarLsOnLoad();

  // Deep link from an ntfy push (`#c=<id>`): open that candidate's detail
  // sheet on load, and on later hash changes (second push while app is open).
  if (candidateIdFromHash()) openCandidateById(candidateIdFromHash());
  else if (!handlePeerHash()) handleBriefingHash();
  window.addEventListener('hashchange', () => {
    const id = candidateIdFromHash();
    if (id) openCandidateById(id);
    else if (!handlePeerHash()) handleBriefingHash();
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
    if (currentBlobType === 'all') { allBlobs.watch = null; allBlobs.archive = null; }
    await switchBlob(currentBlobType);
    await loadMerklisteEntries(true); // re-pull merkliste Einstand prices
    await loadLsHistory(true);        // re-pull the 10-day LS history (Trade view)
    await loadAnalystEvents(true);
    loadDailyPicks(true);
    toast('Aktualisiert', 'info', 1500);
  });

  document.getElementById('btn-run').addEventListener('pointerup', openRunSheet);

  document.getElementById('btn-upload').addEventListener('pointerup', () => {
    renderUploadModal({ onImport: importCandidates });
  });

  // Briefing: Marktbriefing aus dem market-Blob (Claude-Tagesauswertung).
  document.getElementById('nav-briefing').addEventListener('pointerup', () => openMarketBriefing());

  // Watch Ranges: 1:1-Kopie des Claude-Artefakts als Modal, gespeist aus dem
  // Watch-Blob (Ranges wie /api/watch-ranges). Schreibt range_override, das
  // Alarm-Flag range_alarm und die wr_-Alerts direkt in den Watch-Blob.
  document.getElementById('btn-ranges').addEventListener('pointerup', () => {
    const canWrite = !useMock && !!storageClient;
    const backendUrl = localStorage.getItem('discovery_backend_url');
    const secret     = localStorage.getItem('discovery_secret');
    const afterWrite = () => { if (currentBlobType === 'watch' || currentBlobType === 'all') { candidateList.renderRows(); updateAlertBadge(); } };
    loadCharts().then(() => openRangesModal({
      getCandidates: async () => (await ensureBlob('watch'))?.candidates ?? [],
      getFx: resolveFxRate,
      persist: canWrite
        ? async (id, patch) => { await storageClient.updateCandidate('watch', id, patch); afterWrite(); }
        : async () => afterWrite(),
      // LS-Kurse in Wellen von 6 (wie die übrigen Bulk-Abrufe), je Titel persistiert.
      refreshLs: canWrite && backendUrl && secret
        ? async (cands, onEach) => {
            for (let i = 0; i < cands.length; i += 6) {
              await Promise.allSettled(cands.slice(i, i + 6).map(async (c) => {
                try {
                  const q = await fetchLsQuote(c, { backendUrl, secret });
                  if (q?.price != null) {
                    c.ls_quote = q;
                    await storageClient.updateCandidate('watch', c.id, { ls_quote: q }).catch(() => {});
                  }
                } finally { onEach(c); }
              }));
            }
            afterWrite();
          }
        : null,
      // Kerzen und EUR-Basis nachladen — derselbe Abruf wie im Detail-Sheet,
      // Ergebnis landet wie dort am Kandidaten im Watch-Blob.
      loader: canWrite && backendUrl && secret ? {
        isUs: (c) => isUsTicker(c),
        canCandles: (c) => !isUsTicker(c) || !!localStorage.getItem('discovery_twelvedata_key'),
        candles: async (c) => {
          const r = await fetchSwingAnalysis(c, { eurUsd: resolveFxRate(), backendUrl, secret });
          if (r?.error) return { ok: false, error: r.error, msg: swingErrorText(r.error) || r.message || r.error };
          c.swing_analysis = r;
          await storageClient.updateCandidate('watch', c.id, { swing_analysis: r }).catch((e) => console.warn('[ranges] Kerzen speichern:', e.message));
          afterWrite();
          return { ok: true };
        },
        eurBasis: async (c) => {
          const r = await fetchEurBasis(c, { backendUrl, secret });
          if (r?.error) return { ok: false, error: r.error, msg: 'Keine EUR-Kurse (LS, Yahoo, Wechselkurs) gefunden' };
          c.eur_basis = r;
          await storageClient.updateCandidate('watch', c.id, { eur_basis: r }).catch((e) => console.warn('[ranges] EUR-Basis speichern:', e.message));
          return { ok: true };
        },
      } : null,
      onOpenCandidate: async (c, ctrl) => {
        if (currentBlobType !== 'watch' && currentBlobType !== 'all') await switchBlob('watch');
        const cand = (allBlobs.watch?.candidates ?? []).find((x) => x.id === c.id) ?? c;
        ctrl.hide();
        returnToMonitor = () => ctrl.show();   // beim Schliessen des Sheets zurück ins Modal
        candidateDetail.show(cand);
        openDetailSheet();
      },
    }));
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

  // ── Topbar-Suche (ersetzt den Discovery-Titel): filtert den aktiven Bucket
  // über Symbol/Name/ISIN/Sektor/Industrie/Börse/Quellen/Health/Notizen.
  const searchEl = document.getElementById('global-search');
  const searchClear = document.getElementById('global-search-clear');
  const applySearch = () => {
    searchClear.hidden = !searchEl.value;
    candidateList.setSearch(searchEl.value);
  };
  let searchTimer = null;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applySearch, 150);
  });
  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { searchEl.value = ''; applySearch(); searchEl.blur(); }
  });
  searchClear.addEventListener('pointerup', () => { searchEl.value = ''; applySearch(); searchEl.focus(); });

  // ── Beim Runterscrollen in der Tabelle Topbar+Subbar einklappen (mobil),
  // beim Hochscrollen wieder zeigen. CSS (#app.is-compact) macht das nur
  // ≤767px sichtbar; hier nur die Klasse anhand der Scroll-Richtung togglen.
  //
  // Das Umschalten ändert die Grid-Zeilen und damit die Höhe von #content.
  // Am Seitenende sinkt dadurch die maximale Scrollposition, und der Browser
  // klemmt scrollTop um die Leistenhöhe nach unten. Ungeschützt liest der
  // Handler das als „hochgescrollt", klappt wieder aus, wodurch erneut geklemmt
  // wird — die Leisten springen dann im Frame-Takt. Deshalb setzt jedes
  // Umschalten die Richtungserkennung kurz aus (Referenz läuft mit), bis die
  // Layout-Transition und das Klemmen durch sind.
  const contentEl = document.getElementById('content');
  const appEl = document.getElementById('app');
  const SETTLE_MS = 350;   // > Grid-Transition (--t-fast = 120 ms) + Klemm-Nachlauf
  const DEAD_ZONE = 6;     // Mindestbewegung, damit Mikro-Deltas nichts auslösen
  let lastScrollY = 0, scrollTicking = false, settleUntil = 0;
  contentEl.addEventListener('scroll', () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      scrollTicking = false;
      const y = contentEl.scrollTop;
      const now = performance.now();
      // Nachlauf nach eigenem Umschalten: nur die Referenz mitziehen, nicht schalten.
      if (now < settleUntil) { lastScrollY = y; return; }
      // Zielzustand bestimmen und nur bei echter Änderung schreiben — sonst
      // setzt jeder Scroll-Frame das class-Attribut neu, ohne dass sich etwas
      // ändert.
      const isCompact = appEl.classList.contains('is-compact');
      let want = isCompact;
      if (y > lastScrollY + DEAD_ZONE && y > 56) want = true;
      else if (y < lastScrollY - DEAD_ZONE || y <= 8) want = false;
      if (want !== isCompact) {
        appEl.classList.toggle('is-compact', want);
        settleUntil = now + SETTLE_MS;
      }
      lastScrollY = y;
    });
  }, { passive: true });

  document.getElementById('btn-settings').addEventListener('pointerup', () => {
    renderSettingsModal(async () => {
      useMock = !isConfigured();
      storageClient = isConfigured() ? routeAll(loadStorageClient()) : null;
      allBlobs = { inbox: null, archive: null, export: null, watch: null, all: null };
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
      // Indices-Tab: Branchen-/Länder-Indizes (Liste in lib/tv-indices.js).
      onFetchIndexRows: async (entries) => {
        const backendUrl = localStorage.getItem('discovery_backend_url');
        const secret     = localStorage.getItem('discovery_secret');
        if (useMock || !backendUrl || !secret) return null;
        return fetchIndexRows({ backendUrl, secret, entries });
      },
      // News-Tab: Sektor-/Portfolio-Chips folgen dem Watch-Bucket.
      getWatchCandidates: async () => (await ensureBlob('watch'))?.candidates ?? [],
      // Sektoren-Heatmap: alle Kandidaten aus allen 4 Buckets (inbox + watch +
      // export + archive), dedupliziert nach Symbol+Börse. Archiv ist meist der
      // größte Topf (verworfene, aber TV-angereicherte Werte) → breitere Basis.
      getHeatCandidates: async () => {
        const blobs = await Promise.all(['inbox', 'watch', 'export', 'archive'].map((b) => ensureBlob(b)));
        const seen = new Set();
        const out = [];
        for (const c of blobs.flatMap((b) => b?.candidates ?? [])) {
          const k = `${normalizeExchange(c.exchange)}:${String(c.symbol ?? '').toUpperCase()}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(c);
        }
        return out;
      },
    });
  });

  // Monitor slot → dashboard for the active bucket (score movers, perf, signals).
  document.getElementById('nav-monitor').addEventListener('pointerup', () => {
    const candidates = allBlobs[currentBlobType]?.candidates ?? [];
    renderDashboardModal({
      candidates,
      bucket: currentBlobType,
      loadRankings,
      onOpenHit: (hit, ctrl) => openBriefingHit(hit, ctrl),
      onMoveHit: (hit, to) => moveRotationHit(hit, to),
      onMoveHits: (hits, to) => moveRotationHits(hits, to),
      // Gruppen-Auswahl im Monitor: Titel auswählen, „nur Auswahl“ an → Bulk-Leiste.
      onSelectInList: (ids) => {
        if (!ids.length) return;
        candidateList.setSelection(ids);
        candidateList.setShowSelectedOnly(true);
        renderSelectedPill();
        window.scrollTo(0, 0);
        toast(`${ids.length} Titel ausgewählt`, 'success');
      },
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
