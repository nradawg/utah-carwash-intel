"""Rebuild every dataset from source, then export the browser payload.

Usage:  .venv/bin/python scripts/run_all.py
Runtime: roughly 5 minutes, dominated by the ACS summary-file download.

Every ingest asserts its row count against what was verified when the pipeline
was written, so a source that silently changes shape fails loudly here rather
than quietly producing a wrong map.
"""
import subprocess, sys, pathlib, datetime, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
PY = str(ROOT / ".venv" / "bin" / "python")

STEPS = [
    ("parcels",      "ingest_parcels.py"),
    ("traffic",      "ingest_traffic.py"),
    ("roads",        "ingest_roads.py"),
    ("rooftops",     "ingest_rooftops.py"),
    ("tracts",       "ingest_tracts.py"),
    ("demographics", "ingest_demographics.py"),
    ("context",      "ingest_context.py"),
    ("osm",          "fetch_osm.py"),
    ("overture",     "fetch_overture.py"),
    ("merge",        "merge_competition.py"),
    ("sites",        "build_sites.py"),
    ("isochrones",   "build_isochrones.py"),
]

if __name__ == "__main__":
    only = sys.argv[1:] or None
    t0 = time.time()
    for name, script in STEPS:
        if only and name not in only:
            continue
        print(f"\n=== {name} " + "=" * (60 - len(name)))
        r = subprocess.run([PY, str(ROOT / "scripts" / script)])
        if r.returncode != 0:
            sys.exit(f"FAILED at {name}. Pipeline stopped; data not exported.")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    print("\n=== export " + "=" * 54)
    r = subprocess.run([PY, str(ROOT / "scripts" / "export_web.py"), stamp])
    if r.returncode != 0:
        sys.exit("FAILED at export.")
    print(f"\nPipeline complete in {time.time()-t0:.0f}s. Data stamped {stamp}.")
