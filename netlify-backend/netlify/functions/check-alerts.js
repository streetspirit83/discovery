/**
 * check-alerts.js — Scheduled: Discovery alert evaluation → ntfy.sh push.
 *
 * Primary quote source: Lang & Schwarz (EUR, the Trade-Republic venue), with a
 * Yahoo fallback. Indicator levels (RSI/EMA/MACD) come from each candidate's
 * stored tv_data (only as fresh as the last TV fetch). Alerts use the shared
 * status-logic engine — the same one merkliste's portfolio push uses.
 *
 * Scope: every candidate (inbox + watch + export) with >=1 enabled alert.
 * Global mute lives in the discovery-config blob (set from the Alert-Overview).
 *
 * Push format (lib/push-composer.js): kind-based title (⛔ STOP-LOSS / 🟢 BUY /
 * 🔭 WATCH), explicit trigger line, user note, portfolio Entry|Stück from the
 * public merkliste blob, ≤2 salience-picked setup sentences (LS-history
 * detectors + cluster/RSI/volume facts), ISIN line; action buttons 🔍 Discovery
 * (deep link to the detail sheet) + 📈 TV-Chart. One bundled push per ticker.
 *
 * Preisalarme sehen jeden LS-Kurs seit dem letzten Lauf, nicht nur den letzten:
 * ein Ausschlag zwischen zwei Läufen feuert also auch.
 *
 * Range-Alarme (wr_sup_/wr_res_): Berührung des Levels = Push „erreicht". Bruch
 * (> 0,5 % jenseits, rangeView) = zweiter Push „gebrochen", danach stehen die
 * Alarme auf den neuen Levels. Ein gebrochenes manuelles Level wird dabei gelöscht:
 * Es gilt wieder die dynamische Systematik. Nachgezogen wird bei jedem Lauf mit derselben
 * Rechnung wie in der App (ui/lib/range-levels.js, range-alarm.js).
 *
 * Schedule: every 20 min, 7-21 UTC Mon-Fri (siehe config unten) — Netlify cron is
 * UTC, no DST.
 */

import { getStore } from '@netlify/blobs';
import { computeStatus, evaluateAlerts } from './lib/status-logic.js';
import { fetchLsPrice, fetchYahooPrice, fetchEurUsd } from './lib/ls-quote.js';
import { sendNtfy } from './lib/notify.js';
import { composePush } from './lib/push-composer.js';
import { computePriceClusters } from './lib/price-cluster.js';
import { rangeInputs, rangeView } from '../../../ui/lib/range-levels.js';
import { rangeAlarmOn, rangeAlarmPatch, armedLevels, levelMoved, isWr } from '../../../ui/lib/range-alarm.js';
import { eurBasisFactor } from '../../../ui/lib/eur-basis.js';

const NTFY_TOPIC = process.env.DISC_NTFY_TOPIC || 'disc-alerts-q4w8r2v';
const SOURCE_BLOBS = ['discovery-inbox', 'discovery-watch', 'discovery-export'];
const CONFIG_KEY  = 'discovery-config';
const STATE_KEY   = 'discovery-alert-state';
const TRIG_KEY    = 'discovery-alert-trig';
const HISTORY_KEY = 'discovery-ls-history';
const BREAK_KEY   = 'discovery-range-breaks';
const NET_BATCH   = 6;                       // LS-Abrufe je Welle (wie in der UI)
const BREAK_REPUSH_MS = 24 * 60 * 60 * 1000; // gleicher Bruch höchstens einmal am Tag

const MERKLISTE_BLOB_URL = 'https://merkliste-app.netlify.app/.netlify/functions/blob';

/* Merkliste portfolio (public GET, no CORS server-side): symbol → entry/shares.
   Same alias indexing as ui/lib/merkliste-import.js (match by symbol only). */
async function fetchMerklisteMap() {
  try {
    const res = await fetch(MERKLISTE_BLOB_URL);
    if (!res.ok) return null;
    const data = await res.json();
    const up = (v) => String(v ?? '').trim().toUpperCase();
    const bySym = new Map();
    for (const t of data?.tickers ?? []) {
      const entry = t?.user?.entry_price_manual;
      if (entry == null) continue;
      const shares = t?.user?.entry_shares ?? null;
      const s = t?.stamm ?? {};
      for (const alias of [s.symbol, s.yahoo_symbol, s.twelvedata_symbol]) {
        const key = up(alias);
        if (key) bySym.set(key, { entry, shares });
      }
    }
    return bySym;
  } catch (e) {
    console.warn(`[disc-alerts] merkliste blob nicht erreichbar: ${e.message}`);
    return null;
  }
}

function portfolioFor(c, bySym) {
  if (!bySym) return null;
  const up = (v) => String(v ?? '').trim().toUpperCase();
  for (const alias of [c.symbol, c.yahoo_symbol, c.merkliste_symbol]) {
    const key = up(alias);
    if (key && bySym.has(key)) return bySym.get(key);
  }
  return null;
}

const enabled = (a) => a && a.enabled !== false;

/* LS liefert Berliner Ortszeit als wäre sie UTC (gemessen: letzter Punkt lag eine
   Stunde „in der Zukunft"). Abstand zu echter Zeit für den Zeitpunkt `date`. */
export function berlinOffsetMs(date) {
  const p = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(date)) p[type] = +value;
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(date.getTime() / 1000) * 1000;
}

/* Preisalarme, die nur ein Ausschlag seit dem letzten Lauf ausgelöst hat. Ein Alarm
   sieht nur Kurse nach seiner Anlage, sonst feuerte ein frisch verschobener sofort. */
export function wickHits(alerts, ticks) {
  const out = [];
  for (const a of alerts) {
    if (a.group || a._trig || !(a.threshold > 0)) continue;
    const test = a.type === 'price_below' ? (p) => p <= a.threshold
      : a.type === 'price_above' ? (p) => p >= a.threshold : null;
    if (!test) continue;
    const from = Date.parse(a.created_at ?? '') || 0;
    if (ticks.some(([t, p]) => t >= from && test(p))) out.push({ ...a, _trig: true, _wick: true });
  }
  return out;
}

/* Soll-Zustand der Range-Alarme eines Titels. null = nichts rechenbar. */
function rangeState(c, price, snapshots, eurUsd) {
  try {
    const { it, ov, hist } = rangeInputs({ ...c, ls_quote: { price }, ls_history: snapshots }, eurUsd);
    if (!it.conv) return null;                 // Levels nicht in EUR, Alarme vergleichen EUR
    return { v: rangeView(it, ov, { p: price }, hist) };
  } catch (e) {
    console.warn(`[range] ${c.symbol}: ${e.message}`);
    return null;
  }
}

/* Neue wr_-Alerts in den Blob: frisch lesen, direkt schreiben, damit das Fenster zu
   Speichervorgängen der App so klein wie möglich bleibt. Geht ein Alarm dabei doch
   verloren, setzt ihn der nächste Lauf neu. */
async function writeRearm(store, blobKey, byId) {  // byId: id → { wr?, override? }
  const doc = await store.get(blobKey, { type: 'json' });
  if (!Array.isArray(doc?.candidates)) return 0;
  const now = new Date().toISOString();
  let n = 0;
  for (const c of doc.candidates) {
    const up = byId.get(c.id);
    if (!up) continue;
    if (up.override !== undefined) c.range_override = up.override;
    if (up.wr && rangeAlarmOn(c)) {          // inzwischen abgeschaltet: nicht wieder anlegen
      c.alerts = [...(Array.isArray(c.alerts) ? c.alerts : []).filter((a) => !isWr(a)), ...up.wr];
      c.range_alarm = true;
    }
    c.last_updated_at = now;
    n++;
  }
  if (!n) return 0;
  doc.updated_at = now;
  await store.setJSON(blobKey, doc);
  return n;
}

export default async () => {
  const startedAt = new Date().toISOString();
  console.log(`[disc-alerts] Start ${startedAt}`);
  const store = getStore({ name: 'discovery-data', consistency: 'strong' });

  // Global mute?
  const config = await store.get(CONFIG_KEY, { type: 'json' }).catch(() => null);
  const muted = config?.alerts_muted === true;

  // Collect candidates with >=1 enabled alert (dedup by id across blobs).
  const byId = new Map();
  const blobOf = new Map();
  for (const key of SOURCE_BLOBS) {
    const blob = await store.get(key, { type: 'json' }).catch(() => null);
    for (const c of blob?.candidates ?? []) {
      const manual = +c.range_override?.sup > 0 || +c.range_override?.res > 0;
      const active = (Array.isArray(c.alerts) && c.alerts.some(enabled)) || rangeAlarmOn(c) || manual;
      if (active && !byId.has(c.id)) { byId.set(c.id, c); blobOf.set(c.id, key); }
    }
  }
  const candidates = [...byId.values()];
  console.log(`[disc-alerts] ${candidates.length} Kandidaten mit aktiven Alerts · muted=${muted}`);
  if (!candidates.length) return new Response('no alerts', { status: 200 });

  const [prevStateDoc, prevTrigDoc, histDoc, mkBySym, prevBreakDoc] = await Promise.all([
    store.get(STATE_KEY,   { type: 'json' }).catch(() => null),
    store.get(TRIG_KEY,    { type: 'json' }).catch(() => null),
    store.get(HISTORY_KEY, { type: 'json' }).catch(() => null),
    fetchMerklisteMap(),
    store.get(BREAK_KEY,   { type: 'json' }).catch(() => null),
  ]);
  const prevState = prevStateDoc?.state ?? {};
  const prevTrig  = prevTrigDoc?.triggered ?? {};
  const lsHistory = histDoc?.history ?? {};

  const eurUsd = await fetchEurUsd();
  // Native → EUR. Weder EUR noch USD (SEK, GBX): über die EUR-Basis, sonst null —
  // ein unumgerechneter Wert würde gegen EUR-Schwellen falsche Alarme auslösen.
  const toEur = (v, c) => {
    if (v == null) return null;
    const ccy = String(c.currency ?? '').toUpperCase();
    if (!ccy || ccy === 'EUR') return v;
    if (ccy === 'USD') return eurUsd ? +(v / eurUsd).toFixed(4) : null;
    const f = eurBasisFactor(c);
    return f ? +(v * f).toFixed(4) : null;
  };

  // Fenster für die Ausschläge: alles nach dem letzten Lauf.
  const nowMs = Date.now();
  const lastRunMs = prevStateDoc?.updatedAt ?? nowMs - 25 * 60 * 1000;
  const lsShift = berlinOffsetMs(new Date(nowMs));

  // Kurse in Wellen: der Lauf darf die 30 s einer geplanten Funktion nie reissen,
  // sonst wird der Zustand gar nicht mehr gespeichert.
  const quotes = new Map();
  const fetchQuote = async (c) => {
    const ls = await fetchLsPrice(c).catch(() => null);
    if (ls?.price != null) return ls;
    if (!(c.yahoo_symbol || c.symbol)) return null;
    const y = await fetchYahooPrice(c.yahoo_symbol || c.symbol).catch(() => null);
    return { price: toEur(y, c), points: null };
  };
  for (let i = 0; i < candidates.length; i += NET_BATCH) {
    await Promise.allSettled(candidates.slice(i, i + NET_BATCH).map(async (c) => {
      quotes.set(c.id, await fetchQuote(c));
    }));
  }

  const newState = { ...prevState };
  const newTrig  = {};
  // Beim allerersten Lauf nur den Stand merken: bestehende Brüche sind keine Neuigkeit.
  const firstBreakRun = !prevBreakDoc;
  const prevBreaks = prevBreakDoc?.breaks ?? {};
  const newBreaks = { ...prevBreaks };
  const rearm = new Map();     // blobKey → Map(id → { wr, override })
  const planRearm = (c, up) => {
    const key = blobOf.get(c.id);
    if (!rearm.has(key)) rearm.set(key, new Map());
    rearm.get(key).set(c.id, { ...rearm.get(key).get(c.id), ...up });
  };
  let pushCount = 0;

  for (const c of candidates) {
    const ccy = c.currency;
    const quote = quotes.get(c.id) ?? null;
    const price = quote?.price ?? null;
    if (price == null) console.warn(`[disc-alerts] kein Kurs für ${c.symbol}`);
    const ticks = (quote?.points ?? [])
      .filter((p) => Array.isArray(p) && p[1] != null)
      .map((p) => [p[0] - lsShift, p[1]])
      .filter(([t]) => t > lastRunMs);

    const tv = c.tv_data ?? {};
    // Dynamic cluster levels for cross_below_sup / cross_above_res: compute the
    // clusters in native currency (LS/EUR levels → native via lsToNative), then
    // convert the nearest zone midpoints to EUR to compare with the EUR price.
    const ccyU = String(ccy).toUpperCase();
    const basisF = eurBasisFactor(c);
    const lsToNative = ccyU === 'EUR' ? 1 : ccyU === 'USD' ? (eurUsd ?? null) : basisF ? 1 / basisF : null;
    const nativeClose = tv.close_1m ?? tv.close;
    const pc = nativeClose != null
      ? computePriceClusters(tv, { lsHistory: lsHistory[c.id]?.snapshots ?? null, refPrice: nativeClose, lsToNative })
      : null;
    const q = {
      price,
      rsi: tv.rsi ?? null,
      ma20:  toEur(tv.ema20, c),
      ma50:  toEur(tv.ema50, c),
      ma200: toEur(tv.ema200, c),
      macd_histogram: (tv.macd != null && tv.macd_signal != null) ? toEur(tv.macd - tv.macd_signal, c) : null,
      volume: tv.average_volume ?? null,
      avg_volume: tv.avg_vol_10d ?? tv.average_volume ?? null,
      sup: pc?.nearestSup ? toEur(pc.nearestSup.mid, c) : null,
      res: pc?.nearestRes ? toEur(pc.nearestRes.mid, c) : null,
    };

    const activeAlerts = (Array.isArray(c.alerts) ? c.alerts : []).filter(enabled);
    const { alerts: evaled } = evaluateAlerts(activeAlerts, q);
    const triggered = [...evaled.filter((a) => a._trig), ...wickHits(evaled, ticks)];
    const status = computeStatus({ alerts: activeAlerts }, q);

    const prevKey     = prevState[c.id] ?? 'halten';
    const prevTrigSet = new Set(prevTrig[c.id] ?? []);
    const newlyTriggered = triggered.filter((a) => !prevTrigSet.has(a.id));

    // "Gesehen"-Buchführung: ein Trigger gilt erst als gesehen, wenn sein Push
    // tatsächlich raus ist. Vorher wurde newTrig bei JEDEM Lauf voll geschrieben —
    // Trigger, die während Mute feuerten, deren ntfy-Send fehlschlug oder die beim
    // ersten Deploy schon aktiv waren, wurden dadurch stumm geschluckt und nie
    // nachgeholt ("Web zeigt Alert, ntfy pusht nicht").
    const stillSeen = triggered.filter((a) => prevTrigSet.has(a.id)).map((a) => a.id);
    newTrig[c.id]  = stillSeen;
    newState[c.id] = status.key;

    const statusChanged = prevKey !== status.key && status.key !== 'halten';
    const hasNewTrigger = newlyTriggered.length > 0;

    // Range-Alarm: Bruch melden und Alarme auf die aktuellen Levels ziehen.
    const alarmOn = rangeAlarmOn(c) && price != null;
    const snaps = lsHistory[c.id]?.snapshots ?? null;
    const over = c.range_override ?? {};
    const hasManual = +over.sup > 0 || +over.res > 0;
    let rs = (alarmOn || (hasManual && price != null)) ? rangeState(c, price, snaps, eurUsd) : null;
    const brk = rs?.v.brk ?? null;
    let view = c;                    // Stand, aus dem die Alarme entstehen
    // Reisst ein manuelles Level, gilt für diese Seite wieder die dynamische Systematik.
    if (brk && +over[brk.side] > 0) {
      const rest = { ...over, [brk.side]: null };
      const override = +rest.sup > 0 || +rest.res > 0 ? rest : null;
      view = { ...c, range_override: override };
      rs = rangeState(view, price, snaps, eurUsd) ?? rs;
      planRearm(c, { override });
      console.log(`[range] ${c.symbol}: manuelles ${brk.side} ${brk.lvl} gebrochen → auto`);
    }
    let breakAlert = null;
    if (brk && alarmOn) {
      const prev = prevBreaks[c.id];
      const same = prev && prev.side === brk.side && !levelMoved(prev.lvl, brk.lvl);
      const isNew = !same || nowMs - (prev.at ?? 0) > BREAK_REPUSH_MS;
      if (isNew && firstBreakRun) newBreaks[c.id] = { side: brk.side, lvl: brk.lvl, at: nowMs };
      else if (isNew) {
        breakAlert = {
          id: `wr_brk_${brk.side}_${c.id}`, type: 'range_break', kind: 'watch', priority: 4, _trig: true,
          side: brk.side, threshold: brk.lvl, nextSup: rs.v.sup, nextRes: rs.v.res, lvlAfter: rs.v.brk?.lvl ?? brk.lvl,
        };
      }
    }
    const moved = [];
    // Ein von Hand deaktivierter Range-Alarm bleibt deaktiviert.
    if (alarmOn && rs && !(Array.isArray(c.alerts) ? c.alerts : []).some((a) => isWr(a) && a.enabled === false)) {
      const { patch, armed } = rangeAlarmPatch(view, rs.v, true);
      const old = armedLevels(c);
      for (const side of ['sup', 'res']) if (levelMoved(armed[side], old[side])) moved.push(`wr_${side}_${c.id}`);
      if (moved.length) {
        planRearm(c, { wr: patch.alerts.filter(isWr) });
        console.log(`[range] ${c.symbol}: Alarm ${old.sup ?? '—'}/${old.res ?? '—'} → ${armed.sup ?? '—'}/${armed.res ?? '—'}`);
      }
    }
    // Verschobener Alarm = neues Level, darf wieder feuern.
    if (moved.length) newTrig[c.id] = newTrig[c.id].filter((id) => !moved.includes(id));

    console.log(`[eval] ${c.symbol}: px=${price != null ? price.toFixed(2) : '—'} ticks=${ticks.length} → ${status.key} (prev ${prevKey}) new=${newlyTriggered.map((a) => a.type).join(',') || '—'}${breakAlert ? ' BRUCH' : ''}`);

    if (muted || (!statusChanged && !hasNewTrigger && !breakAlert)) {
      // Mute: Statuswechsel ebenfalls nicht festschreiben, damit er nach dem
      // Unmute noch als Wechsel erkannt und gepusht wird.
      if (muted && statusChanged) newState[c.id] = prevKey;
      continue;
    }

    // Fällt die Berührung in denselben Lauf wie der Bruch, reicht der Bruch-Push.
    const shown = [
      ...(statusChanged ? triggered : newlyTriggered)
        .filter((a) => !(breakAlert && a.id === `wr_${breakAlert.side}_${c.id}`)),
      ...(breakAlert ? [breakAlert] : []),
    ];
    if (!shown.length) continue;
    const push = composePush({
      c,
      shown,
      q,
      snapshots: lsHistory[c.id]?.snapshots ?? null,
      portfolio: portfolioFor(c, mkBySym),
      lsToNative, // reused from the cluster computation above
    });
    console.log(`[ALERT] ${push.title}\n${push.message}`);
    const sent = await sendNtfy(NTFY_TOPIC, push).catch((e) => { console.error(`[ntfy] ${e.message}`); return false; });
    if (sent) {
      newTrig[c.id] = triggered.map((a) => a.id).filter((id) => !moved.includes(id));   // jetzt gesehen
      if (breakAlert) newBreaks[c.id] = { side: breakAlert.side, lvl: breakAlert.lvlAfter, at: nowMs };
      pushCount++;
    } else {
      // Fehlgeschlagen → Zustand nicht festschreiben, nächster Lauf pusht erneut.
      newState[c.id] = prevKey;
      console.warn(`[disc-alerts] ntfy fehlgeschlagen für ${c.symbol} — Retry im nächsten Lauf`);
    }
  }

  const now = Date.now();
  await Promise.allSettled([
    store.setJSON(STATE_KEY, { state: newState, updatedAt: now }),
    store.setJSON(TRIG_KEY,  { triggered: newTrig, updatedAt: now }),
    store.setJSON(BREAK_KEY, { breaks: newBreaks, updatedAt: now }),
  ]);
  let moved = 0;
  for (const [key, ids] of rearm) moved += await writeRearm(store, key, ids).catch((e) => { console.error(`[range] ${key}: ${e.message}`); return 0; });
  console.log(`[disc-alerts] Fertig: ${pushCount} Push(es)${muted ? ' (muted)' : ''} · ${moved} Alarm(e) nachgezogen`);
  return new Response(JSON.stringify({ pushes: pushCount, candidates: candidates.length, muted }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};

// 7-21 UTC: 8:00-22:40 Uhr im Winter, 9:00-23:40 Uhr im Sommer. Deckt damit den
// US-Schluss um 22:00 Uhr ab; LS handelt bis 23:00 Uhr.
export const config = {
  schedule: '*/20 7-21 * * 1-5',
};
