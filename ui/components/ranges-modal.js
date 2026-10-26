/**
 * Watch Ranges — Modal-Fassung des Claude-Artefakts „Watch Ranges".
 *
 * Optik und Bedienung sind eine 1:1-Kopie des Artefakts: gleiches Markup,
 * gleiche Klassen, gleiche CSS (ranges-modal.css, im Shadow DOM, damit die
 * App-Styles wie .btn/.row/.chip nicht hineinwirken), gleiche Bruch-Logik,
 * gleicher Level-Editor mit Chart.
 *
 * Datenquelle ist der Watch-Blob statt der Artefakt-Datenbank. Die Range je
 * Titel wird genau wie in netlify/functions/watch-ranges.js gerechnet
 * (computePriceClusters um den TV-Schluss, Fallback 52W-Extrem) und in EUR
 * angezeigt:
 *   - Levels/Zonen/Cluster: native Währung × EUR-Faktor (nur USD↔EUR umrechenbar)
 *   - Kurs: LS-Kurs (EUR, wie im Artefakt), sonst TV-Schluss umgerechnet
 *   - Kursverlauf: swing_analysis.ohlc (Schlusskurse) + heutiger LS-Kurs.
 *     Die Kerzen lädt das Modal selbst nach, mit demselben Abruf wie das
 *     Detail-Sheet (opts.loadCandles): beim Aufklappen einer Zeile sofort, wenn
 *     sie fehlen oder älter als 20 h sind; beim Öffnen im Hintergrund für alle
 *     Titel ohne Kerzen (Yahoo in Wellen von 6, US/TwelveData gedrosselt).
 *   - Weder EUR noch USD (SEK, GBX …): EUR-Basis aus eur-basis.js — Verlauf
 *     aus LS-Schlusskursen, sonst deutschem Yahoo-Listing, sonst Kerzen ×
 *     Wechselkurs; Levels über den implizierten Faktor `eur_basis.f` in EUR.
 *   - Overrides: candidate.range_override { sup, res } in NATIVER Währung —
 *     dasselbe Feld, das watch-ranges.js liest
 *   - Alarme: candidate.range_alarm (angehakt) + Alerts wr_sup_<id>/wr_res_<id>
 *     (price_below/price_above, EUR) im selben Format wie watch-alarms.js;
 *     in der App direkt geschrieben, ohne Abgleich-Aufgabe.
 *
 * Nicht übernommen, weil an die Artefakt-Datenbank/Claude-Aufgaben gebunden:
 * Momentum-Analyse und Tiefenanalyse (samt ihrer Marken in der Zeile).
 */

import { computePriceClusters } from '../lib/price-cluster.js?v=20260807a';
import { normalizeExchange } from '../lib/exchange-map.js';
import { isEtf } from '../lib/instrument-type.js?v=20260831a';
import { needsEurBasis, eurBasisFresh, EUR_BASIS_LABEL } from '../lib/eur-basis.js?v=20261026a';

const CSS_URL = new URL('./ranges-modal.css?v=20261025a', import.meta.url).href;

const C = { bg: '#0f172a', text: '#94a3b8', grid: '#1a2436', border: '#263247', line: '#38bdf8', pos: '#34C759', neg: '#ff5147', faint: '#64748b', warn: '#fbbf24' };

/* Lucide-Icons, identisch zum Artefakt */
const PIN = '<svg class="pin" viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-label="manuell gesetzt"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
const I_TV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v4"/><rect width="4" height="6" x="7" y="9" rx="1"/><path d="M9 15v2"/><path d="M17 3v2"/><rect width="4" height="8" x="15" y="5" rx="1"/><path d="M17 13v3"/><path d="M3 3v16a2 2 0 0 0 2 2h16"/></svg>';
const I_DISC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/><path d="m21 3-9 9"/><path d="M15 3h6v6"/></svg>';
const I_BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/></svg>';
const BL = '<svg class="bl" viewBox="0 0 24 24" aria-label="Alarm scharf"><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/></svg>';
const I_CHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const I_STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>';
const I_EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
const I_LAYERS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>';
const I_REFRESH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>';
const I_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

const SECTOR = { 'Electronic Technology': 'Elektroniktechnik', 'Technology Services': 'Technologie-Dienste', Finance: 'Finanzen', 'Producer Manufacturing': 'Industrieproduktion', 'Industrial Services': 'Industriedienste', 'Distribution Services': 'Handel & Distribution', Communications: 'Kommunikation', 'Non-Energy Minerals': 'Rohstoffe', 'Process Industries': 'Grundstoffe & Chemie', Utilities: 'Versorger', 'Commercial Services': 'Unternehmensdienste', 'Energy Minerals': 'Energie', 'Health Technology': 'Gesundheitstechnik', 'Health Services': 'Gesundheitsdienste', 'Consumer Durables': 'Gebrauchsgüter', 'Consumer Non-Durables': 'Verbrauchsgüter', 'Consumer Services': 'Konsumdienste', 'Retail Trade': 'Einzelhandel', Transportation: 'Transport' };

function fmt(v) { if (v == null || !isFinite(v)) return '–'; const d = v >= 1000 ? 0 : v >= 100 ? 1 : 2; return Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function pct(v, sign) { if (v == null || !isFinite(v)) return ''; const s = Math.abs(v).toFixed(1).replace('.', ','); return (sign ? (v >= 0 ? '+' : '−') : '') + s + ' %'; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
function hhmm(iso) { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const today = new Date().toDateString() === d.toDateString(); return (today ? '' : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ') + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); }
const num = (v) => (v != null && Number.isFinite(+v) && +v > 0 ? +v : null);
function r4(x) { return Math.floor(x * 1e4 + 0.5) / 1e4; }
const r4n = (x) => (x == null ? null : r4(x));

/* Bruch-Logik – identisch zum Artefakt (und dessen Alarm-Abgleich). Bruch erst ab 0,5 % jenseits des Levels. */
const BRK = 0.005, ZONE = 0.015, PW = 5;

/* ── Daten: Watch-Kandidat → Artefakt-Datensatz ─────────────────────────────── */

// Native Währung → EUR. Nur USD↔EUR ist umrechenbar (siehe „LS = EUR" in CLAUDE.md).
function eurFactor(ccy, fx) {
  if (!ccy || ccy === 'EUR') return 1;
  if (ccy === 'USD' && fx) return 1 / fx;
  return null;
}

function buildItem(c, fx) {
  const tv = c.tv_data ?? {};
  const ccy = String(c.currency ?? '').toUpperCase() || null;
  const eb = c.eur_basis && num(c.eur_basis.f) ? c.eur_basis : null;
  const fE0 = eb && needsEurBasis(c) ? +eb.f : eurFactor(ccy, fx);
  const conv = fE0 != null;
  const fE = conv ? fE0 : 1;                    // nicht umrechenbar → native Anzeige, ohne LS
  const pN = num(tv.close_1m ?? tv.close);
  // Wie watch-ranges.js: LS-Historie (EUR) → native über lsToNative.
  const lsToNative = conv ? 1 / fE : null;
  const pc = pN ? computePriceClusters(tv, { lsHistory: c.ls_history ?? null, refPrice: pN, lsToNative }) : null;
  const lo52 = num(tv.price_52_week_low), hi52 = num(tv.price_52_week_high);
  const ns = pc?.nearestSup, nr = pc?.nearestRes;
  const asN = ns ? ns.mid : lo52, arN = nr ? nr.mid : hi52;
  const labels = (z) => (z?.members ?? []).map((m) => m.label).join(' · ');
  return {
    id: c.id,
    s: c.symbol ?? '',
    n: c.name ?? '',
    p: pN != null ? r4(pN * fE) : null,
    as: asN != null ? r4(asN * fE) : null,
    ar: arN != null ? r4(arN * fE) : null,
    sz: ns ? [r4(ns.lo * fE), r4(ns.hi * fE)] : null,
    rz: nr ? [r4(nr.lo * fE), r4(nr.hi * fE)] : null,
    sl: ns ? labels(ns) : asN != null ? '52W-Tief' : '',
    rl: nr ? labels(nr) : arN != null ? '52W-Hoch' : '',
    cl: (pc?.clusters ?? []).map((z) => [r4(z.mid * fE), z.score]),
    oc: ccy,
    conv,
    fE,
    eb: eb && needsEurBasis(c) ? { src: eb.src, sym: eb.sym } : null,
    c,
  };
}

// Schlusskurse aus swing_analysis.ohlc, in EUR; heute = LS-Kurs (wie im Artefakt).
function buildHist(c, it, fx, livePx) {
  const today = new Date().toISOString().slice(0, 10);
  const eb = c.eur_basis;
  if (it.eb && Array.isArray(eb?.t) && eb.t.length >= 2) {
    const t = eb.t.slice(), cl = eb.c.slice();
    if (livePx > 0) { if (t[t.length - 1] === today) cl[cl.length - 1] = livePx; else if (t[t.length - 1] < today) { t.push(today); cl.push(livePx); } }
    return { t, c: cl };
  }
  const a = c.swing_analysis;
  const bars = Array.isArray(a?.ohlc) ? a.ohlc.filter((b) => b && num(b.c) && b.date) : [];
  if (bars.length < 2) return null;
  const bc = String(a.currency ?? 'USD').toUpperCase();
  const f = it.conv ? eurFactor(bc, fx) : (bc === it.oc ? 1 : null);
  if (f == null) return null;
  const t = bars.map((b) => String(b.date).slice(0, 10));
  const cl = bars.map((b) => r4(+b.c * f));
  if (livePx > 0 && t[t.length - 1] < today) { t.push(today); cl.push(livePx); }
  return { t, c: cl };
}

const isWr = (a) => String(a?.id ?? '').startsWith('wr_');

function wrAlert(cid, side, level, prev, now) {
  const sup = side === 'sup';
  const same = prev && Math.abs((prev.threshold ?? 0) - level) < 1e-6;
  return {
    id: `wr_${side}_${cid}`,
    kind: 'watch',
    type: sup ? 'price_below' : 'price_above',
    threshold: level,
    dir: 'watch',
    enabled: true,
    priority: 4,
    label: `${sup ? 'Support' : 'Resistance'} ${level.toLocaleString('de-DE', { minimumFractionDigits: level >= 1000 ? 0 : 2, maximumFractionDigits: level >= 1000 ? 0 : 2 })} €`,
    note: 'Watch Ranges',
    basis: { kind: 'level', source: 'Watch Ranges' },
    created_at: same && prev.created_at ? prev.created_at : now,
  };
}

/* ── Modal ───────────────────────────────────────────────────────────────────── */

/**
 * @param {object} opts
 * @param {() => Promise<object[]>} opts.getCandidates  Kandidaten des Watch-Blobs
 * @param {() => number|null} opts.getFx                EUR/USD (USD je EUR)
 * @param {(id:string, patch:object) => Promise<void>} [opts.persist]  schreibt in den Watch-Blob; fehlt → nur lokal (Mock)
 * @param {(cands:object[], onEach:(c:object)=>void) => Promise<void>} [opts.refreshLs]  LS-Kurse holen; fehlt → Knopf aus
 * @param {(c:object, ctrl:{hide:Function, show:Function}) => void} [opts.onOpenCandidate]  Detail-Sheet öffnen
 * @param {object} [opts.loader]  Nachladen wie im Detail-Sheet; fehlt → kein Nachladen (Mock)
 *   loader.canCandles(c) → bool · loader.isUs(c) → bool (TwelveData, gedrosselt)
 *   loader.candles(c) / loader.eurBasis(c) → Promise<{ ok, error?, msg? }> (schreiben selbst in den Blob)
 */
export function openRangesModal({ getCandidates, getFx, persist, refreshLs, onOpenCandidate, loader = null } = {}) {
  if (document.getElementById('ranges-modal-host')) return null;

  const host = document.createElement('div');
  host.id = 'ranges-modal-host';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-label', 'Watch Ranges');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<link rel="stylesheet" href="${CSS_URL}">
<div class="wr-root" id="scroller">
<div class="wrap">
  <header>
    <div class="hrow">
      <button class="chip fl" id="flstar" aria-pressed="false" aria-label="Nur Portfolio (Stern)" title="Nur Titel mit Stern (Portfolio) in Discovery">${I_STAR}<b id="nstar"></b></button>
      <button class="chip fl" id="flwatch" aria-pressed="false" aria-label="Nur Watch-Label" title="Nur Titel mit Watch-Label in Discovery">${I_EYE}<b id="nwatch"></b></button>
      <button class="chip" id="grpbtn" aria-pressed="false" title="Nach Sektor gruppieren" aria-label="Nach Sektor gruppieren">${I_LAYERS}</button>
      <div class="info" id="info" title="Tippen für den vollen Status"><span id="meta">lädt …</span><span id="alst" role="status"></span><span class="st" id="lsst" role="status"></span><span id="ldst" role="status"></span></div>
      <button class="btn pri ico" id="lsbtn" type="button" aria-label="LS-Kurse aktualisieren" title="LS-Kurse aktualisieren">${I_REFRESH}</button>
      <button class="btn ico x" id="close" type="button" aria-label="Schließen" title="Schließen">${I_X}</button>
    </div>
    <div class="tools">
      <button class="chip" data-sort="res" aria-pressed="true">Nähe Res</button>
      <button class="chip" data-sort="sup" aria-pressed="false">Nähe Sup</button>
      <button class="chip" data-sort="trend" aria-pressed="false" title="Nach Kursveränderung der letzten 5 Handelstage">Trend 5T</button>
      <button class="chip" data-sort="out" aria-pressed="false">Ausbrüche<b id="outn"></b></button>
      <button class="chip" data-sort="az" aria-pressed="false">A–Z</button>
    </div>
  </header>
  <div id="list"><p class="empty">Die Ranges der Watchlist werden geladen.</p></div>
</div>
</div>`;
  document.body.appendChild(host);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const $ = (id) => root.getElementById(id);
  const listEl = $('list'), scroller = $('scroller');

  const S = { items: [], ov: {}, live: null, liveAt: null, hist: {}, meta: {}, sort: 'res', group: false, closed: {}, q: '', open: null, tf: '6M', sel: null, chart: null, alarms: {}, armed: {}, aState: {}, flags: {}, fStar: false, fWatch: false, ls: { run: false, done: 0, total: 0, at: null, err: '' }, synced: {},
    ld: { busy: {}, err: {}, run: false, done: 0, total: 0, tdStop: false } };
  try { S.sort = localStorage.getItem('wr_sort') || S.sort; S.tf = localStorage.getItem('wr_tf') || S.tf; S.group = localStorage.getItem('wr_group') === '1'; S.fStar = localStorage.getItem('wr_fstar') === '1'; S.fWatch = localStorage.getItem('wr_fwatch') === '1'; S.closed = JSON.parse(localStorage.getItem('wr_closed') || '{}') || {}; } catch (e) {}

  /* Kandidaten → Zustand (wie die Artefakt-Snapshots) */
  function ingest(cands) {
    const fx = getFx?.() ?? null;
    const items = [], ov = {}, live = {}, hist = {}, meta = {}, flags = {}, alarms = {}, armed = {};
    let liveAt = null;
    for (const c of cands) {
      const it = buildItem(c, fx);
      items.push(it);
      const o = c.range_override ?? {};
      const sN = num(o.sup), rN = num(o.res);
      if (sN || rN) ov[it.id] = { sup: sN ? r4(sN * it.fE) : null, res: rN ? r4(rN * it.fE) : null };
      const q = c.ls_quote;
      const lp = it.conv && num(q?.price) ? +q.price : null;
      if (lp) {
        live[it.id] = { p: lp, prev: num(q.prev_close) };
        if (q.checked_at && (!liveAt || q.checked_at > liveAt)) liveAt = q.checked_at;
      }
      const h = buildHist(c, it, fx, lp);
      if (h) hist[it.id] = h;
      meta[it.id] = { x: normalizeExchange(c.exchange) || c.exchange || '', sec: c.sector || '', sub: c.sub_sector || '', t: isEtf(c) ? 'ETF' : '' };
      flags[it.id] = { s: !!c.in_portfolio, w: !!c.watch_flag, e: num(c.mk_entry) };
      const wr = (c.alerts ?? []).filter(isWr);
      if (c.range_alarm === true || wr.length) alarms[it.id] = { on: true };
      const thr = (side) => num(wr.find((a) => a.id === `wr_${side}_${it.id}`)?.threshold);
      armed[it.id] = { sup: thr('sup'), res: thr('res') };
    }
    Object.assign(S, { items, ov, live: Object.keys(live).length ? { p: live, at: liveAt } : null, hist, meta, flags, alarms, armed });
  }

  function price(it) { const l = S.live && S.live.p && S.live.p[it.id]; return l ? { p: l.p, prev: l.prev, ls: true } : { p: it.p, prev: null, ls: false }; }

  function nextLevel(it, p, dir) {
    const beyond = (x) => x > 0 && (dir > 0 ? x > p * (1 + BRK) : x < p * (1 - BRK));
    const near = (a, b) => Math.abs(a - p) - Math.abs(b - p);
    const cs = (it.cl || []).map((c) => +c[0]).filter(beyond).sort(near);
    if (cs.length) return { lvl: cs[0], src: 'Cluster' };
    const h = S.hist[it.id], c = h && h.c ? h.c.filter((x) => x > 0) : [];
    if (c.length >= 2 * PW + 1) {
      let piv = [];
      for (let i = PW; i < c.length - PW; i++) { const w = c.slice(i - PW, i + PW + 1), mx = Math.max.apply(null, w), mn = Math.min.apply(null, w); if (c[i] === mx || c[i] === mn) piv.push(c[i]); }
      piv = piv.filter(beyond).sort(near);
      const zones = [];
      piv.forEach((x) => { const z = zones[zones.length - 1]; if (z && Math.abs(x - z.start) / z.start <= ZONE) z.v.push(x); else zones.push({ start: x, v: [x] }); });
      const pick = zones.filter((z) => z.v.length >= 2)[0] || zones[0];
      if (pick) return { lvl: r4(pick.v.reduce((a, b) => a + b, 0) / pick.v.length), src: 'Swing-Pivot', n: pick.v.length };
    }
    if (c.length) { const y = c.slice(-252), ext = dir > 0 ? Math.max.apply(null, y) : Math.min.apply(null, y); if (beyond(ext)) return { lvl: ext, src: dir > 0 ? '52W-Hoch' : '52W-Tief' }; }
    let mv = 0.08;
    if (c.length >= 21) {
      const t = c.slice(-21), rs = [];
      for (let j = 1; j < t.length; j++) rs.push(t[j] / t[j - 1] - 1);
      const m = rs.reduce((a, b) => a + b, 0) / rs.length, sd = Math.sqrt(rs.reduce((a, b) => a + (b - m) * (b - m), 0) / (rs.length - 1));
      mv = Math.max(0.03, 2 * sd * Math.sqrt(10));
    }
    const tg = p * (1 + dir * mv), step = Math.pow(10, Math.floor(Math.log10(p))) / 4;
    let lv = dir > 0 ? Math.ceil(tg / step) * step : Math.floor(tg / step) * step;
    if (!(lv > 0)) lv = tg;
    return { lvl: r4(lv), src: 'Volatilität' };
  }
  /* ★ Einstand (EUR) aus der Merkliste – nur für Titel mit Stern */
  function entryOf(it) { const f = S.flags[it.id]; return f && f.s && f.e > 0 ? +f.e : null; }
  function view(it) {
    const o = S.ov[it.id] || {}, supM = o.sup > 0, resM = o.res > 0;
    let sup = supM ? o.sup : it.as, res = resM ? o.res : it.ar, sz = supM ? null : it.sz, rz = resM ? null : it.rz;
    const pr = price(it), p = pr.p;
    const bSup = sup, bRes = res;
    let brk = null, nl = null;
    const st = p > 0 && res > 0 && p > res * (1 + BRK) ? 'up' : p > 0 && sup > 0 && p < sup * (1 - BRK) ? 'dn' : '';
    /* Bruch: das gebrochene Level wechselt die Seite, in Bruchrichtung kommt das nächste Level. Gilt auch für manuelle Levels. */
    if (st) {
      const lv = (it.cl || []).map((c) => +c[0]).concat([sup, res]).filter((x) => x > 0);
      if (st === 'up') { brk = { side: 'res', lvl: res }; sup = Math.max.apply(null, lv.filter((x) => x < p)); nl = nextLevel(it, p, 1); res = nl.lvl; }
      else { brk = { side: 'sup', lvl: sup }; res = Math.min.apply(null, lv.filter((x) => x > p)); nl = nextLevel(it, p, -1); sup = nl.lvl; }
      sz = null; rz = null;
    }
    const lo = sup != null ? Math.min(sz ? sz[0] : sup, sup) : p * 0.97, hi = res != null ? Math.max(rz ? rz[1] : res, res) : p * 1.03;
    const pos = (sup != null && res != null && res > sup) ? (p - sup) / (res - sup) : null;
    return { sup, res, bSup, bRes, supM: supM && !st, resM: resM && !st, sz, rz, lo, hi, pos, st, brk, nl, p, pr };
  }

  /* Was scharf sein müsste – überschrittene Levels bekommen keinen Alarm. */
  function wantArm(v) { return { sup: v.sup && v.p > v.sup ? r4(v.sup) : null, res: v.res && v.p < v.res ? r4(v.res) : null }; }
  function differs(a, b) { if (!a && !b) return false; if (!a || !b) return true; return Math.abs(a - b) / b > 0.002; }

  /* Range-Alarme: angehakt = range_alarm; scharf = vorhandene wr_-Alerts. */
  async function syncAlarm(id, on) {
    const it = S.items.find((x) => x.id === id); if (!it) return;
    const c = it.c, now = new Date().toISOString();
    const old = Array.isArray(c.alerts) ? c.alerts : [];
    const prev = (side) => old.find((a) => a?.id === `wr_${side}_${id}`);
    const w = on ? wantArm(view(it)) : { sup: null, res: null };
    if (w.sup != null && w.res != null && w.sup >= w.res) { w.sup = null; w.res = null; }
    const mine = [];
    if (w.sup != null) mine.push(wrAlert(id, 'sup', w.sup, prev('sup'), now));
    if (w.res != null) mine.push(wrAlert(id, 'res', w.res, prev('res'), now));
    const alerts = [...old.filter((a) => !isWr(a)), ...mine];
    const before = { alerts: c.alerts, range_alarm: c.range_alarm };
    c.alerts = alerts; c.range_alarm = !!on;
    S.aState[id] = 'wait'; render();
    try {
      if (persist) await persist(id, { alerts, range_alarm: !!on });
      S.aState[id] = '';
      S.armed[id] = { sup: w.sup, res: w.res };
      if (on) S.alarms[id] = { on: true }; else delete S.alarms[id];
    } catch (e) {
      c.alerts = before.alerts; c.range_alarm = before.range_alarm;
      S.aState[id] = 'fail';
    }
    render();
  }
  // Wie checkAlarmLevels im Artefakt: ziehen die Levels weg vom Scharfgestellten, einmal nachziehen.
  function checkAlarmLevels() {
    Object.keys(S.alarms).forEach((id) => {
      if (S.synced[id] || S.aState[id]) return;
      const it = S.items.find((x) => x.id === id), a = S.armed[id] || {};
      if (!it) return;
      const w = wantArm(view(it));
      if (differs(w.sup, a.sup) || differs(w.res, a.res)) { S.synced[id] = 1; syncAlarm(id, true); }
    });
  }
  function almHtml(it) {
    const id = it.id, on = !!S.alarms[id], a = S.armed[id] || {}, st = S.aState[id] || '';
    let cls = 'alm', t;
    if (!on && st !== 'wait') t = 'Alarm für Support und Resistance scharf stellen';
    else if (st === 'fail') { cls += ' fail'; t = 'Nicht gespeichert – Haken einmal ab- und wieder anhaken, um es erneut zu versuchen.'; }
    else if (st === 'wait') { cls += ' wait'; t = 'Alarm wird gespeichert …'; }
    else if (a.sup || a.res) { cls += ' on'; t = 'Alarm scharf: ' + (a.sup ? 'Support ' + fmt(a.sup) + ' €' : '') + (a.sup && a.res ? ' · ' : '') + (a.res ? 'Resistance ' + fmt(a.res) + ' €' : ''); }
    else { cls += ' void'; t = 'Kein Alarm möglich: beide Levels sind bereits überschritten'; }
    return '<label class="' + cls + '" title="' + esc(t) + '"><input type="checkbox" data-alarm="' + esc(id) + '" aria-label="' + esc(it.s + ': ' + t) + '"' + (on ? ' checked' : '') + '>' + I_BELL + '</label>';
  }
  function alarmStatus() {
    const el = $('alst'); if (!el) return;
    const ids = Object.keys(S.alarms), n = ids.length;
    const armedN = ids.filter((id) => { const a = S.armed[id]; return a && (a.sup || a.res); }).length;
    let t = n ? armedN + ' von ' + n + ' Alarmen scharf' : '';
    const fail = Object.values(S.aState).some((x) => x === 'fail');
    if (Object.values(S.aState).some((x) => x === 'wait')) t += (t ? ' · ' : '') + 'Alarme werden gespeichert …';
    else if (fail) t = (n ? n + ' Alarme angehakt · ' : '') + 'Speichern fehlgeschlagen – Haken erneut setzen';
    el.textContent = t; el.style.color = fail ? 'var(--neg)' : '';
  }

  /* Richtung der letzten 5 Handelstage (Schlusskurse, heute = LS): ±1 % gilt als seitwärts. */
  function trend(it) {
    const h = S.hist[it.id]; if (!h || !h.c || h.c.length < 6) return null;
    const c = h.c, now = c[c.length - 1], then = c[c.length - 6]; if (!(then > 0)) return null;
    const ch = (now - then) / then * 100; return { dir: ch >= 1 ? 'up' : ch <= -1 ? 'dn' : '', ch };
  }
  function trendHtml(it, x) {
    const t = trend(it); if (!t || !t.dir) return '';
    const up = t.dir === 'up', side = up ? 'left:min(calc(100% - 10px),calc(' + x + '% + 5px))' : 'left:max(0px,calc(' + x + '% - 15px))';
    return '<svg class="tr ' + t.dir + '" style="' + side + '" viewBox="0 0 10 10" aria-label="5 Tage ' + (up ? 'steigend' : 'fallend') + ' ' + pct(t.ch, true) + '"><path d="' + (up ? 'M3 2l4 3-4 3' : 'M7 2L3 5l4 3') + '"/></svg>';
  }

  function tvUrl(it) {
    const m = S.meta[it.id] || {}, x = String(m.x || '').toUpperCase();
    const sym = String(it.s || '').trim().toUpperCase(); if (!sym) return null;
    return 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(x ? x + ':' + sym : sym) + '&interval=1D';
  }
  function sectorOf(it) {
    const m = S.meta[it.id]; if (!m) return 'Ohne Zuordnung';
    if (m.t === 'ETF' || m.sec === 'Miscellaneous') return m.t === 'ETF' ? 'ETFs' : 'Sonstige';
    return SECTOR[m.sec] || m.sec || 'Ohne Zuordnung';
  }

  function rowHtml(it) {
    const v = view(it);
    const chg = v.pr.prev ? (v.p - v.pr.prev) / v.pr.prev * 100 : null;
    const t = S.sort === 'trend' ? trend(it) : null, tu = tvUrl(it);
    const cur = it.conv ? ' €' : ' ' + esc(it.oc || '');
    const head = '<div class="id">' + almHtml(it) + '<span class="tk">' + esc(it.s) + ((v.supM || v.resM) ? PIN : '') + '</span>' +
      (tu ? '<a class="ib" href="' + esc(tu) + '" target="_blank" rel="noopener" title="Chart in TradingView öffnen" aria-label="' + esc(it.s) + ' in TradingView öffnen">' + I_TV + '</a>' : '') +
      '<button class="ib" type="button" data-detail="' + esc(it.id) + '" title="Detail in Discovery öffnen" aria-label="' + esc(it.s) + ' in Discovery öffnen">' + I_DISC + '</button>' +
      (S.sort === 'trend' ? '<span class="flag ' + (t ? t.dir : '') + '">' + (t ? '5T ' + pct(t.ch, true) : '5T –') + '</span>' : '') +
      '<span class="nm">' + esc(it.n || '') + '</span></div>' +
      '<div class="px"><b class="' + (v.st || (chg != null ? (chg >= 0 ? 'up' : 'dn') : '')) + '">' + fmt(v.p) + cur + '</b>' + (chg != null ? '<span class="' + (chg >= 0 ? 'up' : 'dn') + '">' + pct(chg, true) + '</span>' : '<span class="nm">TV</span>') + '</div>';
    let band;
    if ((v.pos == null && !v.brk) || !(v.hi > v.lo)) { band = '<div class="band"><div></div><div class="hint">keine Range verfügbar</div><div></div></div>'; }
    else {
      const span = v.hi - v.lo, X = (x) => Math.max(0, Math.min(100, (x - v.lo) / span * 100));
      const sL = v.sz ? X(v.sz[0]) : v.sup != null ? X(v.sup) - 1 : -99, sW = v.sz ? Math.max(2, X(v.sz[1]) - X(v.sz[0])) : 2;
      const rL = v.rz ? X(v.rz[0]) : v.res != null ? X(v.res) - 1 : -99, rW = v.rz ? Math.max(2, X(v.rz[1]) - X(v.rz[0])) : 2;
      const ds = v.sup != null ? (v.sup - v.p) / v.p * 100 : null, dr = v.res != null ? (v.res - v.p) / v.p * 100 : null;
      const tone = (d) => (d == null ? '' : d >= 10 ? ' up' : d <= -10 ? ' dn' : '');
      const bk = (side) => {
        if (!v.brk || v.brk.side === side) return '';
        const up = v.st === 'up', same = Math.abs((up ? v.sup : v.res) - v.brk.lvl) < 1e-6;
        return '<small class="bk" title="' + (up ? 'Resistance ' : 'Support ') + fmt(v.brk.lvl) + ' € um mehr als 0,5 % durchbrochen">' + (up ? '↑ ' : '↓ ') + (same ? 'gebrochen' : fmt(v.brk.lvl) + ' gebr.') + '</small>';
      };
      const lvTxt = (x, d, side) => (x != null ? fmt(x) + '<small>' + pct(d, true) + '</small>' : '–<small>kein Level</small>') + bk(side);
      const ar = S.alarms[it.id] ? S.armed[it.id] || {} : {};
      const ek = (() => {
        const e = entryOf(it); if (!e) return '';
        const out = e < v.lo || e > v.hi;
        return '<div class="ek' + (out ? ' out' : '') + '" style="left:' + X(e) + '%" title="★ Einstand ' + fmt(e) + ' € · ' + pct((v.p - e) / e * 100, true) + (out ? ' · außerhalb der Range' : '') + '"></div>';
      })();
      band = '<div class="band">' +
        '<div class="lv s' + tone(ds) + '">' + (ar.sup ? BL : '') + lvTxt(v.sup, ds, 'sup') + '</div>' +
        '<div class="trk" aria-label="Kurs ' + fmt(v.p) + ' Euro zwischen Support ' + fmt(v.sup) + ' und Resistance ' + fmt(v.res) + '"><div class="rail"></div>' +
        (sL > -50 ? '<div class="zs" style="left:' + sL + '%;width:' + sW + '%"></div>' : '') + (rL > -50 ? '<div class="zr" style="left:' + rL + '%;width:' + rW + '%"></div>' : '') +
        ek +
        '<div class="mk ' + v.st + '" style="left:' + X(v.p) + '%"></div>' + trendHtml(it, X(v.p)) + '</div>' +
        '<div class="lv r' + tone(dr) + '">' + (ar.res ? BL : '') + lvTxt(v.res, dr, 'res') + '</div></div>';
    }
    let h = '<div class="row" role="button" tabindex="0" data-id="' + esc(it.id) + '" aria-expanded="' + (S.open === it.id) + '">' + head + band + '</div>';
    if (S.open === it.id) h += editorHtml(it, v);
    return h;
  }

  function editorHtml(it, v) {
    const id = esc(it.id);
    const cl = (it.cl || []).map((c) => { const s = c[0] < v.p; return '<button class="cl ' + (s ? 's' : 'r') + '" data-lvl="' + c[0] + '" data-side="' + (s ? 'sup' : 'res') + '">' + fmt(c[0]) + '<em>' + c[1] + '</em></button>'; }).join('');
    const tf = ['1M', '3M', '6M', '1J'].map((t) => '<button data-tf="' + t + '" aria-pressed="' + (S.tf === t) + '">' + t + '</button>').join('');
    const sel = S.sel && S.sel.id === it.id ? S.sel.p : null;
    const m = S.meta[it.id] || {}, sec = sectorOf(it);
    const cu = it.conv ? '€' : esc(it.oc || '');
    const basis = it.eb ? ' (Basis ' + esc(it.eb.src === 'yahoo' ? 'Yahoo ' + it.eb.sym : EUR_BASIS_LABEL[it.eb.src] || it.eb.src) + ')' : '';
    const ccyNote = it.oc && it.oc !== 'EUR' ? (it.conv ? ' · Levels aus ' + esc(it.oc) + ' umgerechnet' + basis : ' · Levels in ' + esc(it.oc) + ' (nicht in EUR umrechenbar)') : '';
    const noChart = S.ld.busy[it.id] ? 'Kursverlauf wird geladen …' : S.ld.err[it.id] ? 'Kein Kursverlauf: ' + esc(S.ld.err[it.id]) : loader && !loader.canCandles(it.c) ? 'Kein Kursverlauf: TwelveData-Key in den Einstellungen hinterlegen (nur für US-Titel nötig).' : 'Noch kein Kursverlauf.';
    return '<div class="ed" data-ed="' + id + '">' +
      '<div class="edh"><span class="nm">' + esc(it.n || it.s) + (m.sub ? ' · ' + esc(m.sub) : sec ? ' · ' + esc(sec) : '') + ccyNote + '</span><div class="tf">' + tf + '</div></div>' +
      (S.hist[it.id] ? '<div class="chart" id="chart"></div>' : '<div class="nochart">' + noChart + '</div>') +
      '<div class="sel" id="sel">' + (sel != null ? 'Gewählt <b>' + fmt(sel) + ' ' + cu + '</b><button class="sbtn s" data-pick="sup">Als Support</button><button class="sbtn r" data-pick="res">Als Resistance</button>' : '<span class="hint">Tippe in den Chart, um einen Preis als Level zu wählen. Ziehen verschiebt, Zwei-Finger zoomt.</span>') + '</div>' +
      '<div class="grid2"><label>Support (' + cu + ')<input class="s" id="sup-' + id + '" inputmode="decimal" value="' + (v.supM ? fmt(v.bSup) : '') + '" placeholder="' + fmt(v.brk ? v.sup : it.as) + '"><span class="auto">auto ' + fmt(it.as) + (it.sl ? ' · ' + esc(it.sl) : '') + '</span></label>' +
      '<label>Resistance (' + cu + ')<input class="r" id="res-' + id + '" inputmode="decimal" value="' + (v.resM ? fmt(v.bRes) : '') + '" placeholder="' + fmt(v.brk ? v.res : it.ar) + '"><span class="auto">auto ' + fmt(it.ar) + (it.rl ? ' · ' + esc(it.rl) : '') + '</span></label></div>' +
      (cl ? '<div><div class="hint" style="margin-bottom:6px">Cluster (Zahl = Stärke) antippen, um sie zu übernehmen</div><div class="cls">' + cl + '</div></div>' : '') +
      (v.brk ? '<div class="hint">' + (v.brk.side === 'res' ? 'Resistance ' : 'Support ') + fmt(v.brk.lvl) + ' € gebrochen → wird ' + (v.brk.side === 'res' ? 'Support' : 'Resistance') + '. Neue ' + (v.brk.side === 'res' ? 'Resistance ' : 'Support ') + fmt(v.nl.lvl) + ' € aus ' + esc(v.nl.src) + (v.nl.n ? ' (' + v.nl.n + (v.nl.n === 1 ? ' Berührung)' : ' Berührungen)') : '') + '. Gilt auch über manuelle Levels; Alarme ziehen automatisch nach. Eigene Levels hier eintragen und speichern – leere Felder übernehmen das angezeigte Level.</div>' : '') +
      '<div class="acts"><button class="btn pri" data-act="save">Speichern</button><button class="btn" data-act="auto">Auf auto zurück</button></div>' +
      '<div class="msg" id="msg-' + id + '" role="status"></div></div>';
  }

  function series(h) { return h.c.map((v, i) => ({ time: h.t[i], value: v })); }

  function mountChart(it) {
    if (S.chart) { try { S.chart.remove(); } catch (e) {} S.chart = null; }
    const el = $('chart'), h = S.hist[it.id]; if (!el || !h || !window.LightweightCharts) return;
    const v = view(it), LW = window.LightweightCharts;
    const ch = LW.createChart(el, {
      autoSize: true,
      layout: { background: { type: 'solid', color: C.bg }, textColor: C.text, fontFamily: 'DM Sans, system-ui, sans-serif', fontSize: 11 },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.border, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderColor: C.border, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: LW.CrosshairMode.Normal },
      localization: { locale: 'de-DE', priceFormatter: fmt },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    const data = series(h);
    const ek = entryOf(it);
    const s = ch.addAreaSeries({ autoscaleInfoProvider: (o) => { const r = o(); if (r && r.priceRange && ek) { r.priceRange.minValue = Math.min(r.priceRange.minValue, ek); r.priceRange.maxValue = Math.max(r.priceRange.maxValue, ek); } return r; }, lineColor: C.line, topColor: 'rgba(56,189,248,.28)', bottomColor: 'rgba(56,189,248,0)', lineWidth: 2, priceLineVisible: true, lastValueVisible: true });
    s.setData(data);
    function line(p, color, style, title, w) { if (p > 0) s.createPriceLine({ price: p, color, lineWidth: w || 1, lineStyle: style, axisLabelVisible: !!title, title: title || '' }); }
    (it.cl || []).forEach((c) => { if (!(v.sup != null && Math.abs(c[0] - v.sup) < 1e-6) && !(v.res != null && Math.abs(c[0] - v.res) < 1e-6)) line(c[0], C.faint, LW.LineStyle.Dotted, '', 1); });
    if (v.sz) { line(v.sz[0], 'rgba(52,199,89,.5)', LW.LineStyle.Dashed); line(v.sz[1], 'rgba(52,199,89,.5)', LW.LineStyle.Dashed); }
    if (v.rz) { line(v.rz[0], 'rgba(255,81,71,.5)', LW.LineStyle.Dashed); line(v.rz[1], 'rgba(255,81,71,.5)', LW.LineStyle.Dashed); }
    if (v.brk && v.brk.lvl !== v.sup && v.brk.lvl !== v.res) line(v.brk.lvl, C.warn, LW.LineStyle.Dashed, 'Bruch', 1);
    if (v.sup != null) line(v.sup, C.pos, LW.LineStyle.Solid, v.brk && v.brk.side === 'res' && v.sup === v.brk.lvl ? 'S (Bruch)' : 'S', 2);
    if (ek) line(ek, '#c26bff', LW.LineStyle.Solid, '★ Einstand', 2);
    if (v.res != null) line(v.res, C.neg, LW.LineStyle.Solid, v.brk && v.brk.side === 'sup' && v.res === v.brk.lvl ? 'R (Bruch)' : 'R', 2);
    let selLine = null;
    const cu = it.conv ? '€' : esc(it.oc || '');
    function drawSel() {
      if (selLine) { s.removePriceLine(selLine); selLine = null; }
      if (S.sel && S.sel.id === it.id) selLine = s.createPriceLine({ price: S.sel.p, color: C.warn, lineWidth: 1, lineStyle: LW.LineStyle.LargeDashed, axisLabelVisible: true, title: 'Wahl' });
      const se = $('sel'); if (se && S.sel && S.sel.id === it.id) se.innerHTML = 'Gewählt <b>' + fmt(S.sel.p) + ' ' + cu + '</b><button class="sbtn s" data-pick="sup">Als Support</button><button class="sbtn r" data-pick="res">Als Resistance</button>';
    }
    drawSel();
    const days = { '1M': 31, '3M': 92, '6M': 183, '1J': 366 }[S.tf] || 183;
    const last = data[data.length - 1].time, from = new Date(new Date(last).getTime() - days * 86400000).toISOString().slice(0, 10);
    try { ch.timeScale().setVisibleRange({ from: from < data[0].time ? data[0].time : from, to: last }); } catch (e) { ch.timeScale().fitContent(); }
    ch.subscribeClick((prm) => {
      if (!prm || !prm.point) return; const p = s.coordinateToPrice(prm.point.y); if (p == null || !(p > 0)) return;
      S.sel = { id: it.id, p: Math.round(p * 100) / 100 }; drawSel();
    });
    S.chart = ch;
  }

  function sorted(a) {
    const P = (it) => view(it).pos;
    const T = (it) => { const t = trend(it); return t ? t.ch : null; };
    if (S.sort === 'out') a = a.filter((it) => view(it).st);
    if (S.sort === 'res' || S.sort === 'out') a.sort((x, y) => (P(y) == null ? -9 : P(y)) - (P(x) == null ? -9 : P(x)));
    else if (S.sort === 'sup') a.sort((x, y) => (P(x) == null ? 9 : P(x)) - (P(y) == null ? 9 : P(y)));
    else if (S.sort === 'trend') a.sort((x, y) => (T(y) == null ? -1e9 : T(y)) - (T(x) == null ? -1e9 : T(x)));
    else a.sort((x, y) => (x.s < y.s ? -1 : 1));
    return a;
  }
  function filtered() {
    const q = S.q.trim().toUpperCase();
    return sorted(S.items.filter((it) => {
      if (S.fStar || S.fWatch) { const f = S.flags[it.id] || {}; if (!((S.fStar && f.s) || (S.fWatch && f.w))) return false; }
      return !q || it.s.toUpperCase().indexOf(q) >= 0 || (it.n || '').toUpperCase().indexOf(q) >= 0 || sectorOf(it).toUpperCase().indexOf(q) >= 0;
    }));
  }

  function groupedHtml(rows) {
    const g = {}, order = [];
    rows.forEach((it) => { const k = sectorOf(it); if (!g[k]) { g[k] = []; order.push(k); } g[k].push(it); });
    const stat = (k) => { const ts = g[k].map(trend).filter(Boolean).map((t) => t.ch); return ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : null; };
    const st = {}; order.forEach((k) => { st[k] = stat(k); });
    order.sort((a, b) => { const x = st[a], y = st[b]; if (x == null && y == null) return a < b ? -1 : 1; if (x == null) return 1; if (y == null) return -1; return y - x; });
    return order.map((k) => {
      const list = g[k], out = list.filter((it) => view(it).st === 'up').length, dn = list.filter((it) => view(it).st === 'dn').length;
      const open = !S.closed[k], t = st[k];
      return '<button class="grp" data-grp="' + esc(k) + '" aria-expanded="' + open + '"><h2>' + esc(k) + '</h2><span class="gm"><span>' + list.length + ' ' + (list.length === 1 ? 'Wert' : 'Werte') + '</span>' +
        (t != null ? '<span class="' + (t >= 1 ? 'up' : t <= -1 ? 'dn' : '') + '">Ø 5T ' + pct(t, true) + '</span>' : '') +
        (out ? '<span class="up">' + out + ' über Res</span>' : '') + (dn ? '<span class="dn">' + dn + ' unter Sup</span>' : '') + '</span>' + I_CHEV + '</button>' +
        (open ? list.map(rowHtml).join('') : '');
    }).join('');
  }

  function render(keepInputs) {
    if (!S.items.length) return;
    const y = scroller.scrollTop;
    // Hintergrund-Updates dürfen getippte Levels im offenen Editor nicht verwerfen.
    const kept = keepInputs && S.open ? ['sup', 'res'].map((k) => { const el = $(k + '-' + S.open); return el ? [k, el.value, root.activeElement === el] : null; }).filter(Boolean) : [];
    const outs = S.items.filter((it) => view(it).st).length; $('outn').textContent = outs ? String(outs) : '';
    const rows = filtered();
    listEl.innerHTML = rows.length ? (S.group ? groupedHtml(rows) : rows.map(rowHtml).join('')) : '<p class="empty">' + ((S.fStar || S.fWatch) && !S.q.trim() ? 'Kein Titel trägt in Discovery diese Markierung.' : S.sort === 'out' ? 'Gerade bricht kein Titel aus seiner Range aus.' : 'Kein Ticker passt zur Suche.') + '</p>';
    let ns = 0, nw = 0; S.items.forEach((it) => { const f = S.flags[it.id]; if (f && f.s) ns++; if (f && f.w) nw++; }); $('nstar').textContent = ns ? String(ns) : ''; $('nwatch').textContent = nw ? String(nw) : '';
    let meta = S.items.length + ' Titel';
    if (S.live && S.live.at) meta += ' · LS ' + hhmm(S.live.at);
    $('meta').textContent = meta; alarmStatus(); checkAlarmLevels();
    ldStatus();
    kept.forEach(([k, v, f]) => { const el = $(k + '-' + S.open); if (el) { el.value = v; if (f) el.focus(); } });
    const it = S.open && S.items.find((x) => x.id === S.open); if (it && $('chart')) mountChart(it); else if (S.chart) { S.chart.remove(); S.chart = null; }
    scroller.scrollTop = y;
  }

  /* ── Kerzen / EUR-Basis nachladen (wie das Detail-Sheet) ─────────────────── */
  const BARS_MS = 20 * 60 * 60 * 1000, TD_GAP_MS = 8000;
  const hasBars = (c) => Array.isArray(c.swing_analysis?.ohlc) && c.swing_analysis.ohlc.length >= 2;
  const barsStale = (c) => { const a = Date.parse(c.swing_analysis?.checked_at ?? ''); return !hasBars(c) || !(Number.isFinite(a) && Date.now() - a < BARS_MS); };
  const basisDue = (c) => needsEurBasis(c) && !eurBasisFresh(c);
  function ldStatus() {
    const el = $('ldst'); if (!el) return;
    el.textContent = S.ld.run ? 'Kerzen ' + S.ld.done + '/' + S.ld.total : '';
  }
  // Gesammelte Updates: offene Editor-Zeile → ganze Liste (mit Eingaben), sonst nur die Zeile.
  const dirty = new Set(); let flushT = null;
  function refreshItem(id) {
    dirty.add(id);
    if (flushT) return;
    flushT = setTimeout(() => {
      flushT = null;
      const ids = [...dirty]; dirty.clear();
      if (host.hidden) return;
      ingest(S.items.map((it) => it.c));
      if (!S.open || ids.includes(S.open)) { render(true); return; }
      ids.forEach((id) => {
        const el = listEl.querySelector('.row[data-id="' + CSS.escape(id) + '"]');
        const it = S.items.find((x) => x.id === id);
        if (el && it) el.outerHTML = rowHtml(it);
      });
      const outs = S.items.filter((it) => view(it).st).length; $('outn').textContent = outs ? String(outs) : '';
      ldStatus();
    }, 150);
  }
  async function loadOne(c, { bars, basis }) {
    const id = c.id;
    if (S.ld.busy[id]) return S.ld.busy[id];
    const p = (async () => {
      if (bars && loader.canCandles(c)) {
        const r = await loader.candles(c);
        if (r?.ok) delete S.ld.err[id];
        else { S.ld.err[id] = r?.msg || 'Abruf fehlgeschlagen'; if (r?.error === 'td_limit') S.ld.tdStop = true; }
      }
      if (basis && needsEurBasis(c)) {
        const r = await loader.eurBasis(c);
        if (!r?.ok && !S.ld.err[id]) S.ld.err[id] = r?.msg || 'Keine EUR-Kurse gefunden';
      }
    })();
    S.ld.busy[id] = p; refreshItem(id);
    try { await p; } catch (e) { S.ld.err[id] = e?.message || 'Abruf fehlgeschlagen'; }
    finally { delete S.ld.busy[id]; refreshItem(id); }
  }
  // Beim Aufklappen: wie das Detail-Sheet sofort holen, was fehlt oder veraltet ist.
  function loadOnOpen(id) {
    if (!loader) return;
    const it = S.items.find((x) => x.id === id); if (!it) return;
    const c = it.c, bars = barsStale(c) && loader.canCandles(c), basis = basisDue(c) || (needsEurBasis(c) && bars);
    if (bars || basis) loadOne(c, { bars, basis });
  }
  // Beim Öffnen: Titel ohne Kerzen (Nicht-US auch veraltete) und fällige EUR-Basis.
  // Yahoo in Wellen von 6; TwelveData (US) nacheinander mit 8 s Abstand (Free: 8/min).
  async function autoLoad() {
    if (!loader || S.ld.run) return;
    const yq = [], tq = [];
    S.items.forEach(({ c }) => {
      const us = loader.isUs(c), can = loader.canCandles(c);
      const bars = can && (us ? !hasBars(c) : barsStale(c));
      const basis = basisDue(c) || (needsEurBasis(c) && bars);
      if (bars || basis) (us && bars ? tq : yq).push({ c, bars, basis });
    });
    if (!yq.length && !tq.length) return;
    Object.assign(S.ld, { run: true, done: 0, total: yq.length + tq.length, tdStop: false }); ldStatus();
    const one = async (j) => { await loadOne(j.c, j); S.ld.done++; ldStatus(); };
    const yahoo = (async () => { for (let i = 0; i < yq.length; i += 6) await Promise.allSettled(yq.slice(i, i + 6).map(one)); })();
    const td = (async () => {
      for (let i = 0; i < tq.length; i++) {
        if (S.ld.tdStop || !host.isConnected) { S.ld.done += tq.length - i; break; }
        await one(tq[i]);
        if (i < tq.length - 1) await new Promise((r) => setTimeout(r, TD_GAP_MS));
      }
    })();
    await Promise.allSettled([yahoo, td]);
    S.ld.run = false; ldStatus();
  }

  function parseNum(s) { s = String(s || '').trim(); s = s.indexOf(',') >= 0 ? s.replace(/\./g, '').replace(',', '.') : s; if (!s) return null; const n = Number(s); return isFinite(n) && n > 0 ? n : NaN; }
  function msg(id, t) { const m = $('msg-' + id); if (m) m.textContent = t; }
  // Overrides werden nativ gespeichert (range_override liest auch watch-ranges.js).
  async function save(id, sup, res) {
    const it = S.items.find((x) => x.id === id); if (!it) return;
    const c = it.c, prev = c.range_override;
    const ro = sup == null && res == null ? null : { sup: sup != null ? r4(sup / it.fE) : null, res: res != null ? r4(res / it.fE) : null, at: new Date().toISOString() };
    c.range_override = ro;
    if (ro) S.ov[id] = { sup, res }; else delete S.ov[id];
    try {
      if (persist) await persist(id, { range_override: ro });
      S.sel = null; render();
      if (S.alarms[id]) syncAlarm(id, true);
    } catch (e) {
      c.range_override = prev;
      const o = prev ?? {};
      if (num(o.sup) || num(o.res)) S.ov[id] = { sup: num(o.sup) ? r4(o.sup * it.fE) : null, res: num(o.res) ? r4(o.res * it.fE) : null }; else delete S.ov[id];
      render(); msg(id, 'Konnte nicht speichern: ' + (e?.message || 'unbekannter Fehler'));
    }
  }

  /* LS-Refresh */
  const btn = $('lsbtn'), stEl = $('lsst');
  if (!refreshLs) btn.hidden = true;
  function lsStatus(t, err) { stEl.textContent = t; stEl.className = 'st' + (err ? ' err' : ''); }
  $('info').addEventListener('click', function () { this.classList.toggle('full'); });
  function syncBtn() {
    const r = S.ls.run; btn.setAttribute('aria-busy', String(!!r)); btn.title = r ? 'Läuft …' : 'LS-Kurse aktualisieren';
    if (r) lsStatus('LS ' + S.ls.done + '/' + S.ls.total);
    else if (S.ls.err) lsStatus(S.ls.err, true);
    else if (S.ls.at) lsStatus('Aktualisiert ' + hhmm(S.ls.at));
  }
  btn.addEventListener('click', async () => {
    if (S.ls.run || !refreshLs) return;
    const cands = S.items.map((it) => it.c);
    S.ls = { run: true, done: 0, total: cands.length, at: null, err: '' }; syncBtn();
    try {
      await refreshLs(cands, () => { S.ls.done++; syncBtn(); });
      S.ls.at = new Date().toISOString();
    } catch (e) {
      S.ls.err = 'Abruf fehlgeschlagen: ' + (e?.message || 'unbekannter Fehler');
    }
    S.ls.run = false;
    ingest(cands); render(); syncBtn();
  });

  /* Schliessen / Ein- und Ausblenden (Detail-Sheet) */
  function close() {
    if (S.chart) { try { S.chart.remove(); } catch (e) {} S.chart = null; }
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = prevOverflow;
    host.remove();
  }
  const ctrl = {
    hide: () => { host.hidden = true; document.body.style.overflow = prevOverflow; },
    show: () => {
      host.hidden = false; document.body.style.overflow = 'hidden'; ingest(S.items.map((it) => it.c)); render();
      // Läuft der Abruf des Detail-Sheets noch, die Zeile nach dessen Ende auffrischen.
      const c = S.detailC; S.detailC = null;
      if (c && c._auto_busy) { const t = setInterval(() => { if (!c._auto_busy || !host.isConnected) { clearInterval(t); refreshItem(c.id); } }, 1000); }
    },
    close,
  };
  function onKey(e) { if (e.key === 'Escape' && !host.hidden) close(); }
  document.addEventListener('keydown', onKey);
  $('close').addEventListener('click', close);

  /* Interaktion – wie im Artefakt */
  root.querySelectorAll('.chip[data-sort]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.sort === S.sort));
    b.addEventListener('click', () => {
      S.sort = b.dataset.sort; try { localStorage.setItem('wr_sort', S.sort); } catch (e) {}
      root.querySelectorAll('.chip[data-sort]').forEach((c) => { c.setAttribute('aria-pressed', String(c === b)); }); render();
    });
  });
  const gb = $('grpbtn'); gb.setAttribute('aria-pressed', String(S.group));
  gb.addEventListener('click', () => { S.group = !S.group; gb.setAttribute('aria-pressed', String(S.group)); try { localStorage.setItem('wr_group', S.group ? '1' : '0'); } catch (e) {} render(); });
  [['flstar', 'fStar', 'wr_fstar'], ['flwatch', 'fWatch', 'wr_fwatch']].forEach((c) => {
    const b = $(c[0]); b.setAttribute('aria-pressed', String(S[c[1]]));
    b.addEventListener('click', () => { S[c[1]] = !S[c[1]]; b.setAttribute('aria-pressed', String(S[c[1]])); try { localStorage.setItem(c[2], S[c[1]] ? '1' : '0'); } catch (e) {} render(); });
  });
  function toggleRow(id) { S.open = S.open === id ? null : id; S.sel = null; render(); if (S.open) loadOnOpen(S.open); }
  listEl.addEventListener('keydown', (e) => {
    const row = e.target.classList && e.target.classList.contains('row') ? e.target : null;
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleRow(row.dataset.id); }
  });
  listEl.addEventListener('change', (e) => {
    const cb = e.target.closest && e.target.closest('input[data-alarm]'); if (!cb) return;
    syncAlarm(cb.dataset.alarm, cb.checked);
  });
  listEl.addEventListener('click', (e) => {
    const dt = e.target.closest('[data-detail]');
    if (dt) {
      const it = S.items.find((x) => x.id === dt.dataset.detail);
      if (it && onOpenCandidate) { S.detailC = it.c; onOpenCandidate(it.c, ctrl); }
      return;
    }
    if (e.target.closest('a') || e.target.closest('.alm')) return;
    const g = e.target.closest('[data-grp]');
    if (g) { const k = g.dataset.grp; if (S.closed[k]) delete S.closed[k]; else S.closed[k] = 1; try { localStorage.setItem('wr_closed', JSON.stringify(S.closed)); } catch (x) {} render(); return; }
    const row = e.target.closest('.row[data-id]');
    if (row) { toggleRow(row.dataset.id); return; }
    const ed = e.target.closest('.ed'); if (!ed) return; const id = ed.dataset.ed;
    const tf = e.target.closest('[data-tf]'); if (tf) { S.tf = tf.dataset.tf; try { localStorage.setItem('wr_tf', S.tf); } catch (x) {} render(); return; }
    const pk = e.target.closest('[data-pick]'); if (pk && S.sel) { $(pk.dataset.pick + '-' + id).value = fmt(S.sel.p); msg(id, 'Übernommen – zum Sichern auf „Speichern“ tippen.'); return; }
    const cl = e.target.closest('.cl'); if (cl) { $(cl.dataset.side + '-' + id).value = fmt(Number(cl.dataset.lvl)); return; }
    const act = e.target.closest('[data-act]'); if (!act) return;
    if (act.dataset.act === 'auto') { save(id, null, null); return; }
    let s = parseNum($('sup-' + id).value), r = parseNum($('res-' + id).value);
    if (Number.isNaN(s) || Number.isNaN(r)) { msg(id, 'Bitte eine positive Zahl eingeben, z. B. 72,50.'); return; }
    /* Leere Felder = aktuell angezeigtes Level (nach Bruch das neue, sonst auto). Nach einem Bruch werden beide Seiten fest gespeichert,
       sonst würde die alte, gebrochene Gegenseite den Bruch sofort wieder auslösen und die Eingabe überstimmen. */
    const it = S.items.find((x) => x.id === id), v = view(it), fs = s != null ? s : v.sup, fr = r != null ? r : v.res;
    if (fs != null && fr != null && fs >= fr) { msg(id, 'Support muss unter der Resistance liegen.'); return; }
    if (v.p > 0 && fs > 0 && v.p < fs * (1 - BRK)) { msg(id, 'Support liegt über dem Kurs (' + fmt(v.p) + ' €) und würde sofort als Bruch zählen.'); return; }
    if (v.p > 0 && fr > 0 && v.p > fr * (1 + BRK)) { msg(id, 'Resistance liegt unter dem Kurs (' + fmt(v.p) + ' €) und würde sofort als Bruch zählen.'); return; }
    if (v.brk) { s = fs; r = fr; }
    msg(id, ''); save(id, s, r);
  });

  /* Daten */
  (async () => {
    let cands;
    try { cands = (await getCandidates()) ?? []; }
    catch (e) { listEl.innerHTML = '<p class="empty">Die Daten konnten nicht geladen werden. Öffne das Fenster neu.</p>'; $('meta').textContent = ''; return; }
    if (!cands.length) { listEl.innerHTML = '<p class="empty">Im Watch-Bucket liegen noch keine Titel.</p>'; $('meta').textContent = ''; return; }
    ingest(cands); render();
    autoLoad();
  })();

  return ctrl;
}
