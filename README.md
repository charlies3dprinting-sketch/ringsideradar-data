# Ringside Radar data

Show, champion and ranking data for the Ringside Radar app: WWE, AEW, TNA and the other majors, plus about 250 US indie promotions nationwide.

- `data-src/`: the editable sources (see the app project's DATA.md for every field).
- `scripts/build-data.mjs`: validates the sources and writes `data-bundle/ringsideradar-data.json`.
- `data-bundle/ringsideradar-data.json`: the file the app downloads.
- `data-bundle/places.json`: every US and Canadian town (1,000+ people) for the app's town search (wrestler "Based in",
  promoter Find talent). Built once by `scripts/build-places.mjs` from the `cities.json` package; the weekly update doesn't touch it.
- `UPDATE.md`: the weekly update routine (Mondays).
- `data-src/pwi.txt`: the PWI 500 and Women's 250 lists the rankings are anchored to (used in the formula, never shown).
- `data-src/photos.tsv`: free-licensed wrestler photos from Wikimedia Commons, credited in the app.
- `scripts/add-shows.mjs`: adds new shows from a pipe-separated list, creating cities and promotions (`npm install` first).
- `docs/`: privacy policy, account deletion page and support page (GitHub Pages).

Rebuild after editing: `node scripts/build-data.mjs`
