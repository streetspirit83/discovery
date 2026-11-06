/**
 * Mega-Cluster – die ~19 TV-Sektoren zu 5 aussagekräftigen Gruppen gebündelt.
 * Gemeinsame Quelle für den Filterbar-Dropdown, das Kontroll-Modal und die
 * Sektor-Heatmap im Markets-Modal.
 */

export const MEGA_CLUSTERS = [
  { key: 'tech',     label: 'Tech & Comms' },
  { key: 'health',   label: 'Gesundheit' },
  { key: 'consumer', label: 'Konsum & Handel' },
  { key: 'industry', label: 'Industrie & Energie' },
  { key: 'finance',  label: 'Finanzen' },
];

/* TV-Sektor → Mega-Cluster-Key. Unbekannte Sektoren → null (fallen bei
 * aktivem Filter raus und tauchen in der Heatmap nicht auf). */
const SECTOR_TO_MEGA = {
  'Electronic Technology': 'tech',
  'Technology Services': 'tech',
  'Communications': 'tech',
  'Health Technology': 'health',
  'Health Services': 'health',
  'Consumer Durables': 'consumer',
  'Consumer Non-Durables': 'consumer',
  'Consumer Services': 'consumer',
  'Retail Trade': 'consumer',
  'Distribution Services': 'consumer',
  'Producer Manufacturing': 'industry',
  'Industrial Services': 'industry',
  'Commercial Services': 'industry',
  'Transportation': 'industry',
  'Non-Energy Minerals': 'industry',
  'Process Industries': 'industry',
  'Energy Minerals': 'industry',
  'Utilities': 'industry',
  'Finance': 'finance',
};

export const megaClusterOf = (sector) => SECTOR_TO_MEGA[sector] ?? null;
export const megaClusterLabel = (key) => MEGA_CLUSTERS.find((m) => m.key === key)?.label ?? key;
