/**
 * Link Builder (browser version)
 */

export function buildLinks({ symbol, exchange, yahooSymbol }) {
  return {
    tradingview: `https://www.tradingview.com/symbols/${exchange}-${symbol}/`,
    stocktwits: `https://stocktwits.com/symbol/${symbol}`,
    yahoo: `https://finance.yahoo.com/quote/${yahooSymbol}`,
  };
}
