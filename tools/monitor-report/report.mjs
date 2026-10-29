/**
 * Monitor-Bericht – reine Logik ohne I/O.
 *
 *   buildReport(cands, stale, now) → Bericht als Objekt (= die JSON-Datei)
 *   renderHtml(report)             → lesbare Kurzfassung (Google Doc)
 *
 * Das Doc wird ausschliesslich aus dem JSON gerendert, damit beide Fassungen
 * nie auseinanderlaufen. ETFs sind bereits herausgefiltert, wenn die Titel
 * hier ankommen; eine Sektor-Übersicht gibt es bewusst nicht mehr — der Sektor
 * steht nur noch als Feld am Titel.
 */

import { computePriceClusters } from '../../ui/lib/price-cluster.js';
import { computeBias } from '../../ui/lib/tv-sentiment.js';
import { isAlertTriggered, alertSummary } from '../../ui/lib/alerts.js';
import {
  pulse, scoreMovers, momMovers, perfLeaders, macdFlips, rsiExtremes, smaCrosses, trends, liveOverallScore,
} from '../../ui/lib/dashboard-metrics.js';
import { trendRadar } from '../../ui/lib/trend-radar.js';

export const SCHEMA = 'discovery-monitor-2.0';
const BRK = 0.005;          // Bruch erst 0,5 % jenseits des Levels (wie Watch Ranges)
const MOVERS = 10;          // Länge der Movers-Listen im JSON
const DOC_TOP = 8;          // Zeilen je Tabelle im Doc
const DOC_LIST = 6;         // Titel je Signalzeile im Doc
const BIG_MOVE = 5;         // |1D| ab dieser Schwelle gilt als Ausreisser
const TZ = 'Europe/Berlin';

/* ── Helfer ───────────────────────────────────────────────────────────────── */

const r2 = (v) => (v == null || !Number.isFinite(+v) ? null : Math.round(+v * 100) / 100);
const r1 = (v) => (v == null || !Number.isFinite(+v) ? null : Math.round(+v * 10) / 10);
const median = (a) => {
  const s = a.filter((v) => v != null && Number.isFinite(v)).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const nameOf = (c) => (c.name && c.name !== c.symbol ? c.name : c.symbol);
const isoDay = (d) => d.toLocaleDateString('sv-SE', { timeZone: TZ });
const weekday = (d) => d.toLocaleDateString('de-DE', { weekday: 'short', timeZone: TZ });

/* Kurzreferenz auf einen Titel – in jeder Signal-Liste gleich aufgebaut. */
const ref = (c) => ({ symbol: c.symbol, name: nameOf(c), sector: c.sector ?? null, bucket: c._bucket });
/* Schlanke Referenz für die Signal-Listen – Sektor und Bucket stehen in `stocks`. */
const sref = (c) => ({ symbol: c.symbol, name: nameOf(c), bucket: c._bucket });

function rangeState(c) {
  const tv = c.tv_data ?? {};
  const p = tv.close;
  if (!(p > 0)) return null;
  const pc = computePriceClusters(tv, { lsHistory: c.ls_history ?? null, refPrice: tv.close_1m ?? p });
  const o = c.range_override ?? {};
  const sup = o.sup > 0 ? +o.sup : pc?.nearestSup?.mid ?? tv.price_52_week_low ?? null;
  const res = o.res > 0 ? +o.res : pc?.nearestRes?.mid ?? tv.price_52_week_high ?? null;
  if (res > 0 && p > res * (1 + BRK)) return { dir: 'up', level: r2(res), pct: r2((p / res - 1) * 100) };
  if (sup > 0 && p < sup * (1 - BRK)) return { dir: 'down', level: r2(sup), pct: r2((p / sup - 1) * 100) };
  return null;
}

/* ── Bericht als Objekt ───────────────────────────────────────────────────── */

export const FIELD_GUIDE = {
  'trading_day': 'Handelstag (Europe/Berlin), auf den sich die Schlusskurse beziehen.',
  'universe': 'Beobachtete Einzelaktien aus Watchlist (watch) und Archiv (archive), ohne ETFs. stale = Titel ohne frische Kurse (Vortageswerte).',
  'breadth': 'Marktbreite der beobachteten Titel: Anzahl steigender/fallender Werte, Mediane der Kursveränderung, Anteil über SMA50/SMA200, Ø Qualitäts-Score 0–100.',
  'earnings_next_7d': 'Angekündigte Quartalszahlen in den nächsten 7 Tagen (Datum laut TradingView; Uhrzeit vor/nach Börse ist nicht bekannt).',
  'movers_1d': 'Grösste Tagesgewinner (top) und -verlierer (flop) nach Kursveränderung zum Vortagesschluss in %.',
  'movers_1w': 'Dasselbe auf Wochensicht (Performance 1 Woche in %).',
  'signals': 'Technische Ereignisse des Tages. range_*: Kurs über Widerstand bzw. unter Unterstützung (level in Notierungswährung, pct = Abstand). macd_*: MACD-Histogramm wechselt das Vorzeichen. sma_cross_*: Kurs- oder Linienkreuzung der gleitenden Durchschnitte. rsi_*: RSI ≤ 30 bzw. ≥ 70. score_*/momentum_*: Veränderung der Scores (0–100) zum Vortag. trend_radar: Titel, die gerade einen Aufwärtstrend ausbilden (fresh = heute frisch gedreht). clean/broken_trends: 1W, 1M und 3M alle positiv bzw. alle negativ. bias_*: gerichtetes Trend-Bias −100…+100, ab ±50. alerts: vom Nutzer gesetzte, heute ausgelöste Kursalarme.',
  'headlines': 'Automatisch erzeugte, rein datenbasierte Kernsätze – ohne Nachrichtenbezug.',
  'stocks': 'Alle Titel mit Kennzahlen. chg_1d/perf_* in %, close in currency, rsi 0–100, score = Qualitäts-Score 0–100 (d_score = Veränderung zum Vortag), bias −100…+100, pt_avg = Analysten-Kursziel Ø, earnings_next = nächster Zahlentermin (ISO-Datum).',
};

export function buildReport(cands, stale, now = new Date()) {
  const tvd = cands.filter((c) => c.tv_data);
  const tv = (c, k) => c.tv_data?.[k] ?? null;

  /* Marktbreite */
  const chg = tvd.map((c) => tv(c, 'change_1d')).filter((v) => v != null);
  const share = (f) => {
    const r = tvd.filter((c) => tv(c, 'close') != null && tv(c, f) != null);
    return r.length ? Math.round(r.filter((c) => c.tv_data.close > c.tv_data[f]).length / r.length * 100) : null;
  };
  const pu = pulse(cands);
  const breadth = {
    advancers: chg.filter((v) => v > 0).length,
    decliners: chg.filter((v) => v < 0).length,
    unchanged: chg.filter((v) => v === 0).length,
    median_chg_1d: r2(median(chg)),
    median_perf_1w: r2(median(tvd.map((c) => tv(c, 'perf_w')))),
    median_perf_1m: r2(median(tvd.map((c) => tv(c, 'perf_1m')))),
    above_sma50_pct: share('sma50'),
    above_sma200_pct: share('sma200'),
    big_moves: chg.filter((v) => Math.abs(v) >= BIG_MOVE).length,
    big_move_threshold_pct: BIG_MOVE,
    avg_score: pu.avg,
    score_up: pu.improved,
    score_down: pu.declined,
  };

  /* Movers */
  const byChg = tvd.filter((c) => tv(c, 'change_1d') != null);
  const mv = (c) => ({ ...ref(c), chg_1d: r2(tv(c, 'change_1d')), perf_1w: r2(tv(c, 'perf_w')), close: r2(tv(c, 'close')), currency: c.currency ?? null });
  const movers_1d = {
    top: byChg.filter((c) => c.tv_data.change_1d > 0).sort((a, b) => b.tv_data.change_1d - a.tv_data.change_1d).slice(0, MOVERS).map(mv),
    flop: byChg.filter((c) => c.tv_data.change_1d < 0).sort((a, b) => a.tv_data.change_1d - b.tv_data.change_1d).slice(0, MOVERS).map(mv),
  };
  const pl = perfLeaders(cands, '1W');
  const wk = (r) => ({ ...ref(r.c), perf_1w: r2(r.perf), perf_1m: r2(tv(r.c, 'perf_1m')) });
  const movers_1w = { top: pl.gainers.slice(0, MOVERS).map(wk), flop: pl.losers.slice(0, MOVERS).map(wk) };

  /* Earnings: ab heute bis +7 Tage */
  const nowS = now.getTime() / 1000;
  const startOfDay = nowS - 86400 / 2;
  const earnings_next_7d = cands
    .map((c) => ({ c, t: Number(tv(c, 'earnings_next_date')) }))
    .filter((x) => x.t > startOfDay && x.t <= nowS + 7 * 86400)
    .sort((a, b) => a.t - b.t)
    .map(({ c, t }) => {
      const d = new Date(t * 1000);
      return { date: isoDay(d), weekday: weekday(d), ...ref(c), chg_1d: r2(tv(c, 'change_1d')), perf_1w: r2(tv(c, 'perf_w')), perf_1m: r2(tv(c, 'perf_1m')), rsi: r1(tv(c, 'rsi')) };
    });

  /* Signale */
  const sm = scoreMovers(cands), mm = momMovers(cands);
  const mf = macdFlips(cands), rx = rsiExtremes(cands), sx = smaCrosses(cands), tr = trends(cands);
  const radar = trendRadar(cands);
  const ranges = cands.map((c) => ({ c, r: rangeState(c) })).filter((x) => x.r);
  const bias = tvd.map((c) => ({ c, b: computeBias(c.tv_data) })).filter((x) => x.b);
  const alerts = [];
  for (const c of cands) for (const a of c.alerts ?? []) {
    if (a.enabled === false) continue;
    try { if (isAlertTriggered(c, a)) alerts.push({ ...sref(c), alert: alertSummary(a) }); } catch { /* unvollständige Daten */ }
  }
  const signals = {
    range_breakout_up: ranges.filter((x) => x.r.dir === 'up').sort((a, b) => b.r.pct - a.r.pct).map((x) => ({ ...sref(x.c), level: x.r.level, pct: x.r.pct })),
    range_break_down: ranges.filter((x) => x.r.dir === 'down').sort((a, b) => a.r.pct - b.r.pct).map((x) => ({ ...sref(x.c), level: x.r.level, pct: x.r.pct })),
    macd_bullish: mf.bullish.map((r) => sref(r.c)),
    macd_bearish: mf.bearish.map((r) => sref(r.c)),
    sma_cross_bullish: sx.bullish.map((r) => ({ ...sref(r.c), cross: r.label })),
    sma_cross_bearish: sx.bearish.map((r) => ({ ...sref(r.c), cross: r.label })),
    rsi_oversold: rx.oversold.map((r) => ({ ...sref(r.c), rsi: r1(r.rsi) })),
    rsi_overbought: rx.overbought.map((r) => ({ ...sref(r.c), rsi: r1(r.rsi) })),
    score_up: sm.risers.map((r) => ({ ...sref(r.c), score: r.overall, delta: r.dOverall })),
    score_down: sm.fallers.map((r) => ({ ...sref(r.c), score: r.overall, delta: r.dOverall })),
    momentum_up: mm.risers.map((r) => ({ ...sref(r.c), momentum: r.mom, delta: r.dMom })),
    momentum_down: mm.fallers.map((r) => ({ ...sref(r.c), momentum: r.mom, delta: r.dMom })),
    trend_radar: radar.rising.map((r) => ({ ...sref(r.c), score: r.score, fresh: r.fresh })),
    clean_trends: tr.clean.map((r) => ({ ...sref(r.c), monthly_growth_pct: r2(r.ogrm) })),
    broken_trends: tr.broken.map((r) => ({ ...sref(r.c), monthly_growth_pct: r2(r.ogrm) })),
    bias_bullish: bias.filter((x) => x.b.score >= 50).sort((a, b) => b.b.score - a.b.score).map((x) => ({ ...sref(x.c), bias: Math.round(x.b.score) })),
    bias_bearish: bias.filter((x) => x.b.score <= -50).sort((a, b) => a.b.score - b.b.score).map((x) => ({ ...sref(x.c), bias: Math.round(x.b.score) })),
    alerts,
  };

  /* Alle Titel */
  const dScore = new Map([...sm.risers, ...sm.fallers].map((r) => [r.c, r.dOverall]));
  const biasOf = new Map(bias.map((x) => [x.c, Math.round(x.b.score)]));
  const stocks = cands.map((c) => {
    const e = Number(tv(c, 'earnings_next_date'));
    const close = tv(c, 'close');
    return {
      ...ref(c), exchange: c.exchange ?? null, currency: c.currency ?? null,
      close: r2(close), chg_1d: r2(tv(c, 'change_1d')), perf_1w: r2(tv(c, 'perf_w')),
      perf_1m: r2(tv(c, 'perf_1m')), perf_3m: r2(tv(c, 'perf_3m')), perf_6m: r2(tv(c, 'perf_6m')),
      rsi: r1(tv(c, 'rsi')),
      above_sma50: close != null && tv(c, 'sma50') != null ? close > c.tv_data.sma50 : null,
      above_sma200: close != null && tv(c, 'sma200') != null ? close > c.tv_data.sma200 : null,
      score: c.tv_data ? liveOverallScore(c.tv_data)?.total ?? null : null,
      d_score: dScore.get(c) ?? null,
      bias: biasOf.get(c) ?? null,
      pt_avg: r2(tv(c, 'pt_average')),
      market_cap: tv(c, 'market_cap'),
      earnings_next: e > 0 ? isoDay(new Date(e * 1000)) : null,
      stale: stale.includes(c),
    };
  }).sort((a, b) => (b.chg_1d ?? -Infinity) - (a.chg_1d ?? -Infinity));

  const nW = cands.filter((c) => c._bucket === 'watch').length;
  const report = {
    schema: SCHEMA,
    generated_at: now.toISOString(),
    trading_day: isoDay(now),
    timezone: TZ,
    source: 'Discovery Workspace – Watchlist + Archiv, Schlusskurse und Indikatoren von TradingView',
    field_guide: FIELD_GUIDE,
    universe: { n: cands.length, watch: nW, archive: cands.length - nW, stale: stale.map((c) => c.symbol) },
    breadth,
    headlines: [],
    earnings_next_7d,
    movers_1d,
    movers_1w,
    signals,
    stocks,
  };
  report.headlines = headlines(report);
  return report;
}

/* ── Textbausteine ────────────────────────────────────────────────────────── */

const fmtNum = (v, d = 1) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtPct = (v, d = 1) => {
  if (v == null || Number.isNaN(+v)) return '–';
  const r = +(+v).toFixed(d);
  return `${r >= 0 ? '+' : '−'}${fmtNum(Math.abs(r), d)} %`;
};
const who = (x) => `${x.name} (${x.symbol})`;
const names = (arr, n = 3) => {
  const s = arr.slice(0, n).map((x) => x.name);
  const rest = arr.length - s.length;
  if (rest > 0) return `${s.join(', ')} und ${rest} weitere`;
  return s.length > 1 ? `${s.slice(0, -1).join(', ')} und ${s.at(-1)}` : (s[0] ?? '');
};

export function headlines(rep) {
  const out = [];
  const b = rep.breadth, n = b.advancers + b.decliners + b.unchanged;

  if (n) {
    const q = Math.round(b.advancers / n * 100);
    const lead = q >= 60 ? 'Freundlicher Handelstag für die beobachteten Werte'
      : q <= 40 ? 'Schwacher Handelstag für die beobachteten Werte'
      : 'Gemischtes Bild bei den beobachteten Werten';
    out.push(`${lead}: ${b.advancers} von ${n} Titeln (${q} %) schlossen im Plus, ${b.decliners} im Minus. Der Median lag bei ${fmtPct(b.median_chg_1d)}, auf Wochensicht bei ${fmtPct(b.median_perf_1w)}.`);
  }

  const [t1, ...tRest] = rep.movers_1d.top;
  if (t1) out.push(`Tagessieger war ${who(t1)} mit ${fmtPct(t1.chg_1d)}${tRest.length ? `, dahinter ${tRest.slice(0, 2).map((x) => `${x.name} (${fmtPct(x.chg_1d)})`).join(' und ')}` : ''}.`);
  const [f1, ...fRest] = rep.movers_1d.flop;
  if (f1) out.push(`Am anderen Ende verlor ${who(f1)} ${fmtNum(Math.abs(f1.chg_1d))} %${fRest.length ? `, ebenfalls deutlich schwächer: ${fRest.slice(0, 2).map((x) => `${x.name} (${fmtPct(x.chg_1d)})`).join(' und ')}` : ''}.`);
  if (b.big_moves) out.push(`${b.big_moves} ${b.big_moves === 1 ? 'Titel bewegte' : 'Titel bewegten'} sich um mehr als ±${b.big_move_threshold_pct} % – hier lohnt der Blick in die Nachrichtenlage.`);

  const w1 = rep.movers_1w.top[0], wl = rep.movers_1w.flop[0];
  if (w1 || wl) out.push(`Auf Wochensicht ${w1 ? `führt ${who(w1)} mit ${fmtPct(w1.perf_1w)}` : 'liegt kein Titel im Plus'}${wl ? `, Schlusslicht ist ${who(wl)} mit ${fmtPct(wl.perf_1w)}` : ''}.`);

  const e = rep.earnings_next_7d;
  out.push(e.length
    ? `In den kommenden sieben Tagen ${e.length === 1 ? 'legt ein Unternehmen' : `legen ${e.length} Unternehmen`} Zahlen vor: ${e.slice(0, 5).map((x) => `${x.name} (${x.weekday})`).join(', ')}${e.length > 5 ? ` und ${e.length - 5} weitere` : ''}.`
    : 'In den kommenden sieben Tagen sind keine Quartalszahlen der beobachteten Unternehmen angekündigt.');

  const s = rep.signals, tech = [];
  if (s.range_breakout_up.length) tech.push(`${s.range_breakout_up.length}× Ausbruch über den Widerstand (${names(s.range_breakout_up)})`);
  if (s.range_break_down.length) tech.push(`${s.range_break_down.length}× Bruch unter die Unterstützung (${names(s.range_break_down)})`);
  const golden = s.sma_cross_bullish.filter((x) => x.cross === 'Golden Cross'), death = s.sma_cross_bearish.filter((x) => x.cross === 'Death Cross');
  if (golden.length) tech.push(`Golden Cross bei ${names(golden)}`);
  if (death.length) tech.push(`Death Cross bei ${names(death)}`);
  if (tech.length) out.push(`Technisch auffällig: ${tech.join('; ')}.`);
  else out.push('Technisch ruhiger Tag: keine Ausbrüche aus den Handelsspannen.');

  const rsi = [];
  if (s.rsi_overbought.length) rsi.push(`überkauft (RSI ≥ 70): ${names(s.rsi_overbought)}`);
  if (s.rsi_oversold.length) rsi.push(`überverkauft (RSI ≤ 30): ${names(s.rsi_oversold)}`);
  if (rsi.length) { const t = rsi.join('; '); out.push(`${t[0].toUpperCase()}${t.slice(1)}.`); }

  if (b.above_sma200_pct != null) {
    out.push(b.above_sma200_pct >= 60
      ? `Das Trendbild bleibt intakt: ${b.above_sma200_pct} % der Titel notieren über ihrer 200-Tage-Linie, ${b.above_sma50_pct ?? '–'} % über der 50-Tage-Linie.`
      : b.above_sma200_pct <= 40
        ? `Das Trendbild ist angeschlagen: nur ${b.above_sma200_pct} % der Titel notieren über ihrer 200-Tage-Linie, ${b.above_sma50_pct ?? '–'} % über der 50-Tage-Linie.`
        : `Das Trendbild ist durchwachsen: ${b.above_sma200_pct} % der Titel notieren über ihrer 200-Tage-Linie, ${b.above_sma50_pct ?? '–'} % über der 50-Tage-Linie.`);
  }
  return out;
}

/* ── Lesbare Kurzfassung (HTML → Google Doc) ──────────────────────────────── */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const POS = '#1a7f37', NEG = '#cf222e', MUTED = '#6e7781', HEAD = '#f3f4f6';
const tone = (v, s) => (v == null || v === 0 ? esc(s) : `<span style="color:${v > 0 ? POS : NEG}">${esc(s)}</span>`);
const tPct = (v) => tone(v, fmtPct(v));
const title = (x) => `<b>${esc(x.name)}</b> <span style="color:${MUTED}">${esc(x.symbol)}${x.bucket === 'archive' ? ' · A' : ''}</span>`;
const short = (x) => `<b>${esc(x.symbol)}</b>${x.bucket === 'archive' ? '<sup>A</sup>' : ''}`;

function table(head, rows) {
  if (!rows.length) return `<p style="color:${MUTED}">–</p>`;
  const th = head.map((h, i) => `<th style="background:${HEAD};text-align:${i ? 'right' : 'left'}">${esc(h)}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((c, i) => `<td style="text-align:${i ? 'right' : 'left'}">${c}</td>`).join('')}</tr>`).join('');
  return `<table border="1" cellpadding="5" style="border-collapse:collapse;width:100%;border-color:#d0d7de"><tr>${th}</tr>${tr}</table>`;
}

const SIGNAL_ROWS = [
  ['range_breakout_up', 'Ausbruch über Widerstand', 'Kurs schliesst über der nächsten Widerstandszone – mögliches Anschlusspotenzial.', (x) => `${short(x)} ${tPct(x.pct)}`],
  ['range_break_down', 'Bruch unter Unterstützung', 'Kurs fällt unter die nächste Unterstützung – Vorsicht, Abwärtsdynamik möglich.', (x) => `${short(x)} ${tPct(x.pct)}`],
  ['trend_radar', 'Trend bildet sich aus', 'Aufwärtstrend nimmt Form an; „frisch" = heute gedreht.', (x) => `${short(x)} ${x.score}${x.fresh ? ' <i>frisch</i>' : ''}`],
  ['sma_cross_bullish', 'Kreuzung nach oben', 'Kurs oder kurze Linie kreuzt eine gleitende Durchschnittslinie aufwärts.', (x) => `${short(x)} ${esc(x.cross)}`],
  ['sma_cross_bearish', 'Kreuzung nach unten', 'Kurs oder kurze Linie fällt unter eine gleitende Durchschnittslinie.', (x) => `${short(x)} ${esc(x.cross)}`],
  ['macd_bullish', 'MACD dreht positiv', 'Momentum wechselt ins Positive.', (x) => short(x)],
  ['macd_bearish', 'MACD dreht negativ', 'Momentum wechselt ins Negative.', (x) => short(x)],
  ['rsi_overbought', 'Überkauft (RSI ≥ 70)', 'Stark gelaufen, Konsolidierung wahrscheinlicher.', (x) => `${short(x)} ${Math.round(x.rsi)}`],
  ['rsi_oversold', 'Überverkauft (RSI ≤ 30)', 'Stark abverkauft, technische Gegenbewegung möglich.', (x) => `${short(x)} ${Math.round(x.rsi)}`],
  ['score_up', 'Score verbessert', 'Qualitäts-Score (0–100) gegenüber Vortag gestiegen.', (x) => `${short(x)} ${tone(1, `+${x.delta}`)}`],
  ['score_down', 'Score verschlechtert', 'Qualitäts-Score gegenüber Vortag gefallen.', (x) => `${short(x)} ${tone(-1, `−${Math.abs(x.delta)}`)}`],
  ['clean_trends', 'Saubere Aufwärtstrends', '1 Woche, 1 Monat und 3 Monate im Plus.', (x) => short(x)],
  ['broken_trends', 'Gebrochene Trends', '1 Woche, 1 Monat und 3 Monate im Minus.', (x) => short(x)],
  ['alerts', 'Ausgelöste Alarme', 'Eigene Kursalarme, die heute gegriffen haben.', (x) => `${short(x)} ${esc(x.alert)}`],
];

export function renderHtml(rep, { jsonName = 'Discovery Monitor.json' } = {}) {
  const day = new Date(rep.generated_at);
  const date = day.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: TZ });
  const time = day.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  const u = rep.universe;

  const moverRows = (arr) => arr.slice(0, DOC_TOP).map((x) => [title(x), esc(x.sector ?? '–'), tPct(x.chg_1d), tPct(x.perf_1w)]);
  const weekRows = (arr) => arr.slice(0, DOC_TOP).map((x) => [title(x), esc(x.sector ?? '–'), tPct(x.perf_1w), tPct(x.perf_1m)]);
  const earnRows = rep.earnings_next_7d.map((x) => [
    `${esc(x.weekday)} ${esc(x.date.slice(8, 10))}.${esc(x.date.slice(5, 7))}. · ${title(x)}`,
    esc(x.sector ?? '–'), tPct(x.perf_1w), tPct(x.perf_1m), x.rsi == null ? '–' : esc(Math.round(x.rsi)),
  ]);

  const sig = SIGNAL_ROWS
    .map(([k, label, hint, fmt]) => {
      const arr = rep.signals[k] ?? [];
      if (!arr.length) return null;
      const more = arr.length > DOC_LIST ? ` <span style="color:${MUTED}">+${arr.length - DOC_LIST}</span>` : '';
      return `<tr><td style="width:34%;vertical-align:top"><b>${esc(label)}</b><br><span style="color:${MUTED};font-size:9pt">${esc(hint)}</span></td><td style="vertical-align:top">${arr.slice(0, DOC_LIST).map(fmt).join(' · ')}${more}</td></tr>`;
    })
    .filter(Boolean);

  return `<html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif">
<h1>Discovery Monitor</h1>
<p><b>${esc(date)}</b> · Stand ${esc(time)} Uhr · ${u.n} Aktien (${u.watch} Watchlist, ${u.archive} Archiv, A = Archiv)</p>

<h2>Auf einen Blick</h2>
<ul>${rep.headlines.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>

<h2>Tagesgewinner</h2>
${table(['Titel', 'Sektor', 'Heute', '1 Woche'], moverRows(rep.movers_1d.top))}

<h2>Tagesverlierer</h2>
${table(['Titel', 'Sektor', 'Heute', '1 Woche'], moverRows(rep.movers_1d.flop))}

<h2>Quartalszahlen in den nächsten 7 Tagen</h2>
${table(['Termin · Titel', 'Sektor', '1 Woche', '1 Monat', 'RSI'], earnRows)}

<h2>Wochenbilanz</h2>
<h3>Stärkste Werte</h3>
${table(['Titel', 'Sektor', '1 Woche', '1 Monat'], weekRows(rep.movers_1w.top))}
<h3>Schwächste Werte</h3>
${table(['Titel', 'Sektor', '1 Woche', '1 Monat'], weekRows(rep.movers_1w.flop))}

<h2>Technische Signale</h2>
${sig.length ? `<table border="1" cellpadding="5" style="border-collapse:collapse;width:100%;border-color:#d0d7de">${sig.join('')}</table>` : `<p style="color:${MUTED}">Heute keine technischen Signale.</p>`}

<p style="color:${MUTED};font-size:9pt">${u.stale.length ? `Ohne frische Kurse (Vortageswerte verwendet): ${esc(u.stale.join(', '))}. ` : ''}Alle Werte sind Schlusskurse laut TradingView; die Kernsätze oben sind automatisch aus den Daten erzeugt und enthalten keine Nachrichten. Die vollständige, maschinenlesbare Fassung liegt als „${esc(jsonName)}" im selben Ordner.</p>
</body></html>`;
}

/* ── Kompakte Fassung für die tägliche KI-Auswertung ──────────────────────────
 * Bei mehreren hundert Titeln wäre das volle JSON ~400 KB (≈ 120k Tokens). Die
 * Tagesfassung kürzt jede Signal-Liste auf SLIM_LIST Einträge (die volle Länge
 * steht in `signal_counts`) und behält in `stocks` nur Titel, die irgendwo im
 * Bericht vorkommen. Die volle Fassung bleibt als eigene Datei erhalten. */
const SLIM_LIST = 12;

export function slimReport(rep) {
  const signals = {}, signal_counts = {};
  for (const [k, arr] of Object.entries(rep.signals)) {
    signal_counts[k] = arr.length;
    signals[k] = arr.slice(0, SLIM_LIST);
  }
  const used = new Set();
  const mark = (arr) => arr.forEach((x) => used.add(x.symbol));
  mark(rep.movers_1d.top); mark(rep.movers_1d.flop);
  mark(rep.movers_1w.top); mark(rep.movers_1w.flop);
  mark(rep.earnings_next_7d);
  Object.values(signals).forEach(mark);
  return {
    ...rep,
    variant: 'compact',
    variant_note: `Kompakte Tagesfassung: Signal-Listen auf ${SLIM_LIST} Einträge gekürzt (volle Länge in signal_counts), stocks nur mit Titeln, die im Bericht vorkommen. Alle Titel stehen in der vollständigen Fassung.`,
    signals,
    signal_counts,
    stocks: rep.stocks.filter((s) => used.has(s.symbol)),
  };
}
