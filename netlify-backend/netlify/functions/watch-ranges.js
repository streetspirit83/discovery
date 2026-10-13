/**
 * Netlify Function: watch-ranges
 * GET /api/watch-ranges — read-only range view for the watch bucket.
 *
 * Per candidate: nearest support / resistance confluence zone (same
 * computePriceClusters as the UI and check-alerts) around the TV close,
 * with an optional manual override from candidate.range_override
 * ({ sup, res } in native currency, null = auto).
 *
 * No secret required: returns only derived price levels plus ISIN / LS
 * instrument id (for live quotes), no notes, alerts or portfolio data. All prices in the ticker's native currency.
 */

import { getStore } from '@netlify/blobs';
import { computePriceClusters } from './lib/price-cluster.js';
import { fetchEurUsd } from './lib/ls-quote.js';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=300',
};

const num = (v) => (v != null && Number.isFinite(+v) && +v > 0 ? +v : null);
const r4 = (v) => (v == null ? null : +(+v).toFixed(4));
const zone = (z) => (z ? { lo: r4(z.lo), hi: r4(z.hi), mid: r4(z.mid), score: z.score, labels: z.members.map((m) => m.label) } : null);

export default async (req) => {
  // 200 statt 204: bei 204 streicht Netlifys CDN die CORS-Header (siehe CLAUDE.md).
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: HEADERS });

  const store = getStore({ name: 'discovery-data', consistency: 'strong' });
  const [watch, hist] = await Promise.all([
    store.get('discovery-watch', { type: 'json' }).catch(() => null),
    store.get('discovery-ls-history', { type: 'json' }).catch(() => null),
  ]);
  const lsHistory = hist?.history ?? {};
  const eurUsd = await fetchEurUsd().catch(() => null);

  const items = (watch?.candidates ?? []).map((c) => {
    const tv = c.tv_data ?? {};
    const ccy = String(c.currency ?? '').toUpperCase();
    const price = num(tv.close_1m ?? tv.close);
    const lsToNative = ccy === 'EUR' ? 1 : ccy === 'USD' ? eurUsd : null;
    const pc = price
      ? computePriceClusters(tv, { lsHistory: lsHistory[c.id]?.snapshots ?? null, refPrice: price, lsToNative })
      : null;

    // Auto levels: nearest cluster zone; fallback 52W extremes when no zone on that side.
    const autoSup = pc?.nearestSup ? r4(pc.nearestSup.mid) : r4(num(tv.price_52_week_low));
    const autoRes = pc?.nearestRes ? r4(pc.nearestRes.mid) : r4(num(tv.price_52_week_high));
    const ov = c.range_override ?? {};
    const sup = num(ov.sup) ?? autoSup;
    const res = num(ov.res) ?? autoRes;

    return {
      id: c.id,
      symbol: c.symbol,
      name: c.name ?? null,
      isin: c.isin ?? null,
      ls_id: c.tr_check?.ls_id ?? c.ls_quote?.instrument_id ?? null,
      currency: ccy || null,
      price: r4(price),
      sup,
      res,
      sup_src: num(ov.sup) ? 'manual' : pc?.nearestSup ? 'cluster' : autoSup ? '52w' : null,
      res_src: num(ov.res) ? 'manual' : pc?.nearestRes ? 'cluster' : autoRes ? '52w' : null,
      auto: { sup: autoSup, res: autoRes },
      sup_zone: zone(pc?.nearestSup),
      res_zone: zone(pc?.nearestRes),
      clusters: (pc?.clusters ?? []).map((z) => ({ mid: r4(z.mid), score: z.score, side: z.side })),
      tv_at: tv.refreshed_at ?? null,
    };
  });

  return new Response(JSON.stringify({ updated_at: watch?.updated_at ?? null, count: items.length, items }), {
    status: 200,
    headers: HEADERS,
  });
};
