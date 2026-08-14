/**
 * TEMPORARY probe — inspects real StockTwits API responses.
 *
 * Session/local egress is blocked for api.stocktwits.com, and CLAUDE.md forbids
 * writing parsing logic against assumed field names. This runs on the GitHub
 * runner (which reaches StockTwits) and dumps responses verbatim so the parser
 * can be written against real data. Delete once the shape is confirmed.
 */

const UA = {
  'User-Agent': 'DiscoveryWorkspace/1.0 david.krehan@gmail.com',
  Accept: 'application/json',
};

const TARGETS = [
  ['stream',        'https://api.stocktwits.com/api/2/streams/symbol/AAPL.json?limit=3'],
  ['sentiment',     'https://api.stocktwits.com/api/2/symbols/AAPL/sentiment.json'],
  ['trending',      'https://api.stocktwits.com/api/2/trending/symbols.json'],
];

// Recursively collect key paths so nesting is visible even where values are long.
function keyPaths(node, prefix = '', out = new Set(), depth = 0) {
  if (depth > 6 || node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    if (node.length) keyPaths(node[0], `${prefix}[0]`, out, depth + 1);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.add(`${path} :: ${v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v}`);
    keyPaths(v, path, out, depth + 1);
  }
  return out;
}

for (const [label, url] of TARGETS) {
  console.log(`\n${'='.repeat(70)}\n### ${label} — ${url}\n${'='.repeat(70)}`);
  try {
    const res = await fetch(url, { headers: UA });
    console.log(`HTTP ${res.status} ${res.statusText}`);
    for (const [h, v] of res.headers.entries()) {
      if (/rate|limit|retry|remain/i.test(h)) console.log(`hdr ${h}: ${v}`);
    }

    const text = await res.text();
    console.log(`--- RAW (first 4000 chars) ---\n${text.slice(0, 4000)}`);

    try {
      const json = JSON.parse(text);
      console.log(`--- KEY PATHS ---`);
      for (const p of [...keyPaths(json)].sort()) console.log(p);

      // The field the whole feature depends on: per-message sentiment.
      if (Array.isArray(json.messages)) {
        console.log(`--- SENTIMENT VALUES across ${json.messages.length} messages ---`);
        for (const m of json.messages) {
          console.log(JSON.stringify({
            id: m.id,
            entities_sentiment: m.entities?.sentiment ?? null,
            top_level_sentiment: m.sentiment ?? null,
          }));
        }
      }
    } catch {
      console.log('(not valid JSON)');
    }
  } catch (err) {
    console.log(`FETCH FAILED: ${err.message}`);
  }
}
