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
pin["year_month"] = pin["date"].dt.to_period("M").astype(str)
pin["month"] = pin["date"].dt.month
pin["year"] = pin["date"].dt.year
pin["hour"] = pin["time_of_day"].str.slice(0, 2).astype(int)

# ---- monthly visit + unique-device trend (trim first/last partial months) --
# this is the PRIMARY temporal chart -- ~29 points instead of ~125 weekly
# points reads as an actual trend instead of noise.
monthly_series = pin.groupby("year_month").agg(visits=("device", "size"), devices=("device", "nunique")).reset_index()
monthly_series = monthly_series.sort_values("year_month")
monthly_series = monthly_series.iloc[1:-1]  # drop first/last partial month
monthly_out = monthly_series.to_dict(orient="records")
print(f"{len(monthly_out)} monthly points from {monthly_series['year_month'].min()} to {monthly_series['year_month'].max()}")

# pre-compute the like-for-like Jan-May year-over-year comparison here (not
# in the browser) so the annotation text and the underlying number can never
# drift apart
jan_may = pin[pin["month"] <= 5]
jm_by_year = jan_may.groupby("year").agg(visits=("device", "size"), weeks=("week", "nunique")).reset_index()
jm_by_year["weekly_avg"] = jm_by_year["visits"] / jm_by_year["weeks"]
jm = {int(r["year"]): float(r["weekly_avg"]) for _, r in jm_by_year.iterrows()}
seasonal_dip = None
if 2021 in jm and 2022 in jm and 2023 in jm:
    seasonal_dip = {
        "drop_pct_2021_to_2022": round((1 - jm[2022] / jm[2021]) * 100, 1),
        "rebound_pct_2023_of_2021": round((jm[2023] / jm[2021]) * 100, 1),
    }
    print("seasonal_dip:", seasonal_dip)

# ---- monthly seasonality: average visits per month-of-year, normalized so
# the pattern isn't swamped by 2021 vs 2023 partial-year coverage ----
full_months = pin[(pin["date"] >= "2021-01-01") & (pin["date"] <= "2022-12-31")]
monthly = full_months.groupby(["year", "month"]).agg(visits=("device", "size")).reset_index()
month_avg = monthly.groupby("month")["visits"].mean().reindex(range(1, 13))
month_names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
seasonality = [{"month": month_names[m-1], "avg_visits": round(float(v), 1)} for m, v in month_avg.items()]
print(seasonality)

peak_month = max(seasonality, key=lambda m: m["avg_visits"])
trough_month = min(seasonality, key=lambda m: m["avg_visits"])
seasonality_annotation = {
    "peak_month": peak_month["month"], "peak_visits": peak_month["avg_visits"],
    "trough_month": trough_month["month"], "trough_visits": trough_month["avg_visits"],
    "ratio": round(peak_month["avg_visits"] / trough_month["avg_visits"], 1),
}
print("seasonality_annotation:", seasonality_annotation)

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

# busiest single (day, hour) cell -- for a direct annotation on the grid
best_day, best_hour, best_val = None, None, -1
for row in dow_hour_grid:
    for h, v in enumerate(row["hours"]):
        if v > best_val:
            best_day, best_hour, best_val = row["day"], h, v
busiest_cell = {"day": best_day, "hour": best_hour, "visits": int(best_val)}
print("busiest_cell:", busiest_cell)

out = {
    "monthly": monthly_out,
    "seasonal_dip": seasonal_dip,
    "seasonality": seasonality,
    "seasonality_annotation": seasonality_annotation,
    "dow_hour_grid": dow_hour_grid,
    "dow_pct": dow_pct,
    "peak_hour": peak_hour,
    "busiest_day": dow_totals.idxmax(),
    "busiest_cell": busiest_cell,
}
json.dump(out, open("../data/time_patterns.json", "w"), indent=2, default=str)
print("Saved time_patterns.json")
