/**
 * Alert-Overview modal — compact triage list, one row per symbol.
 *
 * Per row: symbol, name (truncated), trigger price, %Δ to that trigger, and a
 * Watch/Buy/Stop advice badge. Triggered symbols are highlighted. Tapping a row
 * opens the alert editor (add/modify); the per-symbol +/- toggle enables or
 * mutes all of that symbol's alerts. A global mute sits at the top.
 */

import {
  candidateQuoteEur, candidateTriggered, primaryPriceAlert, candidateAdvice,
  ALERTS_MUTED_KEY,
} from '../lib/alerts.js?v=20260703a';

const fmtEur = (v) => (v == null ? '—' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');
const fmtPct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
const isMuted = () => localStorage.getItem(ALERTS_MUTED_KEY) === '1';

/**
 * @param {object} opts
 * @param {object[]} opts.candidates current candidates (those with alerts are shown)
 * @param {(id:string, alerts:object[])=>Promise<void>} [opts.onSaveAlerts]
 * @param {(c:object)=>void} [opts.onOpenEditor] tap a row → open the alert editor
 * @param {(muted:boolean)=>void} [opts.onSetMute]
 * @param {(msg:string,type?:string)=>void} [opts.toast]
 */
export function renderAlertModal({ candidates, onSaveAlerts, onOpenEditor, onSetMute, toast } = {}) {
  if (document.getElementById('alert-modal-overlay')) return;
  const all = candidates ?? [];

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'alert-modal-overlay';
  overlay.innerHTML = `
    <div class="modal alert-modal" role="dialog" aria-modal="true" aria-label="Alerts">
      <div class="modal-header">
        <h2>🔔 Alerts</h2>
        <button class="modal-close" id="al-close" aria-label="Schließen">✕</button>
      </div>
      <div class="alert-modal__bar">
        <button class="btn ${isMuted() ? 'btn-primary' : 'btn-secondary'}" id="al-mute">
          ${isMuted() ? '🔕 Alle stummgeschaltet' : '🔔 Alle aktiv'}
        </button>
        <span class="muted" id="al-count"></span>
      </div>
      <div class="modal-body alert-modal__body" id="al-body"></div>
    </div>`;
  document.body.appendChild(overlay);

  const bodyEl = overlay.querySelector('#al-body');
  const withAlerts = () => all.filter((c) => Array.isArray(c.alerts) && c.alerts.length);

  function rowHtml(c) {
    const muted = isMuted();
    const trig = !muted && candidateTriggered(c);
    const anyOn = c.alerts.some((a) => a.enabled !== false);
    const pa = primaryPriceAlert(c);
    const adv = candidateAdvice(c);
    const q = candidateQuoteEur(c);
    return `<tr class="alrow${trig ? ' is-trig' : ''}${anyOn ? '' : ' is-off'}" data-cid="${c.id}">
      <td class="alrow__sym"><span class="alrow__symbtn">${c.symbol}</span></td>
      <td class="alrow__name" title="${(c.name || '').replace(/"/g, '')}">${c.name || ''}</td>
      <td class="num alrow__trig">${pa ? fmtEur(pa.threshold) : '—'}</td>
      <td class="num alrow__delta ${pa && pa.deltaPct != null ? (pa.deltaPct >= 0 ? 'pos' : 'neg') : ''}">${pa ? fmtPct(pa.deltaPct) : (q.price != null ? '—' : '—')}</td>
      <td class="alrow__adv"><span class="adv-badge adv-${adv.cls}">${adv.label}</span></td>
      <td class="num alrow__tog"><button class="alrow__plusminus" data-tog="${c.id}" title="${anyOn ? 'Alle Alerts stummschalten' : 'Alle Alerts aktivieren'}">${anyOn ? '−' : '+'}</button></td>
    </tr>`;
  }

  function render() {
    const muted = isMuted();
    const cands = withAlerts();
    const trigN = muted ? 0 : cands.reduce((n, c) => n + (candidateTriggered(c) ? 1 : 0), 0);
    overlay.querySelector('#al-count').textContent =
      cands.length ? `${cands.length} Symbole${trigN ? ` · ${trigN} ausgelöst` : ''}` : '';
    const muteBtn = overlay.querySelector('#al-mute');
    muteBtn.className = `btn ${muted ? 'btn-primary' : 'btn-secondary'}`;
    muteBtn.innerHTML = muted ? '🔕 Alle stummgeschaltet' : '🔔 Alle aktiv';

    if (!cands.length) {
      bodyEl.innerHTML = `<div class="empty-state">Keine Alerts angelegt.<br>
        <span class="muted">Über das <strong>+</strong> in der Tabelle (Aktions-Spalte) Alerts hinzufügen.</span></div>`;
      return;
    }
    // Triggered first, then by symbol.
    const sorted = [...cands].sort((a, b) =>
      (candidateTriggered(b) - candidateTriggered(a)) || String(a.symbol).localeCompare(b.symbol));
    bodyEl.innerHTML = `<table class="alert-table"><tbody>${sorted.map(rowHtml).join('')}</tbody></table>`;
  }

  bodyEl.addEventListener('pointerup', (e) => {
    // Per-symbol +/- toggle (does not open the editor).
    const tog = e.target.closest('[data-tog]');
    if (tog) {
      const c = all.find((x) => x.id === tog.dataset.tog);
      if (!c) return;
      const turnOn = !c.alerts.some((a) => a.enabled !== false);
      c.alerts.forEach((a) => { a.enabled = turnOn; });
      render();
      Promise.resolve(onSaveAlerts?.(c.id, c.alerts)).catch((err) =>
        toast?.(`Nicht gespeichert: ${err.message}`, 'error'));
      return;
    }
    // Tap anywhere else on the row → open the alert editor.
    const row = e.target.closest('.alrow');
    if (row) {
      const c = all.find((x) => x.id === row.dataset.cid);
      if (c && onOpenEditor) { close(); onOpenEditor(c); }
    }
  });

  overlay.querySelector('#al-mute').addEventListener('pointerup', () => {
    const next = !isMuted();
    localStorage.setItem(ALERTS_MUTED_KEY, next ? '1' : '0');
    render();
    Promise.resolve(onSetMute?.(next)).catch((err) => toast?.(`Mute nicht synchronisiert: ${err.message}`, 'error'));
  });

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.querySelector('#al-close').addEventListener('pointerup', close);
  overlay.addEventListener('pointerup', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  render();
}
