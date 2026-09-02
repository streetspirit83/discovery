/**
 * price-viz.js — inline-SVG / HTML visualizations for the candidate detail modal.
 *
 * No historical OHLC series exists in tv_data, so these are *positioning*
 * visuals: where the current price sits relative to the many level fields TV
 * provides (52W range, ATH, SMAs, Bollinger, pivots, Donchian, timeframe ranges).
 *
 * All generators are pure and return strings. Colours come from CSS via classes.
 */

const fmt = (v) => (v == null || Number.isNaN(v) ? '—'
  : Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pctTxt = (v, dec = 1) => (v == null || Number.isNaN(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(dec)}%`);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

/* ── Score ring (header) ─────────────────────────────────────────────────── */

export function scoreRingSVG(score, labelCode) {
  const R = 20, C = 2 * Math.PI * R, sz = 52;
  if (score == null) {
    return `<div class="score-ring score-ring--empty" title="Kein Score (zu wenig TV-Daten)">
      <svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}"><circle cx="26" cy="26" r="${R}" class="score-ring__track"/></svg>
      <span class="score-ring__num">–</span></div>`;
  }
  const off = C * (1 - clamp01(score / 100));
  return `<div class="score-ring score-ring--${labelCode}" title="Overall Score ${score}/100 (${labelCode})">
    <svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}">
      <circle cx="26" cy="26" r="${R}" class="score-ring__track"/>
      <circle cx="26" cy="26" r="${R}" class="score-ring__val"
        stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
        transform="rotate(-90 26 26)"/>
    </svg>
    <span class="score-ring__num">${score}</span>
  </div>`;
}

/* ── Vertical price ladder ───────────────────────────────────────────────── */
// Scale: linear over the 52W range, with a compressed cap up to the all-time
// high so blue-sky territory stays visible without stretching the whole axis.

function spreadLabels(items, minGap, top, bottom) {
  const a = items.slice().sort((x, y) => x.y - y.y);
  for (let i = 1; i < a.length; i++) if (a[i].y < a[i - 1].y + minGap) a[i].y = a[i - 1].y + minGap;
  if (a.length && a[a.length - 1].y > bottom) {
    a[a.length - 1].y = bottom;
    for (let i = a.length - 2; i >= 0; i--) if (a[i].y > a[i + 1].y - minGap) a[i].y = a[i + 1].y - minGap;
  }
  for (const it of a) it.y = Math.max(top, Math.min(bottom, it.y));
  return a;
}

export function priceLadderSVG(tv, clusters = null) {
  const cur = tv.close_1m ?? tv.close;
  const lo52 = tv.price_52_week_low, hi52 = tv.price_52_week_high, ath = tv.high_all;
  if (cur == null || lo52 == null || hi52 == null || hi52 <= lo52) {
    return `<p class="pv-empty">Keine 52‑Wochen-Kursdaten – „TV Daten" laden.</p>`;
  }

  const W = 300, H = 264, top = 16, bottom = H - 16;
  const barX = 40, barW = 52, labelX = barX + barW + 12;
  const hasCap = ath != null && ath > hi52;
  const capH = hasCap ? (bottom - top) * 0.16 : 0;
  const mainTop = top + capH, mainSpan = hi52 - lo52;

  const yOf = (v) => {
    if (v == null) return null;
    if (v <= hi52) return bottom - clamp01((v - lo52) / mainSpan) * (bottom - mainTop);
    return hasCap ? mainTop - clamp01((v - hi52) / (ath - hi52)) * capH : mainTop;
  };

  // All level fields (drawn as colour-coded ticks; key ones get a label).
  const raw = [
    ['ATH', ath, 'anchor'], ['52W-H', hi52, 'anchor'],
    ['R2', tv.pivot_r2, 'resist'], ['R1', tv.pivot_r1, 'resist'],
    ['Donch↑', tv.donch_ch20_upper_1m, 'resist'], ['BB↑', tv.bb_upper, 'band'],
    ['SMA20', tv.sma20, 'ma'], ['SMA50', tv.sma50, 'ma'], ['SMA100', tv.sma100, 'ma'], ['SMA200', tv.sma200, 'ma'],
    ['BB↓', tv.bb_lower, 'band'], ['Donch↓', tv.donch_ch20_lower_1m, 'support'],
    ['S1', tv.pivot_s1, 'support'], ['S2', tv.pivot_s2, 'support'],
    ['52W-T', lo52, 'anchor'],
  ].filter(([, v]) => v != null);

  // Nearest support / resistance among tradable levels (exclude the anchors).
  const tradable = raw.filter(([, , t]) => t !== 'anchor');
  const resist = tradable.filter(([, v]) => v > cur).sort((a, b) => a[1] - b[1])[0];
  const support = tradable.filter(([, v]) => v < cur).sort((a, b) => b[1] - a[1])[0];
  const labelSet = new Set(['ATH', '52W-H', '52W-T', 'SMA20', 'SMA50', 'SMA200']);
  if (resist) labelSet.add(resist[0]);
  if (support) labelSet.add(support[0]);

  // Ticks across the bar for every level.
  const ticks = raw.map(([name, v, type]) => {
    const y = yOf(v);
    return `<line x1="${barX}" y1="${y.toFixed(1)}" x2="${barX + barW}" y2="${y.toFixed(1)}"
      class="pv-tick pv-tick--${type}"><title>${esc(name)}: ${fmt(v)}</title></line>`;
  }).join('');

  // Right-hand labels (collision-avoided).
  const labelItems = spreadLabels(
    raw.filter(([name]) => labelSet.has(name)).map(([name, v, type]) => ({ name, v, type, y: yOf(v), ty: yOf(v) })),
    13, top, bottom);
  const labels = labelItems.map((it) => `
    <line x1="${barX + barW}" y1="${it.ty.toFixed(1)}" x2="${labelX - 3}" y2="${it.y.toFixed(1)}" class="pv-leader"/>
    <text x="${labelX}" y="${(it.y + 3).toFixed(1)}" class="pv-lbl pv-lbl--${it.type}">${esc(it.name)} ${fmt(it.v)}</text>`).join('');

  // Bollinger band overlay (translucent) when both edges exist.
  let bbBand = '';
  if (tv.bb_upper != null && tv.bb_lower != null) {
    const yu = yOf(tv.bb_upper), yl = yOf(tv.bb_lower);
    bbBand = `<rect x="${barX}" y="${yu.toFixed(1)}" width="${barW}" height="${Math.max(1, yl - yu).toFixed(1)}" class="pv-bb"/>`;
  }

  // Price-cluster confluence zones: coloured bands (green support / red
  // resistance), opacity scales with the cluster score — the stronger the
  // zone, the more visible the band.
  let cluBands = '';
  if (Array.isArray(clusters) && clusters.length) {
    cluBands = clusters.map((cl) => {
      const y1 = yOf(cl.hi), y2 = yOf(cl.lo);
      if (y1 == null || y2 == null) return '';
      const op = Math.min(0.4, 0.12 + cl.score * 0.03).toFixed(2);
      const names = cl.members.map((m) => m.label).join(' + ');
      return `<rect x="${(barX - 6).toFixed(1)}" y="${y1.toFixed(1)}" width="${barW + 6}" height="${Math.max(3, y2 - y1).toFixed(1)}"
        class="pv-clu pv-clu--${cl.side}" style="opacity:${op}">
        <title>Cluster ${fmt(cl.lo)}–${fmt(cl.hi)} · Score ${cl.score} · ${esc(names)}</title></rect>`;
    }).join('');
  }

  // Current price marker.
  const yc = yOf(cur);
  const curMark = `
    <line x1="${barX - 6}" y1="${yc.toFixed(1)}" x2="${barX + barW}" y2="${yc.toFixed(1)}" class="pv-cur"/>
    <circle cx="${barX - 6}" cy="${yc.toFixed(1)}" r="3.5" class="pv-cur-dot"/>
    <text x="${labelX}" y="${(yc + 3).toFixed(1)}" class="pv-lbl pv-lbl--cur">● ${fmt(cur)}</text>`;

  const capRect = hasCap
    ? `<rect x="${barX}" y="${top}" width="${barW}" height="${(mainTop - top).toFixed(1)}" class="pv-cap"/>` : '';

  const pos52 = clamp01((cur - lo52) / mainSpan) * 100;
  const above = ['sma20', 'sma50', 'sma200'].map((k) => (tv[k] != null && cur >= tv[k] ? '✓' : '·')).join('');

  return `
    <svg class="pv-ladder" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img"
         aria-label="Kursposition relativ zu 52-Wochen-Spanne und Leveln">
      <rect x="${barX}" y="${mainTop.toFixed(1)}" width="${barW}" height="${(bottom - mainTop).toFixed(1)}" class="pv-bar"/>
      ${capRect}${bbBand}${cluBands}${ticks}${labels}${curMark}
    </svg>
    <p class="pv-foot">
      52W-Position <b>${pos52.toFixed(0)}%</b> · SMA20/50/200 <b>${above}</b>
      ${resist ? ` · Widerstand ${esc(resist[0])} <span class="neg">${pctTxt((resist[1] - cur) / cur * 100)}</span>` : ''}
      ${support ? ` · Stütze ${esc(support[0])} <span class="pos">${pctTxt((support[1] - cur) / cur * 100)}</span>` : ''}
    </p>`;
}

/* ── Horizontal trend-band ───────────────────────────────────────────────── */
// Same information as priceLadderSVG (52W range + ATH cap, SMAs, Bollinger,
// pivots, Donchian, confluence clusters) but laid out left→right as a compact
// bar. Levels are vertical ticks (values live in the Kurs-Daten table); the
// current price sits below.

export function priceBandHorizontalSVG(tv, clusters = null) {
  const cur = tv.close_1m ?? tv.close;
  const lo52 = tv.price_52_week_low, hi52 = tv.price_52_week_high, ath = tv.high_all;
  if (cur == null || lo52 == null || hi52 == null || hi52 <= lo52) {
    return `<p class="pv-empty">Keine 52‑Wochen-Kursdaten – „TV Daten" laden.</p>`;
  }

  // Compact band: no level labels above (all values live in the Kurs-Daten
  // table below), so the bar sits near the top and the chart stays narrow.
  const W = 320, H = 52, padL = 8, padR = 8;
  const barTop = 8, barH = 18, barBottom = barTop + barH;
  const hasCap = ath != null && ath > hi52;
  const usable = W - padL - padR;
  const capW = hasCap ? usable * 0.16 : 0;
  const mainLeft = padL, mainRight = W - padR - capW, mainSpan = hi52 - lo52;
  const lft = padL + 2, rgt = W - padR - 2;

  const xOf = (v) => {
    if (v == null) return null;
    if (v <= hi52) return mainLeft + clamp01((v - lo52) / mainSpan) * (mainRight - mainLeft);
    return hasCap ? mainRight + clamp01((v - hi52) / (ath - hi52)) * capW : mainRight;
  };

  const raw = [
    ['ATH', ath, 'anchor'], ['52W-H', hi52, 'anchor'],
    ['R2', tv.pivot_r2, 'resist'], ['R1', tv.pivot_r1, 'resist'],
    ['Donch↑', tv.donch_ch20_upper_1m, 'resist'], ['BB↑', tv.bb_upper, 'band'],
    ['SMA20', tv.sma20, 'ma'], ['SMA50', tv.sma50, 'ma'], ['SMA100', tv.sma100, 'ma'], ['SMA200', tv.sma200, 'ma'],
    ['BB↓', tv.bb_lower, 'band'], ['Donch↓', tv.donch_ch20_lower_1m, 'support'],
    ['S1', tv.pivot_s1, 'support'], ['S2', tv.pivot_s2, 'support'],
    ['52W-T', lo52, 'anchor'],
  ].filter(([, v]) => v != null);

  // Vertical ticks for every level (hover shows name + value).
  const ticks = raw.map(([name, v, type]) => {
    const x = xOf(v);
    return `<line x1="${x.toFixed(1)}" y1="${barTop}" x2="${x.toFixed(1)}" y2="${barBottom}"
      class="pv-tick pv-tick--${type}"><title>${esc(name)}: ${fmt(v)}</title></line>`;
  }).join('');

  // Bollinger band overlay.
  let bbBand = '';
  if (tv.bb_upper != null && tv.bb_lower != null) {
    const xl = xOf(tv.bb_lower), xu = xOf(tv.bb_upper);
    bbBand = `<rect x="${xl.toFixed(1)}" y="${barTop}" width="${Math.max(1, xu - xl).toFixed(1)}" height="${barH}" class="pv-bb"/>`;
  }

  // Confluence clusters (green support / red resistance), opacity by score.
  let cluBands = '';
  if (Array.isArray(clusters) && clusters.length) {
    cluBands = clusters.map((cl) => {
      const x1 = xOf(cl.lo), x2 = xOf(cl.hi);
      if (x1 == null || x2 == null) return '';
      const op = Math.min(0.4, 0.12 + cl.score * 0.03).toFixed(2);
      const names = cl.members.map((m) => m.label).join(' + ');
      return `<rect x="${x1.toFixed(1)}" y="${barTop - 3}" width="${Math.max(3, x2 - x1).toFixed(1)}" height="${barH + 6}"
        class="pv-clu pv-clu--${cl.side}" style="opacity:${op}">
        <title>Cluster ${fmt(cl.lo)}–${fmt(cl.hi)} · Score ${cl.score} · ${esc(names)}</title></rect>`;
    }).join('');
  }

  // 52W-Tief (left end) and ATH (right end) below the bar — same baseline and
  // font size as the current price, so the axis reads Tief · Kurs · ATH.
  const rightVal = ath != null ? ath : hi52;
  const rightTag = ath != null ? 'ATH' : '52W-H';
  const endLabels = `
    <text x="${padL}" y="${H - 4}" text-anchor="start" class="pv-lbl pv-lbl--anchor">52W-T ${fmt(lo52)}</text>
    <text x="${W - padR}" y="${H - 4}" text-anchor="end" class="pv-lbl pv-lbl--anchor">${rightTag} ${fmt(rightVal)}</text>`;

  // Current-price marker below the bar (line + dot only; the price value lives
  // in the panel above, so no text label here — avoids overlap with the ends).
  const xc = xOf(cur);
  const curMark = `
    <line x1="${xc.toFixed(1)}" y1="${barTop - 6}" x2="${xc.toFixed(1)}" y2="${barBottom + 6}" class="pv-cur"/>
    <circle cx="${xc.toFixed(1)}" cy="${(barBottom + 6).toFixed(1)}" r="3.5" class="pv-cur-dot"/>`;

  const capRect = hasCap
    ? `<rect x="${mainRight.toFixed(1)}" y="${barTop}" width="${capW.toFixed(1)}" height="${barH}" class="pv-cap"/>` : '';

  return `
    <svg class="pv-hband" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img"
         aria-label="Kursposition relativ zu 52-Wochen-Spanne und Leveln (horizontal)">
      <rect x="${mainLeft}" y="${barTop}" width="${(mainRight - mainLeft).toFixed(1)}" height="${barH}" class="pv-bar"/>
      ${capRect}${bbBand}${cluBands}${ticks}${endLabels}${curMark}
    </svg>`;
}

/* ── Price-levels table (expandable, replaces the trend-band legend) ──────── */
// Every level the band draws as a tick, listed with its price and Δ to the
// current Kurs. Sorted high→low; the current price is highlighted, levels above
// read as resistance (red Δ), below as support (green Δ).

export function priceLevelsTable(tv) {
  const cur = tv.close_1m ?? tv.close;
  if (cur == null) return '';
  const rows = [
    ['ATH', tv.high_all, 'anchor'], ['52W-Hoch', tv.price_52_week_high, 'anchor'],
    ['Pivot R2', tv.pivot_r2, 'resist'], ['Pivot R1', tv.pivot_r1, 'resist'],
    ['Donchian ↑', tv.donch_ch20_upper_1m, 'resist'], ['Bollinger ↑', tv.bb_upper, 'band'],
    ['SMA 20', tv.sma20, 'ma'], ['SMA 50', tv.sma50, 'ma'], ['SMA 100', tv.sma100, 'ma'], ['SMA 200', tv.sma200, 'ma'],
    ['Bollinger ↓', tv.bb_lower, 'band'], ['Donchian ↓', tv.donch_ch20_lower_1m, 'support'],
    ['Pivot S1', tv.pivot_s1, 'support'], ['Pivot S2', tv.pivot_s2, 'support'],
    ['52W-Tief', tv.price_52_week_low, 'anchor'],
  ].filter(([, v]) => v != null);
  rows.push(['Kurs', cur, 'cur']);
  rows.sort((a, b) => b[1] - a[1]);

  const body = rows.map(([name, v, type]) => {
    const isCur = type === 'cur';
    const d = !isCur && cur > 0 ? (v - cur) / cur * 100 : null;
    const dCls = d == null ? '' : d >= 0 ? 'neg' : 'pos';
    return `<tr class="pv-lvl-row${isCur ? ' pv-lvl-row--cur' : ''}">
      <td class="pv-lvl-name"><span class="pv-lvl-dot pv-lvl-dot--${type}"></span>${esc(name)}</td>
      <td class="pv-lvl-val">${fmt(v)}</td>
      <td class="pv-lvl-delta ${dCls}">${isCur ? '—' : pctTxt(d)}</td>
    </tr>`;
  }).join('');

  return `<table class="pv-levels"><thead><tr>
    <th>Level</th><th>Kurs</th><th>Δ</th>
  </tr></thead><tbody>${body}</tbody></table>`;
}

/* ── Range bands per timeframe (A) ───────────────────────────────────────── */

export function rangeBandsHTML(tv) {
  const cur = tv.close_1m ?? tv.close;
  if (cur == null) return '';
  const rows = [
    ['1M', tv.low_1m, tv.high_1m],
    ['3M', tv.low_3m, tv.high_3m],
    ['6M', tv.low_6m, tv.high_6m],
    ['52W', tv.price_52_week_low, tv.price_52_week_high],
  ].filter(([, lo, hi]) => lo != null && hi != null && hi > lo);
  if (!rows.length) return '';
  return `<div class="pv-ranges">${rows.map(([lbl, lo, hi]) => {
    const pos = clamp01((cur - lo) / (hi - lo)) * 100;
    return `<div class="pv-range" title="${lbl}: ${fmt(lo)} – ${fmt(hi)} · Position ${pos.toFixed(0)}%">
      <span class="pv-range__lbl">${lbl}</span>
      <span class="pv-range__lo">${fmt(lo)}</span>
      <span class="pv-range__track">
        <span class="pv-range__fill" style="width:${pos.toFixed(1)}%"></span>
        <span class="pv-range__dot" style="left:${pos.toFixed(1)}%"></span>
      </span>
      <span class="pv-range__hi">${fmt(hi)}</span>
      <span class="pv-range__pos">${pos.toFixed(0)}%</span>
    </div>`;
  }).join('')}</div>`;
}

/* ── Bollinger / %B gauge with ATR expected range (D) ────────────────────── */

export function bollingerGaugeHTML(tv) {
  const cur = tv.close_1m ?? tv.close;
  const lo = tv.bb_lower, hi = tv.bb_upper;
  if (cur == null || lo == null || hi == null || hi <= lo) return '';
  const pctB = (cur - lo) / (hi - lo);
  const pos = clamp01(pctB) * 100;
  const out = pctB > 1 ? ' über Band' : pctB < 0 ? ' unter Band' : '';
  const atr = tv.atr, atrp = tv.atrp;
  // ATR expected daily range as a translucent span around the current price.
  let atrSpan = '';
  if (atr != null) {
    const l = clamp01((cur - atr - lo) / (hi - lo)) * 100;
    const r = clamp01((cur + atr - lo) / (hi - lo)) * 100;
    atrSpan = `<span class="pv-bb__atr" style="left:${l.toFixed(1)}%;width:${Math.max(0, r - l).toFixed(1)}%"></span>`;
  }
  return `<div class="pv-gauge">
    <div class="pv-gauge__head">
      <span>Bollinger %B <b class="${pctB > 1 ? 'neg' : pctB < 0 ? 'pos' : ''}">${(pctB * 100).toFixed(0)}%${out}</b></span>
      ${atr != null ? `<span class="pv-muted">ATR ${fmt(atr)}${atrp != null ? ` (${atrp.toFixed(1)}%)` : ''}</span>` : ''}
    </div>
    <div class="pv-bb-track" title="Unteres Band ${fmt(lo)} · Kurs ${fmt(cur)} · Oberes Band ${fmt(hi)}">
      ${atrSpan}
      <span class="pv-bb__dot" style="left:${pos.toFixed(1)}%"></span>
    </div>
    <div class="pv-bb-scale"><span>${fmt(lo)}</span><span>Mittel</span><span>${fmt(hi)}</span></div>
  </div>`;
}

/* ── Return-per-period diverging bars ────────────────────────────────────── */

export function perfBarsHTML(tv) {
  const rows = [
    ['Δ1T', tv.change_1d], ['1W', tv.perf_w], ['1M', tv.perf_1m], ['3M', tv.perf_3m], ['6M', tv.perf_6m],
  ].filter(([, v]) => v != null);
  if (!rows.length) return '';
  const maxAbs = Math.max(1, ...rows.map(([, v]) => Math.abs(v)));
  return `<div class="pv-perf">${rows.map(([lbl, v]) => {
    const w = Math.abs(v) / maxAbs * 50;
    const pos = v >= 0;
    const style = pos ? `left:50%;width:${w.toFixed(1)}%` : `left:${(50 - w).toFixed(1)}%;width:${w.toFixed(1)}%`;
    return `<div class="pv-perf__row" title="${esc(lbl)}: ${pctTxt(v)}">
      <span class="pv-perf__lbl">${esc(lbl)}</span>
      <span class="pv-perf__track"><span class="pv-perf__zero"></span><span class="pv-perf__bar ${pos ? 'pos' : 'neg'}" style="${style}"></span></span>
      <span class="pv-perf__val ${pos ? 'pos' : 'neg'}">${pctTxt(v)}</span>
    </div>`;
  }).join('')}</div>`;
}

/* ── Colour legend for the ladder ────────────────────────────────────────── */

export function priceLadderLegend(withClusters = false) {
  const it = (cls, label) => `<span class="pv-leg__item"><span class="pv-leg__sw pv-leg__sw--${cls}"></span>${label}</span>`;
  return `<div class="pv-legend">
    ${it('cur', 'Kurs')}${it('anchor', 'ATH/52W')}${it('ma', 'SMA')}
    ${it('band', 'Bollinger')}${it('resist', 'Widerstand')}${it('support', 'Stütze')}
    ${withClusters ? it('clu-sup', 'Sup-Cluster') + it('clu-res', 'Res-Cluster') : ''}
  </div>`;
}

/* ── Section assembly ────────────────────────────────────────────────────── */

export function renderPerformanceSection(tv) {
  if (!tv) return '';
  const ladder = priceLadderSVG(tv);
  const hasLadder = !ladder.includes('pv-empty');
  const perf = perfBarsHTML(tv);
  const ranges = rangeBandsHTML(tv);
  const gauge = bollingerGaugeHTML(tv);
  if (!hasLadder && !perf && !ranges && !gauge) return '';
  return `
    <div class="detail-section">
      <h3>Performance</h3>
      <div class="pv-ladder-row">
        <div class="pv-ladder-wrap">${ladder}</div>
        ${hasLadder ? priceLadderLegend() : ''}
      </div>
      ${perf ? `<h4 class="pv-subhead">Rendite je Zeitraum</h4>${perf}` : ''}
      ${ranges ? `<h4 class="pv-subhead">Range je Zeithorizont</h4>${ranges}` : ''}
      ${gauge ? `<h4 class="pv-subhead">Bollinger / Volatilität</h4>${gauge}` : ''}
    </div>`;
}
