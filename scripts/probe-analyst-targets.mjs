/** Probe 4: Warum liefert die echte Anfrage keine Kursziele?
 *  Schickt die ECHTE TV_COLUMNS-Liste aus dem Repo (131 Spalten) und prüft,
 *  wie viele Werte zurückkommen und was an den Kursziel-Indizes steht. */
import { readFileSync } from 'node:fs';

const src = readFileSync('ui/lib/tv-enrichment.js', 'utf8');
const arr = src.match(/const TV_COLUMNS\s*=\s*\[(.*?)\n\];/s)[1];
const COLS = [...arr.matchAll(/'([^']+)'/g)].map((m) => m[1]);
const idx = Object.fromEntries(['price_target_average','price_target_high','price_target_low',
  'price_target_median','recommendation_buy','recommendation_hold','recommendation_sell',
  'recommendation_total'].map((n) => [n, COLS.indexOf(n)]));
console.log(`TV_COLUMNS: ${COLS.length} Spalten · Indizes`, idx);

const UA = 'Mozilla/5.0 (compatible; DiscoveryBot/1.0)';   // derselbe UA wie die scrape-proxy
async function scan(market, ticker, columns, withMarkets = true) {
  const body = { ...(withMarkets ? { markets: [market] } : {}),
    symbols: { tickers: [ticker] }, columns };
  const res = await fetch(`https://scanner.tradingview.com/${market}/scan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify(body) });
  const text = await res.text();
  let d = null, err = null;
  try { d = JSON.parse(text)?.data?.[0]?.d ?? null; } catch { err = text.slice(0, 200); }
  return { status: res.status, d, err, raw: text.slice(0, 200) };
}

for (const [market, ticker] of [['america', 'NASDAQ:AAPL'], ['germany', 'XETR:SAP']]) {
  console.log(`\n══ ${ticker}`);

  const full = await scan(market, ticker, COLS);
  console.log(`  volle Liste (${COLS.length} Spalten): HTTP ${full.status}, zurück ${full.d?.length ?? '—'} Werte`);
  if (full.d) {
    for (const [name, i] of Object.entries(idx)) {
      console.log(`     [${i}] ${name.padEnd(28)} ${JSON.stringify(full.d[i])}`);
    }
  } else console.log('     Fehler:', full.err ?? full.raw);

  // Gegenprobe 1: nur die Kursziel-Spalten
  const solo = await scan(market, ticker, ['close', 'price_target_average', 'price_target_high']);
  console.log(`  nur 3 Spalten: HTTP ${solo.status} →`, JSON.stringify(solo.d));

  // Gegenprobe 2: volle Liste OHNE das "markets"-Feld im Body
  const noMarkets = await scan(market, ticker, COLS, false);
  console.log(`  volle Liste ohne markets-Feld: HTTP ${noMarkets.status}, zurück ${noMarkets.d?.length ?? '—'} Werte,`,
    `PT-Ø ${JSON.stringify(noMarkets.d?.[idx.price_target_average])}`);

  // Gegenprobe 3: wie viele Spalten kommen bei 120 / 131 / 140 zurück?
  for (const n of [120, 131]) {
    const cut = await scan(market, ticker, COLS.slice(0, n));
    console.log(`  erste ${n} Spalten → zurück ${cut.d?.length ?? '—'} Werte`);
  }
}
