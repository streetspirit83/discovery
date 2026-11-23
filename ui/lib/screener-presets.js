/**
 * Screener presets – persisted server-side (discovery-config blob) so they sync
 * across devices. Falls back to localStorage when no backend is configured
 * (mock/dev), so the Studio still works offline.
 *
 * Preset shape:
 *   { id, label, market, sector|null, mega:[key]|null, filter:[{left,operation,right}],
 *     sort:{sortBy,sortOrder}, count, signal_type:'custom_screen', built_in,
 *     auto (Vorgabe: läuft im Adapter-Lauf mit), auto_override (Schalter im Studio) }
 *
 * `right` darf ein Feldname sein (Feld gegen Feld, z. B. close > SMA50). Mit `auto`
 * führt der Adapter `tradingview-screener` das Preset werktags selbst aus und legt die
 * Treffer in die Inbox (siehe adapters/tradingview-screener.js).
 */

const LS_KEY = 'discovery_screener_presets';

export const DEFAULT_PRESETS = [
  {
    id: 'builtin-volume-spike-us', auto: true, label: 'Volume Spike US', market: 'america', sector: null,
    filter: [
      { left: 'market_cap_basic', operation: 'greater', right: 300000000 },
      { left: 'close', operation: 'greater', right: 5 },
      { left: 'volume', operation: 'greater', right: 500000 },
      { left: 'relative_volume_10d_calc', operation: 'greater', right: 2.5 },
    ],
    sort: { sortBy: 'relative_volume_10d_calc', sortOrder: 'desc' }, count: 50,
    signal_type: 'custom_screen', built_in: true,
  },
  {
    id: 'builtin-volume-spike-de', auto: true, label: 'Volume Spike EU', market: 'europe', sector: null,
    // Bis Nov. 2026 „Volume Spike DE“ über den Länder-Endpoint – der lieferte fast nur an
    // deutschen Plätzen gehandelte Auslandswerte. Jetzt alle EU-Heimatbörsen.
    filter: [
      { left: 'market_cap_basic', operation: 'greater', right: 300000000 },
      { left: 'volume', operation: 'greater', right: 50000 },
      { left: 'relative_volume_10d_calc', operation: 'greater', right: 2.5 },
    ],
    sort: { sortBy: 'relative_volume_10d_calc', sortOrder: 'desc' }, count: 30,
    signal_type: 'custom_screen', built_in: true,
  },
  {
    id: 'builtin-momentum-breakout-us', auto: true, label: 'Momentum Breakout US', market: 'america', sector: null,
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
    id: 'builtin-near-cycle-high-us', label: 'Near Cycle High US', market: 'america', sector: null,
    // Proxy for a high PCHS (cycle-high) score: strong multi-timeframe performance,
    // since field-vs-field filters (e.g. close vs. price_52_week_high) aren't supported here.
    filter: [
      { left: 'close', operation: 'greater', right: 5 },
      { left: 'volume', operation: 'greater', right: 300000 },
      { left: 'Perf.Y', operation: 'greater', right: 20 },
      { left: 'Perf.6M', operation: 'greater', right: 10 },
      { left: 'Perf.3M', operation: 'egreater', right: 0 },
    ],
    sort: { sortBy: 'Perf.Y', sortOrder: 'desc' }, count: 40,
    signal_type: 'custom_screen', built_in: true,
  },

  // ── Newer built-ins ─────────────────────────────────────────────────────────
  {
    id: 'builtin-52w-high-breakout-us', auto: true, label: '52W-Hoch Breakout US', market: 'america', sector: null,
    // Uses synthetic %-fields: close within 3% of the 52w high, on a volume surge.
    filter: [
      { left: 'close', operation: 'greater', right: 5 },
      { left: 'volume', operation: 'greater', right: 500000 },
      { left: 'High.1M', operation: 'egreater', right: 'price_52_week_high' }, // neues 52W-Hoch im letzten Monat
      { left: 'pct_below_52w_high', operation: 'eless', right: 3 },
      { left: 'vol_vs_avg30d_pct', operation: 'greater', right: 150 },
    ],
    sort: { sortBy: 'Perf.1M', sortOrder: 'desc' }, count: 40,
    signal_type: 'custom_screen', built_in: true,
  },
  {
    id: 'builtin-oversold-bounce-us', label: 'Oversold Bounce US', market: 'america', sector: null,
    filter: [
      { left: 'close', operation: 'greater', right: 5 },
      { left: 'RSI', operation: 'less', right: 35 },
      { left: 'Perf.1M', operation: 'less', right: -15 },
      { left: 'vol_vs_avg30d_pct', operation: 'greater', right: 100 },
    ],
    sort: { sortBy: 'RSI', sortOrder: 'asc' }, count: 40,
    signal_type: 'custom_screen', built_in: true,
  },
  {
    id: 'builtin-trend-stack-us', auto: true, label: 'Trend-Stack Bull US', market: 'america', sector: null,
    // Trend-alignment proxy (numeric builder can't do a literal SMA50×SMA200 cross):
    // price above its EMA20 AND SMA200, with a real trend (ADX).
    filter: [
      { left: 'close', operation: 'greater', right: 5 },
      { left: 'pct_above_ema20', operation: 'greater', right: 0 },
      { left: 'pct_above_sma200', operation: 'greater', right: 0 },
      { left: 'ADX', operation: 'greater', right: 20 },
    ],
    sort: { sortBy: 'Perf.3M', sortOrder: 'desc' }, count: 40,
    signal_type: 'custom_screen', built_in: true,
  },
  {
    id: 'builtin-pullback-ema20-us', label: 'Pullback EMA20 US', market: 'america', sector: null,
    // Uptrend buy-the-dip: hugging EMA20 (±3%) while still above SMA200 and rising.
    filter: [
      { left: 'close', operation: 'greater', right: 5 },
      { left: 'pct_above_ema20', operation: 'in_range', right: [-3, 3] },
      { left: 'pct_above_sma200', operation: 'greater', right: 0 },
      { left: 'Perf.3M', operation: 'greater', right: 10 },
    ],
    sort: { sortBy: 'Perf.3M', sortOrder: 'desc' }, count: 40,
    signal_type: 'custom_screen', built_in: true,
  },
  {
    id: 'builtin-quality-compounder-us', label: 'Quality Compounder US', market: 'america', sector: null,
    filter: [
      { left: 'market_cap_basic', operation: 'greater', right: 1000000000 },
      { left: 'return_on_equity', operation: 'greater', right: 15 },
      { left: 'total_revenue_yoy_growth_ttm', operation: 'greater', right: 10 },
      { left: 'debt_to_equity', operation: 'less', right: 1 },
    ],
    sort: { sortBy: 'return_on_equity', sortOrder: 'desc' }, count: 40,
    signal_type: 'custom_screen', built_in: true,
  },
  {
    id: 'builtin-dividend-value-us', label: 'Dividend Value US', market: 'america', sector: null,
    filter: [
      { left: 'dividend_yield_recent', operation: 'greater', right: 3 },
      { left: 'price_earnings_ttm', operation: 'in_range', right: [0, 20] },
      { left: 'market_cap_basic', operation: 'greater', right: 1000000000 },
    ],
    sort: { sortBy: 'dividend_yield_recent', sortOrder: 'desc' }, count: 40,
    signal_type: 'custom_screen', built_in: true,
  },
  {
    id: 'builtin-smallcap-momentum-us', auto: true, label: 'Small-Cap Momentum US', market: 'america', sector: null,
    filter: [
      { left: 'market_cap_basic', operation: 'in_range', right: [100000000, 2000000000] },
      { left: 'Perf.3M', operation: 'greater', right: 20 },
      { left: 'relative_volume_10d_calc', operation: 'greater', right: 2 },
      { left: 'close', operation: 'greater', right: 2 },
    ],
    sort: { sortBy: 'Perf.3M', sortOrder: 'desc' }, count: 40,
    signal_type: 'custom_screen', built_in: true,
  },
  {
    id: 'builtin-low-vola-climber-us', label: 'Low-Vola Steady Climber US', market: 'america', sector: null,
    // Trending but calm: positive 6M perf with low daily volatility and modest ADX.
    filter: [
      { left: 'close', operation: 'greater', right: 5 },
      { left: 'Perf.6M', operation: 'greater', right: 10 },
      { left: 'ADX', operation: 'less', right: 25 },
      { left: 'Volatility.D', operation: 'less', right: 3 },
    ],
    sort: { sortBy: 'Perf.6M', sortOrder: 'desc' }, count: 40,
    signal_type: 'custom_screen', built_in: true,
  },
  {
    id: 'builtin-momentum-breakout-eu', auto: true, label: 'Momentum Breakout EU', market: 'europe', sector: null,
    filter: [
      { left: 'market_cap_basic', operation: 'greater', right: 300000000 },
      { left: 'volume', operation: 'greater', right: 20000 },
      { left: 'RSI', operation: 'greater', right: 55 },
      { left: 'Perf.1M', operation: 'greater', right: 8 },
    ],
    sort: { sortBy: 'Perf.1M', sortOrder: 'desc' }, count: 30,
    signal_type: 'custom_screen', built_in: true,
  },
  // ── Trend-/Rally-Screens (Nov. 2026, Feld gegen Feld nativ im Scanner) ─────
  // Alle mit Mega-Cluster-Fokus (ohne „Miscellaneous“ = Fonds/Mäntel) und ab 300 Mio. Börsenwert.
  ...['america', 'europe'].flatMap((market) => {
    const tag = market === 'america' ? 'US' : 'EU';
    const minVol = market === 'america' ? 300000 : 20000;
    const mega = ['tech', 'health', 'consumer', 'industry', 'finance'];
    const base = { market, sector: null, mega, signal_type: 'custom_screen', built_in: true, auto: true };
    return [
      {
        ...base, id: `builtin-minervini-${tag.toLowerCase()}`, label: `Minervini Stage 2 ${tag}`,
        // Trend-Template: Kurs > SMA50 > SMA150 > SMA200, nah am 52W-Hoch, weit über dem 52W-Tief.
        filter: [
          { left: 'market_cap_basic', operation: 'greater', right: 300000000 },
          { left: 'volume', operation: 'greater', right: minVol },
          { left: 'close', operation: 'greater', right: 'SMA50' },
          { left: 'SMA50', operation: 'greater', right: 'SMA150' },
          { left: 'SMA150', operation: 'greater', right: 'SMA200' },
          { left: 'pct_below_52w_high', operation: 'eless', right: 25 },
          { left: 'pct_above_52w_low', operation: 'egreater', right: 30 },
        ],
        sort: { sortBy: 'Perf.6M', sortOrder: 'desc' }, count: 30,
      },
      {
        ...base, id: `builtin-growth-momentum-${tag.toLowerCase()}`, label: `Growth + Momentum ${tag}`,
        filter: [
          { left: 'market_cap_basic', operation: 'greater', right: 300000000 },
          { left: 'total_revenue_yoy_growth_ttm', operation: 'greater', right: 25 },
          { left: 'earnings_per_share_diluted_yoy_growth_ttm', operation: 'greater', right: 25 },
          { left: 'Perf.3M', operation: 'greater', right: 20 },
          { left: 'close', operation: 'greater', right: 'SMA50' },
        ],
        sort: { sortBy: 'Perf.3M', sortOrder: 'desc' }, count: 30,
      },
      {
        ...base, id: `builtin-earnings-gap-${tag.toLowerCase()}`, label: `Earnings-Gap ${tag}`,
        // Post-Earnings-Drift: positive Überraschung im letzten Quartal + Kurslücke mit Volumen.
        filter: [
          { left: 'market_cap_basic', operation: 'greater', right: 300000000 },
          { left: 'gap', operation: 'greater', right: 5 },
          { left: 'relative_volume_10d_calc', operation: 'greater', right: 2 },
          { left: 'eps_surprise_percent_fq', operation: 'greater', right: 0 },
          { left: 'close', operation: 'greater', right: 'SMA200' },
        ],
        sort: { sortBy: 'gap', sortOrder: 'desc' }, count: 25,
      },
      {
        ...base, id: `builtin-rs-midcap-${tag.toLowerCase()}`, label: `RS-Leader Mid-Cap ${tag}`,
        // Unbekanntere Werte (0,3–10 Mrd.) mit relativer Stärke über 6 Monate und echtem Trend.
        filter: [
          { left: 'market_cap_basic', operation: 'in_range', right: [300000000, 10000000000] },
          { left: 'volume', operation: 'greater', right: minVol },
          { left: 'Perf.6M', operation: 'greater', right: 40 },
          { left: 'Perf.1M', operation: 'greater', right: 0 },
          { left: 'ADX', operation: 'greater', right: 25 },
          { left: 'close', operation: 'greater', right: 'SMA50' },
        ],
        sort: { sortBy: 'Perf.6M', sortOrder: 'desc' }, count: 30,
      },
      {
        ...base, id: `builtin-breakout-pullback-${tag.toLowerCase()}`, label: `Ausbruch + Rücksetzer ${tag}`,
        // Setup wie in der Auto-Rotation: frisches Hoch, kleiner Rücksetzer, SMA20 > SMA50 > SMA200.
        filter: [
          { left: 'market_cap_basic', operation: 'greater', right: 300000000 },
          { left: 'volume', operation: 'greater', right: minVol },
          { left: 'SMA20', operation: 'greater', right: 'SMA50' },
          { left: 'SMA50', operation: 'greater', right: 'SMA200' },
          { left: 'close', operation: 'greater', right: 'SMA50' },
          { left: 'pct_below_1m_high', operation: 'in_range', right: [2, 12] },
          { left: 'pct_below_52w_high', operation: 'eless', right: 15 },
        ],
        sort: { sortBy: 'Perf.3M', sortOrder: 'desc' }, count: 30,
      },
    ];
  }),
];

// Built-in presets that were shipped previously but have since been retired. They
// are actively pruned from existing stores on load so they don't linger.
const REMOVED_BUILTIN_IDS = new Set(['builtin-strong-buy-us']);

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
 * Reconcile a stored preset list against the shipped built-ins: prune retired
 * built-ins, then append any newly-added ones (by id). Returns [list, changed].
 */
export function reconcileBuiltins(presets) {
  let changed = false;
  let list = presets.filter((p) => {
    if (p.built_in && REMOVED_BUILTIN_IDS.has(p.id)) { changed = true; return false; }
    return true;
  });
  // Eingebaute Screens folgen immer der ausgelieferten Definition; nur der Auto-Schalter
  // des Nutzers (`auto_override`) bleibt erhalten.
  const shipped = new Map(DEFAULT_PRESETS.map((p) => [p.id, p]));
  list = list.map((p) => {
    const def = p.built_in ? shipped.get(p.id) : null;
    if (!def) return p;
    const next = structuredClone(def);
    if (p.auto_override != null) next.auto_override = p.auto_override;
    if (JSON.stringify(next) !== JSON.stringify(p)) changed = true;
    return next;
  });
  const existingIds = new Set(list.map((p) => p.id));
  const missing = DEFAULT_PRESETS.filter((p) => !existingIds.has(p.id));
  if (missing.length) { list = [...list, ...structuredClone(missing)]; changed = true; }
  return [list, changed];
}

/**
 * Load presets. Seeds DEFAULT_PRESETS on first use (when the store is empty),
 * and merges in any newly-added built-ins for existing stores.
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
      const local = readLocal();
      if (local && local.length) {
        const [merged, changed] = reconcileBuiltins(local);
        if (changed) writeLocal(merged);
        return merged;
      }
      return structuredClone(DEFAULT_PRESETS);
    }
    const presets = Array.isArray(config?.presets) ? config.presets : [];
    if (presets.length === 0) {
      const seeded = structuredClone(DEFAULT_PRESETS);
      try { await storageClient.writeConfig({ presets: seeded }); } catch {}
      return seeded;
    }
    const [merged, changed] = reconcileBuiltins(presets);
    if (changed) {
      try { await storageClient.writeConfig({ presets: merged }); } catch {}
    }
    return merged;
  }

  // No backend → localStorage fallback.
  const local = readLocal();
  if (local && local.length) {
    const [merged, changed] = reconcileBuiltins(local);
    if (changed) writeLocal(merged);
    return merged;
  }
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
