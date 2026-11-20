#!/usr/bin/env python3
"""
Watchlist-Ranking und Prognose-Check für den Sonntags-Rückblick (kind "watch").

Zwei Modi, beide rein rechnend (keine Netzzugriffe):

  rank   python3 watch_rank.py rank full.json method.json DAY > rank.json
         Basis-Score 0–100 je Augen-Titel (eye == true) aus watch_setups und
         stocks, mit den Gewichten aus method.json (Artefakt-Datenbank
         `watch_method/current`; fehlt sie, gelten DEFAULT_WEIGHTS). Claude
         ergänzt danach je Titel eine begründete Korrektur adj (−15…+15) aus
         Nachrichten/Katalysatoren; score = base + adj.

  review python3 watch_rank.py review prev.json full.json method.json > review.json
         Vergleicht das Ranking der Vorwoche (prev.json = gespeichertes
         Watch-Briefing mit `ranking`) mit der tatsächlichen Wochenbewegung
         (perf_1w in full.json): Rangkorrelation, Top- vs. Flop-Drittel,
         Trefferquote, Ziel/Stopp auf Schlusskursbasis und je Faktor die
         Korrelation mit dem Ergebnis. Daraus ein Vorschlag für neue Gewichte
         (je Woche höchstens ±STEP je Faktor, Untergrenze MIN_W, Summe 1) –
         Claude prüft ihn, begründet die Lehren und schreibt die Methode zurück.

Die Faktoren (alle 0…1, höher = bessere Wochenchance):
  trend     Trend-Radar / 100
  bias      gerichtetes Bias (−100…+100) → 0…1
  quality   Gesamt-Score / 100
  breakout  Nähe zum nächsten Widerstand bzw. 52W-Hoch: 1 − Abstand/10 %
  crv       Chance/Risiko: Potenzial bis Widerstand (max. 15 %) ÷ Abstand zur
            Unterstützung (min. 3 %), /3
  sma       über SMA50 und/oder SMA200 (0 / 0,5 / 1)
  delta     Score-Veränderung zum Vortag, −10…+10 → 0…1
Abzüge in Punkten: RSI > 80 → penalty_rsi_hot; Kurs unter SMA50 und SMA200 → penalty_below.
"""
import json
import sys
from datetime import date, timedelta

DEFAULT_WEIGHTS = {'trend': 0.20, 'bias': 0.15, 'quality': 0.10, 'breakout': 0.20,
                   'crv': 0.15, 'sma': 0.10, 'delta': 0.10}
DEFAULT_PENALTIES = {'penalty_rsi_hot': 5, 'penalty_below': 5}
STEP, MIN_W, MAX_W = 0.02, 0.03, 0.35
CAP_POT, MIN_RISK = 15.0, 3.0   # Prozent


def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def method_of(m):
    w = dict(DEFAULT_WEIGHTS)
    w.update({k: float(v) for k, v in ((m or {}).get('weights') or {}).items() if k in DEFAULT_WEIGHTS})
    pen = dict(DEFAULT_PENALTIES)
    pen.update({k: float(v) for k, v in ((m or {}).get('penalties') or {}).items() if k in DEFAULT_PENALTIES})
    s = sum(w.values()) or 1
    return {k: v / s for k, v in w.items()}, pen


def num(v):
    return None if v is None else float(v)


def factors(s, w):
    """s = stocks-Eintrag, w = watch_setups-Eintrag (beide für denselben Titel)."""
    res_d, sup_d = num(w.get('res_dist_pct')), num(w.get('sup_dist_pct'))
    hi_d, up, down = num(w.get('high_52w_dist_pct')), num(w.get('upside_pct')), num(w.get('downside_pct'))
    potential = res_d if res_d is not None and res_d > 0 else up
    # Widerstand praktisch erreicht (< 2 %): nach einem Ausbruch zählt das 52W-Hoch
    if res_d is not None and 0 < res_d < 2 and hi_d is not None and hi_d > res_d:
        potential = hi_d
    risk = abs(sup_d) if sup_d is not None and sup_d < 0 else (abs(down) if down else None)
    prox = lambda d: clamp(1 - d / 10) if d is not None and d >= 0 else 0.0
    # Wochenhorizont: Potenzial höchstens CAP_POT, Risiko mindestens MIN_RISK –
    # sonst explodiert das CRV bei Kursen direkt auf der Unterstützung.
    crv = (min(potential, CAP_POT) / max(risk, MIN_RISK)) if potential is not None and risk else None
    a50, a200 = bool(s.get('above_sma50')), bool(s.get('above_sma200'))
    ds = num(w.get('d_score'))
    f = {
        'trend': clamp((num(w.get('trend')) or 0) / 100),
        'bias': clamp(((num(w.get('bias')) or 0) + 100) / 200),
        'quality': clamp((num(w.get('score')) or 0) / 100),
        'breakout': max(prox(res_d), prox(hi_d)),
        'crv': clamp(crv / 3) if crv is not None else 0.0,
        'sma': (a50 + a200) / 2,
        'delta': clamp(((ds if ds is not None else 0) + 10) / 20),
    }
    return f, potential, risk, crv


def target_of(s, w, potential):
    res_d, close = num(w.get('res_dist_pct')), num(s.get('close'))
    if res_d is not None and 0 < res_d < 2 and potential and close:
        return round(close * (1 + potential / 100), 2)   # 52W-Hoch nach Ausbruch
    return w.get('res') if (res_d or 0) > 0 else None


def setup_of(s, w, earn_week):
    rsi, bias, res_d, trend = num(s.get('rsi')) or 50, num(w.get('bias')) or 0, num(w.get('res_dist_pct')), num(w.get('trend')) or 0
    sig = set(w.get('signals') or [])
    a50, a200 = bool(s.get('above_sma50')), bool(s.get('above_sma200'))
    if earn_week:
        return 'Katalysator'
    if res_d is not None and 0 < res_d <= 5 and trend >= 50 and a50:
        return 'Ausbruch'
    if rsi < 35 and sig & {'momentum_up', 'score_up', 'macd_bullish'}:
        return 'Erholung'
    if bias <= -30 or (not a50 and not a200):
        return 'Abwärtstrend'
    if a50 and a200 and bias >= 30:
        return 'Trendfortsetzung'
    return 'Seitwärts'


def chance_of(score):
    return 'hoch' if score >= 70 else 'mittel' if score >= 50 else 'gering'


def rank(full, method, day):
    weights, pen = method_of(method)
    d0 = date.fromisoformat(day)
    week_end = (d0 + timedelta(days=7)).isoformat()
    setups = {(w['symbol'], w.get('exchange')): w for w in full.get('watch_setups', [])}
    out = []
    for s in full.get('stocks', []):
        if not s.get('eye'):
            continue
        w = setups.get((s['symbol'], s.get('exchange'))) or {}
        f, potential, risk, crv = factors(s, w)
        base = 100 * sum(weights[k] * f[k] for k in weights)
        penalties = []
        if (num(s.get('rsi')) or 0) > 80:
            base -= pen['penalty_rsi_hot']; penalties.append('RSI > 80')
        if not s.get('above_sma50') and not s.get('above_sma200'):
            base -= pen['penalty_below']; penalties.append('unter SMA50 und SMA200')
        en = s.get('earnings_next') or w.get('earnings_next')
        earn_week = bool(en and day < en <= week_end)
        out.append({
            'symbol': s['symbol'], 'exchange': s.get('exchange'), 'name': s.get('name'), 'sector': s.get('sector'),
            'currency': s.get('currency'), 'close': s.get('close'),
            'base': round(clamp(base, 0, 100), 1),
            'setup': setup_of(s, {**w, 'bias': w.get('bias', s.get('bias'))}, earn_week),
            'potential_pct': None if potential is None else round(potential, 1),
            'target': target_of(s, w, potential),
            'stop': w.get('sup'), 'risk_pct': None if risk is None else round(risk, 1),
            'crv': None if crv is None else round(crv, 2),
            'earnings': en if earn_week else None,
            'penalties': penalties,
            'factors': {k: round(v, 2) for k, v in f.items()},
            'perf_1w': s.get('perf_1w'), 'perf_1m': s.get('perf_1m'), 'rsi': s.get('rsi'),
            'signals': w.get('signals') or [],
        })
    out.sort(key=lambda r: -r['base'])
    for i, r in enumerate(out, 1):
        r['base_rank'] = i
    return {'day': day, 'weights': {k: round(v, 3) for k, v in weights.items()}, 'penalties': pen, 'items': out}


def ranks(vals):
    order = sorted(range(len(vals)), key=lambda i: vals[i])
    r = [0.0] * len(vals)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and vals[order[j + 1]] == vals[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def spearman(a, b):
    if len(a) < 3:
        return None
    ra, rb = ranks(a), ranks(b)
    n = len(a)
    ma, mb = sum(ra) / n, sum(rb) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    va = sum((x - ma) ** 2 for x in ra) ** 0.5
    vb = sum((y - mb) ** 2 for y in rb) ** 0.5
    return round(cov / (va * vb), 2) if va and vb else None


def median(v):
    v = sorted(v)
    n = len(v)
    return None if not n else (v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2)


def review(prev, full, method):
    weights, _ = method_of(method)
    now = {(s['symbol'], s.get('exchange')): s for s in full.get('stocks', [])}
    items = []
    for r in prev.get('ranking') or []:
        s = now.get((r['symbol'], r.get('exchange')))
        if not s or s.get('perf_1w') is None:
            continue
        close = num(s.get('close'))
        items.append({
            'rank': r.get('rank'), 'symbol': r['symbol'], 'exchange': r.get('exchange'), 'name': r.get('name'),
            'score': r.get('score'), 'chance': r.get('chance'), 'setup': r.get('setup'),
            'potential_pct': r.get('potential_pct'), 'perf_1w': s['perf_1w'],
            'target_hit': bool(r.get('target') and close and close >= float(r['target'])),
            'stop_hit': bool(r.get('stop') and close and close <= float(r['stop'])),
            'factors': r.get('factors') or {},
        })
    if not items:
        return {'available': False, 'reason': 'kein Ranking der Vorwoche gefunden'}
    items.sort(key=lambda x: x['rank'] or 999)
    perf = [x['perf_1w'] for x in items]
    med = median(perf)
    third = max(1, len(items) // 3)
    top, bottom = items[:third], items[-third:]
    avg = lambda xs: round(sum(x['perf_1w'] for x in xs) / len(xs), 2)
    for x in items:
        x['beat_median'] = x['perf_1w'] > med
        if x in top:
            x['verdict'] = 'Treffer' if x['beat_median'] and x['perf_1w'] > 0 else 'teilweise' if x['beat_median'] or x['perf_1w'] > 0 else 'Fehlschlag'
        elif x in bottom:
            x['verdict'] = 'Treffer' if not x['beat_median'] else 'Fehlschlag'
        else:
            x['verdict'] = None
    judged = [x for x in items if x['verdict']]
    hits = sum(1 for x in judged if x['verdict'] == 'Treffer')
    # Faktor-Korrelation mit dem Wochenergebnis → Gewichtsvorschlag
    corr = {}
    for k in weights:
        vals = [x['factors'].get(k) for x in items]
        if all(v is not None for v in vals) and len(set(vals)) > 1:
            corr[k] = spearman(vals, perf)
    sug = dict(weights)
    for k, c in corr.items():
        if c is None or abs(c) < 0.2:
            continue
        sug[k] = clamp(sug[k] + (STEP if c > 0 else -STEP), MIN_W, MAX_W)
    s = sum(sug.values())
    sug = {k: round(v / s, 3) for k, v in sug.items()}
    for x in items:
        x.pop('factors', None)
    return {
        'available': True, 'prev_day': prev.get('day'), 'n': len(items),
        'spearman': spearman([-(x['rank'] or 0) for x in items], perf),
        'median_1w': round(med, 2), 'top_third_avg': avg(top), 'bottom_third_avg': avg(bottom),
        'hit_rate_pct': round(100 * hits / len(judged)) if judged else None,
        'targets_hit': sum(x['target_hit'] for x in items), 'stops_hit': sum(x['stop_hit'] for x in items),
        'factor_corr': corr, 'weights_old': {k: round(v, 3) for k, v in weights.items()}, 'weights_suggested': sug,
        'items': items,
    }


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    if mode == 'rank':
        full, m = load(sys.argv[2]), (load(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] != '-' else {})
        day = sys.argv[4] if len(sys.argv) > 4 else date.today().isoformat()
        print(json.dumps(rank(full, m, day), ensure_ascii=False, indent=1))
    elif mode == 'review':
        prev, full = load(sys.argv[2]), load(sys.argv[3])
        m = load(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] != '-' else {}
        print(json.dumps(review(prev, full, m), ensure_ascii=False, indent=1))
    else:
        sys.exit('Aufruf: watch_rank.py rank full.json method.json DAY | review prev.json full.json method.json')
