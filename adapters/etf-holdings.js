/**
 * ETF Holdings adapter – iShares Global Clean Energy ETF (ICLN)
 *
 * Uses SEC EDGAR NPORT-P filings (free, official, cloud-accessible).
 * NPORT-P is the monthly portfolio disclosure all US-registered funds must file.
 * Only quarter-end filings are publicly available (~60-day lag).
 *
 * EDGAR access: public, only requires a User-Agent header.
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

const MIN_WEIGHT_PCT = 0.3; // % of portfolio; keep low to capture more holdings
const ETF_NAME = 'iShares Global Clean Energy ETF (ICLN)';
const ISHARES_CIK = '1100663'; // iShares Trust registrant CIK

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── XML helpers (namespace-aware) ──────────────────────────────────────────
// NPORT-P XML uses namespace prefixes, e.g. <n-4:invstOrSec>, <ns0:pctVal>.
// These helpers strip any prefix before the colon so tags match regardless.

function xmlTag(xml, tag) {
  const re = new RegExp(
    `<(?:[a-zA-Z0-9_-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tag}>`,
    'i',
  );
  return (xml.match(re) ?? [])[1]?.trim();
}

function xmlAttr(xml, tag, attr = 'value') {
  const re = new RegExp(
    `<(?:[a-zA-Z0-9_-]+:)?${tag}[^>]*\\s${attr}="([^"]*)"[^/]*/?>`,
    'i',
  );
  return (xml.match(re) ?? [])[1];
}

// ─── Step 1: Find the latest NPORT-P filing for ICLN ────────────────────────

async function findLatestFiling() {
  // Search EFTS for NPORT-P filings mentioning ICLN (the fund ticker)
  const startDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const endDate = new Date().toISOString().slice(0, 10);

  const url =
    `https://efts.sec.gov/LATEST/search-index` +
    `?q=%22Global+Clean+Energy%22` +
    `&forms=NPORT-P` +
    `&startdt=${startDate}` +
    `&enddt=${endDate}`;

  log('info', 'etf-holdings: searching EDGAR for NPORT-P filing', { startDate, endDate });

  // Retry up to 4x – EFTS returns transient 500s occasionally
  let data;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: SEC_HEADERS });
    if (res.ok) { data = await res.json(); break; }
    if (attempt === 4) throw new Error(`EDGAR EFTS search failed: ${res.status}`);
    log('warn', 'etf-holdings: EFTS retry', { attempt, status: res.status });
    await sleep(attempt * 2000);
  }

  const hits = data.hits?.hits ?? [];
  log('info', 'etf-holdings: EFTS hits', { count: hits.length });
  if (hits.length === 0) throw new Error('No NPORT-P filings found for ICLN in EFTS');

  // Sort by file_date descending (EFTS returns by relevance, not date)
  hits.sort((a, b) =>
    String(b._source?.file_date ?? '').localeCompare(String(a._source?.file_date ?? '')),
  );

  const hit = hits[0];
  const id = hit._id ?? '';
  log('debug', 'etf-holdings: best hit', { id, fileDate: hit._source?.file_date, source: hit._source });

  const colonIdx = id.indexOf(':');
  if (colonIdx === -1) throw new Error(`Unexpected _id format: ${id}`);

  const accessionNo = id.slice(0, colonIdx);
  const primaryDoc  = id.slice(colonIdx + 1);

  // Registrant CIK from _source.entity_id; fall back to known iShares Trust CIK
  const raw = hit._source?.entity_id;
  const cik = raw
    ? String(parseInt(Array.isArray(raw) ? raw[0] : raw, 10))
    : ISHARES_CIK;

  log('info', 'etf-holdings: filing located', { accessionNo, primaryDoc, cik, fileDate: hit._source?.file_date });
  return { accessionNo, primaryDoc, cik };
}

// ─── Step 2: Resolve the XML document name from the filing index ─────────────

async function resolveXmlDoc(cik, accessionNo, primaryDoc) {
  // EDGAR primary doc is usually .htm (viewer); the companion .xml has the data
  if (/\.xml$/i.test(primaryDoc)) return primaryDoc;

  const acc = accessionNo.replace(/-/g, '');
  const indexUrl =
    `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${acc}/${accessionNo}-index.json`;

  log('info', 'etf-holdings: fetching filing index', { indexUrl });
  const res = await fetch(indexUrl, { headers: SEC_HEADERS });

  if (!res.ok) {
    // Fall back: replace .htm extension with .xml
    const fallback = primaryDoc.replace(/\.htm$/i, '.xml');
    log('warn', 'etf-holdings: index fetch failed, using fallback doc name', { fallback, status: res.status });
    return fallback;
  }

  const idx = await res.json();
  const items = idx.directory?.item ?? [];
  log('debug', 'etf-holdings: filing index documents', {
    docs: items.map((f) => `${f.name} (${f.type})`),
  });

  // Prefer the XML companion document; exclude EX-100 exhibits
  const xmlItem = items.find(
    (f) => /\.xml$/i.test(f.name) && !/EX-100|ex100/i.test(f.type ?? ''),
  );

  if (xmlItem) return xmlItem.name;

  const fallback = primaryDoc.replace(/\.htm$/i, '.xml');
  log('warn', 'etf-holdings: no XML doc found in index, using fallback', { fallback });
  return fallback;
}

// ─── Step 3: Fetch and parse the NPORT-P XML ────────────────────────────────

async function parseHoldings(cik, accessionNo, xmlDoc) {
  const acc = accessionNo.replace(/-/g, '');
  const xmlUrl =
    `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${acc}/${xmlDoc}`;

  log('info', 'etf-holdings: fetching XML', { xmlUrl });
  const res = await fetch(xmlUrl, { headers: { ...SEC_HEADERS, Accept: 'text/xml, application/xml, */*' } });
  if (!res.ok) throw new Error(`XML fetch failed: ${res.status} for ${xmlUrl}`);

  const xml = await res.text();
  log('info', 'etf-holdings: XML fetched', { bytes: xml.length });

  // Log first 800 chars of XML so we can see namespace declarations and structure
  log('debug', 'etf-holdings: XML preview', { preview: xml.slice(0, 800) });

  const holdings = [];

  // Match individual holding blocks (namespace-aware)
  const holdingRe = /<(?:[a-zA-Z0-9_-]+:)?invstOrSec[\s>]([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?invstOrSec>/g;
  let m;
  let totalBlocks = 0;

  while ((m = holdingRe.exec(xml)) !== null) {
    totalBlocks++;
    const block = m[1];

    // Filter to equity holdings only (assetCat = EC)
    const assetCat = xmlTag(block, 'assetCat');
    if (assetCat && assetCat !== 'EC') continue;

    const pctValStr = xmlTag(block, 'pctVal') ?? '0';
    const pctVal = parseFloat(pctValStr);
    if (isNaN(pctVal) || pctVal * 100 < MIN_WEIGHT_PCT) continue;

    const name = xmlTag(block, 'name') ?? '';

    // Ticker: may be attribute-style <ticker value="ENPH"/> or text <ticker>ENPH</ticker>
    const ticker = xmlAttr(block, 'ticker') ?? xmlTag(block, 'ticker') ?? null;

    // ISIN: may be attribute or text
    const isin = xmlAttr(block, 'isin') ?? xmlTag(block, 'isin') ?? null;

    const invCountry = xmlTag(block, 'invCountry') ?? 'US';

    holdings.push({ name, ticker, isin, invCountry, pctVal });
  }

  log('info', 'etf-holdings: parsed holdings', {
    totalBlocks,
    equityAboveThreshold: holdings.length,
  });

  // If no blocks found at all, log a larger sample to diagnose XML structure
  if (totalBlocks === 0) {
    log('warn', 'etf-holdings: no invstOrSec blocks found – XML structure sample', {
      sample: xml.slice(0, 2000),
    });
  }

  return holdings;
}

// ─── Step 4: Resolve exchange for each holding ──────────────────────────────

const COUNTRY_EXCHANGE = {
  DK: 'OMXCO', ES: 'BME', PT: 'EURONEXT', DE: 'XETR',
  GB: 'LSE',   FR: 'EURONEXT', IT: 'MIL',  JP: 'TSE',
};

const YAHOO_SUFFIX = {
  XETR: '.DE', LSE: '.L', EURONEXT: '.PA',
  BME: '.MC',  MIL: '.MI', OMXCO: '.CO', TSE: '.T',
};

async function resolveExchange(ticker, invCountry) {
  if (invCountry && invCountry !== 'US' && COUNTRY_EXCHANGE[invCountry]) {
    return COUNTRY_EXCHANGE[invCountry];
  }
  if (ticker && /^[A-Z]{1,5}$/.test(ticker)) {
    return resolveUSExchange(ticker).catch(() => 'NASDAQ');
  }
  return 'NASDAQ';
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function fetchCandidates() {
  log('info', 'etf-holdings: starting EDGAR NPORT-P fetch');

  let filing;
  try {
    filing = await findLatestFiling();
  } catch (err) {
    log('error', 'etf-holdings: filing discovery failed', { error: err.message });
    return [];
  }

  await sleep(200);

  let xmlDoc;
  try {
    xmlDoc = await resolveXmlDoc(filing.cik, filing.accessionNo, filing.primaryDoc);
  } catch (err) {
    log('error', 'etf-holdings: XML doc resolution failed', { error: err.message });
    return [];
  }

  await sleep(200);

  let holdings;
  try {
    holdings = await parseHoldings(filing.cik, filing.accessionNo, xmlDoc);
  } catch (err) {
    log('error', 'etf-holdings: XML parse failed', { error: err.message });
    return [];
  }

  if (holdings.length === 0) {
    log('warn', 'etf-holdings: no equity holdings above threshold');
    return [];
  }

  holdings.sort((a, b) => b.pctVal - a.pctVal);

  const now = new Date().toISOString();
  const candidates = [];

  for (const h of holdings) {
    const ticker = h.ticker ?? h.isin?.slice(-6) ?? 'UNKNOWN';
    const exchange = await resolveExchange(h.ticker, h.invCountry);
    const suffix = YAHOO_SUFFIX[exchange] ?? '';
    const yahooSymbol = suffix ? `${ticker}${suffix}` : ticker;

    candidates.push({
      id: uuidv4(),
      symbol: ticker,
      exchange,
      yahoo_symbol: yahooSymbol,
      isin: h.isin,
      name: h.name,
      sources: [{
        adapter: 'etf-holdings',
        source_url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${ISHARES_CIK}&type=NPORT-P&count=5`,
        discovered_at: now,
        signal_type: 'etf_addition',
        raw_signal: {
          etf: ETF_NAME,
          weight_pct: parseFloat((h.pctVal * 100).toFixed(3)),
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

    await sleep(30); // brief pause between exchange lookups
  }

  log('info', 'etf-holdings: candidates ready', { count: candidates.length });
  return candidates;
}
