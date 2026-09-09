"""Commercial frontage roads: UGRC transportation.roads via Open SGID.

Gives what UDOT's state-highway AADT layer cannot: posted speed limit (the <=45
mph gate), functional class, lane count, and local-road AADT. Restricted to
arterials/collectors plus anything with a traffic count, since a car wash does
not go on a residential local street.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import duckdb, pyarrow as pa, pyarrow.parquet as pq
from common import DATA, assert_count

DSN = "dbname=opensgid user=agrc password=agrc host=opensgid.ugrc.utah.gov port=5432"

SQL = """
SELECT fullname, dot_fclass, speed_lmt, dot_aadt, dot_thrulanes, oneway,
       ST_AsText(ST_Simplify(ST_Transform(shape,4326), 0.00012)) AS wkt
FROM transportation.roads
WHERE (dot_fclass IN ('Principal Arterial','Minor Arterial','Major Collector',
                      'Minor Collector','Interstate','Other Freeway')
       OR dot_aadt > 0)
  AND shape IS NOT NULL
"""


def pts_from_wkt(wkt, step=3):
    """Sample vertices from a LINESTRING / MULTILINESTRING."""
    if not wkt:
        return []
    body = wkt[wkt.find("(") : ].strip()
    out = []
    for chunk in body.replace("(", " ").replace(")", " ").split(","):
        p = chunk.split()
        if len(p) >= 2:
            try:
                out.append((round(float(p[0]), 5), round(float(p[1]), 5)))
            except ValueError:
                pass
    return out[::step] + (out[-1:] if len(out) > step else [])


if __name__ == "__main__":
    print("Roads: arterials/collectors + counted roads (Open SGID)")
    c = duckdb.connect()
    c.execute("INSTALL postgres; LOAD postgres;")
    c.execute(f"ATTACH '{DSN}' AS sgid (TYPE postgres, READ_ONLY);")
    raw = c.execute(f"SELECT * FROM postgres_query(sgid, $q${SQL}$q$)").fetchall()
    print(f"  segments returned: {len(raw):,}")

    rows = []
    for name, fclass, speed, aadt, lanes, oneway, wkt in raw:
        pts = pts_from_wkt(wkt)
        if not pts:
            continue
        rows.append({
            "name": (name or "").strip() or None,
            "fclass": (fclass or "").strip() or None,
            "speed": int(speed) if speed else None,
            "aadt_local": int(aadt) if aadt else None,
            "lanes": int(lanes) if lanes else None,
            "oneway": (oneway or "").strip() or None,
            "pts": pts,
        })
    assert_count("frontage road segments", len(rows), None)
    pq.write_table(pa.Table.from_pylist(rows), DATA / "roads.parquet", compression="zstd")
    print(f"  wrote data/roads.parquet  {len(rows):,} rows "
          f"{(DATA/'roads.parquet').stat().st_size/1e6:.1f} MB")
    ok = sum(1 for r in rows if r["speed"] and r["speed"] <= 45)
    print(f"  with speed<=45mph: {ok:,}  |  with local AADT: "
          f"{sum(1 for r in rows if r['aadt_local']):,}")
