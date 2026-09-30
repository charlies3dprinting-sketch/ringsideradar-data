# Weekly data update (instructions for the scheduled Claude run, Mondays)

This repo feeds the RingsideRadar app. The app downloads `data-bundle/ringsideradar-data.json`
from GitHub every time it opens. Your job each week: keep shows, champions and results current,
rebuild, and push. Budget: **about 30 web fetches per run**. Skip anything that hasn't changed.

Rankings are anchored to the PWI lists in `data-src/pwi.txt`; everything since the newest list's
evaluation period ended moves wrestlers up or down, with big-promotion results worth far more than
local ones. So the most valuable data is: **title changes, and singles results from majors and the
bigger indies.**

## 1. Clean up
Delete shows in `data-src/shows.json` whose date is before today.

## 2. Majors: last 7 days of results and title changes
- WWE (Raw, SmackDown, NXT, PLEs), AEW (Dynamite, Collision, PPVs), TNA, ROH, AAA, NJPW, CMLL.
- Title changes: https://en.wikipedia.org/wiki/2026_in_professional_wrestling (title-changes table; use the current
  year's page). Confirm each change with one news report (postwrestling.com, fightful.com, wrestlinginc.com).
- Results: Wikipedia pages for any PLE/PPV; weekly TV results from pwmania.com or wrestlinginc.com
  (search e.g. "WWE Raw results <date>"). Record **singles** results only (multi-person: winner vs each loser).
- Update `reigns.tsv` (close the old reign with an end date, add the new one; tag reigns `Team: A + B`).

## 3. Bigger indies: last 7 days of results
Priority order (stop when the fetch budget runs low):
1. GCW: pwponderings.com (search "Game Changer Wrestling <date> results") or fightful.com.
2. MLW: pwmania.com ("MLW Fusion results <date>").
3. AIW, NCG, XICW and other Michigan/Ohio promotions in `promotions.json`: their sites and pwponderings.com.
4. Other national indies that PWI ranks heavily (Wrestling Revolver, Beyond, DEFY, PWG, Black Label Pro,
   Wrestling Open): pwponderings.com. Only add a new promotion to `promotions.json` if it has recurring coverage;
   tier 3 = national indie, 2 = regional, 1 = local.

## 4. Upcoming shows (launch region: Michigan, Ohio, Windsor/Ontario border)
- https://www.allelitewrestling.com/aew-events, https://www.wweschedule.com/wwe-schedule/2026 (current year),
  https://ncgwrestling.com/events, aiwrestling.com/events, xicw.info/tickets/, exoprowrestling.com, aswalive.com.
- The newest "Upcoming Independent Wrestling Events" post on wrestlereality.substack.com (MI/OH listings).
- Add new shows for the next 8 weeks and any new national PLE. Put advertised names in `featuring`.
- Map pins: US Census geocoder
  `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=<address>&benchmark=Public_AR_Current&format=json`.
  No match → town center from `cities.json` and `"approx": true`.

## 5. New PWI lists
PWI publishes the PWI 500 around September, the Women's 250 around November and the Tag Team 100 around December.
If a new PWI 500 or Women's 250 is out, replace that list in `pwi.txt` (new `##` header with the list id, gender,
evaluation-period end date and source; names in rank order). Check a couple of names against a second source.

## Rules
- Only record facts found in a source this week. Put the page in a show's `source` field.
- Never invent match results, times or champions. Unknown time → `"TBA"`.
- Names must match `wrestlers.tsv` exactly (accents allowed; the build also matches PWI names loosely). Add new
  wrestlers there: name, m/f, promotions (home first), rough follower estimate in thousands.
- Don't fetch cagematch.net (it rate-limits automated reads).

## Finish
```bash
node scripts/build-data.mjs     # must print ✓ — fix every listed problem before continuing
git add -A
git commit -m "Weekly data update YYYY-MM-DD: <one line on what changed>"
git push
```
If nothing changed, don't commit. End with a short summary: new shows, title changes, results added.
