/**
 * Auto-Rotation – reine Logik ohne I/O (Entwurf, Stand Testlauf).
 *
 * Auswahl-Score 0–100 je Titel aus absoluten Skalen (nicht aus Perzentilen: die
 * verschieben sich, sobald die Inbox geleert wird):
 *   Bias −100…+100 → 0…100 · Score (Standardtabelle) · Health · Trend-Radar · ROIC −10…+30 % → 0…100
 * Bias und Score müssen vorhanden sein, sonst gibt es keinen Auswahl-Score.
 * Bonus (kein Ausschluss): fairer Kurs ≥ Kurs, Analystenziel ≥ Kurs.
 *
 * Watchlist = geschützte Titel (Stern, Auge, aktiver Alarm; zählen nicht mit)
 *           + höchstens `cap` Titel nach Rang. Puffer gegen tägliches Hin und Her:
 *           ein neuer Titel braucht Rang ≤ `enter`, ein vorhandener bleibt bis Rang ≤ `stay`.
 */
import { metricsOf } from '../../ui/lib/rankings-filter.js';
import { rangeAlarmOn } from '../../ui/lib/range-alarm.js';

export const RULES = {
  cap: 50, enter: 40, stay: 60,
  weights: { bias: 0.35, overall: 0.30, health: 0.15, trend: 0.10, roic: 0.10 },
  bonus: { fair: 4, analyst: 4 },
};

const clamp = (v) => Math.max(0, Math.min(100, v));
const NORM = {
  bias: (v) => clamp((v + 100) / 2),
  overall: clamp, health: clamp, trend: clamp,
  roic: (v) => clamp(((v + 10) / 40) * 100),
};

export function protectionOf(c) {
  const why = [];
  if (c.mk_entry != null || Number(c.mk_shares) > 0) why.push('Stern');
  if (c.watch_flag) why.push('Auge');
  const manual = +c.range_override?.sup > 0 || +c.range_override?.res > 0;
  if ((Array.isArray(c.alerts) && c.alerts.some((a) => a && a.enabled !== false)) || rangeAlarmOn(c) || manual) why.push('Alarm');
  return why;
}

export function rowOf(c, rules = RULES) {
  const m = metricsOf(c);
  const tv = c.tv_data ?? {};
  const pt = Number(tv.pt_average), close = Number(tv.close);
  const analystUp = pt > 0 && close > 0 ? (pt / close - 1) * 100 : null;
  let score = null, parts = {};
  if (m && m.bias != null && m.overall != null) {
    let sum = 0, have = 0;
    for (const [k, w] of Object.entries(rules.weights)) {
      if (m[k] == null) continue;
      parts[k] = Math.round(NORM[k](m[k]));
      sum += parts[k] * w; have += w;
    }
    score = sum / have;
    if (m.fair_upside != null && m.fair_upside >= 0) { score += rules.bonus.fair; parts.fair = `+${rules.bonus.fair}`; }
    if (analystUp != null && analystUp >= 0) { score += rules.bonus.analyst; parts.analyst = `+${rules.bonus.analyst}`; }
    score = Math.round(score * 10) / 10;
  }
  return {
    id: c.id, symbol: c.symbol, exchange: c.exchange ?? '', name: m?.name ?? c.name ?? c.symbol, bucket: c._bucket,
    sector: c.sector ?? null, protect: protectionOf(c), score, parts,
    bias: m?.bias ?? null, overall: m?.overall ?? null, health: m?.health ?? null, trend: m?.trend ?? null,
    roic: m?.roic ?? null, fair_upside: m?.fair_upside ?? null, analyst_upside: analystUp,
    above_sma200: m?.above_sma200 ?? null, cap_usd: m?.cap_usd ?? null, ls_ok: c._ls_ok ?? null, stale: !!c._stale,
  };
}

/** rows → { watch, protectedRows, enter, leave, pulled, kept_no_data, ranked } */
export function select(rows, rules = RULES, gate = () => true) {
  const protectedRows = rows.filter((r) => r.protect.length);
  const free = rows.filter((r) => !r.protect.length);
  const ranked = free.filter((r) => r.score != null && r.ls_ok !== false && gate(r)).sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  ranked.forEach((r, i) => { r.rank = i + 1; });
  let chosen = ranked.filter((r) => (r.bucket === 'watch' ? r.rank <= rules.stay : r.rank <= rules.enter));
  if (chosen.length > rules.cap) chosen = chosen.slice(0, rules.cap);
  for (const r of ranked) { if (chosen.length >= rules.cap) break; if (!chosen.includes(r)) chosen.push(r); }
  chosen.sort((a, b) => a.rank - b.rank);
  const set = new Set(chosen);
  // Vorhandene Watch-Titel ohne Daten bleiben liegen: fehlende Daten sind kein Grund für einen Abstieg.
  const keptNoData = free.filter((r) => r.bucket === 'watch' && r.score == null);
  return {
    ranked, watch: chosen, protectedRows, kept_no_data: keptNoData,
    enter: chosen.filter((r) => r.bucket !== 'watch'),
    leave: free.filter((r) => r.bucket === 'watch' && r.score != null && !set.has(r)),
    pulled: protectedRows.filter((r) => r.bucket !== 'watch'),
  };
}
