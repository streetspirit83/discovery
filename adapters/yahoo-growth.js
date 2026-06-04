/**
 * Yahoo Finance Growth Stocks adapter
 *
 * Fetches Yahoo's predefined "undervalued_growth_stocks" screener via the
 * Netlify scrape-proxy (AWS IP, browser headers). GitHub Actions (Azure) is
 * range-blocked by Yahoo; Netlify is not.
 *
 * Endpoint (GET):
 *   query1.finance.yahoo.com/v1/finance/screener/predefined/saved
 *     ?scrIds=undervalued_growth_stocks&count=25
 *   Requires Origin + Referer to pass Yahoo's bot filter.
 *
 * Response shape (same envelope as the trending API):
 *   { finance: { result: [ { quotes: [ { symbol, fullExchangeName, longName } ] } ] } }
 *
 * Signal: screener membership – rank reflects Yahoo's own ordering.
 */

import { v4 as uuidv4 } from 'uuid';
import { buildLinks } from './_shared/link-builder.js';
import { resolveUSExchange } from './_shared/us-exchange-resolver.js';

const log = (level, msg, data = {}) =>
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCREEN_ID = 'undervalued_growth_stocks';
const COUNT     = 25;

// Browser headers that pass Yahoo's bot filter (same set as yahoo-trending)
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.5',
  'Origin': 'https://finance.yahoo.com',
  'Referer': 'https://finance.yahoo.com/',
};

// ─── Proxy helper ─────────────────────────────────────────────────────────────

async function proxyFetch(url, extraHeaders = {}) {
  const backendUrl = process.env.DISCOVERY_BACKEND_URL;
  const secret     = process.env.DISCOVERY_SECRET;
  if (!backendUrl || !secret) throw new Error('DISCOVERY_BACKEND_URL / DISCOVERY_SECRET not set');

  const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
    body: JSON.stringify({
      url,
      method: 'GET',
      headers: { ...BROWSER_HEADERS, ...extraHeaders },
    }),
  });

  if (!res.ok) throw new Error(`Proxy responded ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`Proxy error: ${data.error}`);
  return data; // { status, body, content_type }
}

// ─── Exchange normalisation ───────────────────────────────────────────────────

// Yahoo's fullExchangeName ("NasdaqGS", "NYSEArca", …) → the standard codes the
// rest of the system expects (NASDAQ / NYSE / AMEX / XETR). Returns null when
// unknown so the caller can fall back to resolveUSExchange().
function normalizeExchange(fullExchangeName) {
  if (!fullExchangeName) return null;
  const n = fullExchangeName.toLowerCase();
  if (n.includes('nasdaq'))                 return 'NASDAQ';
  if (n.includes('arca'))                   return 'AMEX';   // NYSE Arca
  if (n.includes('american'))               return 'AMEX';   // NYSE American
  if (n.includes('nyse'))                   return 'NYSE';
  if (n.includes('xetra'))                  return 'XETR';
  if (n.includes('cboe') || n.includes('bats')) return 'AMEX';
  return null;
}

// ─── Fetch screener ───────────────────────────────────────────────────────────

async function fetchScreener() {
  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${SCREEN_ID}&count=${COUNT}`;
  log('info', 'yahoo-growth: fetching screener', { screen: SCREEN_ID, url });

  let proxy;
  try {
    proxy = await proxyFetch(url);
  } catch (err) {
    log('warn', 'yahoo-growth: proxy call failed', { error: err.message });
    return [];
  }

  log('debug', 'yahoo-growth: upstream status', { status: proxy.status, size: proxy.body?.length });

  if (proxy.status !== 200) {
    log('warn', 'yahoo-growth: non-200 upstream', { status: proxy.status, preview: proxy.body?.slice(0, 300) });
    return [];
  }

  let data;
  try {
    data = JSON.parse(proxy.body);
  } catch {
    log('warn', 'yahoo-growth: JSON parse failed', { preview: proxy.body?.slice(0, 300) });
    return [];
  }

  const quotes = data?.finance?.result?.[0]?.quotes ?? [];
  log('info', 'yahoo-growth: screener parsed', { count: quotes.length });
  return quotes;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchCandidates() {
  log('info', 'yahoo-growth: starting', { screen: SCREEN_ID });

  const now    = new Date().toISOString();
  const quotes = await fetchScreener();
  const candidates = [];

  for (let i = 0; i < quotes.length; i++) {
    const q      = quotes[i];
    const symbol = q?.symbol ?? '';
    if (!symbol) continue;

    if (!/^[A-Z0-9.]{1,10}$/.test(symbol)) {
      log('debug', 'yahoo-growth: skipping non-standard symbol', { symbol });
      continue;
    }

    const rank     = i + 1;
    const exchange = normalizeExchange(q?.fullExchangeName)
      ?? await resolveUSExchange(symbol).catch(() => 'NASDAQ');

    candidates.push({
      id: uuidv4(),
      symbol,
      exchange,
      yahoo_symbol: symbol,
      isin: null,
      name: q?.longName ?? symbol,
      sources: [{
        adapter: 'yahoo-growth',
        source_url: 'https://finance.yahoo.com/research-hub/screener/undervalued_growth_stocks/',
        discovered_at: now,
        signal_type: 'screener_growth',
        raw_signal: {
          screen: SCREEN_ID,
          rank,
          full_exchange_name: q?.fullExchangeName ?? null,
        },
        info_snippet: `Yahoo Growth Stocks #${rank}`,
      }],
      links: buildLinks({ exchange, symbol, yahooSymbol: symbol }),
      workspace_state: 'new',
      notes: '',
      enrichment: null,
      first_discovered_at: now,
      last_updated_at: now,
    });

    await sleep(50);
  }

  log('info', 'yahoo-growth: candidates ready', { count: candidates.length });
  return candidates;
}
