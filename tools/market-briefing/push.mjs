/**
 * Marktbriefing in den market-Blob schreiben (Upsert je Handelstag).
 *
 * Aufruf über die Action market-briefing.yml (workflow_dispatch), die Claude
 * nach der Tagesauswertung auf „Go“ startet:
 *   gh workflow run market-briefing.yml -f payload="$(cat briefing.json)"
 * Lokal:  PAYLOAD="$(cat briefing.json)" node tools/market-briefing/push.mjs
 *         DELETE_DAY=2026-10-28 node tools/market-briefing/push.mjs
 *
 * Der Blob hält höchstens KEEP Briefings, neueste zuerst. Ein erneuter Lauf für
 * denselben Tag ersetzt das alte Briefing.
 *
 * Arten (Feld kind): daily (Tagesbriefing, Standard), preview (Wochenvorschau),
 * watch (Watchlist-Rückblick); je Art und Tag ein Eintrag.
 *
 * Env: DISCOVERY_BACKEND_URL, DISCOVERY_SECRET, PAYLOAD | DELETE_DAY (+ DELETE_KIND), optional DRY_RUN=1
 */

const KEEP = 30;                  // je Art
const KINDS = ['daily', 'preview', 'watch'];
const kindOf = (b) => b?.kind ?? 'daily';
const keyOf = (b) => `${kindOf(b)}:${b?.day}`;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const env = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Env ${k} fehlt`);
  return v;
};

async function storage(body) {
  const res = await fetch(`${env('DISCOVERY_BACKEND_URL').replace(/\/$/, '')}/api/storage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': env('DISCOVERY_SECRET') },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(`storage ${body.op}/${body.blob_type}: ${j?.error ?? res.status}`);
  return j.data;
}

/* Pflichtfelder prüfen – ein kaputtes Briefing soll den Blob nicht erreichen. */
function validate(b) {
  const errs = [];
  if (!b || typeof b !== 'object') return ['Payload ist kein Objekt'];
  if (!DAY.test(b.day ?? '')) errs.push('day fehlt oder ist kein JJJJ-MM-TT');
  if (!KINDS.includes(kindOf(b))) errs.push(`kind muss ${KINDS.join('|')} sein`);
  if (!b.title) errs.push('title fehlt');
  if (!b.lead) errs.push('lead fehlt');
  for (const k of ['top', 'flop', 'earnings', 'technik', 'drivers', 'sources', 'indices', 'calendar', 'themes', 'news']) {
    if (b[k] != null && !Array.isArray(b[k]) && !(k === 'indices' && typeof b[k] === 'object')) errs.push(`${k} hat das falsche Format`);
  }
  return errs;
}

async function main() {
  const del = process.env.DELETE_DAY;
  let entry = null;
  if (!del) {
    try { entry = JSON.parse(env('PAYLOAD')); }
    catch (e) { throw new Error(`PAYLOAD ist kein gültiges JSON: ${e.message}`); }
    const errs = validate(entry);
    if (errs.length) throw new Error(`Briefing ungültig: ${errs.join('; ')}`);
    entry.saved_at = new Date().toISOString();
  }

  const doc = (await storage({ op: 'read', blob_type: 'market' })) ?? {};
  const delKey = del ? `${process.env.DELETE_KIND || 'daily'}:${del}` : null;
  const list = (Array.isArray(doc.briefings) ? doc.briefings : []).filter((b) => keyOf(b) !== (delKey ?? keyOf(entry)));
  if (entry) list.push(entry);
  list.sort((a, b) => (a.day < b.day ? 1 : -1));
  // höchstens KEEP je Art, neueste zuerst
  const seen = {};
  const briefings = list.filter((b) => (seen[kindOf(b)] = (seen[kindOf(b)] ?? 0) + 1) <= KEEP);

  if (process.env.DRY_RUN === '1') {
    console.log(`DRY_RUN: ${briefings.length} Briefings, neuestes ${briefings[0]?.day ?? '–'}`);
    return;
  }
  await storage({
    op: 'write', blob_type: 'market',
    blob: { schema_version: 'discovery-market-1.0', blob_type: 'market', updated_at: new Date().toISOString(), briefings },
  });
  console.log(del ? `✓ ${delKey} gelöscht` : `✓ ${entry.day} gespeichert (${kindOf(entry)})`, `· ${briefings.length} Briefings im Blob`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
