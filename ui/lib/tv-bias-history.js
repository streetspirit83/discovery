/**
 * tv-bias-history.js — historisches Bias aus TwelveData-Tagesbars.
 *
 * Warum: das Bias in der Tabelle ist ein Punkt-in-Zeit-Wert. „Seit wann läuft
 * der Trend?" beantwortet nur eine Zeitreihe, und die haben wir sonst nicht
 * (tv_data.snapshot hält 5 Tage, ls_history 10). TwelveData liefert für
 * US-Titel echtes OHLC — daraus lassen sich alle Bias-Inputs für JEDEN
 * vergangenen Tag nachrechnen und durch dieselbe computeBias() schicken.
 *
 * Ergebnis ist eine kompakte Serie [{ d, b }] (Datum, Bias −100…+100). Nur die
 * wird persistiert (~3 KB für 250 Tage) — die Rohbars bleiben bei 180 für den
 * Chart, sonst würde der Blob pro Ticker um ~27 KB wachsen.
 *
 * GRENZEN, die im UI benannt werden müssen:
 *  • Warmlaufzeit: SMA200 braucht 200 Bars, die EMA250-Näherung 250. Die Serie
 *    beginnt deshalb erst ab Bar WARMUP — bei 500 geholten Bars sind das ~240
 *    verwertbare Tage.
 *  • Der Weekly-EMA-Stack wird über Tages-EMAs mit 5-facher Periode genähert
 *    (EMA20|1W ≈ EMA100 täglich, EMA50|1W ≈ EMA250 täglich). EMA200|1W wären
 *    ~1000 Tagesbars — nicht erreichbar, dieser Teilcheck bleibt null. Das
 *    level()-Mittel in tv-sentiment lässt fehlende Teilwerte aus, das
 *    historische Regime stützt sich hier also auf zwei statt drei Checks.
 *  • Kurse sind USD (TD-Rohdaten). Für das Bias irrelevant — es rechnet nur
 *    mit Verhältnissen, nie mit absoluten Beträgen.
 */

import { computeBias } from './tv-sentiment.js?v=20260803d';

/** Bars, die vor dem ersten verwertbaren Bias-Wert verbraucht werden. */
export const WARMUP = 260;

/* ── Indikatoren (alle: Array rein, Array gleicher Länge raus, null = zu früh) ── */

function smaArr(vals, n) {
  const out = new Array(vals.length).fill(null);
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i];
    if (i >= n) sum -= vals[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/* EMA mit SMA-Seed — ohne Seed hinge der erste Wert komplett am ersten Kurs. */
function emaArr(vals, n) {
  const out = new Array(vals.length).fill(null);
  if (vals.length < n) return out;
  const k = 2 / (n + 1);
  let prev = vals.slice(0, n).reduce((s, v) => s + v, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < vals.length; i++) {
    prev = vals[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/* RSI nach Wilder. */
function rsiArr(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + (d > 0 ? d : 0)) / n;
    loss = (loss * (n - 1) + (d < 0 ? -d : 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function macdArr(closes, fast = 12, slow = 26, sig = 9) {
  const ef = emaArr(closes, fast), es = emaArr(closes, slow);
  const macd = closes.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  // Signal-EMA nur über den belegten Teil, dann zurückschreiben.
  const start = macd.findIndex((v) => v != null);
  const signal = new Array(closes.length).fill(null);
  if (start >= 0) {
    const seg = emaArr(macd.slice(start), sig);
    seg.forEach((v, j) => { signal[start + j] = v; });
  }
  return { macd, signal };
}

/* ADX + DI nach Wilder. DI trägt die Richtung, ADX nur die Stärke. */
function adxArr(bars, n = 14) {
  const len = bars.length;
  const adx = new Array(len).fill(null);
  const plusDI = new Array(len).fill(null);
  const minusDI = new Array(len).fill(null);
  if (len <= n * 2) return { adx, plusDI, minusDI };

  const tr = [0], pDM = [0], mDM = [0];
  for (let i = 1; i < len; i++) {
    const up = bars[i].high - bars[i - 1].high;
    const dn = bars[i - 1].low - bars[i].low;
    pDM.push(up > dn && up > 0 ? up : 0);
    mDM.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close),
    ));
  }

  let atr = 0, ap = 0, am = 0;
  for (let i = 1; i <= n; i++) { atr += tr[i]; ap += pDM[i]; am += mDM[i]; }
  const dxs = [];
  for (let i = n; i < len; i++) {
    if (i > n) {
      atr = atr - atr / n + tr[i];
      ap  = ap  - ap  / n + pDM[i];
      am  = am  - am  / n + mDM[i];
    }
    if (atr === 0) continue;
    const pdi = 100 * ap / atr, mdi = 100 * am / atr;
    plusDI[i] = pdi; minusDI[i] = mdi;
    const sum = pdi + mdi;
    const dx = sum === 0 ? 0 : 100 * Math.abs(pdi - mdi) / sum;
    dxs.push({ i, dx });
    if (dxs.length === n) {
      adx[i] = dxs.reduce((s, x) => s + x.dx, 0) / n;
    } else if (dxs.length > n) {
      adx[i] = (adx[i - 1] * (n - 1) + dx) / n;
    }
  }
  return { adx, plusDI, minusDI };
}

/* Aroon: misst die Zeit seit dem Periodenextrem — 100 = Extrem ist heute. */
function aroonArr(bars, n = 14) {
  const up = new Array(bars.length).fill(null);
  const down = new Array(bars.length).fill(null);
  for (let i = n; i < bars.length; i++) {
    let hi = -Infinity, lo = Infinity, hiI = i, loI = i;
    for (let j = i - n; j <= i; j++) {
      if (bars[j].high > hi) { hi = bars[j].high; hiI = j; }
      if (bars[j].low < lo) { lo = bars[j].low; loI = j; }
    }
    up[i] = 100 * (n - (i - hiI)) / n;
    down[i] = 100 * (n - (i - loI)) / n;
  }
  return { up, down };
}

const pctChange = (arr, i, back) =>
  (i - back >= 0 && arr[i - back] ? (arr[i] / arr[i - back] - 1) * 100 : null);

/**
 * buildBiasSeries(bars) → { series:[{d,b}], warmup, from, to } | null
 * bars: [{ date, open, high, low, close, volume }] aufsteigend sortiert.
 */
export function buildBiasSeries(bars) {
  if (!Array.isArray(bars) || bars.length <= WARMUP) return null;

  const closes = bars.map((b) => b.close);
  const vols   = bars.map((b) => b.volume ?? 0);

  const sma50 = smaArr(closes, 50), sma200 = smaArr(closes, 200);
  const ema20 = emaArr(closes, 20), ema50 = emaArr(closes, 50), ema200 = emaArr(closes, 200);
  // Weekly-Näherung über 5-fache Tagesperiode (siehe Modul-Kopf).
  const ema100 = emaArr(closes, 100), ema250 = emaArr(closes, 250);
  const rsi = rsiArr(closes);
  const { macd, signal } = macdArr(closes);
  const { adx, plusDI, minusDI } = adxArr(bars);
  const aroon = aroonArr(bars);
  const vol10 = smaArr(vols, 10), vol30 = smaArr(vols, 30);

  const series = [];
  for (let i = WARMUP; i < bars.length; i++) {
    const tv = {
      close:   closes[i],
      sma50:   sma50[i],
      sma200:  sma200[i],
      ema20:   ema20[i],
      ema50:   ema50[i],
      ema200:  ema200[i],
      ema20_1w:  ema100[i],
      ema50_1w:  ema250[i],
      ema200_1w: null,      // ~1000 Tagesbars — nicht erreichbar
      adx: adx[i], adx_plus_di: plusDI[i], adx_minus_di: minusDI[i],
      aroon_up: aroon.up[i], aroon_down: aroon.down[i],
      perf_1m:   pctChange(closes, i, 21),
      perf_w:    pctChange(closes, i, 5),
      change_1d: pctChange(closes, i, 1),
      macd: macd[i], macd_signal: signal[i], rsi: rsi[i],
      avg_vol_10d: vol10[i], average_volume_30d_calc: vol30[i],
    };
    const b = computeBias(tv);
    if (b) series.push({ d: bars[i].date, b: b.score });
  }
  if (!series.length) return null;
  return { series, warmup: WARMUP, from: series[0].d, to: series[series.length - 1].d };
}

/* ── Regime-Statistik ─────────────────────────────────────────────────────── */

/**
 * regimeStats(series, band) → Phasen gleicher Richtung + Einordnung der laufenden.
 *
 * Neutrale Tage (|b| ≤ band) erben die vorherige Richtung. Ohne das zerfiele
 * jede Phase an jedem Nulldurchgang in Schnipsel und die Ø-Dauer wäre Unsinn.
 */
export function regimeStats(series, band = 10) {
  if (!Array.isArray(series) || series.length < 2) return null;

  let dir = 0;
  const phases = [];
  for (const p of series) {
    if (p.b > band) dir = 1;
    else if (p.b < -band) dir = -1;
    if (!dir) continue;                       // Vorlauf bis zur ersten Richtung
    const last = phases[phases.length - 1];
    if (last && last.dir === dir) { last.end = p.d; last.days++; }
    else phases.push({ dir, start: p.d, end: p.d, days: 1 });
  }
  if (!phases.length) return null;

  const current = phases[phases.length - 1];
  const done = phases.slice(0, -1);
  const bull = done.filter((p) => p.dir === 1);
  const bear = done.filter((p) => p.dir === -1);
  const avg = (a) => (a.length ? a.reduce((s, p) => s + p.days, 0) / a.length : null);

  // Wie viele abgeschlossene Phasen gleicher Richtung waren KÜRZER als die
  // laufende? Das ordnet „seit 47 Tagen" ein, statt es nur zu behaupten.
  const same = done.filter((p) => p.dir === current.dir);
  const percentile = same.length
    ? Math.round(100 * same.filter((p) => p.days < current.days).length / same.length)
    : null;

  return {
    phases, current, flips: phases.length - 1,
    avgBull: avg(bull), avgBear: avg(bear),
    countBull: bull.length, countBear: bear.length,
    percentile,
  };
}

/* ── Divergenz ────────────────────────────────────────────────────────────── */

/**
 * detectDivergence(bars, pivots) → { kind:'bear'|'bull', … } | null
 * Bearish: höheres Kurshoch, aber niedrigerer RSI am Hoch (Kraft lässt nach).
 * Bullish: tieferes Kurstief, aber höherer RSI am Tief.
 *
 * Die Pivots kommen als Argument herein (detectPivots aus tv-swings.js) — sonst
 * importierten sich die beiden Module gegenseitig, weil tv-swings die
 * Bias-Historie beim Fetch baut.
 */
export function detectDivergence(bars, pivots) {
  if (!Array.isArray(bars) || bars.length < 40 || !pivots) return null;
  const rsi = rsiArr(bars.map((b) => b.close));
  const { highs = [], lows = [] } = pivots;

  const pair = (pts) => (pts.length >= 2 ? pts.slice(-2) : null);
  const hh = pair(highs), ll = pair(lows);

  if (hh && rsi[hh[0].i] != null && rsi[hh[1].i] != null
      && hh[1].price > hh[0].price && rsi[hh[1].i] < rsi[hh[0].i] - 2) {
    return { kind: 'bear', prev: hh[0], last: hh[1], rsiPrev: rsi[hh[0].i], rsiLast: rsi[hh[1].i],
             date: bars[hh[1].i].date };
  }
  if (ll && rsi[ll[0].i] != null && rsi[ll[1].i] != null
      && ll[1].price < ll[0].price && rsi[ll[1].i] > rsi[ll[0].i] + 2) {
    return { kind: 'bull', prev: ll[0], last: ll[1], rsiPrev: rsi[ll[0].i], rsiLast: rsi[ll[1].i],
             date: bars[ll[1].i].date };
  }
  return null;
}
