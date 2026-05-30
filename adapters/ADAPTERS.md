# Discovery Adapters

Each adapter is a Node.js module that exports `fetchCandidates()` and is run by the shared `_run.js` CLI. The runner calls `fetchCandidates()`, then pushes each returned candidate to the Netlify backend via `StorageClient.appendCandidate()`.

---

## Auto-Fetch Schedule

| Adapter            | Cron              | UTC Time              | Trigger              | Status     |
|--------------------|-------------------|-----------------------|----------------------|------------|
| `openinsider`      | `0 6 * * *`       | Daily 06:00           | Schedule + manual    | ✅ Active  |
| `etf-holdings`     | `0 7 * * 1`       | Monday 07:00          | Schedule + manual    | ✅ Active  |
| `stocktwits`       | `0 8,20 * * *`    | Daily 08:00 + 20:00   | Schedule + manual    | ✅ Active  |
| `boerse-frankfurt` | *(paused)*        | —                     | Manual only          | ⏸ Paused  |

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

StockTwits refreshes their trending list every 15 minutes. The adapter runs twice daily to capture distinct pre-market (08:00 UTC) and after-hours (20:00 UTC) sentiment snapshots without excessive polling.

### Method

1. **Fetch** `trending/symbols.json` — returns top-30 symbols with `id`, `symbol`, `title`, `watchlist_count`.
2. **Filter** for standard equity tickers only — regex `/^[A-Z]{1,5}$/` removes crypto (`.X` suffix), indices, and malformed entries.
3. **Resolve exchange** via `resolveUSExchange()` (FMP → Twelve Data → static fallback → NASDAQ).
4. **Return** all remaining symbols as candidates; rank and watchlist count stored in `raw_signal` for downstream weighting.

### Key Thresholds & Filters

| Parameter           | Value             | Rationale                                   |
|---------------------|-------------------|---------------------------------------------|
| Symbols fetched     | Top 30 (API max)  | Full trending list; dedup prevents bloat    |
| Equity filter       | `/^[A-Z]{1,5}$/`  | Excludes crypto `BTC.X`, indices `SPY500`   |
| Schedule            | 2× daily          | Pre-market + after-hours sentiment capture  |
| Rate limit margin   | 50 ms between     | API allows ~60 req/min; one req per run     |

### Signal Quality

US equity-focused. Measures **retail sentiment momentum** — not a price breakout signal. Best used as a secondary confirmation layer alongside insider buy or ETF weight data. High-volume trending stocks often correlate with near-term volatility.

### Required Env Vars

| Variable                | Required | Purpose                            |
|-------------------------|----------|------------------------------------|
| `DISCOVERY_BACKEND_URL` | ✅        | Netlify backend URL                |
| `DISCOVERY_SECRET`      | ✅        | Auth header for backend            |
| `FMP_API_KEY`           | Optional | Exchange resolution (primary)      |
| `TWELVEDATA_API_KEY`    | Optional | Exchange resolution (fallback)     |

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

Entry point for all adapters. Loads the adapter module, calls `fetchCandidates()`, then pushes each result to the backend via `appendCandidate()`. Outputs a structured JSON log per line (level, msg, ts, data).

Exit codes: `0` = success, `1` = any error (missing env, adapter load failure, backend errors).

Final log line summary:
```json
{ "level":"info", "msg":"adapter: complete", "total":42, "added":5, "merged":3, "skipped":34, "errors":0 }
```

### `_shared/storage-client.js`

HTTP client for the Netlify backend. Reads env vars `DISCOVERY_BACKEND_URL` and `DISCOVERY_SECRET`.

| Method                                          | Backend op          |
|-------------------------------------------------|---------------------|
| `appendCandidate(candidate)`                    | `append_candidate`  |
| `readBlob(blobType)`                            | `read`              |
| `writeBlob(blobType, blob)`                     | `write`             |
| `updateCandidate(blobType, id, updates)`        | `update_candidate`  |
| `moveCandidate(id, fromBlob, toBlob)`           | `move_candidate`    |
| `deleteCandidate(blobType, id)`                 | `delete_candidate`  |

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

## Adding a New Adapter

1. Create `adapters/<name>.js` exporting `async function fetchCandidates(): Promise<Candidate[]>`.
2. Register the name in `adapters/_run.js` → `ADAPTERS` map.
3. Create `.github/workflows/adapter-<name>.yml` using the existing workflows as template.
4. Document thresholds and data source in this file.

The `Candidate` shape is defined in `ui/lib/schema.js`.
