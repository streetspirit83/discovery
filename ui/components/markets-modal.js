/**
 * Markets modal.
 *
 * Shows the live market indices (DAX / NASDAQ / NIKKEI / VIX) — moved out of the
 * Intra-Day modal — and embeds the Markets sub-page below in an iframe.
 * Opened from the "Markets" slot in the bottom navigation.
 */

import { icons } from '../lib/icons.js?v=20260701c';

const MARKETS_URL = 'https://streetspirit83.github.io/discovery/markets/?v=20260701b';

const DEFAULT_INDICATORS = [
  { label: 'DAX',    value: null, change: null, perf1m: null },
  { label: 'NASDAQ', value: null, change: null, perf1m: null },
  { label: 'NIKKEI', value: null, change: null, perf1m: null },
  { label: 'VIX',    value: null, change: null, perf1m: null },
];

const PREMARKETS_URL = 'https://edition.cnn.com/markets/premarkets';

const INDICATOR_LINKS = {
  DAX:    'https://www.tradingview.com/symbols/XETR-DAX/?utm_source=androidapp&utm_medium=share',
  NASDAQ: 'https://www.tradingview.com/symbols/TVC-NDQ/?utm_source=androidapp&utm_medium=share',
  NIKKEI: 'https://www.tradingview.com/symbols/TVC-NI225/?utm_source=androidapp&utm_medium=share',
  VIX:    'https://www.tradingview.com/symbols/CBOE-VIX/?utm_source=androidapp&utm_medium=share',
};

const fmtPct = (v, dec = 2) => (v == null || Number.isNaN(v) ? '–' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(dec)}%`);
const posNeg = (v) => (v == null ? '' : v >= 0 ? 'pos' : 'neg');

function indicatorChip(i) {
  const href = INDICATOR_LINKS[i.label];
  const tip = `${i.label}${i.value != null ? ` ${i.value.toLocaleString('de-DE')}` : ''} · heute ${fmtPct(i.change)} · 1M ${fmtPct(i.perf1m)} – auf TradingView öffnen`;
  // Narrow stacked chip (STYLEGUIDE.md §5): label / today / 1M, each on its own
  // short line so four equal blocks fit in ONE non-wrapping row; the 1M line is
  // one font-step smaller (§2).
  const inner = `<span class="id-ind__label">${i.label}</span>
    <span class="id-ind__val ${posNeg(i.change)}">${i.change != null ? fmtPct(i.change, 1) : '–'}</span>
    <span class="id-ind__m1 ${posNeg(i.perf1m)}">${i.perf1m != null ? fmtPct(i.perf1m, 1) : '–'}<span class="id-ind__m1tag">1M</span></span>`;
  return href
    ? `<a class="id-ind id-ind--link" href="${href}" target="_blank" rel="noopener" title="${tip}">${inner}</a>`
    : `<div class="id-ind" title="${tip}">${inner}</div>`;
}

export function renderMarketsModal({ indicators, onFetchIndicators } = {}) {
  if (document.getElementById('markets-modal-overlay')) return;
  let inds = indicators?.length ? indicators : DEFAULT_INDICATORS;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'markets-modal-overlay';
  overlay.innerHTML = `
    <div class="modal markets-modal" role="dialog" aria-modal="true" aria-label="Märkte">
      <div class="modal-header">
        <h2>${icons.barChart2} Märkte</h2>
        <div class="modal-header-actions">
          <a class="link-chip" href="${PREMARKETS_URL}" target="_blank" rel="noopener" title="CNN Pre-Markets öffnen" aria-label="CNN Pre-Markets öffnen">${icons.trendingUp}</a>
          <button class="icon-btn" id="mk-close" aria-label="Schließen">${icons.xMark}</button>
        </div>
      </div>
      <div class="modal-body">
        <div class="id-indicators" id="mk-indicators">${inds.map(indicatorChip).join('')}</div>
        <iframe class="markets-frame" src="${MARKETS_URL}" title="Markets" loading="lazy"></iframe>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.querySelector('#mk-close').addEventListener('pointerup', close);
  overlay.addEventListener('pointerup', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  // Fetch live indices (best-effort) and refresh the chips.
  (async () => {
    if (!onFetchIndicators) return;
    try {
      const r = await onFetchIndicators();
      if (Array.isArray(r) && r.length) {
        inds = r;
        const el = overlay.querySelector('#mk-indicators');
        if (el) el.innerHTML = inds.map(indicatorChip).join('');
      }
    } catch { /* keep placeholders */ }
  })();
}
