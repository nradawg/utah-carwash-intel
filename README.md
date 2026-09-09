# Utah Car Wash Site Intelligence

Site selection for car wash development across all 29 Utah counties. It ranks
45,140 candidate commercial parcels against real traffic counts, assessed land
values, census demographics and mapped competition, then explains why each site
ranks where it does.

You set the facility you want to build. Everything re-ranks in the browser.

**Live:** _(deployed URL)_

---

## What it answers

Not "where are the car washes" but "where should the next one go, and what is
the argument for it". Three things make that more than a dot map:

**A saturation read that is not published anywhere else.** Dividing county
population by mapped express tunnels gives a picture the industry talks about
in the abstract but has no public Utah figure for:

| County | Population | Wash facilities | Express tunnels | People per tunnel |
|---|---|---|---|---|
| Tooele | 76,648 | 8 | 1 | **76,648** |
| Box Elder | 59,725 | 8 | 1 | **59,725** |
| Summit | 42,709 | 5 | 1 | **42,709** |
| Cache | 137,031 | 20 | 4 | 34,257 |
| Davis | 366,742 | 36 | 14 | 26,195 |
| Salt Lake | 1,184,689 | 175 | 63 | 18,804 |
| Utah | 683,622 | 93 | 45 | 15,191 |
| Washington | 189,827 | 38 | 17 | 11,166 |
| Wasatch | 35,808 | 2 | **0** | no tunnel |

Industry guidance puts a healthy market at 25,000 to 35,000 people per express
tunnel. The Wasatch Front core is well past that. Tooele, Box Elder and Summit
are not, and Wasatch County has no express tunnel at all.

**Traffic is deliberately weighted low.** Most site-selection models lead with
car count. The evidence does not support it: DRB reports that car count has
almost no predictive value on site performance, MMCG attributes roughly 6% of
volume variance to it, and Retail Petroleum Consultants show capture rate
falling from 1.7% of passing traffic at 10,000 AADT to 0.5% at 80,000. Traffic
is treated as a screen with a floor, not a driver.

**Nothing is invented.** Where a value is inferred it says so. 61% of mapped
car washes carry no format tag, so format is resolved through observed tags,
then a verified brand table, then category, then name, and anything left is
shown as Unknown rather than guessed. Hover a competitor to see which rule
classified it.

## How scoring works

**Layer 1, hard gates.** Acreage, minimum lot dimension (225 ft fits a 125 ft
conveyor plus approach and exit), FEMA flood zone, posted speed, traffic floor,
budget. A site that fails is not ranked.

**Layer 2, weighted score.** Access and site 25, competitive position 25,
demand density 20, traffic quality 15, growth and durability 15. Every weight
is a slider.

Competition is weighted heavily because its downside is discontinuous: MMCG
document a cliff when a third tunnel opens within a mile. Demand outranks
traffic because the modern express wash is a subscription business, and Mister
Car Wash reported 79% of wash sales from unlimited members in Q4 2025, so what
matters is a resident base that can carry a monthly charge.

## Data sources

All free, all public. No paid API, no key required to run the pipeline.

| Source | What it gives | Licence |
|---|---|---|
| UGRC LIR parcels, 29 counties | land value, acreage, class, building sq ft | Public record |
| UDOT AADT 2024 | 4,565 segments, annual series back to 1981, truck share | Public record |
| UGRC roads via Open SGID | posted speed, functional class, local traffic counts | Public record |
| UGRC address points | 1,498,550 rooftops for trade-area density | Public record |
| ACS 2023 5-year summary file | income, households, vehicles, tenure, commute | Public domain |
| OpenStreetMap | car washes with format tags | ODbL |
| Overture Maps places 2026-08-19.0 | car washes, brands | CDLA / Apache 2.0 |
| FEMA NFHL | special flood hazard areas | Public domain |
| Census Building Permits | 2026 permits by county, the leading indicator | Public domain |
| CARTO basemap | dark raster tiles | OSM + CARTO attribution |

The published build carries open-licensed POIs only. Google-derived records are
excluded and live in a gitignored local overlay.

## Running it

```bash
uv venv --python python3.12 .venv
uv pip install --python .venv/bin/python duckdb requests pyarrow shapely scipy
.venv/bin/python scripts/run_all.py        # rebuild all data, about 5 minutes
cd app && npm install && npm run dev       # http://localhost:3111
```

Each ingest asserts its row count against what was verified when the pipeline
was written, so a source that changes shape fails loudly rather than quietly
producing a wrong map.

## Known limits

Stated plainly, and repeated in the app's Methodology tab:

- Emery and San Juan counties publish parcels but leave the property class
  field empty, so no candidate sites appear there. That is a county reporting
  gap, not an absence of commercial land.
- Utah's Farmland Assessment Act assesses qualifying land at agricultural
  rather than market value, clustering near $2,500 per acre. Those parcels are
  flagged, not hidden or imputed. Carbon County reports on a non-market basis
  throughout.
- UDOT counts cover state highways. Parcels with no UDOT segment within 500 ft
  fall back to local road counts, and some have no count at all.
- Flood screening tests the parcel centroid against FEMA polygons generalised
  to roughly 100 m. It is a screening flag, not a survey.
- Competitor coverage is what OSM and Overture have mapped. It is good but not
  a census of every wash bay in Utah.
