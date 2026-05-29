/**
 * Transform Discovery candidates → Merkliste "Schema A" import format.
 */

export function toMerklisteSchemaA(candidates) {
  return candidates.map((c) => {
    const e = c.enrichment || {};
    const links = c.links || {};

    // Collect source signal descriptions for Notizen
    const sourceLines = (c.sources || []).map((s) => s.info_snippet).filter(Boolean);
    const notes = [c.notes || '', ...sourceLines].filter(Boolean).join('\n');

    return {
      symbol: c.symbol,
      name: c.name,
      isin: c.isin || null,
      exchange: c.exchange,
      yahoo_symbol: c.yahoo_symbol,
      bucket: 'neutral',

      // Top-level URL fields – required for any Schema A importer to pick up links
      tradingview_url: links.tradingview || null,
      stocktwits_url: links.stocktwits || null,
      yahoo_url: links.yahoo || null,

      sector: e.sector || null,
      industry: e.industry || null,
      market_cap_bucket: e.market_cap_bucket || null,
      region: e.region || null,

      thesis_short: e.thesis_short || null,
      thesis_long: e.thesis_long || null,
      risks: e.risks || [],
      catalysts: e.catalysts || [],
      confidence: e.confidence || null,

      // Notizen = user notes + source signal descriptions (e.g. "CEO bought $2M")
      notes,

      // Keep nested links too for Discovery's own re-import
      links,

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
