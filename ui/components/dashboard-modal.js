/**
 * Dashboard / Monitor modal (bottom-nav slot "Monitor"), vier Reiter über den *aktiven Bucket*
 * (Reihenfolge Dynamik · Live · Rankings · Rotation, Dynamik öffnet zuerst):
 *
 *   Live      – Kacheln der Einzeltitel nach LS-Tagesveränderung (`ls_quote.change_pct`,
 *               Lang & Schwarz gegen Vortagesschluss), sortiert vom stärksten zum schwächsten,
 *               filterbar über die fünf Mega-Cluster-Icons. Live-Ticker (Aus · 1 · 2 · 5 min,
 *               gemerkt in localStorage) lädt die LS-Kurse der gezeigten Titel in Runden neu
 *               (`onRefreshLs`, je Runde höchstens 80, älteste zuerst); „Aktualisieren“ lädt alle
 *               gezeigten sofort. Während des Ladens pulsieren die Kacheln, ein Balken zeigt den
 *               Fortschritt, geänderte Werte blitzen kurz auf; Fehlversuche lädt die App im
 *               Hintergrund nach und markiert, was danach noch fehlt (Grund im Tooltip).
 *   Dynamik   – Signal-Matrix (components/signal-matrix.js): Zeilen = Mega-Cluster, Spalten =
 *               Signale (Score-/Momentum-/PCHS-Dynamik vs. Vortag, MACD-Dreher, SMA-Kreuzungen,
 *               Trends, RSI- und SMA200-Extreme). Ein Klick auf eine Zeile geht tiefer
 *               (Cluster → Sektor → Sub-Sektor → Titel), eine Zelle zeigt ihre Titel.
 *               Darunter die Setup-Matrix (components/setup-matrix.js) über denselben Ausschnitt:
 *               Setup-Typ × Signal, Scatter EPS-Wachstum vs. %S200 mit Brush, %S200-Quintile;
 *               alle Filter zusammen, Treffer → „In Tabelle öffnen“. Signal-Matrix und Setup-Teil
 *               filtern sich gegenseitig (gewählte Signal-Zelle ↔ Setup-Zelle/Quintil/Brush).
 *               Ganz oben die fünf Mega-Cluster-Icons: Filter für alle Grafiken des Reiters
 *               (= Drill-down auf den Cluster, nochmal tippen = alle).
 *   Rankings  – ganz oben die Ranking-Matrix (RSI gegen Score 0–100 je Liste, Zoom + Tabelle,
 *               components/zoom-scatter.js), darunter Umschalter Live (fünf technische Listen) ·
 *               KI-Ranking (Sonntag) · Tagessieger.
 *
 * Ausschnitt (seit 23.11.2026): Ist die Hauptliste gefiltert, beziehen sich alle Grafiken auf die
 * gefilterten Titel (`candidates`), sonst auf den ganzen Bucket. `universe` = ganzer Bucket, nur für
 * die Perzentile der Rankings (Scores bleiben so mit dem ungefilterten Stand vergleichbar).
 *   Rotation  – Tagesbericht der Auto-Rotation.
 *
 * Das Markt-Dashboard (Treemap) liegt seit Nov. 2026 im Markets-Modal (Reiter „Markt“).
 * All metrics come from dashboard-metrics (client-side).
 *
 * renderDashboardModal returns a controller { overlay, show, hide, close } so the
 * app can hide the dashboard while a candidate detail sheet is open and restore
 * it when the sheet closes (X or swipe).
 */

import { icons } from '../lib/icons.js?v=20261123a';
import { pulse } from '../lib/dashboard-metrics.js?v=20261103h';
import { liveListHtml, weeklyRankingsHtml, rotationTabHtml, RANK_SEGS } from './rankings-panel.js?v=20261116a';
import { liveRankings, rankingPoints } from '../lib/rankings-filter.js?v=20261123a';
import { zoomScatterHtml, zsClick, zsVisible, bindZoomScatter } from './zoom-scatter.js?v=20261123a';
import { dailyPicksHtml } from './daily-picks-panel.js?v=20261107a';
import { signalMatrixHtml, selectedIds } from './signal-matrix.js?v=20261119c';
import { buildSetupModel, setupMatrixHtml, setupHitsHtml, setupHitCount, setupHits, hasSetupFilter, bindSetupBrush } from './setup-matrix.js?v=20261119d';
import { signalColumns } from '../lib/market-signals.js?v=20261116c';
import { groupsFor, scopeOf, withData, median, PERSPECTIVES } from '../lib/market-scope.js?v=20261116d';
import { MEGA_CLUSTERS, megaClusterOf, megaClusterLabel } from '../lib/sector-clusters.js?v=20260807a';

/* Icons der Mega-Cluster wie in der Subleiste (`SECTOR_ICONS` in app.js). */
const MEGA_ICONS = { tech: 'cpu', health: 'heartPulse', consumer: 'shoppingCart', industry: 'factory', finance: 'landmark' };
const LIVE_AUTO_MAX = 80;            // so viele Titel lädt eine Ticker-Runde höchstens (älteste zuerst)
const LIVE_STALE_MS = 15 * 60 * 1000;   // älter = Kachel als „alter Stand“ markiert
const LIVE_TICKS = [[0, 'Aus'], [1, '1 min'], [2, '2 min'], [5, '5 min']];
const LIVE_TICK_KEY = 'discovery_live_ticker_min';
const LIVE_CAP = 4;                  // ±4 % Tagesveränderung = volle Farbsättigung
const fmtPct = (v, dec = 1) => (v == null || Number.isNaN(v) ? '–' : `${v >= 0 ? '+' : '−'}${Math.abs(Number(v)).toFixed(dec)}%`);

const BUCKET_LABELS = { inbox: 'Inbox', archive: 'Archiv', export: 'Export', watch: 'Watchlist', all: 'Watch + Archiv' };
/* ── formatters ───────────────────────────────────────────────────────────── */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

function timeAgo(iso) {
  if (!iso) return '–';
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3.6e6);
  if (Number.isNaN(h)) return '–';
  if (h < 1) return 'vor <1 Std';
  if (h < 24) return `vor ${h} Std`;
  return `vor ${Math.round(h / 24)} T`;
}
function stamp(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  return Number.isNaN(d) ? '–'
    : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) +
      ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/* ── render the modal body from current state ─────────────────────────────── */

/* Seitenpanel der Trefferliste im Reiter „Dynamik“ (nur Desktop): offen/zu gemerkt. */
const DYN_SIDE_KEY = 'discovery_dyn_side';
function storedSide() { try { return localStorage.getItem(DYN_SIDE_KEY) !== '0'; } catch { return true; } }

export function renderDashboardModal({ candidates = [], universe = null, filterNote = '', bucket = 'inbox', onOpenDetail, loadRankings, onOpenHit, onSelectInList, onSetRotationMode, onRefreshLs } = {}) {
  if (document.getElementById('dashboard-modal-overlay')) return null;

  const filtered = !!universe && universe.length !== candidates.length;
  const all = universe ?? candidates;
  const state = { rkList: 'momentum', rkSub: 'live', sig: null,
    setup: { cell: null, q: null, brush: null }, side: storedSide() };
  const rk = { tab: 'dynamics', data: null, err: null, loading: false };
  // Dynamik: Drill-down-Pfad über die Perspektive `cluster` (Mega-Cluster → Sektor → Sub-Sektor).
  const base = withData(candidates);
  const dyn = { path: [] };
  const view = () => (dyn.path.length ? scopeOf(base, 'cluster', dyn.path) : candidates);

  /* Reiter Live: Einzeltitel als Kacheln nach LS-Tagesveränderung, Filter über Mega-Cluster.
     `lv.pending` = wird gerade geladen, `lv.failed` = letzter Versuch ohne Kurs (id → Grund),
     `lv.flash` = Wert hat sich in dieser Runde geändert (id → 'up' | 'down'). */
  const storedTick = () => { try { const v = Number(localStorage.getItem(LIVE_TICK_KEY)); return LIVE_TICKS.some(([m]) => m === v) ? v : 2; } catch { return 2; } };
  const lv = { seg: '', running: false, note: '', pending: new Set(), failed: new Map(), flash: new Map(),
    done: 0, total: 0, tick: storedTick(), nextAt: 0, timer: null, last: null };
  let closed = false;
  const lsChg = (c) => { const v = c?.ls_quote?.change_pct; return v == null || Number.isNaN(Number(v)) ? null : Number(v); };
  const liveSet = () => (lv.seg ? candidates.filter((c) => megaClusterOf(c.sector) === lv.seg) : candidates);
  const hhmm = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function liveTabHtml() {
    const set = liveSet();
    const all = set.map((c) => ({ c, v: lsChg(c) }));
    const rows = all.filter((r) => r.v != null).sort((a, b) => b.v - a.v);
    const blank = all.filter((r) => r.v == null);
    const up = rows.filter((r) => r.v > 0).length, down = rows.filter((r) => r.v < 0).length;
    const med = median(rows.map((r) => r.v));
    const filter = MEGA_CLUSTERS.map((m) => {
      const n = candidates.filter((c) => megaClusterOf(c.sector) === m.key).length;
      const act = lv.seg === m.key;
      const tip = act ? `${m.label} (${n}) · nochmal tippen: alle` : `Nur ${m.label} (${n})`;
      return `<button type="button" class="subnav-alert${act ? ' is-active' : ''}" data-lv-seg="${m.key}" aria-pressed="${act}" title="${esc(tip)}" aria-label="${esc(tip)}">${icons[MEGA_ICONS[m.key]] ?? ''}</button>`;
    }).join('');
    const tone = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
    const now = Date.now();
    const tile = (r) => {
      const q = r.c.ls_quote;
      const at = q?.checked_at ? new Date(q.checked_at).getTime() : null;
      const fail = lv.failed.get(r.c.id);
      const cls = ['md-tile', 'lv-tile'];
      if (lv.pending.has(r.c.id)) cls.push('is-loading');
      else if (fail) cls.push('is-failed');
      else if (r.v != null && (!at || now - at > LIVE_STALE_MS)) cls.push('is-stale');
      if (lv.flash.has(r.c.id)) cls.push(`lv-flash--${lv.flash.get(r.c.id)}`);
      const state = lv.pending.has(r.c.id) ? 'lädt …' : fail ? `kein neuer Kurs (${fail})` : at ? `Stand ${stamp(q.checked_at)}` : 'noch kein Kurs';
      const tip = `${r.c.name ?? r.c.symbol} · ${r.v != null ? `LS ${fmtPct(r.v, 2)}` : 'kein LS-Kurs'}${q?.price != null ? ` · ${Number(q.price).toFixed(2)} €` : ''} · ${state}`;
      const bg = r.v == null ? 'var(--surface-3)'
        : `color-mix(in srgb, var(${r.v >= 0 ? '--pos' : '--neg'}) ${Math.round(Math.min(Math.abs(r.v) / LIVE_CAP, 1) * 50 + 6)}%, var(--surface-2))`;
      return `<button type="button" class="${cls.join(' ')}" data-id="${esc(r.c.id)}" title="${esc(tip)}" aria-label="${esc(tip)}" style="background:${bg}">
        <span class="md-tile__name">${esc(r.c.symbol)}</span>
        <span class="md-tile__val">${r.v != null ? fmtPct(r.v) : '–'}</span>
        ${fail && !lv.pending.has(r.c.id) ? `<span class="lv-tile__warn" aria-hidden="true">${icons.info}</span>` : ''}
      </button>`;
    };
    const stale = rows.filter((r) => { const at = r.c.ls_quote?.checked_at; return !at || now - new Date(at).getTime() > LIVE_STALE_MS; }).length;
    const notes = [`Lang & Schwarz gegen Vortagesschluss · Farbe ab ±${LIVE_CAP} % voll`];
    if (lv.last) notes.push(`letzte Runde ${hhmm(lv.last)}`);
    if (lv.tick && !lv.running && lv.nextAt) notes.push(`nächste ${hhmm(lv.nextAt)}`);
    if (lv.tick && set.length > LIVE_AUTO_MAX) notes.push(`Ticker lädt je Runde die ${LIVE_AUTO_MAX} ältesten Kurse`);
    if (stale && !lv.running) notes.push(`${stale} mit altem Stand (gestrichelt)`);
    if (lv.failed.size && !lv.running) notes.push(`${[...lv.failed.keys()].filter((id) => set.some((c) => c.id === id)).length} ohne neuen Kurs (ⓘ)`);
    if (blank.length) notes.push(`${blank.length} ohne LS-Kurs`);
    if (lv.note) notes.push(lv.note);
    const pct = lv.total ? Math.round((lv.done / lv.total) * 100) : 0;
    return `<div class="md-ctl">
        <div class="lv-filter" role="group" aria-label="Mega-Cluster">${filter}</div>
        ${onRefreshLs ? `<div class="lv-actions">
          <span class="md-ctl__label">Ticker</span>
          <div class="dash-seg">${LIVE_TICKS.map(([m, l]) => `<button type="button" class="dash-seg__btn${m === lv.tick ? ' is-active' : ''}" data-lv-tick="${m}">${l}</button>`).join('')}</div>
          <button type="button" class="btn btn-sm btn-secondary${lv.running ? ' is-busy' : ''}" data-lv-refresh${lv.running ? ' disabled' : ''} title="LS-Kurse der gezeigten Titel jetzt laden" aria-label="LS-Kurse jetzt laden">${icons.refreshCw}${lv.running ? `<span>${lv.done}/${lv.total}</span>` : ''}</button>
        </div>` : ''}
      </div>
      <div class="lv-progress${lv.running ? ' is-on' : ''}" role="progressbar" aria-label="LS-Kurse laden" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
      <div class="md-kpis">
        <span><b>${rows.length}</b> Titel${lv.seg ? ` · ${esc(MEGA_CLUSTERS.find((m) => m.key === lv.seg)?.label ?? '')}` : ''}</span>
        <span class="pos">${icons.arrowUp}<b>${up}</b></span>
        <span class="neg">${icons.arrowDown}<b>${down}</b></span>
        <span class="md-kpis__med">Median heute <b class="${tone(med ?? 0)}">${fmtPct(med)}</b></span>
      </div>
      ${all.length ? `<div class="md-tm md-tm--grid lv-grid" data-group="live.tiles">${rows.map(tile).join('')}${blank.map(tile).join('')}</div>`
        : '<p class="dash-empty">Keine Titel in diesem Cluster.</p>'}
      <p class="md-note">${esc(notes.join(' · '))}</p>`;
  }
  function renderLive() {
    if (rk.tab !== 'live' || closed) return;
    const y = bodyEl.scrollTop;
    bodyEl.innerHTML = liveTabHtml();
    bodyEl.scrollTop = y;
    lv.flash.clear();                            // Aufblitzen nur in der Zeichnung, die es zeigt
  }
  // Fortschritt kommt je Titel – höchstens alle 200 ms neu zeichnen.
  let liveDraw = null;
  const renderLiveSoon = () => { liveDraw ??= setTimeout(() => { liveDraw = null; renderLive(); }, 200); };
  const scheduleNext = () => { lv.nextAt = lv.tick ? Date.now() + lv.tick * 60 * 1000 : 0; };

  /** Lädt die LS-Kurse der gezeigten Titel. `auto` = Ticker-Runde (höchstens LIVE_AUTO_MAX, älteste zuerst). */
  async function refreshLive(auto = false) {
    if (!onRefreshLs || lv.running || closed) return;
    const age = (c) => (c.ls_quote?.checked_at ? new Date(c.ls_quote.checked_at).getTime() : 0);
    let targets = [...liveSet()].sort((a, b) => age(a) - age(b));
    if (auto) targets = targets.slice(0, LIVE_AUTO_MAX);
    if (!targets.length) return;
    const before = new Map(targets.map((c) => [c.id, lsChg(c)]));
    lv.running = true; lv.note = ''; lv.done = 0; lv.total = targets.length;
    for (const c of targets) lv.pending.add(c.id);
    renderLive();
    try {
      const res = await onRefreshLs(targets.map((c) => c.id), {
        cancelled: () => closed,
        // Je Titel: fertig (ok/Fehler mit Grund) oder zweiter Anlauf im Hintergrund (`retry`).
        onProgress: ({ id, ok, retry, reason }) => {
          if (retry) { lv.pending.add(id); renderLiveSoon(); return; }
          lv.pending.delete(id);
          if (ok) {
            if (!lv.failed.delete(id)) lv.done++;
            const c = candidates.find((x) => x.id === id);
            const old = before.get(id), cur = lsChg(c);
            if (old != null && cur != null && Math.abs(cur - old) >= 0.005) lv.flash.set(id, cur > old ? 'up' : 'down');
          } else {
            if (!lv.failed.has(id)) lv.done++;
            lv.failed.set(id, reason || 'LS antwortet nicht');
          }
          renderLiveSoon();
        },
      });
      if (res == null) lv.note = 'LS-Kurse brauchen das Backend (nicht im Demo-Modus)';
    } catch (err) { lv.note = `Laden fehlgeschlagen: ${err.message}`; }
    lv.pending.clear();
    lv.running = false;
    lv.last = Date.now();
    scheduleNext();
    renderLive();
  }
  /* Ticker: prüft jede Sekunde, ob eine Runde fällig ist – nur solange der Live-Reiter
     sichtbar ist (Modal offen, nicht hinter einem Detail-Sheet, Browser-Tab im Vordergrund). */
  function startTicker() {
    if (lv.timer || !onRefreshLs) return;
    lv.timer = setInterval(() => {
      if (closed) { clearInterval(lv.timer); return; }
      if (!lv.tick || lv.running || rk.tab !== 'live' || overlay.style.display === 'none' || document.visibilityState !== 'visible') return;
      if (lv.nextAt && Date.now() >= lv.nextAt) refreshLive(true);
    }, 1000);
  }
  function showLive() {
    renderLive();
    if (!onRefreshLs) return;
    startTicker();
    if (!lv.last && !lv.running) refreshLive(true);   // erste Runde gleich beim Öffnen
  }

  function pulseBody() {
    const p = pulse(view());
    const arrows = `<span class="pos">${icons.arrowUp}${p.improved}</span>
      <span class="neg">${icons.arrowDown}${p.declined}</span>
      <span class="dash-muted">=${p.stable}</span>`;
    const alerts = (p.buy || p.sell)
      ? `<span class="dash-alert dash-alert--buy">${p.buy} Buy</span><span class="dash-alert dash-alert--sell">${p.sell} Sell</span>`
      : '<span class="dash-muted">keine aktiven Alerts</span>';
    return `<div class="dash-pulse__top">
        <span><b>${p.scored}</b>/${p.total} gescort</span>
        <span>Ø ${p.avg ?? '–'}</span>
        <span class="dash-pulse__delta">${arrows}</span>
      </div>
      <div class="dash-pulse__bot">
        <span class="dash-pulse__alerts">${alerts}</span>
        <span class="dash-muted">Stand: ${stamp(p.lastFetch)} (${timeAgo(p.lastFetch)})</span>
      </div>`;
  }

  /* Signal-Matrix: Zeilen = Gruppen der nächsten Ebene, Spalten = Signale. Die gewählte
     Zelle (`state.sig`) zeigt darunter ihre Titel. Je Pfad gecacht. */
  const sigCache = new Map();
  function sigData() {
    const key = dyn.path.join('>');
    if (!sigCache.has(key)) {
      const sc = scopeOf(base, 'cluster', dyn.path);
      const { title, rows } = groupsFor(sc, 'cluster', dyn.path);
      sigCache.set(key, { columns: signalColumns(sc), rows, rowTitle: title,
        drill: dyn.path.length < PERSPECTIVES.cluster.levels.length });
    }
    return { ...sigCache.get(key), sel: state.sig };
  }
  /* Verknüpfung Signal-Matrix ↔ Setup-Teil: Die Signal-Matrix zählt nur Titel, die die
     Setup-Filter (Zelle, Quintil, Brush) erfüllen; die gewählte Signal-Zelle filtert
     umgekehrt Setup-Matrix, Scatter, Quintile und Trefferliste. */
  const setupOnly = () => ({ ...state.setup, ids: null });
  function sigView() {
    const d = sigData();
    if (!hasSetupFilter(state.setup)) return d;
    const ok = new Set(setupHits(setupModel(), setupOnly()).map((m) => m.c.id));
    return { ...d, columns: d.columns.map((col) => ({ ...col, rows: col.rows.filter((x) => ok.has(x.c.id)) })) };
  }
  function setupSel() {
    const d = sigData();
    const col = d.sel && d.columns.find((c) => c.key === d.sel.col);
    if (!col) return setupOnly();
    const where = d.sel.row === 'all' ? '' : `${d.rows[Number(d.sel.row)]?.name ?? ''} · `;
    return { ...state.setup, ids: new Set(selectedIds(d)), idsLabel: `${where}${col.title}` };
  }
  /* Setup-Matrix unter der Signal-Matrix: gleicher Ausschnitt, je Pfad gecacht. */
  const setupCache = new Map();
  function setupModel() {
    const key = dyn.path.join('>');
    if (!setupCache.has(key)) setupCache.set(key, buildSetupModel(scopeOf(base, 'cluster', dyn.path)));
    return setupCache.get(key);
  }
  function dynamicsHtml() {
    if (!base.length) return '<p class="dash-empty">Keine Titel mit TV-Daten – erst TV-Daten laden.</p>';
    const curMega = dyn.path[0];
    const segBtns = MEGA_CLUSTERS.map((m) => {
      const label = megaClusterLabel(m.key);
      const n = base.filter((c) => megaClusterOf(c.sector) === m.key).length;
      const act = curMega === label;
      const tip = act ? `${label} (${n}) · nochmal tippen: alle` : `Nur ${label} (${n}) – gilt für alle Grafiken`;
      return `<button type="button" class="subnav-alert${act ? ' is-active' : ''}" data-dyn-seg="${esc(label)}" aria-pressed="${act}" title="${esc(tip)}" aria-label="${esc(tip)}"${n ? '' : ' disabled'}>${icons[MEGA_ICONS[m.key]] ?? ''}</button>`;
    }).join('');
    const crumbs = ['Alle', ...dyn.path].map((name, i) => `${i ? `<span class="md-bc__sep">${icons.chevronRight}</span>` : ''}<button type="button" class="md-bc__btn${i === dyn.path.length ? ' is-current' : ''}" data-dyn-bc="${i}">${esc(name)}</button>`).join('');
    const model = setupModel(), sel = setupSel();
    const open = state.side;
    const toggle = `<button type="button" class="dyn-side__toggle" data-dyn-side aria-expanded="${open}"
      title="${open ? 'Liste einklappen' : 'Liste ausklappen'}" aria-label="${open ? 'Liste einklappen' : 'Liste ausklappen'}">${open ? icons.chevronRight : icons.chevronLeft}</button>`;
    const rail = `<button type="button" class="dyn-side__rail" data-dyn-side aria-expanded="false" title="Liste ausklappen" aria-label="Liste ausklappen">
      ${icons.chevronLeft}<b>${setupHitCount(model, sel)}</b><span>${hasSetupFilter(sel) ? 'Treffer' : 'Titel'}</span></button>`;
    return `<div class="dyn-layout${open ? '' : ' is-collapsed'}">
      <div class="dyn-main">
        <div class="md-ctl dyn-filter"><div class="lv-filter" role="group" aria-label="Mega-Sektor-Filter">${segBtns}</div></div>
        <nav class="md-bc" aria-label="Ausschnitt">${crumbs}</nav>
        ${signalMatrixHtml(sigView())}
        ${setupMatrixHtml(model, sel)}
        <div class="dash-pulse">${pulseBody()}</div>
      </div>
      <aside class="dyn-side" aria-label="Unternehmen">${rail}${setupHitsHtml(model, sel, toggle)}</aside>
    </div>`;
  }

  /* Reiter Rankings: Live-Listen (eine zur Zeit), KI-Wochenranking, Tagessieger. */
  const scope = bucket === 'all' ? 'Watchlist' : (BUCKET_LABELS[bucket] ?? bucket);
  let live = null;
  function liveHtml() {
    live ??= liveRankings(all, { bucket, n: 8, only: filtered ? new Set(candidates) : null });
    const list = live.lists.find((l) => l.key === state.rkList) ?? live.lists[0];
    const segs = RANK_SEGS.filter((sg) => live.lists.some((l) => l.key === sg.key));
    return `<section class="dash-card">
      <header class="dash-card__head"><span class="dash-card__icon">${icons.trophy}</span><h3>Rankings</h3>
        <span class="rk-stand">${list ? `${list.passed} im Filter` : ''}</span></header>
      <div class="dash-card__body">
        <div class="md-rkseg"><div class="dash-seg">${segs.map((sg) => `<button type="button" class="dash-seg__btn${sg.key === list?.key ? ' is-active' : ''}" data-md-rk="${sg.key}">${esc(sg.label)}</button>`).join('')}</div></div>
        ${live.pool && list ? liveListHtml(list) : '<p class="dash-muted">Keine Titel mit TV-Daten – erst TV-Daten laden.</p>'}
        <p class="rk-stand">Technisch · live · ${esc(scope)}${filtered ? ' · gefiltert' : ''} (${live.pool} Titel) · ohne KI</p>
      </div>
    </section>`;
  }
  /* Ranking-Matrix (ganz oben im Reiter): je Titel und bestandener Liste ein Punkt RSI × Score,
     Farbe = Liste. Rechteck ziehen zoomt, die Tabelle darunter zeigt den Ausschnitt. */
  const RK_TONE = { momentum: '--series-1', solid: '--series-3', growth: '--series-7', pullback: '--series-4', breakout: '--series-2' };
  const RK_SHORT = Object.fromEntries(RANK_SEGS.map((sg) => [sg.key, sg.label]));
  const zs = { rank: { zoom: [], off: new Set() } };
  let rkPts = null;
  function rankPoints() {
    if (rkPts) return rkPts;
    const rows = rankingPoints(all, { bucket, only: filtered ? new Set(candidates) : null });
    rkPts = [];
    for (const r of rows) for (const [k, sc] of Object.entries(r.scores)) {
      if (r.rsi == null) continue;
      rkPts.push({ id: r.c.id, x: r.rsi, y: sc, group: k, sym: r.c.symbol, c: r.c,
        tip: `${r.c.symbol} · ${RK_SHORT[k]} ${Math.round(sc)} · RSI ${Math.round(r.rsi)}` });
    }
    rkPts.n = rows.length;
    return rkPts;
  }
  const rankTable = (rows) => `<div class="dash-group" data-group="rank.matrix">${rows
    .map((ps) => ({ ps: [...ps].sort((a, b) => b.y - a.y), c: ps[0].c, rsi: ps[0].x }))
    .sort((a, b) => b.ps[0].y - a.ps[0].y)
    .map(({ ps, c, rsi }) => `<button class="dash-row" data-id="${esc(c.id)}">
      <span class="dash-row__sym"><span class="dash-sym">${esc(c.symbol)}</span><span class="dash-ex">${esc(c.name ?? c.exchange ?? '')}</span></span>
      <span class="dash-row__val zs-vals"><span class="zs-chips">${ps.map((p) => `<span class="zs-chip" style="--zs-c:var(${RK_TONE[p.group]})" title="${esc(RK_SHORT[p.group])}">${esc(RK_SHORT[p.group])} <b>${Math.round(p.y)}</b></span>`).join('')}</span>
        <span class="dash-num zs-sub">RSI ${Math.round(rsi)}</span></span></button>`).join('')}</div>`;
  function rankMatrixHtml() {
    const pts = rankPoints();
    if (pts.length < 2) return '';                // ohne TV-Daten keine Matrix
    return zoomScatterHtml({
      key: 'rank', points: pts, full: { x0: 0, x1: 100, y0: 0, y1: 100 }, st: zs.rank,
      groups: RANK_SEGS.filter((sg) => RK_TONE[sg.key]).map((sg) => ({ key: sg.key, label: sg.label, tone: RK_TONE[sg.key] })),
      title: 'Ranking-Matrix', xLabel: 'RSI (14)', yLabel: 'Ranking-Score 0–100', xShort: 'RSI', yShort: 'Score',
      refs: [{ axis: 'x', v: 30, label: '30' }, { axis: 'x', v: 70, label: '70' }],
      quads: [{ x: 'r', y: 't', text: 'stark · heiss', cls: 'sm-quad zs-quad--warn' }, { x: 'l', y: 't', text: 'stark · überverkauft' }],
      tableHtml: rankTable,
      note: `${pts.n} Titel · ${scope}${filtered ? ' · gefiltert' : ''} · ein Punkt je bestandener Liste (Filter wie Live-Rankings, ohne Sektor- und Anzahlgrenze) · Score = Perzentile über ${all.length} Titel`,
    });
  }
  const RK_SUBS = [['live', 'Live'], ['weekly', 'KI-Ranking'], ['picks', 'Tagessieger']];
  const blobHtml = (what, fn) => (rk.err ? `<p class="dash-muted">${what} konnte nicht geladen werden: ${esc(rk.err)}</p>`
    : rk.data ? fn(rk.data)
    : `<p class="dash-muted"><span class="ls-loading"></span> Lade ${what} …</p>`);
  function rankTabHtml() {
    const body = state.rkSub === 'weekly' ? blobHtml('KI-Wochenranking', weeklyRankingsHtml)
      : state.rkSub === 'picks' ? blobHtml('Tagessieger', dailyPicksHtml)
      : liveHtml();
    return `${rankMatrixHtml()}<div class="md-ctl"><div class="dash-seg">${RK_SUBS.map(([k, l]) => `<button type="button" class="dash-seg__btn${k === state.rkSub ? ' is-active' : ''}" data-rk-sub="${k}">${l}</button>`).join('')}</div></div>
      ${body}`;
  }

  /* ── mount ──────────────────────────────────────────────────────────────── */

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'dashboard-modal-overlay';
  overlay.innerHTML = `
    <div class="modal dash-modal" role="dialog" aria-modal="true" aria-label="Monitor">
      <div class="modal-header">
        <h2 class="dash-title">${icons.activity}<span>Monitor · ${esc(BUCKET_LABELS[bucket] ?? bucket)}${filtered ? ` <small class="dash-filtered" title="${esc(filterNote || 'Die Hauptliste ist gefiltert: alle Grafiken zeigen nur diese Titel')}">${icons.sliders} gefiltert · ${candidates.length} von ${all.length}</small>` : ''}</span></h2>
        <button class="modal-close" id="dash-close" aria-label="Schließen">✕</button>
      </div>
      <div class="tab-bar dash-tabs" role="tablist">
        <button class="tab-btn active" data-dash-tab="dynamics" role="tab" aria-selected="true">Dynamik</button>
        <button class="tab-btn" data-dash-tab="live" role="tab" aria-selected="false">Live</button>
        <button class="tab-btn" data-dash-tab="rankings" role="tab" aria-selected="false">Rankings</button>
        <button class="tab-btn" data-dash-tab="rotation" role="tab" aria-selected="false">Rotation</button>
      </div>
      <div class="modal-body dash-body"></div>
      <div class="dash-selbar" hidden></div>
    </div>`;
  document.body.appendChild(overlay);

  const bodyEl = overlay.querySelector('.dash-body');
  const modalEl = overlay.querySelector('.dash-modal');
  const selBar = overlay.querySelector('.dash-selbar');

  /* Gruppen-Auswahl: jede Gruppe (Abschnitt, Signal-Chips, Ranking-Liste) bekommt eine
     Checkbox „alle N“. Sie erfasst nur die SICHTBAREN Zeilen – eingeklappte hinter
     „+N mehr“ nie; klappt man eine markierte Gruppe auf, wächst die Auswahl mit.
     Gezählt werden nur Titel, die im aktiven Bucket liegen (sonst kann die Liste sie
     nicht zeigen). „In Liste zeigen“ übergibt die Vereinigung an die App. */
  const sel = new Map();                         // Gruppen-Schlüssel → sichtbare IDs
  const inBucket = new Set(candidates.map((c) => c.id));
  const rowIds = (g) => [...new Set([...g.querySelectorAll('[data-id],[data-rk-live],[data-rk-id]')]
    .map((el) => el.dataset.id ?? el.dataset.rkLive ?? el.dataset.rkId)
    .filter((id) => id && inBucket.has(id)))];
  const union = () => new Set([...sel.values()].flat());
  function renderSelBar() {
    const n = union().size;
    selBar.hidden = n === 0;
    selBar.innerHTML = n ? `<span><b>${n}</b> markiert</span>
      <button type="button" class="btn btn-sm btn-secondary" data-sel-clear>Aufheben</button>
      <button type="button" class="btn btn-sm btn-primary" data-sel-show>In Liste zeigen</button>` : '';
  }
  function decorate() {
    const groups = [...bodyEl.querySelectorAll('[data-group], .rk-list')];
    let i = 0;
    for (const g of groups) {
      const key = g.dataset.group ?? `${rk.tab}:${i++}`;
      if (g.dataset.grpDone) continue;           // schon beschriftet (Teil-Neuzeichnung)
      g.dataset.grpDone = '1';
      g.dataset.grpKey = key;
      const ids = rowIds(g);
      if (!ids.length) { sel.delete(key); continue; }
      if (sel.has(key)) sel.set(key, ids);
      const label = document.createElement('label');
      label.className = 'grp-sel';
      label.innerHTML = `<input type="checkbox" data-grp="${esc(key)}"${sel.has(key) ? ' checked' : ''}> alle ${ids.length}`;
      // In eine vorhandene Zwischenzeile (Bullish, Weit darüber …) setzen, sonst eigene Zeile.
      const prev = g.previousElementSibling;
      if (prev?.matches('.dash-sub, .dash-sig__label')) { prev.classList.add('has-grp-sel'); prev.appendChild(label); }
      else g.before(label);
    }
    renderSelBar();
  }
  bodyEl.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-grp]');
    if (!cb) return;
    const g = [...bodyEl.querySelectorAll('[data-grp-key]')].find((x) => x.dataset.grpKey === cb.dataset.grp);
    if (cb.checked && g) sel.set(cb.dataset.grp, rowIds(g)); else sel.delete(cb.dataset.grp);
    renderSelBar();
  });
  selBar.addEventListener('click', (e) => {
    if (e.target.closest('[data-sel-clear]')) {
      sel.clear();
      bodyEl.querySelectorAll('[data-grp]').forEach((cb) => { cb.checked = false; });
      renderSelBar();
    } else if (e.target.closest('[data-sel-show]')) {
      const ids = [...union()];
      ctrl.close();
      onSelectInList?.(ids);
    }
  });
  // Jede Neuzeichnung des Inhalts bekommt die Checkboxen neu.
  new MutationObserver(() => {
    if (bodyEl.querySelector('.grp-sel')) return;
    decorate();
  }).observe(bodyEl, { childList: true });
  decorate();

  /* Jeder Reiter setzt den ganzen Inhalt neu; die Gruppen-Checkboxen kommen über den
     MutationObserver dazu. KI-Ranking, Tagessieger und Rotation teilen einen Abruf des
     market-Blobs (`loadData`). */
  const renderDynamics = () => {
    if (rk.tab !== 'dynamics') return;
    modalEl.classList.add('has-dyn');           // Desktop: breiteres Modal für das Seitenpanel
    const top = bodyEl.scrollTop;                // Setup-Filter zeichnen den Reiter neu, die Stelle bleibt
    bodyEl.innerHTML = dynamicsHtml();
    bodyEl.scrollTop = top;
  };
  const renderRankings = () => {
    if (rk.tab !== 'rankings') return;
    const top = bodyEl.scrollTop;                // Zoom und Legende zeichnen neu, die Stelle bleibt
    bodyEl.innerHTML = rankTabHtml();
    bodyEl.scrollTop = top;
  };
  async function loadData() {
    if (rk.data || rk.loading || !loadRankings) return;
    rk.loading = true;
    try { rk.data = await loadRankings(); } catch (err) { rk.err = err.message; }
    rk.loading = false;
    renderRankings();
    renderRotation();
  }
  function showRankings() {
    renderRankings();
    if (state.rkSub !== 'live') loadData();
  }
  /* Reiter Rotation: Tagesbericht der Auto-Rotation (`auto_rotation` im market-Blob,
     derselbe Abruf wie die Rankings). Der Schalter Probelauf/Scharf gilt ab dem nächsten Lauf. */
  const renderRotation = () => {
    if (rk.tab !== 'rotation') return;
    bodyEl.innerHTML = rk.err ? `<p class="dash-muted">Rotation konnte nicht geladen werden: ${esc(rk.err)}</p>`
      : rk.data ? rotationTabHtml({ auto: rk.data.auto, find: rk.data.find, day: rk.rotDay })
      : '<p class="dash-muted"><span class="ls-loading"></span> Lade Rotation …</p>';
  };
  function showRotation() {
    renderRotation();
    loadData();
  }
  overlay.querySelectorAll('[data-dash-tab]').forEach((b) => b.addEventListener('click', () => {
    rk.tab = b.dataset.dashTab;
    modalEl.classList.toggle('has-dyn', rk.tab === 'dynamics');
    overlay.querySelectorAll('[data-dash-tab]').forEach((t) => {
      const on = t === b;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    bodyEl.scrollTop = 0;
    if (rk.tab === 'rankings') showRankings();
    else if (rk.tab === 'rotation') showRotation();
    else if (rk.tab === 'dynamics') renderDynamics();
    else showLive();
  }));
  bindZoomScatter(bodyEl, {
    onZoom: (key, box) => { if (zs[key]) { zs[key].zoom.push(box); renderRankings(); } },
    onTap: (key, id) => { const cand = candidates.find((c) => c.id === id); if (cand) onOpenDetail?.(cand, ctrl); },
  });
  bindSetupBrush(bodyEl, (brush) => {
    if (!brush && !state.setup.brush) return;
    state.setup.brush = brush;
    renderDynamics();
  });
  // click statt pointerup: ein Wisch beim Scrollen soll kein Detail öffnen.
  bodyEl.addEventListener('click', async (e) => {
    if (e.target.closest('.grp-sel')) return;
    /* Ranking-Matrix: Zoom zurück, Legende, „In Tabelle öffnen“ (Titel im Ausschnitt). */
    if (zsClick(e, zs)) { renderRankings(); return; }
    if (e.target.closest('[data-zs-show]')) {
      const ids = [...new Set(zsVisible(rankPoints(), { x0: 0, x1: 100, y0: 0, y1: 100 }, zs.rank).map((p) => p.id))].filter((id) => inBucket.has(id));
      if (!ids.length) return;
      ctrl.close();
      onSelectInList?.(ids);
      return;
    }
    /* Live: Cluster-Filter und Aktualisieren. */
    const lvSeg = e.target.closest('[data-lv-seg]');
    if (lvSeg) { lv.seg = lv.seg === lvSeg.dataset.lvSeg ? '' : lvSeg.dataset.lvSeg; lv.note = ''; renderLive(); return; }
    if (e.target.closest('[data-lv-refresh]')) { refreshLive(false); return; }
    const lvTick = e.target.closest('[data-lv-tick]');
    if (lvTick) {
      lv.tick = Number(lvTick.dataset.lvTick);
      try { localStorage.setItem(LIVE_TICK_KEY, String(lv.tick)); } catch { /* egal */ }
      scheduleNext();
      renderLive();
      return;
    }
    /* Dynamik: Zelle wählen (Titel stehen in der Trefferliste unten), Zeile aufklappen, Brotkrumen. */
    const sigCell = e.target.closest('[data-sig-col]');
    if (sigCell) {
      const { sigRow: row, sigCol: col } = sigCell.dataset;
      state.sig = state.sig && state.sig.row === row && state.sig.col === col ? null : { row, col };
      renderDynamics();
      return;
    }
    /* Setup-Matrix: Zelle, Quintil, Spider-Legende, Zurücksetzen, „In Tabelle öffnen“. */
    const smCell = e.target.closest('[data-sm-cell]');
    if (smCell) {
      const [type, col] = smCell.dataset.smCell.split('|');
      const c = state.setup.cell;
      state.setup.cell = c && c.type === type && c.col === col ? null : { type, col };
      renderDynamics();
      return;
    }
    const smQ = e.target.closest('[data-sm-q]');
    if (smQ) { const q = Number(smQ.dataset.smQ); state.setup.q = state.setup.q === q ? null : q; renderDynamics(); return; }
    if (e.target.closest('[data-dyn-side]')) {
      state.side = !state.side;
      try { localStorage.setItem(DYN_SIDE_KEY, state.side ? '1' : '0'); } catch { /* egal */ }
      renderDynamics();
      return;
    }
    if (e.target.closest('[data-sm-reset]')) { state.setup = { cell: null, q: null, brush: null }; state.sig = null; renderDynamics(); return; }
    if (e.target.closest('[data-sm-show]')) {
      const ids = setupHits(setupModel(), setupSel()).map((m) => m.c.id).filter((id) => inBucket.has(id));
      if (!ids.length) return;
      ctrl.close();
      onSelectInList?.([...new Set(ids)]);
      return;
    }
    const drill = e.target.closest('[data-sig-drill]');
    const crumb = e.target.closest('[data-dyn-bc]');
    const seg = e.target.closest('[data-dyn-seg]');
    if (drill || crumb || seg) {
      dyn.path = seg ? (dyn.path[0] === seg.dataset.dynSeg ? [] : [seg.dataset.dynSeg])
        : drill ? [...dyn.path, drill.dataset.sigDrill] : dyn.path.slice(0, Number(crumb.dataset.dynBc));
      state.sig = null;                          // Zeilen der Matrix ändern sich
      state.setup = { cell: null, q: null, brush: null };   // Quintile und Achsen hängen am Ausschnitt
      renderDynamics();
      return;
    }
    /* Rankings: Unterreiter und Liste. */
    const rkSub = e.target.closest('[data-rk-sub]');
    if (rkSub) { state.rkSub = rkSub.dataset.rkSub; showRankings(); return; }
    const rkBtn = e.target.closest('[data-md-rk]');
    if (rkBtn) { state.rkList = rkBtn.dataset.mdRk; renderRankings(); return; }
    /* Rotation: Lauf wählen und Modus umschalten. */
    const rotDay = e.target.closest('[data-rot-day]');
    if (rotDay) { rk.rotDay = rotDay.dataset.rotDay; renderRotation(); return; }
    const rotMode = e.target.closest('[data-rot-mode]');
    if (rotMode) {
      const mode = rotMode.dataset.rotMode;
      const auto = rk.data?.auto;
      if (rotMode.disabled || !onSetRotationMode || (auto?.mode === 'live' ? 'live' : 'dry') === mode) return;
      if (mode === 'live') {
        const last = auto?.reports?.[0];
        const n = last ? `Der letzte Lauf hätte ${last.enter?.length ?? 0} Titel in die Watchlist und ${last.leave?.length ?? 0} ins Archiv verschoben. ` : '';
        if (!confirm(`${n}Scharf schalten? Ab dem nächsten Lauf wird automatisch verschoben, freitags wird der Inbox-Rest gelöscht.`)) return;
      }
      rotMode.disabled = true;
      const ok = await onSetRotationMode(mode).catch(() => false);
      if (ok && rk.data) rk.data.auto = { ...(rk.data.auto ?? {}), mode };
      renderRotation();
      return;
    }
    const live = e.target.closest('[data-rk-live]');
    if (live) {
      const cand = candidates.find((c) => c.id === live.dataset.rkLive);
      if (cand) onOpenDetail?.(cand, ctrl);
      return;
    }
    const row = e.target.closest('[data-rk-id]');
    if (row) onOpenHit?.(rk.data?.byId?.get(row.dataset.rkId), ctrl);
  });

  const hidden = () => overlay.style.display === 'none';
  const ctrl = {
    overlay,
    hide:  () => { overlay.style.display = 'none'; },
    show:  () => { overlay.style.display = ''; },
    close: () => { closed = true; clearInterval(lv.timer); overlay.remove(); document.removeEventListener('keydown', onKey); },
  };

  const onKey = (e) => { if (e.key === 'Escape' && !hidden()) ctrl.close(); };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('#dash-close').addEventListener('pointerup', ctrl.close);

  overlay.addEventListener('pointerup', (e) => {
    if (e.target === overlay) { ctrl.close(); return; }
    if (e.target.closest('.grp-sel, .dash-selbar')) return;

    const hit = e.target.closest('[data-id]');
    if (hit) {
      const cand = candidates.find((c) => c.id === hit.dataset.id);
      if (cand) onOpenDetail?.(cand, ctrl);
    }
  });

  renderDynamics();                // Dynamik ist der erste Reiter und erscheint beim Öffnen

  return ctrl;
}
