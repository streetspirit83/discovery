/**
 * TradingView bulk enrichment – browser-side
 *
 * One scanner request per symbol using filter name=equal=TICKER —
 * the same filter pattern our screener adapter uses (confirmed working).
 * Grouped by market to use the correct endpoint, with 150ms between calls.
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
  if (!wrapper.ok) throw new Error(`Proxy: ${wrapper.error}`);
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
  const results   = new Map();
  const noMarket  = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const market    = EXCHANGE_TO_MARKET[candidate.exchange];

    if (!market) {
      noMarket.push(`${candidate.symbol}(${candidate.exchange ?? '?'})`);
      continue;
    }

    onProgress?.(`📊 ${i + 1}/${candidates.length} – ${candidate.symbol}`);

    const url = `https://scanner.tradingview.com/${market}/scan`;
    let bodyStr;
    try {
      bodyStr = await proxyPost(backendUrl, secret, url, {
        filter:  [{ left: 'name', operation: 'equal', right: candidate.symbol }],
        columns: TV_COLUMNS,
        range:   [0, 1],
      });
    } catch (err) {
      console.warn(`tv-enrichment: ${candidate.symbol} – ${err.message}`);
      if (i < candidates.length - 1) await sleep(150);
      continue;
    }

    try {
      const parsed = JSON.parse(bodyStr);
      const row    = parsed?.data?.[0];
      if (row) results.set(candidate.id, buildUpdates(row.d ?? [], candidate));
    } catch {
      console.warn(`tv-enrichment: JSON parse failed for ${candidate.symbol}`);
    }

    if (i < candidates.length - 1) await sleep(150);
  }

  if (results.size === 0) {
    const detail = noMarket.length === candidates.length
      ? `Keine bekannten Exchanges: ${noMarket.join(', ')}`
      : 'TV hat für kein Symbol Daten zurückgegeben';
    throw new Error(detail);
  }

  return results;
}
