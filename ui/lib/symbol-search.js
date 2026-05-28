/**
 * Symbol search via Alpha Vantage SYMBOL_SEARCH.
 * API key is read from localStorage (discovery_alphavantage_key).
 * Maps a search hit into the Discovery candidate schema.
 */

import { normalizeCandidate } from './import-parser.js';

// Alpha Vantage symbol suffix → { TV exchange, Yahoo suffix }
const AV_SUFFIX = {
  LON: { ex: 'LSE', ys: '.L' },
  DEX: { ex: 'XETR', ys: '.DE' },
  FRK: { ex: 'FWB', ys: '.F' },
  BER: { ex: 'BER', ys: '.BE' },
  STU: { ex: 'STU', ys: '.SG' },
  PAR: { ex: 'EURONEXT', ys: '.PA' },
  AMS: { ex: 'EURONEXT', ys: '.AS' },
  BRU: { ex: 'EURONEXT', ys: '.BR' },
  MIL: { ex: 'MIL', ys: '.MI' },
  MCE: { ex: 'BME', ys: '.MC' },
  SWX: { ex: 'SIX', ys: '.SW' },
  STO: { ex: 'OMXSTO', ys: '.ST' },
  CPH: { ex: 'OMXCOP', ys: '.CO' },
  HEL: { ex: 'OMXHEX', ys: '.HE' },
  OSL: { ex: 'OSE', ys: '.OL' },
  TRT: { ex: 'TSX', ys: '.TO' },
};

function regionOf(avRegion = '') {
  const r = avRegion.toLowerCase();
  if (r.includes('united states') || r === 'us') return 'US';
  if (r.includes('germany') || r.includes('xetra') || r.includes('frankfurt')) return 'DE';
  const eu = ['united kingdom', 'france', 'netherlands', 'belgium', 'italy', 'spain',
    'switzerland', 'austria', 'sweden', 'denmark', 'finland', 'norway', 'ireland', 'portugal'];
  if (eu.some((c) => r.includes(c))) return 'EU';
  return 'other';
}

/** @returns {Promise<Array<{symbol,name,type,region,currency,score}>>} */
export async function searchSymbols(keywords) {
  // No hard block: fall back to Alpha Vantage's documented "demo" key so the
  // lookup still works for demo keywords (e.g. "tesco") without configuration.
  // Configure a real key in Settings for unrestricted search.
  const key = localStorage.getItem('discovery_alphavantage_key') || 'demo';

  const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(keywords)}&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
  const data = await res.json();

  if (data.Note) throw new Error('Alpha-Vantage-Rate-Limit erreicht (5/min, 25/Tag im Free-Tier).');
  if (data.Information) throw new Error('Alpha Vantage: ' + data.Information);
  if (data['Error Message']) throw new Error('Alpha Vantage: ungültige Anfrage.');

  return (data.bestMatches || []).map((m) => ({
    symbol: m['1. symbol'],
    name: m['2. name'],
    type: m['3. type'],
    region: m['4. region'],
    currency: m['8. currency'],
    score: parseFloat(m['9. matchScore'] || '0'),
  }));
}

/** Split an Alpha Vantage symbol into Discovery symbol/exchange/yahoo parts. */
export function searchResultToParts(result) {
  const raw = result.symbol || '';
  const dot = raw.lastIndexOf('.');
  if (dot > 0) {
    const base = raw.slice(0, dot);
    const suf = raw.slice(dot + 1).toUpperCase();
    const m = AV_SUFFIX[suf];
    if (m) return { symbol: base, exchange: m.ex, yahoo_symbol: base + m.ys };
    return { symbol: base, exchange: '', yahoo_symbol: raw };
  }
  return { symbol: raw, exchange: '', yahoo_symbol: raw };
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
          alpha_vantage: { region: result.region, type: result.type, currency: result.currency },
        },
        info_snippet: `Manuell via Symbol-Suche (${result.region || 'n/a'})`,
      },
    ],
  });
}
