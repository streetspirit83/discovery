/**
 * Robust import parser.
 * Accepts: Discovery blob JSON, Discovery candidate array, single candidate,
 * Merkliste "Schema A" array, generic objects, and CSV. Normalizes everything
 * into the Discovery candidate schema (see docs/discovery-workspace-spec.md 3.3).
 */

import { buildLinks } from './link-builder.js';

const nowIso = () => new Date().toISOString();
const uuid = () =>
  (crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      }));

/** Case-insensitive field lookup across a set of aliases. */
function getField(obj, aliases) {
  if (!obj || typeof obj !== 'object') return undefined;
  const lowerMap = {};
  for (const k of Object.keys(obj)) lowerMap[k.toLowerCase()] = obj[k];
  for (const a of aliases) {
    const v = lowerMap[a.toLowerCase()];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

const up = (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v);

/**
 * Turn a loose object (candidate / Schema A / CSV row / search result) into a
 * full Discovery candidate. Returns null if no symbol can be found.
 */
export function normalizeCandidate(obj) {
  if (!obj || typeof obj !== 'object') return null;

  const symbol = up(getField(obj, ['symbol', 'ticker', 'sym']));
  if (!symbol) return null;

  const exchange = up(getField(obj, ['exchange', 'exch', 'mic', 'market'])) || 'UNKNOWN';
  const yahoo_symbol = getField(obj, ['yahoo_symbol', 'yahoo', 'yahoo symbol']) || symbol;
  const isin = getField(obj, ['isin']) || null;
  const name = getField(obj, ['name', 'company', 'company name', 'firma', 'bezeichnung']) || symbol;
  const notes = getField(obj, ['notes', 'note', 'notiz', 'notizen', 'kommentar']) || '';

  let sources = Array.isArray(obj.sources) ? obj.sources : null;
  if (!sources || sources.length === 0) {
    const info = getField(obj, ['info_snippet', 'info', 'snippet', 'beschreibung', 'signal info']);
    const signal_type = getField(obj, ['signal_type', 'signal', 'signaltyp']) || 'manual';
    const source_url = getField(obj, ['source_url', 'url', 'link', 'quelle']) || '';
    const adapter = getField(obj, ['adapter', 'source', 'quelle_name']) || 'manual';
    sources = [
      {
        adapter,
        source_url,
        discovered_at: nowIso(),
        signal_type,
        raw_signal: {},
        info_snippet: info || `Manuell hinzugefügt: ${symbol}`,
      },
    ];
  }

  // Links: prefer obj.links struct, then top-level *_url fields, then auto-build
  const tvUrl = getField(obj, ['tradingview_url', 'tradingview']);
  const stUrl = getField(obj, ['stocktwits_url', 'stocktwits']);
  const yhUrl = getField(obj, ['yahoo_url', 'yahoo']);
  let links;
  if (obj.links && obj.links.tradingview) {
    // Merge: nested links object wins, but top-level *_url fields can override nulls
    links = {
      tradingview: obj.links.tradingview || tvUrl || null,
      stocktwits:  obj.links.stocktwits  || stUrl || null,
      yahoo:       obj.links.yahoo       || yhUrl || null,
    };
  } else if (tvUrl || stUrl) {
    const built = buildLinks({ symbol, exchange, yahooSymbol: yahoo_symbol });
    links = {
      tradingview: tvUrl || built.tradingview,
      stocktwits:  stUrl || built.stocktwits,
      yahoo:       yhUrl || built.yahoo,
    };
  } else {
    links = buildLinks({ symbol, exchange, yahooSymbol: yahoo_symbol });
  }

  // Enrichment: use existing, or map Schema A enrichment fields if present
  let enrichment = obj.enrichment || null;
  if (!enrichment) {
    const sector      = getField(obj, ['sector']);
    const industry    = getField(obj, ['sub_sector', 'industry', 'industrie']);
    const mktCap      = getField(obj, ['market_cap_size', 'market_cap_bucket']);
    const region      = getField(obj, ['region']);
    const thesisShort = getField(obj, ['trend_reason', 'thesis_short']);
    const thesisLong  = getField(obj, ['core_business', 'thesis_long']);
    const confidence  = getField(obj, ['confidence']) || null;
    const sentiment   = getField(obj, ['sentiment']) || null;
    const whyNot      = getField(obj, ['why_not']);
    const risks = Array.isArray(obj.risks)
      ? obj.risks
      : (whyNot ? [whyNot] : null);
    const catalysts = Array.isArray(obj.next_catalysts)
      ? obj.next_catalysts
      : (typeof obj.next_catalysts === 'string' ? [obj.next_catalysts] : null);
    const recentNews = Array.isArray(obj.recent_news) ? obj.recent_news : null;

    if (sector || thesisShort || thesisLong || catalysts || risks) {
      enrichment = {
        enriched_at:      nowIso(),
        model:            'import',
        sector:           sector || null,
        industry:         industry || null,
        market_cap_bucket: mktCap || null,
        region:           region || null,
        thesis_short:     thesisShort || null,
        thesis_long:      thesisLong || null,
        risks,
        catalysts,
        confidence,
        sentiment,
        recent_news:      recentNews,
      };
    }
  }

  return {
    id: obj.id || uuid(),
    symbol,
    exchange,
    yahoo_symbol,
    isin,
    name,
    sources,
    links,
    workspace_state: obj.workspace_state || 'new',
    notes,
    enrichment,
    first_discovered_at: obj.first_discovered_at || nowIso(),
    last_updated_at: nowIso(),
  };
}

/** Minimal RFC-4180-ish CSV parser (handles quotes and embedded commas). */
function parseCSV(text) {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '');
  if (!lines.length) return [];

  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQ = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === ',' || ch === ';' || ch === '\t') {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };

  const headers = parseLine(lines[0]).map((h) => h.toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

function fromJson(data) {
  if (!data || Array.isArray(data)) {
    // plain array
    const arr = Array.isArray(data) ? data : [];
    return fromArray(arr, arr[0] && (arr[0].sources || arr[0].workspace_state) ? 'discovery-candidates' : 'objects');
  }

  // Full Discovery blob { candidates: [...] }
  if (Array.isArray(data.candidates)) {
    const candidates = data.candidates.map(normalizeCandidate).filter(Boolean);
    return { candidates, format: 'discovery-blob', errors: candidates.length ? [] : ['Keine gültigen Kandidaten im Blob'] };
  }

  // Schema A wrapper { results: [...] }
  if (Array.isArray(data.results)) {
    return fromArray(data.results, 'schema-a');
  }

  // Single object
  return fromArray([data], 'objects');
}

function fromArray(arr, defaultFormat) {
  const candidates = arr.map(normalizeCandidate).filter(Boolean);
  const first = arr[0] || {};
  const format = first.sources || first.workspace_state
    ? 'discovery-candidates'
    : first.sector || first.trend_reason || first.core_business
      ? 'schema-a'
      : defaultFormat;
  return {
    candidates,
    format,
    errors: candidates.length ? [] : ['Keine Objekte mit Feld "symbol"/"ticker" gefunden'],
  };
}

/**
 * Parse arbitrary text into candidates.
 * @returns {{ candidates: object[], format: string, errors: string[] }}
 */
export function parseImport(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return { candidates: [], format: 'empty', errors: ['Kein Inhalt'] };

  if (trimmed[0] === '{' || trimmed[0] === '[') {
    let data;
    try {
      data = JSON.parse(trimmed);
    } catch (e) {
      return { candidates: [], format: 'json', errors: [`Ungültiges JSON: ${e.message}`] };
    }
    return fromJson(data);
  }

  try {
    const rows = parseCSV(trimmed);
    if (!rows.length) return { candidates: [], format: 'csv', errors: ['Keine CSV-Datenzeilen erkannt'] };
    const candidates = rows.map(normalizeCandidate).filter(Boolean);
    return {
      candidates,
      format: 'csv',
      errors: candidates.length ? [] : ['CSV braucht eine Spalte "symbol" oder "ticker"'],
    };
  } catch (e) {
    return { candidates: [], format: 'unknown', errors: [`Konnte Inhalt nicht parsen: ${e.message}`] };
  }
}
