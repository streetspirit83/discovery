/**
 * ISIN → Ticker resolver.
 *
 * Primary:  Twelve Data /stocks?isin=X  (requires TWELVEDATA_API_KEY env var)
 *           Returns symbol + mic_code directly — most reliable for link-building.
 * Fallback: OpenFIGI /v3/mapping with idType=ID_ISIN (free, no key needed).
 *
 * Usage:
 *   const map = await resolveISINsToTickers(['US29355A1079', 'US4659001059']);
 *   // { 'US29355A1079': { ticker: 'ENPH', exchange: 'NASDAQ' }, ... }
 */

const log = (level, msg, data = {}) =>
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// MIC codes used by Twelve Data → our TradingView-style exchange names
const MIC_TO_EXCHANGE = {
  XNAS: 'NASDAQ',
  XNYS: 'NYSE',
  XASE: 'AMEX',
  XLON: 'LSE',
  XETR: 'XETR',
  XPAR: 'EURONEXT',
  XMIL: 'MIL',
  XMAD: 'BME',
  XCPH: 'OMXCO',
  XOSL: 'OMXNO',
  XSTO: 'OMXSTO',
  XHKG: 'HKEX',
  XTKS: 'TSE',
  XASX: 'ASX',
};

// Bloomberg exchange codes used by OpenFIGI → our exchange names (fallback only)
const OPENFIGI_EXCH_MAP = {
  UQ: 'NASDAQ',
  UN: 'NYSE',
  UA: 'AMEX',
  LN: 'LSE',
  GR: 'XETR',
  FP: 'EURONEXT',
  IM: 'MIL',
  SM: 'BME',
  DC: 'OMXCO',
  NO: 'OMXNO',
  SS: 'OMXSTO',
  HK: 'HKEX',
  JP: 'TSE',
  AU: 'ASX',
};

const cache = new Map(); // ISIN → { ticker, exchange } | null

// ─── Twelve Data (primary) ───────────────────────────────────────────────────

async function resolveViaTwelveData(isin, apiKey) {
  try {
    const url = `https://api.twelvedata.com/stocks?isin=${isin}&apikey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const list = data?.data ?? [];
    if (!list.length) return null;

    // When multiple listings, prefer the primary exchange based on ISIN country prefix
    const isUS = isin.startsWith('US');
    let item;
    if (isUS) {
      item =
        list.find((d) => d.mic_code === 'XNAS') ??
        list.find((d) => d.mic_code === 'XNYS') ??
        list.find((d) => d.mic_code === 'XASE') ??
        list[0];
    } else {
      item = list[0];
    }

    if (!item?.symbol) return null;
    const exchange = MIC_TO_EXCHANGE[item.mic_code] ?? null;
    log('debug', 'isin-to-ticker: TD resolved', { isin, ticker: item.symbol, mic: item.mic_code, exchange });
    return { ticker: item.symbol, exchange };
  } catch (err) {
    log('warn', 'isin-to-ticker: TD fetch error', { isin, error: err.message });
    return null;
  }
}

// ─── OpenFIGI (fallback) ─────────────────────────────────────────────────────

async function batchResolveViaOpenFIGI(isins) {
  const body = isins.map((isin) => ({ idType: 'ID_ISIN', idValue: isin }));
  const results = new Map();

  let res;
  try {
    res = await fetch('https://api.openfigi.com/v3/mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`OpenFIGI fetch error: ${err.message}`);
  }

  if (res.status === 429) throw new Error('OpenFIGI rate limit hit');
  if (!res.ok) throw new Error(`OpenFIGI HTTP ${res.status}`);

  const data = await res.json();

  for (let i = 0; i < isins.length; i++) {
    const isin = isins[i];
    const item = data[i];

    if (!item || item.error || !Array.isArray(item.data) || item.data.length === 0) {
      log('debug', 'isin-to-ticker: FIGI no result', { isin, error: item?.error });
      results.set(isin, null);
      continue;
    }

    const equities = item.data.filter((d) => d.marketSector === 'Equity' && d.ticker);
    if (!equities.length) { results.set(isin, null); continue; }

    const isUS = isin.startsWith('US');
    const best = isUS
      ? (equities.find((d) => d.exchCode === 'UQ') ??
         equities.find((d) => d.exchCode === 'UN') ??
         equities.find((d) => d.exchCode === 'UA') ??
         equities[0])
      : equities[0];

    const exchange = OPENFIGI_EXCH_MAP[best.exchCode] ?? null;
    log('debug', 'isin-to-ticker: FIGI resolved', { isin, ticker: best.ticker, exchCode: best.exchCode, exchange });
    results.set(isin, { ticker: best.ticker, exchange });
  }

  return results;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolve a list of ISINs to { ticker, exchange } objects.
 * Returns a map keyed by ISIN; value is null if unresolvable.
 *
 * @param {string[]} isins
 * @returns {Promise<Record<string, { ticker: string, exchange: string|null } | null>>}
 */
export async function resolveISINsToTickers(isins) {
  const unique = [...new Set(isins.filter(Boolean))];
  const uncached = unique.filter((isin) => !cache.has(isin));

  log('info', 'isin-to-ticker: resolving', { total: unique.length, uncached: uncached.length });

  const tdKey = process.env.TWELVEDATA_API_KEY;
  const openFIGIQueue = [];

  // Step 1: Try Twelve Data per-ISIN (most reliable for exchange data)
  for (let i = 0; i < uncached.length; i++) {
    const isin = uncached[i];
    if (tdKey) {
      const result = await resolveViaTwelveData(isin, tdKey);
      if (result) {
        cache.set(isin, result);
        if (i < uncached.length - 1) await sleep(200); // stay gentle on TD
        continue;
      }
    }
    openFIGIQueue.push(isin);
  }

  // Step 2: Fall back to OpenFIGI for any still-unresolved ISINs
  if (openFIGIQueue.length > 0) {
    log('info', 'isin-to-ticker: falling back to OpenFIGI', { count: openFIGIQueue.length });
    const BATCH = 10; // OpenFIGI: 10 items/batch, 10 req/min without key
    for (let i = 0; i < openFIGIQueue.length; i += BATCH) {
      const batch = openFIGIQueue.slice(i, i + BATCH);
      try {
        const resolved = await batchResolveViaOpenFIGI(batch);
        for (const [isin, result] of resolved) cache.set(isin, result);
      } catch (err) {
        log('warn', 'isin-to-ticker: FIGI batch failed', { error: err.message });
        for (const isin of batch) cache.set(isin, null);
      }
      if (i + BATCH < openFIGIQueue.length) await sleep(6500);
    }
  }

  return Object.fromEntries(unique.map((isin) => [isin, cache.get(isin) ?? null]));
}
