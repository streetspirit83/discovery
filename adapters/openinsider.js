/**
 * OpenInsider adapter
 * Scrapes insider buy signals from openinsider.com screener.
 *
 * Filters: min $1M transaction value, last 30 days, P/S type transactions.
 */

import { load as cheerioLoad } from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import { resolveUSExchange } from './_shared/us-exchange-resolver.js';
import { resolveISIN } from './_shared/isin-resolver.js';
import { buildLinks } from './_shared/link-builder.js';

const log = (level, msg, data = {}) =>
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );

const SCREENER_URL =
  'https://openinsider.com/screener?s=&o=&pl=&ph=&ll=&lh=&fd=30&td=&tdr=&fdlyl=&fdlyh=&daysago=&xp=1&vl=1000000&vh=&ocl=&och=&sic1=-1&sicl=100&sich=9999&grp=0&nfl=&nfh=&nfllo=&nflhi=&oclo=&ochi=&sortcol=0&cnt=20&page=1';

const MIN_VALUE_USD = 1_000_000;

/**
 * Parse a dollar amount string like "$9,100,000" or "$9.1M" → number
 * @param {string} str
 * @returns {number}
 */
function parseDollarAmount(str) {
  if (!str) return 0;
  const cleaned = str.replace(/[$,\s]/g, '');
  if (cleaned.endsWith('M')) return parseFloat(cleaned) * 1_000_000;
  if (cleaned.endsWith('K')) return parseFloat(cleaned) * 1_000;
  if (cleaned.endsWith('B')) return parseFloat(cleaned) * 1_000_000_000;
  return parseFloat(cleaned) || 0;
}

/**
 * Parse a share count string like "50,000" → number
 * @param {string} str
 * @returns {number}
 */
function parseShareCount(str) {
  if (!str) return 0;
  return parseInt(str.replace(/[,\s]/g, ''), 10) || 0;
}

/**
 * Fetch and parse the OpenInsider screener page.
 * @returns {Promise<Array>} raw rows from table
 */
async function scrapeOpenInsider() {
  log('info', 'openinsider: fetching screener', { url: SCREENER_URL });

  const res = await fetch(SCREENER_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; DiscoveryWorkspace/1.0; +https://github.com/discovery)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!res.ok) {
    throw new Error(`OpenInsider request failed: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  log('debug', 'openinsider: received HTML', { bytes: html.length });

  const $ = cheerioLoad(html);
  const rows = [];

  // The main table has class "tinytable" or similar; let's find all rows
  $('table.tinytable tbody tr, table tbody tr').each((i, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 13) return;

    const filingDate = $(cells[1]).text().trim();
    const tradeDate = $(cells[2]).text().trim();
    const ticker = $(cells[3]).find('a').text().trim() || $(cells[3]).text().trim();
    const companyName = $(cells[4]).find('a').text().trim() || $(cells[4]).text().trim();
    const insiderName = $(cells[5]).find('a').text().trim() || $(cells[5]).text().trim();
    const insiderTitle = $(cells[6]).text().trim();
    const tradeType = $(cells[7]).text().trim();
    const price = $(cells[8]).text().trim();
    const qty = $(cells[9]).text().trim();
    const owned = $(cells[10]).text().trim();
    const deltaOwn = $(cells[11]).text().trim();
    const value = $(cells[12]).text().trim();

    const valueParsed = parseDollarAmount(value);

    if (!ticker || valueParsed < MIN_VALUE_USD) return;

    // Only include purchases (P or J - gift, A - award sometimes)
    if (!tradeType.includes('P') && tradeType !== 'A') return;

    rows.push({
      filingDate,
      tradeDate,
      ticker: ticker.toUpperCase(),
      companyName,
      insiderName,
      insiderTitle,
      tradeType,
      price: parseDollarAmount(price),
      qty: parseShareCount(qty),
      owned: parseShareCount(owned),
      deltaOwn,
      value: valueParsed,
    });
  });

  log('info', 'openinsider: parsed rows', { count: rows.length });
  return rows;
}

/**
 * Convert raw OpenInsider rows to Discovery candidates.
 * Groups multiple insider transactions for same ticker into one candidate.
 *
 * @param {Array} rows
 * @returns {Promise<Array>} candidates
 */
async function rowsToCandidates(rows) {
  // Group by ticker
  const byTicker = new Map();
  for (const row of rows) {
    if (!byTicker.has(row.ticker)) {
      byTicker.set(row.ticker, []);
    }
    byTicker.get(row.ticker).push(row);
  }

  const candidates = [];
  const now = new Date().toISOString();

  for (const [ticker, tickerRows] of byTicker) {
    const primaryRow = tickerRows[0];

    let exchange;
    try {
      exchange = await resolveUSExchange(ticker);
    } catch (err) {
      log('warn', 'openinsider: could not resolve exchange', { ticker, error: err.message });
      exchange = 'NASDAQ';
    }

    let isin = null;
    try {
      isin = await resolveISIN(ticker, exchange);
    } catch (err) {
      log('warn', 'openinsider: could not resolve ISIN', { ticker, error: err.message });
    }

    const links = buildLinks({
      exchange,
      symbol: ticker,
      yahooSymbol: ticker,
    });

    // Build sources (one per transaction)
    const sources = tickerRows.map((row) => {
      const totalValue = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(row.value);

      const priceFormatted = row.price
        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(row.price)
        : 'unknown price';

      return {
        adapter: 'openinsider',
        source_url: SCREENER_URL,
        discovered_at: now,
        signal_type: 'insider_buy',
        raw_signal: {
          ticker: row.ticker,
          company: row.companyName,
          insider_name: row.insiderName,
          insider_title: row.insiderTitle,
          trade_type: row.tradeType,
          trade_date: row.tradeDate,
          filing_date: row.filingDate,
          price: row.price,
          qty: row.qty,
          value: row.value,
          delta_own: row.deltaOwn,
        },
        info_snippet: `${row.insiderTitle || 'Insider'} ${row.insiderName} bought ${row.qty.toLocaleString()} shares at ${priceFormatted} (${totalValue})`,
      };
    });

    const candidate = {
      id: uuidv4(),
      symbol: ticker,
      exchange,
      yahoo_symbol: ticker,
      isin,
      name: primaryRow.companyName,
      sources,
      links,
      workspace_state: 'new',
      notes: '',
      enrichment: null,
      first_discovered_at: now,
      last_updated_at: now,
    };

    candidates.push(candidate);
  }

  return candidates;
}

/**
 * Main export: fetch candidates from OpenInsider.
 * @returns {Promise<Array>} Discovery candidates
 */
export async function fetchCandidates() {
  const rows = await scrapeOpenInsider();
  if (rows.length === 0) {
    log('warn', 'openinsider: no rows found (site structure may have changed)');
    return [];
  }
  return rowsToCandidates(rows);
}
