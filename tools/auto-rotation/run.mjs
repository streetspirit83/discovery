/**
 * Auto-Rotation – täglicher Lauf (GitHub Action auto-rotation.yml, werktags vor dem Monitor-Bericht).
 *
 *   1. Watchlist, Inbox, Archiv lesen (Dubletten nach Symbol+Börse einmal, Watch gewinnt),
 *      Merkliste für den Stern-Schutz. Ohne Merkliste kein Lauf.
 *   2. TV-Daten für alle Titel frisch holen; LS-Kurs für alle Titel in Reichweite der Auswahl prüfen.
 *   3. Auswahl rechnen (select.mjs): 40 Momentum + 10 Qualität, dazu die geschützten Titel.
 *   4. Modus `live`: TV-Daten in die Buckets schreiben, verschieben (Inbox/Archiv → Watchlist,
 *      Watchlist → Archiv), freitags den Inbox-Rest löschen, der älter als INBOX_MIN_DAYS ist.
 *      Modus `dry` (Probelauf): nichts schreiben ausser dem Bericht.
 *   5. Bericht in den market-Blob (`auto_rotation.reports`, neueste zuerst) – der Monitor-Reiter
 *      „Rotation“ zeigt ihn. Kein KI-Text: alles entsteht aus den Zahlen des Laufs.
 *
 * Der Modus steht im market-Blob (`auto_rotation.mode`, Schalter im Reiter), Standard `dry`.
 * FORCE_MODE=dry erzwingt einen Probelauf (Workflow-Eingabe), FORCE_MODE=live gibt es bewusst nicht.
 *
 * Env: DISCOVERY_BACKEND_URL, DISCOVERY_SECRET, optional FORCE_MODE=dry
 */
import { fetchTVEnrichment, fetchFxRate } from '../../ui/lib/tv-enrichment.js';
import { fetchMerklisteEntries, applyMerklisteEntries } from '../../ui/lib/merkliste-import.js';
import { normalizeExchange } from '../../ui/lib/exchange-map.js';
import { isEtf } from '../../ui/lib/instrument-type.js';
import { fetchLsPrice } from '../../netlify-backend/netlify/functions/lib/ls-quote.js';
import { RULES, rowOf, select, whyEnter, whyLeave } from './select.mjs';

const KEEP_REPORTS = 30;
const INBOX_MIN_DAYS = 5;        // jüngere Inbox-Titel überleben das Löschen am Freitag
const LS_REACH = 110;            // LS-Prüfung für die besten N nach Momentum-Score …
const LS_REACH_Q = 40;           // … und nach Qualitäts-Score, plus alle freien Watch-Titel
const CHUNK = 40;                // Titel je bulk_update (Antwortgrösse der Netlify-Funktion)

const mem = new Map();
globalThis.localStorage ??= { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
// tv-enrichment protokolliert jeden Titel – hier zählt nur die Zusammenfassung.
const log = console.log.bind(console);
for (const k of ['log', 'group', 'groupEnd', 'warn', 'info', 'debug']) console[k] = () => {};

const auth = { backendUrl: process.env.DISCOVERY_BACKEND_URL.replace(/\/$/, ''), secret: process.env.DISCOVERY_SECRET };
async function storage(body) {
  const res = await fetch(`${auth.backendUrl}/api/storage`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-discovery-secret': auth.secret }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(`storage ${body.op}/${body.blob_type ?? body.from_blob ?? ''}: ${j?.error ?? res.status}`);
  return j.data ?? j;
}
const keyOf = (c) => `${String(c.symbol ?? '').toUpperCase()}:${normalizeExchange(c.exchange) || c.exchange || ''}`;
const fail = (msg) => { log(`✗ ${msg} – kein Lauf, nichts verändert.`); process.exit(1); };

async function main() {
  const startedAt = new Date();
  const [watch, archive, inbox, lsHist, market0] = await Promise.all([
    storage({ op: 'read', blob_type: 'watch' }), storage({ op: 'read', blob_type: 'archive' }),
    storage({ op: 'read', blob_type: 'inbox' }), storage({ op: 'read_ls_history' }).catch(() => null),
    storage({ op: 'read', blob_type: 'market' }),
  ]);
  const mode = process.env.FORCE_MODE === 'dry' ? 'dry' : (market0?.auto_rotation?.mode === 'live' ? 'live' : 'dry');
  const live = mode === 'live';
  log(`Modus: ${live ? 'SCHARF' : 'Probelauf'}${process.env.FORCE_MODE === 'dry' ? ' (erzwungen)' : ''}`);

  const seen = new Set(), all = [];
  for (const [bucket, blob] of [['watch', watch], ['inbox', inbox], ['archive', archive]]) {
    for (const c of blob?.candidates ?? []) {
      const k = keyOf(c);
      if (seen.has(k)) continue;
      seen.add(k);
      all.push({ ...c, _bucket: bucket, ls_history: lsHist?.history?.[c.id]?.snapshots ?? c.ls_history ?? null });
    }
  }
  const sizes = { watch: watch?.candidates?.length ?? 0, inbox: inbox?.candidates?.length ?? 0, archive: archive?.candidates?.length ?? 0 };
  log(`Bestand: Watchlist ${sizes.watch} · Inbox ${sizes.inbox} · Archiv ${sizes.archive}`);

  const mk = await fetchMerklisteEntries(auth).catch(() => null);
  if (!mk) fail('Merkliste nicht lesbar (Stern-Schutz fehlt)');
  applyMerklisteEntries(all, mk);

  const fx = await fetchFxRate(auth).catch(() => null);
  if (fx) localStorage.setItem('discovery_fx_eurusd_live', String(fx));
  const updates = await fetchTVEnrichment(all, { ...auth, onProgress: () => {} });
  log(`TV-Daten frisch: ${updates.size}/${all.length}`);
  if (updates.size < all.length * 0.7) fail('Weniger als 70 % der Titel mit TV-Daten');

  let cands = all.map((c) => {
    const u = updates.get(c.id);
    return u ? { ...c, ...u, _bucket: c._bucket, ls_history: c.ls_history, tv_data: u.tv_data, mk_entry: c.mk_entry, mk_shares: c.mk_shares } : { ...c, _stale: true };
  });
  const etfs = cands.filter(isEtf).length;
  cands = cands.filter((c) => !isEtf(c));   // ETFs bleiben, wo sie sind

  // LS nur für Titel in Reichweite der Auswahl.
  const pre = cands.map((c) => rowOf(c)).filter((r) => !r.protect.length);
  const top = (key, n) => pre.filter((r) => r[key] != null).sort((a, b) => b[key] - a[key]).slice(0, n);
  const reach = new Set([...top('score', LS_REACH), ...top('qscore', LS_REACH_Q), ...pre.filter((r) => r.bucket === 'watch')].map((r) => r.id));
  const todo = cands.filter((c) => reach.has(c.id));
  const lsMissing = [];
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.allSettled(todo.slice(i, i + 6).map(async (c) => {
      const q = await fetchLsPrice(c).catch(() => null);
      // Ohne Kurs (Wochenende, Feiertag) genügt die bekannte LS-Instrument-ID.
      c._ls_ok = q?.price != null || !!(c.tr_check?.ls_id || c.ls_quote?.instrument_id);
      if (!c._ls_ok) lsMissing.push(c.symbol);
    }));
  }
  log(`LS geprüft: ${todo.length} Titel · nicht abrufbar: ${lsMissing.length}${lsMissing.length ? ` (${lsMissing.join(', ')})` : ''}`);
  // Fällt LS ganz aus, darf das keine Massenabstiege auslösen.
  if (todo.length >= 20 && lsMissing.length > todo.length * 0.3) fail('LS für mehr als 30 % der geprüften Titel nicht abrufbar');

  const rows = cands.map((c) => rowOf(c));
  const scored = rows.filter((r) => r.score != null).length;
  if (scored < rows.length * 0.7) fail('Weniger als 70 % der Titel mit Auswahl-Score');
  const res = select(rows);
  log(`Auswahl: ${res.momentum.length} Momentum + ${res.quality.length} Qualität · geschützt ${res.protectedRows.length} · neu ${res.enter.length} · raus ${res.leave.length} · nachgezogen ${res.pulled.length}`);

  /* Freitags: Inbox-Rest löschen (frei, nicht ausgewählt, älter als INBOX_MIN_DAYS). */
  const friday = startedAt.getUTCDay() === 5;
  const chosenIds = new Set(res.watch.map((r) => r.id));
  const ageDays = (c) => { const t = Date.parse(c.first_discovered_at ?? c.created_at ?? ''); return Number.isFinite(t) ? (startedAt - t) / 864e5 : Infinity; };
  const byId = new Map(cands.map((c) => [c.id, c]));
  const purge = friday ? rows.filter((r) => r.bucket === 'inbox' && !r.protect.length && !chosenIds.has(r.id) && ageDays(byId.get(r.id)) >= INBOX_MIN_DAYS) : [];

  const errors = [];
  let tvWritten = 0;
  const moved = { in: 0, out: 0, pulled: 0, deleted: 0 };
  if (live) {
    const step = async (label, fn) => { try { return await fn(); } catch (e) { errors.push(`${label}: ${e.message}`); log(`✗ ${label}: ${e.message}`); return null; } };
    // 1. Frische TV-Daten in die Buckets (vor dem Verschieben – die Daten wandern mit).
    for (const bucket of ['watch', 'inbox', 'archive']) {
      const ups = all.filter((c) => c._bucket === bucket && updates.has(c.id)).map((c) => ({ candidate_id: c.id, updates: updates.get(c.id) }));
      for (let i = 0; i < ups.length; i += CHUNK) {
        const r = await step(`TV-Daten ${bucket}`, () => storage({ op: 'bulk_update_candidates', blob_type: bucket, updates: ups.slice(i, i + CHUNK) }));
        tvWritten += r?.updated ?? 0;
      }
    }
    // 2. Verschieben, je Richtung ein Aufruf.
    const move = async (list, from, to) => {
      const ids = list.filter((r) => r.bucket === from).map((r) => r.id);
      if (!ids.length) return 0;
      const r = await step(`${from} → ${to}`, () => storage({ op: 'move_candidates', candidate_ids: ids, from_blob: from, to_blob: to }));
      return r?.moved ?? 0;
    };
    moved.pulled = await move(res.pulled, 'inbox', 'watch') + await move(res.pulled, 'archive', 'watch');
    moved.in = await move(res.enter, 'inbox', 'watch') + await move(res.enter, 'archive', 'watch');
    moved.out = await move(res.leave, 'watch', 'archive');
    // 3. Freitag: Inbox-Rest löschen.
    if (purge.length) {
      const r = await step('Inbox-Rest löschen', () => storage({ op: 'delete_candidates', blob_type: 'inbox', candidate_ids: purge.map((p) => p.id) }));
      moved.deleted = r?.removed ?? 0;
    }
    log(`Geschrieben: TV-Daten ${tvWritten} · rein ${moved.in} · raus ${moved.out} · nachgezogen ${moved.pulled} · gelöscht ${moved.deleted}${errors.length ? ` · ${errors.length} Fehler` : ''}`);
  }

  /* Bericht – kompakt, weil der market-Blob beim App-Start geladen wird. */
  const item = (r, why) => ({
    symbol: r.symbol, exchange: r.exchange, name: r.name, from: r.bucket, slot: r.slot ?? null,
    rank: r.rank ?? null, qrank: r.qrank ?? null, score: r.slot === 'quality' ? r.qscore : r.score,
    bias: r.bias, overall: r.overall, health: r.health, roic: r.roic, fair_upside: r.fair_upside, analyst_upside: r.analyst_upside, why,
  });
  const why = (w) => res.protectedRows.filter((r) => r.protect.includes(w)).length;
  const report = {
    day: startedAt.toISOString().slice(0, 10), at: startedAt.toISOString(), mode, applied: live && !errors.length,
    rules: { version: RULES.version, momentum: RULES.momentum, quality: RULES.quality, weights: RULES.weights, bonus: RULES.bonus },
    universe: { ...sizes, stocks: rows.length, scored, etfs },
    data: { tv: updates.size, tv_total: all.length, ls_checked: todo.length, ls_missing: lsMissing },
    protected: { count: res.protectedRows.length, star: why('Stern'), eye: why('Auge'), alarm: why('Alarm') },
    watch_after: res.watch.length + res.protectedRows.length + res.kept_no_data.length,
    threshold: { momentum: res.momentum.at(-1)?.score ?? null, quality: res.quality.at(-1)?.qscore ?? null },
    enter: res.enter.map((r) => item(r, whyEnter(r))),
    leave: [...res.leave].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).map((r) => item(r, whyLeave(r))),
    pulled: res.pulled.map((r) => ({ ...item(r, `Geschützt: ${r.protect.join(', ')}`) })),
    kept_no_data: res.kept_no_data.map((r) => ({ symbol: r.symbol, exchange: r.exchange, name: r.name })),
    deleted: purge.map((r) => ({ symbol: r.symbol, exchange: r.exchange, name: r.name })),
    purge_day: friday,
    selection: res.watch.map((r) => ({ symbol: r.symbol, exchange: r.exchange, name: r.name, slot: r.slot, rank: r.slot === 'quality' ? r.qrank : r.rank, score: r.slot === 'quality' ? r.qscore : r.score, new: r.bucket !== 'watch' })),
    moved: live ? moved : null, errors,
  };
  const cur = (await storage({ op: 'read', blob_type: 'market' })) ?? {};
  const old = (cur.auto_rotation?.reports ?? []).filter((r) => r.day !== report.day).map(({ selection, ...r }) => r);   // Auswahl nur im neuesten Bericht
  const reports = [report, ...old].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, KEEP_REPORTS);
  await storage({ op: 'write', blob_type: 'market', blob: { ...cur, updated_at: new Date().toISOString(), auto_rotation: { ...(cur.auto_rotation ?? {}), mode: cur.auto_rotation?.mode === 'live' ? 'live' : 'dry', reports } } });
  log(`✓ Bericht ${report.day} gespeichert (${JSON.stringify(report).length} Zeichen, ${reports.length} Berichte)`);

  const line = (r) => `  ${String(r.rank ?? r.qrank ?? '').padStart(3)} ${String(r.symbol).padEnd(7)} ${String(r.name).slice(0, 24).padEnd(24)} ${String(r.from).padEnd(7)} ${String(r.score ?? '–').padStart(5)}  ${r.why}`;
  log(`\nNeu in der Watchlist (${report.enter.length}):`); report.enter.forEach((r) => log(line(r)));
  log(`\nIns Archiv (${report.leave.length}):`); report.leave.forEach((r) => log(line(r)));
  log(`\nQualitätsplätze (${res.quality.length}):`); res.quality.forEach((r) => log(`  ${String(r.qrank).padStart(3)} ${r.symbol.padEnd(7)} ${String(r.name).slice(0, 24).padEnd(24)} ${r.bucket.padEnd(7)} ${String(r.qscore).padStart(5)}  Health ${r.health} · ROIC ${r.roic} · Bias ${r.bias}`));
  if (report.deleted.length || friday) log(`\nInbox-Rest (Freitag): ${report.deleted.length} Titel${live ? ' gelöscht' : ' würden gelöscht'}`);
  if (errors.length) process.exit(1);
}

main().catch((e) => { log(`✗ ${e.stack ?? e.message}`); process.exit(1); });
