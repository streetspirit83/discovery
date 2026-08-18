/**
 * tv-reverse-dcf.js — was preist der Markt an FCF-Wachstum ein?
 *
 * Statt einen Fair Value zu behaupten (dafür bräuchte es Analysten-Prognosen,
 * die wir nicht haben), dreht das hier die Rechnung um: Bei welchem konstanten
 * Free-Cash-Flow-Wachstum über 10 Jahre ergibt ein DCF genau die heutige
 * Marktkapitalisierung? Diese **eingepreiste Wachstumsrate** ist die Aussage —
 * sie macht die Erwartung sichtbar, statt sie in einer Kommastelle zu verstecken.
 *
 * Alles kommt aus Feldern, die die TV-Anreicherung ohnehin holt — keine neue
 * Quelle, keine Historie:
 *   FCF (absolut) = market_cap ÷ price_free_cash_flow_ttm
 *   Diskontsatz   = risk_free + beta × Marktrisikoprämie   (CAPM)
 *
 * Währung: market_cap und FCF stehen in derselben Währung, das Verhältnis ist
 * dimensionslos. Die eingepreiste Wachstumsrate ist deshalb währungsfrei —
 * hier ist ausdrücklich KEINE Umrechnung nötig (anders als bei den Swing-Zonen).
 *
 * Bewusste Vereinfachungen — das ist eine Einordnungshilfe, kein Bewertungsmodell:
 * - Diskontiert wird der gesamte FCF gegen die Marktkapitalisierung mit den
 *   Eigenkapitalkosten. Sauber wäre FCFF gegen den Enterprise Value mit WACC.
 *   Für Firmen mit viel Netto-Schulden fällt die eingepreiste Rate dadurch zu
 *   niedrig aus; `leverage_warn` markiert diese Fälle, statt sie zu verschweigen.
 * - Zwei Phasen (10 Jahre Wachstum g, danach ewige Rente mit `terminalGrowth`),
 *   kein Fade dazwischen.
 * - TTM-FCF als Basis. Ein Ausreisserjahr schlägt voll durch — deshalb wird die
 *   beobachtete Wachstumsrate zum Vergleich mitgeliefert, nicht als Input benutzt.
 *
 * Das Ergebnis ist ein Kontextwert wie die Retail-Stimmung: es steht neben den
 * TV-Scores und fliesst in keinen davon ein (siehe CLAUDE.md — die ungerichteten
 * Qualitätsmasse dürfen nicht vermischt werden).
 */

export const DCF_DEFAULTS = {
  riskFree: 0.03,        // 10J-Bund/Treasury-Näherung
  erp: 0.05,             // Marktrisikoprämie
  terminalGrowth: 0.02,  // ewiges Wachstum ≈ langfristige Inflation
  years: 10,             // explizite Phase
  betaFloor: 0.6,        // Beta-Ausreisser dämpfen: ein Beta von 0,05 oder 4
  betaCap: 2.2,          //   würde den Diskontsatz sonst absurd machen
};

// Suchbereich für die eingepreiste Rate. Unterhalb/oberhalb ist die Aussage
// ohnehin nur noch „schrumpft dauerhaft" bzw. „völlig ausserhalb des Plausiblen".
const G_MIN = -0.40;
const G_MAX = 1.00;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Eigenkapitalkosten nach CAPM, mit gedämpftem Beta. */
export function discountRate(tv, opts = {}) {
  const { riskFree, erp, betaFloor, betaCap } = { ...DCF_DEFAULTS, ...opts };
  const rawBeta = num(tv?.beta) ?? num(tv?.beta_3_year);
  // Ohne Beta: Marktbeta 1 annehmen statt aufgeben.
  const beta = rawBeta == null ? 1 : Math.min(Math.max(rawBeta, betaFloor), betaCap);
  return { rate: riskFree + beta * erp, beta, betaRaw: rawBeta };
}

/** Absoluter Free Cash Flow (TTM) aus Marktkapitalisierung und P/FCF. */
export function fcfAbsolute(tv) {
  const mc = num(tv?.market_cap);
  const pfcf = num(tv?.price_free_cash_flow_ttm);
  if (mc == null || mc <= 0) return null;
  if (pfcf == null || pfcf === 0) return null;
  return mc / pfcf;   // negatives P/FCF ⇒ negativer FCF, wird oben abgefangen
}

/**
 * Barwert eines zwei-phasigen FCF-Stroms.
 * Phase 1: `years` Jahre mit Wachstum g. Danach ewige Rente mit gt.
 */
export function presentValue(fcf, g, r, gt, years) {
  if (!(r > gt)) return Infinity;         // sonst divergiert die ewige Rente
  let pv = 0;
  let cf = fcf;
  for (let t = 1; t <= years; t++) {
    cf *= (1 + g);
    pv += cf / Math.pow(1 + r, t);
  }
  const terminal = (cf * (1 + gt)) / (r - gt);
  return pv + terminal / Math.pow(1 + r, years);
}

/**
 * Kernstück: löst PV(g) = Marktkapitalisierung nach g.
 * PV ist in g streng monoton steigend, deshalb genügt eine Bisektion.
 */
export function solveImpliedGrowth(fcf, marketCap, r, gt, years) {
  if (presentValue(fcf, G_MIN, r, gt, years) > marketCap) return { growth: G_MIN, bounded: 'below' };
  if (presentValue(fcf, G_MAX, r, gt, years) < marketCap) return { growth: G_MAX, bounded: 'above' };

  let lo = G_MIN, hi = G_MAX;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (presentValue(fcf, mid, r, gt, years) < marketCap) lo = mid; else hi = mid;
  }
  return { growth: (lo + hi) / 2, bounded: null };
}

/**
 * reverseDcf(tv, opts) →
 *   { implied_growth, observed_growth, gap, rate, beta, fcf, market_cap,
 *     bounded, leverage_warn, assumptions }
 * | { error: 'no_data' | 'negative_fcf' }
 *
 * `implied_growth` und `observed_growth` sind Dezimalzahlen (0,12 = 12%).
 */
export function reverseDcf(tv, opts = {}) {
  const o = { ...DCF_DEFAULTS, ...opts };
  const marketCap = num(tv?.market_cap);
  const fcf = fcfAbsolute(tv);

  if (marketCap == null || fcf == null) return { error: 'no_data' };
  // Negativer FCF lässt sich nicht sinnvoll hochwachsen — jede Rate ergäbe
  // einen negativen Barwert. Ehrlicher: gar nichts ausgeben.
  if (fcf <= 0) return { error: 'negative_fcf', fcf, market_cap: marketCap };

  const { rate, beta, betaRaw } = discountRate(tv, o);
  const { growth, bounded } = solveImpliedGrowth(fcf, marketCap, rate, o.terminalGrowth, o.years);

  // Beobachtetes Wachstum nur als Vergleich, nie als Eingang in die Lösung.
  const obsPct = num(tv?.free_cash_flow_yoy_growth_ttm) ?? num(tv?.free_cash_flow_yoy_growth_fy);
  const observed = obsPct == null ? null : obsPct / 100;

  // Hoher Verschuldungsgrad ⇒ die Vereinfachung (Eigenkapitalkosten auf den
  // gesamten FCF) verzerrt spürbar nach unten. Kennzeichnen statt kaschieren.
  const de = num(tv?.debt_to_equity);
  const leverageWarn = de != null && de > 1.5;

  return {
    implied_growth: growth,
    observed_growth: observed,
    gap: observed == null ? null : growth - observed,
    rate,
    beta,
    beta_raw: betaRaw,
    fcf,
    market_cap: marketCap,
    bounded,
    leverage_warn: leverageWarn,
    assumptions: { riskFree: o.riskFree, erp: o.erp, terminalGrowth: o.terminalGrowth, years: o.years },
    checked_at: new Date().toISOString(),
  };
}

/* ── Szenario-Leiter: Wert je Wachstumsannahme ──────────────────────────────
   Dieselbe Rechnung vorwärts statt rückwärts. Sie beantwortet die Frage, die
   eine einzelne eingepreiste Rate offen lässt: was wäre die Aktie wert, wenn
   das Wachstum 10, 20, 30, 40 % beträgt — und ab wann ist sie damit günstig?

   Der faire Kurs je Aktie kommt ohne Aktienanzahl aus: Wert ÷ Marktkap. × Kurs
   kürzt sie heraus. Das spart ein Feld, das die TV-Anreicherung gar nicht hat. */

export const LADDER_GROWTHS = [0.05, 0.10, 0.20, 0.30, 0.40];

/** Anteil des Endwerts am Gesamtwert — je höher, desto stärker hängt das
 *  Ergebnis an Diskontsatz und ewigem Wachstum statt an der Wachstumsannahme. */
export function terminalShare(fcf, g, r, gt, years) {
  const total = presentValue(fcf, g, r, gt, years);
  if (!Number.isFinite(total) || total === 0) return null;
  let pv1 = 0, cf = fcf;
  for (let t = 1; t <= years; t++) { cf *= (1 + g); pv1 += cf / Math.pow(1 + r, t); }
  return 1 - pv1 / total;
}

/**
 * growthLadder(tv, opts) →
 *   { rows: [{ growth, value, fair_price, upside }], implied_growth, price,
 *     market_cap, rate, fcf, terminal_share }
 * | { error }
 *
 * `upside` ist Wert ÷ Marktkapitalisierung − 1, also währungsfrei. Die Zeile,
 * bei der upside das Vorzeichen wechselt, ist genau die eingepreiste Rate.
 */
export function growthLadder(tv, opts = {}) {
  const o = { ...DCF_DEFAULTS, ...opts };
  const growths = opts.growths ?? LADDER_GROWTHS;

  const base = reverseDcf(tv, o);
  if (base.error) return base;

  const price = num(tv?.close_1m) ?? num(tv?.close);
  const { fcf, market_cap: marketCap, rate } = base;

  const rows = growths.map((g) => {
    const value = presentValue(fcf, g, rate, o.terminalGrowth, o.years);
    return {
      growth: g,
      value,
      // Ohne Aktienanzahl: der faire Kurs skaliert wie der Wert.
      fair_price: price == null ? null : price * (value / marketCap),
      upside: value / marketCap - 1,
    };
  });

  return {
    rows,
    implied_growth: base.implied_growth,
    observed_growth: base.observed_growth,
    price,
    market_cap: marketCap,
    fcf,
    rate,
    // Beim eingepreisten Wachstum ausgewertet — dort steht die Aussage.
    terminal_share: terminalShare(fcf, base.implied_growth, rate, o.terminalGrowth, o.years),
    assumptions: base.assumptions,
    leverage_warn: base.leverage_warn,
  };
}

/**
 * impliedGrowthForValue(tv, targetValue, opts) → Wachstumsrate | null
 *
 * Macht einen fremden Fair Value mit unserem vergleichbar: welche Rate müsste
 * der FCF haben, damit UNSER Modell auf genau diesen Wert kommt? Damit lassen
 * sich FMPs DCF und die eingepreiste Marktrate auf derselben Skala lesen,
 * statt einen Eurobetrag gegen eine Prozentzahl zu stellen.
 *
 * `targetValue` ist ein Eigenkapitalwert in derselben Währung wie market_cap.
 */
export function impliedGrowthForValue(tv, targetValue, opts = {}) {
  const o = { ...DCF_DEFAULTS, ...opts };
  const fcf = fcfAbsolute(tv);
  if (fcf == null || fcf <= 0) return null;
  if (!Number.isFinite(targetValue) || targetValue <= 0) return null;
  const { rate } = discountRate(tv, o);
  const { growth } = solveImpliedGrowth(fcf, targetValue, rate, o.terminalGrowth, o.years);
  return growth;
}

/* ── Fairer Kurs + Break-even je Stellschraube ───────────────────────────────
   Eine eingepreiste Rate lässt sich schlecht gegen die Wirklichkeit halten,
   ein Kurs schon. `fairValue()` dreht die Aussage deshalb um: ein fairer Kurs
   aus einer benannten Wachstumsannahme — und je Eingang der Wert, den genau
   dieser annehmen müsste, damit der faire Kurs dem Marktkurs entspricht.

   Getrennt ausgewiesen wird, was **nachprüfbar** ist (TV-Felder, exakt so
   benannt wie im Fundamental-Block: „P/FCF", „Beta") und was **Annahme** ist
   (Wachstum, ewiges Wachstum, Diskontsatz-Bausteine). Nur die erste Gruppe
   lässt sich gegen Geschäftsberichte prüfen; die zweite ist Setzung. */

// Über zehn Jahre halten sehr wenige Firmen mehr als 15 % FCF-Wachstum durch.
// Das beobachtete Wachstum wird deshalb gedeckelt statt fortgeschrieben.
const BASE_GROWTH_CAP = 0.15;
const BASE_GROWTH_FALLBACK = 0.08;

/** Barwert je Einheit FCF — PV ist in FCF linear, das macht die Umkehr exakt. */
function pvPerFcf(g, r, gt, years) { return presentValue(1, g, r, gt, years); }

/** Allgemeine Bisektion für monotone Break-even-Suchen. */
function bisect(f, lo, hi, rising, steps = 60) {
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    if (rising ? f(mid) < 0 : f(mid) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * fairValue(tv, opts) →
 *   { fair_price, price, upside, base_growth, base_source, fcf, rate, beta,
 *     drivers: [{ key, label, unit, current, breakeven, verifiable }] }
 * | { error }
 *
 * `breakeven` = Wert, bei dem fair_price === price. null, wenn ausserhalb des
 * sinnvollen Suchbereichs (dann ist dieser Eingang allein nicht der Hebel).
 */
export function fairValue(tv, opts = {}) {
  const o = { ...DCF_DEFAULTS, ...opts };
  const base = reverseDcf(tv, o);
  if (base.error) return base;

  const { fcf, market_cap: mc, rate, beta } = base;
  const price = num(tv?.close_1m) ?? num(tv?.close);
  const gt = o.terminalGrowth;
  const N = o.years;

  // Basisannahme: beobachtetes FCF-Wachstum, gedeckelt — die einzige empirische
  // Grösse, die wir haben. Ohne sie ein neutraler Mittelwert.
  const obs = base.observed_growth;
  const baseGrowth = obs == null ? BASE_GROWTH_FALLBACK
    : Math.min(Math.max(obs, 0), BASE_GROWTH_CAP);
  /* Bausteine statt fertigem Satz: die Lib bleibt locale-frei, die deutsche
     Formulierung samt Zahlenformat entsteht in der UI (fmtNum). */
  const baseSource = obs == null ? 'none' : obs > BASE_GROWTH_CAP ? 'capped'
    : obs < 0 ? 'floored' : 'observed';

  const value = presentValue(fcf, baseGrowth, rate, gt, N);
  const fairPrice = price == null ? null : price * (value / mc);

  /* Break-even je Eingang, alles andere festgehalten. */
  // Wachstum: exakt die eingepreiste Rate.
  const beGrowth = base.implied_growth;

  // Beta: PV fällt mit steigendem Beta (höherer Diskontsatz) ⇒ fallend.
  const pvForBeta = (b) => presentValue(fcf, baseGrowth, o.riskFree + b * o.erp, gt, N) - mc;
  const beBeta = (pvForBeta(0.1) < 0 || pvForBeta(5) > 0)
    ? null : bisect(pvForBeta, 0.1, 5, false);

  // P/FCF: PV ist linear in FCF ⇒ das nötige P/FCF ist genau der Barwert je
  // FCF-Einheit. Keine Suche nötig.
  const bePfcf = pvPerFcf(baseGrowth, rate, gt, N);

  // Ewiges Wachstum: PV steigt mit gt, Definitionsbereich endet unter dem Zins.
  const pvForGt = (x) => presentValue(fcf, baseGrowth, rate, x, N) - mc;
  const beGt = (pvForGt(-0.05) > 0 || pvForGt(rate - 0.001) < 0)
    ? null : bisect(pvForGt, -0.05, rate - 0.001, true);

  return {
    fair_price: fairPrice,
    price,
    upside: fairPrice == null ? null : fairPrice / price - 1,
    base_growth: baseGrowth,
    base_source: baseSource,      // 'none' | 'capped' | 'floored' | 'observed'
    base_observed: obs,
    base_cap: BASE_GROWTH_CAP,
    fcf, market_cap: mc, rate, beta,
    terminal_share: terminalShare(fcf, baseGrowth, rate, gt, N),
    leverage_warn: base.leverage_warn,
    assumptions: base.assumptions,
    drivers: [
      { key: 'growth', label: 'Wachstum', unit: '%', verifiable: false,
        current: baseGrowth, breakeven: beGrowth },
      { key: 'pfcf', label: 'P/FCF', unit: 'x', verifiable: true,
        current: num(tv?.price_free_cash_flow_ttm), breakeven: bePfcf },
      { key: 'beta', label: 'Beta', unit: '', verifiable: true,
        current: num(tv?.beta) ?? num(tv?.beta_3_year), breakeven: beBeta },
      { key: 'terminal', label: 'Ewige Rente', unit: '%', verifiable: false,
        current: gt, breakeven: beGt },
    ],
  };
}

/**
 * Einordnung der eingepreisten Rate. Bewusst grob und ohne Punktzahl: das hier
 * ist kein Score, sondern eine Lesehilfe („was muss passieren, damit der Kurs
 * aufgeht?"). Die Schwellen sind Erfahrungswerte, nicht kalibriert.
 */
export function growthDemandLabel(g) {
  if (g == null) return null;
  if (g <= 0)     return { key: 'shrink',    text: 'Schrumpfung eingepreist' };
  if (g < 0.05)   return { key: 'modest',    text: 'wenig eingepreist' };
  if (g < 0.12)   return { key: 'normal',    text: 'moderat' };
  if (g < 0.20)   return { key: 'demanding', text: 'anspruchsvoll' };
  return            { key: 'heroic',    text: 'sehr anspruchsvoll' };
}
