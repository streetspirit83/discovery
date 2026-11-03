/**
 * range-alarm.js — Alarme auf Support und Resistance (Watch Ranges).
 *
 * Gemeinsam für das Range-Modal und den Kerzen-Chart im Detail-Sheet. `range_alarm`
 * ist der Haken, scharf sind die Alerts `wr_sup_<id>` / `wr_res_<id>` (EUR, gleiches
 * Format wie die Function watch-alarms). Ein überschrittenes Level bekommt keinen Alarm.
 */

import { r4 } from './range-levels.js?v=20261103h';

export const isWr = (a) => String(a?.id ?? '').startsWith('wr_');

function wrAlert(cid, side, level, prev, now) {
  const sup = side === 'sup';
  const same = prev && Math.abs((prev.threshold ?? 0) - level) < 1e-6;
  return {
    id: `wr_${side}_${cid}`,
    kind: 'watch',
    type: sup ? 'price_below' : 'price_above',
    threshold: level,
    dir: 'watch',
    enabled: true,
    priority: 4,
    label: `${sup ? 'Support' : 'Resistance'} ${level.toLocaleString('de-DE', { minimumFractionDigits: level >= 1000 ? 0 : 2, maximumFractionDigits: level >= 1000 ? 0 : 2 })} €`,
    note: 'Watch Ranges',
    basis: { kind: 'level', source: 'Watch Ranges' },
    created_at: same && prev.created_at ? prev.created_at : now,
  };
}

/** Was scharf sein müsste. `v` = Ergebnis von rangeView. */
export function wantArm(v) {
  return { sup: v.sup && v.p > v.sup ? r4(v.sup) : null, res: v.res && v.p < v.res ? r4(v.res) : null };
}

/** Scharfgestellte Levels eines Titels. */
export function armedLevels(c) {
  const list = Array.isArray(c?.alerts) ? c.alerts : [];
  const thr = (side) => { const v = +list.find((a) => a?.id === `wr_${side}_${c.id}`)?.threshold; return v > 0 ? v : null; };
  return { sup: thr('sup'), res: thr('res') };
}

export const rangeAlarmOn = (c) => c?.range_alarm === true || (Array.isArray(c?.alerts) && c.alerts.some(isWr));

/** Neuer Zustand für Alarm an/aus: { patch: {alerts, range_alarm}, armed: {sup, res} }. */
export function rangeAlarmPatch(c, v, on, now = new Date().toISOString()) {
  const old = Array.isArray(c.alerts) ? c.alerts : [];
  const prev = (side) => old.find((a) => a?.id === `wr_${side}_${c.id}`);
  const w = on ? wantArm(v) : { sup: null, res: null };
  if (w.sup != null && w.res != null && w.sup >= w.res) { w.sup = null; w.res = null; }
  const mine = [];
  if (w.sup != null) mine.push(wrAlert(c.id, 'sup', w.sup, prev('sup'), now));
  if (w.res != null) mine.push(wrAlert(c.id, 'res', w.res, prev('res'), now));
  return { patch: { alerts: [...old.filter((a) => !isWr(a)), ...mine], range_alarm: !!on }, armed: w };
}
