/**
 * Startzeit-Messung der App (headless Chromium, Handy-Viewport, CPU 4× gedrosselt
 * wie ein Mittelklasse-Handy). Je Bucket ein Kaltstart (leerer Cache) und ein
 * Warmstart (Reload im selben Kontext). Misst:
 *   shell   – erste Zeichnung der Seite (FCP)
 *   rows    – erste Tabellenzeile sichtbar
 *   settled – keine Anfragen mehr offen (networkidle)
 * dazu Anfragen/übertragene Bytes, Main-Thread-Blockaden (Long Tasks) und die
 * Zahl der Listen-Neuzeichnungen. Schreibt nichts in die Blobs.
 */
import { chromium } from 'playwright';

const URL_ = process.env.DISCOVERY_UI_URL || 'https://streetspirit83.github.io/discovery/';
const buckets = (process.env.BUCKETS || 'all,watch').split(',');
const s = (ms) => `${(ms / 1000).toFixed(2)} s`;

async function run(ctx, bucket, label) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  let bytes = 0, reqs = 0, js = 0;
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; reqs++; });
  page.on('request', (r) => { if (r.resourceType() === 'script') js++; });
  await page.addInitScript(() => {
    window.__lt = 0; window.__ltMs = 0;
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__lt++; window.__ltMs += e.duration; } }).observe({ type: 'longtask', buffered: true }); } catch {}
    window.__renders = 0;
    const mo = new MutationObserver((m) => { for (const x of m) if (x.target.tagName === 'TBODY' && x.addedNodes.length) { window.__renders++; break; } });
    document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { childList: true, subtree: true }));
  });
  const t0 = Date.now();
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('tbody tr', { timeout: 60000 }).catch(() => {});
  const rows = Date.now() - t0;
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  const settled = Date.now() - t0;
  const m = await page.evaluate(() => ({
    fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
    n: document.querySelectorAll('tbody tr').length, lt: window.__lt, ltMs: window.__ltMs, renders: window.__renders,
  }));
  console.log(`${bucket.padEnd(6)} ${label.padEnd(5)} shell ${s(m.fcp ?? 0)} · rows ${s(rows)} (${m.n} Zeilen) · settled ${s(settled)} · ${reqs} Anfragen (${js} Skripte), ${(bytes / 1024 / 1024).toFixed(2)} MB · Long Tasks ${m.lt} = ${s(m.ltMs)} · Listen-Zeichnungen ${m.renders}`);
  await page.close();
}

const browser = await chromium.launch();
for (const bucket of buckets) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) if (v && localStorage.getItem(k) == null) localStorage.setItem(k, v); }, {
    discovery_backend_url: process.env.DISCOVERY_BACKEND_URL, discovery_secret: process.env.DISCOVERY_SECRET,
    'discovery.ui.v1': JSON.stringify({ bucket }),
  });
  await run(ctx, bucket, 'kalt');
  await run(ctx, bucket, 'warm');
  await ctx.close();
}
await browser.close();
