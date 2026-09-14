import pandas as pd
import numpy as np
import json
import os
os.makedirs("../data", exist_ok=True)

print("Loading pin report...")
pin = pd.read_csv("/mnt/user-data/uploads/3384782_fmsp_trails_pin_report_tsv.gz", sep="\t")
pin.columns = ["polygon", "device", "lat", "lon", "ts", "date", "time_of_day", "dow", "tz"]
pin["date"] = pd.to_datetime(pin["date"])
pin["week"] = pin["date"].dt.to_period("W").apply(lambda p: p.start_time.strftime("%Y-%m-%d"))
pin["month"] = pin["date"].dt.month
pin["year"] = pin["date"].dt.year
pin["hour"] = pin["time_of_day"].str.slice(0, 2).astype(int)

# ---- weekly visit + unique-device trend (trim first/last partial weeks) ----
weekly = pin.groupby("week").agg(visits=("device", "size"), devices=("device", "nunique")).reset_index()
weekly = weekly.sort_values("week")
weekly = weekly.iloc[1:-1]  # drop first/last partial week
weekly_out = weekly.to_dict(orient="records")
print(weekly.head())
print(f"{len(weekly)} weekly points from {weekly['week'].min()} to {weekly['week'].max()}")

# ---- monthly seasonality: average visits per month-of-year, normalized so
# the pattern isn't swamped by 2021 vs 2023 partial-year coverage ----
full_months = pin[(pin["date"] >= "2021-01-01") & (pin["date"] <= "2022-12-31")]
monthly = full_months.groupby(["year", "month"]).agg(visits=("device", "size")).reset_index()
month_avg = monthly.groupby("month")["visits"].mean().reindex(range(1, 13))
month_names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
seasonality = [{"month": month_names[m-1], "avg_visits": round(float(v), 1)} for m, v in month_avg.items()]
print(seasonality)

# ---- day-of-week x hour-of-day heatmap ----
dow_order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
dow_hour = pin.groupby(["dow", "hour"]).size().reset_index(name="visits")
dow_hour_grid = []
for d in dow_order:
    row = []
    for h in range(24):
        v = dow_hour[(dow_hour["dow"] == d) & (dow_hour["hour"] == h)]["visits"]
        row.append(int(v.iloc[0]) if len(v) else 0)
    dow_hour_grid.append({"day": d, "hours": row})

# day-of-week totals (normalized to % of week's visits)
dow_totals = pin["dow"].value_counts().reindex(dow_order).fillna(0)
dow_pct = [{"day": d, "pct": round(float(v) / dow_totals.sum() * 100, 1)} for d, v in dow_totals.items()]
print(dow_pct)

# peak hour overall
hour_totals = pin.groupby("hour").size()
peak_hour = int(hour_totals.idxmax())

out = {
    "weekly": weekly_out,
    "seasonality": seasonality,
    "dow_hour_grid": dow_hour_grid,
    "dow_pct": dow_pct,
    "peak_hour": peak_hour,
    "busiest_day": dow_totals.idxmax(),
}
json.dump(out, open("../data/time_patterns.json", "w"), indent=2, default=str)
print("Saved time_patterns.json")
