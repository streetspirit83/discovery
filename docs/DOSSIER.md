# Dossier – Google Doc je Watchlist-Ticker

Pro Ticker im **Watch-Bucket** legt eine GitHub Action ein Google Doc
„Symbol - Company Name“ an: Kerndaten (ISIN, Sector, Sub Sector, fairer Kurs,
MCap, nächste Earnings, Website), Firmenprofil (ROIC.ai, Wikipedia als Fallback)
und Screenshots der Tabs Perf. (1J), Trend, Prog. und Fund. Quelle ist
ausschliesslich die eigene App — kein Claude, keine Tokens, kein Rechner an.

## Ablauf

1. **UI** – Meta-Ansicht, Bucket Watch, Spalte **Doc**:
   - Dokument-Icon = Haken „Dossier anlegen“ (`dossier_flag`). Nochmal tippen
     nimmt den Haken raus; das Doc in Drive bleibt.
   - Pfeil-Icon = „Dossier aktualisieren“ (`dossier_update`, Einmal-Auftrag,
     erst aktiv, wenn ein Doc existiert).
   - Ist das Doc fertig, wird das Dokument-Icon selbst zum Link aufs Doc.
     Pulsieren = läuft, rot = Fehler (Tooltip zeigt den Grund, antippen startet neu).
   - Spaltenkopf „Doc ⟳“ antippen = alle offenen Aufträge sofort erstellen.
   - Nach jedem Anstoss liest die App den Status alle 20 s nach (max. 6 min),
     der Link erscheint ohne Neuladen.
2. **Netlify** `dossier-trigger` → `repository_dispatch` (event `dossier`).
3. **GitHub Action** `dossier.yml` → `tools/dossier/run.mjs`: öffnet die App
   headless (Playwright) über den Deep-Link `#c=<id>`, schaltet den Chart auf 1J,
   lädt das Firmenprofil, macht die Screenshots, baut ein .docx und lädt es als
   Google Doc in den Ordner (Update überschreibt dasselbe Doc, Link bleibt).
   Status, Doc-ID und Link landen am Kandidaten (`dossier`).
4. **Sweep** täglich 05:41 UTC holt Aufträge nach, deren Anstoss verloren ging.
   Manuell: Actions → „Dossier …“ → Run workflow (leer = alle offenen).

Dauer pro Ticker ≈ 1–2 min Action-Laufzeit (Freikontingent).

## AI Research im Dossier

Abschnitt „AI Research“ zwischen Firmenprofil und Screenshots: je Prompt ein
Unterabschnitt mit Stand-Datum. Ein neuer Lauf desselben Prompts ersetzt den
alten.

1. **Artefakt „Dossier Research“** (https://claude.ai/artifact/HtGSH28Lkng8zC9t3swEXn):
   listet die Docs im Dossier-Ordner über den Google-Drive-Konnektor. Zeile
   aufklappen, Prompts wählen, „An Claude“. Reiter „Prompts“: Vorlagen
   bearbeiten, eigene anlegen, Standard wiederherstellen. Platzhalter wie
   `{{subject}}`, `{{data}}`, `{{extremes}}` füllt die Netlify-Funktion.
2. Das Artefakt schreibt `req/<docId>` in seine Datenbank und startet die
   geplante Aufgabe **„Discovery Research“** (Claude Code Remote `fire_trigger`).
3. Die Aufgabe liest Anfrage und Vorlagen, holt die Werte über
   `GET /api/research?doc=<docId>&symbol=<SYM>`, recherchiert je Prompt im Web, schickt die
   Ergebnisse per `POST /api/research` (rebuild) und meldet `status/<docId>` ans
   Artefakt zurück.
4. `research` speichert `candidate.research[key]` im watch-Blob und stösst
   `dossier.yml` an; `run.mjs` baut das Doc samt Abschnitt neu.

### Auslösen aus der App (Warteschlange)

Im ✨-Modal eines Watch-Titels (Detail-Sheet, Toolbar) steht oben „AI Research
ins Dossier“: Prompts per Checkbox wählen (nichts vorausgewählt), „In
Warteschlange“. Die App schreibt `research_request = { keys, at }` an den Titel;
hat er noch kein Dossier, setzt sie zugleich den Dossier-Haken und stösst das
Anlegen an.

Die geplante Aufgabe **„Discovery Research (App-Warteschlange)“** läuft alle
2 Stunden (7–23 Uhr Berlin):
1. meldet die Prompt-Liste des Artefakts an `POST /api/research { catalog }` —
   daraus baut die App ihre Checkbox-Liste (`GET ?catalog=1`, Fallback: die
   eingebauten Vorlagen);
2. holt offene Aufträge (`GET ?queue=1`), höchstens 3 je Lauf;
3. recherchiert je Prompt und schickt `POST { id, rebuild, results, failed }`.
   Geschriebene und gescheiterte Schlüssel werden aus `research_request`
   ausgetragen, Fehler stehen in `research_error` (zeigt das Modal an). Ohne Doc,
   aber mit Dossier-Haken stösst `rebuild` das Anlegen an.

Die Artefakt-Variante (Knopf „An Claude“) bleibt unverändert; das Artefakt ist
weiter der Ort, an dem Prompts bearbeitet werden.

Unverknüpfte Docs: Liegt im Ordner ein Doc, das an keinem Titel als
`dossier.doc_id` hängt (z. B. aus der Zeit vor der Verknüpfung), findet
`research` den Titel über `symbol` — nur wenn genau ein Watch-Titel dieses
Symbol trägt und selbst noch kein Doc hat. Der POST verknüpft das Doc dann fest,
das Update baut genau dieses Doc neu.

Schlüssel: Netlify-Variable `RESEARCH_TOKEN` (Kontext production, Scope
functions), Header `x-research-token`. Darf nur `research` am watch-Blob
schreiben und ein Dossier-Update anstossen.

## Einmalige Einrichtung

### A. Google: OAuth-Client + Refresh-Token (~15 min)

Ein Service-Account geht **nicht**: er hat keinen eigenen Speicher und kann in
einem privaten Gmail-Drive keine Dateien anlegen. Deshalb ein OAuth-Token des
eigenen Kontos.

1. <https://console.cloud.google.com> → oben Projekt-Auswahl → **Neues Projekt**
   „discovery-dossier“ → Erstellen, dann auswählen.
2. **APIs & Dienste → Bibliothek** → „Google Drive API“ → **Aktivieren**.
3. **APIs & Dienste → OAuth-Zustimmungsbildschirm** (bzw. „Google Auth Platform“):
   - Nutzertyp **Extern**, App-Name „Discovery Dossier“, Support- und
     Kontakt-E-Mail = eigene Adresse, speichern.
   - **Zielgruppe / Testnutzer:** eigene Gmail-Adresse eintragen.
   - **Veröffentlichungsstatus auf „In Produktion“ setzen** (Button „App
     veröffentlichen“). Wichtig: im Status „Test“ verfällt der Refresh-Token
     nach 7 Tagen. Eine Google-Prüfung ist für die Eigennutzung nicht nötig; beim
     Login erscheint nur ein Warnhinweis „App nicht überprüft“.
4. **APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen → OAuth-Client-ID**:
   - Anwendungstyp **Webanwendung**, Name „dossier“.
   - Autorisierte Weiterleitungs-URI: `https://developers.google.com/oauthplayground`
   - Erstellen → **Client-ID** und **Clientschlüssel** notieren.
5. <https://developers.google.com/oauthplayground> öffnen:
   - Zahnrad oben rechts → **Use your own OAuth credentials** anhaken →
     Client-ID und Clientschlüssel eintragen.
   - Links unten im Feld „Input your own scopes“: `https://www.googleapis.com/auth/drive`
     → **Authorize APIs** → mit dem eigenen Konto anmelden → „Erweitert“ →
     „Zu Discovery Dossier wechseln (unsicher)“ → Zugriff erlauben.
   - **Exchange authorization code for tokens** → den **Refresh token** kopieren.
   - Danach im Zahnrad-Menü die eigenen Credentials wieder abwählen (Hygiene).

### B. GitHub-Token für den Anstoss (~3 min)

1. GitHub → Settings → Developer settings → **Personal access tokens →
   Fine-grained tokens → Generate new token**.
2. Name „discovery-dossier-dispatch“, Ablauf z. B. 1 Jahr,
   Repository access: **Only select repositories → streetspirit83/discovery**.
3. Permissions → Repository → **Contents: Read and write** (mehr nicht).
4. Token kopieren.

### C. Secrets eintragen

**GitHub** → Repo `discovery` → Settings → Secrets and variables → Actions:

| Typ | Name | Wert |
|---|---|---|
| Secret | `GOOGLE_CLIENT_ID` | aus A.4 |
| Secret | `GOOGLE_CLIENT_SECRET` | aus A.4 |
| Secret | `GOOGLE_REFRESH_TOKEN` | aus A.5 |
| Secret | `ROIC_API_KEY` | derselbe Key wie in den App-Settings |
| Secret | `DISCOVERY_BACKEND_URL`, `DISCOVERY_SECRET`, `TWELVEDATA_API_KEY` | existieren schon (Adapter) |
| Variable (optional) | `DOSSIER_FOLDER_ID` | Default: `1V9z1QYbwgWhAxZ0tf3vErKSdm5nfaffj` |
| Variable (optional) | `DISCOVERY_UI_URL` | Default: GitHub-Pages-URL |

**Netlify** → Site → Site configuration → Environment variables:

| Name | Wert |
|---|---|
| `GH_DISPATCH_TOKEN` | Token aus B |
| `GH_REPO` (optional) | Default `streetspirit83/discovery` |

Nach dem Eintragen in Netlify einmal **Deploys → Trigger deploy** (Env-Variablen
greifen erst mit dem nächsten Deploy).

### D. Erster Test

1. Actions → „Dossier – Google Doc je Watchlist-Ticker“ → **Run workflow** mit der
   ID eines Watch-Kandidaten (steht im Detail-Sheet unter Meta) — prüft Google-
   und App-Zugang ohne die UI.
2. Danach in der App: Meta-Ansicht → Watch → Dokument-Icon bei einem Ticker →
   nach ~2 min Seite neu laden → Link-Icon erscheint.

## Bekannte Grenzen

- Screenshots zeigen den Zustand der App beim Lauf; US-Kerzen brauchen den
  TwelveData-Key, ROIC.ai im Free-Plan max. 5 Anfragen/min — beim Sweep über
  viele Ticker greift dann der Wikipedia-Fallback.
