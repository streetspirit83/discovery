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
