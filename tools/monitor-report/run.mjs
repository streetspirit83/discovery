/**
 * Monitor-Bericht: täglicher Überblick über Watchlist + Archiv als Google Doc,
 * gegliedert nach den fünf Mega-Clustern (ui/lib/sector-clusters.js — dieselben
 * Gruppen wie die Sektor-Heatmap im Markets-Modal).
 *
 * Aufruf (GitHub Action monitor-report.yml):
 *   node tools/monitor-report/run.mjs
 *   DRY_RUN=1 node tools/monitor-report/run.mjs   → schreibt nur monitor-report.html,
 *                                                   kein Upload, kein Blob-Schreiben
 *
 * Ablauf:
 *   1. watch + archive lesen (nur diese beiden Buckets), nach Symbol+Börse
 *      dedupliziert — Watch gewinnt.
 *   2. TV-Daten für ALLE Titel frisch holen (fetchTVEnrichment, wie die App) —
 *      das Archiv frischt sonst niemand auf. Die Kandidaten-Blobs werden NICHT
 *      beschrieben; der Bericht liest nur.
 *   3. Vortagszustand aus dem monitor-Blob (je Titel die Score-Tagesreihe
 *      `tv_data.snapshot`) einsetzen, damit Deltas, MACD-Wechsel und SMA-
 *      Kreuzungen auch für Archiv-Titel funktionieren. Danach den neuen Stand
 *      zurückschreiben. Am ersten Tag fehlen die Deltas naturgemäss.
 *   4. Je Cluster dieselben Kennzahlen wie der Monitor (dashboard-metrics.js,
 *      trend-radar.js) plus Range-Brüche (Logik wie Watch Ranges).
 *   5. Zwei Docs: „Discovery Monitor" (zentral, in place überschrieben — Link
 *      bleibt) und „Monitor JJJJ-MM-TT" im Unterordner „Monitor Archiv".
 *
 * Env: DISCOVERY_BACKEND_URL, DISCOVERY_SECRET,
 *      GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
 *      MONITOR_FOLDER_ID (Drive-Zielordner), optional MONITOR_NAME
 */

import { google } from 'googleapis';
import { Readable } from 'node:stream';
import { fetchTVEnrichment, fetchFxRate } from '../../ui/lib/tv-enrichment.js';
import { MEGA_CLUSTERS, megaClusterOf } from '../../ui/lib/sector-clusters.js';
import { normalizeExchange } from '../../ui/lib/exchange-map.js';
import { computePriceClusters } from '../../ui/lib/price-cluster.js';
import { computeBias } from '../../ui/lib/tv-sentiment.js';
import { isEtf } from '../../ui/lib/instrument-type.js';
import { isAlertTriggered, alertSummary } from '../../ui/lib/alerts.js';
import {
  pulse, scoreMovers, momMovers, perfLeaders, macdFlips, rsiExtremes, smaCrosses, trends,
} from '../../ui/lib/dashboard-metrics.js';
import { trendRadar } from '../../ui/lib/trend-radar.js';

const DRY_RUN = process.env.DRY_RUN === '1';
const NAME = process.env.MONITOR_NAME || 'Discovery Monitor';
const ARCHIVE_FOLDER = 'Monitor Archiv';
const TOP = 5;
const SNAPSHOT_MAX = 5;          // wie tv-enrichment.js
const BRK = 0.005;               // Bruch erst 0,5 % jenseits des Levels (wie Watch Ranges)
const DOC = 'application/vnd.google-apps.document';
const FOLDER = 'application/vnd.google-apps.folder';

const env = (k, fallback) => {
  const v = process.env[k] ?? fallback;
  if (v == null || v === '') throw new Error(`Env ${k} fehlt`);
  return v;
};

/* alerts.js liest den EUR/USD-Kurs aus localStorage — in Node ein Ersatz im Speicher. */
const mem = new Map();
globalThis.localStorage ??= { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

/* ── Backend ──────────────────────────────────────────────────────────────── */

async function storage(auth, body) {
  const res = await fetch(`${auth.backendUrl}/api/storage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': auth.secret },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(`storage ${body.op}/${body.blob_type ?? ''}: ${j?.error ?? res.status}`);
  return j.data;
}

const keyOf = (c) => `${String(c.symbol ?? '').toUpperCase()}:${normalizeExchange(c.exchange) || c.exchange || ''}`;

/* Watch + Archiv, dedupliziert (Watch gewinnt). `_bucket` markiert die Herkunft. */
function mergeBuckets(watch, archive) {
  const seen = new Set(), out = [];
  for (const [bucket, list] of [['watch', watch], ['archive', archive]]) {
    for (const c of list) {
      const k = keyOf(c);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ ...c, _bucket: bucket });
    }
  }
  return out;
}

const dayOf = (s) => s?.d ?? (s?.at ? String(s.at).slice(0, 10) : null);

/* Tagesreihe aus monitor-Blob und eigenem tv_data.snapshot vereinen (neueste zuerst). */
function mergeSnapshots(a, b) {
  const byDay = new Map();
  for (const s of [...(b ?? []), ...(a ?? [])]) { const d = dayOf(s); if (d) byDay.set(d, s); }
  return [...byDay.entries()].sort((x, y) => (x[0] < y[0] ? 1 : -1)).map(([, s]) => s).slice(0, SNAPSHOT_MAX);
}

/* ── Range-Status (wie Watch Ranges, aber in nativer Währung gegen den TV-Schluss) ── */

function rangeState(c) {
  const tv = c.tv_data ?? {};
  const p = tv.close;
  if (!(p > 0)) return null;
  const pc = computePriceClusters(tv, { lsHistory: c.ls_history ?? null, refPrice: tv.close_1m ?? p });
  const o = c.range_override ?? {};
  const sup = o.sup > 0 ? +o.sup : pc?.nearestSup?.mid ?? tv.price_52_week_low ?? null;
  const res = o.res > 0 ? +o.res : pc?.nearestRes?.mid ?? tv.price_52_week_high ?? null;
  if (res > 0 && p > res * (1 + BRK)) return { dir: 'up', lvl: res, pct: (p / res - 1) * 100 };
  if (sup > 0 && p < sup * (1 - BRK)) return { dir: 'dn', lvl: sup, pct: (p / sup - 1) * 100 };
  return null;
}

/* ── Formatierung ─────────────────────────────────────────────────────────── */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const num = (v, d = 1) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v, d = 1) => {
  if (v == null || Number.isNaN(+v)) return '–';
  const r = +(+v).toFixed(d);                       // −0,0 vermeiden
  return `${r >= 0 ? '+' : '−'}${num(Math.abs(r), d)} %`;
};
const signed = (v) => (v == null ? '–' : `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}`);
const POS = '#1a7f37', NEG = '#cf222e', MUTED = '#6e7781';
const tone = (v, s) => (v == null || v === 0 ? esc(s) : `<span style="color:${v > 0 ? POS : NEG}">${esc(s)}</span>`);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/* Titel-Kürzel: Symbol, Archiv-Titel mit hochgestelltem A. */
const sym = (c) => `<b>${esc(c.symbol)}</b>${c._bucket === 'archive' ? '<sup>A</sup>' : ''}`;
const list = (rows, fmt) => (rows.length ? rows.slice(0, TOP).map(fmt).join(' · ') + (rows.length > TOP ? ` <span style="color:${MUTED}">+${rows.length - TOP}</span>` : '') : `<span style="color:${MUTED}">–</span>`);

function row(label, html) {
  return `<tr><td style="width:30%;vertical-align:top"><b>${esc(label)}</b></td><td>${html}</td></tr>`;
}

/* ── Abschnitte ───────────────────────────────────────────────────────────── */

function groupSection(label, cands) {
  const tvd = cands.filter((c) => c.tv_data);
  const pu = pulse(cands);
  const med = (k) => median(tvd.map((c) => c.tv_data[k]).filter((v) => v != null));
  const share = (f) => { const r = tvd.filter((c) => c.tv_data.close != null && c.tv_data[f] != null); return r.length ? Math.round(r.filter((c) => c.tv_data.close > c.tv_data[f]).length / r.length * 100) : null; };
  const nW = cands.filter((c) => c._bucket === 'watch').length;

  const sm = scoreMovers(cands), mm = momMovers(cands);
  const p1 = perfLeaders(cands, '1W'), p3 = perfLeaders(cands, '1M');
  const mf = macdFlips(cands), rx = rsiExtremes(cands), sx = smaCrosses(cands), tr = trends(cands);
  const radar = trendRadar(cands);
  const ranges = cands.map((c) => ({ c, r: rangeState(c) })).filter((x) => x.r);
  const alerts = [];
  for (const c of cands) for (const a of c.alerts ?? []) {
    if (a.enabled === false) continue;
    try { if (isAlertTriggered(c, a)) alerts.push({ c, a }); } catch { /* unvollständige Daten */ }
  }
  const bias = tvd.map((c) => ({ c, b: computeBias(c.tv_data) })).filter((x) => x.b);

  const head = `${cands.length} Werte (${nW} Watch · ${cands.length - nW} Archiv) · Median 1W ${pct(med('perf_w'))} · 1M ${pct(med('perf_1m'))} · 3M ${pct(med('perf_3m'))}`
    + ` · über SMA50 ${share('sma50') ?? '–'} % · über SMA200 ${share('sma200') ?? '–'} %`
    + (pu.avg != null ? ` · Ø Score ${pu.avg}` : '')
    + (pu.improved + pu.declined ? ` · Score ↑${pu.improved} ↓${pu.declined}` : '');

  const perf = (r) => `${sym(r.c)} ${tone(r.perf, pct(r.perf))}`;
  const dl = (k) => (r) => `${sym(r.c)} ${tone(r[k], signed(r[k]))}`;
  const rows = [
    row('Stärkste 1W', list(p1.gainers, perf)),
    row('Schwächste 1W', list(p1.losers, perf)),
    row('Stärkste 1M', list(p3.gainers, perf)),
    row('Schwächste 1M', list(p3.losers, perf)),
    row('Score ↑ / ↓ (Vortag)', `${list(sm.risers, dl('dOverall'))}<br>${list(sm.fallers, dl('dOverall'))}`),
    row('Momentum ↑ / ↓ (Vortag)', `${list(mm.risers, dl('dMom'))}<br>${list(mm.fallers, dl('dMom'))}`),
    row('Trend-Radar (trendet gerade)', list(radar.rising, (r) => `${sym(r.c)} ${r.score}${r.fresh ? ' <i>frisch</i>' : ''}`)),
    row('Saubere Trends (1W·1M·3M positiv)', list(tr.clean, (r) => `${sym(r.c)} ${tone(r.ogrm, pct(r.ogrm))}/M`)),
    row('Gebrochene Trends (alle negativ)', list(tr.broken, (r) => `${sym(r.c)} ${tone(r.ogrm, pct(r.ogrm))}/M`)),
    row('Bias stark bullish / bearish', `${list(bias.filter((x) => x.b.score >= 50).sort((a, b) => b.b.score - a.b.score), (x) => `${sym(x.c)} ${tone(1, signed(x.b.score))}`)}<br>${list(bias.filter((x) => x.b.score <= -50).sort((a, b) => a.b.score - b.b.score), (x) => `${sym(x.c)} ${tone(-1, signed(x.b.score))}`)}`),
    row('Range-Ausbruch ↑', list(ranges.filter((x) => x.r.dir === 'up').sort((a, b) => b.r.pct - a.r.pct), (x) => `${sym(x.c)} ${tone(1, pct(x.r.pct))} über Res`)),
    row('Range-Bruch ↓', list(ranges.filter((x) => x.r.dir === 'dn').sort((a, b) => a.r.pct - b.r.pct), (x) => `${sym(x.c)} ${tone(-1, pct(x.r.pct))} unter Sup`)),
    row('MACD dreht ↑ / ↓', `${list(mf.bullish, (r) => sym(r.c))}<br>${list(mf.bearish, (r) => sym(r.c))}`),
    row('SMA-Kreuzungen ↑ / ↓', `${list(sx.bullish, (r) => `${sym(r.c)} ${esc(r.label)}`)}<br>${list(sx.bearish, (r) => `${sym(r.c)} ${esc(r.label)}`)}`),
    row('RSI ≤ 30 / ≥ 70', `${list(rx.oversold, (r) => `${sym(r.c)} ${Math.round(r.rsi)}`)}<br>${list(rx.overbought, (r) => `${sym(r.c)} ${Math.round(r.rsi)}`)}`),
    row('Ausgelöste Alarme', list(alerts, (x) => `${sym(x.c)} ${esc(alertSummary(x.a))}`)),
  ];
  return `<h2>${esc(label)}</h2><p>${head}</p><table border="1" cellpadding="4" style="border-collapse:collapse;width:100%">${rows.join('')}</table>`;
}

function overview(groups, all, stale) {
  const med = (cs, k) => median(cs.map((c) => c.tv_data?.[k]).filter((v) => v != null));
  const heat = groups.map(([label, cs]) => `<tr><td><b>${esc(label)}</b> <span style="color:${MUTED}">n=${cs.length}</span></td>${['perf_w', 'perf_1m', 'perf_3m', 'perf_6m'].map((k) => { const v = med(cs, k); return `<td style="text-align:right">${tone(v, pct(v))}</td>`; }).join('')}</tr>`).join('');

  const now = Date.now() / 1000, week = now + 7 * 86400;
  const earnings = all
    .map((c) => ({ c, t: Number(c.tv_data?.earnings_next_date) }))
    .filter((x) => x.t > now - 86400 && x.t <= week)
    .sort((a, b) => a.t - b.t)
    .map((x) => `${sym(x.c)} ${new Date(x.t * 1000).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}`);

  return `<h2>Überblick</h2>
<table border="1" cellpadding="4" style="border-collapse:collapse"><tr><th>Sektor-Gruppe (Median)</th><th>1W</th><th>1M</th><th>3M</th><th>6M</th></tr>${heat}</table>
<p><b>Earnings nächste 7 Tage:</b> ${earnings.length ? earnings.join(' · ') : '–'}</p>
${stale.length ? `<p style="color:${MUTED}">Ohne frische TV-Daten (Vortageswerte verwendet): ${stale.map((c) => esc(c.symbol)).join(', ')}</p>` : ''}`;
}

function buildHtml(cands, stale) {
  const at = new Date();
  const groups = MEGA_CLUSTERS.map((m) => [m.label, cands.filter((c) => megaClusterOf(c.sector) === m.key)]);
  const rest = cands.filter((c) => !megaClusterOf(c.sector));
  if (rest.length) groups.push([rest.every(isEtf) ? 'ETFs' : 'ETFs & ohne Sektor', rest]);
  const nW = cands.filter((c) => c._bucket === 'watch').length;
  return `<html><head><meta charset="utf-8"></head><body>
<h1>Discovery Monitor · ${at.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' })}</h1>
<p style="color:${MUTED}">${cands.length} Werte aus Watchlist (${nW}) und Archiv (${cands.length - nW}), <sup>A</sup> = Archiv. Stand ${at.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })} Uhr, TV-Daten frisch abgerufen; „Vortag" = letzter Bericht.</p>
${overview(groups.filter(([, cs]) => cs.length), cands, stale)}
${groups.filter(([, cs]) => cs.length).map(([label, cs]) => groupSection(label, cs)).join('\n')}
</body></html>`;
}

/* ── Google Drive ─────────────────────────────────────────────────────────── */

function drive() {
  const auth = new google.auth.OAuth2(env('GOOGLE_CLIENT_ID'), env('GOOGLE_CLIENT_SECRET'));
  auth.setCredentials({ refresh_token: env('GOOGLE_REFRESH_TOKEN') });
  return google.drive({ version: 'v3', auth });
}

const qName = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const ALL = { supportsAllDrives: true, includeItemsFromAllDrives: true };

async function findOne(d, parent, name, mimeType) {
  const q = `name = '${qName(name)}' and '${parent}' in parents and mimeType = '${mimeType}' and trashed = false`;
  const r = await d.files.list({ q, fields: 'files(id,webViewLink)', pageSize: 1, ...ALL });
  return r.data.files?.[0] ?? null;
}

async function ensureFolder(d, parent, name) {
  const f = await findOne(d, parent, name, FOLDER);
  if (f) return f.id;
  const r = await d.files.create({ requestBody: { name, parents: [parent], mimeType: FOLDER }, fields: 'id', supportsAllDrives: true });
  return r.data.id;
}

/* HTML → Google Doc; ein vorhandenes Doc gleichen Namens wird in place ersetzt (Link bleibt). */
async function upsertDoc(d, parent, name, html) {
  const media = () => ({ mimeType: 'text/html', body: Readable.from(Buffer.from(html, 'utf8')) });
  const ex = await findOne(d, parent, name, DOC);
  if (ex) {
    const r = await d.files.update({ fileId: ex.id, media: media(), fields: 'id,webViewLink', supportsAllDrives: true });
    return r.data;
  }
  const r = await d.files.create({ requestBody: { name, parents: [parent], mimeType: DOC }, media: media(), fields: 'id,webViewLink', supportsAllDrives: true });
  return r.data;
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

async function main() {
  const auth = { backendUrl: env('DISCOVERY_BACKEND_URL').replace(/\/$/, ''), secret: env('DISCOVERY_SECRET') };

  const [watch, archive, lsHist] = await Promise.all([
    storage(auth, { op: 'read', blob_type: 'watch' }),
    storage(auth, { op: 'read', blob_type: 'archive' }),
    storage(auth, { op: 'read_ls_history' }).catch(() => null),
  ]);
  let state = { snapshots: {} };
  try { state = (await storage(auth, { op: 'read', blob_type: 'monitor' })) ?? state; }
  catch (e) { console.warn(`monitor-Blob nicht lesbar (${e.message}) – Bericht ohne Vortagswerte.`); }
  const prevSnaps = state.snapshots ?? {};

  const cands = mergeBuckets(watch?.candidates ?? [], archive?.candidates ?? []).map((c) => ({
    ...c,
    ls_history: lsHist?.history?.[c.id]?.snapshots ?? c.ls_history ?? null,
    tv_data: c.tv_data ? { ...c.tv_data, snapshot: mergeSnapshots(prevSnaps[c.id], c.tv_data.snapshot) } : null,
  }));
  console.log(`Titel: ${cands.length} (Watch ${watch?.candidates?.length ?? 0}, Archiv ${archive?.candidates?.length ?? 0}, nach Dedup)`);

  const fx = await fetchFxRate(auth).catch(() => null);
  if (fx) localStorage.setItem('discovery_fx_eurusd_live', String(fx));

  const updates = await fetchTVEnrichment(cands, { ...auth, onProgress: (m) => console.log(m) });
  console.log(`TV-Daten: ${updates.size}/${cands.length}`);
  // Kein Bericht aus kaputten Daten – sonst überschreibt ein TV-/Proxy-Ausfall den letzten guten.
  if (updates.size < cands.length * 0.5) {
    console.error('Weniger als die Hälfte der Titel mit TV-Daten – Bericht und Vortagszustand bleiben unverändert.');
    process.exit(1);
  }

  const stale = [];
  const fresh = cands.map((c) => {
    const u = updates.get(c.id);
    if (!u) { stale.push(c); return c; }
    return { ...c, ...u, _bucket: c._bucket, ls_history: c.ls_history, tv_data: u.tv_data };
  });

  const html = buildHtml(fresh, stale);
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });   // JJJJ-MM-TT

  if (DRY_RUN) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile('monitor-report.html', html);
    console.log('DRY_RUN: monitor-report.html geschrieben, kein Upload, kein Blob.');
    return;
  }

  const d = drive();
  const folder = env('MONITOR_FOLDER_ID');
  const central = await upsertDoc(d, folder, NAME, html);
  console.log(`✓ ${NAME}: ${central.webViewLink}`);
  const arch = await upsertDoc(d, await ensureFolder(d, folder, ARCHIVE_FOLDER), `Monitor ${day}`, html);
  console.log(`✓ Archiv Monitor ${day}: ${arch.webViewLink}`);

  // Vortagszustand erst nach erfolgreichem Upload schreiben (nur aktuelle Titel → Blob bleibt klein).
  const snapshots = {};
  for (const c of fresh) if (c.tv_data?.snapshot?.length) snapshots[c.id] = c.tv_data.snapshot;
  await storage(auth, { op: 'write', blob_type: 'monitor', blob: { schema_version: 'discovery-monitor-1.0', report_day: day, doc_url: central.webViewLink, snapshots } });
  console.log(`✓ Vortagszustand: ${Object.keys(snapshots).length} Titel`);
}

main().catch((e) => { console.error(e); process.exit(1); });
