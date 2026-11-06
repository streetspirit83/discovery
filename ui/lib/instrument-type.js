/**
 * Instrumententyp — ETF oder Aktie.
 *
 * Zwei Quellen, in dieser Reihenfolge:
 *  1. **TradingView-Scanner.** `type` ("stock" | "fund" | "dr" | "bond" | …)
 *     zusammen mit `typespecs` (["etf"], ["etf","etn"], ["common"], ["reit"] …).
 *     Das ist die belastbare Angabe; sie wird bei der TV-Anreicherung als
 *     `asset_type` am Kandidaten persistiert (siehe `tv-enrichment.js`).
 *  2. **Namensheuristik.** Greift für Kandidaten, die noch nie angereichert
 *     wurden — sonst stünde bei jedem frisch importierten ETF „Aktie".
 *
 * Bewusst NICHT als Signal benutzt: `signal_type: 'etf_addition'` aus dem
 * etf-holdings-Adapter. Das sagt „diese **Aktie** wurde in einen ETF
 * aufgenommen" — es beschreibt die Quelle, nicht das Papier.
 */

export const ASSET_TYPES = { ETF: 'ETF', STOCK: 'Stock' };

export const TYPE_LABEL = { etf: 'ETF', stock: 'Aktie' };

/**
 * ETF-Erkennung aus den Scanner-Feldern. `typespecs` ist die eigentliche
 * Auskunft (["etf"]); `type === 'fund'` fängt Fonds ohne gesetzte typespecs
 * mit ab. ETC/ETN laufen bewusst mit als ETF: sie sind für die Frage in der
 * Tabelle („Einzelwert oder Korb?") dasselbe.
 */
export function isEtfFromTv(type, typespecs) {
  const specs = Array.isArray(typespecs)
    ? typespecs.map((s) => String(s).toLowerCase())
    : typeof typespecs === 'string' ? [typespecs.toLowerCase()] : [];
  if (specs.some((s) => s === 'etf' || s === 'etn' || s === 'etc')) return true;
  return String(type ?? '').toLowerCase() === 'fund';
}

/** Was `asset_type` am Kandidaten trägt: 'ETF' oder 'Stock'. */
export function assetTypeFromTv(type, typespecs) {
  return isEtfFromTv(type, typespecs) ? ASSET_TYPES.ETF : ASSET_TYPES.STOCK;
}

/* Namensheuristik. Zwei Gruppen: die Gattungswörter im Namen und die grossen
   Emittenten, deren Produktnamen den Typ nicht immer ausschreiben
   ("iShares Core MSCI World"). Bewusst eng gehalten — ein falsch als ETF
   markierter Einzelwert wäre schlimmer als ein fehlendes Label. */
const ETF_WORDS = /(^|[\s(.\-])(etf|etfs|etc|etn|ucits|sicav|index fund|indexfonds)([\s).\-,]|$)/i;
const ETF_ISSUERS = /^(ishares|xtrackers|x-trackers|lyxor|amundi|spdr|vaneck|van eck|wisdomtree|global x|hsbc msci|franklin ftse|l&g |legal & general ucits|first trust (?:nasdaq|cloud)|proshares|direxion|deka msci|ubs \(irl\)|vanguard (?:ftse|s&p|total|esg|msci|all-world))/i;

export function isEtfFromName(name) {
  const n = String(name ?? '').trim();
  if (!n) return false;
  return ETF_WORDS.test(n) || ETF_ISSUERS.test(n);
}

/**
 * instrumentType(candidate) → 'etf' | 'stock'
 *
 * Fällt nie auf null zurück: die Tabelle soll jede Zeile beschriften, und
 * „nicht als ETF erkannt" heisst in diesem Workspace praktisch Einzelwert.
 * Wie sicher die Auskunft ist, sagt `instrumentTypeSource()`.
 */
export function instrumentType(candidate) {
  if (!candidate) return 'stock';
  const stored = String(candidate.asset_type ?? '').toLowerCase();
  if (stored === 'etf') return 'etf';
  const tv = candidate.tv_data;
  if (tv && (tv.instrument_type != null || tv.typespecs != null)) {
    return isEtfFromTv(tv.instrument_type, tv.typespecs) ? 'etf' : 'stock';
  }
  if (stored === 'stock') return isEtfFromName(candidate.name) ? 'etf' : 'stock';
  return isEtfFromName(candidate.name) ? 'etf' : 'stock';
}

/** 'tv' = vom Scanner bestätigt · 'name' = aus dem Namen geraten. */
export function instrumentTypeSource(candidate) {
  const tv = candidate?.tv_data;
  if (tv && (tv.instrument_type != null || tv.typespecs != null)) return 'tv';
  return 'name';
}

export const isEtf = (candidate) => instrumentType(candidate) === 'etf';
