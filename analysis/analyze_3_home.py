import pandas as pd
import numpy as np
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__) or ".")
from hexbin_lib import latlon_to_xy, xy_to_latlon, hex_bin, hex_center_xy, hex_corners_offset

os.makedirs("../data", exist_ok=True)

print("Loading visitors-home report...")
home = pd.read_csv("/mnt/user-data/uploads/3384782_fmsp_trails_visitors_home_report_tsv.gz", sep="\t")
home.columns = ["device", "polygon", "visit_ts", "lat", "lon", "country", "state", "postal", "census", "metro",
                "date", "time", "dow", "tz"]

# one row per visit; dedupe to one row per DEVICE (their home location is
# stable-ish across visits) for the "where do visitors live" picture
by_device = home.sort_values("visit_ts").drop_duplicates("device", keep="last")
print("Unique devices w/ home info:", len(by_device), "of", home["device"].nunique())

PARK_LAT, PARK_LON = 31.902, -106.52  # rough park centroid for distance calc

def haversine_miles(lat1, lon1, lat2, lon2):
    r = 3958.8
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = np.sin(dlat/2)**2 + np.cos(lat1)*np.cos(lat2)*np.sin(dlon/2)**2
    return 2 * r * np.arcsin(np.sqrt(a))

by_device["dist_miles"] = haversine_miles(by_device["lat"], by_device["lon"], PARK_LAT, PARK_LON)

is_el_paso_metro = by_device["metro"] == "El Paso, TX"
is_juarez = by_device["metro"] == "Juarez"
is_mexico = by_device["country"].astype(str).str.upper().isin(["MEX", "MEXICO"]) | is_juarez
is_texas_other = (by_device["state"] == "TX") & (~is_el_paso_metro)
is_domestic_other = (~is_el_paso_metro) & (~is_texas_other) & (~is_mexico) & (by_device["country"] == "USA")

origin_summary = {
    "total_devices_with_home": int(len(by_device)),
    "el_paso_metro_pct": float(is_el_paso_metro.mean() * 100),
    "el_paso_metro_n": int(is_el_paso_metro.sum()),
    "texas_other_pct": float(is_texas_other.mean() * 100),
    "texas_other_n": int(is_texas_other.sum()),
    "mexico_pct": float(is_mexico.mean() * 100),
    "mexico_n": int(is_mexico.sum()),
    "other_us_pct": float(is_domestic_other.mean() * 100),
    "other_us_n": int(is_domestic_other.sum()),
    "median_dist_miles_all": float(by_device["dist_miles"].median()),
    "median_dist_miles_local": float(by_device.loc[is_el_paso_metro, "dist_miles"].median()),
}
print(origin_summary)

# top ZIP codes (El Paso metro locals) -- "where in El Paso do visitors live"
local = by_device[is_el_paso_metro].copy()
local["postal"] = local["postal"].astype(str).str.replace(".0", "", regex=False).str.zfill(5)
zip_counts = local.groupby("postal").agg(
    devices=("device", "nunique"), lat=("lat", "median"), lon=("lon", "median")
).reset_index().sort_values("devices", ascending=False)
zip_counts = zip_counts[zip_counts["postal"].str.startswith(("798", "799"))]  # El Paso area zips
top_zips = zip_counts.head(20).to_dict(orient="records")
print(zip_counts.head(15))

# top out-of-town metros (excluding El Paso itself)
metro_counts = by_device[~is_el_paso_metro]["metro"].value_counts().head(15)
top_metros = [{"metro": k, "devices": int(v)} for k, v in metro_counts.items() if pd.notna(k)]
print(top_metros)

# hex-binned home points for map plotting (privacy: ~900m-radius hexagons,
# drop cells with <3 devices so no single household is ever exposed). A
# single sequential intensity scale reads far more clearly at city scale
# than overlapping alpha-blended circles -- the local/non-local split is
# still available in the stats and tables above, just not crammed onto
# the same map.
HOME_HEX_RADIUS_M = 900
home_geo = by_device.dropna(subset=["lat", "lon"]).copy()
print(f"Dropping {len(by_device) - len(home_geo)} devices with no resolvable home lat/lon before hex-binning")
lat0 = home_geo["lat"].mean()
x, y = latlon_to_xy(home_geo["lat"].to_numpy(), home_geo["lon"].to_numpy(), lat0)
hq, hr = hex_bin(x, y, HOME_HEX_RADIUS_M)
home_geo["hex_q"], home_geo["hex_r"] = hq, hr

hex_grouped = home_geo.groupby(["hex_q", "hex_r"]).agg(devices=("device", "nunique")).reset_index()
hex_grouped = hex_grouped[hex_grouped["devices"] >= 3]
hcx, hcy = hex_center_xy(hex_grouped["hex_q"].to_numpy(), hex_grouped["hex_r"].to_numpy(), HOME_HEX_RADIUS_M)
hclat, hclon = xy_to_latlon(hcx, hcy, lat0)
hex_grouped["lat"], hex_grouped["lon"] = hclat, hclon

home_hex_cells = [[round(r.lat, 5), round(r.lon, 5), int(r.devices)] for r in hex_grouped.itertuples()]
print(f"{len(home_hex_cells)} home-location hex cells (>=3 devices, {HOME_HEX_RADIUS_M}m radius) for map, "
      f"covering {hex_grouped['devices'].sum()} of {len(home_geo)} geolocated devices")

out = {
    "summary": origin_summary,
    "top_zips": top_zips,
    "top_metros": top_metros,
    "home_hex": {
        "hex_radius_m": HOME_HEX_RADIUS_M,
        "corner_offsets_m": [[round(a, 3), round(b, 3)] for a, b in hex_corners_offset(HOME_HEX_RADIUS_M)],
        "cells": home_hex_cells,
    },
    "park_center": [PARK_LAT, PARK_LON],
}
json.dump(out, open("../data/home_origins.json", "w"), indent=2, default=str)
print("Saved home_origins.json")
