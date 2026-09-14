"""
Step 0: geometry prep. Run this once before the numbered analysis scripts.

Produces the two GeoJSON files the site's map layers use:
  ../data/trail_buffers.geojson  -- the 110 named trail-segment polygons
  ../data/park_boundary.geojson  -- the official FMSP boundary

Inputs:
  - FMSP_Trail_Buffer.zip, unzipped into ./trail_buffer_shp/ (a shapefile
    exported from ArcGIS in Web Mercator / EPSG:3857 -- reprojected below).
  - The park boundary is NOT one of the uploaded files; it's pulled live
    from the City of El Paso's public ArcGIS FeatureServer (same boundary
    linked in the project brief: item id e9b6e622e890406bb79c62e0e5a0cf04).
    If that endpoint ever moves, re-resolve it via
    https://www.arcgis.com/sharing/rest/content/items/<item_id>?f=json
    and read the "url" field.
"""
import json
import os
import zipfile
import urllib.request

import shapefile  # pip install pyshp
from pyproj import Transformer
from shapely.geometry import shape, mapping

os.makedirs("../data", exist_ok=True)
os.makedirs("_work/trail_buffer_shp", exist_ok=True)

# ---- 1. unzip the trail buffer shapefile (skip if already unzipped) ----
zip_path = "/mnt/user-data/uploads/FMSP_Trail_Buffer.zip"
if os.path.exists(zip_path) and not os.path.exists("_work/trail_buffer_shp/FMSP Trail Buffer.shp"):
    with zipfile.ZipFile(zip_path) as z:
        z.extractall("_work/trail_buffer_shp")

# ---- 2. reproject trail buffers from Web Mercator -> WGS84, simplify ----
transformer = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
sf = shapefile.Reader("_work/trail_buffer_shp/FMSP Trail Buffer.shp")

features = []
for sr in sf.iterShapeRecords():
    rec, shp = sr.record, sr.shape
    parts = list(shp.parts) + [len(shp.points)]
    rings = []
    for i in range(len(parts) - 1):
        pts = shp.points[parts[i]:parts[i + 1]]
        rings.append([[*transformer.transform(x, y)] for x, y in pts])
    features.append({
        "type": "Feature",
        "properties": {"name": rec["Name"]},
        "geometry": {"type": "Polygon", "coordinates": rings},
    })

simplified = []
for feat in features:
    geom = shape(feat["geometry"]).simplify(0.00003, preserve_topology=True)
    simplified.append({"type": "Feature", "properties": feat["properties"], "geometry": mapping(geom)})

json.dump({"type": "FeatureCollection", "features": simplified}, open("../data/trail_buffers.geojson", "w"))
print(f"Wrote {len(simplified)} trail buffer polygons to ../data/trail_buffers.geojson")

# ---- 3. fetch the official park boundary from the City of El Paso GIS server ----
FEATURE_SERVER = "https://gis.elpasotexas.gov/dev/rest/services/OpenData/FranklinMountainStatePark/FeatureServer/0/query"
url = FEATURE_SERVER + "?where=1=1&outFields=*&outSR=4326&f=geojson"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; fmsp-trail-study/1.0)"})
with urllib.request.urlopen(req, timeout=30) as resp:
    boundary_raw = json.load(resp)

boundary_simplified = []
for feat in boundary_raw["features"]:
    geom = shape(feat["geometry"]).simplify(0.0002, preserve_topology=True)
    boundary_simplified.append({"type": "Feature", "properties": {}, "geometry": mapping(geom)})

json.dump({"type": "FeatureCollection", "features": boundary_simplified}, open("../data/park_boundary.geojson", "w"))
print(f"Wrote park boundary ({len(boundary_simplified)} feature(s)) to ../data/park_boundary.geojson")
