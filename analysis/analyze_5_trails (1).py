import pandas as pd
import numpy as np
import json
import re
import os
os.makedirs("../data", exist_ok=True)

vc = pd.read_csv("/mnt/user-data/uploads/3384782_fmsp_trails_visitor_count_report_tsv.gz", sep="\t")
vc.columns = ["polygon", "unique_visitors", "visits"]
vc["visits_per_visitor"] = (vc["visits"] / vc["unique_visitors"]).round(2)

# strip "(Part N)" suffixes to roll segmented trails up into their parent trail
def parent_name(name):
    return re.sub(r"\s*\(Part [IVX0-9]+\)\s*$", "", name).strip()

vc["trail_family"] = vc["polygon"].apply(parent_name)
family = vc.groupby("trail_family").agg(
    unique_visitors=("unique_visitors", "sum"), visits=("visits", "sum")
).reset_index().sort_values("visits", ascending=False)

top_trails = vc.sort_values("visits", ascending=False).head(20).to_dict(orient="records")
top_families = family.head(15).to_dict(orient="records")

print(family.head(15))

json.dump(
    {"top_segments": top_trails, "top_families": top_families,
     "total_visits_all_segments": int(vc["visits"].sum())},
    open("../data/trail_stats.json", "w"), indent=2
)

# ---- overall hero summary, pulling from everything computed so far ----
session_summary = json.load(open("_work/session_summary.json"))
home_origins = json.load(open("../data/home_origins.json"))
time_patterns = json.load(open("../data/time_patterns.json"))

hero = {
    "total_devices": session_summary["total_devices"],
    "total_sessions": session_summary["total_sessions"],
    "date_range": [session_summary["date_min"], session_summary["date_max"]],
    "pct_multi_trail_sessions": round(session_summary["pct_multi_trail_sessions"], 1),
    "el_paso_metro_pct": round(home_origins["summary"]["el_paso_metro_pct"], 1),
    "mexico_pct": round(home_origins["summary"]["mexico_pct"], 1),
    "median_dist_miles_local": round(home_origins["summary"]["median_dist_miles_local"], 1),
    "busiest_day": time_patterns["busiest_day"],
    "weekend_pct": round(sum(d["pct"] for d in time_patterns["dow_pct"] if d["day"] in ("Sat", "Sun")), 1),
    "peak_hour": time_patterns["peak_hour"],
    "top_trail_family": top_families[0]["trail_family"],
    "top_trail_family_visits": top_families[0]["visits"],
}
json.dump(hero, open("../data/hero_stats.json", "w"), indent=2)
print(hero)
