"""County boundary polygons, for attributing washes to the right county.

Nearest-parcel attribution misplaces anything near a county line, and the
saturation table counts express tunnels per county, so a boundary error
corrupts the headline metric.
"""
import sys, pathlib, urllib.parse
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import pyarrow as pa, pyarrow.parquet as pq
from common import get_json, UGRC, DATA, assert_count

LAYER = f"{UGRC}/Utah_County_Boundaries/FeatureServer/0"  # NOT County_Boundaries, which holds only 2 features despite its name
# UGRC uses upper-case names with spaces; the pipeline keys counties without.
FIX = {"BOX ELDER": "BoxElder", "SALT LAKE": "SaltLake", "SAN JUAN": "SanJuan"}


def norm(n):
    n = (n or "").strip()
    return FIX.get(n.upper(), n.title().replace(" ", ""))


if __name__ == "__main__":
    print("County boundaries: UGRC")
    # County polygons are large, so the service truncates: page explicitly.
    rows, offset = [], 0
    while True:
        p = {"where": "1=1", "outFields": "NAME", "f": "json", "returnGeometry": "true",
             "outSR": 4326, "maxAllowableOffset": 0.002,
             "resultOffset": offset, "resultRecordCount": 10}
        d = get_json(f"{LAYER}/query?{urllib.parse.urlencode(p)}", timeout=180)
        if "error" in d:
            raise RuntimeError(d["error"])
        feats = d.get("features", [])
        if not feats:
            break
        for f in feats:
            rings = (f.get("geometry") or {}).get("rings") or []
            if not rings:
                continue
            outer = max(rings, key=len)
            rows.append({"county": norm(f["attributes"].get("NAME")),
                         "ring": [[round(x, 5), round(y, 5)] for x, y in outer]})
        offset += len(feats)
        sys.stderr.write(f"\r  counties: {offset}")
    sys.stderr.write("\n")
    assert_count("Utah counties", len(rows), 29)
    pq.write_table(pa.Table.from_pylist(rows), DATA / "counties_geom.parquet",
                   compression="zstd")
    print(f"  wrote data/counties_geom.parquet  {sorted(r['county'] for r in rows)[:6]} ...")
