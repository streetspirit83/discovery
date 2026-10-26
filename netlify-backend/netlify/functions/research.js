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
 * Env: RESEARCH_TOKEN, GH_DISPATCH_TOKEN, optional GH_REPO
 */

import { getStore } from '@netlify/blobs';
import { promptVars } from '../../../ui/lib/research-prompt.js';
import { fairValue } from '../../../ui/lib/tv-reverse-dcf.js';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-research-token',
};
const KEY_RE = /^[a-z0-9_-]{1,40}$/;
const MAX_MD = 40000;
const MAX_RESULTS = 10;

const respond = (status, body) => new Response(JSON.stringify(body), { status, headers: HEADERS });

const DOC_RE = /^[A-Za-z0-9_-]{10,100}$/;

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

async function dispatchDossier(candidateId) {
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
    body: JSON.stringify({ event_type: 'dossier', client_payload: { candidate_id: candidateId, mode: 'update' } }),
  }).catch((e) => ({ status: 0, text: async () => e.message }));
  if (res.status === 204) return null;
  return `GitHub dispatch HTTP ${res.status}`;
}

export default async (req) => {
  // 200 statt 204: bei 204 streicht Netlifys CDN die CORS-Header (siehe CLAUDE.md).
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: HEADERS });

  const token = process.env.RESEARCH_TOKEN;
  if (!token || req.headers.get('x-research-token') !== token) return respond(401, { ok: false, error: 'Unauthorized' });

  const store = getStore({ name: 'discovery-data', consistency: 'strong' });
  const doc = await store.get('discovery-watch', { type: 'json' }).catch(() => null);
  if (!doc || !Array.isArray(doc.candidates)) return respond(500, { ok: false, error: 'watch-Blob nicht lesbar' });

  if (req.method === 'GET') {
    const u = new URL(req.url);
    const id = u.searchParams.get('id'), docId = u.searchParams.get('doc'), symbol = u.searchParams.get('symbol');
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
  const rebuild = body?.rebuild === true && !!c.dossier?.doc_id;
  if (!written.length && !rebuild) return respond(400, { ok: false, error: 'keine gültigen Ergebnisse' });

  if (written.length) c.research = research;
  if (rebuild || relink) c.dossier_flag = true;
  if (rebuild) {
    c.dossier_update = true;
    c.dossier = { ...(c.dossier ?? {}), status: 'queued', error: null, queued_at: now };
  }
  c.last_updated_at = now;
  doc.updated_at = now;
  await store.setJSON('discovery-watch', doc);

  // Geht der Anstoss verloren, holt der tägliche Sweep der Action das Update nach.
  const dispatchError = rebuild ? await dispatchDossier(c.id) : null;
  return respond(200, { ok: true, id: c.id, written, rebuild, relinked: relink, dispatched: rebuild && !dispatchError, dispatch_error: dispatchError });
};
