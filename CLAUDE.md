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

## PWA / Android (seit Nov. 2026)
Die App ist installierbar (Chrome → „App installieren“): `ui/manifest.webmanifest`, Icons in `ui/icons/`
(`icon-maskable-512.png` = vollflächig für Android), Service Worker `ui/sw.js`, registriert per Inline-Skript in
`index.html` (nur https/localhost, nicht `file://`). `sw.js` fasst nur die App-Hülle und die Google-Schriften an:
Seitenaufruf Netz zuerst (4 s, sonst Cache), Dateien Cache zuerst mit Auffrischen im Hintergrund; alte `?v=`-Fassungen
fliegen raus. Backend-Aufrufe gehen unberührt ans Netz, Offline-Daten kommen aus `lib/blob-cache.js`. Die
Cache-Busting-Regel gilt unverändert. Ändert sich die Cache-Logik, `CACHE` in `sw.js` hochzählen. ntfy bleibt der
Push-Kanal: Der Knopf „🔍 Discovery“ (`#c=<id>`) öffnet die installierte App.

**Android-App (APK, `android-app/`):** Capacitor-Hülle, die `ui/` in die App einpackt (läuft unter
`https://localhost`, also mit eigenen Einstellungen und eigenem Cache, getrennt von der Web-App). Das Android-Projekt
wird nicht eingecheckt: `android-app.yml` (von Hand oder bei Änderungen in `android-app/`) kopiert `ui/` nach `www/`,
erzeugt das Projekt, baut eine Debug-APK und legt sie ins Vorab-Release `android-latest` (`discovery.apk`). Fester
Signaturschlüssel über das Secret `ANDROID_KEYSTORE_B64`, sonst aus dem Actions-Cache. In der APK läuft kein Service
Worker (`window.Capacitor`). Eine neue UI-Fassung kommt erst mit einem neuen APK-Build in die App.

## Startzeit (seit Nov. 2026, gemessen mit `diag-startup-bench.yml`)
- **Blob-Cache:** Beim ersten Laden eines Buckets je Sitzung zeichnet die App den letzten Stand aus IndexedDB
  (`lib/blob-cache.js`) und fragt den Server im Hintergrund mit dem ETag (`readBlobIfChanged`, Op `read` mit `etag`):
  unverändert → keine Daten. Sonst frischer Stand, eine Neuzeichnung nach allen Buckets (`revalidateBlob`). Spätere
  Ladevorgänge (nach Aktionen) gehen immer direkt an den Server. Schreibt die App während eines Lesens, wird nach
  `writesSettled()` nachgelesen. Der Server reicht den Blob beim Lesen als Text durch (`respondRaw`).
- **Liste:** Intl-Formatter nur einmal bauen (nie `toLocaleString` mit Optionen je Zelle – kostete Sekunden);
  Zustandswechsel in `candidateList.batch()` bündeln; nachgeladene Zusatzdaten über `renderRowsSoon()`. `renderRows`
  zeichnet 40 Zeilen sofort und den Rest in Häppchen (alles auf einmal, wenn weiter unten gescrollt).
- **Zusatzdaten** (Merkliste, LS-Historie, Analysten, market) starten in `init()` parallel zum Blob (`shared()` teilt laufende Abrufe).
- **Lazy:** Lightweight Charts über `lib/lwc-loader.js` (Detail-Sheet, Watch Ranges; Vorladen im Leerlauf).
  Eruda nur mit `?debug`.
- Messen: `diag-startup-bench.yml` (Handy, CPU 4× gedrosselt, kalt/warm, optional CPU-Profil) und `diag-blob-sizes.yml`.
  Marken `app:init`, `blob:*`, `app:first-render` stehen im Performance-Panel.

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

**Watch + Archiv (Bucket `all`, nur UI):** kein eigener Blob, sondern eine
gemeinsame Sicht auf die geladenen Watch- und Archiv-Kandidaten (dieselben
Objekte; Dubletten nach Symbol+Börse einmal, Watch gewinnt). Die Herkunft trägt
jedes Objekt als **nicht-aufzählbares `_bucket`** (landet nie im Blob) und zeigt
sie als W/A-Label in der Symbol-Zelle. Schreibzugriffe mit `blob_type 'all'`
leitet `routeAll()` in `app.js` (Proxy um den Storage-Client) an den echten
Bucket des Titels weiter; nach Verschieben/Löschen baut `rebuildAllView()` die
Sicht aus frisch gelesenen Blobs neu. In der Subleiste stehen dann **fünf
Sektor-Buttons** (`#sector-btns`, je Mega-Cluster ein Lucide-Icon: cpu ·
heartPulse · shoppingCart · factory · landmark): Einfachauswahl, nochmal tippen =
wieder alle (`uiState.fSeg`, `segmentOf` in `candidate-list.js`). ETFs/Titel ohne
Sektor erscheinen nur unter „alle". Die Mehrfachauswahl-Dropdowns „Mega" und
„Sectors" sind in dieser Sicht ausgeblendet und ruhen. Stern- oder Auge-Filter
aktiv → die Buttons treten zurück, die Liste zeigt alle markierten Titel ohne
Sektor-Trennung.

## Workspace States
`new` → `reviewed` → `promoted` | `dismissed`

## Code Map (ui/)
Entry point `ui/app.js` (shell, state, bot-nav, modals wiring). Then:

**components/** (UI):
- `candidate-list.js` – the main table; 5 views (Standard / Performance / Price /
  Metrics / Fundamental), sorting, filters, column resize, bulk actions, currency
  toggle. Largest file; header and cell order per view must stay in sync — die
  Standard-Ansicht rendert Kopf und Zellen an zwei getrennten Stellen, ein
  Versatz fällt sonst nicht auf. Die Spalten **Sup · Range · Res** (Standard nach „52W")
  zeigen Watch Ranges in der Liste: dieselbe Rechnung wie das Modal (`lib/range-levels.js`),
  je Titel gecacht (`rangeOf`), Sup und Res sortieren nach Nähe. Das Band sieht aus wie im Modal
  (Schiene, grüne/rote Zone, Kursmarke, ★-Einstand, Pfeil = 5-Tage-Trend ab ±1 %), Abstände ab
  ±10 % sind eingefärbt, die Glocke zeigt den Alarm am Level (`levelAlarm`: scharf, rot = ausgelöst, Warnfarbe = steht auf anderem Level oder im Archiv), ↑/↓ markiert ein gebrochenes Level und ist reine Anzeige (ab 0,5 %, kein Push). Tippen auf Sup/Res öffnet das Alert-Fenster mit vorgewählter Seite. Eine Glocke hinter dem TV-Icon zeigt aktive Alarme, rot gefüllt,
  sobald einer ausgelöst ist; neue Alarme entstehen weiter über die Aktionsspalte. In der Trade-Ansicht stehen die drei „wohin
  könnte es gehen"-Werte nebeneinander: **Target** (eigenes Cluster-Ziel) ·
  **PTØ** (Analysten-Konsens, TV) · **Fair** (Reverse-DCF). Alle drei sortieren
  nach dem Potenzial, nicht nach dem angezeigten Preis. In der Standard-Ansicht
  zeigt „10T" (nach PerfW) den LS-Verlauf der letzten zehn Tage als Sparkline —
  aus den Nacht-Snapshots plus Live-Kurs, sortiert nach dem Zuwachs über das
  Fenster (`ls10Series` in `spark.js`). Die Intraday-Spalte „Verlauf" ist entfallen. ETF-Zeilen tragen in der zweiten Zeile der
  Symbol-Zelle ein **ETF-Label** (`instrument-type.js`) und die Flächentönung
  `.row-etf`; „Aktie" steht dort bewusst nicht (Normalfall). Die Symbol-Spalte
  endet nach Symbol + TV-Icon, die zweite Zeile wird an der Kante abgeschnitten. Die Spalte **„S200Ø"**
  (Standard nach „Bias", Trade nach „TrdR") zeigt das Ø-Wachstum der SMA200 je
  Monat plus Richtungspfeil für den letzten Monat (`sma-trend.js`). Daneben (Standard nach „S200Ø", Preis nach „SMA200") steht **„%S200"** (`S200D_COL`): Abstand des LS-Kurses (sonst TV-Schluss) zur SMA200 in %, sortiert nach Abstand (`smaDistPct`). Das Monitor-Modal (`dashboard-modal.js`) zeigt dazu die Karte „Abstand zur SMA200 · Extreme" aus `lib/sma200-extremes.js` — dieselbe Rechnung (TV-Schluss gegen TV-SMA200) nutzt der Monitor-Bericht für `sma200_far_above/_below`.
- `candidate-detail.js` – per-candidate detail sheet (TV data, links, notes,
  AI-enrichment, range viz). Swipe-to-dismiss; reopens the modal it came from.
  Sechs Tabs (Perf. · Trend · Prog. · Trade · Fund. · News). Der Stift in der Toolbar
  öffnet das Bearbeiten-Feld: Links, Research-Prompt, Merkliste-Symbol (ein Speichern)
  und die Signal-Herkunft. Der Perf.-Chart startet mit den Tageskerzen (US TwelveData,
  sonst Yahoo); ohne Kerzen und ohne laufenden Abruf bleibt LS, bis 1J gewählt wird.
  Tab „Trend" erklärt die Bias-Grafik (drei Ebenen, Ring-Legende) und zeigt mit
  geladener TD-Historie Bias-Verlauf, Regime-Statistik, den **SMA200-Trend**
  (Ø-Wachstum je Monat, Richtung 1M/3M, Fenster) und Fragilität.
  Tab „Prog." (Forecast) zeigt zusätzlich das Analysten-Konsensziel als
  gestrichelten Verlauf mit Fächer (Spalte „PTØ" in der Trade-Ansicht neben „Target")
  und projiziert 6 Monate: 3 Monate echte Kerzen + drei
  gestrichelte Szenarien (Breakout/Status Quo/Breakdown) mit Fächer-Fläche, ATH
  und Fair Value als Linien — Rechnung in `tv-forecast.js`, Spec in
  `docs/FORECAST_SPEC.md`.
  Der 1J-Chart zeichnet zusätzlich die **Watch-Range-Levels** gestrichelt (`chartRange`, gleiche
  Rechnung wie Liste und Modal; scharf = Titel „Sup Alarm"/„Res Alarm") und bestehende Preis-Alerts
  gepunktet. Der Knopf „Sup/Res" in der Level-Leiste schaltet den Range-Alarm (Aktion `rangeAlarm`,
  `lib/range-alarm.js`, gemeinsam mit Modal und Server). Manuelle Levels setzt das Alert-Fenster. Im Archiv gibt es keinen Alarm, dort prüft
  `check-alerts` nicht. Geänderte Levels zieht `check-alerts` bei jedem Lauf nach.
- `alert-modal.js` – alert triage overview (opened from the Home/🔔 nav slot;
  it replaced the former Intra-Day modal). `intraday-modal.js` still exists but is
  **no longer imported** (dead code).
- `trigger-modal.js` – per-symbol alert editor (price / MA / indicator presets).
- **Bulk-Leiste:** Claude- und Perplexity-Knopf öffnen den Research-Prompt der Auswahl (`buildResearchPrompt`) direkt als
  neuen Chat (`promptUrl` in `quick-take-prompt.js`, Logos in `lib/ai-logos.js`); Links über 12 000 Zeichen öffnen den leeren
  Chat und legen den Prompt in die Zwischenablage. Sie ersetzen die früheren Knöpfe „AI-Enrichment" und „Prompt kopieren".
- `nachkauf-modal.js` – Nachkauf/Teilverkauf calculator for ★ portfolio tickers
  (Standard view row action). Pure calculator, EUR only — it reads `mk_entry` /
  `mk_shares` (merkliste) + the LS quote and persists nothing.
  Die Toolbar trägt neben den Icon-Links einen **✨-Knopf**, der
  `ai-prompt-modal.js` öffnet: fünf einzeln kopierbare englische Recherche-
  Prompts (Moat & Wettbewerb · Red Flags inkl. Short-Seller · Insider ·
  News/Katalysatoren mit 3-Monats-Ausblick · **Extreme & Katalysatoren**),
  gebaut von `stockPrompts` in `research-prompt.js`. Alle fünf teilen Kopf
  (neutral evidence researcher, Quelle + Datum) und Formatregeln (kurze
  Bullets, Fettung sparsam, Signal-Marker 🔴🟢🟡⚪, Abschlusszeile „⚠ Watch").
  Ein im Bearbeiten-Menü hinterlegter Text (`candidate.research_prompt`) kommt
  als zusätzliche erste Karte dazu — er ersetzt die fünf nicht.
  Der Extreme-Prompt seziert rückblickend die Ausschläge eines Jahres (Auslöser,
  gehalten oder zurückgegeben, wiederholbar?) und bekommt als Anker die
  **Termine der grössten Tagessprünge** aus `swing_analysis.ohlc` mit —
  gefiltert auf ≥ 2,5 × den Median der absoluten Tagesbewegung des Titels,
  damit keine ereignislosen Tage in der Liste landen.
- **KI-Knöpfe** in der Detail-Toolbar (neben ✨): Claude, ChatGPT und Perplexity, je ein Link mit
  `?q=…` und derselben kurzen Ersteinschätzung (Fazit, Momentum, Einordnung, Wettbewerb, Größe
  plus Kennzahlen), gebaut von `lib/quick-take-prompt.js` (`chatUrl`). `q` ist nirgends offiziell
  dokumentiert. Claude füllt nur vor, Perplexity startet sofort, ChatGPT ist laut Quellen unklar.
  Gemini kennt den Parameter im normalen Chat nicht und ist deshalb nicht dabei. Eigene Datei,
  weil `research-prompt.js` in die Netlify-Funktion `research` gebündelt wird.
  Trigger-, LS- und Kerzen-Knopf sind aus der Toolbar entfernt (LS und Kerzen holt das Sheet beim
  Öffnen selbst, Alerts laufen über die Tabellenzeile). Der Prompt verlangt am Ende immer
  3 konkrete Wettbewerber als Alternativen plus einen Link
  `…/discovery/#add=TICKER:BÖRSE,…&peer=SYM:BÖRSE`. Der öffnet `peer-import-modal.js`
  (Logik in `lib/peer-import.js`): Titel werden über TV geprüft, bei falscher Börse per
  Symbolsuche neu zugeordnet, 1M/3M stehen neben dem Ausgangstitel nur zur Orientierung
  und filtern nicht. Bestätigt landen sie in der Inbox (Quelle `claude-peer`). Was schon im
  Workspace liegt, ist nicht wählbar, weil `append_candidate` keine Dubletten prüft. Der
  Chat schreibt nie selbst; ohne Backend-Verbindung im Browser sperrt das Fenster.
- `ai-prompt-modal.js` – die fünf Recherche-Prompts eines Titels zum Kopieren
  (reiner Kopier-Dialog, ruft nichts ab und speichert nichts).
  Die Prompts sind seit Okt. 2026 **Vorlagen mit Platzhaltern** (`PROMPT_TEMPLATES`,
  `promptVars`, `fillPrompt` in `research-prompt.js`) — dieselben Texte nutzen das
  Research-Artefakt (dort editierbar) und die Netlify-Funktion `research`.
  `PROMPT_TEMPLATES` enthält zusätzlich „Momentum", das ✨-Modal zeigt nur die fünf.
- `ranges-modal.js` (+ `ranges-modal.css`) – **Watch Ranges** (Topbar, Pfeil-Knopf):
  1:1-Kopie des Claude-Artefakts „Watch Ranges" als Vollbild-Modal. Läuft im
  **Shadow DOM**, damit Markup und CSS des Artefakts unverändert bleiben können
  (die App-Klassen `.btn`/`.row`/`.chip` würden sonst hineinwirken) — Änderungen
  am Look daher in `ranges-modal.css`, nicht in `styles.css`. Daten aus dem
  Watch-Blob, Ranges wie `/api/watch-ranges` (computePriceClusters um den
  TV-Schluss, Fallback 52W), angezeigt in EUR (nur USD↔EUR umrechenbar).
  Schreibt `range_override` (native Währung, dasselbe Feld wie die Function),
  `range_alarm` und die Alerts `wr_sup_<id>`/`wr_res_<id>` (Format wie
  `watch-alarms.js`) direkt. Momentum-/Tiefenanalyse des Artefakts sind an
  dessen Datenbank gebunden und fehlen hier bewusst. Detail-Knopf schaltet bei
  Bedarf auf den Watch-Bucket und kehrt nach dem Sheet ins Modal zurück
  (`returnToMonitor`).
  **Kerzen lädt das Modal selbst nach** (derselbe `fetchSwingAnalysis` wie das
  Detail-Sheet, persistiert als `swing_analysis`): beim Aufklappen einer Zeile
  sofort, wenn sie fehlen oder > 20 h alt sind; beim Öffnen im Hintergrund für
  Titel ohne Kerzen (Nicht-US auch veraltete) — Yahoo in Wellen von 6,
  US/TwelveData nacheinander mit 8 s Abstand (Free: 8/min), Abbruch bei
  `td_limit`. **Weder EUR noch USD** (Sivers SEK, Funding Circle GBX):
  `lib/eur-basis.js` holt eine EUR-Basis — LS `series=history` (Tages-
  schlüsse EUR, ~2 Jahre) → deutsches Yahoo-Listing per Namenssuche (per ISIN
  findet Yahoo nur SIVE.ST; Listing muss ±20 % zum Wechselkurs passen) →
  Heimat-Kerzen × Yahoo `SEKEUR=X`. Persistiert als `eur_basis` {src, sym, t, c,
  f, at}; `f` = EUR je Notierungs-Einheit (impliziert, Median über gemeinsame
  Tage — gleicht GBX/Pence automatisch aus). Range-Levels × `f`, Chart/5T aus
  `eur_basis.c`, Kurs aus LS.
- **Monitor-Gruppenauswahl** (`dashboard-modal.js`, alle vier Reiter): jede Gruppe (`data-group` aus `section()`,
  Signal-Chips, jede `.rk-list`) bekommt eine Checkbox „alle N“ (`decorate()`, nach jeder Neuzeichnung per
  MutationObserver). Sie erfasst nur die **sichtbaren** Zeilen, nie die hinter „+N mehr“; klappt eine markierte
  Gruppe auf, wächst die Auswahl mit. Nur Titel des aktiven Buckets zählen. Leiste unten „N markiert · In Liste
  zeigen“ → `onSelectInList` in `app.js`: `setSelection` + „nur Auswahl“ → Bulk-Leiste.
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
  Der Periodensatz folgt dem Zoom (`SMA_ZOOM_PERIODS` in `candidate-detail.js`): ALL 20/50/100/200,
  6M 10/20/50/100, 3M 5/10/20/50, 1M 3/5/10/20 — kürzere Perioden rechnet der Chart aus den gespeicherten Bars,
  die vier Farben bleiben (schnell → langsam), die Legende zieht mit.
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
- Typ/Trend-Helfer: `instrument-type.js` (ETF vs. Aktie — erst `tv_data.type`/
  `typespecs` aus dem Scanner, sonst Namensheuristik; `asset_type` am Kandidaten
  ist das persistierte Ergebnis), `sma-trend.js` (Ø-Wachstum und Richtung einer
  SMA-Reihe; **braucht `swing_analysis.sma`** — der Scanner-Wert `sma200` ist nur
  ein Momentwert und trägt keine Richtung).
- Firmenprofil: `company-profile.js` (ROIC.ai → Wikipedia), steht im Perf.-Tab unter dem Chart
  und wird beim Öffnen des Sheets einmal geholt, wenn es fehlt.
  Ein Treffer wird **gekürzt am Kandidaten im Blob** gespeichert (`company_profile`,
  `compactProfile`: Text ≤ 3000 Zeichen am Satzende, fünf Fakten, Quelle, `fetched_at` —
  ≤ ~3,5 KB je Titel), Fehlversuche nie. Danach zeigt jedes Gerät das Profil sofort;
  „neu laden“ im Profil-Fuss holt frisch (`force`) und behält bei Fehlschlag das alte.
  Profile, die vorher nur im localStorage-Cache lagen, übernimmt `detailOpened`
  einmalig ohne Netz in den Blob (`cachedCompanyProfile`). Das Dossier nutzt das
  gespeicherte Profil zuerst.
- Schreiben: `storage-client.js` serialisiert `updateCandidate`/`bulkUpdateCandidates` je Blob
  (`#enqueue`) und fasst Aufgelaufenes zu einem Bulk zusammen, weil `update_candidate` ohne Sperre
  den ganzen Blob liest und schreibt. Parallele Einzelaufrufe überschrieben sich vorher gegenseitig.
- Misc: `research-prompt.js`, `link-builder.js` (**`tvChartUrl`** baut den
  TradingView-**Chart**-Link `/chart/?symbol=XETR:SAP&interval=1D`; Detail-Sheet
  und Tabelle leiten ihn zur Laufzeit ab, damit auch Kandidaten mit alter
  gespeicherter `/symbols/`-URL im Chart landen),
  `detail-autofetch.js` (`autoFetchPlan` — entscheidet, welche Quelle abgerufen
  wird. **Beim Öffnen eines Detail-Sheets läuft der Plan mit `force: true`**:
  LS · Kerzen (TD/Yahoo) · TR · Yahoo-Kursziele werden immer frisch geholt,
  unabhängig vom Alter — überall gleich, Desktop wie Handy. Es bleiben nur die
  harten Bedingungen (kein Backend/Mock, US-Kerzen ohne TwelveData-Key,
  Kursziele ohne `yahoo_symbol`) und `busy` gegen eine doppelte laufende Runde.
  Ohne `force` gelten weiter die Fristen LS 2 min · Kerzen 20 h · TR 7 Tage ·
  Yahoo-Kursziele 12 h plus die 2-min-Sperre), `import-parser.js`,
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
- **TradingView-News** (`news-headlines.tradingview.com/v2/headlines`, inoffiziell, ohne
  Key, kein CORS-Header): `lib/tv-news.js`, Detail-Tab „News" neben ROIC. Die Sprache
  wählt die Quellen: `lang=de` liefert dpa-AFX inkl. „ANALYSE-FLASH", `lang=en` Dow Jones
  und `tradingview_analyst_updates`; NYSE:BMI ist unter `de` leer. Deshalb XETR → `de`,
  sonst `en`. `parseAnalystHeadline` erkennt Hoch-/Abstufung, Kursziel, Erstbewertung und
  Bestätigung (rein, für den Monitor-Lauf wiederverwendbar). Beide Quellen laden getrennt
  (`company_news`, `tv_news`, nicht-aufzählbar, je 30 min Cache); `mergeNews` mischt nur
  zur Anzeige. TV-Titel verlinken auf die Google-News-Suche, das Icon auf die Quelle.
  Prog.-Tab: Verteilung aus `tv_data` plus Aktionen aus demselben Feed (`tvOnly`, ohne ROIC).
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
  `convFromEur` in `candidate-list.js`). **Fremdwährungen (SEK, GBX, …)** laufen
  app-weit über `eurBasisFactor(c)` aus `lib/eur-basis.js`: `eur_basis.f`, sonst LS-Kurs/TV-Schluss.
  Liste, Detail (`displayInfo`, Basis EUR, Knopf schaltet auf USD), Kerzen (`barsF`, inkl.
  `barsUnitAdj` für GBP/GBX), Range und Alerts nutzen genau diese Stelle. Ohne beides bleibt der
  Titel nativ. Marktkapitalisierung und FCF bleiben nativ. `loadEurBasis` in `app.js` holt fehlende
  Basen im Hintergrund beim Laden des Buckets und beim Öffnen eines Titels. Live EUR/USD comes from the
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
product spec. `ANALYST_BACKTEST.md`: Event-Studie zu Analystenmeldungen, starke Tagesreaktion,
keine verlässliche Nachdrift, deshalb kein Analystensignal in Score und Alarmen.

## GitHub Actions
- Adapters run on schedule (daily at 6 AM UTC)
- UI deploys to GitHub Pages on push to main
- `dossier.yml` erzeugt Google-Doc-Dossiers je Watch-Ticker (Spalte „Doc“ in der Meta-Ansicht → `dossier-trigger` → Action → `tools/dossier/run.mjs`, Playwright gegen die eigene App). Setup und Ablauf: `docs/DOSSIER.md`.
- **AI Research im Dossier:** Artefakt „Dossier Research" (https://claude.ai/artifact/HtGSH28Lkng8zC9t3swEXn) listet die Docs im Dossier-Ordner (Google-Drive-Konnektor), Prompts liegen editierbar in dessen Datenbank (`prompts`, Standard in `defaults`). Auswahl → geplante Aufgabe „Discovery Research" → Netlify `research` (eigener Schlüssel `RESEARCH_TOKEN`): GET liefert die Platzhalter-Werte (`promptVars` aus `ui/lib/research-prompt.js`, fairer Kurs aus `tv-reverse-dcf.js` — die Funktion importiert beide direkt aus `ui/lib`), POST schreibt `candidate.research[key] = {label, md, at}` (neuer Lauf ersetzt den alten) und stösst ein Dossier-Update an. `run.mjs` setzt daraus den Abschnitt „AI Research" (`tools/dossier/md-docx.mjs`). Der Text lebt im Blob, deshalb übersteht er jedes Dossier-Update. Details: `docs/DOSSIER.md`.
- `monitor-report.yml` (werktags 22:13 UTC) schreibt den **Monitor-Bericht** über
  Watchlist + Archiv (nur diese beiden, dedupliziert, Watch gewinnt, **ETFs raus**) —
  `tools/monitor-report/run.mjs` (I/O) + `report.mjs` (reine Logik). Seit Okt. 2026
  **ohne Sektor-Gliederung**: der Sektor steht nur als Feld am Titel. Erst entsteht
  ein Bericht-Objekt (`buildReport`, Schema `discovery-monitor-2.0`: `field_guide`,
  `breadth`, `indices` (Leitindizes/Zins/Rohstoffe/FX aus `BENCHMARKS` in `run.mjs` plus
  die Branchen aus `INDEX_GROUPS`, beides über `fetchIndexRows`), `headlines` = automatische Textbausteine, `earnings_next_7d`,
  `movers_1d`/`movers_volume`/`movers_1w`, `signals`, `stocks`) — `signals.sma200_far_above`/`sma200_far_below` listen je 10 Titel mit dem weitesten Abstand über/unter der SMA200, `stocks` und `watch_setups` tragen `dist_sma200_pct`, daraus rendert `renderHtml` die
  lesbare Kurzfassung — Doc und JSON laufen so nie auseinander. In den Drive-Ordner
  `MONITOR_FOLDER_ID` (Standard wie `INDICES_FOLDER_ID`): „Discovery Monitor" (Doc)
  und „Discovery Monitor.json" (kompakte Tagesfassung für die KI-Auswertung via
  `slimReport`: Signal-Listen auf 8 gekürzt, Earnings ohne Kennzahlen, `stocks` nur für Tages-Movers und Ausreisser —
  das volle JSON wären bei ~470 Titeln ~380 KB) plus „Discovery Monitor –
  vollständig.json", alle in place überschrieben; „Discovery Monitor – Prompt.md" (aus `tools/monitor-report/PROMPT.md`,
  KI-neutraler Auswertungsprompt für Claude/Gemini); im Unterordner „Monitor Archiv"
  je Tag Doc + vollständiges JSON. TV-Daten holt die Action für alle Titel frisch, die
  Kandidaten-Blobs beschreibt sie **nicht**. Der Vortagszustand (Score-Tagesreihe je
  Titel) liegt im Blob **`monitor`** — ohne ihn gäbe es für Archiv-Titel keine Deltas.
  **Analysten (Block `analyst`, Blob `analyst`, Logik `ui/lib/analyst-events.js`):** Konsens
  aller Titel gegen den Vortag (`consensus_shifts`, aus dem Scanner) und neue Rating-Meldungen
  für Augen-Titel plus Tages-Movers (`actions`, `clusters`, je Titel eine Proxy-Runde über
  `fetchTvNews`). `since` = letzter Lauf; ein zweiter Lauf am selben Handelstag behält das
  Fenster. Der Blob hält 180 Tage je Titel. Schlägt der Abruf fehl, erscheint der Bericht
  mit `analyst.available:false`. Scanner: `recommendation_buy` = nur Strong Buy, `_over` = Buy,
  `_under` = Sell, `_sell` = Strong Sell, `mark` 1 bis 3 (Gewichte 1/1,5/2/2,5/3). Nicht im
  Score: Der Backtest zeigt keine verlässliche Nachdrift (`docs/ANALYST_BACKTEST.md`).
  Spalte **„Ana"** (Standard nach „Dauer"): Saldo der letzten 30 Tage aus diesem Blob
  (`netBalance`, nicht-aufzählbar als `analyst_30d`, `loadAnalystEvents` in `app.js`).
- **Tagesauswertung „Marktbriefing“:** Claude-Artefakt https://claude.ai/artifact/KH7R1DGvxGsoyHbSemtmLY
  (db-Collection `briefings`, Dokument-ID = Handelstag) **und** in der App über den
  Slot „Briefing“ ganz rechts in der unteren Menüleiste (`#nav-briefing`; der Bucket „Watch + Archiv“
  heisst dort kurz „All“) (`components/market-briefing-modal.js`, liest den Blob
  **`market`** — read/write wie `review`, 30 Briefings, neueste zuerst). Das Artefakt
  lässt sich nicht einbetten (claude.ai sendet `frame-ancestors 'self'`), deshalb rendert
  die App dieselben Daten selbst. Symbole im Modal öffnen das Detail-Sheet (Watch/Archiv
  → „Watch + Archiv“, sonst der eigene Bucket), beim Schliessen kehrt das Modal zurück
  (`returnToMonitor`). Deep Links: `#briefing` öffnet das Modal, `#s=SYMBOL[:BÖRSE]` das
  Detail-Sheet (`handleBriefingHash` in `app.js`; das Artefakt verlinkt Symbole so).
  Indexkacheln (Modal und Artefakt): zwei feste Viererreihen S&P 500 · Nasdaq · HXR · SOX /
  DAX · KOSPI · VIX · Brent, je Label / Tagesveränderung / absoluter Stand; HXR kommt aus
  `indices.sectors`, der Rest aus `indices.benchmarks`. Darunter je drei stärkste und
  schwächste Branchen.
  **Drei Arten** (Feld `kind`, Reiter Tag / Woche / Watchlist in Modal und Artefakt):
  `daily` (Tagesbriefing, Standard), `preview` (Wochenvorschau, Felder zusätzlich
  `week_label, themes[{text}], calendar[{date,weekday,items[{time?,text}]}]`, earnings mit
  `watch:true` für Watchlist-Titel) und `watch` (Watchlist-Rückblick:
  `week_label, stats{n,up,down,median_1w,median_1m,above_sma200_pct}`, `top/flop` mit
  `perf_1w/perf_1m/reason`, `news[{symbol,exchange,name,perf_1w,headline,text,url}]`,
  `technik`, `earnings`, dazu der KI-Wochenausblick `outlook{text, candidates[{symbol,exchange,
  name,setup,chance(hoch|mittel|gering),potential_pct,target,stop,risk_pct,catalyst,reason}],
  risks[{symbol,exchange,name,text}]}`). Grundlage dafür ist `watch_setups` in „Discovery
  Monitor – vollständig.json“ (je Watch-Titel nächster Widerstand/Unterstützung aus
  `computePriceClusters` mit Abstand in %, 52W-Hoch-Abstand, `computeUpsidePotential`,
  Analystenziel-Abstand, Trend-Radar, Score/Bias, aktive Signale). **„Watch“ im Briefing heisst
  nur die mit dem Augen-Knopf markierten Titel** (`watch_flag` am Kandidaten; im Monitor-JSON
  `eye: true` an jedem Titel-Eintrag, `universe.eye` = Anzahl). `watch_setups` enthält nur diese.
  **Ranking + Lernschleife (seit Nov. 2026):** `ranking[{rank,symbol,exchange,name,score,base,adj,
  chance,setup,potential_pct,target,stop,risk_pct,crv,catalyst,note,factors}]` rankt ALLE
  Augen-Titel für die kommende Woche: Basis-Score aus `tools/market-briefing/watch_rank.py rank`
  (Faktoren trend/bias/quality/breakout/crv/sma/delta, Gewichte aus der Artefakt-Datenbank
  `watch_method/current`), dazu KI-Korrektur `adj` ±15 mit Begründung; Chance hoch ≥ 70,
  mittel ≥ 50. `review{available, prev_day, summary, hit_rate_pct, spearman, top_third_avg,
  bottom_third_avg, items[{rank,symbol,…,perf_1w,verdict,why}], lessons[{text}],
  weight_changes[{factor,old,new,reason}]}` prüft das Ranking der Vorwoche (`watch_rank.py
  review`: Rangkorrelation, Drittel-Vergleich, Faktor-Korrelation → Gewichtsvorschlag, je Woche
  höchstens ±0,02 je Faktor); `method{version,weights,penalties,rules[{text}]}` ist der Stand
  nach dem Check. Die Methode lebt in `watch_method/current` (+ `watch_method/v<N>` als Historie)
  — so korrigiert sich die Einschätzung Woche für Woche, ohne den Aufgaben-Prompt anzufassen.
  **Scout (`kind: scout`, nur App, Reiter im Briefing):** `week_label, title, lead, items[{symbol,exchange,
  name,category,thesis,catalyst,counter}], fazit, sources`. Der Inbox-Knopf öffnet das Prüffenster der
  Chat-Alternativen (`openImportCheck` in `app.js`, Quelle `ai-scout`); Titel im Workspace zeigen ihren Bucket.
  **Rankings (`kind: ranking` und `rotation`, nur App):** Monitor-Reiter „Rankings“ (`rankings-panel.js`) ist seit
  Nov. 2026 **eine Seite ohne Unterreiter**: oben die fünf Listen **technisch live** aus den Kandidaten des aktiven
  Buckets (`liveRankings` in `lib/rankings-filter.js`, ohne KI, 8 je Liste; bei „Watch + Archiv" nur die Watchlist,
  Perzentile über beide; Tippen öffnet das Detail-Sheet), darunter einklappbar das KI-Wochenranking vom Sonntag aus dem
  neuesten Eintrag des market-Blobs. Die Rotation steht seit Nov. 2026 im eigenen Monitor-Reiter „Rotation“
  (`rotationTabHtml`): Archiv → Watchlist und Watchlist → Archiv. Unter jedem Vorschlag ein Knopf „Zur Watchlist“ bzw.
  „Ins Archiv“ (`data-rk-move` → `onMoveHit` → `moveRotationHit` in `app.js`, ein `moveCandidate`); liegt der Titel schon
  woanders, steht dort der aktuelle Bucket. Im Kartenkopf „Alle N“ (`data-rk-move-all` → `onMoveHits` → `moveRotationHits`, mit Rückfrage) für alle Vorschläge
  einer Richtung, die noch im Ausgangs-Bucket liegen. Verschoben wird nur auf Tippen, nie automatisch. `ranking`: `title, lead, lists{momentum|solid|growth|pullback|breakout:
  {question, items[{rank,symbol,exchange,name,eye?,score,note,lists[]}]}}`; `push.mjs` ergänzt `prev_rank` und
  `has_prev`. `rotation`: `title, lead, promote[…], demote[…]` mit denselben Feldern. Das Briefing-Modal blendet
  beide Arten aus.
  Modal und Artefakt setzen über jedes Briefing ein nummeriertes Inhaltsverzeichnis mit
  Sprungknöpfen (`addToc`; Knöpfe statt `#`-Links, weil der Hash in der App Deep Links trägt).
  Im market-Blob je Art und Tag ein Eintrag (30 je Art); im
  Artefakt doc_id = Tag (daily), `preview-<Tag>` bzw. `watch-<Tag>`. Deep Link
  `#briefing=preview|watch` öffnet den Reiter.
  **Automatisch (geplante Aufgaben):** „Marktbriefing werktags“ Di–Sa 7:07 Uhr (Vortag,
  also Freitag am Samstag), „Wochenvorschau Montag“ Mo 7:08 Uhr, „Watchlist-Wochenrückblick
  und -ausblick“ So 9:34 Uhr (liest „Discovery Monitor – vollständig.json“, filtert `eye == true`,
  Prognose-Check → Methode anpassen → Ranking).
  Jede überspringt einen Eintrag, der im Artefakt schon steht.
  Nur für die App, ohne Artefakt: „Discovery Scout“ Sa 10:41 Uhr, „Discovery Rankings“ So 11:23 Uhr, „Discovery Rotation Archiv/Watchlist“ So 11:47 Uhr; alle drei lesen „Discovery Rankings.json“ und speichern über `market-briefing.yml`.
  **Tagessieger (`kind: picks`, nur App, seit Nov. 2026):** geplante Aufgabe „Discovery Tagessieger“ Mo–Fr 7:39 Uhr. Liest
  `daily_picks` aus „Discovery Rankings.json“ (technische Vorauswahl, **nur Watchlist**, 15 Titel, höchstens 4 je Sektor:
  `dailyPickPool` in `lib/rankings-filter.js`, Gate SMA50 drüber, RSI 40–78, Bias > −20, ≥ 1 Mrd. USD; Score aus
  `PICK_WEIGHTS`), recherchiert News/Termine und wählt **5 Tagessieger**. Eintrag: `day, trading_day, title, lead,
  picks[{rank,symbol,exchange,name,close,score,setup,catalyst,risk,reason}], pool` (pool = `daily_picks.pool` 1:1, mit
  `factors` je Titel). `push.mjs` hält 260 Einträge dieser Art und lässt andere Blob-Felder stehen. **Treffer-Check und
  Lernschleife** (`lib/daily-picks.js`) laufen im Monitor (`dailyPicksCheck` in `run.mjs`): je Pool-Titel `perf_1d`/
  `perf_5d` gegen `close` nachtragen, `reviewPicks` (Tagessieger vs. übriger Pool, Spearman je Faktor), `nextMethod`
  passt die Gewichte höchstens alle 5 Handelstage um ±0,02 an (ab 30 Messungen) → market-Blob `picks_method`
  {version, weights, updated_day, history, last_changes}; `daily_picks.review`/`.method` stehen auch in Rankings.json.
  App: Monitor-Reiter „Tagessieger“ (`components/daily-picks-panel.js`: heute · Treffer-Check · Bestenliste · Verlauf),
  Abzeichen (Lucide-Pokal, `pick-badge`) neben dem Symbol in Watch und „Watch + Archiv“ für die neuesten 5
  (`daily_pick`, nicht-aufzählbar, `loadDailyPicks` in `app.js`). Keine Kauf- oder Verkaufsempfehlung.
  **Ablauf auf „Go“:** „Discovery Monitor.json“ aus Drive lesen, Nachrichten des
  Handelstags recherchieren, Briefing-JSON bauen (`day, title, lead, data_note?,
  indices{benchmarks,sectors}` 1:1 aus dem Monitor, `breadth{advancers,decliners,
  median_chg_1d,median_perf_1w,above_sma200_pct,big_moves}, drivers[{text}],
  top/flop[{symbol,exchange,name,sector,chg_1d,perf_1w,reason}],
  volume[{symbol,exchange,name,rel_vol,chg_1d,earnings?}] (optional, 1:1 aus `movers_volume`: Vielfaches des 10-Tage-Schnitts, nachrichtlich),
  earnings[{date,weekday,symbol,exchange,name,focus}],
  analyst[{symbol,exchange,name,label,dir,firm,rating,target,text}] (optional, auch im Watch-Rückblick),
  technik[{symbol,exchange,name,signal,dir,text}], fazit, sources[{title,url,date}]` —
  je Eintrag genau EIN Symbol), dann (1) ins Artefakt schreiben (ArtifactData `set`) und
  (2) `gh workflow run market-briefing.yml -f payload="$(cat briefing.json)"` →
  `tools/market-briefing/push.mjs` schreibt in den market-Blob (Upsert je Tag;
  `-f delete_day=JJJJ-MM-TT` löscht). Für andere KIs liegt der Prompt als
  „Discovery Monitor – Prompt.md“ im Drive-Ordner.
- **Rankings-Filter (`ui/lib/rankings-filter.js`, reine Logik; `tools/monitor-report/rankings.mjs` reicht sie nur weiter):** Das Bias (`computeBias`, −100…+100) ist Kennzahl `bias`: Gewicht in allen fünf Listen, Filter Momentum und Ausbruch nur mit Bias > 0, Rücksetzer ohne Bias ≤ −60. Der Monitor-Lauf schreibt zusätzlich „Discovery Rankings.json“ in denselben Drive-Ordner. **Strikte Trennung:** `rankings.*` (momentum, solid, growth, pullback, breakout) enthalten nur den Watch-Bucket, `rotation.promote` nur das Archiv, `rotation.demote` nur die Watchlist ohne Augen- und Depot-Titel (Depot live aus der Merkliste, `fetchMerklisteEntries`; ist sie nicht lesbar, bleibt `demote` leer). Je Liste Ausschlussfilter, dann Score aus Perzentilen über Watch + Archiv, höchstens `CONFIG.candidates` Titel und `CONFIG.sectorCap` je Sektor. Finanzwerte (`sector == 'Finance'`) haben eigene Filter, weil FCF und Reverse-DCF dort wenig aussagen. Börsenwert grob nach USD umgerechnet (`USD_PER`), nur für Mindestgrössen. Die Auswahl steht mit dem Filter fest (12 je Liste und Richtung, je Firma ein Listing); die Wochen-KI bewertet sie nur. `known_symbols` listet alles aus Watch, Archiv und Inbox für den Scout.
- **AI Research aus der App:** ✨-Modal → Bereich „AI Research ins Dossier“ (Checkboxen, nichts vorausgewählt) → `candidate.research_request` → geplante Aufgabe „Discovery Research (App-Warteschlange)“ alle 2 h (muss in der Cloud-Umgebung **„netlify-blobs“** laufen — die Standard-Umgebung sperrt das Netlify-Backend) → `research` (`?queue=1`, `?catalog=1`, POST mit `failed`). Die Funktion akzeptiert dafür neben `x-research-token` auch `x-discovery-secret`. Details: `docs/DOSSIER.md`.
- `indices-snapshot.yml` schreibt täglich (21:47 UTC) die Tabellen des Markets-Reiters „Indices“ als Google Sheet „Indices Snapshot“ (Blätter „Branchen“ und „Länder“) in den Drive-Ordner „Wertpapiere“ — `tools/indices-snapshot/run.mjs`, nutzt `ui/lib/tv-indices.js` (`fetchIndexRows`) über die scrape-proxy und dieselben Google-Secrets wie das Dossier. Die Datei wird in place überschrieben; Ordner per Variable `INDICES_FOLDER_ID`. Eine neue Index-Gruppe in `INDEX_GROUPS` wird automatisch als weiteres Blatt übernommen.

## Alerts (`check-alerts`, alle 20 min, 7–21 UTC)
Die App ist die einzige Quelle für Levels und Alarme (`range_override`, `range_alarm`, `wr_sup_/wr_res_<id>`).
`check-alerts` importiert dafür `ui/lib/range-levels.js`, `range-alarm.js` und `eur-basis.js` direkt, die Rechnung
kann also nicht auseinanderlaufen.
- **Alarm vs. Bruch:** Alarm feuert bei Berührung des Levels (Push „erreicht"). Bruch = > 0,5 % jenseits
  (`rangeView`): zweiter Push „gebrochen", danach stehen die Alarme auf den neuen Levels. Gleicher Bruch
  höchstens alle 24 h (Blob `discovery-range-breaks`, der erste Lauf merkt sich nur den Stand). Fällt
  beides in einen Lauf, geht nur der Bruch-Push raus. Zwischen Level und 0,5 % bleibt der Alarm stehen.
- **Manuelle Levels:** gelten in Liste, Chart und Alarm, bis sie reissen. Dann löscht `check-alerts` die Seite aus
  `range_override`, es gilt wieder auto (auch ohne Alarm, deshalb prüft der Lauf alle Titel mit `range_override`).
  Gesetzt werden sie im Alert-Fenster (`trigger-modal.js`, Knöpfe Support/Resistance über dem Preisfeld, Feld leer
  = auto mit Alarm) oder im Range-Modal. Löschen eines Range-Alarms im Alert-Fenster nimmt beide Seiten und `range_alarm`.
- **Ausschläge:** Preisalarme prüfen alle LS-Kurse seit dem letzten Lauf (`wickHits`), ein Alarm nur Kurse nach
  seinem `created_at`. **LS-Zeitstempel sind Berliner Ortszeit, nicht UTC** (`berlinOffsetMs`).
- **Währung:** `toEur` rechnet SEK/GBX über `eurBasisFactor`; ohne Basis `null` statt Heimatwährung gegen EUR.
- `watch-alarms.js` und `tools/watch-ranges/alarm_sync.py` gehören zum alten Artefakt-Abgleich und sind
  nicht mehr die Quelle: Läuft der Abgleich noch, überschreibt `check-alerts` ihn im nächsten Lauf.

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
