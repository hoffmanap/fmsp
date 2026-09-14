"""
Step 2: grid-bin every pathing ping into ~30m cells, find the densest cells
(device-clustering hot spots), and dedupe adjacent hot cells into named spots.
Also compute a coarser grid (for a lightweight heatmap layer covering the
whole park, not just the top spots).
"""
import pandas as pd
import numpy as np
import json
import os
os.makedirs("../data", exist_ok=True)

print("Loading pathing report...")
df = pd.read_csv(
    "/mnt/user-data/uploads/3384782_fmsp_trails_pathing_x_report_tsv.gz",
    sep="\t",
    usecols=["Polygon ID", "Hashed Device ID", "Lat of Observation Point", "Lon of Observation Point"],
)
df.columns = ["polygon", "device", "lat", "lon"]

# ~30m grid for hotspot detection (0.00027 deg lat ~ 30m at this latitude)
CELL = 0.0003
df["cell_lat"] = (df["lat"] / CELL).round().astype(int)
df["cell_lon"] = (df["lon"] / CELL).round().astype(int)

# count PINGS and unique DEVICES per cell (unique devices is the more honest
# "how many separate visitors cluster here" measure -- a lone device idling
# for an hour shouldn't outrank a spot 40 different people stop at)
cell_stats = df.groupby(["cell_lat", "cell_lon"]).agg(
    pings=("device", "size"),
    devices=("device", "nunique"),
    lat=("lat", "mean"),
    lon=("lon", "mean"),
).reset_index()

# dominant polygon per cell (for labeling)
dom_poly = df.groupby(["cell_lat", "cell_lon"])["polygon"].agg(lambda s: s.value_counts().idxmax())
cell_stats = cell_stats.merge(dom_poly.rename("polygon"), on=["cell_lat", "cell_lon"])

cell_stats = cell_stats.sort_values("devices", ascending=False)
print(cell_stats.head(15)[["lat", "lon", "devices", "pings", "polygon"]])

# ---- non-maximum suppression so we don't return 5 adjacent cells for the
# same physical spot -- greedily take the top cell, drop anything within
# ~90m of an already-picked spot, repeat ----
def haversine(lat1, lon1, lat2, lon2):
    r = 6371000.0
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = np.sin(dlat/2)**2 + np.cos(lat1)*np.cos(lat2)*np.sin(dlon/2)**2
    return 2 * r * np.arcsin(np.sqrt(a))

candidates = cell_stats.head(400).copy().reset_index(drop=True)
picked = []
SUPPRESS_M = 90
for _, row in candidates.iterrows():
    too_close = False
    for p in picked:
        if haversine(row["lat"], row["lon"], p["lat"], p["lon"]) < SUPPRESS_M:
            too_close = True
            break
    if not too_close:
        picked.append(row.to_dict())
    if len(picked) >= 40:
        break

hotspots = []
for i, p in enumerate(picked):
    hotspots.append({
        "rank": i + 1,
        "lat": round(p["lat"], 6),
        "lon": round(p["lon"], 6),
        "devices": int(p["devices"]),
        "pings": int(p["pings"]),
        "trail": p["polygon"],
    })

json.dump(hotspots, open("../data/hotspots_all.json", "w"), indent=2)
print(f"\nSaved {len(hotspots)} hotspots (all)")
for h in hotspots[:12]:
    print(h)

# ---- secondary pass: same NMS process but excluding the three trailhead/
# parking-lot polygons, so the result surfaces mid-trail points of interest
# (caves, overlooks, junctions) rather than restating "parking lots are busy" ----
TRAILHEADS = {"FMSP Tom Mays Trail", "FMSP North Hills Access", "Lost Dog Access"}
interior_candidates = cell_stats[~cell_stats["polygon"].isin(TRAILHEADS)].head(400).copy().reset_index(drop=True)
picked2 = []
for _, row in interior_candidates.iterrows():
    too_close = False
    for p in picked2:
        if haversine(row["lat"], row["lon"], p["lat"], p["lon"]) < SUPPRESS_M:
            too_close = True
            break
    if not too_close:
        picked2.append(row.to_dict())
    if len(picked2) >= 20:
        break

interior_hotspots = []
for i, p in enumerate(picked2):
    interior_hotspots.append({
        "rank": i + 1,
        "lat": round(p["lat"], 6),
        "lon": round(p["lon"], 6),
        "devices": int(p["devices"]),
        "pings": int(p["pings"]),
        "trail": p["polygon"],
    })

json.dump(
    {"trailhead": hotspots[:10], "interior": interior_hotspots},
    open("../data/hotspots.json", "w"), indent=2
)
print(f"\nSaved {len(interior_hotspots)} interior (non-trailhead) hotspots")
for h in interior_hotspots[:12]:
    print(h)

# ---- coarse heatmap layer (whole-park density, ~60m cells, min-device filter to keep file small) ----
CELL2 = 0.0006
df["hlat"] = (df["lat"] / CELL2).round(0) * CELL2
df["hlon"] = (df["lon"] / CELL2).round(0) * CELL2
heat = df.groupby(["hlat", "hlon"]).agg(devices=("device", "nunique")).reset_index()
heat = heat[heat["devices"] >= 2]
heat_points = heat[["hlat", "hlon", "devices"]].values.tolist()
heat_points = [[round(a, 5), round(b, 5), int(c)] for a, b, c in heat_points]
json.dump(heat_points, open("../data/heatmap.json", "w"))
print(f"Saved {len(heat_points)} heatmap cells")
