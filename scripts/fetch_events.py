#!/usr/bin/env python3
"""Per ogni coppia di stazioni consecutive lungo un fiume scarica, a risoluzione oraria, le finestre delle
maggiori piene registrate alla stazione di valle: servono a misurare quante ore impiega un picco a
propagarsi da monte a valle ("quando arriva la piena").

Uso:
  python scripts/fetch_events.py              # aggiorna le coppie che hanno eventi nuovi o mancanti
  python scripts/fetch_events.py --force      # riscarica tutto

Come funziona:
  1. dai file giornalieri data/levels-*.json prende, per la stazione di valle, i N giorni con il massimo più alto,
     distanziati almeno MIN_GAP giorni (eventi distinti);
  2. per ogni evento scarica la media oraria di entrambe le stazioni nella finestra [picco - 4 giorni, picco + 3 giorni]
     dalla serie validata dell'anno (o dal flusso corrente se l'anno è recente);
  3. salva data/events/<monte>-<valle>.json. Il calcolo del ritardo è in build_data.py.
Un file per coppia, versionato: le piene passate non cambiano, quindi il download è quasi sempre incrementale.
"""
import argparse, datetime as dt, glob, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (DATA_DIR, DS_CURRENT, DS_VALIDATED, VALID_RANGE, load_catalog, log, now_iso,  # noqa: E402
                    read_json, soda, write_json)

N_EVENTS = 10
MIN_GAP = 15          # giorni tra due eventi distinti
BEFORE, AFTER = 4, 3  # finestra in giorni attorno al picco
EVENTS_DIR = os.path.join(DATA_DIR, 'events')


def pairs_from_catalog(cat: dict) -> list:
    out = []
    for r in cat['rivers']:
        st = r['stations']
        for up, down in zip(st, st[1:]):
            if down.get('lag') is False:      # un lago tra le due stazioni: nessuna propagazione da misurare
                continue
            out.append((r['id'], up['id'], down['id']))
    return out


def load_daily() -> dict:
    """{sid: {day: (lo, a, hi)}} da tutti i file annuali."""
    daily: dict = {}
    for path in sorted(glob.glob(os.path.join(DATA_DIR, 'levels-*.json'))):
        for s, d, lo, a, hi, n in read_json(path)['rows']:
            daily.setdefault(s, {})[d] = (lo, a, hi)
    return daily


def pick_events(series: dict) -> list:
    """I giorni di picco più alti, distanziati tra loro (escludendo l'ultima settimana, ancora in evoluzione)."""
    cutoff = (dt.date.today() - dt.timedelta(days=AFTER + 1)).isoformat()
    ranked = sorted(((v[2], d) for d, v in series.items() if d < cutoff), reverse=True)
    chosen: list = []
    for hi, d in ranked:
        dd = dt.date.fromisoformat(d)
        if all(abs((dd - dt.date.fromisoformat(c)).days) >= MIN_GAP for c in chosen):
            chosen.append(d)
        if len(chosen) == N_EVENTS:
            break
    return sorted(chosen)


def dataset_for(day: str) -> tuple:
    year = int(day[:4])
    for lo, hi, ds in DS_VALIDATED:
        if lo <= year <= hi:
            return ds, "stato='1'"
    return DS_CURRENT, "stato='VA'"


def fetch_window(ids: list, peak: str) -> dict:
    p = dt.date.fromisoformat(peak)
    start, end = p - dt.timedelta(days=BEFORE), p + dt.timedelta(days=AFTER + 1)
    inlist = ','.join(f"'{i}'" for i in ids)
    series = {str(i): [] for i in ids}
    # se la finestra non è nella serie validata (anno recente) si ripiega sul flusso corrente
    for ds, valid in dict([dataset_for(peak), (DS_CURRENT, "stato='VA'")]).items():
        rows = soda(ds, {
            '$select': 'idsensore as s,date_trunc_ymd(data) as d,date_extract_hh(data) as h,avg(valore) as v',
            '$where': f"idsensore in({inlist}) and {valid} and {VALID_RANGE} and data >= '{start}T00:00:00' and data < '{end}T00:00:00'",
            '$group': 's,d,h', '$order': 's,d,h', '$limit': 50000,
        })
        for r in rows:
            series[r['s']].append([r['d'][:10], int(r['h']), round(float(r['v']), 1)])
        if all(series.values()):
            break
    return series


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()
    cat = load_catalog()
    daily = load_daily()
    os.makedirs(EVENTS_DIR, exist_ok=True)
    for river, up, down in pairs_from_catalog(cat):
        if down not in daily or up not in daily:
            log(f'{river} {up}->{down}: dati giornalieri mancanti, salto')
            continue
        path = os.path.join(EVENTS_DIR, f'{up}-{down}.json')
        old = {} if args.force else {e['peak']: e for e in read_json(path, {'events': []})['events']}
        peaks = pick_events(daily[down])
        events, new = [], 0
        for peak in peaks:
            if peak in old:
                events.append(old[peak])
                continue
            w = fetch_window([up, down], peak)
            events.append({'peak': peak, 'up': w[str(up)], 'down': w[str(down)]})
            new += 1
        if new or args.force or not os.path.exists(path):
            write_json(path, {'river': river, 'up': up, 'down': down, 'generated': now_iso(), 'events': events})
        log(f'{river} {up}->{down}: {len(events)} eventi ({new} nuovi)')


if __name__ == '__main__':
    main()
