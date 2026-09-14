import pandas as pd
import numpy as np
import json
import os
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

# grid-aggregated home points for map plotting (privacy: aggregate to ~1.5km
# grid cells, drop cells with <3 devices so no single household is exposed)
CELL = 0.012
by_device["glat"] = (by_device["lat"] / CELL).round(0) * CELL
by_device["glon"] = (by_device["lon"] / CELL).round(0) * CELL
grid = by_device.groupby(["glat", "glon"]).agg(devices=("device", "nunique")).reset_index()
grid = grid[grid["devices"] >= 3]
home_grid = [[round(r.glat, 4), round(r.glon, 4), int(r.devices)] for r in grid.itertuples()]
print(f"{len(home_grid)} home-location grid cells (>=3 devices) for map, "
      f"covering {grid['devices'].sum()} of {len(by_device)} devices")

out = {
    "summary": origin_summary,
    "top_zips": top_zips,
    "top_metros": top_metros,
    "home_grid": home_grid,
    "park_center": [PARK_LAT, PARK_LON],
}
json.dump(out, open("../data/home_origins.json", "w"), indent=2, default=str)
print("Saved home_origins.json")
