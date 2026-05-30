/**
 * StockTwits Trending adapter
 *
 * Fetches the top-30 trending symbols from the public StockTwits API.
 * No API key required. Filters out crypto (.X) and non-standard symbols.
 * Exchange resolved via existing US exchange resolver.
 *
 * Update frequency: StockTwits refreshes trending list every 15 min.
 * Workflow runs twice daily (08:00 + 20:00 UTC) to capture pre-market
 * and after-hours sentiment shifts.
 */

import { v4 as uuidv4 } from 'uuid';
import { buildLinks } from './_shared/link-builder.js';
import { resolveUSExchange } from './_shared/us-exchange-resolver.js';

const log = (level, msg, data = {}) =>
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TRENDING_URL = 'https://api.stocktwits.com/api/2/trending/symbols.json';

// Only standard equity tickers: 1-5 uppercase letters, no suffix like .X (crypto)
const EQUITY_TICKER_RE = /^[A-Z]{1,5}$/;

export async function fetchCandidates() {
  log('info', 'stocktwits: fetching trending symbols', { url: TRENDING_URL });

  let data;
  try {
    const res = await fetch(TRENDING_URL, {
      headers: {
        'User-Agent': 'DiscoveryWorkspace/1.0 david.krehan@gmail.com',
        Accept: 'application/json',
      },
    });
    if (res.status === 429) {
      log('error', 'stocktwits: rate limit hit (429)');
      return [];
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    log('error', 'stocktwits: fetch failed', { error: err.message });
    return [];
  }

  if (data?.response?.status !== 200) {
    log('error', 'stocktwits: API error', { status: data?.response?.status });
    return [];
  }

  const symbols = (data?.symbols ?? []).filter((s) => EQUITY_TICKER_RE.test(s.symbol ?? ''));
  log('info', 'stocktwits: equity symbols after filter', { total: data?.symbols?.length ?? 0, equity: symbols.length });

  if (symbols.length === 0) return [];

  const now = new Date().toISOString();
  const candidates = [];

  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i];
    const ticker = s.symbol;
    const rank = i + 1;

    const exchange = await resolveUSExchange(ticker).catch(() => 'NASDAQ');
    log('debug', 'stocktwits: resolved', { ticker, rank, exchange, watchlistCount: s.watchlist_count });

    candidates.push({
      id: uuidv4(),
      symbol: ticker,
      exchange,
      yahoo_symbol: ticker,
      isin: null,
      name: s.title ?? ticker,
      sources: [{
        adapter: 'stocktwits',
        source_url: `https://stocktwits.com/symbol/${ticker}`,
        discovered_at: now,
        signal_type: 'social_trending',
        raw_signal: {
          rank,
          ticker,
          title: s.title,
          watchlist_count: s.watchlist_count ?? null,
        },
        info_snippet: `StockTwits Trending #${rank}${s.watchlist_count ? ` · ${s.watchlist_count.toLocaleString()} on watchlist` : ''}`,
      }],
      links: buildLinks({ exchange, symbol: ticker, yahooSymbol: ticker }),
      workspace_state: 'new',
      notes: '',
      enrichment: null,
      first_discovered_at: now,
      last_updated_at: now,
    });

    await sleep(50); // brief pause between exchange lookups
  }

  log('info', 'stocktwits: candidates ready', { count: candidates.length });
  return candidates;
}
