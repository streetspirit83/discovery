#!/usr/bin/env python3
"""
Schreibt die Triage zurück: cowork_review an jeden Kandidaten des
watch-Blobs und den Tages-Briefing-Eintrag in den review-Blob.

Eingabe reviews.json (vom Lauf erzeugt):
{
  "macro": {"summary": "...", "clusters": [...], "drivers": [...]},
  "reviews": [
    {"symbol":"AVGO","signal":"positive","materiality":2,"headline":"...",
     "summary":"...","event_types":["product"],"cluster":"semis",
     "sources":["AVGO#1","AVGO#3"]}
  ]
}

Nicht aufgeführte Ticker mit Treffern gelten als materiality 0. Ticker ohne
Treffer bekommen automatisch no_news. Quellen werden über die Kennungen aus
dem Digest aufgelöst — was nicht im Digest stand, wird verworfen.

Aufruf:
  python3 push_review.py digest.json reviews.json --base URL --secret S [--dry-run]
"""
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

SIGNALS = {"positive", "neutral", "negative"}
CLUSTERS = {"biotech", "semis", "tech", "other"}
EVENTS = {"earnings", "guidance", "mna", "regulatory", "product",
          "analyst", "legal", "macro", "none"}
MAX_BRIEFINGS = 30


def arg(flag: str, default=None):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default


def post(base: str, secret: str, payload: dict) -> dict:
    req = urllib.request.Request(
        f"{base.rstrip('/')}/api/storage",
        data=json.dumps(payload).encode("utf8"),
        headers={"Content-Type": "application/json", "x-discovery-secret": secret},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf8"))


def clamp(review: dict, item_map: dict, symbol: str) -> dict:
    """Erzwingt das Schema. Was nicht passt, fällt auf den sicheren Wert."""
    mat = review.get("materiality", 0)
    mat = mat if isinstance(mat, int) and 0 <= mat <= 3 else 0
    sig = review.get("signal") if review.get("signal") in SIGNALS else "neutral"
    cl = review.get("cluster") if review.get("cluster") in CLUSTERS else "other"
    evs = [e for e in (review.get("event_types") or []) if e in EVENTS] or ["none"]

    sources = []
    for ref in review.get("sources") or []:
        it = item_map.get(ref)
        if it and ref.split("#")[0] == symbol:
            sources.append({"title": it["title"], "url": it["url"],
                            "published": it["published"]})

    # Ohne Quelle keine Aussage: materiality fällt auf 0 zurück.
    if not sources and mat > 0:
        mat, sig = 0, "neutral"

    return {
        "reviewed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "run_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "signal": sig,
        "materiality": mat,
        "headline": (review.get("headline") or "")[:80],
        "summary": review.get("summary") or "",
        "event_types": evs,
        "cluster": cl,
        "flag": mat >= 2,
        "sources": sources[:4],
        "no_news": not sources,
    }


CLUSTER_ORDER = ("biotech", "semis", "tech")
STATES = {"risk_on", "neutral", "risk_off"}


def clean_sources(raw) -> list:
    out = []
    for s in raw or []:
        if isinstance(s, dict) and s.get("url"):
            out.append({"title": s.get("title", ""), "url": s["url"],
                        "published": s.get("published", "")})
    return out[:3]


def clamp_macro(macro: dict) -> dict:
    """
    Erzwingt die Form des Makro-Blocks, bevor er in den Blob geht.

    Ein Lauf schrieb die Cluster schon einmal unter "cluster" statt "key" und
    die Termine als flache Zeichenkette. Die Oberfläche liest feste Feldnamen —
    was hier durchrutscht, ist dort eine leere Kachel. Also hier begradigen,
    nicht in drei Ansichten Sonderfälle pflegen.
    """
    macro = macro if isinstance(macro, dict) else {}

    by_key = {}
    for c in macro.get("clusters") or []:
        if not isinstance(c, dict):
            continue
        key = c.get("key") or c.get("cluster")
        if key in CLUSTER_ORDER:
            by_key[key] = c

    clusters = []
    for key in CLUSTER_ORDER:
        c = by_key.get(key, {})
        state = c.get("state")
        clusters.append({
            "key": key,
            "state": state if state in STATES else "neutral",
            "note": str(c.get("note") or ""),
            "sources": clean_sources(c.get("sources")),
        })

    drivers = []
    for d in (macro.get("drivers") or [])[:4]:
        if isinstance(d, str):
            drivers.append({"date": "", "event": d})
        elif isinstance(d, dict):
            drivers.append({"date": str(d.get("date") or ""),
                            "event": str(d.get("event") or "")})

    return {"summary": str(macro.get("summary") or ""),
            "clusters": clusters, "drivers": drivers}


EARNINGS_WINDOW_DAYS = 14
WEEKDAYS = ("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")


def earnings_drivers(results: list) -> list:
    """
    Termine des Briefings = die nächsten Earnings der Watchlist aus den TV-Daten.

    Nicht recherchiert: der Lauf liefert hier nichts, was nicht schon im
    watch-Blob steht (`tv_data.earnings_next_date`, Unix-Sekunden, von
    fetch_news.py durchgereicht). Fenster: heute bis +14 Tage, chronologisch.
    """
    today = datetime.now(timezone.utc).date()
    rows = []
    for r in results:
        ts = r.get("earnings_next_date")
        if not isinstance(ts, (int, float)) or ts <= 0:
            continue
        day = datetime.fromtimestamp(ts, timezone.utc).date()
        if not 0 <= (day - today).days <= EARNINGS_WINDOW_DAYS:
            continue
        name = (r.get("name") or "").strip()
        rows.append((day, r["symbol"], f"{r['symbol']} · {name}" if name else r["symbol"]))
    rows.sort()
    return [{"date": f"{WEEKDAYS[d.weekday()]} {d:%d.%m.}", "event": ev}
            for d, _, ev in rows]


def no_news(cluster: str = "other") -> dict:
    return {
        "reviewed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "run_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "signal": "neutral", "materiality": 0, "headline": "",
        "summary": "Keine relevanten Nachrichten im Zeitfenster gefunden.",
        "event_types": ["none"], "cluster": cluster, "flag": False,
        "sources": [], "no_news": True,
    }


def main() -> int:
    base, secret = arg("--base"), arg("--secret")
    dry = "--dry-run" in sys.argv
    if not dry and not (base and secret):
        print("--base und --secret erforderlich", file=sys.stderr)
        return 2

    with open(sys.argv[1], encoding="utf8") as fh:
        digest = json.load(fh)
    with open(sys.argv[2], encoding="utf8") as fh:
        verdicts = json.load(fh)

    item_map, by_symbol = {}, {}
    for r in digest["results"]:
        by_symbol[r["symbol"]] = r
        for n, it in enumerate(r["items"], 1):
            item_map[f"{r['symbol']}#{n}"] = it

    judged = {v["symbol"]: v for v in verdicts.get("reviews", [])}
    updates, stats = [], {"reviewed": 0, "with_news": 0, "flagged": 0,
                          "skipped": 0, "errors": digest.get("errors", 0)}
    highlights = []

    for r in digest["results"]:
        sym = r["symbol"]
        if r["error"]:
            stats["skipped"] += 1
            continue
        if sym in judged:
            cr = clamp(judged[sym], item_map, sym)
        elif r["items"]:
            # Treffer vorhanden, aber nicht bewertet: als unauffällig ablegen.
            cr = no_news()
            cr["summary"] = "Treffer im Fenster, aber ohne erkennbare Relevanz."
        else:
            cr = no_news()

        stats["reviewed"] += 1
        if not cr["no_news"]:
            stats["with_news"] += 1
        if cr["flag"]:
            stats["flagged"] += 1
            highlights.append({"id": r["id"], "symbol": sym,
                               "signal": cr["signal"],
                               "materiality": cr["materiality"],
                               "headline": cr["headline"]})
        updates.append({"candidate_id": r["id"], "updates": {"cowork_review": cr}})

    highlights.sort(key=lambda h: -h["materiality"])
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    macro = clamp_macro(verdicts.get("macro"))
    # Termine kommen nicht vom Lauf, sondern aus den TV-Earnings-Daten.
    macro["drivers"] = earnings_drivers(digest["results"])
    entry = {
        "date": today,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "macro": macro,
        "highlights": highlights[:10],
        "stats": stats,
    }

    if dry:
        print(json.dumps({"entry": entry, "updates": len(updates)},
                         ensure_ascii=False, indent=1)[:4000])
        return 0

    res = post(base, secret, {"op": "bulk_update_candidates", "blob_type": "watch",
                              "updates": updates})
    print("bulk_update_candidates:", json.dumps(res)[:200])

    try:
        doc = post(base, secret, {"op": "read", "blob_type": "review"})["data"]
    except urllib.error.HTTPError:
        doc = None
    if not isinstance(doc, dict) or "briefings" not in doc:
        doc = {"schema_version": "discovery-1.0", "blob_type": "review",
               "briefings": []}
    doc["briefings"] = ([entry] + [b for b in doc["briefings"]
                                   if b.get("date") != today])[:MAX_BRIEFINGS]
    res = post(base, secret, {"op": "write", "blob_type": "review", "blob": doc})
    print("write review:", json.dumps(res)[:200])
    print(json.dumps(stats))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
