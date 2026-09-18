# Componenti e dati di terze parti

| Componente | Percorso | Licenza | Fonte |
|---|---|---|---|
| Livelli idrometrici (anagrafica e misure) | `data/stations.csv`, `data/levels-*.json`, `data/events/` (rielaborati: aggregazione giornaliera e oraria) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/legalcode) (pubblico dominio; attribuzione «ARPA LOMBARDIA» indicata nei metadati) | ARPA Lombardia, via [Regione Lombardia Open Data](https://www.dati.lombardia.it) |
| Confini provinciali | `site/province_lombardia.geojson` (semplificati) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | ISTAT, via [openpolis/geojson-italy](https://github.com/openpolis/geojson-italy) |
| Leaflet 1.9.4 | `site/vendor/leaflet.js`, `leaflet.css` | BSD-2-Clause | https://leafletjs.com |
| Chart.js 4.4 | `site/vendor/chart.umd.js` | MIT | https://www.chartjs.org |
| IBM Plex Sans / Mono | `site/fonts/` (sottoinsieme latin, via @fontsource) | [SIL OFL 1.1](site/fonts/LICENSE-OFL.txt) | IBM |
| Tile di mappa (opzionali, caricate dal browser solo su richiesta) | — | [ODbL](https://www.openstreetmap.org/copyright) | © OpenStreetMap contributors, tile.openstreetmap.org ([policy d'uso](https://operations.osmfoundation.org/policies/tiles/)) |
| Dati OpenStreetMap via Overpass (solo `scripts/check_rivers_osm.py`, verifica manuale del catalogo; nulla viene distribuito) | — | [ODbL](https://www.openstreetmap.org/copyright) | © OpenStreetMap contributors |

I dataset ARPA su dati.lombardia.it (`nf78-nj6b`, `xubc-puka`, `gsyu-uxt3`, `3e8b-w7ay`, `647i-nhxk`) sono pubblicati con licenza
CC0 1.0 e indicano «ARPA Lombardia» come attribuzione: la CC0 non la impone, ma il sito la riporta ovunque compaiano i dati.
Gli orari delle misure sono in ora solare (CET) tutto l'anno e si riferiscono alla fine dell'intervallo di rilevazione, come
dichiarato nei metadati dei dataset.

I dati ARPA sono **rielaborati**: dalle misure a 10 minuti si ricavano minimo, media e massimo giornalieri, medie orarie
per le ultime settimane e per le finestre delle piene, percentili climatologici e ritardi di propagazione. Sono elaborazioni
proprie di un progetto indipendente, non statistiche ufficiali. Le serie fino all'anno precedente sono quelle validate da
ARPA; i mesi recenti provengono dal flusso in tempo reale (stato `VA`) e sono provvisori.
