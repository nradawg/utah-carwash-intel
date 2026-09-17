"""Export the map layers as GeoPackages, for opening in QGIS.

A plain lat/lon parquet opens in QGIS as a table with no points, while a
GeoPackage opens in every QGIS version by drag and drop. One file per layer,
because DuckDB's GDAL writer replaces the whole .gpkg on every COPY, so a
second layer written to the same file silently erases the first.

The site score is computed here with the website's default settings, because
the website scores in the browser and sites.parquet carries no score column.
default_score() mirrors scoreSite() and gateFail() in app/lib/scoring.ts and
must change when that file does. The score column is floored to a whole number,
the same number the website prints, so QGIS and the website never disagree by
one point on a lot. drive_time_uid names the uid in drive_times.gpkg whose 5
and 10 minute areas the website shows for the lot.

When data/raw_user.json holds your own car wash points, they are also written
to my_car_washes.gpkg. Those points may come from Google Maps, so that file is
for your own QGIS only and must stay out of the public repo.

Usage:  .venv/bin/python scripts/export_gis.py [--data-dir DIR] [--iso FILE] [--out-dir DIR]
"""
import sys, json, math, re, argparse, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import duckdb, pyarrow as pa, pyarrow.parquet as pq
from shapely.geometry import Polygon, shape
from common import DATA, ROOT

GIS = ROOT / "gis"
ISO = ROOT / "app" / "public" / "data" / "isochrones.json"

# DEFAULT_INPUTS in app/lib/scoring.ts
D_ACRES, D_MIN_DIM, D_BUDGET, D_MIN_AADT, D_MAX_SPEED = 1.0, 225, 3_000_000, 15_000, 45
W = {"access": 25, "competition": 25, "demand": 20, "traffic": 15, "growth": 15}
# BUILT_VALUE and BUILT_SQFT in scoring.ts: a working property, not a lot to build on.
BUILT_VALUE, BUILT_SQFT = 400_000, 10_000
# Site columns the wording and the Growth score read; they pass through to sites.gpkg as they are.
NEW_SITE_COLS = ("aadt_road", "county_permits_per_1k", "improvement_value", "parcel_current")


def norm(v, lo, hi):
    return 0 if hi == lo else max(0.0, min(1.0, (v - lo) / (hi - lo)))


def nz(v, default):
    """JavaScript `v ?? default`: only null falls back, a real 0 is kept."""
    return default if v is None else v


def usable_traffic_growth(s):
    """usableTrafficGrowth() in scoring.ts: the 2014 to 2024 change, or None past +/-100%."""
    g = s.get("aadt_growth_pct")
    return g if g is not None and -100 <= g <= 100 else None


def permits_per_1k(s):
    """permitsPer1k() in scoring.ts: the county figure, or None when missing or not a number."""
    v = s.get("county_permits_per_1k")
    ok = isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
    return v if ok else None


def gate_fail(s):
    """Why the website hides this site with default settings, or None.
    Same tests, in the same order, as gateFail() with DEFAULT_INPUTS, worded
    for someone reading the attribute table rather than the code."""
    if s["acres"] < D_ACRES:
        return f"only {round(s['acres'], 2):g} acres, needs {D_ACRES:g}"
    if s["max_dim_ft"] < D_MIN_DIM:
        return f"only {s['max_dim_ft']} feet at its longest, needs {D_MIN_DIM}"
    if s["in_flood_zone"]:
        return "in a mapped flood zone"
    if s["road_speed"] is not None and s["road_speed"] > D_MAX_SPEED:
        return f"speed limit {s['road_speed']} mph"
    if s["aadt"] is None:
        return "no traffic count"
    if s["aadt"] < D_MIN_AADT:
        return f"about {s['aadt']:,} cars a day, under {D_MIN_AADT:,}"
    if s["land_value"] > D_BUDGET:
        return f"assessed land value ${s['land_value']:,}, over ${D_BUDGET:,}"
    if s["value_flag"] == "below_market":
        return "county values the land below market (farmland or tax exempt)"
    # hasSizableBuilding() in scoring.ts; skipBuilt is on by default.
    sqft, imp = nz(s["bldg_sqft"], 0), nz(s.get("improvement_value"), 0)
    if imp >= BUILT_VALUE or sqft >= BUILT_SQFT:
        return (f"a {round(sqft):,} sq ft building already stands here" if sqft >= BUILT_SQFT
                else f"the county values the buildings here at ${round(imp):,}")
    # includeStale is off by default. A sites file without the column counts as current.
    if s.get("parcel_current") is False:
        return "the county has since split, merged or renumbered this parcel"
    return None


def default_score(s):
    """0 to 100 unrounded, as scoreSite() computes it with default weights and a 3 mile ring."""
    comp, expr, roofs = s["competitors_3mi"], s["express_3mi"], s["rooftops_3mi"]

    speed = nz(s["road_speed"], 35)
    speed_fit = 1 - abs(speed - 32) / 30 if speed <= 45 else 0
    rc = nz(s["road_class"], "")
    arterial = (1 if re.search(r"Principal Arterial|Minor Arterial", rc, re.I)
                else 0.65 if re.search(r"Collector", rc, re.I) else 0.3)
    room = norm(s["acres"] / max(D_ACRES, 0.1), 1, 2.2)
    frontage = norm(s["max_dim_ft"], D_MIN_DIM, 600)
    access = clamp01(0.32 * max(0, speed_fit) + 0.24 * arterial + 0.24 * room + 0.20 * frontage)

    express_pen = 1 if expr == 0 else 0.72 if expr == 1 else 0.42 if expr == 2 else 0.12
    other_pen = 1 - norm(comp - expr, 0, 8) * 0.35
    dist_bonus = norm(nz(s["dist_nearest_express_mi"], 12), 0.4, 4)
    saturation = 1 if expr == 0 else norm(roofs * 2.6 / expr, 8_000, 30_000)
    competition = clamp01(0.40 * express_pen + 0.20 * other_pen + 0.20 * dist_bonus + 0.20 * saturation)

    density = norm(roofs, 500, 30_000)
    income = norm(nz(s["median_hh_income"], 0), 45_000, 120_000)
    vehicles = norm(nz(s["vehicles_per_hh"], 0), 1.2, 2.6)
    multifam = norm(nz(s["multifamily_pct"], 0), 0, 35)
    commute = norm(nz(s["car_commute_pct"], 0), 55, 92)
    # A missing home count is not an empty area: drop density and renormalise.
    # A sites file without the column counts as known, as in scoring.ts.
    if s.get("rooftops_known") is False:
        demand = clamp01((0.22 * income + 0.18 * vehicles + 0.12 * multifam + 0.10 * commute)
                         / (0.22 + 0.18 + 0.12 + 0.10))
    else:
        demand = clamp01(0.38 * density + 0.22 * income + 0.18 * vehicles
                         + 0.12 * multifam + 0.10 * commute)

    traffic_growth = usable_traffic_growth(s)
    vol = norm(math.log10(max(nz(s["aadt"], 1), 1)), math.log10(8_000), math.log10(60_000))
    trend = norm(nz(traffic_growth, 0), -5, 45)
    non_truck = 1 - norm(nz(s["truck_share"], 0.04), 0.02, 0.25)
    measured = 1 if s["aadt_source"] == "udot" else 0.7 if s["aadt_source"] == "local" else 0.3
    traffic = clamp01(0.42 * vol + 0.26 * trend + 0.18 * non_truck + 0.14 * measured)

    # Per 1,000 residents when the sites file has it, else the old raw count range.
    per1k = permits_per_1k(s)
    permits = (norm(per1k, 1, 10) if per1k is not None
               else norm(s["county_permits_2026"], 60, 3_200))
    roof_growth = norm(nz(traffic_growth, 0), 0, 40)
    vacancy = 1 if s["is_vacant"] else 0.45
    city = s.get("city_growth_pct")
    if city is not None:
        growth = clamp01(0.35 * permits + 0.30 * norm(city, 0, 30) + 0.10 * roof_growth + 0.25 * vacancy)
    else:
        growth = clamp01(0.45 * permits + 0.20 * roof_growth + 0.35 * vacancy)

    parts = {"access": access, "competition": competition, "demand": demand,
             "traffic": traffic, "growth": growth}
    return sum(parts[k] * W[k] for k in W) / sum(W.values()) * 100


def clamp01(v):
    return max(0.0, min(1.0, v))


def drive_time_uid(uid, iso_uids, assign):
    """The uid whose drive_times polygons the website draws for this lot, or None."""
    if uid in iso_uids:
        return uid
    origin = (assign.get(uid) or [None])[0]
    return origin if origin in iso_uids else None


def write_gpkg(con, tbl, path, geom_sql, geom_type):
    """Write one arrow table as a single-layer GeoPackage in EPSG:4326."""
    con.register("t", tbl)
    path.unlink(missing_ok=True)
    cols = "* EXCLUDE (wkt)" if "wkt" in tbl.column_names else "*"
    con.execute(f"""
      COPY (SELECT {cols}, {geom_sql} AS geom FROM t)
      TO '{path}' WITH (FORMAT GDAL, DRIVER 'GPKG', SRS 'EPSG:4326',
                        GEOMETRY_TYPE '{geom_type}', LAYER_NAME '{path.stem}')""")
    con.unregister("t")
    print(f"  {path.name:<18} {tbl.num_rows:>6,} features  {path.stat().st_size / 1e6:6.2f} MB")


def ring_wkt(ring):
    return Polygon(ring).wkt if len(ring) >= 4 else None


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data-dir", type=pathlib.Path, default=DATA)
    ap.add_argument("--iso", type=pathlib.Path, default=ISO, help="isochrones.json")
    ap.add_argument("--out-dir", type=pathlib.Path, default=GIS)
    a = ap.parse_args()
    d, out = a.data_dir, a.out_dir
    out.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    pt = "ST_Point(lon, lat)"
    print(f"GeoPackages for QGIS -> {out}")

    iso_json = json.loads(a.iso.read_text())
    feats = iso_json.get("features", [])
    iso_uids = {str(f["properties"]["uid"]) for f in feats}
    iso_assign = iso_json.get("assign") or {}

    # ---- sites: every column, plus the website's default score ----
    sites = pq.read_table(d / "sites.parquet")
    missing = [c for c in NEW_SITE_COLS if c not in sites.column_names]
    if missing:
        print(f"  (sites.parquet has no {', '.join(missing)}; rebuild the sites to add them)")
    rows = sites.to_pylist()
    # Floored, not rounded: the website prints Math.floor(total) and grades on it.
    sites = sites.add_column(1, "score", pa.array([math.floor(default_score(r)) for r in rows], pa.int32()))
    sites = sites.add_column(2, "fails_default_filters", pa.array([gate_fail(r) for r in rows]))
    # Which drive_times polygons belong to this lot: its own when it has them,
    # else the nearby lot the website borrows them from (resolveIso() in
    # app/lib/data.ts). Filter drive_times on uid = this value in QGIS.
    sites = sites.add_column(3, "drive_time_uid", pa.array(
        [drive_time_uid(str(r["uid"]), iso_uids, iso_assign) for r in rows], pa.string()))
    write_gpkg(con, sites, out / "sites.gpkg", pt, "POINT")

    # ---- car washes: the publishable, open-licensed set only ----
    cw = pq.read_table(d / "carwashes_open.parquet")
    cw = cw.drop_columns([c for c in ("rating", "reviews", "has_google") if c in cw.column_names])
    write_gpkg(con, cw, out / "car_washes.gpkg", pt, "POINT")

    # ---- your own car washes, when import_user_washes.py found any ----
    # Private points, so only on this computer. A fixed schema, because a column
    # that is empty in every row would otherwise have no type and GDAL rejects it.
    user_path = d / "raw_user.json"
    user = json.loads(user_path.read_text()) if user_path.exists() else []
    mine_path = out / "my_car_washes.gpkg"
    if user:
        cols = {"name": "name", "format": "user_format", "format_as_typed": "user_format_text",
                "address": "address", "website": "website", "phone": "phone",
                "notes": "notes", "source_file": "src_id"}
        schema = pa.schema([(k, pa.string()) for k in cols] + [("lat", pa.float64()), ("lon", pa.float64())])
        mine = pa.Table.from_pylist(
            [{**{k: r.get(v) for k, v in cols.items()}, "lat": r["lat"], "lon": r["lon"]} for r in user],
            schema=schema)
        write_gpkg(con, mine, mine_path, pt, "POINT")
    else:
        # Points removed from data/user/ must not linger in an old export.
        mine_path.unlink(missing_ok=True)
        print("  (no points in raw_user.json, my_car_washes.gpkg skipped)")

    # ---- drive times: 5 and 10 minute polygons per site uid ----
    iso = pa.table({
        "uid": [str(f["properties"]["uid"]) for f in feats],
        "minutes": [int(f["properties"]["minutes"]) for f in feats],
        "wkt": [shape(f["geometry"]).wkt for f in feats],
    })
    write_gpkg(con, iso, out / "drive_times.gpkg", "ST_Multi(ST_GeomFromText(wkt))", "MULTIPOLYGON")

    # ---- counties, with Census 2025 growth when it has been built ----
    cg = pq.read_table(d / "counties_geom.parquet").to_pylist()
    pep_path = d / "county_pep.parquet"
    pep = {r["county"]: r for r in pq.read_table(pep_path).to_pylist()} if pep_path.exists() else {}
    if not pep:
        print("  (county_pep.parquet not found, counties exported without population)")
    crow = []
    for r in cg:
        p = pep.get(r["county"], {})
        crow.append({"county": r["county"], "fips": p.get("fips"),
                     "population_2020": p.get("pop_2020_base"),
                     "population_2025": p.get("pop_2025"),
                     "growth_pct": p.get("growth_pct"),
                     "net_domestic_migration_2020_2025": p.get("net_domestic_2020_2025"),
                     "wkt": ring_wkt(r["ring"])})
    write_gpkg(con, pa.Table.from_pylist(crow), out / "counties.gpkg",
               "ST_GeomFromText(wkt)", "POLYGON")

    # ---- cities, when built ----
    cities_path = d / "cities.parquet"
    if cities_path.exists():
        ct = pq.read_table(cities_path)
        cities = pa.table({
            "name": ct.column("name"), "county": ct.column("county_names"),
            "population_2020": ct.column("pop_2020_base"),
            "population_2025": ct.column("pop_2025"),
            "growth_pct": ct.column("growth_pct"), "wkt": ct.column("wkt"),
        })
        write_gpkg(con, cities, out / "cities.gpkg", "ST_Multi(ST_GeomFromText(wkt))", "MULTIPOLYGON")
    else:
        print("  (cities.parquet not found, cities.gpkg skipped)")

    # ---- census tracts with ACS 2023 5-year demographics ----
    demo = {r["geoid"]: r for r in pq.read_table(d / "demographics.parquet").to_pylist()}
    trow = []
    for r in pq.read_table(d / "tracts.parquet").to_pylist():
        w = ring_wkt(r["ring"])
        if w is None:
            continue
        rec = dict(demo.get(r["geoid"], {}))
        rec["geoid"] = r["geoid"]
        rec["wkt"] = w
        trow.append(rec)
    write_gpkg(con, pa.Table.from_pylist(trow), out / "tracts.gpkg",
               "ST_GeomFromText(wkt)", "POLYGON")


if __name__ == "__main__":
    main()
