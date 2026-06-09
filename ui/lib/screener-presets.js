/**
 * Screener presets – persisted server-side (discovery-config blob) so they sync
 * across devices. Falls back to localStorage when no backend is configured
 * (mock/dev), so the Studio still works offline.
 *
 * Preset shape:
 *   { id, label, market, sector|null, filter:[{left,operation,right}],
 *     sort:{sortBy,sortOrder}, count, signal_type:'custom_screen', built_in }
 */

const LS_KEY = 'discovery_screener_presets';

export const DEFAULT_PRESETS = [
  {
    id: 'builtin-volume-spike-us', label: 'Volume Spike US', market: 'america', sector: null,
    filter: [
      { left: 'close', operation: 'greater', right: 5 },
      { left: 'volume', operation: 'greater', right: 500000 },
      { left: 'relative_volume_10d_calc', operation: 'greater', right: 2.5 },
    ],
    sort: { sortBy: 'relative_volume_10d_calc', sortOrder: 'desc' }, count: 50,
    signal_type: 'custom_screen', built_in: true,
  },
  {
    id: 'builtin-volume-spike-de', label: 'Volume Spike DE', market: 'germany', sector: null,
    filter: [
      { left: 'volume', operation: 'greater', right: 50000 },
      { left: 'relative_volume_10d_calc', operation: 'greater', right: 2.5 },
    ],
    sort: { sortBy: 'relative_volume_10d_calc', sortOrder: 'desc' }, count: 30,
    signal_type: 'custom_screen', built_in: true,
  },
  {
    id: 'builtin-momentum-breakout-us', label: 'Momentum Breakout US', market: 'america', sector: null,
    filter: [
      { left: 'close', operation: 'greater', right: 5 },
      { left: 'volume', operation: 'greater', right: 500000 },
      { left: 'RSI', operation: 'greater', right: 55 },
      { left: 'Perf.1M', operation: 'greater', right: 8 },
    ],
    sort: { sortBy: 'Perf.1M', sortOrder: 'desc' }, count: 40,
    signal_type: 'custom_screen', built_in: true,
  },
  {
    id: 'builtin-sector-leader-tech', label: 'Sector Leader: Tech Services', market: 'america',
    sector: 'Technology Services',
    filter: [
      { left: 'market_cap_basic', operation: 'greater', right: 300000000 },
      { left: 'volume', operation: 'greater', right: 200000 },
      { left: 'Perf.1M', operation: 'greater', right: 8 },
    ],
    sort: { sortBy: 'Perf.1M', sortOrder: 'desc' }, count: 25,
    signal_type: 'custom_screen', built_in: true,
  },
  {
    id: 'builtin-strong-buy-us', label: 'TV Strong Buy US', market: 'america', sector: null,
    filter: [
      { left: 'close', operation: 'greater', right: 5 },
      { left: 'volume', operation: 'greater', right: 300000 },
      { left: 'Recommend.All', operation: 'egreater', right: 0.5 },
    ],
    sort: { sortBy: 'Recommend.All', sortOrder: 'desc' }, count: 40,
    signal_type: 'custom_screen', built_in: true,
  },
];

function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch { return null; }
}

function writeLocal(presets) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(presets)); } catch {}
}

/**
 * Load presets. Seeds DEFAULT_PRESETS on first use (when the store is empty).
 * @param {object|null} storageClient
 * @returns {Promise<object[]>}
 */
export async function loadPresets(storageClient) {
  if (storageClient) {
    let config;
    try {
      config = await storageClient.readConfig();
    } catch (err) {
      // Backend unreachable → fall back to local copy so the UI still works.
      return readLocal() ?? structuredClone(DEFAULT_PRESETS);
    }
    const presets = Array.isArray(config?.presets) ? config.presets : [];
    if (presets.length === 0) {
      const seeded = structuredClone(DEFAULT_PRESETS);
      try { await storageClient.writeConfig({ presets: seeded }); } catch {}
      return seeded;
    }
    return presets;
  }

  // No backend → localStorage fallback.
  const local = readLocal();
  if (local && local.length) return local;
  const seeded = structuredClone(DEFAULT_PRESETS);
  writeLocal(seeded);
  return seeded;
}

async function persist(storageClient, presets) {
  if (storageClient) {
    await storageClient.writeConfig({ presets });
  } else {
    writeLocal(presets);
  }
  return presets;
}

/** Upsert a preset (by id) and persist the full list. Returns the new list. */
export async function savePreset(storageClient, preset) {
  const presets = await loadPresets(storageClient);
  const idx = presets.findIndex((p) => p.id === preset.id);
  if (idx === -1) presets.push(preset);
  else presets[idx] = preset;
  return persist(storageClient, presets);
}

/** Delete a preset by id and persist. Returns the new list. */
export async function deletePreset(storageClient, id) {
  const presets = (await loadPresets(storageClient)).filter((p) => p.id !== id);
  return persist(storageClient, presets);
}
