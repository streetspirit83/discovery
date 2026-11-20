/**
 * Reiter „Rankings“ im Monitor. Seit Nov. 2026 eine durchgehende Seite ohne
 * Unterreiter: oben die fünf technischen Listen, live aus den geladenen Daten
 * gerechnet (`liveRankingsHtml`, ohne KI, Logik in lib/rankings-filter.js),
 * darunter einklappbar das KI-Wochenranking vom Sonntag (`weeklyRankingsHtml`,
 * Eintrag `ranking` aus dem market-Blob). Der Monitor-Reiter „Rotation“ zeigt den
 * Tagesbericht der Auto-Rotation (`rotationTabHtml`, `auto_rotation` im market-Blob).
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

/* ── Reiter „Rotation“: Tagesbericht der Auto-Rotation ─────────────────────
   Kein KI-Text. Der Bericht entsteht im täglichen Lauf (tools/auto-rotation/run.mjs)
   und liegt im market-Blob unter `auto_rotation.reports` (neueste zuerst). Im
   Probelauf zeigt er, was verschoben würde; scharf, was verschoben wurde. */
const BUCKET_NAME = { watch: 'Watchlist', archive: 'Archiv', inbox: 'Inbox', export: 'Export' };
const fmt1 = (v) => (v == null ? '–' : String(Math.round(v * 10) / 10).replace('.', ','));
const runLabel = (r) => {
  const d = r?.at ? new Date(r.at) : null;
  return d ? `${d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr` : dayLabel(r?.day);
};

function autoRowHtml(it, find, badge) {
  const hit = find(it.symbol, it.exchange);
  const head = `
    <span class="rk-rank">${esc(badge ?? '')}</span>
    <span class="rk-id">
      <span class="rk-sym">${esc(it.symbol)}</span>
      <span class="rk-name">${esc(it.name ?? '')}</span>
    </span>
    <span class="rk-val"><span class="rk-score" title="Auswahl-Score 0–100">${esc(fmtScore(it.score))}</span></span>`;
  const origin = it.from && it.from !== 'watch' ? ` · aus ${BUCKET_NAME[it.from] ?? it.from}` : '';
  const note = it.why ? `<p class="rk-note">${esc(it.why)}${esc(origin)}</p>` : '';
  return hit
    ? `<button type="button" class="rk-row" data-rk-id="${esc(hit.id)}"><span class="rk-head">${head}</span>${note}</button>`
    : `<div class="rk-row rk-row--off"><span class="rk-head">${head}</span>${note}</div>`;
}

const autoCard = (title, body, extra = '') => `<section class="dash-card">
    <header class="dash-card__head"><h3>${esc(title)}</h3>${extra}</header>
    <div class="dash-card__body">${body}</div>
  </section>`;
const autoList = (items, find, badge) => `<div class="rk-list">${items.map((it) => autoRowHtml(it, find, badge(it))).join('')}</div>`;
const symLine = (items) => `<p class="rk-tags">${items.map((it) => esc(it.symbol)).join(' · ')}</p>`;

export function rotationTabHtml({ auto, find, day = null } = {}) {
  find ??= () => null;
  const reports = auto?.reports ?? [];
  const mode = auto?.mode === 'live' ? 'live' : 'dry';
  const seg = (m, label) => `<button type="button" class="seg-btn${mode === m ? ' seg-btn--active' : ''}" data-rot-mode="${m}" aria-pressed="${mode === m}">${label}</button>`;
  const modeBar = `<div class="rk-mode" role="group" aria-label="Modus der Auto-Rotation">
      ${seg('dry', 'Probelauf')}${seg('live', 'Scharf')}
      <span class="rk-stand">${mode === 'live' ? 'Der nächste Lauf verschiebt.' : 'Der nächste Lauf verschiebt nichts.'} Läuft werktags gegen 22:40 Uhr.</span>
    </div>`;
  if (!reports.length) return `${modeBar}<p class="dash-muted">Noch kein Lauf gespeichert.</p>`;

  const r = reports.find((x) => x.day === day) ?? reports[0];
  const dry = r.mode !== 'live';
  const days = reports.length > 1 ? `<div class="rk-days" role="group" aria-label="Lauf wählen">${reports.slice(0, 10).map((x) =>
    `<button type="button" class="chip-btn${x.day === r.day ? ' is-active' : ''}" data-rot-day="${esc(x.day)}">${esc(new Date(`${x.day}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' }))}</button>`).join('')}</div>` : '';

  const u = r.universe ?? {}, pr = r.protected ?? {}, d = r.data ?? {};
  const mCap = r.rules?.momentum?.cap ?? 40, qCap = r.rules?.quality?.cap ?? 10;
  const sel = r.selection ?? [];
  const nQ = sel.length ? sel.filter((x) => x.slot === 'quality').length : qCap;
  const nM = sel.length ? sel.length - nQ : mCap;
  const status = dry ? 'Probelauf: Es wurde nichts verschoben.'
    : r.errors?.length ? 'Scharf, mit Fehlern (siehe unten).'
    : `Scharf: ${r.moved?.in ?? 0} in die Watchlist, ${r.moved?.out ?? 0} ins Archiv${r.moved?.pulled ? `, ${r.moved.pulled} geschützte nachgezogen` : ''}${r.moved?.deleted ? `, ${r.moved.deleted} aus der Inbox gelöscht` : ''}.`;
  const facts = `
    <p class="rk-tags"><b>Watchlist danach:</b> ${esc(r.watch_after)} Titel (${nM} Momentum · ${nQ} Qualität · ${esc(pr.count ?? 0)} geschützt${r.kept_no_data?.length ? ` · ${r.kept_no_data.length} ohne Daten` : ''})</p>
    <p class="rk-tags"><b>Geschützt:</b> ${esc(pr.star ?? 0)} Stern · ${esc(pr.eye ?? 0)} Auge · ${esc(pr.alarm ?? 0)} mit Alarm</p>
    <p class="rk-tags"><b>Geprüft:</b> ${esc(u.stocks ?? '–')} Aktien aus Watchlist ${esc(u.watch ?? '–')}, Inbox ${esc(u.inbox ?? '–')}, Archiv ${esc(u.archive ?? '–')}</p>
    <p class="rk-tags"><b>Daten:</b> TradingView ${esc(d.tv ?? '–')}/${esc(d.tv_total ?? '–')} · LS ${esc(d.ls_checked ?? '–')} geprüft, ${esc(d.ls_missing?.length ?? 0)} ohne Kurs</p>
    <p class="rk-tags"><b>Schwelle:</b> Momentum ab ${esc(fmt1(r.threshold?.momentum))} · Qualität ab ${esc(fmt1(r.threshold?.quality))}</p>`;

  const none = '<p class="dash-muted">Keine Änderung.</p>';
  const enter = r.enter ?? [], leave = r.leave ?? [], pulled = r.pulled ?? [];
  const rankOf = (it) => (it.slot === 'quality' ? `Q${it.qrank ?? ''}` : it.rank ?? '');
  const parts = [
    autoCard(`${dry ? 'Käme neu in die Watchlist' : 'Neu in der Watchlist'} (${enter.length})`, enter.length ? autoList(enter, find, rankOf) : none),
    autoCard(`${dry ? 'Ginge ins Archiv' : 'Ins Archiv verschoben'} (${leave.length})`, leave.length ? autoList(leave, find, (it) => it.rank ?? '–') : none),
  ];
  if (pulled.length) parts.push(autoCard(`Geschützte Titel ${dry ? 'kämen' : 'kamen'} in die Watchlist (${pulled.length})`, autoList(pulled, find, () => '')));
  if (r.purge_day || r.deleted?.length) parts.push(autoCard(`Inbox-Rest ${dry ? 'würde gelöscht' : 'gelöscht'} (${r.deleted?.length ?? 0})`, r.deleted?.length ? symLine(r.deleted) : none));
  if (r.kept_no_data?.length) parts.push(autoCard(`Ohne Daten liegen geblieben (${r.kept_no_data.length})`, symLine(r.kept_no_data)));
  if (r.errors?.length) parts.push(autoCard('Fehler im Lauf', r.errors.map((e) => `<p class="rk-tags"><b class="neg">${esc(e)}</b></p>`).join('')));
  if (sel.length) {
    const rows = (slot) => autoList(sel.filter((x) => x.slot === slot).map((x) => ({ ...x, why: x.new ? 'neu' : '' })), find, (it) => (slot === 'quality' ? `Q${it.rank}` : it.rank));
    parts.push(`<details class="dash-card rk-weekly">
      <summary class="dash-card__head"><h3>Auswahl nach diesem Lauf (${sel.length})</h3></summary>
      <div class="dash-card__body"><p class="rk-question">Momentum (${nM})</p>${rows('momentum')}<p class="rk-question">Qualität im Rücksetzer (${nQ})</p>${rows('quality')}</div>
    </details>`);
  }
  return `${modeBar}${days}
    <p class="rk-stand">Lauf vom ${esc(runLabel(r))}</p>
    <p class="rk-lead">${esc(status)}</p>
    ${autoCard('Überblick', facts)}
    ${parts.join('\n')}`;
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

/** Eine Live-Liste (Frage + Zeilen) – auch einzeln im Markt-Dashboard des Monitors. */
export function liveListHtml(l) {
  return `<p class="rk-question">${esc(l.question)}</p>
      ${l.items.length ? `<div class="rk-list">${l.items.map((it) => liveRowHtml(it, l.key)).join('')}</div>`
        : '<p class="dash-muted">Kein Titel besteht den Filter.</p>'}`;
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
      ${liveListHtml(l)}
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
