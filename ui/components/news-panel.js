/**
 * News-Panel – Inhalt des News-Tabs im Markets-Modal.
 *
 * Drei Sub-Tabs:
 * - Märkte:    Live-Markt-/Index-News (Marketaux + TradingView Data API,
 *              keine Einzelaktien-News) mit Fokus auf die 4 häufigsten
 *              Sektoren im Watchlist-Bucket.
 * - Portfolio: Eigene RSS-/Google-Alert-Quellen; Treffer werden per Symbol/
 *              Name den ★-Werten zugeordnet, Chips filtern nach Symbol/
 *              Sub-Sektor. (ROIC-Firmen-News: nur im Detail-Sheet.)
 * - Quellen:   Pflege der eigenen RSS-/Google-Alert-Feeds (localStorage).
 *
 * Ohne Keys zeigen Märkte/Portfolio Demo-Daten mit Hinweis; die Fetcher
 * liegen in `lib/news-feed.js` (30-min-Cache, Refresh erzwingt neu).
 */

import { icons } from '../lib/icons.js?v=20260807a';
import {
  topSectors, portfolioCandidates, portfolioSubSectors, sectorToIndustry,
  fetchMarketNews, fetchPortfolioNews, hasMarketNewsKeys,
  demoMarketNews, demoPortfolioNews,
} from '../lib/news-feed.js?v=20260807a';
import { loadNewsSources, addNewsSource, removeNewsSource } from '../lib/news-sources.js?v=20260807a';

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
  const meta = [fmtWhen(it.date), it.source, ...(it.symbols ?? []).slice(0, 3)].filter(Boolean).map(esc).join(' · ');
  const tag = it.industry ?? it.sector;
  const title = it.url
    ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>`
    : esc(it.title);
  return `<article class="news-item">
    <div class="news-item__meta">${meta}${tag ? ` · <span class="news-item__tag">${esc(tag)}</span>` : ''}</div>
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

/** Statuszeile unter den Chips: Stand + Fehler der einzelnen Quellen. */
function statusLine(data, loading) {
  if (loading) return `<div class="news-item__meta news-status">News werden geladen …</div>`;
  if (!data) return '';
  const parts = [];
  if (data.fetched_at) {
    const t = new Date(data.fetched_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    parts.push(`Stand ${t}${data.cached ? ' (Cache)' : ''}`);
  }
  const errs = (data.errors ?? []).map((e) => `<span class="news-status__err">${esc(e.source)}: ${esc(e.message)}</span>`).join(' · ');
  return `<div class="news-item__meta news-status">${parts.join(' · ')}${errs ? ` · ${errs}` : ''}</div>`;
}

/* ── Filter-Prädikate (Live-Items + Demo-Items) ──────────────────────────── */

function matchesSector(it, chipVal, watch) {
  if (chipVal === 'all') return true;
  if (it.sector === chipVal) return true;                       // Demo-Items
  const ind = sectorToIndustry(chipVal);
  if (ind && it.industry === ind) return true;                  // Marketaux-Industry
  const syms = new Set(watch.filter((c) => c.sector === chipVal).map((c) => c.symbol));
  return (it.symbols ?? []).some((s) => syms.has(s));           // Watch-Symbole im Sektor
}

function matchesPortfolio(it, chipVal, watch) {
  if (chipVal === 'all') return true;
  if (chipVal.startsWith('sub:')) {
    const sub = chipVal.slice(4);
    if (it.sub_sector === sub) return true;
    const syms = new Set(portfolioCandidates(watch).filter((c) => c.sub_sector === sub).map((c) => c.symbol));
    return (it.symbols ?? []).some((s) => syms.has(s));
  }
  return (it.symbols ?? []).includes(chipVal);
}

/* ── Sub-Tab: Märkte ─────────────────────────────────────────────────────── */

function renderMarketsPane(pane, state) {
  const sectors = topSectors(state.watch);
  const live = hasMarketNewsKeys();
  const items = (live ? (state.markets?.items ?? []) : demoMarketNews(sectors))
    .filter((it) => matchesSector(it, state.marketFilter, state.watch));
  pane.innerHTML = `
    ${live ? '' : hint('Demo-Daten – für Live-News Marketaux- oder RapidAPI-Key (TradingView) in den Einstellungen hinterlegen.')}
    <div class="news-chips">
      ${chip('all', 'Alle', state.marketFilter === 'all')}
      ${sectors.map((s) => chip(s.sector, s.sector, state.marketFilter === s.sector, `${s.count}× im Watch-Bucket`)).join('')}
      <span class="news-spacer"></span>
      ${live ? `<button class="icon-btn news-refresh" data-refresh="markets" title="News aktualisieren" aria-label="News aktualisieren">${icons.refreshCw}</button>` : ''}
    </div>
    ${live ? statusLine(state.markets, state.marketsLoading) : ''}
    ${state.marketsLoading ? '' : list(items, live ? 'Keine News gefunden.' : 'Keine News für diesen Sektor.')}`;
}

/* ── Sub-Tab: Portfolio ──────────────────────────────────────────────────── */

function renderPortfolioPane(pane, state) {
  const port = portfolioCandidates(state.watch);
  const symbols = port.map((c) => c.symbol).filter(Boolean);
  const subSectors = portfolioSubSectors(state.watch);
  const nSources = loadNewsSources().length;
  const live = nSources > 0;
  const items = (live ? (state.portfolio?.items ?? []) : demoPortfolioNews(symbols))
    .filter((it) => matchesPortfolio(it, state.portfolioFilter, state.watch));
  pane.innerHTML = `
    ${port.length ? '' : hint('Keine Werte mit ★ markiert – die Symbol-Chips folgen den Stern-Werten im Watch-Bucket.')}
    ${live ? '' : hint('Demo-Daten – eigene RSS-/Google-Alert-Feeds im Sub-Tab „Quellen" anlegen; Treffer werden per Symbol/Name den ★-Werten zugeordnet. (Firmen-News je Wert: Detail-Sheet → News-Tab.)')}
    <div class="news-chips">
      ${chip('all', 'Alle', state.portfolioFilter === 'all')}
      ${symbols.map((s) => chip(s, `★ ${s}`, state.portfolioFilter === s)).join('')}
      ${subSectors.map((s) => chip(`sub:${s}`, s, state.portfolioFilter === `sub:${s}`, 'Sub-Sektor')).join('')}
      <span class="news-spacer"></span>
      ${live ? `<button class="icon-btn news-refresh" data-refresh="portfolio" title="News aktualisieren" aria-label="News aktualisieren">${icons.refreshCw}</button>` : ''}
    </div>
    ${nSources ? `<div class="news-item__meta news-src-count">${nSources} eigene Quelle${nSources === 1 ? '' : 'n'} (RSS/Google Alerts) aktiv</div>` : ''}
    ${live ? statusLine(state.portfolio, state.portfolioLoading) : ''}
    ${state.portfolioLoading ? '' : list(items, live ? 'Keine News gefunden.' : 'Keine News für diese Auswahl.')}`;
}

/* ── Sub-Tab: Quellen ────────────────────────────────────────────────────── */

function renderSourcesPane(pane, onSourcesChanged) {
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
    <div class="news-hint">${icons.info}<span>Google Alerts: im Alert „An RSS-Feed senden" wählen und die Feed-URL hier einfügen. Quellen werden nur lokal gespeichert (localStorage) und speisen den Portfolio-Feed. Andere RSS-Hosts müssen ggf. im scrape-proxy freigeschaltet werden.</span></div>
    ${sources.length
      ? `<div class="news-src-list">${sources.map((s) => `
          <div class="news-src-item" data-id="${esc(s.id)}">
            <span class="news-src-item__icon" title="${s.type === 'galert' ? 'Google Alert' : 'RSS-Feed'}">${s.type === 'galert' ? icons.bellPlus : icons.rss}</span>
            <span class="news-src-item__label">${esc(s.label)}</span>
            <span class="news-src-item__url" title="${esc(s.url)}">${esc(s.url)}</span>
            <button class="icon-btn news-src-item__del" data-del="${esc(s.id)}" title="Quelle entfernen" aria-label="Quelle entfernen">${icons.trash}</button>
          </div>`).join('')}</div>`
      : `<div class="news-empty"><span class="news-item__meta">Noch keine eigenen Quellen angelegt.</span></div>`}`;

  const rerender = () => { onSourcesChanged?.(); renderSourcesPane(pane, onSourcesChanged); };
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
  const state = {
    tab: 'markets', marketFilter: 'all', portfolioFilter: 'all', watch: [],
    markets: null, marketsLoading: false,
    portfolio: null, portfolioLoading: false,
  };

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

  async function loadMarkets(force = false) {
    if (!hasMarketNewsKeys() || state.marketsLoading) return;
    state.marketsLoading = true;
    renderActive();
    try {
      state.markets = await fetchMarketNews({ sectors: topSectors(state.watch), force });
    } catch (err) {
      state.markets = { items: [], errors: [{ source: 'News', message: err.message }] };
    }
    state.marketsLoading = false;
    renderActive();
  }

  async function loadPortfolio(force = false) {
    if (!loadNewsSources().length || state.portfolioLoading) return;
    state.portfolioLoading = true;
    renderActive();
    try {
      state.portfolio = await fetchPortfolioNews({ candidates: state.watch, force });
    } catch (err) {
      state.portfolio = { items: [], errors: [{ source: 'News', message: err.message }] };
    }
    state.portfolioLoading = false;
    renderActive();
  }

  const renderActive = () => {
    if (state.tab === 'markets') {
      renderMarketsPane(pane('markets'), state);
      pane('markets').querySelectorAll('[data-chip]').forEach((c) => c.addEventListener('pointerup', () => {
        state.marketFilter = c.dataset.chip; renderActive();
      }));
      pane('markets').querySelector('[data-refresh]')?.addEventListener('pointerup', () => loadMarkets(true));
    } else if (state.tab === 'portfolio') {
      renderPortfolioPane(pane('portfolio'), state);
      pane('portfolio').querySelectorAll('[data-chip]').forEach((c) => c.addEventListener('pointerup', () => {
        state.portfolioFilter = c.dataset.chip; renderActive();
      }));
      pane('portfolio').querySelector('[data-refresh]')?.addEventListener('pointerup', () => loadPortfolio(true));
    } else {
      // Quellen geändert → Portfolio-Feed beim nächsten Öffnen neu laden.
      renderSourcesPane(pane('sources'), () => { state.portfolio = null; });
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
      // Lazy: Portfolio-Feed erst beim ersten Öffnen des Sub-Tabs laden.
      if (state.tab === 'portfolio' && !state.portfolio) loadPortfolio();
    });
  });

  renderActive();

  // Watch-Bucket zuerst laden (liefert Sektor-Fokus + ★-Werte), dann den
  // Märkte-Feed starten — so geht der Sektor-Filter in den Marketaux-Request.
  (async () => {
    try {
      state.watch = (await getWatchCandidates?.()) ?? [];
    } catch { /* Chips bleiben leer */ }
    renderActive();
    loadMarkets();
  })();
}
