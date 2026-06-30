/**
 * Alert editor (formerly the free-text "Trigger" modal).
 *
 * Manages a candidate's `c.alerts` array — multiple alerts per ticker, each a
 * merkliste-compatible alert object. Three ways to add:
 *   • Manual price (≥/≤ a price in EUR)
 *   • %-from-entry stop/target (+10/+20/−10/−20/Manual %) anchored on the
 *     Merkliste entry (fallback Mein Entry / LS price)
 *   • Indicator presets (RSI overbought/oversold, MACD bullish/bearish)
 *
 * Every change persists immediately via onSaveAlerts(id, alerts).
 */

import {
  entryBasisEur, alertSummary, dirBadge, isAlertTriggered,
  buildManualPriceAlert, buildEntryPctAlert, buildPresetAlert,
} from '../lib/alerts.js?v=20260627h';

const fmtEur = (v) => (v == null ? '—' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');

const PCT_OPTS = [
  { v: '10',  label: 'Ziel +10%' },
  { v: '20',  label: 'Ziel +20%' },
  { v: '-10', label: 'Stop −10%' },
  { v: '-20', label: 'Stop −20%' },
  { v: 'manual', label: 'Manuell % …' },
];

// Price-driven (live LS price vs stored EMA level).
const MA_PRESETS = [
  { v: 'ema20',  label: '≤ EMA20' },
  { v: 'ema50',  label: '≤ EMA50' },
  { v: 'ema200', label: '≤ EMA200' },
];

// Pure TV-snapshot indicators (only as fresh as the last TV fetch).
const IND_PRESETS = [
  { v: 'rsi_os', label: 'RSI überverkauft' },
  { v: 'rsi_ob', label: 'RSI überkauft' },
  { v: 'macd_up', label: 'MACD bullish' },
  { v: 'macd_dn', label: 'MACD bearish' },
];

/**
 * @param {object} c candidate (mutated: c.alerts)
 * @param {object} opts
 * @param {(id:string, alerts:object[])=>Promise<void>} [opts.onSaveAlerts]
 * @param {()=>void} [opts.onSaved] re-render the table after a change
 * @param {(msg:string,type?:string)=>void} [opts.toast]
 */
export function openTriggerEditor(c, { onSaveAlerts, onSaved, toast } = {}) {
  if (!c) return;
  if (!Array.isArray(c.alerts)) c.alerts = [];
  const basis = entryBasisEur(c);

  const sub = document.createElement('div');
  sub.className = 'modal-overlay id-sub-overlay';
  sub.innerHTML = `
    <div class="modal id-trigger-modal" role="dialog" aria-modal="true" aria-label="Alerts">
      <div class="modal-header">
        <h2>Alerts · ${c.symbol}</h2>
        <button class="modal-close" id="idt-close" aria-label="Schließen">✕</button>
      </div>
      <div class="modal-body">
        <div class="alert-entry-row">
          Entry-Basis: <strong>${fmtEur(basis.value)}</strong>
          <span class="muted">${basis.source ? `(${basis.source})` : '(kein Entry / Kurs)'}</span>
        </div>

        <ul class="alert-list" id="idt-list"></ul>

        <div class="alert-add">
          <div class="alert-tier">Kurs · LS live</div>

          <div class="alert-add__group">
            <label>Stop / Ziel (% von Entry)</label>
            <select id="idt-pct">
              <option value="">— wählen —</option>
              ${PCT_OPTS.map((o) => `<option value="${o.v}">${o.label}</option>`).join('')}
            </select>
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

          <div class="alert-tier">Gleitende Durchschnitte · Kurs live, EMA aus TV-Daten</div>
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

  function persist() {
    onSaved?.();
    Promise.resolve(onSaveAlerts?.(c.id, c.alerts)).catch((err) =>
      toast?.(`Alert nicht gespeichert: ${err.message}`, 'error'));
  }

  function renderList() {
    if (!c.alerts.length) {
      listEl.innerHTML = '<li class="alert-empty muted">Noch keine Alerts. Unten hinzufügen.</li>';
      return;
    }
    listEl.innerHTML = c.alerts.map((a) => {
      const off = a.enabled === false;
      const trig = !off && isAlertTriggered(c, a);
      return `<li class="alert-item${off ? ' is-off' : ''}${trig ? ' is-trig' : ''}" data-id="${a.id}">
        <button class="alert-toggle" data-act="toggle" title="${off ? 'Aktivieren' : 'Stummschalten'}">${off ? '○' : '●'}</button>
        <span class="alert-badge">${dirBadge(a)}</span>
        <span class="alert-text">${alertSummary(a)}</span>
        ${trig ? '<span class="alert-trig-tag">ausgelöst</span>' : ''}
        <button class="alert-del" data-act="del" title="Löschen">🗑</button>
      </li>`;
    }).join('');
  }

  function addAlert(a) {
    if (!a) { toast?.('Kein Entry/Kurs für Berechnung', 'error'); return; }
    c.alerts.push(a);
    renderList();
    persist();
  }

  // %-from-entry dropdown
  sub.querySelector('#idt-pct').addEventListener('change', (e) => {
    const v = e.target.value;
    e.target.value = '';
    if (!v) return;
    let pct;
    if (v === 'manual') {
      const raw = window.prompt('Prozent vom Entry (z. B. 15 für +15%, -8 für Stop −8%):', '');
      if (raw == null) return;
      pct = parseFloat(raw.replace(',', '.'));
      if (!Number.isFinite(pct)) { toast?.('Ungültige Prozentangabe', 'error'); return; }
    } else {
      pct = parseFloat(v);
    }
    addAlert(buildEntryPctAlert(c, pct));
  });

  // Manual price
  sub.querySelector('#idt-add-price').addEventListener('pointerup', () => {
    const price = parseFloat(sub.querySelector('#idt-price').value);
    if (!Number.isFinite(price)) { toast?.('Preis eingeben', 'error'); return; }
    const dir = sub.querySelector('#idt-dir').value;
    addAlert(buildManualPriceAlert({ dir, priceEur: +price.toFixed(4) }));
    sub.querySelector('#idt-price').value = '';
  });

  // Indicator presets
  sub.querySelectorAll('[data-preset]').forEach((btn) =>
    btn.addEventListener('pointerup', () => addAlert(buildPresetAlert(btn.dataset.preset))));

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
