/**
 * index-news.js — Reiter „News" im Markets-Modal: TradingView-Headlines zu den Leitindizes.
 *
 * Derselbe Feed wie der News-Tab im Detail-Sheet (`news-headlines.tradingview.com/v2/headlines`,
 * über die scrape-proxy), nur mit Index-Symbolen. Gemessen (19.11.2026): NASDAQ:NDX, XETR:DAX und
 * SP:SPX liefern je 200 Einträge. Die Sprache wählt die Quellen: `de` bringt dpa-AFX
 * („Aktien Frankfurt Schluss", „INDEX-FLASH") und Reuters auf Deutsch, `en` Reuters, Benzinga u. a.
 *
 * Filter: Alle (die drei Feeds gemischt, Dubletten je Titel und Tag einmal, mit allen Index-Labels)
 * oder ein Index; Sprache DE/EN, gemerkt in localStorage `discovery_idxnews_lang`.
 * Abruf: `onFetch(ticker, lang, { force })` aus `app.js`, Ergebnis wie `buildTvNews`, 30 min Cache.
 */

import { icons } from '../lib/icons.js?v=20261103f';

export const INDEX_FEEDS = [
  { key: 'ndx', label: 'Nasdaq 100', short: 'Nasdaq', ticker: 'NASDAQ:NDX' },
  { key: 'dax', label: 'DAX', short: 'DAX', ticker: 'XETR:DAX' },
  { key: 'spx', label: 'S&P 500', short: 'S&P', ticker: 'SP:SPX' },
];
const LANG_KEY = 'discovery_idxnews_lang';
const LIMIT = 60;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const normKey = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

const TIME = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });
function when(iso) {
  const t = new Date(iso ?? '');
  if (Number.isNaN(+t)) return '';
  const min = Math.round((Date.now() - t) / 60e3);
  if (min >= 0 && min < 60) return `vor ${Math.max(1, min)} min`;
  const today = new Date().toDateString() === t.toDateString();
  return today ? TIME.format(t) : `${DAY.format(t)} ${TIME.format(t)}`;
}

/** Feeds mischen: gleicher Titel am selben Tag = eine Zeile mit allen Index-Labels. */
export function mergeIndexNews(byKey, keys) {
  const out = new Map();
  for (const k of keys) {
    for (const it of byKey[k]?.items ?? []) {
      const id = `${String(it.date ?? '').slice(0, 10)}|${normKey(it.title)}`;
      const hit = out.get(id);
      if (hit) { if (!hit.idx.includes(k)) hit.idx.push(k); continue; }
      out.set(id, { ...it, idx: [k] });
    }
  }
  return [...out.values()].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''))).slice(0, LIMIT);
}

function itemHtml(it, showIdx) {
  const labels = showIdx ? it.idx.map((k) => INDEX_FEEDS.find((f) => f.key === k)?.short).filter(Boolean) : [];
  const src = it.source_url
    ? `<a class="link-chip news-item__src" href="${esc(it.source_url)}" target="_blank" rel="noopener" title="Quelle öffnen" aria-label="Quelle öffnen">${icons.externalLink}</a>`
    : '';
  return `<article class="news-item">
    <div class="news-item__meta news-item__meta--row">
      <span>${esc(when(it.date))}${it.source ? ` · ${esc(it.source)}` : ''}${labels.map((l) => ` · <span class="news-item__tag">${esc(l)}</span>`).join('')}</span>${src}
    </div>
    <div class="news-item__title"><a href="${esc(it.search_url)}" target="_blank" rel="noopener" title="Bei Google suchen">${esc(it.title)}</a></div>
  </article>`;
}

/** Montiert den Reiter in `root`. `onFetch` = null → Hinweis „kein Backend". */
export function mountIndexNews(root, { onFetch } = {}) {
  let lang = 'de';
  try { lang = localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'de'; } catch { /* ignore */ }
  let sel = 'all';
  const data = { de: {}, en: {} };       // lang → key → { items } | { error }
  let loading = false;

  const seg = (attr, items, cur) => `<div class="dash-seg">${items
    .map(([k, l]) => `<button type="button" class="dash-seg__btn${k === cur ? ' is-active' : ''}" data-in-${attr}="${esc(k)}">${esc(l)}</button>`).join('')}</div>`;

  const draw = () => {
    const keys = sel === 'all' ? INDEX_FEEDS.map((f) => f.key) : [sel];
    const d = data[lang];
    const items = mergeIndexNews(d, keys);
    const errs = keys.filter((k) => d[k]?.error).map((k) => `${INDEX_FEEDS.find((f) => f.key === k).label}: ${d[k].error}`);
    const body = !onFetch ? '<p class="md-note">Index-News brauchen eine Backend-Verbindung (Einstellungen).</p>'
      : items.length ? items.map((it) => itemHtml(it, sel === 'all')).join('')
      : loading ? '<p class="md-note">Lade Headlines …</p>'
      : '<p class="md-note">Keine Headlines.</p>';
    root.innerHTML = `<div class="idx-news">
      <div class="md-ctl">
        ${seg('idx', [['all', 'Alle'], ...INDEX_FEEDS.map((f) => [f.key, f.label])], sel)}
        <div class="idx-news__right">
          ${seg('lang', [['de', 'DE'], ['en', 'EN']], lang)}
          <button type="button" class="icon-btn${loading ? ' is-busy' : ''}" data-in-reload title="Neu laden" aria-label="Neu laden"${loading ? ' disabled' : ''}>${icons.refreshCw}</button>
        </div>
      </div>
      ${errs.length ? `<p class="md-note">${errs.map(esc).join(' · ')}</p>` : ''}
      <div class="idx-news__list">${body}</div>
      <p class="md-note">TradingView-Headlines · Titel → Google-News-Suche, Icon → Quelle</p>
    </div>`;
  };

  const load = async (force = false) => {
    if (!onFetch) return draw();
    const l = lang;
    const keys = (sel === 'all' ? INDEX_FEEDS.map((f) => f.key) : [sel]).filter((k) => force || !data[l][k]?.items);
    if (!keys.length) return draw();
    loading = true; draw();
    await Promise.all(keys.map(async (k) => {
      try {
        const r = await onFetch(INDEX_FEEDS.find((f) => f.key === k).ticker, l, { force });
        data[l][k] = r ? { items: r.items ?? [] } : { error: 'nicht verfügbar' };
      } catch (e) {
        data[l][k] = { ...(data[l][k]?.items ? data[l][k] : {}), error: e.message };
      }
    }));
    loading = false; draw();
  };

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-in-idx],[data-in-lang],[data-in-reload]');
    if (!b) return;
    if (b.dataset.inIdx) { sel = b.dataset.inIdx; load(); }
    else if (b.dataset.inLang) {
      lang = b.dataset.inLang;
      try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
      load();
    } else load(true);
  });
  load();
}
