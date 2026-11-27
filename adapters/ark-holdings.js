/**
 * ARK Daily Holdings – aktive Käufe der ARK-ETFs (täglich veröffentlichte CSV-Dateien).
 *
 * Quelle: assets.ark-funds.com/fund-documents/funds-etf-csv/<FONDS>_HOLDINGS.csv (frei, ohne Key,
 * gemessen 23.11.2026; Spalten date,fund,company,ticker,cusip,shares,market value ($),weight (%)).
 * Signal ist die Veränderung gegenüber dem letzten Lauf:
 *   - `etf_addition`: neue Position in einem Fonds
 *   - `etf_weight_increase`: Stückzahl +MIN_SHARE_UP % oder mehr bei mindestens MIN_WEIGHT % Gewicht
 * Der Vortagsstand liegt als Datei in ARK_STATE (Standard .ark-state/holdings.json), die der Workflow über
 * actions/cache von Lauf zu Lauf weiterreicht. Erster Lauf ohne Stand: nur speichern, keine Kandidaten.
 * Fonds, deren CSV-Datum sich nicht geändert hat (z. B. ARKW hängt zeitweise hinterher), zählen nicht.
 * Börse je Ticker über den TradingView-Scanner (NASDAQ/NYSE/AMEX, via scrape-proxy); was dort nicht als
 * US-Aktie existiert (Auslandstitel, Cash-Positionen), fällt raus.
 *
 * Env: DISCOVERY_BACKEND_URL, DISCOVERY_SECRET, optional ARK_STATE.
 */

import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { buildLinks } from './_shared/link-builder.js';

const log = (level, msg, data = {}) =>
  process.stdout.write(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...data }) + '\n');

const BASE = 'https://assets.ark-funds.com/fund-documents/funds-etf-csv/';
export const FUNDS = [
  { fund: 'ARKK', file: 'ARK_INNOVATION_ETF_ARKK_HOLDINGS' },
  { fund: 'ARKW', file: 'ARK_NEXT_GENERATION_INTERNET_ETF_ARKW_HOLDINGS' },
  { fund: 'ARKG', file: 'ARK_GENOMIC_REVOLUTION_ETF_ARKG_HOLDINGS' },
  { fund: 'ARKQ', file: 'ARK_AUTONOMOUS_TECH._&_ROBOTICS_ETF_ARKQ_HOLDINGS' },
  { fund: 'ARKF', file: 'ARK_BLOCKCHAIN_&_FINTECH_INNOVATION_ETF_ARKF_HOLDINGS' },
  { fund: 'ARKX', file: 'ARK_SPACE_&_DEFENSE_INNOVATION_ETF_ARKX_HOLDINGS' },
];
const MIN_SHARE_UP = 10;   // %
const MIN_WEIGHT = 0.5;    // % des Fonds
const US = ['NASDAQ', 'NYSE', 'AMEX'];

/** Eine CSV-Zeile mit Anführungszeichen zerlegen. */
function splitCsv(line) {
  const out = []; let cur = ''; let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const num = (s) => { const v = Number(String(s ?? '').replace(/[$,%\s]/g, '')); return Number.isFinite(v) ? v : null; };

export function parseHoldings(csv) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const head = splitCsv(lines[0] ?? '').map((h) => h.trim().toLowerCase());
  const ix = (name) => head.findIndex((h) => h.startsWith(name));
  const [iDate, iFund, iCo, iTk, iSh, iW] = ['date', 'fund', 'company', 'ticker', 'shares', 'weight'].map(ix);
  if ([iDate, iTk, iSh].some((i) => i < 0)) throw new Error(`Unerwartete Spalten: ${head.join(',')}`);
  const rows = [];
  for (const l of lines.slice(1)) {
    const c = splitCsv(l);
    const ticker = String(c[iTk] ?? '').trim().toUpperCase();
    if (!/^[A-Z][A-Z.]{0,5}$/.test(ticker)) continue;          // Cash, Auslandskürzel mit Leerzeichen/Ziffern
    rows.push({ date: c[iDate]?.trim(), fund: c[iFund]?.trim(), company: c[iCo]?.trim(), ticker, shares: num(c[iSh]), weight: num(c[iW]) });
  }
  return { date: rows[0]?.date ?? null, rows };
}

/** Reine Logik: Veränderungen je Ticker über alle Fonds. */
export function diffHoldings(prev, cur) {
  const hits = new Map();
  for (const [fund, now] of Object.entries(cur)) {
    const old = prev?.[fund];
    if (!old || old.date === now.date) continue;
    for (const r of now.rows) {
      const before = old.shares?.[r.ticker];
      let kind = null; let up = null;
      if (before == null) kind = 'etf_addition';
      else if (before > 0 && r.shares != null) {
        up = (r.shares / before - 1) * 100;
        if (up >= MIN_SHARE_UP && (r.weight ?? 0) >= MIN_WEIGHT) kind = 'etf_weight_increase';
      }
      if (!kind) continue;
      const h = hits.get(r.ticker) ?? { ticker: r.ticker, company: r.company, events: [] };
      h.events.push({ fund, kind, date: now.date, shares: r.shares, weight: r.weight, share_up_pct: up != null ? Math.round(up * 10) / 10 : null });
      hits.set(r.ticker, h);
    }
  }
  return [...hits.values()];
}

async function resolveUs(tickers) {
  const backendUrl = String(process.env.DISCOVERY_BACKEND_URL ?? '').replace(/\/$/, '');
  const res = await fetch(`${backendUrl}/api/scrape-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-discovery-secret': process.env.DISCOVERY_SECRET ?? '' },
    body: JSON.stringify({
      url: 'https://scanner.tradingview.com/america/scan', method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: { symbols: { tickers: tickers.flatMap((t) => US.map((u) => `${u}:${t}`)) }, columns: ['description', 'type'] },
    }),
  });
  const w = await res.json();
  if (!w?.ok || w.status !== 200) throw new Error(`TV: ${w?.error ?? w?.status ?? res.status}`);
  const map = new Map();
  for (const r of JSON.parse(w.body).data ?? []) {
    const [ex, sym] = r.s.split(':');
    if (r.d?.[1] !== 'stock' && r.d?.[1] !== 'dr') continue;
    if (!map.has(sym)) map.set(sym, { exchange: ex, name: r.d?.[0] });
  }
  return map;
}

export async function fetchCandidates() {
  const statePath = process.env.ARK_STATE || '.ark-state/holdings.json';
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(statePath, 'utf8')).funds ?? null; } catch { /* erster Lauf */ }

  const cur = {};
  for (const f of FUNDS) {
    try {
      const res = await fetch(BASE + encodeURIComponent(f.file) + '.csv', { headers: { 'User-Agent': 'Mozilla/5.0 (DiscoveryWorkspace)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { date, rows } = parseHoldings(await res.text());
      cur[f.fund] = { date, rows };
      log('info', 'ark-holdings: fund parsed', { fund: f.fund, date, positions: rows.length, prev_date: prev?.[f.fund]?.date ?? null });
    } catch (err) {
      log('warn', 'ark-holdings: fund failed', { fund: f.fund, error: err.message });
      if (prev?.[f.fund]) cur[f.fund] = null;      // alten Stand behalten
    }
  }
  if (!Object.values(cur).some(Boolean)) throw new Error('keine ARK-Datei lesbar');

  const hits = prev ? diffHoldings(prev, Object.fromEntries(Object.entries(cur).filter(([, v]) => v))) : [];
  // Neuen Stand schreiben (nicht lesbare Fonds behalten den alten)
  const next = { ...(prev ?? {}) };
  for (const [fund, v] of Object.entries(cur)) if (v) next[fund] = { date: v.date, shares: Object.fromEntries(v.rows.map((r) => [r.ticker, r.shares])) };
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ saved_at: new Date().toISOString(), funds: next }));
  if (!prev) { log('info', 'ark-holdings: erster Lauf, nur Stand gespeichert'); return []; }
  if (!hits.length) { log('info', 'ark-holdings: keine Veränderungen'); return []; }

  const us = await resolveUs(hits.map((h) => h.ticker));
  const now = new Date().toISOString();
  const out = [];
  for (const h of hits) {
    const r = us.get(h.ticker);
    if (!r) { log('debug', 'ark-holdings: kein US-Listing', { ticker: h.ticker }); continue; }
    const exchange = r.exchange === 'NYSE ARCA' ? 'AMEX' : r.exchange;
    out.push({
      id: uuidv4(), symbol: h.ticker, exchange, yahoo_symbol: h.ticker.replace('.', '-'), isin: null, name: r.name ?? h.company,
      sources: h.events.map((e) => ({
        adapter: 'ark-holdings', source_url: `${BASE}${encodeURIComponent(FUNDS.find((f) => f.fund === e.fund).file)}.csv`,
        discovered_at: now, signal_type: e.kind, raw_signal: e,
        info_snippet: e.kind === 'etf_addition'
          ? `ARK ${e.fund}: neue Position (${e.weight ?? '?'} % Gewicht, Stand ${e.date})`
          : `ARK ${e.fund}: +${e.share_up_pct} % Stück (${e.weight ?? '?'} % Gewicht, Stand ${e.date})`,
      })),
      links: buildLinks({ exchange, symbol: h.ticker, yahooSymbol: h.ticker.replace('.', '-') }),
      workspace_state: 'new', notes: '', enrichment: null, first_discovered_at: now, last_updated_at: now,
    });
  }
  log('info', 'ark-holdings: candidates ready', { hits: hits.length, count: out.length });
  return out;
}
