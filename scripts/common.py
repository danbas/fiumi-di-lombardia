"""Funzioni condivise dagli script: accesso Socrata, catalogo, percorsi. Solo libreria standard."""
import csv, datetime as dt, json, os, sys, time, urllib.parse, urllib.request

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
DATA_DIR = os.path.join(ROOT, 'data')
OPEN_DIR = os.path.join(DATA_DIR, 'open')
SITE_DATA = os.path.join(ROOT, 'site', 'data')

BASE = 'https://www.dati.lombardia.it/resource/'
DS_STATIONS = 'nf78-nj6b'   # Stazioni Idro Nivo Meteorologiche (anagrafica di tutti i sensori)
DS_CURRENT = '647i-nhxk'    # Dati sensori meteo: flusso corrente (finestra scorrevole di alcuni mesi, ogni 10 minuti)
# Serie validate di livello idrometrico, spezzate per periodo. Gli idsensore sono stabili tra i dataset.
DS_VALIDATED = [
    (1900, 2010, 'xubc-puka'),   # Livello idrometrico fino al 2010
    (2011, 2020, 'gsyu-uxt3'),   # Livello idrometrico dal 2011 al 2020
    (2021, 9999, '3e8b-w7ay'),   # Livello idrometrico dal 2021
]
MISSING = -9000               # ARPA marca i valori mancanti con -9999; i livelli reali stanno sopra questa soglia
# Intervallo fisicamente plausibile per un livello idrometrico (cm rispetto allo zero): il flusso in tempo reale, non
# validato, contiene ogni tanto valori assurdi (es. 292.443.464 cm) che devono restare fuori da medie, record e percentili.
MAX_ABS = 3000
VALID_RANGE = f'valore > -{MAX_ABS} and valore < {MAX_ABS}'


def plausible(*values) -> bool:
    return all(v is not None and abs(v) < MAX_ABS for v in values)

FIRST_YEAR = int(os.environ.get('LIVELLI_FIRST_YEAR', 2011))


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def soda(dataset: str, params: dict, retries: int = 5, timeout: int = 300) -> list:
    """GET su un dataset Socrata con backoff. Con SOCRATA_APP_TOKEN il throttling è molto più permissivo."""
    url = BASE + dataset + '.json?' + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    headers = {'Accept': 'application/json', 'User-Agent': 'fiumi-di-lombardia (https://github.com/danbas/fiumi-di-lombardia)'}
    token = os.environ.get('SOCRATA_APP_TOKEN')
    if token:
        headers['X-App-Token'] = token
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if attempt == retries - 1:
                raise
            wait = 10 * (attempt + 1)
            log(f'  tentativo {attempt + 1} fallito ({e}); riprovo tra {wait}s')
            time.sleep(wait)
    return []


def soda_all(dataset: str, params: dict, page: int = 100000) -> list:
    """Come soda(), ma pagina con $offset finché il server restituisce pagine piene."""
    out, offset = [], 0
    while True:
        rows = soda(dataset, {**params, '$limit': page, '$offset': offset})
        out.extend(rows)
        if len(rows) < page:
            return out
        offset += page


def load_catalog() -> dict:
    with open(os.path.join(DATA_DIR, 'catalog.json'), encoding='utf-8') as f:
        return json.load(f)


def catalog_sensors(cat: dict) -> list:
    """Tutti gli idsensore attivi citati dal catalogo (fiumi e laghi), nell'ordine del catalogo."""
    ids = []
    for r in cat['rivers'] + cat['lakes']:
        ids += [s['id'] for s in r['stations']]
    return ids


def load_stations() -> dict:
    """Anagrafica da data/stations.csv: {idsensore: {...}}."""
    with open(os.path.join(DATA_DIR, 'stations.csv'), encoding='utf-8') as f:
        return {int(r['idsensore']): r for r in csv.DictReader(f, delimiter=';')}


def is_closed(year: int) -> bool:
    """Un anno è chiuso quando ARPA ha avuto tempo di validarlo: la serie validata arriva di norma in primavera dell'anno dopo."""
    return year <= dt.date.today().year - 2


def levels_path(year: int) -> str:
    return os.path.join(DATA_DIR, f'levels-{year}.json')


def read_json(path: str, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def write_json(path: str, obj, compact: bool = True) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=1)
