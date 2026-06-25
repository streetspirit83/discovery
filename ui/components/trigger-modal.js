/**
 * Stand-alone Trigger editor (price markers + computed stop-loss).
 *
 * Mirrors the editor embedded in the Intra-Day modal so the same modal can be
 * opened from the candidate table's action column. Self-contained: takes the
 * candidate plus persistence/refresh callbacks. Reuses the global modal CSS.
 */

function fmtNum(v, dec = 2) {
  if (v == null) return '—';
  return Number(v).toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
const lastPrice = (c) => c.ls_quote?.price ?? c.tv_data?.close_1m ?? c.tv_data?.close ?? null;
const atrpOf = (c) => c.tv_data?.atrp ?? null;

function stopLossOptions(c) {
  const L = lastPrice(c), a = atrpOf(c), tv = c.tv_data ?? {};
  const opts = [];
  if (L != null) {
    if (a != null) {
      opts.push({ v: 'atr1', label: `−1×ATR  (${fmtNum(L * (1 - a / 100))})` });
      opts.push({ v: 'atr2', label: `−2×ATR  (${fmtNum(L * (1 - 2 * a / 100))})` });
    }
    [5, 8, 10].forEach((p) => opts.push({ v: `pct${p}`, label: `−${p}%  (${fmtNum(L * (1 - p / 100))})` }));
  }
  if (tv.ema20 != null)    opts.push({ v: 'ema20',   label: `EMA20  (${fmtNum(tv.ema20)})` });
  if (tv.pivot_s2 != null) opts.push({ v: 'pivots2', label: `Pivot S2  (${fmtNum(tv.pivot_s2)})` });
  return opts;
}

/**
 * @param {object} c candidate (mutated with c.intraday_trigger on save)
 * @param {object} opts
 * @param {(id:string,trigger:object)=>Promise<void>} [opts.onSaveTrigger] persistence
 * @param {()=>void} [opts.onSaved] re-render hook after save
 * @param {(msg:string,type?:string)=>void} [opts.toast]
 */
export function openTriggerEditor(c, { onSaveTrigger, onSaved, toast } = {}) {
  if (!c) return;
  const existing = c.intraday_trigger ?? {};
  const opts = stopLossOptions(c);

  const sub = document.createElement('div');
  sub.className = 'modal-overlay id-sub-overlay';
  sub.innerHTML = `
    <div class="modal id-trigger-modal" role="dialog" aria-modal="true" aria-label="Trigger">
      <div class="modal-header">
        <h2>Trigger · ${c.symbol}</h2>
        <button class="modal-close" id="idt-close" aria-label="Schließen">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="idt-markers">Preismarker (Freitext)</label>
          <textarea id="idt-markers" rows="3" placeholder="z. B. Einstieg 7,50 · Ziel 9,20 · Beobachten ab 8,00">${existing.markers ?? ''}</textarea>
        </div>
        <div class="form-group">
          <label for="idt-stop">Stop-Loss-Marke (berechnet)</label>
          <select id="idt-stop">
            <option value="">— keine —</option>
            ${opts.map((o) => `<option value="${o.v}"${existing.stop_loss === o.v ? ' selected' : ''}>${o.label}</option>`).join('')}
          </select>
          <small>Marken aus Last-Kurs, ATRP und TV-Leveln berechnet.</small>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="idt-cancel">Abbrechen</button>
        <button class="btn btn-primary" id="idt-save">Speichern</button>
      </div>
    </div>`;
  document.body.appendChild(sub);

  const closeSub = () => sub.remove();
  sub.querySelector('#idt-close').addEventListener('pointerup', closeSub);
  sub.querySelector('#idt-cancel').addEventListener('pointerup', closeSub);
  sub.addEventListener('pointerup', (e) => { if (e.target === sub) closeSub(); });
  sub.querySelector('#idt-save').addEventListener('pointerup', async () => {
    const trigger = {
      markers: sub.querySelector('#idt-markers').value.trim(),
      stop_loss: sub.querySelector('#idt-stop').value,
      saved_at: new Date().toISOString(),
    };
    c.intraday_trigger = trigger;
    onSaved?.();
    closeSub();
    try { await onSaveTrigger?.(c.id, trigger); }
    catch (err) { toast?.(`Trigger nicht gespeichert: ${err.message}`, 'error'); }
  });
}
