/**
 * SMA Trend Strength Score 0–100 (seit 26.11.2026) — vergleichbare Trendstärke über hunderte Titel,
 * nur aus SMA20 · SMA50 · SMA100 · SMA200. Alles in Prozent bzw. als Verhältnis, also unabhängig vom
 * Kursniveau und von der Währung.
 *
 * Vier Komponenten (Gewichte in `SMA_TS.W`):
 *   1. Alignment  (30) — bullische Reihenfolge SMA20 > SMA50 > SMA100 > SMA200: Anteil der richtig
 *                        geordneten Paare (6 Paare, ohne SMA100 die 3 Paare aus 20/50/200).
 *   2. Slope      (30) — %-Steigung jeder SMA über 20 Handelstage, je Linie linear von 0 % (0 Punkte)
 *                        bis `SLOPE_CAP` (voll), gewichtet mit `SLOPE_W`. Fallende Linien geben 0.
 *   3. Separation (25) — Abstand SMA20 zu SMA200 in %, linear von 0 % bis `SEP_CAP` (voll).
 *   4. Stability  (15) — Anteil der letzten 20 Handelstage mit bullischer Struktur
 *                        (SMA20 > SMA50 > SMA200, mit SMA100: 20 > 50 > 100 > 200).
 *
 * Historie (für Slope und Stability), in dieser Reihenfolge:
 *   · `swing_analysis.sma` — SMA-Serien aus den Tageskerzen (TwelveData/Yahoo), wenn höchstens
 *     `SWING_FRESH_DAYS` alt und ≥ 21 Punkte;
 *   · `tv_data.sma_hist` — tägliche Scanner-Momentwerte, die jede TV-Anreicherung fortschreibt
 *     (App, Bucket-Refresh, Auto-Rotation; `upsertSmaHist`, bis `HIST_MAX` Handelstage);
 *   · die längere der beiden, wenn keine frisch und vollständig ist.
 * Fehlende Historie: mit 5–19 Tagen wird die Steigung auf 20 Tage hochgerechnet (geometrisch) und die
 * Stabilität über die vorhandenen Tage gezählt; unter 5 Tagen fallen beide Komponenten weg. Der Score
 * wird dann auf die verfügbaren Punkte normiert (`earned / maxAvail × 100`) und als `partial`
 * markiert (Anzeige „~“). Ohne SMA20/50/200 gibt es keinen Score.
 */

export const SMA_TS = {
  W: { align: 30, slope: 30, sep: 25, stab: 15 },
  WINDOW: 20,                                  // Handelstage für Slope und Stability
  MIN_HIST: 5,                                 // darunter keine Slope-/Stabilitätskomponente
  HIST_MAX: 21,                                // so viele Tageswerte hält tv_data.sma_hist (heute + 20 zurück)
  SWING_FRESH_DAYS: 10,                        // Kerzen-Serien gelten so lange als aktuell
  SLOPE_CAP: { 20: 8, 50: 5, 100: 3.5, 200: 2.5 },   // % über 20 Tage für volle Punkte
  SLOPE_W:   { 20: 0.2, 50: 0.3, 100: 0.2, 200: 0.3 },
  SEP_CAP: 25,                                 // % SMA20 über SMA200 für volle Punkte
  STRONG: 70,                                  // Trendstatus: stark ab Score 70 und SMA50 steigend
  WEAK: 40,                                    // unter 40 (oder SMA50 fallend) schwach/negativ
};

export const TREND_STATUS = {
  strong: { label: 'Stark positiv', short: 'stark',       tone: '--pos'  },
  dev:    { label: 'Entwickelnd',   short: 'entwickelnd', tone: '--warn' },
  weak:   { label: 'Schwach / negativ', short: 'schwach', tone: '--neg'  },
};

const P = [20, 50, 100, 200];
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const r5 = (v) => (v == null ? null : Number(v.toPrecision(5)));

/* ── Historie fortschreiben (tv-enrichment → buildUpdates) ─────────────────── */

/**
 * upsertSmaHist(hist, tv, seed) → [[day, s20, s50, s100, s200], …] (neueste zuerst, höchstens HIST_MAX)
 *
 * Ein Eintrag je Tag, der letzte Abruf des Tages gewinnt. Ein neuer Tag mit exakt denselben vier Werten
 * wie der Vortag (Wochenende, Feiertag: kein neuer Bar) ersetzt den Vortag nicht, sondern entfällt —
 * sonst zählten Nicht-Handelstage als Historie. `seed` = `tv_data.snapshot` (5 Tage mit SMA-Feldern),
 * damit die Reihe beim ersten Mal nicht bei null beginnt.
 */
export function upsertSmaHist(hist, tv, seed = null) {
  let rows = Array.isArray(hist) ? hist.filter((r) => Array.isArray(r) && r.length >= 5) : [];
  if (!rows.length && Array.isArray(seed)) {
    for (const s of seed) {                     // snapshot ist neueste zuerst
      const d0 = s?.d ?? (s?.at ? String(s.at).slice(0, 10) : null);
      const d = d0 ? tradingDay(d0) : null;
      if (!d || num(s.sma20) == null || num(s.sma50) == null || num(s.sma200) == null) continue;
      const row = [d, r5(s.sma20), r5(s.sma50), r5(num(s.sma100)), r5(s.sma200)];
      const last = rows[rows.length - 1];
      if (last && last[0] === d) continue;
      if (last && same(last, row)) continue;
      rows.push(row);
    }
  }
  const s20 = num(tv?.sma20), s50 = num(tv?.sma50), s200 = num(tv?.sma200);
  if (s20 == null || s50 == null || s200 == null) return rows.length ? rows.slice(0, SMA_TS.HIST_MAX) : null;
  const day = tradingDay((tv.fetched_at ?? new Date().toISOString()).slice(0, 10));
  const row = [day, r5(s20), r5(s50), r5(num(tv.sma100)), r5(s200)];
  if (rows[0] && rows[0][0] === day) rows[0] = row;
  else if (rows[0] && same(rows[0], row)) { /* kein neuer Handelstag */ }
  else if (!rows[0] || rows[0][0] < day) rows.unshift(row);
  return rows.slice(0, SMA_TS.HIST_MAX);
}
/* Sa/So zählen zum Freitag davor (kein neuer Bar, ein Abruf am Wochenende ersetzt den Freitagswert). */
function tradingDay(day) {
  const d = new Date(`${day}T12:00:00Z`);
  const wd = d.getUTCDay();
  if (wd !== 0 && wd !== 6) return day;
  d.setUTCDate(d.getUTCDate() - (wd === 6 ? 1 : 2));
  return d.toISOString().slice(0, 10);
}
const same = (a, b) => a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4];

/* ── Historie lesen ────────────────────────────────────────────────────────── */

/** Reihen beider Quellen → [{s20,s50,s100,s200}] (älteste zuerst) + Quelle und letzter Tag. */
function histFromSwing(a) {
  const sma = a?.sma;
  if (!sma) return null;
  const get = (n) => sma[n] ?? sma[String(n)];
  const a20 = get(20), a50 = get(50), a200 = get(200), a100 = get(100);
  if (!Array.isArray(a20) || !Array.isArray(a50) || !Array.isArray(a200)) return null;
  const len = Math.min(a20.length, a50.length, a200.length);
  const take = SMA_TS.WINDOW + 1;
  const rows = [];
  for (let i = Math.max(0, len - take); i < len; i++) {
    const r = { s20: num(a20[i]), s50: num(a50[i]), s100: Array.isArray(a100) ? num(a100[i]) : null, s200: num(a200[i]) };
    if (r.s20 != null && r.s50 != null && r.s200 != null) rows.push(r);
  }
  const ohlc = Array.isArray(a.ohlc) ? a.ohlc : null;
  const lastDay = ohlc?.length ? String(ohlc[ohlc.length - 1]?.date ?? '').slice(0, 10) : null;
  return rows.length ? { rows, src: a.source === 'twelvedata' ? 'TwelveData' : a.source === 'yahoo' ? 'Yahoo' : 'Kerzen', lastDay } : null;
}
function histFromScanner(h) {
  if (!Array.isArray(h) || !h.length) return null;
  const rows = h.slice(0, SMA_TS.WINDOW + 1).reverse()
    .map((r) => ({ s20: num(r[1]), s50: num(r[2]), s100: num(r[3]), s200: num(r[4]) }))
    .filter((r) => r.s20 != null && r.s50 != null && r.s200 != null);
  return rows.length ? { rows, src: 'TV-Tageswerte', lastDay: h[0][0] } : null;
}
const ageDays = (day) => (day ? (Date.now() - new Date(`${day}T00:00:00Z`).getTime()) / 864e5 : Infinity);

export function smaHistoryOf(c) {
  const sw = histFromSwing(c?.swing_analysis);
  const tv = histFromScanner(c?.tv_data?.sma_hist);
  const full = SMA_TS.WINDOW + 1;
  if (sw && sw.rows.length >= full && ageDays(sw.lastDay) <= SMA_TS.SWING_FRESH_DAYS) return sw;
  if (tv && tv.rows.length >= full) return tv;
  const cands = [sw && ageDays(sw.lastDay) <= SMA_TS.SWING_FRESH_DAYS ? sw : null, tv].filter(Boolean);
  return cands.sort((a, b) => b.rows.length - a.rows.length)[0] ?? null;
}

/* ── Score ─────────────────────────────────────────────────────────────────── */

const bullish = (r) => r.s20 > r.s50 && r.s50 > r.s200 && (r.s100 == null || (r.s50 > r.s100 && r.s100 > r.s200));

/** Steigung in % über WINDOW Tage aus einer Reihe (älteste zuerst); bei kürzerer Reihe hochgerechnet. */
function slopeOf(rows, key) {
  const pts = rows.map((r) => r[key]);
  let last = pts.length - 1;
  while (last >= 0 && pts[last] == null) last--;
  if (last < 0) return null;
  const want = last - SMA_TS.WINDOW;
  let first = Math.max(0, want);
  while (first < last && pts[first] == null) first++;
  const span = last - first;
  if (span < SMA_TS.MIN_HIST - 1 || pts[first] == null) return null;
  const ratio = pts[last] / pts[first];
  return span >= SMA_TS.WINDOW ? (ratio - 1) * 100 : (ratio ** (SMA_TS.WINDOW / span) - 1) * 100;
}

/**
 * smaTrendScore(c) → null | {
 *   score, partial, status,
 *   parts: { align, slope, sep, stab } (Punkte oder null), max: verfügbare Punkte,
 *   slopes: {20,50,100,200} (% über 20 T), sep (% SMA20 über SMA200), stabDays, stabN,
 *   histDays, src, extrapolated
 * }
 * Ergebnis je Objekt gecacht (nicht-aufzählbar), solange sich tv_data und swing_analysis nicht ändern.
 */
const CACHE = new WeakMap();
export function smaTrendScore(c) {
  if (!c) return null;
  const hit = CACHE.get(c);
  if (hit && hit.tv === c.tv_data && hit.sw === c.swing_analysis) return hit.v;
  const v = compute(c);
  CACHE.set(c, { tv: c.tv_data, sw: c.swing_analysis, v });
  return v;
}

function compute(c) {
  const tv = c.tv_data ?? {};
  const hist = smaHistoryOf(c);
  const lastRow = hist?.rows[hist.rows.length - 1];
  const cur = {
    s20: num(tv.sma20) ?? lastRow?.s20 ?? null,
    s50: num(tv.sma50) ?? lastRow?.s50 ?? null,
    s100: num(tv.sma100) ?? lastRow?.s100 ?? null,
    s200: num(tv.sma200) ?? lastRow?.s200 ?? null,
  };
  if (cur.s20 == null || cur.s50 == null || cur.s200 == null) return null;
  const W = SMA_TS.W;

  // 1 · Alignment: Anteil richtig geordneter Paare (kürzere SMA über längerer).
  const keys = ['s20', 's50', 's100', 's200'].filter((k) => cur[k] != null);
  let pairs = 0, ok = 0;
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) { pairs++; if (cur[keys[i]] > cur[keys[j]]) ok++; }
  const align = (ok / pairs) * W.align;

  // 3 · Separation: SMA20 gegenüber SMA200 in %.
  const sepPct = (cur.s20 / cur.s200 - 1) * 100;
  const sep = clamp01(sepPct / SMA_TS.SEP_CAP) * W.sep;

  // 2 · Slope: je SMA %-Steigung über 20 Handelstage.
  const rows = hist?.rows ?? [];
  // Die Historie endet ggf. vor heute; der heutige Scanner-Wert ersetzt den letzten Punkt nicht, damit
  // die Steigung aus einer Quelle bleibt (Kerzen-SMA und TV-SMA weichen leicht voneinander ab).
  const slopes = {};
  for (const n of P) slopes[n] = rows.length ? slopeOf(rows, `s${n}`) : null;
  let slope = null, extrapolated = false;
  const avail = P.filter((n) => slopes[n] != null);
  if (avail.includes(20) && avail.includes(50) && avail.includes(200)) {
    const wsum = avail.reduce((s, n) => s + SMA_TS.SLOPE_W[n], 0);
    slope = avail.reduce((s, n) => s + SMA_TS.SLOPE_W[n] * clamp01(slopes[n] / SMA_TS.SLOPE_CAP[n]), 0) / wsum * W.slope;
  }
  const span = rows.length ? rows.length - 1 : 0;
  if (slope != null && span < SMA_TS.WINDOW) extrapolated = true;

  // 4 · Stability: Tage mit bullischer Struktur in den letzten 20 Handelstagen.
  let stab = null, stabDays = null, stabN = null;
  const win = rows.slice(-SMA_TS.WINDOW);
  if (win.length >= SMA_TS.MIN_HIST) {
    stabN = win.length;
    stabDays = win.filter(bullish).length;
    stab = (stabDays / stabN) * W.stab;
  }

  const parts = { align, slope, sep, stab };
  const max = W.align + W.sep + (slope != null ? W.slope : 0) + (stab != null ? W.stab : 0);
  const earned = align + sep + (slope ?? 0) + (stab ?? 0);
  const score = Math.round((earned / max) * 100);
  const partial = max < 100 || extrapolated || (stabN != null && stabN < SMA_TS.WINDOW);
  return {
    score, partial, max, parts, slopes, sep: sepPct, stabDays, stabN,
    histDays: span, src: hist?.src ?? null, extrapolated,
    status: statusOf(score, slopes[50]),
  };
}

/** Trendstatus für Farben und Filter: stark = Score ≥ 70 und SMA50 steigend; schwach = Score < 40 oder SMA50 fallend. */
export function statusOf(score, slope50) {
  if (score == null) return null;
  if (score < SMA_TS.WEAK || (slope50 != null && slope50 < 0)) return 'weak';
  if (score >= SMA_TS.STRONG && (slope50 == null || slope50 > 0)) return 'strong';
  return 'dev';
}

/** Markt für Filter: US (NASDAQ/NYSE/AMEX) · Europa · Sonstige. */
const US_EX = new Set(['NASDAQ', 'NYSE', 'AMEX']);
const EU_EX = new Set(['XETR', 'LSE', 'EURONEXT', 'MIL', 'BME', 'VIE', 'OMXSTO', 'SIX', 'OMXCOP', 'OSL', 'OMXHEX', 'FWB', 'TRADEGATE', 'GETTEX']);
export const TREND_MARKETS = [['', 'Alle'], ['us', 'USA'], ['eu', 'Europa'], ['other', 'Sonstige']];
export function marketOf(c) {
  const ex = String(c?.exchange ?? '').toUpperCase();
  if (US_EX.has(ex)) return 'us';
  if (EU_EX.has(ex)) return 'eu';
  return 'other';
}
