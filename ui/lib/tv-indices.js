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
 *   1. Kandidaten – die (kurze) Liste in `tickers` je Eintrag, ein Scan je
 *                   Scanner-Markt (`RESOLVE_MARKETS`).
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
      // Symbol ist ROBOT (nicht ROBO) – korrigiert nach Prüfung auf TV.
      { code: 'ROBO',     label: 'Robotik & Automation',           name: 'ROBO Global Robotics Index',             tickers: ['SBOX:ROBOT'],        url: 'https://www.tradingview.com/symbols/SBOX-ROBOT/' },
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

const CACHE_KEY = 'discovery_index_tickers_v4';
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

/**
 * Scanner-Märkte, die für die Auflösung durchprobiert werden.
 *
 * Ein `symbols.tickers`-Lookup ist auf den Markt in der URL beschränkt (siehe
 * `tv-enrichment.js`, EURONEXT_FALLBACK_MARKETS) — `global` kennt längst nicht
 * jedes Symbol, das TradingView auf seinen Symbolseiten anzeigt. US-Indizes wie
 * `NASDAQ:NBI` liegen im Markt `america`. Reihenfolge = Trefferwahrscheinlichkeit;
 * der erste Markt mit Daten gewinnt und wird je Index mitgecacht, damit der
 * Datenabruf danach direkt den richtigen Endpunkt trifft.
 */
const RESOLVE_MARKETS = ['global', 'america'];

/**
 * Präfixe, unter denen der Scanner Index-Symbole führt.
 *
 * Belegt durch den Diagnose-Lauf vom 29.07.: **das URL-Präfix ist nicht das
 * Scanner-Präfix.** `TVC:SOX` und `NASDAQ:BKX` liefern Daten, `TVC:DJT` nicht –
 * obwohl DJT davor mit `DJ:DJT`/`INDEX:DJT` sauber aufgelöst hat. Auch die
 * Vorgabeliste selbst nutzt für zwei Dow-Jones-Indizes zwei verschiedene
 * Präfixe (INDEXDJX-DJUSSW vs. DJ-DJINET).
 *
 * Deshalb wird für den DATENABRUF das Symbol unter allen gängigen Präfixen
 * probiert – das ist kein Raten, sondern eine Abfrage: nur was der Scanner mit
 * Daten bestätigt, wird übernommen. Der ANGEZEIGTE TV-Link bleibt in jedem Fall
 * die vorgegebene URL (`entry.url`).
 */
const ALT_PREFIXES = ['DJ', 'INDEXDJX', 'INDEX', 'NASDAQ', 'TVC', 'SP', 'SBOX', 'FTSE', 'CBOE'];

/** Vorgegebener Ticker zuerst, danach dasselbe Symbol unter den Alt-Präfixen. */
export function candidatesFor(entry) {
  const base = entry.tickers ?? [];
  const symbols = [...new Set(base.map((t) => String(t).split(':').pop()))];
  return [...new Set([...base, ...symbols.flatMap((s) => ALT_PREFIXES.map((p) => `${p}:${s}`))])];
}

/* Protokoll des letzten Auflösungslaufs – was wurde je Markt angefragt, was kam
 * zurück, was hat die Suche vorgeschlagen, was blieb offen. Der "Diagnose"-Button
 * im Panel legt das in die Zwischenablage. Ohne diese Fakten ist jede weitere
 * Ticker-Korrektur wieder nur geraten (siehe CLAUDE.md, "Inspect real API
 * responses before writing parsing logic"). */
let lastReport = null;
export const getResolveReport = () => lastReport;

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

/**
 * Vorschläge für einen Suchtext, beste zuerst (exakter Symbol-Match, Typ index).
 * Ein Fehler (Proxy nicht erreichbar, Host nicht in der Allowlist, HTTP-Fehler)
 * wird NICHT verschluckt, sondern im Report vermerkt – sonst sieht ein 403 aus
 * wie "nichts gefunden", und man sucht den Fehler an der falschen Stelle.
 */
async function searchTickers(backendUrl, secret, text, code) {
  const params = new URLSearchParams({
    text, hl: '0', lang: 'en', search_type: 'index', type: 'index', domain: 'production',
  });
  let hits = [];
  try { hits = parseSearchHits(await proxyGet(backendUrl, secret, `${SEARCH_URL}?${params}`)); } catch (err) {
    console.warn(`[TV] Symbolsuche fehlgeschlagen (${text}):`, err.message);
    return { tickers: [], error: err.message };
  }
  const wanted = String(code).toUpperCase();
  const rank = (h) => (h.symbol.toUpperCase() === wanted ? 0 : 1) + (h.type === 'index' ? 0 : 2);
  const sorted = [...hits].sort((a, b) => rank(a) - rank(b));
  return {
    tickers: [...new Set(sorted.map((h) => h.ticker))].slice(0, 4),
    hits: sorted.slice(0, 4).map((h) => `${h.ticker}[${h.type}]`),
    error: null,
  };
}

/**
 * Probiert eine Tickerliste über alle `RESOLVE_MARKETS` (bzw. die per Eintrag
 * gesetzten Märkte) und liefert Map ticker → Markt für alles, was Daten hatte.
 * Bereits gefundene Ticker fallen aus den Folgemärkten raus.
 */
async function findMarkets(backendUrl, secret, tickers, markets = RESOLVE_MARKETS, report = null) {
  const hit = new Map();
  let openTickers = [...new Set(tickers)];
  for (const market of markets) {
    if (!openTickers.length) break;
    const found = await scan(backendUrl, secret, market, openTickers, ['description']);
    if (report) report.marketScans.push({ market, sent: openTickers.length, hits: found.size });
    for (const t of found.keys()) hit.set(t, market);
    openTickers = openTickers.filter((t) => !hit.has(t));
  }
  return hit;
}

/**
 * Ermittelt je Eintrag Ticker UND Scanner-Markt (Kandidaten → Suche →
 * Bestätigung, siehe Modul-Kopf). Gecacht wird nur, was der Scanner mit Daten
 * bestätigt hat.
 * @returns {Promise<Record<string,{t:string,m:string}>>} code → { Ticker, Markt }
 */
/** Fingerabdruck der Ticker-Definition eines Eintrags. Ändert sie sich, sind
 *  Auflösung und Such-Sperre für diesen Code hinfällig. */
const entrySig = (e) => (e.tickers ?? []).join(',');

export async function resolveTickers({ backendUrl, secret, entries = allIndexEntries() }) {
  const cache = loadTickerCache();

  // Korrigierte Ticker sollen sofort greifen: Cache-Einträge, deren Definition
  // sich seit der Auflösung geändert hat, verfallen – inklusive der 24-h-Sperre
  // für erfolglose Suchen. Sonst blockiert ein alter Fehlversuch die Korrektur.
  for (const e of entries) {
    const sig = entrySig(e);
    if (cache.tickers[e.code] && cache.tickers[e.code].sig !== sig) delete cache.tickers[e.code];
    if (cache.tried[e.code]   && cache.tried[e.code].sig   !== sig) delete cache.tried[e.code];
  }

  const report = {
    at: new Date().toISOString(),
    markets: RESOLVE_MARKETS,
    marketScans: [],          // { market, sent, hits } je Scan
    searchErrors: [],         // Fehler der Symbolsuche (403 ≠ "nichts gefunden")
    searchHits: {},           // code → was die Suche vorgeschlagen hat
    unresolved: [],           // { code, tried:[…] }
  };
  lastReport = report;

  let open = entries.filter((e) => !cache.tickers[e.code]);
  if (!open.length) {
    report.note = 'alles aus dem Cache';
    return cache.tickers;
  }

  let dirty = false;

  // Stufe 1: vorgegebener Ticker + dasselbe Symbol unter den Alt-Präfixen,
  // über alle Märkte. Reihenfolge = Vorgabe zuerst.
  const candOf = new Map(open.map((e) => [e.code, candidatesFor(e)]));
  const found = await findMarkets(backendUrl, secret, [...candOf.values()].flat(), RESOLVE_MARKETS, report);
  for (const e of open) {
    const hit = candOf.get(e.code).find((t) => found.has(t));
    if (hit) { cache.tickers[e.code] = { t: hit, m: found.get(hit), sig: entrySig(e) }; dirty = true; }
  }
  open = open.filter((e) => !cache.tickers[e.code]);

  // Stufe 2: Suche – erst Kürzel, ersatzweise Indexname. Kürzlich erfolglose
  // Codes bleiben aussen vor (RETRY_AFTER_MS).
  const now = Date.now();
  const toSearch = open.filter((e) => {
    const t = cache.tried[e.code];
    return !t || now - new Date(t.at).getTime() > RETRY_AFTER_MS;
  });
  report.searchSkipped = open.filter((e) => !toSearch.includes(e)).map((e) => e.code);

  const proposals = new Map();   // code → Ticker-Vorschläge
  for (const batch of chunked(toSearch, SEARCH_BATCH)) {
    await Promise.all(batch.map(async (e) => {
      let res = await searchTickers(backendUrl, secret, e.code, e.code);
      if (!res.tickers.length && !res.error) res = await searchTickers(backendUrl, secret, e.name, e.code);
      if (res.error) report.searchErrors.push(`${e.code}: ${res.error}`);
      else report.searchHits[e.code] = res.hits ?? [];
      if (res.tickers.length) proposals.set(e.code, res.tickers);
    }));
  }

  // Stufe 3: Vorschläge durch den Scanner bestätigen (ebenfalls über alle Märkte)
  if (proposals.size) {
    const confirmed = await findMarkets(backendUrl, secret, [...proposals.values()].flat(), RESOLVE_MARKETS, report);
    for (const e of toSearch) {
      const hit = (proposals.get(e.code) ?? []).find((t) => confirmed.has(t));
      if (hit) cache.tickers[e.code] = { t: hit, m: confirmed.get(hit), sig: entrySig(e) };
    }
  }
  for (const e of toSearch) {
    if (!cache.tickers[e.code]) cache.tried[e.code] = { at: new Date().toISOString(), sig: entrySig(e) };
  }
  if (toSearch.length) dirty = true;

  for (const e of entries) {
    if (!cache.tickers[e.code]) report.unresolved.push({ code: e.code, tried: candidatesFor(e) });
  }
  report.resolved = cache.tickers;

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
  const resolved = await resolveTickers({ backendUrl, secret, entries });

  // Je Scanner-Markt ein Datenabruf – ein `symbols.tickers`-Lookup gilt nur für
  // den Markt in der URL, deshalb wird der bei der Auflösung gefundene Markt
  // mitgeführt statt pauschal `global` anzufragen.
  const byMarket = new Map();
  for (const e of entries) {
    const r = resolved[e.code];
    if (!r) continue;
    if (!byMarket.has(r.m)) byMarket.set(r.m, []);
    byMarket.get(r.m).push(r.t);
  }
  const data = new Map();
  await Promise.all([...byMarket.entries()].map(async ([market, tickers]) => {
    for (const [t, d] of await scan(backendUrl, secret, market, tickers, DATA_COLUMNS)) data.set(t, d);
  }));

  return entries.map((e) => {
    const ticker = resolved[e.code]?.t ?? null;
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
