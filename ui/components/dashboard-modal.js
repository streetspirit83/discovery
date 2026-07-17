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

import { icons } from '../lib/icons.js?v=20260717a';
import {
  pulse, scoreMovers, momMovers, pchsMovers, perfLeaders,
  macdFlips, rsiExtremes, trends, smaCrosses,
} from '../lib/dashboard-metrics.js?v=20260707a';
import { trendRadar } from '../lib/trend-radar.js?v=20260709c';

const BUCKET_LABELS = { inbox: 'Inbox', archive: 'Archiv', export: 'Export', watch: 'Watchlist' };
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

export function renderDashboardModal({ candidates = [], bucket = 'inbox', onOpenDetail } = {}) {
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
    return shown.map(rowFn).join('') + btn;
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
      <div class="dash-sig__items">${items.length
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
      <div class="modal-body dash-body">${bodyHtml()}</div>
    </div>`;
  document.body.appendChild(overlay);

  const bodyEl = overlay.querySelector('.dash-body');
  const rerender = () => { bodyEl.innerHTML = bodyHtml(); };

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
