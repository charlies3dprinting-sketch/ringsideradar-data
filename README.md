# RingsideRadar data

Show, champion and ranking data for the RingsideRadar app (Metro Detroit, Michigan, Ohio and the major promotions).

- `data-src/`: the editable sources (see the app project's DATA.md for every field).
- `scripts/build-data.mjs`: validates the sources and writes `data-bundle/ringsideradar-data.json`.
- `data-bundle/ringsideradar-data.json`: the file the app downloads.
- `UPDATE.md`: the weekly update routine (Mondays).
- `data-src/pwi.txt`: the PWI 500 and Women's 250 lists the rankings are anchored to.

Rebuild after editing: `node scripts/build-data.mjs`
