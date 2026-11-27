# Backtest Analystenmeldungen (Stand 3. Nov. 2026)

**Frage:** Bewegen Analystenaktionen Kurse, und läuft danach noch etwas nach?
**Ergebnis:** Die Reaktion ist stark und fällt am Tag selbst an. Eine verlässliche Nachdrift
gibt es nicht. Das Signal bleibt deshalb Erklärung im Briefing und geht nicht in Score oder Alarme.

## Daten und Methode
- 433 US-Titel aus dem Monitor (Stand 2.11.2026), Yahoo `upgradeDowngradeHistory` mit 84.996 Meldungen, Tageskurse 3.11.2016 bis 2.11.2026.
- Überrendite gegen das gleichgewichtete eigene Universum, abzüglich des Titelmittels. Die Gegenprobe gegen SPY ändert das Bild nicht.
- Tag 0 = erster Handelstag, an dessen Schluss die Meldung bekannt war. Nachdrift misst ab Schluss Tag 1, also ab dem ersten Kurs nach dem Briefing.
- Je Titel, Tag und Art eine Beobachtung. Tage mit mindestens 4 Häusern gelten als Zahlen-Tage und fallen samt Umfeld raus.
- t-Werte auf Monatsmittel mit Newey-West. Placebo: dieselben Titel, um 6 bis 13 Monate versetzt.

## Ergebnis ohne Zahlen-Tage
| Aktion | n | 5 Tage davor | Reaktion Tag 0 | Tag 1 | Tag 2–6 | Tag 2–21 | Tag 2–61 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Hochstufung | 4.185 | +0,26 % | **+2,22 %** (t 28,6) | +0,02 % | −0,05 % | −0,38 % (t −0,9) | −0,47 % (t −0,5) |
| Abstufung | 3.749 | −0,44 % | **−2,54 %** (t −23,1) | −0,07 % | −0,01 % | −0,09 % (t −0,1) | +0,06 % (t 0,1) |
| Erstbewertung | 5.076 | +0,13 % | +0,55 % (t 9,0) | +0,01 % | −0,15 % | +0,07 % | −0,29 % |
| Kursziel hoch | 17.322 | **+1,80 %** | +0,57 % (t 8,2) | −0,07 % | −0,12 % | −0,30 % (t −0,6) | −0,43 % (t 0,6) |
| Kursziel runter | 10.602 | **−1,92 %** | −0,54 % (t −8,2) | +0,03 % | −0,03 % | −0,50 % (t −1,4) | −1,34 % (t −1,7) |

- **Einstufungen bewegen Kurse**, am stärksten bei kleinen Titeln (Hochstufung +3,9 %, Abstufung −4,4 %) und schwächer bei grossen (+1,7 %, −1,9 %).
- **Kursziele laufen dem Kurs hinterher:** Sie folgen 5 Tagen mit rund 2 % Bewegung in dieselbe Richtung und bringen selbst wenig.
- **Keine Nachdrift bei Hoch- und Abstufungen**, auch nicht in beiden Zeiträumen (bis 2022, ab 2023) oder nach starker Tagesreaktion.
- **Einziger Kandidat: Häufung nach unten** (ab 3 Häusern in 5 Tagen, n = 1.039): −0,29 % in 5 Tagen (t −2,4), −1,18 % in 20 Tagen (t −2,2), in beiden Zeiträumen negativ, über 60 Tage nicht mehr gesichert.
- **Mehrfachtest:** 6 von 96 geprüften Nachdrift-Zellen erreichen |t| ≥ 2. Rund 5 wären reiner Zufall.

## Grenzen
- Das Universum ist die heutige Liste. Überlebende und frühere Gewinner sind überrepräsentiert; der Abzug des Titelmittels mildert das nur.
- Zahlen-Tage sind geschätzt, nicht aus einem Kalender. Bei wenig beobachteten Titeln rutscht Nachlauf durch.
- Die Reaktion zeigt keine Ursache: Am selben Tag können andere Nachrichten gewirkt haben.
- Das Placebo streut unabhängig und unterschätzt die Unsicherheit. Massgeblich sind die t-Werte.
- Deutschland: nur 59 Meldungen seit Dez. 2025 aus dem Feed, zu wenig für eine Aussage. Yahoo führt dort keine Historie.

## Folgen
- Score und Alarme bleiben ohne Analystensignal.
- `Häufung nach unten` wird live weiter beobachtet (`analyst.clusters`). Neu bewerten, wenn eigene Daten aus mindestens 12 Monaten vorliegen, auch für Deutschland.

## Wiederholen
`tools/analyst-backtest/`: In einem leeren Arbeitsordner `universe.json` ablegen (`stocks` aus „Discovery Monitor – vollständig.json“), dann `node fetch.mjs`, danach `python3 -I backtest.py` (braucht numpy).
