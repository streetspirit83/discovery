/**
 * Insider buy adapter – SEC EDGAR Form 4 filings
 *
 * Replaces openinsider.com scraping (blocked on cloud IPs).
 * Fetches P-Purchase Form 4 filings directly from SEC EDGAR.
 * Filters: value ≥ $1M, last 30 days.
 */

import { v4 as uuidv4 } from 'uuid';
import { buildLinks } from './_shared/link-builder.js';

const log = (level, msg, data = {}) =>
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );

// SEC requires identifying User-Agent per their automated-access policy
const SEC_HEADERS = {
  'User-Agent': 'DiscoveryWorkspace/1.0 david.krehan@gmail.com',
  Accept: 'application/json, text/plain, */*',
};

const MIN_VALUE_USD = 1_000_000;
const DAYS_BACK = 7;    // match weekly adapter window; dedup prevents re-adding
const MAX_FILINGS = 500;
const DELAY_MS = 150; // stay under SEC's 10 req/sec limit

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The filer CIK is the numeric prefix of the accession number
function reporterCikFromAccession(accessionNo) {
  return String(parseInt(accessionNo.split('-')[0], 10));
}

// Matches content between XML tags, including multi-line values
function xmlTag(xml, tag) {
  return (xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`)) ?? [])[1]?.trim();
}

// Matches <tag>\s*<value>…</value> pattern used in Form 4 amount fields
function xmlValue(xml, tag) {
  return (xml.match(new RegExp(`<${tag}>[\\s\\S]*?<value>([\\s\\S]*?)<\\/value>`)) ?? [])[1]?.trim();
}

/**
 * Search EDGAR full-text search for recent Form 4 filings.
 * The _id in results has format "{accessionNo}:{primaryDocumentName}".
 */
async function searchForm4s() {
  const startDate = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  const url = `https://efts.sec.gov/LATEST/search-index?forms=4&dateRange=custom&startdt=${startDate}`;
  log('info', 'edgar: searching Form 4 filings', { startDate });

  const res = await fetch(url, { headers: SEC_HEADERS });
  if (!res.ok) throw new Error(`EDGAR EFTS search failed: ${res.status}`);

  const data = await res.json();
  const hits = data.hits?.hits ?? [];
  log('info', 'edgar: search results', { total: data.hits?.total?.value, using: Math.min(hits.length, MAX_FILINGS) });
  return hits.slice(0, MAX_FILINGS);
}

/**
 * Fetch Form 4 XML and extract purchase transactions.
 */
async function parseForm4(reporterCik, accessionNo, docName) {
  const acc = accessionNo.replace(/-/g, '');
  const cikInt = parseInt(reporterCik, 10);

  const res = await fetch(
    `https://www.sec.gov/Archives/edgar/data/${cikInt}/${acc}/${docName}`,
    { headers: { ...SEC_HEADERS, Accept: 'text/xml, */*' } },
  );
  if (!res.ok) return null;
  const xml = await res.text();

  const issuerTicker = xmlTag(xml, 'issuerTradingSymbol');
  if (!issuerTicker) return null;

  const issuerName = xmlTag(xml, 'issuerName');
  const issuerCik = xmlTag(xml, 'issuerCik');
  const insiderName = xmlTag(xml, 'rptOwnerName');
  const insiderTitle = xmlTag(xml, 'officerTitle');

  const purchases = [];
  const re = /<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    if (xmlTag(block, 'transactionCode') !== 'P') continue;
    if (xmlValue(block, 'transactionAcquiredDisposedCode') !== 'A') continue;

    const shares = parseFloat(xmlValue(block, 'transactionShares') ?? '0') || 0;
    const price = parseFloat(xmlValue(block, 'transactionPricePerShare') ?? '0') || 0;
    const value = shares * price;
    const date = xmlValue(block, 'transactionDate');

    if (value >= MIN_VALUE_USD) purchases.push({ shares, price, value, date });
  }

  return { issuerTicker: issuerTicker.toUpperCase(), issuerName, issuerCik, insiderName, insiderTitle, purchases };
}

// Cache per issuer CIK to avoid redundant fetches
const exchangeCache = new Map();

async function resolveExchange(issuerCik) {
  if (exchangeCache.has(issuerCik)) return exchangeCache.get(issuerCik);
  const cik10 = String(parseInt(issuerCik, 10)).padStart(10, '0');
  const res = await fetch(`https://data.sec.gov/submissions/CIK${cik10}.json`, { headers: SEC_HEADERS });
  const exchange = res.ok ? ((await res.json()).exchanges?.[0] ?? 'NASDAQ') : 'NASDAQ';
  exchangeCache.set(issuerCik, exchange);
  return exchange;
}

export async function fetchCandidates() {
  const hits = await searchForm4s();

  const byTicker = new Map();

  for (const hit of hits) {
    const src = hit._source ?? {};

    // EDGAR EFTS _id format: "{accessionNo}:{primaryDocumentName}"
    const colonIdx = (hit._id ?? '').indexOf(':');
    if (colonIdx === -1) continue;
    const accessionNo = hit._id.slice(0, colonIdx);
    const docName = hit._id.slice(colonIdx + 1);
    if (!accessionNo || !docName) continue;

    const reporterCik = reporterCikFromAccession(accessionNo);

    await sleep(DELAY_MS);
    let form4;
    try {
      form4 = await parseForm4(reporterCik, accessionNo, docName);
    } catch (e) {
      log('debug', 'edgar: parse failed', { accessionNo, error: e.message });
      continue;
    }
    if (!form4 || form4.purchases.length === 0) continue;

    const { issuerTicker, issuerName, issuerCik, insiderName, insiderTitle, purchases } = form4;

    let exchange = 'NASDAQ';
    if (issuerCik) {
      await sleep(DELAY_MS);
      exchange = await resolveExchange(issuerCik).catch(() => 'NASDAQ');
    }

    for (const p of purchases) {
      if (!byTicker.has(issuerTicker)) {
        byTicker.set(issuerTicker, { name: issuerName, exchange, insiders: [] });
      }
      byTicker.get(issuerTicker).insiders.push({
        name: insiderName, title: insiderTitle,
        ...p, filingDate: src.file_date, accessionNo,
      });
    }
  }

  log('info', 'edgar: qualified tickers', { count: byTicker.size });
  if (byTicker.size === 0) return [];

  const now = new Date().toISOString();
  return [...byTicker.entries()].map(([ticker, data]) => ({
    id: uuidv4(),
    symbol: ticker,
    exchange: data.exchange,
    yahoo_symbol: ticker,
    isin: null,
    name: data.name,
    sources: data.insiders.map((ins) => ({
      adapter: 'openinsider',
      source_url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${ticker}&type=4&dateb=&owner=include&count=10`,
      discovered_at: now,
      signal_type: 'insider_buy',
      raw_signal: {
        ticker, company: data.name,
        insider_name: ins.name, insider_title: ins.title,
        trade_date: ins.date, filing_date: ins.filingDate,
        price: ins.price, qty: ins.shares, value: ins.value,
      },
      info_snippet: `${ins.title || 'Insider'} ${ins.name} bought ${ins.shares.toLocaleString()} shares at $${ins.price.toFixed(2)} ($${(ins.value / 1e6).toFixed(1)}M)`,
    })),
    links: buildLinks({ exchange: data.exchange, symbol: ticker, yahooSymbol: ticker }),
    workspace_state: 'new',
    notes: '',
    enrichment: null,
    first_discovered_at: now,
    last_updated_at: now,
  }));
}
