# Using this data in QGIS

The `gis` folder in this project holds map files you can open in QGIS. They
are the same data the website uses.

On the website, filled dots are candidate commercial lots, colored by score
from weak (red) to strong (green). They are not listings and are not
necessarily for sale. Ringed dots are car washes and detailers that already
exist.

This page has two kinds of boxes. Read the label above each one:

* **Type this in Terminal** means a command. Type it (or copy and paste it)
  into the Terminal window and press Return.
* **Type this in the QGIS Filter box (not Terminal)** means a line you type
  inside QGIS.

## Before you start

### Get the project (once)

1. Open https://github.com/nradawg/utah-carwash-intel in your web browser.
2. Click the green **Code** button, then **Download ZIP**.
3. Open your **Downloads** folder. If you see `utah-carwash-intel-main.zip`,
   double click it to unzip it. You now have a folder called
   `utah-carwash-intel-main`.
4. Drag the `utah-carwash-intel-main` folder onto your **Desktop**. This folder
   is the project folder for the rest of this page.

### Install QGIS (once)

1. Open https://qgis.org/download/ in your web browser.
2. Under **macOS**, click **Long Term Version for macOS**. That is the steady
   version QGIS suggests if you are not sure which one to pick. If a box asks
   for a donation, you can close it.
3. Open the downloaded file and drag **QGIS** into the **Applications** folder.
4. Open QGIS from Applications. If your Mac asks whether you are sure you want
   to open it, click **Open**.

### Open Terminal in the project folder

Sections 1 and 3 only need QGIS. You need Terminal, and the one time setup
below, only for sections 2, 4 and 5. Do this each time you want to run a
command.

1. Press **Command + Space**, type **Terminal** and press **Return**. A window
   with a blinking cursor opens.
2. Type `cd` and then one space. Do not press Return yet.
3. In Finder, drag the project folder (`utah-carwash-intel-main` on your
   Desktop) into the Terminal window. The folder's location appears after `cd`.
4. Press **Return**.

Keep that window open for the commands on this page. If you close it, do these
four steps again.

## One time setup

Do this once on each computer. It needs an internet connection.

1. Install uv, a free tool from Astral that sets up Python for this project.

   **Type this in Terminal**

   ```
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

2. When it says everything is installed, close the Terminal window, open a new
   one and get to the project folder again (the four steps above). The new
   window is what lets Terminal find uv.
3. Set up Python for the project and install the pieces it needs. Type the
   first line and press Return, wait for it to finish, then do the same with
   the second line.

   **Type this in Terminal**

   ```
   uv venv --python 3.12 .venv
   uv pip install --python .venv/bin/python duckdb requests pyarrow shapely scipy
   ```

   If it asks whether to replace the existing environment, type n and press
   Return, then run the second line. It then says it failed to create the
   environment, which is fine, because the one you already have is kept.

If Terminal ever says `command not found: uv`, close the window, open a new
one and try again. If it says `no such file or directory: .venv/bin/python`,
you are not in the project folder (see "Open Terminal in the project folder"
above), or setup has not been done yet.

## 1. Open the map layers

1. In Finder, open the project's `gis` folder.
2. Drag the `.gpkg` files you want onto the QGIS map. Each file is one layer.
3. For a background map, open the **Browser** panel, expand **XYZ Tiles** and
   double click **OpenStreetMap**. Drag it to the bottom of the Layers list.

| File | What it is |
|---|---|
| `sites.gpkg` | Every candidate lot: commercial parcels of at least half an acre that have an assessed land value, each with its car wash score. They are not listings and are not necessarily for sale. |
| `car_washes.gpkg` | The existing car washes and detailers shown on the website, from OpenStreetMap and Overture Maps. |
| `my_car_washes.gpkg` | Your own car wash points. It only appears after you add some (section 2) and it stays private. |
| `drive_times.gpkg` | Areas you can reach in 5 and 10 minutes of driving, worked out for sites spread about 0.4 miles apart. Each site's `drive_time_uid` in `sites.gpkg` says which of these areas belongs to it. |
| `counties.gpkg` | County population in 2020 and 2025, growth, and net moves from other US counties (people who moved in minus people who moved out), can be negative. |
| `cities.gpkg` | City limits with population in 2020 and 2025 and growth. |
| `tracts.gpkg` | Census tracts (the neighborhood areas the Census uses) with income, households and vehicles, from surveys taken 2019 to 2023. |
| `migration_flows_into_utah.gpkg` | Lines showing where people who moved into each Utah county came from. See section 3. |

**Color the sites by score**

1. Right click `sites` in the Layers list, then **Properties**, then **Symbology**.
2. Change **Single Symbol** to **Graduated**.
3. Set **Value** to `score`, pick a color ramp such as **RdYlGn**, click
   **Classify**, then **OK**.

`score` is a whole number from 0 to 100. It is the same number the website
shows before you change any of its settings.

**Show only the sites that pass the website's filters**

The column `fails_default_filters` is empty when a site passes the website's
starting filters. When a site fails, it says why in plain words, for example
that the lot is too small, the road carries too little traffic, or the lot is
in a flood zone.

1. Right click `sites` and choose **Filter**.
2. In the box at the bottom, type the line below and click **OK**.

**Type this in the QGIS Filter box (not Terminal)**

```
"fails_default_filters" IS NULL
```

This shows every site that passes those filters. The website goes two steps
further, so it shows fewer dots: where several passing lots are within a mile
of each other it keeps only the best one, and then it lists the top 200.

Use `uid` to tell sites apart. `parcel_id` can repeat, because county
assessors reuse ids.

**Color the car washes by type**

1. Right click `car_washes`, then **Properties**, then **Symbology**.
2. Change **Single Symbol** to **Categorized**, set **Value** to
   `format_label`, click **Classify**, then **OK**.

**Show the drive times for one site**

Drive areas were worked out for sites spread about 0.4 miles apart, so a site
often shares the drive area of a site close by. The column `drive_time_uid`
tells you which one to use.

1. Find the site's `drive_time_uid`. Click the **Identify Features** tool (the
   i button), select the `sites` layer in the Layers list, then click the site
   on the map. A panel opens with the site's details (click the small arrow
   next to the site if they are folded away). `drive_time_uid` is near the top,
   just below `score` and `fails_default_filters`. Note the number next to it.
2. Right click `drive_times` and choose **Filter**.
3. Type the line below, but put the `drive_time_uid` you noted between the
   single quotes in place of the words, then click **OK**.

**Type this in the QGIS Filter box (not Terminal)**

```
"uid" = '<drive_time_uid of the site you picked>'
```

Keep the single quotes. If `drive_time_uid` is empty for a site, there is no
drive area for it. Usually that is because the lot does not pass the basic
checks for size, flood zone, speed limit and traffic, and now and then it is
because the roads next to it could not be mapped.

To see a different site later, right click `drive_times`, choose **Filter**,
change the number and click **OK**. To show all drive areas again, clear the
box and click **OK**.

## 2. Add your own car washes

**Your points stay private.** They stay on your computer, they are left out
of what goes to GitHub, and they do not change the website, the scores or
`car_washes.gpkg`. That is on purpose: this project is public, and points
copied from Google Maps cannot be published, because Google does not allow its
map data to be republished. The only way to change that is the `PUBLISH_OK`
file described at the end of this section.

1. In QGIS, right click your car wash layer, then **Export**, then
   **Save Features As**.
2. Pick one of these two ways to save it.

   **GeoPackage (easiest).** Set **Format** to **GeoPackage**. Next to
   **File name**, click the **...** button, go into the project folder, then
   `data`, then `user`, and name the file `my_washes`. Leave the CRS as it is.
   Click **OK**.

   **CSV.** Set **Format** to **Comma Separated Value [CSV]**. Save it into the
   same `data/user` folder. Set **CRS** to **EPSG:4326** (named WGS 84). Under
   **Layer Options**, set **GEOMETRY** to **AS_XY**. Click **OK**.

   A spreadsheet also works. Save it as CSV into `data/user` with columns
   called `name`, `lat` and `lon`.

   Keep only one copy of each list in `data/user`. Every file in that folder
   is read, so saving the same points twice counts them twice.

3. A field called `name` is helpful. These fields are also used when they are
   there: `format`, `website`, `phone`, `address`, `notes`.
4. Read your points in. It prints how many points it found in each file.

   **Type this in Terminal**

   ```
   .venv/bin/python scripts/import_user_washes.py
   ```

5. Make the QGIS file. This rewrites every file in the `gis` folder, so first
   remove those layers from QGIS (select them, right click, **Remove Layer**)
   or close QGIS.

   **Type this in Terminal**

   ```
   .venv/bin/python scripts/export_gis.py
   ```

6. Drag `gis/my_car_washes.gpkg` onto the QGIS map to see your points, along
   with any other layers you want back.

Words that are understood in the `format` field: express, tunnel, conveyor,
flex, full serve, in bay, automatic, touchless, self serve, coin, hand,
detail, truck. Anything else, or a mix such as "self serve and automatic", is
worked out from the name instead.

**Only if none of your points came from Google Maps**, you can let them count
on the website. Then they are combined with the OpenStreetMap and Overture car
washes, and where one of yours sits on a wash those maps already have, your
name, phone and type are used.

1. Create an empty file named `PUBLISH_OK` in `data/user`.

   **Type this in Terminal**

   ```
   touch data/user/PUBLISH_OK
   ```

2. Run the refresh in section 5.
3. The live website only changes after the updated project files are uploaded
   to GitHub and the site is rebuilt.

To go back to private, delete that file and run the refresh again.

**Type this in Terminal**

```
rm data/user/PUBLISH_OK
```

## 3. See where people are moving

**Growth by county**

1. Drag in `counties.gpkg`.
2. **Properties**, **Symbology**, **Graduated**, **Value** `growth_pct`, pick a
   color ramp, **Classify**, **OK**. This is growth from April 2020 to July 2025.
3. Try **Value** `net_domestic_migration_2020_2025` instead. That is people who
   moved in from other US counties minus people who moved out, so it can be
   negative.

`cities.gpkg` works the same way with `growth_pct`, and shows growth inside a
county, for example Saratoga Springs against Provo.

**Flow lines**

1. Drag in `migration_flows_into_utah.gpkg`. Each line runs from the county
   people left to the Utah county they moved to, using tax returns filed in
   2022 and 2023.
2. **Properties**, **Symbology**, **Graduated**, **Value** `people`. Change
   **Method** from **Color** to **Size**, click **Classify**, then **OK**.
   Thicker lines mean more people.
3. To see one county, right click the layer, choose **Filter**, type the line
   below and click **OK**.

   **Type this in the QGIS Filter box (not Terminal)**

   ```
   "dest_county" = 'Utah County'
   ```

   To see only people who came from other states, use this line instead.

   **Type this in the QGIS Filter box (not Terminal)**

   ```
   "dest_county" = 'Utah County' AND "same_state" = false
   ```

What the columns mean:

| Column | Meaning |
|---|---|
| `people` | Everyone listed on the tax returns of the households that moved, so adults plus their children and other dependents. |
| `households` | The number of tax returns, which is close to the number of households. |
| `avg_agi_per_return` | The average income on those tax returns, in dollars. |

The IRS only lists a move between two counties when at least 20 households
made it, to protect privacy, so smaller moves have no line and are added up by
region in `gis/migration_other_flows.csv` instead.

Check that file before deciding a small county has no newcomers. Its `meaning`
column says what each row counts, and a blank number means the IRS hid it.

## 4. Draw a shape and get its population

1. In QGIS: **Layer**, **Create Layer**, **New GeoPackage Layer**. Save it as
   `my_area.gpkg` on your Desktop, set **Geometry type** to **Polygon**, click
   **OK**.
2. Click the pencil (**Toggle Editing**), then **Add Polygon Feature**. Click
   around the area, right click to finish, click **OK**, then click the pencil
   again and choose **Save**.
3. Count the people inside it.

   The easiest way to give a file location is to type the start of the
   command, then drag the file from Finder into the Terminal window. Terminal
   types the file's full location for you, and that handles spaces in names.
   Here, type `.venv/bin/python scripts/population_in_shape.py --shape` and
   one space, drag `my_area.gpkg` from your Desktop into Terminal, then type
   `--write ~/Desktop/my_area_population.gpkg` and press Return. Typing the
   whole line below works too.

   **Type this in Terminal**

   ```
   .venv/bin/python scripts/population_in_shape.py --shape ~/Desktop/my_area.gpkg --write ~/Desktop/my_area_population.gpkg
   ```

4. Drag `my_area_population.gpkg` from your Desktop into QGIS. Click it with the
   **Identify Features** tool (the i button) to see the numbers.

For a whole city, with or without a ring around it, skip the drawing. This
example is Tooele plus 1 mile around its city limits.

**Type this in Terminal**

```
.venv/bin/python scripts/population_in_shape.py --city "Tooele" --buffer-mi 1
```

It prints:

```
Tooele city limits plus 1 mile  (55.7 square miles)

                     2010      2020    Change
People             32,511    37,093    +4,582  (+14.1%)
Housing units      10,931    12,156    +1,225  (+11.2%)

These are the official census counts for April 2010 and April 2020. Each census
block counts as fully inside or fully outside, so edges are approximate.

Census estimate for Tooele, July 2025: 42,270 people (+18.3% since 2020).
That number covers the city limits only, not the 1 mile buffer,
so do not compare it with the table above.
```

The first time, it downloads about 290 MB of census files. After that each
answer takes a few seconds. If you type a file location that has spaces in
it instead of dragging the file in, put quotes around the whole location, like
the city name above.

## 5. Refresh everything

This downloads fresh data from every public source and rebuilds all the data,
including the website data and every file in `gis`. It takes a few minutes.
Remove the project layers from QGIS first (or close QGIS), because the files
are rewritten. Drag the layers back in when it finishes.

**Type this in Terminal**

```
.venv/bin/python scripts/run_all.py
```
