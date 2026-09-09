"""Join every layer onto candidate parcels and emit FACTOR VALUES.

Deliberately does NOT emit a final score. The user changes facility size, budget
and factor weights in the browser, so scoring happens client-side. What is
precomputed here is the expensive geospatial work that cannot run in a browser:
nearest-road snapping, ring aggregation over 36k rooftop cells, competitor
counts by format, and flood screening.
"""
import sys, math, pathlib, json
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import numpy as np, pyarrow as pa, pyarrow.parquet as pq
from scipy.spatial import cKDTree
from common import DATA, assert_count

LAT0 = 39.5
M_LAT = 111_320.0
M_LON = 111_320.0 * math.cos(math.radians(LAT0))
MI = 1609.34
RINGS = [1, 3, 5]                 # miles, the industry-standard competitor rings
ROOF_RINGS = [1, 3]


def xy(lon, lat):
    return np.column_stack([np.asarray(lon) * M_LON, np.asarray(lat) * M_LAT])


def col(t, n):
    return t.column(n).to_pylist()


def load(name):
    return pq.read_table(DATA / name)


if __name__ == "__main__":
    print("Building site factor table")
    P = load("parcels.parquet")
    plon = np.array(col(P, "lon")); plat = np.array(col(P, "lat"))
    pxy = xy(plon, plat)
    n = len(plon)
    print(f"  parcels: {n:,}")

    # ---- roads: posted speed + class + local AADT (the <=45mph gate) ----
    R = load("roads.parquet")
    rpts, rmeta = [], []
    for pts, sp, fc, aa, ln in zip(col(R, "pts"), col(R, "speed"), col(R, "fclass"),
                                   col(R, "aadt_local"), col(R, "lanes")):
        for (x, y) in pts:
            rpts.append((x, y)); rmeta.append((sp, fc, aa, ln))
    rxy = xy([p[0] for p in rpts], [p[1] for p in rpts])
    rtree = cKDTree(rxy)
    rd, ri = rtree.query(pxy, k=1)
    road_speed = [rmeta[i][0] for i in ri]
    road_class = [rmeta[i][1] for i in ri]
    road_aadt = [rmeta[i][2] for i in ri]
    road_lanes = [rmeta[i][3] for i in ri]
    print(f"  roads: {len(R):,} segments -> {len(rpts):,} vertices indexed")

    # ---- UDOT AADT: state-highway volume, trend, truck-discounted ----
    T = load("traffic.parquet")
    tpts, tmeta = [], []
    for pts, a, ar, g, tr, ds in zip(col(T, "pts"), col(T, "aadt"), col(T, "aadt_retail"),
                                     col(T, "growth_10yr_pct"), col(T, "truck_share"),
                                     col(T, "desc")):
        for (x, y) in pts:
            tpts.append((x, y)); tmeta.append((a, ar, g, tr, ds))
    txy = xy([p[0] for p in tpts], [p[1] for p in tpts])
    td, ti = cKDTree(txy).query(pxy, k=1)
    SNAP = 500 * 0.3048  # 500 ft: beyond this the segment is not this site's frontage
    aadt = [tmeta[i][0] if d <= SNAP else None for d, i in zip(td, ti)]
    aadt_retail = [tmeta[i][1] if d <= SNAP else None for d, i in zip(td, ti)]
    aadt_growth = [tmeta[i][2] if d <= SNAP else None for d, i in zip(td, ti)]
    truck_share = [tmeta[i][3] if d <= SNAP else None for d, i in zip(td, ti)]
    aadt_desc = [tmeta[i][4] if d <= SNAP else None for d, i in zip(td, ti)]
    # fall back to local road counts where no state highway is in range
    aadt_best = [a if a is not None else (la or None) for a, la in zip(aadt, road_aadt)]
    aadt_src = ["udot" if a is not None else ("local" if la else "none")
                for a, la in zip(aadt, road_aadt)]
    print(f"  traffic: {sum(1 for a in aadt if a):,} parcels snapped to a UDOT segment "
          f"(<=500ft), {sum(1 for s in aadt_src if s=='local'):,} using local counts")

    # ---- rooftops in rings ----
    RF = load("rooftops.parquet")
    fxy = xy(col(RF, "lon"), col(RF, "lat"))
    fres = np.array(col(RF, "n_res")); fall = np.array(col(RF, "n_all"))
    ftree = cKDTree(fxy)
    roof = {}
    for mi in ROOF_RINGS:
        idx = ftree.query_ball_point(pxy, mi * MI)
        roof[f"rooftops_{mi}mi"] = [int(fres[i].sum()) if len(i) else 0 for i in idx]
    print(f"  rooftops: ringed over {len(RF):,} grid cells")

    # ---- competitors by format ----
    # Use the open-licensed variant so competitor COUNTS match the competitors
    # the map actually displays. Scoring against a larger private set would
    # show "3 tunnels within 3 mi" beside only 2 visible dots, which reads as
    # a bug and is impossible for anyone to audit.
    C = load("carwashes_open.parquet")
    is_comp = np.array(col(C, "is_competitor"))
    cfmt = np.array(col(C, "format"))
    cxy_all = xy(col(C, "lon"), col(C, "lat"))
    cxy = cxy_all[is_comp]
    cfmt_c = cfmt[is_comp]
    ctree = cKDTree(cxy)
    express_mask = (cfmt_c == "express_tunnel")
    etree = cKDTree(cxy[express_mask]) if express_mask.any() else None

    comp = {}
    for mi in RINGS:
        idx = ctree.query_ball_point(pxy, mi * MI)
        comp[f"competitors_{mi}mi"] = [len(i) for i in idx]
        comp[f"express_{mi}mi"] = [int(express_mask[i].sum()) if len(i) else 0 for i in idx]
    dnear, _ = ctree.query(pxy, k=1)
    comp["dist_nearest_wash_mi"] = [round(d / MI, 2) for d in dnear]
    if etree is not None:
        de, _ = etree.query(pxy, k=1)
        comp["dist_nearest_express_mi"] = [round(d / MI, 2) for d in de]
    else:
        comp["dist_nearest_express_mi"] = [None] * n
    print(f"  competition: {int(is_comp.sum()):,} wash facilities "
          f"({int(express_mask.sum()):,} express tunnels)")

    # ---- demographics: ACS tract attached by point-in-polygon ----
    from shapely.geometry import Polygon, Point
    from shapely.strtree import STRtree
    TR = load("tracts.parquet")
    tgeoids = col(TR, "geoid")
    polys, keep = [], []
    for gi, ring in zip(tgeoids, col(TR, "ring")):
        if len(ring) >= 4:
            polys.append(Polygon(ring)); keep.append(gi)
    tree = STRtree(polys)
    pts = [Point(float(lo), float(la)) for lo, la in zip(plon, plat)]
    hit = tree.query(pts, predicate="within")   # (query_idx, geom_idx) pairs
    parcel_tract = [None] * n
    for qi, gi in zip(hit[0], hit[1]):
        if parcel_tract[qi] is None:
            parcel_tract[qi] = keep[gi]

    D = load("demographics.parquet")
    dem = {}
    for g, pop, inc, hh, vph, mf, cc, hv in zip(
            col(D, "geoid"), col(D, "population"), col(D, "median_hh_income"),
            col(D, "households"), col(D, "vehicles_per_hh"),
            col(D, "multifamily_pct"), col(D, "car_commute_pct"),
            col(D, "median_home_value")):
        dem[g] = (pop, inc, hh, vph, mf, cc, hv)
    matched = sum(1 for t in parcel_tract if t and t in dem)
    print(f"  demographics: {matched:,}/{n:,} parcels matched to an ACS tract "
          f"({matched/n*100:.1f}%)")

    # ---- flood screening ----
    F = load("flood.parquet")
    fl_pts, = [col(F, "ring")]
    fb = []
    for ring in fl_pts:
        xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
        fb.append((min(xs), max(xs), min(ys), max(ys)))
    fb = np.array(fb)
    fcx = xy((fb[:, 0] + fb[:, 1]) / 2, (fb[:, 2] + fb[:, 3]) / 2)
    fdist, fidx = cKDTree(fcx).query(pxy, k=1)
    # conservative: flag if the parcel falls inside the polygon's bounding box
    in_flood = []
    for k, (lo, la) in enumerate(zip(plon, plat)):
        i = fidx[k]
        in_flood.append(bool(fb[i, 0] <= lo <= fb[i, 1] and fb[i, 2] <= la <= fb[i, 3]))
    print(f"  flood: {sum(in_flood):,} parcels inside an SFHA bounding box (screening flag)")

    # ---- permits by county ----
    PM = load("permits.parquet")
    permits = {c: (a or 0) + (b or 0) for c, a, b in
               zip(col(PM, "county"), col(PM, "permits_1unit"), col(PM, "permits_multi"))}

    # ---- land value credibility ----
    # Utah's Farmland Assessment Act ("greenbelt") assesses qualifying land at
    # AGRICULTURAL value, not market value, producing clusters at ~$2,500/acre.
    # Some counties (notably Carbon) appear to report on a different basis
    # entirely. Presenting those as land prices would mislead, so flag rather
    # than silently drop or impute.
    VALUE_FLOOR = 25_000          # $/acre; below this is not commercial market value in Utah
    ppa_all = col(P, "price_per_acre")
    by_cty = {}
    for c_, v in zip(col(P, "county"), ppa_all):
        if v: by_cty.setdefault(c_, []).append(v)
    cty_median = {k: sorted(v)[len(v)//2] for k, v in by_cty.items() if v}
    suspect_counties = {k for k, m in cty_median.items() if m < VALUE_FLOOR}
    if suspect_counties:
        print(f"  [value] counties whose MEDIAN $/acre is below ${VALUE_FLOOR:,} "
              f"(assessed on a non-market basis): {sorted(suspect_counties)}")
    n_flag = sum(1 for v in ppa_all if v and v < VALUE_FLOOR)
    print(f"  [value] {n_flag:,} parcels flagged below-market "
          f"({n_flag/len(ppa_all)*100:.1f}%) - shown with a warning, not hidden")

    # ---- assemble ----
    # Hoist every column out of the Arrow table ONCE. Calling col() inside the
    # row loop re-materialises the whole column per row (O(n^2)).
    P_ = {k: col(P, k) for k in
          ("parcel_id", "address", "city", "county", "acres", "land_value",
           "price_per_acre", "prop_class", "bldg_sqft", "is_vacant",
           "max_dim_ft", "min_dim_ft", "assessor_url")}
    out = []
    for i in range(n):
        cty = P_["county"][i]
        out.append({
            "parcel_id": P_["parcel_id"][i],
            "address": P_["address"][i], "city": P_["city"][i], "county": cty,
            "lat": float(plat[i]), "lon": float(plon[i]),
            "acres": P_["acres"][i],
            "land_value": P_["land_value"][i],
            "price_per_acre": P_["price_per_acre"][i],
            "prop_class": P_["prop_class"][i],
            "bldg_sqft": P_["bldg_sqft"][i],
            "is_vacant": P_["is_vacant"][i],
            "max_dim_ft": P_["max_dim_ft"][i],
            "min_dim_ft": P_["min_dim_ft"][i],
            "assessor_url": P_["assessor_url"][i],
            "road_speed": road_speed[i], "road_class": road_class[i],
            "road_lanes": road_lanes[i],
            "aadt": aadt_best[i], "aadt_source": aadt_src[i],
            "aadt_retail": aadt_retail[i], "aadt_growth_pct": aadt_growth[i],
            "truck_share": truck_share[i], "aadt_desc": aadt_desc[i],
            "rooftops_1mi": roof["rooftops_1mi"][i],
            "rooftops_3mi": roof["rooftops_3mi"][i],
            "competitors_1mi": comp["competitors_1mi"][i],
            "competitors_3mi": comp["competitors_3mi"][i],
            "competitors_5mi": comp["competitors_5mi"][i],
            "express_1mi": comp["express_1mi"][i],
            "express_3mi": comp["express_3mi"][i],
            "express_5mi": comp["express_5mi"][i],
            "dist_nearest_wash_mi": comp["dist_nearest_wash_mi"][i],
            "dist_nearest_express_mi": comp["dist_nearest_express_mi"][i],
            "in_flood_zone": in_flood[i],
            "county_permits_2026": permits.get(cty, 0),
            "tract": parcel_tract[i],
            "tract_pop": dem.get(parcel_tract[i], (None,)*7)[0],
            "median_hh_income": dem.get(parcel_tract[i], (None,)*7)[1],
            "tract_households": dem.get(parcel_tract[i], (None,)*7)[2],
            "vehicles_per_hh": dem.get(parcel_tract[i], (None,)*7)[3],
            "multifamily_pct": dem.get(parcel_tract[i], (None,)*7)[4],
            "car_commute_pct": dem.get(parcel_tract[i], (None,)*7)[5],
            "median_home_value": dem.get(parcel_tract[i], (None,)*7)[6],
            "value_flag": ("below_market"
                           if (P_["price_per_acre"][i] or 0) < VALUE_FLOOR
                           else "ok"),
            "county_value_basis": ("non_market" if cty in suspect_counties else "market"),
        })

    assert_count("scored candidate sites", len(out), 45140)
    pq.write_table(pa.Table.from_pylist(out), DATA / "sites.parquet", compression="zstd")
    print(f"  wrote data/sites.parquet  {(DATA/'sites.parquet').stat().st_size/1e6:.1f} MB")
