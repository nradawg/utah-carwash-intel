"""Parcels: UGRC LIR, all 29 counties.

Yields candidate commercial parcels with land value, acreage, and the derived
site-geometry facts the scoring gates need (centroid, bbox dimensions).

PROP_TYPE is NULL in Salt Lake County and silently returns zero rows, so we
filter on PROP_CLASS. Verified 2026-09-09.
"""
import sys, math, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from concurrent.futures import ThreadPoolExecutor
import pyarrow as pa, pyarrow.parquet as pq
from common import UGRC, COUNTIES, arcgis_page, DATA, assert_count

WHERE = "PROP_CLASS LIKE '%ommercial%' AND PARCEL_ACRES>=0.5 AND LAND_MKT_VALUE>0"
FIELDS = ("PARCEL_ID,PARCEL_ADD,PARCEL_CITY,COUNTY_NAME,TOTAL_MKT_VALUE,LAND_MKT_VALUE,"
          "PARCEL_ACRES,PROP_CLASS,BLDG_SQFT,BUILT_YR,CURRENT_ASOF,ASSESSOR_SRC")

FT_PER_DEG_LAT = 364000.0  # ~constant; longitude scaled by cos(lat) below


def geom_facts(rings):
    """Centroid + bbox dimensions in feet from an esriGeometryPolygon."""
    xs, ys = [], []
    for ring in rings or []:
        for pt in ring:
            if len(pt) >= 2 and pt[0] is not None:
                xs.append(pt[0]); ys.append(pt[1])
    if not xs:
        return None
    lon = sum(xs) / len(xs); lat = sum(ys) / len(ys)
    w_ft = (max(xs) - min(xs)) * FT_PER_DEG_LAT * math.cos(math.radians(lat))
    h_ft = (max(ys) - min(ys)) * FT_PER_DEG_LAT
    return lon, lat, w_ft, h_ft


def fetch(county):
    url = f"{UGRC}/Parcels_{county}_LIR/FeatureServer/0"
    try:
        feats = arcgis_page(url, WHERE, FIELDS, geometry=True, label=f"{county:<11}")
    except Exception as e:
        print(f"  [FAIL] {county}: {e}")
        return []
    out = []
    for f in feats:
        g = geom_facts((f.get("geometry") or {}).get("rings"))
        if not g:
            continue
        lon, lat, w, h = g
        a = f["attributes"]
        acres = a.get("PARCEL_ACRES") or 0
        land = a.get("LAND_MKT_VALUE") or 0
        out.append({
            "parcel_id": a.get("PARCEL_ID"),
            "address": (a.get("PARCEL_ADD") or "").strip(),
            "city": (a.get("PARCEL_CITY") or "").strip(),
            "county": county,
            "lon": round(lon, 6), "lat": round(lat, 6),
            "acres": round(acres, 3),
            "land_value": int(land),
            "total_value": int(a.get("TOTAL_MKT_VALUE") or 0),
            "price_per_acre": int(land / acres) if acres > 0 else None,
            "prop_class": a.get("PROP_CLASS"),
            "bldg_sqft": int(a.get("BLDG_SQFT") or 0),
            "built_yr": a.get("BUILT_YR") or None,
            # gate inputs
            "max_dim_ft": round(max(w, h)),
            "min_dim_ft": round(min(w, h)),
            "is_vacant": (a.get("BLDG_SQFT") or 0) == 0,
            "assessor_url": a.get("ASSESSOR_SRC"),
        })
    return out


if __name__ == "__main__":
    print(f"Parcels: {len(COUNTIES)} counties, filter = {WHERE}")
    rows = []
    with ThreadPoolExecutor(6) as ex:
        for r in ex.map(fetch, COUNTIES):
            rows.extend(r)
    assert_count("candidate parcels", len(rows), 45140)
    got = {r["county"] for r in rows}
    missing = [c for c in COUNTIES if c not in got]
    if missing:
        print(f"  [WARN] no rows from: {missing}")
    pq.write_table(pa.Table.from_pylist(rows), DATA / "parcels.parquet", compression="zstd")
    mb = (DATA / "parcels.parquet").stat().st_size / 1e6
    print(f"  wrote data/parcels.parquet  {len(rows):,} rows  {mb:.1f} MB")
    vac = sum(1 for r in rows if r["is_vacant"])
    print(f"  vacant (no building): {vac:,}  |  >=0.75ac & >=225ft: "
          f"{sum(1 for r in rows if r['acres']>=0.75 and r['max_dim_ft']>=225):,}")
