/**
 * Exchange code normalisation – single source of truth.
 *
 * Maps the many regional/alias venue codes that arrive from Twelve Data
 * (MIC + free-text), watchlist imports and adapters onto the canonical
 * internal exchange codes that the TradingView enrichment understands.
 *
 * Key case: German equities. Frankfurt floor (FWB/XFRA), Stuttgart
 * (XSTU/SWB), Munich (MUN), Tradegate, Gettex etc. all list the *same*
 * instrument; Xetra (XETR) is the reference venue with the deepest, most
 * reliable price + fundamental data on TV. We therefore normalise every
 * German venue to XETR. The TV scanner has no data under MIC codes like
 * XSTU (its Stuttgart prefix is SWB), so normalising also avoids the
 * MIC-vs-TV-prefix trap.
 */

// alias / regional code → canonical internal exchange
const ALIASES = {
  // Germany → Xetra (same instrument, best data on TV)
  XETRA: 'XETR', ETR: 'XETR', GER: 'XETR', DE: 'XETR',
  FWB: 'XETR', XFRA: 'XETR', FRA: 'XETR', F: 'XETR',
  STU: 'XETR', XSTU: 'XETR', SWB: 'XETR',
  MUN: 'XETR', XMUN: 'XETR',
  BER: 'XETR', XBER: 'XETR',
  DUS: 'XETR', XDUS: 'XETR',
  HAM: 'XETR', XHAM: 'XETR', HAN: 'XETR', XHAN: 'XETR',
  GAT: 'XETR', TRADEGATE: 'XETR', GETTEX: 'XETR',
  // US aliases
  XNGS: 'NASDAQ', XNMS: 'NASDAQ', XNCM: 'NASDAQ', XNAS: 'NASDAQ',
  XNYS: 'NYSE', ARCX: 'NYSE', XASE: 'AMEX', BATS: 'AMEX',
  // Nordics / Austria – align to the codes TV actually accepts
  STO: 'OMXSTO', XSTO: 'OMXSTO',
  HEL: 'OMXHEX', XHEL: 'OMXHEX',
  OMXCO: 'OMXCOP', CPH: 'OMXCOP', XCSE: 'OMXCOP', KFX: 'OMXCOP',
  OMXNO: 'OSL', OSE: 'OSL', XOSL: 'OSL', OL: 'OSL',
  WBAG: 'VIE', XWBO: 'VIE',
};

/**
 * @param {string} code raw exchange/MIC code
 * @returns {string} canonical internal exchange code (uppercased, aliases resolved)
 */
export function normalizeExchange(code) {
  if (!code) return code;
  const up = String(code).trim().toUpperCase();
  return ALIASES[up] ?? up;
}
