#!/usr/bin/env python3
"""Event-Studie: Bewegen Analystenaktionen Kurse, und läuft danach noch etwas nach?

Eingabe im Arbeitsverzeichnis: raw/<SYM>.json (fetch.mjs), universe.json.
Ausgabe: results.json und die Tabellen auf stdout. Methode: docs/ANALYST_BACKTEST.md.
"""
import collections, datetime as dt, glob, json, os
import numpy as np

SELL = {'sell', 'underperform', 'underweight', 'reduce', 'strong sell', 'negative'}
HORIZONS = {'pre': (-5, -1), 'react': (0, 0), 'next': (1, 1), 'w1': (2, 6), 'm1': (2, 21), 'm3': (2, 61)}
EARN_FIRMS = 4       # ab so vielen Häusern am Tag gilt der Tag als Zahlen-Tag
PLACEBO_RUNS = 200
rng = np.random.default_rng(7)


def day(ts):
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).date()


spy = json.load(open('raw/SPY.json'))
cal = [day(t) for t in spy['t']]
idx = {d: i for i, d in enumerate(cal)}
T = len(cal)
universe = {u['symbol']: u for u in json.load(open('universe.json'))}

syms, rets, raw_events = [], [], {}
for f in sorted(glob.glob('raw/*.json')):
    s = os.path.basename(f)[:-5]
    if s in ('SPY', 'QQQ'):
        continue
    d = json.load(open(f))
    p = np.full(T, np.nan)
    for t, c in zip(d['t'], d['c']):
        i = idx.get(day(t))
        if i is not None and c:
            p[i] = c
    r = np.full(T, np.nan)
    r[1:] = np.log(p[1:] / p[:-1])
    r[np.abs(r) > 0.7] = np.nan           # Datenfehler, keine Bewegung
    syms.append(s)
    rets.append(r)
    raw_events[s] = d['events']
R = np.array(rets)
pos = {s: i for i, s in enumerate(syms)}
mkt = np.nanmean(R, axis=0)               # gleichgewichtetes eigenes Universum
spy_p = np.array(spy['c'], float)
spy_r = np.r_[np.nan, np.log(spy_p[1:] / spy_p[:-1])]
AR = R - mkt
alpha = np.nanmean(AR, axis=1, keepdims=True)
AD = AR - alpha                           # gegen Titelmittel: Überlebenden-Effekt raus
ADS = R - spy_r - np.nanmean(R - spy_r, axis=1, keepdims=True)


def t0_of(ts):
    d = dt.datetime.fromtimestamp(ts, dt.timezone.utc)
    i = np.searchsorted(np.array(cal, dtype='datetime64[D]'), np.datetime64(d.date()))
    if d.hour >= 20:                       # nach US-Schluss: zählt für den nächsten Tag
        i += (i < T and cal[i] == d.date())
    return int(i)


def kind(e):
    a, pt = e.get('action'), (e.get('priceTargetAction') or '').lower()
    if a == 'up':
        return 'upgrade'
    if a == 'down':
        return 'downgrade'
    if a == 'init':
        return 'init'
    if pt == 'raises':
        return 'target_up'
    if pt == 'lowers':
        return 'target_down'
    return None


events, firms_by_day = [], collections.defaultdict(set)
for s, hist in raw_events.items():
    for e in hist:
        i = t0_of(e['epochGradeDate'])
        if i >= T:
            continue
        firms_by_day[(s, i)].add(e.get('firm'))
        k = kind(e)
        if k:
            events.append((s, i, k, e))
earn = collections.defaultdict(set)
for (s, i), fs in firms_by_day.items():
    if len(fs) >= EARN_FIRMS:
        earn[s].update(range(i - 1, i + 3))

# Eine Beobachtung je Titel, Tag und Art; mehrere Häuser fallen zusammen.
units = {}
for s, i, k, e in events:
    u = units.setdefault((s, i, k), {'s': s, 'i': i, 'k': k, 'n': 0, 'to': set(), 'pct': []})
    u['n'] += 1
    u['to'].add((e.get('toGrade') or '').lower())
    cur, pri = e.get('currentPriceTarget') or 0, e.get('priorPriceTarget') or 0
    if cur > 0 and pri > 0:
        u['pct'].append(cur / pri - 1)
units = list(units.values())
for u in units:
    u['earn'] = u['i'] in earn[u['s']]
    u['react'] = None


def car(mat, si, i, h):
    a, b = i + h[0], i + h[1]
    if a < 1 or b >= T or i + 1 >= T:
        return np.nan
    x = mat[si, a:b + 1]
    return np.nan if np.isnan(x).mean() > 0.2 else float(np.nansum(x))


def stats(rows, h, mat=AD):
    vals = [(u['i'], car(mat, pos[u['s']], u['i'], HORIZONS[h])) for u in rows]
    vals = [(i, v) for i, v in vals if not np.isnan(v)]
    if len(vals) < 20:
        return None
    by_m = collections.defaultdict(list)
    for i, v in vals:
        by_m[(cal[i].year, cal[i].month)].append(v)
    months = sorted(by_m)
    means = np.array([np.mean(by_m[m]) for m in months])
    x = np.array([v for _, v in vals])
    # Newey-West: lange Fenster überlappen sich über Monatsgrenzen hinweg.
    a, b = HORIZONS[h]
    lag = int(np.ceil((b - a + 1) / 21))
    e = means - means.mean()
    var = (e @ e) / len(e)
    for l in range(1, lag + 1):
        var += 2 * (1 - l / (lag + 1)) * (e[l:] @ e[:-l]) / len(e)
    se = np.sqrt(max(var, 0) / len(e))
    return {'n': len(x), 'mean': float(x.mean() * 100), 'median': float(np.median(x) * 100),
            'hit_neg': float((x < 0).mean() * 100), 'months': len(means),
            't': float(means.mean() / se) if se else None}


def table(title, groups):
    print(f'\n## {title}')
    print(f"{'Gruppe':<34}{'n':>7}" + ''.join(f'{h:>16}' for h in HORIZONS))
    out = {}
    for name, rows in groups.items():
        cells, res = [], {}
        for h in HORIZONS:
            st = stats(rows, h)
            res[h] = st
            cells.append(f"{st['mean']:+6.2f}% (t{st['t']:+5.1f})" if st else f"{'–':>15}")
        print(f'{name:<34}{len(rows):>7}' + ''.join(f'{c:>16}' for c in cells))
        out[name] = res
    return out


results = {'universe': len(syms), 'days': T, 'raw_events': sum(len(v) for v in raw_events.values()),
           'from': str(cal[0]), 'to': str(cal[-1])}
clean = [u for u in units if not u['earn'] and u['i'] >= 1]
sel = lambda k, rows=clean: [u for u in rows if u['k'] == k]
KINDS = ['upgrade', 'downgrade', 'init', 'target_up', 'target_down']

results['all'] = table('Alle Meldungen, einschliesslich Zahlen-Tage', {k: sel(k, units) for k in KINDS})
results['clean'] = table('Ohne Zahlen-Tage (Hauptergebnis)', {k: sel(k) for k in KINDS})

mid = dt.date(2023, 1, 1)
split = {}
for k in ('upgrade', 'downgrade', 'target_up', 'target_down'):
    split[f'{k} bis 2022'] = [u for u in sel(k) if cal[u['i']] < mid]
    split[f'{k} ab 2023'] = [u for u in sel(k) if cal[u['i']] >= mid]
results['period'] = table('Zeiträume', split)

caps = sorted(v['market_cap'] for v in universe.values() if v.get('market_cap'))
lo, hi = caps[len(caps) // 3], caps[2 * len(caps) // 3]
cap = lambda u: universe.get(u['s'], {}).get('market_cap') or 0
size = {}
for k in ('upgrade', 'downgrade'):
    size[f'{k} klein'] = [u for u in sel(k) if 0 < cap(u) < lo]
    size[f'{k} mittel'] = [u for u in sel(k) if lo <= cap(u) < hi]
    size[f'{k} gross'] = [u for u in sel(k) if cap(u) >= hi]
results['size'] = table('Nach heutiger Marktkapitalisierung', size)

for u in clean:
    u['react'] = car(AD, pos[u['s']], u['i'], (0, 0))
ok = lambda u: u['react'] is not None and not np.isnan(u['react'])
cond = {
    'downgrade Reaktion ≤ −3 %': [u for u in sel('downgrade') if ok(u) and u['react'] <= -0.03],
    'downgrade Reaktion > −3 %': [u for u in sel('downgrade') if ok(u) and u['react'] > -0.03],
    'downgrade auf Sell-Stufe': [u for u in sel('downgrade') if u['to'] & SELL],
    'upgrade Reaktion ≥ +3 %': [u for u in sel('upgrade') if ok(u) and u['react'] >= 0.03],
    'upgrade Reaktion < +3 %': [u for u in sel('upgrade') if ok(u) and u['react'] < 0.03],
    'target_down ≥ 10 %': [u for u in sel('target_down') if u['pct'] and np.mean(u['pct']) <= -0.10],
    'target_up ≥ 10 %': [u for u in sel('target_up') if u['pct'] and np.mean(u['pct']) >= 0.10],
}
results['conditional'] = table('Bedingte Gruppen', cond)

# Häufung: mindestens drei Häuser in 5 Handelstagen in dieselbe Richtung, erster Tag zählt.
dirs = {'upgrade': 1, 'target_up': 1, 'downgrade': -1, 'target_down': -1}
by_title = collections.defaultdict(list)
for u in clean:
    if u['k'] in dirs:
        by_title[u['s']].append(u)
cluster = {1: [], -1: []}
for s, rows in by_title.items():
    rows.sort(key=lambda u: u['i'])
    for d in (1, -1):
        same = [u for u in rows if dirs[u['k']] == d]
        last = -99
        for j, u in enumerate(same):
            near = [v for v in same[max(0, j - 12):j + 1] if u['i'] - v['i'] <= 4]
            if sum(v['n'] for v in near) >= 3 and u['i'] - last > 10:
                cluster[d].append(u)
                last = u['i']
results['cluster'] = table('Häufung ab drei Häusern in 5 Tagen', {'nach oben': cluster[1], 'nach unten': cluster[-1]})
results['spy'] = {k: {h: stats(sel(k), h, ADS) for h in HORIZONS} for k in KINDS}
print('\nGegen SPY:', {k: {h: round(v['mean'], 2) for h, v in results['spy'][k].items() if v} for k in KINDS})

# Placebo: dieselben Titel, jedes Ereignis um 6 bis 13 Monate versetzt. Das erhält grob die
# zeitliche Verteilung. Kürzere Versätze taugen nicht: Das Fenster läge dann im Vorlauf
# oder Nachlauf des echten Ereignisses und enthielte dessen Kursbewegung.
print('\n## Placebo mit versetzten Terminen')
placebo = {}
groups = {**{k: sel(k) for k in KINDS}, 'Häufung oben': cluster[1], 'Häufung unten': cluster[-1]}
for name, rows in groups.items():
    for h in ('w1', 'm1', 'm3'):
        actual = stats(rows, h)['mean'] / 100
        a, b = HORIZONS[h]
        sims = []
        for _ in range(PLACEBO_RUNS):
            off = rng.integers(126, 274, len(rows)) * rng.choice([-1, 1], len(rows))
            vals = [car(AD, pos[u['s']], int(u['i'] + o), (a, b)) for u, o in zip(rows, off)
                    if 1 <= u['i'] + o < T - b - 1]
            sims.append(np.nanmean(vals))
        sims = np.array(sims)
        p = float((np.abs(sims - sims.mean()) >= abs(actual - sims.mean())).mean())
        placebo[f'{name}/{h}'] = {'actual': actual * 100, 'placebo': float(sims.mean() * 100), 'sd': float(sims.std() * 100), 'p': p}
        print(f'{name:<15}{h:<4} ist {actual*100:+6.2f}%  Placebo {sims.mean()*100:+6.2f}% ±{sims.std()*100:4.2f}  p={p:.3f}')
results['placebo'] = placebo
clu = {}
for d, n in ((1, 'oben'), (-1, 'unten')):
    clu[f'Häufung {n} bis 2022'] = [u for u in cluster[d] if cal[u['i']] < mid]
    clu[f'Häufung {n} ab 2023'] = [u for u in cluster[d] if cal[u['i']] >= mid]
results['cluster_period'] = table('Häufung nach Zeitraum', clu)
json.dump(results, open('results.json', 'w'), indent=1, default=str)
