/**
 * Netlify Function: altindex-ingest
 * POST /api/altindex-ingest – receives AltIndex toplist JSON payloads from the
 * scrape-toplist GitHub Action and persists each to its own Netlify Blob key,
 * derived from the payload's `source` URL (e.g.
 * https://altindex.com/toplist/reddit-mentions -> "reddit-mentions.json",
 * https://altindex.com/toplist -> "toplist.json").
 *
 * Requires header x-deploy-secret matching env ALTINDEX_INGEST_SECRET.
 */

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'altindex';
const DEFAULT_BLOB_KEY = 'toplist';
const SLUG_RE = /^[a-z0-9-]+$/;

function blobKeyFromSource(source) {
  if (typeof source !== 'string') return `${DEFAULT_BLOB_KEY}.json`;
  let pathname;
  try {
    pathname = new URL(source).pathname;
  } catch {
    return `${DEFAULT_BLOB_KEY}.json`;
  }
  const slug = pathname.replace(/^\/toplist\/?/, '').replace(/\/$/, '') || DEFAULT_BLOB_KEY;
  return SLUG_RE.test(slug) ? `${slug}.json` : `${DEFAULT_BLOB_KEY}.json`;
}

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

  const blobKey = blobKeyFromSource(body && body.source);
  const store = getStore(STORE_NAME);
  await store.setJSON(blobKey, body);

  return respond(200, { ok: true, key: blobKey });
}

export const config = {
  path: '/api/altindex-ingest',
};
