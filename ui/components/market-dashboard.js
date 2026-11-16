/**
 * Markt-Dashboard im Monitor (Reiter „Markt“): Kennzahlen, passende Branchen- bzw.
 * Länder-Indizes, Treemap mit Drill-down, Titelliste der gewählten Kachel und Top-Mover.
 *
 * Zwei Perspektiven (Schalter): Sektoren (Sektor → Sub-Sektor → Titel) und Länder
 * (Land → Sektor → Titel), immer eine Ebene zur Zeit. Logik in lib/market-scope.js, die
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
} from '../lib/market-scope.js?v=20261116c';
import { INDEX_GROUPS, allIndexEntries } from '../lib/tv-indices.js?v=20261023a';
import { COLOR_MODES, metricFn } from '../lib/market-signals.js?v=20261116c';

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
  const st = { view: 'sector', path: [], h: HORIZONS[0].key, color: 'perf', listAll: false, idx: indexCache?.rows ?? null, idxState: 'idle' };
  const horizon = () => HORIZONS.find((h) => h.key === st.h) ?? HORIZONS[0];
  const levels = () => PERSPECTIVES[st.view].levels;
  const scoped = () => scopeOf(base, st.view, st.path);
  const scopeLabel = () => (st.path.length ? st.path[st.path.length - 1] : 'Alle');
  /* Färbung der Kacheln: Performance im Horizont oder eine Kennzahl aus market-signals. */
  const colorMode = () => COLOR_MODES.find((m) => m.key === st.color) ?? COLOR_MODES[0];
  const colorCap = () => colorMode().cap ?? horizon().cap;
  const colorLabel = () => (st.color === 'perf' ? horizon().label : colorMode().label);
  const metricCache = new Map();
  const tileValue = () => {
    if (st.color === 'perf') return st.h;
    if (!metricCache.has(st.color)) metricCache.set(st.color, metricFn(st.color, base));
    return metricCache.get(st.color);
  };
  const fmtTile = (v) => (v == null ? '–' : st.color === 'perf' ? fmtPct(v) : colorMode().fmt(v));

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
    // Kacheln in derselben Farblogik wie die Treemap.
    const chip = (i) => {
      const inner = `<span class="md-ix__label">${esc(i.label)}</span><span class="md-ix__val">${fmtPct(i.v)}</span>`;
      const tip = `${i.label} (${i.code}) · ${horizon().label} ${fmtPct(i.v, 2)}`;
      const style = tileStyle(i.v, horizon().cap);
      return i.url
        ? `<a class="md-ix__chip" style="${style}" href="${esc(i.url)}" target="_blank" rel="noopener" title="${esc(tip)} – auf TradingView öffnen" aria-label="${esc(tip)}">${inner}</a>`
        : `<span class="md-ix__chip" style="${style}" title="${esc(tip)}">${inner}</span>`;
    };
    const head = mode === 'edge' ? `${kind} · stärkste und schwächste` : `${kind} · ${esc(scopeLabel())}`;
    return `<div class="md-ix"><span class="md-ix__head">${head}</span><div class="md-ix__row">${items.map(chip).join('')}</div></div>`;
  }

  /* ── Bausteine ─────────────────────────────────────────────────────────── */
  const seg = (attr, items, cur) => `<div class="dash-seg">${items
    .map(([k, l]) => `<button type="button" class="dash-seg__btn${k === cur ? ' is-active' : ''}" data-md-${attr}="${esc(k)}">${esc(l)}</button>`).join('')}</div>`;

  /* Schmale Kennzahlenzeile: Anzahl · Plus · Minus · Median. */
  function kpisHtml(sc) {
    const b = breadth(sc, st.h);
    return `<div class="md-kpis">
      <span><b>${b.n}</b> Titel</span>
      <span class="pos">${icons.arrowUp}<b>${b.up}</b></span>
      <span class="neg">${icons.arrowDown}<b>${b.down}</b></span>
      <span class="md-kpis__med">Median ${horizon().label} <b class="${tone(b.median)}">${fmtPct(b.median)}</b></span>
    </div>`;
  }

  /* Brotkrumen + „In Tabelle öffnen“ (alle Titel des Ausschnitts in der Hauptliste). */
  const crumbsHtml = (n) => `<div class="md-bcrow"><nav class="md-bc" aria-label="Ausschnitt">${['Alle', ...st.path]
    .map((name, i) => `${i ? `<span class="md-bc__sep">${icons.chevronRight}</span>` : ''}<button type="button" class="md-bc__btn${i === st.path.length ? ' is-current' : ''}" data-md-bc="${i}">${esc(name)}</button>`)
    .join('')}</nav>${st.path.length && n ? `<button type="button" class="btn btn-sm btn-secondary" data-md-show title="Alle ${n} Titel des Ausschnitts in der Tabelle zeigen">In Tabelle öffnen</button>` : ''}</div>`;

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
    const parts = [`Kachelgröße = Anzahl Titel · Farbe = Median ${colorLabel()}${st.color === 'perf' ? '' : ` (${colorMode().title})`}`];
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
      <div class="md-ctl md-ctl--color"><span class="md-ctl__label">Farbe</span>${seg('color', COLOR_MODES.map((m) => [m.key, m.label]), st.color)}</div>
      ${kpisHtml(sc)}
      ${indicesHtml()}
      ${crumbsHtml(sc.length)}
      <div class="md-tm" id="md-tm" role="group" aria-label="Treemap ${esc(PERSPECTIVES[st.view].label)}"></div>
      ${noteHtml(sc)}
      ${listHtml(mv)}
      ${moversHtml(mv)}`;
  }

  /* ── Treemap ───────────────────────────────────────────────────────────── */
  function tileHtml(t, box) {
    const w = box ? box.x1 - box.x0 : 0, h = box ? box.y1 - box.y0 : 0;
    const pos = box ? `left:${box.x0}px;top:${box.y0}px;width:${w}px;height:${h}px;` : '';
    const showName = !box || (w > 44 && h > 22);
    const showVal = !box || (w > 44 && h > 42);
    const showTag = t.tag && (!box || (w > 70 && h > 64));
    const tip = `${t.name}${t.tag ? ` (${t.tag})` : ''} · ${colorLabel()} ${fmtTile(t.v)}${t.c ? '' : ` · ${t.n} Titel`}`;
    const target = t.c ? `data-id="${esc(t.c.id)}"` : `data-md-tile="${esc(t.name)}"`;
    const shade = t.v == null ? null : t.v - colorMode().mid;
    return `<button type="button" class="md-tile" ${target} style="${pos}${tileStyle(shade, colorCap())}" title="${esc(tip)}" aria-label="${esc(tip)}">
      ${showName ? `<span class="md-tile__name">${esc(t.name)}</span>` : ''}
      ${showVal ? `<span class="md-tile__val">${fmtTile(t.v)}${t.c ? '' : `<span class="md-tile__n">${t.n}</span>`}</span>` : ''}
      ${showTag ? `<span class="md-tile__tag">${esc(t.tag)}</span>` : ''}
    </button>`;
  }

  /** Zeichnet die Kacheln in `#md-tm` (nach jedem Einsetzen von topHtml aufrufen). */
  async function draw(root) {
    const el = root.querySelector('#md-tm');
    if (!el) return;
    const { tiles } = tilesFor(scoped(), st.view, st.path, tileValue());
    if (!tiles.length) { el.innerHTML = '<p class="dash-empty">Keine Titel im Ausschnitt.</p>'; el.classList.add('md-tm--grid'); return; }
    const d3 = await loadD3();
    if (!el.isConnected) return;               // inzwischen neu gezeichnet
    const W = el.clientWidth;
    if (!d3 || !W) {                           // Ersatz: gleich grosse Kacheln im Raster
      el.classList.add('md-tm--grid');
      el.innerHTML = tiles.map((t) => tileHtml(t, null)).join('');
      return;
    }
    el.classList.remove('md-tm--grid');
    const H = W < 420 ? 280 : 340;
    el.style.height = `${H}px`;
    const h = d3.hierarchy({ children: tiles.map((t) => ({ t })) }).sum((d) => (d.t ? d.t.n : 0)).sort((a, b) => b.value - a.value);
    d3.treemap().size([W, H]).paddingInner(2).round(true)(h);
    el.innerHTML = h.leaves().map((n) => tileHtml(n.data.t, n)).join('');
  }

  /**
   * Klick im Dashboard auswerten.
   * @returns {null | {changed:true} | {show:string[]}}  `show` = IDs für „In Tabelle öffnen“
   */
  function handleClick(e) {
    const t = e.target.closest('[data-md-view],[data-md-h],[data-md-color],[data-md-bc],[data-md-tile],[data-md-more],[data-md-show]');
    if (!t) return null;
    const d = t.dataset;
    if (d.mdShow != null) return { show: scoped().map((c) => c.id) };
    if (d.mdMore != null) { st.listAll = !st.listAll; return { changed: true }; }
    st.listAll = false;
    if (d.mdView) { if (d.mdView === st.view) return null; st.view = d.mdView; st.path = []; }
    else if (d.mdH) { if (d.mdH === st.h) return null; st.h = d.mdH; }
    else if (d.mdColor) { if (d.mdColor === st.color) return null; st.color = d.mdColor; }
    else if (d.mdBc != null) st.path = st.path.slice(0, Number(d.mdBc));
    else if (d.mdTile != null && st.path.length < levels().length) st.path = [...st.path, d.mdTile];
    return { changed: true };
  }

  return { st, scoped, scopeLabel, topHtml, draw, handleClick, loadIndices, hasData: () => base.length > 0 };
}
