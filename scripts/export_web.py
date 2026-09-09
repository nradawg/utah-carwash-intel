"""Export browser-ready data + a machine-readable coverage manifest.

Licence split: the published build carries only open-licensed POIs
(OSM = ODbL, Overture = CDLA/Apache). Google-derived records and the
rating/review fields sourced from them stay in data/local and are gitignored.
Coverage of the open subset is measured and reported, not assumed.
"""
import sys, json, shutil, pathlib, datetime
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import pyarrow as pa, pyarrow.parquet as pq
import numpy as np
from scipy.spatial import cKDTree
from common import DATA, ROOT

WEB = ROOT / "app" / "public" / "data"
WEB.mkdir(parents=True, exist_ok=True)


def to_int32(tbl):
    """Write integers as int32 so the browser gets Numbers, not BigInt.

    Parquet int64 decodes to JS BigInt, which throws as soon as it meets a
    plain number in arithmetic. Every integer here (acres, dollars, counts)
    fits comfortably in int32.
    """
    cols, fields = [], []
    for f in tbl.schema:
        c = tbl.column(f.name)
        if pa.types.is_int64(f.type) or pa.types.is_uint64(f.type):
            c = c.cast(pa.int32())
            f = pa.field(f.name, pa.int32())
        cols.append(c); fields.append(f)
    return pa.Table.from_arrays([c.combine_chunks() for c in cols],
                                schema=pa.schema(fields))


def main(stamp):
    sites = pq.read_table(DATA / "sites.parquet")
    cw = pq.read_table(DATA / "carwashes.parquet")
    # carwashes_open.parquet is re-merged from open-licensed members only.
    cw_open = pq.read_table(DATA / "carwashes_open.parquet")

    # ---- POIs: open-licensed only for the public build ----
    drop = {"rating", "reviews", "has_google"}
    open_cw = cw_open.select([c for c in cw_open.column_names if c not in drop])
    leaked = [s for s in open_cw.column("sources").to_pylist() if "gmaps" in s]
    if leaked:
        raise RuntimeError(f"{len(leaked)} published records still reference gmaps")

    total_wash = sum(1 for i, c in enumerate(cw.column("is_competitor").to_pylist()) if c)
    open_wash = sum(1 for c in open_cw.column("is_competitor").to_pylist() if c)
    fmts = open_cw.column("format").to_pylist()
    comp = open_cw.column("is_competitor").to_pylist()
    open_express = sum(1 for f, c in zip(fmts, comp) if c and f == "express_tunnel")

    # Attribute each wash to a county by point-in-polygon against the actual
    # county boundaries. Nearest-parcel attribution put a Centerville wash in
    # Salt Lake County, and the saturation table counts tunnels per county, so
    # a boundary error corrupts the headline metric.
    import math
    from shapely.geometry import Polygon, Point
    from shapely.strtree import STRtree
    CB = pq.read_table(DATA / "counties_geom.parquet")
    polys, names = [], []
    for nm, ring in zip(CB.column("county").to_pylist(), CB.column("ring").to_pylist()):
        if len(ring) >= 4:
            polys.append(Polygon(ring)); names.append(nm)
    ctree = STRtree(polys)
    wlon = open_cw.column("lon").to_pylist()
    wlat = open_cw.column("lat").to_pylist()
    pts = [Point(float(a), float(b)) for a, b in zip(wlon, wlat)]
    wash_county = [None] * len(pts)
    hit = ctree.query(pts, predicate="within")
    for qi, gi in zip(hit[0], hit[1]):
        if wash_county[qi] is None:
            wash_county[qi] = names[gi]
    # A handful sit just outside a simplified boundary; fall back to nearest.
    miss = [i for i, v in enumerate(wash_county) if v is None]
    if miss:
        cent = np.array([[p.centroid.x, p.centroid.y] for p in polys])
        _, ci = cKDTree(cent).query(np.array([[wlon[i], wlat[i]] for i in miss]), k=1)
        for j, i in enumerate(miss):
            wash_county[i] = names[ci[j]]
        print(f"  [county] {len(miss)} wash(es) fell outside a boundary, snapped to nearest")
    open_cw = open_cw.append_column("county", pa.array(wash_county))
    pq.write_table(to_int32(open_cw), WEB / "carwashes.parquet", compression="zstd")
    pq.write_table(to_int32(sites), WEB / "sites.parquet", compression="zstd")

    # ---- county rollup (the "he had it open on Maps" view, done properly) ----
    import duckdb
    d = duckdb.connect()
    county = d.execute(f"""
      SELECT s.county,
             count(*) AS parcels,
             round(median(s.price_per_acre)) AS median_price_per_acre,
             round(median(s.aadt)) AS median_aadt,
             max(s.tract_pop) AS _x,
             round(avg(s.median_hh_income)) AS avg_hh_income,
             sum(s.county_permits_2026)/count(*) AS permits_2026
      FROM '{DATA}/sites.parquet' s GROUP BY 1 ORDER BY 1
    """).fetchall()
    # County population: sum EVERY ACS tract in the county, not just tracts that
    # happen to contain a candidate parcel. Using the latter undercounts badly
    # (Davis showed 211k against roughly 380k actual) and would distort the
    # population-per-tunnel saturation metric, which is the headline number.
    FIPS = {"001":"Beaver","003":"BoxElder","005":"Cache","007":"Carbon","009":"Daggett",
      "011":"Davis","013":"Duchesne","015":"Emery","017":"Garfield","019":"Grand",
      "021":"Iron","023":"Juab","025":"Kane","027":"Millard","029":"Morgan","031":"Piute",
      "033":"Rich","035":"SaltLake","037":"SanJuan","039":"Sanpete","041":"Sevier",
      "043":"Summit","045":"Tooele","047":"Uintah","049":"Utah","051":"Wasatch",
      "053":"Washington","055":"Wayne","057":"Weber"}
    pop = {}
    for fips, pv in d.execute(f"""
      SELECT county_fips, sum(population) FROM '{DATA}/demographics.parquet'
      GROUP BY 1""").fetchall():
        nm = FIPS.get(fips)
        if nm:
            pop[nm] = int(pv or 0)

    # Wash counts per county, and the saturation metric the industry actually
    # uses: population per express tunnel. The published bands are 25,000 to
    # 35,000 people per tunnel; below that a market is considered tight.
    wc, we = {}, {}
    for c_, f_, comp_ in zip(wash_county, open_cw.column("format").to_pylist(),
                             open_cw.column("is_competitor").to_pylist()):
        if not comp_:
            continue
        wc[c_] = wc.get(c_, 0) + 1
        if f_ in ("express_tunnel", "flex_full_serve"):
            we[c_] = we.get(c_, 0) + 1

    rows = []
    for (cty, parcels, ppa, aadt, _x, inc, permits) in county:
        p_ = int(pop.get(cty) or 0)
        e_ = we.get(cty, 0)
        rows.append({
            "county": cty, "candidate_parcels": int(parcels),
            "median_price_per_acre": int(ppa) if ppa else None,
            "median_aadt": int(aadt) if aadt else None,
            "avg_hh_income": int(inc) if inc else None,
            "permits_2026": int(permits or 0),
            "population": p_,
            "washes": wc.get(cty, 0),
            "express": e_,
            "pop_per_tunnel": int(p_ / e_) if e_ else None,
            "pop_per_wash": int(p_ / wc[cty]) if wc.get(cty) else None,
        })
    (WEB / "counties.json").write_text(json.dumps(rows))

    # ---- coverage manifest: what is solid and what is not ----
    manifest = {
        "generated": stamp,
        "sources": [
            {"name": "UGRC LIR parcels", "url": "https://gis.utah.gov/products/sgid/cadastre/parcels/",
             "licence": "Public record (State of Utah, SGID)", "vintage": "county tax rolls, annual"},
            {"name": "UDOT AADT 2024", "url": "https://data-uplan.opendata.arcgis.com/",
             "licence": "Public record", "vintage": "2024 (series from 1981)"},
            {"name": "ACS 5-year 2023", "url": "https://www2.census.gov/programs-surveys/acs/summary_file/2023/",
             "licence": "Public domain", "vintage": "2019-2023"},
            {"name": "OpenStreetMap", "url": "https://www.openstreetmap.org/copyright",
             "licence": "ODbL - attribution and share-alike required", "vintage": "live"},
            {"name": "Overture Maps places", "url": "https://docs.overturemaps.org/",
             "licence": "CDLA-Permissive-2.0 / Apache-2.0", "vintage": "2026-08-19.0"},
            {"name": "UGRC address points", "url": "https://gis.utah.gov/products/sgid/location/address-points/",
             "licence": "Public record", "vintage": "current"},
            {"name": "FEMA NFHL", "url": "https://hazards.fema.gov/", "licence": "Public domain",
             "vintage": "current"},
            {"name": "Census Building Permits", "url": "https://www2.census.gov/econ/bps/County/",
             "licence": "Public domain", "vintage": "2026 year-to-date"},
        ],
        "coverage_caveats": [
            "Emery and San Juan counties publish parcels but leave PROP_CLASS unpopulated, so no candidate sites are listed there. That is a county reporting gap, not an absence of commercial land.",
            "Utah's Farmland Assessment Act ('greenbelt') assesses qualifying land at agricultural rather than market value, producing clusters near $2,500/acre. Affected parcels are flagged value_flag='below_market' rather than hidden or imputed.",
            "Carbon County reports land values on a non-market basis throughout; its median $/acre is not comparable to other counties.",
            "UDOT counts cover state highways and federal-aid roads. Parcels with no UDOT segment within 500 ft fall back to UGRC local-road counts (aadt_source='local'); some have no count at all.",
            "Flood screening uses FEMA SFHA polygons generalised to roughly 100 m and tested against the parcel centroid. It is a screening flag, not a survey-grade flood determination.",
            "Format is inferred where not directly observed. Every wash carries format_source and format_confidence; unresolved records are shown as Unknown rather than guessed.",
            "Competitor data is open-licensed only (OpenStreetMap and Overture), and the scoring uses the same set that the map displays, so every count is auditable against a visible dot. A wider sweep found more washes statewide; those records are not redistributable and are excluded here, so competitor counts should be read as a floor rather than a census.",
        ],
        "counts": {
            "candidate_parcels": sites.num_rows,
            "wash_facilities_published": open_wash,
            "wash_facilities_all_sources": total_wash,
            "express_tunnels_published": open_express,
            "open_coverage_pct": round(open_wash / total_wash * 100, 1) if total_wash else None,
        },
    }
    (WEB / "manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f"exported to app/public/data")
    print(f"  sites.parquet      {sites.num_rows:,} rows  "
          f"{(WEB/'sites.parquet').stat().st_size/1e6:.2f} MB")
    print(f"  carwashes.parquet  {open_cw.num_rows:,} rows (open-licensed only)  "
          f"{(WEB/'carwashes.parquet').stat().st_size/1e6:.2f} MB")
    print(f"  published wash facilities: {open_wash}/{total_wash} "
          f"({manifest['counts']['open_coverage_pct']}%), {open_express} express tunnels")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "unknown")
