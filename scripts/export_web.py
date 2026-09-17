"""Export browser-ready data + a machine-readable coverage manifest.

Licence split: the published build carries only open-licensed POIs
(OSM = ODbL, Overture = CDLA/Apache). Google-derived records and the
rating/review fields sourced from them stay in data/local and are gitignored.
Coverage of the open subset against that private sweep is printed here for
the maintainer and never written to the published files.
"""
import sys, re, json, shutil, pathlib, datetime
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import pyarrow as pa, pyarrow.parquet as pq
from common import DATA, ROOT

WEB = ROOT / "app" / "public" / "data"
CC_BY = "https://creativecommons.org/licenses/by/4.0/"
US_GOV = "https://www.usa.gov/government-copyright"   # federal work, not copyrighted in the US
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
    if not (DATA / "user" / "PUBLISH_OK").exists():
        mine = [s for s in open_cw.column("sources").to_pylist() if "user" in s.split(",")]
        if mine:
            raise RuntimeError(f"{len(mine)} published records come from data/user without PUBLISH_OK")

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
    # A few Utah washes sit just outside a simplified county outline, so a wash
    # within 1 km of a county takes that county. Snapping every miss to the
    # nearest county centroid put Rock Springs and Green River, Wyoming in
    # Daggett and an Evanston truck wash in Summit: Overture's search box is a
    # rectangle. Washes further out get no county. They stay on the map and in
    # competitor rings (real competition across the line), but no Utah county
    # counts them.
    from shapely.ops import nearest_points
    miss = [i for i, v in enumerate(wash_county) if v is None]
    far = []
    for i in miss:
        k = math.cos(math.radians(wlat[i]))
        dist = []
        for j, poly in enumerate(polys):
            q = nearest_points(poly, pts[i])[0]
            dist.append((math.hypot((q.x - wlon[i]) * 111_195 * k, (q.y - wlat[i]) * 111_195), j))
        dm, j = min(dist)
        if dm <= 1000:
            wash_county[i] = names[j]
        else:
            far.append(f"{open_cw.column('name')[i].as_py()} ({dm / 1000:.0f} km outside {names[j]})")
    print(f"  [county] {len(miss) - len(far)} wash(es) just outside a county outline took that county; "
          f"{len(far)} outside Utah left without a county: {'; '.join(far)}")
    open_cw = open_cw.append_column("county", pa.array(wash_county))
    pq.write_table(to_int32(open_cw), WEB / "carwashes.parquet", compression="zstd")
    pq.write_table(to_int32(sites), WEB / "sites.parquet", compression="zstd")

    # ---- county rollup (the "he had it open on Maps" view, done properly) ----
    import duckdb
    d = duckdb.connect()
    # Site figures per county. Emery and San Juan have no candidate lots, so the
    # table is driven by the Census county list below and these are joined on.
    site_agg = {r[0]: r[1:] for r in d.execute(f"""
      SELECT s.county,
             count(*) AS parcels,
             round(median(s.price_per_acre)) AS median_price_per_acre,
             round(median(s.aadt)) AS median_aadt,
             round(avg(s.median_hh_income)) AS avg_hh_income,
             max(s.county_value_basis) AS value_basis
      FROM '{DATA}/sites.parquet' s GROUP BY 1
    """).fetchall()}
    permits = {c_: int((a or 0) + (b or 0)) for c_, a, b in d.execute(
        f"SELECT county, permits_1unit, permits_multi FROM '{DATA}/permits.parquet'").fetchall()}
    # County population: the Census July 2025 estimate for the WHOLE county, not
    # a sum of tracts that happen to contain a candidate parcel (that undercut
    # Davis by about 170k). It replaced the ACS 2019-2023 tract sum, which lagged
    # fast-growing counties by years and so overstated how saturated they are
    # on the population-per-tunnel metric, the headline number.
    pep = {}
    for cty, p25, p20, g, dom in d.execute(f"""
      SELECT county, pop_2025, pop_2020_base, growth_pct, net_domestic_2020_2025
      FROM '{DATA}/county_pep.parquet'""").fetchall():
        pep[cty] = (int(p25), int(p20), g, int(dom))

    # Wash counts per county, and the saturation metric the industry actually
    # uses: population per express tunnel. The published bands are 25,000 to
    # 35,000 people per tunnel; below that a market is considered tight.
    wc, we = {}, {}
    for c_, f_, comp_ in zip(wash_county, open_cw.column("format").to_pylist(),
                             open_cw.column("is_competitor").to_pylist()):
        if not comp_ or c_ is None:
            continue
        wc[c_] = wc.get(c_, 0) + 1
        # Express tunnels only, the same definition the map and site panels use.
        if f_ == "express_tunnel":
            we[c_] = we.get(c_, 0) + 1

    unknown = set(site_agg) - set(pep)
    if unknown:
        raise RuntimeError(f"no Census population estimate for counties {sorted(unknown)}")
    rows = []
    for cty in sorted(pep):
        parcels, ppa, aadt, inc, basis = site_agg.get(cty, (0, None, None, None, None))
        p_, p20, growth, dom = pep[cty]
        e_ = we.get(cty, 0)
        rows.append({
            "county": cty, "candidate_parcels": int(parcels),
            "median_price_per_acre": int(ppa) if ppa else None,
            # 'non_market' (Carbon): land is assessed on a basis whose prices
            # cannot be compared with other counties.
            "value_basis": basis or "market",
            "median_aadt": int(aadt) if aadt else None,
            "avg_hh_income": int(inc) if inc else None,
            "permits_2026": permits.get(cty, 0),
            "population": p_,
            "washes": wc.get(cty, 0),
            "express": e_,
            "pop_per_tunnel": int(p_ / e_) if e_ else None,
            "pop_per_wash": int(p_ / wc[cty]) if wc.get(cty) else None,
            "population_2020": p20,
            "growth_pct": growth,
            "net_domestic_2020_2025": dom,
        })
    (WEB / "counties.json").write_text(json.dumps(rows))

    # ---- coverage manifest: what is solid and what is not ----
    # Counties whose parcel ids could not be checked against the current map
    # (check_parcels_current.py says why), named in the caveat below.
    unchecked = sorted(re.sub(r"(?<=[a-z])(?=[A-Z])", " ", c_) for (c_,) in d.execute(
        f"SELECT DISTINCT county FROM '{DATA}/parcel_currency.parquet' WHERE skip_reason IS NOT NULL").fetchall())
    unchecked_txt = (", ".join(unchecked[:-1]) + " and " + unchecked[-1]) if len(unchecked) > 1 else "".join(unchecked)
    manifest = {
        "generated": stamp,
        # licence_url links the licence itself (or, for public domain and
        # UDOT, the page that states the terms). Every url and licence_url
        # below returned HTTP 200 on 2026-09-17.
        "sources": [
            {"name": "UGRC LIR parcels", "url": "https://gis.utah.gov/products/sgid/cadastre/parcels/",
             "licence": "CC BY 4.0, credit UGRC SGID (data modified)", "licence_url": CC_BY,
             "vintage": "county tax rolls, annual"},
            {"name": "UDOT AADT 2024", "url": "https://data-uplan.opendata.arcgis.com/",
             "licence": "Published by UDOT with no licence stated, provided without warranty",
             "licence_url": "https://www.arcgis.com/home/item.html?id=52da935542464cdaa29fc872a489b580",
             "vintage": "2024 (series from 1981)"},
            {"name": "ACS 5-year 2023", "url": "https://www2.census.gov/programs-surveys/acs/summary_file/2023/",
             "licence": "Public domain", "licence_url": US_GOV, "vintage": "2019 to 2023"},
            {"name": "Census TIGER census tracts", "url": "https://tigerweb.geo.census.gov/",
             "licence": "Public domain", "licence_url": US_GOV, "vintage": "2023 tract boundaries"},
            {"name": "OpenStreetMap", "url": "https://www.openstreetmap.org/",
             "licence": "ODbL, attribution and share-alike required",
             "licence_url": "https://www.openstreetmap.org/copyright", "vintage": "live"},
            {"name": "Overture Maps places", "url": "https://docs.overturemaps.org/attribution/",
             "licence": "CDLA-Permissive-2.0 (Foursquare records Apache-2.0, AllThePlaces records CC0)",
             "licence_url": "https://cdla.dev/permissive-2-0/", "vintage": "2026-08-19.0"},
            {"name": "Foursquare Open Source Places, via Overture Maps",
             "url": "https://opensource.foursquare.com/places-notice-txt/",
             "licence": "Apache-2.0, keep Foursquare's NOTICE with the data",
             "licence_url": "https://www.apache.org/licenses/LICENSE-2.0", "vintage": "2026-08-19.0"},
            {"name": "UGRC address points", "url": "https://gis.utah.gov/products/sgid/location/address-points/",
             "licence": "CC BY 4.0, credit UGRC SGID (data modified)", "licence_url": CC_BY, "vintage": "current"},
            {"name": "UGRC roads (Open SGID transportation.roads)",
             "url": "https://gis.utah.gov/products/sgid/transportation/road-centerlines/",
             "licence": "CC BY 4.0, credit UGRC SGID (data modified). Used for speed limits, road types, "
                        "drive areas and Street View points", "licence_url": CC_BY, "vintage": "current"},
            {"name": "UGRC county boundaries", "url": "https://gis.utah.gov/products/sgid/boundaries/county/",
             "licence": "CC BY 4.0, credit UGRC SGID (data modified)", "licence_url": CC_BY, "vintage": "current"},
            {"name": "FEMA NFHL", "url": "https://msc.fema.gov/portal/home",
             "licence": "Public domain", "licence_url": US_GOV, "vintage": "current"},
            {"name": "Census Building Permits", "url": "https://www2.census.gov/econ/bps/County/",
             "licence": "Public domain", "licence_url": US_GOV, "vintage": "2026 year-to-date"},
            {"name": "Census Population Estimates, counties (Vintage 2025)",
             "url": "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/counties/totals/co-est2025-alldata.csv",
             "licence": "Public domain", "licence_url": US_GOV, "vintage": "April 2020 base to July 1, 2025"},
            {"name": "Census Population Estimates, cities and towns (Vintage 2025)",
             "url": "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_49.csv",
             "licence": "Public domain", "licence_url": US_GOV, "vintage": "April 2020 base to July 1, 2025"},
            {"name": "UGRC municipal boundaries", "url": "https://gis.utah.gov/products/sgid/boundaries/municipal/",
             "licence": "CC BY 4.0, credit UGRC SGID (data modified)", "licence_url": CC_BY, "vintage": "current"},
        ],
        # Written for someone outside the trade: no field names or acronyms.
        "coverage_caveats": [
            "Each lot appears once. County records that repeat a parcel for every unit or owner are merged into one lot, and apartment and condo complexes are left out.",
            "Lots come from each county's yearly tax roll. A lot whose parcel number is gone from the county's current parcel map, because the county has split, merged or renumbered it since that roll, is left out of the ranking by default."
            + (f" {unchecked_txt} {'counties' if len(unchecked) > 1 else 'County'} could not be checked this way, because the current map there is older than the tax roll or numbers parcels differently." if unchecked else ""),
            "Salt Lake County marks land whose owner pays no property tax, such as city, state and church land, mining land and condo common areas, and those lots are left out. The other counties do not say which land is tax exempt, so some of their lots may still be owned by a government or a church.",
            "A lot counts as empty only when the county records no building on it, no year built, and buildings worth less than $15,000 (or 5% of the lot's total value). Several counties, Summit among them, never record building size, so the building value is what shows a lot is built on.",
            "The state parcel file lists Summit County's building value where the land value belongs and the other way round, which the Summit County property records confirm. The two are swapped back here, so Summit land prices match the county's own figures.",
            "Emery and San Juan counties publish their parcels without saying which ones are commercial, so no lots are listed there. That is a gap in what those counties report, not a lack of commercial land.",
            "Utah taxes qualifying farmland (greenbelt land) at its farm value instead of its market value, so some lots show land values near $2,500 an acre. Those lots carry a below market warning instead of being hidden or guessed at.",
            "Carbon County values its land on a different basis from other counties, so its land prices cannot be compared with theirs.",
            "Traffic counts from the Utah Department of Transportation cover state highways and other main roads. Interstate freeway counts are never used, because a car wash cannot be entered from a freeway, so each lot takes the nearest other counted road within 500 feet. A lot with none uses the count on its nearest main road from the state road map, and some lots have no count at all. Traffic is only shown when the counted road runs right beside the lot, so a lot set back from every counted road shows no count instead of a busy road some distance away. Traffic growth compares 2024 with 2014 and is left blank where there was no 2014 count.",
            "Homes nearby are counted from the state's list of addresses. Several counties, including Wasatch, Summit and Utah counties, do not say which of their addresses are homes, so there the count is estimated so that each county's total matches the Census count of homes. Where more than a quarter of the 3 mile area around a lot is in another state, homes over the state line are not in the list, so that lot's home count is marked as not known.",
            "The flood check compares the middle of each lot with a simplified outline of FEMA's mapped flood zones and leans toward flagging a lot when in doubt. It is a first look, not an official flood determination.",
            "When a car wash's type (Express tunnel, In-bay automatic, Self-serve and so on) is not recorded, it is worked out from its brand, its name or its listing category, and each wash says how its type was found. If nothing points to a type, it shows as Format unknown instead of a guess.",
            "Existing car washes come from two free public maps, OpenStreetMap and Overture Maps, and every competitor count uses exactly the washes shown on the map. Neither map lists every business, so read wash counts as a minimum. Washes just over the state line appear on the map and count as nearby competition, but are not included in any Utah county's totals.",
            "County population is the Census estimate for July 1, 2025, so people per express wash reflects growth since 2020. Neighborhood figures for each lot, such as household income and cars per household, come from the Census survey covering 2019 to 2023, because the Census does not publish yearly figures for areas that small.",
            "City growth compares each city's population in April 2020, when the last Census was taken, with its July 2025 estimate. Lots outside every city boundary are on unincorporated county land. Ogden Valley City and Spring Lake are on the state boundary map but have no Census estimate yet, so lots there show the city name without population or growth.",
        ],
        "counts": {
            # The header reads these: lots on the map, and the counties that have any.
            "candidate_lots": sites.num_rows,
            "counties_with_lots": sum(1 for r in rows if r["candidate_parcels"]),
            "candidate_parcels": sites.num_rows,
            "wash_facilities_published": open_wash,
            "express_tunnels_published": open_express,
        },
    }
    (WEB / "manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f"exported to app/public/data")
    print(f"  sites.parquet      {sites.num_rows:,} rows  "
          f"{(WEB/'sites.parquet').stat().st_size/1e6:.2f} MB")
    print(f"  carwashes.parquet  {open_cw.num_rows:,} rows (open-licensed only)  "
          f"{(WEB/'carwashes.parquet').stat().st_size/1e6:.2f} MB")
    # Maintainer only: how much of the private sweep the open maps cover.
    print(f"  published wash facilities: {open_wash}/{total_wash} "
          f"({open_wash / max(total_wash, 1) * 100:.1f}% of all sources, not published), "
          f"{open_express} express tunnels")
    print(f"  counties.json: {len(rows)} counties")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "unknown")
