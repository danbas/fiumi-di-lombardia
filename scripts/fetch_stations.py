#!/usr/bin/env python3
"""Aggiorna l'anagrafica degli idrometri ARPA Lombardia (data/stations.csv) dal dataset Socrata
"Stazioni Idro Nivo Meteorologiche" e segnala i sensori che il catalogo (data/catalog.json) non conosce.

Uso:
  python scripts/fetch_stations.py            # riscrive data/stations.csv e stampa le differenze col catalogo
  python scripts/fetch_stations.py --check    # solo confronto, non scrive nulla

L'anagrafica cambia raramente (nuove stazioni, dismissioni): lo script è pensato per essere lanciato a mano
o dal workflow con --check, così un nuovo idrometro compare nel log e si decide se aggiungerlo al catalogo.
Nota: il campo datastart dell'anagrafica non è affidabile (per quasi tutti i sensori riporta 2025-01-01
anche se le misure esistono dal 2011): l'inizio reale delle serie va dedotto dai dati.
"""
import argparse, csv, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA_DIR, DS_STATIONS, catalog_sensors, load_catalog, log, soda  # noqa: E402

FIELDS = ['idsensore', 'idstazione', 'nomestazione', 'provincia', 'quota', 'lat', 'lng', 'storico', 'datastop']


def fetch() -> list:
    rows = soda(DS_STATIONS, {
        '$select': ','.join(FIELDS),
        '$where': "tipologia='Livello Idrometrico'",
        '$order': 'provincia,nomestazione', '$limit': 5000,
    })
    for r in rows:
        r['datastop'] = (r.get('datastop') or '')[:10]
        for k in FIELDS:
            r.setdefault(k, '')
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--check', action='store_true', help='confronta soltanto, non riscrive stations.csv')
    args = ap.parse_args()
    rows = fetch()
    log(f'{len(rows)} idrometri in anagrafica')
    cat = load_catalog()
    known = set(catalog_sensors(cat)) | set(cat.get('dismissed', []))
    for r in rows:
        sid = int(r['idsensore'])
        if sid not in known:
            log(f"  NUOVO, non a catalogo: {sid} {r['nomestazione']} ({r['provincia']}) storico={r['storico']}")
        elif r['storico'] == 'S' and sid not in cat.get('dismissed', []):
            log(f"  DISMESSO ma ancora a catalogo: {sid} {r['nomestazione']} (datastop {r['datastop']})")
    ids = {int(r['idsensore']) for r in rows}
    for sid in known - ids:
        log(f'  a catalogo ma sparito dall\'anagrafica: {sid}')
    if args.check:
        return
    path = os.path.join(DATA_DIR, 'stations.csv')
    with open(path, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, delimiter=';', lineterminator='\n')
        w.writeheader()
        w.writerows({k: r[k] for k in FIELDS} for r in rows)
    log(f'scritto {path}')


if __name__ == '__main__':
    main()
