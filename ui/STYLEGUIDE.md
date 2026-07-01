# Discovery UI – Styleguide

Verbindliche Design-Regeln für alles unter `ui/`. Vor jeder UI-Änderung lesen.
Dies ist die Design-Ebene zu den Architektur-Vorgaben in
[`../CLAUDE.md`](../CLAUDE.md) – siehe dort **„Key Design Decisions"** (kein
Build-Step, Plain HTML/CSS/ES-Module, bewusste Einfachheit) und **„Diagnose
before you assume it's a bug"** (fehlendes UX-Affordance statt Bugfix).

> **Arbeitsweise (Pflicht):** UI-Änderungen werden **erst hier im Chat als
> Visual/Plan abgestimmt**, dann gebaut. Keine spekulativen Umsetzungen.

---

## 0. Grundprinzipien

1. **Token-first.** Nie feste Pixel/Hex-Werte im Markup oder in neuen Regeln.
   Immer die Tokens aus `styles.css` (`:root`) verwenden. Ein hartes
   `font-size: 22px` ist ein Fehler – es gibt `--fs-*`.
2. **Ein einziges Icon-System.** Immer **Lucide** über `ui/lib/icons.js`.
   **Keine Emoji** als UI-Icons.
3. **Links sind Icons.** Externe Links werden als Icon/Logo ohne Textlabel
   dargestellt (`title` + `aria-label` tragen die Bedeutung).
4. **Wiederverwenden statt neu erfinden.** Es gibt bereits `.btn`, `.icon-btn`,
   `.link-chip`, `.id-ind`, `.modal-*`. Neue Komponenten nur, wenn nichts passt.
5. **Lesbarkeit vor Dichte.** Lieber ein klar lesbarer Block als viele winzige.

---

## 1. Design-Tokens (Quelle: `styles.css` `:root`)

Immer diese Tokens nutzen, nie die Rohwerte hardcoden.

### Farben
| Token | Bedeutung |
|---|---|
| `--bg`, `--surface`, `--surface-2`, `--surface-3` | Flächen (hell → dunkler gestuft) |
| `--text`, `--muted` | Text primär / sekundär |
| `--border` | Rahmen |
| `--accent`, `--accent-weak` | Primärakzent (Links, aktive Tabs, Primär-Buttons) |
| `--pos`, `--pos-weak` | positiv (Kursplus, Promote) |
| `--neg`, `--neg-weak` | negativ (Kursminus, Dismiss) |
| `--warn` · `--ai`, `--ai-weak` | Warnung · KI-Enrichment |

Alle Farb-Tokens haben eine `[data-theme="dark"]`-Variante – **nie** eine feste
Farbe setzen, die im Dark-Mode bricht (mein alter `#16a34a`/`#dc2626`-Hack war
falsch; nutze `--pos`/`--neg`).

### Spacing · Radius · Typo
| Gruppe | Tokens |
|---|---|
| Spacing | `--s-1:4` `--s-2:8` `--s-3:12` `--s-4:16` `--s-5:24` |
| Radius | `--r-1:4` `--r-2:8` `--r-pill:999` |
| Schriftgrößen | `--fs-1:14` `--fs-2:15` `--fs-3:16` `--fs-4:17` `--fs-5:19` `--fs-6:21` |
| Schriftgewicht | `--fw-reg:400` `--fw-med:500` `--fw-bold:700` |
| Fonts | `--font-ui` (DM Sans), `--font-mono` (DM Mono) |
| Motion | `--t-fast:0.12s` |

Zahlenkolonnen immer mit `font-variant-numeric: tabular-nums`.

---

## 2. Typografie & Wert-Blöcke

### Der Stat-Block (Label + Wert(e) gestapelt)
Kanonische Reihenfolge in einem Datenblock (z. B. Index-Kachel):

```
Label       ← klein, --muted, --fw-bold, leicht gesperrt   (--fs-1)
Hauptwert    ← groß, --fw-bold, tabular-nums                (z. B. --fs-5)
Nebenwert    ← IMMER kleiner als der Hauptwert darüber      (eine Stufe kleiner)
```

**Harte Regel:** Ein Wert in der **zweiten Zeile** eines Blocks ist **genau eine
Font-Stufe kleiner** als der Wert direkt darüber (auf der `--fs-*`-Leiter eine
Stufe runter, z. B. Hauptwert `--fs-5` → Nebenwert `--fs-4`). Nie gleich groß,
nie größer.

Einheiten/Perioden-Tags (`1M`, `%`, `Ø`) sind **immer** kleiner und `--muted`,
nie so groß wie der Wert selbst.

---

## 3. Icons – nur Lucide, nur aus `icons.js`

- Quelle: **`ui/lib/icons.js`** (`import { icons } from '../lib/icons.js'`).
- Fehlt ein Glyph, wird er **dort** ergänzt (Lucide-Pfad, `stroke-width 2`,
  `viewBox 0 0 24 24`, `currentColor`) – nicht ad-hoc im Component-Markup.
- Größenklassen: `.icon` (20px), `.icon-sm` (16px). Icons erben `currentColor`.
- **Verboten:** Emoji als UI-Icon (📊 📈 ✅ ⚙ …). Emoji nur in reinem Fließtext/
  Toasts, wenn überhaupt.

> **Altlast/Tech-Debt:** Einige Modal-Header nutzen noch Emoji-Titel
> (`<h2>📈 Intra-Day</h2>`) und `✕`-Close-Buttons. Das ist **nicht** Vorbild –
> bei Berührung auf Lucide (`icons.xMark` im `.icon-btn`) migrieren.

---

## 4. Links = Icon, kein Text

Vorbild: `chipLink()` in `candidate-list.js` → `.link-chip`.

- Externer Link = **Icon/Logo im `.link-chip`**, **ohne sichtbaren Text**.
- Bedeutung/Barrierefreiheit über `title` **und** `aria-label`.
- Immer `target="_blank" rel="noopener"`.
- **Nur** wenn ein Label unvermeidbar ist: extrem kurz (1 Wort), zusammen mit dem
  Icon – nie ganze Sätze, nie „↗"-Textpfeile.

```js
// richtig – Icon-only-Link
`<a class="link-chip" href="${url}" target="_blank" rel="noopener"
    title="CNN Pre-Markets" aria-label="CNN Pre-Markets">${icons.trendingUp}</a>`
```

```js
// falsch – Textlink mit Beschriftung + Emoji
`<a href="${url}">📈 PreMarkets ↗</a>`
```

---

## 5. Panels / Daten-Reihen

Ein **Panel/Indikator-Streifen** legt seine Items in **einer horizontalen Zeile**
an. Vorbild: `.id-indicators` mit `.id-ind`-Kacheln.

### Feste kleine Anzahl → **eine Zeile, gleich breite Spalten** (harte Regel)
Bei einer **festen, kleinen Anzahl** Blöcke (z. B. die **4 Index-Kacheln**)
stehen **immer alle in EINER Zeile** – sie brechen **nie** auf eine zweite Zeile
um, auch nicht auf dem Handy:

- `flex-wrap: nowrap` am Container.
- Jede Kachel `flex: 1 1 0; min-width: 0` → gleich breite Spalten, die zusammen
  die Zeile füllen und bei wenig Platz **schrumpfen** (statt umzubrechen).
- Damit vier Spalten auch schmal passen: **vertikal gestapelt** (Label / Wert /
  Nebenwert je eigene kurze Zeile), Werte `white-space: nowrap`.

> (Nur bei **variabler/großer** Item-Zahl ist `flex-wrap: wrap` richtig.)

### Ein Panel über Primärinhalt ist ein **schmaler Streifen**
Sitzt ein Panel über Primärinhalt (Tabelle, iframe, Chart), darf es diesem
**keinen nennenswerten Platz nehmen**:

- **Kompakt halten, nicht vergrößern.** Kacheln nicht „größer machen, damit man
  besser sieht" – das war der Fehler. Hauptwert **≤ `--fs-3`**, Padding
  **≤ `--s-1`**, `line-height ≈ 1.2`, **max. 3 kurze Zeilen** pro Kachel.
- Panels sitzen im dafür vorgesehenen Container (z. B. **Markets-Modal**), nicht
  in einen kleinen iframe gequetscht.

---

## 6. Buttons & interaktive Flächen

| Klasse | Einsatz |
|---|---|
| `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-success` / `.btn-danger` / `.btn-ai` | Standard-Buttons (Token-Farben) |
| `.btn-sm` | kompakte Variante (`min-height:32px`) |
| `.icon-btn` | quadratischer Icon-Only-Button (Header/Toolbar) |
| `.act-btn--promote` / `--dismiss` | Zeilenaktionen (grün/rot) |
| `.link-chip` | Icon-Only-Link (Abschnitt 4) |

Touch-Ziele ≥ 32px. Hover/aktiv über Token-Farben, nicht über feste Werte.

---

## 7. Modals

- Struktur: `.modal-overlay > .modal > (.modal-header, .modal-body[, .modal-footer])`.
- Header: Titel links; rechts Aktionen. Icon-Only-Aktionen als `.icon-btn` mit
  Lucide (Close = `icons.xMark`).
- Schließen per Klick auf Overlay **und** `Escape` (siehe bestehende Modals).
- Inhalt scrollt in `.modal-body`, Header/Footer bleiben fix.

---

## 8. Farbsemantik Werte

- Positiv → `--pos`, negativ → `--neg`, neutral/keine Daten → `--muted` + `–`.
- Klassen `.pos` / `.neg` existieren bereits – nutzen statt Inline-Farbe.
- Prozente über den vorhandenen `fmtPct`-Helper (Vorzeichen + eine Nachkomma).

---

## 9. Do / Don't (Kurz-Checkliste)

**Do**
- Tokens statt Rohwerte · Lucide aus `icons.js` · Icon-Only-Links ·
  Nebenwert < Hauptwert · bestehende Klassen wiederverwenden · Dark-Mode prüfen ·
  Visual vorher im Chat abstimmen.

**Don't**
- Emoji-Icons · Textlinks mit `↗` · feste `px`/`#hex` in neuem CSS · zweite
  Wertzeile gleich groß/größer · neue Ad-hoc-Komponente, wenn eine existiert ·
  Inhalt in einen zu kleinen iframe zwängen.

---

## 10. Worked Example – Index-Kachel (Markets-Modal)

Zielbild: **4 gleich breite Blöcke in EINER Zeile** (nowrap), je 3 kurze Zeilen,
schmaler Streifen – der iframe darunter behält den Platz.

```
┌────────┬────────┬────────┬────────┐
│  DAX   │ NASDAQ │ NIKKEI │  VIX   │  ← Label (--fs-1, muted)
│ +0,5 % │ +0,3 % │ −0,2 % │ +1,1 % │  ← heute (--fs-3, bold)
│+4,2% 1M│+6,1% 1M│+2,8% 1M│−12% 1M │  ← 1M (--fs-2, eine Stufe kleiner)
└────────┴────────┴────────┴────────┘
   flex:1 1 0 · min-width:0 · flex-wrap:nowrap → nie Umbruch
```
- Gleich breite, schrumpfende Spalten – nie auf eine zweite Zeile umbrechen (§5).
- Werte `white-space:nowrap`, Farbe über `.pos`/`.neg`.
- Links (PreMarkets etc.) als **Icon-Only** aus `icons.js` – kein Text, kein Emoji.

_Änderungen an diesem Guide ebenfalls vorab im Chat abstimmen._
