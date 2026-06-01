/**
 * TradingView bulk enrichment – browser-side
 *
 * Uses the scanner API's symbols.tickers batch lookup:
 * POST https://scanner.tradingview.com/scan
 * Body: { markets: ["america"], symbols: { tickers: ["NASDAQ:AAPL", ...] }, columns: [...] }
 *
 * This is the correct per-ticker API — no filter needed, no client-side matching.
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
  'description',               // 0
  'sector',                    // 1
  'industry',                  // 2
  'close',                     // 3
  'change',                    // 4
  'change|1W',                 // 5
  'change|1M',                 // 6
  'Volatility.D',              // 7
  'beta_1_year',               // 8
  'average_volume_10d_calc',   // 9
  'market_cap_basic',          // 10
  'price_earnings_ttm',        // 11
  'dividend_yield_recent',     // 12
  'Recommend.All',             // 13
  'RSI',                       // 14
  'EMA20',                     // 15
  'EMA50',                     // 16
  'EMA200',                    // 17
  'MACD.macd',                 // 18
  'ADX',                       // 19
  'high|52W',                  // 20
  'earnings_release_next_date',// 21
];

const COL = {
  description:   0,
  sector:        1,
  industry:      2,
  close:         3,
  change:        4,
  change1W:      5,
  change1M:      6,
  volatility:    7,
  beta:          8,
  avgVol10d:     9,
  marketCap:     10,
  pe:            11,
  dividendYield: 12,
  rating:        13,
  rsi:           14,
  ema20:         15,
  ema50:         16,
  ema200:        17,
  macd:          18,
  adx:           19,
  high52w:       20,
  earningsDate:  21,
};

// ─── Proxy POST ───────────────────────────────────────────────────────────────

async function proxyPost(backendUrl, secret, url, requestBody) {
  const proxyUrl = `${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`;

  console.group(`[TV] POST ${url}`);
  console.log('[TV] Proxy URL:', proxyUrl);
  console.log('[TV] Request body:', JSON.stringify(requestBody, null, 2));

  let res;
  try {
    res = await fetch(proxyUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
      body: JSON.stringify({
        url,
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    requestBody,
      }),
    });
  } catch (fetchErr) {
    console.error('[TV] Proxy fetch failed (network):', fetchErr);
    console.groupEnd();
    throw new Error(`Proxy network error: ${fetchErr.message}`);
  }

  console.log('[TV] Proxy response status:', res.status);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[TV] Proxy HTTP error body:', text);
    console.groupEnd();
    throw new Error(`Proxy HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  let wrapper;
  try {
    wrapper = await res.json();
  } catch (jsonErr) {
    console.error('[TV] Proxy response not JSON:', jsonErr);
    console.groupEnd();
    throw new Error('Proxy returned non-JSON');
  }

  console.log('[TV] Proxy wrapper:', { ok: wrapper.ok, status: wrapper.status, error: wrapper.error, bodyLen: wrapper.body?.length });

  if (!wrapper.ok) {
    console.error('[TV] Proxy error:', wrapper.error);
    console.groupEnd();
    throw new Error(`Proxy: ${wrapper.error}`);
  }
  if (wrapper.status !== 200) {
    console.error('[TV] Upstream HTTP error. Body preview:', wrapper.body?.slice(0, 500));
    console.groupEnd();
    throw new Error(`TV HTTP ${wrapper.status} – ${wrapper.body?.slice(0, 200)}`);
  }

  console.log('[TV] Upstream body (first 500 chars):', wrapper.body?.slice(0, 500));
  console.groupEnd();

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
      rating:        d[COL.rating]       ?? null,
      pe_ttm:        d[COL.pe]           ?? null,
      market_cap:    d[COL.marketCap]    ?? null,
      close:         d[COL.close]        ?? null,
      change_1d:     d[COL.change]       ?? null,
      change_1w:     d[COL.change1W]     ?? null,
      change_1m:     d[COL.change1M]     ?? null,
      volatility:    d[COL.volatility]   ?? null,
      beta:          d[COL.beta]         ?? null,
      avg_vol_10d:   d[COL.avgVol10d]    ?? null,
      dividend_yield:d[COL.dividendYield]?? null,
      rsi:           d[COL.rsi]          ?? null,
      ema20:         d[COL.ema20]        ?? null,
      ema50:         d[COL.ema50]        ?? null,
      ema200:        d[COL.ema200]       ?? null,
      macd:          d[COL.macd]         ?? null,
      adx:           d[COL.adx]          ?? null,
      high_52w:      d[COL.high52w]      ?? null,
      earnings_next_date: d[COL.earningsDate] ?? null,
      fetched_at:    new Date().toISOString(),
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

  if (d[COL.rating] != null) {
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
  console.group('[TV] fetchTVEnrichment start');
  console.log('[TV] candidates:', candidates.map((c) => `${c.exchange}:${c.symbol}`));

  // Group by TV market
  const groups   = new Map(); // market → [{candidate, tvTicker}]
  const noMarket = [];

  for (const c of candidates) {
    const market = EXCHANGE_TO_MARKET[c.exchange];
    const prefix = TV_PREFIX_MAP[c.exchange];
    if (!market || !prefix) {
      console.warn('[TV] Unknown exchange:', c.exchange, 'for', c.symbol);
      noMarket.push(`${c.symbol}(${c.exchange ?? '?'})`);
      continue;
    }
    if (!groups.has(market)) groups.set(market, []);
    groups.get(market).push({ candidate: c, tvTicker: `${prefix}:${c.symbol}` });
  }

  console.log('[TV] groups:', Object.fromEntries([...groups.entries()].map(([m, e]) => [m, e.map((x) => x.tvTicker)])));
  console.log('[TV] noMarket:', noMarket);
  console.groupEnd();

  if (groups.size === 0) {
    throw new Error(`Keine bekannten Exchanges – ${noMarket.join(', ')}`);
  }

  const results = new Map();
  let marketIdx = 0;

  for (const [market, entries] of groups) {
    marketIdx++;
    const tvTickers = entries.map((e) => e.tvTicker);
    onProgress?.(`📊 ${marketIdx}/${groups.size} – ${market}: ${tvTickers.join(', ')}…`);

    // Build lookup: tvTicker → candidate
    const tvTickerMap = new Map(entries.map((e) => [e.tvTicker, e.candidate]));

    const requestBody = {
      markets: [market],
      symbols: { tickers: tvTickers },
      columns: TV_COLUMNS,
    };

    let bodyStr;
    try {
      bodyStr = await proxyPost(backendUrl, secret,
        `https://scanner.tradingview.com/${market}/scan`,
        requestBody,
      );
    } catch (err) {
      console.warn(`[TV] ${market} failed:`, err.message);
      onProgress?.(`⚠️ ${market}: ${err.message}`);
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(bodyStr);
    } catch (parseErr) {
      console.warn(`[TV] ${market}: JSON parse error on body:`, bodyStr?.slice(0, 300));
      onProgress?.(`⚠️ ${market}: JSON parse fehlgeschlagen`);
      continue;
    }

    console.group(`[TV] ${market} response`);
    console.log('[TV] totalCount:', parsed?.totalCount);
    console.log('[TV] data rows:', parsed?.data?.length ?? 0);
    // Per-column dump for the first row so we can verify which fields return data
    const firstRow = parsed?.data?.[0];
    if (firstRow?.d) {
      console.group(`[TV] columns for ${firstRow.s}`);
      TV_COLUMNS.forEach((name, i) => {
        const v = firstRow.d[i];
        console.log(`  ${name}: ${v === null ? 'null' : v === undefined ? 'undefined' : JSON.stringify(v)}`);
      });
      console.groupEnd();
    }
    console.groupEnd();

    const rows = parsed?.data ?? [];
    onProgress?.(`✅ ${market}: ${rows.length} Treffer für ${tvTickers.length} Ticker`);

    let matched = 0;
    for (const row of rows) {
      const candidate = tvTickerMap.get(row.s);
      if (candidate) {
        results.set(candidate.id, buildUpdates(row.d ?? [], candidate));
        matched++;
      } else {
        console.warn('[TV] No candidate for ticker:', row.s);
      }
    }

    if (matched < tvTickers.length) {
      const missing = tvTickers.filter((t) => !rows.find((r) => r.s === t));
      console.warn('[TV] No TV data for:', missing);
      onProgress?.(`⚠️ ${market}: ${missing.length} Ticker ohne Daten: ${missing.join(', ')}`);
    }
  }

  if (results.size === 0) {
    const detail = noMarket.length === candidates.length
      ? `Keine bekannten Exchanges: ${noMarket.join(', ')}`
      : 'Keine TV-Daten – Exchange/Symbol prüfen (Details im Browser Console)';
    throw new Error(detail);
  }

  return results;
}
