/**
 * fmp-valuation.js — FMPs eigener DCF-Fair-Value + Rating als Zweitmeinung.
 *
 * Gegen den echten Free-Key vermessen (CI-Probe), nicht aus der Doku abgeleitet:
 *
 * ✅ frei — aber nur für einen **begrenzten Symbol-Umfang**:
 *    stable/discounted-cash-flow?symbol=          → [{ symbol, date, dcf, "Stock Price" }]
 *    stable/levered-discounted-cash-flow?symbol=  → dito (nach Verschuldung)
 *    stable/ratings-snapshot?symbol=              → [{ rating, overallScore, …Score }]
 * ❌ HTTP 402 „Premium Query Parameter" für alles ausserhalb dieses Umfangs.
 *
 * Gemessen (10 US-Ticker, CI-Probe): AAPL · NVDA · MSFT · TSLA · AMD · GOOGL · F
 * liefern 200, **SMCI · ENPH · PSKY antworten 402** — und jeder Nicht-US-Ticker
 * ohnehin. Es ist also KEINE reine US-Grenze, sondern eine Symbol-Auswahl, die
 * grob den Mega-Caps entspricht. Eine frühere Fassung dieses Kommentars behauptete
 * „alle US-Titel"; das beruhte auf einer Stichprobe von genau einem Symbol (AAPL).
 * Für die typischen Discovery-Kandidaten (Small/Mid-Caps aus OpenInsider und
 * StockTwits-Trending) liefert FMP deshalb meistens nichts.
 * ❌ alles unter /api/v3 und /api/v4 → HTTP 403 „Legacy Endpoint", für Keys ab
 *    dem 31.08.2025 abgeschaltet. Nur /stable/ lebt.
 *
 * Achtung beim Parsen: das Preisfeld heisst wörtlich `"Stock Price"` — mit
 * Leerzeichen und Grossbuchstaben. Nur über Klammerzugriff erreichbar.
 *
 * Währung: für US-Titel ist alles USD. Wir geben deshalb bewusst vor allem das
 * **Verhältnis** aus (Auf-/Abschlag in Prozent) — das ist währungsfrei und
 * damit unabhängig vom USD/EUR-Umschalter der Anzeige.
 *
 * Einordnung: FMPs `dcf` ist ein mechanisches Modell, kein Analysten-Fair-Value
 * à la Morningstar. Es steht neben unserem Reverse-DCF als zweite, anders
 * parametrisierte Rechnung — und fliesst wie dieser in keinen Score ein.
 *
 * Kontingent: 250 Anfragen/Tag im Free-Plan. Ein Symbol kostet 2 Anfragen,
 * deshalb 24 h Cache (der DCF ändert sich ohnehin nur täglich).
 */

import { isUsTicker } from './tv-swings.js?v=20260818a';

const BASE = 'https://financialmodelingprep.com/stable';
const TTL_MS = 24 * 60 * 60 * 1000;
const cacheKey = (sym) => `discovery_fmp_val_${sym}`;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

function readCache(sym) {
  try {
    const raw = localStorage.getItem(cacheKey(sym));
    if (!raw) return null;
    const { at, payload } = JSON.parse(raw);
    if (!at || Date.now() - at > TTL_MS) return null;
    return payload;
  } catch { return null; }
}

function writeCache(sym, payload) {
  try { localStorage.setItem(cacheKey(sym), JSON.stringify({ at: Date.now(), payload })); }
  catch { /* Quota — Cache ist optional */ }
}

async function proxyGet(url, { backendUrl, secret }) {
  const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/scrape-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
    body: JSON.stringify({ url, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' } }),
  });
  const wrapper = await res.json();
  if (!wrapper?.ok) return { error: 'proxy' };
  /* FMPs Originaltext IMMER mitführen. Die erste Fassung bildete den Status auf
     einen festen Satz ab — dadurch stand „nur US-Titel" auch bei einem US-Titel
     und verwies auf die falsche Ursache. Eine gemappte Meldung darf die Quelle
     ergänzen, nie ersetzen. */
  const detail = String(wrapper.body ?? '').slice(0, 300).trim();
  if (wrapper.status === 402) return { error: 'premium_symbol', status: 402, detail };
  if (wrapper.status === 401 || wrapper.status === 403) return { error: 'key', status: wrapper.status, detail };
  if (wrapper.status === 429) return { error: 'quota', status: 429, detail };
  if (wrapper.status !== 200) return { error: 'http', status: wrapper.status, detail };
  try { return { data: JSON.parse(wrapper.body) }; }
  catch { return { error: 'parse' }; }
}

/** Erstes Element aus FMPs Array-Antworten, sonst null. */
const first = (d) => (Array.isArray(d) && d.length ? d[0] : null);

/**
 * fetchFmpValuation(candidate, { backendUrl, secret })
 * → { dcf, dcf_levered, price, upside, upside_levered, rating, scores, date, checked_at }
 * | { unsupported: true }            (Nicht-US — im Free-Plan gesperrt)
 * | { error: 'no_key'|'key'|'quota'|'premium_symbol'|… }
 */
export async function fetchFmpValuation(candidate, { backendUrl, secret }) {
  const now = new Date().toISOString();
  if (!isUsTicker(candidate)) return { unsupported: true, checked_at: now };

  const key = localStorage.getItem('discovery_fmp_key');
  if (!key) return { error: 'no_key', checked_at: now };

  const sym = String(candidate?.symbol ?? '').trim().toUpperCase();
  if (!sym) return { unsupported: true, checked_at: now };

  const cached = readCache(sym);
  if (cached) return cached;

  const q = `symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(key)}`;
  const [dcfRes, ratingRes] = await Promise.all([
    proxyGet(`${BASE}/discounted-cash-flow?${q}`, { backendUrl, secret }),
    proxyGet(`${BASE}/ratings-snapshot?${q}`, { backendUrl, secret }),
  ]);

  // Der DCF trägt die Aussage — scheitert er, ist der Rest wertlos.
  if (dcfRes.error) {
    return { error: dcfRes.error, status: dcfRes.status ?? null, detail: dcfRes.detail ?? null,
             symbol: sym, checked_at: now };
  }

  const d = first(dcfRes.data);
  if (!d) return { error: 'empty', checked_at: now };

  const dcf = num(d.dcf);
  const price = num(d['Stock Price']);       // Feldname wörtlich, mit Leerzeichen
  const r = ratingRes.error ? null : first(ratingRes.data);

  const payload = {
    dcf,
    price,
    // Auf-/Abschlag als Verhältnis → währungsfrei.
    upside: dcf != null && price ? dcf / price - 1 : null,
    rating: r?.rating ?? null,
    scores: r ? {
      overall: num(r.overallScore),
      dcf: num(r.discountedCashFlowScore),
      roe: num(r.returnOnEquityScore),
      roa: num(r.returnOnAssetsScore),
      debtToEquity: num(r.debtToEquityScore),
      pe: num(r.priceToEarningsScore),
      pb: num(r.priceToBookScore),
    } : null,
    date: d.date ?? null,
    checked_at: now,
  };
  writeCache(sym, payload);
  return payload;
}

export function fmpErrorText(code) {
  switch (code) {
    case 'no_key':         return 'FMP-Key in den Einstellungen hinterlegen.';
    case 'key':            return 'FMP lehnt den Key ab (oder der Endpoint ist ein Legacy-Pfad).';
    case 'quota':          return 'FMP-Kontingent erschöpft (250 Anfragen/Tag) – morgen erneut.';
    case 'premium_symbol': return 'FMP deckt dieses Symbol im Free-Plan nicht ab (HTTP 402) — der freie Umfang umfasst im Wesentlichen Mega-Caps.';
    case 'empty':          return 'FMP lieferte keine Bewertung für dieses Symbol.';
    default:               return 'FMP-Abruf fehlgeschlagen.';
  }
}
