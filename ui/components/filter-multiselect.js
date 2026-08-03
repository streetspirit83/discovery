/**
 * Filterbar-Multi-Select: Button im .filter-select-Look, der ein Popover mit
 * Checkbox-Optionen öffnet. Ersetzt die nativen Single-Select-Dropdowns der
 * Filterbar, damit mehrere Klassen (Sektoren, Score-Bänder, …) gleichzeitig
 * filterbar sind. Auswahl-Semantik: OR innerhalb eines Filters, AND über die
 * Filter hinweg (Auswertung in candidate-list.js getFiltered()).
 *
 * Das Popover hängt am <body> (fixed), weil die Filterbar horizontal scrollt
 * und ein absolut positioniertes Kind abschneiden würde. Es schließt bei
 * Klick außerhalb, Escape, Scroll und wenn der Button aus dem DOM fällt
 * (Filterbar-Re-Render).
 */

import { icons } from '../lib/icons.js?v=20260803a';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

let openPop = null; // nur ein offenes Popover zur Zeit

function closeOpen() {
  if (!openPop) return;
  openPop.pop.remove();
  openPop.teardown();
  openPop = null;
}

/**
 * @param {{ id:string, label:string, title?:string,
 *           options:Array<{value:string,label:string}>,
 *           selected:string[], onChange:(values:string[])=>void }} opts
 * @returns {HTMLElement} Button, direkt in die Filterbar einhängbar
 */
export function filterMultiSelect({ id, label, title = '', options, selected = [], onChange }) {
  const values = new Set(selected);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = id;
  btn.className = 'filter-select fms-btn';
  if (title) btn.title = title;
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');

  const renderBtn = () => {
    const n = values.size;
    const text = n === 0 ? label
      : n === 1 ? (options.find((o) => values.has(o.value))?.label ?? label)
      : `${label} · ${n}`;
    btn.innerHTML = `<span class="fms-btn__text">${esc(text)}</span>${icons.chevronDown}`;
    btn.classList.toggle('filter-select--active', n > 0);
  };
  renderBtn();

  const open = () => {
    const pop = document.createElement('div');
    pop.className = 'fms-pop';
    pop.setAttribute('role', 'listbox');
    pop.setAttribute('aria-multiselectable', 'true');
    pop.innerHTML = options.map((o) => `
      <label class="fms-opt">
        <input type="checkbox" value="${esc(o.value)}"${values.has(o.value) ? ' checked' : ''}>
        <span>${esc(o.label)}</span>
      </label>`).join('');

    // Unter dem Button verankern; am rechten Viewport-Rand nach links ausweichen.
    const r = btn.getBoundingClientRect();
    pop.style.top = `${r.bottom + 4}px`;
    pop.style.left = `${r.left}px`;
    document.body.appendChild(pop);
    const pw = pop.offsetWidth;
    if (r.left + pw > window.innerWidth - 8) pop.style.left = `${Math.max(8, window.innerWidth - pw - 8)}px`;

    pop.querySelectorAll('input').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) values.add(cb.value); else values.delete(cb.value);
        renderBtn();
        onChange([...values]);
      });
    });

    const onDown = (e) => { if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeOpen(); };
    const onKey = (e) => { if (e.key === 'Escape') closeOpen(); };
    const onScroll = (e) => { if (!pop.contains(e.target)) closeOpen(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    const teardown = () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
      btn.setAttribute('aria-expanded', 'false');
    };
    openPop = { pop, teardown, btn };
    btn.setAttribute('aria-expanded', 'true');
  };

  btn.addEventListener('pointerup', () => {
    if (openPop?.btn === btn) { closeOpen(); return; }
    closeOpen();
    open();
  });

  return btn;
}
