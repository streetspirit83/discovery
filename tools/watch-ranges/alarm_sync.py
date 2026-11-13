"""Watch Ranges → Soll-Zustand der Range-Alarme.

Liest die im Artefakt "Watch Ranges" an- und abgehakten Titel und berechnet je Titel
die Alarm-Levels in EUR: Support (price_below) und Resistance (price_above),
mit manuellen Overrides. Ein Level, das der aktuelle LS-Kurs schon
überschritten hat, bekommt keinen Alarm. Das Ergebnis geht an
POST /api/watch-alarms, das die Alarme am watch-Blob setzt.

Usage:
  python3 -I alarm_sync.py DBDIR STARTED_AT desired.json status.json

DBDIR enthält die per ArtifactData (out_dir) gesicherten Dokumente:
  ranges/current.json, live/current.json, overrides/*.json, alarms/*.json
"""
import glob, json, os, sys
from datetime import datetime, timezone

db, started_at, out_desired, out_status = sys.argv[1:5]

def load(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default

def docs(coll):
    out = {}
    for p in glob.glob(os.path.join(db, "**", coll, "*.json"), recursive=True):
        d = load(p)
        if isinstance(d, dict):
            out[os.path.splitext(os.path.basename(p))[0]] = d
    return out

def one(coll, name):
    for p in glob.glob(os.path.join(db, "**", coll, name + ".json"), recursive=True):
        d = load(p)
        if isinstance(d, dict):
            return d
    return {}

def num(v):
    try:
        v = float(v)
        return round(v, 4) if v > 0 else None
    except (TypeError, ValueError):
        return None

ranges = {x["id"]: x for x in one("ranges", "current").get("items", [])}
if not ranges:
    sys.exit("ranges/current fehlt oder ist leer — nichts geschrieben")
live = one("live", "current").get("p") or {}
overrides = docs("overrides")
all_alarms = docs("alarms")
wanted = sorted(k for k, v in all_alarms.items() if v.get("on") is True)
# Abgehakte Titel werden ausdrücklich als "aus" gemeldet (sup/res = null) —
# die Function löscht nie implizit.
off = sorted(k for k, v in all_alarms.items() if v.get("on") is not True)

alarms, armed, missing = [], {}, []
for cid in wanted:
    r = ranges.get(cid)
    if not r:
        missing.append(cid)
        continue
    ov = overrides.get(cid, {})
    sup = num(ov.get("sup")) or num(r.get("as"))
    res = num(ov.get("res")) or num(r.get("ar"))
    px = num((live.get(cid) or {}).get("p")) or num(r.get("p"))
    a_sup = sup if (sup and px and px > sup) else None
    a_res = res if (res and px and px < res) else None
    alarms.append({"id": cid, "sup": a_sup, "res": a_res})
    armed[cid] = {"sup": a_sup, "res": a_res, "p": px,
                  "skip_sup": bool(sup and not a_sup), "skip_res": bool(res and not a_res)}

alarms += [{"id": cid, "sup": None, "res": None} for cid in off]

with open(out_desired, "w", encoding="utf-8") as f:
    json.dump({"alarms": alarms}, f)
with open(out_status, "w", encoding="utf-8") as f:
    json.dump({"at": started_at, "done_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "armed": armed, "missing": missing}, f, separators=(",", ":"))
print(f"{len(off)} aus, {len(wanted)} angehakt, {sum(1 for a in alarms if a['sup'] or a['res'])} mit Alarm, fehlend: {missing or 'keine'}")
