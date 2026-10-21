/**
 * Dossier-Generator: legt pro Watchlist-Ticker ein Google Doc
 * „Symbol - Company Name" mit Kerndaten und Screenshots aus der Discovery-App an.
 *
 * Aufruf (GitHub Action dossier.yml):
 *   node tools/dossier/run.mjs [candidate_id] [create|update]
 *   ohne candidate_id → Sweep: alle Watch-Kandidaten mit offenem Auftrag
 *     (dossier_flag ohne Doc, oder dossier_update gesetzt).
 *
 * Datenquellen — nur die eigene App:
 *   • Watch-Blob (storage read):   ISIN, Sector, Sub Sector, MCap, Earnings
 *   • App headless (Playwright):   Firmenprofil (ROIC.ai, gleiche Kaskade wie
 *     der Button), fairer Kurs aus dem Fund.-Tab, Screenshots der Tabs
 *
 * Env: DISCOVERY_BACKEND_URL, DISCOVERY_SECRET, DISCOVERY_UI_URL,
 *      ROIC_API_KEY, TWELVEDATA_API_KEY,
 *      GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, DOSSIER_FOLDER_ID
 */

import { chromium } from 'playwright';
import { google } from 'googleapis';
import { Readable } from 'node:stream';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun,
  Table, TableRow, TableCell, WidthType, ExternalHyperlink,
} from 'docx';

const env = (k, fallback) => {
  const v = process.env[k] ?? fallback;
  if (v == null || v === '') throw new Error(`Env ${k} fehlt`);
  return v;
};

const BACKEND = env('DISCOVERY_BACKEND_URL').replace(/\/$/, '');
const SECRET = env('DISCOVERY_SECRET');
const UI_URL = env('DISCOVERY_UI_URL', 'https://streetspirit83.github.io/discovery/');
const FOLDER_ID = env('DOSSIER_FOLDER_ID');
const BLOB = 'watch';

// Tabs, die als Screenshot ins Dossier wandern (Schlüssel = data-tab im Detail-Sheet).
const SHOTS = [
  { tab: 'performance', title: 'Performance (1J TD) inkl. Firmenprofil' },
  { tab: 'trend',       title: 'Trend' },
  { tab: 'forecast',    title: 'Prognose (6 Monate)' },
  { tab: 'fundamental', title: 'Fundamentaldaten & fairer Kurs' },
];

/* ── Backend ──────────────────────────────────────────────────────────────── */

async function storage(body) {
  const res = await fetch(`${BACKEND}/api/storage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': SECRET },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(`storage ${body.op}: HTTP ${res.status} ${json.error ?? ''}`);
  return json;
}

const readWatch = async () => (await storage({ op: 'read', blob_type: BLOB })).data?.candidates ?? [];
const patch = (id, updates) => storage({ op: 'update_candidate', blob_type: BLOB, candidate_id: id, updates });

/* ── Auswahl ──────────────────────────────────────────────────────────────── */

function pending(c) {
  if (c.dossier_update) return 'update';
  if (c.dossier_flag && !c.dossier?.doc_id) return 'create';
  return null;
}

/* ── Formatierung ─────────────────────────────────────────────────────────── */

const de = (n, d = 2) => Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

function fmtCap(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e12) return `${de(n / 1e12)} Bio.`;
  if (n >= 1e9) return `${de(n / 1e9)} Mrd.`;
  return `${de(n / 1e6, 0)} Mio.`;
}

function fmtEarnings(ts) {
  if (ts == null) return '—';
  const ms = typeof ts === 'number' ? (ts < 1e12 ? ts * 1000 : ts) : Date.parse(ts);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/* ── App headless ─────────────────────────────────────────────────────────── */

async function openApp(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 2200 }, deviceScaleFactor: 1, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const settings = {
    discovery_backend_url: BACKEND,
    discovery_secret: SECRET,
    discovery_roic_key: process.env.ROIC_API_KEY ?? '',
    discovery_twelvedata_key: process.env.TWELVEDATA_API_KEY ?? '',
  };
  await ctx.addInitScript((s) => {
    for (const [k, v] of Object.entries(s)) if (v) localStorage.setItem(k, v);
  }, settings);
  return ctx;
}

const settle = async (page, ms = 1500) => {
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
};

async function capture(ctx, c) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.warn(`[page] ${e.message}`));
  // #c=<id> ist der bestehende Deep-Link (ntfy-Push) → öffnet das Detail-Sheet.
  await page.goto(`${UI_URL}#c=${encodeURIComponent(c.id)}`, { waitUntil: 'domcontentloaded' });
  const sheet = page.locator('#detail-sheet');
  await sheet.locator('.detail-tabs').waitFor({ timeout: 45000 });
  await settle(page, 3000); // Autofetch beim Öffnen: LS, Kerzen, TR, Kursziele

  const tab = async (key) => {
    await sheet.locator(`.tab-btn[data-tab="${key}"]`).click();
    await settle(page);
  };

  // Perf.: Chart auf 1J (TD/Yahoo-Kerzen) und Firmenprofil laden.
  await tab('performance');
  const oneYear = sheet.locator('.chart-horizon [data-horizon="1J"]');
  if (await oneYear.count()) { await oneYear.click(); await settle(page, 3000); }
  const profBtn = sheet.locator('#profile-load');
  if (await profBtn.count()) {
    await profBtn.click();
    await sheet.locator('.id-profile--loading').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
    await settle(page, 800);
  }
  const more = sheet.locator('#profile-more');
  if (await more.isVisible().catch(() => false)) await more.click();

  // Profil als Daten: dieselbe Funktion, die der Button nutzt (Cache greift).
  const profile = await page.evaluate(async (cand) => {
    try {
      const m = await import(new URL('lib/company-profile.js', location.href).href);
      return await m.fetchCompanyProfile(cand, {
        backendUrl: localStorage.getItem('discovery_backend_url'),
        secret: localStorage.getItem('discovery_secret'),
      });
    } catch (e) { return { error: String(e?.message ?? e) }; }
  }, c);

  // Nur für den Screenshot: Scroll-Container des Sheets aufklappen, damit jedes
  // Tab-Panel in voller Höhe aufs Bild kommt statt im Modal abgeschnitten.
  await page.addStyleTag({ content: `
    #detail-sheet, #detail-sheet .detail-tabpanes, #detail-sheet .detail-col--main
      { max-height: none !important; height: auto !important; overflow: visible !important; }
    #detail-sheet .id-profile__text { -webkit-line-clamp: unset !important; max-height: none !important; }` });

  const shots = [];
  for (const s of SHOTS) {
    if (s.tab !== 'performance') await tab(s.tab);
    const panel = sheet.locator(`.tab-panel[data-panel="${s.tab}"]`);
    const png = await panel.screenshot({ type: 'png', animations: 'disabled' });
    shots.push({ ...s, png });
  }

  // Fairer Kurs exakt so, wie der Fund.-Tab ihn zeigt.
  await tab('fundamental');
  const fundText = await sheet.locator('.tab-panel[data-panel="fundamental"]').innerText().catch(() => '');
  const fair = /Fairer Kurs\s*\n\s*([^\n]+)/i.exec(fundText)?.[1]?.trim() ?? null;
  const fairNote = /Fairer Kurs\s*\n\s*[^\n]+\n\s*([^\n]+)/i.exec(fundText)?.[1]?.trim() ?? null;

  await page.close();
  return { profile, shots, fair, fairNote };
}

/* ── Dokument ─────────────────────────────────────────────────────────────── */

function cell(text, bold = false) {
  return new TableCell({
    width: { size: bold ? 30 : 70, type: WidthType.PERCENTAGE },
    children: [new Paragraph({ children: [new TextRun({ text: String(text ?? '—'), bold })] })],
  });
}

async function buildDocx(c, cap) {
  const tv = c.tv_data ?? {};
  const p = cap.profile && !cap.profile.error ? cap.profile : null;
  const website = p?.website ?? null;
  const rows = [
    ['Symbol', `${c.symbol}${c.exchange ? ` (${c.exchange})` : ''}`],
    ['Name', c.name],
    ['ISIN', c.isin ?? tv.isin],
    ['Sector', c.sector],
    ['Sub Sector', c.sub_sector],
    ['Fairer Kurs (DCF)', cap.fair ? `${cap.fair}${cap.fairNote ? ` · ${cap.fairNote}` : ''}` : '—'],
    ['MCap', fmtCap(tv.market_cap ?? tv.market_cap_basic)],
    ['Nächste Earnings', fmtEarnings(tv.earnings_next_date)],
    ['Website', website ?? '—'],
  ];

  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, text: `${c.symbol} - ${c.name}` }),
    new Paragraph({ children: [new TextRun({ text: `Quelle: Discovery Workspace · Stand ${fmtEarnings(Date.now())}`, italics: true })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Kerndaten' }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows.map(([k, v]) => new TableRow({ children: [cell(k, true), cell(v)] })) }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Firmenprofil' }),
  ];

  if (p?.description) {
    for (const para of p.description.split(/\n{2,}/)) children.push(new Paragraph({ text: para.trim() }));
    const facts = Object.entries(p).filter(([k, v]) => !['description', 'source', 'website', 'url', 'error'].includes(k) && v != null && typeof v !== 'object');
    if (facts.length) children.push(new Paragraph({ children: [new TextRun({ text: facts.map(([k, v]) => `${k}: ${v}`).join(' · '), size: 18 })] }));
    if (website) children.push(new Paragraph({ children: [new ExternalHyperlink({ link: website, children: [new TextRun({ text: website, style: 'Hyperlink' })] })] }));
    children.push(new Paragraph({ children: [new TextRun({ text: `Quelle: ${p.source ?? 'ROIC.ai'}`, italics: true, size: 18 })] }));
  } else {
    children.push(new Paragraph({ text: `Kein Profil verfügbar${cap.profile?.error ? ` (${cap.profile.error})` : ''}.` }));
  }

  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Screenshots' }));
  for (const s of cap.shots) {
    // Breite auf ~6,3 Zoll (A4 mit Rand) skalieren, Seitenverhältnis halten.
    const { width, height } = pngSize(s.png);
    const w = 600, h = Math.round(height * (w / width));
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, text: s.title }));
    children.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: s.png, transformation: { width: w, height: h } })] }));
  }

  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/* ── Google Drive ─────────────────────────────────────────────────────────── */

function drive() {
  const auth = new google.auth.OAuth2(env('GOOGLE_CLIENT_ID'), env('GOOGLE_CLIENT_SECRET'));
  auth.setCredentials({ refresh_token: env('GOOGLE_REFRESH_TOKEN') });
  return google.drive({ version: 'v3', auth });
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function upload(d, c, buf) {
  const name = `${c.symbol} - ${c.name}`;
  const media = () => ({ mimeType: DOCX, body: Readable.from(buf) });
  const oldId = c.dossier?.doc_id;

  if (oldId) {
    // Update: Inhalt des bestehenden Docs ersetzen — Link und Kommentare bleiben.
    try {
      const r = await d.files.update({ fileId: oldId, requestBody: { name }, media: media(), fields: 'id,webViewLink' });
      return r.data;
    } catch (e) {
      console.warn(`[drive] Update von ${oldId} fehlgeschlagen (${e.message}) — lege neu an.`);
    }
  }
  const r = await d.files.create({
    requestBody: { name, parents: [FOLDER_ID], mimeType: 'application/vnd.google-apps.document' },
    media: media(),
    fields: 'id,webViewLink',
  });
  if (oldId) await d.files.update({ fileId: oldId, requestBody: { trashed: true } }).catch(() => {});
  return r.data;
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

async function main() {
  const [argId, argMode] = process.argv.slice(2);
  const all = await readWatch();
  const jobs = argId
    ? all.filter((c) => c.id === argId).map((c) => ({ c, mode: argMode === 'update' ? 'update' : (pending(c) ?? 'create') }))
    : all.map((c) => ({ c, mode: pending(c) })).filter((j) => j.mode);

  if (argId && !jobs.length) throw new Error(`Kandidat ${argId} nicht im Watch-Blob`);
  if (!jobs.length) { console.log('Keine offenen Dossier-Aufträge.'); return; }
  console.log(`Dossiers: ${jobs.map((j) => `${j.c.symbol}(${j.mode})`).join(', ')}`);

  const d = drive();
  const browser = await chromium.launch();
  const ctx = await openApp(browser);
  let failed = 0;

  for (const { c, mode } of jobs) {
    const t0 = Date.now();
    try {
      await patch(c.id, { dossier: { ...(c.dossier ?? {}), status: 'running', mode, started_at: new Date().toISOString(), error: null } });
      const cap = await capture(ctx, c);
      const buf = await buildDocx(c, cap);
      const file = await upload(d, c, buf);
      await patch(c.id, {
        dossier_flag: true,
        dossier_update: false,
        dossier: { status: 'done', doc_id: file.id, url: file.webViewLink, updated_at: new Date().toISOString(), error: null },
      });
      console.log(`✓ ${c.symbol} → ${file.webViewLink} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    } catch (e) {
      failed++;
      console.error(`✗ ${c.symbol}: ${e.stack ?? e.message}`);
      await patch(c.id, {
        dossier_update: false,
        dossier: { ...(c.dossier ?? {}), status: 'error', error: String(e.message).slice(0, 300), updated_at: new Date().toISOString() },
      }).catch(() => {});
    }
  }

  await browser.close();
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
