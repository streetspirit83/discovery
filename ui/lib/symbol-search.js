/**
 * Symbol search via Twelve Data SYMBOL_SEARCH.
 * Endpoint is CORS-enabled and works without a key (IP rate-limited);
 * an optional key (discovery_twelvedata_key) raises the free limit to
 * 800 calls/day. Maps a hit into the Discovery candidate schema.
 */

import { normalizeCandidate } from './import-parser.js';
import { normalizeExchange } from './exchange-map.js';

// Twelve Data MIC code → { internal exchange, Yahoo suffix }.
// MIC is more reliable than the free-text exchange field.
// German regional venues all normalise to Xetra (XETR) – same instrument,
// best data on TV – with the .DE (Xetra) Yahoo suffix.
const MIC_MAP = {
  // US
  XNGS: { ex: 'NASDAQ', ys: '' }, XNMS: { ex: 'NASDAQ', ys: '' }, XNCM: { ex: 'NASDAQ', ys: '' },
  XNAS: { ex: 'NASDAQ', ys: '' },
  XNYS: { ex: 'NYSE', ys: '' }, ARCX: { ex: 'NYSE', ys: '' },
  XASE: { ex: 'AMEX', ys: '' }, BATS: { ex: 'AMEX', ys: '' },
  // Germany → Xetra
  XETR: { ex: 'XETR', ys: '.DE' }, XFRA: { ex: 'XETR', ys: '.DE' }, XMUN: { ex: 'XETR', ys: '.DE' },
  XSTU: { ex: 'XETR', ys: '.DE' }, XBER: { ex: 'XETR', ys: '.DE' }, XDUS: { ex: 'XETR', ys: '.DE' },
  // Europe
  XLON: { ex: 'LSE', ys: '.L' },
  XPAR: { ex: 'EURONEXT', ys: '.PA' }, XAMS: { ex: 'EURONEXT', ys: '.AS' },
  XBRU: { ex: 'EURONEXT', ys: '.BR' }, XLIS: { ex: 'EURONEXT', ys: '.LS' },
  XMIL: { ex: 'MIL', ys: '.MI' }, MTAA: { ex: 'MIL', ys: '.MI' },
  XMAD: { ex: 'BME', ys: '.MC' }, BMEX: { ex: 'BME', ys: '.MC' },
  XSWX: { ex: 'SIX', ys: '.SW' }, XVTX: { ex: 'SIX', ys: '.SW' },
  XWBO: { ex: 'VIE', ys: '.VI' },
  XSTO: { ex: 'OMXSTO', ys: '.ST' }, XCSE: { ex: 'OMXCOP', ys: '.CO' },
  XHEL: { ex: 'OMXHEX', ys: '.HE' }, XOSL: { ex: 'OSL', ys: '.OL' },
};

function regionOf(country = '') {
  const c = country.toLowerCase();
  if (c.includes('united states') || c === 'usa' || c === 'us') return 'US';
  if (c.includes('germany')) return 'DE';
  const eu = ['united kingdom', 'france', 'netherlands', 'belgium', 'italy', 'spain',
    'switzerland', 'austria', 'sweden', 'denmark', 'finland', 'norway', 'ireland', 'portugal'];
  if (eu.some((x) => c.includes(x))) return 'EU';
  return 'other';
}

/** @returns {Promise<Array>} search hits carrying TD fields for the candidate builder */
export async function searchSymbols(keywords) {
  const key = localStorage.getItem('discovery_twelvedata_key');
  const params = new URLSearchParams({ symbol: keywords, outputsize: '30' });
  if (key) params.set('apikey', key);

  const res = await fetch(`https://api.twelvedata.com/symbol_search?${params}`);
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
  const data = await res.json();

  if (data.status === 'error') {
    if (data.code === 429) throw new Error('Twelve-Data-Rate-Limit erreicht – Key in Einstellungen hinterlegen für mehr Anfragen.');
    throw new Error('Twelve Data: ' + (data.message || 'unbekannter Fehler'));
  }

  return (data.data || [])
    .filter((m) => m.symbol)
    .map((m) => ({
      symbol: m.symbol,
      name: m.instrument_name || m.symbol,
      exchange: m.exchange || '',
      mic: m.mic_code || '',
      country: m.country || '',
      currency: m.currency || '',
      type: m.instrument_type || '',
      region: regionOf(m.country),
    }));
}

/** Split a Twelve Data hit into Discovery symbol/exchange/yahoo parts. */
export function searchResultToParts(result) {
  const base = result.symbol || '';
  const mic = (result.mic || '').toUpperCase();
  const m = MIC_MAP[mic];
  if (m) {
    return { symbol: base, exchange: m.ex, yahoo_symbol: base + m.ys };
  }
  // Fallback: normalise the free-text TD exchange string (e.g. STU → XETR)
  return { symbol: base, exchange: normalizeExchange(result.exchange || ''), yahoo_symbol: base };
}

/** Build a full Discovery candidate from a search hit. */
export function searchResultToCandidate(result) {
  const parts = searchResultToParts(result);
  return normalizeCandidate({
    symbol: parts.symbol,
    exchange: parts.exchange,
    yahoo_symbol: parts.yahoo_symbol,
    name: result.name,
    sources: [
      {
        adapter: 'manual',
        source_url: '',
        discovered_at: new Date().toISOString(),
        signal_type: 'manual',
        raw_signal: {
          twelvedata: {
            mic_code: result.mic,
            exchange: result.exchange,
            country: result.country,
            currency: result.currency,
            type: result.type,
          },
        },
        info_snippet: `Manuell via Symbol-Suche (${result.exchange || result.region || 'n/a'})`,
      },
    ],
  });
}
