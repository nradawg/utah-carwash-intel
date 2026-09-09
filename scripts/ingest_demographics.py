"""Demographics: ACS 2023 5-year, Utah census tracts.

Uses the KEYLESS table-based Summary File rather than api.census.gov, which now
requires a key (keyless requests 302 to missing_key.html). Same underlying data,
no signup, so the repo works for anyone who clones it.

Format: pipe-delimited, GEO_ID|<TABLE>_E001|<TABLE>_M001...
Utah tracts are GEO_ID prefix 1400000US49. Verified: 716 tracts.
"""
import sys, pathlib, urllib.request, io
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import pyarrow as pa, pyarrow.parquet as pq
from common import DATA, UA, assert_count

BASE = ("https://www2.census.gov/programs-surveys/acs/summary_file/2023/"
        "table-based-SF/data/5YRData")
PREFIX = "1400000US49"

# table -> {output_field: column_name}
WANT = {
    "b01003": {"population": "B01003_E001"},
    "b19013": {"median_hh_income": "B19013_E001"},
    "b11001": {"households": "B11001_E001"},
    "b25046": {"aggregate_vehicles": "B25046_E001"},
    "b25077": {"median_home_value": "B25077_E001"},
    "b25003": {"occupied_units": "B25003_E001", "owner_occ": "B25003_E002",
               "renter_occ": "B25003_E003"},
    "b08301": {"commuters_total": "B08301_E001", "commute_car": "B08301_E002",
               "commute_drove_alone": "B08301_E003", "worked_home": "B08301_E021"},
    "b25024": {"units_total": "B25024_E001"},
}
# B25024_E008..E010 = 10-19, 20-49, 50+ unit structures -> multifamily proxy
MULTIFAMILY = ["B25024_E006", "B25024_E007", "B25024_E008", "B25024_E009", "B25024_E010"]


def load_table(tbl):
    url = f"{BASE}/acsdt5y2023-{tbl}.dat"
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=300) as r:
        raw = r.read().decode("utf-8", "replace")
    lines = raw.splitlines()
    hdr = lines[0].split("|")
    idx = {c: i for i, c in enumerate(hdr)}
    out = {}
    for ln in lines[1:]:
        if not ln.startswith(PREFIX):
            continue
        p = ln.split("|")
        out[p[0].replace("1400000US", "")] = (p, idx)
    return out


def num(parts, idx, col):
    i = idx.get(col)
    if i is None or i >= len(parts):
        return None
    v = parts[i].strip()
    if v in ("", ".", "-", "null", "*"):
        return None
    try:
        f = float(v)
        return None if f < 0 else f   # ACS uses large negatives as annotations
    except ValueError:
        return None


if __name__ == "__main__":
    print("Demographics: ACS 2023 5yr summary file (keyless), Utah tracts")
    tracts = {}
    for tbl, fields in WANT.items():
        print(f"  fetching {tbl} ...", end="", flush=True)
        data = load_table(tbl)
        print(f" {len(data)} tracts")
        for geoid, (parts, idx) in data.items():
            rec = tracts.setdefault(geoid, {"geoid": geoid, "county_fips": geoid[2:5]})
            for out_name, col in fields.items():
                rec[out_name] = num(parts, idx, col)
            if tbl == "b25024":
                mf = [num(parts, idx, c) for c in MULTIFAMILY]
                rec["multifamily_units"] = sum(v for v in mf if v is not None) or 0

    rows = list(tracts.values())
    for r in rows:
        hh = r.get("households") or 0
        veh = r.get("aggregate_vehicles")
        r["vehicles_per_hh"] = round(veh / hh, 2) if veh and hh else None
        ut = r.get("units_total") or 0
        r["multifamily_pct"] = round((r.get("multifamily_units") or 0) / ut * 100, 1) if ut else None
        tot = r.get("commuters_total") or 0
        r["car_commute_pct"] = round((r.get("commute_car") or 0) / tot * 100, 1) if tot else None

    assert_count("Utah census tracts", len(rows), 716)
    pq.write_table(pa.Table.from_pylist(rows), DATA / "demographics.parquet", compression="zstd")
    print(f"  wrote data/demographics.parquet  {len(rows)} rows "
          f"{(DATA/'demographics.parquet').stat().st_size/1e6:.2f} MB")
    inc = sorted(r["median_hh_income"] for r in rows if r.get("median_hh_income"))
    veh = sorted(r["vehicles_per_hh"] for r in rows if r.get("vehicles_per_hh"))
    print(f"  median tract HH income: ${inc[len(inc)//2]:,.0f}  (n={len(inc)})")
    print(f"  median vehicles/household: {veh[len(veh)//2]:.2f}  (n={len(veh)})")
