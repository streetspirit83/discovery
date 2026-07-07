/**
 * rotation.js — Sektor-Rotation for the Markets sub-page.
 *
 * Works purely from the current multi-timeframe sector aggregates (1W/1M/3M/6M,
 * cap-weighted) — there is no historical sector series, so instead of a classic
 * RRG tail we build a *horizon trail*: every window is converted to a monthly
 * rate and expressed as excess vs. the cap-weighted benchmark of the current
 * selection; sliding window pairs then form a path per sector
 *
 *   P1 = (excess 6M, excess 3M) → P2 = (excess 3M, excess 1M) → P3 = (excess 1M, excess 1W)
 *
 * with X = longer-term relative strength and Y = shorter-term relative
 * momentum. The head (P3) sits in one of the four classic RRG quadrants
 * (Leading / Weakening / Lagging / Improving); the trail shows the rotation
 * direction from day one.
 *
 * Three views: quadrant chart, rank bump chart (6M→3M→1M→1W), and the
 * "Harte Brüche" list ranking long-vs-short-horizon rank divergences.
 */

// Window key → length in months (1W ≈ 12/52 months).
const WINDOWS = [
  { key: 'ph', label: '6M', months: 6 },
  { key: 'pq', label: '3M', months: 3 },
  { key: 'pm', label: '1M', months: 1 },
  { key: 'pw', label: '1W', months: 12 / 52 },
];

const QUAD_META = {
  leading:   { label: 'Leading',   color: 'var(--pos)' },
  weakening: { label: 'Weakening', color: '#d97706' },
  lagging:   { label: 'Lagging',   color: 'var(--neg)' },
  improving: { label: 'Improving', color: 'var(--accent)' },
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const monthlyRate = (pct, months) => (Math.pow(1 + pct / 100, 1 / months) - 1) * 100;

const fmtPct = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%');
function heatCls(v) {
  if (v == null) return 'h0';
  if (v > 10)  return 'h3';
  if (v > 5)   return 'h2';
  if (v > 0)   return 'h1';
  if (v > -5)  return 'n1';
  if (v > -10) return 'n2';
  return 'n3';
}

/* ── Model ──────────────────────────────────────────────────────────────────
 * aggs: [{ sector, n, mcap, pw, pm, pq, ph }] (cap-weighted sector perf, %).
 * Returns { sectors, bench, skipped } where each sector carries the excess
 * monthly rates (pp/month), the trail points, quadrant, per-window ranks and
 * the break score (rankLong − rankShort; positive = "dreht auf").
 */
export function computeRotationModel(aggs) {
  const rows = (aggs ?? []).filter((a) =>
    a.pw != null && a.pm != null && a.pq != null && a.ph != null && (a.mcap ?? 0) > 0);
  const skipped = (aggs?.length ?? 0) - rows.length;
  if (rows.length < 2) return { sectors: [], bench: null, skipped };

  const totalMcap = rows.reduce((s, a) => s + a.mcap, 0);
  const bench = {};
  for (const w of WINDOWS) {
    bench[w.key] = rows.reduce((s, a) => s + a[w.key] * a.mcap, 0) / totalMcap;
  }

  const sectors = rows.map((a) => {
    const ex = {};
    for (const w of WINDOWS) ex[w.key] = monthlyRate(a[w.key], w.months) - monthlyRate(bench[w.key], w.months);
    const points = [[ex.ph, ex.pq], [ex.pq, ex.pm], [ex.pm, ex.pw]];
    const [hx, hy] = points[2];
    const quad = hx >= 0 ? (hy >= 0 ? 'leading' : 'weakening') : (hy >= 0 ? 'improving' : 'lagging');
    return {
      sector: a.sector, n: a.n, mcap: a.mcap,
      perf: { pw: a.pw, pm: a.pm, pq: a.pq, ph: a.ph },
      ex, points, quad,
      long: (ex.ph + ex.pq) / 2, short: (ex.pm + ex.pw) / 2,
    };
  });

  // Ranks: per window (for the bump chart) and long/short horizon (break score).
  const rankMap = (key) => new Map(
    [...sectors].sort((x, y) => y[key] - x[key]).map((s, i) => [s.sector, i + 1]));
  const perWin = {};
  for (const w of WINDOWS) {
    const m = new Map([...sectors].sort((x, y) => y.ex[w.key] - x.ex[w.key]).map((s, i) => [s.sector, i + 1]));
    perWin[w.key] = m;
  }
  const rl = rankMap('long'), rs = rankMap('short');
  for (const s of sectors) {
    s.rank = Object.fromEntries(WINDOWS.map((w) => [w.key, perWin[w.key].get(s.sector)]));
    s.rankLong = rl.get(s.sector);
    s.rankShort = rs.get(s.sector);
    s.breakScore = s.rankLong - s.rankShort;
  }
  return { sectors, bench, skipped };
}

/* ── Stage 2: per-day snapshots in localStorage → real history tails ────────
 * Every rotation render upserts today's sector aggregates (per market filter).
 * Older days are replayed as head points (excess 1M vs 1W, each day against
 * its own cap-weighted benchmark) and drawn as a dotted tail behind the live
 * head — over time the horizon trail grows a true day-over-day RRG tail. */

const SNAP_KEY = 'discovery_rotation_snaps_v1';
const SNAP_DAYS = 45;   // days kept per filter
const TAIL_DAYS = 10;   // previous days drawn in the quadrant

function loadSnaps() {
  try { return JSON.parse(localStorage.getItem(SNAP_KEY)) ?? {}; } catch { return {}; }
}

export function upsertRotationSnapshot(filterKey, aggs) {
  const day = new Date().toISOString().slice(0, 10);
  const sectors = {};
  for (const a of aggs ?? []) {
    if (a.pw == null || a.pm == null || (a.mcap ?? 0) <= 0) continue;
    sectors[a.sector] = { pw: a.pw, pm: a.pm, mcap: a.mcap };
  }
  if (!Object.keys(sectors).length) return;
  const all = loadSnaps();
  const key = filterKey || '';
  const list = all[key] ?? [];
  const rec = { d: day, sectors };
  if (list[0]?.d === day) list[0] = rec; else list.unshift(rec);
  all[key] = list.slice(0, SNAP_DAYS);
  try { localStorage.setItem(SNAP_KEY, JSON.stringify(all)); } catch { /* quota */ }
}

/* sector → [[x,y] oldest→newest] head points of stored previous days. */
export function historyTails(filterKey) {
  const today = new Date().toISOString().slice(0, 10);
  const W_M = 12 / 52;
  const days = (loadSnaps()[filterKey || ''] ?? [])
    .filter((r) => r.d !== today).slice(0, TAIL_DAYS).reverse();
  const tails = {};
  for (const rec of days) {
    const entries = Object.entries(rec.sectors ?? {}).filter(([, v]) => v.pm != null && v.pw != null && v.mcap > 0);
    const tot = entries.reduce((s, [, v]) => s + v.mcap, 0);
    if (tot <= 0 || entries.length < 2) continue;
    const benchPm = entries.reduce((s, [, v]) => s + v.pm * v.mcap, 0) / tot;
    const benchPw = entries.reduce((s, [, v]) => s + v.pw * v.mcap, 0) / tot;
    for (const [sec, v] of entries) {
      const x = monthlyRate(v.pm, 1) - monthlyRate(benchPm, 1);
      const y = monthlyRate(v.pw, W_M) - monthlyRate(benchPw, W_M);
      (tails[sec] ??= []).push([x, y]);
    }
  }
  return tails;
}

/* ── Quadrant chart (SVG) ───────────────────────────────────────────────── */

function quadrantSVG(model, selected, tails = {}) {
  const W = 340, H = 300, pad = 14;
  const pts = model.sectors.flatMap((s) => s.points.flat())
    .concat(model.sectors.flatMap((s) => (tails[s.sector] ?? []).flat()));
  const range = Math.max(1, ...pts.map(Math.abs)) * 1.1;
  const sx = (v) => pad + ((Math.max(-range, Math.min(range, v)) + range) / (2 * range)) * (W - 2 * pad);
  const sy = (v) => pad + ((range - Math.max(-range, Math.min(range, v))) / (2 * range)) * (H - 2 * pad);
  const cx = sx(0), cy = sy(0);
  const maxMcap = Math.max(...model.sectors.map((s) => s.mcap));

  // Labels: selected sector + the strongest divergers (they carry the story).
  const labelled = new Set(selected ? [selected] : []);
  const byBreak = [...model.sectors].sort((a, b) => Math.abs(b.breakScore) - Math.abs(a.breakScore));
  for (const s of byBreak.slice(0, 4)) labelled.add(s.sector);

  const trails = [...model.sectors]
    .sort((a, b) => (a.sector === selected) - (b.sector === selected))  // selected paints last (on top)
    .map((s) => {
      const sel = s.sector === selected;
      const color = QUAD_META[s.quad].color;
      const p = s.points.map(([x, y]) => [sx(x), sy(y)]);
      const rHead = 3.5 + 5.5 * Math.sqrt(s.mcap / maxMcap);
      const line = p.map((q) => q.join(',')).join(' ');
      // dotted day-over-day history tail (previous days' head points → live head)
      const hist = tails[s.sector] ?? [];
      const tailLine = hist.length
        ? `<polyline points="${[...hist.map(([x, y]) => `${sx(x)},${sy(y)}`), p[2].join(',')].join(' ')}"
             fill="none" stroke="${color}" stroke-width="${sel ? 1.6 : 1}" stroke-dasharray="1.5 3"
             opacity="${sel ? 0.85 : 0.35}" stroke-linecap="round"/>`
        : '';
      const label = labelled.has(s.sector)
        ? `<text class="rot-lbl${sel ? ' is-sel' : ''}" x="${p[2][0]}" y="${p[2][1] - rHead - 3}" text-anchor="middle">${esc(shortName(s.sector))}</text>`
        : '';
      return `<g class="rot-sec${sel ? ' is-sel' : ''}" data-sector="${esc(s.sector)}">
        ${tailLine}
        <polyline points="${line}" fill="none" stroke="${color}" stroke-width="${sel ? 2.2 : 1.3}" opacity="${sel ? 0.9 : 0.38}"/>
        <circle cx="${p[0][0]}" cy="${p[0][1]}" r="2" fill="${color}" opacity="${sel ? 0.8 : 0.4}"/>
        <circle cx="${p[1][0]}" cy="${p[1][1]}" r="2" fill="${color}" opacity="${sel ? 0.8 : 0.4}"/>
        <circle class="rot-head" cx="${p[2][0]}" cy="${p[2][1]}" r="${rHead}" fill="${color}" opacity="${sel ? 0.95 : 0.7}" stroke="var(--bg)" stroke-width="1"/>
        ${label}
      </g>`;
    }).join('');

  return `<svg class="rot-quad" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sektor-Rotation Quadrant">
    <rect x="${cx}" y="${pad}" width="${W - pad - cx}" height="${cy - pad}" fill="var(--pos)" opacity="0.05"/>
    <rect x="${cx}" y="${cy}" width="${W - pad - cx}" height="${H - pad - cy}" fill="#d97706" opacity="0.05"/>
    <rect x="${pad}" y="${pad}" width="${cx - pad}" height="${cy - pad}" fill="var(--accent)" opacity="0.05"/>
    <rect x="${pad}" y="${cy}" width="${cx - pad}" height="${H - pad - cy}" fill="var(--neg)" opacity="0.05"/>
    <line x1="${pad}" y1="${cy}" x2="${W - pad}" y2="${cy}" stroke="var(--border)"/>
    <line x1="${cx}" y1="${pad}" x2="${cx}" y2="${H - pad}" stroke="var(--border)"/>
    <text class="rot-quad-lbl" x="${W - pad - 4}" y="${pad + 12}" text-anchor="end" fill="var(--pos)">Leading</text>
    <text class="rot-quad-lbl" x="${W - pad - 4}" y="${H - pad - 6}" text-anchor="end" fill="#d97706">Weakening</text>
    <text class="rot-quad-lbl" x="${pad + 4}" y="${pad + 12}" fill="var(--accent)">Improving</text>
    <text class="rot-quad-lbl" x="${pad + 4}" y="${H - pad - 6}" fill="var(--neg)">Lagging</text>
    ${trails}
  </svg>`;
}

// "Electronic Technology" → "Electronic Tech.", keep short names as-is.
function shortName(sector) {
  const words = String(sector).split(' ');
  if (sector.length <= 16) return sector;
  return words.map((w, i) => (i === words.length - 1 && w.length > 5 ? w.slice(0, 4) + '.' : w)).join(' ');
}

/* ── Bump chart (rank ribbons, SVG) ─────────────────────────────────────── */

function bumpSVG(model, selected) {
  const n = model.sectors.length;
  const rowH = 17, top = 22, bottom = 8, left = 30, right = 118;
  const W = 340, H = top + bottom + n * rowH;
  const colX = WINDOWS.map((_, i) => left + (i * (W - left - right)) / (WINDOWS.length - 1));
  const yOf = (rank) => top + (rank - 0.5) * rowH;

  const bands = [...model.sectors]
    .sort((a, b) => (a.sector === selected) - (b.sector === selected))
    .map((s) => {
      const sel = s.sector === selected;
      const head = s.rank.pw;
      const color = sel ? 'var(--accent)'
        : head <= 5 ? 'var(--pos)'
        : head > n - 5 ? 'var(--neg)'
        : 'var(--border)';
      const pts = WINDOWS.map((w, i) => `${colX[i]},${yOf(s.rank[w.key])}`).join(' ');
      const showLbl = sel || head <= 5 || head > n - 5;
      const lbl = showLbl
        ? `<text class="rot-bump-lbl${sel ? ' is-sel' : ''}" x="${colX[3] + 6}" y="${yOf(head) + 3}">${esc(truncate(s.sector, 17))}</text>`
        : '';
      return `<g class="rot-sec${sel ? ' is-sel' : ''}" data-sector="${esc(s.sector)}">
        <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${sel ? 2.4 : head <= 5 || head > n - 5 ? 1.8 : 1}" opacity="${sel ? 1 : 0.75}" stroke-linejoin="round"/>
        <circle cx="${colX[3]}" cy="${yOf(head)}" r="2.4" fill="${color}"/>
        ${lbl}
      </g>`;
    }).join('');

  const heads = WINDOWS.map((w, i) =>
    `<text class="rot-bump-head" x="${colX[i]}" y="12" text-anchor="middle">${w.label}</text>`).join('');

  return `<svg class="rot-bump" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rang-Bänder">
    <text class="rot-bump-head" x="${left - 6}" y="${yOf(1) + 3}" text-anchor="end">#1</text>
    <text class="rot-bump-head" x="${left - 6}" y="${yOf(n) + 3}" text-anchor="end">#${n}</text>
    ${heads}${bands}
  </svg>`;
}

const truncate = (s, max) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

/* ── "Harte Brüche" list ────────────────────────────────────────────────── */

function breaksHtml(model, selected) {
  const up = model.sectors.filter((s) => s.breakScore >= 2).sort((a, b) => b.breakScore - a.breakScore).slice(0, 6);
  const down = model.sectors.filter((s) => s.breakScore <= -2).sort((a, b) => a.breakScore - b.breakScore).slice(0, 6);
  if (!up.length && !down.length) {
    return '<p class="rot-empty">Keine harten Divergenzen — Lang- und Kurzfrist-Ranking laufen aktuell parallel.</p>';
  }
  const row = (s, dir) => `<button class="rot-row${s.sector === selected ? ' is-sel' : ''}" data-sector="${esc(s.sector)}"
      title="Rang lang (6M/3M): #${s.rankLong} → Rang kurz (1M/1W): #${s.rankShort}">
    <span class="rot-row__badge ${dir}">${dir === 'up' ? '▲' : '▼'} ${Math.abs(s.breakScore)}</span>
    <span class="rot-row__name">${esc(s.sector)}</span>
    <span class="rot-cells">${['ph', 'pq', 'pm', 'pw'].map((k) =>
      `<span class="rot-cell ${heatCls(s.perf[k])}">${fmtPct(s.perf[k])}</span>`).join('')}</span>
    <span class="rot-row__go" data-drill="${esc(s.sector)}" title="Drill-Down öffnen">→</span>
  </button>`;
  const parts = [];
  if (up.length)   parts.push(`<div class="rot-sub up">Dreht auf · Kurzfrist-Rang besser als Langfrist</div>${up.map((s) => row(s, 'up')).join('')}`);
  if (down.length) parts.push(`<div class="rot-sub down">Rollt über · Kurzfrist-Rang schlechter als Langfrist</div>${down.map((s) => row(s, 'down')).join('')}`);
  return parts.join('');
}

/* ── Public render ──────────────────────────────────────────────────────────
 * renderRotation(el, { aggs, onDrill }) — self-contained: keeps its own
 * selection state and re-renders on tap. onDrill(sector) opens the existing
 * sector drill-down (wired by markets/app.js).
 */
export function renderRotation(el, { aggs, filterKey = '', onDrill } = {}) {
  const model = computeRotationModel(aggs);
  upsertRotationSnapshot(filterKey, aggs);
  const tails = historyTails(filterKey);
  const tailDays = Math.max(0, ...Object.values(tails).map((t) => t.length));
  let selected = null;

  const html = () => {
    if (!model.sectors.length) {
      return '<p class="rot-empty">Zu wenige Sektoren mit vollständigen 1W/1M/3M/6M-Daten.</p>';
    }
    return `
      <section class="rot-block">
        <h3 class="rot-h">Rotations-Quadrant <span class="rot-hint">Pfad 6M→3M→1M→1W · x: rel. Stärke lang · y: rel. Momentum kurz (%-Pkt./Monat vs. Markt)${tailDays ? ` · gepunktet: echte Historie (${tailDays} Tag${tailDays === 1 ? '' : 'e'})` : ''}</span></h3>
        ${quadrantSVG(model, selected, tails)}
      </section>
      <section class="rot-block">
        <h3 class="rot-h">Harte Brüche <span class="rot-hint">Rangdifferenz Langfrist (Ø6M/3M) vs. Kurzfrist (Ø1M/1W)</span></h3>
        ${breaksHtml(model, selected)}
      </section>
      <section class="rot-block">
        <h3 class="rot-h">Rang-Bänder <span class="rot-hint">Platzierung je Zeitfenster · Top/Bottom 5 farbig</span></h3>
        ${bumpSVG(model, selected)}
      </section>`;
  };

  const paint = () => { el.innerHTML = html(); };
  paint();

  el.addEventListener('pointerup', (e) => {
    const go = e.target.closest('[data-drill]');
    if (go) { onDrill?.(go.dataset.drill); return; }
    const g = e.target.closest('[data-sector]');
    if (!g) return;
    selected = selected === g.dataset.sector ? null : g.dataset.sector;
    paint();
  });

  return { get model() { return model; } };
}
