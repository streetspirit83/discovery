/**
 * Briefing-Modal – die Tages-Briefings der Cowork-Triage.
 *
 * Liest den `review`-Blob (Ringpuffer über 30 Tage) und zeigt je Tag: den
 * Makro-Block mit den drei Clustern als Streifen, die Earnings der nächsten
 * 14 Tage (aus den TV-Daten, nicht recherchiert) und
 * die geflaggten Titel. Geöffnet über das Fernrohr in der Topbar.
 *
 * Rein darstellend — das Modal ruft nichts ab außer dem Blob und schreibt nie.
 */

import { icons } from '../lib/icons.js?v=20260807a';
import {
  REVIEW_BLOB_TYPE, SIGNAL_CLASS, STATE_CLASS, STATE_LABELS, CLUSTER_LABELS,
  materialityLabel, fullDate, esc, normalizeDriver, normalizeCluster,
} from '../lib/cowork-review.js?v=20260924a';

const CLUSTER_ORDER = ['biotech', 'semis', 'tech'];

/* Die Kachel trägt nur das Signal — Label und Zustand, zwei kurze Zeilen, drei
   Spalten nebeneinander auch am Handy. Der erklärende Satz passt dort nicht
   hinein (er schrumpfte auf drei Wörter) und steht deshalb unter der Zeile. */
function clusterTile(cl) {
  const c = normalizeCluster(cl);
  const cls = STATE_CLASS[c.state] ?? 'neutral';
  return `<div class="bf-tile">
    <div class="bf-tile__label">${esc(CLUSTER_LABELS[c.key] ?? c.key)}</div>
    <div class="bf-tile__state bf-tile__state--${cls}">${esc(STATE_LABELS[c.state] ?? c.state)}</div>
  </div>`;
}

function clusterNote(cl) {
  const c = normalizeCluster(cl);
  if (!c.note || c.note === '—') return '';
  const src = c.sources?.[0];
  const link = src?.url
    ? `<a class="link-chip" href="${esc(src.url)}" target="_blank" rel="noopener"
         title="${esc(src.title ?? 'Quelle')}" aria-label="${esc(src.title ?? 'Quelle')}">${icons.newspaper}</a>`
    : '';
  return `<li class="bf-note">
    <span class="bf-note__label">${esc(CLUSTER_LABELS[c.key] ?? c.key)}</span>
    <span class="bf-note__text">${esc(c.note)}</span>
    ${link}
  </li>`;
}

function driverRow(d) {
  const { date, event } = normalizeDriver(d);
  return `<li class="bf-driver">
    <span class="bf-driver__date">${esc(date || '—')}</span>
    <span class="bf-driver__event">${esc(event)}</span>
  </li>`;
}

function highlightRow(h, onPick) {
  const cls = SIGNAL_CLASS[h.signal] ?? 'neutral';
  return `<li class="bf-hit" ${onPick ? `data-id="${esc(h.id)}" role="button" tabindex="0"` : ''}>
    <span class="cow-mark cow-mark--${cls}" title="${esc(materialityLabel(h.materiality))}">
      <span class="cow-mark__dot" aria-hidden="true"></span><span class="cow-mark__num">${h.materiality}</span></span>
    <span class="bf-hit__sym">${esc(h.symbol)}</span>
    <span class="bf-hit__head">${esc(h.headline ?? '')}</span>
  </li>`;
}

function renderEntry(b, opts) {
  if (!b) {
    return `<p class="pv-muted">Für diesen Tag liegt kein Briefing vor.</p>`;
  }
  const macro = b.macro ?? {};
  const byKey = new Map((macro.clusters ?? []).map((c) => [normalizeCluster(c).key, c]));
  // Feste kleine Anzahl → immer EINE Zeile (Styleguide §5); fehlt ein Cluster,
  // steht die Kachel trotzdem, damit die drei Spalten nie springen.
  const cells = CLUSTER_ORDER.map((k) => byKey.get(k) ?? { key: k, state: 'neutral', note: '' });
  const tiles = cells.map(clusterTile).join('');
  const notes = cells.map(clusterNote).join('');

  const drivers = (macro.drivers ?? []).map(driverRow).join('');
  const hits = (b.highlights ?? []).map((h) => highlightRow(h, opts.onOpenCandidate)).join('');
  const s = b.stats ?? {};

  return `
    <div class="bf-tiles">${tiles}</div>

    ${notes ? `<ul class="bf-notes">${notes}</ul>` : ''}

    ${macro.summary ? `<p class="bf-summary">${esc(macro.summary)}</p>` : ''}

    ${drivers ? `<section class="bf-section">
      <h3 class="bf-h">Earnings (14 Tage)</h3>
      <ul class="bf-drivers">${drivers}</ul>
    </section>` : ''}

    <section class="bf-section">
      <h3 class="bf-h">Auffällig (${b.highlights?.length ?? 0})</h3>
      ${hits ? `<ul class="bf-hits">${hits}</ul>` : '<p class="pv-muted">Heute nichts Auffälliges.</p>'}
    </section>

    <p class="bf-foot pv-muted">
      ${s.reviewed ?? 0} Titel geprüft · ${s.with_news ?? 0} mit Nachrichten ·
      ${s.flagged ?? 0} auffällig${s.errors ? ` · ${s.errors} Fehler` : ''} ·
      erstellt ${esc(fullDate(b.generated_at))}
    </p>`;
}

/**
 * @param {object}   opts
 * @param {function} opts.loadBlob            – async (blobType) => blob
 * @param {function} [opts.onOpenCandidate]   – (symbol) => void
 */
export function renderBriefingModal(opts = {}) {
  if (document.getElementById('briefing-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'briefing-modal-overlay';
  overlay.innerHTML = `
    <div class="modal briefing-modal" role="dialog" aria-modal="true" aria-label="Briefing">
      <div class="modal-header">
        <h2>${icons.newspaper} Briefing</h2>
        <div class="modal-header-actions">
          <select class="bf-pick" id="bf-pick" aria-label="Tag wählen"></select>
          <button class="icon-btn" id="bf-close" aria-label="Schließen">${icons.xMark}</button>
        </div>
      </div>
      <div class="modal-body" id="bf-body">
        <p class="pv-muted"><span class="ls-loading"></span> Lade Briefing …</p>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.querySelector('#bf-close').addEventListener('pointerup', close);
  overlay.addEventListener('pointerup', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  const body = overlay.querySelector('#bf-body');
  const pick = overlay.querySelector('#bf-pick');

  const mount = (briefings, idx) => {
    body.innerHTML = renderEntry(briefings[idx], opts);
    if (!opts.onOpenCandidate) return;
    body.querySelectorAll('.bf-hit[data-id]').forEach((el) => {
      const open = () => { close(); opts.onOpenCandidate(el.dataset.id); };
      el.addEventListener('pointerup', open);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });
  };

  (async () => {
    let briefings = [];
    try {
      const blob = await opts.loadBlob?.(REVIEW_BLOB_TYPE);
      briefings = Array.isArray(blob?.briefings) ? blob.briefings : [];
    } catch (err) {
      body.innerHTML = `<p class="pv-muted">Briefing konnte nicht geladen werden: ${esc(err.message)}</p>`;
      return;
    }
    if (!briefings.length) {
      pick.hidden = true;
      body.innerHTML = `<p class="pv-muted">Noch kein Briefing vorhanden. Der geplante
        Cowork-Lauf legt jeden Morgen um 7:30 Uhr eines ab.</p>`;
      return;
    }
    pick.innerHTML = briefings
      .map((b, i) => `<option value="${i}">${esc(b.date ?? '—')}</option>`).join('');
    pick.addEventListener('change', () => mount(briefings, Number(pick.value)));
    mount(briefings, 0);
  })();
}
