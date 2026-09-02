/**
 * notify.js — ntfy.sh push sender (JSON body → UTF-8 safe for emoji).
 * Extends the merkliste helper with click-URL and action buttons.
 *
 * priority: explicit value wins; legacy pushColor 'red' → 4, else 3.
 * click:    URL opened when the notification itself is tapped.
 * actions:  up to 3 ntfy action buttons, e.g. { action:'view', label, url }.
 */

export async function sendNtfy(topic, { title, message, pushColor = null, priority = null, click = null, actions = null }) {
  const body = {
    topic,
    title,
    message,
    priority: priority ?? (pushColor === 'red' ? 4 : 3),
  };
  if (click) body.click = click;
  if (Array.isArray(actions) && actions.length) body.actions = actions.slice(0, 3);
  const res = await fetch('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.warn(`[ntfy] HTTP ${res.status} for "${title}"`);
  return res.ok;
}
