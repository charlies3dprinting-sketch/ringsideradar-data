# ringsideradar.com

The website, hosted on Cloudflare Pages (project root `site/`, output `dist`, no build command).

- `dist/` is the Ringside Radar app exported for the web. It's built from the app project with
  `node scripts/build-web.mjs` (writes `web/dist`), then copied here. Don't edit it by hand.
- `functions/` + `lib/preview.js` give shared links (wrestler, promotion, show, title, team, fan, group pages)
  their own preview title, description and image. They read the share pages in `docs/p/`, which the weekly
  data update rebuilds, so new wrestlers and shows get previews without redeploying the site.
- The site loads show data from `data-bundle/` at runtime, same as the app.
