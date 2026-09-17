"""Is each candidate lot's parcel id still on the county's current parcel map?

The LIR layers ingest_parcels.py reads (Parcels_<County>_LIR) are the yearly
tax roll. Counties split, merge and renumber land all year, so a lot can be
listed that no longer exists as described: Heber 00-0020-8298 (Wasatch roll of
2024-10-31) is now the new parcels 00-0022-0595 to 00-0022-0598. UGRC also
publishes each county's plain parcel layer (Parcels_<County>, no suffix),
refreshed whenever the county sends a new map, monthly for the large counties.
A parcel id missing from that layer is marked not current.

The check only runs where it can mean something. Measured 2026-09-17:
  * the current map must be newer than the tax roll (ParcelsCur after the
    roll's CURRENT_ASOF). Duchesne, Kane and Rich sent their current map
    before their roll, and Sanpete's is from 2015.
  * ids must be written the same way on both. At least half of a sample of up
    to 200 ids per county must be found. Box Elder (roll 050040018, map
    05-004-0018) and Daggett (map 153-1) match none; the rest match 93% to 100%.
A skipped county's lots stay current, with the reason logged.

data/parcel_currency.parquet keeps the answer per (county, parcel_id) with the
map date it was checked against, so a rerun only asks about ids that are new
or whose county has published a newer map since.

Usage:  .venv/bin/python scripts/check_parcels_current.py
"""
import sys, json, pathlib, datetime, urllib.parse
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from concurrent.futures import ThreadPoolExecutor
import pyarrow as pa, pyarrow.parquet as pq
from common import UGRC, COUNTIES, DATA, get_json

OUT = DATA / "parcel_currency.parquet"
SAMPLE = 200          # ids per county for the format test
MIN_MATCH = 0.5       # below this share found, the two layers write ids differently
BATCH = 200           # ids per IN (...) query


def day(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")


def max_date(layer, field):
    q = urllib.parse.urlencode({"where": "1=1", "f": "json", "outStatistics": json.dumps(
        [{"statisticType": "max", "onStatisticField": field, "outStatisticFieldName": "d"}])})
    d = get_json(f"{layer}/query?{q}")
    if "error" in d:
        raise RuntimeError(f"{layer}: {d['error']}")
    v = d["features"][0]["attributes"]["d"]
    return day(v) if v else None


def found(county, ids):
    """The ids in this batch that the county's current map still has."""
    where = "PARCEL_ID IN (" + ",".join("'" + i.replace("'", "''") + "'" for i in ids) + ")"
    d = get_json(f"{UGRC}/Parcels_{county}/FeatureServer/0/query", data=urllib.parse.urlencode(
        {"where": where, "outFields": "PARCEL_ID", "returnDistinctValues": "true",
         "returnGeometry": "false", "f": "json"}))
    if "error" in d or d.get("exceededTransferLimit"):
        raise RuntimeError(f"{county}: {d.get('error') or 'transfer limit hit'}")
    return {(f["attributes"]["PARCEL_ID"] or "").strip() for f in d["features"]}


def assess(county, ids):
    """(map date, roll date, sample share found, skip reason or None) for one county."""
    cur = max_date(f"{UGRC}/Parcels_{county}/FeatureServer/0", "ParcelsCur")
    roll = max_date(f"{UGRC}/Parcels_{county}_LIR/FeatureServer/0", "CURRENT_ASOF")
    step = max(1, len(ids) // SAMPLE)
    sample = ids[::step][:SAMPLE]
    share = len(found(county, sample)) / len(sample)
    if not cur or not roll:
        return cur, roll, share, "no date on the current map or the tax roll"
    if cur <= roll:
        return cur, roll, share, f"current map ({cur}) is not newer than the tax roll ({roll})"
    if share < MIN_MATCH:
        return cur, roll, share, f"ids written differently, {share:.0%} of a {len(sample)} id sample found"
    return cur, roll, share, None


if __name__ == "__main__":
    print("Parcel ids still on each county's current parcel map")
    P = pq.read_table(DATA / "parcels.parquet", columns=["county", "parcel_id"])
    by_county = {}
    for c, p in zip(P.column("county").to_pylist(), P.column("parcel_id").to_pylist()):
        p = (p or "").strip()
        if p:
            by_county.setdefault(c, set()).add(p)
    by_county = {c: sorted(v) for c, v in by_county.items()}
    cache = {}
    if OUT.exists():
        for r in pq.read_table(OUT).to_pylist():
            if r["in_current"] is not None:
                cache[(r["county"], r["parcel_id"], r["map_date"])] = r["in_current"]

    counties = [c for c in COUNTIES if c in by_county]
    with ThreadPoolExecutor(8) as ex:
        info = dict(zip(counties, ex.map(lambda c: assess(c, by_county[c]), counties)))

    # Ask only about ids not already answered against this county's map date.
    todo = []
    for c in counties:
        cur, _, _, skip = info[c]
        if skip is None:
            ask = [p for p in by_county[c] if (c, p, cur) not in cache]
            todo += [(c, ask[k:k + BATCH]) for k in range(0, len(ask), BATCH)]
    with ThreadPoolExecutor(8) as ex:
        for (c, ids), got in zip(todo, ex.map(lambda t: found(*t), todo)):
            for p in ids:
                cache[(c, p, info[c][0])] = p in got
    asked = sum(len(ids) for _, ids in todo)

    rows = []
    print(f"  {'county':<11}{'ids':>7}{'checked':>9}{'missing':>9}  sample  map / tax roll          note")
    for c in counties:
        cur, roll, share, skip = info[c]
        miss = 0
        for p in by_county[c]:
            v = None if skip else cache[(c, p, cur)]
            miss += v is False
            rows.append({"county": c, "parcel_id": p, "in_current": v, "map_date": cur,
                         "roll_date": roll, "skip_reason": skip})
        checked = 0 if skip else len(by_county[c])
        print(f"  {c:<11}{len(by_county[c]):>7,}{checked:>9,}{miss:>9,}  {share:>5.0%}  "
              f"{cur} / {roll}  {('skipped: ' + skip) if skip else ''}")
    n_miss = sum(1 for r in rows if r["in_current"] is False)
    n_chk = sum(1 for r in rows if r["in_current"] is not None)
    print(f"  total: {len(rows):,} ids, {n_chk:,} checked, {n_miss:,} gone from the current map, "
          f"{len(rows) - n_chk:,} in skipped counties; {asked:,} asked this run, the rest from the cache")
    pq.write_table(pa.Table.from_pylist(rows), OUT, compression="zstd")
    print(f"  wrote data/parcel_currency.parquet  {len(rows):,} rows")
