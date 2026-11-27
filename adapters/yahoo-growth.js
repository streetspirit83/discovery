/**
 * Yahoo Finance Growth Stocks adapter
 *
 * Fetches Yahoo's predefined screeners (undervalued_growth_stocks, growth_technology_stocks,
 * aggressive_small_caps, small_cap_gainers, day_gainers) via the
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

// Seit Nov. 2026 mehrere fertige Yahoo-Screener (gleicher Endpoint, gleiche Antwort, gemessen 23.11.2026).
// Titel aus mehreren Screens werden zu einem Kandidaten mit mehreren Quellen. Mindestens MIN_CAP Börsenwert,
// nur quoteType EQUITY (keine Warrants/ETFs).
const SCREENS = [
  { id: 'undervalued_growth_stocks', label: 'Yahoo Growth Stocks',      count: 25, signal: 'screener_growth' },
  { id: 'growth_technology_stocks',  label: 'Yahoo Growth Tech',        count: 25, signal: 'screener_growth' },
  { id: 'aggressive_small_caps',     label: 'Yahoo Aggressive Small Caps', count: 25, signal: 'screener_growth' },
  { id: 'small_cap_gainers',         label: 'Yahoo Small-Cap Gainers',  count: 25, signal: 'day_gainer' },
  { id: 'day_gainers',               label: 'Yahoo Day Gainers',        count: 25, signal: 'day_gainer' },
];
const MIN_CAP = 300e6;

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

async function fetchScreener(screen) {
  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${screen.id}&count=${screen.count}`;
  let proxy;
  try {
    proxy = await proxyFetch(url);
  } catch (err) {
    log('warn', 'yahoo-growth: proxy call failed', { screen: screen.id, error: err.message });
    return null;
  }
  if (proxy.status !== 200) {
    log('warn', 'yahoo-growth: non-200 upstream', { screen: screen.id, status: proxy.status, preview: proxy.body?.slice(0, 300) });
    return null;
  }
  try {
    const quotes = JSON.parse(proxy.body)?.finance?.result?.[0]?.quotes ?? [];
    log('info', 'yahoo-growth: screener parsed', { screen: screen.id, count: quotes.length });
    return quotes;
  } catch {
    log('warn', 'yahoo-growth: JSON parse failed', { screen: screen.id, preview: proxy.body?.slice(0, 300) });
    return null;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchCandidates() {
  log('info', 'yahoo-growth: starting', { screens: SCREENS.map((s) => s.id) });
  const now = new Date().toISOString();
  const byKey = new Map();
  let ok = 0;

  for (const [si, screen] of SCREENS.entries()) {
    if (si) await sleep(600);
    const quotes = await fetchScreener(screen);
    if (!quotes) continue;
    ok++;
    for (let i = 0; i < quotes.length; i++) {
      const q = quotes[i];
      const symbol = q?.symbol ?? '';
      if (!symbol || !/^[A-Z0-9.]{1,10}$/.test(symbol)) continue;
      if (q?.quoteType && q.quoteType !== 'EQUITY') continue;
      if (q?.marketCap != null && q.marketCap < MIN_CAP) continue;
      const rank = i + 1;
      const source = {
        adapter: 'yahoo-growth',
        source_url: `https://finance.yahoo.com/research-hub/screener/${screen.id}/`,
        discovered_at: now,
        signal_type: screen.signal,
        raw_signal: { screen: screen.id, rank, full_exchange_name: q?.fullExchangeName ?? null, market_cap: q?.marketCap ?? null, change_pct: q?.regularMarketChangePercent ?? null },
        info_snippet: `${screen.label} #${rank}`,
      };
      const known = [...byKey.values()].find((c) => c.symbol === symbol);
      if (known) { known.sources.push(source); continue; }
      const exchange = normalizeExchange(q?.fullExchangeName) ?? await resolveUSExchange(symbol).catch(() => 'NASDAQ');
      byKey.set(`${symbol}:${exchange}`, {
        id: uuidv4(), symbol, exchange, yahoo_symbol: symbol, isin: null, name: q?.longName ?? q?.shortName ?? symbol,
        sources: [source],
        links: buildLinks({ exchange, symbol, yahooSymbol: symbol }),
        workspace_state: 'new', notes: '', enrichment: null, first_discovered_at: now, last_updated_at: now,
      });
    }
  }
  if (!ok) log('warn', 'yahoo-growth: no screener reachable');
  const candidates = [...byKey.values()];
  for (const c of candidates) if (c.sources.length > 1) c.sources[0].info_snippet = `Yahoo: ${c.sources.map((s) => s.info_snippet.replace(/^Yahoo /, '')).join(' · ')}`;
  log('info', 'yahoo-growth: candidates ready', { count: candidates.length });
  return candidates;
}
