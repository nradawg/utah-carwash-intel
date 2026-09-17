"""Merge car wash POIs from OSM + Overture + Google Maps sweep.

Three sources disagree, overlap, and have different licences, so this:
  1. clusters by proximity + name similarity to dedupe,
  2. merges attributes with a source priority per field,
  3. classifies format with explicit provenance,
  4. records which sources contributed, so the licence story stays traceable.

Google-derived fields stay flagged (`has_google`) so the published build can
exclude them; OSM is ODbL and Overture is CDLA/Apache. The friend's own survey
points (src 'user', from data/raw_user.json) win every attribute but are held
out of the published file the same way unless data/user/PUBLISH_OK exists.
"""
import sys, json, csv, math, re, pathlib, urllib.parse
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import pyarrow as pa, pyarrow.parquet as pq
from common import DATA, ROOT
from formats import classify, LABEL, UNKNOWN, HAND as HAND_FMT

MERGE_M = 70          # two points closer than this are the same business
GMAPS_CSV = DATA / "local" / "gmaps-carwash-ut.csv"
# The friend's own points (scripts/import_user_washes.py). They may have been
# copied from Google Maps, so they stay out of the published file unless he
# says otherwise by creating data/user/PUBLISH_OK.
USER_JSON = DATA / "raw_user.json"
USER_PUBLISH_OK = DATA / "user" / "PUBLISH_OK"

# Google categories that are actually car washes (the sweep also returns noise)
CAT_OK = re.compile(r"car wash|self service car wash|auto detail|car detail|"
                    r"truck wash|detailing service", re.I)
CAT_NO = re.compile(r"auto repair|oil change|tire|body shop|dealer|"
                    r"gas station|convenience store|laundr", re.I)


def load_raw(path):
    """Raw source rows, with the category key under its current name.

    Older raw files (and data/raw_user.json from import_user_washes.py) still
    say google_category, although the value came from Overture or was empty.
    """
    rows = json.loads(path.read_text()) if path.exists() else []
    for r in rows:
        if "google_category" in r:
            r["place_category"] = r.pop("google_category")
    return rows


def clean_url(u):
    """Drop utm_ tracking parameters. They say which ad or listing sent the
    click (one read utm_source=Google Maps), which is noise on a public map."""
    if not u or "utm_" not in u:
        return u
    parts = urllib.parse.urlsplit(u)
    q = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
         if not k.lower().startswith("utm_")]
    return urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(q)))


def norm_name(n):
    n = (n or "").lower()
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    n = re.sub(r"\b(the|a|of|and|car|wash|carwash|llc|inc|co|ut|utah)\b", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def load_gmaps():
    if not GMAPS_CSV.exists():
        return []
    rows = []
    csv.field_size_limit(10_000_000)
    with open(GMAPS_CSV, newline="", encoding="utf-8", errors="replace") as fh:
        for r in csv.DictReader(fh):
            cat = r.get("category") or ""
            if CAT_NO.search(cat) and not CAT_OK.search(cat):
                continue
            if not CAT_OK.search(cat) and not CAT_OK.search(r.get("title") or ""):
                continue
            try:
                lat, lon = float(r["latitude"]), float(r["longitude"])
            except (ValueError, KeyError, TypeError):
                continue
            if not (36.9 < lat < 42.1 and -114.1 < lon < -109.0):
                continue
            def i(k):
                try: return int(float(r.get(k) or 0))
                except ValueError: return 0
            def f(k):
                try: return float(r.get(k) or 0) or None
                except ValueError: return None
            rows.append({
                "src": "gmaps", "src_id": r.get("place_id") or r.get("cid"),
                "name": (r.get("title") or "").strip() or None,
                "brand": None, "operator": None, "lat": lat, "lon": lon,
                "address": (r.get("address") or "").strip() or None,
                "city": None, "website": r.get("website") or None,
                "phone": r.get("phone") or None,
                "opening_hours": r.get("open_hours") or None, "parcel_id": None,
                "tags": {}, "rating": f("review_rating"), "reviews": i("review_count"),
                # Same key as Overture's category so the classifier reads both.
                "place_category": cat.strip().lower() or None,
            })
    return rows


def cluster(rows):
    """Grid-bucket then link points within MERGE_M that plausibly match."""
    deg = MERGE_M / 111_320.0
    buckets = {}
    for i, r in enumerate(rows):
        key = (int(r["lat"] / deg), int(r["lon"] / deg))
        buckets.setdefault(key, []).append(i)

    parent = list(range(len(rows)))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb: parent[max(ra, rb)] = min(ra, rb)

    for (gy, gx), idxs in buckets.items():
        near = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                near.extend(buckets.get((gy + dy, gx + dx), []))
        for i in idxs:
            a = rows[i]
            for j in near:
                if j <= i: continue
                b = rows[j]
                dy_m = (a["lat"] - b["lat"]) * 111_320
                dx_m = (a["lon"] - b["lon"]) * 111_320 * math.cos(math.radians(a["lat"]))
                if math.hypot(dx_m, dy_m) > MERGE_M:
                    continue
                na, nb = norm_name(a["name"]), norm_name(b["name"])
                # same spot: merge unless both are named and the names clearly differ
                if na and nb and na != nb and na not in nb and nb not in na:
                    continue
                union(i, j)
    groups = {}
    for i in range(len(rows)):
        groups.setdefault(find(i), []).append(rows[i])
    return list(groups.values())


# A point someone checked in person beats every dataset.
PRIORITY = {"user": 4, "gmaps": 3, "overture": 2, "osm": 1}


def merge_group(g):
    g = sorted(g, key=lambda r: -PRIORITY.get(r["src"], 0))
    best = g[0]
    def pick(field):
        for r in g:
            if r.get(field):
                return r[field]
        return None
    tags = {}
    for r in g:
        tags.update(r.get("tags") or {})
    srcs = sorted({r["src"] for r in g})
    nm = (pick("name") or "").lower()
    user_fmt = next((r for r in g if r.get("user_format")), None)
    if user_fmt:
        fmt, conf, fsrc, ev = (user_fmt["user_format"], 0.95, "user",
                               f"your own survey: {user_fmt['user_format_text']}")
    else:
        fmt, conf, fsrc, ev = classify(
            name=pick("name"), tags=tags,
            place_category=pick("place_category"),
            brand=pick("brand"), operator=pick("operator"))
    # A detailing shop is not competition for an express tunnel. Mobile
    # detailers have no fixed premises at all. Keep them (they signal car-care
    # demand) but exclude them from competitor counts by default.
    is_mobile = bool(re.search(r"\bmobile\b|\bon[\s-]?site\b|\bcomes to you\b", nm))
    facility = "detailer" if fmt == HAND_FMT else "wash"
    # Contributing datasets, for the "confirmed by" line in the UI. OSM and
    # Overture are independent surveys, so a place present in both is far more
    # trustworthy than one seen once.
    datasets = set()
    for r in g:
        if r["src"] == "osm":
            datasets.add("OpenStreetMap")
        elif r["src"] == "overture":
            for d in (r.get("datasets") or []):
                datasets.add(f"Overture/{d}")
            if not r.get("datasets"):
                datasets.add("Overture")
        elif r["src"] == "user":
            datasets.add("Your own survey")

    socials = []
    for r in g:
        for u in (r.get("socials") or []):
            if u and u not in socials:
                socials.append(u)

    return {
        "name": pick("name"), "lat": round(best["lat"], 6), "lon": round(best["lon"], 6),
        "address": pick("address"), "city": pick("city"), "postcode": pick("postcode"),
        "brand": pick("brand"), "brand_wikidata": pick("brand_wikidata"),
        "website": clean_url(pick("website")), "phone": pick("phone"),
        "opening_hours": pick("opening_hours"),
        "socials": ",".join(socials[:3]) or None,
        "osm_id": pick("osm_id"), "overture_id": pick("overture_id"),
        "confirmed_by": ", ".join(sorted(datasets)) or None,
        "last_checked": pick("checked"),
        "amenities": ",".join(sorted(
            k for k, v in tags.items()
            if k in ("vacuum_cleaner", "dog_washing", "drive_through",
                     "payment:credit_cards", "self_service:vacuum")
            and str(v).lower() in ("yes", "only", "customer"))) or None,
        "rating": pick("rating"), "reviews": pick("reviews"),
        "format": fmt, "format_label": LABEL[fmt],
        "format_confidence": conf, "format_source": fsrc, "format_evidence": ev,
        "facility_class": facility,
        "is_mobile": is_mobile,
        "is_competitor": facility == "wash" and not is_mobile,
        "sources": ",".join(srcs), "n_sources": len(srcs),
        "has_google": "gmaps" in srcs,
        "parcel_id": pick("parcel_id"),
    }


if __name__ == "__main__":
    osm = load_raw(DATA / "raw_osm.json")
    ovt = load_raw(DATA / "raw_overture.json")
    gm = load_gmaps()
    usr = load_raw(USER_JSON)
    print(f"inputs: osm={len(osm)}  overture={len(ovt)}  gmaps={len(gm)}  user={len(usr)}")

    # Unnamed single-source points are usually noise, but a point the friend
    # placed himself is a real wash whether or not he typed a name.
    def keep(m):
        return m["name"] or m["n_sources"] > 1 or "user" in m["sources"].split(",")

    groups = cluster(osm + ovt + gm + usr)
    merged = [merge_group(g) for g in groups]
    merged = [m for m in merged if keep(m)]
    print(f"  deduped -> {len(merged):,} distinct car washes")

    pq.write_table(pa.Table.from_pylist(merged), DATA / "carwashes.parquet", compression="zstd")

    # Publishable variant: clustered again from the open-licensed rows alone.
    # Re-merging each cluster of the full run was not enough: a Google point
    # between an OSM and an Overture record linked them into one cluster, so
    # the private sweep still decided which open records merged (447 published
    # washes with the sweep file present, 453 from the open sources alone,
    # 2026-09-17). Built from OSM and Overture
    # only, plus the friend's own points when data/user/PUBLISH_OK exists, the
    # published file is the same whether or not the sweep file is on disk.
    publish_user = USER_PUBLISH_OK.exists()
    open_input = osm + ovt + (usr if publish_user else [])
    open_rows = [m for m in (merge_group(g) for g in cluster(open_input)) if keep(m)]
    # Drop the Google-only columns outright. They are always empty here, but an
    # empty "rating" column in a public file still reads like a leak.
    for m in open_rows:
        for k in ("rating", "reviews", "has_google"):
            m.pop(k, None)
    pq.write_table(pa.Table.from_pylist(open_rows), DATA / "carwashes_open.parquet",
                   compression="zstd")
    print(f"\n  open-licensed variant: {len(open_rows):,} records "
          f"({sum(1 for m in open_rows if m['is_competitor']):,} wash facilities), "
          "attributes sourced only from OSM and Overture"
          + (" plus your own survey (data/user/PUBLISH_OK is set)" if publish_user else ""))
    if usr and not publish_user:
        print(f"  your own survey: {len(usr)} points used locally, kept out of the published file")
    from collections import Counter
    fc = Counter(m["format"] for m in merged)
    sc = Counter(m["format_source"] for m in merged)
    print("  by format:")
    for k, n in fc.most_common():
        print(f"    {LABEL[k]:<22} {n:>4}  ({n/len(merged)*100:.0f}%)")
    print(f"  classification source: {dict(sc)}")
    comp = [m for m in merged if m["is_competitor"]]
    det = [m for m in merged if m["facility_class"] == "detailer"]
    print(f"  multi-source confirmed: {sum(1 for m in merged if m['n_sources']>1):,}"
          f"  |  google-only: {sum(1 for m in merged if m['sources']=='gmaps'):,}")
    print(f"\n  WASH FACILITIES (counted as competition): {len(comp):,}")
    cf = Counter(m["format"] for m in comp)
    for k, n in cf.most_common():
        print(f"    {LABEL[k]:<22} {n:>4}  ({n/len(comp)*100:.0f}%)")
    print(f"  detailers held separately: {len(det):,} "
          f"({sum(1 for m in det if m['is_mobile'])} mobile)")
