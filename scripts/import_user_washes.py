"""Your own car wash points, exported from QGIS, as an input to the merge.

Reads every .gpkg, .geojson and .csv in data/user/ and writes data/raw_user.json
in the same row shape fetch_osm.py produces, tagged src='user', so
merge_competition.py dedupes these points against OSM and Overture like any
other source. A CSV needs name, lat and lon columns; format, website, phone,
address and notes are optional in every file type.

These points may have been copied from Google Maps, which is not
redistributable, and the repo is public. merge_competition.py keeps them out
of the published car wash file unless data/user/PUBLISH_OK exists.
"""
import sys, csv, json, re, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import duckdb
from common import DATA
from formats import LABEL, UNKNOWN, EXPRESS, FLEX, IBA, SELF, HAND, TRUCK
from population_in_shape import lonlat_sql

USER = DATA / "user"
OPTIONAL = ("format", "website", "phone", "address", "notes")
LAT = ("lat", "latitude", "y")
LON = ("lon", "lng", "long", "longitude", "x")

# Free text a person might type in a format column. A value that matches more
# than one format ("self serve and automatic") is not obvious, so it is left
# for the classifier in formats.py.
FORMAT_WORDS = [
    (TRUCK,   r"\btruck|\bsemi\b"),
    (SELF,    r"self[\s-]*serv|coin|\bwand|\bdiy\b|do[\s-]*it[\s-]*yourself"),
    (HAND,    r"\bhand\b|detail"),
    (FLEX,    r"\bflex|full[\s-]*serv"),
    (EXPRESS, r"express|tunnel|conveyor"),
    (IBA,     r"in[\s-]*bay|\biba\b|automatic|touch[\s-]*less|touch[\s-]*free|soft[\s-]*touch|roll[\s-]*over"),
]


def map_format(text):
    t = (text or "").strip().lower()
    if not t:
        return None
    for code, label in LABEL.items():
        if code != UNKNOWN and t in (code, label.lower()):
            return code
    hits = {fmt for fmt, rx in FORMAT_WORDS if re.search(rx, t)}
    if FLEX in hits:                 # a full-serve site is also a tunnel
        hits.discard(EXPRESS)
    return hits.pop() if len(hits) == 1 else None


def pick(row, names):
    """Case-insensitive column lookup; blank cells count as missing."""
    low = {str(k).strip().lower(): v for k, v in row.items()}
    for n in names:
        v = low.get(n)
        if v is not None and str(v).strip() != "":
            return str(v).strip()
    return None


# Excel on Windows saves CSV as cp1252 and older Mac apps as Mac Roman, so a
# name like "Café" is not UTF-8. utf-8-sig first also drops Excel's BOM.
ENCODINGS = ("utf-8-sig", "cp1252", "mac_roman")


def read_csv(path):
    """All rows as (attributes, lat, lon), read with the first encoding that fits."""
    for enc in ENCODINGS:
        try:
            with open(path, newline="", encoding=enc) as fh:
                rows = list(csv.DictReader(fh))
            break
        except UnicodeDecodeError:
            continue
    else:
        raise UnicodeDecodeError("csv", b"", 0, 1, "not UTF-8, Windows or Mac text")
    out = []
    for r in rows:
        try:
            lat, lon = float(pick(r, LAT)), float(pick(r, LON))
        except (TypeError, ValueError):
            lat = lon = None
        out.append((r, lat, lon))
    return out


def read_layers(con, path):
    """Every layer in a GeoPackage or GeoJSON, as (attributes, lat, lon)."""
    # ST_Read_Meta crashes the whole process on a damaged file (DuckDB 1.5.5),
    # where ST_Read raises an error this script can catch and skip.
    con.execute("SELECT 1 FROM ST_Read(?) LIMIT 1", [str(path)])
    for layer in con.execute("SELECT unnest(layers) FROM ST_Read_Meta(?)", [str(path)]).fetchall():
        layer = layer[0]
        geom = lonlat_sql(layer, path)
        cur = con.execute(f"""
          SELECT * EXCLUDE (geom), ST_Y(ST_PointOnSurface({geom})) AS _lat,
                 ST_X(ST_PointOnSurface({geom})) AS _lon
          FROM ST_Read(?, layer := ?)""", [str(path), layer["name"]])
        cols = [c[0] for c in cur.description]
        for vals in cur.fetchall():
            r = dict(zip(cols, vals))
            yield r, r.pop("_lat"), r.pop("_lon")


def main():
    USER.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in USER.iterdir() if p.suffix.lower() in (".gpkg", ".geojson", ".csv"))
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    rows, skipped = [], 0
    for path in files:
        try:
            src = read_csv(path) if path.suffix.lower() == ".csv" else list(read_layers(con, path))
        except Exception:
            print(f"  {path.name}: skipped, this file could not be read. Save it again from QGIS or Excel, then run this again.")
            continue
        n = 0
        for i, (r, lat, lon) in enumerate(src):
            # Utah bounds, same as the gmaps loader. A point outside is almost
            # always swapped lat/lon or an unexpected CRS.
            if lat is None or lon is None or not (36.9 < lat < 42.1 and -114.1 < lon < -109.0):
                skipped += 1
                continue
            extra = {k: pick(r, (k,)) for k in OPTIONAL}
            rows.append({
                "src": "user", "src_id": f"{path.name}#{i + 1}",
                "name": pick(r, ("name",)),
                "brand": None, "operator": None,
                "lat": round(lat, 6), "lon": round(lon, 6),
                "address": extra["address"], "city": None,
                "website": extra["website"], "phone": extra["phone"],
                "opening_hours": None, "parcel_id": None,
                "tags": {},
                "postcode": None, "brand_wikidata": None, "checked": None,
                "osm_id": None, "overture_id": None,
                "confidence": None, "socials": None,
                "rating": None, "reviews": None, "place_category": None,
                "user_format": map_format(extra["format"]),
                "user_format_text": extra["format"],
                "notes": extra["notes"],
            })
            n += 1
        print(f"  {path.name}: {n} car washes")

    (DATA / "raw_user.json").write_text(json.dumps(rows))
    print(f"Your car washes: {len(rows)} from {len(files)} file(s) in data/user/ -> data/raw_user.json")
    if skipped:
        print(f"  skipped {skipped} row(s) with no location inside Utah. Check the lat and lon columns.")
    typed = sum(1 for r in rows if r["user_format"])
    print(f"  format understood for {typed}; the rest are classified from the name")
    print("  published on the website: "
          + ("yes, data/user/PUBLISH_OK exists" if (USER / "PUBLISH_OK").exists()
             else "no (add an empty file named PUBLISH_OK in data/user/ to allow it)"))


if __name__ == "__main__":
    main()
