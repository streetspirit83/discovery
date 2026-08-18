/**
 * tv-forecast.js — 6-Monats-Szenarien für den Forecast-Tab.
 *
 * Spec: docs/FORECAST_SPEC.md.
 *
 * Drei Pfade aus EINEM Skelett, gerechnet im Log-Raum:
 *
 *   p_s(t) = p0 · exp( μ·t  +  m_s · σ_d · √t )        t = 1 … 126 Handelstage
 *
 * - **μ (Drift)** — ØGr/M aus Perf.1M/3M/6M (Blend 50/30/20), geometrisch auf
 *   einen Handelstag heruntergebrochen und mit `DRIFT_DAMPING` gedämpft. Die
 *   Dämpfung ist dieselbe wie in `tv-upside.js`: Momentum kehrt zurück, eine
 *   ungedämpfte Fortschreibung von Perf.1M über ein halbes Jahr ist Unsinn.
 * - **σ_d (Volatilität)** — ATRP/100 × `SIGMA_FROM_ATRP`. Die True Range ist
 *   systematisch breiter als die Tages-Standardabweichung (Faustwert ~1,25×),
 *   ohne den Faktor wäre der Fächer dauerhaft zu weit.
 * - **√t statt t** beim Vol-Term: der Fächer öffnet sich wie ein Diffusions-
 *   kegel statt linear zu explodieren. Bei ATRP 2 % sind das nach 6 Monaten
 *   ±18 %, nicht ±250 %.
 * - **m_s (Sigma-Vielfaches), Bias-dynamisch** — Breakout +1,0σ…+1,5σ,
 *   Breakdown −1,0σ…−1,5σ, je nach Bias-Vorzeichen; Status Quo m = 0, also
 *   reine Drift ab dem LS/TR-Kurs. Ein bullisches Bias verlängert damit den
 *   Breakout-Ast und lässt den Breakdown-Ast kurz — der Fächer kippt mit der
 *   Marktlage, ohne dass eine Richtung behauptet wird.
 *
 * Danach **bremst die Struktur**: jedes überschrittene Level (Resistance-Zonen,
 * 1M/3M/6M-Hochs, 52W-Hoch bzw. gespiegelt nach unten) halbiert die Steigung
 * des Restwegs, ATH bzw. 52W-Tief sind harte Grenzen. Das ist eine monotone,
 * stückweise lineare Abbildung auf den Preis — die Kurve knickt sichtbar dort
 * ab, wo sie auf eine getestete Zone läuft.
 *
 * **Währung:** das Modul rechnet währungsfrei. σ und μ sind relativ, alle
 * absoluten Preise (p0, Level, Cap/Floor) kommen bereits in EINER Währung
 * herein — die Umrechnung passiert im Component, wo die Faktoren liegen.
 *
 * Alles hier ist rein und ohne DOM/Netz testbar.
 */

/* ── Modellparameter ──────────────────────────────────────────────────────── */

/** Projektionslänge: ~6 Monate in Handelstagen. */
export const FORECAST_DAYS = 126;
/** Handelstage je Monat (Umrechnung Monatsrate → Tagesrate). */
export const DAYS_PER_MONTH = 21;
/** ATRP → Tages-σ. True Range ist ~1,25× breiter als die Standardabweichung. */
export const SIGMA_FROM_ATRP = 0.8;
/** Dämpfung der Drift — identisch zu `tv-upside.js`. */
export const DRIFT_DAMPING = 0.5;
/**
 * Halbwertszeit des Momentums in Handelstagen (~3 Monate). Die Drift wirkt
 * NICHT linear über die vollen 6 Monate, sondern läuft aus:
 *   D(t) = μ · τ · (1 − e^(−t/τ))
 *
 * Ohne das Auslaufen wächst die Drift mit `t`, der Vol-Term aber nur mit `√t` —
 * bei einem Titel mit ØGr/M +6 % (also +43 % über 6 Monate) frisst die Drift das
 * ganze −1σ auf, und der *Breakdown*-Ast dreht wieder nach oben. Genau das war
 * im ersten Wurf zu sehen. Kurzfristig bleibt D(t) ≈ μ·t, langfristig sättigt es
 * bei μ·τ ≈ 3 Monaten Momentum — mehr Fortschreibung gibt ein Perf-Wert nicht her.
 */
export const DRIFT_PERSISTENCE_DAYS = 63;
/** Sigma-Vielfaches der Extremszenarien ohne Bias-Zuschlag. */
export const BASE_SIGMA_MULT = 1.0;
/** Maximaler Bias-Zuschlag auf das Sigma-Vielfache (bei |Bias| = 100). */
export const BIAS_SIGMA_BONUS = 0.5;
/** Restweg-Faktor je überschrittenem Level (0,5 = jede Zone halbiert). */
export const LEVEL_COMPRESSION = 0.5;
/**
 * Untergrenze der Bremswirkung. Ohne sie stünde der Pfad bei einem Titel mit
 * vielen dicht liegenden Levels faktisch still (0,5^7 ≈ 0,008) — eine Zone
 * kostet Zeit, sie friert den Kurs aber nicht für ein halbes Jahr ein.
 */
export const MIN_SLOPE = 0.25;
/** Levels näher als 2 % beieinander sind dieselbe Zone (vgl. `buildZones`). */
export const LEVEL_MERGE_PCT = 0.02;
/**
 * Steigung jenseits von ATH bzw. 52W-Tief. Diese beiden sind die **stärkste
 * Bremse**, keine Wand: ein harter Deckel friert bei einem Titel dicht unter
 * seinem ATH jedes Aufwärtsszenario auf ein paar Prozent ein — dabei ist der
 * Ausbruch über das ATH bei genau so einem Titel das eigentliche Szenario.
 * Mit 0,1 kostet neues Terrain die zehnfache Strecke, bleibt aber möglich.
 */
export const BEYOND_BOUND_SLOPE = 0.1;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/* ── Bausteine ────────────────────────────────────────────────────────────── */

/**
 * Tages-σ als Anteil (0,016 = 1,6 %). Reihenfolge wie in `tv-upside.js`:
 * ATRP, dann ATR/Preis, dann die geglätteten TV-Volatilitäten.
 */
export function dailySigma(tv, price) {
  if (!tv) return null;
  const atrp = num(tv.atrp);
  if (atrp != null && atrp > 0) return (atrp / 100) * SIGMA_FROM_ATRP;
  const atr = num(tv.atr);
  if (atr != null && atr > 0 && price > 0) return (atr / price) * SIGMA_FROM_ATRP;
  const volM = num(tv.volatility_m);
  if (volM != null && volM > 0) return volM / 100;
  const volD = num(tv.volatility);
  if (volD != null && volD > 0) return volD / 100;
  return null;
}

/** Geometrische Ø-Monatsrate (%) aus einer Performance über n Monate. */
export function monthlyRate(perfPct, months) {
  const v = num(perfPct);
  if (v == null || v <= -100) return null;
  return (Math.pow(1 + v / 100, 1 / months) - 1) * 100;
}

/**
 * Gedämpfte Ø-Monatsrate (%) aus Perf.1M/3M/6M — der „ØGr/M"-Eingang des
 * Status-Quo-Szenarios. Gewichte 50/30/20, auf die vorhandenen Felder
 * renormiert; ohne jede Performance null.
 */
export function blendedMonthlyDrift(tv) {
  if (!tv) return null;
  const parts = [
    [monthlyRate(tv.perf_1m, 1), 0.5],
    [monthlyRate(tv.perf_3m, 3), 0.3],
    [monthlyRate(tv.perf_6m, 6), 0.2],
  ].filter(([v]) => v != null);
  if (!parts.length) return null;
  const wSum = parts.reduce((s, [, w]) => s + w, 0);
  return (parts.reduce((s, [v, w]) => s + v * w, 0) / wSum) * DRIFT_DAMPING;
}

/** Monatsrate (%) → Log-Drift je Handelstag. */
export function dailyLogDrift(monthlyPct) {
  const m = num(monthlyPct);
  if (m == null || m <= -100) return 0;
  return Math.log(1 + m / 100) / DAYS_PER_MONTH;
}

/**
 * Aufsummierte Log-Drift bis Tag t, mit auslaufendem Momentum:
 *   D(t) = μ · τ · (1 − e^(−t/τ)),  τ = DRIFT_PERSISTENCE_DAYS
 * Für kleine t praktisch μ·t, für große t gesättigt bei μ·τ.
 */
export function cumulativeDrift(driftD, t) {
  const tau = DRIFT_PERSISTENCE_DAYS;
  return driftD * tau * (1 - Math.exp(-t / tau));
}

/**
 * Stückweise lineare Bremse. Gerechnet wird auf der **Ausgabeseite**: der
 * gezeigte Pfad läuft bis zum ersten Level ungebremst, für den Weg vom ersten
 * zum zweiten Level braucht er die doppelte Rohstrecke, danach die vierfache —
 * `slope_k = max(LEVEL_COMPRESSION^k, MIN_SLOPE)`.
 *
 * Die Richtung ist wichtig: die Breakpoints liegen bei den **echten Levels**,
 * nicht auf einem unsichtbaren Rohpfad. Nur so bedeutet „gebremst an 105,40",
 * dass die gezeichnete Kurve diese 105,40 auch wirklich erreicht hat.
 *
 * `levels` sind aufsteigend nach Abstand von p0 sortiert, `dir` = +1 aufwärts |
 * −1 abwärts. `boundIdx` markiert darin ATH bzw. 52W-Tief: jenseits davon gilt
 * `BEYOND_BOUND_SLOPE` statt der Halbierungsleiter (−1 = kein solches Level).
 *
 * Zurück kommt der gebremste Preis, das letzte vom gezeigten Pfad erreichte
 * Level und ob dieses Level die harte Grenze war.
 */
export function applyBrakes(raw, p0, levels, dir, boundIdx = -1) {
  const dist = (raw - p0) * dir;          // Rohstrecke (ungebremst)
  if (!(dist > 0)) return { value: raw, brake: null, atBound: false };

  let used = 0;        // verbrauchte Rohstrecke
  let out = 0;         // zurückgelegte Ausgabestrecke
  let passed = 0;      // tatsächlich erreichte Level (= Steigungs-Exponent)
  let brake = null;
  const slopeAt = (k) => (boundIdx >= 0 && k > boundIdx
    ? BEYOND_BOUND_SLOPE
    : Math.max(Math.pow(LEVEL_COMPRESSION, k), MIN_SLOPE));
  const done = (value) => ({ value, brake, atBound: boundIdx >= 0 && passed > boundIdx });
  for (const lvl of levels) {
    const seg = (lvl - p0) * dir - out;                // Ausgabestrecke bis dahin
    if (seg <= 0) continue;                            // Level schon hinter uns
    const slope = slopeAt(passed);
    const cost = seg / slope;                          // nötige Rohstrecke
    if (used + cost >= dist) {                         // endet vor dem Level
      return done(p0 + dir * (out + (dist - used) * slope));
    }
    used += cost;
    out += seg;
    passed++;
    brake = lvl;                                       // Level erreicht
  }
  return done(p0 + dir * (out + (dist - used) * slopeAt(passed)));
}

/* ── Wahrscheinlichkeit ───────────────────────────────────────────────────── */

/** Standardnormal-Verteilungsfunktion (Abramowitz-Stegun 7.1.26 über erf). */
export function normCdf(z) {
  const s = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + s * y);
}

/**
 * z-Wert eines Zielpreises unter der Lognormal-Annahme des Modells. Die Drift
 * geht als `cumulativeDrift` ein — dieselbe auslaufende Größe wie im Pfad,
 * sonst passten Wahrscheinlichkeit und gezeichnete Kurve nicht zusammen.
 */
function zScore(target, p0, driftD, sigmaD, days) {
  if (!(target > 0) || !(p0 > 0) || !(sigmaD > 0) || !(days > 0)) return null;
  return (Math.log(target / p0) - cumulativeDrift(driftD, days)) / (sigmaD * Math.sqrt(days));
}

/* ── Level-Aufbereitung ───────────────────────────────────────────────────── */

/**
 * Bremslevel einer Seite: alles zwischen p0 und der harten Grenze, zusammen-
 * gefasst (was näher als `LEVEL_MERGE_PCT` beieinander liegt, ist dieselbe
 * Zone) und nach Abstand von p0 sortiert. `cap` selbst ist KEIN Bremslevel —
 * es ist die Wand dahinter.
 */
export function brakeLevels(raw, p0, dir, cap = null) {
  const seen = [];
  const levels = raw
    .map(num)
    .filter((v) => v != null && v > 0 && (v - p0) * dir > 0)
    .filter((v) => cap == null || (v - cap) * dir < 0)
    .sort((a, b) => (a - b) * dir)
    .filter((v) => {
      if (seen.some((s) => Math.abs(v - s) / p0 < LEVEL_MERGE_PCT)) return false;
      seen.push(v);
      return true;
    });
  // Die harte Grenze hängt als letztes, stärkstes Bremslevel hinten dran.
  const boundIdx = cap != null && (cap - p0) * dir > 0 ? levels.push(cap) - 1 : -1;
  return { levels, boundIdx };
}

/* ── Hauptfunktion ────────────────────────────────────────────────────────── */

/**
 * buildForecast(opts) → { p0, sigmaD, driftD, monthlyDrift, days, scenarios[], … }
 *
 * Alle Preise (p0, resistances, supports, cap, floor) müssen in DERSELBEN
 * Währung übergeben werden; das Ergebnis liegt in genau dieser Währung.
 *
 * `scenarios[]` ist immer [breakout, status, breakdown] mit:
 *   { key, label, mult, points[], target, changePct, prob, brake, cap }
 * `points[]` enthält den Startpunkt (t = 0, p0) plus je Handelstag einen Wert —
 * die Zeitachse hängt der Aufrufer an (er kennt den Handelskalender der Bars).
 */
export function buildForecast({
  tv, p0, biasScore = 0, resistances = [], supports = [],
  cap = null, floor = null, days = FORECAST_DAYS,
} = {}) {
  const price = num(p0);
  if (price == null || price <= 0) return null;

  const sigmaD = dailySigma(tv, price);
  if (sigmaD == null || !(sigmaD > 0)) return null;

  const monthlyDrift = blendedMonthlyDrift(tv);
  const driftD = dailyLogDrift(monthlyDrift);
  const k = Math.max(-1, Math.min(1, (num(biasScore) ?? 0) / 100));

  // Grenzen zählen nur auf der richtigen Seite von p0. Kurs bereits über dem
  // ATH (Blue Sky) ⇒ keine Grenze, die ATH-Linie bleibt reine Referenz.
  const capUp   = num(cap)   != null && num(cap)   > price ? num(cap)   : null;
  const floorDn = num(floor) != null && num(floor) < price ? num(floor) : null;

  const up = brakeLevels(resistances, price, +1, capUp);
  const dn = brakeLevels(supports,    price, -1, floorDn);

  const defs = [
    { key: 'breakout',  label: 'Breakout',   mult: +(BASE_SIGMA_MULT + BIAS_SIGMA_BONUS * Math.max(k, 0)) },
    { key: 'status',    label: 'Status Quo', mult: 0 },
    { key: 'breakdown', label: 'Breakdown',  mult: -(BASE_SIGMA_MULT + BIAS_SIGMA_BONUS * Math.max(-k, 0)) },
  ];

  const scenarios = defs.map(({ key, label, mult }) => {
    const points = [{ t: 0, value: price }];
    let brake = null;
    let atBound = false;
    for (let t = 1; t <= days; t++) {
      const raw = price * Math.exp(cumulativeDrift(driftD, t) + mult * sigmaD * Math.sqrt(t));
      /* Die Leiter richtet sich nach dem ROHPUNKT, nicht nach dem Szenario:
         ein Breakout-Ast unter p0 (stark negative Drift) muss an Supports
         bremsen, nicht an Resistances. Sonst laufen die Äste ineinander und
         die Reihenfolge Breakout ≥ Status Quo ≥ Breakdown kippt. */
      const dir = raw >= price ? +1 : -1;
      const ladder = dir > 0 ? up : dn;
      const br = applyBrakes(raw, price, ladder.levels, dir, ladder.boundIdx);
      if (br.brake != null) { brake = br.brake; atBound = br.atBound; }
      /* Namensgarantie: ein „Breakdown" endet nie über dem Startkurs und ein
         „Breakout" nie darunter. Bei extremer Drift und kleinem σ könnte die
         Rechnung das sonst hergeben — dann ist der Ast flach, aber ehrlich. */
      const v = mult > 0 ? Math.max(br.value, price)
        : mult < 0 ? Math.min(br.value, price)
          : br.value;
      points.push({ t, value: v });
    }

    const target = points[points.length - 1].value;
    return {
      key, label, mult, points, target,
      changePct: (target / price - 1) * 100,
      brake, atBound,
    };
  });

  /* Wahrscheinlichkeiten aus DERSELBEN Lognormal-Annahme, damit die drei Zahlen
     zusammen 100 % ergeben: oberhalb des Breakout-Ziels, unterhalb des
     Breakdown-Ziels, Rest = Status Quo. Gerechnet wird auf die ANGEZEIGTEN
     (gebremsten) Ziele — der Leser soll die Zahl neben dem Ziel lesen können,
     das im Chart steht.

     Die Grenzen werden vorher sortiert: liegen zwei Ziele gleichauf (beide an
     derselben Bremse), fällt der mittlere Bereich auf 0 % zusammen statt
     negativ zu werden. Genau das ging vorher schief, als Breakout und Status
     Quo beide am ATH klebten. */
  const [sUp, sSt, sDn] = scenarios;
  const hi = Math.max(sUp.target, sSt.target);
  const lo = Math.min(sDn.target, sSt.target);
  const zUp = zScore(hi, price, driftD, sigmaD, days);
  const zDn = zScore(lo, price, driftD, sigmaD, days);
  const pUp = zUp == null ? null : 1 - normCdf(zUp);
  const pDn = zDn == null ? null : normCdf(zDn);
  sUp.prob = pUp == null ? null : pUp * 100;
  sDn.prob = pDn == null ? null : pDn * 100;
  sSt.prob = (pUp == null || pDn == null) ? null : Math.max(0, 1 - pUp - pDn) * 100;

  return {
    p0: price, sigmaD, driftD, monthlyDrift, days,
    bias: k * 100,
    horizonSigmaPct: sigmaD * Math.sqrt(days) * 100,
    horizonDriftPct: (Math.exp(cumulativeDrift(driftD, days)) - 1) * 100,
    upLevels: up.levels, dnLevels: dn.levels, cap: capUp, floor: floorDn,
    scenarios,
  };
}

/* ── Zeitachse ────────────────────────────────────────────────────────────── */

/**
 * `days` Handelstage (Mo–Fr) ab dem Tag NACH `startDate` als 'YYYY-MM-DD'.
 * Feiertage werden ignoriert: bei einer Projektion über ein halbes Jahr
 * verschöbe ein Feiertag den Endpunkt um einen Tag — irrelevant, und ein
 * Kalender je Börse wäre Ballast ohne Nutzen.
 */
export function futureBusinessDays(startDate, days = FORECAST_DAYS) {
  const start = new Date(`${String(startDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return [];
  const out = [];
  const d = new Date(start);
  while (out.length < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
