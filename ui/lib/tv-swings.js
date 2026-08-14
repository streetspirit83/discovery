/**
 * tv-swings.js — Swing-Analyse aus echtem OHLC.
 *
 * Spec: docs/SWING_CHECK_HANDOVER.md. On-demand pro Ticker im Detail-Modal. Aus
 * ~1 Jahr Tagesbars werden Fractal-Pivots (Swing-Hochs/Tiefs) erkannt, zu
 * Support-/Resistance-Zonen gemerged (mit `touches` als Signifikanz), die
 * Marktstruktur (up/down/range) klassifiziert und ATR(14) berechnet.
 *
 * Zwei Quellen, weil keine allein reicht:
 * - **US-Titel → TwelveData** `time_series` (direkter CORS-Call). Free-Tier,
 *   aber ausschliesslich US: Nicht-US-Symbole beantwortet TD mit „available
 *   starting with the Grow or Venture plan" (mit echtem Key gegengeprüft).
 * - **Alles andere → Yahoo** `chart/v8` über die scrape-proxy. Liefert dieselben
 *   Tages-OHLC+Volumen für XETR/AMS/SIX/JPX/PAR, ohne Key und ohne Kontingent;
 *   `range=2y` ergibt ~507 Bars, genug für Zonen UND den WARMUP der Bias-Historie.
 *
 * Währung: die Analyse rechnet in der **nativen Währung der Bars** —
 * `analysis.currency` sagt welche. Nichts hier darf USD annehmen; die Anzeige
 * rechnet über diesen Wert um. Der Live-LS-Kurs ist EUR und wird nur als
 * Referenzpreis benutzt, wenn er in die Bar-Währung passt (EUR direkt, USD über
 * die Rate) — sonst ist der letzte Close die Referenz.
 *
 * Reine Rechen-Helfer sind exportiert und ohne Netz testbar; nur die
 * fetch*-Funktionen gehen ins Netz.
 */

import { normalizeExchange } from './exchange-map.js';
import { buildBiasSeries, WARMUP } from './tv-bias-history.js?v=20260807a';

const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX']);
export const MIN_BARS = 20; // need enough history for pivots + ATR

/**
 * US-Ticker? (TwelveData Free liefert nur US-Werte). The exchange field arrives
 * in many spellings (NASDAQ / NasdaqGS / NMS / NYQ / ARCA …), so a strict
 * NASDAQ|NYSE|AMEX match misses real US names. Fall back to the two reliable
 * currency/ISIN signals: US equities trade in USD and (incl. NYSE/NASDAQ-listed
 * ADRs) carry a US ISIN. Known non-US venues are excluded first so a European
 * ticker never slips through on a stray USD field.
 */
const US_EXCHANGE_HINTS = /NASDAQ|NYSE|AMEX|ARCA|BATS|^NMS$|^NGM$|^NCM$|^NYQ$|^PCX$|^ASE$/;
const NON_US_EXCHANGES = new Set(['XETR', 'EURONEXT', 'MIL', 'BME', 'VIE', 'LSE', 'SIX', 'OMXSTO', 'OMXCOP', 'OSL', 'OMXHEX']);
export function isUsTicker(candidate) {
  if (!candidate) return false;
  const ex = normalizeExchange(candidate.exchange || '');
  if (US_EXCHANGES.has(ex) || US_EXCHANGE_HINTS.test(ex)) return true;
  if (NON_US_EXCHANGES.has(ex)) return false;
  const cur = String(candidate.currency || '').toUpperCase();
  if (cur === 'USD') return true;
  if (cur && cur !== 'USD') return false;
  // Last resort: a US ISIN (US-domiciled security / US-issued ADR).
  return /^US[0-9A-Z]{9}[0-9]$/.test(String(candidate.isin || '').trim().toUpperCase());
}

/* ── Pure computation ─────────────────────────────────────────────────── */

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** ATR(14) über OHLC-Bars (Wilder-Mittel der True Range). */
export function computeAtr(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length < 2) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close;
    if (h == null || l == null || pc == null) continue;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (trs.length < period) return trs.length ? trs.reduce((a, b) => a + b, 0) / trs.length : null;
  // Wilder smoothing seeded with the simple mean of the first `period` TRs.
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
  return atr;
}

/**
 * Fractal pivots: a swing high is a bar whose `high` is the max over ±k bars;
 * a swing low is a bar whose `low` is the min over ±k bars. Returns pivots in
 * chronological order with their bar index and price.
 */
export function detectPivots(bars, k = 3) {
  const highs = [], lows = [];
  for (let i = k; i < bars.length - k; i++) {
    const h = bars[i].high, l = bars[i].low;
    if (h == null || l == null) continue;
    let isHigh = true, isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (bars[j].high != null && bars[j].high >= h) isHigh = false;
      if (bars[j].low != null && bars[j].low <= l) isLow = false;
    }
    if (isHigh) highs.push({ i, price: h });
    if (isLow) lows.push({ i, price: l });
  }
  return { highs, lows };
}

/**
 * Merge nearby pivot levels into zones. Tolerance = max(0.5×ATR, 1.5% of ref).
 * `touches` = how many pivots fall inside the zone (its significance).
 * Returns zones sorted low→high: [{ lo, hi, mid, touches }].
 */
export function buildZones(pivots, atr, refPrice) {
  const levels = pivots.map((p) => p.price).filter((v) => v != null).sort((a, b) => a - b);
  if (!levels.length) return [];
  const tol = Math.max(atr != null ? 0.5 * atr : 0, refPrice != null ? 0.015 * refPrice : 0) || (levels[0] * 0.015);

  const zones = [];
  let group = [levels[0]];
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - group[group.length - 1] <= tol) group.push(levels[i]);
    else { zones.push(group); group = [levels[i]]; }
  }
  zones.push(group);

  return zones.map((g) => {
    const lo = g[0], hi = g[g.length - 1];
    const mid = g.reduce((a, b) => a + b, 0) / g.length;
    return { lo, hi, mid, touches: g.length };
  });
}

/** Market structure from the last two swing highs + lows: HH/HL up, LH/LL down. */
export function classifyStructure(highs, lows) {
  if (highs.length < 2 || lows.length < 2) return 'range';
  const h = highs.slice(-2), l = lows.slice(-2);
  const hh = h[1].price > h[0].price, hl = l[1].price > l[0].price;
  const lh = h[1].price < h[0].price, ll = l[1].price < l[0].price;
  if (hh && hl) return 'up';
  if (lh && ll) return 'down';
  return 'range';
}

/**
 * analyzeBars(bars, refPrice, { interval, k }) → the compact swing_analysis
 * object (pure, no network). refPrice is the reference in the bars' own native
 * currency, used for the nearest-zone split and the live marker.
 */
export function analyzeBars(bars, refPrice, { interval = 'daily', k = 3 } = {}) {
  if (!Array.isArray(bars) || bars.length < MIN_BARS) return { error: 'few_bars' };
  const atr = computeAtr(bars);
  const { highs, lows } = detectPivots(bars, k);
  const ref = refPrice ?? bars[bars.length - 1].close;

  const resZones = buildZones(highs, atr, ref).filter((z) => z.mid > ref).sort((a, b) => a.mid - b.mid);
  const supZones = buildZones(lows, atr, ref).filter((z) => z.mid < ref).sort((a, b) => a.mid - b.mid);

  const lo = Math.min(...bars.map((b) => b.low).filter((v) => v != null));
  const hi = Math.max(...bars.map((b) => b.high).filter((v) => v != null));

  return {
    interval,
    domain: { low: lo, high: hi },
    ref_price: ref,
    atr,
    structure: classifyStructure(highs, lows),
    resistance: resZones,
    support: supZones,
    nearest_res: resZones.length ? resZones[0] : null,       // lowest zone above price
    nearest_sup: supZones.length ? supZones[supZones.length - 1] : null, // highest zone below price
    bars: bars.length,
    checked_at: new Date().toISOString(),
  };
}

/* ── Bar-Quellen: TwelveData (US) und Yahoo (alles andere) ──────────────── */

/**
 * Yahoo-Ticker inkl. Börsensuffix. Die Adapter schreiben ihn meist schon als
 * `yahoo_symbol` mit ("SAP.DE"); nur wenn der fehlt, wird er aus der
 * normalisierten Börse abgeleitet.
 *
 * EURONEXT fehlt in der Tabelle mit Absicht: unser kanonischer Code fasst
 * Paris/Amsterdam/Brüssel/Lissabon zusammen, Yahoo trennt sie (.PA/.AS/.BR/.LS).
 * Raten wäre schlimmer als aufgeben — dort zählt allein `yahoo_symbol`.
 */
const YF_SUFFIX = {
  XETR: '.DE', MIL: '.MI', BME: '.MC', VIE: '.VI',
  OMXSTO: '.ST', OMXCOP: '.CO', OSL: '.OL', OMXHEX: '.HE',
  LSE: '.L', SIX: '.SW',
};

export function yahooChartSymbol(candidate) {
  const given = String(candidate?.yahoo_symbol ?? '').trim();
  if (given.includes('.')) return given;              // Adapter hat das Suffix gesetzt
  if (isUsTicker(candidate)) return given || candidate?.symbol || null;  // US: ohne Suffix
  const suffix = YF_SUFFIX[normalizeExchange(candidate?.exchange || '')];
  if (!suffix) return given || null;
  return candidate?.symbol ? `${candidate.symbol}${suffix}` : null;
}

/**
 * Yahoo chart v8 über die scrape-proxy. Liefert echte Tages-OHLC+Volumen auch
 * für XETR/AMS/SIX/JPX — anders als TwelveData Free, das Nicht-US-Symbole hinter
 * dem Grow-Plan sperrt (per Live-Response geprüft).
 *
 * Die Browser-Header sind NICHT optional: ohne `Origin`/`Referer` antwortet
 * Yahoo mit 429, mit ihnen mit 200. Gleiche Header wie in yahoo-trending.js.
 */
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Origin': 'https://finance.yahoo.com',
  'Referer': 'https://finance.yahoo.com/',
};

/** Epoch-Sekunden → 'YYYY-MM-DD'. Für Tagesbars ist der UTC-Tag korrekt: alle
 *  betroffenen Börsen öffnen nach 00:00 UTC (Tokio 09:00 JST = 00:00 UTC). */
const ymd = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);

/* `num()` allein reicht hier NICHT: Number(null) ist 0 und damit finite, d.h.
   Yahoos Feiertags-Löcher (`null` in den quote-Arrays) würden zu Kursen von 0
   — das ergäbe eine Phantom-Zone bei 0 und zöge domain.low mit sich. Deshalb
   null/undefined vorher explizit aussortieren. */
const numOrNull = (v) => (v == null ? null : num(v));

export function parseYahooChart(json) {
  const res = json?.chart?.result?.[0];
  const ts = res?.timestamp;
  const q = res?.indicators?.quote?.[0];
  if (!Array.isArray(ts) || !q) return { bars: [], currency: null };

  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const high = numOrNull(q.high?.[i]);
    const low = numOrNull(q.low?.[i]);
    const close = numOrNull(q.close?.[i]);
    if (high == null || low == null || close == null) continue;  // Feiertage → null-Löcher
    bars.push({
      date: ymd(ts[i]),
      open: numOrNull(q.open?.[i]),
      high, low, close,
      volume: numOrNull(q.volume?.[i]),
    });
  }
  return { bars, currency: res?.meta?.currency ?? null };
}

async function fetchYahooBars(candidate, { backendUrl, secret, range = '2y' }) {
  if (!backendUrl || !secret) return { error: 'no_backend' };
  const symbol = yahooChartSymbol(candidate);
  if (!symbol) return { error: 'no_symbol' };

  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  let wrapper;
  try {
    const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
      body: JSON.stringify({ url: target, method: 'GET', headers: YF_HEADERS }),
    });
    wrapper = await res.json();
  } catch (e) {
    return { error: 'yf_error', message: e.message };
  }
  if (!wrapper?.ok) return { error: 'yf_error', message: wrapper?.error };
  if (wrapper.status === 429) return { error: 'yf_limit' };
  if (wrapper.status !== 200) return { error: 'yf_error', message: `HTTP ${wrapper.status}` };

  let json; try { json = JSON.parse(wrapper.body); } catch { return { error: 'yf_error', message: 'kein JSON' }; }
  const { bars, currency } = parseYahooChart(json);
  if (!bars.length) return { error: 'empty' };
  return { bars, currency, symbol };
}

async function fetchTwelveDataBars(candidate, { interval, outputsize }) {
  const key = localStorage.getItem('discovery_twelvedata_key');
  if (!key) return { error: 'no_key' };

  const params = new URLSearchParams({
    symbol: candidate.symbol, interval, outputsize: String(outputsize), order: 'ASC', apikey: key,
  });
  let data;
  try {
    const res = await fetch(`https://api.twelvedata.com/time_series?${params}`);
    data = await res.json();
  } catch (e) {
    return { error: 'td_error', message: e.message };
  }
  if (data?.status === 'error') {
    if (data.code === 429 || /credit/i.test(data.message || '')) return { error: 'td_limit', message: data.message };
    return { error: 'td_error', message: data.message };
  }
  const values = Array.isArray(data?.values) ? data.values : [];
  if (!values.length) return { error: 'empty' };

  const bars = values.map((v) => ({
    date: v.datetime,
    open: num(v.open), high: num(v.high), low: num(v.low), close: num(v.close), volume: num(v.volume),
  })).filter((b) => b.high != null && b.low != null && b.close != null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return { bars, currency: 'USD' };
}

/**
 * fetchSwingAnalysis(candidate, { interval, outputsize, eurUsd, backendUrl, secret })
 * → analysis object | { error: <code> }.
 *
 * Quelle nach Titel: US → TwelveData (wie bisher, direkter CORS-Call), alles
 * andere → Yahoo über die scrape-proxy. Die Analyse rechnet in der **nativen
 * Währung der Bars**; `analysis.currency` sagt, welche das ist, damit die
 * Anzeige nicht länger USD annehmen muss.
 *
 * refPrice: der Live-LS-Kurs ist EUR und wird nur benutzt, wenn er sich in die
 * Bar-Währung bringen lässt (EUR→EUR direkt, EUR→USD über eurUsd). Für CHF/JPY
 * & Co. gibt es keinen Kurs — dort ist der letzte Close die Referenz.
 */
export async function fetchSwingAnalysis(candidate, {
  interval = '1day', outputsize = 500, eurUsd = null, backendUrl = null, secret = null,
} = {}) {
  const useTd = isUsTicker(candidate);
  const fetched = useTd
    ? await fetchTwelveDataBars(candidate, { interval, outputsize })
    : await fetchYahooBars(candidate, { backendUrl, secret });
  if (fetched.error) return fetched;

  const bars = fetched.bars;
  if (bars.length < MIN_BARS) return { error: 'few_bars' };

  const currency = fetched.currency ?? (useTd ? 'USD' : null);
  const lastClose = bars[bars.length - 1].close;

  // LS quotiert in EUR — nur in EUR- oder (über die Rate) USD-Reihen einsetzbar.
  const lsEur = candidate.ls_quote?.price;
  let refPrice = lastClose;
  let refSource = useTd ? 'td_close' : 'yf_close';
  if (lsEur != null) {
    if (currency === 'EUR') { refPrice = lsEur; refSource = 'ls'; }
    else if (currency === 'USD' && eurUsd) { refPrice = lsEur * eurUsd; refSource = 'ls'; }
  }

  const analysis = analyzeBars(bars, refPrice, { interval: interval === '1week' ? 'weekly' : 'daily' });
  analysis.source = useTd ? 'twelvedata' : 'yahoo';
  analysis.currency = currency;
  analysis.ref_source = refSource;
  // Keep a capped compact OHLCV series (USD) so the detail chart can draw daily
  // candles without re-hitting TD. Short keys keep the blob small (~180 bars).
  analysis.ohlc = bars.slice(-180).map((b) => ({ date: b.date, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }));

  /* Bias-Historie aus den VOLLEN Bars — nicht aus den 180 gespeicherten: SMA200
     und die EMA250-Näherung brauchen ~260 Bars Vorlauf (WARMUP). Persistiert
     wird nur die kompakte Serie [{d,b}] (~3 KB statt ~27 KB Rohbars); der Chart
     lebt weiter von `ohlc`. Deshalb holt der Call oben 500 statt 250 Bars —
     ein TD-Credit deckt die Anfrage unabhängig von outputsize ab. */
  if (interval === '1day' && bars.length > WARMUP) {
    const bh = buildBiasSeries(bars);
    if (bh) analysis.bias_history = bh;
  }
  return analysis;
}

/* ── Visualization (inline SVG price ladder with swing zones) ───────────── */

const fmt = (v) => (v == null || Number.isNaN(v) ? '—'
  : Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const pctTxt = (v) => (v == null || Number.isNaN(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`);

const STRUCTURE_LABEL = { up: '▲ Aufwärts (HH/HL)', down: '▼ Abwärts (LH/LL)', range: '↔ Seitwärts' };

// Herkunft der Bars bzw. des Referenzkurses — sichtbar machen, damit im Sheet
// nie unklar ist, ob eine Zone aus TD- oder Yahoo-Kerzen stammt.
const SOURCE_LABEL = { twelvedata: 'TwelveData', yahoo: 'Yahoo' };
const REF_LABEL = {
  ls: ' · Kurs aus LS',
  td_close: ' · Kurs = letzter Close',
  yf_close: ' · Kurs = letzter Close',
};

/**
 * swingLadderSVG(analysis) → HTML string (SVG ladder + footer). Preise in der
 * nativen Währung der Bars (`analysis.currency`).
 * (TD is US-only). Opacity of each zone band scales with its `touches`.
 */
export function swingLadderSVG(a) {
  if (!a || a.error) return '<p class="pv-empty">Keine Swing-Daten.</p>';
  const { low, high } = a.domain;
  if (low == null || high == null || high <= low) return '<p class="pv-empty">Ungültige Kursspanne.</p>';

  const W = 300, H = 264, top = 16, bottom = H - 16;
  const barX = 44, barW = 60, labelX = barX + barW + 10;
  const span = high - low;
  const yOf = (v) => (v == null ? null : bottom - clamp01((v - low) / span) * (bottom - top));

  const maxTouch = Math.max(2, ...[...a.resistance, ...a.support].map((z) => z.touches));
  const band = (z, side) => {
    const y1 = yOf(z.hi), y2 = yOf(z.lo);
    if (y1 == null || y2 == null) return '';
    const op = (0.18 + 0.6 * (z.touches / maxTouch)).toFixed(2);
    return `<rect x="${(barX - 6).toFixed(1)}" y="${y1.toFixed(1)}" width="${barW + 12}" height="${Math.max(3, y2 - y1).toFixed(1)}"
      class="sw-zone sw-zone--${side}" style="opacity:${op}">
      <title>${side === 'res' ? 'Resistance' : 'Support'} ${fmt(z.lo)}–${fmt(z.hi)} · ${z.touches}× getestet</title></rect>`;
  };
  const bands = [...a.resistance.map((z) => band(z, 'res')), ...a.support.map((z) => band(z, 'sup'))].join('');

  // Nearest-zone labels with distance in % and ATR.
  const ref = a.ref_price;
  const distLabel = (z, side) => {
    if (!z) return '';
    const y = yOf(z.mid);
    const dPct = (z.mid - ref) / ref * 100;
    const dAtr = a.atr ? (z.mid - ref) / a.atr : null;
    return `<text x="${labelX}" y="${(y + 3).toFixed(1)}" class="sw-lbl sw-lbl--${side}">${side === 'res' ? 'R' : 'S'} ${fmt(z.mid)} · ${pctTxt(dPct)}${dAtr != null ? ` · ${Math.abs(dAtr).toFixed(1)}ATR` : ''}</text>`;
  };

  const yc = yOf(ref);
  const curMark = `
    <line x1="${barX - 8}" y1="${yc.toFixed(1)}" x2="${barX + barW}" y2="${yc.toFixed(1)}" class="sw-cur"/>
    <circle cx="${barX - 8}" cy="${yc.toFixed(1)}" r="3.5" class="sw-cur-dot"/>
    <text x="${labelX}" y="${(yc + 3).toFixed(1)}" class="sw-lbl sw-lbl--cur">● ${fmt(ref)}</text>`;

  const svg = `<svg class="sw-ladder" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="Swing-Zonen und aktuelle Kursposition">
    <rect x="${barX}" y="${top}" width="${barW}" height="${(bottom - top).toFixed(1)}" class="sw-bar"/>
    ${bands}${distLabel(a.nearest_res, 'res')}${distLabel(a.nearest_sup, 'sup')}${curMark}
  </svg>`;

  const foot = `<p class="pv-foot">
    Struktur <b>${STRUCTURE_LABEL[a.structure] || a.structure}</b> ·
    ${a.nearest_sup ? `Support <span class="pos">${pctTxt((a.nearest_sup.mid - ref) / ref * 100)}</span>` : 'kein Support'} ·
    ${a.nearest_res ? `Widerstand <span class="neg">${pctTxt((a.nearest_res.mid - ref) / ref * 100)}</span>` : 'kein Widerstand'}
    <br><span class="pv-muted">${a.bars} Bars · ATR ${fmt(a.atr)} · ${esc(a.currency ?? 'USD')} ${SOURCE_LABEL[a.source] ?? 'TwelveData'}${REF_LABEL[a.ref_source] ?? ''}</span>
  </p>`;

  return svg + foot;
}

/** Human-readable message for a fetch/compute error code. */
export function swingErrorText(code) {
  switch (code) {
    case 'no_key':  return 'TwelveData-Key in Einstellungen hinterlegen (nur für US-Titel nötig).';
    case 'not_us':  return 'Swing-Check: nur US-Titel (TwelveData Free).';
    case 'td_limit':return 'TwelveData-Limit erreicht – später erneut.';
    case 'few_bars':return 'Zu wenig Historie für Swing-Zonen.';
    case 'empty':   return 'Keine Kursdaten erhalten.';
    case 'no_backend': return 'Backend nicht konfiguriert – Yahoo läuft über die scrape-proxy.';
    case 'no_symbol':  return 'Kein Yahoo-Symbol: Börsensuffix unbekannt, bitte im Detail-Sheet ergänzen.';
    case 'yf_limit':   return 'Yahoo drosselt gerade (429) – später erneut.';
    case 'yf_error':   return 'Yahoo-Abruf fehlgeschlagen.';
    default:        return 'Swing-Check fehlgeschlagen.';
  }
}
