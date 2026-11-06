/**
 * Netlify Function: dossier-trigger
 * POST /api/dossier-trigger  { candidate_id, mode: 'create' | 'update' }
 *                            { mode: 'sweep' } → alle offenen Aufträge sofort
 *
 * Löst die GitHub Action `dossier.yml` per repository_dispatch aus. Die UI hat
 * vorher schon dossier_flag / dossier_update und dossier.status = 'queued' am
 * Kandidaten gesetzt; diese Function schreibt nichts in die Blobs, sie reicht
 * den Auftrag nur weiter. Geht der Dispatch verloren, holt der tägliche
 * Sweep-Lauf der Action alle offenen Aufträge nach.
 *
 * Env: DISCOVERY_SECRET, GH_DISPATCH_TOKEN (fine-grained PAT, nur dieses Repo,
 *      Contents: read & write), optional GH_REPO (default streetspirit83/discovery)
 */

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-discovery-secret',
};

const respond = (status, body) => new Response(JSON.stringify(body), { status, headers: CORS });

export default async (req) => {
  // 200 mit null-Body statt 204: Netlifys CDN streicht bei 204 + Body die CORS-Header.
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS });
  if (req.method !== 'POST') return respond(405, { ok: false, error: 'POST only' });

  if (req.headers.get('x-discovery-secret') !== process.env.DISCOVERY_SECRET) {
    return respond(401, { ok: false, error: 'Unauthorized' });
  }

  let body;
  try { body = await req.json(); } catch { return respond(400, { ok: false, error: 'Invalid JSON body' }); }

  const candidateId = String(body?.candidate_id ?? '').trim();
  const sweep = body?.mode === 'sweep';
  const mode = body?.mode === 'update' ? 'update' : 'create';
  if (!candidateId && !sweep) return respond(400, { ok: false, error: 'Missing candidate_id' });

  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return respond(500, { ok: false, error: 'GH_DISPATCH_TOKEN fehlt in den Netlify-Umgebungsvariablen' });
  const repo = process.env.GH_REPO || 'streetspirit83/discovery';

  const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'discovery-dossier-trigger',
    },
    body: JSON.stringify({ event_type: 'dossier', client_payload: { candidate_id: sweep ? '' : candidateId, mode } }),
  });

  if (res.status !== 204) {
    const text = await res.text().catch(() => '');
    return respond(502, { ok: false, error: `GitHub dispatch HTTP ${res.status}`, detail: text.slice(0, 300) });
  }
  return respond(200, { ok: true, candidate_id: sweep ? null : candidateId, mode: sweep ? 'sweep' : mode });
};
