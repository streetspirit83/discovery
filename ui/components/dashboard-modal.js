/**
 * Dashboard / Monitor modal (bottom-nav slot "Monitor"), vier Reiter über den *aktiven Bucket*:
 *
 *   Live      – Kacheln der Einzeltitel nach LS-Tagesveränderung (`ls_quote.change_pct`,
 *               Lang & Schwarz gegen Vortagesschluss), sortiert vom stärksten zum schwächsten,
 *               filterbar über die fünf Mega-Cluster-Icons. „Aktualisieren“ holt die LS-Kurse
 *               der gezeigten Titel neu (`onRefreshLs`); bis 80 Titel passiert das beim Öffnen
 *               von selbst, wenn der neueste Kurs älter als 2 min ist.
 *   Dynamik   – Signal-Matrix (components/signal-matrix.js): Zeilen = Mega-Cluster, Spalten =
 *               Signale (Score-/Momentum-/PCHS-Dynamik vs. Vortag, MACD-Dreher, SMA-Kreuzungen,
 *               Trends, RSI- und SMA200-Extreme). Ein Klick auf eine Zeile geht tiefer
 *               (Cluster → Sektor → Sub-Sektor → Titel), eine Zelle zeigt ihre Titel.
 *   Rankings  – Umschalter Live (fünf technische Listen) · KI-Ranking (Sonntag) · Tagessieger.
 *   Rotation  – Tagesbericht der Auto-Rotation.
 *
 * Das Markt-Dashboard (Treemap) liegt seit Nov. 2026 im Markets-Modal (Reiter „Markt“).
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
import { signalMatrixHtml, selectedIds } from './signal-matrix.js?v=20261116d';
import { signalColumns } from '../lib/market-signals.js?v=20261116c';
import { groupsFor, scopeOf, withData, median, PERSPECTIVES } from '../lib/market-scope.js?v=20261116d';
import { MEGA_CLUSTERS, megaClusterOf } from '../lib/sector-clusters.js?v=20260807a';

/* Icons der Mega-Cluster wie in der Subleiste (`SECTOR_ICONS` in app.js). */
const MEGA_ICONS = { tech: 'cpu', health: 'heartPulse', consumer: 'shoppingCart', industry: 'factory', finance: 'landmark' };
const LIVE_AUTO_MAX = 80;            // bis zu so vielen Titeln lädt der Live-Reiter beim Öffnen selbst
const LIVE_FRESH_MS = 2 * 60 * 1000;
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

export function renderDashboardModal({ candidates = [], bucket = 'inbox', onOpenDetail, loadRankings, onOpenHit, onSelectInList, onSetRotationMode, onRefreshLs } = {}) {
  if (document.getElementById('dashboard-modal-overlay')) return null;

  const state = { rkList: 'momentum', rkSub: 'live', sig: null };
  const rk = { tab: 'live', data: null, err: null, loading: false };
  // Dynamik: Drill-down-Pfad über die Perspektive `cluster` (Mega-Cluster → Sektor → Sub-Sektor).
  const base = withData(candidates);
  const dyn = { path: [] };
  const view = () => (dyn.path.length ? scopeOf(base, 'cluster', dyn.path) : candidates);

  /* Reiter Live: Einzeltitel als Kacheln nach LS-Tagesveränderung, Filter über Mega-Cluster. */
  const lv = { seg: '', loading: false, note: '', auto: false };
  const lsChg = (c) => { const v = c?.ls_quote?.change_pct; return v == null || Number.isNaN(Number(v)) ? null : Number(v); };
  const liveSet = () => (lv.seg ? candidates.filter((c) => megaClusterOf(c.sector) === lv.seg) : candidates);
  function liveTabHtml() {
    const set = liveSet();
    const rows = set.map((c) => ({ c, v: lsChg(c) })).filter((r) => r.v != null).sort((a, b) => b.v - a.v);
    const up = rows.filter((r) => r.v > 0).length, down = rows.filter((r) => r.v < 0).length;
    const med = median(rows.map((r) => r.v));
    const stamps = rows.map((r) => r.c.ls_quote?.checked_at).filter(Boolean).sort();
    const filter = MEGA_CLUSTERS.map((m) => {
      const n = candidates.filter((c) => megaClusterOf(c.sector) === m.key).length;
      const act = lv.seg === m.key;
      const tip = act ? `${m.label} (${n}) · nochmal tippen: alle` : `Nur ${m.label} (${n})`;
      return `<button type="button" class="subnav-alert${act ? ' is-active' : ''}" data-lv-seg="${m.key}" aria-pressed="${act}" title="${esc(tip)}" aria-label="${esc(tip)}">${icons[MEGA_ICONS[m.key]] ?? ''}</button>`;
    }).join('');
    const tone = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
    const tile = (r) => {
      const pct = Math.round(Math.min(Math.abs(r.v) / LIVE_CAP, 1) * 50 + 6);
      const tip = `${r.c.name ?? r.c.symbol} · LS ${fmtPct(r.v, 2)}${r.c.ls_quote?.price != null ? ` · ${Number(r.c.ls_quote.price).toFixed(2)} €` : ''}`;
      return `<button type="button" class="md-tile lv-tile" data-id="${esc(r.c.id)}" title="${esc(tip)}" aria-label="${esc(tip)}"
        style="background:color-mix(in srgb, var(${r.v >= 0 ? '--pos' : '--neg'}) ${pct}%, var(--surface-2))">
        <span class="md-tile__name">${esc(r.c.symbol)}</span>
        <span class="md-tile__val">${fmtPct(r.v)}</span>
      </button>`;
    };
    const missing = set.length - rows.length;
    const notes = [`Lang & Schwarz gegen Vortagesschluss · Farbe ab ±${LIVE_CAP} % voll`];
    if (stamps.length) notes.push(`Stand ${stamp(stamps[stamps.length - 1])}${stamps[0].slice(0, 16) !== stamps[stamps.length - 1].slice(0, 16) ? ` (ältester ${stamp(stamps[0])})` : ''}`);
    if (missing > 0) notes.push(`${missing} ohne LS-Kurs`);
    if (lv.note) notes.push(lv.note);
    return `<div class="md-ctl">
        <div class="lv-filter" role="group" aria-label="Mega-Cluster">${filter}</div>
        ${onRefreshLs ? `<button type="button" class="btn btn-sm btn-secondary" data-lv-refresh${lv.loading ? ' disabled' : ''}>${lv.loading ? '<span class="ls-loading"></span> Lädt …' : `${icons.refreshCw} Aktualisieren`}</button>` : ''}
      </div>
      <div class="md-kpis">
        <span><b>${rows.length}</b> Titel${lv.seg ? ` · ${esc(MEGA_CLUSTERS.find((m) => m.key === lv.seg)?.label ?? '')}` : ''}</span>
        <span class="pos">${icons.arrowUp}<b>${up}</b></span>
        <span class="neg">${icons.arrowDown}<b>${down}</b></span>
        <span class="md-kpis__med">Median heute <b class="${tone(med ?? 0)}">${fmtPct(med)}</b></span>
      </div>
      ${rows.length ? `<div class="md-tm md-tm--grid lv-grid" data-group="live.tiles">${rows.map(tile).join('')}</div>`
        : `<p class="dash-empty">${set.length ? 'Noch keine LS-Kurse geladen.' : 'Keine Titel in diesem Cluster.'}</p>`}
      <p class="md-note">${esc(notes.join(' · '))}</p>`;
  }
  const renderLive = () => { if (rk.tab === 'live') bodyEl.innerHTML = liveTabHtml(); };
  async function refreshLive() {
    if (!onRefreshLs || lv.loading) return;
    const ids = liveSet().map((c) => c.id);
    if (!ids.length) return;
    lv.loading = true; lv.note = '';
    renderLive();
    try {
      const res = await onRefreshLs(ids);
      lv.note = res == null ? 'LS-Kurse brauchen das Backend (nicht im Demo-Modus)'
        : res.fail ? `${res.fail} ohne neuen Kurs` : '';
    } catch (err) { lv.note = `Aktualisieren fehlgeschlagen: ${err.message}`; }
    lv.loading = false;
    renderLive();
  }
  /* Beim Öffnen des Reiters einmal selbst laden – nur bei überschaubarer Menge und wenn
     der neueste Kurs nicht ohnehin frisch ist. */
  function showLive() {
    renderLive();
    if (lv.auto || !onRefreshLs) return;
    lv.auto = true;
    const set = liveSet();
    const newest = set.map((c) => c.ls_quote?.checked_at).filter(Boolean).sort().pop();
    if (set.length && set.length <= LIVE_AUTO_MAX && (!newest || Date.now() - new Date(newest).getTime() > LIVE_FRESH_MS)) refreshLive();
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
  function dynamicsHtml() {
    if (!base.length) return '<p class="dash-empty">Keine Titel mit TV-Daten – erst TV-Daten laden.</p>';
    const crumbs = ['Alle', ...dyn.path].map((name, i) => `${i ? `<span class="md-bc__sep">${icons.chevronRight}</span>` : ''}<button type="button" class="md-bc__btn${i === dyn.path.length ? ' is-current' : ''}" data-dyn-bc="${i}">${esc(name)}</button>`).join('');
    return `<nav class="md-bc" aria-label="Ausschnitt">${crumbs}</nav>
      ${signalMatrixHtml(sigData())}
      <div class="dash-pulse">${pulseBody()}</div>`;
  }

  /* Reiter Rankings: Live-Listen (eine zur Zeit), KI-Wochenranking, Tagessieger. */
  const scope = bucket === 'all' ? 'Watchlist' : (BUCKET_LABELS[bucket] ?? bucket);
  let live = null;
  function liveHtml() {
    live ??= liveRankings(candidates, { bucket, n: 8 });
    const list = live.lists.find((l) => l.key === state.rkList) ?? live.lists[0];
    const segs = RANK_SEGS.filter((sg) => live.lists.some((l) => l.key === sg.key));
    return `<section class="dash-card">
      <header class="dash-card__head"><span class="dash-card__icon">${icons.trophy}</span><h3>Rankings</h3>
        <span class="rk-stand">${list ? `${list.passed} im Filter` : ''}</span></header>
      <div class="dash-card__body">
        <div class="md-rkseg"><div class="dash-seg">${segs.map((sg) => `<button type="button" class="dash-seg__btn${sg.key === list?.key ? ' is-active' : ''}" data-md-rk="${sg.key}">${esc(sg.label)}</button>`).join('')}</div></div>
        ${live.pool && list ? liveListHtml(list) : '<p class="dash-muted">Keine Titel mit TV-Daten – erst TV-Daten laden.</p>'}
        <p class="rk-stand">Technisch · live · ${esc(scope)} (${live.pool} Titel) · ohne KI</p>
      </div>
    </section>`;
  }
  const RK_SUBS = [['live', 'Live'], ['weekly', 'KI-Ranking'], ['picks', 'Tagessieger']];
  const blobHtml = (what, fn) => (rk.err ? `<p class="dash-muted">${what} konnte nicht geladen werden: ${esc(rk.err)}</p>`
    : rk.data ? fn(rk.data)
    : `<p class="dash-muted"><span class="ls-loading"></span> Lade ${what} …</p>`);
  function rankTabHtml() {
    const body = state.rkSub === 'weekly' ? blobHtml('KI-Wochenranking', weeklyRankingsHtml)
      : state.rkSub === 'picks' ? blobHtml('Tagessieger', dailyPicksHtml)
      : liveHtml();
    return `<div class="md-ctl"><div class="dash-seg">${RK_SUBS.map(([k, l]) => `<button type="button" class="dash-seg__btn${k === state.rkSub ? ' is-active' : ''}" data-rk-sub="${k}">${l}</button>`).join('')}</div></div>
      ${body}`;
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
        <button class="tab-btn active" data-dash-tab="live" role="tab" aria-selected="true">Live</button>
        <button class="tab-btn" data-dash-tab="dynamics" role="tab" aria-selected="false">Dynamik</button>
        <button class="tab-btn" data-dash-tab="rankings" role="tab" aria-selected="false">Rankings</button>
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

  /* Jeder Reiter setzt den ganzen Inhalt neu; die Gruppen-Checkboxen kommen über den
     MutationObserver dazu. KI-Ranking, Tagessieger und Rotation teilen einen Abruf des
     market-Blobs (`loadData`). */
  const renderDynamics = () => { if (rk.tab === 'dynamics') bodyEl.innerHTML = dynamicsHtml(); };
  const renderRankings = () => { if (rk.tab === 'rankings') bodyEl.innerHTML = rankTabHtml(); };
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
  // click statt pointerup: ein Wisch beim Scrollen soll kein Detail öffnen.
  bodyEl.addEventListener('click', async (e) => {
    if (e.target.closest('.grp-sel')) return;
    /* Live: Cluster-Filter und Aktualisieren. */
    const lvSeg = e.target.closest('[data-lv-seg]');
    if (lvSeg) { lv.seg = lv.seg === lvSeg.dataset.lvSeg ? '' : lvSeg.dataset.lvSeg; lv.note = ''; renderLive(); return; }
    if (e.target.closest('[data-lv-refresh]')) { refreshLive(); return; }
    /* Dynamik: Zelle wählen, Zeile aufklappen, Brotkrumen, „In Tabelle öffnen“. */
    const sigCell = e.target.closest('[data-sig-col]');
    if (sigCell) {
      const { sigRow: row, sigCol: col } = sigCell.dataset;
      state.sig = state.sig && state.sig.row === row && state.sig.col === col ? null : { row, col };
      renderDynamics();
      return;
    }
    if (e.target.closest('[data-sig-show]')) {
      const ids = selectedIds(sigData()).filter((id) => inBucket.has(id));
      if (!ids.length) return;
      ctrl.close();
      onSelectInList?.(ids);
      return;
    }
    const drill = e.target.closest('[data-sig-drill]');
    const crumb = e.target.closest('[data-dyn-bc]');
    if (drill || crumb) {
      dyn.path = drill ? [...dyn.path, drill.dataset.sigDrill] : dyn.path.slice(0, Number(crumb.dataset.dynBc));
      state.sig = null;                          // Zeilen der Matrix ändern sich
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

  showLive();

  return ctrl;
}
