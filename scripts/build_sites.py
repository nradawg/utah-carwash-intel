"""Join every layer onto candidate parcels and emit FACTOR VALUES.

Deliberately does NOT emit a final score. The user changes facility size, budget
and factor weights in the browser, so scoring happens client-side. What is
precomputed here is the expensive geospatial work that cannot run in a browser:
nearest-road snapping, ring aggregation over 36k rooftop cells, competitor
counts by format, and flood screening.
"""
import sys, re, math, pathlib, json
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import numpy as np, pyarrow as pa, pyarrow.parquet as pq
from scipy.spatial import cKDTree
from common import DATA, assert_count
from parcel_links import parcel_url, LINKS
import re

# Mirrors roadLabel() and plainText() in app/components/plain.ts.
_DASH = re.compile(r"\s+[-\u2013\u2014]+\s+|\s*[\u2013\u2014]+\s*")
_SPLIT = re.compile(r"\s*/\s*|\s+&\s+|\s+(?:via|to|from|in)\s+|\s*\b(?:north|south|east|west)erly\b", re.I)


def _first_name(x):
    for p in _SPLIT.split(x):
        p = re.sub(r"\s+", " ", re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9]+$", "", re.sub(r"[()]", " ", p))).strip()
        if re.search(r"[A-Za-z]", p):
            return p
    return ""


def _drop_town(name, towns):
    """UDOT often appends the town: "1000 W Clearfield" is 1000 W in Clearfield."""
    low = name.lower()
    for t in towns:
        if low.endswith(" " + t.lower()) and len(name) > len(t) + 1:
            return name[: -len(t) - 1].strip()
    return name


def road_label(raw, towns):
    t = re.sub(r"\s+", " ", _DASH.sub(", ", raw or "")).strip()
    m = re.search(r"\(([^()]*)\)", t)
    inner = m.group(1) if m else ""
    main_src = t[: t.index("(")] if re.match(r"^[^(]*[A-Za-z0-9][^(]*\(", t) else t
    main = _drop_town(_first_name(main_src), towns)
    alias = "" if re.search(r"one ?way|proposed|\b[NSEW]B\b", inner, re.I) else _drop_town(_first_name(inner), towns)
    if not main:
        return None
    return f"{main} ({alias})" if alias and alias.lower() != main.lower() else main

R_EARTH = 6_371_008.8            # mean Earth radius, metres
MI = 1609.34
RINGS = [1, 3, 5]                 # miles, the industry-standard competitor rings
ROOF_RINGS = [1, 3]
APARTMENT = "Commercial - Apartment & Condo"
DSN = "dbname=opensgid user=agrc password=agrc host=opensgid.ugrc.utah.gov port=5432"
SV_MAX_M = 400                    # past this there is no street worth opening Street View on


def xy(lon, lat):
    """Earth-centred 3D points in metres, so a KD-tree radius is a true ground distance.

    One longitude scale fixed at 39.5 N stretched 3 mile rings about 3% east to
    west at the Arizona and Idaho lines. A flat map with a cos(lat) scale per
    point still skews diagonal distances about 1% at St George and Vernal. The
    straight line between these 3D points equals the ground distance to well
    under a millimetre at ring sizes, anywhere in the state.
    """
    lon = np.radians(np.asarray(lon, dtype=float))
    lat = np.radians(np.asarray(lat, dtype=float))
    c = np.cos(lat)
    return R_EARTH * np.column_stack([c * np.cos(lon), c * np.sin(lon), np.sin(lat)])


def streetview_points(lon, lat, batch=5000):
    """(lat, lon, metres away) of the closest street point to each site.

    One PostGIS nearest-neighbour query per batch against UGRC's full road
    network (every local street, where roads.parquet only keeps arterials and
    counted roads). About 2 s per 2,000 sites. Driveways, private and proposed
    roads (cartocode 12 to 18) have no Street View imagery, and freeways and
    ramps are skipped because a car wash is entered from a street and freeway
    imagery is shot from behind a barrier.
    """
    import duckdb
    c = duckdb.connect()
    c.execute("INSTALL postgres; LOAD postgres;")
    c.execute(f"ATTACH '{DSN}' AS sgid (TYPE postgres, READ_ONLY);")
    out = [None] * len(lon)
    for b in range(0, len(lon), batch):
        vals = ",".join(f"({i},{lon[i]:.6f},{lat[i]:.6f})" for i in range(b, min(b + batch, len(lon))))
        sql = f"""
        WITH s AS (SELECT i, ST_Transform(ST_SetSRID(ST_MakePoint(x, y), 4326), 26912) AS g
                   FROM (VALUES {vals}) v(i, x, y))
        SELECT s.i, ST_Distance(n.shape, s.g),
               ST_X(ST_Transform(ST_ClosestPoint(n.shape, s.g), 4326)),
               ST_Y(ST_Transform(ST_ClosestPoint(n.shape, s.g), 4326))
        FROM s CROSS JOIN LATERAL (
          SELECT r.shape FROM transportation.roads r
          WHERE r.cartocode NOT IN ('1','12','13','14','15','16','17','18')
            AND coalesce(r.dot_fclass, '') NOT IN ('Interstate', 'Other Freeway')
            AND coalesce(r.fullname, '') NOT ILIKE '%RAMP%'
          ORDER BY r.shape <-> s.g LIMIT 1) n"""
        for i, d, x, y in c.execute(f"SELECT * FROM postgres_query(sgid, $q${sql}$q$)").fetchall():
            out[i] = (y, x, d)
    return out


def local_counts_in_reach(lon, lat, asks, batch=2000):
    """{i: metres} for the lots whose local count road passes within reach.

    roads.parquet keeps every third vertex of a simplified line, and a segment
    that simplifies to three points or fewer keeps only its first, so the
    distance to the vertex the KD-tree picked can be far more than the distance
    to the road itself. This measures to the full centre lines on Open SGID:
    any segment of the same road (same name, same count, not an interstate)
    within the lot's reach. asks: (i, road name, count, reach in metres).
    """
    import duckdb
    c = duckdb.connect()
    c.execute("INSTALL postgres; LOAD postgres;")
    c.execute(f"ATTACH '{DSN}' AS sgid (TYPE postgres, READ_ONLY);")
    text = lambda s: "NULL::text" if s is None else "'" + s.replace("'", "''") + "'"
    out = {}
    for b in range(0, len(asks), batch):
        vals = ",".join(f"({i},{lon[i]:.6f},{lat[i]:.6f},{text(nm)},{int(cnt)},{r:.1f})"
                        for i, nm, cnt, r in asks[b:b + batch])
        sql = f"""
        WITH s AS (SELECT i, nm, cnt, r, ST_Transform(ST_SetSRID(ST_MakePoint(x, y), 4326), 26912) AS g
                   FROM (VALUES {vals}) v(i, x, y, nm, cnt, r))
        SELECT s.i, min(ST_Distance(rd.shape, s.g))
        FROM s JOIN transportation.roads rd
          ON ST_DWithin(rd.shape, s.g, s.r)
         AND rd.dot_aadt = s.cnt
         AND coalesce(trim(rd.fullname), '') = coalesce(s.nm, '')
         AND coalesce(trim(rd.dot_fclass), '') <> 'Interstate'
        GROUP BY s.i"""
        for i, d in c.execute(f"SELECT * FROM postgres_query(sgid, $q${sql}$q$)").fetchall():
            out[i] = d
    return out


def plain_road(name):
    """UGRC road names for people: "HWY 89 NB" -> "Route 89", "12TH ST" -> "12th St"."""
    if not name:
        return None
    n = re.sub(r"\s+(?:NB|SB|EB|WB|FWY)\b", "", name.strip().upper())
    m = re.fullmatch(r"(?:HWY|SR|US|STATE ROUTE|HIGHWAY)[ -]?(\d+[A-Z]?)", n)
    if m:
        return f"Route {m.group(1)}"
    words = []
    for w in n.split():
        if re.fullmatch(r"[NSEW]", w):
            words.append(w)
        elif re.search(r"\d", w):
            words.append(w.lower())
        else:
            words.append(w.capitalize())
    return " ".join(words) or None


def col(t, n):
    return t.column(n).to_pylist()


def load(name):
    return pq.read_table(DATA / name)


if __name__ == "__main__":
    print("Building site factor table")
    P = load("parcels.parquet")
    print(f"  parcels in: {len(P):,}")
    # Apartment and condo complexes are taxed as commercial in some counties,
    # but a car wash cannot go on one.
    cls = col(P, "prop_class")
    keep = [i for i, c_ in enumerate(cls) if c_ != APARTMENT]
    print(f"  dropped {len(cls) - len(keep):,} apartment and condo rows")
    # County rolls repeat a parcel id once per unit, owner or building (Davis
    # repeats one 132 times), which stacked dots on one spot that all opened the
    # same record. Keep one row per (county, parcel_id): the largest by acres,
    # then by land value. A row with no parcel id cannot be matched, so it stays.
    pid_, cty_, ac_, lv_ = (col(P, k) for k in ("parcel_id", "county", "acres", "land_value"))
    best, no_id = {}, []
    for i in keep:
        key = (cty_[i], (pid_[i] or "").strip())
        if not key[1]:
            no_id.append(i)
        elif key not in best or (ac_[i] or 0, lv_[i] or 0) > (ac_[best[key]] or 0, lv_[best[key]] or 0):
            best[key] = i
    idx = sorted(no_id + list(best.values()))
    print(f"  dropped {len(keep) - len(idx):,} repeated rows for the same parcel "
          f"({len(best):,} distinct parcels, {len(no_id):,} rows with no parcel id kept)")
    # When the repeats are separate buildings, the kept row only carries one
    # building's size (a Clearfield lot with 6 buildings showed 3,900 of its
    # 20,052 sq ft). Add up the distinct buildings, ignoring exact duplicate
    # rows, and call the parcel vacant only if every row is vacant.
    sq_, yr_, vac_ = (col(P, k) for k in ("bldg_sqft", "built_yr", "is_vacant"))
    bldgs, all_vacant = {}, {}
    for i in keep:
        key = (cty_[i], (pid_[i] or "").strip())
        if not key[1]:
            continue
        if sq_[i]:
            bldgs.setdefault(key, set()).add((sq_[i], yr_[i]))
        all_vacant[key] = all_vacant.get(key, True) and bool(vac_[i])
    sqft_sum = [sum(s for s, _ in bldgs.get((cty_[i], (pid_[i] or "").strip()), ())) or (sq_[i] or 0)
                for i in idx]
    vacant = [all_vacant.get((cty_[i], (pid_[i] or "").strip()), bool(vac_[i])) for i in idx]
    P = P.take(idx)
    grew = sum(1 for i, s in zip(idx, sqft_sum) if s != (sq_[i] or 0))
    P = P.set_column(P.schema.get_field_index("bldg_sqft"), "bldg_sqft",
                     pa.array(sqft_sum, type=P.schema.field("bldg_sqft").type))
    P = P.set_column(P.schema.get_field_index("is_vacant"), "is_vacant", pa.array(vacant))
    print(f"  building size summed across separate buildings for {grew:,} parcels")
    plon = np.array(col(P, "lon")); plat = np.array(col(P, "lat"))
    pxy = xy(plon, plat)
    n = len(plon)
    print(f"  parcels: {n:,}")

    # ---- still on the county's current parcel map (check_parcels_current.py) ----
    # False only where the county's current map was checked and the id is gone.
    # A lot with no parcel id cannot be looked up and stays current.
    CUR = load("parcel_currency.parquet")
    on_map = {(c_, p_): v for c_, p_, v in
              zip(col(CUR, "county"), col(CUR, "parcel_id"), col(CUR, "in_current"))}
    keys = [(c_, (p_ or "").strip()) for c_, p_ in zip(col(P, "county"), col(P, "parcel_id"))]
    unchecked = sum(1 for k in keys if k[1] and k not in on_map)
    if unchecked:
        raise SystemExit(f"  {unchecked:,} parcel ids are not in data/parcel_currency.parquet. "
                         "Run: .venv/bin/python scripts/run_all.py currency sites")
    parcel_current = [on_map.get(k) is not False for k in keys]
    from collections import Counter
    gone = Counter(k[0] for k, v in zip(keys, parcel_current) if not v)
    print(f"  parcel map: {sum(gone.values()):,} lots whose parcel id is gone from the county's current map: "
          + ", ".join(f"{c_} {v}" for c_, v in sorted(gone.items())))

    # ---- roads: posted speed + class + local AADT (the <=45mph gate) ----
    R = load("roads.parquet")
    rpts, rmeta = [], []
    for pts, sp, fc, aa, ln, nm in zip(col(R, "pts"), col(R, "speed"), col(R, "fclass"),
                                       col(R, "aadt_local"), col(R, "lanes"), col(R, "name")):
        for (x, y) in pts:
            rpts.append((x, y)); rmeta.append((sp, fc, aa, ln, nm))
    rxy = xy([p[0] for p in rpts], [p[1] for p in rpts])
    rtree = cKDTree(rxy)
    rd, ri = rtree.query(pxy, k=1)
    road_speed = [rmeta[i][0] for i in ri]
    road_class = [rmeta[i][1] for i in ri]
    road_lanes = [rmeta[i][3] for i in ri]
    # The local traffic count never comes from an interstate: a lot beside I-15
    # cannot be entered from it, and its 60,000+ cars would swamp the score.
    local_ix = np.array([k for k, m in enumerate(rmeta) if m[1] != "Interstate"])
    ltree = cKDTree(rxy[local_ix])
    ld, li = ltree.query(pxy, k=1)
    # keep the original pick wherever the nearest road is not an interstate
    li = np.where([rmeta[i][1] != "Interstate" for i in ri], ri, local_ix[li])
    road_aadt = [rmeta[i][2] for i in li]
    road_aadt_name = [plain_road(rmeta[i][4]) for i in li]
    near_counted_interstate = [rmeta[i][1] == "Interstate" and bool(rmeta[i][2]) for i in ri]
    print(f"  roads: {len(R):,} segments -> {len(rpts):,} vertices indexed")

    # ---- Street View spot ----
    # Street View opened at the lot centre shows a black "no imagery" screen for
    # lots set back from the road, so the app opens it at the nearest street point.
    sv = streetview_points(plon, plat)
    sv_m = np.array([v[2] for v in sv])
    print(f"  street view: lot centre to nearest street, metres: "
          + ", ".join(f"p{q} {np.percentile(sv_m, q):.0f}" for q in (50, 75, 90, 95, 99))
          + f", max {sv_m.max():.0f}; {int((sv_m > SV_MAX_M).sum()):,} lots over {SV_MAX_M} m left blank")

    # ---- UDOT AADT: state-highway volume, trend, truck-discounted ----
    T = load("traffic.parquet")
    tpts, tmeta = [], []
    for pts, a, ar, g, tr, ds, inter, road in zip(
            col(T, "pts"), col(T, "aadt"), col(T, "aadt_retail"), col(T, "growth_10yr_pct"),
            col(T, "truck_share"), col(T, "desc"), col(T, "interstate"), col(T, "road")):
        for (x, y) in pts:
            tpts.append((x, y)); tmeta.append((a, ar, g, tr, ds, inter, road))
    txy = xy([p[0] for p in tpts], [p[1] for p in tpts])
    SNAP = 500 * 0.3048  # 500 ft: beyond this the segment is not this site's frontage
    # Interstate segments are never a lot's traffic (see ingest_traffic.py), so
    # the snap only looks at the rest. The old any-segment snap is kept to report
    # how many lots it had put on a freeway.
    ad, ai = cKDTree(txy).query(pxy, k=1)
    was_interstate = np.array([d <= SNAP and tmeta[i][5] for d, i in zip(ad, ai)])
    street_ix = np.array([k for k, m in enumerate(tmeta) if not m[5]])
    sd, si = cKDTree(txy[street_ix]).query(pxy, k=1)
    # Where the nearest point is already on a street segment, keep that exact
    # pick. Consecutive segments share an end point, and a second tree can
    # break that tie the other way, changing counts on lots this fix is not about.
    on_street = np.array([not tmeta[i][5] for i in ai])
    td = np.where(on_street, ad, sd)
    ti = np.where(on_street, ai, street_ix[si])
    hit = td <= SNAP
    aadt = [tmeta[i][0] if h else None for h, i in zip(hit, ti)]
    aadt_retail = [tmeta[i][1] if h else None for h, i in zip(hit, ti)]
    aadt_growth = [tmeta[i][2] if h else None for h, i in zip(hit, ti)]
    truck_share = [tmeta[i][3] if h else None for h, i in zip(hit, ti)]
    aadt_desc = [tmeta[i][4] if h else None for h, i in zip(hit, ti)]
    # A federal aid segment whose description names only cross streets has no
    # road label, so take the name of the mapped road under the counted point.
    seg_road = []
    for h, i in zip(hit, ti):
        if not h:
            seg_road.append(None)
        elif tmeta[i][6]:
            seg_road.append(tmeta[i][6])
        else:
            d_, k_ = ltree.query(txy[i], k=1)
            seg_road.append(plain_road(rmeta[local_ix[k_]][4]) if d_ <= 60 else None)
    # The local count is this lot's traffic only when its road runs beside the
    # lot: within 152 m (the 500 ft the UDOT snap allows) of the lot's edge,
    # taken as the centre plus half the lot's longest side. With no limit a Park
    # City lot (PP-25-A-3) claimed Park Ave's 39,000 cars from 807 m away.
    reach = 152 + np.array(col(P, "max_dim_ft"), dtype=float) * 0.3048 / 2
    ask = [i for i in range(n) if aadt[i] is None and road_aadt[i]]
    in_reach = local_counts_in_reach(plon, plat, [(i, rmeta[li[i]][4], road_aadt[i], reach[i]) for i in ask])
    for i in ask:
        if i not in in_reach:
            road_aadt[i] = None
            road_aadt_name[i] = None
    print(f"  traffic: {len(ask) - len(in_reach):,} of {len(ask):,} local counts dropped, the counted road "
          f"is further than 152 m plus half the lot's longest side from the lot centre")
    # fall back to local road counts where no state highway is in range
    aadt_best = [a if a is not None else (la or None) for a, la in zip(aadt, road_aadt)]
    aadt_src = ["udot" if a is not None else ("local" if la else "none")
                for a, la in zip(aadt, road_aadt)]
    aadt_road = [sr if a is not None else (nm if la else None)
                 for a, la, sr, nm in zip(aadt, road_aadt, seg_road, road_aadt_name)]
    # Clean the name here rather than only in the website, so QGIS users see
    # the same "Route 89 (Main St)" the lot panel shows, not raw UDOT segment
    # text like "700 S/northerly via 200 W" or "1000 W Clearfield".
    towns = sorted({n for n in load("cities.parquet").column("name").to_pylist() if n},
                   key=len, reverse=True)
    aadt_road = [road_label(r, towns) if r else None for r in aadt_road]
    print(f"  traffic: {sum(1 for a in aadt if a):,} parcels snapped to a UDOT segment "
          f"(<=500ft), {sum(1 for s_ in aadt_src if s_=='local'):,} using local counts")
    print(f"  traffic: {int(was_interstate.sum()):,} lots were nearest an interstate segment; now "
          f"{sum(1 for w, s_ in zip(was_interstate, aadt_src) if w and s_ == 'udot'):,} on a street segment, "
          f"{sum(1 for w, s_ in zip(was_interstate, aadt_src) if w and s_ == 'local'):,} on a local count, "
          f"{sum(1 for w, s_ in zip(was_interstate, aadt_src) if w and s_ == 'none'):,} with no count. "
          f"{sum(1 for f_, a in zip(near_counted_interstate, aadt) if f_ and a is None):,} lots with no "
          f"street segment in range sit nearest a counted interstate and take the nearest other road's count")
    print(f"  traffic: road named for {sum(1 for r_, a in zip(aadt_road, aadt_best) if r_ and a):,} "
          f"of {sum(1 for a in aadt_best if a):,} lots with a count")

    # ---- rooftops in rings ----
    # Homes = typed residential address points plus a share of the untyped ones
    # (ingest_rooftops.py lists the counties that leave the type blank). The
    # share is set per county so its home total matches the Census count of
    # housing units (ACS 2019-2023), grown by the county's population growth to
    # 2025 because address points are current. Checked against Census housing
    # units per tract, median error: Utah County 17% (33% typed points only),
    # Wasatch 26% (100%), Summit 10% (90%), fully typed counties 9% (9%).
    RF = load("rooftops.parquet")
    DM = load("demographics.parquet")
    PEP = load("county_pep.parquet")
    acs_units, acs_pop = {}, {}
    for cf, u, pp in zip(col(DM, "county_fips"), col(DM, "units_total"), col(DM, "population")):
        acs_units[cf] = acs_units.get(cf, 0) + (u or 0)
        acs_pop[cf] = acs_pop.get(cf, 0) + (pp or 0)
    pop25 = {str(f)[-3:]: pp for f, pp in zip(col(PEP, "fips"), col(PEP, "pop_2025"))}
    rf_cty, rf_res, rf_unt = col(RF, "county_fips"), col(RF, "n_res"), col(RF, "n_untyped")
    typed, untyped = {}, {}
    for cf, r_, u_ in zip(rf_cty, rf_res, rf_unt):
        typed[cf] = typed.get(cf, 0) + r_
        untyped[cf] = untyped.get(cf, 0) + u_
    # A county whose typed points already reach 90% of that total types its
    # homes properly, and its few untyped points gather around shops and offices
    # (a third of the typed count within a mile of some Salt Lake lots), so
    # there they stay uncounted rather than inflate homes beside commercial land.
    share = {}
    for cf, u_ in untyped.items():
        target = acs_units.get(cf, 0) * (pop25[cf] / acs_pop[cf] if acs_pop.get(cf) and cf in pop25 else 1)
        share[cf] = (min(1.0, (target - typed[cf]) / u_)
                     if u_ and typed[cf] < 0.9 * target else 0.0)
    print("  rooftops: share of untyped address points counted as homes: "
          + ", ".join(f"{cf} {share[cf]:.2f}" for cf in sorted(share) if share[cf] > 0))
    fxy = xy(col(RF, "lon"), col(RF, "lat"))
    fres = np.array([r_ + share.get(cf, 0.0) * u_ for cf, r_, u_ in zip(rf_cty, rf_res, rf_unt)])
    ftree = cKDTree(fxy)
    roof = {}
    for mi in ROOF_RINGS:
        idx = ftree.query_ball_point(pxy, mi * MI)
        roof[f"rooftops_{mi}mi"] = [int(round(fres[i].sum())) if len(i) else 0 for i in idx]
    print(f"  rooftops: ringed over {len(RF):,} grid cells")

    # Homes across the state line are not in Utah's address points, so a ring
    # that reaches well into Nevada, Arizona, Idaho, Wyoming or Colorado
    # undercounts (West Wendover and Colorado City sit right on the line). Where
    # more than a quarter of the 3 mile ring is outside Utah the count is not known.
    import shapely, shapely.affinity
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    CB = load("counties_geom.parquet")
    utah = Polygon(unary_union([Polygon(r).buffer(0) for r in col(CB, "ring") if len(r) >= 4]).exterior)
    r3 = 3 * MI / (R_EARTH * math.pi / 180)          # 3 miles in degrees of latitude
    kx = np.cos(np.radians(plat))
    outside = np.zeros(n)
    near = shapely.distance(shapely.points(plon, plat), utah.exterior) < r3 / kx
    for i in np.flatnonzero(near):
        ring = shapely.affinity.scale(shapely.Point(plon[i], plat[i]).buffer(1, 32), r3 / kx[i], r3)
        outside[i] = 1 - ring.intersection(utah).area / ring.area
    rooftops_known = outside <= 0.25
    print(f"  rooftops: {int((~rooftops_known).sum()):,} lots with over a quarter of the "
          f"3 mile ring outside Utah, home count marked not known")

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

    # ---- city growth: incorporated place attached by point-in-polygon ----
    # Tract figures are ACS 2019-2023 averages and county growth blurs fast and
    # flat cities together, so each site also carries its own city's 2020 to
    # 2025 Census growth. No city means unincorporated county land.
    import shapely, shapely.affinity
    CT = load("cities.parquet")
    city_name, city_pop, city_growth = col(CT, "name"), col(CT, "pop_2025"), col(CT, "growth_pct")
    hit = STRtree(shapely.from_wkt(col(CT, "wkt"))).query(pts, predicate="within")
    parcel_city = [None] * n
    for qi, gi in zip(hit[0], hit[1]):
        # UGRC boundaries overlap by slivers in a few places (North Salt Lake
        # and Salt Lake City). The lowest row wins (cities.parquet is sorted by
        # FIPS) so reruns never flip a site between cities.
        if parcel_city[qi] is None or gi < parcel_city[qi]:
            parcel_city[qi] = gi
    in_city = sum(1 for c_ in parcel_city if c_ is not None)
    no_est = sum(1 for c_ in parcel_city if c_ is not None and city_pop[c_] is None)
    print(f"  cities: {in_city:,}/{n:,} parcels inside an incorporated city "
          f"({in_city/n*100:.1f}%), {no_est:,} of them in a city too new for a Census estimate, "
          f"{len(hit[0]) - in_city:,} extra overlap hits")

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
    # Per 1,000 residents (Census July 2025), so a small fast county is not
    # read as quiet next to Salt Lake's raw total.
    pop_by_county = dict(zip(col(PEP, "county"), col(PEP, "pop_2025")))
    permits_per_1k = {c: round(v / pop_by_county[c] * 1000, 1)
                      for c, v in permits.items() if pop_by_county.get(c)}

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
           "price_per_acre", "prop_class", "bldg_sqft", "is_vacant", "improvement_value",
           "max_dim_ft", "min_dim_ft", "assessor_url", "serial")}
    # The assessor_url in UGRC is only each county's homepage, and several are
    # dead. parcel_links resolves a link to this parcel's own record where the
    # county publishes one, else the state parcel map centred on the lot.
    links = [parcel_url(P_["county"][i], P_["parcel_id"][i], P_["serial"][i],
                        float(plat[i]), float(plon[i])) for i in range(n)]
    from collections import Counter
    print("  parcel links: " + ", ".join(f"{k} {v:,}" for k, v in
          Counter(k or "none" for _, k, _ in links).most_common()))
    out = []
    for i in range(n):
        cty = P_["county"][i]
        out.append({
            # County assessors reuse parcel ids (Davis repeats one id 133
            # times), so parcel_id cannot identify a row. uid is the stable
            # key used for selection and isochrone lookup.
            "uid": str(i),
            "parcel_id": P_["parcel_id"][i],
            # false: the county has split, merged or renumbered this parcel
            # since the tax roll, so the lot may not exist as described
            "parcel_current": parcel_current[i],
            "address": P_["address"][i], "city": P_["city"][i], "county": cty,
            "lat": float(plat[i]), "lon": float(plon[i]),
            "acres": P_["acres"][i],
            "land_value": P_["land_value"][i],
            "price_per_acre": P_["price_per_acre"][i],
            "prop_class": P_["prop_class"][i],
            "bldg_sqft": P_["bldg_sqft"][i],
            # total minus land; no building on record AND a small value here
            # is what is_vacant means (ingest_parcels.py)
            "improvement_value": P_["improvement_value"][i],
            "is_vacant": P_["is_vacant"][i],
            "max_dim_ft": P_["max_dim_ft"][i],
            "min_dim_ft": P_["min_dim_ft"][i],
            "assessor_url": LINKS.get(cty, {}).get("home") or P_["assessor_url"][i],
            "parcel_url": links[i][0],
            "parcel_url_kind": links[i][1],
            "parcel_url_label": links[i][2],
            "road_speed": road_speed[i], "road_class": road_class[i],
            "road_lanes": road_lanes[i],
            "aadt": aadt_best[i], "aadt_source": aadt_src[i],
            "aadt_retail": aadt_retail[i], "aadt_growth_pct": aadt_growth[i],
            "truck_share": truck_share[i], "aadt_desc": aadt_desc[i],
            "aadt_road": aadt_road[i],
            "rooftops_1mi": roof["rooftops_1mi"][i],
            "rooftops_3mi": roof["rooftops_3mi"][i],
            "rooftops_known": bool(rooftops_known[i]),
            "sv_lat": round(sv[i][0], 6) if sv[i] and sv[i][2] <= SV_MAX_M else None,
            "sv_lon": round(sv[i][1], 6) if sv[i] and sv[i][2] <= SV_MAX_M else None,
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
            "county_permits_per_1k": permits_per_1k.get(cty),
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
            "city_name": city_name[parcel_city[i]] if parcel_city[i] is not None else None,
            "city_pop_2025": city_pop[parcel_city[i]] if parcel_city[i] is not None else None,
            "city_growth_pct": city_growth[parcel_city[i]] if parcel_city[i] is not None else None,
        })

    # One row per parcel since the duplicate and apartment filters (was 45,140 rows).
    # Was 28,948. 2026-09-17: ingest_parcels.py now leaves out Salt Lake tax
    # exempt land (2,134 lots) and apartment complexes marked as homes (Davis 81,
    # Weber 11, Washington 9, Iron 2, Daggett 2, Morgan 1), and Summit gained 205
    # vacant lots once its swapped land value was read correctly: 26,913.
    assert_count("scored candidate sites", len(out), 26913)
    pq.write_table(pa.Table.from_pylist(out), DATA / "sites.parquet", compression="zstd")
    print(f"  wrote data/sites.parquet  {(DATA/'sites.parquet').stat().st_size/1e6:.1f} MB")
