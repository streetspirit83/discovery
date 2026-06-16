/**
 * Builds a copy-paste research prompt for selected candidates.
 *
 * Intended for AI search engines (Perplexity, ChatGPT Search, Claude, …):
 * qualitative web research per ticker plus a benchmark/ranking across the
 * selection, seeded with the quantitative screening data already in tv_data.
 */

import { computeUpsidePotential } from './tv-upside.js';

function pct(v) {
  if (v == null) return 'n/a';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

function num(v, dec = 2) {
  if (v == null) return 'n/a';
  return Number(v).toFixed(dec);
}

function mcap(v) {
  if (v == null) return 'n/a';
  if (v >= 1e12) return (v / 1e12).toFixed(1) + 'T USD';
  if (v >= 1e9)  return (v / 1e9).toFixed(1) + 'B USD';
  if (v >= 1e6)  return (v / 1e6).toFixed(0) + 'M USD';
  return String(v);
}

function candidateLine(c) {
  const tv = c.tv_data;
  const up = computeUpsidePotential(tv);
  const parts = [
    `Kurs: ${num(tv?.close_1m ?? tv?.close)}`,
    `Δ heute: ${pct(tv?.change_1d)}`,
    `Perf 1W: ${pct(tv?.perf_w)}`,
    `Perf 1M: ${pct(tv?.perf_1m)}`,
    `EBITDA-Wachstum YoY: ${pct(tv?.ebitda_yoy_growth_fy ?? tv?.ebitda_yoy_growth_ttm)}`,
    `Market Cap: ${mcap(tv?.market_cap)}`,
    `KGV (TTM): ${num(tv?.pe_ttm, 1)}`,
    `RSI: ${num(tv?.rsi, 0)}`,
    `TV-Rating 1M: ${num(tv?.recommend_all_1m)}`,
    up?.earningsSoon ? 'Achtung: Earnings innerhalb des nächsten Monats' : null,
  ].filter(Boolean);

  const name   = c.name ? ` — ${c.name}` : '';
  const sector = c.sector ? ` (${c.sector})` : '';
  return `- ${c.symbol} @ ${c.exchange}${name}${sector}\n  ${parts.join(' · ')}`;
}

export function buildResearchPrompt(candidates) {
  const date = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const tickers = candidates.map((c) => c.symbol).join(', ');

  return `Du bist ein erfahrener Aktien-Research-Analyst. Führe eine qualitative Web-Recherche zu den folgenden ${candidates.length} Aktien durch und benchmarke sie anschließend gegeneinander: ${tickers}.

Recherchiere pro Aktie (mit aktuellen Quellen, Stand ${date}):
1. Aktuelle Nachrichten und Katalysatoren der letzten 4 Wochen (Earnings, Guidance, Produkt-/Deal-News, Insider-Aktivität)
2. Analystenmeinungen, Kursziele und jüngste Rating-Änderungen
3. Geschäftsmodell, Wettbewerbsposition und Burggraben (Moat)
4. Wesentliche Risiken (operativ, regulatorisch, Bewertung, Verschuldung)
5. Markt-Sentiment (Social Media, Short Interest, ungewöhnliches Volumen)

Erstelle danach:
- Ein **AI-Scoring je Aktie**: geschätzte Wahrscheinlichkeit (0–100 %), dass der Kurs in den nächsten ~21 Handelstagen mindestens **+20 %** steigt — mit 1–2 Sätzen Begründung (Katalysatoren vs. Risiken)
- Eine Vergleichstabelle der wichtigsten qualitativen und quantitativen Faktoren inkl. dieser Upside-Wahrscheinlichkeit
- Ein begründetes Ranking nach der +20%-Wahrscheinlichkeit: Welcher Titel hat auf Sicht von ~1 Monat das beste Chance-Risiko-Verhältnis?
- Je Titel ein kurzes Fazit (2–3 Sätze) mit den wichtigsten Pro- und Contra-Punkten

Quantitative Daten aus meinem Screening (Stand ${date}, bitte gegen aktuelle Marktdaten plausibilisieren):

${candidates.map(candidateLine).join('\n')}

Antworte auf Deutsch.`;
}
