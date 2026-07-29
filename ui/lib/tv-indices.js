/**
 * Indizes-Daten für den "Indices"-Tab im Markets-Modal.
 *
 * Zwei Gruppen (= die beiden Sub-Tabs): `branchen` und `laender`. Jede Gruppe
 * ist eine schlichte Liste aus `{ code, name, ticker }` – austauschbar, ohne
 * dass die Render-Logik angefasst werden muss.
 *
 * Die Kurse kommen wie bei `fetchMarketIndicators()` aus dem TV-Scanner
 * (`scanner.tradingview.com/{market}/scan`) über die scrape-proxy-Function.
 * Eigener kleiner Proxy-Helper statt Import aus `tv-enrichment.js` – so wie in
 * `ls-intraday.js` / `tr-check.js` / `news-feed.js` auch: hält die
 * Cache-Busting-Kaskade auf dieses Modul begrenzt.
 *
 * Spalten im Panel: Kürzel · Indexname · TV-Link · Δ1T · PerfW · Perf1M ·
 * Perf3M · Perf6M · ØGr/M (geometrische Monatsrate aus Perf.6M – identisch zur
 * gleichnamigen Spalte in `candidate-list.js`).
 */

import { monthlyGrowthRate } from './tv-upside.js?v=20260704i';

/* ── Index-Listen ─────────────────────────────────────────────────────────────
 * PLATZHALTER – wird durch die abgestimmte Liste ersetzt. `market` ist optional
 * (Default 'global'); pro Markt geht genau ein Scanner-Request raus.
 * `ticker` ist immer die TV-Notation `PREFIX:SYMBOL`, daraus wird der TV-Link
 * gebaut (`PREFIX-SYMBOL`).
 */
export const INDEX_GROUPS = [
  {
    key: 'branchen',
    label: 'Branchen',
    entries: [
      { code: 'S5INFT', name: 'S&P 500 Information Technology', ticker: 'SP:S5INFT' },
      { code: 'SOX',    name: 'PHLX Semiconductor',             ticker: 'NASDAQ:SOX' },
      { code: 'S5TELS', name: 'S&P 500 Communication Services', ticker: 'SP:S5TELS' },
      { code: 'S5COND', name: 'S&P 500 Consumer Discretionary', ticker: 'SP:S5COND' },
      { code: 'S5CONS', name: 'S&P 500 Consumer Staples',       ticker: 'SP:S5CONS' },
      { code: 'S5HLTH', name: 'S&P 500 Health Care',            ticker: 'SP:S5HLTH' },
      { code: 'S5FINL', name: 'S&P 500 Financials',             ticker: 'SP:S5FINL' },
      { code: 'S5INDU', name: 'S&P 500 Industrials',            ticker: 'SP:S5INDU' },
      { code: 'S5ENRS', name: 'S&P 500 Energy',                 ticker: 'SP:S5ENRS' },
      { code: 'S5MATR', name: 'S&P 500 Materials',              ticker: 'SP:S5MATR' },
      { code: 'S5UTIL', name: 'S&P 500 Utilities',              ticker: 'SP:S5UTIL' },
      { code: 'S5RLST', name: 'S&P 500 Real Estate',            ticker: 'SP:S5RLST' },
    ],
  },
  {
    key: 'laender',
    label: 'Länder',
    entries: [
      { code: 'DAX',    name: 'DAX (Deutschland)',        ticker: 'XETR:DAX' },
      { code: 'SX5E',   name: 'Euro Stoxx 50 (Eurozone)', ticker: 'TVC:SX5E' },
      { code: 'SPX',    name: 'S&P 500 (USA)',            ticker: 'SP:SPX' },
      { code: 'IXIC',   name: 'Nasdaq Composite (USA)',   ticker: 'NASDAQ:IXIC' },
      { code: 'UKX',    name: 'FTSE 100 (UK)',            ticker: 'TVC:UKX' },
      { code: 'CAC40',  name: 'CAC 40 (Frankreich)',      ticker: 'TVC:CAC40' },
      { code: 'SSMI',   name: 'SMI (Schweiz)',            ticker: 'TVC:SSMI' },
      { code: 'IBEX35', name: 'IBEX 35 (Spanien)',        ticker: 'TVC:IBEX35' },
      { code: 'AEX',    name: 'AEX (Niederlande)',        ticker: 'TVC:AEX' },
      { code: 'NI225',  name: 'Nikkei 225 (Japan)',       ticker: 'TVC:NI225' },
      { code: 'HSI',    name: 'Hang Seng (Hongkong)',     ticker: 'TVC:HSI' },
      { code: 'VIX',    name: 'CBOE Volatility Index',    ticker: 'TVC:VIX' },
    ],
  },
];

/** Alle Einträge beider Gruppen (für einen gemeinsamen Fetch). */
export const allIndexEntries = () => INDEX_GROUPS.flatMap((g) => g.entries);

/** TV-Symbolseite zum Scanner-Ticker: `XETR:DAX` → `.../symbols/XETR-DAX/`. */
export const tvIndexUrl = (ticker) =>
  `https://www.tradingview.com/symbols/${String(ticker).replace(':', '-')}/`;

/* ── Fetch ────────────────────────────────────────────────────────────────── */

const TV_COLUMNS = ['description', 'close', 'change', 'Perf.W', 'Perf.1M', 'Perf.3M', 'Perf.6M'];
const COL = { description: 0, close: 1, change: 2, perf_w: 3, perf_1m: 4, perf_3m: 5, perf_6m: 6 };

async function proxyPost(backendUrl, secret, url, requestBody) {
  const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
    body: JSON.stringify({ url, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: requestBody }),
  });
  if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
  // scrape-proxy antwortet als { ok, status, body:string, error } (s. tv-enrichment.js)
  const wrapper = await res.json();
  if (!wrapper.ok) throw new Error(`Proxy: ${wrapper.error}`);
  if (wrapper.status !== 200) throw new Error(`TV HTTP ${wrapper.status}`);
  return wrapper.body;
}

/** Leere Zeile – wird auch als Fallback gerendert, damit die Tabelle steht. */
export function emptyIndexRow(entry) {
  return {
    ...entry,
    url: tvIndexUrl(entry.ticker),
    value: null, change: null,
    perf_w: null, perf_1m: null, perf_3m: null, perf_6m: null,
    growth_m: null,
    ok: false,
  };
}

/**
 * Holt Kurse + Performance für die übergebenen Einträge.
 * Gruppiert nach `market` (Default 'global') → ein Scanner-Request je Markt.
 * Nicht auflösbare Ticker kommen als leere Zeile mit `ok:false` zurück, damit
 * die Fußnote sie benennen kann.
 *
 * @param {{backendUrl:string, secret:string, entries?:Array}} opts
 * @returns {Promise<Array>} Zeilen in der Reihenfolge der Einträge
 */
export async function fetchIndexRows({ backendUrl, secret, entries = allIndexEntries() }) {
  const byMarket = new Map();
  for (const e of entries) {
    const m = e.market ?? 'global';
    if (!byMarket.has(m)) byMarket.set(m, []);
    byMarket.get(m).push(e);
  }

  const data = new Map();
  await Promise.all([...byMarket.entries()].map(async ([market, list]) => {
    try {
      const bodyStr = await proxyPost(backendUrl, secret,
        `https://scanner.tradingview.com/${market}/scan`,
        { symbols: { tickers: list.map((e) => e.ticker), query: { types: [] } }, columns: TV_COLUMNS },
      );
      for (const r of JSON.parse(bodyStr)?.data ?? []) data.set(r.s, r.d);
    } catch (err) {
      console.warn(`[TV] index fetch failed (${market}):`, err.message);
    }
  }));

  return entries.map((e) => {
    const d = data.get(e.ticker);
    if (!d) return emptyIndexRow(e);
    const perf6m = d[COL.perf_6m] ?? null;
    return {
      ...e,
      url:      tvIndexUrl(e.ticker),
      name:     e.name || d[COL.description] || e.code,
      value:    d[COL.close]   ?? null,
      change:   d[COL.change]  ?? null,
      perf_w:   d[COL.perf_w]  ?? null,
      perf_1m:  d[COL.perf_1m] ?? null,
      perf_3m:  d[COL.perf_3m] ?? null,
      perf_6m:  perf6m,
      growth_m: monthlyGrowthRate(perf6m, 6),
      ok:       true,
    };
  });
}
