/**
 * Link Builder – generates external research links for a candidate.
 */

/**
 * Build a TradingView URL for a symbol on a given exchange.
 * @param {string} exchange - TradingView exchange name (e.g. "NASDAQ", "XETR")
 * @param {string} symbol   - base ticker symbol (no suffix)
 * @returns {string}
 */
export function buildTradingViewUrl(exchange, symbol) {
  return `https://www.tradingview.com/symbols/${exchange}-${symbol}/`;
}

/**
 * Build a StockTwits URL.
 * @param {string} symbol - base ticker symbol
 * @returns {string}
 */
export function buildStockTwitsUrl(symbol) {
  return `https://stocktwits.com/symbol/${symbol}`;
}

/**
 * Build a Yahoo Finance URL.
 * @param {string} yahooSymbol - full Yahoo Finance symbol (e.g. "SAP.DE", "AAPL")
 * @returns {string}
 */
export function buildYahooUrl(yahooSymbol) {
  return `https://finance.yahoo.com/quote/${yahooSymbol}`;
}

/**
 * Build all standard links for a candidate.
 *
 * @param {object} params
 * @param {string} params.exchange    - TradingView exchange
 * @param {string} params.symbol      - base symbol
 * @param {string} params.yahooSymbol - full Yahoo symbol
 * @returns {{ tradingview: string, stocktwits: string, yahoo: string }}
 */
export function buildLinks({ exchange, symbol, yahooSymbol }) {
  return {
    tradingview: buildTradingViewUrl(exchange, symbol),
    stocktwits: buildStockTwitsUrl(symbol),
    yahoo: buildYahooUrl(yahooSymbol),
  };
}
