/**
 * Filter für die Wochen-Rankings und die Bucket-Rotation – reine Logik ohne I/O.
 *
 *   buildRankings(cands, { tradingDay }) → Objekt für „Discovery Rankings.json“
 *
 * Trennung (bindend): Rankings zeigen NUR den Watch-Bucket. Die Rotation prüft
 * getrennt `promote` (nur Archiv: was gehört in die Watchlist?) und `demote`
 * (nur Watchlist ohne Augen- und Depot-Titel: was kann ins Archiv?). Das Archiv
 * taucht in den Rankings nie auf, Augen- und Depot-Titel nie als Abgabe-Vorschlag.
 *
 * Verfahren je Liste: erst Ausschlussfilter (`gate`), dann Score 0–100 aus
 * Perzentilen (`score`), danach die besten CONFIG.candidates Titel, höchstens
 * CONFIG.sectorCap je Sektor. So entsteht ohne Nachjustieren immer eine feste
 * Listengrösse. Die Perzentile laufen über Watch + Archiv, damit Scores beider
 * Buckets vergleichbar sind; die Auswahl bleibt strikt nach Bucket getrennt.
 *
 * Die KI bewertet diese Listen später (Recherche und Einschätzung gehören nicht
 * hierher); die Auswahl steht mit dem Filter fest.
 *
 * Seit Nov. 2026 liegt die Logik hier in ui/lib, damit die App dieselben Listen
 * werktags live und ohne KI rechnen kann (`liveRankings`, Monitor-Reiter
 * „Rankings"). tools/monitor-report/rankings.mjs reicht sie nur weiter.
 * Das gerichtete Bias (−100…+100, tv-sentiment.js) fliesst als Kennzahl `bias`
 * in Filter und Gewichte ein.
 */

import { liveHealthScore, liveOverallScore } from './dashboard-metrics.js?v=20261103h';
import { computePriceClusters } from './price-cluster.js?v=20260807a';
import { trendScore } from './trend-radar.js?v=20261103h';
import { fairValue } from './tv-reverse-dcf.js?v=20260814o';
import { computeBias } from './tv-sentiment.js?v=20260807a';

export const CONFIG = {
  candidates: 12,            // je Ranking
  sectorCap: 5,              // höchstens so viele Titel je Sektor
  rotationCandidates: 12,    // je Richtung
  minCoverage: 0.6,          // Mindestanteil vorhandener Score-Gewichte
  capMomentum: 0.3e9,
  capBreakout: 0.3e9,
  capGrowth: 1e9,
  capPullback: 1e9,
  capSolid: 5e9,
  minHealthSolid: 60,        // Health Score ausserhalb von Finance
  maxBetaSolid: 1.5,
  maxFairUpside: 200,        // darüber ist der Reverse-DCF nicht belastbar (zyklischer oder gehebelter FCF)
  demoteMaxStrength: 60,     // stärkster Listen-Score, unter dem ein Watch-Titel als Abgabe-Kandidat gilt
  pickCandidates: 15,        // Tagessieger: Vorauswahl für die KI (sie wählt 5)
  pickSectorCap: 4,
  capPick: 1e9,
};

/* Tagessieger (werktags, nur Watchlist): kurzfristige Signallage für die nächsten
   Handelstage. Gewicht > 0: grösser ist besser, < 0: kleiner ist besser. Die
   Gewichte lernen über den Treffer-Check nach (lib/daily-picks.js, Stand im
   market-Blob `picks_method`); dies hier ist nur der Startwert. */
export const PICK_WEIGHTS = {
  bias: 0.2, trend: 0.15, perf_1m: 0.15, perf_1w: 0.1, trend_strength: 0.1,
  high_near: 0.1, res_dist: -0.1, vol_ratio: 0.1,
};

/* Börsenwert kommt in Notierungswährung. Grobe Kurse genügen: sie entscheiden
   nur über Mindestgrössen, nicht über den Score. */
const USD_PER = {
  USD: 1, EUR: 1.1, GBP: 1.3, GBX: 0.013, CHF: 1.2, SEK: 0.1, NOK: 0.1, DKK: 0.15,
  CAD: 0.72, AUD: 0.65, JPY: 0.0067, KRW: 0.00072, HKD: 0.13, TWD: 0.032, CNY: 0.14, SGD: 0.75, INR: 0.012,
};

const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
const round = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const isFinance = (m) => m.sector === 'Finance';
const nameOf = (c) => c.name ?? c.company_name ?? c.tv_data?.description ?? c.symbol;
const keyOf = (c) => `${c.symbol}:${c.exchange ?? ''}`;

/* Alle Kennzahlen eines Titels, einheitlich benannt. Fehlt etwas, bleibt es null. */
export function metricsOf(c) {
  const t = c.tv_data;
  if (!t) return null;
  const p = num(t.close);
  const rate = USD_PER[String(c.currency ?? 'USD').toUpperCase()];
  const capRaw = num(t.market_cap);
  const dist = (lvl) => (lvl > 0 && p > 0 ? (lvl / p - 1) * 100 : null);
  let pc = null;
  try { pc = p > 0 ? computePriceClusters(t, { lsHistory: c.ls_history ?? null, refPrice: t.close_1m ?? p }) : null; }
  catch { pc = null; }
  const fair = t.market_cap != null ? fairValue(t) : null;
  const fairRaw = fair && !fair.error && fair.price > 0 ? (fair.fair_price / fair.price - 1) * 100 : null;
  const fairUp = fairRaw != null && fairRaw <= CONFIG.maxFairUpside ? fairRaw : null;
  const hi1 = num(t.high_1m), lo1 = num(t.low_1m);
  const v10 = num(t.avg_vol_10d), v30 = num(t.average_volume_30d_calc);
  const debt = num(t.total_debt_to_ebitda_fy);
  const fcfM = num(t.free_cash_flow_margin_ttm) ?? num(t.free_cash_flow_margin_fy);
  let bias = null;
  try { bias = computeBias(t)?.score ?? null; } catch { bias = null; }
  return {
    symbol: c.symbol, exchange: c.exchange ?? null, isin: c.isin ?? null, name: nameOf(c), sector: c.sector ?? null,
    sub_sector: c.sub_sector ?? null, bucket: c._bucket, eye: c._bucket === 'watch' && !!c.watch_flag,
    held: Number(c.mk_shares) > 0,
    currency: c.currency ?? null, close: p,
    cap_usd: capRaw != null ? capRaw * (rate ?? 1) : null, cap_rate_known: rate != null,
    perf_1w: num(t.perf_w), perf_1m: num(t.perf_1m), perf_3m: num(t.perf_3m), perf_6m: num(t.perf_6m),
    rsi: num(t.rsi),
    above_sma50: p != null && t.sma50 != null ? p > t.sma50 : null,
    above_sma200: p != null && t.sma200 != null ? p > t.sma200 : null,
    overall: liveOverallScore(t)?.total ?? null,
    health: liveHealthScore(t)?.total ?? null,
    trend: trendScore(c)?.score ?? null,
    trend_strength: num(t.trend_strength_score?.total),
    bias: bias != null ? Math.round(bias) : null,
    high_dist: dist(t.price_52_week_high),
    range_1m: hi1 > 0 && lo1 > 0 ? (hi1 / lo1 - 1) * 100 : null,
    off_low_1m: lo1 > 0 && p > 0 ? (p / lo1 - 1) * 100 : null,
    vol_ratio: v10 > 0 && v30 > 0 ? v10 / v30 : null,
    res: pc?.nearestRes?.mid ?? null, res_dist: dist(pc?.nearestRes?.mid),
    sup: pc?.nearestSup?.mid ?? null, sup_dist: dist(pc?.nearestSup?.mid),
    fair_upside: fairUp,
    rev_growth: num(t.total_revenue_yoy_growth_ttm) ?? num(t.total_revenue_yoy_growth_fy),
    ebitda_growth: num(t.ebitda_yoy_growth_ttm) ?? num(t.ebitda_yoy_growth_fy),
    fcf_growth: num(t.free_cash_flow_yoy_growth_ttm) ?? num(t.free_cash_flow_yoy_growth_fy),
    eps_growth: num(t.earnings_per_share_diluted_yoy_growth_ttm) ?? num(t.earnings_per_share_diluted_yoy_growth_fy),
    gross_margin: num(t.gross_margin), op_margin: num(t.operating_margin), fcf_margin: fcfM,
    roe: num(t.return_on_equity), roic: num(t.return_on_invested_capital),
    debt_ebitda: debt, volatility: num(t.volatility_m) ?? num(t.volatility), beta: num(t.beta) ?? num(t.beta_3_year),
    dividend_yield: num(t.dividend_yield), pe: num(t.pe_ttm),
    earnings_next: Number(t.earnings_next_date) > 0 ? new Date(Number(t.earnings_next_date) * 1000).toISOString().slice(0, 10) : null,
    stale: !!c._stale,
  };
}

/* Perzentil 0…1 je Kennzahl über alle Titel. Gleiche Werte bekommen denselben Rang. */
function percentiles(rows, key) {
  const vals = rows.map((r) => r[key]).filter((v) => v != null).sort((a, b) => a - b);
  const n = vals.length;
  return (v) => {
    if (v == null || n < 2) return null;
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] < v) lo = m + 1; else hi = m; }
    return lo / (n - 1);
  };
}

/* Gewichte: [Kennzahl, Gewicht]; negatives Gewicht = kleiner ist besser. */
const scoreBy = (pct, m, weights) => {
  let sum = 0, have = 0, all = 0;
  for (const [key, w] of weights) {
    const g = Math.abs(w);
    all += g;
    const p = pct[key](m[key]);
    if (p == null) continue;
    sum += (w > 0 ? p : 1 - p) * g;
    have += g;
  }
  return have / all >= CONFIG.minCoverage ? Math.round((sum / have) * 1000) / 10 : null;
};

const liquid = (m) => !m.stale && m.close != null;

/* Definition der fünf Listen. `gate` schliesst aus, `weights` ordnet. */
const solidWeights = [['health', 0.3], ['fcf_margin', 0.2], ['roic', 0.15], ['volatility', -0.15], ['fair_upside', 0.1], ['bias', 0.1]];
const solidFinanceWeights = [['roe', 0.45], ['volatility', -0.25], ['beta', -0.15], ['bias', 0.15]];

export const LISTS = {
  momentum: {
    label: 'Technisches Momentum', question: 'Wer läuft gerade am stärksten?',
    gate: (m) => m.above_sma50 === true && m.above_sma200 === true && m.perf_3m > 0 && m.rsi != null && m.rsi < 80 && m.cap_usd >= CONFIG.capMomentum
      && (m.bias == null || m.bias > 0),
    weights: () => [['perf_3m', 0.2], ['perf_6m', 0.15], ['perf_1m', 0.15], ['trend', 0.15], ['trend_strength', 0.1], ['high_dist', 0.1], ['bias', 0.15]],
    ai: 'Trägt die Bewegung (Nachrichten, Zahlen)? Überhitzt? Zahlen-Risiko in den nächsten zwei Wochen?',
  },
  solid: {
    label: 'Solide Anlage', question: 'Was ist die robusteste Anlage?',
    gate: (m) => m.cap_usd >= CONFIG.capSolid && (isFinance(m)
      ? m.roe >= 8
      : m.fcf_margin > 0 && m.op_margin > 0 && m.health >= CONFIG.minHealthSolid
        && (m.debt_ebitda == null || m.debt_ebitda <= 4) && (m.beta == null || m.beta <= CONFIG.maxBetaSolid)),
    weights: (m) => (isFinance(m) ? solidFinanceWeights : solidWeights),
    ai: 'Bilanzrisiken, Rechtsstreit, Guidance, Burggraben, Bewertung gegenüber der Historie.',
  },
  growth: {
    label: 'Wachstum', question: 'Wer wächst operativ am stärksten?',
    gate: (m) => m.cap_usd >= CONFIG.capGrowth && m.rev_growth >= 10,
    weights: () => [['rev_growth', 0.35], ['ebitda_growth', 0.2], ['fcf_growth', 0.15], ['eps_growth', 0.1], ['gross_margin', 0.1], ['bias', 0.1]],
    ai: 'Organisch oder zugekauft? Verwässerung? Trägt die Guidance? Was ist eingepreist?',
  },
  pullback: {
    label: 'Rücksetzer', question: 'Welche guten Firmen sind zuletzt gefallen?',
    gate: (m) => m.cap_usd >= CONFIG.capPullback && m.high_dist >= 15 && m.rsi != null && m.rsi < 50
      && (isFinance(m) ? m.roe >= 10 : m.health != null && m.health >= 55)
      && (m.bias == null || m.bias > -60),        // kein freier Fall: stark negatives Bias fällt raus
    weights: (m) => (isFinance(m)
      ? [['roe', 0.5], ['rsi', -0.25], ['high_dist', 0.25]]
      : [['health', 0.3], ['fair_upside', 0.3], ['rsi', -0.15], ['high_dist', 0.15], ['off_low_1m', 0.1]]),
    ai: 'Ist der Grund vorübergehend, oder bricht die These gerade? Gibt es Anzeichen einer Stabilisierung?',
  },
  breakout: {
    label: 'Ausbruch', question: 'Wer steht kurz vor dem nächsten Schritt?',
    gate: (m) => m.cap_usd >= CONFIG.capBreakout && m.above_sma50 === true && m.rsi >= 45 && m.rsi < 75
      && m.res_dist != null && m.res_dist >= 0 && m.res_dist <= 6 && (m.bias == null || m.bias > 0),
    weights: () => [['res_dist', -0.3], ['range_1m', -0.2], ['vol_ratio', 0.2], ['trend_strength', 0.15], ['bias', 0.15]],
    ai: 'Gibt es einen Auslöser? Stehen Zahlen an? Ist der Widerstand schon mehrfach gescheitert?',
  },
};

/* Nur die Felder, die Prüfung und KI brauchen – in Prozent und Mrd. USD gerundet. */
function row(m, score, extra = {}) {
  const pct = (k) => round(m[k], 1);
  return {
    symbol: m.symbol, exchange: m.exchange, name: m.name, sector: m.sector, sub_sector: m.sub_sector,
    bucket: m.bucket, ...(m.eye ? { eye: true } : {}), score, close: round(m.close, 2), currency: m.currency,
    cap_usd_bn: m.cap_usd != null ? round(m.cap_usd / 1e9, 1) : null,
    perf_1w: pct('perf_1w'), perf_1m: pct('perf_1m'), perf_3m: pct('perf_3m'), perf_6m: pct('perf_6m'),
    rsi: pct('rsi'), above_sma50: m.above_sma50, above_sma200: m.above_sma200,
    overall: m.overall, health: m.health, trend: m.trend, trend_strength: m.trend_strength, bias: m.bias,
    high_dist_pct: pct('high_dist'), res_dist_pct: pct('res_dist'), sup_dist_pct: pct('sup_dist'),
    range_1m_pct: pct('range_1m'), vol_ratio: round(m.vol_ratio, 2), fair_upside_pct: pct('fair_upside'),
    rev_growth: pct('rev_growth'), ebitda_growth: pct('ebitda_growth'), fcf_growth: pct('fcf_growth'), eps_growth: pct('eps_growth'),
    gross_margin: pct('gross_margin'), op_margin: pct('op_margin'), fcf_margin: pct('fcf_margin'),
    roe: pct('roe'), roic: pct('roic'), debt_ebitda: round(m.debt_ebitda, 1), volatility: pct('volatility'), beta: round(m.beta, 2),
    dividend_yield: round(m.dividend_yield, 2), pe: round(m.pe, 1), earnings_next: m.earnings_next,
    ...extra,
  };
}

/* Beste Titel nach Score, höchstens `cap` je Sektor; je Firma (ISIN) nur ein Listing. */
function pick(scored, n, cap) {
  const bySector = new Map(), firms = new Set(), out = [];
  for (const x of [...scored].sort((a, b) => b.score - a.score || a.m.symbol.localeCompare(b.m.symbol))) {
    const s = x.m.sector ?? '–';
    if ((bySector.get(s) ?? 0) >= cap || (x.m.isin && firms.has(x.m.isin))) continue;
    if (x.m.isin) firms.add(x.m.isin);
    bySector.set(s, (bySector.get(s) ?? 0) + 1);
    out.push(x);
    if (out.length === n) break;
  }
  return out;
}

const SCORE_KEYS = ['perf_1w', 'perf_1m', 'perf_3m', 'perf_6m', 'trend', 'trend_strength', 'high_dist', 'health', 'fcf_margin', 'roic',
  'volatility', 'fair_upside', 'roe', 'beta', 'rev_growth', 'ebitda_growth', 'fcf_growth', 'eps_growth', 'gross_margin',
  'rsi', 'off_low_1m', 'res_dist', 'range_1m', 'vol_ratio', 'overall', 'bias'];

/* Perzentil-Tabellen über das ganze Universum plus Hilfsfunktionen zum Bewerten. */
function scorer(all) {
  const pct = Object.fromEntries(SCORE_KEYS.map((k) => [k, percentiles(all, k)]));
  // Nähe zum Hoch: kleiner Abstand ist gut – fürs Momentum wird das Perzentil gedreht.
  const hd = pct.high_dist;
  const momPct = { ...pct, high_dist: (v) => { const p = hd(v); return p == null ? null : 1 - p; } };
  pct.high_near = (v) => { const p = hd(v); return p == null ? null : 1 - p; };
  const scoreList = (def, m, table = pct) => scoreBy(table, m, def.weights(m));
  const tableOf = (key) => (key === 'momentum' ? momPct : pct);
  const passes = (key, m) => liquid(m) && !!LISTS[key].gate(m);
  return { pct, scoreList, tableOf, passes };
}

/* Tagessieger-Vorauswahl: Aufwärtstrend intakt, nicht überhitzt, kein negatives Bias.
   `factors` = Perzentil je Faktor in Wirkrichtung (0…1) – daraus lernt der Treffer-Check. */
const pickGate = (m) => liquid(m) && m.bucket === 'watch' && m.cap_usd >= CONFIG.capPick && m.above_sma50 === true
  && m.rsi != null && m.rsi >= 40 && m.rsi < 78 && (m.bias == null || m.bias > -20);

export function dailyPickPool(all, pct, weights = PICK_WEIGHTS) {
  const entries = Object.entries(weights).filter(([k, w]) => w && pct[k]);
  const src = (m, k) => (k === 'high_near' ? m.high_dist : m[k]);
  const hits = all.filter(pickGate).map((m) => {
    const factors = {};
    for (const [k, w] of entries) {
      const p = pct[k](src(m, k));
      if (p != null) factors[k] = round(w > 0 ? p : 1 - p, 3);
    }
    const all_ = entries.reduce((a, [, w]) => a + Math.abs(w), 0);
    const have = entries.filter(([k]) => factors[k] != null);
    const g = have.reduce((a, [, w]) => a + Math.abs(w), 0);
    const score = g / all_ >= CONFIG.minCoverage ? round((have.reduce((a, [k, w]) => a + factors[k] * Math.abs(w), 0) / g) * 100, 1) : null;
    return score == null ? null : { m, score, factors };
  }).filter(Boolean);
  return { passed: hits.length, chosen: pick(hits, CONFIG.pickCandidates, CONFIG.pickSectorCap) };
}

/**
 * Live-Rankings für die App (Monitor-Reiter „Rankings", ohne KI): dieselben fünf
 * Listen wie der Wochenlauf, gerechnet aus den gerade geladenen Kandidaten.
 * Perzentile über alle übergebenen Titel; gelistet wird bei `bucket === 'all'`
 * nur die Watchlist (wie im Wochenlauf), in jedem anderen Bucket der Bucket selbst.
 *
 * @returns {{ pool:number, lists:Array<{key,label,question,passed,items:Array<{rank,c,m,score}>}>}}
 */
export function liveRankings(cands, { bucket = 'watch', n = CONFIG.candidates } = {}) {
  const all = [];
  for (const c of cands ?? []) {
    const m = metricsOf({ ...c, _bucket: c._bucket ?? bucket, watch_flag: c.watch_flag });
    if (m) { m.c = c; all.push(m); }
  }
  const { scoreList, tableOf, passes } = scorer(all);
  const pool = bucket === 'all' ? all.filter((m) => m.bucket === 'watch') : all;
  const lists = Object.entries(LISTS).map(([key, def]) => {
    const hits = pool.filter((m) => passes(key, m))
      .map((m) => ({ m, score: scoreList(def, m, tableOf(key)) }))
      .filter((x) => x.score != null);
    const chosen = pick(hits, n, CONFIG.sectorCap);
    return { key, label: def.label, question: def.question, passed: hits.length,
      items: chosen.map((x, i) => ({ rank: i + 1, c: x.m.c, m: x.m, score: x.score })) };
  });
  // Mehrfachnennungen: in welchen anderen Listen steht ein Titel noch?
  const seen = new Map();
  for (const l of lists) for (const it of l.items) seen.set(it.c, [...(seen.get(it.c) ?? []), l.key]);
  for (const l of lists) for (const it of l.items) it.lists = seen.get(it.c);
  return { pool: pool.length, lists };
}

export function buildRankings(cands, { tradingDay = null, stale = [], depotChecked = true, pickWeights = PICK_WEIGHTS, pickMethodVersion = 0 } = {}) {
  const staleKeys = new Set(stale.map(keyOf));
  const all = cands
    .map((c) => metricsOf({ ...c, _stale: staleKeys.has(keyOf(c)) }))
    .filter(Boolean);

  const { pct, scoreList, tableOf, passes } = scorer(all);

  const watch = all.filter((m) => m.bucket === 'watch');
  const archive = all.filter((m) => m.bucket === 'archive');

  const ranked = (pool, key) => pool
    .filter((m) => passes(key, m))
    .map((m) => ({ m, score: scoreList(LISTS[key], m, tableOf(key)) }))
    .filter((x) => x.score != null);

  /* Rankings: nur Watch */
  const rankings = {};
  for (const [key, def] of Object.entries(LISTS)) {
    const hits = ranked(watch, key);
    const chosen = pick(hits, CONFIG.candidates, CONFIG.sectorCap);
    rankings[key] = {
      label: def.label, question: def.question, ai_task: def.ai,
      funnel: { universe: watch.length, passed_gate: hits.length, candidates: chosen.length },
      candidates: chosen.map((x, i) => ({ pos: i + 1, ...row(x.m, x.score) })),
    };
  }
  const seen = new Map();
  for (const [key, r] of Object.entries(rankings)) for (const c of r.candidates) {
    const k = keyOf(c);
    seen.set(k, [...(seen.get(k) ?? []), key]);
  }
  for (const r of Object.values(rankings)) for (const c of r.candidates) c.lists = seen.get(keyOf(c));

  /* Stärkste Listen eines Titels, beste zuerst. */
  const listsOf = (m) => Object.keys(LISTS)
    .filter((k) => passes(k, m))
    .map((k) => ({ key: k, score: scoreList(LISTS[k], m, tableOf(k)) }))
    .filter((x) => x.score != null)
    .sort((a, b) => b.score - a.score);

  /* Rotation aufwärts: Archiv → Watchlist. Mindestens zwei bestandene Listen; Massstab = Mittel der beiden besten. */
  const promoteHits = archive.filter(liquid).map((m) => {
    const lists = listsOf(m);
    return lists.length >= 2 ? { m, score: round((lists[0].score + lists[1].score) / 2, 1), lists } : null;
  }).filter(Boolean);
  const promote = pick(promoteHits, CONFIG.rotationCandidates, CONFIG.sectorCap);

  /* Rotation abwärts: Watchlist → Archiv. Nie Augen-Titel oder Depot-Titel (mk_shares). Kandidat, wenn keine
     Liste stark ist; Reihenfolge nach Schwäche. */
  const movable = depotChecked ? watch.filter((m) => liquid(m) && !m.eye && !m.held) : [];
  const demoteWeights = [['overall', -0.3], ['perf_6m', -0.2], ['perf_3m', -0.2], ['health', -0.2], ['trend', -0.1]];
  const demoteHits = movable.map((m) => {
    const lists = listsOf(m);
    const strength = lists[0]?.score ?? 0;
    return strength < CONFIG.demoteMaxStrength ? { m, score: scoreBy(pct, m, demoteWeights), strength, lists } : null;
  }).filter((x) => x && x.score != null);
  const demote = [...demoteHits].sort((a, b) => b.score - a.score || a.m.symbol.localeCompare(b.m.symbol)).slice(0, CONFIG.rotationCandidates);

  /* Tagessieger: nur Watch, Vorauswahl für die KI (sie wählt 5 aus diesen). */
  const dp = dailyPickPool(watch, pct, pickWeights);

  const missingRate = [...new Set(all.filter((m) => !m.cap_rate_known).map((m) => m.currency))];

  return {
    schema: 'discovery-rankings-1.0',
    trading_day: tradingDay,
    note: 'Rankings zeigen nur den Watch-Bucket. Rotation: promote nur aus dem Archiv, demote nur aus der Watchlist ohne Augen- und Depot-Titel. Score = Filter-Score 0–100, keine Empfehlung.',
    universe: { watch: watch.length, archive: archive.length, eye: watch.filter((m) => m.eye).length, stale: stale.length },
    config: CONFIG,
    data_notes: [
      ...(missingRate.length ? [`Währung ohne Umrechnungskurs (als USD behandelt): ${missingRate.join(', ')}`] : []),
      ...(depotChecked ? [] : ['Merkliste nicht lesbar: keine Abgabe-Vorschläge, damit keine Depot-Titel vorgeschlagen werden.']),
    ],
    rankings,
    rotation: {
      promote: {
        label: 'Archiv → Watchlist', funnel: { universe: archive.length, passed_gate: promoteHits.length, candidates: promote.length },
        candidates: promote.map((x, i) => ({ pos: i + 1, ...row(x.m, x.score, { lists: x.lists.map((l) => l.key), best_list: x.lists[0].key }) })),
      },
      demote: {
        label: 'Watchlist → Archiv', funnel: { universe: movable.length, passed_gate: demoteHits.length, candidates: demote.length },
        candidates: demote.map((x, i) => ({ pos: i + 1, ...row(x.m, x.score, { best_strength: x.strength, lists: x.lists.map((l) => l.key) }) })),
      },
    },
    daily_picks: {
      label: 'Tagessieger', question: 'Welche 5 Watchlist-Titel haben für die nächsten Handelstage die beste Signallage?',
      method_version: pickMethodVersion, weights: pickWeights,
      funnel: { universe: watch.length, passed_gate: dp.passed, candidates: dp.chosen.length },
      candidates: dp.chosen.map((x, i) => ({ pos: i + 1, ...row(x.m, x.score, { perf_1w: round(x.m.perf_1w, 1) }) })),
      // 1:1 als `pool` in den Tagessieger-Eintrag übernehmen – daraus rechnet der Treffer-Check.
      pool: dp.chosen.map((x) => ({ symbol: x.m.symbol, exchange: x.m.exchange, close: round(x.m.close, 4), score: x.score, factors: x.factors })),
    },
  };
}
