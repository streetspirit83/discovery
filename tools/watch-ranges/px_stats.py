"""Kurs-Kennzahlen für die Momentum-Analyse in "Watch Ranges".

Usage: python3 -I px_stats.py HISTDIR ID
HISTDIR enthält die per ArtifactData (out_dir) gesicherten hist/pN.json
({"h": {id: {"d0": Tag, "dd": [Abstände], "c": [Schlusskurse EUR]}}}).
Gibt ein JSON-Objekt px aus (Prozentwerte, 1 Nachkommastelle, fehlend = null).
"""
import glob, json, os, sys

hist_dir, cid = sys.argv[1], sys.argv[2]
h = None
for p in glob.glob(os.path.join(hist_dir, "*.json")):
    try:
        h = (json.load(open(p, encoding="utf-8")).get("h") or {}).get(cid) or h
    except ValueError:
        pass

def pct(a, b):
    return round((a - b) / b * 100, 1) if a and b else None

px = dict.fromkeys(["r1m", "r3m", "r6m", "r12m", "sma50", "sma200", "ath52", "golden"])
if h and h.get("c"):
    c, days, d = h["c"], [], h["d0"]
    for i in range(len(c)):
        if i:
            d += h["dd"][i - 1]
        days.append(d)
    last, today = c[-1], days[-1]

    def back(n):  # Schlusskurs vor n Kalendertagen (letzter Handelstag davor)
        v = None
        for day, x in zip(days, c):
            if day <= today - n:
                v = x
        return v

    sma = lambda n: sum(c[-n:]) / n if len(c) >= n else None
    s50, s200 = sma(50), sma(200)
    year = [x for day, x in zip(days, c) if day > today - 365]
    px.update(r1m=pct(last, back(30)), r3m=pct(last, back(91)), r6m=pct(last, back(182)),
              r12m=pct(last, back(365)), sma50=pct(last, s50), sma200=pct(last, s200),
              ath52=pct(last, max(year)) if year else None,
              golden=(s50 > s200) if s50 and s200 else None)
print(json.dumps(px))
