/**
 * Link Builder (browser version)
 */

import { normalizeExchange } from './exchange-map.js';

/**
 * TradingView-Chartseite statt Symbolübersicht: `/chart/?symbol=NASDAQ:AAPL`
 * öffnet direkt den Chart mit Zeichenwerkzeugen, die `/symbols/`-Seite dagegen
 * das Profil. Intervall 1D als Startwert.
 *
 * Die Börse läuft durch `normalizeExchange` — TV kennt XETR, aber keine
 * deutschen Regionalcodes wie FWB oder XSTU.
 */
export function tvChartUrl({ symbol, exchange }) {
  const sym = String(symbol ?? '').trim().toUpperCase();
  if (!sym) return null;
  const exch = normalizeExchange(exchange);
  const ticker = exch ? `${exch}:${sym}` : sym;
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(ticker)}&interval=1D`;
}

export function buildLinks({ symbol, exchange, yahooSymbol }) {
  return {
    tradingview: tvChartUrl({ symbol, exchange }),
    stocktwits: `https://stocktwits.com/symbol/${symbol}`,
    yahoo: `https://finance.yahoo.com/quote/${yahooSymbol}`,
  };
}
