"""Car washes from OpenStreetMap via Overpass.

Must use `nwr` not `node`: 77% of Utah car washes are mapped as ways, so a
node-only query silently loses three quarters of them. The area selector must
be ISO3166-2 alone; adding admin_level=4 returns zero. Verified 2026-09-09.

License: ODbL. Kept source-tagged so attribution and share-alike are traceable.
"""
import sys, json, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import urllib.parse
from common import get_json, DATA

ENDPOINT = "https://overpass-api.de/api/interpreter"
QUERY = """[out:json][timeout:120];
area["ISO3166-2"="US-UT"]->.ut;
nwr["amenity"="car_wash"](area.ut);
out center tags;"""


def fetch():
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    d = get_json(ENDPOINT, data=body, timeout=180)
    rows = []
    for e in d.get("elements", []):
        t = e.get("tags") or {}
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lon = e.get("lon") or (e.get("center") or {}).get("lon")
        if lat is None or lon is None:
            continue
        rows.append({
            "src": "osm",
            "src_id": f"{e['type']}/{e['id']}",
            "name": t.get("name"),
            "brand": t.get("brand"),
            "operator": t.get("operator"),
            "lat": lat, "lon": lon,
            "address": " ".join(x for x in [t.get("addr:housenumber"), t.get("addr:street")] if x) or None,
            "city": t.get("addr:city"),
            "website": t.get("website"),
            "phone": t.get("phone"),
            "opening_hours": t.get("opening_hours"),
            "parcel_id": t.get("utahagrc:parcelid"),
            "tags": {k: v for k, v in t.items()
                     if k in ("automated", "self_service", "vacuum_cleaner",
                              "truck_wash", "payment:credit_cards", "drive_through",
                              "dog_washing", "self_service:vacuum", "fee", "level")},
            "postcode": t.get("addr:postcode"),
            "brand_wikidata": t.get("brand:wikidata"),
            "checked": t.get("check_date") or t.get("survey:date"),
            "osm_id": f"{e['type']}/{e['id']}",
            "overture_id": None,
            "confidence": None,
            "socials": None,
            "rating": None, "reviews": None, "google_category": None,
        })
    return rows


if __name__ == "__main__":
    rows = fetch()
    print(f"OSM car washes in Utah: {len(rows)}")
    (DATA / "raw_osm.json").write_text(json.dumps(rows))
    named = sum(1 for r in rows if r["name"])
    tagged = sum(1 for r in rows if r["tags"])
    print(f"  named: {named}  |  with format tags: {tagged} ({tagged/len(rows)*100:.0f}%)")
