/**
 * Netlify Function: altindex-ingest
 * POST /api/altindex-ingest – receives the AltIndex toplist JSON from the
 * scrape-toplist GitHub Action and persists it to Netlify Blobs.
 *
 * Requires header x-deploy-secret matching env ALTINDEX_INGEST_SECRET.
 */

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'altindex';
const BLOB_KEY = 'toplist.json';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-deploy-secret',
};

function respond(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

export default async function handler(req) {
  // CORS preflight – return 200 + null body (204 with body is invalid HTTP)
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return respond(405, { ok: false, error: 'Method not allowed' });
  }

  const secret = req.headers.get('x-deploy-secret');
  if (!secret || secret !== process.env.ALTINDEX_INGEST_SECRET) {
    return respond(401, { ok: false, error: 'Unauthorized' });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return respond(400, { ok: false, error: 'Invalid JSON body' });
  }

  const store = getStore(STORE_NAME);
  await store.setJSON(BLOB_KEY, body);

  return respond(200, { ok: true });
}

export const config = {
  path: '/api/altindex-ingest',
};
