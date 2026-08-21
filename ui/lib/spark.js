/**
 * Shared intraday sparkline + ATRP visuals.
 *
 * Mirrors the renderers in the Intra-Day modal so the Standard table can show
 * the same day-trajectory sparkline (from the Lang & Schwarz intraday series on
 * `c.ls_quote.series`) and the ATRP volatility bar (`c.tv_data.atrp`). Reuses
 * the existing `.id-spark` / `.id-atrp` / `.id-bar` CSS classes — no new styles.
 */

export const SPARK = { W: 84, H: 24, P: 2 };

export function sparkBounds(series, prevClose) {
  let lo = Math.min(...series), hi = Math.max(...series);
  if (prevClose != null) { lo = Math.min(lo, prevClose); hi = Math.max(hi, prevClose); }
  return { lo, hi, span: (hi - lo) || 1 };
}

// Inline SVG day-trajectory sparkline (green/red by direction, prev-close ref line).
export function sparklineSVG(series, prevClose, chg) {
  const { W, H, P } = SPARK;
  const { lo, span } = sparkBounds(series, prevClose);
  const x = (i) => P + (i / (series.length - 1)) * (W - 2 * P);
  const y = (v) => P + (1 - (v - lo) / span) * (H - 2 * P);
  const pts = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const cls = chg == null ? '' : chg >= 0 ? 'id-spark--pos' : 'id-spark--neg';
  const ref = prevClose != null
    ? `<line x1="${P}" y1="${y(prevClose).toFixed(1)}" x2="${W - P}" y2="${y(prevClose).toFixed(1)}" class="id-spark__ref"/>`
    : '';
  return `<svg class="id-spark ${cls}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`
    + `<rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/>`
    + ref
    + `<polyline points="${pts}" fill="none" class="id-spark__line"/>`
    + `</svg>`;
}

// Standard-table cell: the LS intraday sparkline, or a dash if no series loaded.
export function sparkCellHTML(c, fmtNum) {
  const q = c.ls_quote;
  const s = q?.series;
  if (!Array.isArray(s) || s.length < 2) {
    return '<span class="muted-dash" title="Kein Tagesverlauf – „LS-Kurs“ laden">—</span>';
  }
  const lo = q.day_low, hi = q.day_high;
  const tip = (lo != null && hi != null) ? `Tagesspanne ${fmtNum(lo, 2)}–${fmtNum(hi, 2)}` : 'Tagesverlauf (LS)';
  return `<span class="${q._fetching ? 'is-fetching' : ''}" title="${tip}">${sparklineSVG(s, q.prev_close, q.change_pct)}</span>`;
}

/**
 * 10-Tage-LS-Verlauf aus den Nacht-Snapshots (`ls_history`), plus dem heutigen
 * Live-Kurs als letztem Punkt.
 *
 * Der Live-Kurs ersetzt einen Snapshot desselben Tages, statt ihn zu ergänzen —
 * sonst stünde der heutige Tag doppelt in der Kurve (derselbe Griff wie im
 * 10T-Chart des Detail-Sheets).
 *
 * → { prices, chgPct, from, to, days } | null (weniger als zwei Tage)
 */
export function ls10Series(c) {
  const hist = (Array.isArray(c?.ls_history) ? c.ls_history : [])
    .filter((s) => s?.close != null && s.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const live = c?.ls_quote?.price ?? null;
  const liveDay = live != null ? String(c.ls_quote.checked_at ?? '').slice(0, 10) : null;
  const prices = hist
    .filter((s) => !(liveDay && String(s.date) >= liveDay))
    .map((s) => s.close);
  if (live != null) prices.push(live);

  if (prices.length < 2) return null;
  const from = prices[0];
  const to = prices[prices.length - 1];
  return {
    prices,
    from,
    to,
    days: prices.length,
    chgPct: from ? (to / from - 1) * 100 : null,
  };
}

/**
 * Standard-Tabelle: der 10-Tage-Verlauf als Sparkline. Referenzlinie ist der
 * ERSTE Kurs des Fensters (nicht der Vortagesschluss wie bei der Tages-
 * Sparkline) — die Spalte beantwortet „wo steht der Titel gegenüber vor zehn
 * Tagen", nicht „gegenüber gestern".
 *
 * `conv` bringt die EUR-Preise der Tooltip-Zeile in die Anzeigewährung; die
 * Kurve selbst ist reine Form und braucht keine Umrechnung.
 */
export function ls10CellHTML(c, fmtNum, conv = 1) {
  const s = ls10Series(c);
  if (!s) {
    return '<span class="muted-dash" title="Kein 10-Tage-Verlauf – die LS-Historie entsteht aus den nächtlichen Snapshots der Watchlist">—</span>';
  }
  const tip = `10 Tage LS: ${fmtNum(s.chgPct, 1)}% · ${s.days} Punkte · `
    + `${fmtNum(s.from * conv, 2)} → ${fmtNum(s.to * conv, 2)}`;
  return `<span title="${tip}">${sparklineSVG(s.prices, s.from, s.chgPct)}</span>`;
}

// Standard-table cell: ATRP value + a bar of today's move vs. the typical ATR move.
export function atrpCellHTML(c, fmtNum) {
  const a = c.tv_data?.atrp ?? null;
  const chg = c.ls_quote?.change_pct ?? c.tv_data?.change_1d ?? null;
  if (a == null) return '<span class="muted-dash">—</span>';
  const ratio = (chg != null && a > 0) ? Math.min(Math.abs(chg) / a, 1) : 0;
  const cls = chg == null ? '' : chg >= 0 ? 'id-bar--pos' : 'id-bar--neg';
  return `<div class="id-atrp" title="ATRP ${fmtNum(a, 1)}% – durchschnittliche Tagesspanne · Balken = heutige Bewegung vs. typische ATR-Spanne">
    <div class="id-bar"><div class="id-bar__fill ${cls}" style="width:${(ratio * 100).toFixed(0)}%"></div></div>
    <span class="id-atrp__val">${fmtNum(a, 1)}%</span>
  </div>`;
}
