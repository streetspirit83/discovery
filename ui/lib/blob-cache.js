/**
 * Lokaler Zwischenspeicher der Kandidaten-Blobs (IndexedDB) für einen schnellen Start:
 * die App zeichnet sofort den letzten Stand und holt den frischen im Hintergrund
 * (stale-while-revalidate, Steuerung in app.js → loadBlob/revalidateBlob).
 *
 * Nur ein Lesepuffer: geschrieben wird immer über das Backend, der Cache wird nach
 * jedem frischen Lesen ersetzt. Schlüssel = Backend-URL + Blob-Typ, damit ein
 * Wechsel des Backends keine fremden Daten zeigt. Fehler (privater Modus, voller
 * Speicher) sind still: dann lädt die App wie bisher direkt vom Server.
 */
const DB = 'discovery-cache', STORE = 'blobs', VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;    // älter → nicht zeigen, direkt frisch laden

let dbP = null;
function db() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbP ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbP;
}

const key = (base, type) => `${String(base ?? '').replace(/\/$/, '')}|${type}`;

export async function cacheGet(base, type) {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key(base, type));
      req.onsuccess = () => {
        const v = req.result;
        resolve(v?.blob && Date.now() - (v.at ?? 0) < MAX_AGE_MS ? v : null);
      };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function cachePut(base, type, blob, etag = null) {
  const d = await db();
  if (!d || !blob) return;
  try {
    d.transaction(STORE, 'readwrite').objectStore(STORE).put({ at: Date.now(), blob, etag }, key(base, type));
  } catch { /* Speicher voll o. ä. – egal, nächster Start lädt vom Server */ }
}

export async function cacheClear() {
  const d = await db();
  if (!d) return;
  try { d.transaction(STORE, 'readwrite').objectStore(STORE).clear(); } catch {}
}
