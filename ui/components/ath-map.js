/**
 * ATH-Map (seit 27.11.2026), Monitor › Dynamik direkt unter der Trend Map.
 *
 * x = Abstand zum Allzeithoch in % (lib/ath-distance.js, 0 = am Hoch, links tiefer darunter, ab −80 % am Rand),
 * y = umschaltbar: Performance 3 Monate (Standard) · SMA Trend Score · RSI. Farbe = Trendstatus aus dem SMA Trend
 * Score (Legende filtert), Punktgröße = Börsenwert. Vier Bereiche um ATH −10 % und die Mittellinie von y
 * (0 % bzw. 50): Leader am Hoch · Rücksetzer am Hoch · Erholung · Abwärts. Darunter die Tabelle der Titel im
 * Ausschnitt mit „In Tabelle öffnen“. Zoom/Tippen/Legende aus components/zoom-scatter.js; Zustand `am` hält der
 * Aufrufer (`defaultAthState`), Klicks über `athMapClick`.
 */

import { zoomScatterHtml, zsVisible } from './zoom-scatter.js?v=20261126a';
import { smaTrendScore, TREND_STATUS } from '../lib/sma-trend-score.js?v=20261127b';
import { athDistPct } from '../lib/ath-distance.js?v=20261127a';
import { USD_PER } from '../lib/rankings-filter.js?v=20261126a';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const sp = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d).replace('.', ',')}`);
const X_MIN = -80, NEAR = -10;

export const ATH_Y = {
  perf3m: { label: '3M-Perf.', axis: 'Performance 3 Monate %', short: '3M', mid: 0, clamp: [-60, 120], get: (c) => c.tv_data?.perf_3m, unit: '%' },
  score:  { label: 'Trend Score', axis: 'SMA Trend Score 0–100', short: 'Score', mid: 50, clamp: [0, 100], get: (c) => smaTrendScore(c)?.score, unit: '' },
  rsi:    { label: 'RSI', axis: 'RSI (14, Tag)', short: 'RSI', mid: 50, clamp: [0, 100], get: (c) => c.tv_data?.rsi, unit: '' },
};
const GROUPS = [...Object.entries(TREND_STATUS).map(([k, g]) => ({ key: k, label: g.label, tone: g.tone })), { key: 'none', label: 'ohne Trend Score', tone: '--muted' }];

export function defaultAthState() { return { zs: { zoom: [], off: new Set() }, y: 'perf3m', size: true }; }

const sizeOf = (c) => {
  const v = Number(c.tv_data?.market_cap) * (USD_PER[String(c.currency ?? 'USD').toUpperCase()] ?? 1);
  return v > 0 ? 0.7 + 1.3 * Math.max(0, Math.min(1, (Math.log10(v) - 8.5) / 4)) : 0.7;
};

export function athPoints(cands, am) {
  const Y = ATH_Y[am.y] ?? ATH_Y.perf3m;
  const pts = [];
  for (const c of cands) {
    const d = athDistPct(c), yv = Number(Y.get(c));
    if (d == null || Y.get(c) == null || !Number.isFinite(yv)) continue;
    const st = smaTrendScore(c);
    pts.push({ id: c.id, c, d, yv, x: Math.max(X_MIN, d), y: Math.max(Y.clamp[0], Math.min(Y.clamp[1], yv)),
      group: st?.status ?? 'none', sym: c.symbol, r: am.size ? sizeOf(c) : null, score: st?.score ?? null,
      tip: `${c.symbol} · ATH ${sp(d)} % · ${Y.short} ${sp(yv, Y.unit ? 1 : 0)}${Y.unit} · Trend Score ${st ? st.score : '—'}` });
  }
  return am.size ? pts.sort((a, b) => (b.r ?? 0) - (a.r ?? 0)) : pts;
}
function domain(pts, am) {
  const Y = ATH_Y[am.y] ?? ATH_Y.perf3m;
  let lo = Y.mid - 5, hi = Y.mid + 5, xl = -20;
  for (const p of pts) { if (p.y < lo) lo = p.y; if (p.y > hi) hi = p.y; if (p.x < xl) xl = p.x; }
  const pad = (hi - lo) * 0.04 || 1;
  return { x0: Math.floor(xl - 2), x1: 2, y0: Y.unit ? Math.floor(lo - pad) : Math.max(0, Math.floor(lo - pad)), y1: Y.unit ? Math.ceil(hi + pad) : Math.min(100, Math.ceil(hi + pad)) };
}
export function athVisibleIds(cands, am) {
  const pts = athPoints(cands, am);
  return [...new Set(zsVisible(pts, domain(pts, am), am.zs).map((p) => p.id))];
}

function tableHtml(prs, am) {
  const Y = ATH_Y[am.y] ?? ATH_Y.perf3m;
  const rows = prs.map((ps) => ps[0]).sort((a, b) => b.d - a.d).slice(0, 60);
  // vierte Spalte: Trend Score – steht er schon auf der y-Achse, dann die 3M-Performance
  const alt = am.y === 'score';
  const fourth = (p) => {
    if (!alt) { const st = TREND_STATUS[p.group]; return `<span class="tm-cell tm-score" style="--tm-c:var(${st?.tone ?? '--muted'})">${p.score ?? '—'}</span>`; }
    const v = p.c.tv_data?.perf_3m;
    return `<span class="tm-cell ${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${v == null ? '—' : `${sp(v)}%`}</span>`;
  };
  return `<div class="tm-scan">
    <div class="tm-head am-head"><span class="tm-th" style="text-align:left">Titel</span><span class="tm-th">ΔATH</span><span class="tm-th">${esc(Y.short)}</span><span class="tm-th">${alt ? '3M' : 'Score'}</span></div>
    <div class="dash-group" data-group="ath.map">${rows.map((p) => {
      return `<button class="dash-row tm-row am-row" data-id="${esc(p.c.id)}">
        <span class="dash-row__sym"><span class="dash-sym">${esc(p.c.symbol)}</span><span class="dash-ex">${esc(p.c.name ?? p.c.exchange ?? '')}</span></span>
        <span class="tm-cell ${p.d >= -5 ? 'pos' : p.d <= -40 ? 'neg' : ''}">${sp(p.d)}%</span>
        <span class="tm-cell ${p.yv > Y.mid ? 'pos' : p.yv < Y.mid ? 'neg' : ''}">${sp(p.yv, Y.unit ? 1 : 0)}${Y.unit}</span>
        ${fourth(p)}</button>`;
    }).join('')}</div></div>`;
}

export function athMapHtml(cands, am) {
  const pts = athPoints(cands, am);
  if (!pts.length) return '';
  const Y = ATH_Y[am.y] ?? ATH_Y.perf3m;
  const full = domain(pts, am);
  const ctl = `<div class="md-ctl tm-ctl">
      <span class="md-ctl__label">y-Achse</span><div class="dash-seg">${Object.entries(ATH_Y).map(([k, v]) => `<button type="button" class="dash-seg__btn${k === am.y ? ' is-active' : ''}" data-am-y="${k}">${v.label}</button>`).join('')}</div>
      <button type="button" class="dash-seg__btn tm-tog${am.size ? ' is-active' : ''}" data-am-size aria-pressed="${am.size}">Größe = Börsenwert</button>
    </div>`;
  const map = zoomScatterHtml({
    key: 'ath', points: pts, full, st: am.zs, groups: GROUPS,
    zones: [
      { x0: NEAR, x1: 1e3, y0: Y.mid, y1: 1e4, tone: '--pos' },
      { x0: NEAR, x1: 1e3, y0: -1e4, y1: Y.mid, tone: '--warn' },
      { x0: -1e3, x1: NEAR, y0: Y.mid, y1: 1e4, tone: '--accent' },
      { x0: -1e3, x1: NEAR, y0: -1e4, y1: Y.mid, tone: '--neg' },
    ],
    title: 'ATH-Map', xLabel: 'Abstand zum Allzeithoch %', yLabel: Y.axis, xShort: 'ATH', yShort: Y.short,
    refs: [{ axis: 'x', v: NEAR, cls: 'zs-grid', label: String(NEAR) }, { axis: 'y', v: Y.mid }],
    quads: [
      { x: 'r', y: 't', text: 'Leader am Hoch', cls: 'sm-quad tm-quad--pos' },
      { x: 'l', y: 't', text: 'Erholung', cls: 'sm-quad' },
      { x: 'r', y: 'b', text: 'Rücksetzer am Hoch', cls: 'sm-quad' },
      { x: 'l', y: 'b', text: 'Abwärts', cls: 'sm-quad tm-quad--neg' },
    ],
    tableHtml: (prs) => tableHtml(prs, am),
    note: `Abstand = TV-Schluss gegen Allzeithoch in Instrumentwährung, unter ${X_MIN} % am Rand · Bereiche teilen bei ${NEAR} % und ${Y.short} ${Y.mid}${Y.unit} · Farbe = Trendstatus des SMA Trend Score (Legende filtert) · Punktgröße = Börsenwert`,
  });
  return `<div class="tm-wrap">${ctl}${map}</div>`;
}

export function athMapClick(e, am) {
  const y = e.target.closest('[data-am-y]');
  if (y) { am.y = y.dataset.amY; am.zs.zoom = []; return true; }
  if (e.target.closest('[data-am-size]')) { am.size = !am.size; return true; }
  return false;
}
