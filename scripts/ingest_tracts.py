"""Census tract geometry for Utah, from TIGERweb (no key).

Needed to attach ACS demographics to parcels by point-in-polygon. Vintage must
match the ACS vintage or joins silently drop tracts; we use ACS2023 geometry
with ACS 2023 5-year data.
"""
import sys, pathlib, urllib.parse
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import pyarrow as pa, pyarrow.parquet as pq
from common import get_json, DATA, assert_count

BASE = ("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
        "tigerWMS_ACS2023/MapServer/8")   # layer 8 = Census Tracts


def fetch():
    rows, offset = [], 0
    while True:
        p = {"where": "STATE='49'", "outFields": "GEOID,BASENAME", "f": "json",
             "returnGeometry": "true", "outSR": 4326,
             "resultOffset": offset, "resultRecordCount": 250}
        d = get_json(f"{BASE}/query?{urllib.parse.urlencode(p)}", timeout=180)
        if "error" in d:
            raise RuntimeError(f"TIGERweb: {d['error']}")
        feats = d.get("features", [])
        if not feats:
            break
        for f in feats:
            rings = (f.get("geometry") or {}).get("rings") or []
            if not rings:
                continue
            outer = max(rings, key=len)
            rows.append({"geoid": f["attributes"]["GEOID"],
                         "ring": [[round(p[0], 5), round(p[1], 5)] for p in outer
                                  if p and p[0] is not None]})
        offset += len(feats)
        sys.stderr.write(f"\r  tracts: {offset}")
        if not d.get("exceededTransferLimit"):
            break
    sys.stderr.write("\n")
    return rows


if __name__ == "__main__":
    print("Tract geometry: TIGERweb ACS2023, Utah")
    rows = fetch()
    assert_count("Utah census tracts", len(rows), 716)
    pq.write_table(pa.Table.from_pylist(rows), DATA / "tracts.parquet", compression="zstd")
    print(f"  wrote data/tracts.parquet  {(DATA/'tracts.parquet').stat().st_size/1e6:.2f} MB")
