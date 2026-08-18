/**
 * Probe 2: hat der TV-Scanner auch die ANZAHL der Schätzungen / die
 * Empfehlungs-Verteilung? Wichtig: der Scanner antwortet auf unbekannte
 * Spalten mit HTTP 200 und `null` — Existenz beweist nur ein Wert ≠ null
 * über mehrere Titel hinweg.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CANDIDATES = [
  'price_target_estimates_num', 'num_of_analysts', 'analyst_count', 'analysts_num',
  'price_target_num', 'estimates_num', 'recommendation_total', 'recommendation_buy',
  'recommendation_hold', 'recommendation_sell', 'recommendation_strong_buy',
  'Recommend.MA', 'Recommend.Other', 'price_target_date', 'price_target_period',
  'earnings_per_share_forecast_fq', 'revenue_forecast_fq', 'price_earnings_growth_ttm',
];
const TICKERS = [['america','NASDAQ:AAPL'],['america','NYSE:F'],['germany','XETR:SAP']];

for (const [market, ticker] of TICKERS) {
  const res = await fetch(`https://scanner.tradingview.com/${market}/scan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ symbols: { tickers: [ticker], query: { types: [] } },
      columns: ['close', ...CANDIDATES] }),
  });
  const d = (await res.json())?.data?.[0]?.d ?? [];
  console.log(`\n${ticker} HTTP ${res.status}`);
  CANDIDATES.forEach((c, i) => {
    const v = d[i + 1];
    console.log(`  ${v == null ? '—    ' : 'WERT '} ${c.padEnd(34)} ${JSON.stringify(v)}`);
  });
}
