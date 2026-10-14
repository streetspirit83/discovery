"""Watch Ranges → Discovery-Alarme.

Gleicht die im Artefakt "Watch Ranges" angehakten Titel mit den Alarmen im
watch-Blob ab: je Titel ein Preis-Alarm auf Support (price_below) und einer auf
Resistance (price_above), in EUR — dieselbe Einheit, in der check-alerts den
LS-Kurs vergleicht. Ein Level, das der aktuelle Kurs schon überschritten hat,
bekommt keinen Alarm. Alarme anderer Herkunft bleiben unangetastet; die eigenen
erkennt das Skript an der id `wr_sup_<id>` / `wr_res_<id>`.

Usage:
  python3 -I alarm_sync.py DBDIR watch.json STARTED_AT updates.json status.json

DBDIR enthält die per ArtifactData (out_dir) gesicherten Dokumente:
  ranges/current.json, live/current.json, overrides/*.json, alarms/*.json
watch.json ist die Antwort von /api/storage op=read blob_type=watch.
updates.json ist der Body für op=bulk_update_candidates (nur geänderte Titel);
fehlt jede Änderung, enthält er {"updates": []}.
"""
import glob, json, os, sys
from datetime import datetime, timezone

db, watch_path, started_at, out_updates, out_status = sys.argv[1:6]

def load(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default

def docs(coll):
    out = {}
    for p in glob.glob(os.path.join(db, coll, "*.json")):
        d = load(p)
        if isinstance(d, dict):
            out[os.path.splitext(os.path.basename(p))[0]] = d
    return out

def num(v):
    try:
        v = float(v)
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None

ranges = {x["id"]: x for x in (load(os.path.join(db, "ranges", "current.json"), {}) or {}).get("items", [])}
live = ((load(os.path.join(db, "live", "current.json"), {}) or {}).get("p") or {})
overrides = docs("overrides")
wanted = {k for k, v in docs("alarms").items() if v.get("on") is not False}

cands = ((load(watch_path, {}) or {}).get("data") or {}).get("candidates") or []
if not cands:
    sys.exit("watch.json enthält keine Kandidaten — nichts geschrieben")

now = datetime.now(timezone.utc).isoformat(timespec="seconds")

def fmt(v):
    s = f"{v:,.2f}" if v < 1000 else f"{v:,.0f}"
    return s.replace(",", "X").replace(".", ",").replace("X", ".")

def alert(cid, side, level, old):
    sup = side == "sup"
    aid = f"wr_{side}_{cid}"
    prev = next((a for a in old if a.get("id") == aid), None)
    keep_created = prev and abs((prev.get("threshold") or 0) - level) < 1e-6
    return {
        "id": aid,
        "kind": "watch",
        "type": "price_below" if sup else "price_above",
        "threshold": round(level, 4),
        "dir": "watch",
        "enabled": True,
        "label": f"{'Support' if sup else 'Resistance'} {fmt(level)} €",
        "note": "Watch Ranges",
        "basis": {"kind": "level", "source": "Watch Ranges"},
        "created_at": prev.get("created_at") if keep_created else now,
    }

updates, armed, missing = [], {}, []
seen = set()
for c in cands:
    cid = c.get("id")
    seen.add(cid)
    old = c.get("alerts") or []
    others = [a for a in old if not str(a.get("id", "")).startswith("wr_")]
    mine = []
    if cid in wanted and cid in ranges:
        r, ov = ranges[cid], overrides.get(cid, {})
        sup = num(ov.get("sup")) or num(r.get("as"))
        res = num(ov.get("res")) or num(r.get("ar"))
        px = num((live.get(cid) or {}).get("p")) or num(r.get("p"))
        a_sup = sup if (sup and px and px > sup) else None
        a_res = res if (res and px and px < res) else None
        if a_sup:
            mine.append(alert(cid, "sup", a_sup, old))
        if a_res:
            mine.append(alert(cid, "res", a_res, old))
        armed[cid] = {"sup": a_sup, "res": a_res, "p": px,
                      "skip_sup": bool(sup and not a_sup), "skip_res": bool(res and not a_res)}
    new = others + mine
    old_mine = sorted((a.get("id"), a.get("threshold")) for a in old if str(a.get("id", "")).startswith("wr_"))
    new_mine = sorted((a["id"], a["threshold"]) for a in mine)
    if old_mine != new_mine:
        updates.append({"candidate_id": cid, "updates": {"alerts": new}})

missing = sorted(w for w in wanted if w not in seen or w not in ranges)

with open(out_updates, "w", encoding="utf-8") as f:
    json.dump({"op": "bulk_update_candidates", "blob_type": "watch", "updates": updates}, f, ensure_ascii=False)
with open(out_status, "w", encoding="utf-8") as f:
    json.dump({"at": started_at, "done_at": now, "armed": armed, "missing": missing,
               "changed": len(updates)}, f, ensure_ascii=False, separators=(",", ":"))
print(f"{len(wanted)} angehakt, {sum(1 for a in armed.values() if a['sup'] or a['res'])} scharf, "
      f"{len(updates)} Titel geändert, fehlend: {missing or 'keine'}")
