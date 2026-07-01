import { enrichCandidate } from '../lib/claude-api.js';
import { scoreRingSVG, renderPerformanceSection } from '../lib/price-viz.js?v=20260627j';
import { liveOverallScore } from '../lib/dashboard-metrics.js?v=20260627b';

const TV_LOGO  = 'https://s3.tradingview.com/userpics/6171439-mFQX_big.png';
const ST_LOGO  = 'https://avatars.githubusercontent.com/u/30304?s=200&v=4';
const YH_LOGO  = 'https://s.yimg.com/os/creatr-uploaded-images/2021-04/05009f00-a857-11eb-bfd7-56b7773a2529';

const CLOSE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const CHEV_L = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`;
const CHEV_R = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;

function formatDate(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatMarketCap(mc) {
  if (mc == null) return '—';
  if (mc >= 1e12) return `${(mc / 1e12).toFixed(1)}T`;
  if (mc >= 1e9)  return `${(mc / 1e9).toFixed(1)}B`;
  if (mc >= 1e6)  return `${(mc / 1e6).toFixed(0)}M`;
  return mc.toLocaleString('de-DE');
}

// Percent-unit fundamentals (already in %, e.g. 25.3 → "25.3%").
function pctVal(v) { return v == null ? '—' : `${v.toFixed(1)}%`; }
// Plain decimal ratios (e.g. debt/equity, EV/EBITDA).
function ratioVal(v) { return v == null ? '—' : v.toFixed(2); }
// Colour growth figures green/red.
function growthCls(v) { return v == null ? '' : v >= 0 ? 'tv-pos' : 'tv-neg'; }

function tvRatingClass(r) {
  if (r == null) return 'neutral';
  if (r > 0.5)  return 'strong-buy';
  if (r > 0.1)  return 'buy';
  if (r < -0.5) return 'strong-sell';
  if (r < -0.1) return 'sell';
  return 'neutral';
}

function tvRatingLabel(r) {
  if (r == null) return '—';
  if (r > 0.5)  return 'Strong Buy ↑↑';
  if (r > 0.1)  return 'Buy ↑';
  if (r < -0.5) return 'Strong Sell ↓↓';
  if (r < -0.1) return 'Sell ↓';
  return 'Neutral →';
}

function renderTVData(c) {
  const tv = c.tv_data;
  if (!tv) return '';
  const ratingClass = tvRatingClass(tv.rating);
  const description = tv.description ?? c.name ?? '';
  const industry = c.sub_sector ?? tv.industry ?? '';
  return `
    <div class="detail-section">
      <h3>TV Daten</h3>
      ${description ? `<p style="margin-bottom:8px;font-size:13px;color:var(--text)">${description}</p>` : ''}
      ${industry ? `<p style="margin-bottom:10px;font-size:12px;color:var(--muted)">${industry}${c.sector ? ` · ${c.sector}` : ''}</p>` : ''}
      <div class="tv-data-grid">
        <div class="tv-kv">
          <span>Rating</span>
          <strong class="tv-rating tv-rating--${ratingClass}">${tvRatingLabel(tv.rating)}${tv.rating != null ? ` (${tv.rating.toFixed(2)})` : ''}</strong>
        </div>
        <div class="tv-kv"><span>Market Cap</span><strong>${formatMarketCap(tv.market_cap)}</strong></div>
        <div class="tv-kv"><span>Kurs</span><strong>${tv.close != null ? tv.close.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</strong></div>
        <div class="tv-kv"><span>KGV (TTM)</span><strong>${tv.pe_ttm != null ? tv.pe_ttm.toFixed(1) : '—'}</strong></div>
        <div class="tv-kv"><span>Dividende</span><strong>${tv.dividend_yield != null ? tv.dividend_yield.toFixed(2) + '%' : '—'}</strong></div>
        <div class="tv-kv"><span>Nächste Earnings</span><strong>${tv.earnings_next_date ? formatDate(new Date(tv.earnings_next_date * 1000).toISOString()) : '—'}</strong></div>
        <div class="tv-kv"><span>RSI</span><strong>${tv.rsi != null ? tv.rsi.toFixed(1) : '—'}</strong></div>
        <div class="tv-kv"><span>Beta</span><strong>${tv.beta != null ? tv.beta.toFixed(2) : '—'}</strong></div>
        <div class="tv-kv"><span>ROE</span><strong>${pctVal(tv.return_on_equity)}</strong></div>
        <div class="tv-kv"><span>Op-Marge</span><strong>${pctVal(tv.operating_margin)}</strong></div>
        <div class="tv-kv"><span>Umsatz YoY</span><strong class="${growthCls(tv.total_revenue_yoy_growth_ttm)}">${pctVal(tv.total_revenue_yoy_growth_ttm)}</strong></div>
        <div class="tv-kv"><span>EBITDA YoY</span><strong class="${growthCls(tv.ebitda_yoy_growth_ttm)}">${pctVal(tv.ebitda_yoy_growth_ttm)}</strong></div>
        <div class="tv-kv"><span>Debt/Equity</span><strong>${ratioVal(tv.debt_to_equity)}</strong></div>
        <div class="tv-kv"><span>EV/EBITDA</span><strong>${ratioVal(tv.enterprise_value_ebitda_ttm)}</strong></div>
      </div>
      ${c.sector ? `<div class="tv-meta"><span class="tag">${c.sector}</span>${c.sub_sector ? `<span class="tag">${c.sub_sector}</span>` : ''}</div>` : ''}
      <small class="tv-fetched">Stand: ${formatDate(tv.fetched_at)}</small>
    </div>
  `;
}

function renderEnrichment(enrichment) {
  if (!enrichment) return '';
  const confidenceColor = { high: '#2ecc71', medium: '#f39c12', low: '#e74c3c' }[enrichment.confidence] ?? '#999';
  const upsideProb = enrichment.upside_20pct_probability;
  const upsideColor = upsideProb == null ? '#999' : upsideProb >= 60 ? '#2ecc71' : upsideProb >= 30 ? '#f39c12' : '#e74c3c';
  return `
    <div class="enrichment-result">
      <div class="enrichment-meta">
        <span class="badge" style="background:#6c3483;color:#fff">${enrichment.model}</span>
        <span class="badge confidence" style="color:${confidenceColor}">
          ${enrichment.confidence} confidence
        </span>
        ${upsideProb != null ? `
        <span class="badge confidence" style="color:${upsideColor}" title="${enrichment.upside_reasoning ?? ''}">
          ${upsideProb}% Chance auf +20% (1M)
        </span>
        ` : ''}
        <small>${formatDate(enrichment.enriched_at)}</small>
      </div>
      <div class="enrichment-tags">
        ${enrichment.sector ? `<span class="tag">${enrichment.sector}</span>` : ''}
        ${enrichment.industry ? `<span class="tag">${enrichment.industry}</span>` : ''}
        ${enrichment.market_cap_bucket ? `<span class="tag">${enrichment.market_cap_bucket} cap</span>` : ''}
        ${enrichment.region ? `<span class="tag">${enrichment.region}</span>` : ''}
      </div>
      <div class="enrichment-thesis">
        <p><strong>These:</strong> ${enrichment.thesis_short ?? ''}</p>
        ${enrichment.thesis_long ? `<details><summary>Ausführliche These</summary><div class="thesis-long">${enrichment.thesis_long.replace(/\n/g, '<br>')}</div></details>` : ''}
        ${upsideProb != null && enrichment.upside_reasoning ? `<p><strong>Upside-Einschätzung:</strong> ${enrichment.upside_reasoning}</p>` : ''}
      </div>
      ${enrichment.risks?.length ? `
        <div class="enrichment-section">
          <strong>Risiken:</strong>
          <ul>${enrichment.risks.map((r) => `<li>${r}</li>`).join('')}</ul>
        </div>
      ` : ''}
      ${enrichment.catalysts?.length ? `
        <div class="enrichment-section">
          <strong>Katalysatoren:</strong>
          <ul>${enrichment.catalysts.map((c) => `<li>${c}</li>`).join('')}</ul>
        </div>
      ` : ''}
      ${enrichment.recent_news?.length ? `
        <div class="enrichment-section">
          <strong>Aktuelle News:</strong>
          <ul>${enrichment.recent_news.map((n) => `<li>${n}</li>`).join('')}</ul>
        </div>
      ` : ''}
      ${enrichment.sentiment ? `
        <div class="enrichment-section">
          <strong>Sentiment:</strong> <span class="tag">${enrichment.sentiment}</span>
        </div>
      ` : ''}
    </div>
  `;
}

function renderSource(source, idx) {
  const rawJson = JSON.stringify(source.raw_signal ?? {}, null, 2);
  return `
    <details class="source-item" ${idx === 0 ? 'open' : ''}>
      <summary>
        <span class="source-adapter">${source.adapter}</span>
        <span class="source-signal">${source.signal_type}</span>
        <small>${formatDate(source.discovered_at)}</small>
      </summary>
      <div class="source-body">
        <p class="source-snippet">${source.info_snippet ?? ''}</p>
        <a href="${source.source_url}" target="_blank" rel="noopener">Quelle öffnen ↗</a>
        <details class="raw-signal">
          <summary>Raw Signal</summary>
          <pre>${rawJson}</pre>
        </details>
      </div>
    </details>
  `;
}

function linkBtn(href, logo, label, cssClass) {
  if (href) {
    return `<a href="${href}" target="_blank" rel="noopener" class="link-btn ${cssClass}">
      <img src="${logo}" class="link-btn-logo" alt="" loading="lazy"> ${label} ↗
    </a>`;
  }
  return `<span class="link-btn ${cssClass} link-btn--missing">
    <img src="${logo}" class="link-btn-logo" alt="" loading="lazy"> ${label}
  </span>`;
}

export class CandidateDetail {
  constructor(sheetEl, { onAction, onClose, getSiblings }) {
    this.el = sheetEl;
    this.onAction = onAction;
    this.onClose = onClose;
    this.getSiblings = getSiblings;   // () => ordered candidate list (current table sort)
    this.candidate = null;
  }

  // Step to the prev/next candidate in the current sort order (swipe / arrows).
  navigate(dir) {
    const list = this.getSiblings?.() ?? [];
    if (list.length < 2 || !this.candidate) return;
    const i = list.findIndex((c) => c.id === this.candidate.id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    this.show(list[j]);
    this.el.scrollTop = 0;
  }

  show(candidate) {
    this.candidate = candidate;
    this.render();
  }

  hide() {
    this.candidate = null;
    this.onClose?.();
  }

  render() {
    if (!this.candidate) return;
    const c = this.candidate;
    const links = c.links ?? {};

    const stateMap = {
      new: 'Neu', reviewed: 'Gesehen', promoted: 'Promoted',
      dismissed: 'Abgelehnt', imported: 'Importiert',
    };

    this.el.innerHTML = `
      <div class="sheet__header">
        <div class="detail-title">
          <h2>${c.symbol} <span class="exchange-tag">${c.exchange}</span></h2>
          <p class="detail-name">${c.tv_data?.description ?? c.name}</p>
          ${c.isin ? `<small class="isin isin--copy" id="detail-isin" role="button" tabindex="0" title="ISIN kopieren">ISIN: ${c.isin} 📋</small>` : ''}
        </div>
        <div class="detail-header-right">
          ${(() => { const ov = liveOverallScore(c.tv_data); return scoreRingSVG(ov?.total ?? null, ov?.labelCode ?? null); })()}
          <button class="icon-btn" id="detail-close" aria-label="Schließen">${CLOSE_ICON}</button>
        </div>
      </div>

      ${(() => {
        const list = this.getSiblings?.() ?? [];
        const idx = list.findIndex((x) => x.id === c.id);
        if (list.length < 2 || idx < 0) return '';
        return `<div class="detail-nav">
          <button class="detail-nav__btn" id="detail-prev" ${idx <= 0 ? 'disabled' : ''} aria-label="Vorheriger Kandidat">${CHEV_L} Zurück</button>
          <span class="detail-nav__pos">${idx + 1} / ${list.length}</span>
          <button class="detail-nav__btn" id="detail-next" ${idx >= list.length - 1 ? 'disabled' : ''} aria-label="Nächster Kandidat">Weiter ${CHEV_R}</button>
        </div>`;
      })()}

      <div class="detail-state">
        Status: <strong>${stateMap[c.workspace_state] ?? c.workspace_state}</strong>
        &nbsp;
        ${c.workspace_state !== 'promoted' && c.workspace_state !== 'imported'
          ? `<button class="btn btn-sm btn-success" id="detail-promote">✓ Promoten</button>`
          : ''}
        ${c.workspace_state !== 'dismissed'
          ? `<button class="btn btn-sm btn-danger" id="detail-dismiss">✗ Ablehnen</button>`
          : ''}
        <button class="btn btn-sm btn-secondary" id="detail-export">⤓ Export</button>
        ${c.workspace_state === 'new'
          ? `<button class="btn btn-sm" id="detail-review">👁 Als gesehen markieren</button>`
          : ''}
      </div>

      ${renderTVData(c)}

      ${renderPerformanceSection(c.tv_data)}

      <div class="detail-section">
        <h3>Quellen (${c.sources.length})</h3>
        <div class="sources-list">
          ${c.sources.map((s, i) => renderSource(s, i)).join('')}
        </div>
      </div>

      <div class="detail-section">
        <h3>Links</h3>
        <div class="detail-links-btns">
          ${linkBtn(links.tradingview, TV_LOGO, 'TradingView', 'link-tv')}
          ${linkBtn(links.stocktwits, ST_LOGO, 'StockTwits',  'link-st')}
          ${linkBtn(links.yahoo,      YH_LOGO, 'Yahoo Finance','link-yahoo')}
        </div>
        <div class="link-url-fields">
          <div class="link-url-row">
            <label>TradingView URL</label>
            <input type="url" id="lf-tv" value="${links.tradingview ?? ''}" placeholder="https://www.tradingview.com/…">
          </div>
          <div class="link-url-row">
            <label>StockTwits URL</label>
            <input type="url" id="lf-st" value="${links.stocktwits ?? ''}" placeholder="https://stocktwits.com/…">
          </div>
          <div class="link-url-row">
            <label>Yahoo Finance URL</label>
            <input type="url" id="lf-yahoo" value="${links.yahoo ?? ''}" placeholder="https://finance.yahoo.com/…">
          </div>
          <button class="btn btn-sm btn-secondary" id="detail-save-links">Links speichern</button>
        </div>
      </div>

      <div class="detail-section">
        <h3>Merkliste-Mapping</h3>
        <div class="link-url-fields">
          <div class="link-url-row">
            <label>Merkliste-Symbol (Fallback)</label>
            <input type="text" id="lf-merkliste" value="${c.merkliste_symbol ?? ''}" placeholder="z. B. RHM oder RHM.DE">
          </div>
          <button class="btn btn-sm btn-secondary" id="detail-save-merkliste">Mapping speichern</button>
          <p class="detail-hint">Zusätzlicher Schlüssel, um diesen Kandidaten dem Merkliste-Portfolio zuzuordnen (Einstand &amp; P/L), falls Symbol/Yahoo-Symbol nicht matchen.</p>
        </div>
      </div>

      <div class="detail-section">
        <h3>Notizen</h3>
        <textarea id="detail-notes" class="notes-editor" placeholder="Notizen…" rows="3">${c.notes ?? ''}</textarea>
        <button class="btn btn-sm btn-secondary" id="detail-save-notes">Speichern</button>
      </div>

      <div class="detail-section" id="enrichment-section">
        <h3>AI-Enrichment</h3>
        ${c.enrichment
          ? renderEnrichment(c.enrichment)
          : `<p class="no-enrichment">Noch kein Enrichment vorhanden.</p>`
        }
        <button class="btn btn-sm btn-ai" id="detail-enrich">
          ${c.enrichment ? '🔄 Neu enrichen' : '✨ AI-Enrichment ausführen'}
        </button>
        <div id="enrich-status" class="enrich-status" style="display:none"></div>
      </div>
    `;

    this.el.querySelector('#detail-close').addEventListener('pointerup', () => this.hide());

    const isinEl = this.el.querySelector('#detail-isin');
    if (isinEl) {
      const copyIsin = () => {
        if (!c.isin) return;
        navigator.clipboard?.writeText(c.isin).catch(() => {});
        this.onAction?.('isinCopied', c, { value: c.isin });
      };
      isinEl.addEventListener('pointerup', copyIsin);
      isinEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copyIsin(); } });
    }

    this.el.querySelector('#detail-promote')?.addEventListener('pointerup', () => {
      this.onAction?.('promote', c);
      c.workspace_state = 'promoted';
      this.render();
    });

    this.el.querySelector('#detail-dismiss')?.addEventListener('pointerup', () => {
      this.onAction?.('dismiss', c);
      c.workspace_state = 'dismissed';
      this.render();
    });

    this.el.querySelector('#detail-review')?.addEventListener('pointerup', () => {
      this.onAction?.('review', c);
      c.workspace_state = 'reviewed';
      this.render();
    });

    this.el.querySelector('#detail-export')?.addEventListener('pointerup', () => {
      this.onAction?.('export', c);
    });

    this.el.querySelector('#detail-prev')?.addEventListener('pointerup', () => this.navigate(-1));
    this.el.querySelector('#detail-next')?.addEventListener('pointerup', () => this.navigate(1));

    this.el.querySelector('#detail-save-links').addEventListener('pointerup', () => {
      const newLinks = {
        tradingview: this.el.querySelector('#lf-tv').value.trim(),
        stocktwits:  this.el.querySelector('#lf-st').value.trim(),
        yahoo:       this.el.querySelector('#lf-yahoo').value.trim(),
      };
      c.links = newLinks;
      this.onAction?.('saveLinks', c, { links: newLinks });
      this.render();
    });

    this.el.querySelector('#detail-save-notes').addEventListener('pointerup', () => {
      const notes = this.el.querySelector('#detail-notes').value;
      c.notes = notes;
      this.onAction?.('saveNotes', c, { notes });
    });

    this.el.querySelector('#detail-save-merkliste')?.addEventListener('pointerup', () => {
      const value = this.el.querySelector('#lf-merkliste').value.trim() || null;
      c.merkliste_symbol = value;
      this.onAction?.('saveMerklisteSymbol', c, { value });
    });

    this.el.querySelector('#detail-enrich').addEventListener('pointerup', async () => {
      const btn = this.el.querySelector('#detail-enrich');
      const statusEl = this.el.querySelector('#enrich-status');
      btn.disabled = true;
      statusEl.style.display = 'block';
      statusEl.textContent = 'Claude analysiert…';
      statusEl.className = 'enrich-status enrich-status--info';

      try {
        const enrichment = await enrichCandidate(c, {
          onProgress: (msg) => { statusEl.textContent = msg; },
        });
        c.enrichment = enrichment;
        this.onAction?.('enriched', c, { enrichment });
        this.render();
      } catch (err) {
        statusEl.textContent = `Fehler: ${err.message}`;
        statusEl.className = 'enrich-status enrich-status--error';
        btn.disabled = false;
      }
    });
  }
}
