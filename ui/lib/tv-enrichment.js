/**
 * TradingView bulk enrichment – browser-side
 *
 * Groups candidates by exchange → known-working TV market endpoint, then
 * uses symbols.tickers parameter (not a name filter) for reliable per-symbol lookup.
 */

const EXCHANGE_TO_MARKET = {
  NASDAQ:   'america',
  NYSE:     'america',
  AMEX:     'america',
  XETR:     'germany',
  LSE:      'uk',
  EURONEXT: 'france',
  MIL:      'italy',
  BME:      'spain',
  OMXSTO:   'sweden',
  SIX:      'switzerland',
  OMXCO:    'denmark',
  OMXNO:    'norway',
  OMXHEX:   'finland',
};

// Exchange code → TV "EXCHANGE:TICKER" prefix (as seen in s-field of screener response)
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
  'description',                // 0
  'close',                      // 1
  'market_cap_basic',           // 2
  'price_earnings_ttm',         // 3
  'price_to_book_ratio',        // 4
  'Recommend.All',              // 5
  'sector',                     // 6
  'industry',                   // 7
  'earnings_release_next_date', // 8
];
const COL = { description: 0, close: 1, marketCap: 2, pe: 3, pb: 4, rating: 5, sector: 6, industry: 7, earningsDate: 8 };

// ─── Proxy POST ───────────────────────────────────────────────────────────────

async function proxyPost(backendUrl, secret, url, requestBody) {
  const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
    body: JSON.stringify({
      url,
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    requestBody,
    }),
  });
  if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
  const wrapper = await res.json();
  if (!wrapper.ok) throw new Error(`Proxy: ${wrapper.error}`);
  if (wrapper.status !== 200) throw new Error(`TV HTTP ${wrapper.status} für ${url}`);
  return wrapper.body; // raw response body string
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
      rating:             d[COL.rating]       ?? null,
      pe_ttm:             d[COL.pe]           ?? null,
      pb_ratio:           d[COL.pb]           ?? null,
      market_cap:         d[COL.marketCap]    ?? null,
      close:              d[COL.close]        ?? null,
      earnings_next_date: d[COL.earningsDate] ?? null,
      fetched_at:         new Date().toISOString(),
    },
  };

  if (d[COL.description] && (!candidate.name || candidate.name === candidate.symbol)) {
    updates.name = d[COL.description];
  }
  if (d[COL.sector])    updates.sector          = d[COL.sector];
  if (d[COL.industry])  updates.sub_sector      = d[COL.industry];
  if (d[COL.marketCap]) updates.market_cap_size = marketCapBucket(d[COL.marketCap]);

  const earningsStr = formatEarningsDate(d[COL.earningsDate]);
  if (earningsStr) updates.next_catalysts = earningsStr;

  if (d[COL.rating] !== null && d[COL.rating] !== undefined) {
    updates.priority = d[COL.rating] > 0.3 ? 'high' : d[COL.rating] < -0.3 ? 'low' : 'medium';
  }

  const currency = EXCHANGE_CURRENCY[candidate.exchange];
  if (currency) updates.currency = currency;

  return updates;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * @param {object[]} candidates
 * @param {{ backendUrl: string, secret: string }} opts
 * @returns {Promise<Map<string, object>>}  candidateId → updates
 * @throws with a user-readable message on any failure
 */
export async function fetchTVEnrichment(candidates, { backendUrl, secret }) {
  // Group by TV market endpoint
  const groups = new Map(); // market → [{candidate, tvTicker}]
  const noExchange = [];

  for (const c of candidates) {
    const market = EXCHANGE_TO_MARKET[c.exchange];
    const prefix = TV_PREFIX_MAP[c.exchange];
    if (!market || !prefix) { noExchange.push(`${c.symbol}(${c.exchange ?? '?'})`); continue; }
    if (!groups.has(market)) groups.set(market, []);
    groups.get(market).push({ candidate: c, tvTicker: `${prefix}:${c.symbol}` });
  }

  if (groups.size === 0) {
    throw new Error(`Keine bekannten Exchanges – übersprungen: ${noExchange.join(', ')}`);
  }

  const results = new Map();
  const errors  = [];

  for (const [market, entries] of groups) {
    const tickers    = entries.map((e) => e.tvTicker);
    const tickerMap  = new Map(entries.map((e) => [e.tvTicker, e.candidate]));
    const url        = `https://scanner.tradingview.com/${market}/scan`;

    let bodyStr;
    try {
      bodyStr = await proxyPost(backendUrl, secret, url, {
        symbols: { tickers },
        columns: TV_COLUMNS,
      });
    } catch (err) {
      errors.push(`${market}: ${err.message}`);
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(bodyStr);
    } catch {
      errors.push(`${market}: JSON parse fehlgeschlagen`);
      continue;
    }

    if (!Array.isArray(parsed?.data)) {
      errors.push(`${market}: unbekanntes Schema (keys: ${Object.keys(parsed ?? {}).join(', ')})`);
      continue;
    }

    for (const row of parsed.data) {
      const candidate = tickerMap.get(row.s);
      if (!candidate) continue;
      results.set(candidate.id, buildUpdates(row.d ?? [], candidate));
    }
  }

  if (results.size === 0) {
    const detail = errors.length ? errors.join(' | ') : 'TV hat keine Übereinstimmungen zurückgegeben';
    throw new Error(detail);
  }

  return results;
}
