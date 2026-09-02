/**
 * StockTwits Trending adapter
 *
 * Fetches the top-30 trending symbols from the public StockTwits API.
 * No API key required. Filters out crypto (.X) and non-standard symbols.
 *
 * Exchange and ISIN come straight out of the trending response (`exchange`,
 * `symbol_mic`, `isin`) — verified against a live response, not assumed. The
 * external US-exchange resolver is only a fallback now, which removes up to 30
 * FMP/TwelveData roundtrips per run and gives every candidate an ISIN, so the
 * TR-check works without a separate lookup.
 *
 * `trends.summary` is a ready-made explanation of *why* a symbol is trending;
 * it becomes the info_snippet instead of the bare rank.
 *
 * Update frequency: StockTwits refreshes trending list every 15 min.
 * Workflow runs 3× daily (08:23 / 13:23 / 20:23 UTC) to capture pre-market,
 * US-open and after-hours sentiment shifts.
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

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

// Die Trending-Response trägt Börse und MIC bereits mit (`exchange: "NASDAQ"`,
// `symbol_mic: "PSKY.XNAS"`). Das direkt zu lesen spart pro Lauf bis zu 30
// FMP/TwelveData-Roundtrips — der Resolver bleibt nur als Fallback.
const MIC_MAP = { XNAS: 'NASDAQ', XNYS: 'NYSE', XASE: 'AMEX' };

function exchangeFromPayload(s) {
  const ex = String(s.exchange ?? '').toUpperCase();
  if (ex.includes('NASDAQ')) return 'NASDAQ';
  if (ex.includes('NYSE'))   return 'NYSE';
  if (ex.includes('AMEX'))   return 'AMEX';

  const mic = String(s.symbol_mic ?? '').split('.')[1]?.toUpperCase();
  return MIC_MAP[mic] ?? null;
}

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
    const rank = s.rank ?? i + 1;

    // Erst aus der Response lesen; nur wenn die nichts hergibt, extern auflösen.
    let exchange = exchangeFromPayload(s);
    if (!exchange) {
      exchange = await resolveUSExchange(ticker).catch(() => 'NASDAQ');
      await sleep(50); // nur der externe Lookup braucht die Pause
    }

    const isin = String(s.isin ?? '').trim().toUpperCase();
    const summary = String(s.trends?.summary ?? '').trim();

    log('debug', 'stocktwits: resolved', {
      ticker, rank, exchange, isin: isin || null, watchlistCount: s.watchlist_count,
    });

    candidates.push({
      id: uuidv4(),
      symbol: ticker,
      exchange,
      yahoo_symbol: ticker,
      isin: ISIN_RE.test(isin) ? isin : null,
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
          trending_score: s.trending_score ?? null,
          cusip: s.cusip ?? null,
        },
        // StockTwits liefert eine fertige Begründung, warum der Titel gerade
        // läuft. Die ist als Aufhänger im Review deutlich mehr wert als der
        // blosse Rang — der bleibt als Präfix davor stehen.
        info_snippet: summary
          ? `StockTwits Trending #${rank} · ${summary}`
          : `StockTwits Trending #${rank}${s.watchlist_count ? ` · ${s.watchlist_count.toLocaleString()} on watchlist` : ''}`,
      }],
      links: buildLinks({ exchange, symbol: ticker, yahooSymbol: ticker }),
      workspace_state: 'new',
      notes: '',
      enrichment: null,
      first_discovered_at: now,
      last_updated_at: now,
    });
  }

  log('info', 'stocktwits: candidates ready', { count: candidates.length });
  return candidates;
}
