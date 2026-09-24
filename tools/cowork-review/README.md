# Cowork-Triage der Watchlist

Drei Skripte für den geplanten Cowork-Task, der die Watchlist täglich durchsieht.
Sie erledigen das I/O; der Lauf selbst urteilt nur.

```
fetch_news.py    Watchlist → Schlagzeilen der letzten N Tage (Google News RSS)
render_digest.py digest.json → kompakte Textliste mit Quellenkennungen
push_review.py   Urteil → cowork_review am watch-Blob + Briefing im review-Blob
```

## Ablauf

```bash
curl -sS -X POST "$BASE/api/storage" \
  -H "Content-Type: application/json" -H "x-discovery-secret: $SECRET" \
  -d '{"op":"read","blob_type":"watch"}' > watch.json

python3 fetch_news.py watch.json digest.json --days 2   # ~8 s für 138 Ticker
python3 render_digest.py digest.json > digest.txt       # ~11k Token

# ... Lauf liest digest.txt und schreibt reviews.json ...

python3 push_review.py digest.json reviews.json --base "$BASE" --secret "$SECRET"
```

`--dry-run` bei `push_review.py` zeigt den Briefing-Eintrag, ohne zu schreiben.

## Quellenkennungen

`render_digest.py` nummeriert jede Schlagzeile als `SYMBOL#n`. Das Urteil referenziert nur
diese Kennungen, nie URLs. `push_review.py` löst sie auf und verwirft alles, was nicht im
Digest stand oder zu einem anderen Ticker gehört — der Eintrag fällt dann auf
`materiality: 0`. Eine erfundene Quelle kann so nicht in den Blob gelangen.

## Filter

`fetch_news.py` entfernt automatisch erzeugte Schlagzeilen, bevor sie Platz kosten:
Kursseiten, „3 Reasons"-Listicles, 13F-Meldungen, Optionsketten, Chart-Automaten, dazu eine
Liste von Quellen, die fast nur solche Texte liefern. In einem Lauf sind das rund 460 von
etwa 1.000 Treffern.

Wird der Filter zu scharf — erkennbar daran, dass bekannte Meldungen fehlen —, sitzen die
Stellschrauben in `FILLER` und `BLOCKED_SOURCES` am Kopf der Datei.

## Grenzen

- Google News ordnet Artikel gelegentlich falsch zu, besonders bei kurzen Symbolen und bei
  Firmennamen, die es doppelt gibt (Argan Inc. gegen Argan SA). Die Zuordnungsprüfung liegt
  beim Lauf, nicht beim Skript.
- Kleine europäische Titel sind in englischsprachigen Feeds dünn abgedeckt. `no_news` heißt
  dort nicht zwingend, dass nichts passiert ist.
- Das Ergebnis ist eine maschinelle Triage, keine Analyse und keine Anlageentscheidung.
