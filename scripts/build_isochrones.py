"""Drive-time isochrones from Utah's own road network.

DRB's site-selection guidance is explicit that a 10-minute drive time beats a
3-5 mile ring, because rings ignore what the road network does: a freeway pulls
customers from far away, and a canyon or a lake leaves half a ring empty.

Method: build a routable graph from UGRC road centrelines weighted by each
segment's posted speed limit, run Dijkstra from each candidate site, and take a
concave hull of everything reachable inside the time budget. No routing API and
no key.

These are free-flow times from posted limits with a factor for intersections
and turns, not congested times. That caveat is stated in the UI.
"""
import sys, math, pathlib, json
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import duckdb, numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree
from shapely.geometry import MultiPoint, mapping
from shapely import concave_hull
import pyarrow.parquet as pq
from common import DATA, ROOT

DSN = "dbname=opensgid user=agrc password=agrc host=opensgid.ugrc.utah.gov port=5432"
SNAP = 1e-5                    # ~1 m, for welding shared segment endpoints
MINUTES = [5, 10]
SPEED_FACTOR = 0.75            # posted limit -> realistic door-to-door average
THIN_MI = 0.4                  # spacing of the origins we precompute
MI_PER_DEG = 69.055

ROADS_SQL = """
SELECT speed_lmt,
       ST_AsText(ST_Simplify(ST_Transform(shape,4326), 0.00008)) AS wkt
FROM transportation.roads
WHERE speed_lmt > 0
  AND cartocode NOT IN ('12','13','14','15','16','17','18')
  AND shape IS NOT NULL
"""


def parse_lines(wkt):
    """Yield vertex lists from LINESTRING / MULTILINESTRING WKT."""
    if not wkt:
        return
    body = wkt[wkt.index("(") :]
    depth_parts = body.replace("((", "(").replace("))", ")").split("),(")
    for part in depth_parts:
        pts = []
        for chunk in part.replace("(", "").replace(")", "").split(","):
            xy = chunk.split()
            if len(xy) >= 2:
                try:
                    pts.append((float(xy[0]), float(xy[1])))
                except ValueError:
                    pass
        if len(pts) >= 2:
            yield pts


def build_graph():
    c = duckdb.connect()
    c.execute("INSTALL postgres; LOAD postgres;")
    c.execute(f"ATTACH '{DSN}' AS sgid (TYPE postgres, READ_ONLY);")
    print("  pulling road centrelines ...", end="", flush=True)
    rows = c.execute(f"SELECT * FROM postgres_query(sgid, $q${ROADS_SQL}$q$)").fetchall()
    print(f" {len(rows):,} segments")

    node_id, coords = {}, []
    src, dst, cost = [], [], []

    def nid(pt):
        key = (round(pt[0] / SNAP), round(pt[1] / SNAP))
        i = node_id.get(key)
        if i is None:
            i = len(coords)
            node_id[key] = i
            coords.append(pt)
        return i

    for speed, wkt in rows:
        mps = max(float(speed), 5.0) * SPEED_FACTOR * 0.44704   # mph -> m/s
        for pts in parse_lines(wkt):
            prev = nid(pts[0])
            plon, plat = pts[0]
            for lon, lat in pts[1:]:
                cur = nid((lon, lat))
                if cur != prev:
                    dy = (lat - plat) * 111_320.0
                    dx = (lon - plon) * 111_320.0 * math.cos(math.radians(lat))
                    d = math.hypot(dx, dy)
                    if d > 0:
                        t = d / mps
                        src.append(prev); dst.append(cur); cost.append(t)
                        src.append(cur); dst.append(prev); cost.append(t)
                prev, plon, plat = cur, lon, lat

    n = len(coords)
    g = coo_matrix((cost, (src, dst)), shape=(n, n)).tocsr()
    xy = np.array(coords)
    print(f"  graph: {n:,} nodes, {len(cost):,} directed edges")
    return g, xy


def pick_sites():
    """Gate-passing parcels, thinned geometrically so coverage is even.

    Selection is geometric rather than score-based on purpose: the authoritative
    score lives in the browser and changes with the user's weights, so choosing
    by score here would bake in one particular weighting.
    """
    t = pq.read_table(DATA / "sites.parquet")
    col = lambda k: t.column(k).to_pylist()
    lat, lon = np.array(col("lat")), np.array(col("lon"))
    ok = np.array([
        (a >= 0.75) and (d >= 225) and (not f) and (sp is None or sp <= 45)
        and (ad or 0) >= 15000 and vf == "ok"
        for a, d, f, sp, ad, vf in zip(col("acres"), col("max_dim_ft"),
                                       col("in_flood_zone"), col("road_speed"),
                                       col("aadt"), col("value_flag"))])
    idx = np.flatnonzero(ok)
    print(f"  parcels passing default gates: {len(idx):,}")

    cell = THIN_MI / MI_PER_DEG
    grid, kept = {}, []
    for i in idx:
        gy, gx = int(lat[i] / cell), int(lon[i] / cell)
        clash = False
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for j in grid.get((gy + dy, gx + dx), ()):
                    my = (lat[i] - lat[j]) * MI_PER_DEG
                    mx = (lon[i] - lon[j]) * MI_PER_DEG * math.cos(math.radians(lat[i]))
                    if math.hypot(mx, my) < THIN_MI:
                        clash = True; break
                if clash: break
            if clash: break
        if not clash:
            kept.append(i)
            grid.setdefault((gy, gx), []).append(i)
    print(f"  thinned to {len(kept):,} origins at {THIN_MI} mi spacing")
    return kept, np.array(col("uid")), lat, lon, idx


if __name__ == "__main__":
    print("Isochrones: routable graph from UGRC centrelines")
    g, xy = build_graph()
    kept, pids, lat, lon, gated = pick_sites()

    tree = cKDTree(np.column_stack([xy[:, 0] * 111_320.0 * math.cos(math.radians(39.5)),
                                    xy[:, 1] * 111_320.0]))
    site_xy = np.column_stack([lon[kept] * 111_320.0 * math.cos(math.radians(39.5)),
                               lat[kept] * 111_320.0])
    dist_to_road, start_node = tree.query(site_xy, k=1)

    limit = max(MINUTES) * 60.0
    feats, skipped = [], 0
    _skipped_idx = set()
    for k, (src_node, snap_m) in enumerate(zip(start_node, dist_to_road)):
        if snap_m > 400:                      # no drivable road near this parcel
            skipped += 1
            _skipped_idx.add(k)
            continue
        d = dijkstra(g, indices=int(src_node), limit=limit)
        polys = {}
        for mins in MINUTES:
            reach = np.flatnonzero(d <= mins * 60.0)
            if len(reach) < 12:
                continue
            hull = concave_hull(MultiPoint([tuple(p) for p in xy[reach]]), ratio=0.28)
            if hull.is_empty or hull.geom_type not in ("Polygon", "MultiPolygon"):
                continue
            polys[mins] = hull
        for mins, hull in polys.items():
            feats.append({
                "type": "Feature",
                "geometry": mapping(hull.simplify(0.0004)),
                "properties": {"uid": pids[kept[k]], "minutes": mins},
            })
        if (k + 1) % 50 == 0:
            sys.stderr.write(f"\r  isochrones: {k+1}/{len(kept)}")
            sys.stderr.flush()
    sys.stderr.write("\n")

    # Every gate-passing parcel is mapped to its nearest computed origin, so
    # selecting any ranked site resolves to an isochrone. The offset is carried
    # through and shown in the UI, because a drive-time polygon drawn from a
    # point 300 m away should say so rather than imply it was computed here.
    done = {pids[kept[k]] for k in range(len(kept))
            if k not in _skipped_idx}
    origin_idx = [kept[k] for k in range(len(kept)) if k not in _skipped_idx]
    if origin_idx:
        o_xy = np.column_stack([
            lon[origin_idx] * 111_320.0 * math.cos(math.radians(39.5)),
            lat[origin_idx] * 111_320.0])
        o_tree = cKDTree(o_xy)
        g_xy = np.column_stack([
            lon[gated] * 111_320.0 * math.cos(math.radians(39.5)),
            lat[gated] * 111_320.0])
        dm, im = o_tree.query(g_xy, k=1)
        assign = {}
        for j, gi in enumerate(gated):
            assign[str(pids[gi])] = [str(pids[origin_idx[im[j]]]),
                                     round(float(dm[j]) / 1609.34, 2)]
    else:
        assign = {}

    out = ROOT / "app" / "public" / "data" / "isochrones.json"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": feats,
                               "assign": assign}))
    mb = out.stat().st_size / 1e6
    print(f"  wrote {out.relative_to(ROOT)}  {len(feats):,} polygons  {mb:.2f} MB")
    print(f"  origins with isochrones: {len(feats)//len(MINUTES):,}  "
          f"(skipped {skipped} with no road within 400 m)")
    if assign:
        offs = sorted(v[1] for v in assign.values())
        print(f"  every gate-passing parcel mapped to an origin: {len(assign):,}")
        print(f"  offset median {offs[len(offs)//2]:.2f} mi, p90 {offs[9*len(offs)//10]:.2f} mi, max {offs[-1]:.2f} mi")
