/**
 * snapshot-ls.js — Scheduled: nightly LS intraday snapshot for the watchlist.
 *
 * Each evening (after the LS session) captures the full intraday shape for every
 * candidate on the watchlist (discovery-watch) and appends it to a rolling
 * 10-day history per ticker in the discovery-ls-history blob.
 *
 * History shape:
 *   { updated_at, history: { [candidateId]: {
 *       symbol, name,
 *       snapshots: [ { date:'YYYY-MM-DD', close, prev_close, change_pct,
 *                      day_low, day_high, series:[…], ts }, … up to 10 ] } } }
 *
 * Schedule: 21:30 UTC Mon-Fri (~23:30 CEST, just after LS close; one hour
 * earlier in winter — Netlify cron is UTC, no DST).
 */

import { getStore } from '@netlify/blobs';
import { fetchLsSnapshot } from './lib/ls-quote.js';

const WATCH_BLOB  = 'discovery-watch';
const HISTORY_KEY = 'discovery-ls-history';
const MAX_DAYS    = 10;

export default async () => {
  console.log(`[snapshot-ls] Start ${new Date().toISOString()}`);
  const store = getStore({ name: 'discovery-data', consistency: 'strong' });

  const watch = await store.get(WATCH_BLOB, { type: 'json' }).catch(() => null);
  const candidates = watch?.candidates ?? [];
  if (!candidates.length) {
    console.log('[snapshot-ls] Watchlist leer');
    return new Response('no watch candidates', { status: 200 });
  }

  const histDoc = await store.get(HISTORY_KEY, { type: 'json' }).catch(() => null);
  const history = histDoc?.history ?? {};
  const today = new Date().toISOString().slice(0, 10);

  const liveIds = new Set();
  let captured = 0;

  for (const c of candidates) {
    liveIds.add(c.id);
    const snap = await fetchLsSnapshot(c).catch(() => null);
    if (!snap || snap.close == null) { console.log(`[snapshot-ls] ${c.symbol}: keine LS-Daten`); continue; }

    const entry = history[c.id] ?? { symbol: c.symbol, name: c.name ?? null, snapshots: [] };
    entry.symbol = c.symbol;
    entry.name = c.name ?? entry.name ?? null;
    // Replace today's entry if the job re-runs, then keep the last 10 days.
    entry.snapshots = entry.snapshots.filter((s) => s.date !== today);
    entry.snapshots.push({ date: today, ...snap });
    entry.snapshots = entry.snapshots.slice(-MAX_DAYS);
    history[c.id] = entry;
    captured++;
  }

  // Drop history for tickers no longer on the watchlist (keeps the blob bounded).
  for (const id of Object.keys(history)) if (!liveIds.has(id)) delete history[id];

  await store.setJSON(HISTORY_KEY, { history, updated_at: new Date().toISOString() });
  console.log(`[snapshot-ls] Fertig: ${captured}/${candidates.length} erfasst`);
  return new Response(JSON.stringify({ captured, tickers: candidates.length }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};

export const config = {
  schedule: '30 21 * * 1-5',
};
