/**
 * push-composer.js — builds the ntfy push per ticker (pure, no network).
 *
 * Layout (agreed in chat):
 *   Title:  ⛔ STOP-LOSS · NVDA — Nvidia        ← kind of the most severe alert
 *   Line 1: 🎯 Target erreicht: 187,40 € ≥ 185,00 € (Ziel +12 %)  ← the trigger
 *   Line 2: „user note"                          ← only when the alert has one
 *   Line 3: Entry 165,20 € | 12 Stk. (+13,4 %)   ← only for portfolio tickers
 *   Line 4: ≤2 auto-derived setup sentences (salience-picked, see below)
 *   Line 5: ISIN: US67066G1040
 *   click → Discovery app · action button → TradingView chart
 *
 * Salience: every observation (volume spike, breakout/breakdown/bottom
 * detectors, cluster proximity, day move vs ATR, RSI extreme, 52W proximity)
 * gets a 0–100 score, weighted by the push kind (a stop push boosts bearish
 * facts, a buy/watch push boosts bullish ones) and filtered against the
 * trigger (the sentences must ADD something, not repeat line 1). Top 2 win;
 * nothing salient → one neutral fallback sentence instead of forced drama.
 *
 * Currency discipline: prices in the push are EUR (LS quote, thresholds,
 * merkliste entry). Auto sentences stick to percentages and EUR-derived
 * values; native TV levels are only used for ratios, never printed as EUR.
 */

import { alertDir } from './status-logic.js';
import { detectBreakoutSetup, detectBreakdownRisk, detectBottomSignal, MIN_SNAPSHOTS } from './ls-history-signals.js';
import { computePriceClusters } from './price-cluster.js';

export const DISCOVERY_URL = 'https://streetspirit83.github.io/discovery/';

/* Kind of the push = most severe kind among the shown alerts. */
const KINDS = {
  stop:  { emoji: '⛔', title: 'STOP-LOSS', rank: 0, priority: 4 },
  buy:   { emoji: '🟢', title: 'BUY',       rank: 1, priority: 4 },
  watch: { emoji: '🔭', title: 'WATCH',     rank: 2, priority: 3 },
};

/* Alerts created before step 1 carry no `kind` — derive it from their dir.
   Exception: a legacy price_above with dir 'sell' is a take-profit target
   ("Ziel +x %"), not a stop-loss — report it as watch (🎯), never as ⛔. */
export function alertKind(a) {
  if (a.kind && KINDS[a.kind]) return a.kind;
  const d = alertDir(a);
  if (d === 'sell') return a.type === 'price_above' ? 'watch' : 'stop';
  return d === 'buy' ? 'buy' : 'watch';
}

const kindRank = (a) => KINDS[alertKind(a)].rank;

const fmtEur = (v) => (v == null ? '—' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');
const fmtPct = (v, dp = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(dp).replace('.', ',')} %`;
const round0 = (v) => Math.round(v);

/* ── Line 1: the trigger, immediately recognisable ─────────────────────── */

export function triggerLine(a, q) {
  const kind = alertKind(a);
  const lbl = a.label ? ` (${a.label})` : '';
  const px = fmtEur(q.price);
  switch (a.type) {
    case 'price_above': {
      const head = kind === 'stop' ? '⛔ Stop-Loss' : kind === 'buy' ? '🟢 Buy-Level' : '🎯 Target erreicht';
      return `${head}: ${px} ≥ ${fmtEur(a.threshold)}${lbl}`;
    }
    case 'price_below': {
      const head = kind === 'stop' ? '⛔ Stop-Loss' : kind === 'buy' ? '🟢 Buy-Level' : '⚠️ Support gebrochen';
      return `${head}: ${px} ≤ ${fmtEur(a.threshold)}${lbl}`;
    }
    case 'ma20_below':  return `📉 Kurs unter EMA20: ${px} ≤ ${fmtEur(q.ma20)}`;
    case 'ma50_below':  return `📉 Kurs unter EMA50: ${px} ≤ ${fmtEur(q.ma50)}`;
    case 'ma200_below': return `📉 Kurs unter EMA200: ${px} ≤ ${fmtEur(q.ma200)}`;
    case 'rsi_above':   return `📊 RSI ${q.rsi != null ? round0(q.rsi) : '—'} ≥ ${a.threshold} (überkauft)`;
    case 'rsi_below':   return `📊 RSI ${q.rsi != null ? round0(q.rsi) : '—'} ≤ ${a.threshold} (überverkauft)`;
    case 'macd_bullish':return '📊 MACD dreht bullish';
    case 'macd_bearish':return '📊 MACD dreht bearish';
    default:            return a.label || a.type;
  }
}

/* ── Auto-derived setup sentences (salience engine) ────────────────────── */

const median = (arr) => {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/**
 * setupSentences(tv, snapshots, { kind, triggerTypes, triggerLabels, lsToNative })
 * → string ('' when even the fallback lacks data). ≤2 sentences.
 */
export function setupSentences(tv = {}, snapshots = null, { kind = 'watch', triggerTypes = new Set(), triggerLabels = [], lsToNative = 1 } = {}) {
  const obs = []; // { key, score, sentence, tone: 'bull'|'bear'|'neutral' }
  const snaps = Array.isArray(snapshots) ? snapshots : [];
  const last = snaps.length ? snaps[snaps.length - 1] : null;
  const avgVol10 = tv.avg_vol_10d ?? null;

  // 1. Volume spike vs Ø10d (LS-history volume is Yahoo daily volume — same
  //    share-count unit as the TV average).
  const volRef = avgVol10 ?? median(snaps.map((s) => s.volume).filter((v) => v != null && v > 0));
  const lastVol = last?.volume ?? tv.volume ?? null;
  if (lastVol != null && volRef > 0) {
    const ratio = lastVol / volRef;
    if (ratio >= 1.5) {
      const chg = last?.change_pct ?? tv.change_1d ?? 0;
      const down = chg < 0;
      obs.push({
        key: 'vol', tone: down ? 'bear' : 'bull',
        score: Math.min(85, 40 + (ratio - 1.5) * 20),
        sentence: `${down ? 'Abverkauf' : 'Kaufinteresse'} mit ${round0(ratio * 100)} % Volumen vs. Ø10d.`,
      });
    }
  }

  // 2–4. LS-history detectors (watch bucket only — others have no snapshots).
  const bo = detectBreakoutSetup(snaps, avgVol10);
  if (bo && bo.breakoutProbabilityPct >= 50) {
    const parts = [];
    if (bo.criteria.extendedNarrowRange) parts.push('enge Range');
    if (bo.criteria.volumeConfirmation)  parts.push('Volumen zieht an');
    if (bo.criteria.flatTopBullFlag)     parts.push('Bull-Flagge');
    obs.push({ key: 'breakout', tone: 'bull', score: bo.breakoutProbabilityPct, sentence: `Breakout-Setup ${bo.breakoutProbabilityPct}: ${parts.join(' + ') || 'Money-Flow positiv'}.` });
  }
  const bd = detectBreakdownRisk(snaps, avgVol10);
  if (bd && bd.breakdownProbabilityPct >= 50) {
    const parts = [];
    if (bd.criteria.volumeSpikeNoFollowThrough) parts.push('Volumen-Spike ohne Follow-Through');
    if (bd.criteria.distributionDay)            parts.push('Distributionstag');
    if (bd.criteria.nearRecentHigh)             parts.push('nahe am Hoch');
    obs.push({ key: 'breakdown', tone: 'bear', score: bd.breakdownProbabilityPct, sentence: `Breakdown-Risiko ${bd.breakdownProbabilityPct}: ${parts.join(' + ')}.` });
  }
  const bt = detectBottomSignal(snaps);
  if (bt?.isBottom) {
    obs.push({ key: 'bottom', tone: 'bull', score: 70, sentence: `Bottom-Stabilisierung aktiv — Boden ~${fmtEur(bt.bottomPrice)}.` });
  }

  // 5. Cluster proximity (native ref price; distances are %, so currency-safe).
  //    Skipped when the trigger already names a cluster level (redundancy).
  const clusterTriggered = triggerLabels.some((l) => /cluster|sup|res/i.test(l || ''));
  if (!clusterTriggered) {
    const pc = computePriceClusters(tv, { lsHistory: snaps, lsToNative });
    const near = [];
    if (pc?.nearestRes) near.push({ c: pc.nearestRes, side: 'res' });
    if (pc?.nearestSup) near.push({ c: pc.nearestSup, side: 'sup' });
    for (const { c, side } of near) {
      const dAtr = c.distAtr != null ? Math.abs(c.distAtr) : null;
      const dPct = Math.abs(c.distPct);
      if ((dAtr != null && dAtr <= 1) || dPct <= 1.5) {
        obs.push({
          key: `cluster_${side}`, tone: side === 'res' ? 'bull' : 'bear',
          score: 60 - (dAtr != null ? dAtr * 25 : dPct * 15),
          sentence: `Kurs ${dPct.toFixed(1).replace('.', ',')} % ${side === 'res' ? 'unter Resistance' : 'über Support'}-Cluster (Score ${String(c.score).replace('.', ',')}).`,
        });
      }
    }
  }

  // 6. Day move vs the usual ATR% swing.
  if (tv.change_1d != null && tv.atrp > 0) {
    const mult = Math.abs(tv.change_1d) / tv.atrp;
    if (mult >= 1.5) {
      obs.push({
        key: 'daymove', tone: tv.change_1d < 0 ? 'bear' : 'bull',
        score: Math.min(80, 45 + (mult - 1.5) * 15),
        sentence: `Tagesbewegung ${fmtPct(tv.change_1d)} — das ${mult.toFixed(1).replace('.', ',')}-Fache der üblichen Schwankung.`,
      });
    }
  }

  // 7. RSI extreme (skipped when an RSI alert is the trigger).
  const rsiTriggered = triggerTypes.has('rsi_above') || triggerTypes.has('rsi_below');
  if (!rsiTriggered && tv.rsi != null) {
    if (tv.rsi >= 70) obs.push({ key: 'rsi', tone: 'bear', score: 30 + (tv.rsi - 70) * 2, sentence: `RSI ${round0(tv.rsi)} — überkauft, Anschlusskäufe fraglich.` });
    else if (tv.rsi <= 30) obs.push({ key: 'rsi', tone: 'bull', score: 30 + (30 - tv.rsi) * 2, sentence: `RSI ${round0(tv.rsi)} — überverkauft, Rebound-Chance.` });
  }

  // 8. 52W proximity (native close vs native extreme — pure ratio).
  const close = tv.close_1m ?? tv.close;
  const hi52 = tv.price_52_week_high ?? tv.high_52w;
  if (close != null && hi52 > 0) {
    const d = (hi52 - close) / hi52 * 100;
    if (d >= 0 && d <= 2) obs.push({ key: 'near52h', tone: 'bull', score: 50 - d * 10, sentence: d < 0.1 ? 'Neues 52W-Hoch.' : `Nur ${d.toFixed(1).replace('.', ',')} % unter dem 52W-Hoch.` });
  }
  const lo52 = tv.price_52_week_low;
  if (close != null && lo52 > 0) {
    const d = (close - lo52) / lo52 * 100;
    if (d >= 0 && d <= 2) obs.push({ key: 'near52l', tone: 'bear', score: 45 - d * 10, sentence: `Nur ${d.toFixed(1).replace('.', ',')} % über dem 52W-Tief.` });
  }

  // Context weighting: the sentences must fit the push. A stop push boosts
  // bearish facts and damps bullish ones; buy/watch the other way round.
  const boost = kind === 'stop'
    ? { bear: 1.4, bull: 0.6, neutral: 1 }
    : { bear: 0.7, bull: 1.3, neutral: 1 };
  for (const o of obs) o.score *= boost[o.tone] ?? 1;

  const picked = obs.filter((o) => o.score >= 35).sort((a, b) => b.score - a.score).slice(0, 2);
  if (picked.length) return picked.map((o) => o.sentence).join(' ');

  // Neutral fallback — no forced drama.
  if (tv.change_1d != null) {
    const volNote = (lastVol != null && volRef > 0) ? `, Volumen ${round0((lastVol / volRef) * 100)} % Ø10d` : '';
    return `Kurs ${fmtPct(tv.change_1d)} zum Vortag${volNote} — kein auffälliges Setup.`;
  }
  return '';
}

/* ── The full push ─────────────────────────────────────────────────────── */

/**
 * composePush({ c, shown, q, snapshots, portfolio, lsToNative })
 *   c         candidate · shown = alerts to report (already filtered)
 *   q         quote object used by evaluateAlerts (price EUR + EMA/RSI/MACD)
 *   snapshots LS-history window (watch bucket) or null
 *   portfolio { entry, shares } from the merkliste blob, or null
 * → { title, message, priority, click, actions }
 */
export function composePush({ c, shown, q, snapshots = null, portfolio = null, lsToNative = 1 }) {
  const bySeverity = [...shown].sort((a, b) => kindRank(a) - kindRank(b));
  const top = KINDS[alertKind(bySeverity[0])];
  const title = `${top.emoji} ${top.title} · ${c.symbol}${c.name ? ` — ${c.name}` : ''}`;

  const lines = [];
  for (const a of bySeverity.slice(0, 3)) lines.push(triggerLine(a, q));

  const notes = [...new Set(bySeverity.map((a) => a.note).filter(Boolean))].slice(0, 2);
  for (const n of notes) lines.push(`„${n}"`);

  if (portfolio?.entry != null) {
    const pl = q.price != null && portfolio.entry > 0 ? (q.price / portfolio.entry - 1) * 100 : null;
    const shares = portfolio.shares != null ? ` | ${portfolio.shares} Stk.` : '';
    lines.push(`Entry ${fmtEur(portfolio.entry)}${shares}${pl != null ? ` (${fmtPct(pl)})` : ''}`);
  }

  const sentences = setupSentences(c.tv_data ?? {}, snapshots, {
    kind: alertKind(bySeverity[0]),
    triggerTypes: new Set(bySeverity.map((a) => a.type)),
    triggerLabels: bySeverity.map((a) => a.label),
    lsToNative,
  });
  if (sentences) lines.push(sentences);

  if (c.isin) lines.push(`ISIN: ${c.isin}`);

  const tvUrl = c.exchange
    ? `https://www.tradingview.com/symbols/${c.exchange}-${c.symbol}/`
    : `https://www.tradingview.com/symbols/${c.symbol}/`;

  return {
    title,
    message: lines.join('\n'),
    priority: top.priority,
    click: DISCOVERY_URL,
    actions: [{ action: 'view', label: '📈 TV-Chart', url: tvUrl }],
  };
}

export { MIN_SNAPSHOTS };
