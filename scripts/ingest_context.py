"""Context layers: FEMA flood hazard + Census building permits.

FEMA SFHA is a hard disqualifier (you do not build a tunnel in a floodway).
Building permits are the only true LEADING indicator available: rooftops
permitted today are wash customers in 18 months, which matters in a state
growing as fast as Utah.
"""
import sys, pathlib, urllib.parse, json
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import pyarrow as pa, pyarrow.parquet as pq
from common import get_json, DATA, UA, assert_count
import urllib.request

FEMA = ("https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28")
UTAH_ENV = "-114.06,36.99,-109.04,42.01"
BPS = "https://www2.census.gov/econ/bps/County/co2607y.txt"  # 2026 year-to-date

# Utah county FIPS -> name, for joining permits to counties
UT_FIPS = {"001":"Beaver","003":"BoxElder","005":"Cache","007":"Carbon","009":"Daggett",
"011":"Davis","013":"Duchesne","015":"Emery","017":"Garfield","019":"Grand","021":"Iron",
"023":"Juab","025":"Kane","027":"Millard","029":"Morgan","031":"Piute","033":"Rich",
"035":"SaltLake","037":"SanJuan","039":"Sanpete","041":"Sevier","043":"Summit",
"045":"Tooele","047":"Uintah","049":"Utah","051":"Wasatch","053":"Washington",
"055":"Wayne","057":"Weber"}


def fetch_flood():
    """SFHA polygons, generalised server-side via maxAllowableOffset (~100m).

    Full-resolution rings are ~93MB and time out; generalised is 5MB. That
    precision is appropriate because this is a screening flag, not a
    survey-grade flood determination, and it is labelled as such in the UI.
    """
    rows, offset = [], 0
    while True:
        p = {"where": "SFHA_TF='T'", "geometry": UTAH_ENV,
             "geometryType": "esriGeometryEnvelope", "inSR": 4326,
             "spatialRel": "esriSpatialRelIntersects",
             "outFields": "FLD_ZONE", "returnGeometry": "true", "outSR": 4326,
             "maxAllowableOffset": 0.001,
             "f": "json", "resultOffset": offset, "resultRecordCount": 500}
        d = get_json(f"{FEMA}/query?{urllib.parse.urlencode(p)}", timeout=180)
        if "error" in d:
            raise RuntimeError(f"FEMA query failed: {d['error']}")
        feats = d.get("features", [])
        if not feats:
            break
        for f in feats:
            rings = (f.get("geometry") or {}).get("rings") or []
            for ring in rings:
                pts = [(pt[0], pt[1]) for pt in ring if pt and pt[0] is not None]
                if len(pts) >= 3:
                    rows.append({"zone": f["attributes"].get("FLD_ZONE"),
                                 "ring": [[round(x, 5), round(y, 5)] for x, y in pts]})
        offset += len(feats)
        sys.stderr.write(f"\r  flood features: {offset}")
        if not d.get("exceededTransferLimit"):
            break
    sys.stderr.write("\n")
    return rows


def fetch_permits():
    req = urllib.request.Request(BPS, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        txt = r.read().decode("utf-8", "replace")
    out = {}
    for ln in txt.splitlines()[3:]:
        p = [x.strip() for x in ln.split(",")]
        if len(p) < 12 or p[1] != "49":
            continue
        cty = UT_FIPS.get(p[2])
        if not cty:
            continue
        try:
            units_1 = int(p[7] or 0)      # 1-unit units
            units_5 = int(p[16] or 0)     # 5+ unit units
            val_1 = int(p[8] or 0)
        except ValueError:
            continue
        rec = out.setdefault(cty, {"county": cty, "permits_1unit": 0,
                                   "permits_multi": 0, "permit_value": 0})
        rec["permits_1unit"] += units_1
        rec["permits_multi"] += units_5
        rec["permit_value"] += val_1
    return list(out.values())


if __name__ == "__main__":
    print("Context: FEMA SFHA + Census building permits")
    flood = fetch_flood()
    assert_count("FEMA SFHA rings", len(flood), None)
    print(f"  (source reports 7,332 SFHA polygons over the Utah envelope)")
    pq.write_table(pa.Table.from_pylist(flood), DATA / "flood.parquet", compression="zstd")

    permits = fetch_permits()
    print(f"  permit counties: {len(permits)}")
    pq.write_table(pa.Table.from_pylist(permits), DATA / "permits.parquet", compression="zstd")
    top = sorted(permits, key=lambda r: -(r["permits_1unit"] + r["permits_multi"]))[:5]
    for t in top:
        print(f"    {t['county']:<12} {t['permits_1unit']+t['permits_multi']:>6,} units YTD 2026")
