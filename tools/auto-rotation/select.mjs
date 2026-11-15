/**
 * Auto-Rotation – reine Logik ohne I/O.
 *
 * Watchlist = geschützte Titel (Stern, Auge, aktiver Alarm; zählen nicht mit)
 *           + 40 Plätze „Momentum“ + 10 Plätze „Qualität im Rücksetzer“.
 *
 * Momentum-Score 0–100 aus absoluten Skalen (keine Perzentile: die verschieben sich,
 * sobald die Inbox geleert wird):
 *   Bias −100…+100 → 0…100 · Score (Standardtabelle) · Health · Trend-Radar · ROIC −10…+30 % → 0…100
 * Bias und Score müssen vorhanden sein, sonst gibt es keinen Score.
 * Bonus (kein Ausschluss): fairer Kurs ≥ Kurs, Analystenziel ≥ 10 % über Kurs.
 * Setup-Bonus: frischer Ausbruch mit intaktem Aufwärtstrend (Kurs > SMA50 > SMA200, 6-Monats-Hoch
 * im letzten Monat erreicht) – 10 Punkte bis 5 % unter dem Monatshoch, 6 Punkte bis 10 %. So fällt ein
 * Titel nach einem Ausbruch nicht wegen eines kleinen Rücksetzers aus der Auswahl.
 *
 * Qualitätsplätze: Titel ausserhalb der Momentum-Auswahl mit schwachem Bias, hohem
 * Health Score und positivem ROIC, geordnet nach Health · ROIC · Score (+ dieselben Boni).
 *
 * Puffer gegen tägliches Hin und Her: ein neuer Titel braucht Rang ≤ `enter`, ein
 * vorhandener Watch-Titel bleibt bis Rang ≤ `stay` – im intakten Ausbruch-Setup bis `staySetup` –
 * und hat Vorrang vor Neuzugängen. Freie Plätze füllt die Rangfolge auf.
 * Bleiben Qualitätsplätze leer, gehen sie an Momentum.
 */
import { metricsOf } from '../../ui/lib/rankings-filter.js';
import { rangeAlarmOn } from '../../ui/lib/range-alarm.js';

export const RULES = {
  version: 3,
  momentum: { cap: 40, enter: 32, stay: 48, staySetup: 120 },
  quality: { cap: 10, enter: 8, stay: 15, maxBias: 25, minHealth: 70 },
  weights: { bias: 0.35, overall: 0.30, health: 0.15, trend: 0.10, roic: 0.10 },
  qualityWeights: { health: 0.5, roic: 0.25, overall: 0.25 },
  bonus: { fair: 4, analyst: 4, analystMinPct: 10 },
  // Ausbruch-Setup: Aufwärtstrend (Kurs > SMA50 > SMA200), 6-Monats-Hoch im letzten Monat,
  // Kurs höchstens `maxPct` darunter. Nur im Momentum-Score.
  setup: { near: 10, mid: 6, nearPct: 5, maxPct: 10 },
};

const clamp = (v) => Math.max(0, Math.min(100, v));
const NORM = {
  bias: (v) => clamp((v + 100) / 2),
  overall: clamp, health: clamp, trend: clamp,
  roic: (v) => clamp(((v + 10) / 40) * 100),
};
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

export function protectionOf(c) {
  const why = [];
  if (c.mk_entry != null || Number(c.mk_shares) > 0) why.push('Stern');
  if (c.watch_flag) why.push('Auge');
  const manual = +c.range_override?.sup > 0 || +c.range_override?.res > 0;
  if ((Array.isArray(c.alerts) && c.alerts.some((a) => a && a.enabled !== false)) || rangeAlarmOn(c) || manual) why.push('Alarm');
  return why;
}

const weighted = (m, weights, need) => {
  if (need.some((k) => m[k] == null)) return null;
  let sum = 0, have = 0;
  for (const [k, w] of Object.entries(weights)) {
    if (m[k] == null) continue;
    sum += NORM[k](m[k]) * w; have += w;
  }
  return have ? sum / have : null;
};

export function rowOf(c, rules = RULES) {
  const m = metricsOf(c);
  const tv = c.tv_data ?? {};
  const pt = Number(tv.pt_average), close = Number(tv.close);
  const analystUp = pt > 0 && close > 0 ? (pt / close - 1) * 100 : null;
  let bonus = 0;
  if (m?.fair_upside != null && m.fair_upside >= 0) bonus += rules.bonus.fair;
  if (analystUp != null && analystUp >= rules.bonus.analystMinPct) bonus += rules.bonus.analyst;
  const base = m ? weighted(m, rules.weights, ['bias', 'overall']) : null;
  const qbase = m ? weighted(m, rules.qualityWeights, ['health', 'roic', 'overall']) : null;
  // Setup „Ausbruch, Trend intakt“ – nur aus Scanner-Feldern, damit es für alle Buckets gilt.
  const hi1 = Number(tv.high_1m), hiLong = Number(tv.high_6m) || Number(tv.high_3m), s50 = Number(tv.sma50), s200 = Number(tv.sma200);
  const offHigh = hi1 > 0 && close > 0 ? (1 - close / hi1) * 100 : null;          // % unter dem Monatshoch
  const freshHigh = hi1 > 0 && hiLong > 0 ? hi1 >= hiLong * 0.995 : null;          // 6-Monats-Hoch im letzten Monat erreicht
  const uptrend = close > 0 && s50 > 0 && s200 > 0 ? close > s50 && s50 > s200 : null;
  const inSetup = !!(uptrend && freshHigh && offHigh != null && offHigh <= rules.setup.maxPct);
  const setupBonus = !inSetup ? 0 : offHigh <= rules.setup.nearPct ? rules.setup.near : rules.setup.mid;
  return {
    setup: inSetup, off_high: r1(offHigh), fresh_high: freshHigh, uptrend, perf_1m: r1(m?.perf_1m), perf_3m: r1(m?.perf_3m),
    id: c.id, symbol: c.symbol, exchange: c.exchange ?? '', name: m?.name ?? c.name ?? c.symbol, bucket: c._bucket,
    sector: c.sector ?? null, protect: protectionOf(c),
    score: base == null ? null : r1(base + bonus + setupBonus),
    qscore: qbase == null ? null : r1(qbase + bonus),
    bias: m?.bias ?? null, overall: m?.overall ?? null, health: m?.health ?? null, trend: m?.trend ?? null,
    roic: r1(m?.roic), fair_upside: r1(m?.fair_upside), analyst_upside: r1(analystUp),
    ls_ok: c._ls_ok ?? null, stale: !!c._stale,
  };
}

/* Rangfolge mit Puffer und Bestandsvorrang: zuerst vorhandene Watch-Titel bis Rang `stay`
   (im intakten Ausbruch-Setup bis `staySetup`), dann neue bis Rang `enter`, dann auffüllen bis `cap`.
   Ein Watch-Titel im Setup verliert seinen Platz also nicht an einen Neuzugang. */
function pickWithBuffer(ranked, { cap, enter, stay, staySetup }, rankKey) {
  ranked.forEach((r, i) => { r[rankKey] = i + 1; });
  const limit = (r) => (r.setup && staySetup ? staySetup : stay);
  const chosen = ranked.filter((r) => r.bucket === 'watch' && r[rankKey] <= limit(r)).slice(0, cap);
  for (const r of ranked) { if (chosen.length >= cap) break; if (r.bucket !== 'watch' && r[rankKey] <= enter) chosen.push(r); }
  for (const r of ranked) { if (chosen.length >= cap) break; if (!chosen.includes(r)) chosen.push(r); }
  return chosen.sort((a, b) => a[rankKey] - b[rankKey]);
}

/** rows (aus rowOf) → Auswahl und Bewegungen. Verändert die Zeilen (rank, qrank, slot). */
export function select(rows, rules = RULES) {
  const protectedRows = rows.filter((r) => r.protect.length);
  const free = rows.filter((r) => !r.protect.length);
  const ok = (r) => r.ls_ok !== false;
  const bySym = (a, b) => a.symbol.localeCompare(b.symbol);

  const mRanked = free.filter((r) => r.score != null && ok(r)).sort((a, b) => b.score - a.score || bySym(a, b));
  const qOf = (taken) => free.filter((r) => !taken.has(r) && r.qscore != null && ok(r) && r.bias != null && r.bias < rules.quality.maxBias
    && r.health >= rules.quality.minHealth && r.roic > 0).sort((a, b) => b.qscore - a.qscore || bySym(a, b));

  let momentum = pickWithBuffer(mRanked, rules.momentum, 'rank');
  let quality = pickWithBuffer(qOf(new Set(momentum)), rules.quality, 'qrank');
  const spare = rules.quality.cap - quality.length;
  if (spare > 0) {   // leere Qualitätsplätze gehen an Momentum
    momentum = pickWithBuffer(mRanked.filter((r) => !quality.includes(r)), { ...rules.momentum, cap: rules.momentum.cap + spare }, 'rank');
  }
  momentum.forEach((r) => { r.slot = 'momentum'; });
  quality.forEach((r) => { r.slot = 'quality'; });
  const chosen = [...momentum, ...quality];
  const set = new Set(chosen);

  // Vorhandene Watch-Titel ohne Daten bleiben liegen: fehlende Daten sind kein Grund für einen Abstieg.
  const keptNoData = free.filter((r) => r.bucket === 'watch' && (r.score == null || r.stale) && !set.has(r));
  const keptSet = new Set(keptNoData);
  return {
    ranked: mRanked, momentum, quality, watch: chosen, protectedRows, kept_no_data: keptNoData,
    enter: chosen.filter((r) => r.bucket !== 'watch'),
    leave: free.filter((r) => r.bucket === 'watch' && !set.has(r) && !keptSet.has(r)),
    pulled: protectedRows.filter((r) => r.bucket !== 'watch'),
  };
}

const BUCKET = { watch: 'Watchlist', archive: 'Archiv', inbox: 'Inbox' };
const num = (v, unit = '') => (v == null ? '–' : `${Math.round(v)}${unit}`);

/** Kurzbegründung für den Bericht – ein Satz, aus den Zahlen des Titels. */
export function whyEnter(r) {
  return r.slot === 'quality'
    ? `Qualitätsplatz ${r.qrank}: Health ${num(r.health)}, ROIC ${num(r.roic, ' %')}, Bias ${num(r.bias)} (Rücksetzer)`
    : `Momentum-Rang ${r.rank}: Bias ${num(r.bias)}, Score ${num(r.overall)}, Health ${num(r.health)}${r.setup ? ` · Ausbruch-Setup, ${String(r.off_high).replace('.', ',')} % unter Monatshoch` : ''}`;
}
export function whyLeave(r, rules = RULES) {
  if (r.ls_ok === false) return 'Kein Kurs bei Lang & Schwarz abrufbar';
  if (r.rank == null) return 'Kein Auswahl-Score (Bias oder Score fehlt)';
  const weak = r.bias != null && r.bias < 0 ? `Bias ${num(r.bias)}` : `Score ${num(r.overall)}`;
  return `Momentum-Rang ${r.rank}, bleiben würde er bis Rang ${rules.momentum.stay} (im Ausbruch-Setup bis ${rules.momentum.staySetup}) · ${weak}`;
}
export const bucketName = (b) => BUCKET[b] ?? b;
