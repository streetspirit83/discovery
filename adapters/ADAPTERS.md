# Discovery Adapters

Each adapter is a Node.js module that exports `fetchCandidates()` and is run by the shared `_run.js` CLI. The runner calls `fetchCandidates()`, then pushes each returned candidate to the Netlify backend via `StorageClient.appendCandidate()`.

---

## Auto-Fetch Schedule

| Adapter            | Cron              | UTC Time              | Trigger              | Status     |
|--------------------|-------------------|-----------------------|----------------------|------------|
| `openinsider`              | `0 6 * * *`       | Daily 06:00           | Schedule + manual    | ✅ Active  |
| `etf-holdings`             | `0 7 * * 1`       | Monday 07:00          | Schedule + manual    | ✅ Active  |
| `stocktwits`               | `0 8,20 * * *`    | Daily 08:00 + 20:00   | Schedule + manual    | ✅ Active  |
| `yahoo-trending`           | `0 14 * * 1-5`    | Weekdays 14:00        | Schedule + manual    | ✅ Active  |
| `tradingview-screener`     | `30 15 * * 1-5`   | Weekdays 15:30        | Schedule + manual    | ✅ Active  |
| `boerse-frankfurt`         | *(paused)*        | —                     | Manual only          | ⏸ Paused  |

Manual trigger: GitHub Actions → workflow → **Run workflow**.

---

## Dedup / Persistence Logic

`appendCandidate` on the backend:

1. Checks **archive** and **export** blobs first — if the symbol+exchange is found in either, it is **skipped** permanently (no resurrection).
2. Checks **inbox** — if found, merges sources arrays (accumulates signals from multiple runs).
3. Otherwise, adds as a new candidate.

Consequence for delete: deleting from inbox must move the candidate to **archive** (not hard-delete) so the adapter cannot re-add it on the next run. Hard delete is only safe from archive/export.

---

## Adapter: OpenInsider (Form 4 Insider Buys)

**File:** `adapters/openinsider.js`  
**Workflow:** `.github/workflows/adapter-openinsider.yml`  
**Signal type:** `insider_buy`

### Data Source

SEC EDGAR full-text search (EFTS) for Form 4 filings.  
URL: `https://efts.sec.gov/LATEST/search-index?forms=4&dateRange=custom&startdt=…`

> ⚠️ openinsider.com itself blocks cloud IPs (Azure/GitHub Actions). EDGAR is the official source and allows automated access with a `User-Agent` header.

### Method

1. **Search** EDGAR EFTS for all Form 4 filings within the last `DAYS_BACK` days, paginated in batches up to `MAX_FILINGS`.
2. **Parse** each filing XML: extract issuer ticker, issuer CIK, insider name/title, and all `nonDerivativeTransaction` blocks with `transactionCode = P` (open-market purchase) and `acquiredDisposedCode = A`.
3. **Filter** by trade value: only purchases where `shares × pricePerShare ≥ MIN_VALUE_USD`.
4. **Resolve exchange** via `data.sec.gov/submissions/CIK{n}.json` (cached per issuer CIK).
5. **Aggregate** multiple insider buys for the same ticker into a single candidate with multiple sources.

### Key Thresholds

| Parameter       | Value     | Rationale                                              |
|-----------------|-----------|--------------------------------------------------------|
| `MIN_VALUE_USD` | $500,000  | Filters noise; surfaces meaningful conviction buys     |
| `DAYS_BACK`     | 7         | Matches weekly dedup window; avoids duplicate signals  |
| `MAX_FILINGS`   | 600       | Caps run time; covers all meaningful Form 4 volume     |
| `DELAY_MS`      | 150 ms    | Stays under SEC's 10 req/sec fair-use limit            |

### Required Env Vars

| Variable                | Required | Purpose                            |
|-------------------------|----------|------------------------------------|
| `DISCOVERY_BACKEND_URL` | ✅        | Netlify backend URL                |
| `DISCOVERY_SECRET`      | ✅        | Auth header for backend            |
| `FMP_API_KEY`           | Optional | Exchange resolution (FMP API)      |
| `TWELVEDATA_API_KEY`    | Optional | Exchange resolution (Twelve Data)  |

---

## Adapter: StockTwits Trending

**File:** `adapters/stocktwits.js`  
**Workflow:** `.github/workflows/adapter-stocktwits.yml`  
**Signal type:** `social_trending`

### Data Source

StockTwits public trending API — no auth required.  
Endpoint: `GET https://api.stocktwits.com/api/2/trending/symbols.json`

> ✅ Public endpoint, no API key, no cookie/crumb flow. Cloud IPs not blocked as of 2025.

StockTwits refreshes their trending list every 15 minutes. The adapter runs 3× daily (08:23 / 13:23 / 20:23 UTC) to capture distinct pre-market, US-open and after-hours sentiment snapshots without excessive polling.

### Method

1. **Fetch** `trending/symbols.json` — returns top-30 symbols. The response carries far more than the name suggests: `rank`, `trending_score`, `exchange`, `symbol_mic`, `isin`, `cusip`, `sector`/`industry`, a `trends.summary` blurb, and a full `fundamentals` block.
2. **Filter** for standard equity tickers only — regex `/^[A-Z]{1,5}$/` removes crypto (`.X` suffix), indices, and malformed entries.
3. **Read exchange + ISIN from the payload** (`exchange`, else the MIC in `symbol_mic`). `resolveUSExchange()` (FMP → Twelve Data → static fallback → NASDAQ) is only a fallback for entries that carry neither — so a normal run makes **one** HTTP request instead of up to 31.
4. **Return** all remaining symbols as candidates. `trends.summary` — StockTwits' own explanation of *why* the symbol is trending — becomes the `info_snippet`; rank, watchlist count, trending score and CUSIP go to `raw_signal`.

> ⚠️ The **message stream** (`streams/symbol/{SYM}.json`) is not a usable sentiment source: `entities.sentiment` is `null` on virtually every message, because users rarely tag their posts. For per-symbol bull/bear numbers use `symbols/{SYM}/sentiment.json` instead — that is what the UI's `lib/stocktwits-sentiment.js` reads.

### Key Thresholds & Filters

| Parameter           | Value             | Rationale                                   |
|---------------------|-------------------|---------------------------------------------|
| Symbols fetched     | Top 30 (API max)  | Full trending list; dedup prevents bloat    |
| Equity filter       | `/^[A-Z]{1,5}$/`  | Excludes crypto `BTC.X`, indices `SPY500`   |
| Schedule            | 3× daily          | Pre-market, US-open + after-hours capture   |
| Rate limit margin   | 50 ms between     | Only on the fallback exchange lookup        |

### Signal Quality

US equity-focused. Measures **retail sentiment momentum** — not a price breakout signal. Best used as a secondary confirmation layer alongside insider buy or ETF weight data. High-volume trending stocks often correlate with near-term volatility.

### Required Env Vars

| Variable                | Required | Purpose                            |
|-------------------------|----------|------------------------------------|
| `DISCOVERY_BACKEND_URL` | ✅        | Netlify backend URL                |
| `DISCOVERY_SECRET`      | ✅        | Auth header for backend            |
| `FMP_API_KEY`           | Optional | Exchange resolution — fallback only |
| `TWELVEDATA_API_KEY`    | Optional | Exchange resolution — fallback only |

---

## Adapter: Yahoo Finance Trending

**File:** `adapters/yahoo-trending.js`  
**Workflow:** `.github/workflows/adapter-yahoo-trending.yml`  
**Signal type:** `page_view_trending`

### Data Source

Yahoo Finance trending endpoint — no auth required for the trending list.  
Endpoints: `GET https://query1.finance.yahoo.com/v1/finance/trending/{region}?count=20`

> ⚠️ Cloud IP behaviour untested. 403 is logged explicitly; no silent failure. If blocked, the Netlify scrape proxy (AWS) is a fallback option — different IP space from GitHub Actions (Azure).

### Signal Methodology

Yahoo Finance trending reflects **page-view velocity**: which stock detail pages receive significantly more visits than their rolling baseline within the current time window. This is a retail research/attention signal — distinct from StockTwits (opinion/sentiment) and insider buys (conviction buying).

- **Order is meaningful**: rank 1 = strongest page-view spike
- **Not alphabetical, not sorted by price or volume** — driven purely by user attention
- **News-sensitive**: earnings, M&A, analyst calls cause immediate spikes
- **Response fields**: `jobTimestamp` and `startInterval` define the measurement window

### Regions

| Region | Symbol format | Base ticker | Exchange |
|--------|--------------|-------------|----------|
| `US`   | `AAPL`       | as-is       | Resolved via FMP/TD/static |
| `DE`   | `SAP.DE`     | Strip `.DE` | `XETR` (hardcoded) |

### Method

1. **Fetch** `trending/{region}?count=20` for each region sequentially (1 s pause between).
2. **Parse** `finance.result[0].quotes[].symbol`.
3. **Strip suffix** for DE symbols (`SAP.DE` → `SAP`); keep full symbol as `yahoo_symbol`.
4. **Filter** symbols not matching `/^[A-Z0-9.]{1,10}$/` after stripping.
5. **Resolve exchange** for US via `resolveUSExchange()`; DE is hardcoded to `XETR`.
6. Store `rank` and `region` in `raw_signal`. Name field left as ticker (no name in response); AI enrichment fills it in.

### Key Thresholds & Filters

| Parameter       | Value              | Rationale                                     |
|-----------------|--------------------|-----------------------------------------------|
| Count requested | 20                 | API default is 5; 20 covers meaningful signal |
| Regions         | US, DE             | JP/KR use numeric codes incompatible with pipeline |
| Schedule        | Weekdays 14:00 UTC | Mid-session for both US (10:00 ET) and EU markets |
| Ticker filter   | `/^[A-Z0-9.]{1,10}$/` | Rejects malformed entries post-stripping   |

### Required Env Vars

| Variable                | Required | Purpose                            |
|-------------------------|----------|------------------------------------|
| `DISCOVERY_BACKEND_URL` | ✅        | Netlify backend URL                |
| `DISCOVERY_SECRET`      | ✅        | Auth header for backend            |
| `FMP_API_KEY`           | Optional | US exchange resolution (primary)   |
| `TWELVEDATA_API_KEY`    | Optional | US exchange resolution (fallback)  |

---

## Adapter: ETF Holdings (iShares Global Clean Energy)

**File:** `adapters/etf-holdings.js`  
**Workflow:** `.github/workflows/adapter-etf-holdings.yml`  
**Signal type:** `etf_addition`  
**ETF:** iShares Global Clean Energy (ICLN), CIK `1100663`

### Data Source

SEC EDGAR NPORT-P filings — mandatory monthly portfolio disclosure for all US-registered investment funds.  
EFTS search: `https://efts.sec.gov/LATEST/search-index?q=%22iShares+Global+Clean+Energy%22&forms=NPORT-P`

> ⚠️ ishares.com itself blocks cloud IPs. EDGAR is the authoritative free source.  
> Only quarter-end filings are publicly available (~60-day lag from period end).

### Method

1. **Find filing** — EFTS search for NPORT-P filings mentioning "iShares Global Clean Energy" within the last 400 days. Filter results to registrants whose `display_names` contain "iShares". Sort by `file_date` descending, take the newest.
   - Retries up to 4× with exponential backoff (EFTS returns transient 500s).
2. **Resolve XML** — Fetch the filing's `index.json` to locate the actual `.xml` data file (the EFTS `_id` points to a `.htm` viewer, not the data file).
3. **Parse holdings** — Regex-walk `<invstOrSec>` blocks in the NPORT-P XML (namespace-aware: tags may appear as `<n-4:invstOrSec>` etc.).
4. **Filter** per block:
   - `assetCat = EC` (equity) only
   - `pctVal × 100 ≥ MIN_WEIGHT_PCT` (minimum portfolio weight)
   - `invCountry` must be in `ALLOWED_COUNTRIES` (US + European only; Asia-Pacific, LatAm etc. are skipped)
5. **Resolve tickers** — XML may omit `<ticker>`; if missing, calls `resolveISINsToTickers()`:
   - **Primary:** Twelve Data `/stocks?isin=X` (requires `TWELVEDATA_API_KEY`) — returns `symbol + mic_code` directly.
   - **Fallback:** OpenFIGI `/v3/mapping` with `idType=ID_ISIN` — free, no key, batched 10/request.
   - Holdings with no resolvable ticker are **skipped**.
6. **Resolve exchange** — Uses OpenFIGI/TD result when available; otherwise maps `invCountry` via `COUNTRY_EXCHANGE` table; US tickers fall back to `resolveUSExchange()` (FMP → Twelve Data → static).

### Key Thresholds & Filters

| Parameter         | Value  | Rationale                                              |
|-------------------|--------|--------------------------------------------------------|
| `MIN_WEIGHT_PCT`  | 0.3 %  | Captures most meaningful holdings; excludes fringe     |
| `ALLOWED_COUNTRIES` | US + 18 EU codes | TD/FIGI reliable for these markets; skip Asia-Pac |
| EDGAR lookback    | 400 d  | Covers multiple quarterly filing cycles                |
| EFTS retries      | 4×     | Guards against transient 500s from EFTS                |
| Inter-call sleep  | 200 ms | Polite rate for EDGAR; 30 ms between exchange lookups  |

### Allowed Country Codes

```
US  DE  GB  FR  IT  ES  NL  BE  CH  AT
DK  SE  NO  FI  PT  IE  LU  GR  PL
```

### Required Env Vars

| Variable                | Required | Purpose                                        |
|-------------------------|----------|------------------------------------------------|
| `DISCOVERY_BACKEND_URL` | ✅        | Netlify backend URL                            |
| `DISCOVERY_SECRET`      | ✅        | Auth header for backend                        |
| `TWELVEDATA_API_KEY`    | Optional | ISIN→ticker via TD (primary); exchange resolve |
| `FMP_API_KEY`           | Optional | Exchange resolution fallback for US tickers    |

---

## Adapter: TradingView Screener

**File:** `adapters/tradingview-screener.js`  
**Workflow:** `.github/workflows/adapter-tradingview-screener.yml`  
**Signal type:** `volume_spike`

### Data Source

TradingView unofficial scanner API — no auth required.  
Endpoints:
- `POST https://scanner.tradingview.com/america/scan` (US)
- `POST https://scanner.tradingview.com/germany/scan` (DE/XETR)

> ⚠️ Cloud IP behaviour: TradingView blocks GitHub Actions (Azure IPs). All requests route through the Netlify scrape-proxy (AWS IPs). No crumb/cookie flow required — the scanner accepts plain POST with JSON filter body.

### Signal Methodology

#### Option A – Volume Spike (active)

Stocks trading at **≥ 2.5× their 10-day average volume** during the session. Results sorted by relative volume descending.

Signal quality: early detection of institutional or retail attention before price reacts. Complements insider-buy (conviction) and trending (attention) signals with a technical volume dimension.

#### Option B – Technical Momentum (planned)

RSI(14) > 60, close > EMA(50), MACD > signal line. Not yet active — add as a second entry in the `SCREENS` array in `tradingview-screener.js`.

### Screen Structure

Screens are defined as entries in the `SCREENS` array. Each has:

| Field         | Purpose                                             |
|---------------|-----------------------------------------------------|
| `id`          | Unique identifier (used in logs + `raw_signal`)    |
| `label`       | Human-readable label for `info_snippet`            |
| `endpoint`    | Scanner URL (`america`, `germany`, etc.)           |
| `region`      | `US` / `DE` — for logging                         |
| `count`       | Max results to request                             |
| `filter`      | TradingView filter array (left/operation/right)    |
| `signal_type` | Stored in `sources[].signal_type`                  |

### Exchange Parsing

Exchange is read directly from the `s` field prefix (`NASDAQ:AAPL` → `NASDAQ`). No ISIN lookup, no secondary API call. Unknown prefixes (FWB, SWB) are skipped.

### Key Thresholds & Filters

| Parameter            | US                        | DE          | Rationale                                      |
|----------------------|---------------------------|-------------|------------------------------------------------|
| Relative volume min  | 2.5×                      | 2.5×        | Meaningful spike above baseline                |
| Volume min           | 500,000                   | 50,000      | Liquidity floor; DE markets are thinner        |
| Min price            | $5                        | —           | Excludes US penny stocks                       |
| Stock types included | `common`, `foreign-issuer`| all stocks  | Excludes ETFs/funds (`type = fund` filtered out)|
| Max results          | 50                        | 30          | Covers all meaningful spike candidates         |
| Schedule             | Weekdays 15:30 UTC        | same        | Mid-US-session (11:30 ET); EU near close       |

### Required Env Vars

| Variable                | Required | Purpose                  |
|-------------------------|----------|--------------------------|
| `DISCOVERY_BACKEND_URL` | ✅        | Netlify backend URL      |
| `DISCOVERY_SECRET`      | ✅        | Auth for proxy + storage |

---

## Adapter: Börse Frankfurt (DAX Momentum) ⏸ Paused

**File:** `adapters/boerse-frankfurt.js`  
**Workflow:** `.github/workflows/adapter-boerse-frankfurt.yml`  
**Signal type:** `trend_indicator`

### Status: Paused

The original `api.boerse-frankfurt.de` API blocks cloud IPs (Azure). Twelve Data was evaluated as a replacement but **European exchanges are not available on the free plan** (403: "symbol not available with your plan"). The workflow schedule has been removed; only `workflow_dispatch` remains.

Re-enable when a suitable free, cloud-accessible source for European exchange data is confirmed (e.g. stooq.com — untested from cloud, no rate-limit docs).

### Method (when active)

1. Fetch 7-day daily OHLCV for 8 blue-chip DAX tickers from Twelve Data `/time_series?mic_code=XETR`.
2. Calculate 7-day momentum: `(latest_close / oldest_close) − 1`.
3. Return tickers with positive momentum, ranked by momentum descending.

### Key Thresholds

| Parameter   | Value                                    | Rationale                              |
|-------------|------------------------------------------|----------------------------------------|
| `TICKERS`   | SAP SIE ALV BMW MUV2 RWE DTE DBK (8)   | One batch = free-tier per-minute limit |
| `DAYS_BACK` | 7                                        | Short-term momentum signal             |
| Filter      | `momentum > 0`                           | Only upward movers                     |

### Required Env Vars

| Variable                | Required | Purpose                   |
|-------------------------|----------|---------------------------|
| `DISCOVERY_BACKEND_URL` | ✅        | Netlify backend URL       |
| `DISCOVERY_SECRET`      | ✅        | Auth header for backend   |
| `TWELVEDATA_API_KEY`    | ✅        | Time-series data (paused) |

---

## Shared Infrastructure

### `_run.js` — Adapter Runner

Entry point for all adapters. Loads the adapter module, calls `fetchCandidates()`, then pushes all results to the backend in a single `appendCandidates()` call. Outputs a structured JSON log per line (level, msg, ts, data).

> **Why bulk?** The old per-candidate approach sent one HTTP request per ticker, each doing a separate read→modify→write on the inbox blob. With Netlify Blob Storage's eventual consistency, later reads could return stale data before the previous write propagated, causing writes to overwrite each other. `appendCandidates` reads all blobs once, processes everything in memory, then writes once — fully atomic.

Exit codes: `0` = success, `1` = any error (missing env, adapter load failure, backend errors).

Final log line summary:
```json
{ "level":"info", "msg":"adapter: complete", "total":42, "added":5, "merged":3, "skipped":34, "errors":0 }
```

### `_shared/storage-client.js`

HTTP client for the Netlify backend. Reads env vars `DISCOVERY_BACKEND_URL` and `DISCOVERY_SECRET`.

| Method                                          | Backend op             |
|-------------------------------------------------|------------------------|
| `appendCandidates(candidates[])`                | `append_candidates`    |
| `appendCandidate(candidate)`                    | `append_candidate`     |
| `readBlob(blobType)`                            | `read`                 |
| `writeBlob(blobType, blob)`                     | `write`                |
| `updateCandidate(blobType, id, updates)`        | `update_candidate`     |
| `moveCandidate(id, fromBlob, toBlob)`           | `move_candidate`       |
| `deleteCandidate(blobType, id)`                 | `delete_candidate`     |

### `_shared/isin-to-ticker.js`

Resolves a list of ISINs to `{ ticker, exchange }` objects.

- **Primary:** Twelve Data `/stocks?isin=X` (200 ms between calls)
- **Fallback:** OpenFIGI `/v3/mapping`, 10 ISINs/batch, 6.5 s between batches (10 req/min limit without API key)
- In-memory cache per run; unresolvable ISINs cached as `null` to avoid retries

### `_shared/us-exchange-resolver.js`

Resolves US ticker → `NASDAQ | NYSE | AMEX`.  
Priority: FMP API (`FMP_API_KEY`) → Twelve Data (`TWELVEDATA_API_KEY`) → static known-ticker map → default `NASDAQ`.

### `_shared/isin-resolver.js`

Resolves ticker+exchange → ISIN (direction opposite to `isin-to-ticker`).  
Static map for common US/DE tickers; OpenFIGI fallback (currently best-effort only).

### `_shared/link-builder.js`

Builds TradingView, Yahoo Finance, and Stocktwits links from `{ exchange, symbol, yahooSymbol }`.

---

## Deployment

**Netlify site:** `screener-discovery.netlify.app`

### Public export endpoint (merkliste integration)

```
GET https://screener-discovery.netlify.app/.netlify/functions/discovery-export
```

- No auth — publicly readable, merkliste proxy fetches server-side
- Returns the `discovery-export` blob as `{ candidates: [...] }` with `Cache-Control: no-store`
- Set as `DISCOVERY_EXPORT_URL` on the merkliste Netlify project

### Authenticated storage API

```
POST https://screener-discovery.netlify.app/api/storage
```

Requires header `x-discovery-secret`. Used by adapters (`DISCOVERY_BACKEND_URL` + `DISCOVERY_SECRET` env vars) and the UI.

---

## Adding a New Adapter

1. Create `adapters/<name>.js` exporting `async function fetchCandidates(): Promise<Candidate[]>`.
2. Register the name in `adapters/_run.js` → `ADAPTERS` map.
3. Create `.github/workflows/adapter-<name>.yml` using the existing workflows as template.
4. Document thresholds and data source in this file.

The `Candidate` shape is defined in `ui/lib/schema.js`.
