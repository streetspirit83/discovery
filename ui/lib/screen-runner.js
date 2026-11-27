/**
 * Screen-Runner – ein gespeichertes Screener-Preset in eine Scanner-Abfrage übersetzen,
 * ausführen und nachfiltern. Gemeinsam für das Screener Studio (Browser) und den
 * Auto-Lauf des Adapters `tradingview-screener` (GitHub Action), damit beide exakt
 * dieselben Treffer liefern.
 *
 * Preset: { id, label, market, sector|null, mega:[key]|null, filter:[{left,operation,right}],
 *           sort:{sortBy,sortOrder}, count, auto, auto_override }
 *
 * - `right` als Zahl, Zahlenpaar (in_range) oder **Feldname** (Feld gegen Feld, z. B.
 *   close > SMA50 – der Scanner kann das nativ, gemessen 23.11.2026).
 * - Synthetische %-Felder (tv-fields SYNTHETIC_FIELDS) gehen nie an den Scanner, sondern
 *   werden nach dem Abruf je Zeile gerechnet und gefiltert.
 * - `mega`: Mega-Cluster-Keys → Sektor-Filter `in_range [Sektoren]`.
 * - Marktgruppen (`europe`) laufen über den Endpoint `global` (siehe tv-screener.js).
 */

import {
  FIELD_BY_VALUE, OPERATORS, MARKET_BY_SLUG, SECTORS, isSynthetic, syntheticDeps, computeSynthetic, matchesOp,
} from './tv-fields.js?v=20261123a';
import { runScreen } from './tv-screener.js?v=20261123a';
import { megaClusterOf } from './sector-clusters.js?v=20260807a';

const sectorsOfMega = (key) => SECTORS.filter((s) => megaClusterOf(s) === key);

const opArity = (op) => OPERATORS.find((o) => o.value === op)?.arity ?? 1;

/** Ist `v` ein natives Scanner-Feld (für Feld-gegen-Feld-Vergleiche)? */
export function isFieldRef(v) {
  return typeof v === 'string' && FIELD_BY_VALUE.has(v) && !isSynthetic(v);
}

/** Effektiver Auto-Status eines Presets (Schalter im Studio überschreibt die Vorgabe). */
export function isAutoPreset(p) {
  return !!(p?.auto_override ?? p?.auto);
}

/**
 * Preset → Scanner-Abfrage.
 * @returns {{ market, filter, columns, sort, count, syntheticFilters, clientSort, displayCount }}
 */
export function buildScreenRequest(preset) {
  const filter = [];
  const syntheticFilters = [];
  const cols = ['description', 'close', 'sector', 'market_cap_basic'];
  const addCol = (c) => { if (c && !cols.includes(c)) cols.push(c); };

  for (const f of preset.filter ?? []) {
    const { left, operation } = f;
    let right = f.right;
    if (!left || right == null || right === '') continue;
    const arity = opArity(operation);
    if (isSynthetic(left)) {
      const [v1, v2] = Array.isArray(right) ? right : [right, null];
      if (arity === 2 && (v2 == null || v2 === '')) continue;
      syntheticDeps(left).forEach(addCol);
      syntheticFilters.push({ field: left, op: operation, v1, v2 });
      continue;
    }
    if (isFieldRef(right)) {
      filter.push({ left, operation, right });
      addCol(left); addCol(right);
      continue;
    }
    if (typeof right === 'boolean' || (typeof right === 'string' && !Number.isFinite(Number(right)))) {
      filter.push({ left, operation, right }); // Text-/Bool-Felder (z. B. sector, is_primary)
      continue;
    }
    if (arity === 2) {
      const pair = (Array.isArray(right) ? right : [right]).map(Number);
      if (pair.length < 2 || pair.some(Number.isNaN)) continue;
      right = pair;
    } else {
      right = Number(Array.isArray(right) ? right[0] : right);
      if (Number.isNaN(right)) continue;
    }
    filter.push({ left, operation, right });
    addCol(left);
  }

  // Nur Heimatbörsen: ohne diesen Filter liefert z. B. `germany` jede an deutschen Plätzen
  // gehandelte US-Aktie (LSX/GETTEX-Kennungen) und `america` die OTC-Werte. Marktgruppen
  // filtern stattdessen über `is_primary` (tv-screener.js) – im Länder-Endpoint ist das Feld
  // für XETR-Titel false (gemessen 23.11.2026), dort taugt es nicht.
  const marketDef = MARKET_BY_SLUG.get(preset.market ?? 'america');
  if (marketDef && !filter.some((f) => f.left === 'exchange')) {
    filter.push({ left: 'exchange', operation: 'in_range', right: marketDef.exchanges });
  }

  for (const c of preset.extra_columns ?? []) addCol(c);   // nur Anzeige/Weiterverarbeitung, kein Filter

  const megaSectors = (preset.mega ?? []).flatMap((k) => sectorsOfMega(k));
  if (megaSectors.length) filter.push({ left: 'sector', operation: 'in_range', right: megaSectors });
  else if (preset.sector) filter.push({ left: 'sector', operation: 'equal', right: preset.sector });

  const sortBy = preset.sort?.sortBy ?? 'volume';
  const sortOrder = preset.sort?.sortOrder ?? 'desc';
  let clientSort = null;
  let sort;
  if (isSynthetic(sortBy)) {
    syntheticDeps(sortBy).forEach(addCol);
    clientSort = { field: sortBy, order: sortOrder };
    sort = { sortBy: 'volume', sortOrder: 'desc' };
  } else {
    addCol(sortBy);
    sort = { sortBy, sortOrder };
  }

  const displayCount = Math.max(1, Math.min(200, Number(preset.count) || 50));
  // Nachfilter wirken erst nach der Scanner-Grenze → mehr holen, danach kürzen.
  const fetchCount = (syntheticFilters.length || clientSort) ? 200 : displayCount;
  return { market: preset.market ?? 'america', filter, columns: cols, sort, count: fetchCount, syntheticFilters, clientSort, displayCount };
}

/** Synthetische Filter und Sortierung auf die Scanner-Zeilen anwenden, dann kürzen. */
export function postProcessRows(rows, req) {
  const idx = {};
  req.columns.forEach((c, i) => { idx[c] = i; });
  const getter = (d) => (col) => { const i = idx[col]; return i == null ? null : (d[i] ?? null); };
  let out = rows;
  if (req.syntheticFilters.length) {
    out = out.filter((row) => {
      const g = getter(row.d ?? []);
      return req.syntheticFilters.every((f) => matchesOp(computeSynthetic(f.field, g), f.op, f.v1, f.v2));
    });
  }
  if (req.clientSort) {
    const { field, order } = req.clientSort;
    const dir = order === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => {
      const va = computeSynthetic(field, getter(a.d ?? []));
      const vb = computeSynthetic(field, getter(b.d ?? []));
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * dir;
    });
  }
  return out.slice(0, req.displayCount);
}

/**
 * Preset ausführen.
 * @returns {Promise<{ req, rows, totalCount, fetched }>}
 */
export async function runPreset(preset, auth) {
  const req = buildScreenRequest(preset);
  const { totalCount, rows } = await runScreen(req, auth);
  return { req, rows: postProcessRows(rows, req), totalCount, fetched: rows.length };
}
