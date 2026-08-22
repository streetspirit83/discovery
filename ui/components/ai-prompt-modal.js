/**
 * ai-prompt-modal.js — die Recherche-Prompts eines Titels zum Kopieren.
 *
 * Geöffnet über den ✨-Knopf in der Detail-Toolbar. Statt eines einzigen
 * Riesen-Prompts vier gezielte (Moat & Wettbewerb · Red Flags · Insider ·
 * News & Ausblick): Such-KIs beantworten vier Fragen nacheinander deutlich
 * gründlicher als eine mit sieben Unterpunkten.
 *
 * Ein im Bearbeiten-Menü hinterlegter eigener Prompt (`research_prompt`)
 * erscheint als zusätzliche, erste Karte — er ersetzt nichts, sondern kommt
 * dazu: die vier Bausteine bleiben nutzbar.
 *
 * Reiner Kopier-Dialog: er ruft nichts ab und speichert nichts.
 */

import { icons } from '../lib/icons.js?v=20260807a';
import { stockPrompts } from '../lib/research-prompt.js?v=20260819l';
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

/**
 * openAiPromptModal(candidate, { currency })
 * `currency` ist die native Währung des Titels — der Reverse-DCF und die
 * Screening-Daten im News-Prompt stehen darin.
 */
export function openAiPromptModal(c, { currency = 'USD' } = {}) {
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
        <p class="aip-intro">Vier Fragen statt einer: nacheinander in eine Such-KI
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

  overlay.querySelector('#aip-close').addEventListener('pointerup', close);
  overlay.addEventListener('pointerup', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
}
