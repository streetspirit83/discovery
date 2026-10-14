/**
 * Netlify Function: watch-alarms
 * POST /api/watch-alarms — Range-Alarme aus dem Artefakt "Watch Ranges".
 *
 * Schmaler Schreibzugang mit eigenem Schlüssel (Header x-wr-alarm-token =
 * env WR_ALARM_TOKEN), damit die Abgleich-Aufgabe nicht den Hauptschlüssel
 * DISCOVERY_SECRET braucht. Kann ausschließlich:
 *   - an Kandidaten im watch-Blob
 *   - Alarme mit id wr_sup_<id> / wr_res_<id> (price_below / price_above, EUR)
 * setzen oder entfernen. Alle anderen Felder und Alarme bleiben unberührt.
 *
 * Body: { alarms: [{ id, sup, res }] } — der vollständige Soll-Zustand. Titel,
 * die nicht in der Liste stehen, verlieren ihre wr_-Alarme. sup/res = null:
 * für diese Seite keinen Alarm (z. B. Level schon überschritten).
 */

import { getStore } from '@netlify/blobs';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-wr-alarm-token',
};
const MAX_ALARMS = 200;

const respond = (status, body) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const num = (v) => (v != null && Number.isFinite(+v) && +v > 0 ? +(+v).toFixed(4) : null);
const isMine = (a) => String(a?.id ?? '').startsWith('wr_');

function fmt(v) {
  return v.toLocaleString('de-DE', { minimumFractionDigits: v >= 1000 ? 0 : 2, maximumFractionDigits: v >= 1000 ? 0 : 2 });
}

function makeAlert(cid, side, level, prev, now) {
  const sup = side === 'sup';
  const same = prev && Math.abs((prev.threshold ?? 0) - level) < 1e-6;
  return {
    id: `wr_${side}_${cid}`,
    kind: 'watch',
    type: sup ? 'price_below' : 'price_above',
    threshold: level,
    dir: 'watch',
    enabled: true,
    label: `${sup ? 'Support' : 'Resistance'} ${fmt(level)} €`,
    note: 'Watch Ranges',
    basis: { kind: 'level', source: 'Watch Ranges' },
    created_at: same && prev.created_at ? prev.created_at : now,
  };
}

export default async (req) => {
  // 200 statt 204: bei 204 streicht Netlifys CDN die CORS-Header (siehe CLAUDE.md).
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: HEADERS });
  if (req.method !== 'POST') return respond(405, { ok: false, error: 'POST only' });

  const token = process.env.WR_ALARM_TOKEN;
  if (!token || req.headers.get('x-wr-alarm-token') !== token) return respond(401, { ok: false, error: 'Unauthorized' });

  let body;
  try { body = await req.json(); } catch { return respond(400, { ok: false, error: 'Invalid JSON' }); }
  if (!Array.isArray(body?.alarms) || body.alarms.length > MAX_ALARMS) {
    return respond(400, { ok: false, error: `alarms must be an array (max ${MAX_ALARMS})` });
  }

  const want = new Map();
  for (const a of body.alarms) {
    if (!a || typeof a.id !== 'string' || !a.id) continue;
    let sup = num(a.sup), res = num(a.res);
    if (sup != null && res != null && sup >= res) { sup = null; res = null; }
    want.set(a.id, { sup, res });
  }

  const store = getStore({ name: 'discovery-data', consistency: 'strong' });
  const doc = await store.get('discovery-watch', { type: 'json' }).catch(() => null);
  if (!doc || !Array.isArray(doc.candidates)) return respond(500, { ok: false, error: 'watch-Blob nicht lesbar' });

  const now = new Date().toISOString();
  const armed = {};
  let changed = 0;
  const known = new Set();

  for (const c of doc.candidates) {
    known.add(c.id);
    const old = Array.isArray(c.alerts) ? c.alerts : [];
    const prev = (side) => old.find((a) => a?.id === `wr_${side}_${c.id}`);
    const w = want.get(c.id);
    const mine = [];
    if (w?.sup != null) mine.push(makeAlert(c.id, 'sup', w.sup, prev('sup'), now));
    if (w?.res != null) mine.push(makeAlert(c.id, 'res', w.res, prev('res'), now));
    if (w) armed[c.id] = { sup: w.sup, res: w.res };

    const key = (list) => JSON.stringify(list.filter(isMine).map((a) => [a.id, a.threshold]).sort());
    if (key(old) !== key(mine)) {
      c.alerts = [...old.filter((a) => !isMine(a)), ...mine];
      c.last_updated_at = now;
      changed++;
    }
  }

  if (changed) {
    doc.updated_at = now;
    await store.setJSON('discovery-watch', doc);
  }
  const missing = [...want.keys()].filter((id) => !known.has(id));
  return respond(200, { ok: true, changed, armed, missing });
};
