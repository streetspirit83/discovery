/**
 * TradingView Screener adapter
 *
 * Uses the unofficial (but stable) TradingView scanner endpoint:
 *   POST https://scanner.tradingview.com/{market}/scan
 *
 * Cloud IPs (Azure/GitHub Actions) are blocked by TradingView → all requests
 * route through the Netlify scrape-proxy (AWS IPs, different range).
 *
 * SCREENS array drives all fetches. Add new screens here to extend:
 *   - Option A (active): Volume Spike – relative volume > 2.5× 10-day average
 *   - Option B (future): Technical Momentum – RSI + EMA + MACD filters
 *
 * Response format: { data: [{ s: "NASDAQ:AAPL", d: [...columnValues] }] }
 * Exchange is parsed from the "s" prefix; unknown exchanges are skipped.
 */

import { v4 as uuidv4 } from 'uuid';
import { buildLinks } from './_shared/link-builder.js';
import { resolveUSExchange } from './_shared/us-exchange-resolver.js';

const log = (level, msg, data = {}) =>
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Columns requested from every screen – index order matters for parsing
const COLUMNS = ['description', 'close', 'volume', 'relative_volume_10d_calc'];
const COL = { name: 0, close: 1, volume: 2, relVol: 3 };

// ─── Screen definitions ───────────────────────────────────────────────────────
// Each screen is independent. Add Option B here when ready.

const SCREENS = [
  {
    id:         'volume-spike-us',
    label:      'Volume Spike US',
    endpoint:   'https://scanner.tradingview.com/america/scan',
    region:     'US',
    count:      50,
    signal_type: 'volume_spike',
    filter: [
      { left: 'type',                       operation: 'equal',   right: 'stock'                      },
      { left: 'subtype',                    operation: 'in',      right: ['common', 'foreign-issuer'] },
      { left: 'close',                      operation: 'greater', right: 5                            }, // no penny stocks
      { left: 'volume',                     operation: 'greater', right: 500000                       },
      { left: 'relative_volume_10d_calc',   operation: 'greater', right: 2.5                          },
    ],
  },
  {
    id:         'volume-spike-de',
    label:      'Volume Spike DE',
    endpoint:   'https://scanner.tradingview.com/germany/scan',
    region:     'DE',
    count:      30,
    signal_type: 'volume_spike',
    filter: [
      { left: 'type',                       operation: 'equal',   right: 'stock'    },
      { left: 'volume',                     operation: 'greater', right: 50000      },
      { left: 'relative_volume_10d_calc',   operation: 'greater', right: 2.5        },
    ],
  },
];

// ─── Exchange normalisation ───────────────────────────────────────────────────

// TradingView exchange prefix → our exchange identifier
const TV_EXCHANGE_MAP = {
  'NASDAQ':   'NASDAQ',
  'NYSE':     'NYSE',
  'NYSE ARCA':'NYSE',
  'NYSE MKT': 'AMEX',
  'AMEX':     'AMEX',
  'XETR':     'XETR',
  'FWB':      null,   // Frankfurt regular listing – prefer XETR, skip duplicates
  'SWB':      null,   // Stuttgart
};

function parseTicker(s) {
  const colon = s.indexOf(':');
  if (colon === -1) return null;
  const tvExch = s.slice(0, colon);
  const symbol = s.slice(colon + 1);
  const exchange = TV_EXCHANGE_MAP[tvExch] ?? null;
  return exchange ? { symbol, exchange, tvExch } : null;
}

// ─── Proxy helper ─────────────────────────────────────────────────────────────

async function proxyPost(url, requestBody) {
  const backendUrl = process.env.DISCOVERY_BACKEND_URL;
  const secret     = process.env.DISCOVERY_SECRET;
  if (!backendUrl || !secret) throw new Error('DISCOVERY_BACKEND_URL / DISCOVERY_SECRET not set');

  const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
    body:    JSON.stringify({
      url,
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    requestBody,
    }),
  });

  if (!res.ok) throw new Error(`Proxy responded ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`Proxy error: ${data.error}`);
  return data; // { status, body, content_type }
}

// ─── Fetch one screen ─────────────────────────────────────────────────────────

async function runScreen(screen) {
  log('info', 'tradingview-screener: running screen', { id: screen.id, count: screen.count });

  const requestBody = {
    filter:  screen.filter,
    columns: COLUMNS,
    sort:    { sortBy: 'relative_volume_10d_calc', sortOrder: 'desc' },
    range:   [0, screen.count],
  };

  let proxy;
  try {
    proxy = await proxyPost(screen.endpoint, requestBody);
  } catch (err) {
    log('warn', 'tradingview-screener: proxy error', { id: screen.id, error: err.message });
    return [];
  }

  log('debug', 'tradingview-screener: upstream status', { id: screen.id, status: proxy.status });
  if (proxy.status !== 200) {
    log('warn', 'tradingview-screener: non-200 from scanner', { id: screen.id, status: proxy.status });
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(proxy.body);
  } catch {
    log('warn', 'tradingview-screener: JSON parse failed', { id: screen.id });
    return [];
  }

  // Schema guard – surface drift immediately rather than silently returning nothing
  if (!Array.isArray(parsed?.data)) {
    log('error', 'tradingview-screener: unexpected schema – data array missing', {
      id:      screen.id,
      topKeys: Object.keys(parsed ?? {}).slice(0, 10),
    });
    return [];
  }

  log('info', 'tradingview-screener: screen done', { id: screen.id, rows: parsed.data.length });
  return parsed.data;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchCandidates() {
  log('info', 'tradingview-screener: starting', { screens: SCREENS.map((s) => s.id) });

  const now        = new Date().toISOString();
  const candidates = [];
  const seen       = new Set(); // dedup within this run (same symbol can appear in multiple screens)

  for (const screen of SCREENS) {
    const rows = await runScreen(screen);

    for (let rank = 0; rank < rows.length; rank++) {
      const row = rows[rank];
      const parsed = parseTicker(row.s ?? '');
      if (!parsed) continue;

      const { symbol, exchange, tvExch } = parsed;

      // Basic symbol sanity check
      if (!/^[A-Z0-9]{1,12}$/.test(symbol)) {
        log('debug', 'tradingview-screener: skipping non-standard symbol', { raw: row.s });
        continue;
      }

      const key = `${symbol}:${exchange}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const d         = row.d ?? [];
      const name      = d[COL.name]   ?? symbol;
      const close     = d[COL.close]  ?? null;
      const volume    = d[COL.volume] ?? null;
      const relVol    = d[COL.relVol] ?? null;

      // For US tickers, prefer the TradingView exchange over generic resolver
      // (TV already tells us NASDAQ vs NYSE vs AMEX directly)
      const resolvedExchange = exchange;

      const yahooSymbol = exchange === 'XETR' ? `${symbol}.DE` : symbol;

      candidates.push({
        id:           uuidv4(),
        symbol,
        exchange:     resolvedExchange,
        yahoo_symbol: yahooSymbol,
        isin:         null,
        name,
        sources: [{
          adapter:        'tradingview-screener',
          source_url:     screen.endpoint,
          discovered_at:  now,
          signal_type:    screen.signal_type,
          raw_signal:     { screen: screen.id, rank: rank + 1, relVol, volume, close, tvExch },
          info_snippet:   `TradingView ${screen.label} #${rank + 1} – Rel. Vol ${relVol?.toFixed(1) ?? '?'}×`,
        }],
        links:              buildLinks({ exchange: resolvedExchange, symbol, yahooSymbol }),
        workspace_state:    'new',
        notes:              '',
        enrichment:         null,
        first_discovered_at: now,
        last_updated_at:    now,
      });
    }

    log('info', 'tradingview-screener: screen candidates', { id: screen.id, added: candidates.length });
    if (screen !== SCREENS[SCREENS.length - 1]) await sleep(1000);
  }

  log('info', 'tradingview-screener: candidates ready', { count: candidates.length });
  return candidates;
}
