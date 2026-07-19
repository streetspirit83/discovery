/**
 * Sektoren-Heatmap – Performance der 5 Mega-Cluster als Heat-Grid.
 *
 * Zeilen = Mega-Cluster (sector-clusters.js), Spalten = 1W / 1M / 3M / 6M.
 * Zellwert = Median der TV-Performance (perf_w/1m/3m/6m) aller aktiven
 * Kandidaten (inbox+watch+export, dedupliziert) im Cluster; n = Stichprobe.
 * Median statt Mittelwert, damit einzelne Ausreißer das Bild nicht kippen.
 * Zellfarbe: Token-Mix (--pos/--neg in --surface-2), Intensität ∝ |Wert|.
 */

import { MEGA_CLUSTERS, megaClusterOf } from '../lib/sector-clusters.js?v=20260719b';

const HORIZONS = [
  { key: 'perf_w',  label: '1W' },
  { key: 'perf_1m', label: '1M' },
  { key: 'perf_3m', label: '3M' },
  { key: 'perf_6m', label: '6M' },
];

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const fmtPct = (v) => (v == null ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);

/* Zell-Hintergrund: Token-Farbe in die Fläche gemischt; ±15% = volle Sättigung
 * (gekappt bei 55% Mischanteil, damit Text lesbar bleibt). */
function cellStyle(v) {
  if (v == null) return '';
  const tone = v >= 0 ? 'var(--pos)' : 'var(--neg)';
  const pct = Math.min(Math.abs(v) / 15, 1) * 55;
  return `background:color-mix(in srgb, ${tone} ${pct.toFixed(0)}%, var(--surface-2))`;
}

/** Aggregation: je Cluster × Horizont { v: Median-%, n: Stichprobe } + Basis-
 *  Statistik, damit die Fußnote transparent macht, was ein-/ausgeschlossen ist. */
export function aggregateHeat(candidates) {
  const byCluster = new Map(MEGA_CLUSTERS.map((m) => [m.key, []]));
  const stats = { total: 0, noTv: 0, noSector: 0, included: 0 };
  for (const c of candidates ?? []) {
    stats.total++;
    const key = megaClusterOf(c.sector);
    if (!c.tv_data) { stats.noTv++; continue; }
    if (!key)       { stats.noSector++; continue; }   // kein/nicht-gemappter Sektor
    byCluster.get(key).push(c.tv_data);
    stats.included++;
  }
  const rows = MEGA_CLUSTERS.map((m) => ({
    ...m,
    members: byCluster.get(m.key).length,
    cells: HORIZONS.map((h) => {
      const vals = byCluster.get(m.key).map((tv) => tv[h.key]).filter((v) => v != null);
      return { label: h.label, v: median(vals), n: vals.length };
    }),
  }));
  return { rows, stats };
}

/**
 * @param {HTMLElement} container leerer Host (Sektoren-Pane im Markets-Modal)
 * @param {{ getCandidates?: () => Promise<Array> }} opts
 */
export function renderSectorHeatmap(container, { getCandidates } = {}) {
  container.innerHTML = `<div class="heat-loading">Sektoren werden geladen …</div>`;

  (async () => {
    let candidates = [];
    try { candidates = (await getCandidates?.()) ?? []; } catch { /* leer rendern */ }
    const { rows, stats } = aggregateHeat(candidates);

    if (!stats.included) {
      container.innerHTML = `<div class="heat-loading">Keine Kandidaten mit Sektor + TV-Daten (${stats.total} aktiv, davon ${stats.noTv} ohne TV-Daten, ${stats.noSector} ohne gemappten Sektor).</div>`;
      return;
    }

    container.innerHTML = `
      <div class="heat-grid" role="table" aria-label="Mega-Cluster Performance">
        <div class="heat-row heat-row--head" role="row">
          <span class="heat-name"></span>
          ${HORIZONS.map((h) => `<span class="heat-col" role="columnheader">${h.label}</span>`).join('')}
        </div>
        ${rows.map((r) => `
          <div class="heat-row" role="row">
            <span class="heat-name" title="${r.members} Kandidaten im Cluster">${r.label}<small>n=${r.members}</small></span>
            ${r.cells.map((cell) => `
              <span class="heat-cell" role="cell" style="${cellStyle(cell.v)}"
                title="${r.label} · ${cell.label}: Median ${fmtPct(cell.v)} aus ${cell.n} Werten">
                ${fmtPct(cell.v)}
              </span>`).join('')}
          </div>`).join('')}
      </div>
      <p class="heat-note">Median der TV-Performance je Mega-Cluster · Farbskala ±15%.
        Basis: ${stats.total} Kandidaten (Inbox + Watch + Export + Archiv, dedupliziert) →
        <b>${stats.included}</b> mit Sektor & TV-Daten${stats.noSector ? ` · ${stats.noSector} ohne (gemappten) Sektor` : ''}${stats.noTv ? ` · ${stats.noTv} ohne TV-Daten` : ''}.</p>`;
  })();
}
