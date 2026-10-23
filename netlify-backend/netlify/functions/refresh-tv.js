/**
 * refresh-tv.js — Scheduled: refresh TV indicators for alert-bearing candidates.
 *
 * Keeps RSI/EMA/MACD (and close) current for the indicator alerts, since LS only
 * delivers price. Runs once a day before the alert window so the day's first
 * evaluations use fresh indicators. Updates each candidate's tv_data in place
 * and writes the blob back.
 *
 * Schedule: 10:30 UTC Mon-Fri (~12:30 CEST), ahead of check-alerts (11:00 UTC).
 */

import { getStore } from '@netlify/blobs';
import { fetchTvIndicators } from './lib/tv-scan.js';

const SOURCE_BLOBS = ['discovery-inbox', 'discovery-watch', 'discovery-export'];
const enabled = (a) => a && a.enabled !== false;

export default async () => {
  console.log(`[refresh-tv] Start ${new Date().toISOString()}`);
  const store = getStore({ name: 'discovery-data', consistency: 'strong' });
  const nowIso = new Date().toISOString();
  let totalUpdated = 0;

  for (const key of SOURCE_BLOBS) {
    const blob = await store.get(key, { type: 'json' }).catch(() => null);
    const candidates = blob?.candidates ?? [];
    const targets = candidates.filter((c) => Array.isArray(c.alerts) && c.alerts.some(enabled));
    if (!targets.length) { console.log(`[refresh-tv] ${key}: keine Alert-Kandidaten`); continue; }

    let indicators;
    try {
      indicators = await fetchTvIndicators(targets);
    } catch (err) {
      console.warn(`[refresh-tv] ${key}: TV-Fetch fehlgeschlagen:`, err.message);
      continue;
    }

    let updated = 0;
    for (const c of targets) {
      const ind = indicators.get(c.id);
      if (!ind || ind.close == null) continue;
      c.tv_data = { ...(c.tv_data || {}), ...ind, refreshed_at: nowIso };
      updated++;
    }
    if (updated) {
      await store.setJSON(key, blob);
      totalUpdated += updated;
    }
    console.log(`[refresh-tv] ${key}: ${updated}/${targets.length} aktualisiert`);
  }

  console.log(`[refresh-tv] Fertig: ${totalUpdated} Kandidaten`);
  return new Response(JSON.stringify({ updated: totalUpdated }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};

export const config = {
  schedule: '30 10 * * 1-5',
};
