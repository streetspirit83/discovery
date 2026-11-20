/**
 * Signal-Matrix im Monitor-Reiter „Dynamik“: Zeilen = Gruppen des Ausschnitts (Mega-Cluster,
 * Sektoren, Sub-Sektoren bzw. die Einzeltitel auf der untersten Ebene), Spalten = Signale
 * aus lib/market-signals.js. Jede Zelle zeigt die Anzahl der Titel; die gewählte Zelle ist
 * markiert. Ihre Titel (mit „In Tabelle öffnen“) stehen nicht hier, sondern in der
 * gemeinsamen Trefferliste ganz unten im Reiter (setup-matrix.js).
 *
 * Reine Darstellung. Klicks wertet dashboard-modal.js aus: `data-sig-col` + `data-sig-row`
 * (Zeilenindex oder `all`).
 */

import { SIGNAL_GROUPS } from '../lib/market-signals.js?v=20261116c';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const TONE = { bull: '--pos', bear: '--neg', extreme: '--warn' };

function cellStyle(n, group) {
  if (!n) return '';
  const pct = Math.min(10 + n * 9, 55);
  return `background:color-mix(in srgb, var(${TONE[group]}) ${pct}%, var(--surface-2))`;
}

/**
 * @param {object}   p
 * @param {Array}    p.columns   aus signalColumns()
 * @param {Array}    p.rows      [{ name, items:[Kandidat], c? }] – `c` gesetzt = Einzeltitel
 * @param {string}   p.rowTitle  Kopf der ersten Spalte („Sektor“, „Land“, „Titel“ …)
 * @param {{row:string, col:string}|null} p.sel  gewählte Zelle (`row` = Index oder 'all')
 * @param {boolean}  p.drill     Gruppenzeilen sind Knöpfe (`data-sig-drill` = Name) für die nächste Ebene
 */
export function signalMatrixHtml({ columns, rows, rowTitle, sel, drill = false }) {
  if (!rows.length) return '<p class="dash-empty">Keine Titel im Ausschnitt.</p>';
  const sets = rows.map((r) => new Set(r.items));
  const hitsOf = (col, ri) => (ri === 'all' ? col.rows : col.rows.filter((x) => sets[ri].has(x.c)));
  const isSel = (ri, col) => sel && String(sel.row) === String(ri) && sel.col === col.key;
  const cell = (col, ri, label) => {
    const n = hitsOf(col, ri).length;
    return `<button type="button" class="sx-cell${isSel(ri, col) ? ' is-sel' : ''}" data-sig-row="${ri}" data-sig-col="${col.key}"
      style="${cellStyle(n, col.group)}" title="${esc(`${label} · ${col.title}: ${n}`)}" aria-label="${esc(`${label}, ${col.title}: ${n} Titel`)}"${n ? '' : ' disabled'}>${n || '·'}</button>`;
  };
  const groupHead = SIGNAL_GROUPS.map((g) => {
    const span = columns.filter((c) => c.group === g.key).length;
    return span ? `<span class="sx-group sx-group--${g.key}" style="grid-column:span ${span}">${esc(g.label)}</span>` : '';
  }).join('');
  const head = columns.map((c) => `<span class="sx-head" title="${esc(c.title)}">${esc(c.label).replace('\n', '<br>')}</span>`).join('');
  const body = rows.map((r, i) => {
    const label = r.c
      ? `<button type="button" class="sx-row sx-row--stock" data-id="${esc(r.c.id)}" title="${esc(r.c.name ?? r.name)}">${esc(r.name)}</button>`
      : drill
        ? `<button type="button" class="sx-row sx-row--drill" data-sig-drill="${esc(r.name)}" title="${esc(`${r.name} · ${r.items.length} Titel – aufklappen`)}"><span class="sx-row__name">${esc(r.name)}</span><small>${r.items.length}</small></button>`
        : `<span class="sx-row" title="${esc(`${r.name} · ${r.items.length} Titel`)}"><span class="sx-row__name">${esc(r.name)}</span><small>${r.items.length}</small></span>`;
    return label + columns.map((c) => cell(c, i, r.name)).join('');
  }).join('');
  const total = rows.length > 1
    ? `<span class="sx-row sx-row--total">Alle</span>${columns.map((c) => cell(c, 'all', 'Alle')).join('')}` : '';

  return `<div class="sx-wrap"><div class="sx" style="--sx-cols:${columns.length}" role="group" aria-label="Signal-Matrix">
      <span class="sx-corner"></span>${groupHead}
      <span class="sx-corner sx-corner--title">${esc(rowTitle)}</span>${head}
      ${body}${total}
    </div></div>`;
}

/** IDs der gewählten Zelle (für „In Tabelle öffnen“). */
export function selectedIds({ columns, rows, sel }) {
  const col = sel && columns.find((c) => c.key === sel.col);
  if (!col) return [];
  if (sel.row === 'all') return [...new Set(col.rows.map((x) => x.c.id))];
  const set = new Set(rows[Number(sel.row)]?.items ?? []);
  return col.rows.filter((x) => set.has(x.c)).map((x) => x.c.id);
}
