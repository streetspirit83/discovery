/**
 * Trend Map + Trend Scanner (seit 26.11.2026), Monitor › Dynamik unter der Setup-Matrix (EPS-Scatter).
 *
 * Scatter über den Ausschnitt des Reiters (Liste gefiltert → nur diese Titel, Cluster-Drill-down):
 * x = SMA Trend Strength Score 0–100, y = Steigung der SMA50 über 20 Handelstage in %, ein Punkt je
 * Titel. Hintergrund in drei Bereichen (Trendstatus aus `statusOf` in lib/sma-trend-score.js):
 * stark positiv (Score ≥ 70, SMA50 steigend) · entwickelnd · schwach/negativ (Score < 40 oder SMA50
 * fallend). Punktgröße = Börsenwert (abschaltbar), Umriss = Score aus unvollständiger Historie.
 * Zoom, Tippen, Legende (= Filter Trendstatus) kommen aus components/zoom-scatter.js.
 *
 * Filter über der Grafik: Score ab 40/55/70, Markt (USA · Europa · Sonstige), Größe, nur vollständige.
 * Darunter (Desktop daneben) der Trend Scanner: alle Titel im Ausschnitt mit Score, SMA50-/SMA200-
 * Steigung, Separation SMA20–SMA200 und Stabilität, sortierbar per Spaltenkopf, „In Tabelle öffnen“.
 *
 * Zustand `tm` hält der Aufrufer (`defaultTrendState`), Klicks laufen über `trendMapClick`.
 */

import { zoomScatterHtml, zsVisible } from './zoom-scatter.js?v=20261126a';
import { smaTrendScore, TREND_STATUS, TREND_MARKETS, marketOf, SMA_TS } from '../lib/sma-trend-score.js?v=20261126a';
import { USD_PER } from '../lib/rankings-filter.js?v=20261126a';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const sp = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d).replace('.', ',')}%`);
const tone = (v) => (v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const Y_CLAMP = [-12, 20];                        // SMA50-Steigung: Ausreisser an den Rand
const MIN_SCORES = [[0, 'Alle'], [40, '≥ 40'], [55, '≥ 55'], [70, '≥ 70']];
const TABLE_MAX = 60;

export function defaultTrendState() {
  return { zs: { zoom: [], off: new Set() }, min: 0, mkt: '', size: true, full: false, sort: 'score', asc: false, more: false };
}

const capUsd = (c) => {
  const v = Number(c.tv_data?.market_cap);
  const rate = USD_PER[String(c.currency ?? 'USD').toUpperCase()] ?? 1;
  return v > 0 ? v * rate : null;
};
/* Radius-Faktor 0,7…2 über log10 Börsenwert: 300 Mio → klein, 3 Bio → gross. */
const sizeOf = (c) => { const v = capUsd(c); return v ? 0.7 + 1.3 * Math.max(0, Math.min(1, (Math.log10(v) - 8.5) / 4)) : 0.7; };

/** Alle Titel des Ausschnitts mit Score (vor den Filtern), je Titel einmal. */
export function trendRows(cands) {
  const out = [];
  for (const c of cands) {
    const s = smaTrendScore(c);
    if (s) out.push({ c, s });
  }
  return out;
}
/** Filter Score/Markt/vollständig (der Trendstatus läuft über die Legende). */
const passes = (r, tm) => r.s.score >= tm.min && (!tm.mkt || marketOf(r.c) === tm.mkt) && (!tm.full || !r.s.partial);

export function trendPoints(rows, tm) {
  const pts = [];
  for (const r of rows) {
    if (!passes(r, tm)) continue;
    const y = r.s.slopes[50];
    if (y == null) continue;
    const { c, s } = r;
    pts.push({ id: c.id, x: s.score, y: Math.max(Y_CLAMP[0], Math.min(Y_CLAMP[1], y)), group: s.status, sym: c.symbol, c, s,
      r: tm.size ? sizeOf(c) : null, hollow: s.partial,
      tip: `${c.symbol} · Score ${s.partial ? '~' : ''}${s.score} · SMA50 ${sp(y)} / 20 T · SMA200 ${sp(s.slopes[200])} · Sep ${sp(s.sep)}` });
  }
  return tm.size ? pts.sort((a, b) => (b.r ?? 0) - (a.r ?? 0)) : pts;   // grosse zuerst, kleine liegen oben
}
export function trendDomain(pts) {
  let lo = -2, hi = 4;
  for (const p of pts) { if (p.y < lo) lo = p.y; if (p.y > hi) hi = p.y; }
  return { x0: 0, x1: 100, y0: Math.floor(lo - 0.5), y1: Math.ceil(hi + 0.5) };
}
/** IDs im aktuellen Ausschnitt (Zoom + Legende + Filter) – für „In Tabelle öffnen“. */
export function trendVisibleIds(rows, tm) {
  const pts = trendPoints(rows, tm);
  return [...new Set(zsVisible(pts, trendDomain(pts), tm.zs).map((p) => p.id))];
}

const SORTS = {
  score: (r) => r.s.score, s50: (r) => r.s.slopes[50], s200: (r) => r.s.slopes[200], sep: (r) => r.s.sep,
  stab: (r) => (r.s.stabN ? r.s.stabDays / r.s.stabN : null), sym: (r) => r.c.symbol,
};
function scannerHtml(prs, tm) {
  const rows = prs.map((ps) => ({ c: ps[0].c, s: ps[0].s }));
  const get = SORTS[tm.sort] ?? SORTS.score;
  rows.sort((a, b) => {
    const va = get(a), vb = get(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const d = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return tm.asc ? d : -d;
  });
  const th = (k, l, t) => `<button type="button" class="tm-th${tm.sort === k ? ' is-on' : ''}" data-tm-sort="${k}" title="${esc(t)} · tippen sortiert">${l}${tm.sort === k ? (tm.asc ? ' ▲' : ' ▼') : ''}</button>`;
  const shown = tm.more ? rows : rows.slice(0, TABLE_MAX);
  const body = shown.map(({ c, s }) => {
    const st = TREND_STATUS[s.status];
    return `<button class="dash-row tm-row" data-id="${esc(c.id)}">
      <span class="dash-row__sym"><span class="dash-sym">${esc(c.symbol)}</span><span class="dash-ex">${esc(c.name ?? c.exchange ?? '')}</span></span>
      <span class="tm-cell tm-score" style="--tm-c:var(${st?.tone ?? '--muted'})" title="${esc(`${st?.label ?? ''}${s.partial ? ' · unvollständige Historie' : ''}`)}">${s.partial ? '~' : ''}${s.score}</span>
      <span class="tm-cell ${tone(s.slopes[50])}">${sp(s.slopes[50])}</span>
      <span class="tm-cell ${tone(s.slopes[200])}">${sp(s.slopes[200], 2)}</span>
      <span class="tm-cell ${tone(s.sep)}">${sp(s.sep)}</span>
      <span class="tm-cell tm-stab">${s.stabN ? `${s.stabDays}/${s.stabN}` : '—'}</span></button>`;
  }).join('');
  return `<div class="tm-scan">
    <div class="tm-head"><span class="tm-head__sym">${th('sym', 'Titel', 'Symbol')}</span>${th('score', 'Score', 'SMA Trend Strength 0–100')}${th('s50', 'S50↗', 'Steigung SMA50 über 20 Handelstage')}${th('s200', 'S200↗', 'Steigung SMA200 über 20 Handelstage')}${th('sep', 'Sep', 'Abstand SMA20 über SMA200 in %')}${th('stab', 'Stab', 'Tage mit bullischer SMA-Struktur in den letzten 20')}</div>
    <div class="dash-group" data-group="trend.scanner">${body}</div>
    ${rows.length > TABLE_MAX ? `<button type="button" class="btn btn-sm btn-secondary" data-tm-more>${tm.more ? 'Weniger zeigen' : `Alle ${rows.length} zeigen`}</button>` : ''}
  </div>`;
}

export function trendMapHtml(cands, tm) {
  const rows = trendRows(cands);
  if (!rows.length) return '';
  const pts = trendPoints(rows, tm);
  const full = trendDomain(pts);
  const filtered = rows.filter((r) => passes(r, tm));
  const noSlope = filtered.filter((r) => r.s.slopes[50] == null).length;
  const partial = filtered.filter((r) => r.s.partial).length;
  const seg = (list, cur, attr) => `<div class="dash-seg">${list.map(([k, l]) => `<button type="button" class="dash-seg__btn${k === cur ? ' is-active' : ''}" data-${attr}="${k}">${l}</button>`).join('')}</div>`;
  const ctl = `<div class="md-ctl tm-ctl">
      <span class="md-ctl__label">Score</span>${seg(MIN_SCORES, tm.min, 'tm-min')}
      <span class="md-ctl__label">Markt</span>${seg(TREND_MARKETS, tm.mkt, 'tm-mkt')}
      <button type="button" class="dash-seg__btn tm-tog${tm.size ? ' is-active' : ''}" data-tm-size aria-pressed="${tm.size}" title="Punktgröße = Börsenwert">Größe = Börsenwert</button>
      <button type="button" class="dash-seg__btn tm-tog${tm.full ? ' is-active' : ''}" data-tm-full aria-pressed="${tm.full}" title="Nur Titel mit voller 20-Tage-Historie">nur vollständig</button>
    </div>`;
  const W = SMA_TS.W;
  const notes = [
    `Score = Alignment ${W.align} · Slope ${W.slope} · Separation ${W.sep} · Stabilität ${W.stab} Punkte, alles in %`,
    'Farbe = Trendstatus (Legende filtert)',
    partial ? `${partial} mit kürzerer Historie (Umriss, Score auf verfügbare Punkte normiert)` : null,
    noSlope ? `${noSlope} ohne SMA50-Steigung nicht in der Grafik, aber im Scanner` : null,
    `SMA50-Steigung außerhalb ${Y_CLAMP[0]}…+${Y_CLAMP[1]} % am Rand`,
  ].filter(Boolean).join(' · ');
  // Scanner: alle gefilterten Titel im Zoom-Ausschnitt; ohne SMA50-Steigung nur ohne Zoom.
  const map = zoomScatterHtml({
    key: 'trend', points: pts, full, st: tm.zs,
    groups: Object.entries(TREND_STATUS).map(([k, g]) => ({ key: k, label: g.label, tone: g.tone })),
    zones: [
      { x0: 0, x1: SMA_TS.WEAK, y0: -1e3, y1: 1e3, tone: '--neg' },
      { x0: SMA_TS.WEAK, x1: 100, y0: -1e3, y1: 0, tone: '--neg' },
      { x0: SMA_TS.WEAK, x1: SMA_TS.STRONG, y0: 0, y1: 1e3, tone: '--warn' },
      { x0: SMA_TS.STRONG, x1: 100, y0: 0, y1: 1e3, tone: '--pos' },
    ],
    title: 'Trend Map', xLabel: 'SMA Trend Score 0–100', yLabel: 'SMA50-Steigung % (20 T)', xShort: 'Score', yShort: 'S50',
    refs: [{ axis: 'y', v: 0 }, { axis: 'x', v: SMA_TS.WEAK, cls: 'zs-grid', label: String(SMA_TS.WEAK) }, { axis: 'x', v: SMA_TS.STRONG, cls: 'zs-grid', label: String(SMA_TS.STRONG) }],
    quads: [{ x: 'r', y: 't', text: 'stark positiv', cls: 'sm-quad tm-quad--pos' }, { x: 'l', y: 'b', text: 'schwach / negativ', cls: 'sm-quad tm-quad--neg' }],
    tableHtml: (prs) => scannerHtml(tm.zs.zoom.length ? prs : withoutSlope(prs, filtered, tm), tm),
    note: notes,
  });
  return `<div class="tm-wrap">${ctl}${map}</div>`;
}
/* Ohne Zoom zeigt der Scanner auch Titel ohne SMA50-Steigung (Trendstatus-Legende gilt weiter). */
function withoutSlope(prs, filtered, tm) {
  const extra = filtered.filter((r) => r.s.slopes[50] == null && !tm.zs.off.has(r.s.status)).map((r) => [{ c: r.c, s: r.s }]);
  return [...prs, ...extra];
}

/** Klicks der Filter und des Scanners. Liefert true, wenn neu gezeichnet werden muss. */
export function trendMapClick(e, tm) {
  const min = e.target.closest('[data-tm-min]');
  if (min) { tm.min = Number(min.dataset.tmMin); tm.zs.zoom = []; return true; }
  const mkt = e.target.closest('[data-tm-mkt]');
  if (mkt) { tm.mkt = mkt.dataset.tmMkt; tm.zs.zoom = []; return true; }
  if (e.target.closest('[data-tm-size]')) { tm.size = !tm.size; return true; }
  if (e.target.closest('[data-tm-full]')) { tm.full = !tm.full; tm.zs.zoom = []; return true; }
  if (e.target.closest('[data-tm-more]')) { tm.more = !tm.more; return true; }
  const so = e.target.closest('[data-tm-sort]');
  if (so) {
    const k = so.dataset.tmSort;
    if (tm.sort === k) tm.asc = !tm.asc; else { tm.sort = k; tm.asc = k === 'sym'; }
    return true;
  }
  return false;
}

/** IDs für „In Tabelle öffnen“: Zoom-Ausschnitt, ohne Zoom inkl. Titel ohne SMA50-Steigung. */
export function trendShowIds(cands, tm) {
  const rows = trendRows(cands);
  const ids = trendVisibleIds(rows, tm);
  if (tm.zs.zoom.length) return ids;
  const extra = rows.filter((r) => passes(r, tm) && r.s.slopes[50] == null && !tm.zs.off.has(r.s.status)).map((r) => r.c.id);
  return [...new Set([...ids, ...extra])];
}
