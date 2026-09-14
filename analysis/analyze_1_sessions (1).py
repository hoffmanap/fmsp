"""
Step 1: build device 'visit sessions' from the raw pathing pings, then derive:
  - entry-trail popularity (first polygon touched in a session)
  - trail-to-trail transition matrix (what people do next)
  - per-session stats (distinct trails touched, duration)
Sessions are split wherever a device has a gap of > SESSION_GAP_HOURS between
consecutive pings anywhere in the park -- this is what turns 2.5 years of raw
pings into discrete "park visits".
"""
import pandas as pd
import numpy as np
import json
import os

os.makedirs("_work", exist_ok=True)

SESSION_GAP_HOURS = 4

print("Loading pathing report...")
df = pd.read_csv(
    "/mnt/user-data/uploads/3384782_fmsp_trails_pathing_x_report_tsv.gz",
    sep="\t",
    usecols=["Polygon ID", "Hashed Device ID", "Lat of Observation Point",
             "Lon of Observation Point", "Unix Timestamp of Observation Point",
             "Local Date", "Local Time of Day", "Local Day of Week"],
)
df.columns = ["polygon", "device", "lat", "lon", "ts", "date", "time_of_day", "dow"]
df = df.sort_values(["device", "ts"]).reset_index(drop=True)
print(df.shape)

# session id per device: increment whenever gap since previous ping (same device) > threshold
gap = df.groupby("device")["ts"].diff()
new_session = (gap.isna()) | (gap > SESSION_GAP_HOURS * 3600)
df["session_num"] = new_session.groupby(df["device"]).cumsum()
df["session_id"] = df["device"] + "_" + df["session_num"].astype(str)

print("Total sessions (park visits):", df["session_id"].nunique())
print("Total distinct devices:", df["device"].nunique())

# ---- per-session ordered distinct-polygon sequence ----
def collapse_seq(polys):
    out = []
    for p in polys:
        if not out or out[-1] != p:
            out.append(p)
    return out

sess_groups = df.groupby("session_id")
seq_records = []
for sid, g in sess_groups:
    g = g.sort_values("ts")
    seq = collapse_seq(g["polygon"].tolist())
    duration_min = (g["ts"].max() - g["ts"].min()) / 60.0
    seq_records.append({
        "session_id": sid,
        "device": g["device"].iloc[0],
        "seq": seq,
        "n_distinct": len(seq),
        "duration_min": duration_min,
        "date": g["date"].iloc[0],
    })

sess_df = pd.DataFrame(seq_records)
print(sess_df["n_distinct"].describe())
print(sess_df["duration_min"].describe())

# ---- entry-trail popularity (first polygon of each session) ----
entry_counts = sess_df["seq"].apply(lambda s: s[0]).value_counts()
entry_counts.to_json("entry_counts_raw.json")

# ---- exit-trail popularity (last polygon of each session, proxy for "furthest point") ----
exit_counts = sess_df["seq"].apply(lambda s: s[-1]).value_counts()

# ---- transition matrix: consecutive polygon pairs within a session ----
from collections import Counter
trans = Counter()
for seq in sess_df["seq"]:
    for a, b in zip(seq[:-1], seq[1:]):
        if a != b:
            trans[(a, b)] += 1

trans_df = pd.DataFrame([{"from": a, "to": b, "count": c} for (a, b), c in trans.items()])
trans_df = trans_df.sort_values("count", ascending=False)
print(trans_df.head(25))

# save intermediate artifacts for the next steps
sess_df.drop(columns=["seq"]).to_csv("_work/sessions_meta.csv", index=False)
sess_df[["session_id", "seq"]].to_json("_work/sessions_seq.json", orient="records")
trans_df.to_csv("_work/transitions.csv", index=False)
entry_counts.to_csv("_work/entry_counts.csv")
exit_counts.to_csv("_work/exit_counts.csv")

# summary numbers for hero stats
summary = {
    "total_sessions": int(df["session_id"].nunique()) if False else int(sess_df.shape[0]),
    "total_devices": int(df["device"].nunique()),
    "avg_distinct_trails_per_session": float(sess_df["n_distinct"].mean()),
    "pct_multi_trail_sessions": float((sess_df["n_distinct"] > 1).mean() * 100),
    "median_session_duration_min": float(sess_df["duration_min"].median()),
    "date_min": df["date"].min(),
    "date_max": df["date"].max(),
}
json.dump(summary, open("_work/session_summary.json", "w"), indent=2)
print(summary)
