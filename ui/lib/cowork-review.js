/**
 * Cowork-Triage – gemeinsame Helfer für Tabelle, Detail-Sheet und Briefing.
 *
 * Der geplante Cowork-Task legt sein Urteil als `cowork_review` am Kandidaten
 * ab und das Tages-Briefing im `review`-Blob (Ringpuffer, 30 Tage). Beschreibung
 * der Felder: tools/cowork-review/README.md.
 *
 * Bewusst eine eigene Datei: Signalfarbe, Cluster- und Ereignis-Labels werden
 * an drei Stellen gebraucht, und drei Kopien laufen garantiert auseinander.
 */

export const REVIEW_BLOB_TYPE = 'review';

/** signal → CSS-Modifier. Neutral bleibt ohne Farbe (Styleguide §8). */
export const SIGNAL_CLASS = { positive: 'pos', negative: 'neg', neutral: 'neutral' };

export const CLUSTER_LABELS = {
  biotech: 'Biotech',
  semis:   'Halbleiter',
  tech:    'Tech',
  other:   'Übrige',
};

export const EVENT_LABELS = {
  earnings:   'Zahlen',
  guidance:   'Ausblick',
  mna:        'M&A',
  regulatory: 'Regulierung',
  product:    'Produkt',
  analyst:    'Analysten',
  legal:      'Recht',
  macro:      'Makro',
  none:       'Ohne Einordnung',
};

export const STATE_LABELS = {
  risk_on:  'risk-on',
  neutral:  'neutral',
  risk_off: 'risk-off',
};

/** state → CSS-Modifier für den Makro-Streifen. */
export const STATE_CLASS = { risk_on: 'pos', risk_off: 'neg', neutral: 'neutral' };

const MATERIALITY_TITLES = {
  0: 'nichts Neues',
  1: 'Meldung ohne erkennbare Relevanz',
  2: 'relevant',
  3: 'kursrelevant',
};

export function materialityLabel(m) {
  return MATERIALITY_TITLES[m] ?? 'unbekannt';
}

/**
 * Das Review eines Kandidaten, aber nur wenn es etwas zu zeigen gibt.
 * `no_news` und materiality 0 sind der Normalfall und zählen als „nichts".
 */
export function reviewOf(c) {
  const r = c?.cowork_review;
  if (!r || r.no_news || !(r.materiality > 0)) return null;
  return r;
}

/** Sortierwert der Cow-Spalte: Materiality, Richtung als Feinsortierung. */
export function reviewSortValue(c) {
  const r = c?.cowork_review;
  if (!r || r.no_news) return null;
  const dir = r.signal === 'positive' ? 0.3 : r.signal === 'negative' ? 0.1 : 0.2;
  return (r.materiality ?? 0) + dir;
}

/** Tag/Monat aus einem ISO-Datum; leer, wenn unbrauchbar. */
export function shortDate(iso) {
  if (!iso) return '';
  const t = new Date(iso);
  return Number.isNaN(+t) ? '' : t.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

export function fullDate(iso) {
  if (!iso) return '';
  const t = new Date(iso);
  return Number.isNaN(+t) ? '' : t.toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Attribut-sicheres Escaping – dieselbe Aufgabe wie escProfile im Detail-Sheet. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Die Termine im Briefing kommen als {date, event}. Ältere Läufe haben sie als
 * einfache Zeichenkette abgelegt — beide Formen müssen lesbar bleiben, sonst
 * bricht die Ansicht an einem Eintrag von vorgestern.
 */
export function normalizeDriver(d) {
  if (typeof d === 'string') return { date: '', event: d };
  return { date: d?.date ?? '', event: d?.event ?? '' };
}

/**
 * Dasselbe für die Cluster des Makro-Blocks: der Schlüssel heißt `key`, ein
 * früherer Lauf schrieb `cluster`.
 */
export function normalizeCluster(c) {
  return {
    key:     c?.key ?? c?.cluster ?? 'other',
    state:   c?.state ?? 'neutral',
    note:    c?.note ?? '',
    sources: Array.isArray(c?.sources) ? c.sources : [],
  };
}
