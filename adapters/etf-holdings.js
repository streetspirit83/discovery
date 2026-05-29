/**
 * ETF Holdings adapter – iShares Global Clean Energy ETF (ICLN)
 *
 * Replaces direct iShares website scraping (blocked on cloud IPs).
 * Fetches NPORT-P filings from SEC EDGAR — the official monthly
 * portfolio disclosure that all US-registered funds must file.
 *
 * Data lag: ~60 days (SEC publishes only the quarter-end filing).
 * For a discovery tool this is acceptable; holdings rarely change dramatically.
 *
 * EDGAR access policy: public, requires User-Agent header.
 */

import { v4 as uuidv4 } from 'uuid';
import { buildLinks } from './_shared/link-builder.js';
import { resolveUSExchange } from './_shared/us-exchange-resolver.js';

const log = (level, msg, data = {}) =>
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );

const SEC_HEADERS = {
  'User-Agent': 'DiscoveryWorkspace/1.0 david.krehan@gmail.com',
  Accept: 'application/json, text/plain, */*',
};

const MIN_WEIGHT_PCT = 0.5; // minimum % portfolio weight to include
const DELAY_MS = 150;
const ETF_NAME = 'iShares Global Clean Energy ETF (ICLN)';
// Search term matching the exact fund name in the NPORT-P filing text
const FUND_QUERY = encodeURIComponent('"Global Clean Energy"');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Matches text content between XML tags (handles multi-line)
function xmlTag(xml, tag) {
  return (xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)) ?? [])[1]?.trim();
}

// Matches self-closing tag attribute: <tag value="..." />
function xmlAttr(xml, tag, attr = 'value') {
  return (xml.match(new RegExp(`<${tag}\\s[^>]*${attr}="([^"]*)"[^>]*/>`)) ?? [])[1];
}

/**
 * Find the latest NPORT-P accession number for ICLN.
 */
async function findLatestFiling() {
  const today = new Date();
  const startDate = new Date(today.getTime() - 400 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const endDate = today.toISOString().slice(0, 10);

  // EFTS returns hits sorted by relevance, not date, so we fetch and sort ourselves.
  const url = `https://efts.sec.gov/LATEST/search-index?q=${FUND_QUERY}&forms=NPORT-P&startdt=${startDate}&enddt=${endDate}`;

  // EDGAR occasionally returns transient 500s; retry with backoff.
  let data;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: SEC_HEADERS });
    if (res.ok) {
      data = await res.json();
      break;
    }
    if (attempt === 4) throw new Error(`EDGAR NPORT search failed: ${res.status}`);
    log('warn', 'etf-holdings: EDGAR search retry', { status: res.status, attempt });
    await sleep(attempt * 1000);
  }

  const hits = data.hits?.hits ?? [];
  if (hits.length === 0) throw new Error('No NPORT-P filings found for ICLN');

  // Sort by filing date descending so hits[0] is the most recent filing.
  hits.sort((a, b) =>
    String(b._source?.file_date ?? '').localeCompare(String(a._source?.file_date ?? '')),
  );

  const hit = hits[0];
  const id = hit._id ?? '';
  const colonIdx = id.indexOf(':');
  if (colonIdx === -1) throw new Error(`Unexpected _id format: ${id}`);

  const accessionNo = id.slice(0, colonIdx);
  const docName = id.slice(colonIdx + 1);
  // For NPORT-P the accession prefix is the filing agent's CIK, not the registrant's.
  // The registrant CIK lives in _source.entity_id; fall back to the known iShares Trust CIK.
  const rawEntityId = hit._source?.entity_id;
  const cik = rawEntityId
    ? String(parseInt(Array.isArray(rawEntityId) ? rawEntityId[0] : rawEntityId, 10))
    : '1100663';

  log('info', 'etf-holdings: found filing', {
    accessionNo,
    docName,
    cik,
    fileDate: hit._source?.file_date,
  });

  return { accessionNo, docName, cik };
}

/**
 * EDGAR filings include both .htm (human-readable) and .xml (machine-readable).
 * EFTS primary document is usually the .htm; we need the .xml for parsing.
 * Fetch the filing index to find the XML document name.
 */
async function resolveXmlDocName(cik, accessionNo, htmDocName) {
  const acc = accessionNo.replace(/-/g, '');
  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${acc}/${accessionNo}-index.json`;
  const res = await fetch(indexUrl, { headers: SEC_HEADERS });
  if (!res.ok) {
    // Fall back: try replacing .htm extension with .xml
    return htmDocName.replace(/\.htm$/i, '.xml');
  }
  const idx = await res.json();
  const items = idx.directory?.item ?? [];
  const xmlItem = items.find((f) => /\.xml$/i.test(f.name) && f.type !== 'EX-100.D');
  return xmlItem?.name ?? htmDocName.replace(/\.htm$/i, '.xml');
}

/**
 * Fetch and parse the NPORT-P XML, returning all equity holdings.
 */
async function parseNportXml(cik, accessionNo, docName) {
  const acc = accessionNo.replace(/-/g, '');

  // Primary document is usually .htm; resolve the companion .xml file
  const xmlDoc = /\.xml$/i.test(docName) ? docName : await resolveXmlDocName(cik, accessionNo, docName);
  log('info', 'etf-holdings: fetching XML', { xmlDoc });
  await sleep(DELAY_MS);

  const url = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${acc}/${xmlDoc}`;
  const res = await fetch(url, {
    headers: { ...SEC_HEADERS, Accept: 'text/xml, */*' },
  });
  if (!res.ok) throw new Error(`EDGAR NPORT XML fetch failed: ${res.status}`);
  const xml = await res.text();

  const holdings = [];
  const re = /<invstOrSec>([\s\S]*?)<\/invstOrSec>/g;
  let m;

  while ((m = re.exec(xml)) !== null) {
    const block = m[1];

    // Filter to equity holdings only
    const assetCat = xmlTag(block, 'assetCat');
    if (assetCat !== 'EC') continue;

    const pctVal = parseFloat(xmlTag(block, 'pctVal') ?? '0');
    if (pctVal * 100 < MIN_WEIGHT_PCT) continue;

    const name = xmlTag(block, 'name') ?? '';
    const cusip = xmlTag(block, 'cusip') ?? '';

    // Ticker may appear as text content or as attribute in various sub-elements
    const ticker =
      xmlAttr(block, 'ticker') ??
      xmlTag(block, 'ticker') ??
      null;

    // ISIN: may be text content or attribute
    const isin =
      xmlAttr(block, 'isin') ??
      xmlTag(block, 'isin') ??
      null;

    // Country of investment (US, DK, ES, etc.)
    const invCountry = xmlTag(block, 'invCountry') ?? 'US';

    holdings.push({ name, ticker, isin, cusip, pctVal, invCountry });
  }

  log('info', 'etf-holdings: parsed holdings', { total: holdings.length });
  return holdings;
}

/**
 * Best-effort exchange determination from country code / ticker shape.
 */
async function resolveExchange(ticker, invCountry) {
  if (!ticker) return 'NASDAQ';

  const t = ticker.toUpperCase();

  // Non-US country codes → map to their primary exchange
  const COUNTRY_EXCHANGE = {
    DK: 'OMXCO',   // Denmark / Copenhagen
    ES: 'BME',      // Spain
    PT: 'EURONEXT',
    DE: 'XETR',
    GB: 'LSE',
    FR: 'EURONEXT',
    IT: 'MIL',
    JP: 'TSE',
    CN: 'NASDAQ',   // often US-listed ADR
    KR: 'NASDAQ',
  };

  if (invCountry && invCountry !== 'US' && COUNTRY_EXCHANGE[invCountry]) {
    return COUNTRY_EXCHANGE[invCountry];
  }

  // US-style ticker: 1-5 uppercase letters, no dots
  if (/^[A-Z]{1,5}$/.test(t)) {
    return resolveUSExchange(t).catch(() => 'NASDAQ');
  }

  return 'NASDAQ';
}

export async function fetchCandidates() {
  log('info', 'etf-holdings: starting EDGAR NPORT-P fetch');

  let filing;
  try {
    filing = await findLatestFiling();
  } catch (err) {
    log('error', 'etf-holdings: failed to find filing', { error: err.message });
    return [];
  }

  await sleep(DELAY_MS);

  let holdings;
  try {
    holdings = await parseNportXml(filing.cik, filing.accessionNo, filing.docName);
  } catch (err) {
    log('error', 'etf-holdings: failed to parse NPORT XML', { error: err.message });
    return [];
  }

  if (holdings.length === 0) {
    log('warn', 'etf-holdings: no equity holdings found above threshold');
    return [];
  }

  // Sort by weight descending
  holdings.sort((a, b) => b.pctVal - a.pctVal);

  const now = new Date().toISOString();
  const candidates = [];

  for (const h of holdings) {
    const ticker = h.ticker ?? h.isin?.slice(-6) ?? h.cusip?.slice(-6) ?? 'UNKNOWN';
    const exchange = await resolveExchange(h.ticker, h.invCountry);
    await sleep(50); // brief throttle for exchange API calls

    const yahooSuffix = {
      XETR: '.DE', LSE: '.L', EURONEXT: '.PA', BME: '.MC',
      MIL: '.MI', OMXCO: '.CO', TSE: '.T',
    }[exchange] ?? '';
    const yahooSymbol = yahooSuffix ? `${ticker}${yahooSuffix}` : ticker;

    candidates.push({
      id: uuidv4(),
      symbol: ticker,
      exchange,
      yahoo_symbol: yahooSymbol,
      isin: h.isin,
      name: h.name,
      sources: [{
        adapter: 'etf-holdings',
        source_url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=1100663&type=NPORT-P&count=5`,
        discovered_at: now,
        signal_type: 'etf_addition',
        raw_signal: {
          etf: ETF_NAME,
          weight_pct: parseFloat((h.pctVal * 100).toFixed(2)),
          isin: h.isin,
          country: h.invCountry,
          filing_accession: filing.accessionNo,
        },
        info_snippet: `${(h.pctVal * 100).toFixed(2)}% weight in ${ETF_NAME}`,
      }],
      links: buildLinks({ exchange, symbol: ticker, yahooSymbol }),
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
