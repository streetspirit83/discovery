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

/* Währung als Parameter: EBITDA und Marktkapitalisierung stehen in der Währung
   des Instruments — ein fest angehängtes „USD" wäre bei jedem XETR-Titel falsch.
   Default bleibt USD, damit der bestehende Mehrfach-Prompt unverändert liest. */
function mcap(v, cur = 'USD') {
  if (v == null) return 'n/a';
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}T ${cur}`;
  if (v >= 1e9)  return `${(v / 1e9).toFixed(1)}B ${cur}`;
  if (v >= 1e6)  return `${(v / 1e6).toFixed(0)}M ${cur}`;
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
 * Die Rolle ist bewusst NEUTRAL („evidence researcher"), nicht skeptisch und
 * nicht werbend: gesammelt und gewichtet werden Belege, argumentiert wird
 * nicht. Was den Ton trotzdem hart macht, sind die Grundregeln — Quelle plus
 * Datum, ein ausdrückliches „no evidence found" statt einer plausibel
 * klingenden Lücke, und die Trennung von Fakten, Schätzungen und Meinungen.
 * Ohne die liefert eine Such-KI die freundliche Zusammenfassung der IR-Seite.
 *
 * Der Abschluss fragt keinen Bull/Base/Bear-Fall und keine Kaufentscheidung ab,
 * sondern einen 3-Monats-Ausblick mit EINER Kursspanne plus Risiken und Chancen
 * — die Entscheidung trifft der Leser, nicht das Modell.
 *
 * Währungen werden benannt statt umgerechnet: der LS-Kurs ist EUR, die
 * TV-Kennzahlen stehen in der Währung des Instruments. Eine stille Umrechnung
 * im Fliesstext wäre die eine Fehlerquelle, die niemand nachprüft.
 */

const NA = 'n/a';
const money = (v, cur, dec = 2) => (v == null ? NA : `${num(v, dec)} ${cur}`);

/* Sektor/Industrie stehen in der Frage statt im Datenblock: sie sind der
   Aufhänger für die Wettbewerbsanalyse, keine Kennzahl. */
function sectorLine(c) {
  const tv = c.tv_data ?? {};
  const sec = c.sector ?? tv.sector;
  const ind = tv.industry;
  if (!sec && !ind) return 'unclassified';
  return [sec, ind].filter(Boolean).join(' / ');
}

/* Der Datenblock ist bewusst kurz: nur was die KI selbst nicht besser weiss
   oder nicht ohne Weiteres nachschlägt — mein Blick auf die jüngste Bewegung,
   der Analysten-Konsens mit Spanne, und zwei Bewertungsanker. Alles Übrige
   (52W-Spanne, ATH, Marktkapitalisierung …) findet jede Such-KI in Sekunden;
   im Prompt kostet es nur Platz und lenkt von den Fragen ab. */
function dataBlock(c, cur) {
  const tv = c.tv_data ?? {};
  const yh = c.yh_targets;

  // Analysten-Konsens: TV führt, Yahoo springt ein (wie in Tabelle und Sheet).
  let consensus = NA;
  if (tv.pt_average != null) {
    const range = (tv.pt_low != null && tv.pt_high != null) ? `, range ${num(tv.pt_low)}–${num(tv.pt_high)}` : '';
    const n = tv.recommendation_total != null ? `, ${tv.recommendation_total} ratings` : '';
    consensus = `${money(tv.pt_average, cur)}${range}${n}`;
  } else if (yh?.mean != null) {
    const range = (yh.low != null && yh.high != null) ? `, range ${num(yh.low)}–${num(yh.high)}` : '';
    const n = yh.analysts != null ? `, ${yh.analysts} estimates` : '';
    consensus = `${money(yh.mean, yh.currency ?? cur)}${range}${n} (Yahoo)`;
  }

  return [
    `Change today: ${pct(tv.change_1d)}`,
    `Perf W/1M/3M/6M: ${[tv.perf_w, tv.perf_1m, tv.perf_3m, tv.perf_6m].map(pct).join(' / ')}`,
    `Analyst consensus: ${consensus}`,
    `P/E (TTM): ${num(tv.pe_ttm, 1)}`,
    `EBITDA: ${mcap(tv.ebitda, cur)}`,
  ].join(' · ');
}

/* ── Extrembewegungen: Datum-Anker für die Katalysator-Suche ────────────────
 * Der Extreme-Prompt fragt „was hat den Sprung ausgelöst" — die Frage ist nur
 * so gut wie die Daten, an denen sie hängt. Eine Such-KI, die selbst nach
 * „grösste Tagesbewegungen" suchen muss, rät; bekommt sie konkrete Daten, sucht
 * sie gezielt nach den Meldungen dieser Tage.
 *
 * Quelle sind die persistierten Tageskerzen (`swing_analysis.ohlc`, ~180 Bars
 * ≈ 8–9 Monate). Bewusst OHNE Währung: Tagesveränderungen sind Prozente, und
 * die Bars stehen ohnehin in ihrer eigenen Währung (siehe tv-swings.js).
 * Ohne geladene Kerzen entfällt der Block — der Prompt fragt dann trotzdem
 * nach den Extremen, nur ohne vorgegebene Termine.
 */
function biggestDailyMoves(analysis, n = 6) {
  const bars = Array.isArray(analysis?.ohlc) ? analysis.ohlc : null;
  if (!bars || bars.length < 2) return null;

  const moves = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]?.c, cur = bars[i]?.c;
    if (!(prev > 0) || !(cur > 0)) continue;   // Feiertagslücken tragen null
    moves.push({ date: bars[i].date, chg: (cur / prev - 1) * 100 });
  }
  if (!moves.length) return null;

  /* Schwelle relativ zum Titel, nicht absolut: 4 % sind für einen Mega-Cap ein
     Ereignis und für einen Small-Cap ein Dienstag. Der Median der absoluten
     Tagesbewegung ist das Normalmass des Papiers; alles unter dem 2,5-Fachen
     davon ist kein Ausschlag und hat als Recherche-Termin nichts verloren —
     sonst schickt der Prompt die KI auf die Suche nach der Meldung eines Tages,
     an dem nichts passiert ist. */
  const absSorted = moves.map((m) => Math.abs(m.chg)).sort((a, b) => a - b);
  const median = absSorted[Math.floor(absSorted.length / 2)] || 0;
  const floor = Math.max(median * 2.5, 3);

  const top = moves
    .filter((m) => Math.abs(m.chg) >= floor)
    .sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg))
    .slice(0, n)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!top.length) return null;

  return { top, from: bars[0]?.date ?? null, to: bars[bars.length - 1]?.date ?? null, days: bars.length };
}

/* Was die KI für die Extremfrage nicht selbst besser weiss: wo der Kurs in
   seiner 52-Wochen-Spanne steht, wie weit er vom Allzeithoch entfernt ist —
   und die Termine der grössten Tagessprünge aus meinen eigenen Kerzen. */
function extremesBlock(c, cur) {
  const tv = c.tv_data ?? {};
  const px = tv.close_1m ?? tv.close;
  const hi = tv.price_52_week_high, lo = tv.price_52_week_low;
  const out = [];

  if (hi != null && lo != null) {
    const pos = (px != null && hi > lo) ? `, price sits at ${Math.round((px - lo) / (hi - lo) * 100)}% of that range` : '';
    out.push(`52-week range: ${num(lo)}–${num(hi)} ${cur}${pos}`);
  }
  if (tv.high_all != null && px != null) {
    out.push(`All-time high ${money(tv.high_all, cur)} — now ${pct((px / tv.high_all - 1) * 100)} from it`);
  }
  out.push(`Perf W/1M/3M/6M: ${[tv.perf_w, tv.perf_1m, tv.perf_3m, tv.perf_6m].map(pct).join(' / ')}`);
  if (tv.volatility_m != null) out.push(`Avg daily volatility (1M): ${num(tv.volatility_m)}%`);

  const mv = biggestDailyMoves(c.swing_analysis);
  if (mv) {
    out.push(`Largest single-day moves in my daily bars (${mv.from} to ${mv.to}, ${mv.days} sessions): `
      + mv.top.map((m) => `${m.date} ${pct(m.chg)}`).join(', '));
  }
  return out.join('\n');
}

/* ── Fünf Prompts statt einem ───────────────────────────────────────────────
 * Ein einziger Riesen-Prompt liefert bei Such-KIs regelmässig eine dünne
 * Antwort pro Block — fünf gezielte Fragen bringen je Block mehr. Sie teilen
 * sich Kopf (wer fragt, über welchen Titel) und Formatregeln.
 *
 * Die Signal-Marker im Format-Block sind Emoji: das ist bewusst KEIN Verstoss
 * gegen die „nur Lucide"-Regel des Styleguides — sie erscheinen nie in unserer
 * Oberfläche, sondern nur im Text, den eine fremde KI ausgibt. Dort sind sie
 * das einzige Mittel, das in jedem Chatfenster gleich aussieht.
 */

function head(c, date) {
  const name = c.name ? `${c.name} ` : '';
  const isin = c.isin ? `, ISIN ${c.isin}` : '';
  return `You are a neutral evidence researcher. Subject: ${name}(${c.symbol} @ ${c.exchange}${isin}). Use current web sources (today: ${date}). Gather and weigh evidence — do not argue for or against the stock.

Cite a source and a date for every claim. Where you find nothing, write "no evidence found" instead of something that merely sounds plausible. Label company-provided material (IR deck, press release) as such, and keep facts, estimates and opinions apart.`;
}

const FORMAT = `Output format:
- Short bullets only. No prose paragraphs, no preamble, no restating of the question.
- Put the **few genuinely important findings in bold** — sparingly, so bold still means something.
- Start every bullet with a signal marker: 🔴 material risk / red flag · 🟢 verified strength · 🟡 contested or thin evidence · ⚪ context only.
- Put source and date in brackets at the end of the bullet, e.g. [10-K, 2026-02-14].
- End with one line "⚠ Watch:" naming the single most important open point.`;

/** Die vier Bausteine. `build` bekommt den Kandidaten und den Kontext. */
export const STOCK_PROMPTS = [
  {
    key: 'moat',
    label: 'Moat & Wettbewerb',
    hint: 'Geschäftsmodell, Burggraben, Sub-Sektor, Konkurrenz',
    build: (c, { date }) => `${head(c, date)}

**Business & moat**
What exactly does the company earn money with (revenue split by segment and region)? Where does the moat come from — network effects, switching costs, scale, patents, brand, regulation? Give evidence rather than assertions. How durable is it — what would have to happen for the moat to be gone in three years?

**Sector, sub-sector & competition**
Which sector and, more importantly, which sub-sector / niche does it actually compete in? My data classifies it as ${sectorLine(c)}. Name the 3–5 most relevant competitors, listed and private, with rough size or market share. How does ${c.symbol} compare on growth? Who is gaining share right now, and why? Where is that sub-sector in its cycle (demand, economy, interest rates, geopolitical stress)?

${FORMAT}`,
  },
  {
    key: 'redflags',
    label: 'Red Flags',
    hint: 'Bilanzqualität, Betrugsrisiko, Short-Seller, Positionierung',
    build: (c, { date }) => `${head(c, date)}

**Red flags**
Accounting: gaps between cash flow and earnings (accruals), receivables and inventory versus revenue, capitalised costs, recurring "one-off" items, aggressive revenue recognition. Governance: auditor or CFO changes, late filings, restatements, related-party transactions, SEC/BaFin proceedings, class actions. Dilution: share count over time, ATM programmes, convertibles, stock-based comp as a share of revenue. Balance sheet: debt maturities, covenants, cash runway.

**Short sellers**
Are there short-seller reports (Hindenburg, Muddy Waters, Kerrisdale, Culper, Scorpion, Fuzzy Panda, Grizzly, Blue Orca …)? If so: the core allegations, the date, the company's response, and what has since been substantiated or refuted. Current short interest (% of float), days-to-cover and the trend — with the as-of date. Summarise the short thesis in two sentences, and the counter-arguments in two more.

${FORMAT}`,
  },
  {
    key: 'insiders',
    label: 'Insider & Großaktionäre',
    hint: 'Käufe/Verkäufe, Beteiligungen, Rückkäufe',
    build: (c, { date }) => `${head(c, date)}

**Insiders & major holders**
Insider buys and sells over the last 6–12 months: who, how much, at what price, and whether these were genuine open-market purchases or scheduled 10b5-1 sales. Cluster buying by several insiders at once? Management ownership in absolute terms and as a share of their pay. Changes among the largest institutional holders, new activist positions, buybacks in progress (announced vs. actually executed).

${FORMAT}`,
  },
  {
    key: 'news',
    label: 'News, Katalysatoren & Ausblick',
    hint: 'Bewegung erklären, Termine, 3-Monats-Ausblick mit Spanne',
    build: (c, { date, currency, fair, impliedGrowth }) => `${head(c, date)}

**Recent news & catalysts**
What explains the price move over the last 1 / 3 / 6 months — concrete events, not "market conditions"? What is coming up: earnings, guidance, approvals, contract decisions, lock-up expiries, index changes, capital measures? How does the price sit relative to the analyst consensus and to its 52-week range?${fair != null ? `\n\nMy own reverse-DCF puts fair value at ${num(fair)} ${currency}${impliedGrowth != null ? `, i.e. the market is pricing in ~${num(impliedGrowth * 100, 1)}% p.a. free-cash-flow growth` : ''}. Which assumptions is that price most sensitive to?` : ''}

**Outlook — next 3 months**
- One price range for the next three months, with the reasoning in a single line and the two or three factors it hinges on.
- Risks: 3–5 bullets, each with the evidence behind it and how near-term it is.
- Opportunities: 3–5 bullets, same standard.
- Where the evidence is thin or contradictory, say so instead of resolving it.

My screening data (as of ${date}):
${dataBlock(c, currency)}

${FORMAT}`,
  },
  /* Der Extreme-Prompt ist ausdrücklich NICHT „News noch einmal": der
     News-Block erklärt die laufende Bewegung und schaut nach vorn, dieser hier
     seziert rückblickend die Ausschläge eines Jahres — was sie ausgelöst hat,
     ob sie gehalten haben und was davon wiederholbar ist. Genau die Frage
     hinter „warum ist Sivers Semiconductors explodiert und dann abgestürzt". */
  {
    key: 'extremes',
    label: 'Extreme & Katalysatoren',
    hint: 'Was Kurssprünge und Abstürze des letzten Jahres ausgelöst hat',
    build: (c, { date, currency }) => `${head(c, date)}

**Extreme moves over the last 12 months**
Reconstruct the largest up moves and the largest drawdowns of the past year — single days as well as multi-week runs. For each one give: the date (or the window), the size of the move, and the concrete trigger.

For every move, work through these in order and say which one it was:
- Company events: earnings surprise or miss, guidance change, a design win / major contract / order, product or clinical milestone, regulatory decision, M&A, capital raise or dilution, index inclusion or removal, licence and royalty news.
- Positioning: short squeeze, unusually high short interest, options gamma, retail hype (StockTwits/Reddit/X), a short-seller report, a lock-up expiry.
- External: sector or peer move, an analyst upgrade/downgrade, macro (rates, FX, tariffs, export controls), a supplier or key customer.

Then, for each move, the part that actually matters:
- **Did it hold?** How much of the move was retraced 1 week / 1 month later?
- Was it company-specific or did the peer group move the same day? Name the peers and their move on that day.
- Was volume confirming it, or was it a thin-liquidity move?
- Was the underlying claim substantiated later, or did it turn out to be an announcement that never converted into revenue?

**Pattern**
- Which of these catalysts are repeatable, and which were genuinely one-offs?
- Is there a recurring pattern — a habitual beat/miss, an equity raise after every spike, a serial "letter of intent" that never becomes an order?
- Which upcoming events could trigger a move of the same magnitude, and in which direction?
- Where a spike has NO identifiable cause, say so explicitly instead of inventing one.

Anchor data from my own screening (as of ${date}):
${extremesBlock(c, currency)}

Treat those dates as leads, not as gospel — my bar window may be shorter than a year and can miss moves outside it. Look for the biggest moves of the full 12 months independently.

${FORMAT}`,
  },
];

/**
 * stockPrompts(candidate, opts) → [{ key, label, hint, text }]
 * `fair`/`impliedGrowth` kommen aus dem Reverse-DCF des Aufrufers (die Rechnung
 * liegt in `tv-reverse-dcf.js` und soll nicht doppelt existieren).
 */
export function stockPrompts(c, { fair = null, impliedGrowth = null, currency = 'USD' } = {}) {
  const ctx = { date: new Date().toISOString().slice(0, 10), fair, impliedGrowth, currency };
  return STOCK_PROMPTS.map(({ key, label, hint, build }) => ({ key, label, hint, text: build(c, ctx) }));
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
