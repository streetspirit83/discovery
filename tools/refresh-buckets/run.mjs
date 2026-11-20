/**
 * Bucket-Refresh – TV-Daten und LS-Kurse für ALLE Titel in Watchlist und Archiv
 * (GitHub Action refresh-buckets.yml, werktags früh morgens und mittags).
 *
 *   1. Watchlist und Archiv lesen (jeder Bucket für sich – ein Titel in beiden bekommt
 *      beide Einträge aktualisiert), ETFs eingeschlossen.
 *   2. TV-Scanner für alle Titel (über die scrape-proxy, gebündelt je Markt – wenige Aufrufe).
 *   3. LS-Kurs je Titel direkt von ls-tc.de (ohne Proxy, Wellen von 6). Die LS-Instrument-ID
 *      kommt aus tr_check.ls_id oder der letzten Quote, sonst über die ISIN (ggf. frisch aus TV).
 *      Fehlversuche werden einmal nachgeladen. Ohne Kurs bleibt der alte `ls_quote` stehen.
 *   4. Je Bucket ein Teil-Update (`bulk_update_candidates`, nur die geänderten Felder:
 *      TV-Felder aus `buildUpdates` plus `ls_quote`). Andere Felder bleiben unberührt,
 *      weil der Server die Felder in den aktuellen Stand des Blobs einmischt.
 *
 * Bricht nur ab, wenn gar keine TV-Daten kommen. Teilergebnisse werden geschrieben.
 *
 * Env: DISCOVERY_BACKEND_URL, DISCOVERY_SECRET,
 *      optional BUCKETS (Standard "watch,archive"), DRY=1 (nur holen und zählen, nichts schreiben)
 */
import { fetchTVEnrichment, fetchFxRate } from '../../ui/lib/tv-enrichment.js';
import { fetchLsPrice } from '../../netlify-backend/netlify/functions/lib/ls-quote.js';

const CHUNK = 40;          // Titel je bulk_update (Antwortgrösse der Netlify-Funktion)
const LS_WAVE = 6;         // parallele LS-Abrufe
const LS_SERIES = 40;      // Punkte der Tageskurve, wie in ui/lib/ls-intraday.js

const mem = new Map();
globalThis.localStorage ??= { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
// tv-enrichment protokolliert jeden Titel – hier zählt nur die Zusammenfassung.
const log = console.log.bind(console);
for (const k of ['log', 'group', 'groupEnd', 'warn', 'info', 'debug']) console[k] = () => {};

const auth = { backendUrl: process.env.DISCOVERY_BACKEND_URL.replace(/\/$/, ''), secret: process.env.DISCOVERY_SECRET };
const dry = process.env.DRY === '1' || process.env.DRY === 'true';
const buckets = (process.env.BUCKETS || 'watch,archive').split(',').map((b) => b.trim()).filter(Boolean);

async function storage(body) {
  const res = await fetch(`${auth.backendUrl}/api/storage`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-discovery-secret': auth.secret }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(`storage ${body.op}/${body.blob_type ?? ''}: ${j?.error ?? res.status}`);
  return j.data ?? j;
}

/* Gleichmässig auf ~n Preise ausdünnen (erster und letzter bleiben) – wie im Browser. */
function downsample(points, n) {
  const prices = points.map((p) => (Array.isArray(p) ? p[1] : null)).filter((v) => v != null);
  if (prices.length <= n) return prices;
  const step = (prices.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => prices[Math.round(i * step)]);
}

/* LS-Quote im selben Format wie fetchLsQuote im Browser. null = kein Kurs.
   Die serverseitige Funktion kennt als Cache nur tr_check.ls_id – die ID der letzten
   Quote geben wir dort mit, sonst kostete jeder Titel ohne TR-Check eine ISIN-Suche. */
async function lsQuote(c) {
  const lsId = c.tr_check?.ls_id ?? c.ls_quote?.instrument_id ?? null;
  const probe = lsId != null ? { ...c, tr_check: { ...(c.tr_check ?? {}), ls_id: lsId } } : c;
  const q = await fetchLsPrice(probe).catch(() => null);
  if (q?.price == null) return null;
  const prices = q.points.map((p) => (Array.isArray(p) ? p[1] : null)).filter((v) => v != null);
  const last = q.points[q.points.length - 1];
  return {
    price: q.price,
    prev_close: q.prev_close,
    change_pct: q.change_pct,
    series: downsample(q.points, LS_SERIES),
    day_low: prices.length ? Math.min(...prices) : null,
    day_high: prices.length ? Math.max(...prices) : null,
    ts: Array.isArray(last) ? last[0] : null,
    instrument_id: q.ls_id,
    checked_at: new Date().toISOString(),
  };
}

async function main() {
  const started = Date.now();
  const blobs = Object.fromEntries(await Promise.all(buckets.map(async (b) => [b, await storage({ op: 'read', blob_type: b })])));
  const all = buckets.flatMap((b) => (blobs[b]?.candidates ?? []).map((c) => ({ c, bucket: b })));
  log(`${dry ? 'Probelauf · ' : ''}Bestand: ${buckets.map((b) => `${b} ${blobs[b]?.candidates?.length ?? 0}`).join(' · ')}`);
  if (!all.length) { log('Keine Titel – nichts zu tun.'); return; }

  // 1. TV
  const fx = await fetchFxRate(auth).catch(() => null);
  if (fx) localStorage.setItem('discovery_fx_eurusd_live', String(fx));
  const tv = await fetchTVEnrichment(all.map((x) => x.c), { ...auth, onProgress: () => {} });
  log(`TV-Daten: ${tv.size}/${all.length}`);
  if (!tv.size) { log('✗ Keine TV-Daten – kein Lauf, nichts verändert.'); process.exit(1); }

  // 2. LS – auf dem Stand nach TV (TV liefert ggf. die ISIN nach).
  const merged = all.map(({ c, bucket }) => ({ c: { ...c, ...(tv.get(c.id) ?? {}) }, bucket }));
  const ls = new Map();
  const pass = async (list) => {
    const failed = [];
    for (let i = 0; i < list.length; i += LS_WAVE) {
      await Promise.all(list.slice(i, i + LS_WAVE).map(async (x) => {
        const q = await lsQuote(x.c);
        if (q) ls.set(x.c.id, q); else failed.push(x);
      }));
    }
    return failed;
  };
  let lsFailed = await pass(merged);
  if (lsFailed.length && lsFailed.length < merged.length) {
    await new Promise((r) => setTimeout(r, 3000));
    lsFailed = await pass(lsFailed);
  }
  const noId = lsFailed.filter((x) => x.c.tr_check?.ls_id == null && x.c.ls_quote?.instrument_id == null && !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(String(x.c.isin ?? '').toUpperCase()));
  log(`LS-Kurse: ${ls.size}/${merged.length}${lsFailed.length ? ` · ohne Kurs ${lsFailed.length} (davon ohne ISIN/LS-ID ${noId.length})` : ''}`);
  if (lsFailed.length && lsFailed.length <= 40) log(`  ohne Kurs: ${lsFailed.map((x) => x.c.symbol).join(', ')}`);

  // 3. Schreiben, je Bucket in Häppchen.
  const totals = {};
  const errors = [];
  for (const b of buckets) {
    const ups = all.filter((x) => x.bucket === b).map(({ c }) => {
      const u = { ...(tv.get(c.id) ?? {}) };
      if (ls.has(c.id)) u.ls_quote = ls.get(c.id);
      return Object.keys(u).length ? { candidate_id: c.id, updates: u } : null;
    }).filter(Boolean);
    totals[b] = { planned: ups.length, written: 0 };
    if (dry) continue;
    for (let i = 0; i < ups.length; i += CHUNK) {
      try {
        const r = await storage({ op: 'bulk_update_candidates', blob_type: b, updates: ups.slice(i, i + CHUNK) });
        totals[b].written += r?.updated ?? 0;
      } catch (e) { errors.push(`${b}: ${e.message}`); log(`✗ ${b}: ${e.message}`); }
    }
  }
  const secs = Math.round((Date.now() - started) / 1000);
  log(`${dry ? 'Würde schreiben' : 'Geschrieben'}: ${buckets.map((b) => `${b} ${dry ? totals[b].planned : `${totals[b].written}/${totals[b].planned}`}`).join(' · ')} · ${secs} s${errors.length ? ` · ${errors.length} Fehler` : ''}`);
  if (errors.length) process.exit(1);
}

main().catch((e) => { log(`✗ ${e.stack ?? e.message}`); process.exit(1); });
