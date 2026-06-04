# Adapter-Erweiterung – Prompt-Template für Claude Code

Kopiere dieses Template, ersetze die Platzhalter und nutze es als Auftrag in Claude Code.

---

## Template

```
Adapter-Erweiterung: [ADAPTER_NAME]

### Ziel
[Kurze Beschreibung: z.B. "Yahoo Finance: neuer Screen 'Growth Stocks' hinzufügen"]

### Datenquelle
- URL / API Endpoint: [z.B. https://finance.yahoo.com/screener/growth]
- Authentifizierung: [None / API Key / Bearer Token]
- Proxy nötig?: [Ja / Nein — cloud IPs oft geblockt]

### Zu fetchen
[Was wird vom API/scraper geholt?]
z.B. Symbol, Company Name, Rank, Key Metrics

### Feldmapping zu Candidate
```js
{
  symbol:       // [von woher?]
  exchange:     // [fest oder zu resolven?]
  yahoo_symbol: // [von woher?]
  name:         // [von woher?]
  sources[].signal_type: // [new typ?]
  sources[].info_snippet: // [z.B. "Yahoo Growth Stocks #1"]
}
```

### Code-Ort
- Datei: `adapters/[ADAPTER_FILE].js`
- Neue Funktion hinzufügen: `async function fetch[ScreenName]()`
- In `fetchCandidates()` aufrufen: `[...await fetch[ScreenName]()]`

### Rate Limits / Auth
[z.B. 50ms Verzögerung zwischen Requests]

### Test-Daten
[Optional: 1–2 beispiel-Responses zum Testen anpassen]
```

---

## Beispiel (ausgefüllt)

```
Adapter-Erweiterung: Yahoo Finance

### Ziel
Yahoo Finance: neuer Screen "Most Active" hinzufügen (live Trading-Aktivität)

### Datenquelle
- URL / API Endpoint: https://query1.finance.yahoo.com/v1/finance/trending/US
- Authentifizierung: None (Browser-Headers reichen)
- Proxy nötig?: Ja (cloud IPs geblockt)

### Zu fetchen
Symbole mit höchstem Volumen-Umsatz der letzten 24h.
Response-Struktur: JSON mit `quotes[]` array, jeder mit `symbol`, `shortName`, `volume`.

### Feldmapping zu Candidate
```js
{
  symbol:       // quotes[].symbol
  exchange:     // null → resolveUSExchange(symbol)
  yahoo_symbol: // quotes[].symbol
  name:         // quotes[].shortName || symbol
  sources[].signal_type: "page_view_trending"
  sources[].info_snippet: "Yahoo Most Active #1"
  sources[].raw_signal: { rank, screen: "most_active", volume }
}
```

### Code-Ort
- Datei: `adapters/yahoo-trending.js`
- Neue Funktion: `async function fetchMostActive()`
- In `fetchCandidates()`: `const results = [...await fetchTrending(...), ...await fetchMostActive(...)];`

### Rate Limits / Auth
50ms delay zwischen Requests (wie existing Screens)

### Test-Daten
Top 3 (SMCI, 4689, AAPL mit volumes 500M+)
```

---

## Durchfluss

1. **Template ausfüllen** (5–10 Min)
2. **In Claude Code Fenster kopieren** als Auftrag
3. **Claude Code implementiert**:
   - neue Fetch-Funktion
   - in `fetchCandidates()` eingebunden
   - Proxy/Auth korrekt
   - zu Backend geschrieben
4. **Merge zu main** & GitHub Pages deploy
5. **⚡ Button** zeigt neuen Screen in der Liste

