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
 * Schedule: every 20 min, 11-20 UTC Mon-Fri (~13:00-22:40 CEST in summer; one
 * hour earlier in winter — Netlify cron is UTC, no DST).
 */

import { getStore } from '@netlify/blobs';
import { computeStatus, evaluateAlerts, STATUS_MAP } from './lib/status-logic.js';
import { fetchLsPrice, fetchYahooPrice, fetchEurUsd } from './lib/ls-quote.js';
import { sendNtfy } from './lib/notify.js';

const NTFY_TOPIC = process.env.DISC_NTFY_TOPIC || 'disc-alerts-q4w8r2v';
const SOURCE_BLOBS = ['discovery-inbox', 'discovery-watch', 'discovery-export'];
const CONFIG_KEY = 'discovery-config';
const STATE_KEY  = 'discovery-alert-state';
const TRIG_KEY   = 'discovery-alert-trig';

const fmtEur = (v) => (v == null ? '—' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');

function alertSummary(a) {
  switch (a.type) {
    case 'price_above': return `Kurs ≥ ${fmtEur(a.threshold)}${a.label ? ` · ${a.label}` : ''}`;
    case 'price_below': return `Kurs ≤ ${fmtEur(a.threshold)}${a.label ? ` · ${a.label}` : ''}`;
    case 'ma20_below':  return 'Kurs ≤ EMA20';
    case 'ma50_below':  return 'Kurs ≤ EMA50';
    case 'ma200_below': return 'Kurs ≤ EMA200';
    case 'rsi_above':   return `RSI ≥ ${a.threshold}`;
    case 'rsi_below':   return `RSI ≤ ${a.threshold}`;
    case 'macd_bullish':return 'MACD bullish';
    case 'macd_bearish':return 'MACD bearish';
    default:            return a.label || a.type;
  }
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

  const [prevStateDoc, prevTrigDoc] = await Promise.all([
    store.get(STATE_KEY, { type: 'json' }).catch(() => null),
    store.get(TRIG_KEY,  { type: 'json' }).catch(() => null),
  ]);
  const prevState = prevStateDoc?.state ?? {};
  const prevTrig  = prevTrigDoc?.triggered ?? {};

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
    const q = {
      price,
      rsi: tv.rsi ?? null,
      ma20:  toEur(tv.ema20, ccy),
      ma50:  toEur(tv.ema50, ccy),
      ma200: toEur(tv.ema200, ccy),
      macd_histogram: (tv.macd != null && tv.macd_signal != null) ? toEur(tv.macd - tv.macd_signal, ccy) : null,
      volume: tv.average_volume ?? null,
      avg_volume: tv.avg_vol_10d ?? tv.average_volume ?? null,
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

    const info  = STATUS_MAP[status.key] || STATUS_MAP.halten;
    const shown = statusChanged ? triggered : newlyTriggered;
    const title = `${info.emoji} ${c.symbol}: ${info.label}`;
    const lines = [
      shown.map(alertSummary).join(' · '),
      c.name || '',
      price != null ? `Kurs ${fmtEur(price)}${ls?.source === 'ls' ? ' (LS)' : ' (Yahoo)'}` : 'Kein Kurs',
    ].filter(Boolean);
    console.log(`[ALERT] ${title}\n${lines.join('\n')}`);
    await sendNtfy(NTFY_TOPIC, { title, message: lines.join('\n'), pushColor: info.pushColor });
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
