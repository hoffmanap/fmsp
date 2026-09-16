"""
Step 2: hex-bin the raw pathing pings at a small (~50m) radius so the result
literally traces the shape of the trails people walked, colored by how many
distinct devices passed through each cell. Small hexes (not one blob per
trail polygon) is the point -- it should read as a path, not a choropleth.

Also clips every ping to the trail network's own footprint (the union of
all 110 trail buffer polygons, dilated slightly for GPS noise) before
binning -- see the module docstring note below on why this uses the trail
buffers rather than the official park boundary layer.
"""
import json
import os

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape
from shapely.ops import unary_union

from hexbin_lib import latlon_to_xy, xy_to_latlon, hex_bin, hex_center_xy, hex_corners_offset

os.makedirs("../data", exist_ok=True)

HEX_RADIUS_M = 50  # small enough to trace trail shape, but must clear ~4px on
# screen at the park-wide default zoom (~32 m/px at z12) or Leaflet's canvas
# renderer silently skips sub-pixel polygons -- see hexbin_lib.py note

# ---- clip mask: the trail network's OWN footprint, not the park boundary ----
# The pathing export is already restricted to the 110 named trail polygons
# (every ping arrives pre-tagged to one), so there's no open-road driving
# data mixed in to begin with. We still clip because a meaningful share of
# pings land well outside each trail's own drawn buffer (only ~12m wide) --
# testing showed that isn't just GPS noise: even a generous 300m dilation
# only recovers so much, so a lot of it is real device movement on/near the
# mountain that isn't on a mapped trail LINE (unofficial paths, switchbacks,
# genuine off-trail wandering) rather than driving to the park. 300m is a
# deliberately generous "on the mountain" radius, not a tight per-trail-line
# clip -- it's chosen to reliably drop clear outliers (stray pings tens of
# km away) while not deleting legitimate near-trail activity. We do NOT use
# park_boundary.geojson for this: testing it earlier showed that GIS layer
# is an incomplete patchwork missing large parts of the real park (entire
# trailheads like North Hills Access and Lost Dog Access sit outside it),
# so clipping to it would silently delete real, legitimate trail data.
CLIP_DILATE_M = 300
print("Loading trail buffers for clip mask...")
trail_buffers = json.load(open("../data/trail_buffers.geojson"))
trail_union = unary_union([shape(f["geometry"]) for f in trail_buffers["features"]])
clip_mask = trail_union.buffer(CLIP_DILATE_M / 111320)  # rough meters->degrees

print("Loading pathing report...")
df = pd.read_csv(
    "/mnt/user-data/uploads/3384782_fmsp_trails_pathing_x_report_tsv.gz",
    sep="\t",
    usecols=["Polygon ID", "Hashed Device ID", "Lat of Observation Point", "Lon of Observation Point"],
)
df.columns = ["polygon", "device", "lat", "lon"]
print(df.shape)

inside = shapely.contains_xy(clip_mask, df["lon"].to_numpy(), df["lat"].to_numpy())
print(f"Clipping to trail network footprint (+{CLIP_DILATE_M}m): "
      f"{(~inside).sum()} of {len(df)} pings dropped ({(~inside).mean()*100:.2f}%)")
df = df[inside]

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
