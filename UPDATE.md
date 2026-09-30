# Weekly data update (instructions for the scheduled Claude run, Mondays)

This repo feeds the RingsideRadar app. The app downloads `data-bundle/ringsideradar-data.json`
from GitHub whenever it opens. Each week: keep shows, champions and results current, rebuild, push.
Budget: **about 25 web fetches per run.** Skip anything that hasn't changed.

## 1. Clean up
Delete shows in `data-src/shows.json` whose date is before today.

## 2. Majors: last week's results and title changes
WWE (Raw, SmackDown, NXT, PLEs), AEW (Dynamite, Collision, PPVs), TNA, ROH, AAA, NJPW, CMLL.
- Title changes: https://en.wikipedia.org/wiki/2026_in_professional_wrestling (use the current year). Confirm each
  change with one news report (postwrestling.com, fightful.com, wrestlinginc.com), then close the old reign in
  `reigns.tsv` (end date) and add the new one.
- PLE/PPV results: that event's Wikipedia page. Weekly TV main events and title matches: the promotion's own
  results post (wwe.com, allelitewrestling.com) or a news recap. Add singles matches to `results.txt`.

## 3. Higher-level indie results (these move the rankings)
Open https://pwponderings.com/<year>/<month>/ (and /page/2/ etc. until you pass last week) and read the results
posts for: **GCW, MLW, AIW, NCG, JCW, Wrestling Open, Beyond, DEFY, West Coast Pro, Prestige, Black Label Pro,
House of Glory, Wrestling Revolver, IWTV-streamed Midwest shows**, and any Michigan/Ohio promotion.
Add singles results (skip tag and multi-team matches unless it's a title change for a tag title we track).
If the promotion isn't in `promotions.json` yet and it runs regularly, add it (tier 3 for national indies that tour
and stream, tier 2 for regional). One-off promotions: record their results under the closest tracked promotion
only if a tracked title was defended; otherwise skip.

## 4. New shows for the launch region (Michigan, Ohio, Windsor/Ontario border)
- https://www.allelitewrestling.com/aew-events
- https://www.wweschedule.com/wwe-schedule/2026 (current year)
- https://ncgwrestling.com/events, https://www.aiwrestling.com/events/, https://xicw.info/tickets/
- The newest "Upcoming Independent Wrestling Events" post on wrestlereality.substack.com (search its title plus
  this week's date) for Michigan and Ohio indie shows over the next 6 weeks.
Add advertised names to `featuring`. New addresses: geocode with
`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=<address>&benchmark=Public_AR_Current&format=json`;
no match → town center from `cities.json` with `"approx": true`.

## 5. PWI lists (once a year)
`data-src/pwi.txt` holds the PWI 500 (published each September) and PWI Women's 250 (published each November)
that anchor the rankings. When a new edition is out, add it as a new `##` section with its evaluation-period end
date and remove the older edition of that list.

## Rules
- Only record facts found in a source this run. Put the page in a show's `source` field.
- Never invent results, cards, times or champions. Unknown time → `"TBA"`.
- Names must match `wrestlers.tsv` (accents and case don't matter). New wrestler: add a line (name, m/f,
  promotions home first, rough follower estimate in thousands). PWI-ranked wrestlers we don't otherwise track live
  under the hidden `other` promotion automatically; when you add real info for one, add them to `wrestlers.tsv`.
- Tag titles in `reigns.tsv` are written `Team Name: Member + Member`.
- Don't fetch cagematch.net (it rate-limits automated reads).

## Finish
```bash
node scripts/build-data.mjs     # must print ✓ — fix every listed problem first
git add -A
git commit -m "Weekly data update YYYY-MM-DD: <one line on what changed>"
git push
```
If nothing changed, don't commit. End with a short summary: title changes, results added (majors / indies),
new shows, or "No changes this week."
