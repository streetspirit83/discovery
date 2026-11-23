/**
 * Zoom-Scatter mit Tabellenauswahl (seit 23.11.2026), gemeinsam für
 *   · Monitor › Rankings: Ranking-Matrix RSI (x) gegen Ranking-Score 0–100 (y), Farbe = Ranking-Dimension
 *   · Briefing › Scout › Heute: Analysten-Mapping %S200 (x) gegen +% Kursziel (y), Farbe = Art der Meldung
 *
 * Bedienung: Rechteck ziehen = hineinzoomen (mehrfach möglich), Lupe-minus = eine Stufe zurück,
 * „Gesamt“ = ganz heraus. Kurz auf einen Punkt tippen öffnet den Titel. Die Legende schaltet die
 * Farbgruppen ein und aus. Unter dem Plot steht die Tabelle der Titel im Ausschnitt (sichtbare
 * Gruppen, im aktuellen Zoom) mit „In Tabelle öffnen“.
 *
 * Reine Darstellung, kein eigener Zustand. Den Zustand ({ zoom:[box…], off:Set }) hält der Aufrufer;
 * Klicks: `data-zs-out` / `data-zs-reset` / `data-zs-leg` / `data-zs-show` tragen den Plot-Schlüssel,
 * Zoom und Tippen meldet `bindZoomScatter`.
 *
 * Punkt: { id, x, y, group, sym, tip, open? } · `open` = Kennung, die der Aufrufer beim Tippen
 * bekommt (Standard `id`). Ein Titel darf mehrfach vorkommen (z. B. in mehreren Dimensionen);
 * die Tabelle fasst je `id` zusammen.
 */

import { icons } from '../lib/icons.js?v=20261123a';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
export const ZS = { w: 360, h: 248, l: 38, r: 352, t: 10, b: 218 };
const LABEL_MAX = 36;            // so wenige Punkte im Ausschnitt → Symbole stehen am Punkt

function ticks([lo, hi], n = 5) {
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Aktueller Ausschnitt: letzter Zoom oder die volle Achse. */
export const domainOf = (full, zoom) => (zoom?.length ? zoom[zoom.length - 1] : full);
const inBox = (p, d) => p.x >= d.x0 && p.x <= d.x1 && p.y >= d.y0 && p.y <= d.y1;

/** Punkte im aktuellen Ausschnitt mit eingeschalteter Gruppe. */
export function zsVisible(points, full, st) {
  const d = domainOf(full, st.zoom);
  return points.filter((p) => p.x != null && p.y != null && !st.off.has(p.group) && inBox(p, d));
}

/**
 * @param {object} o
 * @param {string} o.key        Plot-Schlüssel (mehrere Plots je Modal möglich)
 * @param {Array}  o.points
 * @param {{x0,x1,y0,y1}} o.full  volle Achsen
 * @param {{zoom:Array, off:Set}} o.st
 * @param {Array<{key,label,tone}>} o.groups   Farbgruppen (tone = CSS-Variable)
 * @param {string} o.title, o.xLabel, o.yLabel
 * @param {Array<{axis:'x'|'y', v:number, cls?:string, label?:string}>} [o.refs]  Hilfslinien
 * @param {Array<{x:'l'|'r', y:'t'|'b', text:string, cls?:string}>} [o.quads]      Ecktexte
 * @param {(rows)=>string} o.tableHtml  Tabelle der Titel im Ausschnitt (eine Zeile je id)
 * @param {string} [o.note]
 */
export function zoomScatterHtml(o) {
  const { key, points, full, st, groups } = o;
  const d = domainOf(full, st.zoom);
  const X = (v) => ZS.l + ((v - d.x0) / (d.x1 - d.x0)) * (ZS.r - ZS.l);
  const Y = (v) => ZS.b - ((v - d.y0) / (d.y1 - d.y0)) * (ZS.b - ZS.t);
  const tone = Object.fromEntries(groups.map((g) => [g.key, g.tone]));
  const all = points.filter((p) => p.x != null && p.y != null);
  const vis = zsVisible(points, full, st);
  const parts = [];
  for (const t of ticks([d.x0, d.x1])) parts.push(`<line x1="${X(t)}" x2="${X(t)}" y1="${ZS.t}" y2="${ZS.b}" class="zs-grid"/><text x="${X(t)}" y="${ZS.b + 13}" text-anchor="middle" class="sm-tick">${t}</text>`);
  for (const t of ticks([d.y0, d.y1], 4)) parts.push(`<line x1="${ZS.l}" x2="${ZS.r}" y1="${Y(t)}" y2="${Y(t)}" class="zs-grid"/><text x="${ZS.l - 5}" y="${Y(t) + 3.5}" text-anchor="end" class="sm-tick">${t}</text>`);
  for (const r of o.refs ?? []) {
    if (r.axis === 'x' && r.v > d.x0 && r.v < d.x1) parts.push(`<line x1="${X(r.v)}" x2="${X(r.v)}" y1="${ZS.t}" y2="${ZS.b}" class="${r.cls ?? 'sm-zero'}"/>${r.label ? `<text x="${X(r.v) + 3}" y="${ZS.b - 4}" class="zs-ref">${esc(r.label)}</text>` : ''}`);
    if (r.axis === 'y' && r.v > d.y0 && r.v < d.y1) parts.push(`<line x1="${ZS.l}" x2="${ZS.r}" y1="${Y(r.v)}" y2="${Y(r.v)}" class="${r.cls ?? 'sm-zero'}"/>${r.label ? `<text x="${ZS.r - 3}" y="${Y(r.v) - 3}" text-anchor="end" class="zs-ref">${esc(r.label)}</text>` : ''}`);
  }
  if (!st.zoom?.length) for (const q of o.quads ?? []) {
    const x = q.x === 'l' ? ZS.l + 4 : ZS.r - 4, y = q.y === 't' ? ZS.t + 11 : ZS.b - 5;
    parts.push(`<text x="${x}" y="${y}" text-anchor="${q.x === 'l' ? 'start' : 'end'}" class="${q.cls ?? 'sm-quad'}">${esc(q.text)}</text>`);
  }
  parts.push(`<rect x="${ZS.l}" y="${ZS.t}" width="${ZS.r - ZS.l}" height="${ZS.b - ZS.t}" class="sm-frame"/>`);
  parts.push(`<text x="${(ZS.l + ZS.r) / 2}" y="${ZS.h - 3}" text-anchor="middle" class="sm-axlbl">${esc(o.xLabel)}</text>`,
    `<text x="10" y="${(ZS.t + ZS.b) / 2}" text-anchor="middle" class="sm-axlbl" transform="rotate(-90 10 ${(ZS.t + ZS.b) / 2})">${esc(o.yLabel)}</text>`);
  // Punkte: im Zoom grösser; wenige Punkte bekommen ihr Symbol daneben.
  const r = st.zoom?.length ? 4.6 : 3.6;
  const label = vis.length <= LABEL_MAX;
  parts.push(`<g clip-path="url(#zs-clip-${esc(key)})">${vis.map((p) => {
    const cx = X(p.x).toFixed(1), cy = Y(p.y).toFixed(1);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" class="zs-dot" style="fill:var(${tone[p.group] ?? '--muted'})" data-zs-id="${esc(p.open ?? p.id)}"><title>${esc(p.tip)}</title></circle>${label ? `<text x="${(+cx + r + 2).toFixed(1)}" y="${(+cy + 3).toFixed(1)}" class="zs-lbl">${esc(p.sym)}</text>` : ''}`;
  }).join('')}</g>`);
  parts.push('<rect x="0" y="0" width="0" height="0" class="sm-brush" data-zs-brushrect/>');
  const svg = `<svg class="sm-scatter zs-plot" viewBox="0 0 ${ZS.w} ${ZS.h}" data-zs-plot="${esc(key)}" role="img"
      aria-label="${esc(`${o.title}: Rechteck ziehen zoomt hinein, Punkt antippen öffnet den Titel`)}"
      data-d="${[d.x0, d.x1, d.y0, d.y1].join(',')}">
      <defs><clipPath id="zs-clip-${esc(key)}"><rect x="${ZS.l - 6}" y="${ZS.t - 6}" width="${ZS.r - ZS.l + 40}" height="${ZS.b - ZS.t + 12}"/></clipPath></defs>
      ${parts.join('')}</svg>`;
  const cnt = (g) => all.filter((p) => p.group === g.key).length;
  const legend = groups.map((g) => {
    const on = !st.off.has(g.key), n = cnt(g);
    return `<button type="button" class="zs-leg${on ? '' : ' is-off'}" data-zs-leg="${esc(key)}|${esc(g.key)}" aria-pressed="${on}"
      title="${esc(`${g.label}: ${n} ${on ? '· tippen blendet aus' : '· tippen blendet ein'}`)}"${n ? '' : ' disabled'}>
      <span class="zs-leg__dot" style="background:var(${g.tone})"></span>${esc(g.label)}<small>${n}</small></button>`;
  }).join('');
  const zoomed = !!st.zoom?.length;
  const tools = `<span class="zs-tools">
      <button type="button" class="icon-btn zs-tool" data-zs-out="${esc(key)}" title="Eine Stufe herauszoomen" aria-label="Eine Stufe herauszoomen"${zoomed ? '' : ' disabled'}>${icons.zoomOut}</button>
      <button type="button" class="btn btn-sm btn-secondary" data-zs-reset="${esc(key)}"${zoomed ? '' : ' disabled'}>Gesamt</button></span>`;
  // Tabelle: je Titel eine Zeile (Gruppen eines Titels zusammengefasst).
  const byId = new Map();
  for (const p of vis) { if (!byId.has(p.id)) byId.set(p.id, []); byId.get(p.id).push(p); }
  const rows = [...byId.values()];
  const head = `<div class="zs-tab__head"><span><b>${rows.length}</b> ${zoomed ? 'Titel im Ausschnitt' : 'Titel'}${zoomed ? ` · ${esc(o.xShort ?? o.xLabel)} ${fmtR(d.x0)}…${fmtR(d.x1)} · ${esc(o.yShort ?? o.yLabel)} ${fmtR(d.y0)}…${fmtR(d.y1)}` : ''}</span>
      ${rows.length ? `<button type="button" class="btn btn-sm btn-primary" data-zs-show="${esc(key)}">In Tabelle öffnen</button>` : ''}</div>`;
  const table = rows.length ? o.tableHtml(rows) : '<p class="dash-empty">Kein Titel im Ausschnitt.</p>';
  return `<section class="sm-card zs" data-zs="${esc(key)}" aria-label="${esc(o.title)}">
    <div class="zs-head"><span class="sm-card__head">${esc(o.title)} <small>${all.length} Punkte · ziehen = Zoom${zoomed ? ` · Stufe ${st.zoom.length}` : ''}</small></span>${tools}</div>
    <div class="zs-legend" role="group" aria-label="Farbgruppen">${legend}</div>
    <div class="zs-body"><div class="zs-plotcol">
      ${all.length >= 2 ? svg : '<p class="dash-empty">Zu wenige Titel mit Daten für die Grafik.</p>'}
      ${o.note ? `<p class="md-note">${esc(o.note)}</p>` : ''}</div>
    <div class="zs-tab">${head}${table}</div></div>
  </section>`;
}
const fmtR = (v) => { const a = Math.abs(v); return (a >= 100 ? Math.round(v) : Math.round(v * 10) / 10).toString().replace('.', ','); };

/**
 * Zustand eines Plots anpassen. Liefert true, wenn sich etwas geändert hat (→ neu zeichnen).
 * Für `data-zs-out`, `data-zs-reset`, `data-zs-leg` (Klick-Delegation des Aufrufers).
 */
export function zsClick(e, states) {
  const out = e.target.closest('[data-zs-out]');
  if (out) { const st = states[out.dataset.zsOut]; if (st?.zoom.length) { st.zoom.pop(); return true; } return false; }
  const reset = e.target.closest('[data-zs-reset]');
  if (reset) { const st = states[reset.dataset.zsReset]; if (st?.zoom.length) { st.zoom = []; return true; } return false; }
  const leg = e.target.closest('[data-zs-leg]');
  if (leg) {
    const [k, g] = leg.dataset.zsLeg.split('|');
    const st = states[k];
    if (!st) return false;
    if (st.off.has(g)) st.off.delete(g); else st.off.add(g);
    return true;
  }
  return false;
}

/**
 * Zoom per Rechteck und Tippen auf einen Punkt. Einmal am Container binden (Delegation).
 * `onZoom(key, {x0,x1,y0,y1})` in Datenwerten, `onTap(key, openId)` für einen Punkt.
 */
export function bindZoomScatter(root, { onZoom, onTap }) {
  let drag = null;
  const local = (svg, e) => {
    const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    return { x: Math.max(ZS.l, Math.min(ZS.r, q.x)), y: Math.max(ZS.t, Math.min(ZS.b, q.y)) };
  };
  root.addEventListener('pointerdown', (e) => {
    const svg = e.target.closest?.('[data-zs-plot]');
    if (!svg || e.button > 0) return;
    const a = local(svg, e);
    drag = { svg, rect: svg.querySelector('[data-zs-brushrect]'), a, b: a, id: e.pointerId, cx: e.clientX, cy: e.clientY };
    svg.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.b = local(drag.svg, e);
    const { rect, a, b } = drag;
    rect.setAttribute('x', Math.min(a.x, b.x)); rect.setAttribute('y', Math.min(a.y, b.y));
    rect.setAttribute('width', Math.abs(a.x - b.x)); rect.setAttribute('height', Math.abs(a.y - b.y));
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { svg, a, b, cx, cy } = drag;
    drag = null;
    svg.releasePointerCapture?.(e.pointerId);
    if (e.type === 'pointercancel') return;
    const key = svg.dataset.zsPlot;
    if (Math.abs(a.x - b.x) < 8 || Math.abs(a.y - b.y) < 8) {
      // Tippen: nächster Punkt im Fangbereich (Finger treffen 4-px-Punkte selten genau).
      let best = null, bestD = 14 ** 2;
      for (const c of svg.querySelectorAll('[data-zs-id]')) {
        const r = c.getBoundingClientRect();
        const dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy, dd = dx * dx + dy * dy;
        if (dd < bestD) { bestD = dd; best = c; }
      }
      if (best) onTap?.(key, best.dataset.zsId);
      return;
    }
    e.stopPropagation();
    const [x0, x1, y0, y1] = svg.dataset.d.split(',').map(Number);
    const ix = (px) => x0 + ((px - ZS.l) / (ZS.r - ZS.l)) * (x1 - x0);
    const iy = (py) => y0 + ((ZS.b - py) / (ZS.b - ZS.t)) * (y1 - y0);
    onZoom?.(key, { x0: ix(Math.min(a.x, b.x)), x1: ix(Math.max(a.x, b.x)), y0: iy(Math.max(a.y, b.y)), y1: iy(Math.min(a.y, b.y)) });
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
}
