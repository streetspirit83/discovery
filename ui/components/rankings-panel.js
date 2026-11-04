/**
 * Reiter „Rankings“ im Monitor: die Wochen-Rankings der Watchlist und die
 * Vorschläge zum Verschieben zwischen Archiv und Watchlist.
 *
 * Reine Darstellung: bekommt die neuesten Einträge `ranking` und `rotation` aus
 * dem market-Blob und liefert HTML. Tippen auf ein Symbol wertet dashboard-modal
 * über `data-rk-id` aus.
 */

import { icons } from '../lib/icons.js?v=20261103f';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const dayLabel = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' }) : '');
const fmtScore = (v) => (v == null ? '–' : Math.round(v));

export const RANK_SEGS = [
  { key: 'momentum', label: 'Momentum' },
  { key: 'solid',    label: 'Solide' },
  { key: 'growth',   label: 'Wachstum' },
  { key: 'pullback', label: 'Rücksetzer' },
  { key: 'breakout', label: 'Ausbruch' },
  { key: 'rotation', label: 'Rotation' },
];

const LIST_LABEL = Object.fromEntries(RANK_SEGS.map((s) => [s.key, s.label]));

function moveHtml(it, hasPrev) {
  if (!hasPrev) return '';
  if (it.prev_rank == null) return '<span class="rk-move rk-move--new">neu</span>';
  const d = it.prev_rank - it.rank;
  if (!d) return '<span class="rk-move">=</span>';
  return `<span class="rk-move ${d > 0 ? 'pos' : 'neg'}">${d > 0 ? icons.arrowUp : icons.arrowDown}${Math.abs(d)}</span>`;
}

function rowHtml(it, find, hasPrev) {
  const hit = find(it.symbol, it.exchange);
  const others = (it.lists ?? []).filter((k) => k !== it.list).map((k) => LIST_LABEL[k]).filter(Boolean);
  const head = `
    <span class="rk-rank">${esc(it.rank)}</span>
    <span class="rk-id">
      <span class="rk-sym">${esc(it.symbol)}${it.eye ? `<span class="rk-eye" title="Mit dem Auge markiert">${icons.eye}</span>` : ''}</span>
      <span class="rk-name">${esc(it.name ?? '')}</span>
    </span>
    <span class="rk-val">${moveHtml(it, hasPrev)}<span class="rk-score" title="Filter-Score 0–100">${esc(fmtScore(it.score))}</span></span>`;
  const note = it.note ? `<p class="rk-note">${esc(it.note)}</p>` : '';
  const tags = others.length ? `<p class="rk-tags">${it.list ? 'auch in' : 'besteht'} ${esc(others.join(' · '))}</p>` : '';
  return hit
    ? `<button type="button" class="rk-row" data-rk-id="${esc(hit.id)}"><span class="rk-head">${head}</span>${note}${tags}</button>`
    : `<div class="rk-row rk-row--off"><span class="rk-head">${head}</span>${note}${tags}</div>`;
}

function listHtml(list, key, find, hasPrev) {
  const items = (list?.items ?? []).map((it) => ({ ...it, list: key }));
  if (!items.length) return '<p class="dash-muted">Diese Woche ist kein Titel in der Liste.</p>';
  return `${list.question ? `<p class="rk-question">${esc(list.question)}</p>` : ''}
    <div class="rk-list">${items.map((it) => rowHtml(it, find, hasPrev)).join('')}</div>`;
}

function rotationHtml(doc, find) {
  if (!doc) return '<p class="dash-muted">Noch keine Vorschläge gespeichert. Sie entstehen einmal pro Woche.</p>';
  const part = (title, items) => `<section class="dash-card">
    <header class="dash-card__head"><h3>${esc(title)}</h3></header>
    <div class="dash-card__body">${items?.length
      ? `<div class="rk-list">${items.map((it) => rowHtml(it, find, false)).join('')}</div>`
      : '<p class="dash-muted">Diese Woche kein Vorschlag.</p>'}</div>
  </section>`;
  return `<p class="rk-stand">Stand ${esc(dayLabel(doc.day))}</p>
    ${doc.lead ? `<p class="rk-lead">${esc(doc.lead)}</p>` : ''}
    ${part('Archiv → Watchlist', doc.promote)}
    ${part('Watchlist → Archiv', doc.demote)}`;
}

/**
 * @param {object} o
 * @param {object|null} o.ranking   neuester Eintrag kind "ranking"
 * @param {object|null} o.rotation  neuester Eintrag kind "rotation"
 * @param {string} o.seg            aktive Liste
 * @param {function} o.find         (symbol, exchange) → Treffer im Workspace oder null
 */
export function rankingsHtml({ ranking, rotation, seg, find }) {
  const segs = `<div class="rk-seg" role="tablist">${RANK_SEGS.map((s) => `
    <button type="button" class="rk-seg__btn${s.key === seg ? ' is-active' : ''}" data-rk-seg="${s.key}" role="tab" aria-selected="${s.key === seg}">${esc(s.label)}</button>`).join('')}</div>`;
  if (seg === 'rotation') return `${segs}${rotationHtml(rotation, find)}`;
  if (!ranking) return `${segs}<p class="dash-muted">Noch keine Rankings gespeichert. Sie entstehen einmal pro Woche.</p>`;
  return `${segs}
    <p class="rk-stand">Stand ${esc(dayLabel(ranking.day))} · nur Watchlist</p>
    ${ranking.lead ? `<p class="rk-lead">${esc(ranking.lead)}</p>` : ''}
    ${listHtml(ranking.lists?.[seg], seg, find, !!ranking.has_prev)}`;
}
