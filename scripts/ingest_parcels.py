"""Parcels: UGRC LIR, all 29 counties.

Yields candidate commercial parcels with land value, acreage, and the derived
site-geometry facts the scoring gates need (centroid, bbox dimensions).

PROP_TYPE is NULL in Salt Lake County and silently returns zero rows, so we
filter on PROP_CLASS. Verified 2026-09-09.

Not every commercial parcel is a lot anyone could build on. Checked 2026-09-17
against the live LIR layers and the county pages, three kinds are dropped here:
  * tax exempt owners: Salt Lake is the only county that fills TAXEXEMPT_TYPE
    (every other county leaves it blank or writes Unknown on every row). Its
    "Other" covers mining land, condo common areas and city golf courses:
    1594 N Beck St (08234820080000, Staker Parson, type 850 MINING) is "Other"
    and 100% exempt on the county page, as were 4 of 4 random "Other" parcels.
  * apartment complexes taxed as commercial: HOUSE_CNT above 4 on a parcel the
    county marks PRIMARY_RES = Y (Davis 151260002, a 132 unit complex built in
    2023). Most counties use HOUSE_CNT for the number of buildings on any
    record, so a shopping centre or industrial park with 5 buildings also has
    HOUSE_CNT above 4. Those are real commercial land and stay.
  * condo common areas whose address carries the "# COM" unit marker or says
    COMMON AREA. A plain COMMON substring would also drop High Commons Way and
    Commonwealth Ave, which are ordinary commercial lots.
"""
import sys, re, math, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import pyarrow as pa, pyarrow.parquet as pq
from common import UGRC, COUNTIES, arcgis_page, DATA, assert_count

WHERE = "PROP_CLASS LIKE '%ommercial%' AND PARCEL_ACRES>=0.5 AND LAND_MKT_VALUE>0"
FIELDS = ("PARCEL_ID,PARCEL_ADD,PARCEL_CITY,COUNTY_NAME,TOTAL_MKT_VALUE,LAND_MKT_VALUE,"
          "PARCEL_ACRES,PROP_CLASS,BLDG_SQFT,BUILT_YR,CURRENT_ASOF,ASSESSOR_SRC,SERIAL_NUM,"
          "TAXEXEMPT_TYPE,PRIMARY_RES,HOUSE_CNT,SUBDIV_NAME")

# Summit's LIR puts the county's improvement (building) value in LAND_MKT_VALUE.
# Checked 2026-09-17 on property.summitcounty.org for CT-362-A and 7 random
# candidates: CT-362-A LIR land 3,530,628 is the county's Improvement 3,530,628
# (Land 580,220, Market 4,110,848), JGC-3 matches the same way, 5 more match
# exactly on one part where the 2026 roll changed the other, and BEDRK-1 changed
# on both. So land = total - LAND_MKT_VALUE there, and a
# vacant Summit lot has LAND_MKT_VALUE empty (SS-3-F, KT-35-F, NS-557: county
# shows it all as land), which the LAND_MKT_VALUE>0 filter would throw away.
SWAPPED_LAND = {"Summit"}
WHERE_SWAPPED = "PROP_CLASS LIKE '%ommercial%' AND PARCEL_ACRES>=0.5 AND TOTAL_MKT_VALUE>0"

# Counties that do not record exemptions write this on every row.
EXEMPT_PLACEHOLDER = {"", "unknown"}
COMMON_AREA = re.compile(r"#\s*COM|\bCOMMON\s+AREA\b", re.I)
RULES = ("tax exempt owner", "apartment complex", "condo common area")

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


def exclusion(a):
    """Which RULES entry rules this record out as a car wash site, else None."""
    if str(a.get("TAXEXEMPT_TYPE") or "").strip().lower() not in EXEMPT_PLACEHOLDER:
        return RULES[0]
    try:
        houses = int(float(a.get("HOUSE_CNT") or 0))
    except (TypeError, ValueError):
        houses = 0
    if houses > 4 and str(a.get("PRIMARY_RES") or "").strip().upper() == "Y":
        return RULES[1]
    if COMMON_AREA.search(a.get("PARCEL_ADD") or ""):
        return RULES[2]
    return None


def fetch(county):
    """(rows, {rule: distinct parcels removed}, rows seen) for one county."""
    url = f"{UGRC}/Parcels_{county}_LIR/FeatureServer/0"
    swapped = county in SWAPPED_LAND
    try:
        feats = arcgis_page(url, WHERE_SWAPPED if swapped else WHERE, FIELDS,
                            geometry=True, label=f"{county:<11}")
    except Exception as e:
        print(f"  [FAIL] {county}: {e}")
        return [], Counter(), 0
    # County rolls repeat a parcel once per unit or building, so a rule that
    # matches any row of a parcel drops every row of it.
    ruled = {}
    for f in feats:
        a = f["attributes"]
        why = exclusion(a)
        pid = (a.get("PARCEL_ID") or "").strip()
        if why and pid:
            ruled.setdefault(pid, why)
    removed = Counter(ruled.values())
    out = []
    for f in feats:
        a = f["attributes"]
        pid = (a.get("PARCEL_ID") or "").strip()
        why = ruled.get(pid) if pid else exclusion(a)
        if why:
            if not pid:
                removed[why] += 1
            continue
        g = geom_facts((f.get("geometry") or {}).get("rings"))
        if not g:
            continue
        lon, lat, w, h = g
        acres = a.get("PARCEL_ACRES") or 0
        total = a.get("TOTAL_MKT_VALUE") or 0
        land = (total - (a.get("LAND_MKT_VALUE") or 0)) if swapped else (a.get("LAND_MKT_VALUE") or 0)
        if land <= 0:          # Summit: all of the value is buildings, no land figure
            continue
        improvement = total - land
        bldg = int(a.get("BLDG_SQFT") or 0)
        built = a.get("BUILT_YR") or None
        out.append({
            "parcel_id": a.get("PARCEL_ID"),
            # Washington, Iron, Kane, Summit, Sevier and Sanpete key their
            # public record pages on the serial number, not the parcel id.
            "serial": (str(a["SERIAL_NUM"]).strip() or None) if a.get("SERIAL_NUM") else None,
            "address": (a.get("PARCEL_ADD") or "").strip(),
            "city": (a.get("PARCEL_CITY") or "").strip(),
            "county": county,
            "lon": round(lon, 6), "lat": round(lat, 6),
            "acres": round(acres, 3),
            "land_value": int(land),
            "total_value": int(total),
            "improvement_value": int(improvement),
            "price_per_acre": int(land / acres) if acres > 0 else None,
            "prop_class": a.get("PROP_CLASS"),
            "bldg_sqft": bldg,
            "built_yr": built,
            # gate inputs
            "max_dim_ft": round(max(w, h)),
            "min_dim_ft": round(min(w, h)),
            # Summit, Tooele, Rich and others never fill BLDG_SQFT, so no
            # building on record is not enough: the county must also value
            # the improvements at next to nothing and give no year built.
            "is_vacant": bldg == 0 and improvement < max(15_000, 0.05 * total) and not built,
            "assessor_url": a.get("ASSESSOR_SRC"),
        })
    return out, removed, len(feats)


if __name__ == "__main__":
    print(f"Parcels: {len(COUNTIES)} counties, filter = {WHERE}")
    print(f"  {', '.join(sorted(SWAPPED_LAND))}: land = TOTAL_MKT_VALUE - LAND_MKT_VALUE, "
          f"filter = {WHERE_SWAPPED}")
    rows, removed, seen = [], {}, {}
    with ThreadPoolExecutor(6) as ex:
        for county, (r, rm, n) in zip(COUNTIES, ex.map(fetch, COUNTIES)):
            rows.extend(r)
            removed[county], seen[county] = rm, n
    print("  not candidate sites (distinct parcels removed, per county):")
    print(f"    {'county':<11}" + "".join(f"{k:>20}" for k in RULES))
    for county in COUNTIES:
        if any(removed[county].values()):
            print(f"    {county:<11}" + "".join(f"{removed[county][k]:>20,}" for k in RULES))
    print(f"    {'total':<11}" + "".join(f"{sum(removed[c][k] for c in COUNTIES):>20,}" for k in RULES))
    # Was 45,140 rows. 2026-09-17: the exclusions above removed 4,076 rows
    # (2,257 Salt Lake exempt, 1,518 Davis apartment unit rows, the rest
    # apartments in Iron, Washington, Weber, Daggett, Morgan) and Summit went
    # from 381 to 586 rows once its vacant lots, which have no LAND_MKT_VALUE,
    # were read correctly.
    assert_count("candidate parcels", len(rows), 41269)
    got = {r["county"] for r in rows}
    missing = [c for c in COUNTIES if c not in got]
    if missing:
        print(f"  [WARN] no rows from: {missing}")
    pq.write_table(pa.Table.from_pylist(rows), DATA / "parcels.parquet", compression="zstd")
    mb = (DATA / "parcels.parquet").stat().st_size / 1e6
    print(f"  wrote data/parcels.parquet  {len(rows):,} rows  {mb:.1f} MB")
    vac = sum(1 for r in rows if r["is_vacant"])
    print(f"  vacant (no building on record, improvements under $15,000 or 5%): {vac:,}  |  "
          f">=0.75ac & >=225ft: {sum(1 for r in rows if r['acres']>=0.75 and r['max_dim_ft']>=225):,}")
