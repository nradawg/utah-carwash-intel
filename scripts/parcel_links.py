"""Parcel links: open one parcel's record on the county's own public site.

UGRC's ASSESSOR_SRC is only each assessor's homepage, and several of those are
dead. Every template below was opened for a real parcel on 2026-09-17 with a
browser User-Agent (and in a real browser where the page fills in with
JavaScript or needs a click first). Counties with no link we could verify fall
back to the UGRC statewide parcel map centred on the parcel.

Several county sites (Salt Lake, Duchesne, Juab, Garfield) reject scripts that
send a bot User-Agent, so the self-test sends full browser headers.

Run:  python scripts/parcel_links.py      (live self-test, one parcel per county)
"""
import sys, re, math, json, time, datetime, pathlib, urllib.parse, urllib.request, urllib.error
from http.cookiejar import CookieJar
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from common import UGRC, COUNTIES, DATA, get_json

VERIFIED = "2026-09-17"

# Tyler EagleWeb sites bounce a first visit to a login page; the public button
# logs in as a guest and the site then opens the page the link asked for (checked
# in a real browser, and the login POST redirects straight back to the record).
# A parcel the county has since split or merged still opens, marked Inactive
# (Summit CT-362-A, replaced by Rivers Edge Subdivision for 2026).
EAGLE_HINT = ("If a login page opens, click {button} and the lot opens. No account or payment is needed. "
              "If the county page says Inactive, the lot was split or merged; use the Utah parcel map to see it now.")
# The results.jsp fallback lands on a one row list, not the record itself.
SEARCH_HINT = ("If a login page opens, click {button}, then click the account number to open the lot. "
               "No account or payment is needed. If the county page says Inactive, the lot was split "
               "or merged; use the Utah parcel map to see it now.")
# Summit and Washington key these pages on the serial number and write the
# parcel number their own way, so it may not match the one on this map.
OWN_NUMBER = " The county may show a slightly different parcel number."

# Keys: kind 'parcel' lands on the record, 'search' lands on a results list or
# search page. needs: which UGRC LIR field fills {id}. fmt: how that value is
# reshaped before it goes in the URL. pattern: id shapes we verified (anything
# else falls through, so we never emit an untested URL). hit/miss/check: text
# the self-test looks for to prove the page shows a real record.
LINKS = {
    "Beaver": {
        "home": "https://www.beaver.utah.gov/117/Assessor",
        "links": [{
            "kind": "parcel", "needs": "PARCEL_ID", "fmt": "dash_2_4_4", "pattern": r"^\d{10}$",
            "url": "https://coins-ut.us/report/{id}",
            "label": "Beaver County tax record for this parcel. If it shows a different county, "
                     "pick Beaver under Select County and open this link again.",
            # COINS keeps the chosen county in browser storage and defaults to Beaver,
            # which is why this works for Beaver and for no other COINS county.
            "check": "https://coins-ut.us/dbb/sql/parcel/reportMaster.js?db=BEAV&prepay=true&parcel={id}&year={year}",
            "hit": '"Parcel":"{id}"',
            "verified": f"{VERIFIED} with 0300560001 (opened as 03-0056-0001, fresh browser)",
        }],
    },
    "BoxElder": {
        "home": "https://www.boxeldercountyut.gov/169/Assessor",
        "links": [{
            # Account numbers (R0037736) are not derivable from SERIAL_NUM, so this
            # lands on a one row results list instead of the record. UGRC's Box
            # Elder LIR is dated 2020-07-17, so some ids are gone: 27 of 30 random
            # candidates were found, the rest show "No results found".
            "kind": "search", "needs": "PARCEL_ID", "pattern": r"^\d{9}$", "login": True,
            "url": "https://erecord.boxeldercountyut.gov/eaglesoftware/taxweb/results.jsp?ParcelNumID={id}",
            "label": "Box Elder County search results for this parcel. It is free. If a login page opens, "
                     "click Limited Viewer, then click the account number. If it says No results, the "
                     "county may have renumbered this lot, so use the Utah parcel map.",
            "hit": "account.jsp?accountNum=",
            "verified": f"{VERIFIED} with 010400022 (account R0037736)",
        }],
    },
    "Cache": {
        "home": "https://www.cachecounty.gov/assessor/",
        "home_was": "https://www.cachecounty.org/assessor/ resets the connection; county moved to cachecounty.gov",
        "links": [{
            "kind": "parcel", "needs": "PARCEL_ID", "pattern": r"^\d{2}-\d{3}-\d{4}$",
            "url": "https://core.cachecounty.gov/Display/Parcel/{id}",
            "label": "Cache County parcel record (owners, values, taxes). Click I agree on the notice.",
            "hit": "Owner(s)",
            "verified": f"{VERIFIED} with 02-065-0038 (fake 02-065-9999 has no owners)",
        }],
    },
    "Carbon": {
        "home": "https://www.carbon.utah.gov/department/assessor/",
        "home_was": "https://www.carbonutah.com now answers with a building controller certificate and 404; county site is carbon.utah.gov",
        "links": [{
            "kind": "parcel", "needs": "PARCEL_ID", "pattern": r"^\d[A-Z]-\d{4}-[0-9A-Z]{4}$",
            "url": "https://www.carbon.utah.gov/service/property-detail/?wdt_search={id}",
            "label": "Carbon County property record for this parcel",
            # Tables load by JavaScript and the HTML echoes any id, so the body
            # check proves nothing here. Checked by eye in a browser instead.
            "js_only": True,
            "verified": f"{VERIFIED} with 1A-0340-0000 (browser showed 68 GARDEN ST, HELPER), "
                        "also 2A-1169-000A and 2A-1146-0000",
        }],
    },
    "Daggett": {
        "home": "https://www.daggettcounty.gov/15/AssessorDMV",
        "home_was": "http://www.daggettcounty.org/15/AssessorDMV redirects here",
        "links": [],
        "why": "Records are on coins-ut.us, but that site picks the county from browser storage "
               "(default Beaver), so a link cannot open a Daggett parcel on a first visit.",
    },
    "Davis": {
        "home": "https://www.daviscountyutah.gov/assessor",
        "links": [{
            "kind": "parcel", "needs": "PARCEL_ID", "pattern": r"^\d{9}$",
            "url": "https://webportal.daviscountyutah.gov/App/PropertySearch/dashboard/parcel/{id}",
            "label": "Davis County property record for this parcel. If a notice appears, tick I agree "
                     "to the Terms of Use, then click OK.",
            # Angular app; the record comes from this API, which the page calls.
            "check": "https://webportal.daviscountyutah.gov/App/PropertySearch/api/parcel/{id}",
            "hit": '"parcelNumber":"{id}"',
            "verified": f"{VERIFIED} with 100270058 (browser showed Neighborhood Shopping Center, 0.53 ac)",
        }],
    },
    "Duchesne": {
        "home": "https://duchesne.utah.gov/gov/elected-officials/assessor/",
        "links": [],
        "why": "Records are on coins-ut.us, which picks the county from browser storage, so no first visit link.",
    },
    "Emery": {
        "home": "https://emery.utah.gov/home/offices/assessor/",
        "home_was": "https://emerycounty.com/home/offices/assessor/ still loads but links to emery.utah.gov",
        "links": [],
        "why": "Records are on coins-ut.us, which picks the county from browser storage, so no first visit link.",
    },
    "Garfield": {
        # Returns 403 to scripts (Akamai) but loads in a real browser: not dead.
        "home": "https://www.garfield.utah.gov/Departments/Assessor",
        "links": [],
        "why": "Records are on coins-ut.us, which picks the county from browser storage, so no first visit link.",
    },
    "Grand": {
        "home": "https://grandcountyutah.net/130/Assessor",
        "links": [],
        "why": "Records are on coins-ut.us, which picks the county from browser storage, so no first visit link.",
    },
    "Iron": {
        "home": "https://ironcountyut.gov/assessor",
        "home_was": "https://ironcounty.net/departments/assessor redirects to a 404 on ironcountyut.gov",
        "links": [{
            "kind": "parcel", "needs": "SERIAL_NUM", "fmt": "pad7", "pattern": r"^\d{1,7}$", "login": True,
            "url": "https://eagleweb.ironcounty.net/eaglesoftware/taxweb/account.jsp?accountNum={id}",
            "label": "Iron County record for this parcel. " + EAGLE_HINT.format(button="Login Without an Account"),
            "hit": "{pid}",
            "verified": f"{VERIFIED} with D-0433-0003-0000 (serial 0494009)",
        }, {
            "kind": "search", "needs": "PARCEL_ID", "pattern": r"^\S+$", "login": True,
            "url": "https://eagleweb.ironcounty.net/eaglesoftware/taxweb/results.jsp?ParcelNumID={id}",
            "label": "Iron County search results for this parcel. "
                     + SEARCH_HINT.format(button="Login Without an Account"),
            "hit": "account.jsp?accountNum=",
            "verified": f"{VERIFIED} with D-0433-0003-0000 (1 result)",
        }],
    },
    "Juab": {
        "home": "https://juabcounty.gov/departments/assessor/",
        "links": [],
        "why": "EagleWeb (juabcountyut-recorder.tylerhost.net) sends visitors to an http address after "
               "Public Login and that connection resets, checked in a browser. Old homepage 406 was a bot filter.",
    },
    "Kane": {
        "home": "https://kane.utah.gov/158/Assessor",
        "links": [{
            "kind": "parcel", "needs": "SERIAL_NUM", "fmt": "pad7", "pattern": r"^\d{1,7}$", "login": True,
            "url": "https://eagleweb.kane.utah.gov/eaglesoftware/taxweb/account.jsp?accountNum={id}",
            "label": "Kane County record for this parcel. " + EAGLE_HINT.format(button="Login Without an Account"),
            "hit": "{pid}",
            "verified": f"{VERIFIED} with 3-6-21-16 (serial 60643), also serials 9350, 134364, 987",
        }, {
            "kind": "search", "needs": "PARCEL_ID", "pattern": r"^\S+$", "login": True,
            "url": "https://eagleweb.kane.utah.gov/eaglesoftware/taxweb/results.jsp?ParcelNumID={id}",
            "label": "Kane County search results for this parcel. "
                     + SEARCH_HINT.format(button="Login Without an Account"),
            "hit": "account.jsp?accountNum=",
            "verified": f"{VERIFIED} with 3-6-21-16 (1 result)",
        }],
    },
    "Millard": {
        "home": "https://millardcounty.gov/your-government/elected-officials/assessor/",
        "home_was": "http://www.millardcounty.org times out; county moved to millardcounty.gov",
        "links": [],
        "why": "Records search is a Tyler site behind a disclaimer page. The county map searches serials by "
               "substring and 51 of 217 candidate ids match other parcels too, so a link could open the wrong one.",
    },
    "Morgan": {
        "home": "https://www.morgancountyutah.gov/assessor",
        "links": [],
        "why": "Records are on coins-ut.us, which picks the county from browser storage, so no first visit link.",
    },
    "Piute": {
        "home": "https://piute.gov/your-government/elected-officials/assessor-apprasier/",
        "home_was": "https://www.piuteutah.com refuses connections; piutecounty.org is a parked domain",
        "links": [],
        "why": "Records are on coins-ut.us, which picks the county from browser storage, so no first visit link.",
    },
    "Rich": {
        "home": "https://www.richcounty.gov/assessor/",
        "links": [],
        "why": "search.richcounty.gov/PropertyTaxSearch.aspx needs a CAPTCHA for every search, so no link can be verified.",
    },
    "SaltLake": {
        "home": "https://www.saltlakecounty.gov/assessor/",
        "links": [{
            "kind": "parcel", "needs": "PARCEL_ID", "pattern": r"^\d{14}$",
            "url": "https://apps.saltlakecounty.gov/assessor/new/valuationInfoExpanded.cfm?parcel_id={id}",
            "label": "Salt Lake County Assessor record for this parcel",
            # A parcel created after the tax roll (26241010100000) opens a page
            # that says it is not on the rolls yet; the link is still right.
            "hit": "Total Acreage",
            "verified": f"{VERIFIED} with 08222010010000 (2.65 ac, slow: about 10 s)",
        }],
    },
    "SanJuan": {
        "home": "https://www.sanjuancountyut.gov/166/AssessorDMV",
        "home_was": "https://sanjuancounty.org/assessor redirects to a 404 on sanjuancountyut.gov",
        "links": [],
        "why": "Records are on coins-ut.us, which picks the county from browser storage, so no first visit link.",
    },
    "Sanpete": {
        "home": "https://www.sanpetecountyutah.gov/163/Assessor",
        "home_was": "https://www.sanpetecountyutah.gov/assessor.html redirects here",
        "links": [{
            "kind": "parcel", "needs": "SERIAL_NUM", "pattern": r"^R\d{6}$", "login": True,
            "url": "https://treasurer.sanpetecountyutah.gov:8443/treasurer/treasurerweb/account.jsp?account={id}",
            "label": "Sanpete County tax record for this parcel. "
                     + EAGLE_HINT.format(button="Login under Tax Payer (Public) Login"),
            "hit": "{pid}",
            "verified": f"{VERIFIED} with 0000939X11 (serial R028064)",
        }],
    },
    "Sevier": {
        "home": "https://www.sevier.utah.gov/departments/assessor/index.php",
        "links": [{
            "kind": "parcel", "needs": "SERIAL_NUM", "fmt": "pad7", "pattern": r"^\d{1,7}$", "login": True,
            "url": "https://qdocs.sevier.utah.gov/recorder/taxweb/account.jsp?accountNum={id}",
            "label": "Sevier County record for this parcel. " + EAGLE_HINT.format(button="Login Without an Account"),
            "hit": "{pid}",
            "verified": f"{VERIFIED} with 1-47-10 (serial 0096772)",
        }, {
            "kind": "search", "needs": "PARCEL_ID", "pattern": r"^\S+$", "login": True,
            "url": "https://qdocs.sevier.utah.gov/recorder/taxweb/results.jsp?ParcelNumID={id}",
            "label": "Sevier County search results for this parcel. "
                     + SEARCH_HINT.format(button="Login Without an Account"),
            "hit": "account.jsp?accountNum=",
            "verified": f"{VERIFIED} with 1-47-10 (1 result)",
        }],
    },
    "Summit": {
        "home": "https://www.summitcountyutah.gov/220/Assessor",
        "links": [{
            "kind": "parcel", "needs": "SERIAL_NUM", "fmt": "pad7", "pattern": r"^\d{1,7}$", "login": True,
            "url": "https://property.summitcounty.org/eaglesoftware/taxweb/account.jsp?accountNum={id}",
            "label": "Summit County record for this parcel. " + EAGLE_HINT.format(button="Public Login") + OWN_NUMBER,
            "hit": "{pid}",
            "verified": f"{VERIFIED} with KK-18 (serial 152045), also serials 3495, 53250, 665",
        }, {
            "kind": "search", "needs": "PARCEL_ID", "pattern": r"^\S+$", "login": True,
            "url": "https://property.summitcounty.org/eaglesoftware/taxweb/results.jsp?ParcelNumID={id}",
            "label": "Summit County search results for this parcel. "
                     + SEARCH_HINT.format(button="Public Login") + OWN_NUMBER,
            "hit": "account.jsp?accountNum=",
            "verified": f"{VERIFIED} with KK-18 (1 result)",
        }],
    },
    "Tooele": {
        "home": "https://tooeleco.gov/departments/elected_officials/assessor/index.php",
        "links": [{
            # EagleWeb here forces a terms acceptance before any record, so we use
            # the county map instead: find= runs its parcel id search and zooms in.
            "kind": "parcel", "needs": "PARCEL_ID", "pattern": r"^\d{2}-\d{3}-[0-9A-Z]-[0-9A-Z]{4}$",
            "url": "https://tooelecountygis.maps.arcgis.com/apps/webappviewer/index.html"
                   "?id=c43e0f457ef547358a85c54d327c0342&find={id}",
            "label": "Tooele County map zoomed to this parcel. Click OK on the notice, "
                     "then click the parcel to see owner and value.",
            "check": "https://tcgisws.tooeleco.gov/server/rest/services/Parcels/MapServer/3/query"
                     "?where=Parcel_ID%3D%27{id}%27&outFields=Parcel_ID&returnGeometry=false&f=json",
            "hit": '"Parcel_ID":"{id}"',
            "verified": f"{VERIFIED} with 18-010-0-003A (browser map centred 28 m from the parcel, "
                        "no substring clashes among 722 candidate ids)",
        }],
    },
    "Uintah": {
        "home": "https://www.uintah.gov/departments/a_-_e_departments/assessor/index.php",
        "links": [],
        "why": "UNVERIFIED: the county property search and its map services on apps.uintah.utah.gov "
               "timed out from this machine in both curl and a browser on 2026-09-17.",
    },
    "Utah": {
        "home": "https://assessor.utahcounty.gov/",
        "links": [{
            "kind": "parcel", "needs": "PARCEL_ID", "pattern": r"^\d{8,9}$",
            "url": "https://www.utahcounty.gov/LandRecords/property.asp?av_serial={id}",
            "label": "Utah County land record for this parcel",
            "hit": "Owner Name",
            "verified": f"{VERIFIED} with 20340008 and 10910155 (fake serial returns 500)",
        }],
    },
    "Wasatch": {
        "home": "https://www.wasatchcounty.gov/166/Assessors-Office",
        "home_was": "www.wasatch.utah.gov no longer resolves; county moved to wasatchcounty.gov",
        "links": [],
        "why": "Records are on coins-ut.us, which picks the county from browser storage, so no first visit link. "
               "The county Property Tax Lookup is an ArcGIS page with no parcel parameter.",
    },
    "Washington": {
        "home": "https://www.washco.utah.gov/departments/assessor/",
        "links": [{
            "kind": "parcel", "needs": "SERIAL_NUM", "fmt": "pad7", "pattern": r"^\d{1,7}$", "login": True,
            "url": "https://eweb.washco.utah.gov:8443/recorder/taxweb/account.jsp?accountNum={id}",
            "label": "Washington County record for this parcel. " + EAGLE_HINT.format(button="Public Login") + OWN_NUMBER,
            "hit": "{pid}",
            "verified": f"{VERIFIED} with S-101-A-1 (serial 104110, also in a browser), "
                        "also serials 13311, 1171254, 6240, 698",
        }, {
            "kind": "search", "needs": "PARCEL_ID", "pattern": r"^\S+$", "login": True,
            "url": "https://eweb.washco.utah.gov:8443/recorder/taxweb/results.jsp?ParcelNumID={id}",
            "label": "Washington County search results for this parcel. "
                     + SEARCH_HINT.format(button="Public Login") + OWN_NUMBER,
            "hit": "account.jsp?accountNum=",
            "verified": f"{VERIFIED} with S-101-A-1, H-BAJR-3, SG-47-A-1 (1 result each)",
        }],
    },
    "Wayne": {
        "home": "https://waynecountyutah.gov/pages/county-offices",
        "home_was": "https://waynecountyutah.org certificate no longer matches; county moved to waynecountyutah.gov",
        "links": [],
        "why": "Records are on coins-ut.us, which picks the county from browser storage, so no first visit link.",
    },
    "Weber": {
        "home": "https://www.webercountyutah.gov/Assessor/",
        "links": [{
            "kind": "parcel", "needs": "PARCEL_ID", "pattern": r"^\d{9}$",
            "url": "https://webercountyutah.gov/parcelsearch/ownership-info.php?id={id}",
            "label": "Weber County parcel record (owner, address, legal description)",
            # The page echoes any id, so a missing legal description marks a miss.
            "hit": "{pid}", "miss": "No Legal Description Found",
            "verified": f"{VERIFIED} with 051670004 (fake 999999998 shows no legal description)",
        }],
    },
}

# UGRC statewide viewer reads #<County>/location/<x>,<y>,<scale> (Web Mercator)
# on load and zooms there with parcel lines and ids drawn. Checked in a browser
# for Salt Lake 08222010010000 and Washington S-101-A-1. It shows a one time
# disclaimer the viewer must accept.
STATEWIDE = "https://parcels.utah.gov/#{county}/location/{x},{y},{scale}"
STATEWIDE_SCALE = 1500
STATEWIDE_LABEL = ("Utah state parcel map at this spot. Click I agree, then click the outline in the "
                   "middle of the map. Its parcel number should match the Parcel ID below.")


def county_name(county):
    """SaltLake -> Salt Lake, the spelling the statewide viewer titles use."""
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", county)


def _fmt(ident, fmt):
    if fmt == "pad7":
        return ident.zfill(7)
    if fmt == "dash_2_4_4":
        return f"{ident[:2]}-{ident[2:6]}-{ident[6:]}"
    return ident


def statewide_url(county, lat, lon):
    """Statewide map centred on a point. Works for every county."""
    if lat is None or lon is None:
        return None
    x = lon * 20037508.342789244 / 180
    y = math.log(math.tan((90 + lat) * math.pi / 360)) * 6378137
    return STATEWIDE.format(county=urllib.parse.quote(county_name(county), safe=""),
                            x=round(x, 1), y=round(y, 1), scale=STATEWIDE_SCALE)


def pick_link(county, parcel_id, serial=None):
    """First verified county link whose id is present and in a verified shape."""
    ids = {"PARCEL_ID": (parcel_id or "").strip(), "SERIAL_NUM": (serial or "").strip()}
    for link in LINKS.get(county, {}).get("links", []):
        raw = ids[link["needs"]]
        if raw and re.match(link["pattern"], raw):
            return link, _fmt(raw, link.get("fmt"))
    return None, None


def parcel_url(county: str, parcel_id: str | None, serial: str | None = None,
               lat: float | None = None, lon: float | None = None) -> tuple[str | None, str | None, str | None]:
    """(url, kind, label) for one parcel. kind: parcel | search | statewide | homepage | None."""
    link, ident = pick_link(county, parcel_id, serial)
    if link:
        return link["url"].format(id=urllib.parse.quote(ident, safe="")), link["kind"], link["label"]
    url = statewide_url(county, lat, lon)
    if url:
        return url, "statewide", STATEWIDE_LABEL
    home = LINKS.get(county, {}).get("home")
    if home:
        return home, "homepage", f"{county_name(county)} County Assessor website"
    return None, None, None


# ---------------------------------------------------------------- self-test --

BROWSER = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9", "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none",
}


def fetch(url, login=False, timeout=60):
    """GET like a browser with cookies. login=True clicks EagleWeb's guest button."""
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
    try:
        r = op.open(urllib.request.Request(url, headers=BROWSER), timeout=timeout)
        final, status, body = r.url, r.status, r.read()
        if login and "/web/login.jsp" in final:
            post = final.split("?")[0].rsplit("/", 1)[0] + "/loginPOST.jsp"
            r = op.open(urllib.request.Request(post, data=b"submit=Public+Login&guest=true",
                                               headers=BROWSER), timeout=timeout)
            final, status, body = r.url, r.status, r.read()
        return status, body.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return type(e).__name__, ""


def sample(county):
    """One real candidate parcel from parcels.parquet, else any LIR parcel (Emery, San Juan have no candidates)."""
    import pyarrow.parquet as pq
    t = pq.read_table(DATA / "parcels.parquet", columns=["county", "parcel_id", "lat", "lon"],
                      filters=[("county", "=", county)])
    for pid, lat, lon in zip(*(t.column(c).to_pylist() for c in ("parcel_id", "lat", "lon"))):
        if pid:
            return pid, lat, lon, "candidate"
    q = urllib.parse.urlencode({"where": "PARCEL_ID IS NOT NULL", "outFields": "PARCEL_ID",
                                "resultRecordCount": 1, "returnGeometry": "true", "outSR": 4326, "f": "json"})
    f = get_json(f"{UGRC}/Parcels_{county}_LIR/FeatureServer/0/query?{q}")["features"][0]
    pts = [p for ring in f["geometry"]["rings"] for p in ring]
    return (f["attributes"]["PARCEL_ID"], sum(p[1] for p in pts) / len(pts),
            sum(p[0] for p in pts) / len(pts), "LIR (no candidates)")


def serial_for(county, pid):
    where = "PARCEL_ID='{}'".format(pid.replace("'", "''"))
    q = urllib.parse.urlencode({"where": where, "outFields": "SERIAL_NUM", "returnGeometry": "false", "f": "json"})
    for f in get_json(f"{UGRC}/Parcels_{county}_LIR/FeatureServer/0/query?{q}").get("features", []):
        if f["attributes"].get("SERIAL_NUM"):
            return f["attributes"]["SERIAL_NUM"]
    return None


def test_county(county):
    """One row per link the county can produce. Serial counties get a second row
    without the serial, which is what the site gets until parcels.parquet stores it."""
    entry = LINKS[county]
    pid, lat, lon, src = sample(county)
    rows = []
    if any(l["needs"] == "SERIAL_NUM" for l in entry["links"]):
        rows.append(test_link(county, pid, serial_for(county, pid), lat, lon, src))
    rows.append(test_link(county, pid, None, lat, lon, src))
    return rows


def test_link(county, pid, serial, lat, lon, src):
    entry = LINKS[county]
    url, kind, label = parcel_url(county, pid, serial, lat, lon)
    link, ident = pick_link(county, pid, serial)
    t0 = time.time()
    status, body = fetch(url, login=bool(link and link.get("login")))
    id_in_body = (ident in body) if ident else None
    record = "-"
    if link and not link.get("js_only"):
        check_body = body
        if link.get("check"):
            year = datetime.date.today().year
            _, check_body = fetch(link["check"].format(id=urllib.parse.quote(ident, safe=""), year=year))
        hit = link["hit"].format(id=ident, pid=pid)
        record = hit in check_body and not (link.get("miss") and link["miss"] in check_body)
    elif link:
        record = "js"
    home_status, _ = fetch(entry["home"])
    return dict(county=county, src=src, pid=pid, serial=serial, kind=kind, status=status,
                id_in_body=id_in_body, record=record, secs=round(time.time() - t0, 1),
                home=home_status, url=url)


if __name__ == "__main__":
    from concurrent.futures import ThreadPoolExecutor
    assert sorted(LINKS) == sorted(COUNTIES), "LINKS must cover all 29 counties"
    print(f"Parcel links self-test, {len(COUNTIES)} counties, browser headers, {datetime.date.today()}")
    with ThreadPoolExecutor(8) as ex:
        rows = [r for rs in ex.map(test_county, COUNTIES) for r in rs]
    print(f"{'county':<11} {'kind':<9} {'http':<5} {'id_in_body':<10} {'record':<6} "
          f"{'home':<5} {'secs':>5}  parcel_id / serial  url")
    problems = []
    for r in rows:
        print(f"{r['county']:<11} {r['kind']:<9} {str(r['status']):<5} {str(r['id_in_body']):<10} "
              f"{str(r['record']):<6} {str(r['home']):<5} {r['secs']:>5}  "
              f"{r['pid']}{' / ' + r['serial'] if r['serial'] else ''}"
              f"{'' if r['src'] == 'candidate' else ' [' + r['src'] + ']'}  {r['url']}")
        if r["kind"] in ("parcel", "search") and (r["status"] != 200 or r["record"] is False):
            problems.append(r["county"])
        if r["kind"] == "statewide" and r["status"] != 200:
            problems.append(r["county"])
    kinds = {}
    for r in rows:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    print(f"  kinds: {kinds}")
    print("  record: county page or its data source shows this parcel. js = checked by eye in a browser.")
    print("  home 403 for Garfield is a bot filter; it loads in a real browser.")
    if problems:
        print(f"  [FAIL] {problems}")
        sys.exit(1)
    print("  [OK] every county link returned its record")
