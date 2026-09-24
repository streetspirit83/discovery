#!/usr/bin/env python3
"""
Rendert digest.json als kompakte Textliste für die Triage.

Jede Schlagzeile bekommt eine Kennung der Form SYMBOL#n. Das Urteil
referenziert nur diese Kennungen — URLs tauchen im Modellkontext nie auf,
werden also auch nicht erfunden. push_review.py löst sie wieder auf.

Aufruf:  python3 render_digest.py digest.json > digest.txt
"""
import json
import sys


def main() -> int:
    with open(sys.argv[1], encoding="utf8") as fh:
        d = json.load(fh)

    hits = [r for r in d["results"] if r["items"]]
    quiet = [r for r in d["results"] if not r["items"] and not r["error"]]
    errors = [r for r in d["results"] if r["error"]]

    print(f"# Nachrichten-Digest, Fenster {d['window_days']} Tage, "
          f"erzeugt {d['generated_at']}")
    print(f"# {d['total']} Ticker, {len(hits)} mit Treffern, "
          f"{len(quiet)} ohne, {len(errors)} Fehler\n")

    for r in hits:
        sub = r.get("sub_sector") or r.get("sector") or "-"
        print(f"{r['symbol']} · {r['name']} · {sub} · prio={r['priority']}")
        for n, it in enumerate(r["items"], 1):
            src = f" [{it['source']}]" if it["source"] else ""
            print(f"  {r['symbol']}#{n} ({it['published']}){src} {it['title']}")
        print()

    print("## Ohne Treffer im Fenster (materiality 0, no_news true)")
    print(", ".join(r["symbol"] for r in quiet) or "keine")
    if errors:
        print("\n## Abruffehler (überspringen, in stats.errors zählen)")
        print(", ".join(f"{r['symbol']}" for r in errors))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
