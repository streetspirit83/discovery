/**
 * Alternativen aus dem Claude-Chat in die Inbox holen.
 *
 * Der Chat hat keinen Backend-Zugang, deshalb übergibt er die Titel per Link
 * (`#add=AMD:NASDAQ,AVGO:NASDAQ&peer=NVDA:NASDAQ`). Geschrieben wird erst, wenn
 * du im Prüffenster bestätigst. Die Auswahl der Titel bleibt bewusst bei der KI;
 * die Kennzahlen stehen nur zur Orientierung daneben und filtern nichts.
 */

import { normalizeCandidate } from './import-parser.js';
import { normalizeExchange } from './exchange-map.js';
import { fetchTVEnrichment, TV_PREFIX_MAP } from './tv-enrichment.js?v=20261103b';
import { searchSymbols, searchResultToParts } from './symbol-search.js?v=20260807a';
import { yahooChartSymbol } from './tv-swings.js?v=20260818a';

const MAX_ITEMS = 6;
const TICKER = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;

function parseTicker(raw) {
  const [symbol, exchange = ''] = decodeURIComponent(String(raw)).trim().toUpperCase().split(':');
  if (!TICKER.test(symbol ?? '')) return null;
  return { symbol, exchange: normalizeExchange(exchange) || '' };
}

/** @returns {{items: {symbol,exchange}[], peer: {symbol,exchange}|null}|null} */
export function parsePeerHash(hash) {
  const add = /^#add=([^&]*)/.exec(hash || '');
  if (!add) return null;
  const peerRaw = /[#&]peer=([^&]+)/.exec(hash);
  const peer = peerRaw ? parseTicker(peerRaw[1]) : null;
  const seen = new Set();
  const items = add[1].split(',').map(parseTicker).filter((t) => {
    if (!t || seen.has(t.symbol)) return false;
    seen.add(t.symbol);
    return true;
  }).slice(0, MAX_ITEMS);
  return items.length ? { items, peer } : null;
}

export const candidateKey = (c) => `${String(c.symbol).toUpperCase()}:${normalizeExchange(c.exchange)}`;

function draft({ symbol, exchange }, peer) {
  return normalizeCandidate({
    symbol,
    exchange,
    yahoo_symbol: yahooChartSymbol({ symbol, exchange }) ?? symbol,
    sources: [{
      adapter: 'claude-peer',
      source_url: '',
      discovered_at: new Date().toISOString(),
      signal_type: 'manual',
      raw_signal: peer ? { peer: peer.symbol } : {},
      info_snippet: peer ? `Claude-Alternative zu ${peer.symbol}` : 'Claude-Alternative',
    }],
  });
}

async function enrich(cands, backend) {
  const known = cands.filter((c) => TV_PREFIX_MAP[normalizeExchange(c.exchange)]);
  if (!known.length) return new Map();
  // fetchTVEnrichment wirft, wenn gar nichts gefunden wurde.
  return fetchTVEnrichment(known, backend).catch(() => new Map());
}

/* Die KI vertut sich am ehesten bei der Börse. Die Suche holt das Listing mit
   gleichem Symbol; deutsche Zweitlistings sind für TV meist leer und stehen hinten. */
async function relist(symbol) {
  const hits = await searchSymbols(symbol).catch(() => []);
  const parts = hits
    .filter((h) => h.symbol?.toUpperCase() === symbol)
    .map(searchResultToParts)
    .filter((p) => TV_PREFIX_MAP[normalizeExchange(p.exchange)]);
  return parts.find((p) => p.exchange !== 'XETR') ?? parts[0] ?? null;
}

/**
 * @returns {Promise<{symbol,exchange,candidate:object|null}[]>} gleiche Reihenfolge
 *   wie `tickers`; `candidate` ist null, wenn der Titel nicht auffindbar ist.
 */
export async function resolveTickers(tickers, peer, backend) {
  const rows = tickers.map((t) => ({ ...t, candidate: draft(t, peer) }));
  const first = await enrich(rows.map((r) => r.candidate), backend);
  const open = [];
  for (const r of rows) {
    const u = first.get(r.candidate.id);
    if (u) Object.assign(r.candidate, u);
    else open.push(r);
  }

  for (const r of open) {
    const hit = await relist(r.symbol);
    r.candidate = hit ? draft({ symbol: hit.symbol, exchange: hit.exchange }, peer) : null;
    if (hit) { r.exchange = normalizeExchange(hit.exchange); }
  }
  const retry = open.filter((r) => r.candidate);
  const second = await enrich(retry.map((r) => r.candidate), backend);
  for (const r of retry) {
    const u = second.get(r.candidate.id);
    if (u) Object.assign(r.candidate, u);
    else r.candidate = null;
  }
  return rows;
}
