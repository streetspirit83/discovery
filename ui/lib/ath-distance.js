/**
 * Abstand zum Allzeithoch in % (seit 27.11.2026): TV-Schluss gegen `tv_data.high_all`, beides in der Währung
 * des Instruments, also ohne Umrechnung. 0 % = am Hoch, −30 % = 30 % darunter. Über 0 (Schluss über dem
 * gespeicherten Hoch, neues ATH im Tagesverlauf) wird auf 0 gekappt.
 */
export function athDistPct(c) {
  const tv = c?.tv_data;
  const close = Number(tv?.close), ath = Number(tv?.high_all);
  if (!(close > 0) || !(ath > 0)) return null;
  return Math.min(0, (close / ath - 1) * 100);
}
