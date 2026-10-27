/**
 * ai-prompt-modal.js — die Recherche-Prompts eines Titels zum Kopieren.
 *
 * Geöffnet über den ✨-Knopf in der Detail-Toolbar. Statt eines einzigen
 * Riesen-Prompts fünf gezielte (Moat & Wettbewerb · Red Flags · Insider ·
 * News & Ausblick · Extreme & Katalysatoren): Such-KIs beantworten fünf Fragen
 * nacheinander deutlich gründlicher als eine mit sieben Unterpunkten.
 *
 * Ein im Bearbeiten-Menü hinterlegter eigener Prompt (`research_prompt`)
 * erscheint als zusätzliche, erste Karte — er ersetzt nichts, sondern kommt
 * dazu: die fünf Bausteine bleiben nutzbar.
 *
 * Oben (nur Watch-Titel mit Backend) der Bereich „AI Research ins Dossier":
 * Prompts per Checkbox wählen — bewusst NICHTS vorausgewählt, jeder Prompt
 * kostet einen Recherche-Lauf — und in die Warteschlange stellen. Die Auswahl
 * landet als `research_request` am Titel; die geplante Aufgabe „Discovery
 * Research (App-Warteschlange)" arbeitet sie alle 2 h ab und schreibt die
 * Ergebnisse ins Dossier. Die Prompt-Liste kommt aus dem Artefakt „Dossier
 * Research" (dort editierbar), Fallback sind die eingebauten Vorlagen.
 * Die Kopier-Karten darunter rufen weiterhin nichts ab.
 */

import { icons } from '../lib/icons.js?v=20261021a';
import { stockPrompts } from '../lib/research-prompt.js?v=20261026b';
import { fairValue } from '../lib/tv-reverse-dcf.js?v=20260814o';

/* Clipboard-API gibt es nur im sicheren Kontext; der Textarea-Umweg ist der
   Fallback, den auch der Transcript-Knopf im Detail-Sheet nimmt. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* Fallback unten */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

const fmtDay = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }); };
const fmtAt = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : `${fmtDay(iso)} ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`; };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function card(p, idx) {
  return `
    <div class="aip-card" data-key="${p.key}">
      <div class="aip-card__head">
        <div class="aip-card__title">
          <b>${idx != null ? `${idx} · ` : ''}${p.label}</b>
          <small>${p.hint}</small>
        </div>
        <button class="btn btn-sm btn-secondary aip-copy" data-key="${p.key}">${icons.clipboard} Kopieren</button>
      </div>
      <details class="aip-card__more">
        <summary>Prompt ansehen (${Math.round(p.text.length / 100) / 10}k Zeichen)</summary>
        <pre class="aip-card__text">${esc(p.text)}</pre>
      </details>
    </div>`;
}

/* Bereich „AI Research ins Dossier": Status + Checkbox-Liste + Knopf. */
function queueHtml(c, prompts) {
  const pending = new Set(c.research_request?.keys ?? []);
  const label = (k) => prompts.find((p) => p.key === k)?.label ?? k;
  const err = c.research_error?.items?.length
    ? `<p class="aiq-status aiq-status--err">Fehlgeschlagen am ${fmtAt(c.research_error.at)}: ${c.research_error.items.map((f) => `${esc(label(f.key))} (${esc(f.err)})`).join(', ')}</p>` : '';
  const wait = pending.size
    ? `<p class="aiq-status">Wartet seit ${fmtAt(c.research_request.at)}: ${[...pending].map((k) => esc(label(k))).join(', ')} — die Aufgabe läuft alle 2 Stunden.</p>` : '';
  const rows = prompts.map((p) => {
    const last = c.research?.[p.key]?.at;
    const isPending = pending.has(p.key);
    return `<label class="aiq-row${isPending ? ' is-pending' : ''}">
      <input type="checkbox" value="${esc(p.key)}"${isPending ? ' disabled' : ''}>
      <span class="aiq-row__lbl">${esc(p.label)}</span>
      <small>${isPending ? 'wartet' : last ? `zuletzt ${fmtDay(last)}` : 'noch nie'}</small>
    </label>`;
  }).join('');
  return `${wait}${err}<div class="aiq-list">${rows}</div>
    <div class="aiq-foot">
      <small class="aiq-hint">${c.dossier?.doc_id ? 'Ergebnisse kommen in den Abschnitt „AI Research" des Dossiers.' : 'Noch kein Dossier — es wird mit dem Auftrag angelegt.'}</small>
      <button class="btn btn-sm btn-ai" id="aiq-send" disabled>In Warteschlange</button>
    </div>`;
}

/**
 * openAiPromptModal(candidate, { currency, queue })
 * `queue` (optional, nur Watch-Titel mit Backend):
 *   { catalog: () => Promise<[{key,label}]>, enqueue: (keys) => Promise<void> }
 *   `hint` statt `queue`: Text, warum es den Auftrag hier nicht gibt.
 * `currency` ist die native Währung des Titels — der Reverse-DCF und die
 * Screening-Daten im News-Prompt stehen darin.
 */
export function openAiPromptModal(c, { currency = 'USD', queue = null, hint = '' } = {}) {
  if (!c) return;

  /* Der Reverse-DCF wird hier einmal gerechnet und als Zahl in den Prompt
     gegeben; Referenzkurs ist der LS-Kurs wie im Fundamental-Tab. */
  const f = fairValue(c.tv_data ?? {}, c.ls_quote?.price != null ? { price: c.ls_quote.price } : {});
  const prompts = stockPrompts(c, {
    fair: f?.error ? null : f.fair_price,
    impliedGrowth: f?.error ? null : f.base_growth,
    currency,
  });

  const custom = (c.research_prompt ?? '').trim();
  const all = custom
    ? [{ key: 'custom', label: 'Eigener Prompt', hint: 'aus dem Bearbeiten-Menü dieses Titels', text: custom }, ...prompts]
    : prompts;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal aip-modal" role="dialog" aria-modal="true" aria-label="Research-Prompts ${c.symbol}">
      <div class="modal-header">
        <h2>${icons.sparkles} ${c.symbol} · Research-Prompts</h2>
        <button class="icon-btn" id="aip-close" aria-label="Schließen">${icons.xMark}</button>
      </div>
      <div class="modal-body">
        ${queue ? `<section class="aiq" id="aiq"><h3>${icons.sparkles} AI Research ins Dossier</h3><p class="aiq-status">Prompts werden geladen …</p></section>`
          : hint ? `<p class="aiq-status">${esc(hint)}</p>` : ''}
        <h3 class="aip-sub">Zum Kopieren</h3>
        <p class="aip-intro">Fünf Fragen statt einer: nacheinander in eine Such-KI
          (Perplexity, ChatGPT Search, Claude) einfügen. Jeder Prompt bringt seine
          eigenen Regeln für Belege und Formatierung mit.</p>
        ${all.map((p, i) => card(p, custom ? (i === 0 ? null : i) : i + 1)).join('')}
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  function onKey(e) { if (e.key === 'Escape') close(); }

  overlay.querySelectorAll('.aip-copy').forEach((btn) => {
    btn.addEventListener('pointerup', async () => {
      const p = all.find((x) => x.key === btn.dataset.key);
      if (!p) return;
      const ok = await copyText(p.text);
      btn.classList.toggle('is-ok', ok);
      btn.innerHTML = ok ? `${icons.check} kopiert` : '✗ fehlgeschlagen';
      setTimeout(() => {
        btn.classList.remove('is-ok');
        btn.innerHTML = `${icons.clipboard} Kopieren`;
      }, 2000);
    });
  });

  // Warteschlange: Prompt-Liste laden, Auswahl zählen, Auftrag senden.
  if (queue) {
    const box = overlay.querySelector('#aiq');
    let prompts = [];
    const head = box.querySelector('h3').outerHTML;
    const draw = () => {
      box.innerHTML = head + queueHtml(c, prompts);
      const send = box.querySelector('#aiq-send');
      const picked = () => [...box.querySelectorAll('input[type=checkbox]:checked')].map((i) => i.value);
      box.querySelectorAll('input[type=checkbox]').forEach((i) => i.addEventListener('change', () => {
        const n = picked().length;
        send.disabled = !n;
        send.textContent = n ? `In Warteschlange (${n})` : 'In Warteschlange';
      }));
      send.addEventListener('click', async () => {
        const keys = picked();
        if (!keys.length) return;
        send.disabled = true; send.textContent = 'Wird gespeichert …';
        try { await queue.enqueue(keys); draw(); }
        catch (e) { send.disabled = false; send.textContent = 'In Warteschlange'; box.insertAdjacentHTML('beforeend', `<p class="aiq-status aiq-status--err">${esc(e.message || 'Speichern fehlgeschlagen')}</p>`); }
      });
    };
    queue.catalog().then((list) => { prompts = list; draw(); })
      .catch(() => { box.innerHTML = head + '<p class="aiq-status aiq-status--err">Prompt-Liste nicht ladbar.</p>'; });
  }

  overlay.querySelector('#aip-close').addEventListener('pointerup', close);
  overlay.addEventListener('pointerup', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
}
