/**
 * Markt-Ausschnitt für das Monitor-Dashboard (reine Logik, kein DOM).
 *
 * Zwei Perspektiven auf dieselben Kandidaten, je drei Drill-down-Ebenen, darunter
 * die Einzeltitel:
 *   Sektoren: Sektor (TV) → Sub-Sektor (TV industry)
 *   Länder:   Land → Sektor (TV)
 * Mega-Cluster bzw. Region stehen als Zusatzzeile auf den Kacheln der obersten Ebene.
 *
 * Das Land kommt aus dem ROIC-Firmenprofil (`company_profile.facts.country`,
 * Sitz der Firma). Fehlt das Profil, gilt ersatzweise der Börsenplatz
 * (`src: 'exchange'`) – bei ADRs und Zweitlistings ist das das Land des Listings,
 * nicht der Firma. `countryCoverage` zählt beide Fälle für die Fußnote.
 *
 * Branchen- und Länder-Indizes (lib/tv-indices.js) werden dem Ausschnitt
 * zugeordnet: Branchen über `INDEX_MEGA` an den Mega-Cluster des Sektors, Länder über
 * ihr Label an das Land (ohne eigenen Index die der Region).
 */

import { megaClusterOf, megaClusterLabel } from './sector-clusters.js?v=20260807a';
import { normalizeExchange } from './exchange-map.js';

export const HORIZONS = [
  { key: 'change_1d', label: '1T', cap: 4 },
  { key: 'perf_w',    label: '1W', cap: 8 },
  { key: 'perf_1m',   label: '1M', cap: 15 },
  { key: 'perf_3m',   label: '3M', cap: 25 },
];
/* Index-Zeilen tragen die Tagesveränderung als `change`. */
const INDEX_FIELD = { change_1d: 'change', perf_w: 'perf_w', perf_1m: 'perf_1m', perf_3m: 'perf_3m' };

/* `levels` = Drill-down-Ebenen (darunter die Einzeltitel), `tag` = übergeordnetes Merkmal,
 * das die Kacheln der obersten Ebene als kleine Zusatzzeile tragen. */
export const PERSPECTIVES = {
  sector:  { label: 'Sektoren', levels: ['sector', 'sub'],     names: ['Sektor', 'Sub-Sektor'], tag: 'mega' },
  country: { label: 'Länder',   levels: ['country', 'sector'], names: ['Land', 'Sektor'],       tag: 'region' },
};

const NO_SECTOR = 'Ohne Sektor';
const NO_SUB = 'Ohne Sub-Sektor';
const OTHER = 'Sonstige';

/* Land → Region. Schlüssel = deutsches Label (so heissen auch die Länder-Indizes). */
const REGION = {
  USA: 'Nordamerika', Kanada: 'Nordamerika',
  Mexiko: 'Lateinamerika', Brasilien: 'Lateinamerika', Argentinien: 'Lateinamerika', Chile: 'Lateinamerika',
  Deutschland: 'Europa', 'Großbritannien': 'Europa', Frankreich: 'Europa', Niederlande: 'Europa', Belgien: 'Europa',
  Schweiz: 'Europa', 'Österreich': 'Europa', Italien: 'Europa', Spanien: 'Europa', Portugal: 'Europa',
  Schweden: 'Europa', Norwegen: 'Europa', 'Dänemark': 'Europa', Finnland: 'Europa', Polen: 'Europa',
  Irland: 'Europa', Luxemburg: 'Europa', Griechenland: 'Europa', Tschechien: 'Europa', 'Türkei': 'Europa',
  Japan: 'Asien-Pazifik', China: 'Asien-Pazifik', Hongkong: 'Asien-Pazifik', 'Südkorea': 'Asien-Pazifik',
  Indien: 'Asien-Pazifik', Singapur: 'Asien-Pazifik', Taiwan: 'Asien-Pazifik', Australien: 'Asien-Pazifik',
  Neuseeland: 'Asien-Pazifik', Indonesien: 'Asien-Pazifik',
  Israel: 'Nahost & Afrika', 'Südafrika': 'Nahost & Afrika', 'Vereinigte Arabische Emirate': 'Nahost & Afrika',
  'Saudi-Arabien': 'Nahost & Afrika',
};

/* Schreibweisen aus dem Profil (ISO-Code oder englischer Name) → deutsches Label. */
const COUNTRY_ALIAS = {
  us: 'USA', usa: 'USA', 'united states': 'USA', 'united states of america': 'USA',
  ca: 'Kanada', canada: 'Kanada', mx: 'Mexiko', mexico: 'Mexiko', br: 'Brasilien', brazil: 'Brasilien',
  ar: 'Argentinien', argentina: 'Argentinien', cl: 'Chile', chile: 'Chile',
  de: 'Deutschland', germany: 'Deutschland', gb: 'Großbritannien', uk: 'Großbritannien',
  'united kingdom': 'Großbritannien', 'great britain': 'Großbritannien', fr: 'Frankreich', france: 'Frankreich',
  nl: 'Niederlande', netherlands: 'Niederlande', be: 'Belgien', belgium: 'Belgien', ch: 'Schweiz', switzerland: 'Schweiz',
  at: 'Österreich', austria: 'Österreich', it: 'Italien', italy: 'Italien', es: 'Spanien', spain: 'Spanien',
  pt: 'Portugal', portugal: 'Portugal', se: 'Schweden', sweden: 'Schweden', no: 'Norwegen', norway: 'Norwegen',
  dk: 'Dänemark', denmark: 'Dänemark', fi: 'Finnland', finland: 'Finnland', pl: 'Polen', poland: 'Polen',
  ie: 'Irland', ireland: 'Irland', lu: 'Luxemburg', luxembourg: 'Luxemburg', gr: 'Griechenland', greece: 'Griechenland',
  cz: 'Tschechien', 'czech republic': 'Tschechien', czechia: 'Tschechien', tr: 'Türkei', turkey: 'Türkei', 'türkiye': 'Türkei',
  jp: 'Japan', japan: 'Japan', cn: 'China', china: 'China', hk: 'Hongkong', 'hong kong': 'Hongkong',
  kr: 'Südkorea', 'south korea': 'Südkorea', korea: 'Südkorea', in: 'Indien', india: 'Indien',
  sg: 'Singapur', singapore: 'Singapur', tw: 'Taiwan', taiwan: 'Taiwan', au: 'Australien', australia: 'Australien',
  nz: 'Neuseeland', 'new zealand': 'Neuseeland', id: 'Indonesien', indonesia: 'Indonesien',
  il: 'Israel', israel: 'Israel', za: 'Südafrika', 'south africa': 'Südafrika',
  ae: 'Vereinigte Arabische Emirate', 'united arab emirates': 'Vereinigte Arabische Emirate',
  sa: 'Saudi-Arabien', 'saudi arabia': 'Saudi-Arabien',
};

/* Ersatz ohne Firmenprofil: Börsenplatz → Land. Euronext deckt mehrere Länder ab. */
const EXCHANGE_COUNTRY = {
  NASDAQ: 'USA', NYSE: 'USA', AMEX: 'USA', OTC: 'USA',
  XETR: 'Deutschland', MIL: 'Italien', BME: 'Spanien', VIE: 'Österreich',
  OMXSTO: 'Schweden', OMXCOP: 'Dänemark', OSL: 'Norwegen', OMXHEX: 'Finnland',
  LSE: 'Großbritannien', SIX: 'Schweiz', TSX: 'Kanada', TSE: 'Japan', HKEX: 'Hongkong',
};

/** @returns {{name:string, region:string, src:'profile'|'exchange'|'none'}} */
export function countryOf(c) {
  const raw = String(c?.company_profile?.facts?.country ?? '').trim();
  if (raw) {
    const name = COUNTRY_ALIAS[raw.toLowerCase()] ?? (REGION[raw] ? raw : raw);
    return { name, region: REGION[name] ?? OTHER, src: 'profile' };
  }
  const ex = normalizeExchange(c?.exchange);
  const name = EXCHANGE_COUNTRY[ex];
  if (name) return { name, region: REGION[name] ?? OTHER, src: 'exchange' };
  if (ex === 'EURONEXT') return { name: 'Euronext (Land offen)', region: 'Europa', src: 'exchange' };
  return { name: 'Unbekannt', region: OTHER, src: 'none' };
}

/** Alle Gruppierungsmerkmale eines Titels (je Kandidat gecacht, nicht-aufzählbar). */
const DIMS = new WeakMap();
export function dimsOf(c) {
  const key = `${c.sector ?? ''}|${c.sub_sector ?? ''}|${c.company_profile?.facts?.country ?? ''}|${c.exchange ?? ''}`;
  const hit = DIMS.get(c);
  if (hit && hit.key === key) return hit.d;
  const megaKey = megaClusterOf(c.sector);
  const ctry = countryOf(c);
  const d = {
    mega: megaKey ? megaClusterLabel(megaKey) : OTHER,
    megaKey,
    sector: c.sector || NO_SECTOR,
    sub: c.sub_sector || NO_SUB,
    region: ctry.region,
    country: ctry.name,
    countrySrc: ctry.src,
  };
  DIMS.set(c, { key, d });
  return d;
}

export function median(values) {
  const s = values.filter((v) => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const perfOf = (c, hKey) => {
  const v = c?.tv_data?.[hKey];
  return v == null || Number.isNaN(Number(v)) ? null : Number(v);
};

/** Basis des Dashboards: nur Titel mit TV-Daten. */
export const withData = (cands) => (cands ?? []).filter((c) => c?.tv_data);

/** Titel im Ausschnitt `path` (Namen je Ebene der Perspektive). */
export function scopeOf(cands, perspective, path = []) {
  const levels = PERSPECTIVES[perspective].levels;
  if (!path.length) return cands;
  return cands.filter((c) => { const d = dimsOf(c); return path.every((n, i) => d[levels[i]] === n); });
}

function groupBy(items, level) {
  const m = new Map();
  for (const c of items) { const k = dimsOf(c)[level]; (m.get(k) ?? m.set(k, []).get(k)).push(c); }
  return [...m].map(([name, list]) => ({ name, items: list }));
}

/**
 * Kacheln für den Ausschnitt – immer genau eine Ebene:
 *   path kürzer als die Ebenen → `tiles[]` der nächsten Ebene (oberste Ebene mit `tag`)
 *   sonst                      → `tiles[]` = Einzeltitel (`tile.c`), `stocks: true`
 * Jede Kachel: { name, n, v (Median im Horizont), tag?, items | c }.
 */
export function tilesFor(scoped, perspective, path, value) {
  const { levels, tag } = PERSPECTIVES[perspective];
  // `value`: Horizont-Schlüssel (Performance) oder Funktion Titel → Kennzahl (Färbung).
  const val = typeof value === 'function' ? value : (c) => perfOf(c, value);
  if (path.length >= levels.length) {
    return { stocks: true, tiles: scoped.map((c) => ({ name: c.symbol, n: 1, v: val(c), c })) };
  }
  const tiles = groupBy(scoped, levels[path.length]).map((g) => ({
    name: g.name, n: g.items.length, v: median(g.items.map(val)), items: g.items,
    tag: path.length ? null : dimsOf(g.items[0])[tag],
  })).sort((x, y) => y.n - x.n || x.name.localeCompare(y.name));
  return { tiles };
}

/**
 * Zeilen der Signal-Matrix: die Gruppen der nächsten Ebene, auf der untersten Ebene die
 * Einzeltitel (`c` gesetzt). `title` = Name der Ebene („Sektor“, „Land“, „Titel“ …).
 */
export function groupsFor(scoped, perspective, path) {
  const { levels, names } = PERSPECTIVES[perspective];
  if (path.length >= levels.length) {
    return { title: 'Titel', rows: scoped.map((c) => ({ name: c.symbol, items: [c], c })).sort((a, b) => a.name.localeCompare(b.name)) };
  }
  return { title: names[path.length],
    rows: groupBy(scoped, levels[path.length]).sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name)) };
}

/** Kennzahlen des Ausschnitts im Horizont. */
export function breadth(scoped, hKey) {
  const vals = scoped.map((c) => perfOf(c, hKey)).filter((v) => v != null);
  const up = vals.filter((v) => v > 0).length;
  const down = vals.filter((v) => v < 0).length;
  return { n: scoped.length, up, down, flat: vals.length - up - down, median: median(vals) };
}

/** Gewinner und Verlierer des Ausschnitts im Horizont. */
export function movers(scoped, hKey, n = 5) {
  const rows = scoped.map((c) => ({ c, v: perfOf(c, hKey) })).filter((r) => r.v != null).sort((a, b) => b.v - a.v);
  return { gainers: rows.filter((r) => r.v > 0).slice(0, n), losers: rows.filter((r) => r.v < 0).reverse().slice(0, n), all: rows };
}

export function countryCoverage(cands) {
  let profile = 0, exchange = 0, none = 0;
  for (const c of cands) {
    const s = dimsOf(c).countrySrc;
    if (s === 'profile') profile++; else if (s === 'exchange') exchange++; else none++;
  }
  return { profile, exchange, none };
}

/* Branchen-Index → Mega-Cluster (Codes aus INDEX_GROUPS „branchen"). */
export const INDEX_MEGA = {
  SOX: 'tech', DJUSSW: 'tech', DJINET: 'tech', HXR: 'tech', EMCLOUD: 'tech', XBAI: 'tech', ROBO: 'tech',
  NBI: 'health', S5HLTH: 'health', DJUSMS: 'health',
  SPAUTO: 'consumer', SPLUX: 'consumer', S5COND: 'consumer', S5CONS: 'consumer',
  SPN: 'industry', SPSIOP: 'industry', DJUSUT: 'industry', SPGTCLEN: 'industry', DJUSIN: 'industry',
  DJUSAS: 'industry', S5CHEM: 'industry', SPMTMN: 'industry', DJT: 'industry',
  IXFT: 'finance', BKX: 'finance', INSR: 'finance',
};

/**
 * Indizes zum Ausschnitt. Ohne Auswahl die je `edge` stärksten und schwächsten der
 * Gruppe, sonst die zum gewählten Sektor bzw. Land.
 * @param {{branchen?:Array, laender?:Array}} rowsByGroup  Zeilen aus fetchIndexRows, je Gruppe
 * @returns {{ items:Array<{code,label,v,url,value}>, mode:'edge'|'scope', total:number }}
 */
export function indicesFor(rowsByGroup, perspective, path, hKey, edge = 3) {
  const field = INDEX_FIELD[hKey] ?? 'change';
  const rows = ((perspective === 'country' ? rowsByGroup?.laender : rowsByGroup?.branchen) ?? [])
    .filter((r) => r?.ok && r[field] != null)
    .map((r) => ({ code: r.code, label: r.label, v: Number(r[field]), url: r.url ?? null, value: r.value ?? null,
      group: perspective === 'country' ? (REGION[r.label] ?? OTHER) : megaClusterLabel(INDEX_MEGA[r.code] ?? '') }))
    .sort((a, b) => b.v - a.v);
  if (!path.length) {
    if (rows.length <= edge * 2) return { items: rows, mode: 'edge', total: rows.length };
    return { items: [...rows.slice(0, edge), ...rows.slice(-edge)], mode: 'edge', total: rows.length };
  }
  // Sektor → Indizes seines Mega-Clusters; Land → sein Index, sonst die der Region.
  let items;
  if (perspective === 'country') {
    items = rows.filter((r) => r.label === path[0]);
    if (!items.length) items = rows.filter((r) => r.group === (REGION[path[0]] ?? OTHER));
  } else {
    const mega = megaClusterOf(path[0]);
    items = mega ? rows.filter((r) => r.group === megaClusterLabel(mega)) : [];
  }
  return { items, mode: 'scope', total: rows.length };
}
