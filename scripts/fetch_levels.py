#!/usr/bin/env python3
"""Scarica i livelli idrometrici ARPA Lombardia (dati.lombardia.it, API Socrata) per le stazioni del catalogo
e li aggrega a livello giornaliero, un file JSON per anno in data/levels-<anno>.json.

Uso:
  python scripts/fetch_levels.py                    # anno corrente + precedente (default), più gli anni mancanti
  python scripts/fetch_levels.py --years all        # tutto dal 2011 (bootstrap iniziale, ~15 richieste)
  python scripts/fetch_levels.py --years 2022,2023  # anni specifici
  python scripts/fetch_levels.py --recent-only      # solo il flusso corrente (ultime settimane, orario) in data/open/

Da dove vengono i dati:
  serie validate   xubc-puka (fino al 2010), gsyu-uxt3 (2011-2020), 3e8b-w7ay (dal 2021): stato '1' = valido
  flusso corrente  647i-nhxk: gli ultimi mesi a 10 minuti, stato 'VA' = valido; è una finestra scorrevole,
                   quindi ciò che non viene salvato in tempo sparisce finché ARPA non pubblica l'anno validato
                   (che può arrivare anche oltre un anno dopo). Per questo i file degli anni aperti sono
                   versionati e ogni notte si FONDONO i giorni nuovi con quelli già salvati: il sito accumula
                   una storia continua che il portale regionale, in quel momento, non offre.

Formato di data/levels-<anno>.json:
  {"year": 2024, "generated": "...", "src": {"8546": "validated"|"current"}, "rows": [[idsensore, "YYYY-MM-DD", min, media, max, n], ...]}
  min/max/media in cm rispetto allo zero idrometrico della stazione, n = numero di misure valide nel giorno (144 = completo).
  Per sensore: "validated" se il giorno viene dalla serie validata (definitivo), "current" se dal flusso corrente (provvisorio).

Variabili d'ambiente opzionali:
  SOCRATA_APP_TOKEN   token applicativo Socrata (evita il throttling; consigliato nel workflow)
  LIVELLI_FIRST_YEAR  primo anno della storia (default 2011)
"""
import argparse, datetime as dt, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (DS_CURRENT, DS_VALIDATED, FIRST_YEAR, OPEN_DIR, VALID_RANGE, catalog_sensors, is_closed,  # noqa: E402
                    levels_path, load_catalog, log, now_iso, plausible, read_json, soda, soda_all, write_json)

RECENT_DAYS = 35      # finestra oraria del flusso corrente tenuta in data/open/recent.json
FULL_DAY = 144        # misure a 10 minuti in un giorno


def validated_dataset(year: int) -> str:
    for lo, hi, ds in DS_VALIDATED:
        if lo <= year <= hi:
            return ds
    raise ValueError(year)


def daily_rows(ds: str, ids: list, year: int, current: bool) -> list:
    """Aggregati giornalieri (min, media, max, n) per sensore dal dataset indicato. Una sola richiesta per anno."""
    inlist = ','.join(f"'{i}'" for i in ids)
    valid = "stato='VA'" if current else "stato='1'"
    rng = f"data >= '{year}-01-01T00:00:00' and data < '{year + 1}-01-01T00:00:00'"
    rows = soda_all(ds, {
        '$select': 'idsensore as s,date_trunc_ymd(data) as d,min(valore) as lo,avg(valore) as a,max(valore) as hi,count(valore) as n',
        '$where': f'idsensore in({inlist}) and {valid} and {VALID_RANGE} and {rng}',
        '$group': 's,d', '$order': 's,d',
    })
    out = []
    for r in rows:
        n = int(r['n'])
        if n < 6:          # meno di un'ora di misure: giorno inutilizzabile
            continue
        out.append([int(r['s']), r['d'][:10], int(float(r['lo'])), round(float(r['a']), 1), int(float(r['hi'])), n])
    return out


def merge_year(year: int, ids: list, force: bool = False) -> dict:
    """Costruisce (o aggiorna) il file dell'anno fondendo serie validata e flusso corrente."""
    today = dt.date.today()
    existing = read_json(levels_path(year), {'year': year, 'src': {}, 'rows': []})
    src = dict(existing.get('src', {}))
    rows = {(r[0], r[1]): r for r in existing['rows']}

    # 1) serie validata. Un anno chiuso già scaricato non si ritocca (i sensori senza dati in quell'anno
    #    resterebbero senza dati anche riprovando): si rifà solo se richiesto esplicitamente con --years.
    todo = [i for i in ids if not (is_closed(year) and (src.get(str(i)) == 'validated' or not force))]
    if todo:
        ds = validated_dataset(year)
        log(f'{year}: serie validata {ds}, {len(todo)} sensori')
        vrows = daily_rows(ds, todo, year, current=False)
        per = {}
        for r in vrows:
            per.setdefault(r[0], []).append(r)
        for sid, rs in per.items():
            # la serie validata è definitiva: sostituisce i giorni provvisori dello stesso sensore
            rows = {k: v for k, v in rows.items() if k[0] != sid}
            src[str(sid)] = 'validated'
            for r in rs:
                rows[(r[0], r[1])] = r
        log(f'  {len(vrows)} giorni validati per {len(per)} sensori')
        todo = [i for i in todo if src.get(str(i)) != 'validated']

    # 2) flusso corrente: solo per gli anni che la finestra scorrevole può ancora coprire
    if todo and year >= today.year - 1:
        log(f'{year}: flusso corrente {DS_CURRENT}, {len(todo)} sensori')
        crows = daily_rows(DS_CURRENT, todo, year, current=True)
        for r in crows:
            k = (r[0], r[1])
            old = rows.get(k)
            # un giorno già salvato con più misure (o validato) non viene degradato da una rilettura parziale;
            # un giorno salvato con valori non plausibili (prima del filtro) viene invece sempre sostituito
            if old is None or (src.get(str(r[0])) != 'validated' and (r[5] >= old[5] or not plausible(old[2], old[3], old[4]))):
                rows[k] = r
            src.setdefault(str(r[0]), 'current')
        log(f'  {len(crows)} giorni dal flusso corrente')

    out_rows = sorted(rows.values(), key=lambda r: (r[0], r[1]))
    return {'year': year, 'generated': now_iso(), 'src': src, 'rows': out_rows}


def fetch_recent(ids: list) -> dict:
    """Ultime settimane a risoluzione oraria (media dei valori a 10 minuti) più l'ultima misura di ogni sensore."""
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=RECENT_DAYS)).strftime('%Y-%m-%dT00:00:00')
    inlist = ','.join(f"'{i}'" for i in ids)
    log(f'flusso corrente: orario dal {since[:10]}')
    hourly = soda_all(DS_CURRENT, {
        '$select': 'idsensore as s,date_trunc_ymd(data) as d,date_extract_hh(data) as h,avg(valore) as v,count(valore) as n',
        '$where': f"idsensore in({inlist}) and stato='VA' and {VALID_RANGE} and data >= '{since}'",
        '$group': 's,d,h', '$order': 's,d,h',
    })
    series: dict = {}
    for r in hourly:
        series.setdefault(r['s'], []).append([r['d'][:10], int(r['h']), round(float(r['v']), 1)])
    log(f'  {len(hourly)} ore per {len(series)} sensori')
    # ultima misura: le ultime 12 ore grezze, poi si tiene il timestamp massimo per sensore
    last_since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=12)).strftime('%Y-%m-%dT%H:%M:%S')
    raw = soda_all(DS_CURRENT, {
        '$select': 'idsensore as s,data as t,valore as v',
        '$where': f"idsensore in({inlist}) and stato='VA' and {VALID_RANGE} and data >= '{last_since}'",
        '$order': 's,t',
    })
    latest: dict = {}
    for r in raw:
        latest[r['s']] = [r['t'][:16], int(float(r['v']))]
    log(f'  ultima misura disponibile per {len(latest)} sensori')
    return {'generated': now_iso(), 'days': RECENT_DAYS, 'hourly': series, 'latest': latest}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--years', default='current,previous', help='"all", "current,previous" oppure anni separati da virgola')
    ap.add_argument('--recent-only', action='store_true', help='aggiorna solo data/open/recent.json')
    args = ap.parse_args()
    cat = load_catalog()
    ids = catalog_sensors(cat)
    log(f'{len(ids)} sensori a catalogo')
    os.makedirs(OPEN_DIR, exist_ok=True)
    write_json(os.path.join(OPEN_DIR, 'recent.json'), fetch_recent(ids))
    if args.recent_only:
        return
    today = dt.date.today()
    if args.years == 'all':
        years = list(range(FIRST_YEAR, today.year + 1))
    else:
        years = []
        for tok in args.years.split(','):
            tok = tok.strip()
            years.append(today.year if tok == 'current' else today.year - 1 if tok == 'previous' else int(tok))
    explicit = set(years)
    for y in range(FIRST_YEAR, today.year + 1):       # un clone vuoto si popola da solo
        if y not in years and not os.path.exists(levels_path(y)):
            years.append(y)
    for y in sorted(set(years)):
        out = merge_year(y, ids, force=y in explicit or not os.path.exists(levels_path(y)))
        if not out['rows']:
            log(f'  {y}: nessuna riga, file non scritto')
            continue
        write_json(levels_path(y), out)
        log(f'  scritto {levels_path(y)}: {len(out["rows"])} righe')


if __name__ == '__main__':
    main()
