/**
 * Markt-Dashboard im Monitor (Reiter „Markt“): Kennzahlen, passende Branchen- bzw.
 * Länder-Indizes, Treemap mit Drill-down, Titelliste der gewählten Kachel und Top-Mover.
 *
 * Zwei Perspektiven (Schalter): Sektoren (Mega-Cluster → Sektor → Sub-Sektor → Titel)
 * und Länder (Region → Land → Sektor → Titel). Logik in lib/market-scope.js, die
 * Kachelflächen rechnet d3-hierarchy (lib/d3-loader.js, lazy; ohne d3 ein Raster).
 *
 * Die Komponente hält nur Zustand und liefert HTML; dashboard-modal.js zeichnet neu,
 * sobald `handleClick` eine Änderung meldet, und filtert Rankings und Signale mit
 * `scoped()` auf denselben Ausschnitt. Titel-Kacheln und -Zeilen tragen `data-id`
 * (öffnet wie überall im Monitor das Detail-Sheet).
 */

import { icons } from '../lib/icons.js?v=20261103f';
import { loadD3 } from '../lib/d3-loader.js?v=20261116a';
import {
  HORIZONS, PERSPECTIVES, withData, scopeOf, tilesFor, breadth, movers,
  countryCoverage, indicesFor, dimsOf,
} from '../lib/market-scope.js?v=20261116a';
import { INDEX_GROUPS, allIndexEntries } from '../lib/tv-indices.js?v=20261023a';

const LIST_COLLAPSED = 8;
const INDEX_TTL_MS = 5 * 60 * 1000;
let indexCache = null;   // { at, rows:{branchen,laender} } – über Modal-Öffnungen hinweg

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const fmtPct = (v, dec = 1) => (v == null || Number.isNaN(v) ? '–' : `${v >= 0 ? '+' : '−'}${Math.abs(Number(v)).toFixed(dec)}%`);
const tone = (v) => (v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '');

/* Kachelfarbe wie die Sektoren-Heatmap: Token in die Fläche gemischt, Sättigung ∝ |Wert|. */
function tileStyle(v, cap) {
  if (v == null) return 'background:var(--surface-3)';
  const pct = Math.round(Math.min(Math.abs(v) / cap, 1) * 50 + 6);
  return `background:color-mix(in srgb, var(${v >= 0 ? '--pos' : '--neg'}) ${pct}%, var(--surface-2))`;
}

export function createMarketDashboard({ candidates = [], onFetchIndexRows } = {}) {
  const base = withData(candidates);
  const st = { view: 'sector', path: [], h: HORIZONS[0].key, listAll: false, idx: indexCache?.rows ?? null, idxState: 'idle' };
  const horizon = () => HORIZONS.find((h) => h.key === st.h) ?? HORIZONS[0];
  const levels = () => PERSPECTIVES[st.view].levels;
  const scoped = () => scopeOf(base, st.view, st.path);
  const scopeLabel = () => (st.path.length ? st.path[st.path.length - 1] : 'Alle');

  /* ── Indizes (Branchen/Länder) – einmal je Öffnung, 5 min gecacht ───────── */
  async function loadIndices(onDone) {
    if (!onFetchIndexRows || st.idxState === 'loading') return;
    if (indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) { st.idx = indexCache.rows; return; }
    st.idxState = 'loading';
    try {
      const rows = await onFetchIndexRows(allIndexEntries());
      if (Array.isArray(rows)) {
        const byCode = new Map(rows.map((r) => [r.code, r]));
        const grouped = Object.fromEntries(INDEX_GROUPS.map((g) => [g.key, g.entries.map((e) => byCode.get(e.code)).filter(Boolean)]));
        indexCache = { at: Date.now(), rows: grouped };
        st.idx = grouped;
      }
      st.idxState = 'done';
    } catch { st.idxState = 'error'; }
    onDone?.();
  }

  function indicesHtml() {
    if (!st.idx) {
      return st.idxState === 'loading' ? '<p class="md-note"><span class="ls-loading"></span> Indizes werden geladen …</p>' : '';
    }
    const { items, mode } = indicesFor(st.idx, st.view, st.path, st.h);
    const kind = st.view === 'country' ? 'Länder-Indizes' : 'Branchen-Indizes';
    if (!items.length) return `<p class="md-note">Kein ${st.view === 'country' ? 'Länder' : 'Branchen'}-Index für ${esc(scopeLabel())}.</p>`;
    const chip = (i) => {
      const inner = `<span class="md-ix__label">${esc(i.label)}</span><span class="md-ix__val ${tone(i.v)}">${fmtPct(i.v)}</span>`;
      const tip = `${i.label} (${i.code}) · ${horizon().label} ${fmtPct(i.v, 2)}`;
      return i.url
        ? `<a class="md-ix__chip" href="${esc(i.url)}" target="_blank" rel="noopener" title="${esc(tip)} – auf TradingView öffnen" aria-label="${esc(tip)}">${inner}</a>`
        : `<span class="md-ix__chip" title="${esc(tip)}">${inner}</span>`;
    };
    const head = mode === 'edge' ? `${kind} · stärkste und schwächste` : `${kind} · ${esc(scopeLabel())}`;
    return `<div class="md-ix"><span class="md-ix__head">${head}</span><div class="md-ix__row">${items.map(chip).join('')}</div></div>`;
  }

  /* ── Bausteine ─────────────────────────────────────────────────────────── */
  const seg = (attr, items, cur) => `<div class="dash-seg">${items
    .map(([k, l]) => `<button type="button" class="dash-seg__btn${k === cur ? ' is-active' : ''}" data-md-${attr}="${esc(k)}">${esc(l)}</button>`).join('')}</div>`;

  function kpisHtml(sc) {
    const b = breadth(sc, st.h);
    const tile = (label, val, cls = '') => `<div class="md-kpi"><span class="md-kpi__label">${label}</span><span class="md-kpi__val ${cls}">${val}</span></div>`;
    return `<div class="md-kpis">${tile('Titel', b.n)}${tile('Plus', b.up, 'pos')}${tile('Minus', b.down, 'neg')}${tile('Median', fmtPct(b.median), tone(b.median))}</div>`;
  }

  const crumbsHtml = () => `<nav class="md-bc" aria-label="Ausschnitt">${['Alle', ...st.path]
    .map((n, i) => `${i ? `<span class="md-bc__sep">${icons.chevronRight}</span>` : ''}<button type="button" class="md-bc__btn${i === st.path.length ? ' is-current' : ''}" data-md-bc="${i}">${esc(n)}</button>`)
    .join('')}</nav>`;

  /* Zweite Zeile einer Titelzeile: das Merkmal, das die Perspektive nicht schon zeigt. */
  const context = (c) => { const d = dimsOf(c); return st.view === 'country' ? d.sub : d.country; };
  const stockRow = (r) => `<button class="dash-row dash-row--${r.v >= 0 ? 'up' : 'down'}" data-id="${esc(r.c.id)}">
      <span class="dash-row__sym"><span class="dash-sym">${esc(r.c.symbol)}</span><span class="dash-ex">${esc(context(r.c))}</span></span>
      <span class="dash-row__val"><span class="dash-num ${tone(r.v)}">${fmtPct(r.v)}</span></span>
    </button>`;

  function listHtml(mv) {
    if (!st.path.length) return '';
    const rows = mv.all;
    const shown = st.listAll ? rows : rows.slice(0, LIST_COLLAPSED);
    const rest = rows.length - shown.length;
    return `<section class="dash-card md-list">
      <header class="dash-card__head">
        <span class="dash-card__icon">${icons.search}</span>
        <h3>Titel in ${esc(scopeLabel())} · ${rows.length}</h3>
        <button type="button" class="btn btn-sm btn-secondary" data-md-show>In Liste zeigen</button>
      </header>
      <div class="dash-card__body">
        ${rows.length ? `<div class="dash-group" data-group="md.tile">${shown.map(stockRow).join('')}</div>` : '<p class="dash-empty">Keine Titel mit Kursdaten.</p>'}
        ${rows.length > LIST_COLLAPSED ? `<button type="button" class="dash-more" data-md-more>${st.listAll ? 'weniger' : `+${rest} mehr`}</button>` : ''}
      </div>
    </section>`;
  }

  function moversHtml(mv) {
    const col = (label, cls, key, rows) => `<div class="md-col">
        <div class="dash-sub dash-sub--${cls}">${label}</div>
        ${rows.length ? `<div class="dash-group" data-group="${key}">${rows.map(stockRow).join('')}</div>` : '<p class="dash-empty">keine</p>'}
      </div>`;
    return `<section class="dash-card">
      <header class="dash-card__head"><span class="dash-card__icon">${icons.trendingUp}</span><h3>Top-Mover · ${horizon().label} · ${esc(scopeLabel())}</h3></header>
      <div class="dash-card__body md-cols">${col('Gewinner', 'pos', 'md.up', mv.gainers)}${col('Verlierer', 'neg', 'md.down', mv.losers)}</div>
    </section>`;
  }

  function noteHtml(sc) {
    const parts = [`Kachelgröße = Anzahl Titel · Farbe = Median ${horizon().label}`];
    const missing = candidates.length - base.length;
    if (missing > 0) parts.push(`${missing} ohne TV-Daten nicht enthalten`);
    if (st.view === 'country') {
      const cov = countryCoverage(sc);
      parts.push(`Land: ${cov.profile} aus dem Firmenprofil${cov.exchange ? `, ${cov.exchange} nach Börsenplatz (Profil noch nicht geladen)` : ''}${cov.none ? `, ${cov.none} unbekannt` : ''}`);
    }
    return `<p class="md-note">${esc(parts.join(' · '))}</p>`;
  }

  function topHtml() {
    const sc = scoped();
    if (!base.length) return '<p class="dash-empty">Keine Titel mit TV-Daten – erst TV-Daten laden.</p>';
    const mv = movers(sc, st.h, 5);
    return `
      <div class="md-ctl">
        ${seg('view', Object.entries(PERSPECTIVES).map(([k, p]) => [k, p.label]), st.view)}
        ${seg('h', HORIZONS.map((h) => [h.key, h.label]), st.h)}
      </div>
      ${kpisHtml(sc)}
      ${indicesHtml()}
      ${crumbsHtml()}
      <div class="md-tm" id="md-tm" role="group" aria-label="Treemap ${esc(PERSPECTIVES[st.view].label)}"></div>
      ${noteHtml(sc)}
      ${listHtml(mv)}
      ${moversHtml(mv)}`;
  }

  /* ── Treemap ───────────────────────────────────────────────────────────── */
  function tileHtml(t, box, parent = '') {
    const w = box ? box.x1 - box.x0 : 0, h = box ? box.y1 - box.y0 : 0;
    const pos = box ? `left:${box.x0.toFixed(1)}px;top:${box.y0.toFixed(1)}px;width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;` : '';
    const showName = !box || (w > 44 && h > 22);
    const showVal = !box || (w > 44 && h > 42);
    const tip = `${t.name} · ${horizon().label} ${fmtPct(t.v)}${t.c ? '' : ` · ${t.n} Titel`}`;
    const target = t.c ? `data-id="${esc(t.c.id)}"` : `data-md-tile="${esc(t.name)}" data-md-parent="${esc(parent)}"`;
    return `<button type="button" class="md-tile" ${target} style="${pos}${tileStyle(t.v, horizon().cap)}" title="${esc(tip)}" aria-label="${esc(tip)}">
      ${showName ? `<span class="md-tile__name">${esc(t.name)}</span>` : ''}
      ${showVal ? `<span class="md-tile__val">${fmtPct(t.v)}${t.c ? '' : `<span class="md-tile__n">${t.n}</span>`}</span>` : ''}
    </button>`;
  }

  /** Zeichnet die Kacheln in `#md-tm` (nach jedem Einsetzen von topHtml aufrufen). */
  async function draw(root) {
    const el = root.querySelector('#md-tm');
    if (!el) return;
    const data = tilesFor(scoped(), st.view, st.path, st.h);
    const flat = data.groups ? data.groups.flatMap((g) => g.tiles.map((t) => ({ t, parent: g.name }))) : data.tiles.map((t) => ({ t, parent: '' }));
    if (!flat.length) { el.innerHTML = '<p class="dash-empty">Keine Titel im Ausschnitt.</p>'; el.classList.add('md-tm--grid'); return; }
    const d3 = await loadD3();
    if (!el.isConnected) return;               // inzwischen neu gezeichnet
    const W = el.clientWidth;
    if (!d3 || !W) {                           // Ersatz: gleich grosse Kacheln im Raster
      el.classList.add('md-tm--grid');
      el.innerHTML = flat.map(({ t, parent }) => tileHtml(t, null, parent)).join('');
      return;
    }
    el.classList.remove('md-tm--grid');
    const H = W < 420 ? 280 : 340;
    el.style.height = `${H}px`;
    const tree = data.groups
      ? { children: data.groups.map((g) => ({ g, children: g.tiles.map((t) => ({ t })) })) }
      : { children: data.tiles.map((t) => ({ t })) };
    const h = d3.hierarchy(tree).sum((d) => (d.t ? d.t.n : 0)).sort((a, b) => b.value - a.value);
    // paddingOuter setzt alle vier Ränder – deshalb vor paddingTop (Platz für das Gruppenlabel).
    d3.treemap().size([W, H]).paddingInner(2).round(true)
      .paddingOuter(data.groups ? 1 : 0)
      .paddingTop((n) => (data.groups && n.depth === 1 ? 20 : 0))(h);
    let html = '';
    if (data.groups) {
      for (const n of h.children ?? []) {
        const g = n.data.g;
        if (n.y1 - n.y0 < 24 || n.x1 - n.x0 < 40) continue;   // zu klein für ein Label
        html += `<button type="button" class="md-tm__group" data-md-top="${esc(g.name)}" title="${esc(`${g.name} · ${fmtPct(g.v)} · ${g.n} Titel`)}"
          style="left:${n.x0}px;top:${n.y0}px;width:${n.x1 - n.x0}px">${esc(g.name)} <span class="${tone(g.v)}">${fmtPct(g.v)}</span></button>`;
      }
    }
    for (const n of h.leaves()) html += tileHtml(n.data.t, n, n.parent?.data?.g?.name ?? '');
    el.innerHTML = html;
  }

  /**
   * Klick im Dashboard auswerten.
   * @returns {null | {changed:true} | {show:string[]}}  `show` = IDs für „In Liste zeigen“
   */
  function handleClick(e) {
    const t = e.target.closest('[data-md-view],[data-md-h],[data-md-bc],[data-md-top],[data-md-tile],[data-md-more],[data-md-show]');
    if (!t) return null;
    const d = t.dataset;
    if (d.mdShow != null) return { show: scoped().map((c) => c.id) };
    if (d.mdMore != null) { st.listAll = !st.listAll; return { changed: true }; }
    st.listAll = false;
    if (d.mdView) { if (d.mdView === st.view) return null; st.view = d.mdView; st.path = []; }
    else if (d.mdH) { if (d.mdH === st.h) return null; st.h = d.mdH; }
    else if (d.mdBc != null) st.path = st.path.slice(0, Number(d.mdBc));
    else if (d.mdTop) st.path = [d.mdTop];
    else if (d.mdTile != null) {
      if (!st.path.length) st.path = [d.mdParent, d.mdTile];
      else if (st.path.length < levels().length) st.path = [...st.path, d.mdTile];
    }
    return { changed: true };
  }

  return { st, scoped, scopeLabel, topHtml, draw, handleClick, loadIndices, hasData: () => base.length > 0 };
}
