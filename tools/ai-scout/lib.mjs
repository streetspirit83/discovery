/**
 * KI-Wochen-Scout (Weg A: erst filtern, dann KI).
 *
 * 1. `buildScoutPool` – technische Vorauswahl für die Samstags-Aufgabe „Discovery Scout“: die Trend-/Rally-Screens
 *    aus dem Screener Studio (US + EU, Mega-Cluster), ohne alles, was schon im Workspace liegt. Je Titel Kennzahlen
 *    und die Screens, in denen er auftaucht. Landet als `scout_pool` in „Discovery Rankings.json“ (Monitor-Lauf).
 * 2. `verifyAndAppend` – nach dem Speichern eines Scout-Briefings (push.mjs, `kind: scout`) jeden Titel über den
 *    TradingView-Scanner prüfen (existiert, Aktie, richtige Börse; US-Titel notfalls an NASDAQ/NYSE/AMEX gesucht) und
 *    die bestätigten ohne weitere Prüfung in die Inbox legen (Quelle `ai-scout`). Erfundene oder falsch zugeordnete
 *    Symbole erreichen die Inbox so nie. Watchlist/Archiv überspringt das Backend selbst.
 */
import { DEFAULT_PRESETS } from '../../ui/lib/screener-presets.js?v=20261123a';
import { runPreset } from '../../ui/lib/screen-runner.js?v=20261123a';
import { normalizeExchange } from '../../ui/lib/exchange-map.js';
import { TV_PREFIX_MAP, EXCHANGE_CURRENCY } from '../../ui/lib/tv-enrichment.js';
import { megaClusterOf, megaClusterLabel } from '../../ui/lib/sector-clusters.js?v=20260807a';
import { buildLinks } from '../../adapters/_shared/link-builder.js';

export const POOL_PRESETS = [
  'builtin-minervini-us', 'builtin-minervini-eu', 'builtin-growth-momentum-us', 'builtin-growth-momentum-eu',
  'builtin-rs-midcap-us', 'builtin-rs-midcap-eu', 'builtin-breakout-pullback-us', 'builtin-breakout-pullback-eu',
  'builtin-smallcap-momentum-us', 'builtin-earnings-gap-us', 'builtin-earnings-gap-eu', 'builtin-momentum-breakout-eu',
];
const EXTRA = ['Perf.1M', 'Perf.3M', 'Perf.6M', 'RSI', 'total_revenue_yoy_growth_ttm', 'earnings_per_share_diluted_yoy_growth_ttm', 'industry', 'currency'];
const US = ['NASDAQ', 'NYSE', 'AMEX'];
const YAHOO_SUFFIX = { XETR: '.DE', LSE: '.L', EURONEXT: '.PA', MIL: '.MI', BME: '.MC', OMXSTO: '.ST', SIX: '.SW', OMXCOP: '.CO', OSL: '.OL', OMXHEX: '.HE', VIE: '.VI' };
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

/** Vorauswahl für den Scout. `known` = Set der Symbole im Workspace. */
export async function buildScoutPool(known, auth, { max = 120, perScreen = 60 } = {}) {
  const byKey = new Map();
  const failed = [];
  for (const id of POOL_PRESETS) {
    const p = DEFAULT_PRESETS.find((x) => x.id === id);
    if (!p) continue;
    let res;
    try { res = await runPreset({ ...p, count: perScreen, extra_columns: EXTRA }, auth); }
    catch (e) { failed.push(id); continue; }
    const idx = Object.fromEntries(res.req.columns.map((c, i) => [c, i]));
    res.rows.forEach((row, rank) => {
      const [tvEx, symbol] = String(row.s ?? '').split(':');
      const exchange = normalizeExchange(tvEx) || tvEx;
      if (!symbol || known.has(symbol)) return;
      const key = `${symbol}:${exchange}`;
      const g = (c) => row.d?.[idx[c]] ?? null;
      const hit = byKey.get(key);
      if (hit) { hit.screens.push(p.label); hit.best_rank = Math.min(hit.best_rank, rank + 1); return; }
      byKey.set(key, {
        symbol, exchange, tv: row.s, name: g('description'), sector: g('sector'), industry: g('industry'),
        mega: megaClusterLabel(megaClusterOf(g('sector'))), region: US.includes(exchange) ? 'US' : 'EU',
        cap_mio: g('market_cap_basic') != null ? Math.round(g('market_cap_basic') / 1e6) : null, currency: g('currency'),
        perf_1m: r1(g('Perf.1M')), perf_3m: r1(g('Perf.3M')), perf_6m: r1(g('Perf.6M')), rsi: r1(g('RSI')),
        rev_growth: r1(g('total_revenue_yoy_growth_ttm')), eps_growth: r1(g('earnings_per_share_diluted_yoy_growth_ttm')),
        screens: [p.label], best_rank: rank + 1,
      });
    });
  }
  const items = [...byKey.values()]
    .sort((a, b) => b.screens.length - a.screens.length || (b.perf_6m ?? -999) - (a.perf_6m ?? -999))
    .slice(0, max);
  return {
    generated_at: new Date().toISOString(), presets: POOL_PRESETS.filter((p) => !failed.includes(p)), failed,
    note: 'Technische Vorauswahl (Trend/Rally, US+EU, Mega-Cluster, ab 300 Mio.), ohne Titel aus Watchlist, Archiv und Inbox. cap_mio in Notierungswährung.',
    n: items.length, items,
  };
}

async function proxyScan(auth, tickers) {
  const res = await fetch(`${auth.backendUrl}/api/scrape-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': auth.secret },
    body: JSON.stringify({
      url: 'https://scanner.tradingview.com/global/scan', method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: { symbols: { tickers }, columns: ['description', 'type', 'sector', 'close'] },
    }),
  });
  const w = await res.json();
  if (!w?.ok || w.status !== 200) throw new Error(`TV-Prüfung: ${w?.error ?? w?.status ?? res.status}`);
  return JSON.parse(w.body).data ?? [];
}

const tickersFor = (x) => {
  const ex = normalizeExchange(x.exchange) || String(x.exchange ?? '').toUpperCase();
  const sym = String(x.symbol ?? '').trim().toUpperCase();
  const list = [TV_PREFIX_MAP[ex] ? `${TV_PREFIX_MAP[ex]}:${sym}` : null];
  if (US.includes(ex) || !ex) list.push(...US.map((u) => `${u}:${sym}`));
  return [...new Set(list.filter(Boolean))];
};

/** Scout-Titel prüfen und in die Inbox legen. `storage(body)` = Backend-Aufruf. */
export async function verifyAndAppend(items, { auth, storage, day, title }) {
  const wanted = (items ?? []).filter((x) => x?.symbol);
  if (!wanted.length) return { at: new Date().toISOString(), added: [], merged: [], skipped: [], missing: [] };
  const all = [...new Set(wanted.flatMap(tickersFor))];
  const found = new Map((await proxyScan(auth, all)).filter((r) => r.d?.[1] === 'stock' || r.d?.[1] === 'dr').map((r) => [r.s, r]));
  const now = new Date().toISOString();
  const cands = [];
  const missing = [];
  for (const x of wanted) {
    const tv = tickersFor(x).find((t) => found.has(t));
    if (!tv) { missing.push(`${x.symbol}${x.exchange ? `:${x.exchange}` : ''}`); continue; }
    const [tvEx, symbol] = tv.split(':');
    const exchange = normalizeExchange(tvEx) || tvEx;
    const yahoo = US.includes(exchange) ? symbol : YAHOO_SUFFIX[exchange] ? `${symbol}${YAHOO_SUFFIX[exchange]}` : null;
    cands.push({
      id: crypto.randomUUID(), symbol, exchange, yahoo_symbol: yahoo, isin: null, name: found.get(tv).d?.[0] ?? x.name ?? symbol,
      currency: EXCHANGE_CURRENCY[exchange] ?? null,
      sources: [{
        adapter: 'ai-scout', source_url: `https://www.tradingview.com/symbols/${tv.replace(':', '-')}/`, discovered_at: now, signal_type: 'ai_scout',
        raw_signal: { day, category: x.category ?? null, thesis: x.thesis ?? null, catalyst: x.catalyst ?? null, counter: x.counter ?? null },
        info_snippet: `KI-Scout ${day}${x.category ? ` · ${x.category}` : ''}: ${String(x.thesis ?? title ?? '').slice(0, 160)}`,
      }],
      links: buildLinks({ exchange, symbol, yahooSymbol: yahoo }), workspace_state: 'new', notes: '', enrichment: null, first_discovered_at: now, last_updated_at: now,
    });
  }
  const out = { at: now, added: [], merged: [], skipped: [], missing };
  if (cands.length) {
    const res = await storage({ op: 'append_candidates', candidates: cands });
    (res?.results ?? []).forEach((r, i) => { const k = `${cands[i].symbol}:${cands[i].exchange}`; (out[r.action] ?? out.skipped).push(k); });
  }
  return out;
}
