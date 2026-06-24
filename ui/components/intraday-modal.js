/**
 * Intra-Day Modal – opens on the (repurposed) Home nav slot.
 *
 * Scaffold: a focused intraday dashboard over the current bucket's candidates.
 *   • header  – live market indicators (DAX / NASDAQ / NIKKEI / VIX) — FETCH TBD,
 *               rendered from an injected `indicators` array (placeholders for now)
 *   • toolbar – refresh button (re-fetches Lang & Schwarz quotes for the rows)
 *   • table   – Symbol | Last | DayChg% | ATRP | Trigger
 *               · all columns sortable, optional "★ only" filter
 *               · ATRP cell shows a bar = |DayChg| / ATRP (green up, red down)
 *               · Trigger "+" opens a stub editor (price markers + stop-loss)
 *
 * Operates on live candidate refs, so a refresh that mutates `ls_quote` shows up
 * on re-render without re-wiring.
 */

// ── tiny local formatters ─────────────────────────────────────────────────────
function fmtNum(v, dec = 2) {
  return v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(dec);
}
function fmtPct(v, dec = 2) {
  return v == null || Number.isNaN(v) ? '—' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(dec)}%`;
}
function posNeg(v) {
  return v == null ? '' : v >= 0 ? 'pos' : 'neg';
}

// ── per-row accessors (LS quote first, TV as fallback) ────────────────────────
function lastPrice(c) {
  return c.ls_quote?.price ?? c.tv_data?.close_1m ?? c.tv_data?.close ?? null;
}
function dayChg(c) {
  return c.ls_quote?.change_pct ?? c.tv_data?.change_1d ?? null;
}
function atrpOf(c) {
  return c.tv_data?.atrp ?? null;
}

const SORTERS = {
  symbol: (c) => c.symbol?.toLowerCase() ?? '',
  last:   (c) => lastPrice(c),
  daychg: (c) => dayChg(c),
  atrp:   (c) => atrpOf(c),
};

const DEFAULT_INDICATORS = [
  { label: 'DAX',    value: null, change: null },
  { label: 'NASDAQ', value: null, change: null },
  { label: 'NIKKEI', value: null, change: null },
  { label: 'VIX',    value: null, change: null },
];

// Hard-wired TradingView symbol pages per indicator (tap opens in a new tab).
const INDICATOR_LINKS = {
  DAX:    'https://www.tradingview.com/symbols/XETR-DAX/?utm_source=androidapp&utm_medium=share',
  NASDAQ: 'https://www.tradingview.com/symbols/TVC-NDQ/?utm_source=androidapp&utm_medium=share',
  NIKKEI: 'https://www.tradingview.com/symbols/TVC-NI225/?utm_source=androidapp&utm_medium=share',
  VIX:    'https://www.tradingview.com/symbols/CBOE-VIX/?utm_source=androidapp&utm_medium=share',
};

// Sparkline geometry (viewBox units), shared by the renderer and the hover probe.
const SPARK = { W: 84, H: 24, P: 2 };
function sparkBounds(series, prevClose) {
  let lo = Math.min(...series), hi = Math.max(...series);
  if (prevClose != null) { lo = Math.min(lo, prevClose); hi = Math.max(hi, prevClose); }
  return { lo, hi, span: (hi - lo) || 1 };
}

/**
 * @param {object} opts
 * @param {object[]} opts.candidates           live candidate refs of the current bucket
 * @param {(ids:string[])=>Promise<{ok:boolean}|void>} [opts.onRefreshPrepare]  one-time gate/backfill before a sweep
 * @param {(c:object)=>Promise<object|null>} [opts.onRefreshTicker]  fetch ONE ticker's LS quote (mutates c)
 * @param {()=>Promise<{label:string,value:number|null,change:number|null}[]|null>} [opts.onFetchIndicators]  DAX/NASDAQ/NIKKEI/VIX
 * @param {(id:string,trigger:object)=>Promise<void>} [opts.onSaveTrigger]
 * @param {(msg:string,type?:string)=>void} opts.toast
 * @param {{label:string,value:number|null,change:number|null}[]} [opts.indicators]
 */
export function renderIntradayModal({ candidates, onRefreshPrepare, onRefreshTicker, onFetchIndicators, onSaveTrigger, onOpenDetail, toast, indicators }) {
  if (document.getElementById('intraday-modal-overlay')) return;

  const state = { sortCol: 'daychg', sortDir: 'desc', starOnly: false };
  let inds = indicators?.length ? indicators : DEFAULT_INDICATORS;

  function indicatorChip(i) {
    const href = INDICATOR_LINKS[i.label];
    const tip = `${i.label}${i.value != null ? ` ${i.value.toLocaleString('de-DE')}` : ''} – auf TradingView öffnen`;
    const inner = `<span class="id-ind__label">${i.label}</span>
      <span class="id-ind__val ${posNeg(i.change)}">${i.change != null ? fmtPct(i.change) : '–'}</span>`;
    return href
      ? `<a class="id-ind id-ind--link" href="${href}" target="_blank" rel="noopener" title="${tip}">${inner}</a>`
      : `<div class="id-ind" title="${tip}">${inner}</div>`;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'intraday-modal-overlay';
  overlay.innerHTML = `
    <div class="modal intraday-modal" role="dialog" aria-modal="true" aria-label="Intra-Day">
      <div class="modal-header">
        <h2>📈 Intra-Day</h2>
        <button class="modal-close" id="id-close" aria-label="Schließen">✕</button>
      </div>
      <div class="modal-body">
        <div class="id-indicators" id="id-indicators">
          ${inds.map(indicatorChip).join('')}
        </div>

        <div class="id-toolbar">
          <button class="id-refresh" id="id-refresh" title="Lang & Schwarz Kurse neu laden">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
          </button>
          <button class="id-star-filter" id="id-star-filter" title="Nur mit ★ markierte (Portfolio) anzeigen">★ nur markierte</button>
          <span class="id-hint" id="id-count"></span>
        </div>

        <div class="id-table-wrap">
          <table class="id-table">
            <thead>
              <tr>
                <th data-sort="symbol"><button class="id-sort">Symbol</button></th>
                <th class="num" data-sort="last"><button class="id-sort">Last</button></th>
                <th class="num" data-sort="daychg"><button class="id-sort">DayChg%</button></th>
                <th data-sort="atrp"><button class="id-sort">ATRP</button></th>
                <th>Verlauf</th>
                <th class="num">Trigger</th>
              </tr>
            </thead>
            <tbody id="id-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const $ = (sel) => overlay.querySelector(sel);
  const tbody = $('#id-tbody');

  function renderIndicators() {
    $('#id-indicators').innerHTML = inds.map(indicatorChip).join('');
  }
  async function refreshIndicators() {
    if (!onFetchIndicators) return;
    try {
      const r = await onFetchIndicators();
      if (Array.isArray(r) && r.length) { inds = r; renderIndicators(); }
    } catch { /* leave previous/placeholder values */ }
  }

  function visibleRows() {
    let rows = candidates.slice();
    if (state.starOnly) rows = rows.filter((c) => c.in_portfolio);
    const get = SORTERS[state.sortCol] ?? SORTERS.symbol;
    const dir = state.sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const va = get(a), vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') return va.localeCompare(vb) * dir;
      return (va - vb) * dir;
    });
    return rows;
  }

  function atrpCell(c) {
    const a = atrpOf(c);
    const chg = dayChg(c);
    if (a == null) return '<span class="muted-dash">—</span>';
    // Bar = how big today's move is vs. the typical ATR move (clamped to 100%).
    const ratio = (chg != null && a > 0) ? Math.min(Math.abs(chg) / a, 1) : 0;
    const cls = chg == null ? '' : chg >= 0 ? 'id-bar--pos' : 'id-bar--neg';
    return `<div class="id-atrp">
      <div class="id-bar"><div class="id-bar__fill ${cls}" style="width:${(ratio * 100).toFixed(0)}%"></div></div>
      <span class="id-atrp__val">${fmtNum(a, 1)}%</span>
    </div>`;
  }

  // Inline SVG day-trajectory sparkline: green/red by day direction, with a faint
  // dashed reference line at the previous close (above = up day, below = down day).
  function sparklineSVG(series, prevClose, chg) {
    const { W, H, P } = SPARK;
    const { lo, span } = sparkBounds(series, prevClose);
    const x = (i) => P + (i / (series.length - 1)) * (W - 2 * P);
    const y = (v) => P + (1 - (v - lo) / span) * (H - 2 * P);
    const pts = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const cls = chg == null ? '' : chg >= 0 ? 'id-spark--pos' : 'id-spark--neg';
    const ref = prevClose != null
      ? `<line x1="${P}" y1="${y(prevClose).toFixed(1)}" x2="${W - P}" y2="${y(prevClose).toFixed(1)}" class="id-spark__ref"/>`
      : '';
    return `<svg class="id-spark ${cls}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"`
      + ` data-series="${series.map((v) => Number(v).toFixed(4)).join(',')}"${prevClose != null ? ` data-prev="${prevClose}"` : ''}>`
      + `<rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/>`
      + ref
      + `<polyline points="${pts}" fill="none" class="id-spark__line"/>`
      + `<circle class="id-spark__dot" r="2.2" style="display:none"/>`
      + `</svg>`;
  }

  function sparkCell(c) {
    const q = c.ls_quote;
    const s = q?.series;
    if (!Array.isArray(s) || s.length < 2) return '<span class="muted-dash">—</span>';
    const lo = q.day_low, hi = q.day_high;
    const tip = (lo != null && hi != null) ? `Tagesspanne ${fmtNum(lo, 2)}–${fmtNum(hi, 2)}` : 'Tagesverlauf (LS)';
    return `<span title="${tip}">${sparklineSVG(s, q.prev_close, q.change_pct)}</span>`;
  }

  function triggerCell(c) {
    const t = c.intraday_trigger;
    const set = t && (t.markers || t.stop_loss);
    return `<button class="id-trigger${set ? ' is-set' : ''}" data-id="${c.id}" title="${set ? 'Trigger gesetzt – bearbeiten' : 'Trigger hinzufügen'}">${set ? '✓' : '+'}</button>`;
  }

  function renderTable() {
    const rows = visibleRows();
    $('#id-count').textContent = `${rows.length} Werte`;
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="id-empty">Keine Werte${state.starOnly ? ' mit ★-Markierung' : ''}.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((c) => {
      const chg = dayChg(c);
      const star = c.in_portfolio ? '<span class="id-star">★</span>' : '';
      return `<tr data-row-id="${c.id}">
        <td><span class="id-sym id-sym--link" role="button" tabindex="0" data-id="${c.id}" title="Detail öffnen">${star}${c.symbol}</span> <span class="id-exch">${c.exchange ?? ''}</span></td>
        <td class="num id-cell-last">${fmtNum(lastPrice(c))}</td>
        <td class="num id-cell-chg ${posNeg(chg)}">${fmtPct(chg)}</td>
        <td class="id-cell-atrp">${atrpCell(c)}</td>
        <td class="id-cell-spark">${sparkCell(c)}</td>
        <td class="num">${triggerCell(c)}</td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.id-trigger').forEach((btn) =>
      btn.addEventListener('pointerup', () => openTriggerEditor(btn.dataset.id)));

    tbody.querySelectorAll('.id-sym--link').forEach((el) => {
      const open = () => {
        const c = candidates.find((x) => x.id === el.dataset.id);
        if (!c) return;
        close();                 // close the Intra-Day overlay first (avoids stacking)
        onOpenDetail?.(c);
      };
      el.addEventListener('pointerup', open);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }

  // Briefly flash a cell green/red, restarting the animation if already running.
  function flash(el, dir) {
    if (!el) return;
    el.classList.remove('id-flash--up', 'id-flash--down');
    void el.offsetWidth; // force reflow so the animation re-triggers
    el.classList.add(`id-flash--${dir}`);
    el.addEventListener('animationend', () => el.classList.remove(`id-flash--${dir}`), { once: true });
  }

  // Update one row's figures in place (no full re-render) and animate the change.
  function updateRowCells(tr, c, prevLast) {
    const newLast = lastPrice(c);
    const chg = dayChg(c);
    const lastCell = tr.querySelector('.id-cell-last');
    const chgCell  = tr.querySelector('.id-cell-chg');
    const atrpEl   = tr.querySelector('.id-cell-atrp');
    const sparkEl  = tr.querySelector('.id-cell-spark');
    if (lastCell) lastCell.textContent = fmtNum(newLast);
    if (chgCell)  { chgCell.textContent = fmtPct(chg); chgCell.className = `num id-cell-chg ${posNeg(chg)}`; }
    if (atrpEl)   atrpEl.innerHTML = atrpCell(c);
    if (sparkEl)  sparkEl.innerHTML = sparkCell(c);

    let dir = null;
    if (prevLast != null && newLast != null && newLast !== prevLast) dir = newLast > prevLast ? 'up' : 'down';
    else if (prevLast == null && newLast != null) dir = 'up'; // first value lands
    if (dir) { flash(lastCell, dir); flash(chgCell, dir); }
  }

  function syncSortHeaders() {
    overlay.querySelectorAll('th[data-sort]').forEach((th) => {
      const active = th.dataset.sort === state.sortCol;
      th.classList.toggle('id-sorted', active);
      const btn = th.querySelector('.id-sort');
      const base = btn.textContent.replace(/[ ▲▼]+$/, '');
      btn.textContent = active ? `${base} ${state.sortDir === 'asc' ? '▲' : '▼'}` : base;
    });
  }

  // ── Trigger editor (stub) ────────────────────────────────────────────────────
  function stopLossOptions(c) {
    const L = lastPrice(c);
    const a = atrpOf(c);
    const tv = c.tv_data ?? {};
    const opts = [];
    if (L != null) {
      if (a != null) {
        opts.push({ v: `atr1`, label: `−1×ATR  (${fmtNum(L * (1 - a / 100))})` });
        opts.push({ v: `atr2`, label: `−2×ATR  (${fmtNum(L * (1 - 2 * a / 100))})` });
      }
      [5, 8, 10].forEach((p) => opts.push({ v: `pct${p}`, label: `−${p}%  (${fmtNum(L * (1 - p / 100))})` }));
    }
    if (tv.ema20 != null)    opts.push({ v: 'ema20',   label: `EMA20  (${fmtNum(tv.ema20)})` });
    if (tv.pivot_s2 != null) opts.push({ v: 'pivots2', label: `Pivot S2  (${fmtNum(tv.pivot_s2)})` });
    return opts;
  }

  function openTriggerEditor(id) {
    const c = candidates.find((x) => x.id === id);
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
      renderTable();
      closeSub();
      try { await onSaveTrigger?.(c.id, trigger); }
      catch (err) { toast?.(`Trigger nicht gespeichert: ${err.message}`, 'error'); }
    });
  }

  // ── Wiring ───────────────────────────────────────────────────────────────────
  overlay.querySelectorAll('th[data-sort]').forEach((th) =>
    th.querySelector('.id-sort').addEventListener('pointerup', () => {
      const col = th.dataset.sort;
      if (state.sortCol === col) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortCol = col; state.sortDir = col === 'symbol' ? 'asc' : 'desc'; }
      syncSortHeaders();
      renderTable();
    }));

  $('#id-star-filter').addEventListener('pointerup', () => {
    state.starOnly = !state.starOnly;
    $('#id-star-filter').classList.toggle('is-active', state.starOnly);
    renderTable();
  });

  $('#id-refresh').addEventListener('pointerup', async () => {
    const btn = $('#id-refresh');
    if (btn.classList.contains('is-loading')) return;
    const rows = visibleRows();
    if (rows.length === 0) return;
    btn.classList.add('is-loading');
    try {
      const prep = await onRefreshPrepare?.(rows.map((c) => c.id));
      if (prep && prep.ok === false) return;
      // Indices + VIX refresh alongside the LS sweep.
      const indicatorsP = refreshIndicators();
      // Sweep ticker by ticker: pulse the row being fetched, then animate its
      // figures the moment its quote lands. Sequential = a visible left-to-right wave.
      let ok = 0;
      for (const c of rows) {
        const tr = tbody.querySelector(`tr[data-row-id="${c.id}"]`);
        if (tr) tr.classList.add('id-row--updating');
        const prevLast = lastPrice(c);
        let q = null;
        try { q = await onRefreshTicker?.(c); } catch { /* keep sweeping */ }
        if (q?.price != null) ok++;
        if (tr) { tr.classList.remove('id-row--updating'); updateRowCells(tr, c, prevLast); }
      }
      await indicatorsP;
      toast?.(`LS aktualisiert: ${ok}/${rows.length}`, ok ? 'success' : 'info', 4000);
    } catch (err) {
      toast?.(`Aktualisieren fehlgeschlagen: ${err.message}`, 'error');
    } finally {
      btn.classList.remove('is-loading');
    }
  });

  // ── Sparkline hover tooltip (price at the hovered point) ─────────────────────
  const sparkTip = document.createElement('div');
  sparkTip.className = 'id-spark-tip';
  document.body.appendChild(sparkTip);
  let sparkDot = null;
  function hideSparkTip() {
    sparkTip.style.display = 'none';
    if (sparkDot) { sparkDot.style.display = 'none'; sparkDot = null; }
  }
  function onSparkMove(e) {
    const svg = e.target.closest?.('.id-spark');
    if (!svg || !svg.dataset.series) { hideSparkTip(); return; }
    const series = svg.dataset.series.split(',').map(Number);
    if (series.length < 2) { hideSparkTip(); return; }
    const prev = svg.dataset.prev ? Number(svg.dataset.prev) : null;
    const rect = svg.getBoundingClientRect();
    let idx = Math.round(((e.clientX - rect.left) / rect.width) * (series.length - 1));
    idx = Math.max(0, Math.min(series.length - 1, idx));
    const price = series[idx];
    const { lo, span } = sparkBounds(series, prev);
    const cx = SPARK.P + (idx / (series.length - 1)) * (SPARK.W - 2 * SPARK.P);
    const cy = SPARK.P + (1 - (price - lo) / span) * (SPARK.H - 2 * SPARK.P);
    const dot = svg.querySelector('.id-spark__dot');
    if (sparkDot && sparkDot !== dot) sparkDot.style.display = 'none';
    if (dot) { dot.setAttribute('cx', cx.toFixed(1)); dot.setAttribute('cy', cy.toFixed(1)); dot.style.display = ''; sparkDot = dot; }
    sparkTip.textContent = `€${price.toFixed(2)}`;
    sparkTip.style.left = `${e.clientX}px`;
    sparkTip.style.top = `${rect.top - 6}px`;
    sparkTip.style.display = 'block';
  }
  tbody.addEventListener('pointermove', onSparkMove);
  tbody.addEventListener('pointerleave', hideSparkTip);

  const close = () => { hideSparkTip(); sparkTip.remove(); overlay.remove(); };
  $('#id-close').addEventListener('pointerup', close);
  overlay.addEventListener('pointerup', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape' && !document.querySelector('.id-sub-overlay')) {
      close(); document.removeEventListener('keydown', esc);
    }
  });

  syncSortHeaders();
  renderTable();
  refreshIndicators(); // populate indices + VIX on open (best-effort)
}
