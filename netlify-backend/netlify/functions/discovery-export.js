/**
 * Netlify Function: discovery-export
 * GET /.netlify/functions/discovery-export
 * GET /.netlify/functions/discovery-export?scope=live
 *
 * Public (no auth) endpoint serving candidate JSON to merkliste. Two scopes,
 * because merkliste has two distinct connections to discovery:
 *
 *  • default (no scope) → the `discovery-export` bucket only. This feeds the
 *    manual "Discovery importieren" button: only the Export briefcase (↗)
 *    adds NEW tickers to merkliste (Promote/Watch stays discovery-internal).
 *
 *  • ?scope=live → the UNION of inbox+watch+export (deduped by symbol+exchange,
 *    the entry with live data preferred). This feeds merkliste's onload quote
 *    refresh, which is update-only: it re-prices tickers you already track,
 *    whatever discovery bucket they currently sit in. Archive is excluded
 *    (dismissed) as are candidates without tv_data/ls_quote (nothing to price).
 *
 * Consumed by the merkliste proxy (server-side fetch, no CORS required).
 */

import { getStore } from '@netlify/blobs';

// Union order = dedup tie-break priority: an entry from an earlier bucket wins,
// and any entry WITH live data beats one without.
const LIVE_BLOBS = ['discovery-export', 'discovery-watch', 'discovery-inbox'];

const hasLive = (c) => !!(c && (c.tv_data || c.ls_quote));
const dedupKey = (c) => `${String(c?.symbol ?? '').toUpperCase()}:${String(c?.exchange ?? '').toUpperCase()}`;

async function liveUnion(store) {
  const seen = new Map();
  for (const key of LIVE_BLOBS) {
    const blob = await store.get(key, { type: 'json' }).catch(() => null);
    for (const c of blob?.candidates ?? []) {
      if (!hasLive(c)) continue; // nothing to price → not useful for the refresh
      const k = dedupKey(c);
      if (!seen.has(k)) seen.set(k, c); // earlier bucket wins (export → watch → inbox)
    }
  }
  return [...seen.values()];
}

export default async function handler(req) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const scope = new URL(req.url).searchParams.get('scope');
  const store = getStore({ name: 'discovery-data', consistency: 'strong' });

  let body;
  if (scope === 'live') {
    body = { candidates: await liveUnion(store) };
  } else {
    body = (await store.get('discovery-export', { type: 'json' })) ?? { candidates: [] };
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
