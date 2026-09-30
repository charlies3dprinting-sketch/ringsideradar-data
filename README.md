# RingsideRadar data

Show, champion and ranking data for the RingsideRadar app (Metro Detroit, Michigan, Ohio and the major promotions).

- `data-src/`: the editable sources (see the app project's DATA.md for every field).
- `scripts/build-data.mjs`: validates the sources and writes `data-bundle/ringsideradar-data.json`.
- `data-bundle/ringsideradar-data.json`: the file the app downloads.
- `UPDATE.md`: the daily update routine.

Rebuild after editing: `node scripts/build-data.mjs`
