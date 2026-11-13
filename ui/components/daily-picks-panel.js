/**
 * Reiter „Tagessieger“ im Monitor (nur Watchlist). Reine Darstellung:
 * bekommt die Einträge `kind: 'picks'` aus dem market-Blob und liefert HTML.
 *
 *   1. Heute: die 5 Tagessieger der geplanten Aufgabe (werktags 8 Uhr) mit Begründung,
 *   2. Treffer-Check: Tagessieger gegen den übrigen Pool nach 1 und 5 Handelstagen,
 *   3. Bestenliste: wie oft ein Titel Tagessieger war und wie er danach lief,
 *   4. Verlauf: die letzten Tage kompakt.
 *
 * Rechenlogik in lib/daily-picks.js. Tippen auf ein Symbol wertet dashboard-modal
 * über `data-rk-id` aus (wie im Reiter „Rankings“).
 */

import { icons } from '../lib/icons.js?v=20261107a';
import { picksOf, reviewPicks, leaderboard, poolOf } from '../lib/daily-picks.js?v=20261107a';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const dayLabel = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', opts) : '');
const fmtP = (v) => (v == null ? '–' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1).replace('.', ',')} %`);
const cls = (v) => (v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const pctTxt = (v) => (v == null ? '–' : `${v} %`);

function symHead(it, find, right) {
  const hit = find?.(it.symbol, it.exchange);
  const head = `
    <span class="rk-rank">${esc(it.rank ?? '')}</span>
    <span class="rk-id">
      <span class="rk-sym">${esc(it.symbol)}${hit?.watch_flag ? `<span class="rk-eye" title="Mit dem Auge markiert">${icons.eye}</span>` : ''}</span>
      <span class="rk-name">${esc(it.name ?? hit?.name ?? hit?.company_name ?? '')}</span>
    </span>
    <span class="rk-val">${right}</span>`;
  return { hit, head };
}

function pickRow(p, find) {
  const res = [p.perf_1d != null ? `<span class="${cls(p.perf_1d)}">1T ${fmtP(p.perf_1d)}</span>` : '',
    p.perf_5d != null ? `<span class="${cls(p.perf_5d)}">5T ${fmtP(p.perf_5d)}</span>` : ''].filter(Boolean).join(' · ');
  const { hit, head } = symHead(p, find, `<span class="rk-score" title="Filter-Score 0–100">${esc(p.score != null ? Math.round(p.score) : '–')}</span>`);
  const body = `
    ${p.setup ? `<p class="rk-tags">${esc(p.setup)}</p>` : ''}
    ${p.reason ? `<p class="rk-note">${esc(p.reason)}</p>` : ''}
    ${p.catalyst ? `<p class="rk-tags"><b>Auslöser:</b> ${esc(p.catalyst)}</p>` : ''}
    ${p.risk ? `<p class="rk-tags"><b>Risiko:</b> ${esc(p.risk)}</p>` : ''}
    ${res ? `<p class="rk-tags">Seither ${res}</p>` : ''}`;
  return hit
    ? `<button type="button" class="rk-row" data-rk-id="${esc(hit.id)}"><span class="rk-head">${head}</span>${body}</button>`
    : `<div class="rk-row rk-row--off"><span class="rk-head">${head}</span>${body}</div>`;
}

function todayCard(e, find) {
  const picks = [...(e.picks ?? [])].sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9));
  return `<section class="dash-card">
    <header class="dash-card__head"><span class="dash-card__icon">${icons.trophy}</span><h3>Tagessieger ${esc(dayLabel(e.day, { weekday: 'long', day: 'numeric', month: 'long' }))}</h3></header>
    <div class="dash-card__body">
      ${e.lead ? `<p class="rk-lead">${esc(e.lead)}</p>` : ''}
      <div class="rk-list">${picks.map((p) => pickRow(p, find)).join('')}</div>
      <p class="rk-stand">Auf Basis der Schlusskurse vom ${esc(dayLabel(e.trading_day ?? e.day, { day: 'numeric', month: 'long' }))} · nur Watchlist · Signallage, keine Kaufempfehlung</p>
    </div>
  </section>`;
}

function statBlock(label, s, key) {
  return `<div class="dp-stat">
    <span class="dp-stat__label">${esc(label)}</span>
    <b class="${cls(s[`avg_${key}`])}">${fmtP(s[`avg_${key}`])}</b>
    <span class="dp-stat__sub">Treffer ${pctTxt(s[`hit_${key}_pct`])} · n=${s[`n_${key}`]}</span>
  </div>`;
}

function checkCard(rv, method) {
  const body = !rv || !rv.pool.n_1d
    ? '<p class="dash-muted">Noch keine Messung. Der Monitor trägt nach jedem Handelstag nach, wie die Tagessieger gelaufen sind (nach 1 und 5 Handelstagen).</p>'
    : `<div class="dp-stats">
        ${statBlock('Tagessieger · 1 Tag', rv.chosen, '1d')}
        ${statBlock('Tagessieger · 5 Tage', rv.chosen, '5d')}
        ${statBlock('Übriger Pool · 5 Tage', rv.rest, '5d')}
      </div>
      <p class="rk-tags">Vorsprung der KI-Auswahl gegen den Filter-Pool (5 Tage): <b class="${cls(rv.edge_5d)}">${rv.edge_5d == null ? 'noch offen' : fmtP(rv.edge_5d).replace(' %', ' Pp.')}</b>
        · Treffer = Kurs höher als beim Auswahl-Schluss · seit ${esc(dayLabel(rv.since, { day: 'numeric', month: 'short' }))}</p>
      ${method?.version ? `<p class="rk-tags">Gewichtung lernt mit: Methode v${esc(method.version)} seit ${esc(dayLabel(method.updated_day, { day: 'numeric', month: 'short' }))}</p>` : '<p class="rk-tags">Gewichtung lernt mit, sobald 30 Messungen nach 5 Tagen vorliegen.</p>'}`;
  return `<section class="dash-card">
    <header class="dash-card__head"><span class="dash-card__icon">${icons.target ?? icons.activity}</span><h3>Treffer-Check</h3></header>
    <div class="dash-card__body">${body}</div>
  </section>`;
}

function boardCard(board, find) {
  const rows = board.map((r, i) => {
    const right = `<span class="rk-move" title="So oft Tagessieger">${icons.trophy}${r.wins}</span>
      <span class="dp-perf ${cls(r.avg_5d)}" title="Ø nach 5 Handelstagen">${fmtP(r.avg_5d)}</span>`;
    const { hit, head } = symHead({ ...r, rank: i + 1 }, find, right);
    const sub = `<p class="rk-tags">zuletzt ${esc(dayLabel(r.last, { day: 'numeric', month: 'short' }))}${r.n_5d ? ` · ${r.hits_5d}/${r.n_5d} Treffer nach 5 Tagen` : ''}${r.avg_1d != null ? ` · Ø 1T ${fmtP(r.avg_1d)}` : ''}</p>`;
    return hit
      ? `<button type="button" class="rk-row" data-rk-id="${esc(hit.id)}"><span class="rk-head">${head}</span>${sub}</button>`
      : `<div class="rk-row rk-row--off"><span class="rk-head">${head}</span>${sub}</div>`;
  }).join('');
  return `<section class="dash-card">
    <header class="dash-card__head"><span class="dash-card__icon">${icons.barChart2}</span><h3>Bestenliste</h3></header>
    <div class="dash-card__body">${rows ? `<div class="rk-list">${rows}</div>` : '<p class="dash-muted">Noch keine Tagessieger.</p>'}</div>
  </section>`;
}

function historyCard(entries) {
  if (entries.length < 2) return '';
  const rows = entries.slice(1, 11).map((e) => {
    const picks = poolOf(e).filter((x) => x.chosen);
    const p5 = picks.map((x) => x.perf_5d).filter((v) => v != null);
    const p1 = picks.map((x) => x.perf_1d).filter((v) => v != null);
    const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    const v = p5.length ? avg(p5) : avg(p1);
    return `<div class="dp-hist">
      <span class="dp-hist__day">${esc(dayLabel(e.day))}</span>
      <span class="dp-hist__syms">${picks.map((x) => esc(x.symbol)).join(' · ')}</span>
      <span class="dp-perf ${cls(v)}" title="${p5.length ? 'Ø nach 5 Handelstagen' : 'Ø nach 1 Handelstag'}">${v == null ? '–' : `${p5.length ? '5T' : '1T'} ${fmtP(v)}`}</span>
    </div>`;
  }).join('');
  return `<details class="dash-card rk-weekly">
    <summary class="dash-card__head"><h3>Verlauf</h3></summary>
    <div class="dash-card__body">${rows}</div>
  </details>`;
}

/**
 * @param {{briefings:Array, method?:object, find:function}} data
 */
export function dailyPicksHtml({ briefings = [], method = null, find } = {}) {
  const entries = picksOf(briefings);
  if (!entries.length) {
    return '<p class="dash-muted">Noch keine Tagessieger gespeichert. Sie entstehen werktags um 8 Uhr aus der Watchlist: technische Vorauswahl, dann KI-Einschätzung der 5 besten.</p>';
  }
  const rv = reviewPicks(briefings, method?.weights ?? {});
  return `${todayCard(entries[0], find)}
    ${checkCard(rv, method)}
    ${boardCard(leaderboard(briefings, { limit: 15 }), find)}
    ${historyCard(entries)}`;
}

/** Schlüssel der neuesten Tagessieger (SYMBOL:BÖRSE) → Rang; für das Abzeichen in der Liste. */
export function latestPickKeys(briefings) {
  const e = picksOf(briefings)[0];
  const m = new Map();
  for (const p of e?.picks ?? []) m.set(`${String(p.symbol).toUpperCase()}:${String(p.exchange ?? '').toUpperCase()}`, { rank: p.rank, day: e.day });
  return m;
}
