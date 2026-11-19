/**
 * Setup-Matrix im Monitor-Reiter „Dynamik“ (unter der Signal-Matrix), über denselben
 * Ausschnitt (aktiver Bucket + Drill-down-Pfad der Signal-Matrix).
 *
 *   1. Matrix Setup-Typ × Signal: Zeilen = die vier Setups der Trade-Spalte „Setup“
 *      (➖ Range zählt nicht), Spalten = Titel · V/Ø30d > 100 % · Brk↑ > 50 % · Rat1M > 0,6 · alle 3.
 *   2. Scatter EPS-Wachstum (x) gegen %S200 (y) mit Rand-Histogrammen, Quintil-Bändern und
 *      Brush (Rechteck ziehen = Auswahl, kurz tippen = Auswahl weg). Punktfarbe = Setup-Typ.
 *   3. Quintil-Leiste %S200 (Grenzen über den Ausschnitt), Tippen filtert.
 *
 * Alle Filter gelten zusammen (UND). Jede Ansicht zählt mit den Filtern der anderen
 * (Cross-Filter), die Trefferliste darunter mit allen. Die gewählte Zelle der Signal-Matrix
 * (Bullisch · Bärisch · Extreme) kommt als `sel.ids` (Set der Titel-IDs) dazu und filtert
 * hier mit; umgekehrt zählt die Signal-Matrix mit den Filtern dieser Ansicht
 * (`setupHits(model, { ...sel, ids: null })`, dashboard-modal.js). Reine Darstellung; Zustand
 * und Klicks hält dashboard-modal.js: `data-sm-cell` (Typ|all + Spalte), `data-sm-q`,
 * `data-sm-reset`, `data-sm-show`; den Brush meldet `bindSetupBrush`.
 */

import { icons } from '../lib/icons.js?v=20261117a';
import {
  setupMetrics, quintileEdges, quintileOf, quantile,
  SETUP_TYPES, SETUP_COLS, THRESH,
} from '../lib/setup-metrics.js?v=20261117a';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const TYPE = Object.fromEntries(SETUP_TYPES.map((t) => [t.key, t]));
const sg = (v, dec = 0) => {
  if (v == null) return '–';
  const a = Math.abs(v).toFixed(dec);
  return Number(a) === 0 ? a : `${v > 0 ? '+' : '−'}${a}`;
};
const pct = (v, dec = 0) => (v == null ? '–' : `${sg(v, dec)} %`);
const de = (v, dec) => (v == null ? '–' : v.toFixed(dec).replace('.', ','));

/* Geometrie des Scatters (viewBox-Einheiten). */
const SC = { w: 360, h: 262, l: 38, r: 300, t: 34, b: 226, mr: 352 };

/* ── Modell ───────────────────────────────────────────────────────────────── */

function niceDomain(values, pLo, pHi) {
  let lo = quantile(values, pLo), hi = quantile(values, pHi);
  if (lo == null) return [-10, 10];
  lo = Math.min(lo, 0); hi = Math.max(hi, 0);
  if (hi - lo < 1) { lo -= 5; hi += 5; }
  const pad = (hi - lo) * 0.06;
  return [lo - pad, hi + pad];
}

/** Rechnet alles für einen Ausschnitt (einmal je Pfad, dashboard-modal cacht). */
export function buildSetupModel(cands) {
  const metrics = setupMetrics(cands);
  const edges = quintileEdges(metrics);
  const plotted = metrics.filter((m) => m.eps != null && m.s200 != null);
  const xd = niceDomain(plotted.map((m) => m.eps), 0.05, 0.95);
  const yd = niceDomain(plotted.map((m) => m.s200), 0.02, 0.98);
  const clamp = (v, [a, b]) => Math.max(a, Math.min(b, v));
  for (const m of metrics) {
    m.q = quintileOf(m.s200, edges);
    m.x = m.eps == null ? null : clamp(m.eps, xd);
    m.y = m.s200 == null ? null : clamp(m.s200, yd);
  }
  return { metrics, edges, xd, yd,
    cover: { brk: metrics.filter((m) => m.brk != null).length, vol: metrics.filter((m) => m.vol != null).length,
      plot: plotted.length } };
}

/* ── Filter ───────────────────────────────────────────────────────────────── */

const COL = Object.fromEntries(SETUP_COLS.map((c) => [c.key, c]));
const passCell = (m, cell) => !cell || ((cell.type === 'all' || m.setup === cell.type) && COL[cell.col].test(m));
const passQ = (m, q) => q == null || m.q === q;
const passBrush = (m, b) => !b || (m.x != null && m.y != null && m.x >= b.x0 && m.x <= b.x1 && m.y >= b.y0 && m.y <= b.y1);
const passIds = (m, ids) => !ids || ids.has(m.c.id);

/** Titel, die alle aktiven Filter erfüllen (inkl. Auswahl aus der Signal-Matrix, `sel.ids`). */
export function setupHits(model, sel) {
  return model.metrics.filter((m) => passCell(m, sel.cell) && passQ(m, sel.q) && passBrush(m, sel.brush) && passIds(m, sel.ids));
}
export const hasSetupFilter = (sel) => !!(sel.cell || sel.q != null || sel.brush || sel.ids);

/* ── Teile ────────────────────────────────────────────────────────────────── */

function cellStyle(n, max, tone) {
  if (!n) return '';
  const p = Math.round(10 + (n / Math.max(max, 1)) * 45);
  return `background:color-mix(in srgb, var(${tone}) ${p}%, var(--surface-2))`;
}

function matrixHtml(model, sel) {
  const base = model.metrics.filter((m) => passQ(m, sel.q) && passBrush(m, sel.brush) && passIds(m, sel.ids));
  const rows = [...SETUP_TYPES.map((t) => ({ key: t.key, label: t.label, icon: icons[t.icon], tone: t.tone,
    items: base.filter((m) => m.setup === t.key) })),
  { key: 'all', label: 'Alle Titel', icon: '', tone: '--muted', items: base }];
  const counts = rows.map((r) => SETUP_COLS.map((c) => r.items.filter(c.test).length));
  const max = Math.max(1, ...counts.slice(0, -1).flatMap((r) => r.slice(1)));
  const head = SETUP_COLS.map((c) => `<span class="sx-head" title="${esc(c.title)}">${esc(c.label).replace('\n', '<br>')}</span>`).join('');
  const body = rows.map((r, ri) => {
    const label = `<span class="sx-row${r.key === 'all' ? ' sx-row--total' : ''}" title="${esc(r.label)} · ${r.items.length} Titel">
      <span class="sx-row__name sm-type">${r.icon ? `<span class="sm-ico" style="color:var(${r.tone})">${r.icon}</span>` : ''}${esc(r.label)}</span></span>`;
    return label + SETUP_COLS.map((c, ci) => {
      const n = counts[ri][ci];
      const on = sel.cell && sel.cell.type === r.key && sel.cell.col === c.key;
      const style = c.key === 'n' ? '' : cellStyle(n, r.key === 'all' ? Math.max(max, n) : max, r.key === 'all' ? '--accent' : r.tone);
      return `<button type="button" class="sx-cell${on ? ' is-sel' : ''}${c.key === 'n' ? ' sm-cell--n' : ''}" data-sm-cell="${r.key}|${c.key}"
        style="${style}" title="${esc(`${r.label} · ${c.title}: ${n}`)}" aria-label="${esc(`${r.label}, ${c.title}: ${n} Titel`)}"${n ? '' : ' disabled'}>${n || '·'}</button>`;
    }).join('');
  }).join('');
  return `<div class="sx-wrap"><div class="sx sm-matrix" style="--sx-cols:${SETUP_COLS.length}" role="group" aria-label="Setup-Matrix">
    <span class="sx-corner sx-corner--title">Setup</span>${head}${body}</div></div>`;
}

function bins(values, [lo, hi], n) {
  const out = new Array(n).fill(0), w = (hi - lo) / n;
  for (const v of values) if (v != null) out[Math.min(n - 1, Math.max(0, Math.floor((v - lo) / w)))]++;
  return out;
}
function ticks([lo, hi], n = 5) {
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function scatterHtml(model, sel) {
  const { xd, yd, edges } = model;
  const X = (v) => SC.l + ((v - xd[0]) / (xd[1] - xd[0])) * (SC.r - SC.l);
  const Y = (v) => SC.b - ((v - yd[0]) / (yd[1] - yd[0])) * (SC.b - SC.t);
  const pts = model.metrics.filter((m) => m.x != null && m.y != null);
  if (pts.length < 3) return '<p class="dash-empty">Zu wenige Titel mit EPS-Wachstum und SMA200.</p>';
  const parts = [];
  // Quintil-Bänder (y = %S200), abwechselnd getönt; das gewählte hervorgehoben.
  if (edges) for (let i = 0; i < 5; i++) {
    const a = Math.max(yd[0], edges[i]), b = Math.min(yd[1], edges[i + 1]);
    if (b <= a) continue;
    const on = sel.q === i;
    parts.push(`<rect x="${SC.l}" y="${Y(b)}" width="${SC.r - SC.l}" height="${Y(a) - Y(b)}" class="sm-band${on ? ' is-on' : i % 2 ? ' is-alt' : ''}"/>`,
      `<text x="${SC.l + 3}" y="${Y(b) + 10}" class="sm-band__lbl">Q${i + 1}</text>`);
  }
  // Achsen + Nulllinien.
  for (const t of ticks(xd)) parts.push(`<line x1="${X(t)}" x2="${X(t)}" y1="${SC.b}" y2="${SC.b + 4}" class="sm-axis"/><text x="${X(t)}" y="${SC.b + 15}" text-anchor="middle" class="sm-tick">${t}</text>`);
  for (const t of ticks(yd, 4)) parts.push(`<line x1="${SC.l - 4}" x2="${SC.l}" y1="${Y(t)}" y2="${Y(t)}" class="sm-axis"/><text x="${SC.l - 6}" y="${Y(t) + 3.5}" text-anchor="end" class="sm-tick">${t}</text>`);
  parts.push(`<rect x="${SC.l}" y="${SC.t}" width="${SC.r - SC.l}" height="${SC.b - SC.t}" class="sm-frame"/>`);
  if (xd[0] < 0 && xd[1] > 0) parts.push(`<line x1="${X(0)}" x2="${X(0)}" y1="${SC.t}" y2="${SC.b}" class="sm-zero"/>`);
  if (yd[0] < 0 && yd[1] > 0) parts.push(`<line x1="${SC.l}" x2="${SC.r}" y1="${Y(0)}" y2="${Y(0)}" class="sm-zero"/>`);
  parts.push(`<text x="${(SC.l + SC.r) / 2}" y="${SC.h - 4}" text-anchor="middle" class="sm-axlbl">EPS-Wachstum YoY %</text>`,
    `<text x="10" y="${(SC.t + SC.b) / 2}" text-anchor="middle" class="sm-axlbl" transform="rotate(-90 10 ${(SC.t + SC.b) / 2})">%S200</text>`,
    `<text x="${SC.r - 3}" y="${SC.t + 11}" text-anchor="end" class="sm-quad">Wachstum + Trend</text>`);
  // Rand-Histogramme: oben EPS, rechts %S200.
  const hx = bins(pts.map((m) => m.x), xd, 24), hy = bins(pts.map((m) => m.y), yd, 20);
  const mx = Math.max(...hx), my = Math.max(...hy), bw = (SC.r - SC.l) / 24, bh = (SC.b - SC.t) / 20;
  hx.forEach((n, i) => n && parts.push(`<rect x="${SC.l + i * bw + 0.5}" y="${SC.t - 4 - (n / mx) * 24}" width="${bw - 1}" height="${(n / mx) * 24}" class="sm-hist"/>`));
  hy.forEach((n, i) => n && parts.push(`<rect x="${SC.r + 4}" y="${SC.b - (i + 1) * bh + 0.5}" width="${(n / my) * (SC.mr - SC.r - 6)}" height="${bh - 1}" class="sm-hist"/>`));
  // Punkte: erst die abgeblendeten, dann die Treffer obenauf.
  const lit = (m) => passCell(m, sel.cell) && passQ(m, sel.q) && passIds(m, sel.ids);
  const anyF = !!(sel.cell || sel.q != null || sel.ids);
  const dot = (m, on) => {
    const t = TYPE[m.setup];
    const r = t ? 3.6 : 2.4;
    const fill = on ? (t ? `var(${t.tone})` : 'var(--muted)') : 'var(--border)';
    const tip = `${m.c.symbol} · ${t ? t.label : 'kein Setup'} · EPS ${pct(m.eps)} · %S200 ${pct(m.s200, 1)}`;
    return `<circle cx="${X(m.x).toFixed(1)}" cy="${Y(m.y).toFixed(1)}" r="${r}" style="fill:${fill}" class="sm-dot${on && t ? ' is-setup' : ''}"><title>${esc(tip)}</title></circle>`;
  };
  const off = pts.filter((m) => anyF && !lit(m)), on = pts.filter((m) => !anyF || lit(m));
  parts.push(off.map((m) => dot(m, false)).join(''), on.filter((m) => !m.setup).map((m) => dot(m, true)).join(''),
    on.filter((m) => m.setup).map((m) => dot(m, true)).join(''));
  const b = sel.brush;
  const br = b ? `x="${X(b.x0)}" y="${Y(b.y1)}" width="${X(b.x1) - X(b.x0)}" height="${Y(b.y0) - Y(b.y1)}"` : 'x="0" y="0" width="0" height="0"';
  parts.push(`<rect ${br} class="sm-brush" data-sm-brushrect/>`);
  return `<svg class="sm-scatter" viewBox="0 0 ${SC.w} ${SC.h}" data-sm-plot role="img"
    aria-label="Scatter EPS-Wachstum gegen Abstand zur SMA200, Rechteck ziehen wählt aus"
    data-xd="${xd.join(',')}" data-yd="${yd.join(',')}">${parts.join('')}</svg>`;
}

function quintileHtml(model, sel) {
  const { edges } = model;
  if (!edges) return '';
  const tot = [0, 0, 0, 0, 0], hit = [0, 0, 0, 0, 0];
  for (const m of model.metrics) if (m.q != null) {
    tot[m.q]++;
    if (passCell(m, sel.cell) && passBrush(m, sel.brush) && passIds(m, sel.ids)) hit[m.q]++;
  }
  const max = Math.max(...tot, 1);
  return `<div class="sm-qrow" role="group" aria-label="%S200-Quintile">${tot.map((n, i) => `
    <button type="button" class="sm-q${sel.q === i ? ' is-sel' : ''}" data-sm-q="${i}" title="Q${i + 1}: %S200 ${pct(edges[i], 1)} bis ${pct(edges[i + 1], 1)} · ${hit[i]} von ${n}">
      <span class="sm-q__bar"><span class="sm-q__tot" style="height:${(n / max) * 100}%"></span><span class="sm-q__hit" style="height:${(hit[i] / max) * 100}%"></span></span>
      <span class="sm-q__lbl">Q${i + 1}</span>
      <span class="sm-q__rng">${sg(edges[i])}…${sg(edges[i + 1])}%</span>
      <span class="sm-q__n">${hit[i]}<small>/${n}</small></span>
    </button>`).join('')}</div>`;
}

function hitRow(m) {
  const t = TYPE[m.setup];
  const val = [`V ${m.vol == null ? '–' : Math.round(m.vol) + ' %'}`, `Brk ${m.brk == null ? '–' : Math.round(m.brk) + ' %'}`,
    `Rat ${de(m.rat, 2)}`, `S200 ${pct(m.s200, 1)}`, `EPS ${pct(m.eps)}`].join(' · ');
  return `<button class="dash-row" data-id="${esc(m.c.id)}">
    <span class="dash-row__sym">${t ? `<span class="sm-ico" style="color:var(${t.tone})" title="${esc(t.label)}">${icons[t.icon]}</span>` : ''}<span class="dash-sym">${esc(m.c.symbol)}</span>
      <span class="dash-ex">${esc(m.c.name ?? m.c.exchange ?? '')}</span>${m.earn ? '<span class="sm-earn" title="Earnings im 1M-Fenster">E</span>' : ''}</span>
    <span class="dash-row__val"><span class="dash-num sm-vals">${esc(val)}</span></span></button>`;
}

function filterLabel(model, sel) {
  const out = [];
  if (sel.ids) out.push(`Signal: ${sel.idsLabel ?? 'Auswahl'}`);
  if (sel.cell) {
    const t = sel.cell.type === 'all' ? 'Alle Titel' : TYPE[sel.cell.type]?.label;
    out.push(sel.cell.col === 'n' ? t : `${t} + ${COL[sel.cell.col].title.split(' (')[0]}`);
  }
  if (sel.q != null) out.push(`%S200 Q${sel.q + 1}`);
  if (sel.brush) out.push(`EPS ${pct(sel.brush.x0)}…${pct(sel.brush.x1)}, %S200 ${pct(sel.brush.y0)}…${pct(sel.brush.y1)}`);
  return out.join(' · ');
}

/**
 * @param {object} model    aus buildSetupModel()
 * @param {{cell:{type,col}|null, q:number|null, brush:{x0,x1,y0,y1}|null, ids?:Set<string>|null, idsLabel?:string}} sel
 */
export function setupMatrixHtml(model, sel) {
  if (!model.metrics.length) return '';
  const hits = setupHits(model, sel);
  const active = hasSetupFilter(sel);
  const list = active
    ? (hits.length ? `<div class="dash-group" data-group="setup.hits">${hits
      .sort((a, b) => (b.rat ?? -9) - (a.rat ?? -9)).map(hitRow).join('')}</div>` : '<p class="dash-empty">Kein Titel erfüllt alle Filter.</p>')
    : '<p class="md-note">Signal- oder Setup-Zelle, Quintil oder Rechteck im Scatter wählen; die Filter gelten zusammen.</p>';
  return `<section class="sm" aria-label="Setups">
    <div class="sm-head"><h3 class="sm-title">Setups</h3>
      <span class="md-note">Schwellen fest: V/Ø30d &gt; ${THRESH.vol} % · Brk↑ &gt; ${THRESH.brk} % · Rat1M &gt; ${de(THRESH.rat, 1)} · Brk↑ für ${model.cover.brk}, V/Ø30d für ${model.cover.vol} von ${model.metrics.length} (LS-Historie)</span></div>
    ${matrixHtml(model, sel)}
    <div class="sm-card"><div class="sm-card__head">EPS-Wachstum vs. %S200 <small>${model.cover.plot} Titel · ziehen = Auswahl${sel.ids ? ' · Signal-Auswahl hervorgehoben' : ''}</small></div>
      ${scatterHtml(model, sel)}${quintileHtml(model, sel)}</div>
    <div class="sx-detail sm-hits">
      <div class="sx-detail__head"><span><b>${active ? hits.length : model.metrics.length}</b> ${active ? 'Treffer' : 'Titel'}${active ? ` · ${esc(filterLabel(model, sel))}` : ''}</span>
        <span class="sm-acts">${active ? '<button type="button" class="btn btn-sm btn-secondary" data-sm-reset>Zurücksetzen</button>' : ''}
        ${active && hits.length ? '<button type="button" class="btn btn-sm btn-primary" data-sm-show>In Tabelle öffnen</button>' : ''}</span></div>
      ${list}
    </div>
  </section>`;
}

/**
 * Brush im Scatter: Rechteck ziehen wählt aus, kurzes Tippen hebt die Auswahl auf.
 * Einmal am Modal-Body binden (Delegation, übersteht Neuzeichnungen).
 * `onBrush({x0,x1,y0,y1} | null)` bekommt die Grenzen in Datenwerten (EPS %, %S200).
 */
export function bindSetupBrush(root, onBrush) {
  let drag = null;
  const local = (svg, e) => {
    const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    return { x: Math.max(SC.l, Math.min(SC.r, q.x)), y: Math.max(SC.t, Math.min(SC.b, q.y)) };
  };
  const draw = () => {
    const { rect, a, b } = drag;
    rect.setAttribute('x', Math.min(a.x, b.x)); rect.setAttribute('y', Math.min(a.y, b.y));
    rect.setAttribute('width', Math.abs(a.x - b.x)); rect.setAttribute('height', Math.abs(a.y - b.y));
  };
  root.addEventListener('pointerdown', (e) => {
    const svg = e.target.closest?.('[data-sm-plot]');
    if (!svg || e.button > 0) return;
    const a = local(svg, e);
    drag = { svg, rect: svg.querySelector('[data-sm-brushrect]'), a, b: a, id: e.pointerId };
    svg.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.b = local(drag.svg, e);
    draw();
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { svg, a, b } = drag;
    drag = null;
    svg.releasePointerCapture?.(e.pointerId);
    if (e.type === 'pointercancel') return;
    if (Math.abs(a.x - b.x) < 6 || Math.abs(a.y - b.y) < 6) { onBrush(null); return; }
    const xd = svg.dataset.xd.split(',').map(Number), yd = svg.dataset.yd.split(',').map(Number);
    const ix = (px) => xd[0] + ((px - SC.l) / (SC.r - SC.l)) * (xd[1] - xd[0]);
    const iy = (py) => yd[0] + ((SC.b - py) / (SC.b - SC.t)) * (yd[1] - yd[0]);
    onBrush({ x0: ix(Math.min(a.x, b.x)), x1: ix(Math.max(a.x, b.x)), y0: iy(Math.max(a.y, b.y)), y1: iy(Math.min(a.y, b.y)) });
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
}
