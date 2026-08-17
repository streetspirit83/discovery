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
