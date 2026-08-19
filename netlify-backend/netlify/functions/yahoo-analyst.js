/**
 * yahoo-analyst.js — Analysten-Kursziele von Yahoo, als Fallback zu TradingView.
 *
 * Warum eine eigene Funktion statt der scrape-proxy: Yahoos `quoteSummary`
 * verlangt seit 2023 **Cookie + Crumb**. Ohne beides antwortet es
 * `401 Invalid Crumb` — gemessen, nicht vermutet, für AAPL, SAP.DE und SMCI und
 * mit zwei verschiedenen User-Agents. Die scrape-proxy reicht aber nur den Body
 * durch, keine Response-Header; der `Set-Cookie` käme also nie beim Browser an.
 * Der Dreischritt (Cookie holen → Crumb holen → Abfrage) läuft deshalb hier,
 * serverseitig: der Browser bekommt fertige Zahlen und nie einen Yahoo-Cookie.
 *
 * Aufruf:  POST /api/yahoo-analyst  { "symbol": "SAP.DE" }  (x-discovery-secret)
 *          POST wie die scrape-proxy, nicht GET: die CORS-Regel in
 *          `netlify.toml` gibt für `/api/*` genau `POST, OPTIONS` frei, und
 *          eine zweite Methode dort einzutragen wäre eine Fehlerquelle mehr.
 * Antwort: { ok, symbol, source:'yahoo', data: {
 *             target_mean, target_high, target_low, target_median,
 *             analysts, recommendation, currency } | null }
 *
 * `symbol` ist der **Yahoo**-Ticker inkl. Börsensuffix (`SAP.DE`) — der steht
 * bei unseren Kandidaten als `yahoo_symbol`.
 *
 * Wichtig für Nicht-US-Titel: die Kursziele stehen in `financialCurrency`
 * (SAP.DE in EUR). Die Währung wird deshalb mitgeliefert und darf im Frontend
 * nicht als USD angenommen werden.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CRUMB_TTL_MS = 30 * 60 * 1000;   // Cookie/Crumb halten deutlich länger, 30 min sind konservativ

// Über Function-Instanzen hinweg wiederverwendet, solange der Container lebt —
// spart pro Abfrage zwei Yahoo-Anfragen.
let cached = { cookie: null, crumb: null, at: 0 };

const num = (v) => {
  const n = Number(v?.raw ?? v);
  return Number.isFinite(n) ? n : null;
};

function respond(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-discovery-secret',
    },
  });
}

/** Cookie + Crumb besorgen (oder den zwischengespeicherten weiterverwenden). */
async function getAuth(force = false) {
  if (!force && cached.crumb && Date.now() - cached.at < CRUMB_TTL_MS) return cached;

  // fc.yahoo.com antwortet mit 404, setzt dabei aber den nötigen Cookie —
  // der Statuscode ist hier bewusst egal.
  const r1 = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA }, redirect: 'follow' });
  const jar = [];
  for (const [k, v] of r1.headers) if (k.toLowerCase() === 'set-cookie') jar.push(v.split(';')[0]);
  const cookie = jar.join('; ');
  if (!cookie) throw new Error('kein Yahoo-Cookie erhalten');

  const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, cookie, Accept: '*/*' },
  });
  const crumb = (await r2.text()).trim();
  if (!r2.ok || !crumb || crumb.length > 32) throw new Error(`Crumb fehlgeschlagen (HTTP ${r2.status})`);

  cached = { cookie, crumb, at: Date.now() };
  return cached;
}

async function fetchSummary(symbol, auth) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
    + `?modules=financialData&crumb=${encodeURIComponent(auth.crumb)}`;
  return fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      Origin: 'https://finance.yahoo.com',
      Referer: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
      cookie: auth.cookie,
    },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-discovery-secret',
      },
    });
  }

  if (req.method !== 'POST') return respond(405, { ok: false, error: 'Method not allowed' });

  const secret = req.headers.get('x-discovery-secret');
  if (!secret || secret !== process.env.DISCOVERY_SECRET) {
    return respond(401, { ok: false, error: 'Unauthorized' });
  }

  let symbol;
  try { symbol = (await req.json())?.symbol; }
  catch { return respond(400, { ok: false, error: 'Invalid JSON body' }); }
  // Eng gefasst: Yahoo-Ticker sind Buchstaben, Ziffern, Punkt, Bindestrich und
  // bei Indizes ein führendes ^. Alles andere geht gar nicht erst raus.
  if (!symbol || !/^[A-Za-z0-9.\-^]{1,20}$/.test(symbol)) {
    return respond(400, { ok: false, error: 'Missing or invalid symbol' });
  }

  try {
    let auth = await getAuth();
    let res = await fetchSummary(symbol, auth);
    // Ein abgelaufener Crumb sieht aus wie 401 — einmal frisch holen und erneut
    // versuchen, bevor wir aufgeben.
    if (res.status === 401) {
      auth = await getAuth(true);
      res = await fetchSummary(symbol, auth);
    }

    const text = await res.text();
    if (!res.ok) {
      console.log(`[yahoo-analyst] ${symbol}: HTTP ${res.status}`);
      return respond(200, { ok: false, symbol, error: `Yahoo HTTP ${res.status}`, data: null });
    }

    const fd = JSON.parse(text)?.quoteSummary?.result?.[0]?.financialData;
    if (!fd || fd.targetMeanPrice == null) {
      return respond(200, { ok: true, symbol, source: 'yahoo', data: null });
    }

    return respond(200, {
      ok: true,
      symbol,
      source: 'yahoo',
      data: {
        target_mean:    num(fd.targetMeanPrice),
        target_high:    num(fd.targetHighPrice),
        target_low:     num(fd.targetLowPrice),
        target_median:  num(fd.targetMedianPrice),
        analysts:       num(fd.numberOfAnalystOpinions),
        recommendation: fd.recommendationKey ?? null,
        currency:       fd.financialCurrency ?? null,
        checked_at:     new Date().toISOString(),
      },
    });
  } catch (err) {
    console.log(`[yahoo-analyst] ${symbol}: ${err.message}`);
    return respond(502, { ok: false, symbol, error: err.message, data: null });
  }
}
