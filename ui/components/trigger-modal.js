/**
 * Alert editor (per-candidate).
 *
 * Every alert carries exactly one explicit intent — Watch · Buy · Stop-Loss —
 * chosen in the segmented control at the top, plus an optional free-text note.
 * Both are applied to whatever level you add next:
 *   • Predefined Support / Resistance / Target levels (from the price clusters
 *     and the trade-setup target — the same ones the Trade view shows)
 *   • %-from-entry stop/target (preset or manual %)
 *   • Manual price (≥/≤ a price in EUR)
 *   • SMA crosses · RSI / MACD indicator presets
 *
 * Every change persists immediately via onSaveAlerts(id, alerts).
 */

import {
  entryBasisEur, alertSummary, isAlertTriggered, toEur,
  buildManualPriceAlert, buildEntryPctAlert, buildPresetAlert, buildClusterAlert,
  ALERT_KINDS, alertKind,
} from '../lib/alerts.js?v=20260704e';
import { computePriceClusters } from '../lib/price-cluster.js?v=20260702h';
import { classifyCluster, tradeTarget } from '../lib/trade-setup.js?v=20260702h';

const fmtEur = (v) => (v == null ? '—' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');

const KIND_ORDER = ['watch', 'buy', 'stop'];

const PCT_OPTS = [
  { v: '10',  label: 'Ziel +10%' },
  { v: '20',  label: 'Ziel +20%' },
  { v: '-10', label: 'Stop −10%' },
  { v: '-20', label: 'Stop −20%' },
];

const MA_PRESETS = [
  { v: 'sma20',  label: '≤ SMA20' },
  { v: 'sma50',  label: '≤ SMA50' },
  { v: 'sma200', label: '≤ SMA200' },
];

const IND_PRESETS = [
  { v: 'rsi_os', label: 'RSI überverkauft' },
  { v: 'rsi_ob', label: 'RSI überkauft' },
  { v: 'macd_up', label: 'MACD bullish' },
  { v: 'macd_dn', label: 'MACD bearish' },
];

/* EUR → native factor (USD via live rate, else 1) so cluster levels come back
   in native currency; converted to EUR per-level for the alert threshold. */
function lsToNative(c) {
  const r = parseFloat(localStorage.getItem('discovery_fx_eurusd_live'));
  const rate = Number.isFinite(r) && r > 0 ? r : null;
  return String(c.currency).toUpperCase() === 'USD' ? (rate ?? 1) : 1;
}

/* Predefined Support / Resistance / Target levels in EUR (or [] if no TV data).
   Support → Buy · Resistance → Watch · Target → Watch as natural defaults.
   Prefers the price-cluster confluence zone; falls back to the nearest single
   TV level so the chips are present even when nothing clusters. */
function predefinedLevels(c) {
  const tv = c.tv_data;
  if (!tv) return [];
  const nativeClose = tv.close_1m ?? tv.close;
  if (nativeClose == null) return [];
  const pc = computePriceClusters(tv, { lsHistory: c.ls_history, refPrice: nativeClose, lsToNative: lsToNative(c) });

  // Nearest single support/resistance from the common TV levels (native).
  const supCands = [tv.pivot_s1, tv.pivot_s1_1w, tv.sma20, tv.sma50, tv.sma200, tv.low_1m].filter((v) => v != null && v < nativeClose);
  const resCands = [tv.pivot_r1, tv.pivot_r1_1w, tv.high_1m, tv.high_20d, tv.high_3m, tv.price_52_week_high].filter((v) => v != null && v > nativeClose);
  const nearestBelow = supCands.length ? Math.max(...supCands) : null;
  const nearestAbove = resCands.length ? Math.min(...resCands) : null;

  const out = [];
  const sup = pc?.nearestSup ? { native: pc.nearestSup.mid, score: pc.nearestSup.score } : (nearestBelow != null ? { native: nearestBelow } : null);
  const res = pc?.nearestRes ? { native: pc.nearestRes.mid, score: pc.nearestRes.score } : (nearestAbove != null ? { native: nearestAbove } : null);
  if (sup) out.push({ id: 'sup', label: 'Support', kind: 'buy', priceEur: toEur(sup.native, c.currency), score: sup.score });
  if (res) out.push({ id: 'res', label: 'Resistance', kind: 'watch', priceEur: toEur(res.native, c.currency), score: res.score });
  const cl = classifyCluster(tv);
  const tgt = tradeTarget(tv, cl ?? undefined);
  if (tgt != null) out.push({ id: 'tgt', label: `Target +${cl?.gainPct ?? ''}%`, kind: 'watch', priceEur: toEur(tgt, c.currency) });
  return out.filter((l) => l.priceEur != null);
}

/**
 * @param {object} c candidate (mutated: c.alerts)
 * @param {object} opts { onSaveAlerts, onSaved, toast }
 */
export function openTriggerEditor(c, { onSaveAlerts, onSaved, toast } = {}) {
  if (!c) return;
  if (!Array.isArray(c.alerts)) c.alerts = [];
  const basis = entryBasisEur(c);
  const refPriceEur = basis.value ?? c.ls_quote?.price ?? null;
  const levels = predefinedLevels(c);
  const canCluster = !!(c.tv_data && (c.tv_data.close_1m ?? c.tv_data.close) != null);

  let kind = 'watch'; // current intent for the next alert added

  const sub = document.createElement('div');
  sub.className = 'modal-overlay id-sub-overlay';
  sub.innerHTML = `
    <div class="modal id-trigger-modal" role="dialog" aria-modal="true" aria-label="Alerts">
      <div class="modal-header">
        <h2>Alerts · ${c.symbol}</h2>
        <button class="modal-close" id="idt-close" aria-label="Schließen">✕</button>
      </div>
      <div class="modal-body">
        <div class="alert-kind" role="tablist" aria-label="Alert-Art">
          ${KIND_ORDER.map((k) => `<button class="alert-kind__btn alert-kind__btn--${k}${k === kind ? ' is-active' : ''}" data-kind="${k}" role="tab" aria-selected="${k === kind}">${ALERT_KINDS[k].emoji} ${ALERT_KINDS[k].label}</button>`).join('')}
        </div>
        <div class="alert-add__group">
          <label for="idt-note">Notiz (optional) – wird an den nächsten Alert gehängt</label>
          <input type="text" id="idt-note" placeholder="z. B. „Teilverkauf am Widerstand"" maxlength="140">
        </div>

        <div class="alert-entry-row">
          Entry-Basis: <strong>${fmtEur(basis.value)}</strong>
          <span class="muted">${basis.source ? `(${basis.source})` : '(kein Entry / Kurs)'}</span>
        </div>

        <ul class="alert-list" id="idt-list"></ul>

        <div class="alert-add">
          ${levels.length ? `
          <div class="alert-tier">Vordefinierte Level · Support / Resistance / Target</div>
          <div class="alert-add__group">
            <div class="alert-add__presets">
              ${levels.map((l) => `<button class="chip-btn chip-btn--lvl" data-lvl="${l.id}" title="${l.label}: ${fmtEur(l.priceEur)}${l.score != null ? ` · Cluster-Score ${l.score}` : ''}">${l.label} · ${fmtEur(l.priceEur)}</button>`).join('')}
            </div>
          </div>` : ''}

          ${canCluster ? `
          <div class="alert-tier">Dynamische Cluster-Alerts · Level bewegt sich mit den Kursen</div>
          <div class="alert-add__group">
            <div class="alert-add__presets">
              <button class="chip-btn chip-btn--dyn" data-cluster="sup" title="Löst aus, sobald der Kurs das JEWEILS aktuelle Support-Cluster erreicht — beim nächsten TV-Fetch neu berechnet, kein fixer Preis">↧ Support-Cluster (dyn.)</button>
              <button class="chip-btn chip-btn--dyn" data-cluster="res" title="Löst aus, sobald der Kurs das JEWEILS aktuelle Resistance-Cluster erreicht — beim nächsten TV-Fetch neu berechnet, kein fixer Preis">↥ Resistance-Cluster (dyn.)</button>
            </div>
          </div>` : ''}

          <div class="alert-tier">Kurs · LS live</div>
          <div class="alert-add__group">
            <label>Stop / Ziel (% von Entry)</label>
            <div class="alert-add__presets">
              ${PCT_OPTS.map((o) => `<button class="chip-btn" data-pct="${o.v}">${o.label}</button>`).join('')}
              <span class="alert-add__inline">
                <input type="number" step="any" inputmode="decimal" id="idt-pct-manual" placeholder="±% manuell" class="pct-input">
                <button class="btn btn-sm btn-primary" id="idt-add-pct" aria-label="Prozent-Alert hinzufügen">＋</button>
              </span>
            </div>
          </div>

          <div class="alert-add__group">
            <label>Manueller Preis-Alert (€)</label>
            <div class="alert-add__manual">
              <select id="idt-dir" class="dir-select" aria-label="Richtung">
                <option value="above">≥</option>
                <option value="below">≤</option>
              </select>
              <input type="number" step="any" inputmode="decimal" id="idt-price" placeholder="Preis in €">
              <button class="btn btn-primary" id="idt-add-price" aria-label="Hinzufügen">＋</button>
            </div>
          </div>

          <div class="alert-tier">Gleitende Durchschnitte · Kurs live, SMA aus TV-Daten</div>
          <div class="alert-add__group">
            <div class="alert-add__presets">
              ${MA_PRESETS.map((p) => `<button class="chip-btn" data-preset="${p.v}">${p.label}</button>`).join('')}
            </div>
          </div>

          <div class="alert-tier">Indikatoren · nur TV-Snapshot (letzter TV-Fetch)</div>
          <div class="alert-add__group">
            <div class="alert-add__presets">
              ${IND_PRESETS.map((p) => `<button class="chip-btn" data-preset="${p.v}">${p.label}</button>`).join('')}
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" id="idt-done">Fertig</button>
      </div>
    </div>`;
  document.body.appendChild(sub);

  const listEl = sub.querySelector('#idt-list');
  const noteEl = sub.querySelector('#idt-note');

  function persist() {
    onSaved?.();
    Promise.resolve(onSaveAlerts?.(c.id, c.alerts)).catch((err) =>
      toast?.(`Alert nicht gespeichert: ${err.message}`, 'error'));
  }

  function renderList() {
    if (!c.alerts.length) {
      listEl.innerHTML = '<li class="alert-empty muted">Noch keine Alerts. Art wählen, dann Level hinzufügen.</li>';
      return;
    }
    listEl.innerHTML = c.alerts.map((a) => {
      const off = a.enabled === false;
      const trig = !off && isAlertTriggered(c, a);
      const k = alertKind(a);
      return `<li class="alert-item${off ? ' is-off' : ''}${trig ? ' is-trig' : ''}" data-id="${a.id}">
        <button class="alert-toggle" data-act="toggle" title="${off ? 'Aktivieren' : 'Stummschalten'}">${off ? '○' : '●'}</button>
        <span class="alert-kind-tag alert-kind-tag--${k}">${ALERT_KINDS[k].emoji} ${ALERT_KINDS[k].label}</span>
        <span class="alert-text">${alertSummary(a)}${a.note ? `<span class="alert-note">📝 ${a.note}</span>` : ''}</span>
        ${trig ? '<span class="alert-trig-tag">ausgelöst</span>' : ''}
        <button class="alert-del" data-act="del" title="Löschen">🗑</button>
      </li>`;
    }).join('');
  }

  const note = () => noteEl.value.trim();
  function addAlert(a) {
    if (!a) { toast?.('Kein Entry/Kurs für Berechnung', 'error'); return; }
    c.alerts.push(a);
    noteEl.value = ''; // note applies to a single alert; reset for the next
    renderList();
    persist();
  }

  // Kind selector
  sub.querySelectorAll('.alert-kind__btn').forEach((btn) => {
    btn.addEventListener('pointerup', () => {
      kind = btn.dataset.kind;
      sub.querySelectorAll('.alert-kind__btn').forEach((b) => {
        const on = b.dataset.kind === kind;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
      });
    });
  });

  // Predefined Support / Resistance / Target chips
  sub.querySelectorAll('[data-lvl]').forEach((btn) => btn.addEventListener('pointerup', () => {
    const lvl = levels.find((l) => l.id === btn.dataset.lvl);
    if (!lvl) return;
    const cmp = (refPriceEur != null && lvl.priceEur < refPriceEur) ? 'below' : 'above';
    addAlert(buildManualPriceAlert({ cmp, priceEur: +lvl.priceEur.toFixed(4), kind, note: note(), label: lvl.label, basisKind: 'level' }));
  }));

  // Dynamic cluster-cross chips (recomputed level, no fixed price)
  sub.querySelectorAll('[data-cluster]').forEach((btn) => btn.addEventListener('pointerup', () =>
    addAlert(buildClusterAlert({ side: btn.dataset.cluster, kind, note: note() }))));

  // %-from-entry presets
  sub.querySelectorAll('[data-pct]').forEach((btn) => btn.addEventListener('pointerup', () =>
    addAlert(buildEntryPctAlert(c, parseFloat(btn.dataset.pct), { kind, note: note() }))));

  // Manual %
  sub.querySelector('#idt-add-pct').addEventListener('pointerup', () => {
    const pct = parseFloat(String(sub.querySelector('#idt-pct-manual').value).replace(',', '.'));
    if (!Number.isFinite(pct)) { toast?.('Prozent eingeben (z. B. 15 oder −8)', 'error'); return; }
    addAlert(buildEntryPctAlert(c, pct, { kind, note: note() }));
    sub.querySelector('#idt-pct-manual').value = '';
  });

  // Manual price
  sub.querySelector('#idt-add-price').addEventListener('pointerup', () => {
    const price = parseFloat(sub.querySelector('#idt-price').value);
    if (!Number.isFinite(price)) { toast?.('Preis eingeben', 'error'); return; }
    const cmp = sub.querySelector('#idt-dir').value;
    addAlert(buildManualPriceAlert({ cmp, priceEur: +price.toFixed(4), kind, note: note() }));
    sub.querySelector('#idt-price').value = '';
  });

  // SMA / indicator presets
  sub.querySelectorAll('[data-preset]').forEach((btn) =>
    btn.addEventListener('pointerup', () => addAlert(buildPresetAlert(btn.dataset.preset, { kind, note: note() }))));

  // List actions (toggle / delete) — delegated
  listEl.addEventListener('pointerup', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const li = btn.closest('.alert-item');
    const a = c.alerts.find((x) => x.id === li?.dataset.id);
    if (!a) return;
    if (btn.dataset.act === 'toggle') a.enabled = a.enabled === false;
    else if (btn.dataset.act === 'del') c.alerts = c.alerts.filter((x) => x.id !== a.id);
    renderList();
    persist();
  });

  const close = () => sub.remove();
  sub.querySelector('#idt-close').addEventListener('pointerup', close);
  sub.querySelector('#idt-done').addEventListener('pointerup', close);
  sub.addEventListener('pointerup', (e) => { if (e.target === sub) close(); });

  renderList();
}
