/**
 * Nachkauf-Kalkulator (pro Portfolio-Ticker).
 *
 * Portiert aus der Merkliste-App (`openNachkauf` / `recomputeNachkauf`): rechnet
 * eine Aufstockung oder einen Teilverkauf durch und zeigt den daraus folgenden
 * Ø-Einstand bzw. Erlös.
 *
 * **Alles in EUR.** Einstand (`mk_entry`) und Stückzahl (`mk_shares`) kommen aus
 * dem Merkliste-Portfolio, der Live-Kurs von Lang & Schwarz (`ls_quote.price`) —
 * beide sind per Konvention EUR (der Kurs, den man bei Trade Republic zahlt).
 * Deshalb greift hier bewusst NICHT der USD/EUR-Umschalter der Tabelle: eine
 * umgerechnete Stückzahl wäre in der Broker-App nicht nachvollziehbar.
 *
 * Reiner Rechner – er schreibt nichts zurück (die Merkliste bleibt die Quelle
 * der Wahrheit für Einstand/Stückzahl).
 */

import { icons } from '../lib/icons.js?v=20260803c';

const num = (v, d = 2) =>
  v == null || !Number.isFinite(v) ? '—' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

const eur = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : `${num(v, d)} €`);

const signCls = (v) => (v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '');

const row = (label, value, cls = '') =>
  `<div class="nk-out__row"><span class="nk-out__lbl">${label}</span><span class="nk-out__val ${cls}">${value}</span></div>`;

const hint = (msg) => `<div class="nk-out__hint">${msg}</div>`;

const DEFAULT_PCT = 30;

export function openNachkaufModal(c) {
  if (!c) return;

  const entry  = c.mk_entry;              // EUR, aus der Merkliste
  const shares = c.mk_shares;             // Stück, aus der Merkliste (optional)
  const live   = c.ls_quote?.price ?? null; // EUR, Lang & Schwarz

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal nk-modal" role="dialog" aria-modal="true" aria-label="Nachkauf-Kalkulator ${c.symbol}">
      <div class="modal-header">
        <h2>${c.symbol} · Kalkulator</h2>
        <button class="icon-btn" id="nk-close" aria-label="Schließen">${icons.xMark}</button>
      </div>
      <div class="modal-body">
        <div class="nk-context">
          <span>Einstand <b>${eur(entry)}</b></span>
          <span>Stück <b>${shares != null ? num(shares, 0) : '—'}</b></span>
          <span>LS live <b>${eur(live)}</b></span>
        </div>

        <div class="nk-seg" role="tablist" aria-label="Art der Order">
          <button class="nk-seg__btn nk-seg__btn--buy is-active" data-type="buy" role="tab" aria-selected="true">Buy · Nachkauf</button>
          <button class="nk-seg__btn nk-seg__btn--sell" data-type="sell" role="tab" aria-selected="false">Sell · Teilverkauf</button>
        </div>

        <div class="nk-fields">
          <div class="nk-field">
            <label for="nk-pct" id="nk-pct-label">Aufstockung %</label>
            <input type="number" step="1" inputmode="decimal" id="nk-pct" value="${DEFAULT_PCT}">
          </div>
          <div class="nk-field">
            <label for="nk-price" id="nk-price-label">Nachkauf-Kurs (EUR)</label>
            <input type="number" step="0.01" inputmode="decimal" id="nk-price" value="${live != null ? live : ''}">
          </div>
        </div>

        <div class="nk-out" id="nk-out"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="nk-done">Schließen</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const $ = (sel) => overlay.querySelector(sel);
  const outEl   = $('#nk-out');
  const pctEl   = $('#nk-pct');
  const priceEl = $('#nk-price');
  let type = 'buy';

  function recompute() {
    const isBuy = type === 'buy';
    $('#nk-pct-label').textContent   = isBuy ? 'Aufstockung %' : 'Verkauf %';
    $('#nk-price-label').textContent = isBuy ? 'Nachkauf-Kurs (EUR)' : 'Verkaufskurs (EUR)';

    const pct   = parseFloat(pctEl.value);
    const price = parseFloat(priceEl.value);

    if (shares == null || !shares) {
      outEl.innerHTML = hint('Keine Stückzahl im Merkliste-Portfolio hinterlegt – ohne sie lässt sich die Position nicht hochrechnen.');
      return;
    }
    if (!Number.isFinite(pct) || !Number.isFinite(price) || price <= 0) {
      outEl.innerHTML = hint('Anteil und Kurs eingeben.');
      return;
    }

    if (isBuy) {
      if (entry == null) {
        outEl.innerHTML = hint('Kein Einstand in der Merkliste gepflegt – für die Buy-Kalkulation nötig.');
        return;
      }
      const oldValue  = entry * shares;
      const addValue  = oldValue * (pct / 100);
      const addShares = addValue / price;
      const newShares = shares + addShares;
      const newValue  = oldValue + addValue;
      const newAvg    = newValue / newShares;
      const liveValue = live != null ? newShares * live : null;
      const newPL     = liveValue != null ? liveValue - newValue : null;
      const newPLpct  = newPL != null && newValue ? (newPL / newValue) * 100 : null;
      // Ø-Einstand vorher → nachher ist die eigentliche Antwort des Rechners,
      // deshalb steht die Verschiebung als Nebenwert direkt darunter.
      const avgShift  = newAvg - entry;

      outEl.innerHTML =
        row('+ Investiert', eur(addValue)) +
        row('+ Stück', num(addShares, 4)) +
        row('Neuer Ø-Einstand', `${eur(newAvg)}<small class="nk-out__sub ${signCls(avgShift)}">${avgShift >= 0 ? '+' : '−'}${num(Math.abs(avgShift))} €</small>`) +
        row('Neue Position', `${num(newShares, 4)} St<small class="nk-out__sub">${eur(newValue)}</small>`) +
        (liveValue != null ? row('Live-Wert', eur(liveValue)) : '') +
        (newPL != null ? row('P/L danach', `${newPL >= 0 ? '+' : '−'}${num(Math.abs(newPL))} €<small class="nk-out__sub ${signCls(newPL)}">${newPLpct != null ? `${newPLpct >= 0 ? '+' : '−'}${num(Math.abs(newPLpct), 1)} %` : ''}</small>`, signCls(newPL)) : '');
    } else {
      const sellShares   = shares * (pct / 100);
      const proceeds     = sellShares * price;
      const remainShares = shares - sellShares;
      const pl           = entry != null ? proceeds - entry * sellShares : null;
      const liveRemain   = live != null ? remainShares * live : null;

      outEl.innerHTML =
        row('Verkauf Stück', num(sellShares, 4)) +
        row('Erlös', eur(proceeds)) +
        (pl != null
          ? row('P/L realisiert', `${pl >= 0 ? '+' : '−'}${num(Math.abs(pl))} €`, signCls(pl))
          : row('P/L realisiert', '<span class="muted">kein Einstand gepflegt</span>')) +
        row('Verbleibend', `${num(remainShares, 4)} St${liveRemain != null ? `<small class="nk-out__sub">${eur(liveRemain)} live</small>` : ''}`);
    }
  }

  overlay.querySelectorAll('.nk-seg__btn').forEach((btn) => {
    btn.addEventListener('pointerup', () => {
      type = btn.dataset.type;
      overlay.querySelectorAll('.nk-seg__btn').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
      });
      recompute();
    });
  });

  pctEl.addEventListener('input', recompute);
  priceEl.addEventListener('input', recompute);

  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  function onKey(e) { if (e.key === 'Escape') close(); }

  $('#nk-close').addEventListener('pointerup', close);
  $('#nk-done').addEventListener('pointerup', close);
  overlay.addEventListener('pointerup', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  recompute();
}
