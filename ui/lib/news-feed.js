/**
 * News-Feed – Datenschicht für den News-Tab im Markets-Modal.
 *
 * Initiale Version: reine Helper (Top-Sektoren, Portfolio-Auswahl) plus
 * Demo-Daten, damit das UI ohne Keys begutachtbar ist. Die Live-Fetcher
 * docken hier an und liefern dieselbe Item-Form wie `company-profile.js`:
 *
 *   { title, url, date, source, text, symbols?, sector? }
 *
 * Geplante Quellen (siehe Settings für die Keys):
 * - Marketaux (api.marketaux.com, Key `discovery_marketaux_key`)
 * - TradingView Data API via RapidAPI (`discovery_rapidapi_key`,
 *   Endpoint-Katalog im Repo tradingview-api-integration-skill)
 * - ROIC.ai Company-News (bestehendes `fetchCompanyNews`, Portfolio-Tab)
 * - RSS / Google Alerts (Quellen aus `news-sources.js`)
 */

/** Die n häufigsten Sektoren eines Kandidaten-Buckets (für die Sektor-Chips). */
export function topSectors(candidates, n = 4) {
  const counts = new Map();
  for (const c of candidates ?? []) {
    const s = c?.sector;
    if (!s) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([sector, count]) => ({ sector, count }));
}

/** Kandidaten mit Stern (Portfolio-Marker) – Basis des Portfolio-Feeds. */
export function portfolioCandidates(candidates) {
  return (candidates ?? []).filter((c) => c?.in_portfolio);
}

/** Sub-Sektoren der Portfolio-Werte (dedupliziert, Reihenfolge stabil). */
export function portfolioSubSectors(candidates) {
  const seen = new Set();
  for (const c of portfolioCandidates(candidates)) {
    if (c?.sub_sector) seen.add(c.sub_sector);
  }
  return [...seen];
}

const demoDate = (hoursAgo) => new Date(Date.now() - hoursAgo * 36e5).toISOString();

/** Demo-Items für den Märkte-Sub-Tab (bis Marketaux/TV-Keys hinterlegt sind). */
export function demoMarketNews(sectors = []) {
  const [s1, s2] = [sectors[0]?.sector ?? 'Technology', sectors[1]?.sector ?? 'Health Technology'];
  return [
    { title: 'Demo: Fed signalisiert Zinspause – Futures drehen ins Plus', source: 'Marketaux', date: demoDate(2), url: null, sector: null, text: 'Beispiel-Schlagzeile für Markt-News. Erscheint, bis ein Marketaux- oder TradingView-Key hinterlegt ist.' },
    { title: `Demo: ${s1}-Werte führen die Erholung an`, source: 'TradingView', date: demoDate(5), url: null, sector: s1, text: null },
    { title: `Demo: Sektor-Rotation – Kapital fließt in ${s2}`, source: 'Marketaux', date: demoDate(9), url: null, sector: s2, text: null },
    { title: 'Demo: Ölpreis fällt nach Lagerbestandsdaten unter 80 $', source: 'TradingView', date: demoDate(14), url: null, sector: 'Energy Minerals', text: null },
  ];
}

/** Demo-Items für den Portfolio-Sub-Tab (bis der ROIC/RSS-Fetch angebunden ist). */
export function demoPortfolioNews(symbols = []) {
  const [a, b] = [symbols[0] ?? 'AAPL', symbols[1] ?? 'ENPH'];
  return [
    { title: `Demo: ${a} übertrifft Erwartungen im Quartalsbericht`, source: 'ROIC.ai', date: demoDate(3), url: null, symbols: [a], text: 'Beispiel-Schlagzeile für Portfolio-News der mit ★ markierten Werte.' },
    { title: `Demo: Analysten heben Kursziel für ${b} an`, source: 'ROIC.ai', date: demoDate(8), url: null, symbols: [b], text: null },
    { title: 'Demo: Google-Alert-Treffer aus eigener Quelle', source: 'Google Alert', date: demoDate(12), url: null, symbols: [], text: 'RSS-/Google-Alert-Quellen lassen sich im Sub-Tab „Quellen" pflegen.' },
  ];
}
