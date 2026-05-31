/**
 * TradingView bulk enrichment – browser-side
 *
 * Uses scanner.tradingview.com/global/scan with symbols.tickers parameter —
 * the reliable way to query specific symbols (how TV queries watchlists internally).
 * Single request for all candidates regardless of market; no grouping needed.
 */

// Our exchange codes → TradingView exchange prefix in the "EXCHANGE:TICKER" format
const TV_PREFIX_MAP = {
  NASDAQ:   'NASDAQ',
  NYSE:     'NYSE',
  AMEX:     'AMEX',
  XETR:     'XETR',
  LSE:      'LSE',
  EURONEXT: 'EURONEXT',
  MIL:      'MIL',
  BME:      'BME',
  OMXSTO:   'OMXSTO',
  SIX:      'SIX',
  OMXCO:    'OMXCO',
  OMXNO:    'OMXNO',
  OMXHEX:   'OMXHEX',
};

const EXCHANGE_CURRENCY = {
  NASDAQ: 'USD', NYSE: 'USD', AMEX: 'USD',
  XETR: 'EUR', EURONEXT: 'EUR', MIL: 'EUR', BME: 'EUR',
  OMXSTO: 'SEK', OMXCO: 'DKK', OMXNO: 'NOK', OMXHEX: 'EUR',
  LSE: 'GBP', SIX: 'CHF',
};

const TV_COLUMNS = [
  'description',              // 0
  'close',                    // 1
  'market_cap_basic',         // 2
  'price_earnings_ttm',       // 3
  'price_to_book_ratio',      // 4
  'Recommend.All',            // 5
  'sector',                   // 6
  'industry',                 // 7
  'earnings_release_next_date', // 8
];
const COL = { description: 0, close: 1, marketCap: 2, pe: 3, pb: 4, rating: 5, sector: 6, industry: 7, earningsDate: 8 };

// ─── Proxy POST ───────────────────────────────────────────────────────────────

async function proxyPost(backendUrl, secret, url, requestBody) {
  const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
    body: JSON.stringify({
      url,
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    requestBody,
    }),
  });
  if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`Proxy: ${data.error}`);
  return data;
}

// ─── Schema A mapping ─────────────────────────────────────────────────────────

function marketCapBucket(mc) {
  if (mc < 300e6)  return 'micro';
  if (mc < 2e9)    return 'small';
  if (mc < 10e9)   return 'mid';
  if (mc < 200e9)  return 'large';
  return 'mega';
}

function formatEarningsDate(ts) {
  if (!ts) return null;
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  if (isNaN(d)) return null;
  return `Earnings: ${d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function buildUpdates(d, candidate) {
  const updates = {
    asset_type: 'Stock',
    scan_date:  new Date().toISOString().split('T')[0],
    tv_data: {
      rating:             d[COL.rating]      ?? null,
      pe_ttm:             d[COL.pe]          ?? null,
      pb_ratio:           d[COL.pb]          ?? null,
      market_cap:         d[COL.marketCap]   ?? null,
      close:              d[COL.close]       ?? null,
      earnings_next_date: d[COL.earningsDate] ?? null,
      fetched_at:         new Date().toISOString(),
    },
  };

  if (d[COL.description] && (!candidate.name || candidate.name === candidate.symbol)) {
    updates.name = d[COL.description];
  }
  if (d[COL.sector])    updates.sector        = d[COL.sector];
  if (d[COL.industry])  updates.sub_sector    = d[COL.industry];
  if (d[COL.marketCap]) updates.market_cap_size = marketCapBucket(d[COL.marketCap]);

  const earningsStr = formatEarningsDate(d[COL.earningsDate]);
  if (earningsStr)  updates.next_catalysts = earningsStr;

  if (d[COL.rating] !== null && d[COL.rating] !== undefined) {
    const r = d[COL.rating];
    updates.priority = r > 0.3 ? 'high' : r < -0.3 ? 'low' : 'medium';
  }

  const currency = EXCHANGE_CURRENCY[candidate.exchange];
  if (currency) updates.currency = currency;

  return updates;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetch TV enrichment for a list of candidates.
 * Single global/scan request using symbols.tickers — no market grouping needed.
 *
 * @param {object[]} candidates
 * @param {{ backendUrl: string, secret: string }} opts
 * @returns {Promise<Map<string, object>>}  candidateId → updates
 * @throws on proxy or schema failure
 */
export async function fetchTVEnrichment(candidates, { backendUrl, secret }) {
  // Build "EXCHANGE:SYMBOL" → candidate map
  const tickerMap = new Map();
  const skipped   = [];

  for (const c of candidates) {
    const prefix = TV_PREFIX_MAP[c.exchange];
    if (!prefix) { skipped.push(`${c.symbol} (${c.exchange ?? 'no exchange'})`); continue; }
    tickerMap.set(`${prefix}:${c.symbol}`, c);
  }

  if (tickerMap.size === 0) {
    const detail = skipped.length ? ` (${skipped.join(', ')})` : '';
    throw new Error(`Keine bekannten Exchanges${detail}`);
  }

  const tickers = [...tickerMap.keys()];

  const proxy = await proxyPost(backendUrl, secret, 'https://scanner.tradingview.com/global/scan', {
    symbols: { tickers },
    columns: TV_COLUMNS,
  });

  let parsed;
  try {
    parsed = JSON.parse(proxy.body);
  } catch {
    throw new Error('TV Antwort ungültig (kein JSON)');
  }

  if (!Array.isArray(parsed?.data)) {
    throw new Error(`Unbekanntes TV Schema – Keys: ${Object.keys(parsed ?? {}).join(', ')}`);
  }

  const results = new Map();
  for (const row of parsed.data) {
    const candidate = tickerMap.get(row.s);
    if (!candidate) continue;
    results.set(candidate.id, buildUpdates(row.d ?? [], candidate));
  }

  if (results.size === 0 && parsed.data.length === 0) {
    throw new Error(`TV hat keine Daten für: ${tickers.slice(0, 5).join(', ')}${tickers.length > 5 ? '…' : ''}`);
  }

  return results;
}
