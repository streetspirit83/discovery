/**
 * ISIN Resolver
 *
 * Attempts to resolve an ISIN for a given symbol+exchange combination.
 * Uses OpenFIGI API (no key required for basic lookups) and falls back
 * to a static map of well-known ISINs.
 */

const log = (level, msg, data = {}) =>
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );

/** @type {Map<string, string>} symbol → ISIN static cache */
const STATIC_ISIN_MAP = new Map([
  ['AAPL', 'US0378331005'],
  ['MSFT', 'US5949181045'],
  ['AMZN', 'US0231351067'],
  ['GOOGL', 'US02079K3059'],
  ['GOOG', 'US02079K1079'],
  ['META', 'US30303M1027'],
  ['TSLA', 'US88160R1014'],
  ['NVDA', 'US67066G1040'],
  ['JPM', 'US46625H1005'],
  ['BAC', 'US0605051046'],
  ['V', 'US92826C8394'],
  ['MA', 'US57636Q1040'],
  ['JNJ', 'US4781601046'],
  ['UNH', 'US91324P1021'],
  ['PG', 'US7427181091'],
  ['HD', 'US4370761029'],
  ['SAP', 'DE0007164600'],
  ['SIE', 'DE0007236101'],
  ['ALV', 'DE0008404005'],
  ['BAS', 'DE000BASF111'],
  ['BMW', 'DE0005190003'],
  ['MBG', 'DE0007100000'],
  ['VOW3', 'DE0007664039'],
  ['ADS', 'DE000A1EWWW0'],
  ['BAYN', 'DE000BAY0017'],
]);

/** In-memory resolution cache */
const resolveCache = new Map();

/**
 * Try to resolve ISIN via OpenFIGI mapping API.
 * @param {string} symbol
 * @param {string} exchange  - TradingView-style exchange or MIC
 * @returns {Promise<string|null>}
 */
async function resolveViaOpenFIGI(symbol, exchange) {
  try {
    // Map TV exchange to MIC for OpenFIGI
    const MIC_MAP = {
      NASDAQ: 'XNAS',
      NYSE: 'XNYS',
      AMEX: 'XASE',
      XETR: 'XETR',
      FWB: 'XFRA',
      LSE: 'XLON',
      EURONEXT: 'XPAR',
      MIL: 'XMIL',
      BME: 'XMAD',
    };
    const exchCode = MIC_MAP[exchange] ?? exchange;

    const body = [{ idType: 'TICKER', idValue: symbol, exchCode }];
    const res = await fetch('https://api.openfigi.com/v3/mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const matches = data?.[0]?.data ?? [];
    // Find a result with an ISIN
    for (const match of matches) {
      if (match.shareClassFIGI || match.compositeFIGI) {
        // OpenFIGI doesn't directly return ISIN; we'd need a second call
        // For now return null and rely on static map
      }
    }
    return null;
  } catch (err) {
    log('warn', 'OpenFIGI resolve failed', { symbol, error: err.message });
    return null;
  }
}

/**
 * Resolve the ISIN for a symbol+exchange combination.
 * Returns null if no ISIN can be determined.
 *
 * @param {string} symbol
 * @param {string} exchange
 * @returns {Promise<string|null>}
 */
export async function resolveISIN(symbol, exchange) {
  const key = `${symbol}:${exchange}`;
  if (resolveCache.has(key)) return resolveCache.get(key);

  // Static map first (fast)
  if (STATIC_ISIN_MAP.has(symbol)) {
    const isin = STATIC_ISIN_MAP.get(symbol);
    resolveCache.set(key, isin);
    return isin;
  }

  // Try OpenFIGI (rate-limited, best-effort)
  const isin = await resolveViaOpenFIGI(symbol, exchange);
  resolveCache.set(key, isin);
  return isin;
}

/**
 * Validate ISIN format (basic checksum not implemented, just format).
 * @param {string} isin
 * @returns {boolean}
 */
export function isValidISINFormat(isin) {
  return typeof isin === 'string' && /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin);
}
