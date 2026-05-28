/**
 * Scrape client for adapter use.
 *
 * When DISCOVERY_BACKEND_URL + DISCOVERY_SECRET are set (GitHub Actions),
 * fetches are routed through the Netlify scrape-proxy so the request
 * originates from Netlify's IPs rather than the GitHub runner IP range,
 * which many sites block.
 *
 * Falls back to direct fetch when no backend is configured (local testing).
 */

const log = (level, msg, data = {}) =>
  process.stdout.write(
    JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n',
  );

/**
 * Fetch a URL, routing through the Netlify scrape-proxy if backend env vars are set.
 * Returns a Response-like object with { ok, status, text() }.
 *
 * @param {string} url
 * @param {{ headers?: Record<string,string> }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, text: () => Promise<string> }>}
 */
export async function proxiedFetch(url, opts = {}) {
  const backendUrl = process.env.DISCOVERY_BACKEND_URL;
  const secret = process.env.DISCOVERY_SECRET;

  if (backendUrl && secret) {
    log('debug', 'scrape-client: routing via proxy', { url });
    const proxyUrl = `${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`;
    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-discovery-secret': secret,
      },
      body: JSON.stringify({ url, method: 'GET', headers: opts.headers ?? {} }),
    });

    const data = await res.json();

    if (!data.ok) {
      throw new Error(`scrape-proxy error: ${data.error ?? res.status}`);
    }

    const body = data.body;
    return {
      ok: data.status >= 200 && data.status < 300,
      status: data.status,
      text: async () => body,
    };
  }

  log('debug', 'scrape-client: direct fetch', { url });
  return fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DiscoveryWorkspace/1.0)',
      Accept: 'text/html,application/xhtml+xml',
      ...opts.headers,
    },
  });
}
