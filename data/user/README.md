# Your own car washes

Put your own car wash points in this folder. The full steps are in
`docs/QGIS.md`, section 2.

1. In QGIS, right click your car wash layer, choose **Export**, then
   **Save Features As**, and save it into this folder as a **GeoPackage**.
   A CSV works too if it has `name`, `lat` and `lon` columns.
2. A `name` field helps. These fields are also used when present: `format`,
   `website`, `phone`, `address`, `notes`.
3. Remove the project's `gis` layers from QGIS (or close QGIS), because the
   second command below rewrites them.
4. Open Terminal in the project folder (see "Before you start" in
   `docs/QGIS.md`) and type these two commands, pressing Return after each:

   ```
   .venv/bin/python scripts/import_user_washes.py
   .venv/bin/python scripts/export_gis.py
   ```

5. Drag `gis/my_car_washes.gpkg` into QGIS to see your points.

Your points stay private and do not change the website. This folder (except
this note), `data/raw_user.json` and `gis/my_car_washes.gpkg` are left out of
what goes to GitHub, because points copied from Google Maps cannot be
published.

Only if none of your points came from Google Maps, you can let them count on
the website. In Terminal, in the project folder, create an empty file in this
folder named `PUBLISH_OK`, then run the refresh. Type these two lines,
pressing Return after each:

```
touch data/user/PUBLISH_OK
.venv/bin/python scripts/run_all.py
```

The live website only changes after the updated project files are uploaded to
GitHub and the site is rebuilt. The full steps are in `docs/QGIS.md`,
section 2.

To go back to private, delete that file and run the refresh again, pressing
Return after each line:

```
rm data/user/PUBLISH_OK
.venv/bin/python scripts/run_all.py
```
