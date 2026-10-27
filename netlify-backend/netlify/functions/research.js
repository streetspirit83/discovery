/**
 * Netlify Function: research
 * Schnittstelle für die Claude-Aufgabe „Discovery Research" (ausgelöst im
 * Artefakt „Research"). Schmaler Zugang mit eigenem Schlüssel (Header
 * x-research-token = env RESEARCH_TOKEN), damit die Aufgabe nicht den
 * Hauptschlüssel DISCOVERY_SECRET braucht. Arbeitet nur auf dem watch-Blob.
 *
 * GET  /api/research                 → Watch-Titel mit Dossier-Doc
 *        { items: [{ id, symbol, name, doc_id, url, research: { key: at } }] }
 * GET  /api/research?doc=<driveId>   (oder ?id=<candidateId>)
 *        Optional &symbol=<SYM>: Ist das Doc an keinem Titel verknüpft (z. B. ein
 *        Dossier-Doc aus der Zeit vor der Verknüpfung), gilt der eindeutige
 *        Watch-Titel mit diesem Symbol, der selbst noch kein Doc hat. Der POST
 *        verknüpft das Doc dann dauerhaft (dossier.doc_id), sodass das Update
 *        genau dieses Doc neu baut statt ein zweites anzulegen.
 *        → { candidate: {…}, vars: {…} }   Werte für die Prompt-Platzhalter,
 *          gerechnet mit denselben Funktionen wie das ✨-Modal in Discovery
 *          (ui/lib/research-prompt.js, Reverse-DCF aus ui/lib/tv-reverse-dcf.js).
 * POST /api/research  { doc | id, symbol?, results: [{ key, label, md }], rebuild }
 *        Schreibt candidate.research[key] = { label, md, at } — ein neuer Lauf
 *        ersetzt den alten desselben Prompts. Mit rebuild: true wird danach das
 *        Dossier zum Update vorgemerkt und die Action dossier.yml angestossen;
 *        sie baut das Doc samt Abschnitt „AI Research" neu. Kann nichts anderes.
 *
 *
 * Warteschlange aus der App (Discovery ✨-Modal):
 *   Die App setzt candidate.research_request = { keys, at } direkt über die
 *   storage-Funktion. Die geplante Aufgabe „Discovery Research (App-Warteschlange)"
 *   arbeitet sie ab:
 * GET  /api/research?queue=1         → { items: [{ id, symbol, name, doc_id, keys, at }] }
 * POST /api/research  { id, results, failed: [{ key, err }], rebuild }
 *        Geschriebene und gescheiterte Schlüssel werden aus research_request
 *        ausgetragen (leer → Feld entfernt); Fehler landen in research_error.
 *        Hat der Titel noch kein Doc, aber einen Dossier-Haken, stösst rebuild
 *        das Anlegen an (mode create) — das Doc enthält die Ergebnisse dann gleich.
 * Prompt-Katalog (die Prompts des Artefakts, damit die App sie zur Auswahl zeigt):
 * POST /api/research  { catalog: [{ key, label }] }   → speichert ihn (Aufgabe)
 * GET  /api/research?catalog=1                         → { prompts, at } (App)
 *
 * Zugang: x-research-token = RESEARCH_TOKEN (Aufgabe) oder
 *         x-discovery-secret = DISCOVERY_SECRET (App, Hauptschlüssel).
 *
 * Env: RESEARCH_TOKEN, DISCOVERY_SECRET, GH_DISPATCH_TOKEN, optional GH_REPO
 */

import { getStore } from '@netlify/blobs';
import { promptVars } from '../../../ui/lib/research-prompt.js';
import { fairValue } from '../../../ui/lib/tv-reverse-dcf.js';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-research-token, x-discovery-secret',
};
const KEY_RE = /^[a-z0-9_-]{1,40}$/;
const MAX_MD = 40000;
const MAX_RESULTS = 10;

const respond = (status, body) => new Response(JSON.stringify(body), { status, headers: HEADERS });

const DOC_RE = /^[A-Za-z0-9_-]{10,100}$/;
const CATALOG_KEY = 'discovery-research-catalog';
const MAX_CATALOG = 40;

// Offene Schlüssel eines App-Auftrags (nur gültige, ohne Dubletten).
const requestKeys = (c) => [...new Set((c.research_request?.keys ?? []).map(String).filter((k) => KEY_RE.test(k)))];

function findCandidate(cands, { id, doc, symbol }) {
  if (id) return cands.find((c) => c.id === id) ?? null;
  if (!doc) return null;
  const linked = cands.find((c) => c.dossier?.doc_id === doc);
  if (linked) return linked;
  // Fallback: Doc noch an keinem Titel → eindeutiger Watch-Titel mit dem Symbol und ohne eigenes Doc.
  const sym = String(symbol ?? '').trim().toUpperCase();
  if (!sym || !DOC_RE.test(doc)) return null;
  const hits = cands.filter((c) => String(c.symbol ?? '').toUpperCase() === sym && !c.dossier?.doc_id);
  return hits.length === 1 ? hits[0] : null;
}

function researchSummary(c) {
  const r = c.research ?? {};
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v?.at ?? null]));
}

function varsFor(c) {
  const f = fairValue(c.tv_data ?? {}, c.ls_quote?.price != null ? { price: c.ls_quote.price } : {});
  return promptVars(c, {
    currency: c.currency || 'USD',
    fair: f?.error ? null : f.fair_price,
    impliedGrowth: f?.error ? null : f.base_growth,
  });
}

async function dispatchDossier(candidateId, mode = 'update') {
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return 'GH_DISPATCH_TOKEN fehlt';
  const repo = process.env.GH_REPO || 'streetspirit83/discovery';
  const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'discovery-research',
    },
    body: JSON.stringify({ event_type: 'dossier', client_payload: { candidate_id: candidateId, mode } }),
  }).catch((e) => ({ status: 0, text: async () => e.message }));
  if (res.status === 204) return null;
  return `GitHub dispatch HTTP ${res.status}`;
}

export default async (req) => {
  // 200 statt 204: bei 204 streicht Netlifys CDN die CORS-Header (siehe CLAUDE.md).
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: HEADERS });

  const token = process.env.RESEARCH_TOKEN, secret = process.env.DISCOVERY_SECRET;
  const okToken = !!token && req.headers.get('x-research-token') === token;
  const okSecret = !!secret && req.headers.get('x-discovery-secret') === secret;
  if (!okToken && !okSecret) return respond(401, { ok: false, error: 'Unauthorized' });

  const store = getStore({ name: 'discovery-data', consistency: 'strong' });

  // Prompt-Katalog: braucht den watch-Blob nicht.
  if (req.method === 'GET' && new URL(req.url).searchParams.get('catalog')) {
    const cat = await store.get(CATALOG_KEY, { type: 'json' }).catch(() => null);
    return respond(200, { ok: true, prompts: cat?.prompts ?? [], at: cat?.at ?? null });
  }

  const doc = await store.get('discovery-watch', { type: 'json' }).catch(() => null);
  if (!doc || !Array.isArray(doc.candidates)) return respond(500, { ok: false, error: 'watch-Blob nicht lesbar' });

  if (req.method === 'GET') {
    const u = new URL(req.url);
    const id = u.searchParams.get('id'), docId = u.searchParams.get('doc'), symbol = u.searchParams.get('symbol');
    if (u.searchParams.get('queue')) {
      const items = doc.candidates
        .filter((c) => requestKeys(c).length)
        .map((c) => ({ id: c.id, symbol: c.symbol, name: c.name ?? null, doc_id: c.dossier?.doc_id ?? null, keys: requestKeys(c), at: c.research_request?.at ?? null }));
      return respond(200, { ok: true, count: items.length, items });
    }
    if (!id && !docId) {
      const items = doc.candidates
        .filter((c) => c.dossier?.doc_id)
        .map((c) => ({ id: c.id, symbol: c.symbol, name: c.name ?? null, doc_id: c.dossier.doc_id, url: c.dossier.url ?? null, research: researchSummary(c) }));
      return respond(200, { ok: true, count: items.length, items });
    }
    const c = findCandidate(doc.candidates, { id, doc: docId, symbol });
    if (!c) return respond(404, { ok: false, error: 'Titel nicht im Watch-Bucket' });
    return respond(200, {
      ok: true,
      candidate: {
        id: c.id, symbol: c.symbol, name: c.name ?? null, exchange: c.exchange ?? null, isin: c.isin ?? null,
        currency: c.currency ?? null, doc_id: c.dossier?.doc_id ?? docId ?? null, url: c.dossier?.url ?? null,
        linked: !!c.dossier?.doc_id,
      },
      vars: varsFor(c),
      research: researchSummary(c),
    });
  }

  if (req.method !== 'POST') return respond(405, { ok: false, error: 'GET/POST only' });

  let body;
  try { body = await req.json(); } catch { return respond(400, { ok: false, error: 'Invalid JSON' }); }

  if (Array.isArray(body?.catalog)) {
    const prompts = body.catalog
      .map((p) => ({ key: String(p?.key ?? ''), label: String(p?.label ?? p?.key ?? '').slice(0, 80) }))
      .filter((p) => KEY_RE.test(p.key))
      .slice(0, MAX_CATALOG);
    if (!prompts.length) return respond(400, { ok: false, error: 'leerer Katalog' });
    await store.setJSON(CATALOG_KEY, { prompts, at: new Date().toISOString() });
    return respond(200, { ok: true, count: prompts.length });
  }

  const c = findCandidate(doc.candidates, { id: body?.id, doc: body?.doc, symbol: body?.symbol });
  if (!c) return respond(404, { ok: false, error: 'Titel nicht im Watch-Bucket' });

  const results = Array.isArray(body?.results) ? body.results : [];
  if (results.length > MAX_RESULTS) return respond(400, { ok: false, error: `max ${MAX_RESULTS} results` });
  const now = new Date().toISOString();
  const written = [];
  const research = { ...(c.research ?? {}) };
  for (const r of results) {
    const key = String(r?.key ?? '');
    const md = String(r?.md ?? '').trim();
    if (!KEY_RE.test(key) || !md) continue;
    research[key] = { label: String(r.label ?? key).slice(0, 80), md: md.slice(0, MAX_MD), at: now };
    written.push(key);
  }

  // Über den Symbol-Fallback gefunden → Doc jetzt fest verknüpfen.
  const relink = !c.dossier?.doc_id && !body?.id && DOC_RE.test(String(body?.doc ?? ''));
  if (relink) c.dossier = { ...(c.dossier ?? {}), doc_id: body.doc, url: `https://docs.google.com/document/d/${body.doc}/edit?usp=drivesdk` };
  // Gescheiterte Prompts eines App-Auftrags: austragen, Grund merken (sonst liefe er jede Runde neu).
  const failed = (Array.isArray(body?.failed) ? body.failed : [])
    .map((f) => ({ key: String(f?.key ?? ''), err: String(f?.err ?? 'fehlgeschlagen').slice(0, 200) }))
    .filter((f) => KEY_RE.test(f.key));
  // Kein Doc, aber Dossier gewünscht (die App setzt den Haken mit dem Auftrag) → Anlegen anstossen.
  const createDoc = !c.dossier?.doc_id && c.dossier_flag === true && written.length > 0;
  const rebuild = body?.rebuild === true && (!!c.dossier?.doc_id || createDoc);
  if (!written.length && !rebuild && !failed.length) return respond(400, { ok: false, error: 'keine gültigen Ergebnisse' });

  if (written.length) c.research = research;
  if (c.research_request) {
    const done = new Set([...written, ...failed.map((f) => f.key)]);
    const left = requestKeys(c).filter((k) => !done.has(k));
    if (left.length) c.research_request = { ...c.research_request, keys: left };
    else delete c.research_request;
  }
  if (failed.length) c.research_error = { items: failed, at: now };
  else if (written.length) delete c.research_error;
  if (rebuild || relink) c.dossier_flag = true;
  if (createDoc && rebuild) c.dossier = { ...(c.dossier ?? {}), status: 'queued', error: null, queued_at: now };
  if (rebuild && !createDoc) {
    c.dossier_update = true;
    c.dossier = { ...(c.dossier ?? {}), status: 'queued', error: null, queued_at: now };
  }
  c.last_updated_at = now;
  doc.updated_at = now;
  await store.setJSON('discovery-watch', doc);

  // Geht der Anstoss verloren, holt der tägliche Sweep der Action das Update nach.
  const dispatchError = rebuild ? await dispatchDossier(c.id, createDoc ? 'create' : 'update') : null;
  return respond(200, { ok: true, id: c.id, written, failed: failed.map((f) => f.key), rebuild, relinked: relink, dispatched: rebuild && !dispatchError, dispatch_error: dispatchError });
};
