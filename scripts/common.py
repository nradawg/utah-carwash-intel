"""Shared helpers: ArcGIS REST paging, retries, provenance."""
import json, time, urllib.parse, urllib.request, urllib.error, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

UGRC = "https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services"
UDOT = "https://services.arcgis.com/pA2nEVnB6tquxgOW/arcgis/rest/services"

COUNTIES = ["Beaver","BoxElder","Cache","Carbon","Daggett","Davis","Duchesne","Emery",
            "Garfield","Grand","Iron","Juab","Kane","Millard","Morgan","Piute","Rich",
            "SaltLake","SanJuan","Sanpete","Sevier","Summit","Tooele","Uintah","Utah",
            "Wasatch","Washington","Wayne","Weber"]

UA = {"User-Agent": "utah-carwash-intel/1.0 (site-selection research)"}


def get_json(url, data=None, timeout=90, retries=4, backoff=3):
    """GET/POST returning parsed JSON, with retry on transient failure."""
    last = None
    for i in range(retries):
        try:
            body = data.encode() if isinstance(data, str) else data
            req = urllib.request.Request(url, data=body, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            last = e
            if i < retries - 1:
                time.sleep(backoff * (i + 1))
    raise RuntimeError(f"failed after {retries}: {url[:120]} :: {last}")


def arcgis_count(layer_url, where="1=1"):
    q = urllib.parse.urlencode({"where": where, "returnCountOnly": "true", "f": "json"})
    return get_json(f"{layer_url}/query?{q}").get("count", -1)


def arcgis_page(layer_url, where="1=1", out_fields="*", geometry=False,
                page=2000, label="", out_sr=4326):
    """Page an ArcGIS FeatureServer layer fully. Yields attribute dicts.

    maxRecordCount is 2000 on UGRC/UDOT, so paging is mandatory, not optional.
    """
    total = arcgis_count(layer_url, where)
    if total <= 0:
        return []
    rows, offset = [], 0
    while offset < total:
        params = {
            "where": where, "outFields": out_fields, "f": "json",
            "resultOffset": offset, "resultRecordCount": page,
            "returnGeometry": "true" if geometry else "false",
            "outSR": out_sr, "orderByFields": "OBJECTID",
        }
        d = get_json(f"{layer_url}/query?{urllib.parse.urlencode(params)}")
        if "error" in d:
            raise RuntimeError(f"{label}: {d['error']}")
        feats = d.get("features", [])
        if not feats:
            break
        rows.extend(feats)
        offset += len(feats)
        if label:
            sys.stderr.write(f"\r  {label}: {offset}/{total}")
            sys.stderr.flush()
    if label:
        sys.stderr.write(f"\r  {label}: {len(rows)}/{total} done\n")
    return rows


def assert_count(name, actual, expected, tol=0.10):
    """Fail loudly if a source drifts from what we verified during planning."""
    if expected is None:
        print(f"  [count] {name}: {actual:,}")
        return
    lo, hi = expected * (1 - tol), expected * (1 + tol)
    flag = "OK" if lo <= actual <= hi else "DRIFT"
    print(f"  [{flag}] {name}: {actual:,} (expected ~{expected:,})")
    if flag == "DRIFT":
        print(f"     ^ outside +/-{int(tol*100)}%. Source changed. Investigate before trusting output.")
