/**
 * Diagnose: Wie viele Titel prüft `check-alerts` je Lauf, und wie lange dauert allein
 * der Kursabruf (LS, sonst Yahoo) in denselben Wellen von 6? Geplante Netlify-Funktionen
 * enden nach 30 s — reisst der Lauf diese Grenze, geht kein Push raus und der Zustand
 * wird nicht gespeichert. Schreibt nichts. Läuft über .github/workflows/diag-alerts.yml.
 */
import { fetchLsPrice, fetchYahooPrice } from '../../netlify-backend/netlify/functions/lib/ls-quote.js';
import { rangeAlarmOn } from '../../ui/lib/range-alarm.js';

const backendUrl = process.env.DISCOVERY_BACKEND_URL, secret = process.env.DISCOVERY_SECRET;
const NET_BATCH = 6;
const read = async (blob_type) => {
  const res = await fetch(`${backendUrl}/api/storage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
    body: JSON.stringify({ op: 'read', blob_type }),
  });
  return (await res.json())?.data ?? null;
};

const t0 = performance.now();
const byId = new Map();
const kinds = { alerts: 0, range: 0, manual: 0 };
for (const b of ['inbox', 'watch', 'export']) {
  const blob = await read(b);
  let n = 0;
  for (const c of blob?.candidates ?? []) {
    const hasAlert = Array.isArray(c.alerts) && c.alerts.some((a) => a && a.enabled !== false);
    const range = rangeAlarmOn(c);
    const manual = +c.range_override?.sup > 0 || +c.range_override?.res > 0;
    if (!(hasAlert || range || manual) || byId.has(c.id)) continue;
    byId.set(c.id, c); n++;
    if (hasAlert) kinds.alerts++; if (range) kinds.range++; if (manual) kinds.manual++;
  }
  console.log(`${b.padEnd(7)} ${String(blob?.candidates?.length ?? 0).padStart(4)} Titel · davon ${n} mit aktivem Alarm`);
}
const tRead = performance.now() - t0;
const cands = [...byId.values()];
console.log(`\nGeprüft je Lauf: ${cands.length} Titel (Preis-/Indikator-Alarm ${kinds.alerts} · Range-Alarm ${kinds.range} · manuelles Level ${kinds.manual})`);
console.log(`Blobs lesen: ${(tRead / 1000).toFixed(1)} s`);

const t1 = performance.now();
let ls = 0, yahoo = 0, none = 0, slowest = 0;
const waves = [];
for (let i = 0; i < cands.length; i += NET_BATCH) {
  const w0 = performance.now();
  await Promise.allSettled(cands.slice(i, i + NET_BATCH).map(async (c) => {
    const q = await fetchLsPrice(c).catch(() => null);
    if (q?.price != null) { ls++; return; }
    const y = (c.yahoo_symbol || c.symbol) ? await fetchYahooPrice(c.yahoo_symbol || c.symbol).catch(() => null) : null;
    if (y != null) yahoo++; else none++;
  }));
  const w = performance.now() - w0;
  waves.push(w); slowest = Math.max(slowest, w);
}
const tQuotes = performance.now() - t1;
console.log(`Kurse holen: ${(tQuotes / 1000).toFixed(1)} s in ${waves.length} Wellen (langsamste ${(slowest / 1000).toFixed(1)} s) · LS ${ls} · Yahoo ${yahoo} · ohne Kurs ${none}`);
const total = (tRead + tQuotes) / 1000;
console.log(`\nSumme Lesen + Kurse: ${total.toFixed(1)} s — Grenze einer geplanten Netlify-Funktion: 30 s`);
console.log(total > 30 ? '→ ÜBER der Grenze: der Lauf bricht ab, bevor ein Push rausgeht.' : total > 20 ? '→ knapp: an langsamen Tagen reisst der Lauf die Grenze.' : '→ im Rahmen (gemessen vom GitHub-Runner, nicht von Netlify aus).');
