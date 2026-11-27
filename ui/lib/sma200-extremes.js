/**
 * SMA200-Extreme – die Titel, deren Kurs am weitesten über bzw. unter der
 * 200-Tage-Linie steht. Rein, ohne DOM: genutzt vom Monitor-Modal der App
 * (dashboard-modal.js) und vom Monitor-Bericht (tools/monitor-report/report.mjs),
 * damit beide dieselben Titel zeigen.
 *
 * Basis ist der TV-Schlusskurs gegen die TV-SMA200 (beides Notierungswährung),
 * also währungsfrei. Die Tabellenspalte „%S200" rechnet dagegen mit dem
 * LS-Kurs und kann intraday leicht abweichen.
 */

/** Abstand Kurs ↔ SMA200 in % (positiv = darüber), null ohne Daten. */
export function sma200DistPct(tv) {
  return tv?.close > 0 && tv?.sma200 > 0 ? (tv.close / tv.sma200 - 1) * 100 : null;
}

/** → { above:[{c, symbol, exchange, dist}], below:[…] }, je absteigend nach |dist|, höchstens n. */
export function sma200Extremes(candidates, n = 10) {
  const rows = [];
  for (const c of candidates ?? []) {
    const dist = sma200DistPct(c?.tv_data);
    if (dist != null) rows.push({ c, symbol: c.symbol, exchange: c.exchange ?? '', dist });
  }
  return {
    above: rows.filter((r) => r.dist > 0).sort((a, b) => b.dist - a.dist).slice(0, n),
    below: rows.filter((r) => r.dist < 0).sort((a, b) => a.dist - b.dist).slice(0, n),
  };
}
