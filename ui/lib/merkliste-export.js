/**
 * Transform Discovery candidates → Merkliste "Schema A" import format.
 *
 * NOTE: The exact Merkliste Schema A field names should be confirmed against the
 * Merkliste import dialog (separate repo). This mapping is a sensible, easy-to-
 * adjust default: it flattens enrichment, sets bucket "neutral", and keeps a
 * backlink (discovery_id) plus a compact source trail.
 */

export function toMerklisteSchemaA(candidates) {
  return candidates.map((c) => {
    const e = c.enrichment || {};
    return {
      symbol: c.symbol,
      name: c.name,
      isin: c.isin || null,
      exchange: c.exchange,
      yahoo_symbol: c.yahoo_symbol,
      bucket: 'neutral',

      sector: e.sector || null,
      industry: e.industry || null,
      market_cap_bucket: e.market_cap_bucket || null,
      region: e.region || null,

      thesis_short: e.thesis_short || null,
      thesis_long: e.thesis_long || null,
      risks: e.risks || [],
      catalysts: e.catalysts || [],
      confidence: e.confidence || null,

      notes: c.notes || '',
      links: c.links || {},

      discovery_id: c.id,
      sources: (c.sources || []).map((s) => ({
        adapter: s.adapter,
        signal_type: s.signal_type,
        info_snippet: s.info_snippet,
        discovered_at: s.discovered_at,
      })),

      imported_from: 'discovery-workspace',
      exported_at: new Date().toISOString(),
    };
  });
}
