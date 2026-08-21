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

/* ── Einzeltitel-Prompt (Teleskop-Knopf im Detail-Sheet) ────────────────────
 * Englisch, weil die Quellen es sind: Short-Seller-Reports, SEC-Filings,
 * Peer-Zahlen und Earnings-Calls liegen fast alle auf Englisch vor — eine
 * deutsche Frage erzwingt beim Modell nur eine Übersetzungsschleife.
 *
 * Der Ton ist bewusst skeptisch und verlangt Quelle + Datum. Ohne das liefert
 * eine Such-KI die freundliche Zusammenfassung der IR-Seite zurück.
 *
 * Währungen werden benannt statt umgerechnet: der LS-Kurs ist EUR, die
 * TV-Kennzahlen stehen in der Währung des Instruments. Eine stille Umrechnung
 * im Fliesstext wäre die eine Fehlerquelle, die niemand nachprüft.
 */

const NA = 'n/a';
const money = (v, cur, dec = 2) => (v == null ? NA : `${num(v, dec)} ${cur}`);

/* TV liefert das Earnings-Datum als Unix-Sekunden (so liest es auch der
   Fundamental-Tab). Roh ausgegeben stünde eine zehnstellige Zahl im Prompt. */
function isoDay(v) {
  if (v == null) return NA;
  const ms = typeof v === 'number' ? v * 1000 : Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : NA;
}

function dataBlock(c, cur) {
  const tv = c.tv_data ?? {};
  const ls = c.ls_quote?.price;
  const a  = c.swing_analysis;
  const sup = a?.support?.length ? a.support[a.support.length - 1].mid : null;
  const res = a?.resistance?.length ? a.resistance[0].mid : null;
  const yh = c.yh_targets;

  const rows = [
    ['Price (Lang & Schwarz, the venue I trade on)', ls != null ? money(ls, 'EUR') : NA],
    [`Price (TradingView close, ${cur})`, money(tv.close_1m ?? tv.close, cur)],
    ['Change today / 1W / 1M / 3M / 6M',
      [tv.change_1d, tv.perf_w, tv.perf_1m, tv.perf_3m, tv.perf_6m].map(pct).join(' / ')],
    ['52-week range', `${money(tv.price_52_week_low, cur)} … ${money(tv.price_52_week_high, cur)}`],
    ['All-time high', money(tv.high_all, cur)],
    ['ATRP (avg daily range)', tv.atrp != null ? `${num(tv.atrp, 1)}%` : NA],
    ['Market cap', mcap(tv.market_cap)],
    ['Sector / industry (per TradingView)', `${c.sector ?? tv.sector ?? NA} / ${tv.industry ?? NA}`],
    ['P/E (TTM) · P/FCF (TTM) · EV/EBITDA',
      `${num(tv.pe_ttm, 1)} · ${num(tv.price_free_cash_flow_ttm, 1)} · ${num(tv.enterprise_value_ebitda_ttm, 1)}`],
    ['ROIC · debt/equity', `${tv.return_on_invested_capital != null ? num(tv.return_on_invested_capital, 1) + '%' : NA} · ${num(tv.debt_to_equity, 2)}`],
    ['Revenue YoY · FCF YoY', `${pct(tv.total_revenue_yoy_growth_ttm)} · ${pct(tv.free_cash_flow_yoy_growth_ttm)}`],
    ['Analyst consensus target (TradingView)',
      tv.pt_average != null
        ? `${money(tv.pt_average, cur)} (range ${num(tv.pt_low)}–${num(tv.pt_high)}, ${tv.recommendation_total ?? '?'} ratings)`
        : NA],
    ['Analyst consensus target (Yahoo)',
      yh?.mean != null
        ? `${money(yh.mean, yh.currency ?? cur)} (${yh.analysts ?? '?'} estimates${yh.recommendation ? `, ${yh.recommendation}` : ''})`
        : NA],
    ['Nearest support / resistance (my swing analysis)',
      sup != null || res != null ? `${num(sup)} / ${num(res)} (${a?.currency ?? cur})` : NA],
    ['Next earnings', isoDay(tv.earnings_next_date)],
  ];
  return rows.map(([k, v]) => `- ${k}: ${v}`).join('\n');
}

/**
 * buildStockPrompt(candidate, { fair, impliedGrowth }) → Recherche-Prompt für
 * EINEN Titel. `fair`/`impliedGrowth` kommen aus dem Reverse-DCF des Aufrufers
 * (die Rechnung liegt in `tv-reverse-dcf.js` und soll nicht doppelt existieren).
 */
export function buildStockPrompt(c, { fair = null, impliedGrowth = null, currency = 'USD' } = {}) {
  const date = new Date().toISOString().slice(0, 10);
  const name = c.name ? `${c.name} ` : '';
  const isin = c.isin ? `, ISIN ${c.isin}` : '';
  const valuation = fair != null
    ? `My own reverse-DCF puts fair value at ${num(fair)} ${currency}`
      + (impliedGrowth != null ? `, i.e. the market is pricing in ~${num(impliedGrowth * 100, 1)}% p.a. free-cash-flow growth` : '')
      + '. Which of those assumptions is the most fragile?'
    : 'What growth and margin path does the current price imply, and which of those assumptions is the most fragile?';

  return `You are a skeptical equity analyst. Research ${name}(${c.symbol} @ ${c.exchange}${isin}) using current web sources (today: ${date}).

Ground rules: cite a source and a date for every claim. Where you find nothing, write "no evidence found" — do not fill the gap with something that merely sounds plausible. Flag anything that is company-provided (IR deck, press release) as such.

**1 · Business & moat**
What exactly does the company earn money with (revenue split by segment and region)? Where does the moat come from — network effects, switching costs, scale, patents, brand, regulation? Give evidence rather than assertions: pricing power, gross margin over time, retention/churn, unit economics. How durable is it — what would have to happen for the moat to be gone in three years?

**2 · Sector, sub-sector & competition**
Which sector and, more importantly, which **sub-sector / niche** does it actually compete in? Check whether the classification in my data below is the right one. Name the 3–5 most relevant competitors, listed **and private**, with rough size or market share. How does ${c.symbol} compare on growth, margin and valuation? Who is gaining share right now, and why? Where is that sub-sector in its cycle (demand, capacity, pricing, inventories)?

**3 · Accounting quality & fraud risk**
Look for gaps between cash flow and earnings (accruals), receivables and inventory versus revenue, capitalised costs, recurring "one-off" items. Auditor or CFO changes, late filings, restatements, SEC/BaFin proceedings, class actions. Dilution: share count over time, ATM programmes, convertibles, stock-based comp as a share of revenue.

**4 · Short sellers & positioning**
Are there **short-seller reports** (Hindenburg, Muddy Waters, Kerrisdale, Culper, Scorpion, Fuzzy Panda, Grizzly, Blue Orca …)? If so: the core allegations, the date, the company's response, and what has since been substantiated or refuted. Current **short interest** (% of float), days-to-cover and the trend — with the as-of date. State the short thesis in two sentences: squeeze candidate or justified skepticism?

**5 · Insiders & major holders**
Insider buys and sells over the last 6–12 months: who, how much, and whether these were genuine open-market purchases or scheduled 10b5-1 sales. Management ownership, changes among institutional holders, buybacks in progress.

**6 · Recent price action & catalysts**
What explains the move over the last 1 / 3 / 6 months — concrete events, not "market conditions"? What is coming up: earnings, guidance, approvals, contract decisions, lock-up expiries, index changes? How does the price sit relative to the analyst consensus and to its 52-week range?

**7 · What is priced in**
${valuation}

**Close with**
- Bull / base / bear case, three bullets each, with a 12-month price range per case.
- The three questions I would need answered before buying.
- One sentence: what would disprove your own thesis?

My screening data (as of ${date} — please sanity-check against live market data):
${dataBlock(c, currency)}

Answer in English, in bullet points, no preamble.`;
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
