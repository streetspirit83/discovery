# Discovery Workspace — Übergabe-Dokument (Architektur & Metriken)

> **Zweck:** Vollständige Einarbeitung für einen frischen AI-Chat ohne Vorkontext.
> Alle Formeln, Gewichte und Schwellen sind **aus dem Code verifiziert** (Stand
> 2026-07-26), nicht rekonstruiert. Bei Abweichung gilt immer der Code.
>
> **Lies zuerst:** [`../CLAUDE.md`](../CLAUDE.md) (Architektur-Regeln, Gotchas,
> Git-Workflow) und [`../ui/STYLEGUIDE.md`](../ui/STYLEGUIDE.md) (verbindliche
> Design-Regeln). Dieses Dokument ergänzt beide, ersetzt sie nicht.

---

## Teil 1 — Produkt & Architektur

### 1.1 Was die App macht

Kandidaten-Discovery für Aktien/ETFs. Adapter scrapen Signale (Insider-Käufe,
Trendlisten, ETF-Änderungen, Screener), schreiben sie in Netlify Blobs; das
Frontend reichert sie mit TradingView-Daten an, berechnet Scores und erlaubt
Review, Alerts und Export.

**Kein Build-Step, kein Bundler, kein TypeScript, kein React.** Plain HTML/CSS/
ES-Module. Das ist eine bewusste Entscheidung, keine Altlast.

### 1.2 Repo-Layout

```
adapters/                  Node-20-Scraper (CLI: node adapters/_run.js <name>)
  _run.js                  Runner
  _shared/                 gemeinsame Helfer
  openinsider.js  boerse-frankfurt.js  etf-holdings.js
  stocktwits.js   tradingview-screener.js
  yahoo-growth.js yahoo-trending.js
netlify-backend/netlify/functions/
  storage.js               Blob-CRUD (alle Ops, siehe 1.5)
  scrape-proxy.js          CORS-Proxy mit ALLOWED_DOMAINS-Allowlist
  snapshot-ls.js           nightly LS-Snapshot (10-Tage-Fenster)
  check-alerts.js          Alert-Auswertung + ntfy-Push
  refresh-tv.js            serverseitiger TV-Refresh
  discovery-export.js      Export-Endpoint
  altindex-ingest.js  altindex-toplist.js
ui/                        Frontend (siehe 1.3)
docs/                      Specs (siehe 5.1)
.github/workflows/         7 Adapter-Crons + deploy-pages.yml
```

### 1.3 Frontend-Struktur (`ui/`)

`index.html` → `app.js` (Shell, State, Bot-Nav, Modal-Wiring) →

**components/** (DOM)
| Datei | Rolle |
|---|---|
| `candidate-list.js` | Haupttabelle, **6 sichtbare Ansichten** (Standard · Trade · Score · Meta · Preis · Fundamental), Sortierung, Filter, Bulk-Aktionen, Spaltenbreiten. **Größte Datei** (~1670 Z.); Header- und Zellreihenfolge je Ansicht müssen synchron bleiben. Achtung: `VIEWS` hat 7 Keys — `performance` und `metrics` sind keine eigenen Tabs, sondern werden per Spread in `VIEWS.score` gebündelt |
| `candidate-detail.js` | Detail-Sheet, 5 Tabs (Perf/Trade/Fund/News/Meta), Charts, AI-Enrichment |
| `compare-modal.js` | Vergleich mehrerer Ticker (Matrix/Scatter/Perf/10T) |
| `control-modal.js` | Kriterien-Auswahl → Bulk-Selektion |
| `screener-modal.js` | TV-Screener-Studio mit Presets |
| `dashboard-modal.js` | Monitor-Dashboard (Puls, Movers, Trend-Radar) |
| `markets-modal.js` | Indizes-Leiste + Märkte-iframe + News + Sektor-Heatmap |
| `alert-modal.js` / `trigger-modal.js` | Alert-Übersicht / Alert-Editor je Symbol |
| `settings-modal.js` `upload-modal.js` `export-modal.js` `news-panel.js` `sector-heatmap.js` `filter-multiselect.js` | |
| `intraday-modal.js` | **Toter Code** — nicht mehr importiert |

**lib/** (rein/pure, browser-fähig)
- *Daten:* `tv-enrichment.js` (TV-Scanner-Bulk + FX + Indizes), `ls-intraday.js`,
  `tr-check.js`, `symbol-search.js`, `exchange-map.js`, `storage-client.js`,
  `company-profile.js`, `news-feed.js`, `news-sources.js`
- *Scores:* `tv-overall-score.js`, `tv-trend-strength-score.js`,
  `tv-health-score.js`, `tv-entry-score.js`, `tv-cycle-score.js`,
  `tv-trend-score.js`, `tv-momentum-check.js`, `tv-mtfa-score.js`,
  `tv-upside.js`, `tv-entry-prices.js`, `trend-radar.js`, `ls-trend.js`
- *Setup/Zonen:* `trade-setup.js`, `price-cluster.js`, `ls-history-signals.js`,
  `tv-swings.js`, `chart-indicators.js`
- *Screener:* `tv-fields.js`, `tv-screener.js`, `screener-presets.js`
- *Viz/Metrik:* `price-viz.js`, `spark.js`, `dashboard-metrics.js`, `alerts.js`,
  `status-logic.js`, `signal-tracker.js`
- *Sonstiges:* `schema.js` (Mock-Daten + Schema), `icons.js` (Lucide),
  `sector-clusters.js`, `research-prompt.js`, `import-parser.js`,
  `merkliste-import.js` / `merkliste-export.js`, `link-builder.js`,
  `adapter-trigger.js`, `claude-api.js`

### 1.4 Cache-Busting — harte Regel

Ohne Bundler cachen Browser ES-Module **per URL**. Bei jeder Änderung an einer
JS/CSS-Datei muss deren `?v=YYYYMMDDx` **an jeder Importstelle** hochgezogen
werden — und **kaskadierend nach oben**: ändert sich der Import-Specifier einer
Datei, hat sich *deren* Inhalt auch geändert, also muss ihre Version bei *ihren*
Importeuren steigen, bis hinauf zu den `app.js`/`styles.css`-Tags in
`index.html`.

**Prüf-Snippet nach jeder Änderung:**
```bash
cd ui && grep -rn "<datei>.js?v=" --include=*.js . && grep -n "app.js?v=\|styles.css?v=" index.html
```
`icons.js` ist der teuerste Fall — es wird von ~9 Komponenten importiert.

### 1.5 Datenmodell: Netlify Blobs

**Ein** Blob-Store namens **`discovery-data`** (`consistency: 'strong'`), darin
mehrere Keys — nicht mehrere Stores:

| Key | Inhalt |
|---|---|
| `discovery-inbox` | aktive Kandidaten in Review |
| `discovery-archive` | **nur manuell** verworfene Werte (Dedup-Gedächtnis) |
| `discovery-export` | promotete Kandidaten, exportbereit |
| `discovery-watch` | Watchlist für laufendes Benchmarking |
| `discovery-tombstone` | `symbol:exchange`-Keys hart gelöschter Inbox-Werte → Re-Add-Schutz |
| `discovery-ls-history` | 10-Tage-LS-Snapshots (nur Watch-Bucket) |
| `discovery-config` | Screener-Presets, geräteübergreifend |

Der Bucket-Name-Mapping liegt in `BLOB_NAMES` in `storage.js`; `blob_type` im
Dokument selbst spiegelt den Bucket (`schema_version: 'discovery-1.0'`).

**Wichtig:** Löschen in der Inbox ist ein **Hard-Delete + Tombstone**, *nicht*
ein Verschieben ins Archiv. Das Archiv enthält ausschließlich manuell
Verworfenes. Adapter prüfen die Tombstone-Keys beim `append_candidates`.

**Storage-Ops** (`storage.js`, aufgerufen über `lib/storage-client.js`):
`read`, `write`, `append_candidate(s)`, `update_candidate`,
`bulk_update_candidates`, `delete_candidate(s)`, `delete_and_tombstone`,
`move_candidate(s)`, `read_ls_history`, `read_config`, `write_config`.
Auth über Header `x-discovery-secret`.

**Dedup-Key:** `symbol + exchange` (normalisiert). Inbox merged Quellen,
Archive/Export überspringen Duplikate.

**Workspace-States:** `new` → `reviewed` → `promoted` | `dismissed`
(zusätzlich `imported`).

### 1.6 Candidate-Shape (gekürzt)

```js
{
  id, symbol, exchange, yahoo_symbol, isin, name,
  sector, sub_sector, currency,
  sources: [{ adapter, source_url, discovered_at, signal_type, raw_signal, info_snippet }],
  links: { tradingview, stocktwits, yahoo },
  workspace_state, notes, enrichment,
  first_discovered_at, last_updated_at,

  tv_data:   { … },          // siehe 2.2 — Herz der Metriken
  ls_quote:  { price, change_pct, checked_at, series[] },   // EUR
  ls_history:[{ date, close, prev_close, change_pct, day_low, day_high, series[], volume }],
  swing_analysis: { …, ohlc:[{date,o,h,l,c,v}] },           // TD, USD
  company_profile, momentum_check, alerts: [ … ],
  tr_check:  { tradable, … },
  in_portfolio, broker_armed, watch_flag,                   // manuelle Marker
  mk_entry, mk_shares, merkliste_symbol                     // Portfolio-Abgleich
}
```

### 1.7 Deploy

- Push auf `main` → **zwei** Deploys: GitHub Pages (UI) + Netlify (Backend).
- **Netlify-Deploys kosten Credits** → Änderungen an `netlify-backend/` oder
  `netlify.toml` bündeln, nie spekulativ pushen.
- Adapter laufen als GitHub-Action-Crons (täglich 06:00 UTC).

---

## Teil 2 — Datenquellen

### 2.1 Regel: alles über den `scrape-proxy`

Browser können diese Hosts nicht direkt aufrufen (CORS). Neue Hosts brauchen
einen Regex in `ALLOWED_DOMAINS` in `netlify-backend/netlify/functions/scrape-proxy.js`;
Aufruf per POST `{ url, method, headers, body }` an `/api/scrape-proxy`.

| Quelle | Was | Grenzen |
|---|---|---|
| **TV-Scanner** `scanner.tradingview.com/{market}/scan` | Bulk-Enrichment, Screener, EUR/USD, Indizes (DAX/NASDAQ/SOX/NIKKEI/VIX) | inoffiziell, keine Garantie |
| **Lang & Schwarz** `www.ls-tc.de` | **Live-EUR-Intraday** (TR-Handelsplatz). Suche `/_rpc/json/.lstc/instrument/search/main` (**mit** `.lstc`), Chart `/_rpc/json/instrument/chart/dataForInstrument` (**ohne** `.lstc`, `series=intraday|history`) | nur `[ts, price]` — **kein OHLC, kein Volumen**. Nicht IP-gesperrt; frühere 403/502 waren falsche Pfade |
| **TwelveData** `api.twelvedata.com` | `time_series` → OHLC + Volumen | **US-only** im Free-Tier, ≈8 req/min, 800 Credits/Tag. Key: `localStorage.discovery_twelvedata_key` |
| **Anthropic API** | AI-Enrichment, direkt aus dem Browser | Header `anthropic-dangerous-direct-browser-access: true` |

**Nie kostenpflichtige Pläne** vorschlagen oder implementieren — nur Free-Tiers
ohne Kreditkarte, öffentliche Endpunkte oder offizielle Free-APIs.

### 2.2 `TV_COLUMNS` ↔ `COL` — Felddisziplin

In `tv-enrichment.js` gibt es ein **Array** `TV_COLUMNS` (rohe TV-Feldnamen, die
Reihenfolge = Spaltenindex der Antwort) und eine **Index-Map** `COL`. Beide
müssen **positionsgleich** bleiben. Ein neues Feld heißt: in `TV_COLUMNS`
anhängen, in `COL` den Index eintragen, in `buildUpdates()` auf einen
`tv_data`-Alias mappen. Wird das verletzt, verschieben sich **alle** Felder
danach — der klassische stille Datenfehler in diesem Projekt.

### 2.3 Zwei Namensräume — häufigste Verwechslung

| Namensraum | Beispiel | Wo |
|---|---|---|
| **Rohe TV-Namen** | `RSI`, `MACD.macd`, `BB.lower`, `market_cap_basic`, `Perf.1M`, `Pivot.M.Classic.S1` | Scanner-Antwort **und** Input der Score-Funktionen |
| **`tv_data`-Aliase** | `rsi`, `macd`, `bb_lower`, `market_cap`, `perf_1m`, `pivot_s1` | gespeicherter Blob-Inhalt |

Die Übersetzung leisten die **`live*`-Adapter** in `dashboard-metrics.js`:
`liveOverallScore(tv)`, `liveHealthScore(tv)`, `liveEntryScore(tv)`. Sie nehmen
`tv_data` und rufen die Score-Funktion mit rohen TV-Namen auf.

**Zusätzlich:** Einige Scores werden beim Fetch **persistiert**
(`tv_data.trend_strength_score`, `.cycle_score`, `.health_score`, `.entry_score`).
Die `live*`-Helfer bevorzugen den persistierten Wert, wenn er existiert und
plausibel ist (`liveHealthScore` prüft z. B. `'A_Size' in hs.breakdown`, um alte
v1-Objekte zu verwerfen). `computeMomentumCheck(tv)` nimmt **direkt `tv_data`**.

> **Konsequenz:** Wer eine Score-Funktion neu aufruft, muss wissen, welchen
> Namensraum sie erwartet. Im Zweifel den passenden `live*`-Helfer benutzen.

---

## Teil 3 — Metriken & Berechnungsmethoden

> Alle Prozentfelder von TV sind **rohe Zahlen** (`15.3` = 15,3 %, nicht `0.153`).
> Ratio-Felder (`debt_to_equity`, `total_debt_to_ebitda_fy`) sind reine Dezimalzahlen.

### 3.1 Overall Score (0–100) — `tv-overall-score.js`

Composite über 9 Komponenten, jede per `scaleLinear(v, lo, hi, max)`
(clamped, gerundet):

| Komponente | Pkt | Skala `lo … hi` |
|---|---|---|
| Perf.W | 15 | −8 % … +8 % |
| Perf.1M | 15 | −15 % … +15 % |
| Δ1T | 5 | −3 % … +3 % |
| EBITDA-Wachstum YoY | 15 | −20 % … +40 % (FY, Fallback TTM) |
| Trend-Rating 1M (`Recommend.All|1M`) | 10 | −1 … +1 |
| Trend Strength Score | 12 | 0 … 100 |
| Entry Timing Score | 10 | 0 … 100 |
| Health Score | 10 | 0 … 100 |
| Cycle Score (PCHS) | 8 | 0 … 100 |

**Renormalisierung:** Fehlende Inputs werden ausgelassen; `availableMax` summiert
nur die Gewichte mit Daten. `total = round(earned / availableMax × 100)`.
**Unter 40 verfügbaren Gewichtspunkten → `null`** (zu wenig Daten).

**Labels:** STRONG ≥70 · GOOD ≥55 · MIXED ≥40 · WEAK <40

### 3.2 Trend Strength Score (0–100) — `tv-trend-strength-score.js`
Spec: `tvtrendstrengthscoringspec.md`. Misst, ob ein **bestätigter Makro-Aufwärtstrend** intakt ist.

| Indikator | Pkt | Regel |
|---|---|---|
| ADX(14) | 25 | >25 → 25 · >20 → 12 · sonst 0 + Flag `WEAK_ADX` |
| Aroon-Alignment | 20 | Up ≥70 **und** Down ≤30 → 20 · Up>Down und Up ≥50 → 10 · sonst Flag `AROON_BEARISH` |
| SMA-Langfrist | 20 | SMA50 > SMA200 (Golden Cross) → 20 · sonst Flag `DEATH_CROSS` |
| Kurs vs SMA50 | 15 | close > SMA50 → 15 · sonst Flag `BELOW_SMA50` |
| EMA-Kurzfrist | 10 | EMA10 > EMA20 → 10 |
| Volumen-Bestätigung | 10 | volume > `average_volume_10d_calc` → 10 · sonst Flag `LOW_VOLUME` |

Summe **ohne** Renormalisierung. **Labels:** POWER ≥85 · MODERATE ≥55 · WEAK <55

### 3.3 Financial Health Score v2 (0–100) — `tv-health-score.js`
Spec: `tvfinancialhealthscoringspec.md`. Vier Kategorien, jede einzeln gekappt.

**A. Size & Scale (max 15)**
- MCap: ≥10 Mrd → +8 · ≥2 Mrd → +6 · ≥300 Mio → +4 · ≥50 Mio → +2 · sonst Flag `NANO_CAP`
- EBITDA: >1 Mrd → +7 · >100 Mio → +5 · >0 → +3 · sonst Flag `NEGATIVE_EBITDA`

**B. YoY Core Growth (max 35)**
- Umsatz YoY TTM: >25 → +17 · >15 → +13 · >10 → +9 · >0 → +4 · sonst Flag `REVENUE_SHRINKING`
- EBITDA YoY TTM: >25 → +18 · >15 → +14 · >10 → +10 · >0 → +5 · sonst Flag `EBITDA_DECLINING`

**C. Cash & Efficiency (max 25)**
- Operating Margin: >25 → +13 · >15 → +10 · >8 → +6 · >0 → +3 · sonst Flag `NEGATIVE_OP_MARGIN`
- FCF YoY TTM: >20 → +12 · >10 → +9 · >0 → +5 · sonst Flag `FCF_DECLINING`

**D. Leverage & Risk (max 25)**
- Debt/Equity: <0,5 → +13 · <1,0 → +10 · <2,0 → +5 · sonst Flag `HIGH_LEVERAGE`
- Debt/EBITDA FY: <0 → Flag `NEGATIVE_DEBT_EBITDA` · <1,0 → +12 · <2,0 → +9 · <4,0 → +4 · sonst Flag `HIGH_DEBT_EBITDA`

**Labels:** „Safe Allocation" ≥75 · Solide ≥55 · Gemischt ≥35 · Fragil <35.
**Flags sind qualitativ** und werden *nicht* vom Score abgezogen.

### 3.4 Entry Timing Score v2 (0–100) — `tv-entry-score.js`
Bewertet, ob **jetzt** ein günstiger kurzfristiger Einstiegsmoment ist.
Belohnt „überverkauft und dreht" statt ausgedehnter Kurse.

| Indikator | Pkt | Regel |
|---|---|---|
| RSI(14) | 25 | 30–50 → 25 (Sweet Spot) · 50–60 → 15 · 25–30 → 12 · 60–70 → 5 · >70 Flag `RSI_OVERBOUGHT` · <25 Flag `RSI_DEEP_OVERSOLD` |
| MACD | 20 | macd > signal → 20 · Konvergenz <5 % → 10 · sonst Flag `MACD_BEARISH` |
| Stochastik | 20 | K>D und K<20 → 20 · K>D und K<50 → 12 · K>D → 6 · K≥80 Flag `STOCH_OVERBOUGHT` |
| Kurs vs EMA20 | 20 | \|Abstand\| ≤2 % → 20 · ≤5 % → 10 · darüber und close>EMA20 Flag `EXTENDED_ABOVE_EMA20` |
| Bollinger | 15 | close ≤ BB.lower → 15 · ≤2 % darüber → 8 |

**Labels:** PRIME ≥80 · NEUTRAL ≥40 · BAD <40

### 3.5 Price Cycle & Historical Position Score / PCHS (0–100) — `tv-cycle-score.js`

| Teil | Pkt | Formel |
|---|---|---|
| `S_LT` | 40 | `(close − Low.All) / (High.All − Low.All) × 40` |
| `S_ATH` | 30 | `close / High.All × 30` |
| `S_52W` | 20 | `(close − low52w) / (high52w − low52w) × 20`; Range 0 → 10; fehlt → 0 |
| `S_6M` | 10 | `(close − Low.6M) / (High.6M − Low.6M) × 10`; Range 0 → 5; fehlt → 0 |

Alle Teile geclampt. **Pflicht-Anker:** `close` + `High.All`/`Low.All`, sonst `null`.

**Labels:** ATH ≥85 · HIGH ≥65 · MID ≥35 · LOW ≥20 · FLOOR <20

### 3.6 Composite Trend Beginning Score (0–**20**) — `tv-trend-score.js`
⚠️ **Andere Skala** als die übrigen Scores (0–20, nicht 0–100).

- **A. MA-Stack (0–5):** je +1 für `close>EMA20`, `EMA20>EMA50`, `EMA50>EMA200`,
  `close>EMA200`; 5. Punkt für `close>EMA20` **und** Abstand <3 % (früh, nicht ausgedehnt)
- **B. ADX (0–4):** >20 → 1, >25 → 2, >30 → 3 (nicht additiv, höchste Stufe gilt);
  +1 wenn `ADX+DI > ADX-DI`
- **C. Momentum (0–5):** RSI>50 → +1; RSI 50–65 → +1; MACD>Signal → +1; MACD>0 → +1
- **D. Oszillatoren (0–3):** Stoch K>D und K<80 → +1; K>50 → +1; CCI20>0 → +1
- **E. TV-Rating (0–3):** `Recommend.All`>0 → +1; >0,1 → +1; `Recommend.MA`>0 → +1

`weeklyAlign` (Wochen-EMA-Stack) ist **rein informativ** und fließt *nicht* ein.
**Labels:** STRONG ≥16 · MODERATE ≥11 · NEUTRAL ≥6 · WEAK <6

### 3.7 Momentum-Check (0–100 + Ampel) — `tv-momentum-check.js`
Punktemodell statt harter Gates; nimmt **`tv_data` direkt**.

| Komponente | Pkt | Skala |
|---|---|---|
| ØGr/M (aus `perf_6m`) | 25 | linear 0 … 10 %/Monat |
| Beschleunigung `perf_w − perf_1m/4` | 15 | linear −2 … +4 |
| ADX | 20 | linear 15 … 40 |
| RSI | 15 | **voll im Band 50–68**, außerhalb linear über 15 Punkte auslaufend |
| Aroon↑ − Aroon↓ (1M) | 15 | linear 0 … +40 |
| `avg_vol_10d / average_volume_30d_calc` | 10 | linear 0,8 … 1,3 |

Renormalisiert wie 3.1; **Coverage <40 → `null`**.
**Ampel:** grün ≥65 · gelb ≥40 · sonst rot.
**Earnings im 1M-Fenster deckelt grün auf gelb** (`ko`-Feld gesetzt).

### 3.8 Multi-Timeframe-Alignment / MTFA (−3 … +3) — `tv-mtfa-score.js`

Drei Horizonte, je per **Mehrheitsentscheid** über 3 Checks zu
`bull` / `bear` / `neutral` / `null` verdichtet:

- **Daily:** `close>ema20`, `ema20>ema50`, `ema50>ema200`
- **Weekly:** `close>ema20_1w`, `ema20_1w>ema50_1w`, `ema50_1w>ema200_1w`
- **Monthly:** `perf_1m>0`, `mom_1m>0`, `close>sma200`

`score = bullCount − bearCount` (Sortierschlüssel).
`aligned = true`, wenn alle drei bekannt und einstimmig non-neutral.
Braucht **keinen zusätzlichen TV-Request**.

### 3.9 Upside / Downside 1M (%) — `tv-upside.js`

Fenster: **21 Handelstage**.

1. **Drift μ** — `blendedDrift`: geometrische Monatsraten aus `perf_1m` (50 %),
   `perf_3m` (30 %), `perf_6m` (20 %), renormalisiert, dann **× 0,5**
   (`DRIFT_DAMPING` — Momentum kehrt zum Mittel zurück)
2. **Volatilität σ** — `dailyVolPct × √21`. Tagesvola-Fallback-Kette:
   `atrp` → `atr/price×100` → `volatility_m` → `volatility`
3. **Statistisches Band** — `statUp = max(0, μ+σ)`, `statDown = max(0, σ−μ)`
4. **Strukturelle Deckel** — nächster Widerstand über dem Kurs aus
   {`pivot_r1`, `pivot_r2`, `bb_upper`, `donch_ch20_upper_1m`, `high_1m`,
   `high_3m`, `high_6m`, `price_52_week_high`}, Support gespiegelt

```
upside   = min(strukturelle Distanz ↑, statUp)
downside = −min(strukturelle Distanz ↓, statDown)
```
Fehlt die Struktur (Blue Sky / kein Support), gilt das statistische Band allein.
`earningsSoon` = Earnings-Termin in 0…31 Tagen.

**Hilfsfunktion (breit genutzt):**
```js
monthlyGrowthRate(perfPct, months) = ((1 + perfPct/100)^(1/months) − 1) × 100
// null bei perfPct <= −100
```

### 3.10 Trade-Cluster & Trade-Parameter — `trade-setup.js`

**Cluster-Klassifikation:** ATRP-Band **doppelt gewichtet**, MCap-Band einfach:
```js
idx = round((2 × atrpIdx + mcapIdx) / 3)
```
ATRP-Bänder: `<4` · `4–6` · `6,1–10` · `>10` → Index 0–3
MCap-Bänder: `>50B` · `10–50B` · `2–10B` · `<2B` → Index 0–3
Fehlt eine Metrik, gilt die andere allein; fehlen beide → `null`.

| Cluster | ATR-Mult | Gewinnziel | Volumen-Basis |
|---|---|---|---|
| Stable | 1,5 | +5 % | 30d |
| Moderate | 2,0 | +10 % | 30d |
| Momentum | 2,1 | +18 % | 10d |
| Hyper | 1,0 | +30 % | 10d |

- **Target:** `close × (1 + gainPct/100)`
- **Breakout-Entry:** `high_20d × 1,0001` (high|20 + 0,01 %)
- **`STOP_PAD = 0,02`** — support-basierte Stops liegen *knapp darunter*, nie darauf

**Exit-Leitern** (`exitLevels`):
*Long:* `low_3m − 0,5×ATR − PAD` · `sma200 − 0,5×ATR − PAD` ·
Chandelier `high_1m − ATR×mult` (ohne PAD)
*Short:* `low|10 (LS) − PAD` · `sma20 − 0,5×ATR` · `2W-Low (LS) − PAD` ·
`low_1m − 0,5×ATR − PAD` · Chandelier `low_1m + ATR×mult`

**Primär-Stop-Auswahl:** muss auf der richtigen Seite des Kurses liegen — Long
darunter (engster = **höchster**), Short darüber (engster = **niedrigster**).
Level auf der falschen Seite bleiben im Tooltip, werden aber nie Headline.

**Dokumentierte Approximationen** (TV hat keine 22-Bar-Felder):
`high|22 ≈ High.1M`, `low|22 ≈ Low.1M`, `ATR|22 ≈ ATR(14)`.

**R:R (Long)** — in `candidate-detail.js` und `compare-modal.js`:
```
rr = (target − entry) / (entry − stop)      mit entry = pivot_r1_1w ?? pivot_r1
                                                 stop  = primaryLong.value
                                            null wenn entry <= stop
```

### 3.11 Entry-Preise — `tv-entry-prices.js`
Spec: `tventrypricesspec.md`. Mittelwert **aller verfügbaren** Methoden:

| Methode | Long | Short |
|---|---|---|
| Mean Reversion | `BB.lower` | `BB.upper` |
| Floor Pivots | `Pivot.M.Classic.S1` | `Pivot.M.Classic.R1` |
| Trend Breakout | `close + 0,5×ATR` | `close − 0,5×ATR` |

`null`-Werte fallen raus; keine Methode → `null`.

### 3.12 Price-Cluster / Konfluenzzonen — `price-cluster.js`

Sammelt **alle** bekannten Level und verschmilzt nahe zu Zonen.
**Startgewichte (transparente Heuristik, nicht backtest-kalibriert):**

| Familie | Level (Gewicht) |
|---|---|
| `struct` | ATH (3) · 52W-H (3) · 52W-T (3) · H/L6M (2,5) · H/L3M (2) · H/L1M (1,5) |
| `ma` | SMA200 (3) · SMA100 (2) · SMA50 (1,5) · SMA20 (1) |
| `pivotM` | R1/S1 (2) · R2/S2 (1,5) · R3/S3 (1) |
| `pivotW` | R1/S1 (1) · R2/S2 (0,75) · R3/S3 (0,5) |
| `demark` | DeM R1/S1 |1W (1,5) |
| `donch` | high\|20, low\|20 (1,5) |
| `bb` | BB↑, BB↓ (1) |
| `ls` | low\|10 (LS) (1,5) · 2W-Low (LS) (1,5) |

**Merge-Regeln** (ATR-normalisiert):
```
tol      = max(0,25 × ATR, 0,003 × ref)     // Lücke zum Nachbarn
widthCap = max(0,75 × ATR, 0,01  × ref)     // Zonenbreite — verhindert Ketten-Merge
```
Ein Einzel-Level ist **keine** Zone (`g.length >= 2` gefordert).

**Score mit Diversitäts-Bonus:**
```
score = Σ Gewichte × min(2, 1 + 0,2 × (Familien − 1))
```
→ SMA200 + S1|1M + L3M schlägt drei gleichartige Pivots.

`mid` ist der **gewichtete** Mittelwert. `side`: `sup` (Zone unter Kurs), `res`
(darüber), `at` (Kurs in der Zone).

> **Währungsfalle:** LS-Level sind **immer EUR**, TV-Level native Währung.
> `lsToNative` rechnet um; ist der Kurs unbekannt (`null`), werden LS-Level
> **übersprungen** statt falsch skaliert eingeordnet.

### 3.13 LS-Trend (Regression) — `ls-trend.js`

Lineare Regression durch die Tages-Schlusskurse der LS-Historie (min. 4 Tage):
```
slope   = Σ(i−mx)(y−my) / Σ(i−mx)²          // EUR/Tag
ratePct = slope / my × 100                   // %/Tag
```
Kreuzungs-Erkennung gegen die auf „heute" projizierte Linie, mit
**Epsilon-Band 0,15 % des Mittelkurses** (Kurse, die auf der Linie kleben,
zählen weder ↑ noch ↓). Liegt eine Live-Quote vor, ist „heute" ein Schritt
hinter dem letzten Snapshot.
Output: `{ ratePct, above, crossedUp, crossedDown, days }`

### 3.14 Trend-Radar (0–100) — `trend-radar.js`
„Wer trendet **gerade**?" — bewusst **ohne** 3M/6M-Fenster.

| Komponente | Gewicht | Sättigung |
|---|---|---|
| LS-10T-Regressionsrate | 30 % | 1,5 %/Tag = voll |
| Richtungs-Alignment (`change_1d`, `perf_w`, `perf_1m` positiv) | 20 % | Anteil positiver |
| Kurzfrist-SMA-Stack (`close>sma20`, `sma20>sma50`, `close>sma50`) | 15 % | Anteil erfüllt |
| Beschleunigung (Wochenrate > Monatsrate) | 15 % | 1 wenn schneller & positiv, 0,5 wenn schneller & negativ |
| Volumen (`avg_vol_10d > average_volume_30d_calc`) | 10 % | binär |
| Frischer Trigger heute (SMA-Kreuzung **oder** LS-Trendlinie ↑) | 10 % | binär |

Fehlende Komponenten werden renormalisiert.
`trendRadar()`: `rising` = Score ≥40, `fresh` = heutiger Trigger.

### 3.15 LS-History-Signale — `ls-history-signals.js`

Fenster: `MIN_SNAPSHOTS = 5` (Bottom: `6`), `MAX_SNAPSHOTS = 10`.
**Alle Prozentwerte sind Heuristiken, bei 90 gekappt — nie kalibrierte
Wahrscheinlichkeiten.**

**Money-Flow-Approximation** (TV-Scanner hat kein MFI/OBV/AD), geteilt von
Breakout und Breakdown:
```
MFM = ((close − low) − (high − close)) / (high − low)      // range<=0 → 0
MFV = MFM × volume
```

**a) Breakout** (`detectBreakoutSetup`) — Spec `BREAKOUT_PROBABILITY_SPEC.md`

| Kriterium | Pkt | Regel |
|---|---|---|
| `extendedNarrowRange` | 20 | `max(ranges) < 1,5 × median(ranges)` |
| `volumeConfirmation` | 30 | letztes Volumen ≥1,5× Referenz **oder** Ø(letzte 3) ≥1,3× |
| `moneyFlowBullish` | 15 | letzter MFM > **0,2** (klar positiv, nicht nur >0) |
| `flatTopBullFlag` | 30 | letzte 4 Highs alle innerhalb ±1 % des Mittels **und** Lows-Slope > 0 |

Volumen-Referenz = übergebener Cluster-Ø (V10d/V30d), Fallback Fenster-Median.
**Überkauft wird bewusst NICHT bestraft** (Spec §3) — überkaufte Werte brechen
auch höher aus. Kein RSI-Term.

**b) Breakdown** (`detectBreakdownRisk`) — Spec `BREAKDOWN_PROBABILITY_SPEC.md`

| Kriterium | Pkt | Regel |
|---|---|---|
| `volumeSpikeNoFollowThrough` | 35 | Spike >2× Ref, danach **alle** Folgevolumina <0,6× Spike **und** kein Preisfortschritt in Spike-Richtung (≤0,1 %) |
| `distributionDay` | 35 | in den letzten 5 Tagen: VolRatio >1,5 **und** \|change_pct\| <0,5 % |
| `nearRecentHigh` | 20 | <3 % unter Fenster-Hoch — zählt **nur**, wenn Kriterium 1 oder 2 gefeuert hat |

**c) Bottom** (`detectBottomSignal`) — **alle vier** Kriterien müssen halten:
1. `trendFlattening` — erste Hälfte fallend, letzte 3 Tage flach/steigend
   (Toleranz 0,2 %/Tag)
2. `decliningVolumeNearSupport` — Volumen-Slope der letzten 5 Tage < 0 **und**
   Kurs ≤ Fenster-Tief × 1,03
3. `candleShift` — Mehrheit der ersten Hälfte bearish, letzte 2 Tage
   `change_pct ≥ −0,2` **und** `MFM ≥ −0,1`
4. `rangeCompression` — Ø-Range der letzten 3 Tage < 0,7 × davor

**Bottom-Preis:** bestätigtes Swing-Low (Reaktionstief mit ≥2 konsekutiv
höheren Closes) → `basis: 'swing-low'`; sonst Kapitulationstief (`day_low` des
Tages mit höchstem Volumen) → `basis: 'capitulation'`.

### 3.16 Swing-Check (TwelveData OHLC) — `tv-swings.js`
Handover: `SWING_CHECK_HANDOVER.md`. **US-only, on-demand, manuell ausgelöst.**

- **`isUsTicker`** — Prüfkette: Exchange-Whitelist/Regex
  (`NASDAQ|NYSE|AMEX|ARCA|BATS|NMS|NGM|NCM|NYQ|PCX|ASE`) → bekannte
  Nicht-US-Börsen ausschließen → `currency === 'USD'` → US-ISIN
  (`/^US[0-9A-Z]{9}[0-9]$/`). Nötig, weil das Exchange-Feld in vielen
  Schreibweisen ankommt.
- **`computeAtr(bars, 14)`** — True Range = `max(h−l, |h−pc|, |l−pc|)`,
  Wilder-Glättung, geseedet mit dem einfachen Mittel der ersten 14 TRs
- **`detectPivots(bars, k=3)`** — fraktale Pivots: Swing-High = Bar, dessen
  `high` das Maximum über ±k Bars ist (Low gespiegelt)
- **`buildZones`**, **`classifyStructure`** (`up` HH/HL · `down` LH/LL · `range`)
- **`fetchSwingAnalysis`** — `MIN_BARS = 20`; Referenzpreis = LS-EUR × EUR/USD
  falls vorhanden, sonst letzter TD-Close (`ref_source`: `'ls'` | `'td_close'`);
  speichert `ohlc` = **letzte 180 Bars** kompakt (`{date,o,h,l,c,v}`), damit der
  Detail-Chart ohne erneuten TD-Call zeichnen kann
- Fehlercodes: `not_us`, `no_key`, `td_limit`, `td_error`, `empty`, `few_bars`

### 3.17 Abgeleitete Einzelwerte (Tabelle & Detail)

| Metrik | Formel / Quelle |
|---|---|
| **52W-Position** | `(close − low52) / (high52 − low52) × 100`, geclampt |
| **V/Ø10d, V/Ø30d** | `letztes LS-Snapshot-Volumen ÷ tv_data.avg_vol_10d` bzw. `÷ average_volume_30d_calc`, ×100. **≥150 % = Spike** |
| **ØGr/M** | `monthlyGrowthRate(perf_6m, 6)` (siehe 3.9) |
| **MACD-Histogramm** | `macdHist(tv)` in `dashboard-metrics.js` |
| **Mega-Cluster** | `megaClusterOf(sector)` — 19 TV-Sektoren → 5 Gruppen (siehe 3.18) |
| **Chart-Indikatoren** | `chart-indicators.js`: `bollinger(20,2)`, `supertrend(10,3)`, `cci(20)` — nur für den TD-Chart |

### 3.18 Mega-Cluster — `sector-clusters.js`

| Key | Label | TV-Sektoren |
|---|---|---|
| `tech` | Tech & Comms | Electronic Technology, Technology Services, Communications |
| `health` | Gesundheit | Health Technology, Health Services |
| `consumer` | Konsum & Handel | Consumer Durables, Consumer Non-Durables, Consumer Services, Retail Trade, Distribution Services |
| `industry` | Industrie & Energie | Producer Manufacturing, Industrial Services, Commercial Services, Transportation, Non-Energy Minerals, Process Industries, Energy Minerals, Utilities |
| `finance` | Finanzen | Finance |

Unbekannte Sektoren → `null` (fallen bei aktivem Filter raus, fehlen in der Heatmap).

**Sektor-Heatmap** (`sector-heatmap.js`): Zellwert = **Median** (nicht Mittel —
Ausreißer sollen das Bild nicht kippen) der TV-Performance je Cluster × Horizont
(1W/1M/3M/6M). Basis sind die **aktiven Buckets inkl. Archiv**; die Fußnote legt
`n`, „ohne Sektor" und „ohne TV-Daten" offen.

### 3.19 Vergleichs-Modal — `compare-modal.js`

**Rang-Normalisierung je Spalte:**
```js
rankT(value, values, dir):
  dir 'none' → null (neutral, keine Färbung)
  t = (value − min) / (max − min);   dir 'low' → t = 1 − t
  null bei <2 Werten oder max === min
```
Zellfläche divergierend: `t ≥ 0,5` → `--pos`, sonst `--neg`, Sättigung
`|t − 0,5| × 2 × 45 %` in `--surface-2` gemischt.

`dir`-Richtungen: `high` = groß ist gut · `low` = klein ist gut (KGV, ATRP) ·
`none` = **bewusst neutral** (RSI, 52W-Pos, MCap — „hoch" ist dort weder gut
noch schlecht).

**10T-Verlauf:** Serien auf **100 indexiert** (`v / v[0] × 100`) → dadurch
währungsneutral. Quelle: `ls_history` (≥2 Closes) → sonst
`swing_analysis.ohlc` (letzte 10 Closes) → sonst TD-Fetch on-demand.

**Serien-Cap:** `SERIES_MAX = 8`. Farben werden **nie zyklisch** vergeben;
jenseits von 8 gibt es neutrales Grau (Matrix listet weiter alle Ticker).
Grund: eine wiederholte Farbe würde fälschlich Gleichheit suggerieren.

### 3.20 Alerts — `alerts.js`

**Typen:** `price_above`, `price_below`, `ma20_below`, `ma50_below`,
`ma200_below`, `cross_below_sup`, `cross_above_res` (dynamisch gegen
Price-Cluster), `rsi_above`, `rsi_below`, `macd_bullish`, `macd_bearish`.

**Kinds und Richtungen** (`ALERT_KINDS`, aufgelöst über `kindToDir`) — Achtung,
Key ≠ `dir` beim Stop:

| `kind` | `dir` | Label |
|---|---|---|
| `watch` | `watch` | Watch |
| `buy` | `buy` | Buy |
| `stop` | **`sell`** | Stop-Loss |

**Presets:** `sma20`/`sma50`/`sma200` (→ buy), `rsi_ob` (RSI ≥70 → stop),
`rsi_os` (RSI ≤30 → buy), `macd_up` (buy), `macd_dn` (stop).

**Auswertung in EUR:** `toEur()`, `entryBasisEur()`, `clusterLevelsEur()`,
`candidateQuoteEur()` — die Alert-Logik rechnet konsequent auf EUR, weil die
LS-Live-Quote die Referenz ist.
Serverseitig prüft `check-alerts.js` und pusht per ntfy;
`localStorage.discovery_alerts_muted_all` schaltet stumm.

---

## Teil 4 — Frontend-Konventionen

### 4.1 Währungen
- **LS-Quotes sind immer EUR** (der Preis, den man bei Trade Republic zahlt).
- Nur **USD ↔ EUR** ist umrechenbar (`convFactor`/`convFromEur` in
  `candidate-list.js`); andere Währungen bleiben nativ und zeigen die
  „Wä"-Spalte.
- Live-EUR/USD kommt aus dem TV-Forex-Scanner (in `localStorage` gecacht),
  manueller Fallback in den Settings.
- **Konsequenz für Vergleiche:** %-Werte, Ratios und Scores sind
  währungsneutral, absolute Kurse nicht.

### 4.2 Börsencodes
Jeden Exchange durch `exchange-map.js` → `normalizeExchange()` schicken
(deutsche Regionalbörsen → `XETR`). **Einzige Quelle der Wahrheit** — nirgends
sonst von Hand mappen.

### 4.3 TR-Handelbarkeit
`tr-check.js` prüft via LS-ISIN-Suche: grün = auf LS gelistet ⇒ sehr
wahrscheinlich auf TR handelbar. Die TR-Zelle **kopiert die ISIN** in die
Zwischenablage (zum Einfügen in die TR-App).

### 4.4 Design (verbindlich, s. STYLEGUIDE.md)
- **Token-first** — nie feste `px`/`#hex` in neuem CSS. Tokens aus `:root`
  (`--fs-*`, `--s-*`, `--r-*`, `--pos`/`--neg`, `--accent`, `--series-1…8`).
- **Nur Lucide-Icons** aus `lib/icons.js`. **Keine Emoji** als UI-Icon.
- **Externe Links = Icon ohne Text** (`title` + `aria-label` tragen die Bedeutung),
  immer `target="_blank" rel="noopener"`.
- **Stat-Block:** zweite Wertzeile ist **genau eine** `--fs-*`-Stufe kleiner als
  die darüber. Nie gleich groß, nie größer.
- **Panels über Primärinhalt** sind schmale Streifen: feste kleine Item-Zahl →
  `flex-wrap:nowrap` + `flex:1 1 0` (nie Umbruch, auch mobil).
- **Modal-Struktur:** `.modal-overlay > .modal > (.modal-header, .modal-body)`;
  Schließen per Overlay-Klick **und** Escape.
- Dark-Mode immer prüfen — jedes Farb-Token hat eine `[data-theme="dark"]`-Variante.
- **Arbeitsweise:** UI-Änderungen werden **erst im Chat als Plan abgestimmt**,
  dann gebaut.

---

## Teil 5 — Arbeiten an diesem Repo

### 5.1 Vorhandene Specs in `docs/`
| Datei | Inhalt |
|---|---|
| `discovery-workspace-spec.md` | ursprüngliche Produktspezifikation (größte Datei) |
| `tvtrendscoringspec.md` | Trend-/Entry-Scoring |
| `tvtrendstrengthscoringspec.md` | Trend Strength Score |
| `tvfinancialhealthscoringspec.md` | Financial Health Score |
| `tventrypricesspec.md` | Entry-Preis-Berechnung |
| `BREAKOUT_PROBABILITY_SPEC.md` / `BREAKDOWN_PROBABILITY_SPEC.md` | LS-History-Signale |
| `SWING_CHECK_HANDOVER.md` | TwelveData-Swing-Check |
| `sources-backlog.md` | Backlog geprüfter/verworfener Datenquellen |

**Vor dem (Neu-)Implementieren eines Scores immer die passende Spec lesen.**

### 5.2 Gotchas (aus echten Fehlschlägen)
1. **Netlify-Deploys kosten Credits.** Lokal diagnostizieren, Backend-Änderungen
   in *einem* Commit bündeln.
2. **Netlify Functions v2:** `new Response(body, {status, headers})` — nicht das
   v1-Format. Ein `204` **muss** einen Null-Body haben (sonst strippt das CDN
   die CORS-Header) → für OPTIONS `200` + Null-Body. CORS-Header in **beiden**
   Orten setzen: Function-Response *und* `netlify.toml [[headers]]`, und die
   `for`-Pattern müssen die echten Pfade treffen (`/api/*` ≠
   `/.netlify/functions/*`).
3. **Cloud-IPs werden geblockt.** GitHub Actions (Azure) und Netlify (AWS) sitzen
   in bekannten Ranges; Consumer-Sites sperren sie. Vor jedem Scraper prüfen, ob
   der Host Cloud-IPs zulässt — sonst offizielle API/Primärquelle suchen.
   *(Bekannt betroffen: `aktie.traderfox.com` ist aus der Entwicklungsumgebung
   nicht erreichbar — Peer-Group-Extraktion daher offen.)*
4. **Erst echte Response ansehen, dann parsen.** Nie Feldnamen, Nesting-Tiefe
   oder Formate raten — eine Live-Antwort holen, verbatim loggen, lesen.
5. **Diagnose vor Bugfix.** „Element verschwindet nach Aktion" ist oft
   gewolltes Verhalten mit fehlendem UX-Affordance (Toast, Redirect, Drawer).
6. **CI-Workflow-Viewer zeigt das YAML vom Trigger-Zeitpunkt** — veraltete
   Ansicht ist erwartbar, auf einen neuen Run warten.
7. **Optionale CI-Caches** (`cache: 'npm'`) rausnehmen, wenn sie nicht schon
   laufen — Debug-Aufwand > Zeitgewinn bei seltenen Cron-Jobs.

### 5.3 Verifikation ohne Backend
Das UI läuft vollständig mit Mock-Daten (`lib/schema.js`: `MOCK_INBOX`,
`MOCK_ARCHIVE`, `MOCK_EXPORT`, `MOCK_WATCH`).

**Bewährtes Muster (Playwright, headless Chromium ist vorinstalliert):**
```js
// Mock-Daten seeden, indem die schema.js-Antwort erweitert wird
await page.route('**/schema.js*', async (route) => {
  const resp = await route.fetch();
  let body = await resp.text();
  body += `\ntry{MOCK_INBOX.candidates.push(${JSON.stringify(cand)});}catch(e){}\n`;
  await route.fulfill({ body, contentType: 'text/javascript' });
});
```
Lokaler Server: `http-server -p 8099 -c-1` im `ui/`-Verzeichnis.
Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
`eruda` ist eingebunden (Mobile-Debug) — dessen `pageerror` ignorieren.

**Bei Charts:** rendern **und hinsehen** (Screenshot). Der häufigste Fehler sind
überlaufende oder kollidierende Labels — die fällt kein Assert auf.

### 5.4 Git-Workflow
Der Nutzer hat **Dauer-Freigabe für Pushes auf `main`**. Fertige, verifizierte
Arbeit selbst promoten, nicht nachfragen:
```bash
# 1. Feature-Branch committen + pushen
git push -u origin claude/<name>
# 2. In main mergen (Konflikte lösen, prüfen dass nichts still verloren ging)
git checkout main && git merge --ff-only origin/main
git merge --no-ff claude/<name> -m "…"
# 3. main pushen  4. Branch auf main fast-forwarden
git push origin main && git checkout claude/<name> && git merge --ff-only main
```
Bei Netzwerkfehlern bis zu 4× mit exponentiellem Backoff (2/4/8/16 s).
Netlify-berührende Änderungen vorher bündeln.

---

## Anhang — Score-Übersicht auf einen Blick

| Score | Skala | Datei | `null` wenn | Labels |
|---|---|---|---|---|
| Overall | 0–100 | `tv-overall-score.js` | Coverage <40 | STRONG 70 / GOOD 55 / MIXED 40 / WEAK |
| Trend Strength | 0–100 | `tv-trend-strength-score.js` | — | POWER 85 / MODERATE 55 / WEAK |
| Financial Health | 0–100 | `tv-health-score.js` | — | Safe 75 / Solide 55 / Gemischt 35 / Fragil |
| Entry Timing | 0–100 | `tv-entry-score.js` | — | PRIME 80 / NEUTRAL 40 / BAD |
| PCHS (Cycle) | 0–100 | `tv-cycle-score.js` | kein close/High.All/Low.All | ATH 85 / HIGH 65 / MID 35 / LOW 20 / FLOOR |
| Trend Beginning | **0–20** | `tv-trend-score.js` | — | STRONG 16 / MODERATE 11 / NEUTRAL 6 / WEAK |
| Momentum-Check | 0–100 | `tv-momentum-check.js` | Coverage <40 | grün 65 / gelb 40 / rot |
| MTFA | **−3…+3** | `tv-mtfa-score.js` | kein Timeframe mit Daten | „3/3 bullish" etc. |
| Trend-Radar | 0–100 | `trend-radar.js` | kein `tv_data` | rising ≥40 |
| Breakout/Breakdown | 0–90 | `ls-history-signals.js` | <5 Snapshots | Heuristik, nie kalibriert |
