/**
 * TradingView Screener adapter – führt alle Screener-Studio-Presets mit Auto-Schalter aus.
 *
 * Seit Nov. 2026 gibt es hier keine fest eingebauten Screens mehr: Die Presets liegen im
 * Config-Blob (`read_config`, dieselbe Quelle wie das Screener Studio), eingebaute Screens
 * kommen aus `ui/lib/screener-presets.js` (DEFAULT_PRESETS). Ein Preset läuft mit, wenn
 * `isAutoPreset` gilt (Vorgabe `auto`, im Studio per Schalter `auto_override` änderbar).
 * Abfrage und Nachfilter teilen sich Studio und Adapter (`ui/lib/screen-runner.js`), die
 * Treffer sind also genau die der Studio-Vorschau.
 *
 * Scanner-Aufrufe laufen über die Netlify scrape-proxy (GitHub-IPs sperrt TradingView).
 * Ein Titel aus mehreren Screens wird zu einem Kandidaten mit mehreren Quellen. Je Lauf
 * höchstens MAX_TOTAL Titel, bevorzugt die mit den meisten Screen-Treffern.
 *
 * Env: DISCOVERY_BACKEND_URL, DISCOVERY_SECRET; optional PRESETS=id1,id2 (nur diese, auch ohne Auto),
 *      MAX_TOTAL (Standard 150).
 */

import { createStorageClientFromEnv } from './_shared/storage-client.js';
import { DEFAULT_PRESETS, reconcileBuiltins } from '../ui/lib/screener-presets.js?v=20261123a';
import { runPreset, isAutoPreset } from '../ui/lib/screen-runner.js?v=20261123a';
import { rowsToCandidates } from '../ui/lib/tv-screener.js?v=20261123a';

const log = (level, msg, data = {}) =>
  process.stdout.write(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAX_TOTAL = Number(process.env.MAX_TOTAL) || 150;

async function loadAutoPresets() {
  let stored = [];
  try {
    const cfg = await createStorageClientFromEnv().readConfig();
    stored = Array.isArray(cfg?.presets) ? cfg.presets : [];
  } catch (err) {
    log('warn', 'tradingview-screener: read_config fehlgeschlagen, nur eingebaute Screens', { error: err.message });
  }
  const [list] = reconcileBuiltins(stored.length ? stored : structuredClone(DEFAULT_PRESETS));
  const only = String(process.env.PRESETS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return only.length ? list.filter((p) => only.includes(p.id)) : list.filter(isAutoPreset);
}

export async function fetchCandidates() {
  const auth = {
    backendUrl: String(process.env.DISCOVERY_BACKEND_URL ?? '').replace(/\/$/, ''),
    secret: process.env.DISCOVERY_SECRET ?? '',
  };
  if (!auth.backendUrl || !auth.secret) throw new Error('DISCOVERY_BACKEND_URL / DISCOVERY_SECRET not set');

  const presets = await loadAutoPresets();
  log('info', 'tradingview-screener: starting', { presets: presets.map((p) => p.id) });

  const byKey = new Map();   // symbol:exchange → { candidate, hits, bestRank }
  let failed = 0;
  for (const [i, preset] of presets.entries()) {
    if (i) await sleep(800);
    let res;
    try {
      res = await runPreset(preset, auth);
    } catch (err) {
      failed++;
      log('warn', 'tradingview-screener: screen failed', { id: preset.id, error: err.message });
      continue;
    }
    const cands = rowsToCandidates(res.rows, {
      market: res.req.market, columns: res.req.columns, presetId: preset.id, presetLabel: preset.label, filter: res.req.filter,
    });
    log('info', 'tradingview-screener: screen done', { id: preset.id, total: res.totalCount, fetched: res.fetched, kept: cands.length });
    for (const c of cands) {
      const key = `${c.symbol}:${c.exchange}`;
      const rank = c.sources[0].raw_signal.rank;
      const hit = byKey.get(key);
      if (!hit) { byKey.set(key, { candidate: c, hits: 1, bestRank: rank }); continue; }
      hit.candidate.sources.push(...c.sources);
      hit.hits++;
      hit.bestRank = Math.min(hit.bestRank, rank);
    }
  }
  if (presets.length && failed === presets.length) throw new Error('alle Screens fehlgeschlagen');

  const ranked = [...byKey.values()].sort((a, b) => b.hits - a.hits || a.bestRank - b.bestRank);
  const out = ranked.slice(0, MAX_TOTAL).map(({ candidate, hits }) => {
    if (hits > 1) {
      const labels = candidate.sources.map((s) => s.raw_signal.preset_label);
      candidate.sources[0].info_snippet = `Screener: ${hits} Treffer (${labels.join(', ')})`;
    }
    return candidate;
  });
  log('info', 'tradingview-screener: candidates ready', { unique: byKey.size, kept: out.length, multi: ranked.filter((r) => r.hits > 1).length });
  return out;
}
