/** Probe 3: Braucht Yahoos quoteSummary wirklich Cookie+Crumb? Und was steckt
 *  im crumb-freien insights-Endpunkt? Entscheidet, ob der Yahoo-Fallback eine
 *  Änderung an der scrape-proxy braucht. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const H = { 'User-Agent': UA, Accept: 'application/json', Origin: 'https://finance.yahoo.com', Referer: 'https://finance.yahoo.com/' };
// Genau so, wie unsere scrape-proxy es täte: eine Anfrage, keine Cookies.
for (const sym of ['AAPL', 'SAP.DE', 'SMCI']) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${sym}?modules=financialData`;
  const res = await fetch(url, { headers: H });
  const t = await res.text();
  console.log(`ohne Crumb  ${sym.padEnd(8)} HTTP ${res.status}  ${t.slice(0, 150)}`);
}
// Und mit dem UA, den die scrape-proxy per Default setzt (DiscoveryBot):
const r = await fetch('https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=financialData',
  { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscoveryBot/1.0)' } });
console.log(`DiscoveryBot-UA      HTTP ${r.status}  ${(await r.text()).slice(0, 120)}`);

// insights v2 (kein Crumb nötig) — welche Kursziel-Felder stecken da drin?
const ins = await fetch('https://query1.finance.yahoo.com/ws/insights/v2/finance/insights?symbol=AAPL', { headers: H });
const j = await ins.json();
const info = j?.finance?.result?.instrumentInfo ?? {};
console.log('\ninsights v2 → Struktur:', Object.keys(j?.finance?.result ?? {}).join(', '));
console.log('instrumentInfo:', Object.keys(info).join(', '));
console.log('valuation:', JSON.stringify(info.valuation));
console.log('recommendation:', JSON.stringify(info.recommendation));
console.log('technicalEvents.targetPrice?:', JSON.stringify(info.technicalEvents?.shortTermOutlook));
