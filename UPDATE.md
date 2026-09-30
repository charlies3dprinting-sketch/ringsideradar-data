# Daily data update (instructions for the scheduled Claude run)

This repo feeds the RingsideRadar app. The app downloads `data-bundle/ringsideradar-data.json`
from GitHub every time it opens. Your job each day: keep shows, champions and results current,
rebuild, and push. Keep it cheap: **aim for 15 web fetches or fewer per run** and skip anything
that hasn't changed.

## Every day

1. **Clean up.** Delete shows in `data-src/shows.json` whose date is before today.
2. **Yesterday's results and title changes (majors).** Check what ran yesterday (WWE Raw/SmackDown/NXT,
   AEW Dynamite/Collision, TNA iMPACT, any PLE/PPV). Best single source for title changes:
   https://en.wikipedia.org/wiki/2026_in_professional_wrestling (title changes table). For a PLE, read its
   Wikipedia results page. Add singles results to `results.txt`; update `reigns.tsv` (close the old reign
   with an end date, add the new one). Confirm any title change with one news report
   (postwrestling.com, fightful.com, wrestlinginc.com) before recording it.
3. **New announcements for the launch region** (Michigan, Ohio, Windsor/Ontario border). Check:
   - https://www.allelitewrestling.com/aew-events
   - https://www.wweschedule.com/wwe-schedule/2026 (or the current year)
   - https://ncgwrestling.com/events
   Add any new MI/OH/Windsor show and any new national PLE. Add advertised names to `featuring`.

## Mondays only (weekly sweep)

4. **Indie shows.** Read the newest "Upcoming Independent Wrestling Events" post on
   wrestlereality.substack.com (search the web for the title plus this week's date). Add Michigan and Ohio
   shows for the next 6 weeks. Then check these sites for new dates, champions and results:
   aiwrestling.com/events, xicw.info/tickets/, exoprowrestling.com, aswalive.com, pureprowrestling.net/live-events/.
   Indie results: pwponderings.com.
5. **Map pins.** Geocode new street addresses with the US Census geocoder:
   `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=<address>&benchmark=Public_AR_Current&format=json`.
   No match → use the town center from `cities.json` and set `"approx": true`.

## Rules

- Only record facts you found in a source today. Put the page in the show's `source` field.
- Never invent match cards or times. Unknown time → `"TBA"`. Unknown names → leave `featuring` out.
- Names must match `wrestlers.tsv` exactly; add new wrestlers there (name, m/f, promotions home first, rough
  follower estimate in thousands).
- Tag titles in `reigns.tsv` are written `Team Name: Member + Member`.
- Don't fetch cagematch.net (it rate-limits automated reads).

## Finish

```bash
node scripts/build-data.mjs     # must print ✓ — fix every listed problem before continuing
git add -A
git commit -m "Data update YYYY-MM-DD: <one line on what changed>"
git push
```

If nothing changed, don't commit. End with a 2–4 line summary of what changed (new shows, title changes,
results added) or "No changes today."
