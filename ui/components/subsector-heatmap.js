/**
 * Sub-Sektor-Heatmap im Monitor-Reiter „Dynamik“ (ganz unten, über demselben Ausschnitt wie
 * Signal-Matrix und Setups, also mit Mega-Cluster-Filter und Drill-down, ohne Setup-Filter).
 *
 * Zeilen = Sub-Sektoren (TradingView-Industry), Spalten = Median-Performance 1T · 1W · 1M · 3M,
 * dazu Anzahl und Breite (Anteil positiv im gewählten Horizont). Spaltenkopf tippen = Horizont
 * wählen und danach sortieren (nochmal = Richtung umdrehen). Filter: Richtung (alle/↑/↓) und
 * Mindestgrösse. Zeile tippen = Titel des Sub-Sektors darunter, mit „In Tabelle öffnen“ und
 * dem KI-Lookup (Claude · ChatGPT · Perplexity): branchenführende börsennotierte Unternehmen,
 * die noch nicht im Workspace liegen; der Link am Ende der Antwort öffnet das Prüffenster
 * (`#add=…&sub=…`, lib/peer-import.js) und legt bestätigte Titel in die Inbox.
 *
 * Reine Darstellung; Klicks wertet dashboard-modal.js aus (`data-hm-*`).
 */

import { icons } from '../lib/icons.js?v=20261123a';
import { CLAUDE_LOGO, PERPLEXITY_LOGO, CHATGPT_LOGO } from '../lib/ai-logos.js?v=20261125b';
import { HORIZONS, subsectorRows, filterRows, membersOf, perfOf } from '../lib/subsector-heat.js?v=20261125b';
import { subsectorLeadersPrompt, promptUrl } from '../lib/quick-take-prompt.js?v=20261125b';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const fmtPct = (v, dec = 1) => (v == null || Number.isNaN(v) ? '–' : `${v >= 0 ? '+' : '−'}${Math.abs(Number(v)).toFixed(dec)}%`);
const LIMIT = 25;                                // so viele Zeilen ohne „alle zeigen“
const MINS = [1, 2, 3];
const DIRS = [['all', 'Alle'], ['up', '↑ positiv'], ['down', '↓ negativ']];

export const defaultHeatState = () => ({ hz: 'perf_1m', sort: 'perf', asc: false, dir: 'all', min: 2, sel: null, more: false });

function heatBg(v, cap) {
  if (v == null) return 'var(--surface-3)';
  const p = Math.round(Math.min(Math.abs(v) / cap, 1) * 50 + 6);
  return `color-mix(in srgb, var(${v >= 0 ? '--pos' : '--neg'}) ${p}%, var(--surface-2))`;
}

/** Spaltenköpfe mit Sortier-Pfeil. */
function headHtml(st) {
  const arrow = (on) => (on ? (st.asc ? ' ↑' : ' ↓') : '');
  const hz = HORIZONS.map((h) => {
    const on = st.sort === 'perf' && st.hz === h.key;
    return `<button type="button" class="hm-head${st.hz === h.key ? ' is-hz' : ''}" data-hm-hz="${h.key}" title="Median ${h.label} · tippen: danach sortieren">${h.label}${arrow(on)}</button>`;
  }).join('');
  return `<button type="button" class="hm-head hm-head--name" data-hm-sort="name">Sub-Sektor${arrow(st.sort === 'name')}</button>
    <button type="button" class="hm-head" data-hm-sort="n" title="Anzahl Titel">n${arrow(st.sort === 'n')}</button>
    ${hz}<span class="hm-head" title="Anteil der Titel mit positiver Performance im gewählten Horizont (Breite)">%↑</span>`;
}

function rowHtml(r, st) {
  const on = st.sel === r.name;
  const cells = HORIZONS.map((h) => `<span class="hm-cell${st.hz === h.key ? ' is-hz' : ''}" style="background:${heatBg(r.med[h.key], h.cap)}">${fmtPct(r.med[h.key])}</span>`).join('');
  const br = r.up[st.hz];
  return `<button type="button" class="hm-row${on ? ' is-sel' : ''}" data-hm-row="${esc(r.name)}" aria-pressed="${on}"
      title="${esc(`${r.name} · ${r.sector} · ${r.items.length} Titel`)}">
      <span class="hm-name"><span class="hm-name__main">${esc(r.name)}</span><span class="hm-name__sub">${esc(r.sector || r.mega)}</span></span>
      <span class="hm-n">${r.items.length}</span>${cells}
      <span class="hm-br"><span class="hm-br__bar"><span style="width:${br ?? 0}%"></span></span><small>${br == null ? '–' : `${br}%`}</small></span>
    </button>`;
}

function detailHtml(r, st, known) {
  const hz = HORIZONS.find((h) => h.key === st.hz);
  const members = membersOf(r, st.hz);
  const prompt = subsectorLeadersPrompt({ sub: r.name, sector: r.sector, known });
  const ai = [['claude', CLAUDE_LOGO, 'Claude'], ['chatgpt', CHATGPT_LOGO, 'ChatGPT'], ['perplexity', PERPLEXITY_LOGO, 'Perplexity']]
    .map(([k, logo, l]) => `<a class="link-chip link-chip--ai" href="${esc(promptUrl(k, prompt))}" target="_blank" rel="noopener" title="Branchenführer in ${l} recherchieren" aria-label="Branchenführer in ${l} recherchieren">${logo}</a>`).join('');
  return `<div class="sx-detail hm-detail">
      <div class="sx-detail__head"><span><b>${esc(r.name)}</b> · ${members.length} Titel · nach ${esc(hz?.label ?? '')}</span>
        <span class="sm-acts"><button type="button" class="btn btn-sm btn-primary" data-hm-show>In Tabelle öffnen</button></span></div>
      <div class="dash-group" data-group="subsector.members">${members.map((c) => {
        const v = perfOf(c, st.hz);
        return `<button class="dash-row${v > 0 ? ' dash-row--up' : v < 0 ? ' dash-row--down' : ''}" data-id="${esc(c.id)}">
          <span class="dash-row__sym"><span class="dash-sym">${esc(c.symbol)}</span><span class="dash-ex">${esc(c.name ?? c.exchange ?? '')}</span></span>
          <span class="dash-row__val"><span class="dash-num ${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${fmtPct(v)}</span></span></button>`;
      }).join('')}</div>
      <div class="hm-ai">
        <span class="hm-ai__label">${icons.sparkles}<span>KI-Lookup: Branchenführer in „${esc(r.name)}“</span></span>
        <span class="link-cluster">${ai}</span>
        <p class="md-note">Die KI nennt bis zu 6 börsennotierte Titel, die noch nicht im Workspace liegen, und hängt einen Link „In Discovery prüfen“ an. Der öffnet das Prüffenster; bestätigte Titel landen in der Inbox (Quelle ai-subsector).</p>
      </div>
    </div>`;
}

/**
 * @param {object[]} cands  Ausschnitt (Kandidaten mit TV-Daten)
 * @param {object}   st     aus defaultHeatState()
 * @param {object[]} known  alle Titel des Workspace (werden der KI als „schon vorhanden“ mitgegeben)
 */
export function subsectorHeatHtml(cands, st, known = []) {
  const { rows, missing } = subsectorRows(cands);
  if (!rows.length) return '';
  const shown = filterRows(rows, st);
  const list = st.more ? shown : shown.slice(0, LIMIT);
  const sel = rows.find((r) => r.name === st.sel);
  const knownSub = sel ? known.filter((c) => c.sub_sector === sel.name) : [];
  const segs = (items, key, cur) => `<div class="dash-seg">${items.map(([v, l]) => `<button type="button" class="dash-seg__btn${String(v) === String(cur) ? ' is-active' : ''}" data-hm-${key}="${v}">${l}</button>`).join('')}</div>`;
  return `<section class="sm hm" aria-label="Sub-Sektoren">
      <div class="sm-head"><h3 class="sm-title">Sub-Sektoren</h3>
        <span class="md-note">Median-Performance je Sub-Sektor (TradingView-Industry) · ${rows.length} Sub-Sektoren${missing ? ` · ${missing} Titel ohne Sub-Sektor` : ''} · Spaltenkopf tippen = sortieren · Zeile tippen = Titel + KI-Lookup</span></div>
      <div class="md-ctl md-ctl--color">${segs(DIRS, 'dir', st.dir)}${segs(MINS.map((m) => [m, `≥ ${m}`]), 'min', st.min)}</div>
      <div class="hm-wrap"><div class="hm-grid" role="group" aria-label="Sub-Sektor-Heatmap">
        <div class="hm-headrow">${headHtml(st)}</div>
        ${list.length ? list.map((r) => rowHtml(r, st)).join('') : '<p class="dash-empty hm-empty">Kein Sub-Sektor erfüllt den Filter.</p>'}
      </div></div>
      ${shown.length > LIMIT ? `<button type="button" class="btn btn-sm btn-secondary hm-more" data-hm-more>${st.more ? 'weniger zeigen' : `alle ${shown.length} zeigen`}</button>` : ''}
      ${sel ? detailHtml(sel, st, knownSub.length ? knownSub : sel.items) : ''}
    </section>`;
}

/** IDs des gewählten Sub-Sektors (für „In Tabelle öffnen“). */
export function heatSelIds(cands, st) {
  const r = subsectorRows(cands).rows.find((x) => x.name === st.sel);
  return r ? r.items.map((c) => c.id) : [];
}
