import { runScreen, rowsToCandidates } from '../lib/tv-screener.js';
import { MARKETS, TV_PREFIX_TO_EXCHANGE } from '../lib/tv-fields.js';
import { loadStorageClient } from '../lib/storage-client.js';

// ─── Column layout sent to the TradingView scanner ─────────────────────────────
const COLUMNS = ['description', 'sector', 'Perf.W', 'Perf.1M', 'Perf.3M', 'Perf.6M', 'Perf.Y', 'market_cap_basic'];
// d[0]=name  d[1]=sector  d[2]=1W  d[3]=1M  d[4]=3M  d[5]=6M  d[6]=1Y  d[7]=mcap

const PERF_COLS = [
  { key: 'pw', label: '1W', idx: 2 },
  { key: 'pm', label: '1M', idx: 3 },
  { key: 'pq', label: '3M', idx: 4 },
  { key: 'ph', label: '6M', idx: 5 },
  { key: 'py', label: '1J', idx: 6 },
];
const KEY_TO_IDX = Object.fromEntries(PERF_COLS.map((c) => [c.key, c.idx]));

// Build a map of TV exchange prefix → market slug for per-row market attribution
const PREFIX_TO_SLUG = (() => {
  const map = {};
  for (const m of MARKETS) {
    for (const exch of m.exchanges) {
      for (const [prefix, code] of Object.entries(TV_PREFIX_TO_EXCHANGE)) {
        if (code === exch) map[prefix] = m.slug;
      }
    }
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
let drill = null;       // { title, rows, marketSlug } or null
let loading = false, loadDone = 0;

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

// ─── Data loading ──────────────────────────────────────────────────────────────
async function loadData() {
  if (!backendUrl || !secret) return;
  loading = true; loadDone = 0; marketData = {}; drill = null;
  renderContent();

  const auth = { backendUrl, secret };
  await Promise.allSettled(MARKETS.map(async (m) => {
    try {
      const { rows } = await runScreen({
        market: m.slug, filter: [], columns: COLUMNS,
        sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' }, count: 500,
      }, auth);
      marketData[m.slug] = { label: m.label, rows };
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

// ─── Rendering ─────────────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');

  if (!backendUrl || !secret) {
    app.innerHTML = `
      <div class="mkt-container">
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
    const sel = drill?.type === 'country' && drill.slug === r.slug;
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
    drill = { type: 'country', slug, title: ca.label, rows: ca.rows, marketSlug: slug };
    el.querySelectorAll('tbody tr').forEach((r) => r.classList.toggle('selected', r.dataset.slug === slug));
    renderDrill();
  });

  if (drill?.type === 'country') renderDrill();
}

function renderSectors(el) {
  const allSectors = Object.keys(sectorMap);
  const aggs = allSectors.map((sec) => {
    const a = sectorAgg(sec, sectorFilter);
    return { sector: sec, ...a };
  }).filter((r) => r.n > 0);
  const sRows = sorted(aggs, sortKey, sortDir).map((r) => {
    const sel = drill?.type === 'sector' && drill.sector === r.sector;
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
    drill = { type: 'sector', sector, title: `${sector} — ${mktLabel}`, rows: a.rows, marketSlug: sectorFilter || null };
    el.querySelectorAll('tbody tr').forEach((r) => r.classList.toggle('selected', r.dataset.sector === sector));
    renderDrill();
  });

  if (drill?.type === 'sector') renderDrill();
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
function renderDrill() {
  const slot = document.getElementById('drill-slot');
  if (!slot || !drill) return;

  const idx = KEY_TO_IDX[sortKey];
  const top20 = [...drill.rows]
    .filter((r) => r.d[idx] != null)
    .sort((a, b) => sortDir === 'desc' ? b.d[idx] - a.d[idx] : a.d[idx] - b.d[idx])
    .slice(0, 20);

  const stockRows = top20.map((row, i) => {
    const d = row.d;
    const sym = row.s.includes(':') ? row.s.split(':')[1] : row.s;
    const name = d[0] ?? sym;
    return `<tr>
      <td style="color:var(--muted); width:1.6rem; font-size:.75rem">${i + 1}</td>
      <td><strong>${sym}</strong></td>
      <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; font-size:.8rem; color:var(--muted)">${name}</td>
      ${hc(d[2])}${hc(d[3])}${hc(d[4])}${hc(d[5])}${hc(d[6])}
      <td style="color:var(--muted); font-size:.75rem">${fmtMcap(d[7])}</td>
    </tr>`;
  }).join('');

  const client = loadStorageClient();
  const importBtn = client
    ? `<button class="btn btn-primary btn-sm" id="drill-import">Import (${top20.length})</button>`
    : `<span style="font-size:.75rem; color:var(--muted)">Kein Backend</span>`;

  slot.innerHTML = `
    <div class="drill-panel">
      <div class="drill-header">
        <h2 class="drill-title">${drill.title}</h2>
        <div style="display:flex; gap:.4rem; align-items:center">
          ${importBtn}
          <button class="drill-close" id="drill-close">✕</button>
        </div>
      </div>
      <table class="perf-table">
        <thead><tr>
          <th></th>
          <th style="text-align:left">Symbol</th>
          <th style="text-align:left">Name</th>
          ${PERF_COLS.map((c) => `<th>${c.label}</th>`).join('')}
          <th>MCap</th>
        </tr></thead>
        <tbody>${stockRows || '<tr><td colspan="9" style="text-align:center; color:var(--muted); padding:1rem">Keine Daten</td></tr>'}</tbody>
      </table>
    </div>`;

  document.getElementById('drill-close').addEventListener('click', () => {
    drill = null;
    slot.innerHTML = '';
    document.querySelectorAll('tbody tr.selected').forEach((r) => r.classList.remove('selected'));
  });

  if (client) {
    document.getElementById('drill-import')?.addEventListener('click', () => doImport(client, top20));
  }
}

async function doImport(client, rows) {
  const btn = document.getElementById('drill-import');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ …'; }

  // Group rows by their market slug so rowsToCandidates gets the correct yahooSuffix
  const byMarket = {};
  for (const row of rows) {
    const prefix = row.s.split(':')[0];
    const slug = PREFIX_TO_SLUG[prefix] ?? drill.marketSlug ?? 'america';
    (byMarket[slug] ??= []).push(row);
  }

  let added = 0, merged = 0, skipped = 0, errors = 0;
  const sourceUrl = `https://scanner.tradingview.com/scan`;
  for (const [slug, mRows] of Object.entries(byMarket)) {
    const candidates = rowsToCandidates(mRows, {
      market: slug,
      columns: COLUMNS,
      presetId: null,
      presetLabel: drill.title,
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

  if (btn) { btn.disabled = false; btn.textContent = `Import (${rows.length})`; }
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

// ─── Init ──────────────────────────────────────────────────────────────────────
applyTheme();
readSettings();
render();
if (backendUrl && secret) loadData();
