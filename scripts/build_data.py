#!/usr/bin/env python3
"""Costruisce i file che il sito legge (site/data/) a partire dal catalogo, dall'anagrafica e dai dati scaricati.

Uso:  python scripts/build_data.py

Output (site/data/, non versionato):
  index.json            anagrafica delle stazioni a catalogo, fiumi e laghi con l'ordine da monte a valle,
                        stato di oggi (ultimo valore, percentile rispetto alla climatologia del giorno, tendenza,
                        sparkline degli ultimi 7 giorni), record storici, ritardi di propagazione delle piene.
                        È l'unico file caricato all'apertura (~100 KB).
  rivers/<id>.json      per ogni fiume: serie giornaliere (min, media, max) per anno e climatologia per giorno
  lakes/<id>.json       dell'anno (percentili 5, 25, 50, 75, 95 su una finestra di ±15 giorni). Caricati a richiesta.
  recent.json           ultime settimane a risoluzione oraria per tutte le stazioni. Caricato a richiesta.
  history.json          per ogni stazione, percentile e media di ogni giorno dal primo anno (binario in base64):
                        serve alla navigazione per data (mappa ed elenco a una data passata). Caricato a richiesta.

Tutte le statistiche sono calcolate qui, una volta per notte: il browser disegna soltanto.
"""
import base64, datetime as dt, glob, math, os, struct, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (DATA_DIR, FIRST_YEAR, OPEN_DIR, SITE_DATA, load_catalog, load_stations, log,  # noqa: E402
                    now_iso, plausible, read_json, write_json)

CLIM_WINDOW = 15       # ±giorni attorno al giorno dell'anno per la climatologia
CLIM_MIN = 60          # campioni minimi per calcolare i percentili
STALE_HOURS = 48       # oltre queste ore senza misure la stazione è "ferma"
SPARK_DAYS, SPARK_STEP = 7, 6
PCTS = (5, 25, 50, 75, 95)
MAX_LAG_H = 96


def doy(day: str) -> int:
    d = dt.date.fromisoformat(day)
    return (d - dt.date(d.year, 1, 1)).days           # 0-based, 366 slot con gli anni bisestili


def percentile(sorted_vals: list, p: float) -> float:
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * p / 100
    lo, hi = math.floor(k), math.ceil(k)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def rank(sorted_vals: list, v: float) -> float:
    """Percentuale di campioni sotto v (0-100)."""
    import bisect
    if not sorted_vals:
        return None
    return round(100 * bisect.bisect_left(sorted_vals, v) / len(sorted_vals), 1)


def status_class(pct) -> str:
    if pct is None:
        return 'nd'
    return 'lo2' if pct < 5 else 'lo1' if pct < 25 else 'ok' if pct <= 75 else 'hi1' if pct <= 95 else 'hi2'


def load_daily() -> dict:
    """{sid: {year: {doy: (lo, a, hi, n)}}} più le sorgenti per anno."""
    daily: dict = {}
    src: dict = {}
    for path in sorted(glob.glob(os.path.join(DATA_DIR, 'levels-*.json'))):
        f = read_json(path)
        for s, d, lo, a, hi, n in f['rows']:
            if not plausible(lo, a, hi):       # valori assurdi del flusso non validato: il giorno non esiste
                continue
            daily.setdefault(s, {}).setdefault(int(d[:4]), {})[doy(d)] = (lo, a, hi, n)
        for s, kind in f.get('src', {}).items():
            src.setdefault(int(s), {})[f['year']] = kind
    return daily, src


def climatology(years: dict) -> dict:
    """Percentili della media giornaliera per ogni giorno dell'anno, finestra ±CLIM_WINDOW su tutti gli anni."""
    by_doy = [[] for _ in range(366)]
    for y, days in years.items():
        for i, (lo, a, hi, n) in days.items():
            by_doy[i].append(a)
    out = {f'p{p}': [] for p in PCTS}
    samples = []
    for i in range(366):
        vals = []
        for k in range(i - CLIM_WINDOW, i + CLIM_WINDOW + 1):
            vals += by_doy[k % 366]
        vals.sort()
        samples.append(vals)
        for p in PCTS:
            out[f'p{p}'].append(round(percentile(vals, p)) if len(vals) >= CLIM_MIN else None)
    return out, samples


def year_arrays(days: dict, year: int) -> dict:
    n = 366 if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) else 365
    lo = [None] * n; a = [None] * n; hi = [None] * n
    for i, (l, m, h, c) in days.items():
        if i < n:
            lo[i], a[i], hi[i] = l, m, h
    return {'lo': lo, 'a': a, 'hi': hi}


def records(years: dict, key: int, reverse: bool, k: int = 10) -> list:
    """I k giorni più alti (key=2, max) o più bassi (key=0, min), distanziati almeno 10 giorni tra loro."""
    ranked = sorted(((v[key], y, i) for y, days in years.items() for i, v in days.items()), reverse=reverse)
    out = []
    for val, y, i in ranked:
        d = dt.date(y, 1, 1) + dt.timedelta(days=i)
        if all(abs((d - dt.date.fromisoformat(o[0])).days) >= 10 for o in out):
            out.append([d.isoformat(), val])
        if len(out) == k:
            break
    return out


def hourly_map(series: list) -> dict:
    """[[day, hour, v], ...] -> {datetime: v}"""
    return {dt.datetime.fromisoformat(d) + dt.timedelta(hours=h): v for d, h, v in series}


def sparkline(hours: dict, end: dt.datetime) -> list:
    out = []
    start = end - dt.timedelta(days=SPARK_DAYS)
    t = start
    while t < end:
        vals = [v for k, v in hours.items() if t <= k < t + dt.timedelta(hours=SPARK_STEP)]
        out.append(round(sum(vals) / len(vals)) if vals else None)
        t += dt.timedelta(hours=SPARK_STEP)
    return out


def xcorr_lag(up: dict, down: dict, max_lag: int = MAX_LAG_H):
    """Ritardo (ore) che massimizza la correlazione tra la serie a monte e quella a valle nella finestra dell'evento.
    Più robusto del confronto tra i due massimi: usa tutta la forma dell'onda, non un solo punto."""
    if not up or not down:
        return None
    t0, t1 = min(min(up), min(down)), max(max(up), max(down))
    n = int((t1 - t0).total_seconds() // 3600) + 1
    u = [up.get(t0 + dt.timedelta(hours=k)) for k in range(n)]
    d = [down.get(t0 + dt.timedelta(hours=k)) for k in range(n)]
    best = None
    for lag in range(0, max_lag + 1):
        pairs = [(u[k], d[k + lag]) for k in range(n - lag) if u[k] is not None and d[k + lag] is not None]
        if len(pairs) < 48:
            continue
        mu = sum(a for a, _ in pairs) / len(pairs)
        md = sum(b for _, b in pairs) / len(pairs)
        su = sum((a - mu) ** 2 for a, _ in pairs) ** .5
        sd = sum((b - md) ** 2 for _, b in pairs) ** .5
        if su < 1 or sd < 1:
            continue
        r = sum((a - mu) * (b - md) for a, b in pairs) / (su * sd)
        if best is None or r > best[1]:
            best = (lag, r)
    return best


def lag_stats(ev_file: dict) -> dict:
    lags = []
    for e in ev_file['events']:
        b = xcorr_lag(hourly_map(e['up']), hourly_map(e['down']))
        # correlazione debole o ritardo a ridosso del limite della finestra: l'onda non si riconosce, evento scartato
        if b and b[1] >= 0.7 and b[0] <= MAX_LAG_H - 6:
            lags.append(b[0])
    lags.sort()
    if len(lags) < 3:
        return {'n': len(lags), 'events': len(ev_file['events'])}
    return {'n': len(lags), 'median': round(percentile(lags, 50)), 'q1': round(percentile(lags, 25)),
            'q3': round(percentile(lags, 75)), 'events': len(ev_file['events'])}


def main() -> None:
    cat = load_catalog()
    stations = load_stations()
    daily, src = load_daily()
    recent = read_json(os.path.join(OPEN_DIR, 'recent.json'), {'hourly': {}, 'latest': {}, 'generated': None})
    now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    today = now.date()
    today_doy = doy(today.isoformat())

    index = {'generated': now_iso(), 'data_generated': recent.get('generated'), 'first_year': FIRST_YEAR,
             'stations': {}, 'rivers': [], 'lakes': [], 'lags': {}}
    # storia compatta per la navigazione per data: per ogni stazione e giorno dal FIRST_YEAR, percentile del giorno
    # (1 byte, 255 = assente) e media giornaliera (int16, cm). Caricata dal sito solo quando si sceglie una data.
    hist_start = dt.date(FIRST_YEAR, 1, 1)
    hist_days = (today - hist_start).days + 1
    history = {'start': hist_start.isoformat(), 'days': hist_days, 'pct': {}, 'mean': {}}

    def build_station(sid: int, body: str, kind: str, entry: dict, order: int) -> None:
        st = stations.get(sid)
        if not st:
            log(f'  sensore {sid} non in anagrafica: ignorato')
            return
        years = daily.get(sid, {})
        clim, samples = climatology(years) if years else ({f'p{p}': [None] * 366 for p in PCTS}, [[]] * 366)
        latest = recent['latest'].get(str(sid))
        if latest and not plausible(latest[1]):
            latest = None
        hours = {k: v for k, v in hourly_map(recent['hourly'].get(str(sid), [])).items() if plausible(v)}
        value = ts = pct = trend = None
        cls = 'nd'
        if latest:
            ts, value = latest
            t = dt.datetime.fromisoformat(ts)
            age_h = (now - t).total_seconds() / 3600
            if age_h > STALE_HOURS:
                cls = 'stale'
            else:
                pct = rank(samples[today_doy], value) if len(samples[today_doy]) >= CLIM_MIN else None
                cls = status_class(pct)
                prev = [v for k, v in hours.items() if t - dt.timedelta(hours=7) <= k <= t - dt.timedelta(hours=5)]
                if prev:
                    trend = round(value - sum(prev) / len(prev))
        first = min(years) if years else None
        index['stations'][sid] = {
            'name': entry.get('label') or st['nomestazione'], 'prov': st['provincia'], 'lat': float(st['lat']), 'lng': float(st['lng']),
            'alt': int(float(st['quota'])) if st['quota'] else None,
            'body': body, 'kind': kind, 'order': order, 'km': entry.get('km'), 'note': entry.get('note'),
            'verify': bool(entry.get('verify')), 'first': first,
            'years': sorted(years), 'src': src.get(sid, {}),
            'ts': ts, 'value': value, 'pct': pct, 'cls': cls, 'trend': trend,
            'spark': sparkline(hours, now) if hours else None,
            'clim_today': {k: v[today_doy] for k, v in clim.items()},
            'rec_hi': records(years, 2, True), 'rec_lo': records(years, 0, False),
        }
        pct_b = bytearray([255] * hist_days)
        mean_b = bytearray(b'\x00\x80' * hist_days)      # -32768 = assente
        for y, days in years.items():
            for i, (lo, a, hi, n) in days.items():
                k = (dt.date(y, 1, 1) + dt.timedelta(days=i) - hist_start).days
                if 0 <= k < hist_days:
                    r = rank(samples[i], a) if len(samples[i]) >= CLIM_MIN else None
                    pct_b[k] = 255 if r is None else int(round(r))
                    struct.pack_into('<h', mean_b, 2 * k, max(-32767, min(32767, int(round(a)))))
        history['pct'][sid] = base64.b64encode(bytes(pct_b)).decode()
        history['mean'][sid] = base64.b64encode(bytes(mean_b)).decode()
        return {'years': {y: year_arrays(d, y) for y, d in years.items()}, 'clim': clim}

    for kind, key in (('river', 'rivers'), ('lake', 'lakes')):
        for body in cat[key]:
            detail = {'id': body['id'], 'name': body['name'], 'generated': index['generated'], 'stations': {}}
            ids = []
            for order, entry in enumerate(body['stations']):
                d = build_station(entry['id'], body['id'], kind, entry, order)
                if d:
                    detail['stations'][entry['id']] = d
                    ids.append(entry['id'])
            write_json(os.path.join(SITE_DATA, key, f'{body["id"]}.json'), detail)
            index[key].append({k: v for k, v in body.items() if k != 'stations'} | {'stations': ids})
            log(f'{body["name"]}: {len(ids)} stazioni')

    pairs = {f'{a["id"]}-{b["id"]}' for r in cat['rivers'] for a, b in zip(r['stations'], r['stations'][1:])}
    for path in sorted(glob.glob(os.path.join(DATA_DIR, 'events', '*.json'))):
        ev = read_json(path)
        if f'{ev["up"]}-{ev["down"]}' not in pairs:      # coppia non più consecutiva nel catalogo (file orfano)
            continue
        index['lags'][f'{ev["up"]}-{ev["down"]}'] = lag_stats(ev) | {'river': ev['river'], 'up': ev['up'], 'down': ev['down']}
    # coppie in cui la propagazione non ha senso (un lago in mezzo): dichiarate nel catalogo con "lag": false
    for r in cat['rivers']:
        ids = [s['id'] for s in r['stations']]
        for prev, entry in zip(ids, r['stations'][1:]):
            if entry.get('lag') is False:
                index['lags'][f'{prev}-{entry["id"]}'] = {'n': 0, 'skip': 'lake', 'river': r['id'], 'up': prev, 'down': entry['id']}

    write_json(os.path.join(SITE_DATA, 'index.json'), index)
    write_json(os.path.join(SITE_DATA, 'history.json'), history)
    # orario compatto: per stazione un'ora di partenza e un array con un valore (o null) per ogni ora successiva
    compact = {}
    for sid, series in recent['hourly'].items():
        hm = hourly_map(series)
        if not hm:
            continue
        t0, t1 = min(hm), max(hm)
        n = int((t1 - t0).total_seconds() // 3600) + 1
        compact[sid] = {'start': t0.strftime('%Y-%m-%dT%H'), 'v': [hm.get(t0 + dt.timedelta(hours=k)) for k in range(n)]}
    write_json(os.path.join(SITE_DATA, 'recent.json'), {'generated': recent.get('generated'), 'hourly': compact})
    size = os.path.getsize(os.path.join(SITE_DATA, 'index.json')) // 1024
    log(f'index.json: {len(index["stations"])} stazioni, {size} KB; {len(index["lags"])} coppie con ritardo')


if __name__ == '__main__':
    main()
