/**
 * tv-sentiment.js — gerichtetes Markt-Bias (bullish/bearish) plus Trendalter.
 *
 * Warum ein eigenes Modul, wo es doch schon Scores gibt: die bestehenden Scores
 * (Overall, Health, Entry, Momentum …) sind *ungerichtete Qualitätsmaße* 0–100 —
 * hoch = gut. Man kann sie nicht mitteln, um eine Richtung zu bekommen: RSI 25
 * ist für Momentum schlecht, für eine Mean-Reversion-These bullish. Das Bias
 * bewertet deshalb symmetrisch auf einer signierten Achse −100 … +100.
 *
 * Drei Ebenen, absichtlich unterschiedlich träge (der Ring in der Tabelle zeigt
 * je Ebene ein Drittel-Segment, damit Uneinigkeit sichtbar wird):
 *   Regime   (40 %) — SMA200, Golden/Death-Cross, Weekly-EMA-Stack
 *   Trend    (35 %) — Daily-EMA-Stack, ADX×DI-Richtung, Aroon-Gap, Perf.1M
 *   Momentum (25 %) — Perf.W, Δ1T, MACD-Histogramm, RSI vs. 50
 *
 * Fehlende Inputs werden ausgelassen und die Gewichte renormalisiert (wie in
 * tv-momentum-check.js). Unter MIN_COVERAGE Datenabdeckung → null, damit ein
 * fast leeres tv_data nicht als „neutral" durchgeht.
 *
 * Alles pure Rechnung auf verbatim tv_data — kein DOM, kein Fetch, kein
 * zusätzlicher TV-Request. Läuft damit für JEDEN Ticker, nicht nur US.
 */

const MIN_COVERAGE = 0.4;   // Anteil belegter Einzelchecks, ab dem gewertet wird
const DEAD_ZONE    = 0.15;  // |Ebenen-Score| darunter = neutral (grauer Ring)
const NEUTRAL_BAND = 10;    // |Gesamt-Score| darunter = keine Richtung

/** Wert auf −1…+1 stauchen: `full` ist der Betrag, ab dem voll ausgeschlagen wird. */
const ramp = (v, full) => (v == null ? null : Math.max(-1, Math.min(1, v / full)));

/* Relativer Abstand a↔b in Prozent, gerampt über ±`full`%.
   Absichtlich KEIN hartes a>b: ein Kurs 0,3% unter der SMA200 liegt praktisch
   auf der Linie und darf nicht dasselbe Signal geben wie einer 20% darunter.
   Aus demselben Grund wird hier auch nicht computeMtfa() wiederverwendet —
   dessen Ternär-Votum wertet Gleichstand als „bear", was auf einer signierten
   Achse ein Range-Papier fälschlich nach unten zieht. MTFA bleibt für die
   eigene Spalte in der Score-Ansicht, wo die Ternär-Logik richtig ist. */
const rel = (a, b, full) =>
  (a == null || b == null || !b ? null : ramp(((a - b) / Math.abs(b)) * 100, full));

/** Mittel über die belegten Teilwerte + wie viele davon belegt waren. */
function level(parts) {
  const vals = parts.filter((v) => v != null);
  return { value: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null,
           filled: vals.length, total: parts.length };
}

const dirOf = (v) => (v == null ? null : v > DEAD_ZONE ? 'up' : v < -DEAD_ZONE ? 'dn' : 'flat');

/* ── Die drei Ebenen ──────────────────────────────────────────────────────── */

/* Regime: wo steht der Kurs im großen Bild? Weite Rampen — ein Regime wechselt
   nicht, weil der Kurs die Linie um ein Promille kreuzt. */
function regimeLevel(tv) {
  const close = tv.close_1m ?? tv.close;
  const weekly = level([
    rel(close, tv.ema20_1w, 3), rel(tv.ema20_1w, tv.ema50_1w, 3), rel(tv.ema50_1w, tv.ema200_1w, 3),
  ]);
  return level([rel(close, tv.sma200, 5), rel(tv.sma50, tv.sma200, 3), weekly.value]);
}

/* Trend: Richtung UND Kraft. ADX allein ist richtungslos (misst nur Stärke),
   deshalb über DI+/DI− signiert und mit ADX/30 als Kraftfaktor gewichtet. */
function trendLevel(tv) {
  const close = tv.close_1m ?? tv.close;
  const daily = level([
    rel(close, tv.ema20, 2), rel(tv.ema20, tv.ema50, 2), rel(tv.ema50, tv.ema200, 2),
  ]);
  const adxDir = tv.adx_plus_di != null && tv.adx_minus_di != null
    ? Math.sign(tv.adx_plus_di - tv.adx_minus_di) * Math.min((tv.adx ?? 0) / 30, 1)
    : null;
  const up = tv.aroon_up ?? tv.aroon_up_1m;
  const dn = tv.aroon_down ?? tv.aroon_down_1m;
  const aroonGap = up != null && dn != null ? ramp(up - dn, 100) : null;
  return level([daily.value, adxDir, aroonGap, ramp(tv.perf_1m, 10)]);
}

/* Momentum: die schnelle Ebene — hier darf es zappeln, das ist der Sinn. */
function momentumLevel(tv) {
  const hist = tv.macd != null && tv.macd_signal != null ? tv.macd - tv.macd_signal : null;
  return level([
    ramp(tv.perf_w, 5),
    ramp(tv.change_1d, 3),
    hist != null ? Math.sign(hist) : null,
    tv.rsi != null ? ramp(tv.rsi - 50, 25) : null,
  ]);
}

/* ── Trendalter ───────────────────────────────────────────────────────────────
 * Ehrlich gesagt ein Proxy, kein gemessenes Alter — wir haben (noch) keine
 * Bias-Historie. Zwei Quellen, bewusst kombiniert:
 *
 * 1) Performance-Leiter (primär): das längste Fenster, dessen Bewegung noch zum
 *    Bias passt (1W → 1M → 3M → 6M). Je länger das Fenster, desto größer muss
 *    die Bewegung sein, damit sie zählt — sonst macht ein Range-Papier mit
 *    +1% über 6 Monate einen „≥6M-Trend" auf.
 *
 * 2) Tages-Aroon (nur für junge Trends): Aroon misst wörtlich die Zeit seit
 *    einem Extrem — Aroon.Down = 100 × (14 − Tage seit dem 14-Tage-TIEF)/14.
 *    Für ein Bull-Bias ist die Zeit seit dem letzten TIEF das Trendalter (nicht
 *    die seit dem Hoch — in einem laufenden Aufwärtstrend sind neue Hochs
 *    frisch, das Tief liegt zurück). Spiegelbildlich für Bear.
 *    ACHTUNG: der Wert sättigt bei 14 Tagen. Er wird deshalb NUR herangezogen,
 *    wenn die Leiter selbst „jung" sagt — sonst stünde an einem seit einem
 *    halben Jahr laufenden Trend „12T".
 *
 * Rückgabe: { days, label, exact } — `exact:false` heißt „mindestens so alt".
 */
const LADDER = [
  ['perf_6m', 180, '≥6M', 8],   // [Feld, Tage, Label, Mindestbewegung %]
  ['perf_3m',  90, '≥3M', 5],
  ['perf_1m',  30, '≥1M', 3],
  ['perf_w',    7, '≥1W', 1.5],
];

export function trendAge(tv, sign) {
  if (!tv || !sign) return null;

  const rung = LADDER.find(([key, , , min]) => {
    const v = tv[key];
    return v != null && Math.sign(v) === sign && Math.abs(v) >= min;
  });

  // Tagesauflösung lohnt nur, solange die Leiter nicht über eine Woche hinaus ist.
  if (!rung || rung[1] <= 7) {
    const aroon = sign > 0 ? tv.aroon_down : tv.aroon_up;
    if (aroon != null) {
      const days = Math.round(14 * (100 - aroon) / 100);
      if (days < 13) return { days, label: `${days}T`, exact: true };
    }
  }

  if (rung) return { days: rung[1], label: rung[2], exact: false };
  return { days: 0, label: 'neu', exact: false };
}

/* ── Bias ─────────────────────────────────────────────────────────────────── */

const WEIGHTS = { regime: 0.40, trend: 0.35, momentum: 0.25 };

/**
 * computeBias(tv) → {
 *   score,                       // −100 … +100 (Sortierschlüssel)
 *   sign,                        // +1 bull | −1 bear (mathematisches Vorzeichen)
 *   neutral,                     // true wenn |score| < NEUTRAL_BAND
 *   levels: { regime, trend, momentum },        // −1 … +1 je Ebene
 *   dirs:   { regime, trend, momentum },        // 'up' | 'dn' | 'flat' | null
 *   coverage,                    // Anteil belegter EINZELCHECKS 0…1 (gewichtet)
 *   volBoost,                    // angewandter Volumen-Faktor
 * } | null
 */
export function computeBias(tv) {
  if (!tv) return null;

  const raw = { regime: regimeLevel(tv), trend: trendLevel(tv), momentum: momentumLevel(tv) };
  const levels = { regime: raw.regime.value, trend: raw.trend.value, momentum: raw.momentum.value };

  let sum = 0, wSum = 0, coverage = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    // Abdeckung zählt die belegten Einzelchecks, nicht die Ebenen: sonst gilt
    // ein tv_data mit drei Feldern als „100% abgedeckt".
    coverage += w * (raw[k].filled / raw[k].total);
    if (levels[k] == null) continue;
    sum += levels[k] * w;
    wSum += w;
  }
  if (!wSum || coverage < MIN_COVERAGE) return null;

  /* Volumen bestätigt nur, es dreht nie: überdurchschnittliches Volumen
     verstärkt den vorhandenen Ausschlag, dünnes dämpft ihn. */
  const volRatio = tv.avg_vol_10d != null && tv.average_volume_30d_calc > 0
    ? tv.avg_vol_10d / tv.average_volume_30d_calc : null;
  const volBoost = volRatio == null ? 1 : volRatio >= 1.2 ? 1.1 : volRatio <= 0.8 ? 0.9 : 1;

  const score = Math.max(-100, Math.min(100, Math.round((sum / wSum) * volBoost * 100)));

  return {
    score,
    sign: score >= 0 ? 1 : -1,
    neutral: Math.abs(score) < NEUTRAL_BAND,
    levels,
    dirs: { regime: dirOf(levels.regime), trend: dirOf(levels.trend), momentum: dirOf(levels.momentum) },
    coverage,
    volBoost,
  };
}

/* ── Ring-Grafik ──────────────────────────────────────────────────────────────
 * Drei Segmente (Regime · Trend · Momentum) um eine Bulle/Bär-Silhouette.
 * Liegt hier, damit Tabelle und Detail-Sheet garantiert dieselbe Grafik zeigen.
 *
 * Das Icon-Markup kommt als Argument herein statt via Import: icons.js ist
 * UI-Schicht, dieses Modul soll abhängigkeitsfrei und ohne DOM testbar bleiben.
 */
export const RING = { r: 14, sw: 2.6, gap: 3.4, iconT: 4.6, iconS: 1.425 };
const RING_C = 2 * Math.PI * RING.r;
const RING_SEG = RING_C / 3;
const RING_VIS = RING_SEG - RING.gap;
export const BIAS_LEVELS = [['regime', 'Regime'], ['trend', 'Trend'], ['momentum', 'Momentum']];

/**
 * biasRingSVG(bias, { size, icon }) → SVG-String.
 * Das Icon MUSS in den Innenkreis passen (r ≈ 12.7 bei viewBox 32) — ein
 * quadratisch ausgereiztes Motiv würde an den Ecken vom Ring beschnitten.
 */
export function biasRingSVG(bias, { size = 34, icon = '' } = {}) {
  const tone = bias.neutral ? 'flat' : bias.sign > 0 ? 'pos' : 'neg';
  const segs = BIAS_LEVELS.map(([key], i) => {
    const d = bias.dirs[key] ?? 'flat';
    return `<circle class="bias-seg bias-seg--${d}" cx="16" cy="16" r="${RING.r}" fill="none"
      stroke-width="${RING.sw}"
      stroke-dasharray="${RING_VIS.toFixed(2)} ${(RING_C - RING_VIS).toFixed(2)}"
      stroke-dashoffset="${(-i * RING_SEG).toFixed(2)}" transform="rotate(-90 16 16)"/>`;
  }).join('');
  return `<svg class="bias-ring bias-ring--${tone}" width="${size}" height="${size}"
      viewBox="0 0 32 32" aria-hidden="true">${segs}
      <g transform="translate(${RING.iconT} ${RING.iconT}) scale(${RING.iconS})">${icon}</g></svg>`;
}

/** Klartext-Label für Tooltips und das Detail-Sheet. */
export function biasLabel(score) {
  if (score == null) return '—';
  const a = Math.abs(score);
  const strength = a >= 60 ? 'stark ' : a >= 30 ? '' : 'leicht ';
  if (a < 10) return 'neutral';
  return `${strength}${score > 0 ? 'bullish' : 'bearish'}`;
}
