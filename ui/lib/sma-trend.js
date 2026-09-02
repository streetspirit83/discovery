/**
 * SMA-Trend — wie schnell und in welche Richtung sich die 200-Tage-Linie bewegt.
 *
 * Quelle sind ausschliesslich die persistierten SMA-Serien aus
 * `swing_analysis.sma` (siehe `tv-swings.js` → `smaTail`): TwelveData für
 * US-Titel, Yahoo für alles andere, beides Tages-Bars. Der TV-Scanner liefert
 * nur den **Momentwert** `sma200` — daraus lässt sich kein Wachstum ableiten,
 * es braucht die Reihe. Ohne geladene Kerzen gibt es hier also bewusst null
 * statt einer Schätzung.
 *
 * Prozentwerte sind währungsfrei: die Serie steht in Bar-Währung, aber jedes
 * Verhältnis zweier Punkte derselben Serie kürzt die Währung weg. Deshalb
 * braucht dieses Modul — anders als alle Preisspalten — keine FX-Umrechnung.
 */

/** Handelstage, die als „ein Monat" gelten (≈ 21 Bars, wie Perf.1M bei TV). */
export const MONTH_BARS = 21;

/**
 * Totband für „seitwärts". Die SMA200 ist ein 200-Tage-Mittel und bewegt sich
 * selbst in klaren Trends nur langsam; alles unter ±0,5 % im Monatsfenster ist
 * praktisch eine waagerechte Linie und soll nicht als Richtung gelesen werden.
 */
export const SIDE_BAND_PCT = 0.5;

/** Pfeil je Richtung. Textglyphen wie DIR_GLYPH in der Tabelle — keine Emoji. */
export const SMA_DIR_GLYPH = { up: '▲', down: '▼', side: '→' };
export const SMA_DIR_LABEL = { up: 'steigend', down: 'fallend', side: 'seitwärts' };

/** Richtung aus einer Prozentveränderung — mit Totband (siehe SIDE_BAND_PCT). */
export function smaDirection(chgPct, band = SIDE_BAND_PCT) {
  if (chgPct == null || Number.isNaN(chgPct)) return null;
  if (chgPct > band) return 'up';
  if (chgPct < -band) return 'down';
  return 'side';
}

/**
 * smaTrend(analysis, period) → null | {
 *   period, first, last, days,
 *   avgMonthlyPct,   // Ø Wachstum je 21 Handelstage über das ganze Fenster (geometrisch)
 *   avgDailyPct,     // dasselbe je Handelstag
 *   totalPct,        // Wachstum über das ganze Fenster
 *   chg1mPct, dir,   // letzte 21 Handelstage + Pfeilrichtung daraus
 *   chg3mPct,
 *   fromDate, toDate, // ISO-Datum der beiden Endpunkte (aus analysis.ohlc)
 * }
 *
 * Geometrisch statt arithmetisch: eine Ø-Wachstumsrate über ein Kursfenster
 * wird multiplikativ verkettet, sonst kommt bei asymmetrischen Bewegungen ein
 * Wert heraus, der sich nicht wieder zum Gesamtwachstum aufmultipliziert.
 */
export function smaTrend(analysis, period = 200) {
  const raw = analysis?.sma?.[period] ?? analysis?.sma?.[String(period)];
  if (!Array.isArray(raw) || raw.length < 2) return null;

  // Der Vorlauf der Serie ist null (eine SMA200 kennt die ersten 199 Bars
  // nicht). Index mitführen, damit Abstände echte Handelstage bleiben.
  const pts = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) pts.push({ i, v });
  }
  if (pts.length < 2) return null;

  const first = pts[0];
  const last  = pts[pts.length - 1];
  const days  = last.i - first.i;
  if (days < 1) return null;

  const ratio    = last.v / first.v;
  const totalPct = (ratio - 1) * 100;
  const avgDailyPct   = (ratio ** (1 / days) - 1) * 100;
  const avgMonthlyPct = (ratio ** (MONTH_BARS / days) - 1) * 100;

  // Rückblickfenster: exakt n Bars zurück, nicht n Listeneinträge — sonst wäre
  // das Fenster in der Nähe des Vorlaufs zu lang.
  const back = (n) => {
    const target = last.i - n;
    if (target < first.i) return null;
    let best = null;
    for (const p of pts) { if (p.i <= target) best = p; else break; }
    return best;
  };
  const p1m = back(MONTH_BARS);
  const p3m = back(MONTH_BARS * 3);
  const chg1mPct = p1m ? (last.v / p1m.v - 1) * 100 : null;
  const chg3mPct = p3m ? (last.v / p3m.v - 1) * 100 : null;

  const dates = Array.isArray(analysis?.ohlc) ? analysis.ohlc : null;
  const dateAt = (i) => (dates && dates[i] ? dates[i].date ?? null : null);

  return {
    period,
    first: first.v,
    last: last.v,
    days,
    totalPct,
    avgDailyPct,
    avgMonthlyPct,
    chg1mPct,
    chg3mPct,
    // Die Richtung beschreibt bewusst den LETZTEN Monat, nicht das ganze
    // Fenster: „wohin läuft die Linie gerade" ist die Frage am Pfeil.
    dir: smaDirection(chg1mPct ?? totalPct),
    dirWindow: chg1mPct != null ? '1M' : 'gesamt',
    fromDate: dateAt(first.i),
    toDate: dateAt(last.i),
    source: analysis?.source ?? null,
  };
}

/** Bequemer Direktzugriff für die 200er-Linie (der Regelfall). */
export const sma200Trend = (analysis) => smaTrend(analysis, 200);
