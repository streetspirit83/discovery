/**
 * Auto-Rotation – Testlauf. Liest Inbox, Archiv und Watchlist, holt TV-Daten frisch,
 * prüft LS für die Titel in Reichweite der Auswahl und zeigt, was verschoben WÜRDE.
 * Schreibt nichts. Läuft über .github/workflows/auto-rotation-dry.yml.
 */
import { fetchTVEnrichment, fetchFxRate } from '../../ui/lib/tv-enrichment.js';
import { fetchMerklisteEntries, applyMerklisteEntries } from '../../ui/lib/merkliste-import.js';
import { normalizeExchange } from '../../ui/lib/exchange-map.js';
import { isEtf } from '../../ui/lib/instrument-type.js';
import { fetchLsPrice } from '../../netlify-backend/netlify/functions/lib/ls-quote.js';
import { RULES, rowOf, select } from './select.mjs';

const mem = new Map();
globalThis.localStorage ??= { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
// tv-enrichment protokolliert jeden Titel – im Testlauf stört das nur.
const log = console.log.bind(console);
for (const k of ['log', 'group', 'groupEnd', 'warn', 'info', 'debug']) console[k] = () => {};

const auth = { backendUrl: process.env.DISCOVERY_BACKEND_URL.replace(/\/$/, ''), secret: process.env.DISCOVERY_SECRET };
async function storage(body) {
  const res = await fetch(`${auth.backendUrl}/api/storage`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-discovery-secret': auth.secret }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(`storage ${body.op}/${body.blob_type ?? ''}: ${j?.error ?? res.status}`);
  return j.data;
}
const keyOf = (c) => `${String(c.symbol ?? '').toUpperCase()}:${normalizeExchange(c.exchange) || c.exchange || ''}`;

const [watch, archive, inbox, lsHist] = await Promise.all([
  storage({ op: 'read', blob_type: 'watch' }), storage({ op: 'read', blob_type: 'archive' }),
  storage({ op: 'read', blob_type: 'inbox' }), storage({ op: 'read_ls_history' }).catch(() => null),
]);
const seen = new Set(), all = []; let dupes = 0;
for (const [bucket, blob] of [['watch', watch], ['inbox', inbox], ['archive', archive]]) {
  for (const c of blob?.candidates ?? []) {
    const k = keyOf(c);
    if (seen.has(k)) { dupes++; continue; }
    seen.add(k);
    all.push({ ...c, _bucket: bucket, ls_history: lsHist?.history?.[c.id]?.snapshots ?? c.ls_history ?? null });
  }
}
const n = (b) => all.filter((c) => c._bucket === b).length;
log(`Bestand: Watchlist ${watch?.candidates?.length ?? 0} · Inbox ${inbox?.candidates?.length ?? 0} · Archiv ${archive?.candidates?.length ?? 0} · ${dupes} Dubletten über Buckets (Watch gewinnt)`);

const mk = await fetchMerklisteEntries(auth).catch(() => null);
if (!mk) { log('Merkliste nicht lesbar – ohne Stern-Schutz kein Lauf.'); process.exit(1); }
applyMerklisteEntries(all, mk);

const fx = await fetchFxRate(auth).catch(() => null);
if (fx) localStorage.setItem('discovery_fx_eurusd_live', String(fx));
const t0 = Date.now();
const updates = await fetchTVEnrichment(all, { ...auth, onProgress: () => {} });
log(`TV-Daten frisch: ${updates.size}/${all.length} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
let cands = all.map((c) => {
  const u = updates.get(c.id);
  return u ? { ...c, ...u, _bucket: c._bucket, ls_history: c.ls_history, tv_data: u.tv_data, mk_entry: c.mk_entry, mk_shares: c.mk_shares } : { ...c, _stale: true };
});
const etfs = cands.filter(isEtf);
cands = cands.filter((c) => !isEtf(c));
log(`ETFs (bleiben unberührt): ${etfs.length} – davon Watchlist ${etfs.filter((c) => c._bucket === 'watch').length}`);

// LS nur für Titel in Reichweite: beste 110 nach Vor-Score plus alle freien Watch-Titel.
const pre = cands.map((c) => rowOf(c)).filter((r) => !r.protect.length);
const reach = new Set([...pre.filter((r) => r.score != null).sort((a, b) => b.score - a.score).slice(0, 110), ...pre.filter((r) => r.bucket === 'watch')].map((r) => r.id));
const todo = cands.filter((c) => reach.has(c.id));
const t1 = Date.now(); let lsLive = 0, lsKnown = 0, lsNone = 0;
for (let i = 0; i < todo.length; i += 6) {
  await Promise.allSettled(todo.slice(i, i + 6).map(async (c) => {
    const q = await fetchLsPrice(c).catch(() => null);
    if (q?.price != null) { c._ls_ok = true; lsLive++; }
    else if (c.tr_check?.ls_id || c.ls_quote?.instrument_id) { c._ls_ok = true; lsKnown++; }   // am Wochenende ohne Kurs, aber bei LS gelistet
    else { c._ls_ok = false; lsNone++; }
  }));
}
log(`LS geprüft: ${todo.length} Titel in ${((Date.now() - t1) / 1000).toFixed(0)} s · Kurs ${lsLive} · gelistet ohne Kurs ${lsKnown} · nicht bei LS ${lsNone}`);

const rows = cands.map((c) => rowOf(c));
const f = (v, d = 0) => (v == null ? '  –' : v.toFixed(d));
const pad = (s, w) => String(s ?? '').slice(0, w).padEnd(w);
const line = (r) => `${String(r.rank ?? '').padStart(3)} ${pad(r.symbol, 7)} ${pad(r.name, 22)} ${pad(r.bucket, 7)} ${f(r.score, 1).padStart(5)} | Bias ${f(r.bias).padStart(4)} Score ${f(r.overall).padStart(3)} Health ${f(r.health).padStart(3)} Trend ${f(r.trend).padStart(3)} ROIC ${f(r.roic).padStart(4)} | Fair ${f(r.fair_upside).padStart(4)}% Ziel ${f(r.analyst_upside).padStart(4)}% ${r.above_sma200 === false ? '<S200' : '     '}`;

const scored = rows.filter((r) => r.score != null);
log(`\nAuswahl-Score vorhanden: ${scored.length}/${rows.length} Aktien · ohne Bias/Score: ${rows.length - scored.length}`);
const q = (p) => { const s = scored.map((r) => r.score).sort((a, b) => a - b); return s[Math.floor((s.length - 1) * p)]; };
log(`Verteilung: Min ${q(0)} · 25 % ${q(0.25)} · Median ${q(0.5)} · 75 % ${q(0.75)} · 90 % ${q(0.9)} · Max ${q(1)}`);
const cnt = (fn) => scored.filter(fn).length;
log(`Bias > 0: ${cnt((r) => r.bias > 0)} · über SMA200: ${cnt((r) => r.above_sma200)} · ROIC > 0: ${cnt((r) => r.roic > 0)} · ROIC fehlt: ${cnt((r) => r.roic == null)} · Fair ≥ Kurs: ${cnt((r) => r.fair_upside >= 0 && r.fair_upside != null)} · Fair fehlt: ${cnt((r) => r.fair_upside == null)} · Ziel ≥ Kurs: ${cnt((r) => r.analyst_upside >= 0 && r.analyst_upside != null)} · Ziel fehlt: ${cnt((r) => r.analyst_upside == null)}`);

function show(title, res) {
  log(`\n════ ${title} ════`);
  const prot = res.protectedRows;
  const why = (w) => prot.filter((r) => r.protect.includes(w)).length;
  log(`Geschützt (zählen nicht zu den 50): ${prot.length} – Stern ${why('Stern')} · Auge ${why('Auge')} · Alarm ${why('Alarm')} · davon noch nicht in der Watchlist: ${res.pulled.length}${res.pulled.length ? ' (' + res.pulled.map((r) => `${r.symbol}/${r.bucket}`).join(', ') + ')' : ''}`);
  log(`Rangliste: ${res.ranked.length} freie Titel · Auswahl ${res.watch.length} · Watchlist danach: ${res.watch.length + prot.length + res.kept_no_data.length} (+ ETFs)`);
  log(`Herkunft der Auswahl: Watchlist ${res.watch.filter((r) => r.bucket === 'watch').length} · Archiv ${res.watch.filter((r) => r.bucket === 'archive').length} · Inbox ${res.watch.filter((r) => r.bucket === 'inbox').length}`);
  log(`Score-Schwelle: Platz ${res.watch.length} = ${res.watch.at(-1)?.score} · Platz 1 = ${res.watch[0]?.score}`);
  log(`\nAuswahl (${res.watch.length}):`); res.watch.forEach((r) => log(line(r)));
  log(`\nKommt neu in die Watchlist (${res.enter.length}): ${res.enter.map((r) => `${r.symbol}(${r.bucket[0].toUpperCase()},${r.score})`).join(' ')}`);
  log(`\nWandert ins Archiv (${res.leave.length}):`); res.leave.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).forEach((r) => log(line(r)));
  if (res.kept_no_data.length) log(`\nBleibt ohne Daten liegen (${res.kept_no_data.length}): ${res.kept_no_data.map((r) => r.symbol).join(' ')}`);
  log(`\nKnapp draussen (Rang ${res.watch.length + 1}–${res.watch.length + 10}):`); res.ranked.filter((r) => !res.watch.includes(r)).slice(0, 10).forEach((r) => log(line(r)));
}

const A = select(rows.map((r) => ({ ...r })), RULES);
show('Variante A – weich: nur Score, keine Ausschlüsse', A);
const B = select(rows.map((r) => ({ ...r })), RULES, (r) => r.bias > 0 && r.above_sma200 === true);
show('Variante B – hart: zusätzlich Bias > 0 und Kurs über SMA200', B);
const C = select(rows.map((r) => ({ ...r })), RULES, (r) => r.bias > 0 && r.above_sma200 === true && r.roic != null && r.roic > 0);
show('Variante C – sehr hart: wie B, zusätzlich ROIC > 0', C);
const ids = (res) => new Set(res.watch.map((r) => r.id));
const overlap = (x, y) => [...ids(x)].filter((i) => ids(y).has(i)).length;
log(`\nÜberschneidung der Auswahl: A∩B ${overlap(A, B)} · A∩C ${overlap(A, C)} · B∩C ${overlap(B, C)}`);
const inboxRest = rows.filter((r) => r.bucket === 'inbox' && !r.protect.length && !ids(A).has(r.id));
log(`Inbox-Rest, der wöchentlich gelöscht würde (Variante A): ${inboxRest.length} von ${n('inbox')}`);
