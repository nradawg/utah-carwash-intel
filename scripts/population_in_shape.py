"""How many people live inside an area, and how much that grew from 2010 to 2020.

Counts census blocks, the smallest unit the Census publishes, from the two
decennial counts. Block group or tract figures cannot answer this: their
boundaries were redrawn for 2020, so ACS numbers from before and after do not
cover the same ground. Blocks are small enough that counting each one by a
point inside it gives a fair total for any shape drawn over a town. UGRC
address point LoadDate looks like a build date but is a reload timestamp, so it
says nothing about growth either.

Checked 2026-09-17: Tooele city plus a 1 mile buffer = 32,511 people (2010)
and 37,093 (2020).

Usage:
  .venv/bin/python scripts/population_in_shape.py --city "Tooele" --buffer-mi 1
  .venv/bin/python scripts/population_in_shape.py --shape my_area.gpkg --write my_area_pop.gpkg
"""
import sys, argparse, json, pathlib, urllib.parse, urllib.request
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import duckdb
from common import get_json, DATA, UGRC, UA

MUNI = f"{UGRC}/UtahMunicipalBoundaries/FeatureServer/0"
TIGER = "https://www2.census.gov/geo/tiger"
BLOCKS = {  # year: (url, shapefile name inside the zip, population, housing units)
    2010: (f"{TIGER}/TIGER2010BLKPOPHU/tabblock2010_49_pophu.zip",
           "tabblock2010_49_pophu", "POP10", "HOUSING10"),
    2020: (f"{TIGER}/TIGER2020/TABBLOCK20/tl_2020_49_tabblock20.zip",
           "tl_2020_49_tabblock20", "POP20", "HOUSING20"),
}
CACHE = DATA / "cache"
UTM = "EPSG:26912"            # UTM 12N, metres, so a buffer is a true distance
SQ_M_PER_SQ_MI = 2_589_988.11
LONLAT = {"4326", "4269"}     # NAD83 and WGS84 differ by about a metre here


def cached(url, name):
    """Download once into data/cache, via a temp name so an interrupted
    download is never mistaken for a complete one."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if not path.exists():
        print(f"  downloading {url} (first run only, this can take a few minutes)")
        part = path.with_suffix(".part")
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=600) as r, open(part, "wb") as fh:
            while chunk := r.read(1 << 20):
                fh.write(chunk)
        part.rename(path)
    return path


def city_shape(con, city, buffer_mi):
    """UGRC city limits, buffered in metres, returned as lon/lat WKT."""
    name = city.strip().upper().replace("'", "''")
    q = urllib.parse.urlencode({
        "where": f"UPPER(NAME)='{name}' OR UPPER(MINNAME)='{name}'",
        "outFields": "NAME", "returnGeometry": "true", "outSR": 4326, "f": "geojson"})
    feats = get_json(f"{MUNI}/query?{q}").get("features", [])
    if not feats:
        q = urllib.parse.urlencode({"where": f"UPPER(NAME) LIKE '%{name}%'",
                                    "outFields": "NAME", "returnGeometry": "false", "f": "json"})
        near = sorted({f["attributes"]["NAME"] for f in get_json(f"{MUNI}/query?{q}").get("features", [])})
        sys.exit(f"No Utah city named {city!r}." + (f" Did you mean: {', '.join(near)}?" if near else ""))
    geoms = [json.dumps(f["geometry"]) for f in feats]
    wkt = con.execute(f"""
      SELECT ST_AsText(ST_Transform(
               ST_Buffer(ST_Transform(ST_Union_Agg(ST_MakeValid(ST_GeomFromGeoJSON(g))),
                                      'EPSG:4326', '{UTM}', always_xy := true), ?),
               '{UTM}', 'EPSG:4326', always_xy := true))
      FROM (SELECT unnest(?::VARCHAR[]) AS g)""", [buffer_mi * 1609.344, geoms]).fetchone()[0]
    return feats[0]["properties"]["NAME"], wkt


def lonlat_sql(layer, path):
    """SQL that turns a layer's geometry into lon/lat, from its saved CRS.

    `layer` is one entry of ST_Read_Meta(path).layers. QGIS often saves in the
    project CRS (Web Mercator, UTM), so this must not assume degrees.
    """
    crs = layer["geometry_fields"][0].get("crs") or {}
    if crs.get("auth_code") in LONLAT:
        return "geom"
    if crs.get("auth_name") and crs.get("auth_code"):
        src = f"{crs['auth_name']}:{crs['auth_code']}"
    elif crs.get("wkt"):
        src = crs["wkt"].replace("'", "''")
    else:
        sys.exit(f"{path.name} has no coordinate system saved with it. "
                 "In QGIS, export it again and pick EPSG:4326 as the CRS.")
    return f"ST_Transform(geom, '{src}', 'EPSG:4326', always_xy := true)"


def file_shape(con, path):
    """Every polygon in the first layer of a QGIS export, merged, as lon/lat WKT."""
    if not path.exists():
        sys.exit(f"File not found: {path}")
    try:   # a damaged file crashes ST_Read_Meta outright, but ST_Read raises
        con.execute("SELECT 1 FROM ST_Read(?) LIMIT 1", [str(path)])
    except duckdb.Error:
        sys.exit(f"{path.name} could not be read. Export it again from QGIS as a GeoPackage.")
    layer = con.execute("SELECT layers[1] FROM ST_Read_Meta(?)", [str(path)]).fetchone()[0]
    geom = lonlat_sql(layer, path)
    wkt, n = con.execute(f"""
      SELECT ST_AsText(ST_Union_Agg(ST_MakeValid({geom}))), count(*)
      FROM ST_Read(?) WHERE ST_GeometryType(geom) IN ('POLYGON', 'MULTIPOLYGON')""",
                         [str(path)]).fetchone()
    if not n:
        sys.exit(f"{path.name} has no areas in it. Draw a polygon, not points or lines.")
    lon0, lat0 = con.execute("SELECT ST_X(ST_Centroid(ST_GeomFromText(?))), ST_Y(ST_Centroid(ST_GeomFromText(?)))",
                             [wkt, wkt]).fetchone()
    if not (-115 < lon0 < -108 and 36 < lat0 < 43):
        sys.exit(f"{path.name} does not land in Utah (centre {lat0:.3f}, {lon0:.3f}). "
                 "Check the CRS it was exported with.")
    label = f"{path.stem} ({n} shape{'s' if n != 1 else ''} combined)" if n > 1 else path.stem
    return label, wkt


def count(con, wkt):
    """People and housing units in blocks whose inside point falls in the shape."""
    out = {}
    for year, (url, stem, pop, hu) in BLOCKS.items():
        z = cached(url, f"{stem}.zip")
        out[year] = con.execute(f"""
          SELECT coalesce(sum({pop}), 0)::BIGINT, coalesce(sum({hu}), 0)::BIGINT
          FROM ST_Read(?), (SELECT ST_GeomFromText(?) AS shape)
          WHERE ST_Intersects(shape, ST_PointOnSurface(geom))""",
                                [f"/vsizip/{z}/{stem}.shp", wkt]).fetchone()
    return out


def city_estimate(name):
    path = DATA / "cities.parquet"
    if not path.exists():
        return None
    return duckdb.execute(f"""
      SELECT pop_2020_base, pop_2025, growth_pct FROM '{str(path).replace("'", "''")}'
      WHERE upper(name) = upper(?)""", [name]).fetchone()


def pct(a, b):
    return round((b - a) / a * 100, 1) if a else None


def main():
    ap = argparse.ArgumentParser(description="People living inside an area, 2010 and 2020 census.")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--city", help='Utah city name, for example "Tooele"')
    src.add_argument("--shape", type=pathlib.Path, help="a .gpkg, .geojson or .shp exported from QGIS")
    ap.add_argument("--buffer-mi", type=float, default=0, help="with --city: add this many miles around the city limits")
    ap.add_argument("--write", type=pathlib.Path, help="save the area with these numbers as a .gpkg for QGIS")
    a = ap.parse_args()
    # "~/Desktop/area.gpkg" arrives with the tilde intact when quoted.
    a.shape = a.shape.expanduser() if a.shape else None
    a.write = a.write.expanduser() if a.write else None
    if a.buffer_mi and not a.city:
        ap.error("--buffer-mi only works with --city")

    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    if a.city:
        city, wkt = city_shape(con, a.city, a.buffer_mi)
        label = f"{city} city limits" + (f" plus {a.buffer_mi:g} mile{'s' if a.buffer_mi != 1 else ''}" if a.buffer_mi else "")
    else:
        city, (label, wkt) = None, file_shape(con, a.shape)
    area = con.execute(f"SELECT ST_Area(ST_Transform(ST_GeomFromText(?), 'EPSG:4326', '{UTM}', always_xy := true))",
                       [wkt]).fetchone()[0] / SQ_M_PER_SQ_MI

    c = count(con, wkt)
    (p10, h10), (p20, h20) = c[2010], c[2020]
    print(f"\n{label}  ({area:,.1f} square miles)\n")
    print(f"{'':15}{'2010':>10}{'2020':>10}{'Change':>10}")
    for lab, x, y in (("People", p10, p20), ("Housing units", h10, h20)):
        pc = pct(x, y)
        print(f"{lab:15}{x:>10,}{y:>10,}{y - x:>+10,}" + (f"  ({pc:+.1f}%)" if pc is not None else ""))
    print("\nThese are the official census counts for April 2010 and April 2020. Each census"
          "\nblock counts as fully inside or fully outside, so edges are approximate.")

    est = city_estimate(city) if city else None
    if est:
        base, p25, g = est
        print(f"\nCensus estimate for {city}, July 2025: {p25:,} people ({g:+.1f}% since 2020)."
              f"\nThat number covers the city limits only"
              + (f", not the {a.buffer_mi:g} mile buffer,\nso do not compare it with the table above."
                 if a.buffer_mi else "."))

    if a.write:
        a.write.parent.mkdir(parents=True, exist_ok=True)
        a.write.unlink(missing_ok=True)
        con.execute(f"""
          COPY (SELECT ? AS name, ?::DOUBLE AS buffer_mi, ?::DOUBLE AS area_sq_mi,
                       ?::BIGINT AS pop_2010, ?::BIGINT AS pop_2020, ?::BIGINT AS pop_change,
                       ?::DOUBLE AS pop_change_pct, ?::BIGINT AS housing_2010,
                       ?::BIGINT AS housing_2020, ?::DOUBLE AS housing_change_pct,
                       ?::BIGINT AS city_limits_pop_2025_estimate,
                       ST_Multi(ST_GeomFromText(?)) AS geom)
          TO '{str(a.write).replace("'", "''")}'
          WITH (FORMAT GDAL, DRIVER 'GPKG', SRS 'EPSG:4326', GEOMETRY_TYPE 'MULTIPOLYGON',
                LAYER_NAME '{a.write.stem.replace("'", "''")}')""",
                    [label, a.buffer_mi if a.city else None, round(area, 2), p10, p20, p20 - p10,
                     pct(p10, p20), h10, h20, pct(h10, h20), est[1] if est else None, wkt])
        print(f"\nSaved {a.write}. Drag it into QGIS to see the area and these numbers.")


if __name__ == "__main__":
    main()
