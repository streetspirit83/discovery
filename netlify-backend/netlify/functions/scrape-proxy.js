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

  const { url, method = 'GET', headers: reqHeaders = {} } = body;

  if (!url) return respond(400, { ok: false, error: 'Missing url' });

  if (!isAllowed(url)) {
    log('warn', 'scrape-proxy: blocked URL', { url });
    return respond(403, { ok: false, error: `URL not in allowlist: ${url}` });
  }

  log('info', 'scrape-proxy: fetching', { url, method });

  try {
    const upstream = await fetch(url, {
      method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DiscoveryBot/1.0)',
        ...reqHeaders,
      },
    });

    const contentType = upstream.headers.get('content-type') ?? 'text/plain';
    const responseBody = await upstream.text();

    log('info', 'scrape-proxy: done', { url, status: upstream.status, size: responseBody.length });

    return respond(200, {
      ok: true,
      status: upstream.status,
      content_type: contentType,
      body: responseBody,
    });
  } catch (err) {
    log('error', 'scrape-proxy: fetch failed', { url, error: err.message });
    return respond(502, { ok: false, error: `Upstream fetch failed: ${err.message}` });
  }
}
