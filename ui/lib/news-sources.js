/**
 * Eigene News-Quellen (RSS-Feeds + Google Alerts) – localStorage-Modell.
 *
 * Google Alerts liefern selbst RSS-Feeds (Alert bearbeiten → „An RSS-Feed
 * senden"); gespeichert wird jeweils die Feed-URL. Die Quellen speisen den
 * Portfolio-Sub-Tab im News-Tab des Markets-Modals.
 */

const LS_KEY = 'discovery_news_sources';

export function loadNewsSources() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function save(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* quota */ }
}

/** @returns die neue Quelle; wirft bei fehlender/doppelter URL */
export function addNewsSource({ type, label, url }) {
  const src = {
    id: `src_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    type: type === 'galert' ? 'galert' : 'rss',
    label: String(label ?? '').trim(),
    url: String(url ?? '').trim(),
    created_at: new Date().toISOString(),
  };
  if (!src.url) throw new Error('Feed-URL fehlt');
  if (!/^https?:\/\//i.test(src.url)) throw new Error('URL muss mit http(s):// beginnen');
  const list = loadNewsSources();
  if (list.some((s) => s.url === src.url)) throw new Error('Quelle existiert bereits');
  if (!src.label) src.label = src.type === 'galert' ? 'Google Alert' : new URL(src.url).hostname.replace(/^www\./, '');
  list.push(src);
  save(list);
  return src;
}

export function removeNewsSource(id) {
  save(loadNewsSources().filter((s) => s.id !== id));
}
