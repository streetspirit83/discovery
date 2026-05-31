import { enrichCandidate } from '../lib/claude-api.js';

const TV_LOGO  = 'https://s3.tradingview.com/userpics/6171439-mFQX_big.png';
const ST_LOGO  = 'https://avatars.githubusercontent.com/u/30304?s=200&v=4';
const YH_LOGO  = 'https://s.yimg.com/os/creatr-uploaded-images/2021-04/05009f00-a857-11eb-bfd7-56b7773a2529';

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
  return `
    <div class="detail-section">
      <h3>TV Daten</h3>
      <div class="tv-data-grid">
        <div class="tv-kv">
          <span>Rating</span>
          <strong class="tv-rating tv-rating--${ratingClass}">${tvRatingLabel(tv.rating)}${tv.rating != null ? ` (${tv.rating.toFixed(2)})` : ''}</strong>
        </div>
        <div class="tv-kv"><span>Kurs</span><strong>${tv.close != null ? tv.close.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</strong></div>
        <div class="tv-kv"><span>Market Cap</span><strong>${formatMarketCap(tv.market_cap)}</strong></div>
        <div class="tv-kv"><span>KGV (TTM)</span><strong>${tv.pe_ttm != null ? tv.pe_ttm.toFixed(1) : '—'}</strong></div>
        <div class="tv-kv"><span>Nächste Earnings</span><strong>${tv.earnings_next_date ? formatDate(new Date(tv.earnings_next_date * 1000).toISOString()) : '—'}</strong></div>
      </div>
      ${c.sector ? `<div class="tv-meta"><span class="tag">${c.sector}</span>${c.sub_sector ? `<span class="tag">${c.sub_sector}</span>` : ''}</div>` : ''}
      <small class="tv-fetched">Stand: ${formatDate(tv.fetched_at)}</small>
    </div>
  `;
}

function renderEnrichment(enrichment) {
  if (!enrichment) return '';
  const confidenceColor = { high: '#2ecc71', medium: '#f39c12', low: '#e74c3c' }[enrichment.confidence] ?? '#999';
  return `
    <div class="enrichment-result">
      <div class="enrichment-meta">
        <span class="badge" style="background:#6c3483;color:#fff">${enrichment.model}</span>
        <span class="badge confidence" style="color:${confidenceColor}">
          ${enrichment.confidence} confidence
        </span>
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
  constructor(container, { onAction }) {
    this.container = container;
    this.onAction = onAction;
    this.candidate = null;
    this.container.innerHTML = '';
    this.container.className = 'detail-drawer';
  }

  show(candidate) {
    this.candidate = candidate;
    this.render();
    this.container.classList.add('open');
  }

  hide() {
    this.container.classList.remove('open');
    this.candidate = null;
  }

  render() {
    if (!this.candidate) return;
    const c = this.candidate;
    const links = c.links ?? {};

    const stateMap = {
      new: 'Neu', reviewed: 'Gesehen', promoted: 'Promoted',
      dismissed: 'Abgelehnt', imported: 'Importiert',
    };

    this.container.innerHTML = `
      <div class="detail-header">
        <div class="detail-title">
          <h2>${c.symbol} <span class="exchange-label">${c.exchange}</span></h2>
          <p class="detail-name">${c.name}</p>
          ${c.isin ? `<small class="isin">ISIN: ${c.isin}</small>` : ''}
        </div>
        <button class="btn-icon detail-close" id="detail-close">✕</button>
      </div>

      <div class="detail-state">
        Status: <strong>${stateMap[c.workspace_state] ?? c.workspace_state}</strong>
        &nbsp;
        ${c.workspace_state !== 'promoted' && c.workspace_state !== 'imported'
          ? `<button class="btn btn-sm btn-success" id="detail-promote">✓ Promoten</button>`
          : ''}
        ${c.workspace_state !== 'dismissed'
          ? `<button class="btn btn-sm btn-danger" id="detail-dismiss">✗ Ablehnen</button>`
          : ''}
        ${c.workspace_state === 'new'
          ? `<button class="btn btn-sm" id="detail-review">👁 Als gesehen markieren</button>`
          : ''}
      </div>

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
        <h3>Notizen</h3>
        <textarea id="detail-notes" class="notes-editor" placeholder="Notizen…" rows="3">${c.notes ?? ''}</textarea>
        <button class="btn btn-sm btn-secondary" id="detail-save-notes">Speichern</button>
      </div>

      ${renderTVData(c)}

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

    this.container.querySelector('#detail-close').addEventListener('pointerup', () => this.hide());

    this.container.querySelector('#detail-promote')?.addEventListener('pointerup', () => {
      this.onAction?.('promote', c);
      c.workspace_state = 'promoted';
      this.render();
    });

    this.container.querySelector('#detail-dismiss')?.addEventListener('pointerup', () => {
      this.onAction?.('dismiss', c);
      c.workspace_state = 'dismissed';
      this.render();
    });

    this.container.querySelector('#detail-review')?.addEventListener('pointerup', () => {
      this.onAction?.('review', c);
      c.workspace_state = 'reviewed';
      this.render();
    });

    this.container.querySelector('#detail-save-links').addEventListener('pointerup', () => {
      const newLinks = {
        tradingview: this.container.querySelector('#lf-tv').value.trim(),
        stocktwits:  this.container.querySelector('#lf-st').value.trim(),
        yahoo:       this.container.querySelector('#lf-yahoo').value.trim(),
      };
      c.links = newLinks;
      this.onAction?.('saveLinks', c, { links: newLinks });
      this.render();
    });

    this.container.querySelector('#detail-save-notes').addEventListener('pointerup', () => {
      const notes = this.container.querySelector('#detail-notes').value;
      c.notes = notes;
      this.onAction?.('saveNotes', c, { notes });
    });

    this.container.querySelector('#detail-enrich').addEventListener('pointerup', async () => {
      const btn = this.container.querySelector('#detail-enrich');
      const statusEl = this.container.querySelector('#enrich-status');
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
