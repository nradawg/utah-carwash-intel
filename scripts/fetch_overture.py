"""Car washes from Overture Maps places.

License CDLA-Permissive-2.0 / Apache-2.0. Overture's places theme deliberately
excludes OSM, so it carries no ODbL share-alike and is safe to publish.

The category string was discovered empirically (not assumed): this release uses
`categories.primary`, and the value is `car_wash`. The docs describe a
`taxonomy.primary` field which is NOT what release 2026-08-19.0 actually ships.
"""
import sys, json, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import duckdb
from common import DATA

RELEASE = "2026-08-19.0"
SRC = f"s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*"
UTAH = dict(w=-114.06, e=-109.04, s=36.99, n=42.01)
CATS = ("car_wash", "auto_detailing")


def fetch():
    c = duckdb.connect()
    c.execute("INSTALL spatial; INSTALL httpfs; LOAD spatial; LOAD httpfs; SET s3_region='us-west-2';")
    q = f"""
    SELECT id, names.primary AS name, categories.primary AS cat, confidence,
           brand.names.primary AS brand, brand.wikidata AS brand_wikidata,
           addresses[1].freeform AS addr, addresses[1].locality AS city,
           addresses[1].postcode AS postcode,
           websites[1] AS website, phones[1] AS phone, operating_status AS status,
           socials, list_transform(sources, x -> x.dataset) AS datasets,
           ST_X(geometry) AS lon, ST_Y(geometry) AS lat
    FROM read_parquet('{SRC}', hive_partitioning=1)
    WHERE bbox.xmin BETWEEN {UTAH['w']} AND {UTAH['e']}
      AND bbox.ymin BETWEEN {UTAH['s']} AND {UTAH['n']}
      AND categories.primary IN {CATS}
      AND confidence > 0.4
    """
    rows = []
    for (oid, name, cat, conf, brand, bwd, addr, city, postcode, web, phone,
         status, socials, datasets, lon, lat) in c.execute(q).fetchall():
        if lon is None or lat is None:
            continue
        if status and status != "open":
            continue
        rows.append({
            "src": "overture", "src_id": oid, "name": name, "brand": brand,
            "operator": None, "lat": lat, "lon": lon, "address": addr, "city": city,
            "website": web, "phone": phone, "opening_hours": None, "parcel_id": None,
            "postcode": postcode, "brand_wikidata": bwd, "checked": None,
            "osm_id": None, "overture_id": oid,
            "socials": list(socials) if socials else None,
            "datasets": sorted(set(datasets)) if datasets else None,
            "tags": {}, "rating": None, "reviews": None,
            "google_category": "auto detailing service" if cat == "auto_detailing" else None,
            "confidence": conf,
        })
    return rows


if __name__ == "__main__":
    rows = fetch()
    print(f"Overture places (Utah, {CATS}): {len(rows)}")
    (DATA / "raw_overture.json").write_text(json.dumps(rows))
    print(f"  with brand: {sum(1 for r in rows if r['brand'])}"
          f"  |  named: {sum(1 for r in rows if r['name'])}")
