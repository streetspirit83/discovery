/**
 * alerts.js — Discovery alert helpers (browser side).
 *
 * Alerts are stored on the candidate as `c.alerts = [{ ... }]`, using the exact
 * schema merkliste's status-logic understands, so the (later) scheduled ntfy
 * function can reuse the same engine with LS as the quote source.
 *
 * Currency: everything is anchored in EUR — `ls_quote.price` and `mk_entry` are
 * already EUR (that's how the P/L column works), so thresholds compare directly
 * to the LS price the push will use. Native TV levels are converted to EUR.
 *
 * Alert shape:
 *   { id, kind, type, threshold, dir, enabled, label, note?, basis, created_at }
 *   kind: 'watch'|'buy'|'stop' — the single explicit intent the user picks per
 *         alert; drives `dir` (buy→buy, stop→sell, watch→watch) and the push.
 *   note: optional free text shown in the list and the push.
 *   basis: { kind:'entry_pct'|'manual'|'preset'|'level', pct?, entry?, source? }
 *          (basis.kind = level *source*, distinct from the alert `kind` above).
 */

import { evalAlert, alertDir } from './status-logic.js?v=20260807a';
import { computePriceClusters } from './price-cluster.js?v=20260807a';

export const ALERTS_MUTED_KEY = 'discovery_alerts_muted_all';

/* The three intents a user assigns to every alert. `dir` feeds the shared
   status-logic engine; emoji/label feed the row badge and the push title. */
export const ALERT_KINDS = {
  watch: { dir: 'watch', label: 'Watch',     emoji: '🔭' },
  buy:   { dir: 'buy',   label: 'Buy',       emoji: '🟢' },
  stop:  { dir: 'sell',  label: 'Stop-Loss', emoji: '⛔' },
};
export function kindToDir(kind) { return ALERT_KINDS[kind]?.dir ?? 'watch'; }
/* Normalise legacy alerts (no `kind`) back to a kind from their dir. */
export function alertKind(a) {
  if (a.kind && ALERT_KINDS[a.kind]) return a.kind;
  const d = alertDir(a);
  return d === 'sell' ? 'stop' : d === 'buy' ? 'buy' : 'watch';
}

export function newAlertId() {
  return 'al_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* USD per 1 EUR — same live rate the table uses (set by refreshFxRate). */
function eurUsdRate() {
  const r = parseFloat(localStorage.getItem('discovery_fx_eurusd_live'));
  return Number.isFinite(r) && r > 0 ? r : null;
}

/* Native price → EUR (only USD differs; other currencies kept as-is). */
export function toEur(v, ccy) {
  if (v == null) return null;
  const rate = eurUsdRate();
  return (String(ccy).toUpperCase() === 'USD' && rate) ? +(v / rate).toFixed(4) : v;
}

/* The entry price (EUR) the %-options anchor on:
   Merkliste portfolio entry (EUR) → manual 'Mein Entry' (native→EUR) → live LS. */
export function entryBasisEur(c) {
  if (c.mk_entry != null)        return { value: c.mk_entry, source: 'Merkliste-Entry' };
  if (c.my_entry != null)        return { value: toEur(c.my_entry, c.currency), source: 'Mein Entry' };
  if (c.ls_quote?.price != null) return { value: c.ls_quote.price, source: 'LS-Kurs' };
  const close = c.tv_data?.close_1m ?? c.tv_data?.close;
  if (close != null)             return { value: toEur(close, c.currency), source: 'TV-Kurs' };
  return { value: null, source: null };
}

/* EUR per 1 EUR = 1; USD stocks convert LS(EUR) levels to native via the rate.
   null when the rate is unknown for a USD stock → LS levels skipped in clusters. */
function lsToNativeFactor(ccy) {
  const u = String(ccy).toUpperCase();
  if (u === 'EUR') return 1;
  if (u === 'USD') return eurUsdRate() ?? null;
  return null;
}

/* Nearest support/resistance cluster levels in EUR (for the dynamic cross_below_sup
   / cross_above_res alerts). Clusters are computed in native currency, then the
   zone midpoints are converted to EUR to compare with the EUR live price. */
export function clusterLevelsEur(c) {
  const tv = c.tv_data ?? {};
  const nativeClose = tv.close_1m ?? tv.close;
  if (nativeClose == null) return { sup: null, res: null };
  const pc = computePriceClusters(tv, { lsHistory: c.ls_history, refPrice: nativeClose, lsToNative: lsToNativeFactor(c.currency) });
  return {
    sup: pc?.nearestSup ? toEur(pc.nearestSup.mid, c.currency) : null,
    res: pc?.nearestRes ? toEur(pc.nearestRes.mid, c.currency) : null,
  };
}

/* Live quote (EUR) for evaluating alerts — LS price primary, TV indicators. */
export function candidateQuoteEur(c) {
  const tv = c.tv_data ?? {};
  const price = c.ls_quote?.price ?? toEur(tv.close_1m ?? tv.close, c.currency);
  const macd = tv.macd, sig = tv.macd_signal;
  const { sup, res } = clusterLevelsEur(c);
  return {
    price,
    rsi: tv.rsi ?? null,
    ma20:  toEur(tv.sma20, c.currency),
    ma50:  toEur(tv.sma50, c.currency),
    ma200: toEur(tv.sma200, c.currency),
    macd_histogram: (macd != null && sig != null) ? +(macd - sig).toFixed(4) : null,
    volume: tv.average_volume ?? null,
    avg_volume: tv.avg_vol_10d ?? tv.average_volume ?? null,
    sup, res, // dynamic cluster levels (EUR)
  };
}

/* True when the alert currently fires against the live quote. */
export function isAlertTriggered(c, a) {
  return evalAlert(a, candidateQuoteEur(c));
}

const fmtEur = (v) => (v == null ? '—' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');

/* Human-readable one-liner for an alert row. */
export function alertSummary(a) {
  switch (a.type) {
    case 'price_above': return `Kurs ≥ ${fmtEur(a.threshold)}${a.label ? ` · ${a.label}` : ''}`;
    case 'price_below': return `Kurs ≤ ${fmtEur(a.threshold)}${a.label ? ` · ${a.label}` : ''}`;
    case 'ma20_below':  return `Kurs ≤ SMA20`;
    case 'ma50_below':  return `Kurs ≤ SMA50`;
    case 'ma200_below': return `Kurs ≤ SMA200`;
    case 'cross_below_sup': return `Kurs ≤ Support-Cluster (dynamisch)`;
    case 'cross_above_res': return `Kurs ≥ Resistance-Cluster (dynamisch)`;
    case 'rsi_above':   return `RSI ≥ ${a.threshold}`;
    case 'rsi_below':   return `RSI ≤ ${a.threshold}`;
    case 'macd_bullish':return `MACD dreht bullish`;
    case 'macd_bearish':return `MACD dreht bearish`;
    default:            return a.label || a.type;
  }
}

export function dirBadge(a) {
  const d = alertDir(a);
  return d === 'sell' ? '🔴' : d === 'buy' ? '🟢' : '🟡';
}

/* ── Triage helpers (compact Alert-Overview + sub-nav badge) ──────────── */

const activeAlerts = (c) => (Array.isArray(c.alerts) ? c.alerts.filter((a) => a.enabled !== false) : []);

/* How many of a candidate's enabled alerts currently fire. */
export function candidateTriggeredCount(c) {
  const q = candidateQuoteEur(c);
  return activeAlerts(c).filter((a) => evalAlert(a, q)).length;
}

/* Total triggered alerts across a candidate list — for the red sub-nav badge. */
export function triggeredCount(candidates) {
  return (candidates || []).reduce((n, c) => n + candidateTriggeredCount(c), 0);
}

/* Whether a candidate has at least one currently-firing enabled alert. */
export function candidateTriggered(c) {
  const q = candidateQuoteEur(c);
  return activeAlerts(c).some((a) => evalAlert(a, q));
}

/* The single price alert to surface in the compact row: a firing one if any,
   else the nearest by |%Δ|. → { threshold, deltaPct, triggered } | null */
export function primaryPriceAlert(c) {
  const q = candidateQuoteEur(c);
  const price = q.price;
  const priceAlerts = activeAlerts(c).filter((a) => a.type === 'price_above' || a.type === 'price_below');
  if (!priceAlerts.length || price == null) return null;
  const rows = priceAlerts.map((a) => ({
    threshold: a.threshold,
    deltaPct: a.threshold ? +(((price - a.threshold) / a.threshold) * 100).toFixed(2) : null,
    triggered: evalAlert(a, q),
  }));
  return rows.find((r) => r.triggered)
    ?? rows.filter((r) => r.deltaPct != null).sort((x, y) => Math.abs(x.deltaPct) - Math.abs(y.deltaPct))[0]
    ?? null;
}

/* Trading advice for a symbol → { label, cls }. Three buckets per request:
   Stop (protective sell), Buy, Watch. Firing alerts take precedence; sell
   (downside / take-profit) is prioritised over buy for safety. */
export function candidateAdvice(c) {
  const q = candidateQuoteEur(c);
  const act = activeAlerts(c);
  const firing = act.filter((a) => evalAlert(a, q));
  const pool = firing.length ? firing : act;
  if (pool.some((a) => alertDir(a) === 'sell'))  return { label: 'Stop',  cls: 'neg' };
  if (pool.some((a) => alertDir(a) === 'buy'))   return { label: 'Buy',   cls: 'pos' };
  return { label: 'Watch', cls: 'watch' };
}

/* ── Builders ────────────────────────────────────────────────────────── */

/* Price alert at an absolute EUR level. `cmp` ('above'|'below') sets the
   comparison type; `kind` (watch/buy/stop) sets the intent → dir. Used for both
   the manual price input and the predefined Support/Resistance/Target chips. */
export function buildManualPriceAlert({ cmp, priceEur, kind = 'watch', note = '', label = 'Manuell', basisKind = 'manual' }) {
  const above = cmp === 'above';
  return {
    id: newAlertId(),
    kind,
    type: above ? 'price_above' : 'price_below',
    threshold: priceEur,
    dir: kindToDir(kind),
    enabled: true,
    label,
    note: note || undefined,
    basis: { kind: basisKind },
    created_at: new Date().toISOString(),
  };
}

/* Dynamic cluster alert: fires when the live price crosses the CURRENT nearest
   support (below) or resistance (above) confluence zone — recomputed on every
   evaluation, so the trigger level moves with the clusters (TrendSpider-style).
   No stored threshold; the level lives in q.sup / q.res. */
export function buildClusterAlert({ side, kind = 'watch', note = '' }) {
  const above = side === 'res';
  return {
    id: newAlertId(),
    kind,
    type: above ? 'cross_above_res' : 'cross_below_sup',
    dir: kindToDir(kind),
    enabled: true,
    label: above ? 'Resistance-Cluster' : 'Support-Cluster',
    note: note || undefined,
    basis: { kind: 'cluster', side },
    created_at: new Date().toISOString(),
  };
}

/* +pct → target (price_above) · −pct → stop (price_below), anchored on entry. */
export function buildEntryPctAlert(c, pct, { kind, note = '' } = {}) {
  const { value: entry, source } = entryBasisEur(c);
  if (entry == null) return null;
  const threshold = +(entry * (1 + pct / 100)).toFixed(4);
  const up = pct >= 0;
  const k = kind ?? (up ? 'watch' : 'stop'); // sensible default: gain→watch, loss→stop
  return {
    id: newAlertId(),
    kind: k,
    type: up ? 'price_above' : 'price_below',
    threshold,
    dir: kindToDir(k),
    enabled: true,
    label: `${up ? 'Ziel' : 'Stop'} ${up ? '+' : '−'}${Math.abs(pct)}%`,
    note: note || undefined,
    basis: { kind: 'entry_pct', pct, entry, source },
    created_at: new Date().toISOString(),
  };
}

/* Presets. SMA crosses are price-driven (live LS price vs stored SMA level);
   RSI/MACD are pure TV-snapshot indicators. The user-picked `kind` overrides the
   preset's natural dir so every alert carries exactly one explicit intent. */
export function buildPresetAlert(preset, { kind, note = '' } = {}) {
  const withKind = (k, def) => {
    const kk = k ?? def;
    return { kind: kk, dir: kindToDir(kk), note: note || undefined };
  };
  const base = { id: newAlertId(), enabled: true, basis: { kind: 'preset' }, created_at: new Date().toISOString() };
  switch (preset) {
    case 'sma20':  return { ...base, type: 'ma20_below',  ...withKind(kind, 'buy'),  label: 'Kurs ≤ SMA20' };
    case 'sma50':  return { ...base, type: 'ma50_below',  ...withKind(kind, 'buy'),  label: 'Kurs ≤ SMA50' };
    case 'sma200': return { ...base, type: 'ma200_below', ...withKind(kind, 'buy'),  label: 'Kurs ≤ SMA200' };
    case 'rsi_ob': return { ...base, type: 'rsi_above', threshold: 70, ...withKind(kind, 'stop'), label: 'RSI ≥ 70 (überkauft)' };
    case 'rsi_os': return { ...base, type: 'rsi_below', threshold: 30, ...withKind(kind, 'buy'),  label: 'RSI ≤ 30 (überverkauft)' };
    case 'macd_up':return { ...base, type: 'macd_bullish', ...withKind(kind, 'buy'),  label: 'MACD bullish' };
    case 'macd_dn':return { ...base, type: 'macd_bearish', ...withKind(kind, 'stop'), label: 'MACD bearish' };
    default: return null;
  }
}
