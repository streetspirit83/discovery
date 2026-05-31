# Discovery Workspace – Architektur- und Schema-Spezifikation

**Zweck dieses Dokuments:** Verbindliche Grundlage für die Implementierung des Discovery Workspace mit Claude Code. Beschreibt Architektur, Datenmodell, Schnittstellen, Repo-Struktur und Implementierungsreihenfolge.

**Status:** v1.1 – freigegeben für Implementierung
**Owner:** David
**Zielumgebung Phase 1:** GitHub Pages (UI) + Netlify (Storage + Scrape-Proxy) + GitHub Actions (Adapter-Cron)
**Zielumgebung Phase 2 (später):** Komplette Migration UI nach Netlify

**Changelog:**
- **v1.1** – Text-Quellen (RSS, Reddit) von AI-Extraktion **entkoppelt**: Ticker-Extraktion erfolgt in Stufen, deterministisch zuerst (Cashtags, Ticker-Dictionary, strukturierte Feed-Felder, Regex), AI nur als Fallback für unstrukturierten Freitext. Siehe Abschnitt 7.1 und 13.
- **v1.0** – Erstfreigabe.

---

## 1. Kontext und Abgrenzung

Das Discovery Workspace ist ein **eigenständiges Tool** zur systematischen Identifikation von Trading-Kandidaten. Es ist **bewusst getrennt** von der bestehenden Merkliste/Trend-Scout-Suite:

- **Merkliste = kuratiert.** Werte, die der User bewusst beobachtet. Hohe Datenqualität, langsames Wachstum.
- **Discovery = explorativ.** Tägliche Roh-Signale aus vielen Quellen. Hoher Durchsatz, niedrige Signal-Qualität, explizit "dreckig".

Der einzige Datenfluss zwischen den Tools: **Discovery → Merkliste** über einen Promotion-Schritt (manuelle Selektion im Workspace → Import-Dialog in der Merkliste). Die Merkliste liest den Discovery-Export-Blob nur lesend; sie schreibt nie zurück.

---

## 2. Architekturüberblick

```
┌─────────────────────────────────────────────────────────────────┐
│  GitHub Repository: discovery-workspace                         │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  ui/         │  │  adapters/   │  │  .github/workflows/  │  │
│  │  (Pages)     │  │  (Node.js)   │  │  (Cron + Manual)     │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                     │               │
└─────────┼─────────────────┼─────────────────────┼───────────────┘
          │                 │                     │
          │                 └──────┬──────────────┘
          │                        │ HTTPS, Shared Secret
          │                        ▼
          │       ┌───────────────────────────────────┐
          │       │  Netlify Site: discovery-backend  │
          │       │                                   │
          │       │  netlify/functions/storage.js     │
          │       │  netlify/functions/scrape-proxy.js│
          │       │                                   │
          │       │  Netlify Blobs:                   │
          │       │    discovery-inbox                │
          │       │    discovery-archive              │
          │       │    discovery-export               │
          │       └───────────────────────────────────┘
          │                        ▲
          │                        │ HTTPS, Shared Secret
          └────────────────────────┘
                                   ▲
                                   │ read-only (export-Blob)
                                   │
                            ┌──────┴───────┐
                            │  Merkliste   │
                            │  (separate)  │
                            └──────────────┘
```

**Drei Komponenten, drei Verantwortlichkeiten:**

| Komponente | Hosting | Verantwortung |
|---|---|---|
| **UI** | GitHub Pages | Workspace-Frontend: Liste, Filter, Triage, AI-Enrichment-Trigger, Promotion |
| **Adapter** | GitHub Actions (Cron) | Quellen-Scraping/API-Calls, Normalisierung, Schreiben in inbox |
| **Backend** | Netlify (Functions + Blobs) | Storage-CRUD, CORS-Proxy für Browser-seitige Adapter-Tests |

---

## 3. Datenmodell

### 3.1 Drei Blobs

| Blob-Name | Inhalt | Schreiber | Leser |
|---|---|---|---|
| `discovery-inbox` | Neu eingegangene Kandidaten, unbearbeitet | Adapter (Auto), UI (manuelle Uploads) | UI |
| `discovery-archive` | Verworfene oder erledigte Kandidaten, Historie | UI | UI |
| `discovery-export` | Promotete Kandidaten mit AI-Enrichment, Merkliste-Import-ready | UI | UI, Merkliste (read-only) |

### 3.2 Blob-Schema (alle drei Blobs gleich strukturiert)

```json
{
  "schema_version": "discovery-1.0",
  "blob_type": "inbox" | "archive" | "export",
  "updated_at": "2026-05-27T14:32:11Z",
  "candidates": [ /* siehe 3.3 */ ]
}
```

### 3.3 Candidate-Schema

```json
{
  "id": "uuid-v4",
  "symbol": "AAPL",
  "exchange": "NASDAQ",
  "yahoo_symbol": "AAPL",
  "isin": "US0378331005",
  "name": "Apple Inc.",

  "sources": [
    {
      "adapter": "openinsider",
      "source_url": "https://openinsider.com/screener?...",
      "discovered_at": "2026-05-27T08:00:00Z",
      "signal_type": "insider_buy",
      "raw_signal": { /* quellspezifisch, frei */ },
      "info_snippet": "CEO Tim Cook bought 50,000 shares at $182.50 ($9.1M)"
    }
  ],

  "links": {
    "tradingview": "https://www.tradingview.com/symbols/NASDAQ-AAPL/",
    "stocktwits": "https://stocktwits.com/symbol/AAPL",
    "yahoo": "https://finance.yahoo.com/quote/AAPL"
  },

  "workspace_state": "new" | "reviewed" | "promoted" | "dismissed" | "imported",
  "notes": "",

  "enrichment": null,

  "first_discovered_at": "2026-05-27T08:00:00Z",
  "last_updated_at": "2026-05-27T08:00:00Z"
}
```

**Feld-Erläuterungen:**

| Feld | Pflicht | Typ | Notiz |
|---|---|---|---|
| `id` | ✅ | UUID v4 | Stabil über Lebenszyklus, generiert bei erster Erfassung |
| `symbol` | ✅ | string | TradingView-Notation (NASDAQ-Symbol, kein Yahoo-Suffix) |
| `exchange` | ✅ | string | TV-Exchange-Code: `NASDAQ`, `NYSE`, `XETR`, `FWB`, `LSE`, `EURONEXT`, `MIL`, etc. |
| `yahoo_symbol` | ✅ | string | Fallback für Yahoo-API-Calls (z.B. `BMW.DE`, `AAPL`) |
| `isin` | ⚪ | string | Sekundärer Dedup-Hinweis, kein Primärschlüssel |
| `name` | ✅ | string | Anzeigename |
| `sources` | ✅ | array, ≥1 | Cluster-Signal: mehrere Quellen für denselben Kandidaten werden hier akkumuliert |
| `links` | ✅ | object | Generierte Außenlinks, vom Helper-Modul produziert |
| `workspace_state` | ✅ | enum | siehe State-Machine in 3.4 |
| `notes` | ⚪ | string | freitext, vom User |
| `enrichment` | ⚪ | object\|null | siehe 3.5 |
| `first_discovered_at` | ✅ | ISO timestamp | wann erste Quelle den Kandidaten gemeldet hat |
| `last_updated_at` | ✅ | ISO timestamp | letzte Änderung (neue Source, State-Change, Note) |

### 3.4 State-Machine

```
                ┌──────────┐
                │  new     │ ← Adapter schreibt hier rein
                └────┬─────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   ┌─────────┐  ┌──────────┐  ┌───────────┐
   │reviewed │  │dismissed │  │ promoted  │
   └────┬────┘  └────┬─────┘  └─────┬─────┘
        │            │              │
        │ → archive  │ → archive    │ (export-Blob)
        │            │              │
        └────────────┘              ▼
                              ┌──────────┐
                              │ imported │ ← nach Merkliste-Import
                              └──────────┘
                                    │
                                    ▼
                                 archive
```

**Übergänge:**
- `new → reviewed`: User hat angeschaut, noch nicht entschieden
- `new/reviewed → dismissed`: User verwirft → wandert ins `discovery-archive`
- `new/reviewed → promoted`: User selektiert für Import → wandert ins `discovery-export`, AI-Enrichment wird getriggert
- `promoted → imported`: Merkliste hat den Kandidaten erfolgreich importiert → wandert ins `discovery-archive`

**Wichtig:** Wenn ein Adapter einen Kandidaten findet, der schon im **inbox** existiert (matched by `symbol+exchange`), wird kein neuer Candidate erzeugt, sondern das `sources`-Array des bestehenden erweitert und `last_updated_at` aktualisiert. Existiert er in `archive` oder `export`, wird **nicht** zurück in inbox geschrieben (keine Auferstehung).

### 3.5 Enrichment-Schema

```json
"enrichment": {
  "enriched_at": "2026-05-27T15:00:00Z",
  "model": "claude-sonnet-4.x",
  "sector": "Technology",
  "industry": "Consumer Electronics",
  "market_cap_bucket": "large" | "mid" | "small" | "micro",
  "region": "US" | "DE" | "EU" | "other",
  "thesis_short": "1-2 Sätze, für info modal in Merkliste",
  "thesis_long": "ausführliche These, Markdown erlaubt",
  "risks": ["Risk 1", "Risk 2"],
  "catalysts": ["Catalyst 1"],
  "confidence": "high" | "medium" | "low"
}
```

---

## 4. Dedup-Logik

**Primärer Dedup-Key:** `symbol + exchange` (case-insensitive, normalisiert)

**Sekundärer Hinweis:** `isin` – das UI zeigt im Workspace eine Warnung "ISIN-Match: dieser Konzern existiert bereits als XYZ/XETR", aber es findet **kein automatisches Merging** statt. Notierungen werden separat behandelt, weil sie separat getradet werden.

**Adapter-Logik bei neuem Fund:**

```javascript
function onNewCandidate(newCand) {
  const inbox = readBlob('discovery-inbox');
  const existing = inbox.candidates.find(c =>
    c.symbol === newCand.symbol && c.exchange === newCand.exchange
  );

  if (existing) {
    // Cluster-Signal: Source ergänzen
    existing.sources.push(newCand.sources[0]);
    existing.last_updated_at = now();
  } else {
    // Check auch archive und export, um "Auferstehung" zu verhindern
    if (isInArchiveOrExport(newCand.symbol, newCand.exchange)) {
      return; // skip
    }
    inbox.candidates.push(newCand);
  }
  writeBlob('discovery-inbox', inbox);
}
```

---

## 5. Helper-Module (Shared Code)

Diese Helfer werden von allen Adaptern und teilweise vom UI verwendet. Liegen in `adapters/_shared/`:

### 5.1 `exchange-mapper.js`

```javascript
yahooSuffixToTvExchange(yahooSymbol: string) → { symbol, exchange }
// Beispiele:
//   "BMW.DE"     → { symbol: "BMW",  exchange: "XETR" }
//   "AAPL"       → { symbol: "AAPL", exchange: "NASDAQ" } // benötigt US-Lookup, siehe 5.2
//   "AIR.PA"     → { symbol: "AIR",  exchange: "EURONEXT" }
//   "RDSA.L"     → { symbol: "RDSA", exchange: "LSE" }

micToTvExchange(mic: string) → string
// MIC = Market Identifier Code (Finnhub liefert das)
//   "XNAS" → "NASDAQ"
//   "XNYS" → "NYSE"
//   "XETR" → "XETR"
```

**Suffix-Mapping (vollständig anlegen, mindestens diese):**

| Yahoo-Suffix | TV-Exchange | Region |
|---|---|---|
| (none) | `NASDAQ` oder `NYSE` (Lookup nötig) | US |
| `.DE` | `XETR` | Xetra |
| `.F` | `FWB` | Frankfurt |
| `.MU` | `MUN` | München |
| `.BE` | `BER` | Berlin |
| `.HM` | `HAM` | Hamburg |
| `.DU` | `DUS` | Düsseldorf |
| `.SG` | `STU` | Stuttgart |
| `.HA` | `HAN` | Hannover |
| `.PA` | `EURONEXT` | Paris |
| `.AS` | `EURONEXT` | Amsterdam |
| `.BR` | `EURONEXT` | Brüssel |
| `.MI` | `MIL` | Mailand |
| `.MC` | `BME` | Madrid |
| `.L` | `LSE` | London |
| `.VI` | `VIE` | Wien |
| `.SW` | `SIX` | Zürich |
| `.ST` | `OMXSTO` | Stockholm |
| `.CO` | `OMXCOP` | Kopenhagen |
| `.HE` | `OMXHEX` | Helsinki |
| `.OL` | `OSE` | Oslo |

### 5.2 `us-exchange-resolver.js`

```javascript
resolveUsExchange(symbol: string) → Promise<"NASDAQ" | "NYSE" | "AMEX">
// Cache (in-memory + ggf. persistierter Blob `discovery-us-exchange-cache`)
// Lookup via FMP /profile-Endpoint oder Yahoo-Lookup
// Bei Cache-Miss: Lookup ausführen, Cache erweitern
```

### 5.3 `isin-resolver.js`

```javascript
resolveByIsin(isin: string) → Promise<{ symbol, exchange, name } | null>
// Quellen-Reihenfolge:
//   1. OpenFIGI API (kostenlos, kein Key) - https://www.openfigi.com/api
//   2. Twelve Data (David's bestehender Key)
// Cache analog us-exchange-resolver
```

### 5.4 `link-builder.js`

```javascript
buildLinks({ symbol, exchange, yahoo_symbol }) → {
  tradingview: string,
  stocktwits: string,
  yahoo: string
}

// TradingView:
//   https://www.tradingview.com/symbols/${exchange}-${symbol}/
//
// StockTwits:
//   https://stocktwits.com/symbol/${symbol}
//   (für non-US Werte funktioniert die Suche meist über das Symbol allein)
//
// Yahoo:
//   https://finance.yahoo.com/quote/${yahoo_symbol}
```

### 5.5 `schema-validator.js`

```javascript
validateCandidate(candidate: object) → { valid: boolean, errors: string[] }
validateBlob(blob: object) → { valid: boolean, errors: string[] }
// Pflichtfelder prüfen, Typen prüfen, sources nicht-leer, etc.
```

### 5.6 `storage-client.js` (von UI + Adaptern verwendet)

```javascript
class StorageClient {
  constructor({ baseUrl, secret }) { ... }

  async readBlob(name)             // → blob JSON
  async writeBlob(name, data)      // → ok
  async appendCandidate(blobName, candidate)  // → ok (mit Dedup-Logik!)
  async updateCandidate(blobName, id, patch)  // → ok
  async moveCandidate(id, fromBlob, toBlob)   // → ok
}
```

Die Storage-Function auf Netlify ist **die einzige authoritative Quelle** für Blob-Mutationen. Dedup-Logik läuft **in der Function**, nicht im Client – das verhindert Race Conditions, wenn mehrere Adapter parallel laufen.

---

## 6. Netlify Functions

### 6.1 `storage.js`

**Endpoints (alle POST, JSON-Body, Header `x-discovery-secret`):**

```
POST /api/storage
{ "op": "read", "blob": "discovery-inbox" }
→ { "ok": true, "data": { /* blob */ } }

POST /api/storage
{ "op": "write", "blob": "discovery-inbox", "data": { /* blob */ } }
→ { "ok": true }

POST /api/storage
{ "op": "append_candidate", "blob": "discovery-inbox", "candidate": { ... } }
→ { "ok": true, "action": "inserted" | "merged" | "skipped_in_archive" }

POST /api/storage
{ "op": "update_candidate", "blob": "discovery-inbox", "id": "...", "patch": { ... } }
→ { "ok": true }

POST /api/storage
{ "op": "move_candidate", "id": "...", "from": "discovery-inbox", "to": "discovery-archive" }
→ { "ok": true }
```

**Auth:** Shared Secret aus Netlify-Env `DISCOVERY_SECRET` muss im Request-Header `x-discovery-secret` matchen. Bei Mismatch: 401.

**Implementierung:** Verwendet `@netlify/blobs` Package, lädt komplettes Blob in Memory, mutiert, schreibt zurück. Bei `append_candidate` läuft die Dedup-Logik aus Abschnitt 4 in der Function.

### 6.2 `scrape-proxy.js`

**Endpoint:**

```
POST /api/scrape
Headers: x-discovery-secret
Body: { "url": "https://...", "method": "GET", "headers": {...} }
→ { "ok": true, "status": 200, "body": "...", "content_type": "text/html" }
```

**Zweck:** Browser-seitige Adapter-Entwicklung kann CORS-blockierte Seiten testen, ohne dass eine GitHub Action laufen muss. **Adapter in Production (GitHub Actions) brauchen diesen Proxy nicht** – sie laufen server-side und können direkt fetchen.

**Sicherheit:**
- Shared Secret (wie Storage)
- URL-Allowlist (regex): nur Domains, die wir bewusst scrapen wollen. Verhindert Missbrauch als allgemeiner Open Proxy.

---

## 7. Adapter-Interface

Jeder Adapter ist ein Node.js-Modul in `adapters/`, implementiert dieses Interface:

```javascript
// adapters/openinsider.js
export const meta = {
  name: 'openinsider',
  description: 'US Insider Buys from openinsider.com',
  region: 'US',
  signal_types: ['insider_buy'],
  schedule: 'daily',  // oder 'weekly', 'manual'
  default_filters: {
    min_value_usd: 1_000_000,
    min_insiders: 1
  }
};

export async function fetchCandidates(config) {
  // 1. Holt Daten von der Quelle (HTTP-Fetch, Scraping, API-Call)
  // 2. Parsed sie
  // 3. Normalisiert zu Candidate[]
  // 4. Verwendet Helper aus _shared/ (link-builder, exchange-mapper)
  // 5. Returnt Array von Candidate-Objekten im Schema aus 3.3
  return candidates;
}
```

**Adapter-Runner** (`adapters/_run.js`):

```javascript
// Wird von GitHub Actions aufgerufen: node adapters/_run.js openinsider
// Lädt das Adapter-Modul, ruft fetchCandidates(), pusht Ergebnisse via
// storage-client.appendCandidate() einzeln in den inbox-Blob.
```

### 7.1 Pioneer-Adapter (Phase 1)

Wir implementieren in dieser Reihenfolge drei Pioniere, einer pro technischer Charakteristik:

1. **`openinsider.js`** – HTML-Scraping-Pionier (US Insider-Käufe)
2. **`boerse-frankfurt.js`** – JSON-API-Pionier (DE Trend-Listen, inoffizielle Endpoints)
3. **`etf-holdings.js`** – CSV-Download-Pionier (z.B. iShares Clean Energy ETF Holdings, weekly diff)

**Stufe 2 – Text-Quellen (RSS, Reddit, News):**

Reddit, RSS-News und andere Text-Quellen sind als eigene Adapter-Kategorie für Stufe 2 vorgesehen.

> **Wichtig (v1.1):** Text-Quellen brauchen **nicht zwangsläufig** AI-Extraktion. Die Ticker-Extraktion läuft in Stufen, deterministisch zuerst, AI nur als Fallback:
>
> 1. **Cashtags** – `$AAPL`, `$NVDA` per Regex (Reddit, StockTwits, X liefern das oft direkt).
> 2. **Strukturierte Feed-Felder** – viele RSS/Atom-Feeds (z.B. SEC EDGAR, PR-Wires, Finnhub-News) enthalten Ticker/CIK/ISIN als eigenes Feld oder im strukturierten Titel. Direkt mappbar, kein NLP nötig.
> 3. **Ticker-Dictionary-Lookup** – Freitext gegen eine Referenzliste (Symbol + Firmenname) matchen. Lokales Dictionary aus Listing-Daten, deterministisch, offline.
> 4. **Regex auf bekannte Muster** – Ticker-in-Klammern `(NASDAQ: AAPL)`, ISIN-Muster `[A-Z]{2}[A-Z0-9]{9}[0-9]`.
> 5. **AI-Extraktion = nur Fallback** für unstrukturierten Freitext ohne klare Ticker-Marker. Reihenfolge bleibt: deterministisch zuerst, AI nur wenn nötig (Kosten + Zuverlässigkeit).
>
> AI-Enrichment (Abschnitt 9.4) bleibt davon unberührt – das ist ein separater, bewusster Schritt nach der Promotion und nicht Teil der Ingestion.

### 7.2 Pre-Filter pro Adapter

Adapter dürfen vor dem Push Pre-Filter anwenden, um die inbox nicht zu fluten. Konfigurierbar in `meta.default_filters`:

- **openinsider:** `min_value_usd` (Default $1M), `min_insiders` (Default 1)
- **etf-holdings:** nur Werte mit `weight >= 0.5%`, nur Diff zur Vorwoche (Neuaufnahmen + signifikante Gewichtsanstiege)
- **boerse-frankfurt:** nur Top-20 pro Liste

Pre-Filter sind im Adapter-Code, nicht im Schema. Sollen leicht änderbar sein.

---

## 8. GitHub Actions Workflows

### 8.1 Adapter-Cron

```yaml
# .github/workflows/adapter-openinsider.yml
name: Adapter – OpenInsider
on:
  schedule:
    - cron: '0 6 * * *'  # daily 06:00 UTC
  workflow_dispatch:      # manueller Trigger aus UI möglich

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: node adapters/_run.js openinsider
        env:
          DISCOVERY_BACKEND_URL: ${{ secrets.DISCOVERY_BACKEND_URL }}
          DISCOVERY_SECRET: ${{ secrets.DISCOVERY_SECRET }}
          FMP_API_KEY: ${{ secrets.FMP_API_KEY }}        # falls genutzt
          TWELVEDATA_API_KEY: ${{ secrets.TWELVEDATA_API_KEY }}
```

Analog für `adapter-boerse-frankfurt.yml` (täglich) und `adapter-etf-holdings.yml` (wöchentlich).

### 8.2 Manueller Trigger aus UI

Das UI kann einen Adapter ad-hoc anstoßen via GitHub `workflow_dispatch` API (Aufruf mit PAT, Scope `repo:workflow`). Optional – wenn das UI-PAT-Handling zu komplex wird, ist es okay, Adapter-Triggers nur via GitHub-UI zu starten.

---

## 9. UI-Funktionalität

### 9.1 Hauptansicht

**Listenansicht** (Default: discovery-inbox):

| Spalte | Inhalt |
|---|---|
| State-Icon | new / reviewed / promoted |
| Symbol | `AAPL @ NASDAQ` |
| Name | `Apple Inc.` |
| Sources | Badges: `[openinsider] [etf-holdings]` (Cluster-Stärke visualisierbar) |
| Latest Signal | "Insider Buy $9.1M – Tim Cook" |
| Discovered | "vor 2h" |
| ISIN-Match-Warning | falls ISIN auch in archive/export existiert |
| Actions | 🔍 Details · ✓ Promote · ✗ Dismiss · 📝 Notes |

**Filter-Leiste:**
- Blob-Switch: inbox / archive / export
- State-Filter
- Quellen-Filter (Multi-Select)
- Region-Filter (US / DE / EU / other)
- Datums-Filter (last 24h, 7d, 30d, all)
- Volltext-Suche (Symbol/Name)

**Bulk-Aktionen:**
- Mehrere selektieren → Dismiss / Promote in einem Rutsch

### 9.2 Detail-Drawer / Modal

Klick auf Zeile öffnet Detailansicht:

- Header: Symbol, Name, ISIN, alle Links (TV/Yahoo/StockTwits)
- Sources-Akkordeon: jede Source mit Datum, Signal-Typ, raw_signal pretty-printed, info_snippet
- Notes-Editor
- Enrichment-Bereich: falls leer → "AI-Enrichment ausführen"-Button (ruft Claude API), falls befüllt → Anzeige
- State-Aktionen

### 9.3 Manueller JSON-Upload

- Upload-Button → File-Dialog (.json)
- File wird gegen `validateBlob()` geprüft
- Bei Erfolg: Candidates werden einzeln via `appendCandidate` in inbox geschoben (Dedup-Logik greift)
- Bei Fehler: Fehlerliste anzeigen

### 9.4 AI-Enrichment

- Per Kandidat (Button in Detail-Drawer) ODER bulk (selektierte Kandidaten, "Enrich selected")
- Ruft Claude API via direkten fetch zu `api.anthropic.com` (Headers: `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`, API-Key aus localStorage)
- Prompt strukturiert: Symbol, Name, alle Sources als Kontext, JSON-Schema im System-Prompt erzwingen
- Response parsen (mit Fence-Stripping), in `enrichment`-Feld schreiben

**Modell:** `claude-sonnet-4.x` (aktuelle Generation, max_tokens 1000)

### 9.5 Promotion zu Merkliste

- Selektion mehrerer Kandidaten im `discovery-export`-View (oder Promote-Aktion in inbox, die direkt nach export verschiebt + AI-Enrichment triggert)
- Promotion ändert State auf `promoted`, verschiebt von inbox nach export
- Merkliste hat eigenen Import-Dialog (separate Implementierung, **nicht in diesem Repo**), liest `discovery-export`-Blob, übersetzt Discovery-Schema → Merkliste Schema A, importiert in Bucket "neutral"
- Nach erfolgreichem Import wird der State im Discovery-Workspace auf `imported` gesetzt (Merkliste callt Storage-Function) und der Eintrag wandert ins archive

### 9.6 Settings / Setup

Beim ersten Start zeigt das UI ein Setup-Modal:

- **Backend URL:** `https://screener-discovery.netlify.app`
- **Shared Secret:** Wert aus `DISCOVERY_SECRET`
- **Claude API Key:** für AI-Enrichment
- **GitHub PAT** (optional, falls UI Workflow-Dispatch nutzen soll)

Alle Werte in localStorage. Klare Warnung im UI: "Diese Werte werden nur lokal in deinem Browser gespeichert."

---

## 10. Repo-Struktur

```
discovery-workspace/
├── .github/
│   └── workflows/
│       ├── adapter-openinsider.yml
│       ├── adapter-boerse-frankfurt.yml
│       ├── adapter-etf-holdings.yml
│       └── deploy-pages.yml         # ggf. Build/Deploy für ui/
├── adapters/
│   ├── _shared/
│   │   ├── exchange-mapper.js
│   │   ├── us-exchange-resolver.js
│   │   ├── isin-resolver.js
│   │   ├── link-builder.js
│   │   ├── schema-validator.js
│   │   └── storage-client.js
│   ├── _run.js                      # Adapter-Runner für GH Actions
│   ├── openinsider.js
│   ├── boerse-frankfurt.js
│   └── etf-holdings.js
├── netlify-backend/                 # SEPARATER Netlify-Deploy
│   ├── netlify.toml
│   ├── package.json
│   └── netlify/functions/
│       ├── storage.js
│       └── scrape-proxy.js
├── ui/                              # GitHub Pages root
│   ├── index.html
│   ├── app.js                       # Haupt-App-Logik
│   ├── components/
│   │   ├── candidate-list.js
│   │   ├── candidate-detail.js
│   │   ├── upload-modal.js
│   │   └── settings-modal.js
│   ├── lib/
│   │   ├── storage-client.js        # Browser-Variante (fetch-basiert)
│   │   ├── claude-api.js            # AI-Enrichment
│   │   ├── link-builder.js          # Browser-Variante des Helpers
│   │   └── schema.js                # Schema-Konstanten
│   └── styles.css
├── package.json                     # Adapter-Deps, npm ci in Actions
├── README.md
└── CLAUDE.md                        # Hinweise für Claude Code Sessions
```

**Wichtig:**
- `netlify-backend/` ist ein **separater Netlify-Deploy** (eigenes Site). Du verbindest es einmalig mit dem Repo, deaktivierst Auto-Build (Build-Settings → Stop auto publishing), und deployst nur manuell, wenn Functions geändert wurden.
- `ui/` wird über GitHub Pages serviert (Settings → Pages → Source: `main` branch, `/ui` folder).

---

## 11. Tech-Constraints (verbindlich)

**Frontend (ui/):**
- Plain HTML/CSS/Vanilla JS oder ES Modules – **kein Build-Step**, damit GitHub Pages direkt serviert
- **Kein TypeScript** in der UI (David's hard rule)
- **Kein React** in Phase 1 – Vanilla reicht, hält Komplexität niedrig
- **Mobile-tauglich** (David testet auf Android Chrome): touch events bevorzugen, `pointerup` statt `mouseup` für Drag
- localStorage für Settings, **nicht** für Kandidaten-Daten (die leben in Blobs)

**Adapter (adapters/):**
- Node.js 20, ES Modules
- Minimal externe Deps; bevorzugt `node-fetch` (oder Native `fetch` in Node 20), `cheerio` für HTML-Parsing
- Keine Adapter-spezifischen Browser-Globals

**Netlify Functions (netlify-backend/):**
- Node 20
- `@netlify/blobs` für Storage
- Strict mode, alle Endpoints schützen mit Shared Secret

**Allgemein:**
- Schema-Validierung an jeder Grenze (Adapter-Output → Storage-Write, Upload-Input → Storage-Write)
- Alle Timestamps ISO 8601 UTC
- IDs immer UUID v4
- Logging: strukturiert (JSON-Lines), kein `console.log` ohne Kontext

---

## 12. Implementierungsreihenfolge (für Claude Code)

**Phase 0 – Setup**
1. Repo `discovery-workspace` anlegen, README + CLAUDE.md
2. `package.json` (root), Lockfile
3. Empty `data/` Verzeichnis-Struktur als Doku (Blobs leben auf Netlify, aber Schemas hier als Beispiel-JSONs)

**Phase 1 – Backend (Netlify)**
4. `netlify-backend/` mit `storage.js` (alle Ops aus 6.1), `scrape-proxy.js`
5. Manueller Deploy nach Netlify, Site-URL und Secret notieren
6. Smoke-Test mit `curl`: write inbox, read inbox, append_candidate (Dedup verifizieren)

**Phase 2 – Shared Helpers**
7. `adapters/_shared/exchange-mapper.js` mit kompletter Suffix-Tabelle
8. `link-builder.js`
9. `schema-validator.js`
10. `storage-client.js` (Node-Variante)
11. `us-exchange-resolver.js` + `isin-resolver.js` (zunächst Stub, später real)

**Phase 3 – Erster Adapter (OpenInsider)**
12. `adapters/openinsider.js` – Scraping, Normalisierung
13. `adapters/_run.js` – Runner
14. GitHub Action `adapter-openinsider.yml`, Test-Run manuell
15. Verifizieren: inbox-Blob enthält normalisierte Kandidaten

**Phase 4 – UI v1 (read-only)**
16. `ui/index.html` + `app.js` Grundgerüst
17. Settings-Modal (Backend-URL, Secret, Claude-Key)
18. Storage-Client (Browser-Variante)
19. Candidate-Listenansicht, Filter, Detail-Drawer
20. Deploy via GitHub Pages, End-to-End-Test: Adapter → inbox → UI

**Phase 5 – UI v1 (write)**
21. State-Aktionen: dismiss, promote, notes
22. Bulk-Aktionen
23. Manueller JSON-Upload
24. AI-Enrichment (Claude API call mit JSON-Schema-Prompt)

**Phase 6 – Weitere Adapter**
25. `boerse-frankfurt.js` + Workflow
26. `etf-holdings.js` + Workflow

**Phase 7 – Merkliste-Integration (separate Repo)**
27. In Merkliste: Import-Dialog im Header, liest `discovery-export`-Blob, übersetzt Schema → Schema A, schreibt in Bucket "neutral"
28. Callback an Discovery-Backend: State `imported` setzen + nach archive verschieben

---

## 13. Offene Punkte für später (nicht Phase 1)

- **Archive-Splitting** bei großem Wachstum (z.B. `discovery-archive-2026-Q2.json`) – Storage-Client soll später transparentes Splitting unterstützen
- **AI-Bulk-Enrichment-Optimierung** (Batch-Requests, Cost-Tracking)
- **Text-Quellen (RSS, Reddit)** – eigene Adapter-Kategorie. Ticker-Extraktion in Stufen, **deterministisch zuerst** (Cashtags, strukturierte Feed-Felder, Ticker-Dictionary, Regex), **AI-Extraktion nur als Fallback** für unstrukturierten Freitext ohne klare Marker (siehe 7.1). RSS ist damit **nicht** an AI gekoppelt.
- **Visualisierung von Cluster-Signalen** – Heatmap "welche Werte haben aktuell die meisten Sources"
- **Merkliste-Migration auf Netlify** (UI), wenn Phase 1 stabil und Credits es zulassen
- **Quellen-Backlog** – siehe `docs/sources-backlog.md` für die Liste der zu erschließenden Quellen

---

## 14. Hinweise für Claude Code

- **Mock-first iteration** (David's Standard): Erste UI-Version rendert gegen ein Mock-Inbox-JSON aus dem Repo, bevor wir das echte Backend anschließen. Erleichtert UI-Iteration ohne API-Calls.
- **Surgical edits only:** Bei Anfragen wie "passe Filter X an" nur den Filter-Code anfassen, kein opportunistic Refactoring.
- **Schema-Migrations bewusst:** Falls das Schema sich in Phase 1 noch ändert (was wir akzeptieren), Migration-Script schreiben + `schema_version` hochzählen.
- **Adapter-Tests:** Jeder neue Adapter soll mit einer gespeicherten Sample-Response (in `adapters/_fixtures/`) lokal testbar sein, bevor er gegen die echte Quelle läuft.

---

**Ende der Spezifikation v1.1**
