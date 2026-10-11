# Weekly data update (instructions for the scheduled Claude run, Mondays)

This repo feeds the Ringside Radar app. The app downloads `data-bundle/ringsideradar-data.json`
from GitHub whenever it opens. Each week: keep shows (nationwide), champions and results current, rebuild, push.
Budget: **about 60 web fetches per run.** Skip anything that hasn't changed. Don't hand-edit `docs/`; the build
regenerates `docs/p/` (share pages) itself, and those changes are committed with the data.

Setup once per run: `npm install` (pulls the offline city list `scripts/add-shows.mjs` uses for map pins).

## 1. Clean up
Nothing to do by hand: `node scripts/build-data.mjs` moves shows dated before today from `shows.json` to `past.json`
(kept a year for promotion show history) and drops past Watch specials.

## 2. New shows → `incoming.txt` → `node scripts/add-shows.mjs incoming.txt`
Write every new show you find as one line in a scratch file `incoming.txt` (format is at the top of
`scripts/add-shows.mjs`: `promotion|state|website|date|time|show name|venue and street|city|ticket link|source`).
The script skips shows already listed, creates missing cities from an offline list, and adds unknown promotions as
tier 1 (Local). Delete `incoming.txt` afterwards; never commit it.

**Majors** (use the promotion id: wwe, nxt, aew, roh, tna, aaa, cmll, njpw). Raw is Monday, SmackDown Friday,
NXT Tuesday, Dynamite Wednesday, Collision Saturday; TNA tapes several TV episodes on one date, so TNA has fewer dates.
- https://www.wweschedule.com/wwe-schedule/2026 (current year): Raw, SmackDown, NXT, PLEs, house shows, AAA.
- https://www.allelitewrestling.com/aew-events (AEW and ROH)
- https://tnawrestling.com/events/
- https://cmll.com/ (the next week of Arena México / Arena Coliseo shows on the home page)
- Weekly NXT on The CW is at the WWE Performance Center, Orlando unless wweschedule lists it elsewhere; keep one
  line per Tuesday for the next 12 weeks (`nxt|FL||date|8:00 PM|NXT (weekly TV)|WWE Performance Center|Orlando|||https://en.wikipedia.org/wiki/WWE_NXT`).

**Indies, nationwide.** The newest "Upcoming Independent Wrestling Events" post on https://wrestlereality.substack.com/archive
lists ~800 US shows with venue, street, city, state, time and website. The post is too long to read in one fetch, so
fetch it several times, asking each time only for the events in one group of states, as pipe lines:
  1. AL AK AZ AR CA CO CT DE   2. FL GA HI ID IL   3. IN IA KS KY LA ME MD   4. MA MI MN MS MO MT NE NV
  5. NH NJ NM NY NC ND OH   6. OK OR PA RI SC SD   7. TN TX UT VT VA WA WV WI WY
A promotion with a `dormant` note in promotions.json has stopped running: its shows are skipped. Only remove the
note (and add shows) when the promotion itself announces a return.
If the newest post can't be fetched (robots.txt disallowed the 10.9.26 post on 2026-10-11), don't work around it and
don't re-read an older post's shows as new. Use the replacements below instead and say so in the summary.

**Indie sources when Wrestle Reality is missing, and every week in addition to it** (checked 2026-10-11):
- `sources/ticketmaster.txt`: refreshed every Monday 6 AM ET by the GitHub Action `ticketmaster.yml` from the
  Ticketmaster Discovery API (Ticketmaster + Universe listings, with exact venue coordinates). Read it, drop amateur or
  non-wrestling lines, fix promotion names against promotions.json, and copy the good lines into incoming.txt (they are
  already in add-shows format, lat|lng included). If the file is missing or old, the TM_API_KEY secret isn't set yet.
- https://independentwrestling.tv/schedule?lang=en : IWTV live events (Watch tab, and a lead for the show itself).
- https://www.trillertv.com/live/wrestling/ : TrillerTV live wrestling streams (Watch tab; the /schedule page is
  robots-blocked, don't use it).
- Regional calendars: California https://www.indydependent.com/full-list-of-events ; Chicago, Wisconsin and NW
  Indiana https://www.windycityslam.com/calendar-of-events (check each date on the promotion's own page; the calendar
  mixes old and undated rows).
- Big indies' own event pages, e.g. NWA https://www.nationalwrestlingalliance.com/nwaliveevents (stale when checked;
  only use dates in the future).
- Step 2b (state-by-state search of promotions' own and ticket pages, weekly series, IWTV promotions directory).
Not usable: dmvprowrestling.com (DMV weekend list) and trillertv.com/schedule are robots-blocked; allevents.in has no
pro wrestling listings; wrestlemap.com's event lists stopped in 2024; cagematch.net is off limits.
Skip micro/little-person touring shows (Little Mania, MicroMania, Micro Wrestling Federation, Midgets with Attitude,
Dwarfanators) and anything outside the US/Canada. Use the promotion's full name as it appears (the script matches it to
our existing promotions; check `promotions.json` for spelling first so you don't create duplicates).
California has its own calendar with more shows: https://www.indydependent.com/full-list-of-events.

**Exact pins (optional, when budget allows):** for a new venue with a street address, geocode it with
`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=<street, city, ST>&benchmark=Public_AR_Current&format=json`
and put the lat|lng as fields 11 and 12. Without them the pin is the town centre (marked approximate).

## 2b. Coverage expansion (about 8 fetches; this is how we catch up with apps like Hot Tag)
Listing sites only carry part of the indie scene. Each week, also:
- **Weakest states first.** Count upcoming shows per state (`node -e` over shows.json + cities.json). Pick the two
  most populous states with the fewest shows (e.g. TX, NY, MI, VA, NJ) and WebSearch "<state> pro wrestling tickets",
  "<city> independent wrestling" and Eventbrite/TicketLeap/Tickeri/SimpleTix results for that state. For each promotion
  found, open its own website or ticket page and add its upcoming dated shows through add-shows.mjs (source = that page).
- **Weekly series.** When a promotion's own site or page states a regular schedule ("every Thursday at Pinballz"), add
  a rule to `data-src/recurring.json` instead of single dates; the build keeps 12 weeks of dates filled in. Add `until`
  or `skip` when they announce a break, and remove the rule if they stop.
- **Promotion directories** for leads: https://en.wikipedia.org/wiki/List_of_independent_wrestling_promotions_in_the_United_States
  (125 promotions by region) and TrillerTV channel pages.
- **IWTV directory.** https://independentwrestling.tv/promotions lists promotions that stream; any US one we don't track
  is a lead: add it (tier 1, `watch` ["IWTV"], `watchLinks`) and look for its upcoming shows.
- Competitor apps and sites (Hot Tag etc.) are never a source: don't copy their listings or scrape them. A show goes in
  only from the promotion's own page, a ticket page, or one of the listing sources above.
- In the summary, report shows added per state from this step.

## 3. Majors: last week's results and title changes
WWE (Raw, SmackDown, NXT, PLEs), AEW (Dynamite, Collision, PPVs), TNA, ROH, AAA, NJPW, CMLL.
- Title changes: https://en.wikipedia.org/wiki/2026_in_professional_wrestling (use the current year). Confirm each
  change with one news report (postwrestling.com, fightful.com, wrestlinginc.com), then close the old reign in
  `reigns.tsv` (end date) and add the new one.
- PLE/PPV results: that event's Wikipedia page. Weekly TV main events and title matches: the promotion's own
  results post (wwe.com, allelitewrestling.com) or a news recap. Add singles matches to `results.txt`.
- Wrestler pages show each wrestler's last 5 results, so prefer adding every singles match from PLEs and the main
  events of weekly TV over deep coverage of one show.

## 4. Higher-level indie results (these move the rankings)
Open https://pwponderings.com/<year>/<month>/ (and /page/2/ etc. until you pass last week) and read the results
posts for national and regional indies we track (tier 3 and 2 in `promotions.json`: Wrestling Open/Beyond, AAW, OVW,
NWA, DEFY, Wrestling Revolver, HOG, JCW, West Coast Pro, GCW, MLW, AIW, NCG, Zero1 USA, STL Anarchy, Warrior,
Limitless, IWC, F1RST, ICW MKE, and so on) plus any Michigan/Ohio promotion.
Add singles results (skip tag and multi-team matches unless it's a title change for a tag title we track).
Fans also report results from shows they attend in the app; those live in the app's database, not here.

**Also:** Voices of Wrestling's weekly column "The U.S. Independent" (voicesofwrestling.com, search "The U.S. Independent")
reports indie title changes and notable results; confirm each on the promotion's page or a results post before recording.

## 4b. Watch tab (`data-src/watch.json`, about 6 fetches)
The Watch tab lists every watchable event, free or paid: weekly TV, major PLEs/PPVs, and indie shows that stream.
The build sorts specials by date, then majors first (tier 4 → 1), then by time, so today's events and the majors
come first.
- `series`: weekly TV (Raw, NXT, Dynamite, TNA, SmackDown, Collision, AAA). Only change one when a source says its
  network, day or time changed.
- `specials` (hand-written, majors): every big event for the next ~3 months: WWE PLEs, NXT PLEs (e.g. Halloween
  Havoc), AEW PPVs, TNA PPVs (Bound for Glory, Destination X …), AAA PLEs (Héroes Inmortales, Guerra de Titanes),
  NJPW majors (King of Pro-Wrestling, Power Struggle, Wrestle Kingdom), plus big streaming specials. Check that every
  such event already in `shows.json` has a special; use the event's Wikipedia page or promotion page for date, start
  time (24h, America/New_York, only when a source gives it), where to watch and access (free / sub / ppv). Never guess
  a platform: if no source says where it airs, leave it out and mention it in the summary.
- Indie streams are automatic: `build-data.mjs` adds every upcoming show (next `indieDays` days) from a tier 1–3
  promotion whose `watch` field in `promotions.json` names a platform listed in watch.json `platforms`
  (IWTV, TrillerTV, YouTube, Facebook …). To grow this list, each week fill in `watch` for 3–5 promotions that have
  upcoming shows but an empty `watch`, from their own website/socials or IWTV/TrillerTV pages (biggest tiers first).
  Whenever you set `watch`, also set `watchLinks` to the promotion's OWN page on each platform, never a platform home
  page: IWTV → `https://independentwrestling.tv/promotions/<slug>` (find the slug on
  https://independentwrestling.tv/promotions), YouTube → the channel (`https://www.youtube.com/@handle`, taken from the
  promotion's own website), Facebook → its page. The app's "Watch on …" buttons use these links; without one it falls
  back to the promotion's website.
  Facebook links: always write `https://www.facebook.com/...` (never `fb.com`), and only add one after opening it and
  seeing the promotion's page with recent posts. Indie promotions often abandon a page and start a new one (look for a
  "follow our new page" post) or let it go dark; a dead page shows "This content isn't available right now". If a
  promotion has no working Facebook page, use its YouTube channel or website instead.
  A new platform goes into `platforms` with its access (free / sub) and link.
- Indie events with a confirmed live stream time (IWTV live schedule https://independentwrestling.tv/schedule?lang=en — one fetch lists every
  upcoming live IWTV event with ET start time; add each as `iwtv-<promotion>-<date>` with where ["IWTV"] and the access
  the schedule shows (it lists them as PPV), creating a tier-1 promotion with watch ["IWTV"] if we don't track it; TrillerTV
  event pages, or a big indie's own announcement) can be added as a hand-written special for that promotion and date
  with the exact start time; it replaces the automatic entry.
- `changes`: date-specific moves or pre-emptions you see in news (e.g. "Dynamite moves to Tuesday this week"):
  `{ "series": "dynamite", "date": "<normal date>", "to": "<new date>", "time": "HH:MM or empty", "note": "...", "source": "..." }`,
  or `"off": true` when an episode isn't airing. Never guess.

## 5. New wrestlers
New wrestler: add a line to `wrestlers.tsv` (name, m/f, promotions home first, rough follower estimate in thousands).
Photos (`photos.tsv` + `docs/photos/`) and career championships (`career.json`, from Wikipedia) are refreshed in
occasional manual sessions, not by this weekly run. Don't edit them here.

## 6. PWI lists (once a year)
`data-src/pwi.txt` holds the PWI 500 (published each September) and PWI Women's 250 (published each November)
that anchor the rankings. When a new edition is out, add it as a new `##` section with its evaluation-period end
date and remove the older edition of that list. PWI ranks are used inside the ranking formula only; the app does
not display them.

## Rules
- Only record facts found in a source this run. Put the page in a show's `source` field.
- Never invent results, cards, times or champions. Unknown time → `"TBA"`.
- Names must match `wrestlers.tsv` (accents and case don't matter). PWI-ranked wrestlers we don't otherwise track live
  under the hidden `other` promotion automatically; when you add real info for one, add them to `wrestlers.tsv`.
- Tag titles in `reigns.tsv` are written `Team Name: Member + Member`.
- Don't fetch cagematch.net (it rate-limits automated reads).

## Finish
```bash
node scripts/build-data.mjs     # must print ✓ — fix every listed problem first
git add -A        # includes data-src/past.json and docs/p/
git commit -m "Weekly data update YYYY-MM-DD: <one line on what changed>"
git push
```
If nothing changed, don't commit. End with a short summary: title changes, results added (majors / indies),
new shows (majors / indies), new promotions, or "No changes this week."
