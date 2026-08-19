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
p_s(t) = p0 · exp( D(t)  +  m_s · σ_d · √t )       t = 1 … 126 Handelstage
D(t)   = μ · τ · (1 − e^(−t/τ))                    τ = 63 Handelstage (~3 Monate)
```

| Größe | Bedeutung | Quelle |
|---|---|---|
| `p0` | Startpreis, für **alle drei** Szenarien derselbe | LS/TR-Kurs (EUR → Anzeigewährung), sonst TV-Close |
| `μ` | Log-Drift je Handelstag | ØGr/M aus Perf.1M/3M/6M (50/30/20), gedämpft ×`DRIFT_DAMPING` (0,5) |
| `D(t)` | aufsummierte Drift mit auslaufendem Momentum | `cumulativeDrift`, Halbwertszeit `DRIFT_PERSISTENCE_DAYS` (63) |
| `σ_d` | Tages-Volatilität | ATRP/100 × `SIGMA_FROM_ATRP` (0,8); Fallbacks ATR/Preis, Volatility.M/D |
| `m_s` | Sigma-Vielfaches des Szenarios | siehe unten, Bias-dynamisch |

Drei Entscheidungen, die den Unterschied machen:

- **`√t` statt `t` beim Vol-Term.** Der Fächer öffnet sich wie ein Diffusions-
  kegel. Linear skaliert wäre er nach 6 Monaten absurd breit (ATRP 2 % ⇒ ±250 %
  statt ±18 %).
- **Drift gedämpft ×0,5.** Dieselbe Dämpfung wie in `tv-upside.js`: Momentum
  kehrt zurück, eine ungedämpfte Fortschreibung von Perf.1M über ein halbes Jahr
  ist Unsinn.
- **Drift läuft zusätzlich aus (`τ`).** Ohne das wächst die Drift linear mit `t`,
  der Vol-Term aber nur mit `√t` — bei ØGr/M +6 % (also +43 % über 6 Monate)
  frisst die Drift das ganze −1σ auf, und der **Breakdown-Ast dreht wieder nach
  oben**. Genau dieser Fehler stand in der ersten Fassung live. Mit `τ` bleibt
  kurzfristig `D(t) ≈ μ·t`, langfristig sättigt die Fortschreibung bei etwa drei
  Monaten Momentum — mehr gibt ein Perf-Wert nicht her.

### Zwei Garantien

1. **Reihenfolge:** Breakout ≥ Status Quo ≥ Breakdown. Die Bremsleiter wird je
   Punkt nach dem Vorzeichen von `raw − p0` gewählt (nicht nach dem Szenario) —
   sonst bremst ein Breakout-Ast, der bei stark negativer Drift unter `p0`
   liegt, an Resistances statt an Supports und unterläuft den Status Quo.
2. **Namenstreue:** ein „Breakdown" endet nie über `p0`, ein „Breakout" nie
   darunter. Bei extremer Drift und winziger Volatilität könnte die Rechnung das
   sonst hergeben; der Ast ist dann flach — auffällig, aber ehrlich.

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

| Seite | Bremslevel | stärkste Bremse |
|---|---|---|
| aufwärts | Resistance-Zonen (`swing_analysis.resistance`), High 1M/3M/6M, 52W-Hoch | **ATH** (`high_all`) |
| abwärts | Support-Zonen (`swing_analysis.support`), Low 1M/3M/6M | **52W-Tief** |

Levels näher als `LEVEL_MERGE_PCT` (2 %) beieinander sind dieselbe Zone — sonst
stapeln sich drei Schreibweisen desselben Hochs zu einer dreifachen Bremse.
Liegt der Kurs bereits über dem ATH (Blue Sky), entfällt die Grenze; die
ATH-Linie bleibt als Referenz stehen.

**ATH und 52W-Tief sind die stärkste Bremse, keine Wand** (`BEYOND_BOUND_SLOPE`
= 0,1 ⇒ neues Terrain kostet die zehnfache Strecke). Ein harter Deckel klang
richtig, war es aber nicht: bei einem Titel 1,6 % unter seinem ATH fror er
*jedes* Aufwärtsszenario auf +1,6 % ein — Breakout und Status Quo klebten beide
am selben Wert, und die Wahrscheinlichkeiten kippten (Status Quo 0 %). Dabei ist
der Ausbruch über das ATH bei genau so einem Titel das eigentliche Szenario.

## 4. Wahrscheinlichkeiten

Aus derselben Lognormal-Annahme, auf die **angezeigten** (gebremsten) Ziele:

```
P(Breakout)  = 1 − Φ(z_up)      P(Breakdown) = Φ(z_dn)
P(Status Quo) = Rest            z = (ln(Ziel/p0) − D(n)) / (σ_d·√n)
```

`D(n)` ist dieselbe auslaufende Drift wie im Pfad — sonst passten Zahl und
gezeichnete Kurve nicht zusammen. Die obere Grenze ist `max(Breakout, Status
Quo)`, die untere `min(Breakdown, Status Quo)`: hängen zwei Ziele an derselben
Bremse, fällt der mittlere Bereich auf 0 % zusammen statt negativ zu werden.

Die drei Werte ergänzen sich damit zu 100 % und beantworten „wie weit trage ich
das Ziel neben der Kurve?". Sie sind so gut wie ihre Eingänge — eine kalibrierte
Trefferquote ist das nicht.

## 5. Analysten-Konsens

Als vierte Zeile unter den Szenarien und als Linie im Chart, mit der Spanne
Tief–Hoch als Band über den Projektionsbereich (Ränder gestrichelt, sonst
wäscht die Fläche über den sichtbaren Bereich hinaus aus).

Quelle ist **TradingView** (`pt_average/high/low/median` aus `tv_data`, kommt im
normalen Bulk-Abruf mit, kein Zusatzrequest). Hat TV für den Titel kein Ziel —
ETFs, viele Small Caps —, lässt sich **Yahoo** on demand nachschlagen
(`analyst-targets.js` → `/api/yahoo-analyst`); nur Yahoo kennt die Anzahl der
Schätzungen. Bei TV steht daneben `recommendation_total` — das sind
**Empfehlungen, nicht Kursziel-Schätzungen**, deshalb als „Ratings" beschriftet.

Die Wahrscheinlichkeit der Zeile ist `probAtOrAbove(fc, Ziel)`, also dieselbe
Lognormal-Annahme wie bei den Szenarien — nur so ist das Konsensziel mit ihnen
vergleichbar statt bloss danebengestellt. Sie zählt bewusst **nicht** in die
100 % der drei Szenarien hinein.

Währung: TV-Werte stehen in `disp.tv` und sind damit schon umgerechnet; Yahoo
liefert seine Währung mit und wird über `curDisplayFactor` umgerechnet. Geht das
nicht (wir haben nur USD↔EUR), fällt das Ziel mitsamt Linie weg und eine Notiz
sagt warum — ein EUR-Ziel neben einem USD-Kurs wäre schlimmer als keins.

Das Analysten-Ziel zieht die Preisskala des Charts mit (`autoscaleInfoProvider`),
sonst läge die Linie oft knapp ausserhalb. ATH und Fair Value tun das bewusst
nicht: ein Fair Value von 329 bei Kurs 88 würde den Chart zusammenstauchen —
sie werden stattdessen in der Legende als „(außerhalb)" markiert.

## 6. Kurzfrist-Setup (LS)

Unter der Szenario-Tabelle stehen die beiden Heuristiken aus
`ls-history-signals.js` (`detectBreakoutSetup` / `detectBreakdownRisk`, 10 Tage
LS-Historie, max. 90 %). Sie messen **ein Setup von heute**, nicht den
6-Monats-Pfad — deshalb eigener Block mit eigener Zeitangabe und bewusst nicht
in die Szenario-Zeilen gemischt.

## 7. Währung (die häufigste Fehlerquelle)

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

## 8. Chart

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
