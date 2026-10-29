/**
 * Monitor-Bericht: täglicher Überblick über Watchlist + Archiv (nur Einzelaktien,
 * ETFs fliegen raus) — als JSON für die KI-Auswertung und als lesbare
 * Kurzfassung (Google Doc). Logik in report.mjs, hier nur Ein-/Ausgabe.
 *
 * Aufruf (GitHub Action monitor-report.yml):
 *   node tools/monitor-report/run.mjs
 *   DRY_RUN=1 node tools/monitor-report/run.mjs   → schreibt nur monitor-report.html
 *                                                   und monitor-report.json, kein Upload
 *
 * Ablauf:
 *   1. watch + archive lesen, nach Symbol+Börse dedupliziert (Watch gewinnt),
 *      ETFs entfernt.
 *   2. TV-Daten für alle Titel frisch holen (fetchTVEnrichment, wie die App).
 *      Die Kandidaten-Blobs werden NICHT beschrieben.
 *   3. Vortagszustand (Score-Tagesreihe je Titel) aus dem monitor-Blob einsetzen,
 *      damit Deltas, MACD-Wechsel und SMA-Kreuzungen funktionieren.
 *   4. Nach Drive (Ordner MONITOR_FOLDER_ID):
 *        „Discovery Monitor"        Google Doc, in place überschrieben (Link bleibt)
 *        „Discovery Monitor.json"   kompakte Tagesfassung für die KI-Auswertung
 *        „Discovery Monitor – vollständig.json"  alle Titel (beide in place überschrieben)
 *        „Discovery Monitor – Prompt.md"  Auswertungsprompt (aus PROMPT.md)
 *        Monitor Archiv/„Monitor JJJJ-MM-TT" + „Monitor JJJJ-MM-TT.json" (vollständig)
 *
 * Env: DISCOVERY_BACKEND_URL, DISCOVERY_SECRET,
 *      GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
 *      MONITOR_FOLDER_ID (Drive-Zielordner), optional MONITOR_NAME
 */

import { google } from 'googleapis';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { fetchTVEnrichment, fetchFxRate } from '../../ui/lib/tv-enrichment.js';
import { normalizeExchange } from '../../ui/lib/exchange-map.js';
import { isEtf } from '../../ui/lib/instrument-type.js';
import { buildReport, renderHtml, slimReport } from './report.mjs';

const DRY_RUN = process.env.DRY_RUN === '1';
const NAME = process.env.MONITOR_NAME || 'Discovery Monitor';
const ARCHIVE_FOLDER = 'Monitor Archiv';
const SNAPSHOT_MAX = 5;          // wie tv-enrichment.js
const DOC = 'application/vnd.google-apps.document';
const FOLDER = 'application/vnd.google-apps.folder';
const JSON_MIME = 'application/json';
const MD_MIME = 'text/markdown';

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

/* Datei ohne Umwandlung (JSON, Markdown); vorhandene gleichen Namens in place ersetzen. */
async function upsertFile(d, parent, name, mimeType, text) {
  const media = () => ({ mimeType, body: Readable.from(Buffer.from(text, 'utf8')) });
  const ex = await findOne(d, parent, name, mimeType);
  if (ex) {
    const r = await d.files.update({ fileId: ex.id, media: media(), fields: 'id,webViewLink', supportsAllDrives: true });
    return r.data;
  }
  const r = await d.files.create({ requestBody: { name, parents: [parent], mimeType }, media: media(), fields: 'id,webViewLink', supportsAllDrives: true });
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

  const merged = mergeBuckets(watch?.candidates ?? [], archive?.candidates ?? []);
  const cands = merged.filter((c) => !isEtf(c)).map((c) => ({
    ...c,
    ls_history: lsHist?.history?.[c.id]?.snapshots ?? c.ls_history ?? null,
    tv_data: c.tv_data ? { ...c.tv_data, snapshot: mergeSnapshots(prevSnaps[c.id], c.tv_data.snapshot) } : null,
  }));
  console.log(`Titel: ${cands.length} Aktien (Watch ${watch?.candidates?.length ?? 0}, Archiv ${archive?.candidates?.length ?? 0}; ${merged.length - cands.length} ETFs entfernt)`);

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
  }).filter((c) => !isEtf(c));                       // TV kennt den Typ genauer als die Namensheuristik

  await publish(fresh, stale.filter((c) => fresh.includes(c)), async (snapshots, urls) => {
    await storage(auth, { op: 'write', blob_type: 'monitor', blob: { schema_version: 'discovery-monitor-1.0', report_day: urls.day, doc_url: urls.doc, json_url: urls.json, snapshots } });
  });
}

/* Bericht bauen und ausliefern. `saveState` schreibt den Vortagszustand erst nach erfolgreichem Upload. */
async function publish(fresh, stale, saveState) {
  const report = buildReport(fresh, stale);
  const full = JSON.stringify({ ...report, variant: 'full' });
  const json = JSON.stringify(slimReport(report));   // Tagesfassung – spart Tokens bei der KI-Auswertung
  const jsonName = `${NAME}.json`;
  const fullName = `${NAME} – vollständig.json`;
  const html = renderHtml(report, { jsonName });
  const day = report.trading_day;

  if (DRY_RUN) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile('monitor-report.html', html);
    await writeFile('monitor-report.json', json);
    await writeFile('monitor-report.full.json', full);
    console.log(`DRY_RUN: monitor-report.html + .json geschrieben (${report.stocks.length} Aktien), kein Upload, kein Blob.`);
    return report;
  }

  const d = drive();
  const folder = env('MONITOR_FOLDER_ID');
  const doc = await upsertDoc(d, folder, NAME, html);
  console.log(`✓ ${NAME}: ${doc.webViewLink}`);
  const js = await upsertFile(d, folder, jsonName, JSON_MIME, json);
  console.log(`✓ ${jsonName} (${Math.round(json.length / 1024)} KB): ${js.webViewLink}`);
  const fj = await upsertFile(d, folder, fullName, JSON_MIME, full);
  console.log(`✓ ${fullName} (${Math.round(full.length / 1024)} KB): ${fj.webViewLink}`);
  const prompt = await readFile(new URL('./PROMPT.md', import.meta.url), 'utf8').catch(() => null);
  if (prompt) {
    const p = await upsertFile(d, folder, `${NAME} – Prompt.md`, MD_MIME, prompt);
    console.log(`✓ Prompt: ${p.webViewLink}`);
  }
  const archive = await ensureFolder(d, folder, ARCHIVE_FOLDER);
  await upsertDoc(d, archive, `Monitor ${day}`, html);
  await upsertFile(d, archive, `Monitor ${day}.json`, JSON_MIME, full);
  console.log(`✓ Archiv: Monitor ${day} (Doc + JSON)`);

  // Nur aktuelle Titel → Blob bleibt klein.
  const snapshots = {};
  for (const c of fresh) if (c.tv_data?.snapshot?.length) snapshots[c.id] = c.tv_data.snapshot;
  await saveState(snapshots, { day, doc: doc.webViewLink, json: js.webViewLink });
  console.log(`✓ Vortagszustand: ${Object.keys(snapshots).length} Titel`);
  return report;
}

main().catch((e) => { console.error(e); process.exit(1); });
