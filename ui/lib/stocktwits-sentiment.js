/**
 * StockTwits Retail-Sentiment (Bull/Bear-Quote je Symbol).
 *
 * Quelle: `api.stocktwits.com/api/2/symbols/{SYM}/sentiment.json` — öffentlich,
 * ohne Key. Liefert eine **Tagesreihe der letzten ~60 Tage** mit
 * `{ bullish, bearish, timestamp }` in Prozent (summiert auf 100).
 *
 * Wichtig (per Live-Response verifiziert, nicht angenommen):
 * - Der Message-Stream (`streams/symbol/{SYM}.json`) ist als Quelle **unbrauchbar**:
 *   `entities.sentiment` ist bei den meisten Messages `null`, weil die wenigsten
 *   Nutzer ihre Posts taggen. Deshalb dieser Aggregat-Endpoint statt Eigenbau.
 * - `data` kommt **absteigend** (Index 0 = heute). Für die Sparkline drehen wir
 *   auf alt→neu.
 *
 * Einordnung: Das ist Retail-Stimmung, **kein Qualitätsmaß**. Es gehört neben
 * die TV-Scores, nicht in sie hinein (siehe CLAUDE.md: die ungerichteten Scores
 * dürfen nicht vermischt werden). Extremwerte sind eher Kontra-Indikator als
 * Bestätigung — dafür das `extreme`-Flag.
 *
 * Browser → StockTwits hat kein CORS, der Call geht über die scrape-proxy.
 *
 * Output: { bullish, bearish, avg7, avg30, delta7, extreme, series, days, date, checked_at }
 *       | { unsupported:true, checked_at }   (nicht-US-Titel)
 *       | { error, checked_at }
 */

// tv-swings.js ist unverändert → bewusst der bestehende ?v=-Tag, sonst lädt der
// Browser das Modul ein zweites Mal (eigene Instanz pro URL).
import { isUsTicker } from './tv-swings.js?v=20260807a';

const ENDPOINT = 'https://api.stocktwits.com/api/2/symbols';

// Tagesreihe ändert sich langsam → 60 min Cache, spart Requests beim Blättern.
const TTL_MS = 60 * 60 * 1000;
const cacheKey = (sym) => `discovery_st_sentiment_${sym}`;

// Ab hier gilt die Menge als einseitig positioniert (Kontra-Indikator-Zone).
const EXTREME_BULL = 75;
const EXTREME_BEAR = 25;

const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

function readCache(sym) {
  try {
    const raw = localStorage.getItem(cacheKey(sym));
    if (!raw) return null;
    const { at, payload } = JSON.parse(raw);
    if (!at || Date.now() - at > TTL_MS) return null;
    return payload;
  } catch { return null; }
}

function writeCache(sym, payload) {
  try {
    localStorage.setItem(cacheKey(sym), JSON.stringify({ at: Date.now(), payload }));
  } catch { /* Quota/Private-Mode — Cache ist optional */ }
}

async function proxyGet(url, { backendUrl, secret }) {
  const proxyUrl = `${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`;
  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
    body: JSON.stringify({ url, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' } }),
  });
  const wrapper = await res.json();
  if (!wrapper?.ok || wrapper.status !== 200) return null;
  return wrapper.body;
}

/**
 * Rechnet die rohe Tagesreihe in die Anzeigewerte um.
 * `rows` erwartet die API-Reihenfolge (neueste zuerst).
 */
export function computeSentiment(rows) {
  const clean = (rows ?? [])
    .filter((r) => Number.isFinite(r?.bullish))
    .map((r) => ({ bullish: r.bullish, bearish: r.bearish, ts: r.timestamp }));
  if (clean.length === 0) return null;

  const latest = clean[0];
  const bulls  = clean.map((r) => r.bullish);

  const avg7  = mean(bulls.slice(0, 7));
  const avg30 = mean(bulls.slice(0, 30));

  return {
    bullish: latest.bullish,
    bearish: latest.bearish,
    // Stimmungs-Momentum: heutiger Wert gegen den eigenen 7-Tage-Schnitt.
    avg7,
    avg30,
    delta7: avg7 == null ? null : latest.bullish - avg7,
    extreme: latest.bullish >= EXTREME_BULL ? 'bull'
      : latest.bullish <= EXTREME_BEAR ? 'bear'
      : null,
    // alt → neu, damit die Sparkline in Leserichtung läuft
    series: bulls.slice().reverse(),
    days: clean.length,
    date: latest.ts ?? null,
  };
}

export async function fetchStocktwitsSentiment(candidate, { backendUrl, secret }) {
  const now = new Date().toISOString();

  // StockTwits kennt praktisch nur US-Ticker — für XETR & Co. gibt es keine Reihe.
  if (!isUsTicker(candidate)) return { unsupported: true, checked_at: now };

  const sym = String(candidate.symbol ?? '').trim().toUpperCase();
  if (!sym) return { unsupported: true, checked_at: now };

  const cached = readCache(sym);
  if (cached) return cached;

  let body;
  try {
    body = await proxyGet(`${ENDPOINT}/${encodeURIComponent(sym)}/sentiment.json`, { backendUrl, secret });
  } catch (err) {
    return { error: err.message, checked_at: now };
  }
  if (!body) return { error: 'StockTwits nicht erreichbar', checked_at: now };

  let json; try { json = JSON.parse(body); } catch { json = null; }
  if (json?.response?.status !== 200) return { error: 'StockTwits-Fehler', checked_at: now };

  const computed = computeSentiment(json?.data);
  if (!computed) return { error: 'Keine Sentiment-Daten', checked_at: now };

  const payload = { ...computed, checked_at: now };
  writeCache(sym, payload);
  return payload;
}
