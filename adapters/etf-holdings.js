/**
 * ETF Holdings adapter – SOXX + ARTY
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
import { resolveISINsToTickers } from './_shared/isin-to-ticker.js';

const log = (level, msg, data = {}) =>
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );

const SEC_HEADERS = {
  'User-Agent': 'DiscoveryWorkspace/1.0 david.krehan@gmail.com',
  Accept: 'application/json, text/plain, */*',
};

const MIN_WEIGHT_PCT = 1.0; // % of portfolio – concentrated ETFs, keep only significant holdings

// ETFs to pull. searchTerm is the free-text phrase sent to EFTS; must uniquely
// identify the fund within iShares' NPORT-P filings.
const ETF_LIST = [
  {
    name:       'iShares Semiconductor ETF (SOXX)',
    searchTerm: 'iShares PHLX Semiconductor',
  },
  {
    name:       'iShares Future AI & Tech ETF (ARTY)',
    searchTerm: 'iShares Future AI',
  },
];

const ISHARES_CIK_FALLBACK = '1100663'; // iShares Trust registrant CIK

// Only include US and European equity markets; skip Asia-Pacific, LatAm, etc.
const ALLOWED_COUNTRIES = new Set([
  'US',
  'DE', 'GB', 'FR', 'IT', 'ES', 'NL', 'BE', 'CH', 'AT',
  'DK', 'SE', 'NO', 'FI', 'PT', 'IE', 'LU', 'GR', 'PL',
]);

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

// ─── Step 1: Find the latest NPORT-P filing for a given ETF ─────────────────

async function findLatestFiling(searchTerm, etfName) {
  const startDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const endDate = new Date().toISOString().slice(0, 10);

  const encoded = encodeURIComponent(`"${searchTerm}"`);
  const url =
    `https://efts.sec.gov/LATEST/search-index` +
    `?q=${encoded}` +
    `&forms=NPORT-P` +
    `&startdt=${startDate}` +
    `&enddt=${endDate}`;

  log('info', 'etf-holdings: searching EDGAR for NPORT-P filing', { etf: etfName, startDate, endDate });

  let data;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: SEC_HEADERS });
    if (res.ok) { data = await res.json(); break; }
    if (attempt === 4) throw new Error(`EDGAR EFTS search failed: ${res.status}`);
    log('warn', 'etf-holdings: EFTS retry', { etf: etfName, attempt, status: res.status });
    await sleep(attempt * 2000);
  }

  const allHits = data.hits?.hits ?? [];
  log('info', 'etf-holdings: EFTS hits total', { etf: etfName, count: allHits.length });
  if (allHits.length === 0) throw new Error(`No NPORT-P filings found for "${etfName}"`);

  // Filter to iShares-sponsored filings only
  const hits = allHits.filter((h) =>
    (h._source?.display_names ?? []).some((n) => /ishares/i.test(n)),
  );
  log('info', 'etf-holdings: iShares hits', {
    etf: etfName,
    count: hits.length,
    sampleNames: allHits.slice(0, 5).map((h) => h._source?.display_names?.[0]),
  });
  if (hits.length === 0) throw new Error(`No iShares NPORT-P hits found for "${etfName}"`);

  hits.sort((a, b) =>
    String(b._source?.file_date ?? '').localeCompare(String(a._source?.file_date ?? '')),
  );

  const hit = hits[0];
  const id = hit._id ?? '';
  log('debug', 'etf-holdings: best hit', {
    etf: etfName,
    id,
    fileDate: hit._source?.file_date,
    displayNames: hit._source?.display_names,
  });

  const colonIdx = id.indexOf(':');
  if (colonIdx === -1) throw new Error(`Unexpected _id format: ${id}`);

  const accessionNo = id.slice(0, colonIdx);
  const primaryDoc  = id.slice(colonIdx + 1);
  const cikRaw = (hit._source?.ciks ?? [])[0] ?? ISHARES_CIK_FALLBACK;
  const cik = String(parseInt(cikRaw, 10));

  log('info', 'etf-holdings: filing located', { etf: etfName, accessionNo, cik, fileDate: hit._source?.file_date });
  return { accessionNo, primaryDoc, cik };
}

// ─── Step 2: Resolve the XML document name from the filing index ─────────────

async function resolveXmlDoc(cik, accessionNo, primaryDoc) {
  if (/\.xml$/i.test(primaryDoc)) return primaryDoc;

  const acc = accessionNo.replace(/-/g, '');
  const indexUrl =
    `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${acc}/index.json`;

  log('info', 'etf-holdings: fetching filing index', { indexUrl });
  const res = await fetch(indexUrl, { headers: SEC_HEADERS });

  if (!res.ok) {
    log('warn', 'etf-holdings: index fetch failed', { status: res.status });
    return 'primary_doc.xml';
  }

  const idx = await res.json();
  const items = idx.directory?.item ?? [];
  const xmlNames = items.filter((f) => /\.xml$/i.test(f.name)).map((f) => f.name);

  const primary = xmlNames.find((n) => /^primary_doc\.xml$/i.test(n));
  if (primary) return primary;

  const nonExhibit = items.find(
    (f) => /\.xml$/i.test(f.name) && !/EX-?100/i.test(f.type ?? ''),
  );
  if (nonExhibit) return nonExhibit.name;

  if (xmlNames.length > 0) return xmlNames[0];

  log('warn', 'etf-holdings: no .xml in index, defaulting to primary_doc.xml', {});
  return 'primary_doc.xml';
}

// ─── Step 3: Fetch and parse the NPORT-P XML ────────────────────────────────

async function parseHoldings(cik, accessionNo, xmlDoc, etfName) {
  const acc = accessionNo.replace(/-/g, '');
  const xmlUrl =
    `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${acc}/${xmlDoc}`;

  log('info', 'etf-holdings: fetching XML', { etf: etfName, xmlUrl });
  const res = await fetch(xmlUrl, { headers: { ...SEC_HEADERS, Accept: 'text/xml, application/xml, */*' } });
  if (!res.ok) throw new Error(`XML fetch failed: ${res.status} for ${xmlUrl}`);

  const xml = await res.text();
  log('info', 'etf-holdings: XML fetched', { etf: etfName, bytes: xml.length });
  log('debug', 'etf-holdings: XML preview', { etf: etfName, preview: xml.slice(0, 800) });

  const holdings = [];
  const holdingRe = /<(?:[a-zA-Z0-9_-]+:)?invstOrSec[\s>]([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?invstOrSec>/g;
  let m;
  let totalBlocks = 0;

  while ((m = holdingRe.exec(xml)) !== null) {
    totalBlocks++;
    const block = m[1];

    const assetCat = xmlTag(block, 'assetCat');
    if (assetCat && assetCat !== 'EC') continue;

    const pctVal = parseFloat(xmlTag(block, 'pctVal') ?? '0');
    if (isNaN(pctVal) || pctVal * 100 < MIN_WEIGHT_PCT) continue;

    const name       = xmlTag(block, 'name') ?? '';
    const ticker     = xmlAttr(block, 'ticker') ?? xmlTag(block, 'ticker') ?? null;
    const isin       = xmlAttr(block, 'isin')   ?? xmlTag(block, 'isin')   ?? null;
    const invCountry = xmlTag(block, 'invCountry') ?? 'US';

    if (!ALLOWED_COUNTRIES.has(invCountry)) {
      log('debug', 'etf-holdings: skipping non-US/EU holding', { etf: etfName, name, invCountry });
      continue;
    }

    holdings.push({ name, ticker, isin, invCountry, pctVal });
  }

  log('info', 'etf-holdings: parsed holdings', { etf: etfName, totalBlocks, equityAboveThreshold: holdings.length });

  if (totalBlocks === 0) {
    log('warn', 'etf-holdings: no invstOrSec blocks found', { etf: etfName, sample: xml.slice(0, 2000) });
  }

  return holdings;
}

// ─── Step 4: Resolve exchange for each holding ──────────────────────────────

const COUNTRY_EXCHANGE = {
  DE: 'XETR', GB: 'LSE',     FR: 'EURONEXT', IT: 'MIL',
  ES: 'BME',  DK: 'OMXCO',   SE: 'OMXSTO',   NO: 'OMXNO',
  PT: 'EURONEXT', BE: 'EURONEXT', NL: 'EURONEXT', FI: 'OMXHEX',
  CH: 'SIX',  AT: 'WBAG',    IE: 'EURONEXT',  GR: 'ATHEX',
};

const YAHOO_SUFFIX = {
  XETR: '.DE', LSE: '.L', EURONEXT: '.PA',
  BME: '.MC', MIL: '.MI', OMXCO: '.CO', OMXSTO: '.ST',
  OMXNO: '.OL', SIX: '.SW', WBAG: '.VI', OMXHEX: '.HE',
};

async function resolveExchange(ticker, invCountry, knownExchange = null) {
  if (knownExchange) return knownExchange;
  if (invCountry && invCountry !== 'US' && COUNTRY_EXCHANGE[invCountry]) {
    return COUNTRY_EXCHANGE[invCountry];
  }
  if (ticker && /^[A-Z]{1,5}$/.test(ticker)) {
    return resolveUSExchange(ticker).catch(() => 'NASDAQ');
  }
  return 'NASDAQ';
}

// ─── Per-ETF fetch ────────────────────────────────────────────────────────────

async function fetchForEtf(etf) {
  log('info', 'etf-holdings: starting fetch', { etf: etf.name });

  let filing;
  try {
    filing = await findLatestFiling(etf.searchTerm, etf.name);
  } catch (err) {
    log('error', 'etf-holdings: filing discovery failed', { etf: etf.name, error: err.message });
    return [];
  }

  await sleep(200);

  let xmlDoc;
  try {
    xmlDoc = await resolveXmlDoc(filing.cik, filing.accessionNo, filing.primaryDoc);
  } catch (err) {
    log('error', 'etf-holdings: XML doc resolution failed', { etf: etf.name, error: err.message });
    return [];
  }

  await sleep(200);

  let holdings;
  try {
    holdings = await parseHoldings(filing.cik, filing.accessionNo, xmlDoc, etf.name);
  } catch (err) {
    log('error', 'etf-holdings: XML parse failed', { etf: etf.name, error: err.message });
    return [];
  }

  if (holdings.length === 0) {
    log('warn', 'etf-holdings: no equity holdings above threshold', { etf: etf.name });
    return [];
  }

  holdings.sort((a, b) => b.pctVal - a.pctVal);

  const isinsNeedingResolution = holdings.filter((h) => !h.ticker && h.isin).map((h) => h.isin);
  let isinTickerMap = {};
  if (isinsNeedingResolution.length > 0) {
    log('info', 'etf-holdings: resolving ISINs to tickers via OpenFIGI', {
      etf: etf.name, count: isinsNeedingResolution.length,
    });
    try {
      isinTickerMap = await resolveISINsToTickers(isinsNeedingResolution);
    } catch (err) {
      log('warn', 'etf-holdings: ISIN resolution failed', { etf: etf.name, error: err.message });
    }
  }

  const now = new Date().toISOString();
  const candidates = [];

  for (const h of holdings) {
    const resolved = h.isin ? (isinTickerMap[h.isin] ?? null) : null;
    const ticker = h.ticker ?? resolved?.ticker ?? null;

    if (!ticker) {
      log('warn', 'etf-holdings: skipping – no ticker resolved', { etf: etf.name, name: h.name, isin: h.isin });
      continue;
    }

    const exchange = await resolveExchange(ticker, h.invCountry, resolved?.exchange ?? null);
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
        source_url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filing.cik}&type=NPORT-P&count=5`,
        discovered_at: now,
        signal_type: 'etf_addition',
        raw_signal: {
          etf: etf.name,
          weight_pct: parseFloat((h.pctVal * 100).toFixed(3)),
          isin: h.isin,
          country: h.invCountry,
          filing_accession: filing.accessionNo,
        },
        info_snippet: `${(h.pctVal * 100).toFixed(2)}% weight in ${etf.name}`,
      }],
      links: buildLinks({ exchange, symbol: ticker, yahooSymbol }),
      workspace_state: 'new',
      notes: '',
      enrichment: null,
      first_discovered_at: now,
      last_updated_at: now,
    });

    await sleep(30);
  }

  log('info', 'etf-holdings: candidates ready', { etf: etf.name, count: candidates.length });
  return candidates;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function fetchCandidates() {
  const allCandidates = [];

  for (const etf of ETF_LIST) {
    const batch = await fetchForEtf(etf);
    allCandidates.push(...batch);
    // Brief pause between ETF fetches to be polite to EDGAR rate limits
    if (etf !== ETF_LIST[ETF_LIST.length - 1]) await sleep(1000);
  }

  // Dedup by ticker: if both ETFs hold the same stock, merge sources into one
  // candidate rather than submitting two entries (the backend dedups by
  // symbol+exchange, but merging here keeps the source list clean).
  const byTicker = new Map();
  for (const c of allCandidates) {
    const key = `${c.symbol}:${c.exchange}`;
    if (byTicker.has(key)) {
      byTicker.get(key).sources.push(...c.sources);
    } else {
      byTicker.set(key, c);
    }
  }

  const merged = [...byTicker.values()];
  log('info', 'etf-holdings: total after dedup', {
    raw: allCandidates.length,
    merged: merged.length,
    deduped: allCandidates.length - merged.length,
  });
  return merged;
}
