/**
 * eur-basis.js — EUR-Kursbasis für Titel, die weder in EUR noch in USD notieren
 * (z. B. Sivers in SEK, Funding Circle in GBX). USD↔EUR deckt der Live-Kurs
 * EUR/USD ab; für alles andere gab es bisher keine Umrechnung, die Range-
 * Ansicht zeigte solche Titel deshalb nativ.
 *
 * Quellen in dieser Reihenfolge (geprüft gegen Live-Antworten, Okt. 2026):
 *   1. Lang & Schwarz `series=history` — Tagesschlusskurse in EUR seit ~2 Jahren
 *      (`series.history.data` = [[ms, preis], …], letzter Punkt = intraday
 *      jetzt). Der Kurs, zu dem man auf Trade Republic tatsächlich handelt.
 *   2. Yahoo, deutsches Listing (`.DE`, `.F`, `.MU`, …) — per ISIN findet Yahoos
 *      Suche nur das Heimatlisting (SIVE.ST), per Name auch 2DG.F/2DG.DU/2DG.SG.
 *      Weil die Namenssuche danebengreifen kann, muss das Listing beim
 *      implizierten Wechselkurs auf ±20 % zum echten Kurs passen.
 *   3. Heimat-Kerzen × Tages-Wechselkurs (Yahoo `SEKEUR=X`).
 *
 * `f` rechnet einen Preis in Notierungs-Einheit des Titels (wie in tv_data, also
 * GBX statt GBP an der LSE) in EUR um. Bei 1./2. ist das das implizierte
 * Verhältnis EUR-Schluss / Heimat-Schluss (Median über die letzten
 * gemeinsamen Handelstage) — das gleicht Einheiten wie Pence automatisch aus.
 *
 * Ergebnis (persistiert als `candidate.eur_basis`):
 *   { src:'ls'|'yahoo'|'fx', sym, t:['YYYY-MM-DD',…], c:[eur,…], f, at }
 *   | { error, at }
 */

import { resolveInstrumentId } from './ls-intraday.js?v=20261026a';
import { normalizeExchange } from './exchange-map.js';

export const EUR_BASIS_MS = 20 * 60 * 60 * 1000;
const KEEP = 260;                      // ~1 Jahr Schlusskurse (Chart 1J + 52W-Extrem)
const DE_SUFFIX = ['DE', 'F', 'MU', 'SG', 'DU', 'BE', 'HM', 'HA'];

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.5',
  'Origin': 'https://finance.yahoo.com',
  'Referer': 'https://finance.yahoo.com/',
};

const pos = (v) => (v != null && Number.isFinite(+v) && +v > 0 ? +v : null);
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

export function needsEurBasis(c) {
  const ccy = String(c?.currency ?? '').toUpperCase();
  return !!ccy && ccy !== 'EUR' && ccy !== 'USD';
}

export function eurBasisFresh(c, now = Date.now()) {
  const at = Date.parse(c?.eur_basis?.at ?? '');
  return Number.isFinite(at) && now - at < EUR_BASIS_MS;
}

export const EUR_BASIS_LABEL = { ls: 'LS-Kurse', yahoo: 'Yahoo', fx: 'Wechselkurs' };

async function proxyGet(url, { backendUrl, secret }, headers = { 'User-Agent': 'Mozilla/5.0' }) {
  try {
    const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
      body: JSON.stringify({ url, method: 'GET', headers }),
    });
    const w = await res.json();
    if (!w?.ok || w.status !== 200) return null;
    return JSON.parse(w.body);
  } catch {
    return null;
  }
}

// Reihe [[date, close], …] → { t, c }, je Tag der letzte Wert, aufsteigend.
function toSeries(pairs) {
  const m = new Map();
  for (const [d, v] of pairs) if (d && pos(v)) m.set(d, +v);
  const t = [...m.keys()].sort();
  return { t, c: t.map((d) => m.get(d)) };
}

async function lsSeries(c, auth) {
  const id = await resolveInstrumentId(c, auth);
  if (id == null) return null;
  const j = await proxyGet(`https://www.ls-tc.de/_rpc/json/instrument/chart/dataForInstrument?instrumentId=${encodeURIComponent(id)}&series=history`, auth);
  const pts = j?.series?.history?.data;
  if (!Array.isArray(pts) || pts.length < 30) return null;
  return { ...toSeries(pts.filter(Array.isArray).map(([ms, p]) => [day(ms), p])), sym: `LS ${id}` };
}

/**
 * fetchLsDays(candidate, { backendUrl, secret }) → { t, c, at } — die letzten 10
 * LS-Tagesschlusskurse (EUR), nur für die 5-Tage-Richtung im Ranges-Modal.
 * Eine Proxy-Runde (Instrument-ID wird wiederverwendet), keine Fremdquelle.
 */
export async function fetchLsDays(c, { backendUrl, secret } = {}) {
  const at = new Date().toISOString();
  if (!backendUrl || !secret) return { error: 'no_backend', at };
  const s = await lsSeries(c, { backendUrl, secret });
  if (!s) return { error: 'none', at };
  return { t: s.t.slice(-10), c: s.c.slice(-10).map((v) => +v.toFixed(4)), at };
}

async function yahooChart(sym, auth) {
  const j = await proxyGet(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1d`, auth, YF_HEADERS);
  const r = j?.chart?.result?.[0];
  const ts = r?.timestamp, cl = r?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(ts) || !Array.isArray(cl)) return null;
  // Feiertage liefern null — vor jeder Zahlwandlung aussortieren (Number(null) = 0).
  const s = toSeries(ts.map((x, i) => [day(x * 1000), cl[i] == null ? null : cl[i]]));
  return { ...s, currency: r.meta?.currency ?? null };
}

// Deutsches EUR-Listing über die Yahoo-Namenssuche.
async function yahooEurListing(c, auth) {
  const known = c.eur_basis?.src === 'yahoo' ? c.eur_basis.sym : null;
  const cands = [];
  if (known) cands.push(known);
  const name = String(c.name ?? '').replace(/\(publ\)/gi, '').replace(/[^\p{L}\p{N}&\s.-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (name) {
    const j = await proxyGet(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}&quotesCount=20&newsCount=0`, auth, YF_HEADERS);
    const syms = (j?.quotes ?? [])
      .filter((q) => q?.quoteType === 'EQUITY' && typeof q.symbol === 'string')
      .map((q) => q.symbol)
      .filter((s) => DE_SUFFIX.includes(s.split('.').pop()))
      .sort((a, b) => DE_SUFFIX.indexOf(a.split('.').pop()) - DE_SUFFIX.indexOf(b.split('.').pop()));
    for (const s of syms) if (!cands.includes(s)) cands.push(s);
  }
  for (const sym of cands.slice(0, 3)) {
    const s = await yahooChart(sym, auth);
    if (s && s.currency === 'EUR' && s.t.length >= 30) return { t: s.t, c: s.c, sym };
  }
  return null;
}

// Notierungs-Einheit → Wechselkurs-Paar (GBX/GBp = Pence).
function fxPair(c) {
  const bars = String(c.swing_analysis?.currency ?? '');
  const ccy = String(c.currency ?? '').toUpperCase();
  const pence = bars === 'GBp' || bars.toUpperCase() === 'GBX' || ccy === 'GBX'
    || (ccy === 'GBP' && !bars && normalizeExchange(c.exchange || '') === 'LSE');
  return { pair: pence ? 'GBP' : ccy, mult: pence ? 0.01 : 1 };
}

async function fxSeries(c, auth) {
  const { pair, mult } = fxPair(c);
  if (!pair || pair === 'EUR') return null;
  const s = await yahooChart(`${pair}EUR=X`, auth);
  if (!s || !s.t.length) return null;
  return { ...s, mult };
}

// Heimat-Schlusskurse (Kerzen aus dem Detail-Sheet), auf die tv_data-Einheit gebracht.
function nativeCloses(c) {
  const bars = Array.isArray(c.swing_analysis?.ohlc) ? c.swing_analysis.ohlc.filter((b) => b?.date && pos(b.c)) : [];
  if (!bars.length) return null;
  const tvClose = pos(c.tv_data?.close_1m ?? c.tv_data?.close);
  let adj = 1;
  if (tvClose) {
    const r = tvClose / bars[bars.length - 1].c;
    if (r > 50 && r < 200) adj = 100; else if (r > 0.005 && r < 0.02) adj = 0.01;
  }
  return new Map(bars.map((b) => [String(b.date).slice(0, 10), b.c * adj]));
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// EUR je Notierungs-Einheit aus einer EUR-Reihe: Median über bis zu 20 gemeinsame Tage.
function impliedFactor(c, s) {
  const nat = nativeCloses(c);
  if (nat) {
    const r = [];
    for (let i = s.t.length - 1; i >= 0 && r.length < 20; i--) {
      const n = nat.get(s.t[i]);
      if (n) r.push(s.c[i] / n);
    }
    if (r.length >= 3) return median(r);
  }
  const tv = pos(c.tv_data?.close_1m ?? c.tv_data?.close);
  return tv ? s.c[s.c.length - 1] / tv : null;
}

const rateAt = (fx, d) => {
  // letzter bekannter Kurs am oder vor dem Tag
  let lo = 0, hi = fx.t.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (fx.t[m] <= d) { k = m; lo = m + 1; } else hi = m - 1; }
  return k >= 0 ? fx.c[k] : null;
};

/**
 * fetchEurBasis(candidate, { backendUrl, secret }) → eur_basis-Objekt (siehe oben).
 * Nutzt, falls vorhanden, die Heimat-Kerzen (`swing_analysis.ohlc`) für den
 * implizierten Faktor — deshalb nach den Kerzen aufrufen.
 */
export async function fetchEurBasis(c, { backendUrl, secret } = {}) {
  const at = new Date().toISOString();
  if (!backendUrl || !secret) return { error: 'no_backend', at };
  const auth = { backendUrl, secret };
  const keep = (s) => ({ t: s.t.slice(-KEEP), c: s.c.slice(-KEEP).map((v) => +v.toFixed(4)) });

  const ls = await lsSeries(c, auth);
  if (ls) {
    const f = impliedFactor(c, ls);
    if (f) return { src: 'ls', sym: ls.sym, ...keep(ls), f: +f.toPrecision(8), at };
  }

  const fx = await fxSeries(c, auth);
  const fxNow = fx ? fx.c[fx.c.length - 1] * fx.mult : null;

  const yh = await yahooEurListing(c, auth);
  if (yh) {
    const f = impliedFactor(c, yh);
    // Namenssuche kann danebengreifen: das Listing muss zum echten Wechselkurs passen.
    if (f && (!fxNow || Math.abs(f / fxNow - 1) < 0.2)) return { src: 'yahoo', sym: yh.sym, ...keep(yh), f: +f.toPrecision(8), at };
  }

  if (fx && fxNow) {
    const nat = nativeCloses(c);
    const pairs = nat ? [...nat.entries()].map(([d, v]) => { const r = rateAt(fx, d); return [d, r ? v * r * fx.mult : null]; }) : [];
    const s = toSeries(pairs);
    return { src: 'fx', sym: `${fxPair(c).pair}EUR=X`, ...keep(s), f: +fxNow.toPrecision(8), at };
  }
  return { error: 'none', at };
}
