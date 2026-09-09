"""Rooftop density from UGRC address points (1,498,550 statewide).

Real rooftop counts beat interpolating households from tract polygons, because
a car wash trade area is a 1-3 mile ring that slices across tract boundaries.

Aggregated server-side into a ~0.005 degree grid (roughly 550m x 420m at
Utah's latitude) so ring sums are cheap. Source: Open SGID PostGIS, whose terms
require ETL-out rather than live querying, which is what this does.

pttype values are messy in the source (RESIDENCIAL, RESIDENTAIL typos,
GOVERNMENT vs GOVERNMENTAL), so they are normalised here.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import duckdb, pyarrow as pa, pyarrow.parquet as pq
from common import DATA, assert_count

DSN = ("dbname=opensgid user=agrc password=agrc "
       "host=opensgid.ugrc.utah.gov port=5432")
CELL = 0.005

# One server-side aggregation, not 750 paged requests.
SQL = f"""
SELECT
  round(ST_X(ST_Transform(shape,4326))/{CELL})*{CELL} AS lon,
  round(ST_Y(ST_Transform(shape,4326))/{CELL})*{CELL} AS lat,
  count(*) AS n_all,
  count(*) FILTER (WHERE upper(coalesce(pttype,'')) LIKE 'RESID%'
                      OR upper(coalesce(pttype,'')) IN ('ADU','MIXED USE')) AS n_res,
  count(*) FILTER (WHERE upper(coalesce(pttype,'')) LIKE 'COMMERC%') AS n_comm
FROM location.address_points
WHERE shape IS NOT NULL
GROUP BY 1,2
"""

if __name__ == "__main__":
    print("Rooftops: UGRC address points -> grid (Open SGID, one-shot ETL)")
    c = duckdb.connect()
    c.execute("INSTALL postgres; LOAD postgres;")
    c.execute(f"ATTACH '{DSN}' AS sgid (TYPE postgres, READ_ONLY);")
    rows = c.execute(f"SELECT * FROM postgres_query(sgid, $q${SQL}$q$)").fetchall()
    out = [{"lon": round(r[0], 4), "lat": round(r[1], 4),
            "n_all": int(r[2]), "n_res": int(r[3]), "n_comm": int(r[4])}
           for r in rows if r[0] is not None]
    total = sum(r["n_all"] for r in out)
    assert_count("address points (summed)", total, 1498550)
    print(f"  grid cells: {len(out):,}")
    pq.write_table(pa.Table.from_pylist(out), DATA / "rooftops.parquet", compression="zstd")
    print(f"  wrote data/rooftops.parquet  {(DATA/'rooftops.parquet').stat().st_size/1e6:.2f} MB")
    print(f"  residential: {sum(r['n_res'] for r in out):,}  "
          f"commercial: {sum(r['n_comm'] for r in out):,}")
