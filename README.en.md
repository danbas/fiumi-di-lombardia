<p align="right">🇮🇹 <a href="README.md">Versione italiana</a></p>

<img src="site/logo.svg" alt="" width="64" align="left" style="margin-right:14px">

# Fiumi di Lombardia — Rivers of Lombardy

Today's water level of every river and lake in Lombardy (Italy) measured by the ARPA Lombardia gauging network,
compared with fifteen years of history: low flows and floods, each river's profile from source to mouth, and how many
hours a flood wave takes to travel downstream. A static site on GitHub Pages, data refreshed twice a day.

<br clear="left">

**Live site:** <https://danbas.github.io/fiumi-di-lombardia/> (Italian)

> **Independent project.** This is not an official site and is not affiliated with ARPA Lombardia, Regione Lombardia or
> any local authority. Percentiles and travel times are the project's own elaborations and are not alert thresholds: for
> those, refer to ARPA Lombardia and the Civil Protection service.

Sibling of [Aria del Pavese](https://github.com/danbas/aria-del-pavese), sharing its approach, style and pipeline.

## Why

ARPA Lombardia publishes as open data the water level of ~80 gauges every 10 minutes, but a level "in cm above the
gauge datum" means nothing on its own: is −350 cm at Pavia a drought or normal? The site answers by comparing each
station with its own history in the same period of the year, and lines up the stations of each river from upstream to
downstream, so you can watch a flood wave travel.

## What it shows

- **Lombardy today**: how many stations are low, normal or high, and a map coloured by status; picking a date (from
  2011 to yesterday) switches map, list, profiles and station pages to that day, e.g. the July 2022 drought or the
  November 2014 flood;
- **each river as a metro line**: stations from upstream to downstream, current level, trend over the last hours,
  and between two stations the median time a flood peak took to travel from one to the other in recorded floods;
- **profile on a date**: the percentile of all stations of a river on a chosen day, compared with another year
  (summer 2022 next to the current one, for instance);
- **station page**: today's level on the distribution for the period, last weeks at hourly resolution, a full year on
  the 5th–95th and 25th–75th percentile bands, year-to-year comparison, highest and lowest days on record;
- **the lakes**: Maggiore, Lugano, Varese, Como, Pusiano, Annone, Endine, Iseo, Idro and Garda with the same tools.

## How it works

```
dati.lombardia.it (Socrata)
   │  Water level 2011-2020 / from 2021 (validated series)     ──┐
   │  "Dati sensori meteo" (live feed, last few months)         ──┤  scripts/fetch_levels.py   → data/levels-<year>.json  (daily)
   │                                                              │  scripts/fetch_events.py   → data/events/<up>-<down>.json (floods, hourly)
   └─ Station registry (Stazioni Idro Nivo Meteorologiche)     ──┘  scripts/fetch_stations.py → data/stations.csv
                                                                     data/catalog.json          ← the scope: rivers, lakes, station order
                                                                 scripts/build_data.py → site/data/ (index.json, rivers/*.json, lakes/*.json, recent.json, history.json)
                                                                 site/ (HTML, CSS, vanilla JS, Leaflet, Chart.js) → GitHub Pages
```

- `data/catalog.json` is **the only place where scope is decided**: adding a river or a station is one entry there;
  the code knows no river names. Entries flagged `"verify": true` were assigned from the station name and coordinates
  and not yet checked: the site marks them with a question mark.
- The 10-minute readings (≈5 million rows for 80 stations over 15 years) are never downloaded: daily aggregation
  (min, mean, max) is done server-side by Socrata (`$group`), one request per year.
- **The ARPA live feed is a rolling window of a few months**, and the validated series for the previous year can
  arrive more than a year later. To avoid gaps, yearly files are versioned even for the current year and every run
  merges new days into the saved ones (`src` records, per sensor, whether a year is `validated` or `current`).
  When ARPA publishes the validated year it replaces the provisional days once.
- The site loads only `index.json` (~100 KB) at start; everything else is fetched on demand, river by river; date
  navigation uses `history.json` (daily percentile and mean per station, base64 binary, ~500 KB gzipped), fetched
  only when a date is first chosen.
- All statistics (percentiles over a ±15-day window, flood travel times, records) are computed in Python at build
  time: the browser only draws.

### Flood travel time

For each pair of consecutive stations on a river, `fetch_events.py` picks the ten largest floods at the downstream
station from the daily series and downloads, at hourly resolution, the window from 4 days before to 3 days after the
peak for both stations. `build_data.py` finds the time shift that maximises the correlation between the two hourly
series (more robust than comparing the two peaks), keeps events with correlation ≥ 0.7, and reports median and
quartiles. Pairs with a lake in between are flagged `"lag": false` in the catalog and skipped. It is a statistic on
past floods, stated as such on the site, not a forecast.

## Running locally

```bash
python3 scripts/fetch_levels.py --years all   # bootstrap: history since 2011, about ten minutes
python3 scripts/fetch_events.py               # flood windows
python3 scripts/build_data.py                 # generates site/data/
cd site && python3 -m http.server 8000        # http://localhost:8000
```

No dependencies to install (Python ≥ 3.10, standard library only). With the `SOCRATA_APP_TOKEN` environment variable
(a free application token from dati.lombardia.it) the portal does not throttle; without it everything still works,
just slower. The GitHub Actions workflow (`.github/workflows/update.yml`) runs the same scripts twice a day, commits the
data files that changed and publishes `site/` to Pages; it can be run by hand with `years=all` for the initial bootstrap.

## Adapting it to another area

The code is geography-agnostic: a catalog with other stations (other Lombardy rivers, or another region publishing on
Socrata with the same schema) yields an equivalent site. What changes is `data/catalog.json`, `data/stations.csv`
(regenerated by `fetch_stations.py`) and, for a different region, the dataset ids in `scripts/common.py` and the
boundary GeoJSON in `site/`.

## Licences

Code under MIT (see `LICENSE`). ARPA Lombardia data CC0 1.0, ISTAT boundaries CC BY 4.0, libraries and fonts as listed
in `THIRD_PARTY_NOTICES.md`. Developed with the support of Claude (Anthropic).
