/**
 * Indizes-Daten für den "Indices"-Tab im Markets-Modal.
 *
 * Zwei Gruppen (= die beiden Sub-Tabs): `branchen` und `laender`. Jeder Eintrag
 * ist `{ code, name, label, tickers, url? }` – `code` ist das Kürzel aus der
 * abgestimmten Liste, `label` die Branche bzw. das Land.
 *
 * **Branchen sind fest vorgegeben** (Ticker + Direkt-URL aus der abgestimmten
 * Tabelle, nichts abgeleitet). Ist `url` gesetzt, zeigt der TV-Link immer
 * dorthin – auch wenn der Scanner die Kursdaten unter einem anderen Symbol
 * führt und die Suche (Stufe 2) eines findet. Link = Vorgabe, Daten = was
 * messbar ist; die beiden werden bewusst nicht vermischt.
 *
 * ── Ticker-Auflösung: Suche schlägt vor, Scanner bestätigt ───────────────────
 * Das TV-Präfix UND der TV-Symbolname eines Index sind nicht ableitbar
 * (SP: / DJ: / NASDAQ: / TVC: / EURONEXT: / börsenspezifisch …) und waren beim
 * Bau nicht live prüfbar. `resolveTickers()` rät deshalb nicht, sondern läuft
 * in drei Stufen – gecacht wird ausschließlich, was der Scanner mit echten
 * Daten bestätigt hat:
 *   1. Kandidaten – die (kurze) Liste in `tickers` je Eintrag, ein Scan.
 *   2. Suche      – für alles Offene `symbol-search.tradingview.com` mit dem
 *                   Kürzel, ersatzweise mit dem Indexnamen.
 *   3. Bestätigung – die Vorschläge aus 2. gehen erneut durch den Scanner; nur
 *                   Treffer mit Daten werden gecacht.
 * Nicht auflösbare Indizes werden in der Statuszeile des Panels benannt – kein
 * stilles "–". Erfolglose Suchen werden 24 h nicht wiederholt.
 * Ein Index mit genau einem Kandidaten ist bereits verifiziert (aus
 * `tv-enrichment.js` `MARKET_INDICATORS` bzw. aus einem Live-Lauf).
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
      // Vorgegebene Liste – Ticker und Direkt-URL exakt wie abgestimmt, nicht
      // abgeleitet. `url` ist gesetzt ⇒ der TV-Link zeigt IMMER hierhin, auch
      // wenn der Scanner die Daten unter einem anderen Symbol führt.
      { code: 'SOX',      label: 'Halbleiter',                     name: 'PHLX Semiconductor Index',               tickers: ['TVC:SOX'],           url: 'https://www.tradingview.com/symbols/TVC-SOX/' },
      { code: 'NBI',      label: 'Biotechnologie',                 name: 'NASDAQ Biotechnology Index',             tickers: ['NASDAQ:NBI'],        url: 'https://www.tradingview.com/symbols/NASDAQ-NBI/' },
      { code: 'DJUSSW',   label: 'Software',                       name: 'Dow Jones U.S. Software Index',          tickers: ['INDEXDJX:DJUSSW'],   url: 'https://www.tradingview.com/symbols/INDEXDJX-DJUSSW/' },
      { code: 'DJINET',   label: 'Internet',                       name: 'Dow Jones Internet Index',               tickers: ['DJ:DJINET'],         url: 'https://www.tradingview.com/symbols/DJ-DJINET/' },
      { code: 'HXR',      label: 'Cybersecurity',                  name: 'ISE Cyber Security Index',               tickers: ['INDEXDJX:HXR'],      url: 'https://www.tradingview.com/symbols/INDEXDJX-HXR/' },
      { code: 'EMCLOUD',  label: 'Cloud Computing',                name: 'BVP Nasdaq Emerging Cloud Index',        tickers: ['NASDAQ:EMCLOUD'],    url: 'https://www.tradingview.com/symbols/NASDAQ-EMCLOUD/' },
      { code: 'XBAI',     label: 'Künstliche Intelligenz',         name: 'Indxx AI & Big Data Index',              tickers: ['SBOX:XBAI'],         url: 'https://www.tradingview.com/symbols/SBOX-XBAI/' },
      { code: 'ROBO',     label: 'Robotik & Automation',           name: 'ROBO Global Robotics Index',             tickers: ['SBOX:ROBO'],         url: 'https://www.tradingview.com/symbols/SBOX-ROBO/' },
      { code: 'IXFT',     label: 'Fintech',                        name: 'Indxx Global Fintech Index',             tickers: ['SBOX:IXFT'],         url: 'https://www.tradingview.com/symbols/SBOX-IXFT/' },
      { code: 'BKX',      label: 'Banken',                         name: 'KBW Nasdaq Bank Index',                  tickers: ['NASDAQ:BKX'],        url: 'https://www.tradingview.com/symbols/NASDAQ-BKX/' },
      { code: 'KRX',      label: 'Regionalbanken',                 name: 'KBW Regional Banking Index',             tickers: ['NASDAQ:KRX'],        url: 'https://www.tradingview.com/symbols/NASDAQ-KRX/' },
      { code: 'KIX',      label: 'Versicherungen',                 name: 'KBW Insurance Index',                    tickers: ['NASDAQ:KIX'],        url: 'https://www.tradingview.com/symbols/NASDAQ-KIX/' },
      { code: 'SPN',      label: 'Energie',                        name: 'S&P 500 Energy Sector',                  tickers: ['SP:SPN'],            url: 'https://www.tradingview.com/symbols/SP-SPN/' },
      { code: 'SPSIOP',   label: 'Öl & Gas Exploration',           name: 'S&P Oil & Gas Exploration & Prod.',      tickers: ['SP:SPSIOP'],         url: 'https://www.tradingview.com/symbols/SP-SPSIOP/' },
      { code: 'DJUSUT',   label: 'Versorger',                      name: 'Dow Jones U.S. Utilities Index',         tickers: ['INDEXDJX:DJUSUT'],   url: 'https://www.tradingview.com/symbols/INDEXDJX-DJUSUT/' },
      { code: 'SPGTCLEN', label: 'Erneuerbare Energien',           name: 'S&P Global Clean Energy Index',          tickers: ['SP:SPGTCLEN'],       url: 'https://www.tradingview.com/symbols/SP-SPGTCLEN/' },
      { code: 'FNRE',     label: 'Immobilien (REITs)',             name: 'FTSE Nareit All Equity REITs',           tickers: ['FTSE:FNRE'],         url: 'https://www.tradingview.com/symbols/FTSE-FNRE/' },
      { code: 'DJUSIN',   label: 'Industrie',                      name: 'Dow Jones U.S. Industrials',             tickers: ['INDEXDJX:DJUSIN'],   url: 'https://www.tradingview.com/symbols/INDEXDJX-DJUSIN/' },
      { code: 'DJUSAS',   label: 'Luft-/Raumfahrt',                name: 'Dow Jones U.S. Aerospace & Defense',     tickers: ['INDEXDJX:DJUSAS'],   url: 'https://www.tradingview.com/symbols/INDEXDJX-DJUSAS/' },
      { code: 'SPAUTO',   label: 'Automobil',                      name: 'S&P Global Automotive Index',            tickers: ['SP:SPAUTO'],         url: 'https://www.tradingview.com/symbols/SP-SPAUTO/' },
      { code: 'SPLUX',    label: 'Luxusgüter',                     name: 'S&P Global Luxury Index',                tickers: ['SP:SPLUX'],          url: 'https://www.tradingview.com/symbols/SP-SPLUX/' },
      { code: 'S5COND',   label: 'Konsumgüter',                    name: 'S&P Consumer Discretionary',             tickers: ['SP:S5COND'],         url: 'https://www.tradingview.com/symbols/SP-S5COND/' },
      { code: 'S5CONS',   label: 'Basiskonsum',                    name: 'S&P Consumer Staples',                   tickers: ['SP:S5CONS'],         url: 'https://www.tradingview.com/symbols/SP-S5CONS/' },
      { code: 'S5HLTH',   label: 'Gesundheitswesen',               name: 'S&P Health Care',                        tickers: ['SP:S5HLTH'],         url: 'https://www.tradingview.com/symbols/SP-S5HLTH/' },
      { code: 'DJUSMS',   label: 'Medizintechnik',                 name: 'Dow Jones U.S. Medical Equipment',       tickers: ['INDEXDJX:DJUSMS'],   url: 'https://www.tradingview.com/symbols/INDEXDJX-DJUSMS/' },
      { code: 'S5CHEM',   label: 'Chemie',                         name: 'S&P Chemicals',                          tickers: ['SP:S5CHEM'],         url: 'https://www.tradingview.com/symbols/SP-S5CHEM/' },
      { code: 'SPMTMN',   label: 'Metalle & Bergbau',              name: 'S&P Metals & Mining',                    tickers: ['SP:SPMTMN'],         url: 'https://www.tradingview.com/symbols/SP-SPMTMN/' },
      { code: 'DJT',      label: 'Transport',                      name: 'Dow Jones Transportation Average',       tickers: ['TVC:DJT'],           url: 'https://www.tradingview.com/symbols/TVC-DJT/' },
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

/* ── Ticker-Cache (localStorage) ──────────────────────────────────────────────
 * `{ tickers: { code: ticker }, tried: { code: isoDate } }`
 * `tickers` = vom Scanner bestätigt. `tried` = erfolglose Suche, wird 24 h
 * nicht wiederholt, damit ein dauerhaft fehlender Index nicht bei jedem
 * Tab-Öffnen 20+ Suchanfragen auslöst.
 */

const CACHE_KEY = 'discovery_index_tickers_v2';
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

export function loadTickerCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    return { tickers: c?.tickers ?? {}, tried: c?.tried ?? {} };
  } catch { return { tickers: {}, tried: {} }; }
}
function saveTickerCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* Quota – egal */ }
}
/** Auflösung verwerfen, damit der nächste Load komplett neu sucht. */
export function clearTickerCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* egal */ }
}
/** Nur die 24-h-Sperre für erfolglose Suchen lösen (manueller Refresh). */
export function clearSearchBackoff() {
  const cache = loadTickerCache();
  cache.tried = {};
  saveTickerCache(cache);
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

/* ── Stufe 2: TV-Symbolsuche ──────────────────────────────────────────────── */

const SEARCH_URL = 'https://symbol-search.tradingview.com/symbol_search/v3/';
const SEARCH_BATCH = 5;   // parallele Suchanfragen

async function proxyGet(backendUrl, secret, url) {
  const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
    body: JSON.stringify({ url, method: 'GET' }),
  });
  if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
  const wrapper = await res.json();
  if (!wrapper.ok) throw new Error(`Proxy: ${wrapper.error}`);
  if (wrapper.status !== 200) throw new Error(`TV HTTP ${wrapper.status}`);
  return wrapper.body;
}

/**
 * Defensiv geparst – das genaue Antwort-Schema der Suche ist nicht dokumentiert
 * und war nicht prüfbar. Deshalb: Wurzel als Array ODER `symbols`/`data`,
 * Präfix aus `prefix` ODER `exchange`, HTML-Highlights (`<em>`) raus. Was hier
 * falsch rauskommt, fällt in Stufe 3 durch – nichts davon landet ungeprüft
 * im Cache.
 */
export function parseSearchHits(bodyStr) {
  let json;
  try { json = JSON.parse(bodyStr); } catch { return []; }
  const list = Array.isArray(json) ? json : (json.symbols ?? json.data ?? []);
  if (!Array.isArray(list)) return [];
  const clean = (s) => String(s ?? '').replace(/<[^>]*>/g, '').trim();
  return list.map((h) => {
    const symbol = clean(h.symbol);
    const prefix = clean(h.prefix) || clean(h.exchange);
    return {
      ticker: symbol && prefix ? `${prefix}:${symbol}` : null,
      symbol,
      type: clean(h.type).toLowerCase(),
      description: clean(h.description),
    };
  }).filter((h) => h.ticker);
}

/** Vorschläge für einen Suchtext, beste zuerst (exakter Symbol-Match, Typ index). */
async function searchTickers(backendUrl, secret, text, code) {
  const params = new URLSearchParams({
    text, hl: '0', lang: 'en', search_type: 'index', type: 'index', domain: 'production',
  });
  let hits = [];
  try { hits = parseSearchHits(await proxyGet(backendUrl, secret, `${SEARCH_URL}?${params}`)); } catch (err) {
    console.warn(`[TV] Symbolsuche fehlgeschlagen (${text}):`, err.message);
    return [];
  }
  const wanted = String(code).toUpperCase();
  const rank = (h) => (h.symbol.toUpperCase() === wanted ? 0 : 1) + (h.type === 'index' ? 0 : 2);
  return [...new Set(hits.sort((a, b) => rank(a) - rank(b)).map((h) => h.ticker))].slice(0, 4);
}

/**
 * Ermittelt je Eintrag den TV-Ticker (Kandidaten → Suche → Bestätigung, siehe
 * Modul-Kopf). Gecacht wird nur, was der Scanner mit Daten bestätigt hat.
 * @returns {Promise<Record<string,string>>} code → Ticker (nur Bestätigte)
 */
export async function resolveTickers({ backendUrl, secret, entries = allIndexEntries() }) {
  const cache = loadTickerCache();
  let open = entries.filter((e) => !cache.tickers[e.code]);
  if (!open.length) return cache.tickers;

  let dirty = false;

  // Stufe 1: hinterlegte Kandidaten
  const found = await scan(backendUrl, secret, 'global', [...new Set(open.flatMap((e) => e.tickers))], ['description']);
  for (const e of open) {
    const hit = e.tickers.find((t) => found.has(t));
    if (hit) { cache.tickers[e.code] = hit; dirty = true; }
  }
  open = open.filter((e) => !cache.tickers[e.code]);

  // Stufe 2: Suche – erst Kürzel, ersatzweise Indexname. Kürzlich erfolglose
  // Codes bleiben aussen vor (RETRY_AFTER_MS).
  const now = Date.now();
  const toSearch = open.filter((e) => {
    const t = cache.tried[e.code];
    return !t || now - new Date(t).getTime() > RETRY_AFTER_MS;
  });

  const proposals = new Map();   // code → Ticker-Vorschläge
  for (const batch of chunked(toSearch, SEARCH_BATCH)) {
    await Promise.all(batch.map(async (e) => {
      let tickers = await searchTickers(backendUrl, secret, e.code, e.code);
      if (!tickers.length) tickers = await searchTickers(backendUrl, secret, e.name, e.code);
      if (tickers.length) proposals.set(e.code, tickers);
    }));
  }

  // Stufe 3: Vorschläge durch den Scanner bestätigen
  if (proposals.size) {
    const confirmed = await scan(backendUrl, secret, 'global',
      [...new Set([...proposals.values()].flat())], ['description']);
    for (const e of toSearch) {
      const hit = (proposals.get(e.code) ?? []).find((t) => confirmed.has(t));
      if (hit) cache.tickers[e.code] = hit;
    }
  }
  for (const e of toSearch) {
    if (!cache.tickers[e.code]) cache.tried[e.code] = new Date().toISOString();
  }
  if (toSearch.length) dirty = true;

  if (dirty) saveTickerCache(cache);
  // Aufgelöste Zuordnung ins Log – so lässt sie sich als feste `tickers`-Liste
  // zurück in dieses Modul übernehmen.
  console.info('[TV] Index-Ticker aufgelöst:', JSON.stringify(cache.tickers));
  return cache.tickers;
}

/** TV-Link einer Zeile: die vorgegebene URL gewinnt immer; sonst aus dem
 *  bestätigten Ticker, ersatzweise aus dem ersten Kandidaten. */
const rowUrl = (entry, ticker) => entry.url ?? tvIndexUrl(ticker ?? entry.tickers?.[0]);

/** Leere Zeile – wird auch als Fallback gerendert, damit die Tabelle steht. */
export function emptyIndexRow(entry, ticker = null) {
  return {
    ...entry,
    ticker,
    url: rowUrl(entry, ticker),
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
      url:      rowUrl(e, ticker),
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
