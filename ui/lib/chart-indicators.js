/**
 * chart-indicators.js — Indikatoren für den 1J-TD-Kerzenchart (pure Mathe).
 *
 * Alle Funktionen nehmen das TD-OHLC-Array ({date, o, h, l, c}) und liefern
 * Arrays in Chart-Reihenfolge; Werte vor der Warmup-Periode sind null (der
 * Aufrufer mappt auf Lightweight-Charts-Whitespace).
 */

const sma = (vals, i, n) => {
  if (i < n - 1) return null;
  let s = 0;
  for (let j = i - n + 1; j <= i; j++) s += vals[j];
  return s / n;
};

/** Bollinger-Bänder (SMA n ± mult·σ). → [{mid, upper, lower}|null] */
export function bollinger(ohlc, n = 20, mult = 2) {
  const closes = ohlc.map((b) => b.c);
  return closes.map((_, i) => {
    const m = sma(closes, i, n);
    if (m == null) return null;
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (closes[j] - m) ** 2;
    const sd = Math.sqrt(v / n);
    return { mid: m, upper: m + mult * sd, lower: m - mult * sd };
  });
}

/** Wilder-ATR als Basis für den Supertrend. */
function atrSeries(ohlc, n) {
  const tr = ohlc.map((b, i) => (i === 0
    ? b.h - b.l
    : Math.max(b.h - b.l, Math.abs(b.h - ohlc[i - 1].c), Math.abs(b.l - ohlc[i - 1].c))));
  const out = new Array(ohlc.length).fill(null);
  let a = null;
  for (let i = 0; i < tr.length; i++) {
    if (i === n - 1) a = tr.slice(0, n).reduce((s, v) => s + v, 0) / n;
    else if (i >= n) a = (a * (n - 1) + tr[i]) / n;
    out[i] = i >= n - 1 ? a : null;
  }
  return out;
}

/** Supertrend (Periode n, Multiplikator mult). → [{value, up:boolean}|null]
 * up=true: Linie unter dem Kurs (Aufwärtstrend, grün), sonst darüber (rot). */
export function supertrend(ohlc, n = 10, mult = 3) {
  const atr = atrSeries(ohlc, n);
  const out = new Array(ohlc.length).fill(null);
  let upBand = null, loBand = null, trendUp = true, prev = null;
  for (let i = 0; i < ohlc.length; i++) {
    if (atr[i] == null) continue;
    const mid = (ohlc[i].h + ohlc[i].l) / 2;
    let bu = mid + mult * atr[i];
    let bl = mid - mult * atr[i];
    // Bänder "ratchen": dürfen sich nur in Trendrichtung bewegen.
    if (prev != null) {
      if (ohlc[i - 1].c > (upBand ?? Infinity) || bu < upBand) upBand = bu; else bu = upBand;
      if (ohlc[i - 1].c < (loBand ?? -Infinity) || bl > loBand) loBand = bl; else bl = loBand;
    }
    upBand = bu; loBand = bl;
    if (prev != null) {
      if (trendUp && ohlc[i].c < loBand) trendUp = false;
      else if (!trendUp && ohlc[i].c > upBand) trendUp = true;
    } else {
      trendUp = ohlc[i].c >= mid;
    }
    const value = trendUp ? loBand : upBand;
    out[i] = { value, up: trendUp };
    prev = value;
  }
  return out;
}

/** CCI (Commodity Channel Index, Periode n). → [number|null] */
export function cci(ohlc, n = 20) {
  const tp = ohlc.map((b) => (b.h + b.l + b.c) / 3);
  return tp.map((_, i) => {
    const m = sma(tp, i, n);
    if (m == null) return null;
    let dev = 0;
    for (let j = i - n + 1; j <= i; j++) dev += Math.abs(tp[j] - m);
    const md = dev / n;
    return md ? (tp[i] - m) / (0.015 * md) : 0;
  });
}
