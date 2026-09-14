# Who's on the Trail — Franklin Mountains State Park

A data-driven look at trail use inside [Franklin Mountains State Park](https://tpwd.texas.gov/state-parks/franklin-mountains), built from 2.5 years of anonymized, hashed-device mobile-location data covering the park's 110 mapped trail segments.

**[View the live site →](https://hoffmanap.github.io/fmsp-trail-study/)** *(update the link once this repo is published/renamed)*

![theme](https://img.shields.io/badge/theme-pudding.cool%20highlighter-B9821B) ![stack](https://img.shields.io/badge/stack-Leaflet%20%2B%20Chart.js-315670)

---

## What's here

A single static page (`index.html` + `script.js`) that answers five questions about the park:

1. **Trail popularity** — which of the park's 110 named trail segments actually carry traffic
2. **Movement through the park** — once someone starts at a trailhead, where do they go next
3. **Device clustering** — the specific spots (trailheads *and* mid-trail points of interest) where foot traffic piles up
4. **Where visitors live** — El Paso-local vs. regional vs. out-of-state/out-of-country, down to the ZIP code
5. **When the park fills up** — weekly trend, monthly seasonality, and a day-of-week × hour-of-day heatmap

Everything on the page is generated from pre-computed JSON in `data/` — there's no server and no client-side data crunching beyond formatting, so it's a plain GitHub Pages deploy.

## Running it locally

Browsers block `fetch()` against local files, so you need a static server, not a double-click:

```bash
cd site   # this directory
python3 -m http.server 8080
# open http://localhost:8080
```

## Repo structure

```
index.html          the page (design tokens + markup)
script.js            loads data/*.json, builds every chart + map
data/                 pre-aggregated JSON + GeoJSON (see below)
analysis/            the Python pipeline that produced data/, for reproducibility
```

## The data

Four exports from a mobile-location data provider, covering FMSP's trail polygons, **January 2021 – May 2023**:

| File | Rows | What it is |
|---|---|---|
| `pathing_x_report` | ~1.04M | Every raw ping a device produced while inside a trail polygon |
| `pin_report` | ~514K | Discrete visit-pin records per device per trail |
| `visitors_home_report` | ~39K | Each device's most common evening ("home") location |
| `visitor_count_report` | 110 | Per-trail unique-visitor and visit totals |

Plus two geometry sources:
- **Trail buffer polygons** — a shapefile export of the 110 named trail segments (uploaded as part of this project; converted from Web Mercator to WGS84 in `analysis/analyze_0_geo.py`).
- **Park boundary** — pulled live from the [City of El Paso GIS open data portal](https://city-of-el-paso-open-data-coepgis.hub.arcgis.com/datasets/e9b6e622e890406bb79c62e0e5a0cf04_0/) rather than uploaded, since it wasn't one of the attached files.

Every device ID in every export is a one-way hash — no individual is ever identifiable, and the site never plots home locations at anything finer than an aggregated ~1.5&nbsp;km grid cell with a minimum of 3 devices per cell.

### Methodology notes

- **"Visits" are reconstructed, not reported.** A visit is a run of pings from the same device with no gap longer than 4 hours. The first trail segment touched in that run is treated as the visit's entry point. This turns 2.5 years of raw pings into 44,773 discrete park visits across 20,098 devices.
- **Hotspots use a ~30m grid and count distinct devices, not raw pings** — otherwise one phone idling in one spot for an hour would outrank a spot forty different hikers each pass through once. Hotspots are split into two lists: trailhead/parking clusters (Tom Mays, North Hills Access, Lost Dog Access) and mid-trail points of interest, found by excluding those three trailheads and re-running the same clustering pass.
- **Home-location grid cells are dropped below 3 devices.** No single household is ever identifiable on the map or in the ZIP-code table.
- **This is panel data, not a gate count.** It reflects wherever the data provider had device coverage, which can shift over a 2.5-year window independent of real-world attendance. Year-over-year comparisons in the "when people visit" section are called out as directional, not exact, for this reason.

## Reproducing the pipeline

The scripts in `analysis/` are numbered in run order and expect to be run **from inside `analysis/`**, writing into `../data/`:

```bash
cd analysis
pip install pandas numpy pyshp pyproj shapely --break-system-packages

python3 analyze_0_geo.py        # trail + boundary geometry -> ../data/*.geojson
python3 analyze_1_sessions.py   # raw pings -> visit sessions, transitions, entry points
python3 analyze_2_hotspots.py   # grid-clustering -> ../data/hotspots.json, heatmap.json
python3 analyze_3_home.py       # visitor home-location analysis -> ../data/home_origins.json
python3 analyze_4_time.py       # weekly/seasonal/hourly patterns -> ../data/time_patterns.json
python3 analyze_5_trails.py     # trail rankings + hero stats -> ../data/trail_stats.json, hero_stats.json
```

`analyze_0_geo.py` expects `FMSP_Trail_Buffer.zip` at `/mnt/user-data/uploads/` (adjust the path at the top of the script if running outside that environment); the four report scripts expect the four `.tsv.gz` exports at the same path, matching their original filenames. `analyze_1_sessions.py` writes scratch files to `analysis/_work/` that `analyze_5_trails.py` reads back in — keep the run order above.

## Design

The visual theme draws directly from the park itself — sun-bleached limestone paper, basalt ink, creosote-gold and rust-rock highlights, sotol green and dusk-sky blue for the visitor-origin split — in a pudding.cool-style editorial layout: a serif display face (Fraunces) for headlines, a reading serif (Spectral) for body copy, and monospace (Space Mono) for every data label, stat, and annotation. Key phrases in the prose are "highlighter"-marked in the same color used by the nearest chart or map legend, so the text and the data stay visually linked as you read.

## Credits

- Trail and park boundary geometry: City of El Paso GIS Open Data
- Mapping: [Leaflet](https://leafletjs.com/) + OpenStreetMap tiles
- Charts: [Chart.js](https://www.chartjs.org/)
- Built by [Alex Hoffman](https://github.com/hoffmanap)
