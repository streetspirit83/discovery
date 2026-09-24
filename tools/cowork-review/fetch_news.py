#!/usr/bin/env python3
"""
Holt für jeden Kandidaten der Watchlist die Schlagzeilen der letzten N Tage
über den Google-News-RSS-Feed und schreibt einen kompakten Digest.

Kein API-Key, keine LLM-Token. Der Digest ist die Grundlage der Triage.

Aufruf:  python3 fetch_news.py watch.json digest.json [--days 2]
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

UA = "Mozilla/5.0 (compatible; discovery-review/1.0)"
FEED = "https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"

# Dauerläufer-Schlagzeilen ohne Nachrichtenwert: Kursseiten, Zacks-Listicles,
# MarketBeat-13F-Churn, Chart-Automaten. Sie machen rund die Hälfte der Treffer
# aus und würden die Triage zumüllen.
FILLER = re.compile(
    r"stock (price|forecast|quote)|price, news, quote|quote & history|quote and history"
    r"|\b\d+ reasons?\b|should you (buy|sell)|is .* a (solid|good|great|smart|buy)"
    r"|why .* (is|are) a (buy|sell|top)|\b(buy|sell) the dip\b"
    r"|moving average|crosses? (above|below)|trading (up|down) [\d.]+%?$"
    r"|(shares|stake|position|holdings?) (sold|bought|acquired|purchased|raised|lowered"
    r"|increased|decreased|trimmed|boosted) by|(acquires|takes|buys) (a )?(new|\$[\d.]+)"
    r"|short interest (update|down|up)|\bsets new\b.*(high|low)"
    r"|(analysts?|brokerages?) (expect|issue|set|offer)|research (analysts|report) (issue|weigh)"
    r"|\bpe ratio\b|\beps estimate\b|what you need to know about|here's (what|why) you"
    r"|(hits?|reaches?) (52|\$)|earnings preview|q[1-4] earnings: what to expect"
    r"|stock news today|latest stock news|news and headlines|trading systems reacting"
    r"|narrative (keeps|looks|puts)|looks (fairly|over|under)valued|stock looks (pricey|cheap)"
    r"|interactive stock chart|\b(call|put) \(\w+\d{6}[cp]\d+\)|option chain"
    r"|(out|under)performs? (competitors|market|peers)|stock (rises|falls|gains|drops)"
    r"|(heads into the open|closing bell|premarket movers?)",
    re.I,
)

# Quellen, die fast ausschließlich automatisch erzeugte Bewertungs- und
# Kursbewegungstexte liefern. Ihre Treffer verdrängen echte Meldungen aus den
# vier Plätzen pro Ticker.
BLOCKED_SOURCES = {
    "simplywall.st", "indmoney", "ad hoc news", "tradingkey", "marketbeat",
    "defense world", "etf daily news", "stocktitan", "stock titan",
    "marketscreener", "investing.com uk", "tipranks",
}

# Rechtsformen und Zusätze, die die Suche nur verwässern.
NOISE = re.compile(
    r"\b(inc|inc\.|corp|corp\.|corporation|co|co\.|ltd|ltd\.|plc|sa|s\.a\.|nv|n\.v\."
    r"|ag|se|kgaa|the|group|holdings?|company|class [abc]|adr|ordinary shares?)\b",
    re.I,
)


def clean_name(name: str) -> str:
    out = NOISE.sub(" ", name or "")
    out = re.sub(r"[^\w\s&.-]", " ", out)
    return re.sub(r"\s+", " ", out).strip()


def build_query(cand: dict, days: int) -> str:
    name = clean_name(cand.get("name", ""))
    sym = cand.get("symbol", "")
    # Kurze oder mehrdeutige Namen brauchen das Symbol als Anker.
    if len(name) < 4:
        term = f'"{sym}" stock'
    elif cand.get("asset_type") == "ETF":
        term = f'"{name}" ETF'
    else:
        term = f'"{name}" stock'
    return urllib.parse.quote(f"{term} when:{days}d")


def fetch(cand: dict, days: int) -> dict:
    url = FEED.format(q=build_query(cand, days))
    res = {"id": cand["id"], "symbol": cand["symbol"], "name": cand.get("name", ""),
           "sector": cand.get("sector"), "sub_sector": cand.get("sub_sector"),
           "priority": cand.get("priority"), "items": [], "filtered": 0, "error": None}
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=25) as r:
            xml = r.read().decode("utf8", "replace")
    except Exception as exc:                                  # noqa: BLE001
        res["error"] = f"{type(exc).__name__}: {exc}"[:120]
        return res

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    seen = set()
    for raw in re.findall(r"<item>(.*?)</item>", xml, re.S):
        title = re.search(r"<title>(.*?)</title>", raw, re.S)
        link = re.search(r"<link>(.*?)</link>", raw, re.S)
        date = re.search(r"<pubDate>(.*?)</pubDate>", raw, re.S)
        if not (title and date):
            continue
        try:
            pub = parsedate_to_datetime(date.group(1))
        except Exception:                                      # noqa: BLE001
            continue
        if pub < cutoff:
            continue
        txt = re.sub(r"<!\[CDATA\[|\]\]>", "", title.group(1)).strip()
        # Google hängt " - Quelle" an; die Quelle wird eigenes Feld.
        src = ""
        if " - " in txt:
            txt, src = txt.rsplit(" - ", 1)
        if src.strip().lower() in BLOCKED_SOURCES or FILLER.search(txt):
            res["filtered"] += 1
            continue
        key = re.sub(r"\W+", "", txt.lower())[:60]
        if key in seen:
            continue
        seen.add(key)
        res["items"].append({
            "title": txt.strip(),
            "source": src.strip(),
            "published": pub.astimezone(timezone.utc).strftime("%Y-%m-%d"),
            "url": (link.group(1).strip() if link else ""),
        })
        if len(res["items"]) >= 4:
            break
    return res


def main() -> int:
    watch_path, out_path = sys.argv[1], sys.argv[2]
    days = 2
    if "--days" in sys.argv:
        days = int(sys.argv[sys.argv.index("--days") + 1])

    with open(watch_path, encoding="utf8") as fh:
        blob = json.load(fh)
    cands = blob.get("data", blob)["candidates"]

    started = time.time()
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda c: fetch(c, days), cands))

    with_news = [r for r in results if r["items"]]
    errors = [r for r in results if r["error"]]
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "window_days": days,
        "total": len(results),
        "with_news": len(with_news),
        "errors": len(errors),
        "results": results,
    }
    with open(out_path, "w", encoding="utf8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)

    print(f"{len(results)} Ticker, {len(with_news)} mit Treffern, "
          f"{len(errors)} Fehler, {time.time() - started:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
