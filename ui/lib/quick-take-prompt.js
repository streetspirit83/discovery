/**
 * Ersteinschätzung per Claude-Link (Claude-Knopf im Detail-Sheet).
 *
 * Der Prompt reist komplett in der URL (`claude.ai/new?q=…`), deshalb bewusst
 * kurz und nicht aus den langen Vorlagen in `research-prompt.js`. Der Parameter
 * ist nicht offiziell dokumentiert und füllt das Eingabefeld nur vor; abgeschickt
 * wird in Claude von Hand.
 *
 * Eigene Datei: `research-prompt.js` wird von der Netlify-Funktion `research`
 * mitgebündelt, dieser Knopf soll keinen Backend-Deploy auslösen.
 */

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
    ...[dataLine(c, currency)].filter(Boolean).flatMap((l) => ['', l]),
  ].join('\n');
}

export function quickTakeUrl(c, opts) {
  return `https://claude.ai/new?q=${encodeURIComponent(quickTakePrompt(c, opts))}`;
}
