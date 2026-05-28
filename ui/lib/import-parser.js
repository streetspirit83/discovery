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

  const exchange = up(getField(obj, ['exchange', 'exch', 'mic', 'market'])) || '';
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

  const links =
    obj.links && obj.links.tradingview
      ? obj.links
      : buildLinks({ symbol, exchange, yahooSymbol: yahoo_symbol });

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
    enrichment: obj.enrichment || null,
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
  // Full Discovery blob
  if (data && !Array.isArray(data) && Array.isArray(data.candidates)) {
    const candidates = data.candidates.map(normalizeCandidate).filter(Boolean);
    return { candidates, format: 'discovery-blob', errors: candidates.length ? [] : ['Keine gültigen Kandidaten im Blob'] };
  }

  const arr = Array.isArray(data) ? data : [data];
  const candidates = arr.map(normalizeCandidate).filter(Boolean);
  const first = arr[0] || {};
  const format =
    first.sources || first.workspace_state
      ? 'discovery-candidates'
      : first.bucket
        ? 'schema-a'
        : 'objects';
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
