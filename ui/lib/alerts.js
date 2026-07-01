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
 *   { id, type, threshold, dir, enabled, label, basis, created_at }
 *   basis: { kind:'entry_pct'|'manual'|'preset', pct?, entry?, source? }
 */

import { evalAlert, alertDir } from './status-logic.js?v=20260626f';

export const ALERTS_MUTED_KEY = 'discovery_alerts_muted_all';

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

/* Live quote (EUR) for evaluating alerts — LS price primary, TV indicators. */
export function candidateQuoteEur(c) {
  const tv = c.tv_data ?? {};
  const price = c.ls_quote?.price ?? toEur(tv.close_1m ?? tv.close, c.currency);
  const macd = tv.macd, sig = tv.macd_signal;
  return {
    price,
    rsi: tv.rsi ?? null,
    ma20:  toEur(tv.sma20, c.currency),
    ma50:  toEur(tv.sma50, c.currency),
    ma200: toEur(tv.sma200, c.currency),
    macd_histogram: (macd != null && sig != null) ? +(macd - sig).toFixed(4) : null,
    volume: tv.average_volume ?? null,
    avg_volume: tv.avg_vol_10d ?? tv.average_volume ?? null,
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

export function buildManualPriceAlert({ dir, priceEur }) {
  const above = dir === 'above';
  return {
    id: newAlertId(),
    type: above ? 'price_above' : 'price_below',
    threshold: priceEur,
    dir: 'sell',
    enabled: true,
    label: 'Manuell',
    basis: { kind: 'manual' },
    created_at: new Date().toISOString(),
  };
}

/* +pct → target (price_above) · −pct → stop (price_below), anchored on entry. */
export function buildEntryPctAlert(c, pct) {
  const { value: entry, source } = entryBasisEur(c);
  if (entry == null) return null;
  const threshold = +(entry * (1 + pct / 100)).toFixed(4);
  const up = pct >= 0;
  return {
    id: newAlertId(),
    type: up ? 'price_above' : 'price_below',
    threshold,
    dir: 'sell',
    enabled: true,
    label: `${up ? 'Ziel' : 'Stop'} ${up ? '+' : '−'}${Math.abs(pct)}%`,
    basis: { kind: 'entry_pct', pct, entry, source },
    created_at: new Date().toISOString(),
  };
}

/* Presets. SMA crosses are price-driven (live LS price vs stored SMA level);
   RSI/MACD are pure TV-snapshot indicators. */
export function buildPresetAlert(kind) {
  const base = { id: newAlertId(), enabled: true, basis: { kind: 'preset' }, created_at: new Date().toISOString() };
  switch (kind) {
    case 'sma20':  return { ...base, type: 'ma20_below',  dir: 'buy',  label: 'Kurs ≤ SMA20' };
    case 'sma50':  return { ...base, type: 'ma50_below',  dir: 'buy',  label: 'Kurs ≤ SMA50' };
    case 'sma200': return { ...base, type: 'ma200_below', dir: 'buy',  label: 'Kurs ≤ SMA200' };
    case 'rsi_ob': return { ...base, type: 'rsi_above', threshold: 70, dir: 'sell', label: 'RSI ≥ 70 (überkauft)' };
    case 'rsi_os': return { ...base, type: 'rsi_below', threshold: 30, dir: 'buy',  label: 'RSI ≤ 30 (überverkauft)' };
    case 'macd_up':return { ...base, type: 'macd_bullish', dir: 'buy',  label: 'MACD bullish' };
    case 'macd_dn':return { ...base, type: 'macd_bearish', dir: 'sell', label: 'MACD bearish' };
    default: return null;
  }
}
