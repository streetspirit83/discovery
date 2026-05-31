/**
 * TradingView bulk enrichment – browser-side
 *
 * Groups candidates by exchange → TV market endpoint, fires one POST per
 * market group through the Netlify scrape-proxy, maps the response to
 * Schema A compatible top-level fields + tv_data{} for raw values.
 */

// Exchange → scanner.tradingview.com/{market}/scan
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

// Columns sent to TV – index order matters for COL map below
const TV_COLUMNS = [
  'description',
  'close',
  'market_cap_basic',
  'price_earnings_ttm',
  'price_to_book_ratio',
  'Recommend.All',
  'sector',
  'industry',
  'earnings_release_next_date',
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
  if (!res.ok) throw new Error(`Proxy ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`Proxy error: ${data.error}`);
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
  // TV returns Unix seconds or ISO string
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  if (isNaN(d)) return null;
  return `Earnings: ${d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function buildUpdates(d, candidate) {
  const updates = {
    asset_type: 'Stock',
    scan_date:  new Date().toISOString().split('T')[0],
    tv_data: {
      rating:            d[COL.rating]      ?? null,
      pe_ttm:            d[COL.pe]          ?? null,
      pb_ratio:          d[COL.pb]          ?? null,
      market_cap:        d[COL.marketCap]   ?? null,
      close:             d[COL.close]       ?? null,
      earnings_next_date: d[COL.earningsDate] ?? null,
      fetched_at:        new Date().toISOString(),
    },
  };

  if (d[COL.description] && (!candidate.name || candidate.name === candidate.symbol)) {
    updates.name = d[COL.description];
  }
  if (d[COL.sector])    updates.sector     = d[COL.sector];
  if (d[COL.industry])  updates.sub_sector = d[COL.industry];
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
 * Fetch TV enrichment data for a list of candidates.
 * Groups by exchange → one TV call per market.
 *
 * @param {object[]} candidates
 * @param {{ backendUrl: string, secret: string }} opts
 * @returns {Promise<Map<string, object>>}  candidateId → updates object
 */
export async function fetchTVEnrichment(candidates, { backendUrl, secret }) {
  // Group by TV market endpoint
  const groups = new Map(); // market → [candidate]
  for (const c of candidates) {
    const market = EXCHANGE_TO_MARKET[c.exchange];
    if (!market) continue;
    if (!groups.has(market)) groups.set(market, []);
    groups.get(market).push(c);
  }

  const results = new Map(); // candidateId → updates

  for (const [market, group] of groups) {
    const symbols = group.map((c) => c.symbol);
    const url = `https://scanner.tradingview.com/${market}/scan`;

    let proxy;
    try {
      proxy = await proxyPost(backendUrl, secret, url, {
        filter:  [{ left: 'name', operation: 'in', right: symbols }],
        columns: TV_COLUMNS,
        range:   [0, symbols.length],
      });
    } catch (err) {
      console.warn(`tv-enrichment: proxy failed for ${market}:`, err.message);
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(proxy.body);
    } catch {
      console.warn(`tv-enrichment: JSON parse failed for ${market}`);
      continue;
    }

    if (!Array.isArray(parsed?.data)) {
      console.warn(`tv-enrichment: unexpected schema for ${market}`, Object.keys(parsed ?? {}));
      continue;
    }

    // Build symbol → row lookup from TV response
    const rowBySymbol = new Map();
    for (const row of parsed.data) {
      const colon = (row.s ?? '').indexOf(':');
      if (colon !== -1) rowBySymbol.set(row.s.slice(colon + 1), row.d ?? []);
    }

    for (const candidate of group) {
      const d = rowBySymbol.get(candidate.symbol);
      if (!d) continue;
      results.set(candidate.id, buildUpdates(d, candidate));
    }
  }

  return results;
}
