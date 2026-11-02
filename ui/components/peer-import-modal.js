/**
 * Prüffenster für Alternativen aus dem Claude-Chat (`#add=…`, siehe
 * `lib/peer-import.js`). Titel, die schon im Workspace liegen, lassen sich nicht
 * anhaken: `append_candidate` schreibt ohne Dublettenprüfung in die Inbox.
 */

import { icons } from '../lib/icons.js?v=20261027g';
import { candidateKey, resolveTickers } from '../lib/peer-import.js?v=20261102b';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function perf(label, v) {
  if (v == null) return `<small>${label} –</small>`;
  const cls = v >= 0 ? 'pos' : 'neg';
  return `<small>${label} <b class="${cls}">${v >= 0 ? '+' : ''}${Number(v).toFixed(1)}%</b></small>`;
}

const perfs = (c) => `<span class="pim-perf">${perf('1M', c?.tv_data?.perf_1m)}${perf('3M', c?.tv_data?.perf_3m)}</span>`;

function rowHtml(r, i, existing) {
  const c = r.candidate;
  const title = `<span class="pim-name"><b>${esc(r.symbol)}</b><small>${esc(c?.name && c.name !== r.symbol ? c.name : r.exchange)}</small></span>`;
  if (!c) {
    return `<div class="pim-row is-off">${title}<small>nicht gefunden</small></div>`;
  }
  const where = existing.get(candidateKey(c));
  if (where) {
    return `<div class="pim-row is-off">${title}${perfs(c)}<small class="pim-where">${esc(where)}</small></div>`;
  }
  return `<label class="pim-row"><input type="checkbox" value="${i}" checked>${title}${perfs(c)}</label>`;
}

/**
 * @param {object} o
 * @param {{items:object[], peer:object|null}} o.request
 * @param {string|null} o.blocked  Grund, warum hier nichts geschrieben werden kann
 * @param {{backendUrl:string, secret:string}} o.backend
 * @param {() => Promise<Map<string,string>>} o.loadExisting  Schlüssel → Bucket-Name
 * @param {(cands:object[]) => Promise<void>} o.onImport
 */
export function openPeerImportModal({ request, blocked = null, backend, loadExisting, onImport }) {
  const { items, peer } = request;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal pim-modal" role="dialog" aria-modal="true" aria-label="Alternativen prüfen">
      <div class="modal-header">
        <h2>${icons.sparkles} Alternativen${peer ? ` zu ${esc(peer.symbol)}` : ''}</h2>
        <button class="icon-btn" id="pim-close" aria-label="Schließen">${icons.xMark}</button>
      </div>
      <div class="modal-body" id="pim-body">
        ${blocked
          ? `<p class="aiq-status aiq-status--err">${esc(blocked)}</p>
             <p class="aip-intro">${items.map((t) => esc(t.symbol)).join(' · ')}</p>`
          : '<p class="aiq-status">Titel werden geprüft …</p>'}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="pim-cancel">Abbrechen</button>
        <button class="btn btn-primary" id="pim-add" disabled>In Inbox</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  overlay.querySelector('#pim-close').addEventListener('click', close);
  overlay.querySelector('#pim-cancel').addEventListener('click', close);
  if (blocked) return;

  const body = overlay.querySelector('#pim-body');
  const add = overlay.querySelector('#pim-add');
  let rows = [];

  const picked = () => [...body.querySelectorAll('input:checked')].map((i) => rows[Number(i.value)].candidate);
  const count = () => {
    const n = picked().length;
    add.disabled = !n;
    add.textContent = n ? `In Inbox (${n})` : 'In Inbox';
  };

  (async () => {
    try {
      const [existing, resolved] = await Promise.all([
        loadExisting(),
        resolveTickers(peer ? [...items, peer] : items, peer, backend),
      ]);
      const base = peer ? resolved.pop() : null;
      rows = resolved;
      if (!overlay.isConnected) return;
      body.innerHTML = `
        ${base?.candidate ? `<div class="pim-row pim-row--base"><span class="pim-name"><b>${esc(base.symbol)}</b><small>Ausgangstitel</small></span>${perfs(base.candidate)}</div>` : ''}
        ${rows.map((r, i) => rowHtml(r, i, existing)).join('')}`;
      body.querySelectorAll('input').forEach((i) => i.addEventListener('change', count));
      count();
    } catch (e) {
      body.innerHTML = `<p class="aiq-status aiq-status--err">Prüfung fehlgeschlagen: ${esc(e.message)}</p>`;
    }
  })();

  add.addEventListener('click', async () => {
    const cands = picked();
    if (!cands.length) return;
    add.disabled = true;
    add.textContent = 'Wird gespeichert …';
    try {
      await onImport(cands);
      close();
    } catch (e) {
      body.insertAdjacentHTML('beforeend', `<p class="aiq-status aiq-status--err">Speichern fehlgeschlagen: ${esc(e.message)}</p>`);
      count();
    }
  });
}
