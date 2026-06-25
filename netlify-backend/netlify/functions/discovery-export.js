/**
 * Netlify Function: discovery-export
 * GET /.netlify/functions/discovery-export
 *
 * Public (no auth) endpoint that serves the promoted "watch" list as JSON.
 * Promote (watchlist) moves a candidate into the `discovery-watch` blob, and
 * merkliste enriches its matching tickers from that list — so this bridge
 * serves `discovery-watch` (not the separate `discovery-export` briefcase blob).
 * Consumed by the merkliste proxy (server-side fetch, no CORS required).
 */

import { getStore } from '@netlify/blobs';

export default async function handler(req) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const store = getStore({ name: 'discovery-data', consistency: 'strong' });
  const data = await store.get('discovery-watch', { type: 'json' });

  const body = data ?? { candidates: [] };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
