/**
 * Börse Frankfurt adapter
 * Fetches trend indicator top-20 stocks from Börse Frankfurt API.
 * Maps to XETR (Xetra) exchange.
 */

import { v4 as uuidv4 } from 'uuid';
import { resolveISIN } from './_shared/isin-resolver.js';
import { buildLinks } from './_shared/link-builder.js';

const log = (level, msg, data = {}) =>
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );

const BF_API_URL =
  'https://api.boerse-frankfurt.de/v1/search/stocks?&limit=20&offset=0&order=desc&sort=TREND_INDICATOR';

const EXCHANGE = 'XETR';

/**
 * Fetch Börse Frankfurt trend list.
 * @returns {Promise<Array>}
 */
async function fetchTrendList() {
  log('info', 'boerse-frankfurt: fetching trend list', { url: BF_API_URL });

  const res = await fetch(BF_API_URL, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (compatible; DiscoveryWorkspace/1.0)',
      Origin: 'https://www.boerse-frankfurt.de',
      Referer: 'https://www.boerse-frankfurt.de/',
    },
  });

  if (!res.ok) {
    throw new Error(`Börse Frankfurt API failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  log('debug', 'boerse-frankfurt: received response', {
    totalCount: data?.totalCount,
    items: data?.data?.length ?? data?.stocks?.length ?? 0,
  });

  // The API might return { data: [...] } or { stocks: [...] } or just an array
  const items = data?.data ?? data?.stocks ?? data?.results ?? (Array.isArray(data) ? data : []);
  log('info', 'boerse-frankfurt: items in trend list', { count: items.length });
  return items;
}

/**
 * Parse a Börse Frankfurt stock item to Discovery candidate.
 * @param {object} item
 * @param {number} rank
 * @returns {Promise<object>}
 */
async function itemToCandidate(item, rank) {
  const now = new Date().toISOString();

  // BF API field names may vary – cover common variants
  const isin = item.isin ?? item.ISIN ?? null;
  const wkn = item.wkn ?? item.WKN ?? null;
  const name = item.name ?? item.companyName ?? item.longName ?? item.shortName ?? 'Unknown';
  const symbol = item.symbol ?? item.ticker ?? item.wkn ?? wkn ?? isin?.slice(-6) ?? 'UNKNOWN';
  const trendValue = item.trendIndicator ?? item.trend ?? item.trendScore ?? null;

  // Build Yahoo symbol: BF stocks are typically .DE for Xetra
  const yahooSymbol = `${symbol}.DE`;

  const links = buildLinks({
    exchange: EXCHANGE,
    symbol,
    yahooSymbol,
  });

  const source = {
    adapter: 'boerse-frankfurt',
    source_url: BF_API_URL,
    discovered_at: now,
    signal_type: 'trend_indicator',
    raw_signal: {
      rank,
      isin,
      wkn,
      name,
      symbol,
      trend_indicator: trendValue,
      raw: item,
    },
    info_snippet: `Ranked #${rank} in Börse Frankfurt trend indicator${trendValue != null ? ` (score: ${trendValue})` : ''}`,
  };

  return {
    id: uuidv4(),
    symbol,
    exchange: EXCHANGE,
    yahoo_symbol: yahooSymbol,
    isin,
    name,
    sources: [source],
    links,
    workspace_state: 'new',
    notes: '',
    enrichment: null,
    first_discovered_at: now,
    last_updated_at: now,
  };
}

/**
 * Main export: fetch candidates from Börse Frankfurt.
 * @returns {Promise<Array>} Discovery candidates
 */
export async function fetchCandidates() {
  const items = await fetchTrendList();

  if (items.length === 0) {
    log('warn', 'boerse-frankfurt: no items returned');
    return [];
  }

  const candidates = [];
  for (let i = 0; i < Math.min(items.length, 20); i++) {
    try {
      const candidate = await itemToCandidate(items[i], i + 1);
      candidates.push(candidate);
    } catch (err) {
      log('warn', 'boerse-frankfurt: failed to parse item', { index: i, error: err.message });
    }
  }

  log('info', 'boerse-frankfurt: produced candidates', { count: candidates.length });
  return candidates;
}
