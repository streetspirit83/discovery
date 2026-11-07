/**
 * Dashboard / Monitor modal.
 *
 * Surfaces trends & dynamics of the *active bucket* at a glance: score / momentum
 * / PCHS dynamics vs. the previous day, performance leaders & laggards (1W/1M/3M),
 * RSI extremes, MACD flips and durable / crumbling trends. Opened from the
 * "Monitor" bottom-nav slot. All metrics come from dashboard-metrics (client-side).
 *
 * renderDashboardModal returns a controller { overlay, show, hide, close } so the
 * app can hide the dashboard while a candidate detail sheet is open and restore
 * it when the sheet closes (X or swipe).
 */

import { icons } from '../lib/icons.js?v=20261103f';
import {
  pulse, scoreMovers, momMovers, pchsMovers, perfLeaders,
  macdFlips, rsiExtremes, trends, smaCrosses,
} from '../lib/dashboard-metrics.js?v=20261103h';
import { trendRadar } from '../lib/trend-radar.js?v=20261103h';
import { sma200Extremes } from '../lib/sma200-extremes.js?v=20261106b';
import { liveRankingsHtml, weeklyRankingsHtml } from './rankings-panel.js?v=20261106c';
import { liveRankings } from '../lib/rankings-filter.js?v=20261107a';
import { dailyPicksHtml } from './daily-picks-panel.js?v=20261107a';

const BUCKET_LABELS = { inbox: 'Inbox', archive: 'Archiv', export: 'Export', watch: 'Watchlist', all: 'Watch + Archiv' };
const COLLAPSED = 3;
const EXPANDED = 12;

/* ── formatters ───────────────────────────────────────────────────────────── */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const fmtPct = (v, dec = 1) => (v == null || Number.isNaN(v) ? '–' : `${v >= 0 ? '+' : '−'}${Math.abs(Number(v)).toFixed(dec)}%`);
const fmtDelta = (v) => (v == null ? '' : `${v >= 0 ? '+' : '−'}${Math.abs(v)}`);

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

const symHtml = (r) => `<span class="dash-sym">${esc(r.symbol)}</span><span class="dash-ex">${esc(r.exchange)}</span>`;

function rowEl(r, valueHtml, accent = '') {
  return `<button class="dash-row${accent ? ' dash-row--' + accent : ''}" data-id="${esc(r.c.id)}">
    <span class="dash-row__sym">${symHtml(r)}</span>
    <span class="dash-row__val">${valueHtml}</span>
  </button>`;
}
function chip(r, valHtml, cls) {
  return `<button class="dash-chip dash-chip--${cls}" data-id="${esc(r.c.id)}">${esc(r.symbol)} <b>${valHtml}</b></button>`;
}
const empty = (txt) => `<p class="dash-empty">${esc(txt)}</p>`;
const hint = (txt) => `<p class="dash-hint">${esc(txt)}</p>`;

/* ── render the modal body from current state ─────────────────────────────── */

export function renderDashboardModal({ candidates = [], bucket = 'inbox', onOpenDetail, loadRankings, onOpenHit, onSelectInList } = {}) {
  if (document.getElementById('dashboard-modal-overlay')) return null;

  const state = { perfWindow: '1W', expanded: new Set() };

  // Expandable list: shows COLLAPSED rows, grows to EXPANDED on demand.
  function section(key, items, rowFn) {
    if (!items.length) return '';
    const open = state.expanded.has(key);
    const shown = items.slice(0, open ? EXPANDED : COLLAPSED);
    const rest = items.length - shown.length;
    const btn = (items.length > COLLAPSED)
      ? `<button class="dash-more" data-expand="${key}">${open ? 'weniger' : `+${rest} mehr`}</button>`
      : '';
    return `<div class="dash-group" data-group="${esc(key)}">${shown.map(rowFn).join('')}</div>${btn}`;
  }

  // Dynamics card body: risers / fallers by day-over-day delta, with a current-
  // leaders fallback before a second day of history exists.
  function dynamicsBody(mv, curOf, dOf, keyBase) {
    if (mv.risers.length || mv.fallers.length) {
      const row = (r) => {
        const cur = curOf(r), d = dOf(r), prev = cur - d;
        return rowEl(r,
          `<span class="dash-prev">${prev} → ${cur}</span>
           <span class="dash-badge ${d >= 0 ? 'pos' : 'neg'}">${fmtDelta(d)}</span>`,
          d >= 0 ? 'up' : 'down');
      };
      return section(keyBase + '.up', mv.risers, row) +
        (mv.risers.length && mv.fallers.length ? '<div class="dash-sep"></div>' : '') +
        section(keyBase + '.down', mv.fallers, row);
    }
    if (!mv.leaders.length) return empty('Keine Daten.');
    const row = (r) => rowEl(r, `<span class="dash-num">${curOf(r)}</span>`);
    return hint('Noch kein Vortagswert – aktuelle Spitzenwerte:') + section(keyBase + '.lead', mv.leaders, row);
  }

  function perfBody() {
    const { gainers, losers } = perfLeaders(candidates, state.perfWindow);
    if (!gainers.length && !losers.length) return empty('Keine Performance-Daten.');
    const row = (r) => rowEl(r, `<span class="dash-num ${r.perf >= 0 ? 'pos' : 'neg'}">${fmtPct(r.perf)}</span>`, r.perf >= 0 ? 'up' : 'down');
    return section('perf.up', gainers, row) +
      (gainers.length && losers.length ? '<div class="dash-sep"></div>' : '') +
      section('perf.down', losers, row);
  }

  function signalsBody() {
    const rsi = rsiExtremes(candidates);
    const macd = macdFlips(candidates);
    const group = (label, cls, items, valFn) => `<div class="dash-sig">
      <span class="dash-sig__label dash-sig__label--${cls}">${esc(label)}</span>
      <div class="dash-sig__items" data-group="sig.${cls}">${items.length
        ? items.slice(0, 8).map((r) => chip(r, valFn(r), cls)).join('')
        : '<span class="dash-none">keine</span>'}</div>
    </div>`;
    return group('Überverkauft · RSI ≤ 30', 'os', rsi.oversold, (r) => Math.round(r.rsi)) +
      group('Überkauft · RSI ≥ 70', 'ob', rsi.overbought, (r) => Math.round(r.rsi)) +
      group('MACD bullish gedreht', 'up', macd.bullish, () => icons.trendingUp) +
      group('MACD bearish gedreht', 'down', macd.bearish, () => icons.trendingDown);
  }

  function smaBody() {
    const { bullish, bearish } = smaCrosses(candidates);
    if (!bullish.length && !bearish.length)
      return empty('Keine frischen SMA-Kreuzungen (Kurs × SMA ab sofort, SMA × SMA ab dem 2. Datentag).');
    // Stacked block (symbol on top, cross label as the smaller second line) —
    // the labels are too wide to share one line with symbol + % on phones.
    const row = (r, dir) => `<button class="dash-row dash-row--${dir === 'pos' ? 'up' : 'down'}" data-id="${esc(r.c.id)}">
      <span class="dash-cross-stack">
        <span class="dash-row__sym">${symHtml(r)}</span>
        <span class="dash-cross">${esc(r.label)}${r.more ? ` +${r.more}` : ''}</span>
      </span>
      <span class="dash-num ${dir}">${fmtPct(r.dist)}</span>
    </button>`;
    const parts = [];
    if (bullish.length) parts.push(`<div class="dash-sub dash-sub--pos">Bullish</div>` + section('sma.up', bullish, (r) => row(r, 'pos')));
    if (bearish.length) parts.push(`<div class="dash-sub dash-sub--neg">Bearish</div>` + section('sma.down', bearish, (r) => row(r, 'neg')));
    return parts.join('<div class="dash-sep"></div>');
  }

  // SMA200-Extreme: weitester Abstand des Kurses über/unter der 200-Tage-Linie
  // (gleiche Rechnung wie der Monitor-Bericht, lib/sma200-extremes.js).
  function sma200Body() {
    const { above, below } = sma200Extremes(candidates, EXPANDED);
    if (!above.length && !below.length) return empty('Keine SMA200-Daten.');
    const row = (r, dir) => rowEl(r, `<span class="dash-num ${dir}">${fmtPct(r.dist)}</span>`, dir === 'pos' ? 'up' : 'down');
    const parts = [];
    if (above.length) parts.push(`<div class="dash-sub dash-sub--pos">Weit darüber · überdehnt</div>` + section('s200.above', above, (r) => row(r, 'pos')));
    if (below.length) parts.push(`<div class="dash-sub dash-sub--neg">Weit darunter · abgestraft</div>` + section('s200.below', below, (r) => row(r, 'neg')));
    return parts.join('<div class="dash-sep"></div>');
  }

  // Trend-Radar: einzelne Werte des Buckets nach kurzfristigem Trend-Score,
  // ersetzt das Signal-Scoreboard (der Recorder läuft im Hintergrund weiter).
  function radarBody() {
    const { rising, fresh } = trendRadar(candidates);
    if (!rising.length && !fresh.length) {
      return empty('Kein Einzelwert mit steigendem Kurzfrist-Trend (Score ≥ 40).');
    }
    const row = (r) => `<button class="dash-row dash-row--up" data-id="${esc(r.c.id)}">
      <span class="dash-cross-stack">
        <span class="dash-row__sym">${symHtml(r)}</span>
        <span class="dash-cross">${esc(r.badges.join(' · ') || '—')}</span>
      </span>
      <span class="dash-num pos">${r.score}</span>
    </button>`;
    const parts = [];
    if (rising.length) parts.push(section('radar.top', rising, row));
    if (fresh.length) parts.push(`<div class="dash-sub dash-sub--pos">Frisch gedreht (heute)</div>` + section('radar.fresh', fresh, row));
    return parts.join('<div class="dash-sep"></div>') +
      hint('Score 0–100, kurzfristig (≤1M): LS-Regression 30% · Richtung 20% · SMA-Stack 15% · Beschleunigung 15% · Volumen 10% · frischer Trigger 10%.');
  }

  function trendsBody() {
    const { clean, broken } = trends(candidates);
    if (!clean.length && !broken.length) return empty('Keine durchgehend gerichteten Trends (1W·1M·3M).');
    const row = (r, dir) => rowEl(r,
      `<span class="dash-num ${dir}">Ø ${r.ogrm != null ? r.ogrm.toFixed(1) + '%' : '–'}</span>
       <span class="dash-perfs">${fmtPct(r.tv.perf_w, 0)} · ${fmtPct(r.tv.perf_1m, 0)} · ${fmtPct(r.tv.perf_3m, 0)}</span>`,
      dir);
    const parts = [];
    if (clean.length)  parts.push(`<div class="dash-sub dash-sub--pos">Stark</div>` + section('trend.clean', clean, (r) => row(r, 'pos')));
    if (broken.length) parts.push(`<div class="dash-sub dash-sub--neg">Schwach</div>` + section('trend.broken', broken, (r) => row(r, 'neg')));
    return parts.join('<div class="dash-sep"></div>');
  }

  function pulseBody() {
    const p = pulse(candidates);
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

  function card(iconName, title, bodyHtml, extraHead = '') {
    return `<section class="dash-card">
      <header class="dash-card__head">
        <span class="dash-card__icon">${icons[iconName] ?? ''}</span>
        <h3>${esc(title)}</h3>
        ${extraHead}
      </header>
      <div class="dash-card__body">${bodyHtml}</div>
    </section>`;
  }

  const perfToggle = () => `<div class="dash-seg" data-seg="perf">${['1W', '1M', '3M']
    .map((w) => `<button class="dash-seg__btn${w === state.perfWindow ? ' is-active' : ''}" data-win="${w}">${w}</button>`)
    .join('')}</div>`;

  function bodyHtml() {
    return `
      <div class="dash-pulse">${pulseBody()}</div>
      ${card('barChart2', 'Score-Dynamik · Δ vs. Vortag', dynamicsBody(scoreMovers(candidates), (r) => r.overall, (r) => r.dOverall, 'score'))}
      ${card('trendingUp', 'Performance', `<div id="dash-perf-body">${perfBody()}</div>`, perfToggle())}
      ${card('zap', 'Momentum · Δ vs. Vortag', dynamicsBody(momMovers(candidates), (r) => r.mom, (r) => r.dMom, 'mom'))}
      ${card('gauge', 'PCHS / Zyklus · Δ vs. Vortag', dynamicsBody(pchsMovers(candidates), (r) => r.pchs, (r) => r.dPchs, 'pchs'))}
      ${card('activity', 'Signale & Extreme', signalsBody())}
      ${card('arrowUpDown', 'SMA-Kreuzungen · Δ vs. Vortag', smaBody())}
      ${card('arrowUpDown', 'Abstand zur SMA200 · Extreme', sma200Body())}
      ${card('candlestick', 'Trend-Radar · Einzelwerte', radarBody())}
      ${card('sparkles', 'Trends · 1W·1M·3M gerichtet · ØGr/M', trendsBody())}
    `;
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
        <button class="tab-btn active" data-dash-tab="overview" role="tab" aria-selected="true">Übersicht</button>
        <button class="tab-btn" data-dash-tab="rankings" role="tab" aria-selected="false">Rankings</button>
        <button class="tab-btn" data-dash-tab="picks" role="tab" aria-selected="false">Tagessieger</button>
      </div>
      <div class="modal-body dash-body">${bodyHtml()}</div>
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

  const rerender = () => { bodyEl.innerHTML = bodyHtml(); };

  /* Reiter Rankings – eine Seite ohne Unterreiter:
     1. technische Listen live aus den Kandidaten des aktiven Buckets (ohne KI;
        bei „Watch + Archiv" nur die Watchlist, Perzentile über beide),
     2. darunter einklappbar das KI-Wochenranking vom Sonntag aus dem market-Blob. */
  const rk = { tab: 'overview', data: null, err: null, loading: false, weeklyOpen: false, live: null };
  const scope = bucket === 'all' ? 'Watchlist' : (BUCKET_LABELS[bucket] ?? bucket);
  const weeklyBody = () => (rk.err ? `<p class="dash-muted">KI-Wochenranking konnte nicht geladen werden: ${esc(rk.err)}</p>`
    : rk.data ? weeklyRankingsHtml(rk.data)
    : '<p class="dash-muted"><span class="ls-loading"></span> Lade KI-Wochenranking …</p>');
  const renderRankings = () => {
    if (rk.tab !== 'rankings') return;
    rk.live ??= liveRankings(candidates, { bucket, n: 8 });
    bodyEl.innerHTML = `${liveRankingsHtml(rk.live, scope)}
      <details class="dash-card rk-weekly"${rk.weeklyOpen ? ' open' : ''}>
        <summary class="dash-card__head"><span class="dash-card__icon">${icons.sparkles ?? ''}</span><h3>KI-Wochenranking (Sonntag)</h3></summary>
        <div class="dash-card__body">${weeklyBody()}</div>
      </details>`;
    bodyEl.querySelector('.rk-weekly')?.addEventListener('toggle', (e) => { rk.weeklyOpen = e.target.open; });
  };
  async function showRankings() {
    renderRankings();
    if (rk.data || rk.loading || !loadRankings) return;
    rk.loading = true;
    try { rk.data = await loadRankings(); } catch (err) { rk.err = err.message; }
    rk.loading = false;
    renderRankings();
    renderPicks();
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
  }
  overlay.querySelectorAll('[data-dash-tab]').forEach((b) => b.addEventListener('click', () => {
    rk.tab = b.dataset.dashTab;
    overlay.querySelectorAll('[data-dash-tab]').forEach((t) => {
      const on = t === b;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    bodyEl.scrollTop = 0;
    if (rk.tab === 'rankings') showRankings(); else if (rk.tab === 'picks') showPicks(); else rerender();
  }));
  // click statt pointerup: ein Wisch beim Scrollen soll kein Detail öffnen.
  bodyEl.addEventListener('click', (e) => {
    if (e.target.closest('.grp-sel')) return;
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

    const win = e.target.closest('[data-win]');
    if (win) { state.perfWindow = win.dataset.win; rerender(); return; }

    const exp = e.target.closest('[data-expand]');
    if (exp) {
      const k = exp.dataset.expand;
      state.expanded.has(k) ? state.expanded.delete(k) : state.expanded.add(k);
      rerender();
      return;
    }

    const hit = e.target.closest('[data-id]');
    if (hit) {
      const cand = candidates.find((c) => c.id === hit.dataset.id);
      if (cand) onOpenDetail?.(cand, ctrl);
    }
  });

  return ctrl;
}
