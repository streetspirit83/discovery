/**
 * Sub-Sektor-Heatmap im Monitor-Reiter „Dynamik“ (reine Logik, kein DOM).
 *
 * Gruppiert den Ausschnitt nach `sub_sector` (TradingView-Industry) und rechnet je Gruppe den
 * Median der Performance für 1T · 1W · 1M · 3M (dieselben Felder und Farbkappen wie die
 * Treemap im Markets-Modal, `HORIZONS` in market-scope.js) sowie die Breite (Anteil der Titel
 * mit positiver Performance im gewählten Horizont).
 */

import { HORIZONS, dimsOf, median } from './market-scope.js?v=20261116d';

export { HORIZONS };
export const NO_SUB = 'Ohne Sub-Sektor';

const val = (c, key) => {
  const v = c?.tv_data?.[key];
  return v == null || Number.isNaN(Number(v)) ? null : Number(v);
};

/** Häufigster Wert einer Liste (für Sektor/Cluster einer Sub-Sektor-Gruppe). */
function mode(list) {
  const n = new Map();
  for (const x of list) if (x) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

/**
 * @param {object[]} cands  Kandidaten des Ausschnitts
 * @returns {{rows: Array<{name, sector, mega, items, med:Object<string,number|null>, up:Object<string,number|null>}>, missing:number}}
 *   `up[key]` = Anteil (0–100) der Titel mit Wert > 0 im Horizont.
 */
export function subsectorRows(cands) {
  const groups = new Map();
  let missing = 0;
  for (const c of cands ?? []) {
    if (!c?.sub_sector) { missing++; continue; }
    if (!groups.has(c.sub_sector)) groups.set(c.sub_sector, []);
    groups.get(c.sub_sector).push(c);
  }
  const rows = [...groups].map(([name, items]) => {
    const med = {}, up = {};
    for (const h of HORIZONS) {
      const vs = items.map((c) => val(c, h.key)).filter((v) => v != null);
      med[h.key] = median(vs);
      up[h.key] = vs.length ? Math.round((vs.filter((v) => v > 0).length / vs.length) * 100) : null;
    }
    return { name, items, med, up,
      sector: mode(items.map((c) => c.sector)), mega: mode(items.map((c) => dimsOf(c).mega)) };
  });
  return { rows, missing };
}

/**
 * Filter + Sortierung. `st` = { hz, dir:'all'|'up'|'down', min, sort:'perf'|'n'|'name', asc };
 * 'perf' sortiert nach dem Median im Horizont `hz`.
 */
export function filterRows(rows, st) {
  const out = rows.filter((r) => {
    if (r.items.length < (st.min ?? 1)) return false;
    const m = r.med[st.hz];
    if (st.dir === 'up') return m != null && m > 0;
    if (st.dir === 'down') return m != null && m < 0;
    return true;
  });
  const dir = st.asc ? 1 : -1;
  out.sort((a, b) => {
    if (st.sort === 'name') return a.name.localeCompare(b.name, 'de') * dir;
    if (st.sort === 'n') return (a.items.length - b.items.length) * dir || a.name.localeCompare(b.name, 'de');
    const va = a.med[st.hz], vb = b.med[st.hz];
    if (va == null && vb == null) return a.name.localeCompare(b.name, 'de');
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * dir || b.items.length - a.items.length;
  });
  return out;
}

/** Titel einer Gruppe nach Performance im Horizont (beste zuerst, ohne Wert am Ende). */
export function membersOf(row, hz) {
  return [...row.items].sort((a, b) => (val(b, hz) ?? -1e9) - (val(a, hz) ?? -1e9));
}

export const perfOf = val;
