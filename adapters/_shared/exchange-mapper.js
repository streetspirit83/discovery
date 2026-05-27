/**
 * Exchange mapper: Yahoo Finance suffix → TradingView exchange name
 * and MIC → TradingView exchange name
 */

/** @type {Record<string, string>} Yahoo suffix → TradingView exchange */
export const YAHOO_SUFFIX_TO_TV = {
  '.DE': 'XETR',
  '.F': 'FWB',
  '.MU': 'MUN',
  '.BE': 'BER',
  '.HM': 'HAM',
  '.DU': 'DUS',
  '.SG': 'STU',
  '.HA': 'HAN',
  '.PA': 'EURONEXT',
  '.AS': 'EURONEXT',
  '.BR': 'EURONEXT',
  '.MI': 'MIL',
  '.MC': 'BME',
  '.L': 'LSE',
  '.VI': 'VIE',
  '.SW': 'SIX',
  '.ST': 'OMXSTO',
  '.CO': 'OMXCOP',
  '.HE': 'OMXHEX',
  '.OL': 'OSE',
};

/** @type {Record<string, string>} MIC code → TradingView exchange */
export const MIC_TO_TV_EXCHANGE = {
  XNAS: 'NASDAQ',
  XNYS: 'NYSE',
  XASE: 'AMEX',
  ARCX: 'NYSE',
  BATS: 'BATS',
  XETR: 'XETR',
  XFRA: 'FWB',
  XMUN: 'MUN',
  XBER: 'BER',
  XHAM: 'HAM',
  XDUS: 'DUS',
  XSTU: 'STU',
  XHAN: 'HAN',
  XPAR: 'EURONEXT',
  XAMS: 'EURONEXT',
  XBRU: 'EURONEXT',
  XMIL: 'MIL',
  XMAD: 'BME',
  XLON: 'LSE',
  XWBO: 'VIE',
  XSWX: 'SIX',
  XSTO: 'OMXSTO',
  XCSE: 'OMXCOP',
  XHEX: 'OMXHEX',
  XOSL: 'OSE',
};

/**
 * Given a Yahoo Finance ticker symbol (e.g. "SAP.DE", "AAPL"), returns the
 * TradingView exchange name. For US symbols (no suffix) returns null – caller
 * must use a US exchange resolver.
 *
 * @param {string} yahooSymbol
 * @returns {{ exchange: string|null, baseSymbol: string }}
 */
export function resolveExchangeFromYahooSymbol(yahooSymbol) {
  const symbol = yahooSymbol.trim().toUpperCase();

  // Try each known suffix, longest first to avoid prefix conflicts
  const sortedSuffixes = Object.keys(YAHOO_SUFFIX_TO_TV).sort(
    (a, b) => b.length - a.length,
  );

  for (const suffix of sortedSuffixes) {
    if (symbol.endsWith(suffix)) {
      return {
        exchange: YAHOO_SUFFIX_TO_TV[suffix],
        baseSymbol: symbol.slice(0, -suffix.length),
      };
    }
  }

  // No suffix found → US market, caller must resolve
  return { exchange: null, baseSymbol: symbol };
}

/**
 * Convert MIC code to TradingView exchange name.
 * @param {string} mic
 * @returns {string|null}
 */
export function micToTvExchange(mic) {
  return MIC_TO_TV_EXCHANGE[mic.toUpperCase()] ?? null;
}
