/**
 * Vergleichs-Modal – mehrere selektierte Kandidaten direkt gegenüberstellen.
 *
 * Geöffnet über die Bulk-Leiste (Waage-Icon) ab 2 Auswahl-Tickern. Vier Tabs:
 *   Matrix        – Kennzahlen-Tabelle, Zellfarbe = Rang innerhalb der Auswahl
 *   Chance/Risiko – Scatter ATRP (Risiko) × Upside (Chance), Bubble = MCap
 *   Performance   – gruppierte Balken je Zeitfenster (Δ1W … 6M)
 *   10T-Verlauf   – auf 100 indexierte Linien aus LS-Historie bzw. TD-Kerzen
 *
 * Währungs-Disziplin: verglichen wird ausschließlich über %-Werte, Ratios und
 * Scores. Die sind währungsneutral – absolute Kurse wären es nicht, weil eine
 * Auswahl USD/EUR/native Werte mischt und nur USD↔EUR umrechenbar ist. Der
 * 10T-Verlauf wird auf 100 indexiert und ist deshalb ebenfalls neutral.
 *
 * Farben: kategoriale Serien-Tokens (--series-1…8) in fester Reihenfolge, nie
 * zyklisch – ein 9. Ticker bekommt keine erfundene Farbe, ab dann bleibt nur
 * die Matrix. Status-Tokens (--pos/--neg) bleiben der Rang-/Vorzeichen-
 * Semantik vorbehalten und werden nie als Serienfarbe benutzt.
 */

import { icons } from '../lib/icons.js?v=20260807a';
import { liveOverallScore, liveHealthScore, liveEntryScore } from '../lib/dashboard-metrics.js?v=20260807a';
import { computeUpsidePotential, monthlyGrowthRate } from '../lib/tv-upside.js?v=20260807a';
import { classifyCluster, tradeTarget, exitLevels } from '../lib/trade-setup.js?v=20260807a';
import { megaClusterOf, megaClusterLabel } from '../lib/sector-clusters.js?v=20260807a';
import { isUsTicker } from '../lib/tv-swings.js?v=20260814j';

/** Charts bekommen höchstens so viele Serien – darüber trägt nur die Matrix.
 *  (Die validierte Palette hat acht Slots; ein neunter wäre eine erfundene
 *  Farbe und damit nicht mehr abgesichert.) */
export const SERIES_MAX = 8;

/** Serienfarbe für Index i – NIE zyklisch: jenseits der Palette gibt es keine
 *  erfundene Farbe, sondern neutrales Grau. Solche Ticker stehen ohnehin nur in
 *  der Matrix (Charts schneiden bei SERIES_MAX ab), wo ein wiederholter Farbton
 *  fälschlich Gleichheit mit einem anderen Ticker suggerieren würde. */
const seriesVar = (i) => (i < SERIES_MAX ? `var(--series-${i + 1})` : 'var(--muted)');

/* ── Formatierung ─────────────────────────────────────────────────────────── */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const nf = (v, d = 2) => (v == null || Number.isNaN(v) ? '—'
  : Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}%`);
const plainPct = (v, d = 0) => (v == null || Number.isNaN(v) ? '—' : `${v.toFixed(d)}%`);
const mcap = (v) => {
  if (v == null) return '—';
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9)  return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6)  return `${(v / 1e6).toFixed(0)}M`;
  return nf(v, 0);
};

/* ── Abgeleitete Kennzahlen ───────────────────────────────────────────────── */

/** Position des Kurses in der 52-Wochen-Spanne, 0–100 %. */
function pos52(tv) {
  const cur = tv?.close_1m ?? tv?.close;
  const lo = tv?.price_52_week_low, hi = tv?.price_52_week_high;
  if (cur == null || lo == null || hi == null || hi <= lo) return null;
  return Math.max(0, Math.min(1, (cur - lo) / (hi - lo))) * 100;
}

/** Chance-Risiko (Long) aus nativen TV-Leveln – ohne LS/FX, damit der Wert
 *  nicht von einem geladenen Wechselkurs abhängt. */
function rrRatio(tv) {
  if (!tv) return null;
  const cl = classifyCluster(tv);
  const target = tradeTarget(tv, cl ?? undefined);
  const entry = tv.pivot_r1_1w ?? tv.pivot_r1 ?? null;
  const stop = exitLevels(tv, cl ?? undefined, null, 1)?.primaryLong?.value ?? null;
  if (target == null || entry == null || stop == null || entry <= stop) return null;
  return (target - entry) / (entry - stop);
}

/**
 * Matrix-Spalten. `dir` steuert die Rang-Einfärbung:
 *   high → großer Wert ist gut · low → kleiner Wert ist gut · none → neutral
 * (RSI, 52W-Position und MCap sind bewusst neutral: „hoch" ist dort weder
 * gut noch schlecht, eine Ampel würde in die Irre führen.)
 */
export const METRICS = [
  { key: 'score',    label: 'Score',   dir: 'high', group: true,  title: 'Overall Score 0–100',                    get: (c) => liveOverallScore(c.tv_data)?.total,  fmt: (v) => nf(v, 0) },
  { key: 'health',   label: 'Health',  dir: 'high', title: 'Financial Health Score 0–100',                          get: (c) => liveHealthScore(c.tv_data)?.total,   fmt: (v) => nf(v, 0) },
  { key: 'entry',    label: 'Entry',   dir: 'high', title: 'Entry Timing Score 0–100',                              get: (c) => liveEntryScore(c.tv_data)?.total,    fmt: (v) => nf(v, 0) },
  { key: 'pchs',     label: 'PCHS',    dir: 'high', title: 'Price Cycle & Historical Position Score 0–100',         get: (c) => c.tv_data?.cycle_score,              fmt: (v) => nf(v, 0) },
  { key: 'strength', label: 'Stärke',  dir: 'high', title: 'Trend Strength Score 0–100',                            get: (c) => c.tv_data?.trend_strength_score,     fmt: (v) => nf(v, 0) },

  { key: 'd1w',      label: 'Δ1W',     dir: 'high', group: true,  title: 'Veränderung 1 Woche',                     get: (c) => c.tv_data?.change_1w,                fmt: pct },
  { key: 'd1m',      label: 'Δ1M',     dir: 'high', title: 'Veränderung 1 Monat',                                   get: (c) => c.tv_data?.change_1m,                fmt: pct },
  { key: 'p3m',      label: 'Perf3M',  dir: 'high', title: 'Performance 3 Monate',                                  get: (c) => c.tv_data?.perf_3m,                  fmt: pct },
  { key: 'p6m',      label: 'Perf6M',  dir: 'high', title: 'Performance 6 Monate',                                  get: (c) => c.tv_data?.perf_6m,                  fmt: pct },
  { key: 'growth',   label: 'ØGr/M',   dir: 'high', title: 'Ø monatliche Wachstumsrate (geometrisch aus Perf.6M)',  get: (c) => monthlyGrowthRate(c.tv_data?.perf_6m, 6), fmt: pct },

  { key: 'up',       label: '▲POT1M',  dir: 'high', group: true,  title: 'Upside-Potenzial ~1 Monat',               get: (c) => computeUpsidePotential(c.tv_data)?.upside,   fmt: pct },
  { key: 'down',     label: '▼POT1M',  dir: 'high', title: 'Downside-Risiko ~1 Monat (negativ = mehr Risiko)',      get: (c) => computeUpsidePotential(c.tv_data)?.downside, fmt: pct },
  { key: 'rr',       label: 'R:R',     dir: 'high', title: 'Chance-Risiko (Long): (Target − Entry) / (Entry − Stop)', get: (c) => rrRatio(c.tv_data),                fmt: (v) => nf(v, 1) },
  { key: 'atrp',     label: 'ATRP',    dir: 'low',  title: 'Average True Range in % – niedriger = ruhiger',         get: (c) => c.tv_data?.atrp,                     fmt: (v) => nf(v, 1) },
  { key: 'rsi',      label: 'RSI',     dir: 'none', title: 'Relative Strength Index (neutral eingefärbt)',          get: (c) => c.tv_data?.rsi,                      fmt: (v) => nf(v, 1) },
  { key: 'pos52',    label: '52W-Pos', dir: 'none', title: 'Position in der 52-Wochen-Spanne (neutral eingefärbt)', get: (c) => pos52(c.tv_data),                    fmt: (v) => plainPct(v, 0) },

  { key: 'pe',       label: 'KGV',     dir: 'low',  group: true,  title: 'Kurs-Gewinn-Verhältnis (TTM) – niedriger = günstiger', get: (c) => c.tv_data?.pe_ttm,      fmt: (v) => nf(v, 1) },
  { key: 'div',      label: 'Div%',    dir: 'high', title: 'Dividendenrendite',                                     get: (c) => c.tv_data?.dividend_yield,           fmt: (v) => nf(v, 2) },
  { key: 'roic',     label: 'ROIC',    dir: 'high', title: 'Return on Invested Capital (FY)',                       get: (c) => c.tv_data?.return_on_invested_capital, fmt: (v) => nf(v, 1) },
  { key: 'mcap',     label: 'MCap',    dir: 'none', title: 'Marktkapitalisierung (native Börsenwährung – nur als Größenordnung)', get: (c) => c.tv_data?.market_cap, fmt: mcap },
];

/**
 * Rang-Normalisierung einer Spalte: 1 = bester Wert der Auswahl, 0 = schlechtester.
 * Gibt `null` zurück, wenn nicht eingefärbt wird (neutrale Spalte, fehlender
 * Wert, oder alle Werte gleich – dann wäre jede Färbung Zufall).
 * @returns {number|null} t ∈ [0,1]
 */
export function rankT(value, values, dir) {
  if (dir === 'none' || value == null) return null;
  const vals = values.filter((v) => v != null);
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals);
  if (max === min) return null;
  const t = (value - min) / (max - min);
  return dir === 'low' ? 1 - t : t;
}

/** Divergierende Zellfläche: bester Wert → --pos, schlechtester → --neg, Mitte
 *  neutral (die Fläche selbst). Sättigung gekappt, damit Text lesbar bleibt. */
function cellStyle(t) {
  if (t == null) return '';
  const tone = t >= 0.5 ? 'var(--pos)' : 'var(--neg)';
  const strength = Math.abs(t - 0.5) * 2;          // 0 (Mitte) … 1 (Extrem)
  return `background:color-mix(in srgb, ${tone} ${(strength * 45).toFixed(0)}%, var(--surface-2))`;
}

/* ── Gewinner-Leiste ──────────────────────────────────────────────────────── */

const WINNERS = [
  { key: 'score',  label: 'Bester Score' },
  { key: 'p6m',    label: 'Beste 6M' },
  { key: 'rr',     label: 'Bestes R:R' },
  { key: 'health', label: 'Beste Bilanz' },
  { key: 'pe',     label: 'Günstigste Bew.' },
];

function winnerStrip(rows) {
  const blocks = WINNERS.map(({ key, label }) => {
    const m = METRICS.find((x) => x.key === key);
    const scored = rows.map((r) => ({ sym: r.c.symbol, v: r.values[key] })).filter((x) => x.v != null);
    if (!scored.length) return '';
    scored.sort((a, b) => (m.dir === 'low' ? a.v - b.v : b.v - a.v));
    const best = scored[0];
    return `<div class="cmp-win" title="${esc(m.title)}">
      <span class="cmp-win__lbl">${esc(label)}</span>
      <span class="cmp-win__sym">${esc(best.sym)}</span>
      <span class="cmp-win__val">${m.fmt(best.v)}</span>
    </div>`;
  }).filter(Boolean).join('');
  return blocks ? `<div class="cmp-winners">${blocks}</div>` : '';
}

/* ── Tab 1: Matrix ────────────────────────────────────────────────────────── */

function matrixHTML(rows) {
  const cols = METRICS.map((m) => {
    const values = rows.map((r) => r.values[m.key]);
    return { m, values };
  });
  const head = `<tr><th class="cmp-th cmp-th--sym">Ticker</th>${
    cols.map(({ m }) => `<th class="cmp-th num${m.group ? ' cmp-th--group' : ''}" title="${esc(m.title)}">${esc(m.label)}</th>`).join('')
  }</tr>`;

  const body = rows.map((r, i) => {
    const cells = cols.map(({ m, values }) => {
      const v = r.values[m.key];
      const t = rankT(v, values, m.dir);
      const isBest = t === 1;
      return `<td class="num${m.group ? ' cmp-th--group' : ''}${isBest ? ' cmp-best' : ''}" style="${cellStyle(t)}"
        title="${esc(r.c.symbol)} · ${esc(m.label)}: ${m.fmt(v)}">${m.fmt(v)}</td>`;
    }).join('');
    return `<tr>
      <th class="cmp-th--sym" scope="row">
        <span class="cmp-swatch" style="background:${seriesVar(i)}" aria-hidden="true"></span>
        <span class="cmp-sym">${esc(r.c.symbol)}</span>
        <span class="cmp-exch">${esc(r.c.exchange ?? '')}</span>
      </th>${cells}</tr>`;
  }).join('');

  return `${winnerStrip(rows)}
    <div class="cmp-matrix-wrap">
      <table class="cmp-matrix"><thead>${head}</thead><tbody>${body}</tbody></table>
    </div>
    <p class="cmp-note">Zellfarbe = Rang innerhalb der Auswahl (grün = bester, rot = schlechtester Wert der Spalte);
      RSI, 52W-Pos und MCap bleiben neutral. Fett = Spaltenbester.</p>`;
}

/* ── Legende (Serienfarbe → Ticker) ───────────────────────────────────────── */

function legend(rows) {
  return `<div class="cmp-legend">${rows.map((r, i) =>
    `<span class="cmp-leg"><span class="cmp-swatch" style="background:${seriesVar(i)}" aria-hidden="true"></span>${esc(r.c.symbol)}</span>`
  ).join('')}</div>`;
}

/* ── Tab 2: Chance/Risiko-Scatter ─────────────────────────────────────────── */

/* Identität trägt hier das Direkt-Label an jedem Punkt, nicht die Farbe: bei
 * frei verteilten Punkten müsste jede Farbe gegen jede andere unterscheidbar
 * sein, was eine 8er-Palette nicht leisten kann. Die Serienfarbe bleibt als
 * redundante Wiedererkennung zu den anderen Tabs. */
function scatterHTML(rows) {
  const pts = rows.map((r, i) => ({
    sym: r.c.symbol, i,
    x: r.values.atrp,
    y: r.values.up,
    mc: r.values.mcap,
    mega: megaClusterOf(r.c.sector),
  })).filter((p) => p.x != null && p.y != null);

  if (pts.length < 2) {
    return `<p class="pv-empty">Zu wenige Kandidaten mit ATRP und Upside-Potenzial – „TV Daten" laden.</p>`;
  }

  const W = 340, H = 250, ml = 34, mr = 12, mt = 12, mb = 30;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const padRange = (lo, hi) => { const s = (hi - lo) || Math.abs(hi) || 1; return [lo - s * 0.15, hi + s * 0.15]; };
  const [x0, x1] = padRange(Math.min(...xs), Math.max(...xs));
  const [y0, y1] = padRange(Math.min(...ys), Math.max(...ys));
  const px = (v) => ml + ((v - x0) / (x1 - x0)) * (W - ml - mr);
  const py = (v) => H - mb - ((v - y0) / (y1 - y0)) * (H - mt - mb);

  const mcs = pts.map((p) => p.mc).filter((v) => v != null);
  const mcMax = mcs.length ? Math.max(...mcs) : null;
  const rOf = (mc) => (mc == null || !mcMax ? 6 : 5 + Math.sqrt(mc / mcMax) * 8);

  const med = (a) => { const s = [...a].sort((m, n) => m - n); const k = Math.floor(s.length / 2); return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
  const mx = px(med(xs)), my = py(med(ys));

  const dots = pts.map((p) => {
    const cx = px(p.x), cy = py(p.y), r = rOf(p.mc);
    const tip = `${p.sym} · Risiko ATRP ${nf(p.x, 1)}% · Chance ${pct(p.y)}${p.mc != null ? ` · MCap ${mcap(p.mc)}` : ''}${p.mega ? ` · ${megaClusterLabel(p.mega)}` : ''}`;
    // Label rechts vom Punkt – am rechten Rand nach links gespiegelt, sonst
    // läuft es aus der Zeichenfläche (≈5,5px je Zeichen bei 10px Schrift).
    const wLbl = p.sym.length * 5.5;
    const flip = cx + r + 3 + wLbl > W - mr;
    return `<g class="cmp-dot"><title>${esc(tip)}</title>
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" style="fill:${seriesVar(p.i)}" class="cmp-dot__c"/>
      <text x="${(flip ? cx - r - 3 : cx + r + 3).toFixed(1)}" y="${(cy + 3.5).toFixed(1)}"
        text-anchor="${flip ? 'end' : 'start'}" class="cmp-dot__lbl">${esc(p.sym)}</text>
    </g>`;
  }).join('');

  return `${legend(rows)}
    <svg class="cmp-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img"
         aria-label="Streudiagramm: Risiko (ATRP) gegen Chance (Upside-Potenzial 1 Monat)">
      <line x1="${ml}" y1="${H - mb}" x2="${W - mr}" y2="${H - mb}" class="cmp-axis"/>
      <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${H - mb}" class="cmp-axis"/>
      <line x1="${mx.toFixed(1)}" y1="${mt}" x2="${mx.toFixed(1)}" y2="${H - mb}" class="cmp-median"/>
      <line x1="${ml}" y1="${my.toFixed(1)}" x2="${W - mr}" y2="${my.toFixed(1)}" class="cmp-median"/>
      ${dots}
      <text x="${(W / 2).toFixed(0)}" y="${H - 6}" text-anchor="middle" class="cmp-axlbl">Risiko · ATRP %</text>
      <text x="10" y="${(H / 2).toFixed(0)}" text-anchor="middle" class="cmp-axlbl"
            transform="rotate(-90 10 ${(H / 2).toFixed(0)})">Chance · ▲POT1M %</text>
    </svg>
    <p class="cmp-note">Bubble-Größe = Marktkapitalisierung · gestrichelt = Median der Auswahl.
      Links oben (viel Chance, wenig Risiko) ist der attraktive Quadrant.</p>`;
}

/* ── Tab 3: Performance-Balken ────────────────────────────────────────────── */

const PERF_GROUPS = [
  { key: 'd1w', label: 'Δ1W' },
  { key: 'd1m', label: 'Δ1M' },
  { key: 'p3m', label: '3M' },
  { key: 'p6m', label: '6M' },
];

function perfBarsHTML(rows) {
  const groups = PERF_GROUPS.map((g) => ({ ...g, vals: rows.map((r) => r.values[g.key]) }))
    .filter((g) => g.vals.some((v) => v != null));
  if (!groups.length) return `<p class="pv-empty">Keine Performance-Daten – „TV Daten" laden.</p>`;

  const all = groups.flatMap((g) => g.vals).filter((v) => v != null);
  const W = 340, H = 210, ml = 36, mr = 8, mt = 12, mb = 26;
  const plotH = H - mt - mb, gw = (W - ml - mr) / groups.length;
  const barW = Math.max(3, (gw - 10) / rows.length - 2);   // 2px Lücke zwischen Balken
  // Skala folgt den Daten (Null immer enthalten): sind alle Werte positiv,
  // sitzt die Nulllinie unten statt mittig – kein toter Halbraum.
  const yMax = Math.max(0, ...all), yMin = Math.min(0, ...all);
  const span = (yMax - yMin) || 1;
  const py = (v) => mt + ((yMax - v) / span) * plotH;
  const zeroY = py(0);

  const bars = groups.map((g, gi) => {
    const gx = ml + gi * gw + 5;
    return g.vals.map((v, i) => {
      if (v == null) return '';
      const x = gx + i * (barW + 2);
      const h = Math.max(1.5, Math.abs(py(v) - zeroY));
      const y = v >= 0 ? zeroY - h : zeroY;
      // 4px gerundete Datenkante, an der Nulllinie verankert
      const rad = Math.min(4, barW / 2, h);
      return `<g><title>${esc(`${rows[i].c.symbol} · ${g.label}: ${pct(v)}`)}</title>
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}"
          rx="${rad.toFixed(1)}" style="fill:${seriesVar(i)}"/></g>`;
    }).join('');
  }).join('');

  const gLabels = groups.map((g, gi) =>
    `<text x="${(ml + gi * gw + gw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="cmp-axlbl">${esc(g.label)}</text>`
  ).join('');
  const yTick = (v) => `<text x="${ml - 5}" y="${(py(v) + 3).toFixed(1)}" text-anchor="end" class="cmp-axlbl">${v > 0 ? '+' : ''}${v.toFixed(0)}%</text>`;

  return `${legend(rows)}
    <svg class="cmp-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img"
         aria-label="Gruppierte Balken: Performance je Zeitfenster und Ticker">
      <line x1="${ml}" y1="${zeroY.toFixed(1)}" x2="${W - mr}" y2="${zeroY.toFixed(1)}" class="cmp-axis"/>
      ${bars}${gLabels}
      ${yMax > 0 ? yTick(yMax) : ''}${yMin < 0 ? yTick(yMin) : ''}
      ${yMin < 0 && yMax > 0 ? `<text x="${ml - 5}" y="${(zeroY + 3).toFixed(1)}" text-anchor="end" class="cmp-axlbl">0</text>` : ''}
    </svg>
    <p class="cmp-note">Gleiche Skala für alle Fenster – wer über mehrere Zeiträume trägt, zeigt durchgehend hohe Balken.</p>`;
}

/* ── Tab 4: 10-Tage-Verlauf (indexiert auf 100) ───────────────────────────── */

/** Schlusskurs-Serie je Kandidat: LS-Historie zuerst (Watch-Bucket), sonst
 *  bereits geladene TD-Kerzen. `null` = nichts vorhanden. */
export function closeSeries(c) {
  const hist = Array.isArray(c.ls_history) ? c.ls_history : null;
  if (hist && hist.length >= 2) {
    const v = hist.map((s) => s.close).filter((x) => x != null);
    if (v.length >= 2) return { src: 'ls', values: v.slice(-10) };
  }
  const ohlc = c.swing_analysis?.ohlc;
  if (Array.isArray(ohlc) && ohlc.length >= 2) {
    const v = ohlc.map((b) => b.c).filter((x) => x != null);
    if (v.length >= 2) return { src: 'td', values: v.slice(-10) };
  }
  return null;
}

function rebasedHTML(rows, { tdPending = 0, loading = false } = {}) {
  const series = rows.map((r, i) => ({ sym: r.c.symbol, i, s: closeSeries(r.c) }))
    .filter((x) => x.s)
    .map((x) => {
      const base = x.s.values[0];
      return { ...x, idx: x.s.values.map((v) => (v / base) * 100) };
    });

  const loadBar = loading
    ? `<div class="cmp-load"><span class="ls-loading"></span> Lade TD-Tageskerzen …</div>`
    : tdPending > 0
      ? `<div class="cmp-load">
           <span>${tdPending} US-Titel ohne Historie</span>
           <button class="btn btn-sm btn-secondary" id="cmp-td-load">${icons.candlestick} TD-Kerzen laden</button>
         </div>`
      : '';

  if (series.length < 2) {
    return `${loadBar}<p class="pv-empty">Mindestens zwei Kandidaten brauchen eine Kurshistorie.
      LS-Historie entsteht nur im Watch-Bucket (nightly), TD-Kerzen gibt es on-demand für US-Titel.</p>`;
  }

  // Rechter Rand trägt die Direkt-Labels (nur bei ≤4 Serien) – Breite nach dem
  // längsten Symbol bemessen, sonst schneidet der Rahmen sie ab.
  const direct = series.length <= 4;
  const maxSym = Math.max(...series.map((s) => s.sym.length));
  const W = 340, H = 210, ml = 34, mt = 12, mb = 24;
  const mr = direct ? Math.min(76, 14 + maxSym * 6.2) : 12;
  const maxLen = Math.max(...series.map((s) => s.idx.length));
  const all = series.flatMap((s) => s.idx);
  const lo = Math.min(100, ...all), hi = Math.max(100, ...all);
  const padY = ((hi - lo) || 1) * 0.1;
  const y0 = lo - padY, y1 = hi + padY;
  const px = (k, n) => ml + (n <= 1 ? 0 : (k / (n - 1)) * (W - ml - mr));
  const py = (v) => H - mb - ((v - y0) / (y1 - y0)) * (H - mt - mb);

  const lines = series.map((s) => {
    const pts = s.idx.map((v, k) => `${px(k, s.idx.length).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
    const last = s.idx[s.idx.length - 1];
    const endX = px(s.idx.length - 1, s.idx.length);
    // Direkt-Label am Linienende nur bei ≤4 Serien – darüber trägt die Legende.
    const lbl = direct
      ? `<text x="${(endX + 5).toFixed(1)}" y="${(py(last) + 3.5).toFixed(1)}" class="cmp-endlbl" style="fill:${seriesVar(s.i)}">${esc(s.sym)}</text>`
      : '';
    return `<g><title>${esc(`${s.sym}: ${last >= 100 ? '+' : '−'}${Math.abs(last - 100).toFixed(1)}% über ${s.idx.length} Tage`)}</title>
      <polyline points="${pts}" class="cmp-line" style="stroke:${seriesVar(s.i)}"/>
      <circle cx="${endX.toFixed(1)}" cy="${py(last).toFixed(1)}" r="3" style="fill:${seriesVar(s.i)}"/>
      ${lbl}</g>`;
  }).join('');

  const srcs = new Set(series.map((s) => s.s.src));
  const srcTxt = [...srcs].map((s) => (s === 'ls' ? 'LS-Historie' : 'TD-Tageskerzen')).join(' + ');

  return `${loadBar}${legend(rows)}
    <svg class="cmp-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img"
         aria-label="Auf 100 indexierter Kursverlauf der letzten Handelstage">
      <line x1="${ml}" y1="${py(100).toFixed(1)}" x2="${W - mr}" y2="${py(100).toFixed(1)}" class="cmp-base"/>
      ${lines}
      <text x="${ml - 5}" y="${(py(100) + 3.5).toFixed(1)}" text-anchor="end" class="cmp-axlbl">100</text>
      <text x="${(W / 2).toFixed(0)}" y="${H - 6}" text-anchor="middle" class="cmp-axlbl">letzte ${maxLen} Handelstage</text>
    </svg>
    <p class="cmp-note">Alle Serien auf 100 zum Startpunkt indexiert – dadurch währungsneutral vergleichbar. Quelle: ${esc(srcTxt)}.</p>`;
}

/* ── Modal-Shell ──────────────────────────────────────────────────────────── */

const TABS = [
  { key: 'matrix',  label: 'Matrix' },
  { key: 'risk',    label: 'Chance/Risiko' },
  { key: 'perf',    label: 'Performance' },
  { key: 'trend',   label: '10T-Verlauf' },
];

/**
 * @param {Array} candidates  ausgewählte Kandidaten (>=2)
 * @param {{ onFetchTd?: (c:object)=>Promise<object>, onLoadTv?: ()=>void }} opts
 *        onFetchTd lädt TD-Tageskerzen für EINEN Kandidaten (US-only) und
 *        persistiert sie – der Aufrufer kennt Blob/Storage, das Modal nicht.
 */
export function renderCompareModal(candidates, { onFetchTd, onLoadTv } = {}) {
  if (document.getElementById('compare-modal-overlay')) return;
  const all = (candidates ?? []).filter(Boolean);
  if (all.length < 2) return;

  // Charts tragen höchstens SERIES_MAX Serien; die Matrix nimmt alle.
  const charted = all.slice(0, SERIES_MAX);
  const overflow = all.length - charted.length;
  const noTv = all.filter((c) => !c.tv_data).length;

  let activeTab = 'matrix';
  let tdLoading = false;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'compare-modal-overlay';

  const buildRows = (list) => list.map((c) => ({
    c,
    values: Object.fromEntries(METRICS.map((m) => {
      let v = null;
      try { v = m.get(c) ?? null; } catch { v = null; }
      return [m.key, Number.isFinite(v) ? v : (v == null ? null : v)];
    })),
  }));

  function paneHTML() {
    const rowsAll = buildRows(all);
    const rowsChart = buildRows(charted);
    if (activeTab === 'matrix') return matrixHTML(rowsAll);
    if (activeTab === 'risk')   return scatterHTML(rowsChart);
    if (activeTab === 'perf')   return perfBarsHTML(rowsChart);
    const tdPending = charted.filter((c) => !closeSeries(c) && isUsTicker(c)).length;
    return rebasedHTML(rowsChart, { tdPending, loading: tdLoading });
  }

  function render() {
    overlay.innerHTML = `
      <div class="modal cmp-modal" role="dialog" aria-modal="true" aria-label="Kandidaten vergleichen">
        <div class="modal-header">
          <h2>${icons.scale} Vergleich <span class="cmp-count">${all.length}</span></h2>
          <div class="modal-header-actions">
            <button class="icon-btn" id="cmp-close" aria-label="Schließen">${icons.xMark}</button>
          </div>
        </div>
        <div class="modal-body">
          ${noTv > 0 ? `<div class="cmp-warn">
            <span>${noTv} ohne TV-Daten – Kennzahlen bleiben leer.</span>
            ${onLoadTv ? `<button class="btn btn-sm btn-secondary" id="cmp-load-tv">TV-Daten laden</button>` : ''}
          </div>` : ''}
          ${overflow > 0 ? `<p class="cmp-note cmp-note--cap">Charts zeigen die ersten ${SERIES_MAX} Ticker
            (${overflow} weitere nur in der Matrix) – mehr Serien wären farblich nicht mehr sicher unterscheidbar.</p>` : ''}
          <div class="tab-bar cmp-tabs" role="tablist">
            ${TABS.map(({ key, label }) =>
              `<button class="tab-btn${activeTab === key ? ' active' : ''}" data-cmptab="${key}"
                role="tab" aria-selected="${activeTab === key}">${esc(label)}</button>`).join('')}
          </div>
          <div class="cmp-pane">${paneHTML()}</div>
        </div>
      </div>`;
    wire();
  }

  function wire() {
    overlay.querySelector('#cmp-close').addEventListener('pointerup', close);
    overlay.querySelectorAll('[data-cmptab]').forEach((btn) => {
      btn.addEventListener('pointerup', () => { activeTab = btn.dataset.cmptab; render(); });
    });
    overlay.querySelector('#cmp-load-tv')?.addEventListener('pointerup', () => { close(); onLoadTv?.(); });
    overlay.querySelector('#cmp-td-load')?.addEventListener('pointerup', async () => {
      if (!onFetchTd || tdLoading) return;
      const targets = charted.filter((c) => !closeSeries(c) && isUsTicker(c));
      tdLoading = true; render();
      // Sequenziell, nicht parallel: TD-Free ist eng limitiert (≈8 Anfragen/Min).
      // Beim ersten Limit-Fehler abbrechen, statt weiter Credits zu verbrennen.
      for (const c of targets) {
        const res = await onFetchTd(c).catch(() => null);
        if (res?.error) break;
      }
      tdLoading = false; render();
    });
  }

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  document.body.appendChild(overlay);
  render();
  overlay.addEventListener('pointerup', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
}
