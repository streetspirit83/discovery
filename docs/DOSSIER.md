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
   - Link-Icon öffnet das fertige Doc. Pulsieren = läuft, rot = Fehler
     (Tooltip zeigt den Grund, antippen startet neu).
2. **Netlify** `dossier-trigger` → `repository_dispatch` (event `dossier`).
3. **GitHub Action** `dossier.yml` → `tools/dossier/run.mjs`: öffnet die App
   headless (Playwright) über den Deep-Link `#c=<id>`, schaltet den Chart auf 1J,
   lädt das Firmenprofil, macht die Screenshots, baut ein .docx und lädt es als
   Google Doc in den Ordner (Update überschreibt dasselbe Doc, Link bleibt).
   Status, Doc-ID und Link landen am Kandidaten (`dossier`).
4. **Sweep** täglich 05:41 UTC holt Aufträge nach, deren Anstoss verloren ging.
   Manuell: Actions → „Dossier …“ → Run workflow (leer = alle offenen).

Dauer pro Ticker ≈ 1–2 min Action-Laufzeit (Freikontingent).

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

- Status-Wechsel sieht die UI erst nach Reload/Bucket-Wechsel (kein Polling).
- Screenshots zeigen den Zustand der App beim Lauf; US-Kerzen brauchen den
  TwelveData-Key, ROIC.ai im Free-Plan max. 5 Anfragen/min — beim Sweep über
  viele Ticker greift dann der Wikipedia-Fallback.
