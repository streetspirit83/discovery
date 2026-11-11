/**
 * sw.js — Service Worker der Discovery-PWA (installierbar, offline lesbar).
 *
 * Nur GET auf die eigene Herkunft (App-Hülle) und die Google-Schriften. Alles
 * andere (Netlify-Backend, scrape-proxy, TradingView …) geht unberührt ans Netz;
 * die Daten selbst hält `lib/blob-cache.js` in IndexedDB.
 *
 *  - Seitenaufruf (index.html): Netz zuerst, nach 4 s bzw. offline der Cache.
 *    index.html trägt die `?v=`-Marken, ein neuer Deploy kommt so sofort an.
 *  - Dateien (JS/CSS/Icons/Schriften): Cache sofort, im Hintergrund auffrischen.
 *    Eine neue `?v=`-Marke ist eine neue URL und kommt direkt aus dem Netz;
 *    ältere Fassungen derselben Datei werden dabei entfernt.
 */
const CACHE = 'discovery-shell-v1';
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('discovery-shell-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

/** Antwort ablegen und ältere `?v=`-Fassungen desselben Pfads entfernen. */
async function store(request, response) {
  if (!response || !(response.ok || response.type === 'opaque')) return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
  const url = new URL(request.url);
  if (!url.search) return;
  for (const old of await cache.keys()) {
    const o = new URL(old.url);
    if (o.origin === url.origin && o.pathname === url.pathname && o.search !== url.search) await cache.delete(old);
  }
}

async function navigate(event) {
  const cache = await caches.open(CACHE);
  const shell = new URL('./', self.registration.scope).href;
  const fromNet = fetch(event.request).then((res) => {
    if (res.ok) event.waitUntil(cache.put(shell, res.clone()));
    return res;
  });
  const cached = await cache.match(shell);
  if (!cached) return fromNet;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
  const res = await Promise.race([fromNet.catch(() => null), timeout]);
  return res && res.ok ? res : cached;
}

async function asset(event) {
  const cached = await caches.match(event.request);
  const fromNet = fetch(event.request).then((res) => {
    event.waitUntil(store(event.request, res.clone()).catch(() => {}));
    return res;
  });
  if (cached) {
    event.waitUntil(fromNet.catch(() => {}));
    return cached;
  }
  return fromNet;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const own = url.origin === self.location.origin && url.href.startsWith(self.registration.scope);
  if (!own && !FONT_HOSTS.has(url.hostname)) return;
  if (own && url.pathname.endsWith('/sw.js')) return;
  event.respondWith(request.mode === 'navigate' && own ? navigate(event) : asset(event));
});
