/**
 * detail-autofetch.js — was beim Öffnen eines Detail-Sheets nachgeladen wird.
 *
 * Nur die Entscheidung, nicht der Abruf: `autoFetchPlan` sagt, welche Quellen
 * fehlen oder veraltet sind. Die Fristen sind unterschiedlich, weil die Daten
 * unterschiedlich schnell altern — ein Live-Kurs ist nach zwei Minuten alt, die
 * TR-Handelbarkeit nach einem Jahr noch richtig.
 *
 * Ausgelagert, weil genau diese Bedingungen still falsch sein können: ein zu
 * kurzes Fenster feuert bei jedem Blättern eine Abrufwelle, ein zu langes lässt
 * das Sheet mit alten Zahlen dastehen. Hier sind sie prüfbar.
 */

/** Derselbe Titel löst frühestens nach dieser Pause erneut Abrufe aus. */
export const AUTO_MIN_GAP_MS = 2 * 60 * 1000;
/** Live-Kurs (Lang & Schwarz). */
export const AUTO_LS_MS = 2 * 60 * 1000;
/** Tageskerzen/Swing-Zonen — ändern sich einmal je Handelstag. */
export const AUTO_BARS_MS = 20 * 60 * 60 * 1000;
/** TR-Handelbarkeit — ändert sich praktisch nie. */
export const AUTO_TR_MS = 7 * 24 * 60 * 60 * 1000;
/** Analysten-Kursziele (Yahoo) — dieselbe Frist wie der localStorage-Cache. */
export const AUTO_YH_MS = 12 * 60 * 60 * 1000;

/** Alter eines ISO-Zeitstempels in ms; fehlt er, gilt „unendlich alt". */
export function ageMs(iso, now = Date.now()) {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? now - t : Infinity;
}

/**
 * autoFetchPlan(candidate, opts) → { skip, ls, bars, tr, yh }
 *
 * `skip` heisst: gar nichts tun (kein Backend, Mock-Modus, ein noch laufender
 * Abruf für denselben Titel, oder — ohne `force` — derselbe Titel wurde gerade
 * eben schon versorgt). Die vier Flags sagen, welche Quelle fällig ist.
 *
 * `force` ist der Normalfall beim Öffnen eines Detail-Sheets: dann holt das
 * Sheet alle vier Quellen frisch, unabhängig vom Alter der gespeicherten Werte.
 * Wer ein Sheet öffnet, will die aktuellen Zahlen sehen und nicht raten, ob
 * gerade eine Frist greift. Übrig bleiben nur die harten Bedingungen, unter
 * denen ein Abruf gar nicht funktionieren kann:
 * `hasTdKey` (US-Titel ohne TwelveData-Key bekommen keine Kerzen, der Abruf
 * erzeugte nur eine Fehlermeldung) und `hasYahooSymbol` (ohne Yahoo-Symbol
 * gibt es keine Kursziel-Abfrage).
 *
 * Ohne `force` (Hintergrund-Auffrischung) entscheiden weiter die Fristen — sie
 * sind unterschiedlich lang, weil die Daten unterschiedlich schnell altern.
 */
export function autoFetchPlan(c, {
  now = Date.now(), hasBackend = true, isMock = false,
  isUs = false, hasTdKey = false, hasYahooSymbol = false,
  force = false, busy = false,
} = {}) {
  const none = { skip: true, ls: false, bars: false, tr: false, yh: false };
  if (!c || isMock || !hasBackend) return none;
  // Eine laufende Runde nicht verdoppeln (Doppelklick, schnelles Zurück/Weiter
  // auf denselben Titel) — das brächte nur dieselben Requests ein zweites Mal.
  if (busy) return none;
  if (!force && c._auto_at && now - c._auto_at < AUTO_MIN_GAP_MS) return none;

  const canBars = !isUs || hasTdKey;
  if (force) {
    return { skip: false, ls: true, bars: canBars, tr: true, yh: hasYahooSymbol };
  }

  return {
    skip: false,
    ls:   ageMs(c.ls_quote?.checked_at, now) > AUTO_LS_MS,
    bars: canBars && ageMs(c.swing_analysis?.checked_at, now) > AUTO_BARS_MS,
    tr:   ageMs(c.tr_check?.checked_at, now) > AUTO_TR_MS,
    yh:   hasYahooSymbol && ageMs(c.yh_targets?.checked_at, now) > AUTO_YH_MS,
  };
}
