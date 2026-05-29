# Quellen-Backlog – Discovery Workspace

Liste der Quellen, die wir als Adapter erschließen wollen. **Kein Quellen-Management im Frontend** (bewusste Entscheidung Phase 1) – jede Quelle ist ein Adapter-Modul in `adapters/`, Keys liegen in GitHub Secrets, Steuerung über Cron/`workflow_dispatch`.

**Legende Parse-Methode** (deterministisch zuerst, AI nur als letzter Fallback):
- `API` = offizielle/inoffizielle JSON-API, direkt mappbar
- `CSV` = Datei-Download, Spalten direkt mappbar
- `HTML` = Scraping mit site-spezifischen Selektoren (cheerio)
- `RSS/Atom` = Feed mit strukturierten Feldern (oft Ticker/CIK/ISIN direkt enthalten)
- `Cashtag` = `$AAPL`-Regex aus Social-Text
- `Dict` = Ticker-Dictionary-Lookup (Firmenname/Symbol gegen Referenzliste)
- `AI` = LLM-Extraktion, **nur** für unstrukturierten Freitext ohne Marker

**Status:** ✅ implementiert · 🔜 als nächstes · 🗓️ geplant · 💡 Idee/zu prüfen

---

## 1. Insider & Politiker-Trades

| Quelle | Typ | Parse | Region | Signal | Auth | Status | Notiz |
|---|---|---|---|---|---|---|---|
| openinsider.com | HTML | HTML | US | `insider_buy` | – | ✅ | Pionier-Adapter |
| SEC EDGAR Form 4 | RSS/Atom + XML | RSS/Atom | US | `insider_buy` | – (Fair-Access UA-Header) | 🔜 | Strukturiertes XML, Ticker/CIK direkt. Kein AI nötig. Primärquelle, openinsider ist nur Aggregator |
| Capitol Trades | API/HTML | API | US | `congress_trade` | – | 🗓️ | Kongress-Käufe/Verkäufe |
| QuiverQuant | API | API | US | `congress_trade`, `gov_contract` | API-Key | 💡 | Mehrere Alt-Daten-Feeds gebündelt |
| insiderscreener.com | HTML | HTML | EU | `insider_buy` | – | 💡 | EU-Insider-Käufe (DE/FR/etc.) |
| BaFin Directors' Dealings | API/HTML | API | DE | `insider_buy` | – | 💡 | Offizielle DE-Meldungen |

## 2. Trend / Momentum / Screener

| Quelle | Typ | Parse | Region | Signal | Auth | Status | Notiz |
|---|---|---|---|---|---|---|---|
| Börse Frankfurt Trend-Listen | API | API | DE | `trend_breakout` | – | ✅ | Pionier-Adapter (inoffizieller Endpoint) |
| Finviz Screener | HTML | HTML | US | `trend_breakout` | – (Elite für Export) | 🔜 | Sehr flexible Filter, robustes HTML |
| Yahoo Trending Tickers | API | API | global | `trend_breakout` | – | 🗓️ | `query1.finance.yahoo.com/v1/finance/trending` |
| StockTwits Trending | API | API + Cashtag | US | `social_trend` | – (Rate-Limit) | 🗓️ | Trending-Symbole, deterministisch |
| TradingView Screener | API | API | global | `trend_breakout` | – (inoffiziell) | 💡 | Scanner-Endpoint, viele Märkte |
| Börse Stuttgart / Euronext / LSE Movers | API/HTML | API/HTML | EU | `trend_breakout` | – | 💡 | EU-Abdeckung erweitern |

## 3. ETF / Fonds / Institutionelle Flüsse

| Quelle | Typ | Parse | Region | Signal | Auth | Status | Notiz |
|---|---|---|---|---|---|---|---|
| iShares ICLN Holdings | CSV | CSV | global | `etf_addition`, `etf_weight_increase` | – | ✅ | Pionier-Adapter, Weekly-Diff |
| ARK Daily Holdings | CSV | CSV | US | `etf_addition`, `etf_weight_increase` | – | 🔜 | Tägliche CSV, sehr sauber. Diff = aktiver Kauf |
| iShares – weitere ETFs | CSV | CSV | global | `etf_*` | – | 🗓️ | Generischer iShares-Holdings-Parser, mehrere Fonds konfigurierbar |
| SEC 13F Filings | RSS/Atom + XML | RSS/Atom + Dict | US | `institutional_buy` | – | 💡 | Quartalsweise, Lag, aber starkes Cluster-Signal |
| WhaleWisdom | API/HTML | API | US | `institutional_buy` | API-Key | 💡 | 13F aufbereitet |

## 4. News / RSS / Filings (Text – ohne AI parsebar)

> **Wichtig:** Diese Kategorie ist **nicht** an AI-Extraktion gekoppelt. Die meisten Finanz-Feeds liefern Ticker/ISIN strukturiert oder als Cashtag/Klammer-Muster. AI nur als Fallback für reinen Freitext.

| Quelle | Typ | Parse | Region | Signal | Auth | Status | Notiz |
|---|---|---|---|---|---|---|---|
| SEC EDGAR Filing-RSS | RSS/Atom | RSS/Atom | US | `filing_8k`, `s1_ipo` | – | 🗓️ | CIK→Ticker-Mapping, strukturiert |
| Businesswire / GlobeNewswire / PR Newswire | RSS | RSS + Regex/Dict | global | `pr_news` | – | 💡 | Ticker oft in `(NASDAQ: XXX)`-Muster |
| Finnhub Company News | API | API | global | `news` | API-Key (free) | 💡 | Liefert `related`-Ticker-Feld direkt |
| DGAP / EQS Ad-hoc (DE) | RSS | RSS + Dict | DE | `adhoc_news` | – | 💡 | Pflichtmeldungen, Firmenname→Symbol |
| Seeking Alpha RSS | RSS | RSS + Cashtag | US | `analysis` | – | 💡 | Cashtag im Feed |

## 5. Social / Sentiment (Cashtag-parsebar)

| Quelle | Typ | Parse | Region | Signal | Auth | Status | Notiz |
|---|---|---|---|---|---|---|---|
| Reddit (wallstreetbets, stocks, etc.) | API/JSON | Cashtag + Dict | US | `social_trend` | OAuth (free) | 💡 | `$TICKER`-Regex + Erwähnungs-Zählung. **Kein AI nötig** |
| StockTwits Symbol-Streams | API | Cashtag | US | `social_trend` | – | 💡 | Native Cashtags |
| X / Twitter Cashtags | API | Cashtag | global | `social_trend` | API-Key (teuer) | 💡 | Nur wenn Budget; sonst skip |

## 6. Analyst / Ratings / Katalysatoren

| Quelle | Typ | Parse | Region | Signal | Auth | Status | Notiz |
|---|---|---|---|---|---|---|---|
| Finnhub Recommendation Trends | API | API | global | `analyst_upgrade` | API-Key (free) | 💡 | Strukturiert |
| FMP Upgrades/Downgrades | API | API | US | `analyst_upgrade` | FMP-Key (vorhanden) | 💡 | FMP-Key liegt schon vor |
| Earnings-Kalender (FMP/Finnhub) | API | API | global | `earnings_soon` | API-Key | 💡 | Als Katalysator-Kontext, nicht als Primärsignal |

---

## Priorisierung (nächste Schritte)

1. **SEC EDGAR Form 4** (RSS/XML) – Primärquelle für US-Insider, ersetzt/ergänzt openinsider, deterministisch.
2. **ARK Daily Holdings** (CSV) – sauberste Flow-Quelle, minimaler Parse-Aufwand.
3. **Finviz Screener** (HTML) – breite US-Momentum-Abdeckung.
4. **Reddit Cashtag-Adapter** – beweist, dass Text-Quellen **ohne AI** funktionieren (Cashtag + Dict).

## Offene Fragen

- **Ticker-Dictionary:** Brauchen wir eine gepflegte Referenzliste (Symbol↔Name↔ISIN) für `Dict`-Parsing? Quelle: SEC company_tickers.json (US, kostenlos), für EU ggf. OpenFIGI/Twelve Data. Als `adapters/_shared/ticker-dictionary.js` + Daten-Snapshot.
- **Rate-Limits / Fair-Access:** SEC verlangt aussagekräftigen User-Agent; Reddit OAuth-App registrieren.
- **Dedup über Notierungen:** US-Listing vs. DE-Listing desselben Konzerns bleibt getrennt (per Spec), ISIN nur als Warnung.
