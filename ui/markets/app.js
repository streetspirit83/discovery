import { runScreen, rowsToCandidates, fetchGlobalQuotes } from '../lib/tv-screener.js?v=20260701a';
import { MARKETS } from '../lib/tv-fields.js?v=20260701a';
import { loadStorageClient } from '../lib/storage-client.js?v=20260701a';
import { normalizeExchange } from '../lib/exchange-map.js?v=20260701a';

// ─── Column layout sent to the TradingView scanner ─────────────────────────────
const COLUMNS = ['description', 'sector', 'Perf.W', 'Perf.1M', 'Perf.3M', 'Perf.6M', 'Perf.Y', 'market_cap_basic', 'industry'];
// d[0]=name  d[1]=sector  d[2]=1W  d[3]=1M  d[4]=3M  d[5]=6M  d[6]=1Y  d[7]=mcap  d[8]=industry

const PERF_COLS = [
  { key: 'pw', label: '1W', idx: 2 },
  { key: 'pm', label: '1M', idx: 3 },
  { key: 'pq', label: '3M', idx: 4 },
  { key: 'ph', label: '6M', idx: 5 },
  { key: 'py', label: '1J', idx: 6 },
];
const KEY_TO_IDX = Object.fromEntries(PERF_COLS.map((c) => [c.key, c.idx]));

// ─── Macro barometer: benchmark indices ─────────────────────────────────────────
// The three equity indices drive the Risk-On/Risk-Off breadth; VIX is a fear
// overlay (rising = risk-off), not part of the breadth count. Tickers verified in
// tv-enrichment.js. Columns fetched from TradingView's global scan:
//   idx 0 = change (today %) · idx 1 = Perf.W (1W %) · idx 2 = Perf.1M (1M %)
const MACRO_INDICES = [
  { label: 'DAX',    ticker: 'XETR:DAX' },
  { label: 'NASDAQ', ticker: 'NASDAQ:IXIC' },
  { label: 'NIKKEI', ticker: 'TVC:NI225' },
];
const VIX_TICKER = 'TVC:VIX';
const INDEX_COLS = ['change', 'Perf.W', 'Perf.1M'];

// Map a canonical exchange code (post normalizeExchange) → market slug, for
// attributing an import row to the right market regardless of which regional
// venue alias (Tradegate, Gettex, FWB, ...) TradingView reported it under.
const EXCHANGE_TO_SLUG = (() => {
  const map = {};
  for (const m of MARKETS) {
    for (const exch of m.exchanges) map[exch] = m.slug;
  }
  return map;
})();

// ─── State ─────────────────────────────────────────────────────────────────────
let backendUrl = null, secret = null;
let marketData = {};    // slug → { label, rows: [{s, d}] }
let countryAggs = [];   // [{slug, label, n, pw, pm, pq, ph, py, rows}]
let sectorMap = {};     // sectorName → { marketSlug → [{s,d}] }
let tab = 'countries';
let sortKey = 'pm', sortDir = 'desc';
let sectorFilter = '';  // '' = all markets, else a market slug
// Nested drill navigator. null when closed, else:
// { rootType:'country'|'sector', rootKey, baseTitle, baseRows, marketSlug,
//   hierarchy:[dim,...], path:[{dim,value},...] }. We aggregate baseRows by
// hierarchy[path.length] until the path reaches the leaf, then list tickers.
let drill = null;
let drillSort = { key: 'pm', dir: 'desc' };  // independent sort for the drill table
let drillSelected = new Set();               // set of row.s currently checked for import
let loading = false, loadDone = 0;
let indexData = null;   // Map<ticker, row.d> for the macro barometer, or null before load

// ─── Helpers ───────────────────────────────────────────────────────────────────
function readSettings() {
  backendUrl = localStorage.getItem('discovery_backend_url') || null;
  secret     = localStorage.getItem('discovery_secret') || null;
}

function applyTheme() {
  try {
    const s = JSON.parse(localStorage.getItem('discovery.ui.v1') || '{}');
    document.documentElement.setAttribute('data-theme', s.theme ?? 'light');
  } catch {}
}

function weightedAvg(rows, pidx) {
  let sw = 0, swp = 0;
  for (const { d } of rows) {
    const w = d[7] ?? 0, p = d[pidx];
    if (p == null || w <= 0) continue;
    sw += w; swp += p * w;
  }
  return sw > 0 ? swp / sw : null;
}

function mkAgg(rows) {
  return { n: rows.length, pw: weightedAvg(rows, 2), pm: weightedAvg(rows, 3), pq: weightedAvg(rows, 4), ph: weightedAvg(rows, 5), py: weightedAvg(rows, 6) };
}

function fmtPct(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

function fmtMcap(v) {
  if (!v || v <= 0) return '';
  if (v >= 1e12) return (v / 1e12).toFixed(1) + 'T';
  if (v >= 1e9)  return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6)  return (v / 1e6).toFixed(0) + 'M';
  return '';
}

function heatCls(v) {
  if (v == null) return 'h0';
  if (v > 10)  return 'h3';
  if (v > 5)   return 'h2';
  if (v > 0)   return 'h1';
  if (v > -5)  return 'n1';
  if (v > -10) return 'n2';
  return 'n3';
}

function hc(v) { return `<td class="${heatCls(v)}">${fmtPct(v)}</td>`; }

function sorted(arr, key, dir) {
  return [...arr].sort((a, b) => {
    const av = a[key] ?? null, bv = b[key] ?? null;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return dir === 'asc' ? av - bv : bv - av;
  });
}

function thSort(key, label) {
  const cls = sortKey === key ? (sortDir === 'desc' ? 'sort-desc' : 'sort-asc') : '';
  return `<th class="${cls}" data-sort="${key}">${label}</th>`;
}

// ─── Aggregation ───────────────────────────────────────────────────────────────
function computeAggregates() {
  countryAggs = MARKETS.map((m) => {
    const rows = marketData[m.slug]?.rows ?? [];
    return { slug: m.slug, label: m.label, rows, ...mkAgg(rows) };
  });

  sectorMap = {};
  for (const m of MARKETS) {
    for (const row of marketData[m.slug]?.rows ?? []) {
      const sec = row.d[1];
      if (!sec) continue;
      if (!sectorMap[sec]) sectorMap[sec] = {};
      if (!sectorMap[sec][m.slug]) sectorMap[sec][m.slug] = [];
      sectorMap[sec][m.slug].push(row);
    }
  }
}

function sectorAgg(sector, filterSlug) {
  const secData = sectorMap[sector] ?? {};
  const rows = filterSlug
    ? (secData[filterSlug] ?? [])
    : Object.values(secData).flat();
  return { rows, ...mkAgg(rows) };
}

// ─── Row cleanup ───────────────────────────────────────────────────────────────
/**
 * Collapse rows that are the same company on different regional venues
 * (XETR/TRADEGATE/GETTEX/FWB/STU/... – confirmed via debug probe to carry
 * identical `description`/market_cap_basic for the same stock) down to one
 * row. Dedupe by description rather than (exchange, symbol): some venues
 * (e.g. Lang & Schwarz / LS, LSX) report the same company under a different,
 * WKN-style numeric symbol, so symbol-based keys miss those duplicates.
 */
function dedupeRows(rows) {
  const seen = new Map();
  for (const row of rows) {
    const colon = row.s.indexOf(':');
    const name = (row.d?.[0] ?? '').trim().toLowerCase();
    const exch = colon === -1 ? row.s : normalizeExchange(row.s.slice(0, colon));
    const symbol = colon === -1 ? '' : row.s.slice(colon + 1);
    const key = name || `${exch}:${symbol}`;
    if (!seen.has(key)) seen.set(key, row);
  }
  return [...seen.values()];
}

// ─── Data loading ──────────────────────────────────────────────────────────────
async function loadData() {
  if (!backendUrl || !secret) return;
  loadIndices();   // fire-and-forget: refresh the macro barometer in parallel
  loading = true; loadDone = 0; marketData = {}; drill = null;
  renderContent();

  const auth = { backendUrl, secret };
  await Promise.allSettled(MARKETS.map(async (m) => {
    try {
      // Confirmed via live debug probe: TradingView's per-market scan includes
      // every stock *tradable* on that market's venues – foreign cross-listings
      // (Nvidia/Apple on Xetra) plus ~10 regional-venue duplicates per company –
      // which flood the fetch budget before distinct domestic companies appear.
      // `is_primary == true` returns exactly one row per company (the primary
      // listing), excluding both the cross-listings and the venue duplicates at
      // the source, so the fetch budget counts distinct companies. Verified:
      // Germany -> 442 distinct names, all on XETR, no foreign leakage.
      const filter = [{ left: 'is_primary', operation: 'equal', right: true }];
      const { rows } = await runScreen({
        market: m.slug, filter, columns: COLUMNS,
        sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' }, count: 10000,
      }, auth);
      marketData[m.slug] = { label: m.label, rows: dedupeRows(rows) };
    } catch {
      marketData[m.slug] = { label: m.label, rows: [] };
    }
    loadDone++;
    const prog = document.getElementById('mkt-progress');
    if (prog) prog.textContent = `⏳ ${loadDone}/${MARKETS.length} Märkte geladen …`;
  }));

  loading = false;
  computeAggregates();
  renderContent();
}

// ─── Setup form (first-run + editable settings) ─────────────────────────────────
function setupBoxHtml() {
  return `
    <div class="setup-box">
      <h2>Backend konfigurieren</h2>
      <p>Gleiche Werte wie im Discovery-Setup (⚙ in der Haupt-App):</p>
      <ul style="font-size:.82rem; color:var(--muted); margin:0 0 1rem; padding-left:1.1rem">
        <li><strong>Backend URL</strong> – die URL deiner Netlify-Site (z.&nbsp;B. <code>https://dein-projekt.netlify.app</code>), in der <code>netlify-backend/</code> deployed ist.</li>
        <li><strong>Shared Secret</strong> – der gleiche Wert wie die Umgebungsvariable <code>DISCOVERY_SECRET</code> auf Netlify.</li>
      </ul>
      <div class="setup-field"><label>Backend URL</label><input id="su-url" type="url" placeholder="https://yoursite.netlify.app" value="${backendUrl ?? ''}" autocomplete="off"></div>
      <div class="setup-field"><label>Shared Secret</label><input id="su-sec" type="password" value="${secret ?? ''}" autocomplete="off"></div>
      <div style="display:flex; gap:.5rem">
        <button class="btn btn-primary btn-sm" id="su-save">Speichern &amp; Laden</button>
        ${backendUrl && secret ? '<button class="btn btn-secondary btn-sm" id="su-cancel">Abbrechen</button>' : ''}
      </div>
    </div>`;
}

function wireSetupBox() {
  document.getElementById('su-save').addEventListener('click', () => {
    const u = document.getElementById('su-url').value.trim();
    const s = document.getElementById('su-sec').value.trim();
    if (!u || !s) { showToast('URL und Secret erforderlich', 'error'); return; }
    localStorage.setItem('discovery_backend_url', u);
    localStorage.setItem('discovery_secret', s);
    backendUrl = u; secret = s;
    render();
    loadData();
  });
  document.getElementById('su-cancel')?.addEventListener('click', render);
}

// ─── PreMarkets quick-link ───────────────────────────────────────────────────────
// Direct jump to CNN's pre-market overview, pinned at the very top of the sub-nav.
function premarketsBarHtml() {
  return `
    <div class="mkt-topbar">
      <a class="premkt-link" href="https://edition.cnn.com/markets/premarkets" target="_blank" rel="noopener"
         title="CNN Pre-Markets in neuem Tab öffnen">📈 PreMarkets ↗</a>
    </div>`;
}

// ─── Macro barometer ─────────────────────────────────────────────────────────────
// A short, simple 1-month sentiment read on the major benchmark indices
// (DAX · NASDAQ · NIKKEI). We take each index's 1-month performance (Perf.1M) and
// derive a *breadth* signal: how many of the three are up over the month, confirmed
// by their mean move. Breadth across the key regions is the classic risk-on/off
// tell. VIX's 1M change is shown as a fear overlay (rising VIX = risk-off) but does
// not alter the equity-breadth verdict.
function loadIndices() {
  if (!backendUrl || !secret) return;
  const tickers = [...MACRO_INDICES.map((i) => i.ticker), VIX_TICKER];
  fetchGlobalQuotes(tickers, INDEX_COLS, { backendUrl, secret })
    .then((map) => { indexData = map; })
    .catch(() => { indexData = null; })
    .finally(renderMacro);
}

function computeMacro() {
  if (!indexData) return null;
  const idx = MACRO_INDICES.map((i) => ({ label: i.label, pm: indexData.get(i.ticker)?.[2] ?? null }));
  const vals = idx.map((i) => i.pm).filter((v) => v != null);
  if (!vals.length) return null;
  const total = vals.length;
  const up = vals.filter((v) => v > 0).length;
  const avg = vals.reduce((a, b) => a + b, 0) / total;   // equal-weighted mean 1M %
  const vix1m = indexData.get(VIX_TICKER)?.[2] ?? null;  // VIX 1M change %
  let regime, cls, arrow;
  if (up >= 2 && avg > 0)      { regime = 'Risk-On';  cls = 'macro-on';      arrow = '▲'; }
  else if (up <= 1 && avg < 0) { regime = 'Risk-Off'; cls = 'macro-off';     arrow = '▼'; }
  else                         { regime = 'Neutral';  cls = 'macro-neutral'; arrow = '▬'; }
  return { idx, up, total, avg, vix1m, regime, cls, arrow };
}

// Coloured 1M chip for one index. `invert` flips the sign→colour mapping for VIX,
// where a rising value (positive %) signals fear and is shown red.
function macroChip(label, v, invert = false) {
  const dir = v == null ? 0 : (invert ? -Math.sign(v) : Math.sign(v));
  const cls = dir > 0 ? 'macro-up' : dir < 0 ? 'macro-down' : '';
  return `<span class="macro-idx">${label}<strong class="${cls}">${fmtPct(v)}</strong></span>`;
}

function renderMacro() {
  const el = document.getElementById('mkt-macro');
  if (!el) return;
  const m = computeMacro();
  if (!m) { el.innerHTML = ''; return; }
  const chips = m.idx.map((i) => macroChip(i.label, i.pm)).join('');
  const vixChip = m.vix1m != null
    ? macroChip('VIX', m.vix1m, true)
    : '';
  el.innerHTML = `
    <div class="macro-bar ${m.cls}" title="1-Monats-Trend der Leitindizes DAX · NASDAQ · NIKKEI">
      <span class="macro-icon">${m.arrow}</span>
      <div class="macro-main">
        <span class="macro-label">Makro-Barometer <span class="macro-sub">· 1M-Trend der Leitindizes</span></span>
        <span class="macro-regime">${m.regime} <span class="macro-breadth">(${m.up}/${m.total} im Plus · Ø ${fmtPct(m.avg)})</span></span>
      </div>
      <div class="macro-stats" title="1-Monats-Performance je Index. VIX rot = steigende Volatilität (Risk-Off).">
        ${chips}${vixChip}
      </div>
    </div>`;
}

// ─── Rendering ─────────────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');

  if (!backendUrl || !secret) {
    app.innerHTML = `
      <div class="mkt-container">
        ${premarketsBarHtml()}
        <div class="mkt-header">
          <a href="../index.html" class="btn btn-secondary btn-sm" style="text-decoration:none">← Discovery</a>
          <h1 class="mkt-title">Markets Performance</h1>
        </div>
        ${setupBoxHtml()}
      </div>`;
    wireSetupBox();
    return;
  }

  app.innerHTML = `
    <div class="mkt-container">
      ${premarketsBarHtml()}
      <div class="mkt-header">
        <a href="../index.html" class="btn btn-secondary btn-sm" style="text-decoration:none; flex-shrink:0">← Discovery</a>
        <h1 class="mkt-title">Markets Performance</h1>
        <button class="btn btn-secondary btn-sm" id="btn-refresh">⟳ Refresh</button>
        <button class="btn btn-secondary btn-sm" id="btn-settings" title="Backend-Einstellungen">⚙</button>
      </div>
      <div class="mkt-tabs">
        <button class="mkt-tab${tab === 'countries' ? ' active' : ''}" id="tab-countries">Länder</button>
        <button class="mkt-tab${tab === 'sectors' ? ' active' : ''}" id="tab-sectors">Sektoren</button>
      </div>
      <div id="mkt-macro"></div>
      <div id="mkt-content"></div>
    </div>`;

  document.getElementById('btn-refresh').addEventListener('click', loadData);
  document.getElementById('btn-settings').addEventListener('click', () => {
    const app2 = document.getElementById('app');
    app2.innerHTML = `
      <div class="mkt-container">
        <div class="mkt-header">
          <a href="../index.html" class="btn btn-secondary btn-sm" style="text-decoration:none">← Discovery</a>
          <h1 class="mkt-title">Markets Performance</h1>
        </div>
        ${setupBoxHtml()}
      </div>`;
    wireSetupBox();
  });
  document.getElementById('tab-countries').addEventListener('click', () => { tab = 'countries'; sortKey = 'pm'; sortDir = 'desc'; drill = null; renderContent(); });
  document.getElementById('tab-sectors').addEventListener('click', () => { tab = 'sectors'; sortKey = 'pm'; sortDir = 'desc'; drill = null; renderContent(); });

  renderContent();
}

function renderContent() {
  const el = document.getElementById('mkt-content');
  if (!el) return;

  renderMacro();

  if (loading) {
    el.innerHTML = `<div class="mkt-progress" id="mkt-progress">⏳ 0/${MARKETS.length} Märkte geladen …</div>
      <p style="color:var(--muted); font-size:.84rem">Alle ${MARKETS.length} Märkte werden parallel abgefragt …</p>`;
    return;
  }

  if (Object.keys(marketData).length === 0) {
    el.innerHTML = `<p class="empty-hint">Noch keine Daten. <button class="btn btn-primary btn-sm" id="start-load" style="margin-left:.4rem">Daten laden</button></p>`;
    document.getElementById('start-load').addEventListener('click', loadData);
    return;
  }

  if (tab === 'countries') renderCountries(el);
  else renderSectors(el);
}

function renderCountries(el) {
  const rows = sorted(countryAggs, sortKey, sortDir).map((r) => {
    const sel = drill?.rootType === 'country' && drill.rootKey === r.slug;
    return `<tr class="${sel ? 'selected' : ''}" data-slug="${r.slug}">
      <td>${r.label}</td>${hc(r.pw)}${hc(r.pm)}${hc(r.pq)}${hc(r.ph)}${hc(r.py)}
      <td class="n-badge-cell"><span class="n-badge">${r.n}</span></td>
      <td class="arrow-cell">→</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <table class="perf-table">
      <thead><tr>
        <th style="text-align:left">Land</th>
        ${PERF_COLS.map((c) => thSort(c.key, c.label)).join('')}
        <th>n</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div id="drill-slot"></div>`;

  wireSort(el);
  el.querySelector('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    const slug = tr.dataset.slug;
    const ca = countryAggs.find((c) => c.slug === slug);
    if (!ca) return;
    drill = {
      rootType: 'country', rootKey: slug, baseTitle: ca.label, baseRows: ca.rows,
      marketSlug: slug, hierarchy: ['sector', 'industry'], path: [],
    };
    openDrillState();
    el.querySelectorAll('tbody tr').forEach((r) => r.classList.toggle('selected', r.dataset.slug === slug));
    renderDrill();
  });

  if (drill?.rootType === 'country') renderDrill();
}

function renderSectors(el) {
  const allSectors = Object.keys(sectorMap);
  const aggs = allSectors.map((sec) => {
    const a = sectorAgg(sec, sectorFilter);
    return { sector: sec, ...a };
  }).filter((r) => r.n > 0);
  const sRows = sorted(aggs, sortKey, sortDir).map((r) => {
    const sel = drill?.rootType === 'sector' && drill.rootKey === r.sector;
    return `<tr class="${sel ? 'selected' : ''}" data-sector="${r.sector}">
      <td>${r.sector}</td>${hc(r.pw)}${hc(r.pm)}${hc(r.pq)}${hc(r.ph)}${hc(r.py)}
      <td class="n-badge-cell"><span class="n-badge">${r.n}</span></td>
      <td class="arrow-cell">→</td>
    </tr>`;
  }).join('');

  const mktOptions = MARKETS.map((m) =>
    `<option value="${m.slug}"${sectorFilter === m.slug ? ' selected' : ''}>${m.label}</option>`
  ).join('');

  el.innerHTML = `
    <div class="mkt-sector-bar">
      <label for="mkt-filter" style="color:var(--muted)">Markt:</label>
      <select class="filter-select" id="mkt-filter" style="width:auto">
        <option value="">Alle Märkte</option>
        ${mktOptions}
      </select>
    </div>
    <table class="perf-table">
      <thead><tr>
        <th style="text-align:left">Sektor</th>
        ${PERF_COLS.map((c) => thSort(c.key, c.label)).join('')}
        <th>n</th><th></th>
      </tr></thead>
      <tbody>${sRows}</tbody>
    </table>
    <div id="drill-slot"></div>`;

  document.getElementById('mkt-filter').addEventListener('change', (e) => {
    sectorFilter = e.target.value;
    drill = null;
    renderSectors(el);
  });

  wireSort(el);
  el.querySelector('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-sector]');
    if (!tr) return;
    const sector = tr.dataset.sector;
    const mktLabel = sectorFilter
      ? MARKETS.find((m) => m.slug === sectorFilter)?.label ?? sectorFilter
      : 'Alle Märkte';
    const a = sectorAgg(sector, sectorFilter);
    drill = {
      rootType: 'sector', rootKey: sector, baseTitle: `${sector} — ${mktLabel}`,
      baseRows: a.rows, marketSlug: sectorFilter || null, hierarchy: ['industry'], path: [],
    };
    openDrillState();
    el.querySelectorAll('tbody tr').forEach((r) => r.classList.toggle('selected', r.dataset.sector === sector));
    renderDrill();
  });

  if (drill?.rootType === 'sector') renderDrill();
}

function wireSort(el) {
  el.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortKey === key) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
      else { sortKey = key; sortDir = 'desc'; }
      drill = null;
      renderContent();
    });
  });
}

// ─── Drill-down panel ──────────────────────────────────────────────────────────
// Columns shown in the drill table; all are sortable. idx maps to the row.d index
// (or null for symbol, which lives on row.s rather than row.d).
const DRILL_COLS = [
  { key: 'sym',  label: 'Symbol', idx: null, align: 'left' },
  { key: 'name', label: 'Name',   idx: 0,    align: 'left' },
  { key: 'pw',   label: '1W',     idx: 2 },
  { key: 'pm',   label: '1M',     idx: 3 },
  { key: 'pq',   label: '3M',     idx: 4 },
  { key: 'ph',   label: '6M',     idx: 5 },
  { key: 'py',   label: '1J',     idx: 6 },
  { key: 'mcap', label: 'MCap',   idx: 7 },
];

const symOf = (row) => (row.s.includes(':') ? row.s.split(':')[1] : row.s);

// Aggregate dimensions and where each value lives in row.d.
const DIMS = {
  sector:   { idx: 1, label: 'Sektor' },
  industry: { idx: 8, label: 'Industrie' },
};
// Perf keys valid for sorting an aggregate (group) table.
const AGG_SORT_KEYS = new Set(PERF_COLS.map((c) => c.key));

/** Reset per-drill state when a new root row is opened: clear selection, seed sort. */
function openDrillState() {
  drillSelected = new Set();
  // Seed the drill sort from whichever perf column the outer table is sorted by.
  drillSort = { key: KEY_TO_IDX[sortKey] ? sortKey : 'pm', dir: 'desc' };
}

/** baseRows narrowed by every {dim,value} filter currently on the drill path. */
function drillFiltered() {
  let rows = drill.baseRows;
  for (const p of drill.path) {
    const idx = DIMS[p.dim].idx;
    rows = rows.filter((r) => ((r.d[idx] ?? '') || '—') === p.value);
  }
  return rows;
}

/** Group rows by an aggregate dimension, computing weighted perf per group. */
function groupAgg(rows, dimIdx) {
  const groups = new Map();
  for (const row of rows) {
    const key = (row.d[dimIdx] ?? '') || '—';
    let g = groups.get(key);
    if (!g) { g = []; groups.set(key, g); }
    g.push(row);
  }
  return [...groups.entries()].map(([value, grp]) => ({ value, rows: grp, ...mkAgg(grp) }));
}

/** Clickable breadcrumb trail (root › dim › dim …). */
function drillHeaderHtml(countText, controlsHtml) {
  const crumbStyle = 'background:none; border:none; padding:0; cursor:pointer; color:var(--accent,#2563eb); font-weight:600; font-size:.95rem';
  const crumbs = [`<button class="mkt-crumb" data-depth="0" style="${crumbStyle}">${drill.baseTitle}</button>`];
  drill.path.forEach((p, i) => {
    crumbs.push(`<span style="color:var(--muted)"> › </span>`);
    crumbs.push(`<button class="mkt-crumb" data-depth="${i + 1}" style="${crumbStyle}">${p.value}</button>`);
  });
  return `
    <div class="drill-header">
      <div class="drill-title" style="display:flex; flex-wrap:wrap; align-items:center; gap:.15rem">${crumbs.join('')}</div>
      <span class="drill-count">${countText}</span>
      <div style="display:flex; gap:.4rem; align-items:center; margin-left:auto">
        ${controlsHtml}
        <button class="drill-close" id="drill-close">✕</button>
      </div>
    </div>`;
}

/** Wire breadcrumb + close, shared by both drill views. */
function wireDrillCommon(slot) {
  slot.querySelectorAll('.mkt-crumb').forEach((b) => b.addEventListener('click', () => {
    drill.path = drill.path.slice(0, Number(b.dataset.depth));
    drillSelected = new Set();
    renderDrill();
  }));
  slot.querySelector('#drill-close')?.addEventListener('click', closeDrill);
}

function closeDrill() {
  drill = null;
  drillSelected = new Set();
  const slot = document.getElementById('drill-slot');
  if (slot) slot.innerHTML = '';
  document.querySelectorAll('.perf-table tbody tr.selected').forEach((r) => r.classList.remove('selected'));
}

/** Route to the aggregate (group) view or the leaf (ticker) view by path depth. */
function renderDrill() {
  const slot = document.getElementById('drill-slot');
  if (!slot || !drill) return;
  const filtered = drillFiltered();
  const depth = drill.path.length;
  if (depth < drill.hierarchy.length) renderDrillGroups(slot, filtered, drill.hierarchy[depth]);
  else renderDrillTickers(slot, filtered);
}

function renderDrillGroups(slot, rows, dim) {
  const dimDef = DIMS[dim];
  const aggs = groupAgg(rows, dimDef.idx);
  const key = AGG_SORT_KEYS.has(drillSort.key) ? drillSort.key : 'pm';
  const sortedAggs = sorted(aggs, key, drillSort.dir);

  const client = loadStorageClient();
  const importAll = client
    ? `<button class="btn btn-secondary btn-sm" id="drill-import-all">Import alle (${rows.length})</button>`
    : '';

  const bodyRows = sortedAggs.map((a) => `
    <tr data-group="${encodeURIComponent(a.value)}">
      <td style="text-align:left">${a.value}</td>
      ${hc(a.pw)}${hc(a.pm)}${hc(a.pq)}${hc(a.ph)}${hc(a.py)}
      <td class="n-badge-cell"><span class="n-badge">${a.n}</span></td>
      <td class="arrow-cell">→</td>
    </tr>`).join('');

  const head = PERF_COLS.map((c) => {
    const cls = key === c.key ? (drillSort.dir === 'desc' ? 'sort-desc' : 'sort-asc') : '';
    return `<th class="${cls}" data-dsort="${c.key}">${c.label}</th>`;
  }).join('');

  slot.innerHTML = `
    <div class="drill-panel">
      ${drillHeaderHtml(`${aggs.length} ${dimDef.label} · ${rows.length} Unternehmen`, importAll)}
      <div class="drill-scroll">
        <table class="perf-table">
          <thead><tr>
            <th style="text-align:left">${dimDef.label}</th>
            ${head}
            <th>n</th><th></th>
          </tr></thead>
          <tbody>${bodyRows || '<tr><td colspan="8" style="text-align:center; color:var(--muted); padding:1rem">Keine Daten</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  wireDrillCommon(slot);

  slot.querySelectorAll('th[data-dsort]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.dsort;
    if (drillSort.key === k) drillSort.dir = drillSort.dir === 'desc' ? 'asc' : 'desc';
    else drillSort = { key: k, dir: 'desc' };
    renderDrill();
  }));

  slot.querySelector('tbody')?.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-group]');
    if (!tr) return;
    drill.path = [...drill.path, { dim, value: decodeURIComponent(tr.dataset.group) }];
    drillSelected = new Set();
    renderDrill();
  });

  if (client) slot.querySelector('#drill-import-all')?.addEventListener('click', () => doImport(client, rows));
}

/** Sort leaf ticker rows by the current drillSort. Nulls always sort last. */
function drillSortedRows(rows) {
  const { key, dir } = drillSort;
  const mul = dir === 'asc' ? 1 : -1;
  const out = [...rows];
  if (key === 'sym' || key === 'name') {
    out.sort((a, b) => {
      const av = key === 'sym' ? symOf(a) : (a.d[0] ?? '');
      const bv = key === 'sym' ? symOf(b) : (b.d[0] ?? '');
      return mul * String(av).localeCompare(String(bv), 'de');
    });
  } else {
    const idx = DRILL_COLS.find((c) => c.key === key)?.idx ?? 3;
    out.sort((a, b) => {
      const av = a.d[idx], bv = b.d[idx];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return mul * (av - bv);
    });
  }
  return out;
}

function renderDrillTickers(slot, baseRows) {
  const rows = drillSortedRows(baseRows);

  const stockRows = rows.map((row) => {
    const d = row.d;
    const sym = symOf(row);
    const name = d[0] ?? sym;
    const checked = drillSelected.has(row.s) ? 'checked' : '';
    return `<tr data-s="${row.s}">
      <td style="text-align:center; width:1.8rem"><input type="checkbox" class="drill-check" data-s="${row.s}" ${checked}></td>
      <td><strong>${sym}</strong></td>
      <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; font-size:.8rem; color:var(--muted)">${name}</td>
      ${hc(d[2])}${hc(d[3])}${hc(d[4])}${hc(d[5])}${hc(d[6])}
      <td style="color:var(--muted); font-size:.75rem">${fmtMcap(d[7])}</td>
    </tr>`;
  }).join('');

  const headCells = DRILL_COLS.map((c) => {
    const cls = drillSort.key === c.key ? (drillSort.dir === 'desc' ? 'sort-desc' : 'sort-asc') : '';
    const style = c.align === 'left' ? ' style="text-align:left"' : '';
    return `<th class="${cls}" data-dsort="${c.key}"${style}>${c.label}</th>`;
  }).join('');

  const client = loadStorageClient();
  const importBtn = client
    ? `<button class="btn btn-primary btn-sm" id="drill-import" disabled>Import (0)</button>`
    : `<span style="font-size:.75rem; color:var(--muted)">Kein Backend</span>`;

  slot.innerHTML = `
    <div class="drill-panel">
      ${drillHeaderHtml(`${rows.length} Unternehmen · <span id="drill-sel-count">0</span> ausgewählt`, importBtn)}
      <div class="drill-scroll">
        <table class="perf-table">
          <thead><tr>
            <th style="width:1.8rem; text-align:center"><input type="checkbox" id="drill-check-all" title="Alle auswählen"></th>
            ${headCells}
          </tr></thead>
          <tbody>${stockRows || '<tr><td colspan="9" style="text-align:center; color:var(--muted); padding:1rem">Keine Daten</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  wireDrillCommon(slot);

  slot.querySelectorAll('th[data-dsort]').forEach((th) => th.addEventListener('click', () => {
    const key = th.dataset.dsort;
    if (drillSort.key === key) drillSort.dir = drillSort.dir === 'desc' ? 'asc' : 'desc';
    else drillSort = { key, dir: key === 'sym' || key === 'name' ? 'asc' : 'desc' };
    renderDrill();
  }));

  slot.querySelector('tbody')?.addEventListener('change', (e) => {
    const cb = e.target.closest('.drill-check');
    if (!cb) return;
    if (cb.checked) drillSelected.add(cb.dataset.s);
    else drillSelected.delete(cb.dataset.s);
    syncDrillSelectionUI(slot, rows.length);
  });

  const checkAll = slot.querySelector('#drill-check-all');
  checkAll?.addEventListener('change', () => {
    if (checkAll.checked) rows.forEach((r) => drillSelected.add(r.s));
    else rows.forEach((r) => drillSelected.delete(r.s));
    slot.querySelectorAll('.drill-check').forEach((cb) => { cb.checked = checkAll.checked; });
    syncDrillSelectionUI(slot, rows.length);
  });

  if (client) slot.querySelector('#drill-import')?.addEventListener('click', () => {
    doImport(client, rows.filter((r) => drillSelected.has(r.s)));
  });

  syncDrillSelectionUI(slot, rows.length);
}

/** Update the selected-count badge, import button label/disabled, and check-all state. */
function syncDrillSelectionUI(slot, total) {
  const n = drillSelected.size;
  const cnt = slot.querySelector('#drill-sel-count');
  if (cnt) cnt.textContent = String(n);
  const btn = slot.querySelector('#drill-import');
  if (btn) { btn.textContent = `Import (${n})`; btn.disabled = n === 0; }
  const checkAll = slot.querySelector('#drill-check-all');
  if (checkAll) {
    checkAll.checked = n > 0 && n === total;
    checkAll.indeterminate = n > 0 && n < total;
  }
}

async function doImport(client, rows) {
  if (!rows.length) return;
  document.querySelectorAll('#drill-import, #drill-import-all').forEach((b) => {
    b.disabled = true; b.textContent = '⏳ …';
  });

  // Title for the source record = the current breadcrumb (root › sector › industry).
  const presetLabel = [drill.baseTitle, ...drill.path.map((p) => p.value)].join(' › ');

  // Group rows by their market slug so rowsToCandidates gets the correct yahooSuffix
  const byMarket = {};
  for (const row of rows) {
    const prefix = row.s.split(':')[0];
    const exch = normalizeExchange(prefix);
    const slug = EXCHANGE_TO_SLUG[exch] ?? drill.marketSlug ?? 'america';
    (byMarket[slug] ??= []).push(row);
  }

  let added = 0, merged = 0, skipped = 0, errors = 0;
  const sourceUrl = `https://scanner.tradingview.com/scan`;
  for (const [slug, mRows] of Object.entries(byMarket)) {
    const candidates = rowsToCandidates(mRows, {
      market: slug,
      columns: COLUMNS,
      presetId: null,
      presetLabel,
      filter: [],
      sourceUrl,
    });
    for (const c of candidates) {
      try {
        const r = await client.appendCandidate(c);
        if (r.action === 'inserted' || r.action === 'added') added++;
        else if (r.action === 'merged') merged++;
        else skipped++;
      } catch { errors++; }
    }
  }

  // Clear selection and re-render the current drill view (resets checkboxes/buttons).
  drillSelected = new Set();
  renderDrill();
  showToast(
    `✓ ${added} neu, ${merged} gemergt${skipped ? `, ${skipped} übersprungen` : ''}${errors ? `, ${errors} Fehler` : ''}`,
    errors ? 'error' : 'success'
  );
}

// ─── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  if (type === 'success') el.style.borderLeftColor = 'var(--pos)';
  if (type === 'error')   el.style.borderLeftColor = 'var(--neg)';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

// ─── Debug: dump raw scanner rows so we can inspect real field values ───────────
// Open  markets/?debug=germany  (or any market slug) to fetch that market with
// diagnostic columns and render the raw rows as copyable JSON. This is how we
// find out what TradingView actually returns for country / exchange / primary
// flags – instead of guessing field formats and breaking the live tables.
const DEBUG_COLUMNS = [
  'description', 'sector', 'industry', 'submarket', 'country', 'exchange',
  'is_primary', 'is_symbol_primary_listing', 'type', 'currency', 'market_cap_basic',
];

async function runDebug(slug, params) {
  const app = document.getElementById('app');
  const market = MARKETS.find((m) => m.slug === slug) || { slug, label: slug };

  if (!backendUrl || !secret) {
    app.innerHTML = `<div class="mkt-container"><p class="empty-hint">Erst Backend konfigurieren (öffne die Markets-Seite ohne <code>?debug=</code>), dann erneut versuchen.</p></div>`;
    return;
  }

  // Optional server-side test filter via ?filterField=country&filterValue=Germany,
  // so we can directly probe whether a candidate filter approach even returns rows
  // before wiring it into the live dashboard. "true"/"false" are coerced to real
  // booleans since boolean scanner columns (is_primary, ...) likely reject the
  // bare query-string value "true".
  const filterField = params.get('filterField');
  const rawFilterValue = params.get('filterValue');
  const filterValue = rawFilterValue === 'true' ? true : rawFilterValue === 'false' ? false : rawFilterValue;
  const extraFilter = filterField && rawFilterValue != null ? [{ left: filterField, operation: 'equal', right: filterValue }] : [];

  app.innerHTML = `<div class="mkt-container"><h1 class="mkt-title">Debug: ${market.label} (${slug})</h1><p class="empty-hint">⏳ Lade Rohdaten …</p></div>`;

  let payload;
  try {
    const { totalCount, rows } = await runScreen({
      market: slug, filter: extraFilter, columns: DEBUG_COLUMNS,
      sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' }, count: 40,
    }, { backendUrl, secret });
    payload = {
      market: slug,
      filter: extraFilter,
      totalCount,
      columns: DEBUG_COLUMNS,
      rows: rows.map((r) => {
        const obj = { s: r.s };
        DEBUG_COLUMNS.forEach((c, i) => { obj[c] = r.d[i] ?? null; });
        return obj;
      }),
    };
  } catch (err) {
    payload = { market: slug, filter: extraFilter, error: String(err?.message ?? err) };
  }

  const json = JSON.stringify(payload, null, 2);
  app.innerHTML = `
    <div class="mkt-container">
      <div class="mkt-header">
        <a href="index.html" class="btn btn-secondary btn-sm" style="text-decoration:none">← Markets</a>
        <h1 class="mkt-title">Debug: ${market.label} (${slug})</h1>
        <button class="btn btn-primary btn-sm" id="dbg-copy">Kopieren</button>
      </div>
      <p style="font-size:.84rem; color:var(--muted)">Top 40 nach Market Cap. Mit <code>&filterField=country&filterValue=Germany</code> kann zusätzlich ein Test-Filter serverseitig angehängt werden. Bitte diesen JSON kopieren und mir schicken.</p>
      <pre id="dbg-json" style="white-space:pre-wrap; word-break:break-all; font-size:.72rem; background:var(--panel,#f4f4f4); padding:1rem; border-radius:6px; max-height:75vh; overflow:auto">${json.replace(/</g, '&lt;')}</pre>
    </div>`;
  document.getElementById('dbg-copy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(json); showToast('JSON kopiert', 'success'); }
    catch { showToast('Kopieren fehlgeschlagen – manuell markieren', 'error'); }
  });
}

// ─── Init ──────────────────────────────────────────────────────────────────────
applyTheme();
readSettings();
const urlParams = new URLSearchParams(location.search);
const debugSlug = urlParams.get('debug');
if (debugSlug) {
  runDebug(debugSlug, urlParams);
} else {
  render();
  if (backendUrl && secret) loadData();
}
