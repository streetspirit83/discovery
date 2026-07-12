/**
 * News-Panel – Inhalt des News-Tabs im Markets-Modal.
 *
 * Drei Sub-Tabs:
 * - Märkte:    Markt-News mit Fokus auf die 4 häufigsten Sektoren im
 *              Watchlist-Bucket (Quellen: Marketaux + TradingView Data API).
 * - Portfolio: News zu den mit ★ markierten Werten (ROIC.ai) plus deren
 *              Sub-Sektoren und eigene RSS-/Google-Alert-Quellen.
 * - Quellen:   Pflege der eigenen RSS-/Google-Alert-Feeds (localStorage).
 *
 * Initiale Ausbaustufe: UI-Gerüst mit Demo-Daten; die Live-Fetcher docken in
 * `lib/news-feed.js` an.
 */

import { icons } from '../lib/icons.js?v=20260712b';
import { topSectors, portfolioCandidates, portfolioSubSectors, demoMarketNews, demoPortfolioNews } from '../lib/news-feed.js?v=20260712b';
import { loadNewsSources, addNewsSource, removeNewsSource } from '../lib/news-sources.js?v=20260712b';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = (Date.now() - d.getTime()) / 36e5;
  if (h < 1) return 'vor <1 h';
  if (h < 24) return `vor ${Math.round(h)} h`;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function newsItem(it) {
  const meta = [fmtWhen(it.date), it.source, ...(it.symbols ?? [])].filter(Boolean).map(esc).join(' · ');
  const title = it.url
    ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>`
    : esc(it.title);
  return `<article class="news-item">
    <div class="news-item__meta">${meta}${it.sector ? ` · <span class="news-item__tag">${esc(it.sector)}</span>` : ''}</div>
    <div class="news-item__title">${title}</div>
    ${it.text ? `<p class="news-item__text">${esc(it.text)}</p>` : ''}
  </article>`;
}

function chip(value, label, active, title = '') {
  return `<button class="pill${active ? ' pill--active' : ''}" data-chip="${esc(value)}" title="${esc(title)}">${esc(label)}</button>`;
}

function hint(text) {
  return `<div class="news-hint">${icons.info}<span>${text}</span></div>`;
}

function list(items, empty) {
  if (!items.length) return `<div class="news-empty"><span class="news-item__meta">${esc(empty)}</span></div>`;
  return `<div class="news-list">${items.map(newsItem).join('')}</div>`;
}

/* ── Sub-Tab: Märkte ─────────────────────────────────────────────────────── */

function renderMarketsPane(pane, sectors, filter) {
  const hasKeys = !!(localStorage.getItem('discovery_marketaux_key') || localStorage.getItem('discovery_rapidapi_key'));
  const items = demoMarketNews(sectors).filter((it) => filter === 'all' || it.sector === filter);
  pane.innerHTML = `
    ${hasKeys ? '' : hint('Demo-Daten – für Live-News Marketaux- oder RapidAPI-Key (TradingView) in den Einstellungen hinterlegen.')}
    <div class="news-chips">
      ${chip('all', 'Alle', filter === 'all')}
      ${sectors.map((s) => chip(s.sector, s.sector, filter === s.sector, `${s.count}× im Watch-Bucket`)).join('')}
    </div>
    ${list(items, 'Keine News für diesen Sektor.')}`;
}

/* ── Sub-Tab: Portfolio ──────────────────────────────────────────────────── */

function renderPortfolioPane(pane, watch, filter) {
  const port = portfolioCandidates(watch);
  const symbols = port.map((c) => c.symbol).filter(Boolean);
  const subSectors = portfolioSubSectors(watch);
  const hasRoic = !!localStorage.getItem('discovery_roic_key');
  const nSources = loadNewsSources().length;
  const items = demoPortfolioNews(symbols).filter((it) => filter === 'all' || (it.symbols ?? []).includes(filter));
  pane.innerHTML = `
    ${port.length ? '' : hint('Keine Werte mit ★ markiert – der Portfolio-Feed folgt den Stern-Werten im Watch-Bucket.')}
    ${hasRoic ? '' : hint('Demo-Daten – für Live-News ROIC.ai-Key in den Einstellungen hinterlegen; eigene Feeds im Sub-Tab „Quellen".')}
    <div class="news-chips">
      ${chip('all', 'Alle', filter === 'all')}
      ${symbols.map((s) => chip(s, `★ ${s}`, filter === s)).join('')}
      ${subSectors.map((s) => chip(`sub:${s}`, s, filter === `sub:${s}`, 'Sub-Sektor')).join('')}
    </div>
    ${nSources ? `<div class="news-item__meta news-src-count">${nSources} eigene Quelle${nSources === 1 ? '' : 'n'} (RSS/Google Alerts) aktiv</div>` : ''}
    ${list(items, 'Keine News für diese Auswahl.')}`;
}

/* ── Sub-Tab: Quellen ────────────────────────────────────────────────────── */

function renderSourcesPane(pane) {
  const sources = loadNewsSources();
  pane.innerHTML = `
    <div class="news-src-form">
      <select id="ns-type" aria-label="Quellen-Typ">
        <option value="rss">RSS-Feed</option>
        <option value="galert">Google Alert</option>
      </select>
      <input type="text" id="ns-label" placeholder="Name (optional)" autocomplete="off">
      <input type="url" id="ns-url" placeholder="https://…/feed" autocomplete="off">
      <button class="btn btn-primary btn-sm" id="ns-add" title="Quelle hinzufügen" aria-label="Quelle hinzufügen">${icons.plus}</button>
    </div>
    <div class="news-hint">${icons.info}<span>Google Alerts: im Alert „An RSS-Feed senden" wählen und die Feed-URL hier einfügen. Quellen werden nur lokal gespeichert (localStorage) und speisen den Portfolio-Feed.</span></div>
    ${sources.length
      ? `<div class="news-src-list">${sources.map((s) => `
          <div class="news-src-item" data-id="${esc(s.id)}">
            <span class="news-src-item__icon" title="${s.type === 'galert' ? 'Google Alert' : 'RSS-Feed'}">${s.type === 'galert' ? icons.bellPlus : icons.rss}</span>
            <span class="news-src-item__label">${esc(s.label)}</span>
            <span class="news-src-item__url" title="${esc(s.url)}">${esc(s.url)}</span>
            <button class="icon-btn news-src-item__del" data-del="${esc(s.id)}" title="Quelle entfernen" aria-label="Quelle entfernen">${icons.trash}</button>
          </div>`).join('')}</div>`
      : `<div class="news-empty"><span class="news-item__meta">Noch keine eigenen Quellen angelegt.</span></div>`}`;

  const rerender = () => renderSourcesPane(pane);
  pane.querySelector('#ns-add').addEventListener('pointerup', () => {
    const urlEl = pane.querySelector('#ns-url');
    try {
      addNewsSource({
        type: pane.querySelector('#ns-type').value,
        label: pane.querySelector('#ns-label').value,
        url: urlEl.value,
      });
      rerender();
    } catch (err) {
      urlEl.setCustomValidity(err.message);
      urlEl.reportValidity();
      setTimeout(() => urlEl.setCustomValidity(''), 2500);
    }
  });
  pane.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('pointerup', () => { removeNewsSource(btn.dataset.del); rerender(); });
  });
}

/* ── Panel ───────────────────────────────────────────────────────────────── */

/**
 * @param {HTMLElement} container leerer Host (News-Tab-Pane im Markets-Modal)
 * @param {{ getWatchCandidates?: () => Promise<Array> }} opts
 */
export function renderNewsPanel(container, { getWatchCandidates } = {}) {
  const state = { tab: 'markets', marketFilter: 'all', portfolioFilter: 'all', watch: [] };

  container.innerHTML = `
    <div class="news-panel">
      <div class="tab-bar news-subtabs" role="tablist">
        <button class="tab-btn active" data-ntab="markets" role="tab" aria-selected="true">Märkte</button>
        <button class="tab-btn" data-ntab="portfolio" role="tab" aria-selected="false">Portfolio</button>
        <button class="tab-btn" data-ntab="sources" role="tab" aria-selected="false">Quellen</button>
      </div>
      <div class="news-pane active" data-npane="markets" role="tabpanel"></div>
      <div class="news-pane" data-npane="portfolio" role="tabpanel"></div>
      <div class="news-pane" data-npane="sources" role="tabpanel"></div>
    </div>`;

  const pane = (name) => container.querySelector(`[data-npane="${name}"]`);

  const renderActive = () => {
    if (state.tab === 'markets') {
      renderMarketsPane(pane('markets'), topSectors(state.watch), state.marketFilter);
      pane('markets').querySelectorAll('[data-chip]').forEach((c) => c.addEventListener('pointerup', () => {
        state.marketFilter = c.dataset.chip; renderActive();
      }));
    } else if (state.tab === 'portfolio') {
      renderPortfolioPane(pane('portfolio'), state.watch, state.portfolioFilter);
      pane('portfolio').querySelectorAll('[data-chip]').forEach((c) => c.addEventListener('pointerup', () => {
        state.portfolioFilter = c.dataset.chip; renderActive();
      }));
    } else {
      renderSourcesPane(pane('sources'));
    }
  };

  container.querySelectorAll('[data-ntab]').forEach((btn) => {
    btn.addEventListener('pointerup', () => {
      state.tab = btn.dataset.ntab;
      container.querySelectorAll('[data-ntab]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      });
      container.querySelectorAll('[data-npane]').forEach((p) => p.classList.toggle('active', p.dataset.npane === state.tab));
      renderActive();
    });
  });

  renderActive();

  // Watch-Bucket asynchron laden → Sektor-/Portfolio-Chips nachziehen.
  (async () => {
    try {
      state.watch = (await getWatchCandidates?.()) ?? [];
      renderActive();
    } catch { /* Chips bleiben leer */ }
  })();
}
