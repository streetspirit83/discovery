/**
 * Dashboard / Monitor modal.
 *
 * Surfaces trends & dynamics of the *active bucket* at a glance — score movers
 * vs. the last TV fetch, performance leaders (1W/1M/3M), momentum/extreme
 * signals and durable "clean" uptrends. Opened from the "Monitor" slot in the
 * bottom navigation. All metrics are computed client-side in dashboard-metrics.
 */

import { icons } from '../lib/icons.js';
import {
  pulse, scoreMovers, perfLeaders, signals, cleanTrends,
} from '../lib/dashboard-metrics.js?v=20260627a';

const BUCKET_LABELS = { inbox: 'Inbox', archive: 'Archiv', export: 'Export', watch: 'Watchlist' };

/* ── small formatters ─────────────────────────────────────────────────────── */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const fmtPct = (v, dec = 1) => (v == null || Number.isNaN(v) ? '–' : `${v >= 0 ? '+' : '−'}${Math.abs(Number(v)).toFixed(dec)}%`);
const fmtDelta = (v) => (v == null ? '' : `${v >= 0 ? '+' : '−'}${Math.abs(v)}`);
const signClass = (v) => (v == null ? '' : v >= 0 ? 'pos' : 'neg');

function timeAgo(iso) {
  if (!iso) return '–';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '–';
  const h = Math.round(diff / 3.6e6);
  if (h < 1) return 'vor <1 Std';
  if (h < 24) return `vor ${h} Std`;
  return `vor ${Math.round(h / 24)} T`;
}
function stamp(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  return Number.isNaN(d) ? '–' : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) +
    ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

const sym = (r) => `<span class="dash-sym">${esc(r.symbol)}</span><span class="dash-ex">${esc(r.exchange)}</span>`;

/* A clickable candidate row: left = symbol, right = caller-supplied value HTML. */
function row(r, valueHtml, accent = '') {
  return `<button class="dash-row${accent ? ' dash-row--' + accent : ''}" data-id="${esc(r.c.id)}">
    <span class="dash-row__sym">${sym(r)}</span>
    <span class="dash-row__val">${valueHtml}</span>
  </button>`;
}

const empty = (txt) => `<p class="dash-empty">${esc(txt)}</p>`;

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

/* ── card bodies ──────────────────────────────────────────────────────────── */

function scoreMoversBody(cands) {
  const { risers, fallers } = scoreMovers(cands, 4);
  if (!risers.length && !fallers.length) return empty('Noch keine Vergleichswerte – beim nächsten TV-Fetch verfügbar.');
  const line = (r) => row(r,
    `<span class="dash-prev">${r.prev} → ${r.overall}</span>
     <span class="dash-badge ${signClass(r.delta)}">${fmtDelta(r.delta)}</span>`,
    r.delta >= 0 ? 'up' : 'down');
  return [
    risers.map(line).join(''),
    risers.length && fallers.length ? '<div class="dash-sep"></div>' : '',
    fallers.map(line).join(''),
  ].join('');
}

function perfBody(cands, window) {
  const { gainers, losers } = perfLeaders(cands, window, 4);
  if (!gainers.length && !losers.length) return empty('Keine Performance-Daten.');
  const line = (r) => row(r, `<span class="dash-num ${signClass(r.perf)}">${fmtPct(r.perf)}</span>`, r.perf >= 0 ? 'up' : 'down');
  return [
    gainers.map(line).join(''),
    gainers.length && losers.length ? '<div class="dash-sep"></div>' : '',
    losers.map(line).join(''),
  ].join('');
}

function signalsBody(cands) {
  const { momTop, rsiOversold, rsiOverbought, blueSky } = signals(cands, 4);
  const group = (label, items, valFn, cls) => {
    if (!items.length) return '';
    return `<div class="dash-sig">
      <span class="dash-sig__label dash-sig__label--${cls}">${esc(label)}</span>
      <div class="dash-sig__items">${items.map((r) =>
        `<button class="dash-chip dash-chip--${cls}" data-id="${esc(r.c.id)}">${esc(r.symbol)} <b>${valFn(r)}</b></button>`).join('')}</div>
    </div>`;
  };
  const html = [
    group('Momentum', momTop, (r) => r.mom.total, 'mom'),
    group('Überverkauft (RSI≤30)', rsiOversold, (r) => Math.round(r.tv.rsi), 'os'),
    group('Überkauft (RSI≥70)', rsiOverbought, (r) => Math.round(r.tv.rsi), 'ob'),
    group('Blue-Sky / ATH-Nähe', blueSky, (r) => r.tv.cycle_score.total, 'sky'),
  ].join('');
  return html || empty('Keine aktiven Signale.');
}

function cleanTrendsBody(cands) {
  const items = cleanTrends(cands, 5);
  if (!items.length) return empty('Keine Werte mit durchgehend positiver 1W/1M/3M-Performance.');
  return items.map((r) => row(r,
    `<span class="dash-num pos">Ø ${r.ogrm != null ? r.ogrm.toFixed(1) + '%' : '–'}</span>
     <span class="dash-perfs">${fmtPct(r.tv.perf_w, 0)} · ${fmtPct(r.tv.perf_1m, 0)} · ${fmtPct(r.tv.perf_3m, 0)}</span>`)).join('');
}

/* ── pulse header ─────────────────────────────────────────────────────────── */

function pulseBody(cands) {
  const p = pulse(cands);
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

/* ── render ───────────────────────────────────────────────────────────────── */

export function renderDashboardModal({ candidates = [], bucket = 'inbox', onOpenDetail } = {}) {
  if (document.getElementById('dashboard-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'dashboard-modal-overlay';

  const bucketLabel = BUCKET_LABELS[bucket] ?? bucket;
  let perfWindow = '1W';

  const perfToggle = () => `<div class="dash-seg" id="dash-perf-seg">
    ${['1W', '1M', '3M'].map((w) =>
      `<button class="dash-seg__btn${w === perfWindow ? ' is-active' : ''}" data-win="${w}">${w}</button>`).join('')}
  </div>`;

  overlay.innerHTML = `
    <div class="modal dash-modal" role="dialog" aria-modal="true" aria-label="Monitor">
      <div class="modal-header">
        <h2 class="dash-title">${icons.activity}<span>Monitor · ${esc(bucketLabel)}</span></h2>
        <button class="modal-close" id="dash-close" aria-label="Schließen">✕</button>
      </div>
      <div class="modal-body dash-body">
        <div class="dash-pulse">${pulseBody(candidates)}</div>
        ${card('barChart2', 'Score-Dynamik · Δ vs. letzter Fetch', scoreMoversBody(candidates))}
        ${card('trendingUp', 'Performance', `<div id="dash-perf-body">${perfBody(candidates, perfWindow)}</div>`, perfToggle())}
        ${card('zap', 'Signale & Extreme', signalsBody(candidates))}
        ${card('sparkles', 'Saubere Trends · 1W·1M·3M positiv · ØGr/M', cleanTrendsBody(candidates))}
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.querySelector('#dash-close').addEventListener('pointerup', close);
  overlay.addEventListener('pointerup', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  // Row / chip click → open the candidate detail sheet.
  overlay.addEventListener('pointerup', (e) => {
    const hit = e.target.closest('[data-id]');
    if (!hit) return;
    const cand = candidates.find((c) => c.id === hit.dataset.id);
    if (!cand) return;
    close();
    onOpenDetail?.(cand);
  });

  // Performance window toggle → re-render just that card body.
  overlay.querySelector('#dash-perf-seg')?.addEventListener('pointerup', (e) => {
    const btn = e.target.closest('[data-win]');
    if (!btn) return;
    perfWindow = btn.dataset.win;
    overlay.querySelectorAll('#dash-perf-seg .dash-seg__btn')
      .forEach((b) => b.classList.toggle('is-active', b.dataset.win === perfWindow));
    overlay.querySelector('#dash-perf-body').innerHTML = perfBody(candidates, perfWindow);
  });
}
