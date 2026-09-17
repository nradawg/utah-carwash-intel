# Utah Car Wash Site Intelligence

A map for deciding where a new car wash could go in Utah. It looks at
commercial lots in 27 of Utah's 29 counties and scores each one on how well the
lot and its road suit a car wash, how many car washes are already nearby, how
many people and homes are around it, the traffic on its road, and how fast the
area is growing. Emery and San Juan counties do not record property types in
their parcel data, so no lots are listed there. You can change the lot size,
budget and how much each part counts, and the ranking updates in the browser.

**Live:** https://utah-carwash-intel.vercel.app

**What the dots mean.** Filled dots are candidate commercial lots, colored by
score from weak (red) to strong (green). They are not listings and are not
necessarily for sale. Ringed dots are car washes and detailers that already
exist, from OpenStreetMap and Overture Maps. The number of lots changes a
little each time the data is rebuilt, and the header of the website shows the
current count.

The site's **Counties** page shows people per express car wash for every
county, using the Census estimates for July 2025. The **How it works** page
explains the score and the known limits of the data, such as counties that do
not report property types and farmland assessed below market value.

## Use it in QGIS

Every layer is in the `gis` folder as a GeoPackage you can drag into QGIS.
[docs/QGIS.md](docs/QGIS.md) explains how to download this project and QGIS,
open and color the layers, add your own car washes privately, see where people
are moving, and count the people inside any shape you draw. It is written for
someone who has never used Terminal, and it includes the one time setup.

## Rebuild the data

After the one time setup in [docs/QGIS.md](docs/QGIS.md), one command
downloads fresh data from every public source and rebuilds the website data
in `app/public/data` and the QGIS files in `gis`:

```
.venv/bin/python scripts/run_all.py
```

It takes a few minutes. Each step checks its row count against a figure
verified when the step was written. If a count drifts too far, it stops the
run, so a source that changes shape cannot quietly produce a wrong map.

To preview the website on your own computer, run `npm install` and then
`npm run dev` inside the `app` folder, and open http://localhost:3111.

## Data licences

All data is free and public, and no API key is needed. Credits and terms for
each source (OpenStreetMap, Overture Maps, US Census Bureau, IRS, FEMA, UGRC
and UDOT) are in [DATA_LICENSES.md](DATA_LICENSES.md), and the full licence
texts that have to travel with the data are in the [LICENSES](LICENSES)
folder and [NOTICE-FOURSQUARE.txt](NOTICE-FOURSQUARE.txt). The current version
of this project contains no Google Maps data.
