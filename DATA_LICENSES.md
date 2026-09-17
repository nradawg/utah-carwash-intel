# Data licences

Everything in this project comes from free public sources. This page says what
data is in this repository, on the website and in the QGIS files in the `gis`
folder, who made it, and the terms that come with it. Links were checked on
17 September 2026.

**The current version of this repository contains no Google Maps data**, and
neither do the website or the `gis` folder. Google does not allow its map data
to be republished. The folder `data/local` and the file `data/carwashes.parquet`
can hold a wider local list on the computer that builds the data, and the
repository's `.gitignore` file keeps them out of what goes to GitHub. Car
washes you add yourself in `data/user` also stay on your computer, along with
`data/raw_user.json` and `gis/my_car_washes.gpkg`, unless you create the file
`data/user/PUBLISH_OK` (see [docs/QGIS.md](docs/QGIS.md), section 2).

**Licence texts.** The full Apache 2.0 licence is in
[LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt), and Foursquare's notice is
in [NOTICE-FOURSQUARE.txt](NOTICE-FOURSQUARE.txt). Both go with any copy of the
car wash data (see the Foursquare notice section at the end of this page).

## OpenStreetMap

**Credit:** © OpenStreetMap contributors

**Licence:** [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
OpenStreetMap explains it on its [copyright page](https://www.openstreetmap.org/copyright).

**Where it is used:** the car wash points in `data/raw_osm.json`,
`data/carwashes_open.parquet`, `app/public/data/carwashes.parquet` (the
website) and `gis/car_washes.gpkg`. The counts of nearby car washes on each
site, in `data/sites.parquet`, `app/public/data/sites.parquet` and
`gis/sites.gpkg`, are worked out from this data too.

**What that means:**

1. Attribution: wherever you show or share this data, say it comes from
   © OpenStreetMap contributors.
2. Share alike: if you share a changed or combined copy of the car wash data,
   such as `car_washes.gpkg`, you have to share it under the ODbL as well.

## Overture Maps Foundation places

**Credit:** Overture Maps Foundation, places theme, release 2026-08-19.0

**Licence:** the places theme is
[CDLA Permissive 2.0](https://cdla.dev/permissive-2-0/) for data from Meta,
Microsoft, BrightQuery and the other providers Overture lists. Overture's
[attribution page](https://docs.overturemaps.org/attribution/) names two
exceptions, and the Utah car washes here include both:

1. Records from Foursquare are under
   [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0) (full text in
   [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt)), and Foursquare asks
   that its [NOTICE.txt](https://opensource.foursquare.com/places-notice-txt/)
   is shared along with the data. It is in
   [NOTICE-FOURSQUARE.txt](NOTICE-FOURSQUARE.txt).
2. Records from AllThePlaces are under
   [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), which means
   no restrictions.

**Where it is used:** `data/raw_overture.json`, `data/carwashes_open.parquet`,
`app/public/data/carwashes.parquet` and `gis/car_washes.gpkg`, plus the nearby
car wash counts on each site.

**What that means:** free to use and share, including for business, as long
as the credit and licence notices go with it. Because `car_washes.gpkg`
combines Overture and OpenStreetMap points, the OpenStreetMap share alike rule
above applies to that combined file.

## US Census Bureau

**Credit:** Source: U.S. Census Bureau

**Where it is used:**

| Census product | Files |
|---|---|
| American Community Survey, 2019 to 2023 (income, households, vehicles, commuting) | `data/demographics.parquet`, `gis/tracts.gpkg`, and the neighborhood columns in the site files |
| Census tract shapes, 2023 ([TIGERweb](https://tigerweb.geo.census.gov/), part of the Census TIGER map files) | `data/tracts.parquet`, `gis/tracts.gpkg`, and matching each site to its tract |
| Population estimates for counties and cities, 2020 to 2025 | `data/county_pep.parquet`, `data/cities.parquet`, `gis/counties.gpkg`, `gis/cities.gpkg` |
| Building permits, 2026 | `data/permits.parquet` |
| County center points (Gazetteer) | the line ends in `gis/migration_flows_into_utah.gpkg` |
| 2010 and 2020 census block counts | downloaded by `scripts/population_in_shape.py` into `data/cache`, which is not part of the repository |

**Terms:** public domain. Work made by the US federal government is not
covered by copyright in the United States
([USA.gov explains the rule](https://www.usa.gov/government-copyright)), and the
Census Bureau publishes its data as [open data](https://www.census.gov/topics/research/research-transparency-public-access/open-data.html).

## IRS Statistics of Income

**Credit:** Source: IRS Statistics of Income, county to county migration data,
tax filing years 2022 to 2023

**Where it is used:** `gis/migration_flows_into_utah.gpkg` and
`gis/migration_other_flows.csv`. The raw download sits in `data/cache`, which
is not part of the repository.

**Terms:** public domain, as work of the US federal government
([USA.gov explains the rule](https://www.usa.gov/government-copyright)). The
source is the IRS [migration data page](https://www.irs.gov/statistics/soi-tax-stats-migration-data).

## FEMA flood maps

**Credit:** Source: FEMA National Flood Hazard Layer

**Where it is used:** `data/flood.parquet`, and the flood zone flag on each site.

**Terms:** public domain, as work of the US federal government. The source is
FEMA's [National Flood Hazard Layer](https://www.fema.gov/flood-maps/national-flood-hazard-layer).

## State of Utah: UGRC (SGID)

**Credit:** Utah Geospatial Resource Center (UGRC), State Geographic
Information Database (SGID), data modified

**Licence:** UGRC's [license page](https://gis.utah.gov/documentation/policy/license/)
says its data is under
[Creative Commons Attribution 4.0 (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)
unless a dataset says otherwise. Anyone sharing a copy has to credit UGRC,
link that licence and say what was changed. UGRC also asks that its disclaimer
goes with the data. In short, the data is provided as is, for information
only, with no promise that it is complete or correct, and a qualified
professional should check any location before you rely on it. The full
wording, which UGRC asks to travel with the data unchanged, is below. Roads and address points were read from the
Open SGID database, which has its own
[terms of use](https://gis.utah.gov/documentation/policy/open-sgid/).

**UGRC disclaimer (unmodified):**

> The data, including but not limited to geographic data, tabular data, and analytical data, are provided “as is” and “as available”, with no guarantees relating to the availability, completeness, or accuracy of data, and without any express or implied warranties. These data are provided as a public service for informational purposes only. You are solely responsible for obtaining the proper evaluation of a location and associated data by a qualified professional. UGRC reserves the right to change, revise, suspend or discontinue published data and services without notice at any time. Neither UGRC nor the State of Utah are responsible for any misuse or misrepresentation of the data. UGRC and the State of Utah are not obligated to provide you with any maintenance or support. The user assumes the entire risk as to the quality and performance of the data. You agree to hold the State of Utah harmless for any claims, liability, costs, and damages relating to your use of the data. You agree that your sole remedy for any dissatisfaction or claims is to discontinue use of the data.

**Where it is used:**

| UGRC data | Files |
|---|---|
| [County parcels](https://gis.utah.gov/products/sgid/cadastre/parcels/) with tax roll details (LIR) | `data/parcels.parquet` and every site file |
| [Roads](https://gis.utah.gov/products/sgid/transportation/road-centerlines/) with speed limits and road types | `data/roads.parquet`, the road columns and the street point used for the Street View link on each site, `gis/drive_times.gpkg` |
| [Address points](https://gis.utah.gov/products/sgid/location/address-points/) | `data/rooftops.parquet` (counted into a grid, not individual addresses) |
| [City limits](https://gis.utah.gov/products/sgid/boundaries/municipal/) | `data/cities.parquet`, `gis/cities.gpkg`, and `scripts/population_in_shape.py --city` |
| [County boundaries](https://gis.utah.gov/products/sgid/boundaries/county/) | `data/counties_geom.parquet`, `gis/counties.gpkg`, and which county each car wash is counted in |

**What was changed:** parcels were filtered to commercial lots of at least half
an acre and joined with the other sources, roads were simplified, address
points were counted into a grid, drive time areas were worked out from the
roads, and a few city records with the wrong Census code were corrected.

## State of Utah: UDOT

**Credit:** Utah Department of Transportation, AADT 2024 traffic counts

**Where it is used:** `data/traffic.parquet` and the traffic columns on each
site.

**Terms:** published free on the [UDOT Open Data portal](https://data-uplan.opendata.arcgis.com/).
The [dataset page](https://www.arcgis.com/home/item.html?id=52da935542464cdaa29fc872a489b580)
names no licence. It says the data is for information only, has to be checked
in the field before it is used on a project, and comes with no warranty from
UDOT.

## Website base map

The dark map behind the website is drawn by
[OpenFreeMap](https://openfreemap.org/), free with no key. Its credit line,
which the website shows behind the small i button in the corner of the map,
is: OpenFreeMap, © [OpenMapTiles](https://openmaptiles.org/), data from
[OpenStreetMap](https://www.openstreetmap.org/copyright). None of the base map
is stored in this repository.

## Foursquare notice

Some Overture places come from Foursquare under Apache 2.0. Foursquare's
notice is in [NOTICE-FOURSQUARE.txt](NOTICE-FOURSQUARE.txt) and the full
Apache 2.0 licence is in [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt).
Both apply to `data/carwashes_open.parquet`, `app/public/data/carwashes.parquet`
and `gis/car_washes.gpkg`, so keep both files with any copy of that data you
share.
