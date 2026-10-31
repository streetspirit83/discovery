/**
 * Indices-Snapshot: legt die Tabellen des Markets-Reiters „Indices"
 * (Branchen + Länder) als Google Sheet mit zwei Tabellenblättern in Drive ab.
 *
 * Aufruf (GitHub Action indices-snapshot.yml):
 *   node tools/indices-snapshot/run.mjs
 *   DRY_RUN=1 node tools/indices-snapshot/run.mjs   → schreibt nur eine lokale .xlsx
 *
 * Datenquelle = dieselbe Logik wie die App: `ui/lib/tv-indices.js`
 * (`fetchIndexRows` – Ticker-Auflösung + TV-Scanner über die scrape-proxy-
 * Function). Kein eigener Abruf, keine Kopie der Indexlisten.
 *
 * Die Datei „Indices Snapshot" wird täglich IN PLACE überschrieben (Link und
 * Freigaben bleiben). Fehlt sie im Zielordner, wird sie angelegt.
 *
 * Env: DISCOVERY_BACKEND_URL, DISCOVERY_SECRET,
 *      GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
 *      INDICES_FOLDER_ID (Drive-Ordner „Wertpapiere"), optional SNAPSHOT_NAME
 */

import ExcelJS from 'exceljs';
import { google } from 'googleapis';
import { Readable } from 'node:stream';
import { INDEX_GROUPS, fetchIndexRows, getResolveReport } from '../../ui/lib/tv-indices.js';

const DRY_RUN = process.env.DRY_RUN === '1';

const env = (k, fallback) => {
  const v = process.env[k] ?? fallback;
  if (v == null || v === '') throw new Error(`Env ${k} fehlt`);
  return v;
};

const NAME = process.env.SNAPSHOT_NAME || 'Indices Snapshot';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SHEET = 'application/vnd.google-apps.spreadsheet';

/* ── Tabellen bauen ───────────────────────────────────────────────────────── */

/** Spalten wie im Panel (Kürzel · Index · TV · Δ1T … ØGr/M) plus Kontext. */
const COLUMNS = (groupLabel) => [
  { header: 'Kürzel',        key: 'code',     width: 11 },
  { header: 'Index',         key: 'name',     width: 38 },
  { header: groupLabel,      key: 'label',    width: 24 },
  { header: 'Ticker',        key: 'ticker',   width: 22 },
  { header: 'Stand-Wert',    key: 'value',    width: 14, fmt: '#,##0.00' },
  { header: 'Δ1T %',         key: 'change',   width: 9,  fmt: '+0.0;-0.0;0.0' },
  { header: 'PerfW %',       key: 'perf_w',   width: 9,  fmt: '+0.0;-0.0;0.0' },
  { header: 'Perf1M %',      key: 'perf_1m',  width: 9,  fmt: '+0.0;-0.0;0.0' },
  { header: 'Perf3M %',      key: 'perf_3m',  width: 9,  fmt: '+0.0;-0.0;0.0' },
  { header: 'Perf6M %',      key: 'perf_6m',  width: 9,  fmt: '+0.0;-0.0;0.0' },
  { header: 'ØGr/M %',       key: 'growth_m', width: 9,  fmt: '+0.00;-0.00;0.00' },
  { header: 'Quelle',        key: 'source',   width: 14 },
  { header: 'TradingView',   key: 'url',      width: 48 },
  { header: 'Stand (UTC)',   key: 'at',       width: 18 },
];

function addSheet(wb, group, rows, at) {
  const ws = wb.addWorksheet(group.label, { views: [{ state: 'frozen', ySplit: 1 }] });
  const cols = COLUMNS(group.label === 'Branchen' ? 'Branche' : 'Land');
  ws.columns = cols.map(({ header, key, width }) => ({ header, key, width }));
  ws.getRow(1).font = { bold: true };

  const byCode = new Map(rows.map((r) => [r.code, r]));
  // Absteigend nach PerfW; Indizes ohne Wert stehen immer am Ende.
  const entries = [...group.entries].sort((a, b) => {
    const x = byCode.get(a.code)?.perf_w, y = byCode.get(b.code)?.perf_w;
    const xe = x == null || Number.isNaN(x), ye = y == null || Number.isNaN(y);
    if (xe || ye) return xe && ye ? 0 : xe ? 1 : -1;
    return y - x;
  });
  for (const e of entries) {
    const r = byCode.get(e.code) ?? e;
    ws.addRow({
      code: e.code,
      name: e.name,
      label: e.label,
      ticker: r.ticker ?? '',
      value: r.value ?? null,
      change: r.change ?? null,
      perf_w: r.perf_w ?? null,
      perf_1m: r.perf_1m ?? null,
      perf_3m: r.perf_3m ?? null,
      perf_6m: r.perf_6m ?? null,
      growth_m: r.growth_m ?? null,
      // ETF-Stellvertreter kenntlich machen – dort stehen ETF-, nicht Indexzahlen.
      source: r.ok ? (r.viaEtf ? `ETF ${r.viaEtf}` : 'Index') : 'ohne Daten',
      url: r.url ?? '',
      at,
    });
  }
  cols.forEach((c, i) => { if (c.fmt) ws.getColumn(i + 1).numFmt = c.fmt; });
  // Header-Zeile behält ihr Textformat
  ws.getRow(1).eachCell((cell) => { cell.numFmt = 'General'; });
  return ws;
}

async function buildWorkbook(rows) {
  const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const wb = new ExcelJS.Workbook();
  for (const g of INDEX_GROUPS) addSheet(wb, g, rows, at);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ── Google Drive ─────────────────────────────────────────────────────────── */

function drive() {
  const auth = new google.auth.OAuth2(env('GOOGLE_CLIENT_ID'), env('GOOGLE_CLIENT_SECRET'));
  auth.setCredentials({ refresh_token: env('GOOGLE_REFRESH_TOKEN') });
  return google.drive({ version: 'v3', auth });
}

async function upsert(d, folderId, buf) {
  const media = () => ({ mimeType: XLSX, body: Readable.from(buf) });
  const q = `name = '${NAME.replace(/'/g, "\\'")}' and '${folderId}' in parents and mimeType = '${SHEET}' and trashed = false`;
  const found = await d.files.list({ q, fields: 'files(id,name)', pageSize: 5, supportsAllDrives: true, includeItemsFromAllDrives: true });
  const existing = found.data.files?.[0];

  if (existing) {
    // Inhalt ersetzen – Datei-ID, Link und Freigaben bleiben.
    const r = await d.files.update({ fileId: existing.id, media: media(), fields: 'id,webViewLink', supportsAllDrives: true });
    return { ...r.data, created: false };
  }
  const r = await d.files.create({
    requestBody: { name: NAME, parents: [folderId], mimeType: SHEET },
    media: media(),
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  });
  return { ...r.data, created: true };
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

async function main() {
  const backendUrl = env('DISCOVERY_BACKEND_URL').replace(/\/$/, '');
  const secret = env('DISCOVERY_SECRET');

  const rows = await fetchIndexRows({ backendUrl, secret });
  const ok = rows.filter((r) => r.ok);
  const missing = rows.filter((r) => !r.ok).map((r) => r.code);
  console.log(`Indizes: ${ok.length}/${rows.length} mit Daten${missing.length ? ` · ohne Daten: ${missing.join(', ')}` : ''}`);

  // Kein Snapshot aus leeren Daten – sonst überschreibt ein Proxy-/TV-Ausfall
  // die letzte gute Version mit einer leeren Tabelle.
  if (!ok.length) {
    console.error('Keine einzige Zeile mit Daten – Datei bleibt unverändert.');
    console.error(JSON.stringify(getResolveReport()?.chunkLog?.slice(0, 5) ?? [], null, 2));
    process.exit(1);
  }

  const buf = await buildWorkbook(rows);

  if (DRY_RUN) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile('indices-snapshot.xlsx', buf);
    console.log('DRY_RUN: indices-snapshot.xlsx geschrieben, kein Upload.');
    return;
  }

  const file = await upsert(drive(), env('INDICES_FOLDER_ID'), buf);
  console.log(`✓ ${file.created ? 'angelegt' : 'aktualisiert'}: ${file.webViewLink}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
