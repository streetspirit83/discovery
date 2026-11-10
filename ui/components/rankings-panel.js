/**
 * Reiter „Rankings“ im Monitor. Seit Nov. 2026 eine durchgehende Seite ohne
 * Unterreiter: oben die fünf technischen Listen, live aus den geladenen Daten
 * gerechnet (`liveRankingsHtml`, ohne KI, Logik in lib/rankings-filter.js),
 * darunter einklappbar das KI-Wochenranking vom Sonntag (`weeklyRankingsHtml`,
 * Eintrag `ranking` aus dem market-Blob). Die Rotation hat seit Nov. 2026 einen
 * eigenen Monitor-Reiter (`rotationTabHtml`, Eintrag `rotation`).
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
  return `<p class="rk-stand">Stand ${esc(dayLabel(doc.day))} · Vorschläge, verschoben wird von Hand</p>
    ${doc.lead ? `<p class="rk-lead">${esc(doc.lead)}</p>` : ''}
    ${part('Archiv → Watchlist', doc.promote)}
    ${part('Watchlist → Archiv', doc.demote)}`;
}

/* ── Reiter „Rotation“ (KI-Vorschläge vom Sonntag) ───────────────────────── */

export function rotationTabHtml({ rotation, find } = {}) {
  return rotationHtml(rotation, find ?? (() => null));
}

/* ── Technisches Ranking (live, ohne KI) ─────────────────────────────────── */

const fmtP = (v) => (v == null ? '–' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1).replace('.', ',')} %`);
const KEY_METRIC = {
  momentum: (m) => `3M ${fmtP(m.perf_3m)}`,
  solid:    (m) => (m.health != null ? `Health ${Math.round(m.health)}` : `ROE ${fmtP(m.roe)}`),
  growth:   (m) => `Umsatz ${fmtP(m.rev_growth)}`,
  pullback: (m) => `52W-Hoch ${fmtP(m.high_dist != null ? -m.high_dist : null)}`,
  breakout: (m) => `Widerstand ${fmtP(m.res_dist)}`,
};

function liveRowHtml(it, key) {
  const m = it.m;
  const others = (it.lists ?? []).filter((k) => k !== key).map((k) => LIST_LABEL[k]).filter(Boolean);
  const bias = m.bias != null ? `<span class="${m.bias > 0 ? 'pos' : m.bias < 0 ? 'neg' : ''}">Bias ${m.bias > 0 ? '+' : ''}${m.bias}</span>` : '';
  const facts = [bias, esc(KEY_METRIC[key](m)), m.rsi != null ? `RSI ${Math.round(m.rsi)}` : ''].filter(Boolean).join(' · ');
  return `<button type="button" class="rk-row" data-rk-live="${esc(it.c.id)}">
    <span class="rk-head">
      <span class="rk-rank">${it.rank}</span>
      <span class="rk-id">
        <span class="rk-sym">${esc(m.symbol)}${m.eye ? `<span class="rk-eye" title="Mit dem Auge markiert">${icons.eye}</span>` : ''}</span>
        <span class="rk-name">${esc(m.name ?? '')}</span>
      </span>
      <span class="rk-val"><span class="rk-score" title="Filter-Score 0–100 (Perzentile über alle geladenen Titel)">${esc(fmtScore(it.score))}</span></span>
    </span>
    <p class="rk-tags">${facts}${others.length ? ` · auch in ${esc(others.join(', '))}` : ''}</p>
  </button>`;
}

/**
 * @param {{pool:number, lists:Array}} live  Ergebnis von liveRankings()
 * @param {string} scope                     Anzeigename des Pools („Watchlist", „Inbox" …)
 */
export function liveRankingsHtml(live, scope) {
  if (!live?.pool) return '<p class="dash-muted">Keine Titel mit TV-Daten – erst TV-Daten laden.</p>';
  const cards = live.lists.map((l) => `<section class="dash-card">
    <header class="dash-card__head"><h3>${esc(LIST_LABEL[l.key] ?? l.label)}</h3><span class="rk-stand">${l.passed} im Filter</span></header>
    <div class="dash-card__body">
      <p class="rk-question">${esc(l.question)}</p>
      ${l.items.length ? `<div class="rk-list">${l.items.map((it) => liveRowHtml(it, l.key)).join('')}</div>`
        : '<p class="dash-muted">Kein Titel besteht den Filter.</p>'}
    </div>
  </section>`).join('');
  return `<p class="rk-stand">Technisch · live aus den aktuellen Daten · ${esc(scope)} (${live.pool} Titel) · ohne KI</p>${cards}`;
}

/* ── KI-Wochenranking (Sonntag), alle Listen untereinander ────────────────── */

export function weeklyRankingsHtml({ ranking, find } = {}) {
  if (!ranking) return '<p class="dash-muted">Noch kein KI-Wochenranking gespeichert. Es entsteht sonntags.</p>';
  const lists = ranking ? RANK_SEGS.filter((sg) => sg.key !== 'rotation').map((sg) => `<section class="dash-card">
    <header class="dash-card__head"><h3>${esc(sg.label)}</h3></header>
    <div class="dash-card__body">${listHtml(ranking.lists?.[sg.key], sg.key, find, !!ranking.has_prev)}</div>
  </section>`).join('') : '';
  return `${ranking ? `<p class="rk-stand">Stand ${esc(dayLabel(ranking.day))} · nur Watchlist</p>
    ${ranking.lead ? `<p class="rk-lead">${esc(ranking.lead)}</p>` : ''}` : ''}
    ${lists}`;
}
