/**
 * range-levels.js — Rechnung hinter Watch Ranges, gemeinsam für Modal und Liste.
 *
 * Support, Resistance und Bruch-Logik wie im Artefakt: computePriceClusters um den
 * TV-Schluss, Fallback 52W-Extrem, manuelle Levels aus `range_override`. Rein und
 * ohne Zustand; die Darstellung liegt bei den Aufrufern.
 */

import { computePriceClusters } from './price-cluster.js?v=20260807a';
import { needsEurBasis } from './eur-basis.js?v=20261027c';

export const num = (v) => (v != null && Number.isFinite(+v) && +v > 0 ? +v : null);
export function r4(x) { return Math.floor(x * 1e4 + 0.5) / 1e4; }

/* Bruch-Logik – identisch zum Artefakt (und dessen Alarm-Abgleich). Bruch erst ab 0,5 % jenseits des Levels. */
export const BRK = 0.005;
const ZONE = 0.015, PW = 5;

// Native Währung → EUR. Nur USD↔EUR ist umrechenbar (siehe „LS = EUR" in CLAUDE.md).
export function eurFactor(ccy, fx) {
  if (!ccy || ccy === 'EUR') return 1;
  if (ccy === 'USD' && fx) return 1 / fx;
  return null;
}

export function buildRangeItem(c, fx) {
  const tv = c.tv_data ?? {};
  const ccy = String(c.currency ?? '').toUpperCase() || null;
  const eb = c.eur_basis && num(c.eur_basis.f) ? c.eur_basis : null;
  const fE0 = eb && needsEurBasis(c) ? +eb.f : eurFactor(ccy, fx);
  const conv = fE0 != null;
  const fE = conv ? fE0 : 1;                    // nicht umrechenbar → native Anzeige, ohne LS
  const pN = num(tv.close_1m ?? tv.close);
  // Wie watch-ranges.js: LS-Historie (EUR) → native über lsToNative.
  const lsToNative = conv ? 1 / fE : null;
  const pc = pN ? computePriceClusters(tv, { lsHistory: c.ls_history ?? null, refPrice: pN, lsToNative }) : null;
  const lo52 = num(tv.price_52_week_low), hi52 = num(tv.price_52_week_high);
  const ns = pc?.nearestSup, nr = pc?.nearestRes;
  const asN = ns ? ns.mid : lo52, arN = nr ? nr.mid : hi52;
  const labels = (z) => (z?.members ?? []).map((m) => m.label).join(' · ');
  return {
    id: c.id,
    s: c.symbol ?? '',
    n: c.name ?? '',
    p: pN != null ? r4(pN * fE) : null,
    as: asN != null ? r4(asN * fE) : null,
    ar: arN != null ? r4(arN * fE) : null,
    sz: ns ? [r4(ns.lo * fE), r4(ns.hi * fE)] : null,
    rz: nr ? [r4(nr.lo * fE), r4(nr.hi * fE)] : null,
    sl: ns ? labels(ns) : asN != null ? '52W-Tief' : '',
    rl: nr ? labels(nr) : arN != null ? '52W-Hoch' : '',
    cl: (pc?.clusters ?? []).map((z) => [r4(z.mid * fE), z.score]),
    oc: ccy,
    conv,
    fE,
    eb: eb && needsEurBasis(c) ? { src: eb.src, sym: eb.sym } : null,
    c,
  };
}

// Schlusskurse aus swing_analysis.ohlc, in EUR; heute = LS-Kurs (wie im Artefakt).
export function buildRangeHist(c, it, fx, livePx) {
  const today = new Date().toISOString().slice(0, 10);
  const eb = c.eur_basis;
  if (it.eb && Array.isArray(eb?.t) && eb.t.length >= 2) {
    const t = eb.t.slice(), cl = eb.c.slice();
    if (livePx > 0) { if (t[t.length - 1] === today) cl[cl.length - 1] = livePx; else if (t[t.length - 1] < today) { t.push(today); cl.push(livePx); } }
    return { t, c: cl };
  }
  const a = c.swing_analysis;
  const bars = Array.isArray(a?.ohlc) ? a.ohlc.filter((b) => b && num(b.c) && b.date) : [];
  if (bars.length < 2) return null;
  const bc = String(a.currency ?? 'USD').toUpperCase();
  const f = it.conv ? eurFactor(bc, fx) : (bc === it.oc ? 1 : null);
  if (f == null) return null;
  const t = bars.map((b) => String(b.date).slice(0, 10));
  const cl = bars.map((b) => r4(+b.c * f));
  if (livePx > 0 && t[t.length - 1] < today) { t.push(today); cl.push(livePx); }
  return { t, c: cl };
}

/* Nächstes Level jenseits des Kurses: Cluster, Swing-Pivot, 52W-Extrem, sonst Volatilität. */
function nextLevel(it, p, dir, hist) {
  const beyond = (x) => x > 0 && (dir > 0 ? x > p * (1 + BRK) : x < p * (1 - BRK));
  const near = (a, b) => Math.abs(a - p) - Math.abs(b - p);
  const cs = (it.cl || []).map((c) => +c[0]).filter(beyond).sort(near);
  if (cs.length) return { lvl: cs[0], src: 'Cluster' };
  const c = hist && hist.c ? h.c.filter((x) => x > 0) : [];
  if (c.length >= 2 * PW + 1) {
    let piv = [];
    for (let i = PW; i < c.length - PW; i++) { const w = c.slice(i - PW, i + PW + 1), mx = Math.max.apply(null, w), mn = Math.min.apply(null, w); if (c[i] === mx || c[i] === mn) piv.push(c[i]); }
    piv = piv.filter(beyond).sort(near);
    const zones = [];
    piv.forEach((x) => { const z = zones[zones.length - 1]; if (z && Math.abs(x - z.start) / z.start <= ZONE) z.v.push(x); else zones.push({ start: x, v: [x] }); });
    const pick = zones.filter((z) => z.v.length >= 2)[0] || zones[0];
    if (pick) return { lvl: r4(pick.v.reduce((a, b) => a + b, 0) / pick.v.length), src: 'Swing-Pivot', n: pick.v.length };
  }
  if (c.length) { const y = c.slice(-252), ext = dir > 0 ? Math.max.apply(null, y) : Math.min.apply(null, y); if (beyond(ext)) return { lvl: ext, src: dir > 0 ? '52W-Hoch' : '52W-Tief' }; }
  let mv = 0.08;
  if (c.length >= 21) {
    const t = c.slice(-21), rs = [];
    for (let j = 1; j < t.length; j++) rs.push(t[j] / t[j - 1] - 1);
    const m = rs.reduce((a, b) => a + b, 0) / rs.length, sd = Math.sqrt(rs.reduce((a, b) => a + (b - m) * (b - m), 0) / (rs.length - 1));
    mv = Math.max(0.03, 2 * sd * Math.sqrt(10));
  }
  const tg = p * (1 + dir * mv), step = Math.pow(10, Math.floor(Math.log10(p))) / 4;
  let lv = dir > 0 ? Math.ceil(tg / step) * step : Math.floor(tg / step) * step;
  if (!(lv > 0)) lv = tg;
  return { lvl: r4(lv), src: 'Volatilität' };
}

/* Levels, Bruch und Position eines Titels. `over` = manuelle Levels { sup, res },
 * `pr` = { p, ... } aktueller Kurs in derselben Einheit, `hist` = Schlusskurse. */
export function rangeView(it, over, pr, hist) {
  const o = over || {}, supM = o.sup > 0, resM = o.res > 0;
  let sup = supM ? o.sup : it.as, res = resM ? o.res : it.ar, sz = supM ? null : it.sz, rz = resM ? null : it.rz;
  const p = pr.p;
  const bSup = sup, bRes = res;
  let brk = null, nl = null;
  const st = p > 0 && res > 0 && p > res * (1 + BRK) ? 'up' : p > 0 && sup > 0 && p < sup * (1 - BRK) ? 'dn' : '';
  /* Bruch: das gebrochene Level wechselt die Seite, in Bruchrichtung kommt das nächste Level. Gilt auch für manuelle Levels. */
  if (st) {
    const lv = (it.cl || []).map((c) => +c[0]).concat([sup, res]).filter((x) => x > 0);
    if (st === 'up') { brk = { side: 'res', lvl: res }; sup = Math.max.apply(null, lv.filter((x) => x < p)); nl = nextLevel(it, p, 1, hist); res = nl.lvl; }
    else { brk = { side: 'sup', lvl: sup }; res = Math.min.apply(null, lv.filter((x) => x > p)); nl = nextLevel(it, p, -1, hist); sup = nl.lvl; }
    sz = null; rz = null;
  }
  const lo = sup != null ? Math.min(sz ? sz[0] : sup, sup) : p * 0.97, hi = res != null ? Math.max(rz ? rz[1] : res, res) : p * 1.03;
  const pos = (sup != null && res != null && res > sup) ? (p - sup) / (res - sup) : null;
  return { sup, res, bSup, bRes, supM: supM && !st, resM: resM && !st, sz, rz, lo, hi, pos, st, brk, nl, p, pr };
}

/** Veränderung über 5 Handelstage aus einer Schlusskurs-Reihe. Richtung ab ±1 %. */
export function rangeTrend(closes) {
  if (!Array.isArray(closes) || closes.length < 6) return null;
  const now = closes[closes.length - 1], then = closes[closes.length - 6];
  if (!(then > 0)) return null;
  const ch = (now - then) / then * 100;
  return { dir: ch >= 1 ? 'up' : ch <= -1 ? 'dn' : '', ch };
}

/** Alles, was je Titel in die Rechnung eingeht: Levels, Overrides, Live-Kurs, Verlauf. */
export function rangeInputs(c, fx) {
  const it = buildRangeItem(c, fx);
  const o = c.range_override ?? {};
  const sN = num(o.sup), rN = num(o.res);
  const ov = sN || rN ? { sup: sN ? r4(sN * it.fE) : null, res: rN ? r4(rN * it.fE) : null } : null;
  const lp = it.conv && num(c.ls_quote?.price) ? +c.ls_quote.price : null;
  return { it, ov, lp, hist: buildRangeHist(c, it, fx, lp) };
}
