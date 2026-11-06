/**
 * Ersteinschätzung per KI-Link (Claude-, ChatGPT- und Perplexity-Knopf im Detail-Sheet).
 *
 * Der Prompt reist komplett in der URL (`?q=…`), deshalb bewusst kurz und nicht
 * aus den langen Vorlagen in `research-prompt.js`. Offiziell dokumentiert ist der
 * Parameter bei keinem der drei. Claude füllt nur vor, Perplexity startet die Suche
 * sofort; für ChatGPT widersprechen sich die Quellen. Gemini kennt ihn im normalen
 * Chat nicht und ist deshalb nicht dabei.
 *
 * Eigene Datei: `research-prompt.js` wird von der Netlify-Funktion `research`
 * mitgebündelt, dieser Knopf soll keinen Backend-Deploy auslösen.
 */

const APP_URL = 'https://streetspirit83.github.io/discovery/';
const EXCHANGES = 'NASDAQ, NYSE, AMEX, XETR, LSE, EURONEXT, MIL, BME, SIX, VIE, OMXSTO, OMXCOP, OSL, OMXHEX';

function money(v, cur) {
  return v == null ? null : `${Number(v).toFixed(2)} ${cur}`;
}

function pct(v) {
  return v == null ? null : `${v >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`;
}

function bigMoney(v, cur) {
  if (v == null) return null;
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)} Bio. ${cur}`;
  if (v >= 1e9)  return `${(v / 1e9).toFixed(1)} Mrd. ${cur}`;
  if (v >= 1e6)  return `${(v / 1e6).toFixed(0)} Mio. ${cur}`;
  return `${v} ${cur}`;
}

/** Nur Werte, die wirklich vorliegen — eine Lücke fällt weg statt „n/a" zu zeigen. */
function dataLine(c, cur) {
  const tv = c.tv_data ?? {};
  const px = tv.close_1m ?? tv.close ?? null;
  const high = tv.price_52_week_high ?? tv.high_52w ?? null;
  const perf = [pct(tv.perf_w), pct(tv.perf_1m)];
  const parts = [
    px != null ? `Kurs ${money(px, cur)}` : null,
    perf[0] || perf[1] ? `Perf 1W/1M ${perf[0] ?? 'k. A.'} / ${perf[1] ?? 'k. A.'}` : null,
    px != null && high > 0 ? `Abstand 52W-Hoch ${pct((px / high - 1) * 100)}` : null,
    tv.pe_ttm != null ? `KGV ${Number(tv.pe_ttm).toFixed(1)}` : null,
    tv.market_cap != null ? `Market Cap ${bigMoney(tv.market_cap, cur)}` : null,
  ].filter(Boolean);
  return parts.length ? `Meine Daten: ${parts.join(', ')}` : null;
}

export function quickTakePrompt(c, { currency = 'USD', date = new Date().toISOString().slice(0, 10) } = {}) {
  const name = c.name ? `${c.name} ` : '';
  const isin = c.isin ? `, ISIN ${c.isin}` : '';
  return [
    `Kurze Ersteinschätzung zu ${name}(${c.symbol} @ ${c.exchange}${isin}), Stand ${date}.`,
    'Nutze aktuelle Webquellen und nenne je Aussage Quelle und Datum.',
    'Antworte auf Deutsch, maximal 200 Wörter, je Punkt 2–3 Bullets.',
    'Eröffne mit einer Zeile „Fazit:“ und einer Zeile „Momentum: stark | intakt | nachlassend | keins“.',
    '',
    '1. Momentum: Hat der Titel gerade Momentum, und stützen News und Zahlen der letzten 4 Wochen die Bewegung?',
    '2. Einordnung: Was macht die Firma, was treibt die Story, was ist der wichtigste offene Punkt?',
    '3. Wettbewerb: Wo steht sie gegenüber den 2–3 wichtigsten Wettbewerbern?',
    '4. Größe: Marktkapitalisierung und Umsatz, verglichen mit diesen Wettbewerbern.',
    '',
    'Liste am Ende unter „Alternativen:“ immer genau 3 börsennotierte Titel aus dem Umfeld, und zwar konkrete Wettbewerber dieses Titels. Bevorzuge die, die gerade interessanter wirken, etwa durch besseres Momentum. Je Zeile: Name, Ticker @ Börse, ein Halbsatz Begründung. Die Alternativen zählen nicht zu den 200 Wörtern.',
    `Schreibe darunter genau diesen Markdown-Link und ersetze nur TICKER und BÖRSE, ohne Leerzeichen: [In Discovery prüfen](${APP_URL}#add=TICKER:BÖRSE,TICKER:BÖRSE,TICKER:BÖRSE&peer=${c.symbol}:${c.exchange})`,
    `Erlaubte Börsen: ${EXCHANGES}.`,
    ...[dataLine(c, currency)].filter(Boolean).flatMap((l) => ['', l]),
  ].join('\n');
}

const CHAT_URLS = {
  claude: 'https://claude.ai/new?q=',
  chatgpt: 'https://chatgpt.com/?q=',
  perplexity: 'https://www.perplexity.ai/search/?q=',
};

export function chatUrl(target, c, opts) {
  return `${CHAT_URLS[target]}${encodeURIComponent(quickTakePrompt(c, opts))}`;
}
