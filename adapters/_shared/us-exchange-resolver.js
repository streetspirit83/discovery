/**
 * US Exchange Resolver
 *
 * Resolves whether a US ticker trades on NASDAQ or NYSE (or AMEX).
 * Uses the Financial Modeling Prep or Twelve Data API when available,
 * falls back to a static heuristic list of known symbols.
 *
 * Environment variables (optional):
 *   FMP_API_KEY       – Financial Modeling Prep key
 *   TWELVEDATA_API_KEY – Twelve Data key
 */

const log = (level, msg, data = {}) =>
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );

/** Well-known NASDAQ symbols (partial, for offline fallback) */
const KNOWN_NASDAQ = new Set([
  'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'GOOG', 'META', 'TSLA', 'NVDA', 'AMD',
  'INTC', 'CSCO', 'ADBE', 'NFLX', 'PYPL', 'CMCSA', 'PEP', 'COST', 'AVGO',
  'TXN', 'QCOM', 'SBUX', 'INTU', 'ISRG', 'MU', 'LRCX', 'KLAC', 'ASML',
  'MRVL', 'SNPS', 'CDNS', 'PANW', 'FTNT', 'CRWD', 'ZS', 'OKTA', 'DDOG',
  'SNOW', 'PLTR', 'COIN', 'HOOD', 'RIVN', 'LCID',
]);

/** Well-known NYSE symbols (partial, for offline fallback) */
const KNOWN_NYSE = new Set([
  'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'BRK.B', 'BRK.A', 'V', 'MA',
  'WMT', 'HD', 'MCD', 'NKE', 'DIS', 'KO', 'PG', 'JNJ', 'UNH', 'PFE',
  'XOM', 'CVX', 'BA', 'CAT', 'GE', 'MMM', 'IBM', 'T', 'VZ', 'CRM',
  'UBER', 'LYFT', 'ABNB', 'DASH', 'PINS', 'SNAP', 'TWTR', 'RBLX',
]);

/**
 * Try to resolve US exchange via Financial Modeling Prep API.
 * @param {string} symbol
 * @param {string} apiKey
 * @returns {Promise<string|null>}
 */
async function resolveViaFMP(symbol, apiKey) {
  try {
    const url = `https://financialmodelingprep.com/api/v3/profile/${symbol}?apikey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const profile = data[0];
    const exchange = profile.exchangeShortName ?? profile.exchange ?? '';
    if (exchange.includes('NASDAQ') || exchange === 'NASDAQ') return 'NASDAQ';
    if (exchange.includes('NYSE') || exchange === 'NYSE') return 'NYSE';
    if (exchange.includes('AMEX') || exchange === 'AMEX') return 'AMEX';
    return null;
  } catch (err) {
    log('warn', 'FMP resolve failed', { symbol, error: err.message });
    return null;
  }
}

/**
 * Try to resolve US exchange via Twelve Data API.
 * @param {string} symbol
 * @param {string} apiKey
 * @returns {Promise<string|null>}
 */
async function resolveViaTwelveData(symbol, apiKey) {
  try {
    const url = `https://api.twelvedata.com/stocks?symbol=${symbol}&country=US&apikey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const list = data?.data ?? [];
    if (list.length === 0) return null;
    const mic = list[0].mic_code ?? '';
    if (mic === 'XNAS') return 'NASDAQ';
    if (mic === 'XNYS') return 'NYSE';
    if (mic === 'XASE') return 'AMEX';
    return null;
  } catch (err) {
    log('warn', 'TwelveData resolve failed', { symbol, error: err.message });
    return null;
  }
}

/** In-memory cache for resolved exchanges. */
const resolveCache = new Map();

/**
 * Resolve the TradingView exchange for a US ticker symbol.
 * Falls back to a static heuristic if no API key is available.
 *
 * @param {string} symbol - bare US ticker (no suffix)
 * @returns {Promise<'NASDAQ'|'NYSE'|'AMEX'|'US'>}
 */
export async function resolveUSExchange(symbol) {
  const sym = symbol.toUpperCase();

  if (resolveCache.has(sym)) return resolveCache.get(sym);

  const fmpKey = process.env.FMP_API_KEY;
  const tdKey = process.env.TWELVEDATA_API_KEY;

  let exchange = null;

  if (fmpKey) {
    exchange = await resolveViaFMP(sym, fmpKey);
  }

  if (!exchange && tdKey) {
    exchange = await resolveViaTwelveData(sym, tdKey);
  }

  if (!exchange) {
    // Static fallback
    if (KNOWN_NASDAQ.has(sym)) exchange = 'NASDAQ';
    else if (KNOWN_NYSE.has(sym)) exchange = 'NYSE';
    else exchange = 'NASDAQ'; // default assumption for unknowns
    log('debug', 'US exchange resolved via static fallback', { symbol: sym, exchange });
  } else {
    log('debug', 'US exchange resolved via API', { symbol: sym, exchange });
  }

  resolveCache.set(sym, exchange);
  return exchange;
}
