/**
 * Netlify Function: scrape-proxy
 * POST /api/scrape – CORS proxy for browser-side adapter testing
 *
 * NOT used by production adapter runs (GitHub Actions fetch directly).
 * Only for development/testing from the browser UI.
 */

function log(level, msg, data = {}) {
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );
}

/* Manche Anbieter verlangen den Key als Query-Parameter (FMP + TwelveData +
   ROIC: `apikey`, Marketaux: `api_token`). Ohne diese Maskierung stünde er im
   Klartext in den Function-Logs — bei jedem Abruf zweimal. Die Logs sind zwar
   privat, aber Logs werden geteilt.

   Bewusst nach Namensbestandteil statt nach einer Liste exakter Namen: eine
   Liste war der erste Versuch und übersah prompt Marketaux' `api_token`. Zu
   viel zu maskieren kostet in einem Log nichts, zu wenig kostet einen Key. */
const SECRET_PARAMS = /key|token|secret|pass|auth|credential/i;
function redactUrl(raw) {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) {
      if (SECRET_PARAMS.test(k)) u.searchParams.set(k, '***');
    }
    return u.toString();
  } catch {
    // Fallback für Strings, die keine gültige URL sind.
    return String(raw).replace(/([?&][^=&]*(?:key|token|secret|pass|auth|credential)[^=&]*=)[^&]*/gi, '$1***');
  }
}

// Allowed domains (regex). Add more as needed.
const ALLOWED_DOMAINS = [
  /^https:\/\/openinsider\.com\//,
  /^https:\/\/api\.boerse-frankfurt\.de\//,
  /^https:\/\/www\.boerse-frankfurt\.de\//,
  /^https:\/\/www\.ishares\.com\//,
  /^https:\/\/api\.openfigi\.com\//,
  /^https:\/\/financialmodelingprep\.com\//,
  /^https:\/\/api\.twelvedata\.com\//,
  /^https:\/\/finance\.yahoo\.com\//,
  /^https:\/\/query1\.finance\.yahoo\.com\//,
  /^https:\/\/query2\.finance\.yahoo\.com\//,
  /^https:\/\/scanner\.tradingview\.com\//,
  // Indices-Tab: löst Index-Kürzel → Scanner-Ticker auf (lib/tv-indices.js).
  /^https:\/\/symbol-search\.tradingview\.com\//,
  /^https:\/\/api\.roic\.ai\//,
  /^https:\/\/www\.ls-tc\.de\//,
  /^https:\/\/merkliste-app\.netlify\.app\//,
  // News-Tab (Markets-Modal): Marketaux + TradingView Data API (RapidAPI)
  // + Google-Alert-Feeds (Atom). Pfad-Anker bei Google hält die Freigabe eng.
  /^https:\/\/api\.marketaux\.com\//,
  /^https:\/\/tradingview-data1\.p\.rapidapi\.com\//,
  /^https:\/\/www\.google\.com\/alerts\/feeds\//,
  // Retail-Sentiment im Detail-Sheet (lib/stocktwits-sentiment.js) — öffentlicher
  // Aggregat-Endpoint, kein Key. Pfad-Anker hält die Freigabe auf die API eng.
  /^https:\/\/api\.stocktwits\.com\/api\/2\//,
];

function isAllowed(url) {
  return ALLOWED_DOMAINS.some((re) => re.test(url));
}

function respond(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-discovery-secret',
    },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-discovery-secret',
      },
    });
  }

  if (req.method !== 'POST') {
    return respond(405, { ok: false, error: 'Method not allowed' });
  }

  const secret = req.headers.get('x-discovery-secret');
  if (!secret || secret !== process.env.DISCOVERY_SECRET) {
    return respond(401, { ok: false, error: 'Unauthorized' });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return respond(400, { ok: false, error: 'Invalid JSON body' });
  }

  const { url, method = 'GET', headers: reqHeaders = {}, body: upstreamBody } = body;

  if (!url) return respond(400, { ok: false, error: 'Missing url' });

  if (!isAllowed(url)) {
    log('warn', 'scrape-proxy: blocked URL', { url: redactUrl(url) });
    return respond(403, { ok: false, error: `URL not in allowlist: ${redactUrl(url)}` });
  }

  log('info', 'scrape-proxy: fetching', { url: redactUrl(url), method });

  try {
    const upstream = await fetch(url, {
      method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DiscoveryBot/1.0)',
        ...reqHeaders,
      },
      body: upstreamBody !== undefined
        ? (typeof upstreamBody === 'string' ? upstreamBody : JSON.stringify(upstreamBody))
        : undefined,
    });

    const contentType = upstream.headers.get('content-type') ?? 'text/plain';
    const responseBody = await upstream.text();

    log('info', 'scrape-proxy: done', { url: redactUrl(url), status: upstream.status, size: responseBody.length });

    return respond(200, {
      ok: true,
      status: upstream.status,
      content_type: contentType,
      body: responseBody,
    });
  } catch (err) {
    log('error', 'scrape-proxy: fetch failed', { url: redactUrl(url), error: err.message });
    return respond(502, { ok: false, error: `Upstream fetch failed: ${err.message}` });
  }
}
