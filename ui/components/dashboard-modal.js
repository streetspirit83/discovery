/**
 * Dashboard / Monitor modal.
 *
 * Reiter „Markt“ (seit Nov. 2026, ersetzt „Übersicht“ und „Rankings“): interaktives
 * Dashboard des *aktiven Buckets* – Treemap mit Drill-down nach Sektoren oder Ländern
 * (components/market-dashboard.js), dazu Branchen-/Länder-Indizes, Top-Mover, die fünf
 * Live-Rankings und die Signal-Matrix (components/signal-matrix.js); das KI-Wochenranking hat einen eigenen Reiter (Score-/Momentum-/PCHS-
 * Dynamik vs. Vortag, RSI-Extreme, MACD-Flips, SMA-Kreuzungen, Trends). Alles unter der
 * Treemap filtert auf den gewählten Ausschnitt mit (`view()`). Die Indizes-Tabelle des
 * Markets-Modals steht einklappbar am Ende. Opened from the "Monitor" bottom-nav slot.
 * All metrics come from dashboard-metrics (client-side).
 *
 * renderDashboardModal returns a controller { overlay, show, hide, close } so the
 * app can hide the dashboard while a candidate detail sheet is open and restore
 * it when the sheet closes (X or swipe).
 */

import { icons } from '../lib/icons.js?v=20261103f';
import { pulse } from '../lib/dashboard-metrics.js?v=20261103h';
import { liveListHtml, weeklyRankingsHtml, rotationTabHtml, RANK_SEGS } from './rankings-panel.js?v=20261116a';
import { liveRankings } from '../lib/rankings-filter.js?v=20261116a';
import { dailyPicksHtml } from './daily-picks-panel.js?v=20261107a';
import { createMarketDashboard } from './market-dashboard.js?v=20261116c';
import { renderIndicesPanel } from './indices-panel.js?v=20261103f';
import { signalMatrixHtml, selectedIds } from './signal-matrix.js?v=20261116c';
import { signalColumns } from '../lib/market-signals.js?v=20261116c';
import { groupsFor } from '../lib/market-scope.js?v=20261116c';

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

export function renderDashboardModal({ candidates = [], bucket = 'inbox', onOpenDetail, loadRankings, onOpenHit, onSelectInList, onSetRotationMode, onFetchIndexRows } = {}) {
  if (document.getElementById('dashboard-modal-overlay')) return null;

  const state = { rkList: 'momentum', foldSignals: true, sig: null };
  const rk = { tab: 'overview', data: null, err: null, loading: false };
  // Markt-Dashboard: hält Perspektive, Horizont und Drill-down-Pfad. `view()` ist der
  // gewählte Ausschnitt – Rankings und alle Signal-Karten rechnen darauf.
  const md = createMarketDashboard({ candidates, onFetchIndexRows });
  const view = () => (md.st.path.length ? md.scoped() : candidates);

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

  /* Signale und Dynamik als Matrix: Zeilen = Gruppen des Ausschnitts, Spalten = Signale.
     Die gewählte Zelle (`state.sig`) zeigt darunter ihre Titel. Je Ausschnitt gecacht. */
  const sigCache = new Map();
  function sigData() {
    const key = `${md.st.view}|${md.st.path.join('>')}`;
    if (!sigCache.has(key)) {
      const sc = md.scoped();
      const { title, rows } = groupsFor(sc, md.st.view, md.st.path);
      sigCache.set(key, { columns: signalColumns(sc), rows, rowTitle: title });
    }
    return { ...sigCache.get(key), sel: state.sig };
  }
  function signalsHtml() {
    return `${signalMatrixHtml(sigData())}
      <div class="dash-pulse">${pulseBody()}</div>`;
  }

  /* Rankings im Ausschnitt: Perzentile über alle Titel des Buckets, gelistet wird nur der
     Ausschnitt (dort ohne Sektor-Grenze). Eine Liste zur Zeit, Umschalter im Kartenkopf. */
  const scope = bucket === 'all' ? 'Watchlist' : (BUCKET_LABELS[bucket] ?? bucket);
  const liveCache = new Map();
  function liveFor() {
    const key = `${md.st.view}|${md.st.path.join('>')}`;
    if (!liveCache.has(key)) {
      const scoped = md.st.path.length;
      liveCache.set(key, liveRankings(candidates, { bucket, n: 8, only: scoped ? new Set(md.scoped()) : null, sectorCap: scoped ? 8 : undefined }));
    }
    return liveCache.get(key);
  }
  function rankingsHtml() {
    const live = liveFor();
    const list = live.lists.find((l) => l.key === state.rkList) ?? live.lists[0];
    const segs = RANK_SEGS.filter((sg) => live.lists.some((l) => l.key === sg.key));
    const where = md.st.path.length ? `${scope} · ${md.scopeLabel()}` : scope;
    return `<section class="dash-card">
      <header class="dash-card__head"><span class="dash-card__icon">${icons.trophy}</span><h3>Rankings</h3>
        <span class="rk-stand">${list ? `${list.passed} im Filter` : ''}</span></header>
      <div class="dash-card__body">
        <div class="md-rkseg"><div class="dash-seg">${segs.map((sg) => `<button type="button" class="dash-seg__btn${sg.key === list?.key ? ' is-active' : ''}" data-md-rk="${sg.key}">${esc(sg.label)}</button>`).join('')}</div></div>
        ${live.pool && list ? liveListHtml(list) : '<p class="dash-muted">Keine Titel mit TV-Daten im Ausschnitt.</p>'}
        <p class="rk-stand">Technisch · live · ${esc(where)} (${live.pool} Titel) · ohne KI</p>
      </div>
    </section>`;
  }
  const weeklyBody = () => (rk.err ? `<p class="dash-muted">KI-Wochenranking konnte nicht geladen werden: ${esc(rk.err)}</p>`
    : rk.data ? weeklyRankingsHtml(rk.data)
    : '<p class="dash-muted"><span class="ls-loading"></span> Lade KI-Wochenranking …</p>');

  /* Der Markt-Reiter besteht aus zwei Teilen: `#md-main` wird bei jeder Änderung des
     Ausschnitts neu gezeichnet, die Indizes-Tabelle darunter bleibt stehen (sie lädt
     beim ersten Aufklappen selbst und soll bei einem Kachel-Klick nicht neu laden). */
  function mainHtml() {
    if (!md.hasData()) return md.topHtml();
    const where = md.st.path.length ? ` · ${esc(md.scopeLabel())}` : '';
    return `${md.topHtml()}
      ${rankingsHtml()}
      <details class="md-fold" data-md-fold="signals"${state.foldSignals ? ' open' : ''}>
        <summary class="md-fold__sum">${icons.activity}<span>Signale und Dynamik${where}</span></summary>
        <div class="md-fold__body">${state.foldSignals ? signalsHtml() : ''}</div>
      </details>`;
  }
  function bodyHtml() {
    return `<div class="md-main" id="md-main">${mainHtml()}</div>
      <details class="md-fold" data-md-fold="indices">
        <summary class="md-fold__sum">${icons.barChart2}<span>Indizes · Branchen und Länder</span></summary>
        <div class="md-fold__body" id="md-indices"></div>
      </details>`;
  }

  /* ── mount ──────────────────────────────────────────────────────────────── */

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'dashboard-modal-overlay';
  overlay.innerHTML = `
    <div class="modal dash-modal" role="dialog" aria-modal="true" aria-label="Monitor">
      <div class="modal-header">
        <h2 class="dash-title">${icons.activity}<span>Monitor · ${esc(BUCKET_LABELS[bucket] ?? bucket)}</span></h2>
        <button class="modal-close" id="dash-close" aria-label="Schließen">✕</button>
      </div>
      <div class="tab-bar dash-tabs" role="tablist">
        <button class="tab-btn active" data-dash-tab="overview" role="tab" aria-selected="true">Markt</button>
        <button class="tab-btn" data-dash-tab="weekly" role="tab" aria-selected="false">KI-Ranking</button>
        <button class="tab-btn" data-dash-tab="picks" role="tab" aria-selected="false">Tagessieger</button>
        <button class="tab-btn" data-dash-tab="rotation" role="tab" aria-selected="false">Rotation</button>
      </div>
      <div class="modal-body dash-body"></div>
      <div class="dash-selbar" hidden></div>
    </div>`;
  document.body.appendChild(overlay);

  const bodyEl = overlay.querySelector('.dash-body');
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

  /* Markt-Reiter zeichnen. `renderMain` ersetzt nur den oberen Teil (Ausschnitt geändert),
     `rerender` den ganzen Reiter (Reiterwechsel). Die Gruppen-Checkboxen kommen jeweils neu. */
  function wireMain() {
    md.draw(bodyEl);
    bodyEl.querySelector('[data-md-fold="signals"]')?.addEventListener('toggle', (e) => {
      if (state.foldSignals === e.target.open) return;
      state.foldSignals = e.target.open;
      renderMain();
    });
    decorate();
  }
  function renderMain() {
    const main = bodyEl.querySelector('#md-main');
    if (rk.tab !== 'overview' || !main) return;
    main.innerHTML = mainHtml();
    wireMain();
  }
  let indicesMounted = false;
  function rerender() {
    indicesMounted = false;
    bodyEl.innerHTML = bodyHtml();
    bodyEl.querySelector('[data-md-fold="indices"]')?.addEventListener('toggle', (e) => {
      if (!e.target.open || indicesMounted) return;
      indicesMounted = true;
      renderIndicesPanel(bodyEl.querySelector('#md-indices'), { onFetchIndexRows });
    });
    wireMain();
  }
  /* Reiter KI-Ranking: KI-Wochenranking vom Sonntag aus dem market-Blob (derselbe Abruf
     wie Tagessieger und Rotation). */
  const renderRankings = () => {
    if (rk.tab !== 'weekly') return;
    bodyEl.innerHTML = weeklyBody();
  };
  async function showWeekly() {
    renderRankings();
    if (rk.data || rk.loading || !loadRankings) return;
    rk.loading = true;
    try { rk.data = await loadRankings(); } catch (err) { rk.err = err.message; }
    rk.loading = false;
    renderRankings();
  }
  /* Reiter Tagessieger: Einträge `picks` aus dem market-Blob (derselbe Abruf wie die Rankings). */
  const renderPicks = () => {
    if (rk.tab !== 'picks') return;
    bodyEl.innerHTML = rk.err ? `<p class="dash-muted">Tagessieger konnten nicht geladen werden: ${esc(rk.err)}</p>`
      : rk.data ? dailyPicksHtml(rk.data)
      : '<p class="dash-muted"><span class="ls-loading"></span> Lade Tagessieger …</p>';
  };
  async function showPicks() {
    renderPicks();
    if (rk.data || rk.loading || !loadRankings) return;
    rk.loading = true;
    try { rk.data = await loadRankings(); } catch (err) { rk.err = err.message; }
    rk.loading = false;
    renderRankings();
    renderPicks();
    renderRotation();
  }
  /* Reiter Rotation: Tagesbericht der Auto-Rotation (`auto_rotation` im market-Blob,
     derselbe Abruf wie die Rankings). Der Schalter Probelauf/Scharf gilt ab dem nächsten Lauf. */
  const renderRotation = () => {
    if (rk.tab !== 'rotation') return;
    bodyEl.innerHTML = rk.err ? `<p class="dash-muted">Rotation konnte nicht geladen werden: ${esc(rk.err)}</p>`
      : rk.data ? rotationTabHtml({ auto: rk.data.auto, find: rk.data.find, day: rk.rotDay })
      : '<p class="dash-muted"><span class="ls-loading"></span> Lade Rotation …</p>';
  };
  async function showRotation() {
    renderRotation();
    if (rk.data || rk.loading || !loadRankings) return;
    rk.loading = true;
    try { rk.data = await loadRankings(); } catch (err) { rk.err = err.message; }
    rk.loading = false;
    renderRankings();
    renderPicks();
    renderRotation();
  }
  overlay.querySelectorAll('[data-dash-tab]').forEach((b) => b.addEventListener('click', () => {
    rk.tab = b.dataset.dashTab;
    overlay.querySelectorAll('[data-dash-tab]').forEach((t) => {
      const on = t === b;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    bodyEl.scrollTop = 0;
    if (rk.tab === 'weekly') showWeekly();
    else if (rk.tab === 'picks') showPicks();
    else if (rk.tab === 'rotation') showRotation();
    else rerender();
  }));
  // click statt pointerup: ein Wisch beim Scrollen soll kein Detail öffnen.
  bodyEl.addEventListener('click', async (e) => {
    if (e.target.closest('.grp-sel')) return;
    /* Markt-Dashboard: Perspektive, Horizont, Kachel, Brotkrumen, „In Liste zeigen“. */
    const sigCell = e.target.closest('[data-sig-col]');
    if (sigCell) {
      const { sigRow: row, sigCol: col } = sigCell.dataset;
      state.sig = state.sig && state.sig.row === row && state.sig.col === col ? null : { row, col };
      renderMain();
      return;
    }
    if (e.target.closest('[data-sig-show]')) {
      const ids = selectedIds(sigData()).filter((id) => inBucket.has(id));
      if (!ids.length) return;
      ctrl.close();
      onSelectInList?.(ids);
      return;
    }
    const rkBtn = e.target.closest('[data-md-rk]');
    if (rkBtn) { state.rkList = rkBtn.dataset.mdRk; renderMain(); return; }
    const act = rk.tab === 'overview' ? md.handleClick(e) : null;
    if (act?.show) {
      if (!act.show.length) return;
      ctrl.close();
      onSelectInList?.(act.show);
      return;
    }
    if (act?.changed) {
      const drilled = e.target.closest('[data-md-tile],[data-md-bc],[data-md-view]');
      if (drilled) state.sig = null;             // Zeilen der Matrix ändern sich
      renderMain();
      if (drilled) bodyEl.querySelector('.md-bc')?.scrollIntoView({ block: 'nearest' });
      return;
    }
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
    close: () => { overlay.remove(); document.removeEventListener('keydown', onKey); },
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

  rerender();
  md.loadIndices(() => renderMain());

  return ctrl;
}
