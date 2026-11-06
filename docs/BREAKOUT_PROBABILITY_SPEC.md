# Breakout Probability Signal — Übergabe für Claude Code

## Datenquellen
- **Blob History** (primär): `history[symbolId].snapshots[]` — liefert echten Verlauf für Range/Pattern/Volumen, TV-Snapshot-Felder liefern nur Momentaufnahmen
- **TV Fetch (ergänzend)**: `ChaikinMoneyFlow` (20), `VWAP`, `relative_volume_10d_calc`, `average_volume_10d_calc`, `RSI`, `BB.upper/BB.lower`, `DonchCh20.Upper/Lower` — keine nativen MFI/OBV/AD/Breakout-Felder vorhanden, daher Money-Flow-Näherung selbst aus Blob-OHLCV berechnen

## Einschränkung
- "Extended Ranges (2+ Wochen)" braucht ~14-15 Handelstage Historie, Blob liefert aktuell 10D → mit vorhandenem Fenster arbeiten, ggf. History-Fenster auf 15D erweitern (Rücksprache nötig)

## Aufgabe
`detectBreakoutSetup(snapshots)` → `breakoutProbabilityPct` (0-100, Heuristik, keine statistisch kalibrierte Wahrscheinlichkeit) + Kriterien-Detail

## Prüfkriterien

**1. Extended narrow range**
- `ranges = snapshots.map(s => (day_high-day_low)/close)`
- Range über gesamtes Fenster durchgängig eng (z.B. `max(ranges) < 1.5x median(ranges)`, keine Ausreißer-Tage)
- Bonus falls `day_high`-Werte der letzten Tage eng clustern (flat top, siehe Kriterium 4)

**2. Volumenbestätigung**
- `volSpike3d/5d/10d`: aktuelles Volumen vs. `average_volume_10d_calc` bzw. gleitender Schnitt der letzten 3/5/10 Tage — Ausreißer nach oben am Ende des Fensters
- **1-Day Money Flow** (approximiert, da keine MFI/OBV-Felder verfügbar):
  `MFM = ((close-day_low)-(day_high-close)) / (day_high-day_low)`
  `MFV = MFM * volume`
  → letzter Tag `MFV` deutlich positiv = bullisher Kaufdruck am Ausbruchstag
- Cross-Check optional: TV `ChaikinMoneyFlow` aktueller Wert > 0 und steigend

**3. Overbought = kein Ausschlusskriterium**
- `RSI` (TV) hoch (>70) darf NICHT negativ gewertet werden — explizit im Code kommentieren, kein Penalty-Term dafür einbauen

**4. Flat Top / Bull Flag Erkennung**
- `highs = snapshots.map(s => s.day_high)`, `lows = snapshots.map(s => s.day_low)`
- Flat Top: letzte 3-5 `day_high`-Werte innerhalb enger Toleranz (z.B. ±1%)
- Steigende Lows: `lows` über Fenster tendenziell steigend (z.B. lineare Regression Steigung > 0, oder `lows.slice(-3)` jeweils ≥ vorheriger)
- Kombination Flat Top + steigende Lows = Bull-Flag/Ascending-Triangle-Muster → starkes Einzelkriterium

## Wahrscheinlichkeits-Mapping (Heuristik)
- Basis 0%, je erfülltes Kriterium +20-30 Punkte (Gewichtung: Flat-Top-Pattern und Volumenbestätigung am höchsten, da im Text als "Look for" hervorgehoben)
- Kappen bei 90% (nie 100%, da Heuristik keine Garantie)
- Als Kommentar im Code: Gewichtung ist Startpunkt, keine Backtest-kalibrierten Werte

## Output
```js
{
  breakoutProbabilityPct: number,     // 0-90
  criteria: {
    extendedNarrowRange: boolean,
    volumeConfirmation: boolean,
    moneyFlowBullish: boolean,        // letzter Tag MFV positiv
    flatTopBullFlag: boolean
  },
  details: {
    rangeStats: { min, max, median },
    volSpikeRatio: number,
    lastDayMFV: number,
    highsCluster: number[],           // letzte n day_high Werte
    lowsSlope: number
  }
}
```

## Anzeige
- Spalte "Breakout %": `breakoutProbabilityPct`
- Optional Tooltip/Detail-Spalte: erfüllte Kriterien als Kurzcode (z.B. "Range+Vol+Flag")

## Sonstiges
- Reine Funktion, kein API-Call
- RSI/Overbought-Status separat anzeigen, aber nicht in Score einrechnen
