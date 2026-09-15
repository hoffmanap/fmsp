# Who's on the Trail — Franklin Mountains State Park

A data-driven look at trail use inside [Franklin Mountains State Park](https://tpwd.texas.gov/state-parks/franklin-mountains), built from 2.5 years of anonymized, hashed-device mobile-location data covering the park's 110 mapped trail segments.

**[View the live site →](https://hoffmanap.github.io/fmsp-trail-study/)** *(update the link once this repo is published/renamed)*

![theme](https://img.shields.io/badge/theme-pudding.cool%20highlighter-B9821B) ![stack](https://img.shields.io/badge/stack-Leaflet%20%2B%20Chart.js-315670) ![viz](https://img.shields.io/badge/maps-hex--binned-AE4726)

---

## What's here

A single static page (`index.html` + `script.js`) that answers five questions about the park:

1. **Trail popularity** — which of the park's 110 named trail segments actually carry traffic
2. **Movement through the park** — the literal shape of foot traffic, hex-binned from raw device pings so it traces actual paths rather than averaging by trail segment
3. **Device clustering** — small hex-binned visit-pin density, with the park's most-visited spots numbered and annotated with a likely reason why
4. **Where visitors live** — El Paso-local vs. regional vs. out-of-state/out-of-country, down to the ZIP code, hex-binned at city scale
5. **When the park fills up** — monthly trend (with the 2022 dip and 2023 rebound annotated directly on the chart), seasonality, and a day-of-week × hour-of-day heatmap

Everything on the page is generated from pre-computed JSON in `data/` — there's no server and no client-side data crunching beyond formatting, so it's a plain GitHub Pages deploy. Every map is grayscale-tiled, pan/zoomable (hover to enable scroll-zoom), hex-binned rather than circle-marker-based, and every map or chart has an expand (&#10021;) button that opens it full-screen. Chart annotations (the seasonal dip/rebound, peak/trough month, busiest hour) come from `chartjs-plugin-annotation` and are drawn from numbers computed in Python, not recalculated in the browser. If a data file fails to fetch, the page still renders everything else and shows an inline diagnostic instead of going blank.

## Running it locally

Browsers block `fetch()` against local files, so you need a static server, not a double-click:

```bash
cd site   # this directory
python3 -m http.server 8080
# open http://localhost:8080
```

If you deploy the whole `site/` folder as-is (with `data/` alongside `index.html`), it works unmodified on GitHub Pages, Netlify, or any static host. A `.nojekyll` file is included so GitHub Pages serves the `data/` and `analysis/` folders as-is rather than running them through Jekyll.

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

Every device ID in every export is a one-way hash — no individual is ever identifiable, and the site never plots home locations at anything finer than an aggregated ~900m hex cell with a minimum of 3 devices per cell.

### Methodology notes

- **"Visits" are reconstructed, not reported.** A visit is a run of pings from the same device with no gap longer than 4 hours. The first trail segment touched in that run is treated as the visit's entry point. This turns 2.5 years of raw pings into 44,773 discrete park visits across 20,098 devices.
- **The movement map and hotspot map are both hex-binned, not choropleths or circle markers.** Small hexagons (~18m radius for the raw pathing trail, ~22m for discrete visit-pins) trace the literal shape of where devices went, rather than averaging activity across an entire named trail segment. Both count *distinct devices per cell*, not raw pings, and drop any cell with only 1 device (near-certain GPS noise) before rendering — so a single idling phone can't manufacture a hotspot.
- **Hex map color uses a log scale, not linear.** A handful of trailheads are 100-1000× busier than a typical trail cell; a linear color scale would make everything except the single hottest spot look the same pale color. `hexbin_lib.py` has the shared binning math (axial coordinates, cube rounding — the standard approach from redblobgames.com/grids/hexagons).
- **The hotspot "likely reason" annotations mix real evidence and an informed guess.** A trail confirmed as a frequent visit-*starting* point (from the session analysis) gets a data-backed "confirmed trailhead" label. Everything else falls back to keyword-matching the trail's own name (cave, overlook, spring, junction, etc.) — treat those as plausible, not verified.
- **Home-location hex cells are dropped below 3 devices**, at a ~900m radius. No single household is ever identifiable on the map or in the ZIP-code table. The map uses one sequential color scale (log-scaled) rather than splitting local/non-local by color, which made the earlier version hard to read — that split is still in the stats and tables, just not layered onto the same map.
- **This is panel data, not a gate count.** It reflects wherever the data provider had device coverage, which can shift over a 2.5-year window independent of real-world attendance. The monthly chart's year-over-year comparison (annotated directly on the chart) is called out as directional, not exact, for this reason.
- **The park boundary is a visual reference only, not an analytical filter.** The pathing export is pulled *per named trail polygon* — every ping in it is already tagged to one of the 110 trail buffers (confirmed: exactly 110 unique polygon IDs, no "unassigned" bucket), so the raw data cannot show genuine off-trail movement; that was never collected. Separately, the City of El Paso's public "BOUNDARY" GIS layer for the park turned out to be a patchwork of ~22 disjoint parcels that doesn't fully cover the park's real footprint — testing it turned up entire well-established trailheads (North Hills Access, Lost Dog Access) sitting outside it, which would make any "% of activity outside the legal boundary" stat misleading. So the boundary is drawn on the maps for geographic context only; `analysis/analyze_0_geo.py` also filters out two clearly-unrelated polygon slivers (~50km away, near Horizon City) that the same ArcGIS query returned alongside the real park parcels.

## Reproducing the pipeline

The scripts in `analysis/` are numbered in run order and expect to be run **from inside `analysis/`**, writing into `../data/`:

```bash
cd analysis
pip install pandas numpy pyshp pyproj shapely --break-system-packages

python3 analyze_0_geo.py             # trail + boundary geometry -> ../data/*.geojson
python3 analyze_1_sessions.py        # raw pings -> visit sessions, transitions, entry points (-> _work/)
python3 analyze_1b_flows.py          # _work/ output -> ../data/flows.json (trail-to-trail network)
python3 analyze_2_movement_hexbin.py # pathing pings -> ../data/movement_hexbin.json (~18m hexagons)
python3 analyze_3_home.py            # visitor home-location analysis -> ../data/home_origins.json
python3 analyze_3_hotspot_hexbin.py  # visit-pins -> ../data/hotspot_hexbin.json (~22m hexagons + annotations)
python3 analyze_4_time.py            # monthly/seasonal/hourly patterns -> ../data/time_patterns.json
python3 analyze_5_trails.py          # trail rankings + hero stats -> ../data/trail_stats.json, hero_stats.json
```

`analyze_0_geo.py` expects `FMSP_Trail_Buffer.zip` at `/mnt/user-data/uploads/` (adjust the path at the top of the script if running outside that environment); the four report scripts expect the four `.tsv.gz` exports at the same path, matching their original filenames. `analyze_1_sessions.py` writes scratch files to `analysis/_work/` that `analyze_1b_flows.py` and `analyze_3_hotspot_hexbin.py` read back in (the latter for its data-backed trailhead detection) — keep the run order above. `hexbin_lib.py` is a shared module, not a run step.

## Design

The visual theme draws directly from the park itself — sun-bleached limestone paper, basalt ink, creosote-gold and rust-rock highlights, sotol green and dusk-sky blue for the visitor-origin split — in a pudding.cool-style editorial layout: a serif display face (Fraunces) for headlines, a reading serif (Spectral) for body copy, and monospace (Space Mono) for every data label, stat, and annotation. Key phrases in the prose are "highlighter"-marked in the same color used by the nearest chart or map legend, so the text and the data stay visually linked as you read.

## Credits

- Trail and park boundary geometry: City of El Paso GIS Open Data
- Mapping: [Leaflet](https://leafletjs.com/) + OpenStreetMap tiles
- Charts: [Chart.js](https://www.chartjs.org/)
- Built by [Alex Hoffman](https://github.com/hoffmanap)
