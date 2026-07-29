/**
 * Indizes-Daten für den "Indices"-Tab im Markets-Modal.
 *
 * Zwei Gruppen (= die beiden Sub-Tabs): `branchen` und `laender`. Jeder Eintrag
 * ist `{ code, name, label, tickers }` – `code` ist das Kürzel aus der
 * abgestimmten Liste, `label` die Branche bzw. das Land.
 *
 * ── Warum `tickers` eine LISTE ist ───────────────────────────────────────────
 * Das TV-Präfix eines Index ist nicht ableitbar (SP: / DJ: / NASDAQ: / TVC: /
 * EURONEXT: / börsenspezifisch …) und war beim Bau nicht live prüfbar. Statt zu
 * raten steht je Index eine geordnete Kandidatenliste; `resolveTickers()` fragt
 * alle Kandidaten in einem Scanner-Request ab und nimmt den ersten, der Daten
 * liefert. Das Ergebnis landet in localStorage, danach geht nur noch der
 * bestätigte Ticker raus. Nicht auflösbare Indizes werden in der Statuszeile
 * des Panels benannt – kein stilles "–".
 * Ein Index mit genau einem Kandidaten ist bereits verifiziert (aus
 * `tv-enrichment.js` `MARKET_INDICATORS`).
 *
 * Kurse kommen wie bei `fetchMarketIndicators()` aus dem TV-Scanner
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

/* ── Index-Listen ─────────────────────────────────────────────────────────── */

export const INDEX_GROUPS = [
  {
    key: 'branchen',
    label: 'Branchen',
    entries: [
      { code: 'SOX',      label: 'Halbleiter',                     name: 'PHLX Semiconductor Index',            tickers: ['NASDAQ:SOX'] },
      { code: 'NBI',      label: 'Biotechnologie',                 name: 'NASDAQ Biotechnology Index',          tickers: ['NASDAQ:NBI', 'INDEX:NBI'] },
      { code: 'DJUSSW',   label: 'Software',                       name: 'Dow Jones U.S. Software Index',       tickers: ['DJ:DJUSSW', 'INDEX:DJUSSW'] },
      { code: 'DJINET',   label: 'Internet',                       name: 'Dow Jones Internet Index',            tickers: ['DJ:DJINET', 'INDEX:DJINET'] },
      { code: 'HXR',      label: 'Cybersecurity',                  name: 'ISE Cyber Security Index',            tickers: ['NASDAQ:HXR', 'INDEX:HXR', 'DJ:HXR'] },
      { code: 'EMCLOUD',  label: 'Cloud Computing',                name: 'BVP Nasdaq Emerging Cloud Index',     tickers: ['NASDAQ:EMCLOUD', 'INDEX:EMCLOUD'] },
      { code: 'XBAI',     label: 'Künstliche Intelligenz',         name: 'Indxx AI & Big Data Index',           tickers: ['NASDAQ:XBAI', 'INDEX:XBAI'] },
      { code: 'ROBO',     label: 'Robotik & Automation',           name: 'ROBO Global Robotics Index',          tickers: ['INDEX:ROBO', 'NASDAQ:ROBO', 'DJ:ROBO'] },
      { code: 'IXFT',     label: 'Fintech',                        name: 'Indxx Global Fintech Index',          tickers: ['NASDAQ:IXFT', 'INDEX:IXFT'] },
      { code: 'BKX',      label: 'Banken',                         name: 'KBW Nasdaq Bank Index',               tickers: ['NASDAQ:BKX', 'INDEX:BKX', 'DJ:BKX'] },
      { code: 'KRX',      label: 'Regionalbanken',                 name: 'KBW Regional Banking Index',          tickers: ['NASDAQ:KRX', 'INDEX:KRX'] },
      { code: 'KIX',      label: 'Versicherungen',                 name: 'KBW Insurance Index',                 tickers: ['NASDAQ:KIX', 'INDEX:KIX'] },
      { code: 'SPN',      label: 'Energie',                        name: 'S&P 500 Energy Sector',               tickers: ['SP:SPN', 'SP:S5ENRS', 'INDEX:SPN'] },
      { code: 'SPSIOP',   label: 'Öl & Gas Exploration',           name: 'S&P Oil & Gas Exploration & Production', tickers: ['SP:SPSIOP', 'INDEX:SPSIOP'] },
      { code: 'DJUSUT',   label: 'Versorger',                      name: 'Dow Jones U.S. Utilities Index',      tickers: ['DJ:DJUSUT', 'INDEX:DJUSUT'] },
      { code: 'SPGTCLEN', label: 'Erneuerbare Energien',           name: 'S&P Global Clean Energy Index',       tickers: ['SP:SPGTCLEN', 'INDEX:SPGTCLEN'] },
      { code: 'FNRE',     label: 'Immobilien (REITs)',             name: 'FTSE Nareit All Equity REITs',        tickers: ['FTSE:FNRE', 'INDEX:FNRE', 'TVC:FNRE', 'NASDAQ:FNRE'] },
      { code: 'DJUSIN',   label: 'Industrie',                      name: 'Dow Jones U.S. Industrials',          tickers: ['DJ:DJUSIN', 'INDEX:DJUSIN'] },
      { code: 'DJUSAS',   label: 'Luft- & Raumfahrt/Verteidigung', name: 'Dow Jones U.S. Aerospace & Defense',  tickers: ['DJ:DJUSAS', 'INDEX:DJUSAS'] },
      { code: 'SPAUTO',   label: 'Automobil',                      name: 'S&P Global Automotive Index',         tickers: ['SP:SPAUTO', 'INDEX:SPAUTO'] },
      { code: 'SPLUX',    label: 'Luxusgüter',                     name: 'S&P Global Luxury Index',             tickers: ['SP:SPLUX', 'INDEX:SPLUX'] },
      { code: 'S5COND',   label: 'Konsumgüter',                    name: 'S&P Consumer Discretionary',          tickers: ['SP:S5COND'] },
      { code: 'S5CONS',   label: 'Basiskonsum',                    name: 'S&P Consumer Staples',                tickers: ['SP:S5CONS'] },
      { code: 'S5HLTH',   label: 'Gesundheitswesen',               name: 'S&P Health Care',                     tickers: ['SP:S5HLTH'] },
      { code: 'DJUSMS',   label: 'Medizintechnik',                 name: 'Dow Jones U.S. Medical Equipment',    tickers: ['DJ:DJUSMS', 'INDEX:DJUSMS'] },
      { code: 'S5CHEM',   label: 'Chemie',                         name: 'S&P Chemicals',                       tickers: ['SP:S5CHEM', 'INDEX:S5CHEM'] },
      { code: 'SPMTMN',   label: 'Metalle & Bergbau',              name: 'S&P Metals & Mining',                 tickers: ['SP:SPMTMN', 'INDEX:SPMTMN'] },
      { code: 'DJT',      label: 'Transport',                      name: 'Dow Jones Transportation Average',    tickers: ['DJ:DJT', 'TVC:DJT', 'INDEX:DJT'] },
    ],
  },
  {
    key: 'laender',
    label: 'Länder',
    entries: [
      { code: 'DAX',     label: 'Deutschland',    name: 'DAX',                  tickers: ['XETR:DAX'] },
      { code: 'SPX',     label: 'USA',            name: 'S&P 500',              tickers: ['SP:SPX'] },
      { code: 'TSX',     label: 'Kanada',         name: 'S&P/TSX Composite',    tickers: ['TSX:TSX', 'TVC:TSX', 'INDEX:TSX'] },
      { code: 'MEXBOL',  label: 'Mexiko',         name: 'IPC',                  tickers: ['BMV:ME', 'TVC:MEXBOL', 'INDEX:MEXBOL'] },
      { code: 'IBOV',    label: 'Brasilien',      name: 'Ibovespa',             tickers: ['BMFBOVESPA:IBOV', 'INDEX:IBOV', 'TVC:IBOV'] },
      { code: 'FTSE',    label: 'Großbritannien', name: 'FTSE 100',             tickers: ['TVC:UKX', 'FTSE:UKX', 'INDEX:UKX'] },
      { code: 'CAC',     label: 'Frankreich',     name: 'CAC 40',               tickers: ['EURONEXT:PX1', 'TVC:CAC40', 'INDEX:CAC40'] },
      { code: 'AEX',     label: 'Niederlande',    name: 'AEX',                  tickers: ['EURONEXT:AEX', 'TVC:AEX', 'INDEX:AEX'] },
      { code: 'BEL20',   label: 'Belgien',        name: 'BEL 20',               tickers: ['EURONEXT:BEL20', 'TVC:BEL20', 'INDEX:BEL20'] },
      { code: 'SMI',     label: 'Schweiz',        name: 'SMI',                  tickers: ['SIX:SMI', 'TVC:SSMI', 'INDEX:SMI'] },
      { code: 'ATX',     label: 'Österreich',     name: 'ATX',                  tickers: ['VIE:ATX', 'TVC:ATX', 'INDEX:ATX'] },
      { code: 'FTSEMIB', label: 'Italien',        name: 'FTSE MIB',             tickers: ['MIL:FTSEMIB', 'TVC:FTSEMIB', 'INDEX:FTSEMIB'] },
      { code: 'IBEX',    label: 'Spanien',        name: 'IBEX 35',              tickers: ['BME:IBC', 'TVC:IBEX35', 'INDEX:IBEX35'] },
      { code: 'PSI',     label: 'Portugal',       name: 'PSI',                  tickers: ['EURONEXT:PSI20', 'TVC:PSI20', 'INDEX:PSI20'] },
      { code: 'OMXS30',  label: 'Schweden',       name: 'OMX Stockholm 30',     tickers: ['OMXSTO:OMXS30', 'TVC:OMXS30', 'INDEX:OMXS30'] },
      { code: 'OBX',     label: 'Norwegen',       name: 'OBX',                  tickers: ['OSL:OBX', 'TVC:OBX', 'INDEX:OBX'] },
      { code: 'OMXC25',  label: 'Dänemark',       name: 'OMX Copenhagen 25',    tickers: ['OMXCOP:OMXC25', 'TVC:OMXC25', 'INDEX:OMXC25'] },
      { code: 'OMXH25',  label: 'Finnland',       name: 'OMX Helsinki 25',      tickers: ['OMXHEX:OMXH25', 'TVC:OMXH25', 'INDEX:OMXH25'] },
      { code: 'WIG20',   label: 'Polen',          name: 'WIG20',                tickers: ['GPW:WIG20', 'TVC:WIG20', 'INDEX:WIG20'] },
      { code: 'XU100',   label: 'Türkei',         name: 'BIST 100',             tickers: ['BIST:XU100', 'TVC:XU100', 'INDEX:XU100'] },
      { code: 'N225',    label: 'Japan',          name: 'Nikkei 225',           tickers: ['TVC:NI225'] },
      { code: 'CSI300',  label: 'China',          name: 'CSI 300',              tickers: ['SSE:000300', 'TVC:CSI300', 'INDEX:CSI300'] },
      { code: 'HSI',     label: 'Hongkong',       name: 'Hang Seng',            tickers: ['HSI:HSI', 'TVC:HSI', 'INDEX:HSI'] },
      { code: 'TAIEX',   label: 'Taiwan',         name: 'TAIEX',                tickers: ['TWSE:TAIEX', 'TVC:TWII', 'INDEX:TAIEX'] },
      { code: 'KOSPI',   label: 'Südkorea',       name: 'KOSPI',                tickers: ['KRX:KOSPI', 'TVC:KOSPI', 'INDEX:KOSPI'] },
      { code: 'NIFTY',   label: 'Indien',         name: 'Nifty 50',             tickers: ['NSE:NIFTY', 'TVC:NIFTY', 'INDEX:NIFTY'] },
      { code: 'STI',     label: 'Singapur',       name: 'Straits Times Index',  tickers: ['SGX:STI', 'TVC:STI', 'INDEX:STI'] },
      { code: 'ASX200',  label: 'Australien',     name: 'S&P/ASX 200',          tickers: ['ASX:XJO', 'TVC:AS200', 'INDEX:ASX200'] },
      { code: 'NZ50',    label: 'Neuseeland',     name: 'NZX 50',               tickers: ['NZX:NZ50G', 'TVC:NZ50', 'INDEX:NZ50'] },
      { code: 'JTOPI',   label: 'Südafrika',      name: 'FTSE/JSE Top 40',      tickers: ['JSE:J200', 'TVC:JTOPI', 'INDEX:JTOPI'] },
    ],
  },
];

/** Alle Einträge beider Gruppen (für einen gemeinsamen Fetch). */
export const allIndexEntries = () => INDEX_GROUPS.flatMap((g) => g.entries);

/** TV-Symbolseite zum Scanner-Ticker: `XETR:DAX` → `.../symbols/XETR-DAX/`. */
export const tvIndexUrl = (ticker) =>
  ticker ? `https://www.tradingview.com/symbols/${String(ticker).replace(':', '-')}/` : null;

/* ── Ticker-Cache (localStorage) ──────────────────────────────────────────── */

const CACHE_KEY = 'discovery_index_tickers_v1';

export function loadTickerCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) ?? {}; } catch { return {}; }
}
function saveTickerCache(map) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(map)); } catch { /* Quota – egal */ }
}
/** Auflösung verwerfen, damit der nächste Load neu sucht (Refresh-Button). */
export function clearTickerCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* egal */ }
}

/* ── Fetch ────────────────────────────────────────────────────────────────── */

const DATA_COLUMNS = ['description', 'close', 'change', 'Perf.W', 'Perf.1M', 'Perf.3M', 'Perf.6M'];
const COL = { description: 0, close: 1, change: 2, perf_w: 3, perf_1m: 4, perf_3m: 5, perf_6m: 6 };
const CHUNK = 60;   // Ticker pro Scanner-Request

const chunked = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

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

/** Ein Scanner-Scan; liefert Map ticker → Spaltenwerte (fehlerfrei = leere Map). */
async function scan(backendUrl, secret, market, tickers, columns) {
  const out = new Map();
  await Promise.all(chunked(tickers, CHUNK).map(async (part) => {
    try {
      const bodyStr = await proxyPost(backendUrl, secret,
        `https://scanner.tradingview.com/${market}/scan`,
        { symbols: { tickers: part, query: { types: [] } }, columns },
      );
      for (const r of JSON.parse(bodyStr)?.data ?? []) out.set(r.s, r.d);
    } catch (err) {
      console.warn(`[TV] index scan failed (${market}, ${part.length} Ticker):`, err.message);
    }
  }));
  return out;
}

/**
 * Ermittelt je Eintrag den TV-Ticker: erst Cache, für den Rest ein Scan über
 * alle Kandidaten – der erste Kandidat mit Daten gewinnt.
 * @returns {Promise<Record<string,string>>} code → Ticker (nur Aufgelöste)
 */
export async function resolveTickers({ backendUrl, secret, entries = allIndexEntries() }) {
  const cache = loadTickerCache();
  const open = entries.filter((e) => !cache[e.code]);
  if (!open.length) return cache;

  const candidates = [...new Set(open.flatMap((e) => e.tickers))];
  const found = await scan(backendUrl, secret, 'global', candidates, ['description']);

  let added = 0;
  for (const e of open) {
    const hit = e.tickers.find((t) => found.has(t));
    if (hit) { cache[e.code] = hit; added++; }
  }
  if (added) saveTickerCache(cache);
  return cache;
}

/** Leere Zeile – wird auch als Fallback gerendert, damit die Tabelle steht. */
export function emptyIndexRow(entry, ticker = null) {
  return {
    ...entry,
    ticker,
    url: tvIndexUrl(ticker),
    value: null, change: null,
    perf_w: null, perf_1m: null, perf_3m: null, perf_6m: null,
    growth_m: null,
    ok: false,
  };
}

/**
 * Holt Kurse + Performance für die übergebenen Einträge (Ticker-Auflösung
 * inklusive). Einträge ohne Daten kommen als leere Zeile mit `ok:false` zurück,
 * damit die Statuszeile sie benennen kann.
 *
 * @param {{backendUrl:string, secret:string, entries?:Array}} opts
 * @returns {Promise<Array>} Zeilen in der Reihenfolge der Einträge
 */
export async function fetchIndexRows({ backendUrl, secret, entries = allIndexEntries() }) {
  const tickerOf = await resolveTickers({ backendUrl, secret, entries });
  const tickers = entries.map((e) => tickerOf[e.code]).filter(Boolean);
  const data = tickers.length ? await scan(backendUrl, secret, 'global', tickers, DATA_COLUMNS) : new Map();

  return entries.map((e) => {
    const ticker = tickerOf[e.code] ?? null;
    const d = ticker ? data.get(ticker) : null;
    if (!d) return emptyIndexRow(e, ticker);
    const perf6m = d[COL.perf_6m] ?? null;
    return {
      ...e,
      ticker,
      url:      tvIndexUrl(ticker),
      tvName:   d[COL.description] ?? null,
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
