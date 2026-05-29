/**
 * ISIN → Ticker resolver via OpenFIGI mapping API.
 * Free, no API key required for basic use (10 req/min, 10 items/batch).
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

// Bloomberg exchange codes → our TradingView-style exchange names
const EXCH_CODE_MAP = {
  UQ: 'NASDAQ',    // NASDAQ Global Select / Capital
  UN: 'NYSE',      // New York Stock Exchange
  UA: 'AMEX',      // NYSE American (AMEX)
  LN: 'LSE',       // London Stock Exchange
  GR: 'XETR',      // Frankfurt / Xetra
  FP: 'EURONEXT',  // Euronext Paris
  IM: 'MIL',       // Borsa Italiana
  SM: 'BME',       // Madrid Stock Exchange
  DC: 'OMXCO',     // Copenhagen
  NO: 'OMXNO',     // Oslo
  SS: 'OMXSTO',    // Stockholm
  HK: 'HKEX',      // Hong Kong
  JP: 'TSE',        // Tokyo
  AU: 'ASX',        // ASX
};

const cache = new Map(); // ISIN → { ticker, exchange } | null

async function batchResolve(isins) {
  const body = isins.map((isin) => ({ idType: 'ID_ISIN', idValue: isin }));

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
  const results = new Map();

  for (let i = 0; i < isins.length; i++) {
    const isin = isins[i];
    const item = data[i];

    if (!item || item.error || !Array.isArray(item.data) || item.data.length === 0) {
      log('debug', 'isin-to-ticker: no result', { isin, error: item?.error });
      results.set(isin, null);
      continue;
    }

    const equities = item.data.filter((d) => d.marketSector === 'Equity' && d.ticker);
    if (equities.length === 0) {
      results.set(isin, null);
      continue;
    }

    // For US ISINs prefer primary US exchanges in priority order
    const isUS = isin.startsWith('US');
    let best;
    if (isUS) {
      best =
        equities.find((d) => d.exchCode === 'UQ') ?? // NASDAQ
        equities.find((d) => d.exchCode === 'UN') ?? // NYSE
        equities.find((d) => d.exchCode === 'UA') ?? // AMEX
        equities[0];
    } else {
      best = equities[0];
    }

    const exchange = EXCH_CODE_MAP[best.exchCode] ?? null;
    results.set(isin, { ticker: best.ticker, exchange });
    log('debug', 'isin-to-ticker: resolved', { isin, ticker: best.ticker, exchCode: best.exchCode, exchange });
  }

  return results;
}

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

  // OpenFIGI: 10 items/batch, 10 req/min without API key → 6 s between batches
  const BATCH = 10;
  for (let i = 0; i < uncached.length; i += BATCH) {
    const batch = uncached.slice(i, i + BATCH);
    try {
      const resolved = await batchResolve(batch);
      for (const [isin, result] of resolved) {
        cache.set(isin, result);
      }
    } catch (err) {
      log('warn', 'isin-to-ticker: batch failed', { batch, error: err.message });
      // Mark as null so we don't retry indefinitely this run
      for (const isin of batch) cache.set(isin, null);
    }
    if (i + BATCH < uncached.length) await sleep(6500); // stay under 10 req/min
  }

  return Object.fromEntries(unique.map((isin) => [isin, cache.get(isin) ?? null]));
}
