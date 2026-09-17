"""Where people moving into each Utah county came from, as flow lines for QGIS.

Source: IRS Statistics of Income county-to-county inflow, filing years 2022 to
2023 (keyless CSV). A household counts as a mover when its tax return was filed
from a different county than the year before. n1 is returns (roughly
households), n2 is individuals on those returns (roughly people), agi is in
thousands of dollars.

IRS hides every county pair with fewer than 20 returns and folds it into
regional "Other flows" rows. A small county can therefore look like nobody
moved there when its movers are simply under the disclosure floor, so those
rows go to a CSV beside the lines instead of being dropped.

Line endpoints are the Census Gazetteer 2025 county internal points. The IRS
file already uses the 2022 Connecticut planning regions, and every origin in
it matches a Gazetteer 2025 county (verified 2026-09-17).
"""
import sys, csv, io, zipfile, pathlib, urllib.request
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import duckdb, pyarrow as pa
from common import DATA, ROOT, UA, assert_count

IRS = "https://www.irs.gov/pub/irs-soi/countyinflow2223.csv"
GAZ = ("https://www2.census.gov/geo/docs/maps-data/data/gazetteer/"
       "2025_Gazetteer/2025_Gaz_counties_national.zip")
CACHE = DATA / "cache"
GIS = ROOT / "gis"

# IRS summary codes in y1_statefips: 57 foreign, 58 other flows same state,
# 59 other flows different state, 96 to 98 totals. Codes checked against the
# labels in the 2022 to 2023 file itself.
SUMMARY = {"57", "58", "59", "96", "97", "98"}
MEANING = {
    ("96", "000"): "Everyone who moved in, from anywhere",
    ("97", "000"): "Everyone who moved in from inside the US",
    ("97", "001"): "Moved in from another Utah county",
    ("97", "003"): "Moved in from another state",
    ("98", "000"): "Moved in from outside the US",
    ("57", "001"): "Moved in from overseas",
    ("57", "003"): "Moved in from Puerto Rico",
    ("57", "005"): "Moved in from US military mail addresses abroad",
    ("57", "009"): "Moved in from abroad, in groups too small for IRS to list",
    ("58", "000"): "Moved in from Utah counties that sent fewer than 20 households each",
    ("59", "000"): "Moved in from counties in other states that sent fewer than 20 households each",
    ("59", "001"): "Moved in from Northeast counties that sent fewer than 20 households each",
    ("59", "003"): "Moved in from Midwest counties that sent fewer than 20 households each",
    ("59", "005"): "Moved in from South counties that sent fewer than 20 households each",
    ("59", "007"): "Moved in from West counties that sent fewer than 20 households each",
}


def cached(url, name):
    """Download once into data/cache, writing to a temp name so a cut-off
    download never passes for a complete file."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if not path.exists():
        print(f"  downloading {url}")
        part = path.with_suffix(path.suffix + ".part")
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=300) as r, open(part, "wb") as fh:
            while chunk := r.read(1 << 20):
                fh.write(chunk)
        part.rename(path)
    return path


def num(v):
    """IRS writes -1 for a suppressed cell."""
    v = int(v)
    return None if v < 0 else v


def avg_agi(agi, n1):
    return round(agi * 1000 / n1) if agi is not None and n1 else None


def main():
    print("Migration into Utah: IRS county-to-county inflow 2022 to 2023")
    with zipfile.ZipFile(cached(GAZ, "2025_Gaz_counties_national.zip")) as z:
        txt = z.read(z.namelist()[0]).decode("latin-1")
    points, names = {}, {}
    for r in csv.DictReader(io.StringIO(txt), delimiter="|"):
        r = {k.strip(): v.strip() for k, v in r.items()}
        points[r["GEOID"]] = (float(r["INTPTLONG"]), float(r["INTPTLAT"]))
        names[r["GEOID"]] = r["NAME"]

    # latin-1: county names such as Dona Ana carry raw accented bytes.
    txt = cached(IRS, "countyinflow2223.csv").read_text(encoding="latin-1")
    rows = [r for r in csv.DictReader(io.StringIO(txt)) if r["y2_statefips"] == "49"]

    # A blank people or households cell in the CSV means IRS hid that number.
    lines, other, missing = [], [], 0
    for r in rows:
        dest = r["y2_statefips"] + r["y2_countyfips"]
        orig = r["y1_statefips"] + r["y1_countyfips"]
        n1, n2, agi = num(r["n1"]), num(r["n2"]), num(r["agi"])
        if r["y1_statefips"] in SUMMARY:
            label = r["y1_countyname"]
            if "Total Migration" in label:      # "Utah County Total Migration-US"
                label = label[label.index("Total Migration"):]
            other.append({"dest_county": names[dest], "dest_geoid": dest, "irs_row": label,
                          "meaning": MEANING.get((r["y1_statefips"], r["y1_countyfips"]), label),
                          "people": n2, "households": n1,
                          "avg_agi_per_return": avg_agi(agi, n1)})
            continue
        if orig == dest:          # non-movers
            continue
        if orig not in points:
            missing += 1
            continue
        (x1, y1), (x2, y2) = points[orig], points[dest]
        lines.append({"origin_name": r["y1_countyname"], "origin_state": r["y1_state"],
                      "origin_geoid": orig, "dest_county": names[dest], "dest_geoid": dest,
                      "people": n2, "households": n1, "avg_agi_per_return": avg_agi(agi, n1),
                      "same_state": r["y1_statefips"] == "49",
                      "wkt": f"LINESTRING ({x1} {y1}, {x2} {y2})"})
    if missing:
        raise RuntimeError(f"{missing} origin counties have no Gazetteer point")
    lines.sort(key=lambda l: (l["dest_geoid"], -(l["people"] or 0)))
    assert_count("county pairs into Utah", len(lines), 555)

    GIS.mkdir(exist_ok=True)
    out = GIS / "migration_flows_into_utah.gpkg"
    out.unlink(missing_ok=True)
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.register("t", pa.Table.from_pylist(lines))
    con.execute(f"""
      COPY (SELECT * EXCLUDE (wkt), ST_GeomFromText(wkt) AS geom FROM t)
      TO '{out}' WITH (FORMAT GDAL, DRIVER 'GPKG', SRS 'EPSG:4326',
                       GEOMETRY_TYPE 'LINESTRING', LAYER_NAME 'migration_flows_into_utah')""")
    print(f"  wrote gis/{out.name}  {len(lines):,} lines")

    oc = GIS / "migration_other_flows.csv"
    with open(oc, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(other[0]))
        w.writeheader()
        w.writerows(other)
    print(f"  wrote gis/{oc.name}  {len(other)} rows")

    top = [l for l in lines if l["dest_geoid"] == "49049"][:3]
    print("  Utah County, top origins: "
          + ", ".join(f"{l['origin_name']} {l['people']:,}" for l in top))


if __name__ == "__main__":
    main()
