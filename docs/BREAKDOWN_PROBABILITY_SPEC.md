# Breakdown Probability Signal — Übergabe für Claude Code

## Datenquellen
- **Blob History** (primär): `history[symbolId].snapshots[]` — Volumen-/Preisverlauf für Exhaustion-Muster
- **TV Fetch (ergänzend)**: `ChaikinMoneyFlow`, `relative_volume_10d_calc`, `average_volume_10d_calc` als Cross-Check, keine nativen Distribution-/Exhaustion-Felder vorhanden → Money-Flow-Näherung selbst aus Blob-OHLCV (wie beim Breakout-Signal)

## Aufgabe
`detectBreakdownRisk(snapshots)` → `breakdownProbabilityPct` (0-100, Heuristik) + Kriterien-Detail
Fenster: letzte 10 Snapshots (10 Handelstage)

## Prüfkriterien

**1. Single High-Volume Day ohne Follow-Through**
- `volumes = snapshots.map(s => s.volume)`
- Spike-Tag identifizieren: `volumeSpikeIdx` = Index mit `volume > 2x average_volume_10d_calc` (oder `> 2x` Median des Fensters), möglichst in den letzten 5-7 Tagen
- Ab `volumeSpikeIdx+1` bis Fenster-Ende: Folge-Tage prüfen
  - `followVolumes = volumes.slice(volumeSpikeIdx+1)` → alle deutlich niedriger als Spike-Tag (z.B. `< 0.6x` Spike-Volumen)
  - `followChanges = changes.slice(volumeSpikeIdx+1)` → kein Preis-Fortschritt in Spike-Richtung (Summe/Durchschnitt nahe 0 oder gegenläufig)
- Kriterium erfüllt: Spike gefunden UND Folge-Tage sowohl volumenschwach als auch ohne Preis-Follow-Through

**2. High Volume + Flat Price (Distribution Day)**
- Für jeden Tag im Fenster: `volRatio = volume / average_volume_10d_calc`, `priceMove = abs(change_pct)`
- Distribution-Tag: `volRatio > 1.5` UND `priceMove < 0.5%` (hohes Volumen, aber kaum Kursbewegung → Verteilung ohne Fortschritt)
- Zusätzlich **1-Day Money Flow** (wie Breakout-Spec):
  `MFM = ((close-day_low)-(day_high-close)) / (day_high-day_low)`
  `MFV = MFM * volume`
  → Distribution-Tag mit `MFV` nahe 0 oder negativ trotz hohem Volumen = Warnsignal
- Kriterium erfüllt: mind. 1 Distribution-Tag in den letzten 5 Tagen des Fensters gefunden

**3. Kontext: Ausdehnung vor dem möglichen Breakdown**
- Aktueller Kurs relativ zu `max(day_high)` im Fenster: `distFromHigh = (maxHigh - lastClose) / maxHigh`
- Kleiner Wert (Kurs noch nahe Hoch) + Kriterium 1/2 erfüllt = höheres Risiko, da "Ende der Rally" typischerweise nahe der Spitze auftritt
- Kein hartes Ausschlusskriterium, nur Gewichtungsfaktor

## Wahrscheinlichkeits-Mapping (Heuristik)
- Basis 0%, Kriterium 1 (Spike ohne Follow-Through) +35, Kriterium 2 (Distribution Day) +35, Kriterium 3 (Nähe zum Hoch) +20
- Kappen bei 90%
- Kommentar im Code: Startgewichtung, keine Backtest-Kalibrierung

## Output
```js
{
  breakdownProbabilityPct: number,   // 0-90
  criteria: {
    volumeSpikeNoFollowThrough: boolean,
    distributionDay: boolean,
    nearRecentHigh: boolean
  },
  details: {
    volumeSpikeIdx: number|null,
    spikeVolume: number|null,
    followVolumeAvg: number|null,
    followPriceChangeAvg: number|null,
    distributionDays: [{ date, volRatio, priceMove, mfv }],
    distFromHighPct: number
  }
}
```

## Anzeige
- Spalte "Breakdown %": `breakdownProbabilityPct`
- Optional Tooltip: erfülltes Kriterium als Kurzcode (z.B. "Spike+Dist")

## Sonstiges
- Reine Funktion, kein API-Call
- Gleiche `average_volume_10d_calc`/MFV-Logik wie im Breakout-Spec wiederverwenden, nicht duplizieren
