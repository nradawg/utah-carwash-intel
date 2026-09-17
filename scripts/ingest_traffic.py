"""Traffic: UDOT AADT 2024.

Layer id is 13 on AADT2024_Rounded (not 0 - that returns "Invalid URL").
The 1981-2024 annual series gives per-segment growth, and the SUTRK/CUTRK truck
shares let us discount volume that is not a retail customer.
Verified 2026-09-09: 4,574 segments.
"""
import sys, re, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import pyarrow as pa, pyarrow.parquet as pq
from common import UDOT, arcgis_page, DATA, assert_count

LAYER = f"{UDOT}/AADT2024_Rounded/FeatureServer/13"
YEARS = [2024, 2019, 2014]
FIELDS = ("OBJECTID,Station,RouteID,DESC_,SectionLength,"
          + ",".join(f"AADT{y}" for y in YEARS) + ",SUTRK2024,CUTRK2024")

# DESC_ names the segment by its cross streets, not by the road that was
# counted: "SR 315 North Willard Perry" is a stretch of I-15 (RouteID 0015PM)
# with 62,000 cars a day that nobody can turn into a lot from. RouteID is the
# only reliable way to tell, and freeways are never a lot's traffic.
INTERSTATES = {"0015", "0070", "0080", "0084", "0215"}
# RouteID is the route number, zero padded, then PM: 0089PM, 089APM, 2172PM.
# Numbers under 1000 are state routes; 1000 and up are federal aid routes,
# which are city and county roads UDOT also counts.
ROUTE = re.compile(r"^(\d+)([A-Z]?)[A-Z]M$")


def road_label(route, desc):
    """A short name for the counted road, e.g. "Route 89 (Main St)" or "1300 East".

    DESC_ reads "<from> via <road> - <to>". A state route is named by its
    number. A federal aid route is named by the text after "via"; without one
    the description is only cross streets, so the label is left empty.
    """
    m = ROUTE.match(route or "")
    if not m:
        return None
    num, suffix = int(m.group(1)), m.group(2)
    desc = re.sub(r"\s+", " ", desc or "").strip()
    if num < 1000:
        label = f"Route {num}{suffix}"
        local = re.search(rf"\bvia (?:SR|US|Hwy|Highway)[ -]?0*{num}{suffix}\b ?\(([^)]+)\)", desc, re.I)
        return f"{label} ({local.group(1).strip()})" if local else label
    via = re.search(r"\bvia (.+?)(?: ?- ?|$)", desc)
    if not via:
        return None
    # "700 S/northerly via 200 W": a route that turns names its last road.
    name = re.split(r"\bvia ", via.group(1))[-1]
    # "(Rt 2030)" and "(2204 turns North)" are notes for UDOT, not the name.
    name = re.sub(r"\s*\((?:Rt|Route) ?\d+[^)]*\)|\s*\([^)]*\bturns\b[^)]*\)", "", name).strip(" ,")
    if re.fullmatch(r"(?:Rt|Route|SR) ?\d+", name):
        return None
    return name if 0 < len(name) <= 40 else None


def densify(paths, step=6):
    """Sample vertices along each polyline so we can snap parcels to the
    nearest point of a road, not just its endpoints."""
    pts = []
    for path in paths or []:
        if len(path) <= step:
            pts.extend(path)
        else:
            pts.extend(path[::step])
            pts.append(path[-1])
    return [(round(x, 5), round(y, 5)) for x, y in pts if x is not None]


if __name__ == "__main__":
    print("Traffic: UDOT AADT2024 layer 13")
    feats = arcgis_page(LAYER, "AADT2024>0", FIELDS, geometry=True, label="AADT")
    assert_count("AADT segments (AADT2024>0)", len(feats), None)

    rows = []
    for f in feats:
        a = f["attributes"]
        pts = densify((f.get("geometry") or {}).get("paths"))
        if not pts:
            continue
        cur = a.get("AADT2024") or 0
        if cur <= 0:
            continue
        # Strictly 2014 to 2024. Falling back to 2019 when 2014 is missing gave
        # a 5 year change under a label that says 10 years, so no count, no figure.
        prior = a.get("AADT2014") or 0
        growth = round((cur / prior - 1) * 100, 1) if prior > 0 else None
        su = a.get("SUTRK2024") or 0
        cu = a.get("CUTRK2024") or 0
        truck = su + cu
        route = (a.get("RouteID") or "").strip()
        rows.append({
            "seg_id": a["OBJECTID"],
            "route": route or None,
            "interstate": route[:4] in INTERSTATES,
            "road": road_label(route, a.get("DESC_")),
            "desc": (a.get("DESC_") or "").strip(),
            "aadt": int(cur),
            "aadt_2019": int(a.get("AADT2019") or 0),
            "aadt_2014": int(a.get("AADT2014") or 0),
            # trucks are not express-wash customers, so discount them
            "aadt_retail": int(cur * (1 - min(truck, 0.5))),
            "truck_share": round(truck, 4),
            "growth_10yr_pct": growth,
            "pts": pts,
        })

    print(f"  segments with AADT2024>0: {len(rows):,}  |  interstate: "
          f"{sum(r['interstate'] for r in rows):,}  |  road named: {sum(1 for r in rows if r['road']):,}")
    bad = sorted({r["route"] for r in rows if not ROUTE.match(r["route"] or "")}, key=str)
    if bad:
        print(f"  [WARN] RouteID shapes not understood, no road name: {bad[:10]}")
    pq.write_table(pa.Table.from_pylist(rows), DATA / "traffic.parquet", compression="zstd")
    mb = (DATA / "traffic.parquet").stat().st_size / 1e6
    print(f"  wrote data/traffic.parquet  {len(rows):,} rows  {mb:.1f} MB")

    g = [r["growth_10yr_pct"] for r in rows if r["growth_10yr_pct"] is not None]
    g.sort()
    hi = sorted(rows, key=lambda r: -r["aadt"])[:3]
    print(f"  10yr growth median: {g[len(g)//2]:.1f}%  (n={len(g):,}, "
          f"{len(rows) - len(g):,} segments with no 2014 count left blank)")
    for r in hi:
        print(f"    {r['aadt']:>7,} AADT | trucks {r['truck_share']*100:.1f}% | {r['desc'][:52]}")
