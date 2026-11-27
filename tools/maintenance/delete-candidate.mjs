/**
 * Titel endgültig aus allen Buckets löschen und gegen Wiederaufnahme sperren.
 *
 * Trifft jeden Kandidaten mit dem Symbol oder einer der ISINs (auch andere
 * Listings derselben Firma). Ohne CONFIRM=1 nur Anzeige der Treffer.
 *
 * Env: DISCOVERY_BACKEND_URL, DISCOVERY_SECRET, SYMBOL, ISINS (kommagetrennt, optional), CONFIRM
 */
const url = `${process.env.DISCOVERY_BACKEND_URL.replace(/\/$/, '')}/api/storage`;
const symbol = String(process.env.SYMBOL ?? '').trim().toUpperCase();
const isins = new Set(String(process.env.ISINS ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
const confirm = process.env.CONFIRM === '1';
if (!symbol) throw new Error('SYMBOL fehlt');

async function storage(body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': process.env.DISCOVERY_SECRET },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(`storage ${body.op}/${body.blob_type}: ${j?.error ?? res.status}`);
  return j.data ?? j;
}

for (const blob_type of ['inbox', 'watch', 'archive', 'export']) {
  const doc = await storage({ op: 'read', blob_type });
  const hits = (doc?.candidates ?? []).filter((c) => String(c.symbol).toUpperCase() === symbol || isins.has(String(c.isin ?? '').toUpperCase()));
  for (const c of hits) console.log(`${blob_type}: ${c.symbol}:${c.exchange} ${c.name ?? c.company_name ?? ''} ISIN ${c.isin ?? '–'}`);
  if (!hits.length) { console.log(`${blob_type}: kein Treffer`); continue; }
  if (!confirm) continue;
  const r = await storage({ op: 'delete_and_tombstone', blob_type, candidate_ids: hits.map((c) => c.id) });
  console.log(`✓ ${blob_type}: ${r.removed} gelöscht und gesperrt`);
}
