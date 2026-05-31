/**
 * TradingView bulk enrichment – browser-side
 *
 * Fetches all stocks from each TV market endpoint (no name filter — name
 * filtering appears unreliable in the scanner API) and matches by the
 * "EXCHANGE:SYMBOL" s-field client-side.
 *
 * Uses only confirmed-working API patterns: type=equal=stock filter,
 * same format as the screener adapter.
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
  'description',                // 0 – company name
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

// Fetch enough rows to cover most liquid stocks per market
const SCAN_RANGE = 3000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (!wrapper.ok)          throw new Error(`Proxy: ${wrapper.error}`);
  if (wrapper.status !== 200) throw new Error(`TV HTTP ${wrapper.status}`);
  return wrapper.body;
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
 * @param {{ backendUrl: string, secret: string, onProgress?: (msg: string) => void }} opts
 * @returns {Promise<Map<string, object>>}  candidateId → updates
 */
export async function fetchTVEnrichment(candidates, { backendUrl, secret, onProgress }) {
  // Group by TV market endpoint
  const groups   = new Map(); // market → [{candidate, tvTicker}]
  const noMarket = [];

  for (const c of candidates) {
    const market = EXCHANGE_TO_MARKET[c.exchange];
    const prefix = TV_PREFIX_MAP[c.exchange];
    if (!market || !prefix) { noMarket.push(`${c.symbol}(${c.exchange ?? '?'})`); continue; }
    if (!groups.has(market)) groups.set(market, []);
    groups.get(market).push({ candidate: c, tvTicker: `${prefix}:${c.symbol}` });
  }

  if (groups.size === 0) {
    throw new Error(`Keine bekannten Exchanges – ${noMarket.join(', ')}`);
  }

  const results = new Map();
  let marketIdx = 0;

  for (const [market, entries] of groups) {
    marketIdx++;
    onProgress?.(`📊 ${marketIdx}/${groups.size} – ${market} (${entries.length} Symbole)…`);

    // Build lookup: tvTicker → candidate
    const tvTickerMap = new Map(entries.map((e) => [e.tvTicker, e.candidate]));

    let bodyStr;
    try {
      bodyStr = await proxyPost(backendUrl, secret,
        `https://scanner.tradingview.com/${market}/scan`,
        {
          filter:  [{ left: 'type', operation: 'equal', right: 'stock' }],
          columns: TV_COLUMNS,
          sort:    { sortBy: 'market_cap_basic', sortOrder: 'desc' },
          range:   [0, SCAN_RANGE],
        },
      );
    } catch (err) {
      // Surface error in toast via re-throw after other markets are tried
      console.warn(`tv-enrichment ${market}: ${err.message}`);
      onProgress?.(`⚠️ ${market}: ${err.message}`);
      if (marketIdx < groups.size) await sleep(1000);
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(bodyStr);
    } catch {
      console.warn(`tv-enrichment ${market}: JSON parse failed`);
      if (marketIdx < groups.size) await sleep(1000);
      continue;
    }

    const rows = parsed?.data ?? [];
    for (const row of rows) {
      const candidate = tvTickerMap.get(row.s);
      if (candidate) results.set(candidate.id, buildUpdates(row.d ?? [], candidate));
    }

    if (marketIdx < groups.size) await sleep(1000);
  }

  if (results.size === 0) {
    const detail = noMarket.length === candidates.length
      ? `Keine bekannten Exchanges: ${noMarket.join(', ')}`
      : 'Keine Übereinstimmungen – Symbole möglicherweise unter $100M Market Cap oder falsche Exchange';
    throw new Error(detail);
  }

  return results;
}
