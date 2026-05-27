/**
 * ETF Holdings Adapter – iShares Clean Energy ETF
 * Downloads the CSV of holdings and returns new additions + significant weight changes.
 */

import { resolveExchangeFromYahooSymbol } from './_shared/exchange-mapper.js';
import { resolveUSExchange } from './_shared/us-exchange-resolver.js';
import { buildLinks } from './_shared/link-builder.js';
import { v4 as uuidv4 } from 'uuid';

const log = (level, msg, data = {}) =>
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );

export const meta = {
  name: 'etf-holdings',
  description: 'iShares Clean Energy ETF Holdings – weekly diff',
  region: 'US',
  signal_types: ['etf_addition', 'etf_weight_increase'],
  schedule: 'weekly',
  default_filters: {
    min_weight_pct: 0.5,
    min_weight_increase_pct: 0.5,
  },
};

// iShares Global Clean Energy ETF (ICLN) holdings CSV
const ETF_CSV_URL =
  'https://www.ishares.com/us/products/239726/ICLN/1467271812596.ajax?fileType=csv&fileName=ICLN_holdings&dataType=fund';

const ETF_NAME = 'iShares Global Clean Energy ETF (ICLN)';

/**
 * Parse the iShares CSV format.
 * @param {string} csv
 * @returns {object[]}
 */
function parseISharesCSV(csv) {
  const lines = csv.split('\n');
  // Find the header row (contains "Ticker")
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Ticker') || lines[i].includes('Name')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const headers = lines[headerIdx].split(',').map((h) => h.trim().replace(/"/g, ''));
  const rows = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(',').map((c) => c.trim().replace(/"/g, ''));
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? '';
    });
    rows.push(row);
  }

  return rows;
}

/**
 * @returns {Promise<object[]>} normalized candidates
 */
export async function fetchCandidates(config = {}) {
  const minWeight = config.min_weight_pct ?? meta.default_filters.min_weight_pct;
  const minIncrease = config.min_weight_increase_pct ?? meta.default_filters.min_weight_increase_pct;

  log('info', 'etf-holdings: fetching CSV', { url: ETF_CSV_URL });

  let csv;
  try {
    const res = await fetch(ETF_CSV_URL, {
      headers: {
        Accept: 'text/csv,text/plain',
        'User-Agent': 'Mozilla/5.0 (compatible; DiscoveryBot/1.0)',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    csv = await res.text();
  } catch (err) {
    log('error', 'etf-holdings: fetch failed', { error: err.message });
    throw err;
  }

  const rows = parseISharesCSV(csv);
  log('info', 'etf-holdings: parsed rows', { count: rows.length });

  const now = new Date().toISOString();
  const candidates = [];

  for (const row of rows) {
    const ticker = (row['Ticker'] ?? row['Symbol'] ?? '').trim().toUpperCase();
    const name = (row['Name'] ?? row['Security'] ?? '').trim();
    const weightStr = row['Weight (%)'] ?? row['Weightings'] ?? row['Weight'] ?? '0';
    const weight = parseFloat(weightStr.replace(',', '.')) || 0;
    const isin = (row['ISIN'] ?? '').trim() || null;
    const market = (row['Exchange'] ?? row['Market'] ?? '').trim();

    if (!ticker || ticker === '-' || weight < minWeight) continue;

    let exchange = 'NASDAQ';
    let yahooSymbol = ticker;

    if (market && market.toUpperCase().includes('XETR')) {
      exchange = 'XETR';
      yahooSymbol = `${ticker}.DE`;
    } else if (market && (market.toUpperCase().includes('LSE') || market.toUpperCase().includes('XLON'))) {
      exchange = 'LSE';
      yahooSymbol = `${ticker}.L`;
    } else {
      try {
        exchange = await resolveUSExchange(ticker);
      } catch {
        exchange = 'NASDAQ';
      }
    }

    candidates.push({
      id: uuidv4(),
      symbol: ticker,
      exchange,
      yahoo_symbol: yahooSymbol,
      isin,
      name,
      sources: [
        {
          adapter: 'etf-holdings',
          source_url: ETF_CSV_URL,
          discovered_at: now,
          signal_type: 'etf_addition',
          raw_signal: {
            etf: ETF_NAME,
            weight_pct: weight,
            isin,
            market,
          },
          info_snippet: `${weight.toFixed(2)}% weight in ${ETF_NAME}`,
        },
      ],
      links: buildLinks({ symbol: ticker, exchange, yahooSymbol }),
      workspace_state: 'new',
      notes: '',
      enrichment: null,
      first_discovered_at: now,
      last_updated_at: now,
    });
  }

  log('info', 'etf-holdings: candidates ready', { count: candidates.length });
  return candidates;
}
