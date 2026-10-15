/**
 * TradingView Screener – curated field / operator / market / sector catalog.
 *
 * Drives the visual filter builder in the Screener Studio. Field names are the
 * exact TradingView scanner column identifiers (same ones proven in
 * tv-enrichment.js). Kept deliberately curated – the high-signal subset – rather
 * than the full multi-thousand field list, so the dropdowns stay usable.
 */

// ─── Field types ────────────────────────────────────────────────────────────
// 'number'   → numeric input(s); supports all comparison operators
// 'category' → value picked from `options`; supports equal/nequal/in_range only

const NATIVE_FIELDS = [
  // Price
  { value: 'close',                     label: 'Price (close)',          group: 'Price',          type: 'number' },
  { value: 'change',                    label: 'Change % (today)',       group: 'Price',          type: 'number' },
  { value: 'change|1W',                 label: 'Change % (1W)',          group: 'Price',          type: 'number' },
  { value: 'change|1M',                 label: 'Change % (1M)',          group: 'Price',          type: 'number' },
  { value: 'price_52_week_high',        label: '52-week high',           group: 'Price',          type: 'number' },
  { value: 'price_52_week_low',         label: '52-week low',            group: 'Price',          type: 'number' },

  // Volume
  { value: 'volume',                    label: 'Volume',                 group: 'Volume',         type: 'number' },
  { value: 'relative_volume_10d_calc',  label: 'Relative volume (10d)',  group: 'Volume',         type: 'number' },
  { value: 'average_volume_10d_calc',   label: 'Avg volume (10d)',       group: 'Volume',         type: 'number' },
  { value: 'average_volume_30d_calc',   label: 'Avg volume (30d)',       group: 'Volume',         type: 'number' },

  // Momentum / oscillators
  { value: 'RSI',                       label: 'RSI (14)',               group: 'Momentum',       type: 'number' },
  { value: 'MACD.macd',                 label: 'MACD line',              group: 'Momentum',       type: 'number' },
  { value: 'MACD.signal',              label: 'MACD signal',            group: 'Momentum',       type: 'number' },
  { value: 'Mom',                       label: 'Momentum',               group: 'Momentum',       type: 'number' },
  { value: 'Stoch.K',                   label: 'Stochastic %K',          group: 'Momentum',       type: 'number' },
  { value: 'CCI20',                     label: 'CCI (20)',               group: 'Momentum',       type: 'number' },

  // Trend
  { value: 'EMA20',                     label: 'EMA 20',                 group: 'Trend',          type: 'number' },
  { value: 'EMA50',                     label: 'EMA 50',                 group: 'Trend',          type: 'number' },
  { value: 'EMA200',                    label: 'EMA 200',                group: 'Trend',          type: 'number' },
  { value: 'SMA50',                     label: 'SMA 50',                 group: 'Trend',          type: 'number' },
  { value: 'SMA200',                    label: 'SMA 200',                group: 'Trend',          type: 'number' },
  { value: 'ADX',                       label: 'ADX',                    group: 'Trend',          type: 'number' },
  { value: 'Aroon.Up',                  label: 'Aroon Up',               group: 'Trend',          type: 'number' },
  { value: 'Aroon.Down',               label: 'Aroon Down',             group: 'Trend',          type: 'number' },
  { value: 'Recommend.All',            label: 'TV rating (−1…+1)',      group: 'Trend',          type: 'number' },

  // Performance
  { value: 'Perf.W',                    label: 'Performance (1W)',       group: 'Performance',    type: 'number' },
  { value: 'Perf.1M',                   label: 'Performance (1M)',       group: 'Performance',    type: 'number' },
  { value: 'Perf.3M',                   label: 'Performance (3M)',       group: 'Performance',    type: 'number' },
  { value: 'Perf.6M',                   label: 'Performance (6M)',       group: 'Performance',    type: 'number' },
  { value: 'Perf.Y',                    label: 'Performance (1Y)',       group: 'Performance',    type: 'number' },

  // Volatility (TradingView columns that are already expressed as %)
  { value: 'Volatility.D',              label: 'Volatility (1D) %',      group: 'Volatility',     type: 'number' },
  { value: 'Volatility.W',              label: 'Volatility (1W) %',      group: 'Volatility',     type: 'number' },
  { value: 'Volatility.M',              label: 'Volatility (1M) %',      group: 'Volatility',     type: 'number' },
  { value: 'gap',                       label: 'Gap % (today)',          group: 'Volatility',     type: 'number' },

  // Valuation
  { value: 'market_cap_basic',          label: 'Market cap',             group: 'Valuation',      type: 'number' },
  { value: 'price_earnings_ttm',        label: 'P/E (TTM)',              group: 'Valuation',      type: 'number' },
  { value: 'dividend_yield_recent',     label: 'Dividend yield %',       group: 'Valuation',      type: 'number' },
  { value: 'enterprise_value_ebitda_ttm', label: 'EV/EBITDA (TTM)',      group: 'Valuation',      type: 'number' },

  // Growth / quality
  { value: 'total_revenue_yoy_growth_ttm', label: 'Revenue growth YoY %', group: 'Growth',        type: 'number' },
  { value: 'earnings_per_share_diluted_yoy_growth_ttm', label: 'EPS growth YoY %', group: 'Growth', type: 'number' },
  { value: 'ebitda_yoy_growth_ttm',     label: 'EBITDA growth YoY %',    group: 'Growth',         type: 'number' },
  { value: 'gross_margin',              label: 'Gross margin %',         group: 'Growth',         type: 'number' },
  { value: 'operating_margin',          label: 'Operating margin %',     group: 'Growth',         type: 'number' },
  { value: 'return_on_equity',          label: 'Return on equity %',     group: 'Growth',         type: 'number' },
  { value: 'debt_to_equity',            label: 'Debt / equity',          group: 'Growth',         type: 'number' },
];

// ─── Synthetic (computed) percent fields ────────────────────────────────────────
// TradingView's scanner only accepts a literal number per field – it cannot filter
// one field relative to another (e.g. "close within 3% of the 52-week high", or
// "volume ≥ 150% of its 30-day average"). These pseudo-fields express exactly that:
// they are NEVER sent to the scanner. Instead the screener fetches their `deps`
// columns and computes the percentage per row, then applies the comparison
// client-side. `compute(get)` receives a `get(column)` accessor for the row's raw
// values and returns a number (the %) or null when inputs are missing.
export const SYNTHETIC_FIELDS = [
  {
    value: 'pct_below_52w_high', label: '% below 52w high', group: 'Relative (%)', type: 'percent',
    synthetic: true, deps: ['close', 'price_52_week_high'],
    compute: (g) => { const c = g('close'), h = g('price_52_week_high'); return (c == null || h == null || h === 0) ? null : (h - c) / h * 100; },
  },
  {
    value: 'pct_above_52w_low', label: '% above 52w low', group: 'Relative (%)', type: 'percent',
    synthetic: true, deps: ['close', 'price_52_week_low'],
    compute: (g) => { const c = g('close'), l = g('price_52_week_low'); return (c == null || l == null || l === 0) ? null : (c - l) / l * 100; },
  },
  {
    value: 'vol_vs_avg30d_pct', label: 'Volume vs avg30d %', group: 'Relative (%)', type: 'percent',
    synthetic: true, deps: ['volume', 'average_volume_30d_calc'],
    compute: (g) => { const v = g('volume'), a = g('average_volume_30d_calc'); return (v == null || a == null || a === 0) ? null : v / a * 100; },
  },
  {
    value: 'pct_above_ema20', label: '% vs EMA20', group: 'Relative (%)', type: 'percent',
    synthetic: true, deps: ['close', 'EMA20'],
    compute: (g) => { const c = g('close'), e = g('EMA20'); return (c == null || e == null || e === 0) ? null : (c - e) / e * 100; },
  },
  {
    value: 'pct_above_sma200', label: '% vs SMA200', group: 'Relative (%)', type: 'percent',
    synthetic: true, deps: ['close', 'SMA200'],
    compute: (g) => { const c = g('close'), s = g('SMA200'); return (c == null || s == null || s === 0) ? null : (c - s) / s * 100; },
  },
];

export const FIELDS = [...NATIVE_FIELDS, ...SYNTHETIC_FIELDS];

// ─── Operators ──────────────────────────────────────────────────────────────
// `arity` 2 means it needs a low + high value (in_range / not_in_range).

export const OPERATORS = [
  { value: 'greater',      label: '>  greater',        numericOnly: true,  arity: 1 },
  { value: 'egreater',     label: '≥  greater/equal',  numericOnly: true,  arity: 1 },
  { value: 'less',         label: '<  less',           numericOnly: true,  arity: 1 },
  { value: 'eless',        label: '≤  less/equal',     numericOnly: true,  arity: 1 },
  { value: 'equal',        label: '=  equal',          numericOnly: false, arity: 1 },
  { value: 'nequal',       label: '≠  not equal',      numericOnly: false, arity: 1 },
  { value: 'in_range',     label: 'between',           numericOnly: false, arity: 2 },
  { value: 'not_in_range', label: 'not between',       numericOnly: false, arity: 2 },
  { value: 'crosses_above', label: 'crosses above',    numericOnly: true,  arity: 1 },
  { value: 'crosses_below', label: 'crosses below',    numericOnly: true,  arity: 1 },
];

// ─── Markets ──────────────────────────────────────────────────────────────────
// `slug` is the scanner endpoint segment; `yahooSuffix` builds the yahoo_symbol;
// `exchanges` lists the TV exchange prefixes we accept from that market's results.

// `country` is the exact domicile name TradingView's scanner uses for its
// `country` field (e.g. `country: 'Germany'`), kept as reference metadata. The
// markets dashboard no longer filters on it: it filters by `is_primary == true`
// instead, which excludes foreign cross-listings AND collapses regional-venue
// duplicates to one row per company in a single, exchange-grounded step.
export const MARKETS = [
  { slug: 'america',     label: 'USA',         yahooSuffix: '',    exchanges: ['NASDAQ', 'NYSE', 'AMEX'],     country: 'United States' },
  { slug: 'germany',     label: 'Germany',     yahooSuffix: '.DE', exchanges: ['XETR'],                       country: 'Germany' },
  { slug: 'uk',          label: 'UK',          yahooSuffix: '.L',  exchanges: ['LSE'],                        country: 'United Kingdom' },
  { slug: 'france',      label: 'France',      yahooSuffix: '.PA', exchanges: ['EURONEXT'],                   country: 'France' },
  { slug: 'netherlands', label: 'Netherlands', yahooSuffix: '.AS', exchanges: ['EURONEXT'],                   country: 'Netherlands' },
  { slug: 'italy',       label: 'Italy',       yahooSuffix: '.MI', exchanges: ['MIL'],                        country: 'Italy' },
  { slug: 'spain',       label: 'Spain',       yahooSuffix: '.MC', exchanges: ['BME'],                        country: 'Spain' },
  { slug: 'sweden',      label: 'Sweden',      yahooSuffix: '.ST', exchanges: ['OMXSTO'],                     country: 'Sweden' },
  { slug: 'switzerland', label: 'Switzerland', yahooSuffix: '.SW', exchanges: ['SIX'],                        country: 'Switzerland' },
  { slug: 'denmark',     label: 'Denmark',     yahooSuffix: '.CO', exchanges: ['OMXCO'],                      country: 'Denmark' },
  { slug: 'norway',      label: 'Norway',      yahooSuffix: '.OL', exchanges: ['OMXNO'],                      country: 'Norway' },
  { slug: 'finland',     label: 'Finland',     yahooSuffix: '.HE', exchanges: ['OMXHEX'],                     country: 'Finland' },
  { slug: 'canada',      label: 'Canada',      yahooSuffix: '.TO', exchanges: ['TSX', 'TSXV'],                country: 'Canada' },
  { slug: 'australia',   label: 'Australia',   yahooSuffix: '.AX', exchanges: ['ASX'],                        country: 'Australia' },
];

// TradingView exchange prefix (left of the colon in "NASDAQ:AAPL") → our code.
export const TV_PREFIX_TO_EXCHANGE = {
  NASDAQ: 'NASDAQ', NYSE: 'NYSE', 'NYSE ARCA': 'NYSE', 'NYSE MKT': 'AMEX', AMEX: 'AMEX',
  XETR: 'XETR', LSE: 'LSE', EURONEXT: 'EURONEXT', MIL: 'MIL', BME: 'BME',
  OMXSTO: 'OMXSTO', SIX: 'SIX', OMXCO: 'OMXCO', OMXNO: 'OMXNO', OMXHEX: 'OMXHEX',
  TSX: 'TSX', TSXV: 'TSXV', ASX: 'ASX',
};

// ─── Sectors (exact FactSet strings used by TradingView) ────────────────────────
export const SECTORS = [
  'Electronic Technology',
  'Technology Services',
  'Health Technology',
  'Health Services',
  'Finance',
  'Energy Minerals',
  'Non-Energy Minerals',
  'Process Industries',
  'Producer Manufacturing',
  'Industrial Services',
  'Consumer Non-Durables',
  'Consumer Durables',
  'Consumer Services',
  'Retail Trade',
  'Distribution Services',
  'Transportation',
  'Utilities',
  'Commercial Services',
  'Miscellaneous',
];

// ─── Lookups ────────────────────────────────────────────────────────────────
export const FIELD_BY_VALUE  = new Map(FIELDS.map((f) => [f.value, f]));
export const MARKET_BY_SLUG   = new Map(MARKETS.map((m) => [m.slug, m]));
export const SYNTHETIC_BY_VALUE = new Map(SYNTHETIC_FIELDS.map((f) => [f.value, f]));

/** Human label for a field id, falling back to the raw id. */
export function fieldLabel(value) {
  return FIELD_BY_VALUE.get(value)?.label ?? value;
}

/** True when `value` is a computed percent field (never sent to the scanner). */
export function isSynthetic(value) {
  return SYNTHETIC_BY_VALUE.has(value);
}

/** Raw scanner columns a synthetic field needs in order to be computed. */
export function syntheticDeps(value) {
  return SYNTHETIC_BY_VALUE.get(value)?.deps ?? [];
}

/** Compute a synthetic field's % value for a row, given a get(column) accessor. */
export function computeSynthetic(value, get) {
  const f = SYNTHETIC_BY_VALUE.get(value);
  return f ? f.compute(get) : null;
}

/**
 * Client-side numeric comparison mirroring the scanner operators, for post-filtering
 * synthetic fields. Unsupported operators (crosses_*) never exclude a row.
 */
export function matchesOp(val, op, v1, v2) {
  if (val == null || Number.isNaN(val)) return false;
  const a = Number(v1);
  const b = Number(v2);
  switch (op) {
    case 'greater':      return val > a;
    case 'egreater':     return val >= a;
    case 'less':         return val < a;
    case 'eless':        return val <= a;
    case 'equal':        return val === a;
    case 'nequal':       return val !== a;
    case 'in_range':     return val >= Math.min(a, b) && val <= Math.max(a, b);
    case 'not_in_range': return !(val >= Math.min(a, b) && val <= Math.max(a, b));
    default:             return true;
  }
}
