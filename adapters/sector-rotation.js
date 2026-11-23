/**
 * Sektor-Rotation (top-down) – erst die stärksten Branchen finden, dann deren Leader holen.
 *
 * Je Region (USA, Europa) ein einziger TradingView-Scan über alle Heimatbörsen-Aktien ab
 * 300 Mio. Börsenwert in den Mega-Clustern (ohne „Miscellaneous“). Daraus:
 *   1. Branchen-Stärke je TV-Industry (mind. MIN_MEMBERS Titel): Median Perf.1M und Perf.3M
 *      (je als Perzentil über alle Branchen) plus Breite = Anteil über der SMA50.
 *      Score = 0,4 · P(1M) + 0,4 · P(3M) + 0,2 · Breite.
 *   2. In den TOP_INDUSTRIES Branchen die Leader im intakten Aufwärtstrend
 *      (Kurs > SMA50 > SMA200, Perf.3M > 0, RSI < 80), sortiert nach Perf.3M + Perf.1M.
 * Ergebnis: höchstens LEADERS je Branche, Quelle `sector-rotation`, Signal `sector_rotation`.
 * Die Auto-Rotation entscheidet danach wie bei jedem Inbox-Titel.
 *
 * Scanner über die Netlify scrape-proxy (ein Aufruf je Region, ~400 KB Antwort).
 * Env: DISCOVERY_BACKEND_URL, DISCOVERY_SECRET; optional DRY_PRINT=1 (Branchen-Tabelle ins Log).
 */

import { runScreen, rowsToCandidates } from '../ui/lib/tv-screener.js?v=20261123a';
import { MARKET_BY_SLUG } from '../ui/lib/tv-fields.js?v=20261123a';
import { megaClusterOf } from '../ui/lib/sector-clusters.js?v=20260807a';

const log = (level, msg, data = {}) =>
  process.stdout.write(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n');

export const RULES = {
  minCap: 300e6,
  minMembers: 6,
  topIndustries: 8,
  leaders: 4,
  maxRsi: 80,
  weights: { p1m: 0.4, p3m: 0.4, breadth: 0.2 },
};

const COLUMNS = ['description', 'sector', 'industry', 'close', 'SMA50', 'SMA200', 'Perf.1M', 'Perf.3M', 'RSI', 'market_cap_basic'];
const REGIONS = [
  { key: 'US', market: 'america' },
  { key: 'EU', market: 'europe' },
];

const median = (a) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pctRank = (vals) => {
  const sorted = [...vals].sort((a, b) => a - b);
  return (v) => (sorted.length < 2 ? 0.5 : sorted.filter((x) => x < v).length / (sorted.length - 1));
};

/** Reine Logik: Scanner-Zeilen → { industries (sortiert), leaders [{row, industry, irank, lrank}] }. */
export function rankIndustries(rows, rules = RULES) {
  const C = Object.fromEntries(COLUMNS.map((c, i) => [c, i]));
  const get = (r, c) => r.d?.[C[c]] ?? null;
  const groups = new Map();
  for (const r of rows) {
    const sector = get(r, 'sector'), industry = get(r, 'industry');
    if (!industry || !megaClusterOf(sector)) continue;
    if (!groups.has(industry)) groups.set(industry, { industry, sector, rows: [] });
    groups.get(industry).rows.push(r);
  }
  const stats = [...groups.values()].filter((g) => g.rows.length >= rules.minMembers).map((g) => ({
    industry: g.industry, sector: g.sector, mega: megaClusterOf(g.sector), n: g.rows.length,
    med_1m: median(g.rows.map((r) => get(r, 'Perf.1M'))),
    med_3m: median(g.rows.map((r) => get(r, 'Perf.3M'))),
    breadth: g.rows.filter((r) => get(r, 'close') > get(r, 'SMA50')).length / g.rows.length,
    rows: g.rows,
  })).filter((s) => s.med_1m != null && s.med_3m != null);
  const p1 = pctRank(stats.map((s) => s.med_1m));
  const p3 = pctRank(stats.map((s) => s.med_3m));
  for (const s of stats) {
    s.score = Math.round(100 * (rules.weights.p1m * p1(s.med_1m) + rules.weights.p3m * p3(s.med_3m) + rules.weights.breadth * s.breadth));
  }
  stats.sort((a, b) => b.score - a.score);

  const leaders = [];
  stats.slice(0, rules.topIndustries).forEach((s, i) => {
    const ok = s.rows.filter((r) => {
      const c = get(r, 'close'), s50 = get(r, 'SMA50'), s200 = get(r, 'SMA200'), p3m = get(r, 'Perf.3M'), rsi = get(r, 'RSI');
      return c > s50 && s50 > s200 && p3m > 0 && (rsi == null || rsi < rules.maxRsi);
    }).sort((a, b) => (get(b, 'Perf.3M') + get(b, 'Perf.1M')) - (get(a, 'Perf.3M') + get(a, 'Perf.1M')));
    // Aktiengattungen derselben Firma (BF.A/BF.B) nur einmal: Name ohne „Class …“ vergleichen.
    const seenName = new Set();
    const firm = (r) => String(get(r, 'description') ?? r.s).replace(/\s+(Class|Cl\.?|Series)\s+\w+.*$/i, '').slice(0, 24).toLowerCase();
    ok.filter((r) => (seenName.has(firm(r)) ? false : seenName.add(firm(r))))
      .slice(0, rules.leaders).forEach((row, j) => leaders.push({ row, industry: s, irank: i + 1, lrank: j + 1 }));
  });
  return { industries: stats.map(({ rows: _r, ...rest }) => rest), leaders };
}

export async function fetchCandidates() {
  const auth = {
    backendUrl: String(process.env.DISCOVERY_BACKEND_URL ?? '').replace(/\/$/, ''),
    secret: process.env.DISCOVERY_SECRET ?? '',
  };
  if (!auth.backendUrl || !auth.secret) throw new Error('DISCOVERY_BACKEND_URL / DISCOVERY_SECRET not set');

  const out = [];
  let ok = 0;
  for (const reg of REGIONS) {
    const filter = [{ left: 'market_cap_basic', operation: 'greater', right: RULES.minCap }];
    const def = MARKET_BY_SLUG.get(reg.market);
    if (def) filter.push({ left: 'exchange', operation: 'in_range', right: def.exchanges });
    else filter.push({ left: 'is_primary', operation: 'equal', right: true });
    let rows;
    try {
      ({ rows } = await runScreen({ market: reg.market, filter, columns: COLUMNS, sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' }, count: 5000 }, auth));
      ok++;
    } catch (err) {
      log('warn', 'sector-rotation: scan failed', { region: reg.key, error: err.message });
      continue;
    }
    const { industries, leaders } = rankIndustries(rows);
    log('info', 'sector-rotation: top industries', {
      region: reg.key, universe: rows.length,
      top: industries.slice(0, RULES.topIndustries).map((s) => `${s.industry} (${s.score}, 1M ${s.med_1m.toFixed(1)}%, 3M ${s.med_3m.toFixed(1)}%, n=${s.n})`),
    });
    for (const { row, industry, irank, lrank } of leaders) {
      const [c] = rowsToCandidates([row], { market: reg.market, columns: COLUMNS, presetId: 'sector-rotation', presetLabel: 'Sektor-Rotation', filter });
      if (!c) continue;
      const src = c.sources[0];
      src.adapter = 'sector-rotation';
      src.signal_type = 'sector_rotation';
      src.raw_signal = {
        region: reg.key, industry: industry.industry, sector: industry.sector, industry_rank: irank, industry_score: industry.score,
        industry_med_1m: industry.med_1m, industry_med_3m: industry.med_3m, industry_breadth: industry.breadth, leader_rank: lrank, values: src.raw_signal.values,
      };
      src.info_snippet = `Sektor-Rotation ${reg.key}: ${industry.industry} (Branche #${irank}, Ø 1M ${industry.med_1m.toFixed(1)} %) · Leader #${lrank}`;
      out.push(c);
    }
  }
  if (!ok) throw new Error('kein Scan erfolgreich');
  log('info', 'sector-rotation: candidates ready', { count: out.length });
  return out;
}
