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
 * `skip` heisst: gar nichts tun (kein Backend, Mock-Modus, oder derselbe Titel
 * wurde gerade eben schon versorgt). Die vier Flags sagen, welche Quelle fällig
 * ist. `hasTdKey` betrifft nur US-Titel — ohne TwelveData-Key gibt es dort keine
 * Kerzen, und ein Abruf würde nur eine Fehlermeldung erzeugen.
 */
export function autoFetchPlan(c, {
  now = Date.now(), hasBackend = true, isMock = false,
  isUs = false, hasTdKey = false, hasYahooSymbol = false,
} = {}) {
  const none = { skip: true, ls: false, bars: false, tr: false, yh: false };
  if (!c || isMock || !hasBackend) return none;
  if (c._auto_at && now - c._auto_at < AUTO_MIN_GAP_MS) return none;

  return {
    skip: false,
    ls:   ageMs(c.ls_quote?.checked_at, now) > AUTO_LS_MS,
    bars: (!isUs || hasTdKey) && ageMs(c.swing_analysis?.checked_at, now) > AUTO_BARS_MS,
    tr:   ageMs(c.tr_check?.checked_at, now) > AUTO_TR_MS,
    yh:   hasYahooSymbol && ageMs(c.yh_targets?.checked_at, now) > AUTO_YH_MS,
  };
}
