/**
 * Einmal-Probe: liefern unsere BESTEHENDEN Quellen Analysten-Kursziele?
 *
 * Läuft im GitHub-Actions-Runner, weil von dort TradingView, Yahoo und FMP
 * erreichbar sind. Sie schreibt rohe Antworten ins Log — keine Parser-Logik,
 * keine Annahmen über Feldnamen (CLAUDE.md: „Inspect real API responses before
 * writing parsing logic").
 *
 * Nach der Auswertung darf diese Datei samt Workflow wieder verschwinden.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const line = (s) => console.log(`\n${'─'.repeat(70)}\n${s}\n${'─'.repeat(70)}`);
const short = (v, n = 400) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s == null ? String(v) : (s.length > n ? `${s.slice(0, n)}…` : s);
};

/* ── 1 · TradingView Scanner ──────────────────────────────────────────────
   Der Scanner ist unsere Hauptquelle (tv-enrichment.js). Unbekannte Spalten
   quittiert er mit einem Fehler — damit lässt sich jede Kandidaten-Spalte
   einzeln auf Existenz prüfen. */
const TV_CANDIDATES = [
  'price_target_average', 'price_target_high', 'price_target_low',
  'price_target_median', 'price_target_estimates_num', 'price_target_currency',
  'target_price_average', 'analyst_target_price', 'price_target_1y',
  'recommendation_mark', 'Recommend.All', 'number_of_analysts',
  'analysts_count', 'total_estimates', 'earnings_per_share_forecast_next_fq',
];

async function tvColumn(col, ticker = 'NASDAQ:AAPL', market = 'america') {
  const res = await fetch(`https://scanner.tradingview.com/${market}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      symbols: { tickers: [ticker], query: { types: [] } },
      columns: ['close', col],
    }),
  });
  const text = await res.text();
  let value = null;
  try { value = JSON.parse(text)?.data?.[0]?.d?.[1]; } catch { /* Fehlertext */ }
  return { status: res.status, ok: res.ok, value, raw: text };
}

async function probeTradingView() {
  line('1 · TradingView Scanner — welche Kursziel-Spalten existieren?');
  const found = [];
  for (const col of TV_CANDIDATES) {
    try {
      const r = await tvColumn(col);
      const mark = r.ok ? '✅' : '❌';
      console.log(`${mark} ${col.padEnd(38)} HTTP ${r.status}  ${r.ok ? `Wert: ${short(r.value, 80)}` : short(r.raw, 120)}`);
      if (r.ok) found.push(col);
    } catch (e) { console.log(`💥 ${col.padEnd(38)} ${e.message}`); }
  }

  if (found.length) {
    line('1b · Gefundene Spalten über mehrere Titel (US, DE, Small-Cap)');
    for (const [market, ticker] of [
      ['america', 'NASDAQ:AAPL'], ['america', 'NYSE:F'], ['america', 'NASDAQ:SMCI'],
      ['germany', 'XETR:SAP'], ['germany', 'XETR:RHM'], ['america', 'AMEX:SPY'],
    ]) {
      try {
        const res = await fetch(`https://scanner.tradingview.com/${market}/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
          body: JSON.stringify({
            symbols: { tickers: [ticker], query: { types: [] } },
            columns: ['close', 'currency', ...found],
          }),
        });
        const j = JSON.parse(await res.text());
        console.log(`${ticker.padEnd(14)} HTTP ${res.status}  ${short(j?.data?.[0]?.d, 300)}`);
      } catch (e) { console.log(`${ticker.padEnd(14)} 💥 ${e.message}`); }
    }
    console.log(`\nSpaltenreihenfolge oben: close, currency, ${found.join(', ')}`);
  }
}

/* ── 2 · Yahoo ────────────────────────────────────────────────────────────
   quoteSummary braucht seit 2023 Cookie + Crumb. Die Frage ist, ob das aus
   einer Cloud-IP heraus überhaupt durchgeht (CLAUDE.md: Cloud-IPs werden von
   Consumer-Sites gern geblockt). */
async function yahooCrumb() {
  const jar = [];
  const r1 = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA }, redirect: 'follow' });
  for (const [k, v] of r1.headers) if (k.toLowerCase() === 'set-cookie') jar.push(v.split(';')[0]);
  const cookie = jar.join('; ');
  const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, cookie, Accept: '*/*' },
  });
  const crumb = await r2.text();
  console.log(`Cookie-Runde: fc.yahoo.com HTTP ${r1.status}, Cookies ${jar.length}, getcrumb HTTP ${r2.status}, Crumb ${short(crumb, 40)}`);
  return { cookie, crumb: crumb.trim() };
}

async function probeYahoo() {
  line('2 · Yahoo quoteSummary (financialData / recommendationTrend)');
  let auth = { cookie: '', crumb: '' };
  try { auth = await yahooCrumb(); } catch (e) { console.log(`Crumb-Flow 💥 ${e.message}`); }

  for (const sym of ['AAPL', 'SAP.DE', 'SMCI']) {
    for (const host of ['query1', 'query2']) {
      const url = `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${sym}`
        + `?modules=financialData,recommendationTrend,upgradeDowngradeHistory`
        + (auth.crumb ? `&crumb=${encodeURIComponent(auth.crumb)}` : '');
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': UA, Accept: 'application/json',
            Origin: 'https://finance.yahoo.com', Referer: `https://finance.yahoo.com/quote/${sym}`,
            ...(auth.cookie ? { cookie: auth.cookie } : {}),
          },
        });
        const text = await res.text();
        if (!res.ok) { console.log(`${sym.padEnd(8)} ${host} HTTP ${res.status} → ${short(text, 160)}`); continue; }
        const fd = JSON.parse(text)?.quoteSummary?.result?.[0]?.financialData ?? {};
        console.log(`${sym.padEnd(8)} ${host} HTTP ${res.status} → targetMean ${short(fd.targetMeanPrice)} `
          + `| high ${short(fd.targetHighPrice)} | low ${short(fd.targetLowPrice)} `
          + `| median ${short(fd.targetMedianPrice)} | n ${short(fd.numberOfAnalystOpinions)} `
          + `| rec ${short(fd.recommendationKey)} | cur ${short(fd.financialCurrency)}`);
      } catch (e) { console.log(`${sym.padEnd(8)} ${host} 💥 ${e.message}`); }
    }
  }

  line('2b · Yahoo Alternativen ohne Crumb');
  const alts = [
    ['insights v2', 'https://query1.finance.yahoo.com/ws/insights/v2/finance/insights?symbol=AAPL'],
    ['quote v7   ', 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL&fields=targetPriceMean,targetPriceHigh,targetPriceLow,averageAnalystRating'],
    ['quote v6   ', 'https://query1.finance.yahoo.com/v6/finance/quote?symbols=AAPL'],
  ];
  for (const [name, url] of alts) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json', Origin: 'https://finance.yahoo.com', Referer: 'https://finance.yahoo.com/' },
      });
      const text = await res.text();
      const hit = /targetPrice|priceTarget|targetMean/i.test(text);
      console.log(`${name} HTTP ${res.status} | Kursziel-Felder im Text: ${hit ? 'JA' : 'nein'} | ${short(text, 220)}`);
    } catch (e) { console.log(`${name} 💥 ${e.message}`); }
  }
}

/* ── 3 · FMP ──────────────────────────────────────────────────────────────
   Free-Key. Bekannt ist: /stable/ lebt, vieles antwortet 402. Die Kursziel-
   Endpunkte sind ungetestet — genau das klärt diese Probe. */
async function probeFmp() {
  line('3 · FMP /stable — Kursziel-Endpunkte mit Free-Key');
  const key = process.env.FMP_API_KEY;
  if (!key) { console.log('Kein FMP_API_KEY im Runner — übersprungen.'); return; }
  const paths = [
    'price-target-summary?symbol=AAPL',
    'price-target-consensus?symbol=AAPL',
    'price-target-news?symbol=AAPL&limit=3',
    'price-target-latest-news?limit=3',
    'grades-consensus?symbol=AAPL',
    'analyst-estimates?symbol=AAPL&period=annual&limit=2',
    'price-target-consensus?symbol=SMCI',
    'price-target-consensus?symbol=SAP.DE',
  ];
  for (const p of paths) {
    const url = `https://financialmodelingprep.com/stable/${p}${p.includes('?') ? '&' : '?'}apikey=${key}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      const text = await res.text();
      console.log(`${res.status} ${p.padEnd(46)} ${short(text.replaceAll(key, '***'), 260)}`);
    } catch (e) { console.log(`💥  ${p} ${e.message}`); }
  }
}

/* ── 4 · StockTwits ───────────────────────────────────────────────────────
   Kein Kursziel-Endpunkt bekannt; geprüft wird, ob das Symbol-Objekt etwas
   in der Richtung mitliefert. */
async function probeStocktwits() {
  line('4 · StockTwits — irgendetwas Analysten-artiges?');
  try {
    const res = await fetch('https://api.stocktwits.com/api/2/streams/symbol/AAPL.json?limit=1', { headers: { 'User-Agent': UA } });
    const text = await res.text();
    console.log(`HTTP ${res.status} | „target" im Text: ${/target|price_target/i.test(text) ? 'JA' : 'nein'}`);
    console.log(`Symbol-Objekt: ${short(JSON.parse(text)?.symbol, 300)}`);
  } catch (e) { console.log(`💥 ${e.message}`); }
}

await probeTradingView();
await probeYahoo();
await probeFmp();
await probeStocktwits();
line('Probe fertig.');
