/**
 * ls-trend.js — Trendrate aus der LS-10-Tage-Historie.
 *
 * Lineare Regression durch die Tages-Schlusskurse (gleiches Fenster wie der
 * 10T-Chart): `ratePct` = Steigung in %/Tag relativ zum Mittelkurs. Zusätzlich
 * die Lage des aktuellen Kurses zur (auf heute projizierten) Regressionslinie:
 * `crossedUp` = Kurs liegt über der Linie UND der Vortages-Schluss lag noch
 * darunter — der klassische "Kurs kreuzt die Trendlinie"-Moment.
 */

export function lsTrend(c) {
  const days = (Array.isArray(c?.ls_history) ? c.ls_history : [])
    .filter((s) => s?.close != null && s.date);
  if (days.length < 4) return null;

  const ys = days.map((s) => s.close);
  const n = ys.length;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (ys[i] - my); den += (i - mx) ** 2; }
  const slope = den ? num / den : 0;                    // EUR pro Tag
  const ratePct = my ? (slope / my) * 100 : 0;          // %/Tag
  const lineAt = (i) => my + slope * (i - mx);

  // Aktueller Kurs: Live-LS-Quote wenn vorhanden (projizierte Linie auf "heute"
  // = einen Schritt hinter dem letzten Snapshot), sonst letzter Schluss.
  const live = c.ls_quote?.price ?? null;
  const idxNow = live != null ? n : n - 1;
  const priceNow = live ?? ys[n - 1];
  const pricePrev = live != null ? ys[n - 1] : ys[n - 2];
  const lineNow = lineAt(idxNow);
  const linePrev = lineAt(idxNow - 1);

  // Epsilon-Band (0,15 % des Mittelkurses): Kurse, die auf der Linie kleben
  // (z. B. perfekt linearer Verlauf), zählen weder als Kreuzung ↑ noch ↓.
  const eps = Math.abs(my) * 0.0015;
  const diffNow = priceNow - lineNow;
  const diffPrev = pricePrev != null ? pricePrev - linePrev : null;
  const above = diffNow >= 0;
  const crossedUp = diffNow > eps && diffPrev != null && diffPrev <= eps;
  const crossedDown = diffNow < -eps && diffPrev != null && diffPrev >= -eps;

  return { ratePct: +ratePct.toFixed(2), above, crossedUp, crossedDown, days: n };
}
