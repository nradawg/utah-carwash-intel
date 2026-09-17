"""County population and growth: Census Population Estimates, Vintage 2025.

ACS 5-year tract totals describe 2019-2023 on average, which lags Utah's
fastest-growing counties by years (Tooele is up about 20% since 2020). The
saturation metric divides population by tunnels, so a stale numerator makes a
growing market look tighter than it is. PEP gives a July 2025 figure plus the
components of change, which show WHERE growth comes from: people moving in
from other counties versus births.

Keyless CSV. The *2020 component columns cover April to July 2020 only, so
"2020_2025" sums are April 2020 to July 2025 and "2021_2025" sums skip that
partial quarter.
"""
import sys, pathlib, csv, io, urllib.request
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import pyarrow as pa, pyarrow.parquet as pq
from common import DATA, UA, COUNTIES, assert_count

URL = ("https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/"
       "counties/totals/co-est2025-alldata.csv")
YEARS = range(2020, 2026)


def fetch():
    req = urllib.request.Request(URL, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:
        # latin-1, not utf-8: "Dona Ana County, NM" carries a raw 0xF1 byte.
        txt = r.read().decode("latin-1")
    # DictReader keeps every field a string, so STATE/COUNTY stay zero-padded.
    return [row for row in csv.DictReader(io.StringIO(txt))
            if row["SUMLEV"] == "050" and row["STATE"] == "49"]


def total(row, field, years):
    return sum(int(row[f"{field}{y}"]) for y in years)


if __name__ == "__main__":
    print("County population: Census PEP Vintage 2025")
    out = []
    for r in fetch():
        # "Box Elder County" -> "BoxElder", the pipeline's county key
        key = r["CTYNAME"].removesuffix(" County").replace(" ", "")
        base, pop = int(r["ESTIMATESBASE2020"]), int(r["POPESTIMATE2025"])
        # The yearly changes must add up to the 2025 estimate. If they do not,
        # a column was misread or the file layout changed.
        if base + total(r, "NPOPCHG", YEARS) != pop:
            raise RuntimeError(f"{key}: yearly changes do not sum to POPESTIMATE2025")
        out.append({
            "county": key, "fips": r["COUNTY"],
            "pop_2020_base": base, "pop_2025": pop,
            "growth_pct": round((pop / base - 1) * 100, 1),
            "net_domestic_2020_2025": total(r, "DOMESTICMIG", YEARS),
            "net_domestic_2021_2025": total(r, "DOMESTICMIG", range(2021, 2026)),
            "net_international_2020_2025": total(r, "INTERNATIONALMIG", YEARS),
            "natural_change_2020_2025": total(r, "NATURALCHG", YEARS),
            "net_migration_2025": int(r["NETMIG2025"]),
        })

    assert_count("Utah counties", len(out), 29)
    if len(out) != 29 or sorted(o["county"] for o in out) != sorted(COUNTIES):
        raise RuntimeError(f"expected the 29 pipeline county keys, got "
                           f"{sorted(o['county'] for o in out)}")
    out.sort(key=lambda o: o["fips"])
    pq.write_table(pa.Table.from_pylist(out), DATA / "county_pep.parquet", compression="zstd")
    print(f"  wrote data/county_pep.parquet  {len(out)} rows")
    for o in sorted(out, key=lambda o: -o["growth_pct"])[:5]:
        print(f"    {o['county']:<12} {o['pop_2020_base']:>9,} -> {o['pop_2025']:>9,} "
              f"({o['growth_pct']:+.1f}%)  net domestic {o['net_domestic_2020_2025']:+,}")
