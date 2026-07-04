/**
 * check-alerts.js — Scheduled: Discovery alert evaluation → ntfy.sh push.
 *
 * Primary quote source: Lang & Schwarz (EUR, the Trade-Republic venue), with a
 * Yahoo fallback. Indicator levels (RSI/EMA/MACD) come from each candidate's
 * stored tv_data (only as fresh as the last TV fetch). Alerts use the shared
 * status-logic engine — the same one merkliste's portfolio push uses.
 *
 * Scope: every candidate (inbox + watch + export) with >=1 enabled alert.
 * Global mute lives in the discovery-config blob (set from the Alert-Overview).
 *
 * Push format (lib/push-composer.js): kind-based title (⛔ STOP-LOSS / 🟢 BUY /
 * 🔭 WATCH), explicit trigger line, user note, portfolio Entry|Stück from the
 * public merkliste blob, ≤2 salience-picked setup sentences (LS-history
 * detectors + cluster/RSI/volume facts), ISIN line; action buttons 🔍 Discovery
 * (deep link to the detail sheet) + 📈 TV-Chart. One bundled push per ticker.
 *
 * Schedule: every 20 min, 11-20 UTC Mon-Fri (~13:00-22:40 CEST in summer; one
 * hour earlier in winter — Netlify cron is UTC, no DST).
 */

import { getStore } from '@netlify/blobs';
import { computeStatus, evaluateAlerts } from './lib/status-logic.js';
import { fetchLsPrice, fetchYahooPrice, fetchEurUsd } from './lib/ls-quote.js';
import { sendNtfy } from './lib/notify.js';
import { composePush } from './lib/push-composer.js';
import { computePriceClusters } from './lib/price-cluster.js';

const NTFY_TOPIC = process.env.DISC_NTFY_TOPIC || 'disc-alerts-q4w8r2v';
const SOURCE_BLOBS = ['discovery-inbox', 'discovery-watch', 'discovery-export'];
const CONFIG_KEY  = 'discovery-config';
const STATE_KEY   = 'discovery-alert-state';
const TRIG_KEY    = 'discovery-alert-trig';
const HISTORY_KEY = 'discovery-ls-history';

const MERKLISTE_BLOB_URL = 'https://merkliste-app.netlify.app/.netlify/functions/blob';

/* Merkliste portfolio (public GET, no CORS server-side): symbol → entry/shares.
   Same alias indexing as ui/lib/merkliste-import.js (match by symbol only). */
async function fetchMerklisteMap() {
  try {
    const res = await fetch(MERKLISTE_BLOB_URL);
    if (!res.ok) return null;
    const data = await res.json();
    const up = (v) => String(v ?? '').trim().toUpperCase();
    const bySym = new Map();
    for (const t of data?.tickers ?? []) {
      const entry = t?.user?.entry_price_manual;
      if (entry == null) continue;
      const shares = t?.user?.entry_shares ?? null;
      const s = t?.stamm ?? {};
      for (const alias of [s.symbol, s.yahoo_symbol, s.twelvedata_symbol]) {
        const key = up(alias);
        if (key) bySym.set(key, { entry, shares });
      }
    }
    return bySym;
  } catch (e) {
    console.warn(`[disc-alerts] merkliste blob nicht erreichbar: ${e.message}`);
    return null;
  }
}

function portfolioFor(c, bySym) {
  if (!bySym) return null;
  const up = (v) => String(v ?? '').trim().toUpperCase();
  for (const alias of [c.symbol, c.yahoo_symbol, c.merkliste_symbol]) {
    const key = up(alias);
    if (key && bySym.has(key)) return bySym.get(key);
  }
  return null;
}

const enabled = (a) => a && a.enabled !== false;

export default async () => {
  const startedAt = new Date().toISOString();
  console.log(`[disc-alerts] Start ${startedAt}`);
  const store = getStore({ name: 'discovery-data', consistency: 'strong' });

  // Global mute?
  const config = await store.get(CONFIG_KEY, { type: 'json' }).catch(() => null);
  const muted = config?.alerts_muted === true;

  // Collect candidates with >=1 enabled alert (dedup by id across blobs).
  const byId = new Map();
  for (const key of SOURCE_BLOBS) {
    const blob = await store.get(key, { type: 'json' }).catch(() => null);
    for (const c of blob?.candidates ?? []) {
      if (Array.isArray(c.alerts) && c.alerts.some(enabled) && !byId.has(c.id)) byId.set(c.id, c);
    }
  }
  const candidates = [...byId.values()];
  console.log(`[disc-alerts] ${candidates.length} Kandidaten mit aktiven Alerts · muted=${muted}`);
  if (!candidates.length) return new Response('no alerts', { status: 200 });

  const [prevStateDoc, prevTrigDoc, histDoc, mkBySym] = await Promise.all([
    store.get(STATE_KEY,   { type: 'json' }).catch(() => null),
    store.get(TRIG_KEY,    { type: 'json' }).catch(() => null),
    store.get(HISTORY_KEY, { type: 'json' }).catch(() => null),
    fetchMerklisteMap(),
  ]);
  const prevState = prevStateDoc?.state ?? {};
  const prevTrig  = prevTrigDoc?.triggered ?? {};
  const lsHistory = histDoc?.history ?? {};

  const eurUsd = await fetchEurUsd();
  const toEur = (v, ccy) => (String(ccy).toUpperCase() === 'USD' && eurUsd && v != null) ? +(v / eurUsd).toFixed(4) : v;

  const newState = { ...prevState };
  const newTrig  = {};
  let pushCount = 0;

  for (const c of candidates) {
    const ccy = c.currency;
    // Primary LS (EUR); fallback Yahoo (native → EUR).
    let price = null;
    const ls = await fetchLsPrice(c).catch(() => null);
    if (ls?.price != null) {
      price = ls.price;
    } else if (c.yahoo_symbol || c.symbol) {
      const y = await fetchYahooPrice(c.yahoo_symbol || c.symbol).catch(() => null);
      price = toEur(y, ccy);
    }

    const tv = c.tv_data ?? {};
    // Dynamic cluster levels for cross_below_sup / cross_above_res: compute the
    // clusters in native currency (LS/EUR levels → native via lsToNative), then
    // convert the nearest zone midpoints to EUR to compare with the EUR price.
    const ccyU = String(ccy).toUpperCase();
    const lsToNative = ccyU === 'EUR' ? 1 : ccyU === 'USD' ? (eurUsd ?? null) : null;
    const nativeClose = tv.close_1m ?? tv.close;
    const pc = nativeClose != null
      ? computePriceClusters(tv, { lsHistory: lsHistory[c.id]?.snapshots ?? null, refPrice: nativeClose, lsToNative })
      : null;
    const q = {
      price,
      rsi: tv.rsi ?? null,
      ma20:  toEur(tv.ema20, ccy),
      ma50:  toEur(tv.ema50, ccy),
      ma200: toEur(tv.ema200, ccy),
      macd_histogram: (tv.macd != null && tv.macd_signal != null) ? toEur(tv.macd - tv.macd_signal, ccy) : null,
      volume: tv.average_volume ?? null,
      avg_volume: tv.avg_vol_10d ?? tv.average_volume ?? null,
      sup: pc?.nearestSup ? toEur(pc.nearestSup.mid, ccy) : null,
      res: pc?.nearestRes ? toEur(pc.nearestRes.mid, ccy) : null,
    };

    const activeAlerts = c.alerts.filter(enabled);
    const { alerts: evaled } = evaluateAlerts(activeAlerts, q);
    const triggered = evaled.filter((a) => a._trig);
    const status = computeStatus({ alerts: activeAlerts }, q);

    const prevKey     = prevState[c.id] ?? 'halten';
    const prevTrigSet = new Set(prevTrig[c.id] ?? []);
    const newlyTriggered = triggered.filter((a) => !prevTrigSet.has(a.id));

    newState[c.id] = status.key;
    newTrig[c.id]  = triggered.map((a) => a.id);

    const statusChanged = prevKey !== status.key && status.key !== 'halten';
    const hasNewTrigger = newlyTriggered.length > 0;

    console.log(`[eval] ${c.symbol}: px=${price != null ? price.toFixed(2) : '—'} → ${status.key} (prev ${prevKey}) new=${newlyTriggered.map((a) => a.type).join(',') || '—'}`);

    if (muted || (!statusChanged && !hasNewTrigger)) continue;

    const shown = statusChanged ? triggered : newlyTriggered;
    if (!shown.length) continue;
    const push = composePush({
      c,
      shown,
      q,
      snapshots: lsHistory[c.id]?.snapshots ?? null,
      portfolio: portfolioFor(c, mkBySym),
      lsToNative, // reused from the cluster computation above
    });
    console.log(`[ALERT] ${push.title}\n${push.message}`);
    await sendNtfy(NTFY_TOPIC, push);
    pushCount++;
  }

  const now = Date.now();
  await Promise.allSettled([
    store.setJSON(STATE_KEY, { state: newState, updatedAt: now }),
    store.setJSON(TRIG_KEY,  { triggered: newTrig, updatedAt: now }),
  ]);
  console.log(`[disc-alerts] Fertig: ${pushCount} Push(es)${muted ? ' (muted)' : ''}`);
  return new Response(JSON.stringify({ pushes: pushCount, candidates: candidates.length, muted }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};

export const config = {
  schedule: '*/20 11-20 * * 1-5',
};
