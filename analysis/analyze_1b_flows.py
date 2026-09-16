"""
Step 1b: build the trail-to-trail transition network + entry-point ranking
used by the "movement through the park" section, from the session analysis
in analyze_1_sessions.py (must be run first -- reads its _work/ output).
"""
import json
import os

import pandas as pd
from shapely.geometry import shape

os.makedirs("../data", exist_ok=True)

trans_path, entry_path = "_work/transitions.csv", "_work/entry_counts.csv"
if not (os.path.exists(trans_path) and os.path.exists(entry_path)):
    raise FileNotFoundError(
        "Missing _work/transitions.csv or _work/entry_counts.csv -- run analyze_1_sessions.py first."
    )

trail_buffers = json.load(open("../data/trail_buffers.geojson"))
centroids = {}
for feat in trail_buffers["features"]:
    c = shape(feat["geometry"]).centroid
    centroids[feat["properties"]["name"]] = [round(c.y, 6), round(c.x, 6)]

trans = pd.read_csv(trans_path).sort_values("count", ascending=False)
entry = pd.read_csv(entry_path)
entry.columns = ["polygon", "count"]

total_transitions = int(trans["count"].sum())  # across ALL pairs, not just the top 30 shipped

top_trans = trans.head(30).copy()
top_trans["from_pt"] = top_trans["from"].map(centroids)
top_trans["to_pt"] = top_trans["to"].map(centroids)
top_trans = top_trans.dropna(subset=["from_pt", "to_pt"])

flows = [
    {
        "from": r["from"], "to": r["to"], "count": int(r["count"]),
        "share": round(r["count"] / total_transitions * 100, 2),
        "from_pt": r["from_pt"], "to_pt": r["to_pt"],
    }
    for _, r in top_trans.iterrows()
]

total_entries = int(entry["count"].sum())
top_entry = entry.sort_values("count", ascending=False).head(12)
entries = [
    {"trail": r["polygon"], "count": int(r["count"]), "share": round(r["count"] / total_entries * 100, 2)}
    for _, r in top_entry.iterrows()
]

json.dump({"flows": flows, "entries": entries, "total_transitions": total_transitions}, open("../data/flows.json", "w"), indent=2)
print(f"Saved flows.json -- {len(flows)} transitions, {len(entries)} entry-point rankings")
