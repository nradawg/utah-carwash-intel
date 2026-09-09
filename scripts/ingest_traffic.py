"""Traffic: UDOT AADT 2024.

Layer id is 13 on AADT2024_Rounded (not 0 - that returns "Invalid URL").
The 1981-2024 annual series gives per-segment growth, and the SUTRK/CUTRK truck
shares let us discount volume that is not a retail customer.
Verified 2026-09-09: 4,574 segments.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import pyarrow as pa, pyarrow.parquet as pq
from common import UDOT, arcgis_page, DATA, assert_count

LAYER = f"{UDOT}/AADT2024_Rounded/FeatureServer/13"
YEARS = [2024, 2019, 2014]
FIELDS = ("OBJECTID,Station,RouteID,DESC_,SectionLength,"
          + ",".join(f"AADT{y}" for y in YEARS) + ",SUTRK2024,CUTRK2024")


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
        prior = a.get("AADT2014") or a.get("AADT2019") or 0
        growth = round((cur / prior - 1) * 100, 1) if prior and prior > 0 else None
        su = a.get("SUTRK2024") or 0
        cu = a.get("CUTRK2024") or 0
        truck = su + cu
        rows.append({
            "seg_id": a["OBJECTID"],
            "route": a.get("RouteID"),
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

    print(f"  segments with AADT2024>0: {len(rows):,}")
    pq.write_table(pa.Table.from_pylist(rows), DATA / "traffic.parquet", compression="zstd")
    mb = (DATA / "traffic.parquet").stat().st_size / 1e6
    print(f"  wrote data/traffic.parquet  {len(rows):,} rows  {mb:.1f} MB")

    g = [r["growth_10yr_pct"] for r in rows if r["growth_10yr_pct"] is not None]
    g.sort()
    hi = sorted(rows, key=lambda r: -r["aadt"])[:3]
    print(f"  10yr growth median: {g[len(g)//2]:.1f}%  (n={len(g):,})")
    for r in hi:
        print(f"    {r['aadt']:>7,} AADT | trucks {r['truck_share']*100:.1f}% | {r['desc'][:52]}")
