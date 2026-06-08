/**
 * Netlify Function: altindex-toplist
 * GET /api/altindex-toplist[?key=<slug>] – returns the most recently ingested
 * AltIndex toplist JSON from Netlify Blobs. `key` selects the dataset (e.g.
 * "reddit-mentions"); defaults to the main "toplist".
 */

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'altindex';
const DEFAULT_KEY = 'toplist';
const SLUG_RE = /^[a-z0-9-]+$/;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
  // CORS preflight – return 200 + null body (204 with body is invalid HTTP)
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  const requestedKey = new URL(req.url).searchParams.get('key');
  const slug = requestedKey && SLUG_RE.test(requestedKey) ? requestedKey : DEFAULT_KEY;

  const store = getStore(STORE_NAME);
  const data = await store.get(`${slug}.json`, { type: 'json' });

  if (!data) {
    return new Response(JSON.stringify({ ok: false, error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export const config = {
  path: '/api/altindex-toplist',
};
