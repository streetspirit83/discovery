/**
 * Marktbriefing-Modal – die finanzjournalistische Tagesauswertung.
 *
 * Liest den `market`-Blob (bis zu 30 Briefings, neueste zuerst; geschrieben von
 * Claude auf „Go“ über die Action market-briefing.yml) und zeigt je Tag:
 * Schlagzeile und Lead, Indizes, Marktbreite, Treiber, Top/Flop mit Auslöser,
 * Earnings, Technik, Fazit und Quellen. Dieselben Inhalte wie das Claude-
 * Artefakt „Marktbriefing“ – das Artefakt selbst lässt sich nicht einbetten
 * (claude.ai sendet `frame-ancestors 'self'`).
 *
 * Symbole, die in Watch/Archiv/Inbox/Export liegen, sind antippbar und öffnen
 * das Detail-Sheet; beim Schliessen des Sheets kehrt das Modal zurück
 * (`ctrl.hide/show`, wie das Monitor-Dashboard).
 *
 * Rein darstellend – das Modal schreibt nie.
 */

import { icons } from '../lib/icons.js?v=20261021a';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const nf = (d) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v, d = 1) => (v == null || Number.isNaN(+v) ? '–' : `${+v > 0 ? '+' : +v < 0 ? '−' : ''}${nf(d).format(Math.abs(+v))} %`);
const tone = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const longDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

/* Indexkacheln: feste Vierergruppen → je Gruppe EINE Zeile (Styleguide §5). */
const INDEX_ROWS = [
  ['SPX', 'IXIC', 'SOX', 'RUT'],
  ['DAX', 'SX5E', 'N225', 'HSI'],
  ['VIX', 'US10Y', 'BRENT', 'GOLD'],
  ['DJI', 'NDX', 'EURUSD', 'BTC'],
];
const SHORT = { SPX: 'S&P 500', IXIC: 'Nasdaq', SOX: 'SOX', RUT: 'R2000', DAX: 'DAX', SX5E: 'Stoxx 50', N225: 'Nikkei', HSI: 'HSI', VIX: 'VIX', US10Y: 'US 10J', BRENT: 'Brent', GOLD: 'Gold', DJI: 'Dow', NDX: 'NDX', EURUSD: 'EUR/USD', BTC: 'Bitcoin' };
/* Kachel-Prozent ohne Leerzeichen – vier Spalten am Handy sind schmal. */
const pctT = (v) => pct(v).replace(' %', '%');

function indexTile(x) {
  if (!x) return '<div class="bf-tile mb-idx mb-idx--empty"></div>';
  const isYield = x.chg_abs != null;
  const day = isYield
    ? `${x.chg_abs >= 0 ? '+' : '−'}${nf(0).format(Math.abs(x.chg_abs * 100))} Bp`
    : pctT(x.chg_1d);
  const dayTone = tone(isYield ? x.chg_abs : x.chg_1d);
  return `<div class="bf-tile mb-idx" title="${esc(x.name)}${x.value != null ? ` · ${nf(x.value >= 1000 ? 0 : 2).format(x.value)}` : ''}">
    <div class="bf-tile__label">${esc(SHORT[x.code] ?? x.name)}</div>
    <div class="mb-idx__day ${dayTone}">${esc(day)}</div>
    <div class="mb-idx__wk ${tone(x.perf_1w)}">${esc(pctT(x.perf_1w))}</div>
  </div>`;
}

function indicesBlock(ix) {
  const bm = new Map((ix?.benchmarks ?? []).map((x) => [x.code, x]));
  if (!bm.size && !(ix?.sectors ?? []).length) return '';
  const rows = INDEX_ROWS
    .filter((codes) => codes.some((c) => bm.has(c)))
    .map((codes) => `<div class="bf-tiles">${codes.map((c) => indexTile(bm.get(c))).join('')}</div>`).join('');
  const sec = ix?.sectors ?? [];
  const secItem = (x) => `<li class="mb-sec"><span class="mb-sec__name">${esc(x.name)}</span><span class="mb-num ${tone(x.chg_1d)}">${esc(pct(x.chg_1d))}</span></li>`;
  const secBlock = sec.length >= 6 ? `<div class="mb-secs">
      <div><div class="mb-sub">Stärkste Branchen</div><ul class="mb-list">${sec.slice(0, 4).map(secItem).join('')}</ul></div>
      <div><div class="mb-sub">Schwächste Branchen</div><ul class="mb-list">${sec.slice(-4).reverse().map(secItem).join('')}</ul></div>
    </div>` : '';
  return `<section class="bf-section"><h3 class="bf-h">Indizes <span class="mb-tag">· heute / 1 Woche</span></h3>${rows}${secBlock}</section>`;
}

function breadthBlock(br) {
  if (!br) return '';
  const n = (br.advancers ?? 0) + (br.decliners ?? 0);
  const ap = n ? Math.round(br.advancers / n * 100) : 0;
  const tile = (label, val, cls = '') => `<div class="bf-tile"><div class="bf-tile__label">${esc(label)}</div><div class="mb-idx__day ${cls}">${esc(val)}</div></div>`;
  return `<section class="bf-section"><h3 class="bf-h">Marktbreite der beobachteten Aktien</h3>
    <div class="bf-tiles">
      ${tile('Median', pct(br.median_chg_1d), tone(br.median_chg_1d))}
      ${tile('1 Woche', pct(br.median_perf_1w), tone(br.median_perf_1w))}
      ${tile('> SMA200', br.above_sma200_pct != null ? `${br.above_sma200_pct} %` : '–')}
      ${tile('> ±5 %', br.big_moves ?? '–')}
    </div>
    ${n ? `<div class="mb-adv" aria-hidden="true"><i class="pos" style="width:${ap}%"></i><i class="neg" style="width:${100 - ap}%"></i></div>
    <div class="mb-advlab"><span>${br.advancers} im Plus</span><span>${br.decliners} im Minus</span></div>` : ''}
  </section>`;
}

/* Symbol als Knopf, wenn der Titel im Workspace liegt – sonst reiner Text. */
function symHtml(x, find) {
  const hit = find(x.symbol, x.exchange);
  return hit
    ? `<button type="button" class="mb-sym" data-id="${esc(hit.id)}" title="Detail öffnen">${esc(x.symbol)}</button>`
    : `<span class="mb-sym mb-sym--plain">${esc(x.symbol)}</span>`;
}

function chartBlock(top, flop) {
  const rows = [...(top ?? []).slice(0, 6), ...(flop ?? []).slice(0, 6).reverse()].filter((r) => r.chg_1d != null);
  if (!rows.length) return '';
  const max = Math.max(...rows.map((r) => Math.abs(r.chg_1d)), 1);
  return `<section class="bf-section"><h3 class="bf-h">Top &amp; Flop des Tages</h3>
    <div class="mb-chart">${rows.map((r) => {
      const w = Math.max(1, Math.abs(r.chg_1d) / max * 100);
      return `<div class="mb-bar">
        <span class="mb-bar__name">${esc(r.name)}</span>
        <span class="mb-bar__track">
          <span class="mb-bar__half">${r.chg_1d < 0 ? `<i class="neg" style="width:${w}%"></i>` : ''}</span>
          <span class="mb-bar__half">${r.chg_1d >= 0 ? `<i class="pos" style="width:${w}%"></i>` : ''}</span>
        </span>
        <span class="mb-num ${tone(r.chg_1d)}">${esc(pct(r.chg_1d))}</span>
      </div>`;
    }).join('')}</div>
  </section>`;
}

function moverBlock(title, rows, find) {
  if (!rows?.length) return '';
  return `<section class="bf-section"><h3 class="bf-h">${esc(title)}</h3>
    <ul class="mb-list">${rows.map((r) => `<li class="mb-row">
      <div class="mb-row__head">
        ${symHtml(r, find)}
        <span class="mb-row__name">${esc(r.name)}${r.sector ? ` <span class="mb-muted">· ${esc(r.sector)}</span>` : ''}</span>
        <span class="mb-num ${tone(r.chg_1d)}">${esc(pct(r.chg_1d))}</span>
        <span class="mb-num mb-num--sm ${tone(r.perf_1w)}">${esc(pct(r.perf_1w))} <span class="mb-tag">1W</span></span>
      </div>
      <div class="mb-row__why">${esc(r.reason || 'kein eindeutiger Nachrichtenauslöser')}</div>
    </li>`).join('')}</ul>
  </section>`;
}

function earningsBlock(rows, find) {
  if (!rows?.length) return '';
  return `<section class="bf-section"><h3 class="bf-h">Anstehende Quartalszahlen</h3>
    <ul class="mb-list">${rows.map((e) => `<li class="mb-row">
      <div class="mb-row__head">
        <span class="mb-date">${esc(e.weekday ?? '')} ${esc(e.date ? `${e.date.slice(8, 10)}.${e.date.slice(5, 7)}.` : '')}</span>
        ${symHtml(e, find)}
        <span class="mb-row__name">${esc(e.name)}</span>
      </div>
      ${e.focus ? `<div class="mb-row__why">${esc(e.focus)}</div>` : ''}
    </li>`).join('')}</ul>
  </section>`;
}

function technikBlock(rows, find) {
  if (!rows?.length) return '';
  return `<section class="bf-section"><h3 class="bf-h">Technik in Kürze</h3>
    <ul class="mb-list">${rows.map((t) => `<li class="mb-row">
      <div class="mb-row__head">
        <span class="mb-chip ${t.dir === 'up' ? 'pos' : t.dir === 'down' ? 'neg' : ''}">${esc(t.signal)}</span>
        ${t.symbol ? symHtml(t, find) : ''}
        <span class="mb-row__name">${esc(t.name)}</span>
      </div>
      ${t.text ? `<div class="mb-row__why">${esc(t.text)}</div>` : ''}
    </li>`).join('')}</ul>
  </section>`;
}

function renderEntry(b, find) {
  if (!b) return '<p class="pv-muted">Für diesen Tag liegt kein Briefing vor.</p>';
  const src = (b.sources ?? []).map((s) => `<li class="bf-note">
      <span class="bf-note__text">${esc(s.title)}${s.date ? ` <span class="mb-muted">· ${esc(s.date)}</span>` : ''}</span>
      ${s.url ? `<a class="link-chip" href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}" aria-label="${esc(s.title)}">${icons.externalLink}</a>` : ''}
    </li>`).join('');
  return `
    <header class="mb-head">
      <div class="mb-dateline">${esc(longDay(b.day))}</div>
      <h3 class="mb-title">${esc(b.title)}</h3>
      <p class="bf-summary">${esc(b.lead)}</p>
      ${b.data_note ? `<p class="bf-foot pv-muted">${esc(b.data_note)}</p>` : ''}
    </header>
    ${indicesBlock(b.indices)}
    ${breadthBlock(b.breadth)}
    ${b.drivers?.length ? `<section class="bf-section"><h3 class="bf-h">Was die Märkte bewegt hat</h3>
      <ul class="mb-drivers">${b.drivers.map((d) => `<li>${esc(d.text ?? d)}</li>`).join('')}</ul></section>` : ''}
    ${chartBlock(b.top, b.flop)}
    ${moverBlock('Top Movers', b.top, find)}
    ${moverBlock('Flops', b.flop, find)}
    ${earningsBlock(b.earnings, find)}
    ${technikBlock(b.technik, find)}
    ${b.fazit ? `<section class="bf-section"><h3 class="bf-h">Fazit des Redakteurs</h3><div class="mb-fazit">${esc(b.fazit)}</div></section>` : ''}
    ${src ? `<section class="bf-section"><h3 class="bf-h">Quellen</h3><ul class="bf-notes">${src}</ul></section>` : ''}
    <p class="bf-foot pv-muted">Einordnung und Fazit von Claude, keine Anlageberatung.</p>`;
}

/**
 * @param {object}   opts
 * @param {function} opts.loadBriefings    – async () => Briefing[] (neueste zuerst)
 * @param {function} opts.loadCandidates   – async () => [{id, symbol, exchange, bucket}]
 * @param {function} opts.onOpenCandidate  – (hit, ctrl) => void
 * @returns {object} ctrl {hide, show, close}
 */
export function renderMarketBriefingModal(opts = {}) {
  const existing = document.getElementById('mb-modal-overlay');
  if (existing) { existing.style.display = ''; return null; }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'mb-modal-overlay';
  overlay.innerHTML = `
    <div class="modal briefing-modal" role="dialog" aria-modal="true" aria-label="Marktbriefing">
      <div class="modal-header">
        <h2>${icons.newspaper} Marktbriefing</h2>
        <div class="modal-header-actions">
          <select class="bf-pick" id="mb-pick" aria-label="Handelstag wählen"></select>
          <button class="icon-btn" id="mb-close" aria-label="Schließen">${icons.xMark}</button>
        </div>
      </div>
      <div class="modal-body" id="mb-body">
        <p class="pv-muted"><span class="ls-loading"></span> Lade Briefing …</p>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const hidden = () => overlay.style.display === 'none';
  const ctrl = {
    hide: () => { overlay.style.display = 'none'; },
    show: () => { overlay.style.display = ''; },
    close: () => { document.removeEventListener('keydown', onKey); overlay.remove(); },
  };
  const onKey = (e) => { if (e.key === 'Escape' && !hidden()) ctrl.close(); };
  overlay.querySelector('#mb-close').addEventListener('pointerup', ctrl.close);
  overlay.addEventListener('pointerup', (e) => { if (e.target === overlay) ctrl.close(); });
  document.addEventListener('keydown', onKey);

  const body = overlay.querySelector('#mb-body');
  const pick = overlay.querySelector('#mb-pick');
  let index = { bySym: new Map(), byId: new Map() };

  /* Symbol (+ Börse) → Kandidat. Ohne passende Börse gewinnt der erste Treffer
     in der Reihenfolge, in der loadCandidates liefert (Watch zuerst). */
  const find = (symbol, exchange) => {
    const list = index.bySym.get(String(symbol ?? '').toUpperCase());
    if (!list?.length) return null;
    if (exchange) return list.find((c) => String(c.exchange ?? '').toUpperCase() === String(exchange).toUpperCase()) ?? list[0];
    return list[0];
  };

  // click statt pointerup: ein Wisch beim Scrollen soll kein Detail öffnen.
  body.addEventListener('click', (e) => {
    const btn = e.target.closest('.mb-sym[data-id]');
    if (!btn) return;
    const hit = index.byId.get(btn.dataset.id);
    if (hit) opts.onOpenCandidate?.(hit, ctrl);
  });

  (async () => {
    let briefings = [];
    try {
      const [list, cands] = await Promise.all([
        opts.loadBriefings?.() ?? [],
        opts.loadCandidates?.().catch(() => []) ?? [],
      ]);
      briefings = Array.isArray(list) ? list.filter((b) => b?.day).sort((a, b) => (a.day < b.day ? 1 : -1)) : [];
      for (const c of cands ?? []) {
        const k = String(c.symbol ?? '').toUpperCase();
        if (!index.bySym.has(k)) index.bySym.set(k, []);
        index.bySym.get(k).push(c);
        index.byId.set(c.id, c);
      }
    } catch (err) {
      body.innerHTML = `<p class="pv-muted">Briefing konnte nicht geladen werden: ${esc(err.message)}</p>`;
      return;
    }
    if (!briefings.length) {
      pick.hidden = true;
      body.innerHTML = `<p class="pv-muted">Noch kein Marktbriefing gespeichert. Gib Claude im
        Auswertungs-Chat „Go“ – das Briefing erscheint danach hier.</p>`;
      return;
    }
    pick.innerHTML = briefings.map((b, i) => `<option value="${i}">${esc(shortDay(b.day))}</option>`).join('');
    const mount = (i) => { body.innerHTML = renderEntry(briefings[i], find); body.scrollTop = 0; };
    pick.addEventListener('change', () => mount(Number(pick.value)));
    mount(0);
  })();

  return ctrl;
}
