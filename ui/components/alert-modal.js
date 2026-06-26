/**
 * Alert-Overview modal — replaces the Intra-Day modal on the Home nav slot.
 *
 * Lists every candidate that has at least one alert, with:
 *   • a global "Mute all" toggle at the top (localStorage; the scheduled push
 *     will read the same flag from a settings blob later),
 *   • a select/unselect (●/○) icon per alert to enable/disable it individually,
 *   • the live triggered state, and an edit shortcut into the alert editor.
 */

import { ALERTS_MUTED_KEY, alertSummary, dirBadge, isAlertTriggered, candidateQuoteEur } from '../lib/alerts.js?v=20260626g';

const fmtEur = (v) => (v == null ? '—' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');

const isMuted = () => localStorage.getItem(ALERTS_MUTED_KEY) === '1';

/**
 * @param {object} opts
 * @param {object[]} opts.candidates current candidates (those with alerts are shown)
 * @param {(id:string, alerts:object[])=>Promise<void>} [opts.onSaveAlerts]
 * @param {(c:object)=>void} [opts.onOpenEditor] open the full alert editor
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

  function withAlerts() {
    return all.filter((c) => Array.isArray(c.alerts) && c.alerts.length);
  }

  function render() {
    const muted = isMuted();
    const cands = withAlerts();
    const totalAlerts = cands.reduce((n, c) => n + c.alerts.length, 0);
    overlay.querySelector('#al-count').textContent =
      cands.length ? `${cands.length} Ticker · ${totalAlerts} Alerts` : '';
    const muteBtn = overlay.querySelector('#al-mute');
    muteBtn.className = `btn ${muted ? 'btn-primary' : 'btn-secondary'}`;
    muteBtn.innerHTML = muted ? '🔕 Alle stummgeschaltet' : '🔔 Alle aktiv';

    if (!cands.length) {
      bodyEl.innerHTML = `<div class="empty-state">Keine Alerts angelegt.<br>
        <span class="muted">Über das <strong>+</strong> in der Tabelle (Aktions-Spalte) Alerts hinzufügen.</span></div>`;
      return;
    }

    bodyEl.innerHTML = cands.map((c) => {
      const q = candidateQuoteEur(c);
      const rows = c.alerts.map((a) => {
        const off = a.enabled === false;
        const trig = !muted && !off && isAlertTriggered(c, a);
        return `<li class="alert-item${off ? ' is-off' : ''}${trig ? ' is-trig' : ''}" data-cid="${c.id}" data-aid="${a.id}">
          <button class="alert-toggle" data-act="toggle" title="${off ? 'Aktivieren' : 'Stummschalten'}">${off ? '○' : '●'}</button>
          <span class="alert-badge">${dirBadge(a)}</span>
          <span class="alert-text">${alertSummary(a)}</span>
          ${trig ? '<span class="alert-trig-tag">ausgelöst</span>' : ''}
        </li>`;
      }).join('');
      return `<section class="alert-card${muted ? ' is-muted' : ''}">
        <header class="alert-card__head">
          <div>
            <strong>${c.symbol}</strong> <span class="muted">${c.name ?? ''}</span>
            <div class="alert-card__px">LS ${fmtEur(q.price)}</div>
          </div>
          <button class="chip-btn" data-edit="${c.id}">＋ / bearbeiten</button>
        </header>
        <ul class="alert-list">${rows}</ul>
      </section>`;
    }).join('');
  }

  // Per-alert enable/disable
  bodyEl.addEventListener('pointerup', (e) => {
    const toggle = e.target.closest('[data-act="toggle"]');
    if (toggle) {
      const li = toggle.closest('.alert-item');
      const c = all.find((x) => x.id === li.dataset.cid);
      const a = c?.alerts.find((x) => x.id === li.dataset.aid);
      if (!a) return;
      a.enabled = a.enabled === false;
      render();
      Promise.resolve(onSaveAlerts?.(c.id, c.alerts)).catch((err) =>
        toast?.(`Nicht gespeichert: ${err.message}`, 'error'));
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const c = all.find((x) => x.id === edit.dataset.edit);
      if (c && onOpenEditor) { close(); onOpenEditor(c); }
    }
  });

  // Global mute toggle — local for instant UI + server so the push honors it.
  overlay.querySelector('#al-mute').addEventListener('pointerup', () => {
    const next = !isMuted();
    localStorage.setItem(ALERTS_MUTED_KEY, next ? '1' : '0');
    render();
    Promise.resolve(onSetMute?.(next)).catch((err) =>
      toast?.(`Mute nicht synchronisiert: ${err.message}`, 'error'));
  });

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.querySelector('#al-close').addEventListener('pointerup', close);
  overlay.addEventListener('pointerup', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  render();
}
