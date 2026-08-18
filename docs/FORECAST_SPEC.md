# Forecast — 6-Monats-Szenarien (Prog.-Tab)

Umsetzung: `ui/lib/tv-forecast.js` (reine Rechnung) + `renderForecastTab` /
`initForecastChart` in `ui/components/candidate-detail.js` (Darstellung).

Der Tab zeigt **3 Monate echten Verlauf** (Tageskerzen wie im Perf-Tab) und
daran anschließend **6 Monate Projektion** als drei gestrichelte Kurven, dazu
ATH und Fair Value als waagerechte Linien.

> Das ist **keine Prognose**, sondern die Fortschreibung von Drift und
> Volatilität, gebremst an der vorhandenen Kursstruktur. Jede Zahl im Tab folgt
> aus den drei Eingängen unten — es steckt kein Modell dahinter, das gelernt
> hätte, wohin ein Kurs läuft.

## 1. Das Skelett

Alle drei Szenarien entstehen aus einer Formel, gerechnet im Log-Raum (damit
−40 % und +67 % symmetrisch sind und kein Pfad negativ werden kann):

```
p_s(t) = p0 · exp( μ·t  +  m_s · σ_d · √t )        t = 1 … 126 Handelstage
```

| Größe | Bedeutung | Quelle |
|---|---|---|
| `p0` | Startpreis, für **alle drei** Szenarien derselbe | LS/TR-Kurs (EUR → Anzeigewährung), sonst TV-Close |
| `μ` | Log-Drift je Handelstag | ØGr/M aus Perf.1M/3M/6M (50/30/20), gedämpft ×`DRIFT_DAMPING` (0,5) |
| `σ_d` | Tages-Volatilität | ATRP/100 × `SIGMA_FROM_ATRP` (0,8); Fallbacks ATR/Preis, Volatility.M/D |
| `m_s` | Sigma-Vielfaches des Szenarios | siehe unten, Bias-dynamisch |

Zwei Entscheidungen, die den Unterschied machen:

- **`√t` statt `t` beim Vol-Term.** Der Fächer öffnet sich wie ein Diffusions-
  kegel. Linear skaliert wäre er nach 6 Monaten absurd breit (ATRP 2 % ⇒ ±250 %
  statt ±18 %).
- **Drift gedämpft ×0,5.** Dieselbe Dämpfung wie in `tv-upside.js`: Momentum
  kehrt zurück, eine ungedämpfte Fortschreibung von Perf.1M über ein halbes Jahr
  ist Unsinn.

## 2. Die drei Szenarien

Mit `k = Bias/100` (Bias aus `tv-sentiment.js`, −100 … +100):

| Szenario | `m_s` | Lesart |
|---|---|---|
| **Breakout** | `+(1,0 + 0,5·max(k,0))` | +1,0σ … +1,5σ über der Drift |
| **Status Quo** | `0` | reine ØGr/M-Fortschreibung ab dem LS/TR-Kurs |
| **Breakdown** | `−(1,0 + 0,5·max(−k,0))` | −1,0σ … −1,5σ unter der Drift |

Der Bias verlängert also **nur den Ast in seine eigene Richtung**: bei Bias +60
läuft der Breakout-Ast mit 1,3σ, der Breakdown-Ast bleibt bei 1,0σ. Der Fächer
kippt mit der Marktlage, ohne dass eine Richtung behauptet wird.

## 3. Struktur bremst, der Extremwert deckelt

Auf den Rohpfad wird eine monotone, stückweise lineare Bremse angewandt
(`applyBrakes`). Steigung je Abschnitt: `max(0,5^k, MIN_SLOPE)` mit
`MIN_SLOPE = 0,25` — der gezeigte Pfad läuft bis zum ersten Level ungebremst,
für den Weg zum zweiten braucht er die doppelte Rohstrecke, danach die
vierfache.

**Gerechnet wird auf der Ausgabeseite.** Die Knickpunkte liegen bei den echten
Levels, nicht auf einem unsichtbaren Rohpfad — nur so bedeutet „gebremst
101,00", dass die gezeichnete Kurve diese 101,00 auch erreicht hat. (Die erste
Fassung rechnete umgekehrt und meldete Bremslevel *oberhalb* des Ziels.)

`MIN_SLOPE` ist kein Schönheitsfaktor: ohne die Untergrenze steht der Pfad bei
einem Titel mit sieben dicht liegenden Levels faktisch still (0,5⁷ ≈ 0,008).
Eine Zone kostet Zeit, sie friert den Kurs nicht für ein halbes Jahr ein.

| Seite | Bremslevel | harte Grenze |
|---|---|---|
| aufwärts | Resistance-Zonen (`swing_analysis.resistance`), High 1M/3M/6M, 52W-Hoch | **ATH** (`high_all`) |
| abwärts | Support-Zonen (`swing_analysis.support`), Low 1M/3M/6M | **52W-Tief** |

Levels näher als `LEVEL_MERGE_PCT` (2 %) beieinander sind dieselbe Zone — sonst
stapeln sich drei Schreibweisen desselben Hochs zu einer dreifachen Bremse.
Liegt der Kurs bereits über dem ATH (Blue Sky), entfällt der Deckel; die
ATH-Linie bleibt als Referenz stehen.

## 4. Wahrscheinlichkeiten

Aus derselben Lognormal-Annahme, auf die **angezeigten** (gebremsten) Ziele:

```
P(Breakout)  = 1 − Φ(z_up)      P(Breakdown) = Φ(z_dn)
P(Status Quo) = Rest            z = (ln(Ziel/p0) − μ·n) / (σ_d·√n)
```

Die drei Werte ergänzen sich damit zu 100 % und beantworten „wie weit trage ich
das Ziel neben der Kurve?". Sie sind so gut wie ihre Eingänge — eine kalibrierte
Trefferquote ist das nicht.

## 5. Kurzfrist-Setup (LS)

Unter der Szenario-Tabelle stehen die beiden Heuristiken aus
`ls-history-signals.js` (`detectBreakoutSetup` / `detectBreakdownRisk`, 10 Tage
LS-Historie, max. 90 %). Sie messen **ein Setup von heute**, nicht den
6-Monats-Pfad — deshalb eigener Block mit eigener Zeitangabe und bewusst nicht
in die Szenario-Zeilen gemischt.

## 6. Währung (die häufigste Fehlerquelle)

`tv-forecast.js` rechnet währungsfrei: σ und μ sind relativ, alle absoluten
Preise kommen **in einer Währung** herein. Die Umrechnung passiert in
`forecastInput()`:

| Eingang | Umrechnung |
|---|---|
| Bars / Swing-Zonen (Yahoo oder TD, native Bar-Währung) | `barsDisplayFactor` |
| LS-Kurs (immer EUR) | `lsDisplayFactor` |
| `tv_data` (ATH, 52W, Hochs/Tiefs, Fair Value) | steht in `disp.tv` bereits umgerechnet |

Ist die Bar-Währung nicht in die Anzeigewährung überführbar (wir haben nur
USD↔EUR), fallen nur die Zonen weg — die Szenarien rechnen aus `tv_data` weiter.

## 7. Chart

Lightweight Charts 4.2 (vendored). Der Chart entsteht **erst beim Öffnen des
Tabs**: alle Tab-Panels liegen gleichzeitig im DOM, ein verstecktes ist 0 px
breit und der Chart zeichnete ins Leere.

Die Fächer-Fläche (grün zwischen Breakout und Status Quo, rot zwischen Status
Quo und Breakdown) sowie die senkrechte Trennlinie „hier endet die Messung"
liegen in einem **Series-Primitive** (`forecastFanPrimitive`): Lightweight
Charts kann keine Füllung zwischen zwei Serien. Das Primitive rechnet die Pfade
bei jedem Zeichnen neu in Pixel um, damit Zoom und Scroll stimmen; fehlt
`attachPrimitive` (ältere Version), bleiben die drei Linien allein stehen.

Fehlen die Tageskerzen, zeigt der Chartbereich denselben Ladeweg wie der
Perf-Tab (`tdQuote`, ein Abruf versorgt beide Tabs) — die Szenario-Tabelle
rechnet auch ohne sie.
