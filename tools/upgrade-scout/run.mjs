/**
 * Analysten-Scout – Lauf (GitHub Action upgrade-scout.yml, mehrmals am Tag).
 *
 *   1. Marktweite Analysten-Feeds lesen (TradingView-Analystenupdates en, dpa-AFX de), neue Ereignisse
 *      im Blob `scout` festhalten. Der Feed hat kein Gedächtnis (immer nur die neuesten 200), deshalb
 *      der häufige Lauf.
 *   2. Signale je Titel (ui/lib/upgrade-scout.js): frischer Auslöser oder Häufung, Gegenwind.
 *   3. Für die Signal-Titel TV-Daten holen (auch für Titel, die nicht in der App sind), Score wie die
 *      Auto-Rotation (`rowOf`), dazu Yahoo-Historie als Gegencheck (nur US).
 *   4. Tagesbericht in den Blob `scout` (je Tag einer, wird bei jedem Lauf fortgeschrieben).
 *      Modus `live`: Titel mit Urteil „stark“ oder „knapp“ gehen in die Inbox (Quelle `analyst-scout`),
 *      die Auto-Rotation entscheidet danach wie bei jedem anderen Inbox-Titel.
 *      Modus `dry` (Standard): nur Bericht.
 *
 * Kein Kaufsignal: Laut docs/ANALYST_BACKTEST.md gibt es nach Hochstufungen keine verlässliche Nachdrift.
 *
 * Env: DISCOVERY_BACKEND_URL, DISCOVERY_SECRET, optional FORCE_MODE=dry, SET_MODE=live|dry,
 *      OUT_FILE (Bericht zusätzlich als JSON), NO_STORAGE=1 (lokaler Test ohne Blobs).
 */
import fs from 'node:fs';
import { fetchTVEnrichment, fetchFxRate, EXCHANGE_CURRENCY } from '../../ui/lib/tv-enrichment.js';
import { normalizeExchange } from '../../ui/lib/exchange-map.js';
import { isEtf } from '../../ui/lib/instrument-type.js';
import { metricsOf } from '../../ui/lib/rankings-filter.js';
import { RULES as ROT_RULES, rowOf } from '../auto-rotation/select.mjs';
import { SCOUT_RULES, SCOUT_FEEDS, feedUrl, eventsFromFeed, mergeEvents, signalsOf, yahooStats, verdictOf, KIND_LABEL, knownUpdates, targetGap } from '../../ui/lib/upgrade-scout.js';
import { fetchMerklisteEntries } from '../../ui/lib/merkliste-import.js';
import { buildLinks } from '../../adapters/_shared/link-builder.js';

const KEEP_REPORTS = 14;
const MAX_KNOWN = 60;          // Zeilen „Bestand neu bewertet“
const MAX_ITEMS = 40;          // Titel je Tagesbericht
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const mem = new Map();
globalThis.localStorage ??= { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const log = console.log.bind(console);
for (const k of ['log', 'group', 'groupEnd', 'warn', 'info', 'debug']) console[k] = () => {};

const auth = { backendUrl: String(process.env.DISCOVERY_BACKEND_URL ?? '').replace(/\/$/, ''), secret: process.env.DISCOVERY_SECRET ?? '' };
const noStorage = process.env.NO_STORAGE === '1';
async function storage(body, tries = 5) {
  if (noStorage) return null;
  // Direkt nach dem Merge kann das Backend den neuen Blob noch nicht kennen (Netlify-Deploy läuft).
  for (let i = 1; ; i++) {
    try { return await storageOnce(body); }
    catch (e) {
      if (i >= tries || !/Unknown blob_type/.test(e.message)) throw e;
      log(`… Backend kennt ${body.blob_type} noch nicht, Versuch ${i}/${tries}, warte 60 s`);
      await new Promise((r) => setTimeout(r, 60e3));
    }
  }
}
async function storageOnce(body) {
  const res = await fetch(`${auth.backendUrl}/api/storage`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-discovery-secret': auth.secret }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(`storage ${body.op}/${body.blob_type ?? ''}: ${j?.error ?? res.status}`);
  return j.data ?? j;
}
const keyOf = (c) => `${String(c.symbol ?? '').toUpperCase()}:${normalizeExchange(c.exchange) || c.exchange || ''}`;
const berlinDay = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(d);

async function fetchFeed(f) {
  const res = await fetch(feedUrl(f), { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${f.key} HTTP ${res.status}`);
  const j = await res.json();
  return Array.isArray(j?.items) ? j.items : [];
}

async function yahooSession() {
  const r0 = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA }, redirect: 'manual' }).catch(() => null);
  const cookie = (r0?.headers?.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const crumb = await (await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, cookie } })).text();
  if (!crumb || crumb.length > 40 || /</.test(crumb)) throw new Error('kein Crumb');
  return { cookie, crumb };
}
/* Über die Netlify-Funktion yahoo-analyst (Option history): aus der GitHub Action direkt gibt Yahoo keinen Crumb heraus. */
async function yahooHistoryBackend(sym) {
  const res = await fetch(`${auth.backendUrl}/api/yahoo-analyst`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-discovery-secret': auth.secret }, body: JSON.stringify({ symbol: sym, history: true }) });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok || !Array.isArray(j.history)) return null;
  return j.history.map((x) => ({ epochGradeDate: x.t, firm: x.firm, action: x.action, fromGrade: x.from, toGrade: x.to }));
}
async function yahooHistory(sess, sym) {
  if (!sess) return yahooHistoryBackend(sym);
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=upgradeDowngradeHistory&crumb=${encodeURIComponent(sess.crumb)}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, cookie: sess.cookie, Origin: 'https://finance.yahoo.com', Referer: 'https://finance.yahoo.com/' } });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.quoteSummary?.result?.[0]?.upgradeDowngradeHistory?.history ?? [];
}

/* Schwelle der Auto-Rotation: Score des Momentum-Rangs `enter` im neuesten Bericht. */
function rotationCutoff(market) {
  const sel = market?.auto_rotation?.reports?.[0]?.selection ?? [];
  const mom = sel.filter((x) => x.slot === 'momentum' && x.score != null).sort((a, b) => a.rank - b.rank);
  if (!mom.length) return null;
  const at = mom.find((x) => x.rank >= ROT_RULES.momentum.enter) ?? mom[mom.length - 1];
  return at.score;
}

function candidateOf(s, now) {
  const yahoo = s.exchange === 'XETR' ? `${s.symbol}.DE` : ['NASDAQ', 'NYSE', 'AMEX'].includes(s.exchange) ? s.symbol : null;
  const rating = s.rating ? ` auf ${s.rating}${s.from ? ` (von ${s.from})` : ''}` : '';
  return {
    id: crypto.randomUUID(), symbol: s.symbol, exchange: s.exchange, yahoo_symbol: yahoo, isin: null, name: s.name ?? s.symbol,
    sources: [{
      adapter: 'analyst-scout', source_url: `https://www.tradingview.com/symbols/${s.tv.replace(':', '-')}/news/`,
      discovered_at: now, signal_type: 'analyst_upgrade',
      raw_signal: { trigger: s.trigger, firm: s.firm, rating: s.rating, from: s.from, target: s.target, points: s.points, pos_firms: s.pos_firms, score: s.row?.score ?? null, at: s.at },
      info_snippet: `${s.firm}: ${s.trigger_label}${rating}${s.target ? `, Ziel ${s.target}` : ''}${s.pos_firms > 1 ? ` · ${s.pos_firms} Häuser positiv` : ''}`,
    }],
    links: buildLinks({ exchange: s.exchange, symbol: s.symbol, yahooSymbol: yahoo }), workspace_state: 'new', notes: '', enrichment: null, first_discovered_at: now, last_updated_at: now,
  };
}

async function main() {
  const now = new Date();
  // Ohne lesbaren scout-Blob kein Lauf: sonst überschriebe der Bericht die gesammelten Ereignisse.
  const scout0 = await storage({ op: 'read', blob_type: 'scout' });
  const evBlob = await storage({ op: 'read', blob_type: 'scout_events' });
  const [watch, archive, inbox, market, analyst] = await Promise.all(
    ['watch', 'archive', 'inbox', 'market', 'analyst'].map((b) => storage({ op: 'read', blob_type: b }).catch((e) => { log(`! ${b}: ${e.message}`); return null; })),
  );
  const scout = scout0 ?? {};
  if (process.env.SET_MODE === 'live' || process.env.SET_MODE === 'off') {
    await storage({ op: 'write', blob_type: 'scout', blob: { ...scout, updated_at: now.toISOString(), mode: process.env.SET_MODE, mode_at: now.toISOString() } });
    log(`✓ Modus jetzt: ${process.env.SET_MODE} (vorher ${scout.mode ?? 'dry'})`);
    return;
  }
  // Seit 18.11.2026 immer scharf: jeder neu gefundene Titel geht in die Inbox, die Auto-Rotation entscheidet.
  // Nur FORCE_MODE=dry (Workflow von Hand) oder ein ausdrückliches mode:'off' im Blob halten das an.
  const mode = process.env.FORCE_MODE === 'dry' || scout.mode === 'off' ? 'dry' : 'live';
  log(`Modus: ${mode === 'live' ? 'scharf (alle neuen Titel in die Inbox)' : 'Probelauf (nur Bericht)'}`);

  // 1. Feeds
  const feeds = {};
  const fresh = [];
  for (const f of SCOUT_FEEDS) {
    try {
      const items = await fetchFeed(f);
      const ev = eventsFromFeed(items, f.key);
      const ts = items.map((x) => x.published).filter(Number.isFinite);
      const oldest = ts.length ? new Date(Math.min(...ts) * 1000).toISOString() : null;
      const newest = ts.length ? new Date(Math.max(...ts) * 1000).toISOString() : null;
      const prevNewest = scout.feeds?.[f.key]?.newest ?? null;
      feeds[f.key] = { items: items.length, events: ev.length, oldest, newest, gap: !!(prevNewest && oldest && oldest > prevNewest) };
      fresh.push(...ev);
      log(`Feed ${f.key}: ${items.length} Einträge, ${ev.length} Analystenmeldungen, ${oldest?.slice(0, 16)} → ${newest?.slice(0, 16)}${feeds[f.key].gap ? ' · LÜCKE seit letztem Lauf' : ''}`);
    } catch (e) {
      feeds[f.key] = { error: e.message, ...(scout.feeds?.[f.key] ? { newest: scout.feeds[f.key].newest } : {}) };
      log(`! Feed ${f.key}: ${e.message}`);
    }
  }
  if (!fresh.length && Object.values(feeds).every((f) => f.error)) { log('✗ Kein Feed erreichbar – nichts geändert.'); process.exit(1); }
  const { events, added } = mergeEvents(evBlob?.events ?? scout.events, fresh, now);
  log(`Ereignisse: ${added} neu, ${events.length} im Bestand (${SCOUT_RULES.keepDays} Tage)`);

  // 2. App-Bestand
  const known = new Map();
  for (const [b, blob] of [['watch', watch], ['inbox', inbox], ['archive', archive]]) {
    for (const c of blob?.candidates ?? []) if (!known.has(keyOf(c))) known.set(keyOf(c), { ...c, _bucket: b });
  }
  // Stern (Depot) aus der Merkliste – nur Anzeige, ein Fehlschlag kostet nichts.
  const stars = new Set();
  try {
    const mk = await fetchMerklisteEntries(auth);
    for (const c of known.values()) { const e = mk?.bySym?.get(String(c.symbol).toUpperCase()); if (e && (e.entry != null || Number(e.shares) > 0)) stars.add(keyOf(c)); }
  } catch { /* ohne Stern */ }

  // 3. Signale + Yahoo-Gegencheck (US)
  let signals = signalsOf(events, { now });
  const yahoo = new Map();
  const us = signals.filter((s) => ['NASDAQ', 'NYSE', 'AMEX'].includes(s.exchange)).slice(0, 60);
  if (us.length) {
    try {
      // Lokal (ohne Backend) direkt, sonst über Netlify.
      const sess = noStorage ? await yahooSession() : null;
      for (let i = 0; i < us.length; i += 6) {
        await Promise.allSettled(us.slice(i, i + 6).map(async (s) => {
          const h = await yahooHistory(sess, s.symbol.replace('.', '-'));
          if (h) yahoo.set(s.key, yahooStats(h, now));
        }));
      }
      log(`Yahoo: ${yahoo.size}/${us.length} US-Titel mit Historie`);
    } catch (e) { log(`! Yahoo: ${e.message}`); }
    signals = signalsOf(events, { now, yahoo });
  }

  // 4. TV-Daten für alle Signal-Titel
  const pseudo = signals.map((s) => ({ ...(known.get(s.key) ?? {}), id: s.key, symbol: s.symbol, exchange: s.exchange, _bucket: known.get(s.key)?._bucket ?? null }));
  const fx = await fetchFxRate(auth).catch(() => null);
  if (fx) localStorage.setItem('discovery_fx_eurusd_live', String(fx));
  let updates = new Map();
  try { updates = await fetchTVEnrichment(pseudo, { ...auth, onProgress: () => {} }); }
  catch (e) { log(`! TV: ${e.message}`); }
  log(`TV-Daten: ${updates.size}/${pseudo.length}`);

  const cutoff = rotationCutoff(market);
  const items = [];
  for (const s of signals) {
    const base = pseudo.find((p) => p.id === s.key);
    const u = updates.get(s.key);
    const c = u ? { ...base, ...u, tv_data: u.tv_data } : base;
    if (u && isEtf(c)) continue;
    const row = u ? rowOf(c) : null;
    const m = u ? metricsOf(c) : null;
    const verdict = verdictOf(row, m?.cap_usd ?? null, cutoff);
    const k = known.get(s.key);
    items.push({
      ...s, name: m?.name ?? k?.name ?? s.symbol, sector: c.sector ?? m?.sector ?? null,
      bucket: k?._bucket ?? null, eye: !!k?.watch_flag,
      verdict, score: row?.score ?? null, bias: row?.bias ?? null, overall: row?.overall ?? null, health: row?.health ?? null,
      roic: row?.roic ?? null, setup: row?.setup ?? false, analyst_upside: row?.analyst_upside ?? null, fair_upside: row?.fair_upside ?? null,
      cap_usd: m?.cap_usd != null ? Math.round(m.cap_usd / 1e6) : null,   // Mio. USD
      perf_1w: m?.perf_1w ?? null, perf_1m: m?.perf_1m ?? null, chg_1d: u?.tv_data?.change ?? null,
      close: u?.tv_data?.close ?? null, currency: c.currency ?? EXCHANGE_CURRENCY[s.exchange] ?? null,
      target_gap: targetGap(s.target, u?.tv_data?.close, c.currency ?? EXCHANGE_CURRENCY[s.exchange]),
      above_sma200: m?.above_sma200 ?? null, row,
    });
  }
  const ORDER = { stark: 0, knapp: 1, schwach: 2, klein: 3, 'ohne Daten': 4 };
  items.sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict] || (b.score ?? -1) - (a.score ?? -1) || b.points - a.points);

  // Gegenwind auf Titeln der App: frische Abstufungen für Watchlist-Titel (Auge zuerst).
  const warnings = [];
  for (const e of events) {
    if (now - Date.parse(e.at) > SCOUT_RULES.freshDays * 864e5) continue;
    if (!['downgrade', 'list_remove', 'init_bear'].includes(e.kind)) continue;
    const k = known.get(`${e.symbol}:${e.exchange}`);
    if (!k || k._bucket !== 'watch') continue;
    if (warnings.some((w) => w.key === `${e.symbol}:${e.exchange}` && w.firm === e.firm)) continue;
    warnings.push({ key: `${e.symbol}:${e.exchange}`, symbol: e.symbol, exchange: e.exchange, name: k.name ?? e.symbol, eye: !!k.watch_flag, firm: e.firm, kind: e.kind, label: KIND_LABEL[e.kind], rating: e.rating, at: e.at, title: e.title });
  }
  warnings.sort((a, b) => (b.eye - a.eye) || b.at.localeCompare(a.at));

  // 5. Inbox: alle neu gefundenen Titel (ausser Watchlist/Archiv), je Titel höchstens einmal in PUSH_DAYS Tagen –
  //    sonst hängte jeder Zwei-Stunden-Lauf dieselbe Quelle erneut an den Inbox-Eintrag.
  let pushed = [];
  const PUSH_DAYS = 14;
  const pushedKeys = Object.fromEntries(Object.entries(scout.pushed_keys ?? {}).filter(([, at]) => now - Date.parse(at) < PUSH_DAYS * 864e5));
  if (mode === 'live') {
    const take = items.filter((i) => i.bucket !== 'watch' && i.bucket !== 'archive' && !pushedKeys[`${i.symbol}:${i.exchange}`]);
    if (take.length) {
      const nowIso = now.toISOString();
      const res = await storage({ op: 'append_candidates', candidates: take.map((i) => candidateOf(i, nowIso)) });
      pushed = (res?.results ?? []).map((r, ix) => ({ symbol: take[ix].symbol, exchange: take[ix].exchange, action: r.action }));
      for (const p of pushed) if (p.action === 'added' || p.action === 'merged') pushedKeys[`${p.symbol}:${p.exchange}`] = now.toISOString();
      log(`Inbox: ${pushed.map((p) => `${p.symbol} (${p.action})`).join(', ')}`);
    }
  }

  // 6. Bestand neu bewertet: marktweite Ereignisse + analyst-Blob, je Titel eine Zeile.
  const knownInfo = new Map([...known].map(([k, c]) => [k, { bucket: c._bucket, name: c.name ?? c.tv_data?.description ?? c.symbol, eye: !!c.watch_flag, star: stars.has(k),
    close: c.tv_data?.close ?? null, currency: c.currency ?? EXCHANGE_CURRENCY[normalizeExchange(c.exchange)] ?? null }]));
  const updatesKnown = knownUpdates(events, analyst?.events ?? {}, knownInfo, { now }).slice(0, MAX_KNOWN)
    .map((u) => { const k = knownInfo.get(`${u.symbol}:${u.exchange}`); return { ...u, close: k?.close ?? null, currency: k?.currency ?? null, target_gap: targetGap(u.target, k?.close, k?.currency) }; });
  log(`Bestand neu bewertet: ${updatesKnown.length} Titel (${updatesKnown.filter((u) => u.bucket === 'watch').length} Watchlist)`);

  // 7. Bericht
  const day = berlinDay(now);
  const counts = items.reduce((a, i) => ({ ...a, [i.verdict]: (a[i.verdict] ?? 0) + 1 }), {});
  const slim = (i) => { const { row, key, ...rest } = i; return rest; };
  const report = {
    day, generated_at: now.toISOString(), mode, rules_version: SCOUT_RULES.version,
    cutoff, cutoff_rank: ROT_RULES.momentum.enter, feeds, counts, n_signals: signals.length,
    items: items.slice(0, MAX_ITEMS).map(slim), warnings: warnings.slice(0, 20), known: updatesKnown, pushed,
  };
  const reports = [report, ...(scout.reports ?? []).filter((r) => r.day !== day)].slice(0, KEEP_REPORTS);
  const feedState = Object.fromEntries(Object.entries(feeds).map(([k, f]) => [k, { newest: f.newest ?? scout.feeds?.[k]?.newest ?? null, at: now.toISOString() }]));
  // Erst die Ereignisse, dann der Bericht: bricht der zweite Schreibvorgang ab, ist nichts Gesammeltes verloren.
  await storage({ op: 'write', blob_type: 'scout_events', blob: { schema: 'discovery-scout-events-1.0', updated_at: now.toISOString(), events } });
  // Modus frisch lesen: die App kann ihn während des Laufs umgeschaltet haben.
  const modeNow = (await storage({ op: 'read', blob_type: 'scout' }).catch(() => null))?.mode ?? scout.mode ?? 'live';
  const { events: _old, ...scoutRest } = scout;   // Ereignisse liegen seit v2 im eigenen Blob
  await storage({ op: 'write', blob_type: 'scout', blob: { ...scoutRest, schema: 'discovery-scout-1.1', updated_at: now.toISOString(), mode: modeNow, feeds: feedState, pushed_keys: pushedKeys, reports } });
  if (process.env.OUT_FILE) fs.writeFileSync(process.env.OUT_FILE, JSON.stringify(report, null, 2));

  log(`\nBericht ${day}: ${signals.length} Signale · ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')} · Schwelle Rotation ${cutoff ?? '–'} (Rang ${ROT_RULES.momentum.enter})`);
  for (const i of items.slice(0, 25)) {
    log(`  ${i.verdict.padEnd(10)} ${`${i.exchange}:${i.symbol}`.padEnd(16)} Score ${String(i.score ?? '–').padStart(5)} · Bias ${String(i.bias ?? '–').padStart(4)} · ${i.trigger_label} ${i.firm}${i.rating ? ` → ${i.rating}` : ''}${i.from ? ` (von ${i.from})` : ''} · Punkte ${i.points}${i.bucket ? ` · [${i.bucket}]` : ''}`);
  }
  if (warnings.length) log(`Gegenwind Watchlist: ${warnings.map((w) => `${w.symbol} (${w.firm}, ${w.label})`).join(', ')}`);
}

main().catch((e) => { log(`✗ ${e.stack ?? e.message}`); process.exit(1); });
