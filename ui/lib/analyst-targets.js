/**
 * analyst-targets.js — Analysten-Kursziele, TradingView zuerst, Yahoo als Fallback.
 *
 * **TradingView** (Primärquelle, kostenlos im Sinne von: kein zusätzlicher
 * Request). Die Felder `pt_average/high/low/median` kommen im normalen
 * Bulk-Abruf von `tv-enrichment.js` mit und stehen in `tv_data`. Gegen den
 * Scanner vermessen: US- **und** XETR-Titel liefern Werte, ETFs nichts.
 *
 * **Yahoo** (Fallback, on demand). Nur wenn TV für den Titel kein Kursziel hat.
 * Kostet einen Request an unsere eigene Funktion `/api/yahoo-analyst` — der
 * Cookie-Crumb-Dreischritt läuft dort serverseitig (siehe Kopf der Funktion).
 * Yahoo liefert als Einziges die **Anzahl der Schätzungen**; TV kennt die nicht
 * (`price_target_estimates_num` ist dort immer null, sechs Namensvarianten
 * geprüft).
 *
 * **Währung:** beide Quellen liefern in der Währung des Instruments. TV-Werte
 * stehen in `tv_data` und laufen durch dieselbe `convertTv`-Umrechnung wie
 * `close`; Yahoo liefert seine Währung explizit mit (`currency`) — das Frontend
 * darf sie NICHT als USD annehmen, sondern rechnet über den mitgelieferten
 * Code um oder zeigt sie nativ.
 */

const TTL_MS = 12 * 60 * 60 * 1000;   // Kursziele ändern sich träge
const cacheKey = (sym) => `discovery_yh_targets_${sym}`;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

function readCache(sym) {
  try {
    const raw = localStorage.getItem(cacheKey(sym));
    if (!raw) return null;
    const { at, payload } = JSON.parse(raw);
    return (at && Date.now() - at < TTL_MS) ? payload : null;
  } catch { return null; }
}

function writeCache(sym, payload) {
  try { localStorage.setItem(cacheKey(sym), JSON.stringify({ at: Date.now(), payload })); }
  catch { /* Quota — Cache ist optional */ }
}

/**
 * tvTargets(tv) → { mean, high, low, median, source:'tv', analysts:null, … } | null
 *
 * `tv` ist das (ggf. bereits in die Anzeigewährung umgerechnete) `tv_data`.
 * `mean` fehlt bei ETFs und vielen Small Caps — dann ist das Ergebnis null und
 * der Yahoo-Fallback kommt zum Zug.
 */
export function tvTargets(tv) {
  const mean = num(tv?.pt_average);
  if (mean == null || mean <= 0) return null;
  return {
    source: 'tv',
    mean,
    high:   num(tv?.pt_high),
    low:    num(tv?.pt_low),
    median: num(tv?.pt_median),
    // TV kennt keine Zahl der Kursziel-Schätzungen; `recommendation_total` ist
    // die Zahl der EMPFEHLUNGEN — verwandt, aber nicht dasselbe. Deshalb ein
    // eigenes Feld, damit die Anzeige es nicht als Schätzungsanzahl ausgibt.
    analysts: null,
    ratings: {
      total: num(tv?.recommendation_total),
      buy:   num(tv?.rec_buy),
      hold:  num(tv?.rec_hold),
      sell:  num(tv?.rec_sell),
    },
    currency: null,   // = Instrumentenwährung, schon in der Anzeigewährung
  };
}

/** Yahoo-Ticker inkl. Suffix — die Adapter schreiben ihn meist schon mit. */
export function yahooSymbol(c) {
  const y = String(c?.yahoo_symbol ?? '').trim();
  return y || null;
}

/**
 * fetchYahooTargets(candidate, { backendUrl, secret, force })
 *   → { source:'yahoo', mean, high, low, median, analysts, recommendation,
 *       currency, checked_at }
 *   | { error: 'no_symbol'|'no_backend'|'none'|'http'|… }
 *
 * Ohne Backend (Mock-Modus) oder ohne `yahoo_symbol` gibt es sauber auf, statt
 * zu raten: einen Yahoo-Ticker aus Symbol + Börse zu basteln ginge für
 * EURONEXT-Titel systematisch schief (siehe `tv-swings.js`).
 */
export async function fetchYahooTargets(candidate, { backendUrl, secret, force = false } = {}) {
  const sym = yahooSymbol(candidate);
  if (!sym) return { error: 'no_symbol' };
  if (!backendUrl || !secret) return { error: 'no_backend' };

  if (!force) {
    const hit = readCache(sym);
    if (hit) return hit;
  }

  let wrapper;
  try {
    const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/yahoo-analyst`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-discovery-secret': secret },
      body: JSON.stringify({ symbol: sym }),
    });
    wrapper = await res.json();
  } catch (err) {
    return { error: 'http', detail: err.message };
  }

  if (!wrapper?.ok) return { error: 'http', detail: wrapper?.error ?? 'unbekannt' };
  const d = wrapper.data;
  if (!d || d.target_mean == null) {
    const miss = { error: 'none', checked_at: new Date().toISOString() };
    writeCache(sym, miss);        // auch die Fehlanzeige cachen, sonst fragt jeder Klick neu
    return miss;
  }

  const out = {
    source: 'yahoo',
    mean:   num(d.target_mean),
    high:   num(d.target_high),
    low:    num(d.target_low),
    median: num(d.target_median),
    analysts: num(d.analysts),
    recommendation: d.recommendation ?? null,
    currency: d.currency ?? null,
    checked_at: d.checked_at ?? new Date().toISOString(),
  };
  writeCache(sym, out);
  return out;
}

/**
 * analystTargets(candidate, tv) → das anzuzeigende Ziel-Objekt oder null.
 *
 * TV gewinnt, weil es ohne Zusatzabruf da ist. Ein bereits geladenes
 * Yahoo-Ergebnis (`candidate.yh_targets`) springt nur ein, wenn TV nichts hat.
 */
export function analystTargets(candidate, tv) {
  return tvTargets(tv) ?? (candidate?.yh_targets?.mean != null ? candidate.yh_targets : null);
}
