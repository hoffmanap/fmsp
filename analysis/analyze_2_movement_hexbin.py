"""
Step 2: hex-bin the raw pathing pings at a small (~18m) radius so the result
literally traces the shape of the trails people walked, colored by how many
distinct devices passed through each cell. Small hexes (not one blob per
trail polygon) is the point -- it should read as a path, not a choropleth.
"""
import json
import os

import numpy as np
import pandas as pd

from hexbin_lib import latlon_to_xy, xy_to_latlon, hex_bin, hex_center_xy, hex_corners_offset

os.makedirs("../data", exist_ok=True)

HEX_RADIUS_M = 18  # small enough to trace trail shape, not blob it

print("Loading pathing report...")
df = pd.read_csv(
    "/mnt/user-data/uploads/3384782_fmsp_trails_pathing_x_report_tsv.gz",
    sep="\t",
    usecols=["Polygon ID", "Hashed Device ID", "Lat of Observation Point", "Lon of Observation Point"],
)
df.columns = ["polygon", "device", "lat", "lon"]
print(df.shape)

lat0 = df["lat"].mean()
x, y = latlon_to_xy(df["lat"].to_numpy(), df["lon"].to_numpy(), lat0)
q, r = hex_bin(x, y, HEX_RADIUS_M)
df["hex_q"], df["hex_r"] = q, r

print("Aggregating hex cells...")
grouped = df.groupby(["hex_q", "hex_r"]).agg(
    devices=("device", "nunique"),
    pings=("device", "size"),
    polygon=("polygon", lambda s: s.value_counts().idxmax()),
).reset_index()
print(f"{len(grouped)} hex cells before noise filter")

# drop cells with only 1 distinct device -- almost always GPS scatter off the
# real corridor rather than a genuinely walked spot, and cuts payload a lot
grouped = grouped[grouped["devices"] >= 2]
print(f"{len(grouped)} hex cells after dropping single-device cells")

cx, cy = hex_center_xy(grouped["hex_q"].to_numpy(), grouped["hex_r"].to_numpy(), HEX_RADIUS_M)
clat, clon = xy_to_latlon(cx, cy, lat0)
grouped["lat"], grouped["lon"] = clat, clon

# intern trail names to a small index (repeated per-cell strings would bloat
# the payload otherwise -- 12k+ cells each carrying a ~25-char trail name)
trail_names = sorted(grouped["polygon"].unique())
trail_index = {name: i for i, name in enumerate(trail_names)}
grouped["trail_i"] = grouped["polygon"].map(trail_index)

# corner offsets are identical (in meters) for every cell at this radius --
# ship them once, the frontend adds them to each hex's center to draw the
# hexagon, converting meters -> degrees locally (cheap, avoids repeating
# 6 coordinate pairs per cell in the JSON)
corner_offsets_m = hex_corners_offset(HEX_RADIUS_M)

cells = [
    [round(r.lat, 6), round(r.lon, 6), int(r.devices), int(r.trail_i)]
    for r in grouped.itertuples()
]

out = {
    "hex_radius_m": HEX_RADIUS_M,
    "corner_offsets_m": [[round(a, 3), round(b, 3)] for a, b in corner_offsets_m],
    "trail_names": trail_names,
    "cell_format": ["lat", "lon", "devices", "trail_index"],
    "cells": cells,
}
json.dump(out, open("../data/movement_hexbin.json", "w"))
print(f"Saved movement_hexbin.json -- {len(cells)} cells")
print("max devices in a single cell:", grouped["devices"].max())
