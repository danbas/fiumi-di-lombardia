<img src="site/logo.svg" alt="" width="64" align="left" style="margin-right:14px">

# Fiumi di Lombardia

Il livello di oggi di ogni fiume e lago lombardo misurato dagli idrometri ARPA, confrontato con quindici anni di
storia: magre e piene, profilo di ogni fiume da monte a valle, quante ore impiega una piena a scendere.
Sito statico su GitHub Pages, dati aggiornati due volte al giorno.

<br clear="left">

**Sito pubblicato:** <https://danbas.github.io/fiumi-di-lombardia/>

> **Progetto indipendente.** Non è un sito ufficiale e non è affiliato ad ARPA Lombardia, a Regione Lombardia né ad
> alcun ente locale. I percentili e i ritardi sono elaborazioni proprie e non sono soglie di allerta: per queste fare
> riferimento ad ARPA Lombardia e alla Protezione civile.

Fratello di [Aria del Pavese](https://github.com/danbas/aria-del-pavese), con cui condivide impostazione, stile e pipeline.

## Perché

ARPA Lombardia pubblica come open data il livello di ~80 idrometri ogni 10 minuti, ma un livello in centimetri "rispetto
allo zero idrometrico" non dice nulla da solo: −350 cm a Pavia è una magra o la norma? Il sito risponde confrontando
ogni stazione con la sua stessa storia nello stesso periodo dell'anno, e mette in fila le stazioni di uno stesso fiume
da monte a valle, così una piena la si vede scendere.

## Cosa mostra

- **Oggi in Lombardia**: quante stazioni sono in magra, nella norma o alte, e la mappa colorata per stato; scegliendo
  una data (dal 2011 a ieri) mappa, elenco, profili e schede mostrano com'era quel giorno, per esempio la siccità del
  luglio 2022 o la piena del novembre 2014;
- **ogni fiume come una linea della metropolitana**: le stazioni da monte a valle, il livello, la tendenza delle ultime ore,
  e tra una stazione e l'altra il tempo mediano che il picco di una piena ha impiegato a passare nelle piene registrate;
- **profilo in una data**: il percentile di tutte le stazioni di un fiume in un giorno scelto, confrontato con un anno prima
  (l'estate 2022 accanto a quella corrente, per esempio);
- **scheda stazione**: livello attuale sulla distribuzione del periodo, ultime settimane a risoluzione oraria, un anno
  intero sulla fascia storica 5°–95° e 25°–75° percentile, confronto tra anni, record di massimo e minimo;
- **i laghi**: Maggiore, Lugano, Varese, Como, Pusiano, Annone, Endine, Iseo, Idro e Garda con gli stessi strumenti.

## Come funziona

```
dati.lombardia.it (Socrata)
   │  Livello idrometrico 2011-2020 / dal 2021 (validati)   ──┐
   │  Dati sensori meteo (flusso corrente, ultimi mesi)      ──┤  scripts/fetch_levels.py   → data/levels-<anno>.json  (giornaliero)
   │                                                           │  scripts/fetch_events.py   → data/events/<monte>-<valle>.json (piene, orario)
   └─ Stazioni Idro Nivo Meteorologiche (anagrafica)        ──┘  scripts/fetch_stations.py → data/stations.csv
                                                                  data/catalog.json          ← il perimetro: fiumi, laghi, ordine delle stazioni
                                                              scripts/build_data.py → site/data/ (index.json, rivers/*.json, lakes/*.json, recent.json, history.json)
                                                              site/ (HTML, CSS, JS vanilla, Leaflet, Chart.js) → GitHub Pages
```

- `data/catalog.json` è **l'unico posto in cui si decide cosa mostrare**: per aggiungere un fiume o una stazione basta
  una voce lì; il codice non conosce i nomi dei fiumi. Le voci con `"verify": true` sono assegnazioni fatte a tavolino
  (nome della stazione e coordinate) e non ancora controllate: sul sito compaiono con un punto interrogativo.
- Le misure a 10 minuti (≈5 milioni di righe per 80 stazioni in 15 anni) non vengono mai scaricate: l'aggregazione
  giornaliera (minimo, media, massimo) la fa il server Socrata (`$group`), una richiesta per anno.
- **Il flusso corrente ARPA è una finestra scorrevole di pochi mesi** e la serie validata dell'anno precedente può
  arrivare oltre un anno dopo. Per non avere buchi, i file annuali sono versionati anche per l'anno in corso e ogni
  esecuzione fonde i giorni nuovi con quelli già salvati (`src` indica, per sensore, se l'anno è `validated` o `current`).
  Quando ARPA pubblica l'anno validato, quello sostituisce i giorni provvisori una volta sola.
- Il sito carica all'apertura solo `index.json` (~100 KB): tutto il resto arriva a richiesta, fiume per fiume; la
  navigazione per data usa `history.json` (percentile e media di ogni giorno per ogni stazione, in binario base64,
  ~500 KB compressi), caricato solo alla prima data scelta.
- Tutte le statistiche (percentili su finestra di ±15 giorni, ritardi delle piene, record) sono calcolate in Python
  una volta per esecuzione: il browser disegna soltanto.

### Ritardo delle piene

Per ogni coppia di stazioni consecutive lungo un fiume, `fetch_events.py` individua nelle serie giornaliere le dieci
piene maggiori alla stazione di valle e scarica, a risoluzione oraria, la finestra da 4 giorni prima a 3 giorni dopo il
picco per entrambe le stazioni. `build_data.py` cerca lo spostamento temporale che massimizza la correlazione tra le due
serie orarie (più robusto del confronto tra i due massimi), tiene gli eventi con correlazione ≥ 0,7 e riporta mediana e
quartili. Le coppie con un lago in mezzo sono marcate `"lag": false` nel catalogo e saltate. È una statistica sulle piene
passate, dichiarata come tale nel sito, non una previsione.

## Eseguire in locale

```bash
python3 scripts/fetch_levels.py --years all   # bootstrap: la storia dal 2011, una decina di minuti
python3 scripts/fetch_events.py               # le finestre delle piene
python3 scripts/build_data.py                 # genera site/data/
cd site && python3 -m http.server 8000        # http://localhost:8000
```

Nessuna dipendenza da installare (Python ≥ 3.10, sola libreria standard). Con la variabile `SOCRATA_APP_TOKEN`
(token applicativo gratuito di dati.lombardia.it) il portale non applica il throttling; senza token funziona lo stesso,
più lentamente. Il workflow GitHub Actions (`.github/workflows/update.yml`) esegue gli stessi tre script due volte al giorno,
committa i file di dati che cambiano e pubblica `site/` su Pages; si può lanciare a mano con l'input `years=all` per il
bootstrap iniziale.

## Adattarlo a un altro territorio

Il codice è indipendente dalla geografia: un catalogo con altre stazioni (di altri fiumi lombardi, o di un'altra regione
che pubblichi su Socrata con lo stesso schema) produce un sito equivalente. Le cose da cambiare sono `data/catalog.json`,
`data/stations.csv` (rigenerabile con `fetch_stations.py`) e, se cambia la regione, gli id dei dataset in
`scripts/common.py` e il GeoJSON dei confini in `site/`.

## Licenze

Codice MIT (vedi `LICENSE`). Dati ARPA Lombardia CC0 1.0, confini ISTAT CC BY 4.0, librerie e font come indicato in
`THIRD_PARTY_NOTICES.md`. Sviluppato con il supporto di Claude (Anthropic).
