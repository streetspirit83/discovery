# Discovery Workspace – Claude Code Notes

## Interaktion: keine wiederholten Rückfrage-Modals (bindend, gilt in ALLEN Chats)

Das Rückfrage-Modal (`AskUserQuestion` / Multiple-Choice-Popup) ist die absolute
Ausnahme, nicht der Normalfall. Regeln:

1. **Nie zweimal dasselbe fragen.** Was in dieser Session (oder in einer der
   Anweisungen oben) schon beantwortet wurde, gilt als beantwortet – auch wenn
   die Antwort weit oben im Verlauf steht, sinngemäß statt wörtlich gegeben
   wurde, oder der Kontext zwischendurch zusammengefasst wurde. Erst im Verlauf
   nachsehen, dann erst fragen. Eine Rückfrage darf **nie** wiederholt werden,
   nur weil die Aufgabe erneut aufgerufen wird.
2. **Kein Modal für Dinge, die im Code stehen.** Dateipfade, Feldnamen, Versionen,
   bestehende Konventionen: selbst nachlesen (`ui/STYLEGUIDE.md`, `docs/`, der
   Code) statt fragen.
3. **Kein Modal für Standardentscheidungen.** Bei mehreren vertretbaren Varianten
   die naheliegendste wählen, sie in einem Satz im Chat benennen und weiterbauen.
   Annahmen dokumentieren schlägt nachfragen.
4. **Kein Modal zur Bestätigung.** „Soll ich loslegen?", „Passt der Plan?",
   „Fertig, oder noch etwas?" – nie als Modal. Einfach machen bzw. als normalen
   Text schreiben.
5. **Wenn wirklich etwas fehlt:** als normale Chat-Frage am Ende der Antwort
   stellen – und vorher alles erledigen, was nicht von der Antwort abhängt.
   Blockierend fragen nur, wenn jede Annahme die Arbeit unbrauchbar oder
   gefährlich machen würde (z. B. Daten löschen, Geld/Credits ausgeben).
6. **Höchstens ein Modal pro Auftrag**, und nur für den in (5) beschriebenen Fall.
   Bei UI-Arbeit gilt weiterhin: Vorschlag/Plan als Text im Chat abstimmen, nicht
   als Popup.

## Project Overview
Stock/ETF candidate discovery tool. Scrapes signals from multiple sources (insider buying, trend lists, ETF changes), stores them in Netlify Blob Storage, and provides a UI for review + AI enrichment.

## Architecture
- **adapters/**: Node.js 20 scrapers that push candidates to the backend
- **netlify-backend/**: Netlify serverless functions for storage + scrape proxy
- **ui/**: Plain HTML/CSS/ES Modules frontend (no build step)
- **data/**: Example data files

## Running Adapters
```bash
npm ci
node adapters/_run.js openinsider
node adapters/_run.js boerse-frankfurt
node adapters/_run.js etf-holdings
```

Requires env vars: `DISCOVERY_BACKEND_URL`, `DISCOVERY_SECRET`
Optional: `FMP_API_KEY`, `TWELVEDATA_API_KEY` (for US exchange resolution)

## UI Development
Open `ui/index.html` directly in a browser – no build step needed.
Works with mock data without any backend.
Settings → configure backend URL, secret, and Claude API key for full functionality.

**Before any UI change, read [`ui/STYLEGUIDE.md`](ui/STYLEGUIDE.md)** – the binding
design rules (design tokens, Lucide-only icons via `ui/lib/icons.js`, icon-only
links, stacked stat-blocks with a smaller second line, single-row panels). UI
changes are agreed as a visual/plan in chat first, then built.

### Cache-busting is a hard rule (`?v=YYYYMMDDx`)
There is no bundler, so ES-module imports are cached by URL. **Whenever you change
a JS/CSS file, bump its `?v=` query string in every place that imports it, and
cascade up:** if you edit a file's import specifier, that file's *own* content
changed too, so bump its version wherever it is imported — all the way up to the
`app.js` and `styles.css` tags in `ui/index.html`. Miss this and the browser
serves stale modules (data won't load, view switches break, etc.). Use a dated
tag like `20260627j`; keep it consistent across a single change set.

## Key Design Decisions
- All storage goes through Netlify Blobs (4 blobs: inbox, archive, export, watch)
- Dedup by symbol+exchange: inbox merges sources, archive/export skips
- AI enrichment calls Anthropic API directly from browser (requires CORS header `anthropic-dangerous-direct-browser-access: true`)
- No TypeScript, no React, no bundler – intentional simplicity

## Blob Types
- **inbox**: Active candidates being reviewed
- **archive**: Dismissed candidates (kept for dedup)
- **export**: Promoted candidates ready for action
- **watch**: Promoted/exported candidates kept for ongoing benchmarking

## Workspace States
`new` → `reviewed` → `promoted` | `dismissed`

## Code Map (ui/)
Entry point `ui/app.js` (shell, state, bot-nav, modals wiring). Then:

**components/** (UI):
- `candidate-list.js` – the main table; 5 views (Standard / Performance / Price /
  Metrics / Fundamental), sorting, filters, column resize, bulk actions, currency
  toggle. Largest file; header and cell order per view must stay in sync — die
  Standard-Ansicht rendert Kopf und Zellen an zwei getrennten Stellen, ein
  Versatz fällt sonst nicht auf. In der Trade-Ansicht stehen die drei „wohin
  könnte es gehen"-Werte nebeneinander: **Target** (eigenes Cluster-Ziel) ·
  **PTØ** (Analysten-Konsens, TV) · **Fair** (Reverse-DCF). Alle drei sortieren
  nach dem Potenzial, nicht nach dem angezeigten Preis. In der Standard-Ansicht
  zeigt „10T" (nach PerfW) den LS-Verlauf der letzten zehn Tage als Sparkline —
  aus den Nacht-Snapshots plus Live-Kurs, sortiert nach dem Zuwachs über das
  Fenster (`ls10Series` in `spark.js`).
- `candidate-detail.js` – per-candidate detail sheet (TV data, links, notes,
  AI-enrichment, range viz). Swipe-to-dismiss; reopens the modal it came from.
  Tab „Trend" erklärt die Bias-Grafik (drei Ebenen, Ring-Legende) und zeigt mit
  geladener TD-Historie Bias-Verlauf, Regime-Statistik und Fragilität.
  Tab „Prog." (Forecast) zeigt zusätzlich das Analysten-Konsensziel als
  gestrichelten Verlauf mit Fächer (Spalte „PTØ" in der Trade-Ansicht neben „Target")
  und projiziert 6 Monate: 3 Monate echte Kerzen + drei
  gestrichelte Szenarien (Breakout/Status Quo/Breakdown) mit Fächer-Fläche, ATH
  und Fair Value als Linien — Rechnung in `tv-forecast.js`, Spec in
  `docs/FORECAST_SPEC.md`.
- `alert-modal.js` – alert triage overview (opened from the Home/🔔 nav slot;
  it replaced the former Intra-Day modal). `intraday-modal.js` still exists but is
  **no longer imported** (dead code).
- `trigger-modal.js` – per-symbol alert editor (price / MA / indicator presets).
- `nachkauf-modal.js` – Nachkauf/Teilverkauf calculator for ★ portfolio tickers
  (Standard view row action). Pure calculator, EUR only — it reads `mk_entry` /
  `mk_shares` (merkliste) + the LS quote and persists nothing.
  Die Toolbar trägt neben den Icon-Links einen **✨-Knopf**, der
  `ai-prompt-modal.js` öffnet: vier einzeln kopierbare englische Recherche-
  Prompts (Moat & Wettbewerb · Red Flags inkl. Short-Seller · Insider ·
  News/Katalysatoren mit 3-Monats-Ausblick), gebaut von `stockPrompts` in
  `research-prompt.js`. Alle vier teilen Kopf (neutral evidence researcher,
  Quelle + Datum) und Formatregeln (kurze Bullets, Fettung sparsam,
  Signal-Marker 🔴🟢🟡⚪, Abschlusszeile „⚠ Watch"). Ein im Bearbeiten-Menü
  hinterlegter Text (`candidate.research_prompt`) kommt als zusätzliche erste
  Karte dazu — er ersetzt die vier nicht.
- `ai-prompt-modal.js` – die vier Recherche-Prompts eines Titels zum Kopieren
  (reiner Kopier-Dialog, ruft nichts ab und speichert nichts).
- `screener-modal.js`, `dashboard-modal.js`, `markets-modal.js`,
  `settings-modal.js`, `upload-modal.js`, `export-modal.js`.

**lib/** (logic, all pure/browser):
- Data: `tv-enrichment.js` (TV scanner bulk fetch + FX + indices),
  `ls-intraday.js` (Lang & Schwarz quotes), `tr-check.js` (TR tradability),
  `stocktwits-sentiment.js` (Retail-Bull/Bear-Tagesreihe, on demand im Trend-Tab),
  `analyst-targets.js` (Analysten-Kursziele: TV aus `tv_data`, Yahoo **als Teil
  der TV-Anreicherung** über `/api/yahoo-analyst` — in Wellen von 6, nur für
  Titel, deren `yh_targets` älter als 12 h sind, Ergebnis wird im Blob
  persistiert; auch eine Fehlanzeige trägt einen Zeitstempel),
  `symbol-search.js`, `exchange-map.js` (`normalizeExchange`), `storage-client.js`.
- Bars/Swings: `tv-swings.js` holt die Tages-OHLC — **US → TwelveData, alles
  andere → Yahoo über die scrape-proxy** — und rechnet Zonen/Struktur/ATR daraus.
  Die Analyse liegt in der **nativen Währung der Bars**; `analysis.currency` sagt
  welche, und die Anzeige rechnet über `barsDisplayFactor()` um. Nichts darf hier
  USD annehmen (alte, vor dem Umbau gespeicherte Analysen haben kein `currency`
  und sind per Definition USD/TwelveData). Persistiert werden die letzten 180
  Bars (`analysis.ohlc`) **plus** `analysis.sma` — die SMA-Kurven 20/50/100/200
  zum selben Raster, aber aus den vollen ~500 Bars gerechnet (`smaTail`). Ohne
  diesen Vorlauf liesse sich aus 180 Bars nie eine SMA200 zeichnen; der 1J-Chart
  im Perf-Tab zeichnet sie als Kurven, nicht als waagerechte Momentwerte.
- Scoring/signals: `tv-sentiment.js` (gerichtetes Bias −100…+100 + Trendalter +
  `biasRingSVG` — die Ring-Grafik liegt dort, damit Tabelle und Detail-Sheet
  garantiert dieselbe zeigen; die anderen Scores sind ungerichtete
  Qualitätsmaße 0–100 und dürfen dafür NICHT gemittelt werden),
  `tv-bias-history.js` (rechnet das Bias aus TD-Tagesbars für jeden vergangenen
  Tag nach → gemessenes Trendalter, Regime-Statistik, Divergenzen; braucht
  WARMUP=260 Bars Vorlauf, deshalb holt `fetchSwingAnalysis` 500 und
  persistiert nur die kompakte Serie), `tv-overall-score.js`, `tv-entry-score.js`, `tv-health-score.js`,
  `tv-cycle-score.js`, `tv-trend-score.js`, `tv-trend-strength-score.js`,
  `tv-momentum-check.js`, `tv-upside.js`, `tv-entry-prices.js`,
  `tv-forecast.js` (6-Monats-Szenarien für den Prog.-Tab: Drift + σ√t, an
  Resistance/Support gebremst, ATH/52W-Tief als harte Grenzen — währungsfrei,
  alle Preise kommen in EINER Währung herein).
- Screener: `tv-fields.js`, `tv-screener.js`, `screener-presets.js`.
- Viz/metrics: `price-viz.js` (range ladder), `spark.js`, `dashboard-metrics.js`,
  `alerts.js` (alert model + evaluation).
- Misc: `research-prompt.js`, `link-builder.js`, `import-parser.js`,
  `merkliste-import.js`/`merkliste-export.js`, `schema.js`, `icons.js`.

## Data Sources & External APIs
Browsers can't call these directly (CORS) → **everything goes through the
`scrape-proxy` Netlify function**. To add a host, add a regex to `ALLOWED_DOMAINS`
in `netlify-backend/netlify/functions/scrape-proxy.js` and POST
`{ url, method, headers, body }` to `/api/scrape-proxy`.

- **TradingView scanner** (`scanner.tradingview.com/{market}/scan`): bulk
  enrichment, screener, EUR/USD rate, and the DAX/NASDAQ/NIKKEI/VIX indices.
  Liefert auch **Analysten-Kursziele**: `price_target_average/high/low/median`
  plus `recommendation_total/buy/hold/sell` — für US- **und** XETR-Titel, ETFs
  ausgenommen, in der Währung des Instruments. Zwei gemessene Eigenheiten:
  unbekannte Spalten quittiert der Scanner mit **HTTP 200 und `null`** statt mit
  einem Fehler (Existenz beweist nur ein Wert ≠ null über mehrere Titel), und
  **Datum und Anzahl der Kursziel-Schätzungen gibt es nicht**
  (`price_target_date`, `price_target_estimates_num` und vier weitere
  Namensvarianten: immer null).
  **Field discipline:** in `tv-enrichment.js` the `TV_COLUMNS` array and the `COL`
  index-map must stay in matching order — a new field means adding it to *both*
  (same position) and mapping it in `buildUpdates()`.
- **Lang & Schwarz** (`www.ls-tc.de`, the Trade-Republic venue): live **EUR**
  intraday quotes. Bulk-Abrufe (LS-Kurse, TR-Check) laufen in Wellen von
  `NET_BATCH` (6) parallel, nicht nacheinander — sequenziell kostete ein Lauf
  über 30 Titel rund 12 s. Die **Instrument-ID wird wiederverwendet**
  (`tr_check.ls_id` oder `ls_quote.instrument_id`); ohne sie zahlt jeder Titel
  eine zusätzliche ISIN-Suche, also die doppelte Anzahl Proxy-Runden. Search: `/_rpc/json/.lstc/instrument/search/main` (WITH
  `.lstc`); chart: `/_rpc/json/instrument/chart/dataForInstrument` (NO `.lstc`,
  `series=intraday`|`history`). Any non-default UA works (`Mozilla/5.0`). Returns
  `[ts, price]` only — no OHLC, no volume. It is NOT IP-blocked; earlier 403/502s
  were wrong paths.
- **StockTwits** (`api.stocktwits.com/api/2/`): public, no key.
  `symbols/{SYM}/sentiment.json` returns a ~60-day daily bull/bear series in
  percent — this is the only usable sentiment source. The **message stream**
  (`streams/symbol/{SYM}.json`) is **not**: `entities.sentiment` is `null` on
  virtually every message because users rarely tag posts. `trending/symbols.json`
  also carries `exchange`, `symbol_mic`, `isin`, `cusip` and a `trends.summary`
  blurb, so the adapter needs no external exchange lookup.
- **TwelveData** (`api.twelvedata.com`): `time_series` gives OHLC + volume, but is
  **US-only on the free tier** (≈8 req/min, 800 credits/day). Key in localStorage
  `discovery_twelvedata_key`; the public `demo` key only serves AAPL. Verified
  against a live call: a non-US symbol answers `404 "available starting with the
  Grow or Venture plan"` — there is no free workaround.
- **Yahoo quoteSummary** (`/v10/finance/quoteSummary/{SYM}?modules=financialData`):
  Analysten-Kursziele als **Fallback**, wenn TV für einen Titel keins hat — als
  Einzige mit `numberOfAnalystOpinions`. Verlangt **Cookie + Crumb**
  (`fc.yahoo.com` → `/v1/test/getcrumb`); ohne beides kommt `401 Invalid Crumb`,
  gemessen für US- wie Nicht-US-Titel und mit mehreren User-Agents. Läuft
  deshalb **nicht** über die scrape-proxy (die reicht nur den Body durch, kein
  `Set-Cookie`), sondern über die eigene Funktion
  `netlify/functions/yahoo-analyst.js`, die den Dreischritt serverseitig macht
  und den Crumb 30 min cacht. Kursziele stehen in `financialCurrency`.
- **Yahoo chart v8** (`query1.finance.yahoo.com/v8/finance/chart/{SYM}`): the
  free OHLC source for **non-US** titles (`range=2y` ≈ 507 daily bars, enough for
  swing zones AND the bias-history WARMUP). No key, no quota. Two hard rules:
  send the full browser headers (`Origin`/`Referer` on finance.yahoo.com) or
  Yahoo answers **429**; and the `quote` arrays carry `null` holes on holidays —
  `Number(null)` is `0`, so filter them *before* any numeric coercion or you get
  phantom price-0 zones. Symbol needs the exchange suffix (`SAP.DE`), which the
  adapters already store as `yahoo_symbol`.

## Frontend Conventions
- **LS = EUR:** Lang & Schwarz quotes are always EUR (the price you'd pay on TR).
  The Price/Standard views convert via the USD/EUR toggle (`convFactor` /
  `convFromEur` in `candidate-list.js`); only USD↔EUR is convertible — other
  currencies stay native (shown in the "Wä" column). Live EUR/USD comes from the
  TV forex scanner (cached in localStorage), with a manual fallback in Settings.
- **TR tradability:** `tr-check.js` checks Trade-Republic via LS ISIN search
  (green = listed on LS ⇒ very likely on TR). The TR cell copies the ISIN to the
  clipboard for pasting into the TR app.
- **Exchange codes:** normalise every exchange through
  `exchange-map.js` `normalizeExchange()` (German regional venues → XETR). Single
  source of truth — don't hand-map exchanges elsewhere.

## Specs (docs/)
Deeper specs live in `docs/` — read the relevant one before (re)implementing a
score/signal: the TV scoring specs (`tvtrend*`, `tvfinancialhealth*`,
`tventryprices*`), and the newer feature handovers
(`SWING_CHECK_HANDOVER.md`, `BREAKOUT_PROBABILITY_SPEC.md`,
`BREAKDOWN_PROBABILITY_SPEC.md`, `FORECAST_SPEC.md`). `discovery-workspace-spec.md` has the original
product spec.

## GitHub Actions
- Adapters run on schedule (daily at 6 AM UTC)
- UI deploys to GitHub Pages on push to main

## Netlify Setup
Deploy `netlify-backend/` directory. Set environment variables:
- `DISCOVERY_SECRET` – shared secret for API auth

## Development Gotchas

### Netlify deploys cost credits — batch changes
Never deploy speculatively. Diagnose locally first, then merge all Netlify-touching changes into one commit before pushing. Every push to `netlify-backend/` or `netlify.toml` that triggers a deploy burns a credit.

### Netlify Functions v2 sharp edges
- Return `new Response(body, { status, headers })` — not `{ statusCode, headers, body }` (that's v1 format)
- A `204` response **must** have a null body; sending any body causes Netlify's CDN to strip response headers (including CORS). Use `200` with a null body for OPTIONS preflights.
- Set CORS headers in **both** the function response and `netlify.toml` `[[headers]]` — one covers direct function invocations, the other covers CDN edge routing.
- `[[headers]]` `for` patterns must match the actual request path. `/.netlify/functions/*` and `/api/*` are different paths; add both if you alias functions.

### Cloud environments get blocked by consumer-facing websites
GitHub Actions (Azure) and Netlify Functions (AWS) are on well-known cloud IP ranges. Consumer sites often block them. Before writing any scraper, verify the target allows automated access from cloud IPs — or find an official API / primary-source feed that does.

### Inspect real API responses before writing parsing logic
Never assume field names, nesting depth, or data formats. Fetch one live response, log it verbatim, and read it before writing any parser. Wrong assumptions compound: each fix that's based on another guess adds another debug cycle.

### CI cache optimizations aren't always worth it
Optional CI caches (`cache: 'npm'`) fail when lock files are missing or in unexpected paths. If the cache isn't already working, remove it — the time saved rarely justifies the debugging overhead for infrequent scheduled jobs.

### CI workflow viewers show the YAML at run-trigger-time
When a GitHub Actions run shows an outdated workflow definition, that's expected — the UI shows the YAML as it was when the run was triggered, not the current file. Verify the current branch has your changes and wait for a new run.

### No paid API plans — ever
Never propose or implement adapters that require a paid subscription or API key purchase. Only use free tiers (no credit card), public/unauthenticated endpoints, or official free developer APIs. If a data source requires payment, find an alternative primary source that exposes the same underlying data for free.

### Diagnose before you assume it's a bug
Unexpected behaviour (e.g. an item "disappearing" after an action) is often intended behaviour with a missing UX affordance (a toast, a redirect, a drawer close). Check the intended flow first before writing fix code.

## Git Workflow

### Always promote finished work to `main` yourself — don't ask
The user has given standing permission to push to `main`. When a unit of work is complete and verified, promote it without asking. Full sequence each time:
1. Commit on the feature branch (`claude/<...>`).
2. Push the feature branch.
3. Merge the feature branch into `main` (resolve conflicts; verify the merge didn't silently drop changes — a parallel `main` once dropped a column + a function that were re-added in the same region).
4. Push `main`.
5. Fast-forward the feature branch back to `main` so the next round starts clean.

Pushing to `main` triggers both deploys (GitHub Pages UI + Netlify backend), so batch Netlify-touching changes first (see "Netlify deploys cost credits").
