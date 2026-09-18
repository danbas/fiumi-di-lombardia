#!/usr/bin/env python3
"""Aiuta a verificare il catalogo: per ogni stazione chiede a OpenStreetMap (Overpass) il corso d'acqua più vicino
e lo confronta con il fiume assegnato in data/catalog.json. Non modifica nulla: stampa un rapporto.

Uso:  python scripts/check_rivers_osm.py [--radius 300] [--only-verify]

Overpass è un servizio pubblico condiviso: lo script fa una richiesta per stazione con una pausa di un secondo
(~80 richieste in un paio di minuti). Da usare a mano, non nel workflow.
"""
import argparse, json, os, sys, time, unicodedata, urllib.parse, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import load_catalog, load_stations, log  # noqa: E402

OVERPASS = 'https://overpass-api.de/api/interpreter'


def norm(s: str) -> str:
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    for w in ('fiume', 'torrente', 'lago', 'di', 'del', 'della', 'canale', 'roggia', 'naviglio'):
        s = s.replace(w + ' ', '')
    return s.strip()


def nearest_waterways(lat: float, lng: float, radius: int) -> list:
    q = f'''[out:json][timeout:25];
(way(around:{radius},{lat},{lng})["waterway"~"^(river|stream|canal)$"]["name"];
 way(around:{radius},{lat},{lng})["natural"="water"]["water"="lake"]["name"];
 relation(around:{radius},{lat},{lng})["natural"="water"]["water"="lake"]["name"];);
out tags;'''
    data = urllib.parse.urlencode({'data': q}).encode()
    req = urllib.request.Request(OVERPASS, data=data, headers={'User-Agent': 'fiumi-di-lombardia (catalog check)'})
    with urllib.request.urlopen(req, timeout=60) as r:
        els = json.load(r)['elements']
    names = []
    for e in els:
        t = e.get('tags', {})
        n = t.get('name')
        if n and n not in names:
            names.append(n)
    return names


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--radius', type=int, default=300, help='raggio di ricerca in metri (default 300)')
    ap.add_argument('--only-verify', action='store_true', help='solo le stazioni marcate "verify" nel catalogo')
    args = ap.parse_args()
    cat, st = load_catalog(), load_stations()
    rows = []
    for kind in ('rivers', 'lakes'):
        for body in cat[kind]:
            for s in body['stations']:
                if args.only_verify and not s.get('verify'):
                    continue
                rows.append((body['name'], s['id'], bool(s.get('verify'))))
    log(f'{len(rows)} stazioni da controllare su Overpass (raggio {args.radius} m)')
    mismatches = 0
    for body_name, sid, verify in rows:
        info = st.get(sid)
        if not info:
            continue
        try:
            names = nearest_waterways(float(info['lat']), float(info['lng']), args.radius)
        except Exception as e:  # noqa: BLE001
            names = [f'errore: {e}']
        ok = any(norm(body_name).split(' ')[0] in norm(n) for n in names)
        flag = 'OK ' if ok else ('?? ' if names else '-- ')
        if not ok:
            mismatches += 1
        osm = ', '.join(names) or "nessun corso d'acqua entro il raggio"
        print(f"{flag}{sid:>6} {info['nomestazione'][:38]:<38} catalogo: {body_name:<26} OSM: {osm}{'  [verify]' if verify else ''}")
        time.sleep(1)
    log(f'{mismatches} stazioni senza riscontro: controllare a mano (OSM può usare nomi diversi o mancare del tag name)')


if __name__ == '__main__':
    main()
