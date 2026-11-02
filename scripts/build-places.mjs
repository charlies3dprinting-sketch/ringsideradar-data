// Builds data-bundle/places.json: every US and Canadian town in the offline `cities.json` package
// (GeoNames, places with 1,000+ people), for the app's city search (wrestler "Based in" and promoter
// "Find talent"). One-off: rerun only to refresh it (`npm install`, then `node scripts/build-places.mjs`).
//
// Format: { "v": 1, "p": "name|ST|lat|lng\nname|ST|lat|lng…" }, ST = state or province code,
// lat/lng rounded to 2 decimals (about a mile). Sorted by name, duplicates (same name and state within
// ~5 miles, e.g. a city and its township) dropped.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let GEO = [];
try { GEO = require('cities.json'); } catch { console.error('Run `npm install` first (needs the cities.json package).'); process.exit(1); }
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const CA_PROV = { '01': 'AB', '02': 'BC', '03': 'MB', '04': 'NB', '05': 'NL', '07': 'NS', '08': 'ON', '09': 'PE', '10': 'QC', '11': 'SK', '12': 'YT', '13': 'NT', '14': 'NU' };
const US_STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split(' '));

const seen = new Map();
const rows = [];
for (const g of GEO) {
  const st = g.country === 'US' ? (US_STATES.has(g.admin1) ? g.admin1 : null) : g.country === 'CA' ? CA_PROV[g.admin1] : null;
  if (!st) continue;
  const name = g.name.replace(/\|/g, ' ').trim();
  const lat = Math.round(Number(g.lat) * 100) / 100, lng = Math.round(Number(g.lng) * 100) / 100;
  if (!name || Number.isNaN(lat) || Number.isNaN(lng)) continue;
  const k = `${name.toLowerCase()}|${st}`;
  const prev = seen.get(k);
  if (prev && prev.some(([a, b]) => Math.abs(a - lat) < 0.08 && Math.abs(b - lng) < 0.08)) continue;
  seen.set(k, [...(prev ?? []), [lat, lng]]);
  rows.push([name, st, lat, lng]);
}
rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
const out = { v: 1, p: rows.map((r) => r.join('|')).join('\n') };
const file = path.join(root, 'data-bundle', 'places.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log(`${rows.length} places (${rows.filter((r) => !US_STATES.has(r[1])).length} in Canada) → ${path.relative(root, file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
