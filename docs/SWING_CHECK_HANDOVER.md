# Übergabe: Swing-Check (TwelveData) im Detail-Modal — Discovery

> Handover für einen frischen Claude-Code-Chat. Self-contained: setzt keinen
> Kontext aus vorherigen Sessions voraus.

## Ziel (Scope, eng gefasst)
Ein **Swing-Check pro Einzel-Ticker**, **nur im Detail-Modal** von Discovery,
**on-demand per Button**. Ergebnis: berechnete **Swing-Zonen**
(Support/Resistance) plus aktuelle Kursposition, dargestellt als **grafische
Range-Visualisierung** (Preis-Leiter). Kein Bulk, keine Tabellen-Spalte, kein
Dauer-Polling.

## Repos
- **`discovery`** — hier wird das Feature gebaut (Detail-Modal).
- **`merkliste`** — nutzt TwelveData bereits. **Erster Schritt: dort die
  bestehende TwelveData-Integration studieren** (Key-Handling, Call-Aufbau,
  Fehler-/Limit-Behandlung, evtl. Proxy) und in Discovery **dasselbe Muster
  wiederverwenden**, statt neu zu erfinden. (Optionale Kür: dieselbe Viz später
  in merkliste portieren — nicht Teil dieser Aufgabe.)

## Discovery-Architektur (was der neue Chat wissen muss)
- Plain HTML/CSS/ES-Module-Frontend, **kein Build-Step**, kein TS/React/Bundler
  (bewusste Einfachheit, siehe `CLAUDE.md`).
- **Cache-Busting-Pflicht:** ES-Modul-Imports tragen `?v=YYYYMMDDx`. Wird eine
  Datei geändert, muss ihre Versionsnummer in **allen** Importstellen und in
  `ui/index.html` (`app.js`, `styles.css`) hochgezählt werden.
- **Git-Flow:** auf dem Feature-Branch entwickeln, dann in `main` mergen, beide
  pushen (Konventionen des Repos befolgen).
- **Backend:** Netlify Functions. `scrape-proxy` hat eine Domain-Allowlist —
  **`api.twelvedata.com` ist bereits allowlisted**
  (`netlify-backend/netlify/functions/scrape-proxy.js`). **Keine**
  Backend-Änderung nötig → kein Netlify-Deploy.
- **CLAUDE.md-Regeln beachten:** „inspect real API responses before parsing",
  keine bezahlten APIs (TwelveData Free reicht), Netlify-Deploys vermeiden.

## TwelveData — verifizierte Fakten (an echter Response geprüft)
- Endpoint
  `GET https://api.twelvedata.com/time_series?symbol=…&interval=1day&outputsize=…&apikey=…`.
- Response: `{ meta, values:[{datetime, open, high, low, close, volume}], status }`
  — **echtes OHLC + Volumen**, tägliche Bars (auch `1week` etc. möglich).
- **Free-Tier: nur US-Werte.** EU/DE (XETR etc.) gehen **nicht** (bestätigt).
  → Feature muss Nicht-US-Ticker sauber abfangen.
- Free-Limits (gegen aktuellen Plan gegenchecken): typ. **8 Req/min,
  800 Credits/Tag**; 1 Symbol = 1 Credit. Single-Ticker-on-demand ist
  unkritisch, aber **TD-Fehlercodes 429 / „out of API credits" abfangen**.
- Key liegt in `localStorage` unter **`discovery_twelvedata_key`**.
  Symbol-Auflösung per ISIN existiert schon: `resolvePrimaryByIsin` in
  `ui/lib/symbol-search.js` (ruft TD) — für die TD-taugliche Symbol/MIC-Auflösung
  wiederverwenden.
- `demo`-Key funktioniert nur für AAPL (Familiarisierung); echte Tests brauchen
  den Nutzer-Key.

## Datenabruf-Spec
- **Nur wenn US-Ticker:** vorher prüfen (normalisierte `exchange` ∈
  {NASDAQ, NYSE, AMEX} bzw. TD-`mic_code`). Sonst gar nicht callen → klare
  Meldung „Swing-Check: nur US-Titel (TwelveData Free)".
- **Params:** `interval=1day` (Default), `outputsize≈250` (~1 Handelsjahr).
  Optional Umschalter `1week` (langlebigere Zonen, s. u.).
- **Zugriffspfad:** dem Muster aus `merkliste`/`symbol-search.js` folgen
  (Proxy vs. direkt). Empfehlung: über den bestehenden `scrape-proxy` (Domain
  schon allowlisted), Key als Query-Param.
- **Symbol/MIC:** via `resolvePrimaryByIsin(isin)` oder `symbol`+`mic_code`. Bei
  TD-Fehler/leer → graceful (kein Crash, Meldung).

## Swing-Berechnung (clientseitig — neue Lib, z. B. `ui/lib/tv-swings.js`)
1. **Fractal-Pivots** über OHLC: Swing-Hoch = Bar, dessen `high` das Maximum in
   ±k Bars ist; Swing-Tief = Bar, dessen `low` das Minimum in ±k Bars ist.
   **k = 3** als Default (Sensitivität vs. Rauschen).
2. **Zonen bilden:** nahe beieinanderliegende Level zu Bändern mergen (Toleranz
   z. B. 0,5×ATR oder ~1,5 %), `touches` (Anzahl Berührungen) als Signifikanz.
3. **Referenzkurs:** Live-**LS-Kurs** falls vorhanden (`candidate.ls_quote.price`),
   sonst letzter TD-Close.
4. **Nächste Zonen:** nächster **Support** (unter Kurs), nächster **Resistance**
   (über Kurs); Abstand in % und in ATR.
5. **Struktur:** letzte zwei Swing-Hochs + zwei Swing-Tiefs → HH/HL = `up`,
   LH/LL = `down`, sonst `range`.
6. **ATR(14)** aus OHLC für Abstandsnormierung.
7. Kompaktes Ergebnis zurückgeben (unten), **nicht** die Rohbars persistieren.

## Gültigkeit & Refresh (in die Logik einbauen)
- **Bestätigte Swing-Level ändern sich nie rückwirkend** → als Fakten gültig,
  **bis gebrochen** (Kurs schließt klar jenseits) — typ. Wochen–Monate.
- **Struktur-Snapshot** basiert auf Tagesbars → materiell erst mit dem
  **nächsten Tagesschluss** neu; also **~1 Handelstag valide** (Weekly:
  ~1 Woche).
- **Intraday kein TD-Refresh nötig** — die Kursposition gegen die (fixen) Level
  liefert der Live-LS-Kurs.
- **Caching:** `swing_analysis.checked_at` stempeln; im UI **„veraltet"-Hinweis**,
  wenn älter als 1 Handelstag (Daily) bzw. 1 Woche (Weekly), plus
  **Event-Invalidierung**, wenn der Live-LS-Kurs eine gespeicherte Zone kreuzt.
  Ergebnis persistieren (überlebt Modal-Schließen), Re-Run nur auf Button.

## Storage-Schema (auf dem Candidate, z. B. `candidate.swing_analysis`)
```
{
  source: 'twelvedata', interval: 'daily'|'weekly',
  domain: { low, high },                 // Achsen-Bounds = Fenster-Min/Max
  ref_price, atr,
  structure: 'up'|'down'|'range',
  resistance: [{ lo, hi, mid, touches }],// Zonen über Kurs
  support:    [{ lo, hi, mid, touches }],// Zonen unter Kurs
  nearest_res, nearest_sup,
  bars, checked_at
}
```
Persistenz best-effort via
`storageClient.updateCandidate(currentBlobType, id, { swing_analysis })`.

## UI-Spec (Detail-Modal)
- **Ort:** `ui/components/candidate-detail.js`, neuer Abschnitt
  `<div class="detail-section">` „Swing-Analyse".
- **Button:** „📐 Swing-Check" (analog zu bestehenden Detail-Buttons).
  Ladezustand + `checked_at`/„veraltet"-Hinweis. Bei Nicht-US:
  Button deaktiviert/Erklärtext.
- **Range-Viz (Inline-SVG, vertikale Preis-Leiter):**
  - Y-Achse = Preis von `domain.low`…`domain.high`.
  - **Resistance-Zonen** als rötliche Bänder, **Support-Zonen** grünlich;
    Bandbreite = Zonen-`lo..hi`, Deckkraft/Label optional nach `touches`.
  - **Aktueller Kurs** als markante horizontale Linie/Marker (Live-LS-Preis) mit
    Label.
  - Nächster S/R beschriftet; Abstand in % und ATR als Text daneben.
  - Muster/Helfer analog zur bestehenden Sparkline
    (`ui/components/intraday-modal.js`: `SPARK`/`sparkBounds`,
    `vector-effect:non-scaling-stroke`, `--pos`/`--neg`-Farbvariablen). Styles in
    `ui/styles.css`, `prefers-reduced-motion` respektieren.
- **Synergie:** Zonen aus TwelveData, Live-Position aus dem LS-Kurs — keine
  TD-Nachladung fürs „nähert sich Level".

## Dateien (Discovery)
- `ui/lib/tv-swings.js` — **neu**: Fetch (TD via Proxy) + Pivot/Zonen/Struktur/ATR.
- `ui/components/candidate-detail.js` — Swing-Abschnitt, Button, Viz-Render,
  Persistenz-Callback.
- `ui/styles.css` — Viz- und Zonen-Styles.
- `ui/index.html` + betroffene Importe — Cache-Bust-Versionen hochzählen.
- **Nicht** anfassen: `netlify-backend/` (Proxy-Domain schon allowlisted).

## Edge-Cases / Fehlerbehandlung
- Kein TD-Key gesetzt → Hinweis „TwelveData-Key in Einstellungen".
- Nicht-US / TD leer / 404 → „nur US-Titel (Free-Tier)".
- TD 429 / Credits erschöpft → freundliche Meldung, Ergebnis-Cache stehen lassen.
- Zu wenige Bars für Pivots (< 2k+1) → „zu wenig Historie".
- Zahlen kommen als **Strings** aus TD → `Number()` parsen.

## Nicht-Ziele
Kein Bulk/Spalte, kein Auto-Refresh/Play, kein Intraday-TD, keine EU-Werte,
keine Backend-Änderung.

## Abnahme-Checkliste
1. US-Ticker (z. B. AAPL) im Detail-Modal: Button → Zonen + Kursmarker
   erscheinen, `checked_at` gesetzt.
2. Nicht-US-Ticker: klare Meldung, **kein** API-Call.
3. Ergebnis überlebt Modal-Schließen (persistiert); „veraltet"-Hinweis nach
   >1 Handelstag.
4. Live-LS-Kursmarker sitzt korrekt in der Range; nächster S/R stimmt mit den
   Zonen.
5. Fehlerpfade (kein Key, 429, zu wenig Historie) sauber abgefangen.
6. Cache-Bust-Versionen erhöht; keine `netlify-backend/`-Änderung.
