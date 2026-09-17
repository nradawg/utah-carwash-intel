"""City boundaries and 2020 to 2025 growth for every incorporated Utah place.

County growth hides the story inside a county: Utah County grew 15%, but
Saratoga Springs and Eagle Mountain grew over 50% while Provo barely moved. A
site in a fast-growing city gains customers every year it operates, so growth
is attached per city.

Population comes from Census PEP Vintage 2025 (keyless CSV). Boundaries come
from UGRC. UGRC's own POPLASTESTIMATE field is NOT used: it is frozen at the
July 2022 estimate.
"""
import sys, pathlib, csv, io, urllib.request, urllib.parse
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import pyarrow as pa, pyarrow.parquet as pq
import shapely
from shapely.geometry import shape
from common import get_json, arcgis_count, DATA, UA, UGRC, COUNTIES, assert_count

PEP = ("https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/"
       "cities/totals/sub-est2025_49.csv")
LAYER = f"{UGRC}/UtahMunicipalBoundaries/FeatureServer/0"

# UGRC data errors, found by matching every polygon to the Census place file.
# Keyed on (NAME, wrong FIPS) so the fix stops applying once UGRC corrects it.
#   Daniel carries Heber City's FIPS 34200, which would merge the two towns
#   into one shape. Daniel's Census place code is 18140.
#   Lake Point has no FIPS at all. Its Census place code is 42010.
FIPS_FIX = {("Daniel", "34200"): "18140", ("Lake Point", None): "42010"}

# PEP county codes -> pipeline keys (county FIPS are the odd numbers 001..057
# in alphabetical order, the same order as COUNTIES).
FIPS_COUNTY = {f"{2 * i + 1:03d}": c for i, c in enumerate(COUNTIES)}


def fetch_estimates():
    """Returns ({place: (base_2020, pop_2025)}, {place: set of county keys})."""
    req = urllib.request.Request(PEP, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:
        # utf-8-sig strips a byte order mark if Census ever adds one, and reads
        # plain utf-8 unchanged when there is none (the case in Vintage 2025).
        txt = r.read().decode("utf-8-sig")
    est, counties = {}, {}
    for row in csv.DictReader(io.StringIO(txt)):
        # 162 = one row per incorporated place. 157 rows repeat a place once
        # per county it touches, so summing them would double count; they are
        # read only to learn which counties a place spans.
        if row["SUMLEV"] == "162":
            est[row["PLACE"]] = (int(row["ESTIMATESBASE2020"]), int(row["POPESTIMATE2025"]))
        elif row["SUMLEV"] == "157" and row["PLACE"] != "99990":   # 99990 = outside any place
            counties.setdefault(row["PLACE"], set()).add(FIPS_COUNTY[row["COUNTY"]])
    return est, counties


def fetch_boundaries():
    """Full-resolution municipal polygons in EPSG:4326, one entry per feature.

    Full resolution, not generalised: a parcel near a city line must land on the
    correct side, and the whole layer is only about 3.5 MB. GeoJSON output keeps
    holes (unincorporated islands) attached to the right outer ring.
    """
    feats, offset = [], 0
    while True:
        p = {"where": "1=1", "outFields": "OBJECTID,NAME,FIPS,COUNTYNBR",
             "returnGeometry": "true", "outSR": 4326, "f": "geojson",
             "orderByFields": "OBJECTID", "resultOffset": offset, "resultRecordCount": 100}
        d = get_json(f"{LAYER}/query?{urllib.parse.urlencode(p)}", timeout=180)
        if "error" in d:
            raise RuntimeError(f"UGRC municipalities: {d['error']}")
        page = d.get("features", [])
        if not page:
            break
        feats.extend(page)
        offset += len(page)
        sys.stderr.write(f"\r  municipal polygons: {offset}")
        if not (d.get("properties") or {}).get("exceededTransferLimit"):
            break
    sys.stderr.write("\n")
    return feats


if __name__ == "__main__":
    print("City growth: Census PEP Vintage 2025 + UGRC municipal boundaries")
    est, place_counties = fetch_estimates()
    assert_count("Census incorporated places (SUMLEV 162)", len(est), 255)

    feats = fetch_boundaries()
    expected = arcgis_count(LAYER)
    if len(feats) != expected:
        raise RuntimeError(f"paged {len(feats)} municipal polygons, service reports {expected}")
    assert_count("UGRC municipal polygons", len(feats), 261)

    # Dissolve by FIPS: Draper, Bluffdale, Santaquin and Park City are drawn
    # once per county and must become one shape each.
    parts, names, fixed = {}, {}, []
    for f in feats:
        a = f["properties"]
        fips = FIPS_FIX.get((a["NAME"], a["FIPS"]), a["FIPS"])
        if fips is None:
            raise RuntimeError(f"{a['NAME']} has no FIPS; look up its Census place code "
                               f"and add it to FIPS_FIX")
        if fips != a["FIPS"]:
            fixed.append(f"{a['NAME']} {a['FIPS']} -> {fips}")
        g = shape(f["geometry"])
        if not g.is_valid:                      # Richfield self-intersects
            g = shapely.make_valid(g)
        parts.setdefault(fips, []).append(g)
        names.setdefault(fips, a["NAME"])
        place_counties.setdefault(fips, set())
        place_counties[fips].add(COUNTIES[int(a["COUNTYNBR"]) - 1])
    print(f"  fixed UGRC FIPS: {fixed}")

    rows, unjoined = [], []
    for fips in sorted(parts):
        # Snap to a 1e-6 degree grid (about 10 cm). set_precision keeps the
        # result valid, so rounding the WKT below cannot create self-crossings.
        geom = shapely.set_precision(shapely.union_all(parts[fips]), 1e-6)
        base, pop = est.get(fips, (None, None))
        if base is None:
            unjoined.append(f"{names[fips]} ({fips})")
        rows.append({
            "geoid": "49" + fips, "fips": fips, "name": names[fips],
            "county_names": ", ".join(sorted(place_counties[fips])),
            "pop_2020_base": base, "pop_2025": pop,
            "growth_pct": round((pop / base - 1) * 100, 1) if base else None,
            "wkt": shapely.to_wkt(geom, rounding_precision=6, trim=True),
        })

    joined = sum(1 for r in rows if r["pop_2025"] is not None)
    assert_count("places joined to a boundary", joined, 255, tol=0.02)
    missing = sorted(set(est) - set(parts))
    if missing:
        raise RuntimeError(f"Census places with no UGRC boundary: {missing}")
    # A boundary with no Census row is a place incorporated after the Vintage
    # 2025 reference date. It keeps its shape and name so sites inside it are
    # not mislabelled unincorporated, but its population stays null.
    print(f"  boundaries with no Census estimate (kept, population null): {unjoined}")

    pq.write_table(pa.Table.from_pylist(rows), DATA / "cities.parquet", compression="zstd")
    print(f"  wrote data/cities.parquet  {len(rows)} rows  "
          f"{(DATA/'cities.parquet').stat().st_size/1e6:.2f} MB")
    big = [r for r in rows if (r["pop_2020_base"] or 0) >= 10_000]
    for r in sorted(big, key=lambda r: -r["growth_pct"])[:5]:
        print(f"    {r['name']:<18} {r['pop_2020_base']:>7,} -> {r['pop_2025']:>7,} "
              f"({r['growth_pct']:+.1f}%)  {r['county_names']}")
