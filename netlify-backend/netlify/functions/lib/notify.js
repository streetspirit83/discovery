/**
 * notify.js — ntfy.sh push sender (JSON body → UTF-8 safe for emoji).
 * Mirror of the merkliste notify helper.
 */

export async function sendNtfy(topic, { title, message, pushColor = null }) {
  const priority = pushColor === 'red' ? 4 : 3;
  const body = { topic, title, message, priority };
  const res = await fetch('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.warn(`[ntfy] HTTP ${res.status} for "${title}"`);
  return res.ok;
}
