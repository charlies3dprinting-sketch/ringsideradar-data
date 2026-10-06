// Adds new shows from a simple pipe-separated file, creating cities and (local) promotions as needed.
//
//   npm install            (once; pulls the offline city list used for map pins)
//   node scripts/add-shows.mjs incoming.txt
//
// incoming.txt, one show per line (blank lines and # comments ignored):
//   promotion|state|website|date|time|show name|venue and street address|city|ticket link|source page
// - promotion: an id from promotions.json (e.g. wwe, aiw) or a promotion's full name. Unknown names become
//   new tier-1 (Local) promotions; set the tier by hand in promotions.json if they're bigger.
// - state: US state code (MI), Canadian province code (ON), or a country name for anywhere else.
// - date YYYY-MM-DD; time like "7:30 PM" or TBA. Ticket link and website may be empty.
// - optional 11th and 12th fields: lat|lng of the venue (e.g. from the Census geocoder). Without them the pin
//   goes on the town centre and the show is marked approximate (wider check-in radius).
// Skips shows already listed (same promotion, date and city) and shows before today.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let GEO = [];
try { GEO = require('cities.json'); } catch { console.error('Run `npm install` first (needs the cities.json package).'); process.exit(1); }
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = path.join(root, 'data-src');
const file = process.argv[2];
if (!file) { console.error('usage: node scripts/add-shows.mjs incoming.txt'); process.exit(1); }

const promotions = JSON.parse(fs.readFileSync(path.join(D, 'promotions.json'), 'utf8'));
const cities = JSON.parse(fs.readFileSync(path.join(D, 'cities.json'), 'utf8'));
const shows = JSON.parse(fs.readFileSync(path.join(D, 'shows.json'), 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^(st\.?|saint) /, 'saint ').replace(/^(ft\.?|fort) /, 'fort ').replace(/^(mt\.?|mount) /, 'mount ').replace(/[^a-z ]/g, '').trim();
const STATES = { AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'Washington DC',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming' };
const CA_PROV = { AB: '01', BC: '02', MB: '03', NB: '04', NL: '05', NS: '07', ON: '08', PE: '09', QC: '10', SK: '11' };
const COUNTRY = { Mexico: 'MX', Japan: 'JP', Australia: 'AU', UK: 'GB', 'United Kingdom': 'GB', 'Saudi Arabia': 'SA', Germany: 'DE', France: 'FR', Ireland: 'IE' };
const byKey = new Map(); const byName = new Map();
for (const g of GEO) { const k = `${g.country}|${g.admin1}|${norm(g.name)}`; if (!byKey.has(k)) byKey.set(k, g); const n = `${g.country}|${norm(g.name)}`; if (!byName.has(n)) byName.set(n, g); }

const problems = [];
function cityFor(name, state) {
  const ex = cities.find((c) => norm(c.name) === norm(name) && c.state === state);
  if (ex) return ex;
  let g;
  if (STATES[state]) g = byKey.get(`US|${state}|${norm(name)}`);
  else if (CA_PROV[state]) g = byKey.get(`CA|${CA_PROV[state]}|${norm(name)}`);
  else if (COUNTRY[state]) g = byName.get(`${COUNTRY[state]}|${norm(name)}`);
  if (!g) { problems.push(`no map location for "${name}, ${state}": add it to data-src/cities.json by hand`); return null; }
  let id = slug(`${name}-${state}`); let n = 2; while (cities.some((c) => c.id === id)) id = `${slug(`${name}-${state}`)}-${n++}`;
  const c = { id, name, state, lat: +(+g.lat).toFixed(4), lng: +(+g.lng).toFixed(4) };
  cities.push(c);
  return c;
}
function promotionFor(raw, state, website) {
  const name = raw.replace(/\s*\([^)]+\)\s*$/, '').trim();
  const same = (x) => [raw, name].some((n) => x.name.toLowerCase() === n.toLowerCase() || x.short.toLowerCase() === n.toLowerCase());
  const byId = promotions.find((x) => x.id === raw);
  if (byId) return byId;
  const hits = promotions.filter(same);
  // Same name in two states (e.g. two "Pure Pro Wrestling"s): pick the one from this state.
  const p = hits.find((x) => x.area === (STATES[state] ?? state)) ?? (hits.length === 1 && hits[0].tier >= 3 ? hits[0] : hits.length === 1 && !STATES[state] ? hits[0] : undefined);
  if (p) return p;
  const short = (raw.match(/\(([^)]+)\)\s*$/) || [])[1] ?? (name.length <= 18 ? name : name.slice(0, 18));
  let id = slug(short).slice(0, 20); let n = 2; while (promotions.some((x) => x.id === id)) id = `${slug(short).slice(0, 18)}-${n++}`;
  const np = { id, name, short, tier: 1, country: STATES[state] ? 'USA' : state, area: STATES[state] ?? state, cities: [], viewership: 1, attendance: 3, watch: [] };
  if (website) np.website = /^https?:/.test(website) ? website : `https://${website}`;
  promotions.splice(promotions.findIndex((x) => x.id === 'other'), 0, np);
  console.log(`  + new promotion ${id} (${name}, ${np.area}, tier 1)`);
  return np;
}

let added = 0, skipped = 0;
for (const line of fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim())) {
  if (!line || line.startsWith('#')) continue;
  const [promo, state, website, date, time, name, venue, cityName, ticketUrl, source, lat, lng] = line.split('|').map((x) => (x ?? '').trim());
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) { problems.push(`bad date: ${line}`); continue; }
  if (date < today) { skipped++; continue; }
  const c = cityFor(cityName, state);
  if (!c) continue;
  const p = promotionFor(promo, state, website);
  if (p.dormant) { skipped++; continue; } // stopped running; see promotions.json `dormant`
  if (shows.some((s) => s.promotion === p.id && s.date === date && s.city === c.id)) { skipped++; continue; }
  const s = { promotion: p.id, name: name || p.name, date, time: time || 'TBA', city: c.id, venue: venue || 'Venue on ticket page' };
  if (lat && lng) Object.assign(s, { lat: +lat, lng: +lng }); else Object.assign(s, { lat: c.lat, lng: c.lng, approx: true });
  if (ticketUrl) s.ticketUrl = ticketUrl;
  if (source) s.source = source;
  shows.push(s);
  if (p.tier <= 2 && p.country === 'USA' && !p.cities.includes(c.id)) p.cities.push(c.id);
  added++;
}
shows.sort((a, b) => a.date.localeCompare(b.date) || a.promotion.localeCompare(b.promotion));
const write = (f, rows) => fs.writeFileSync(path.join(D, f), '[\n' + rows.map((r) => '  ' + JSON.stringify(r)).join(',\n') + '\n]\n');
write('promotions.json', promotions); write('cities.json', cities); write('shows.json', shows);
console.log(`✓ added ${added} shows (${skipped} already listed or past)`);
if (problems.length) console.log('Check these:\n  - ' + problems.join('\n  - '));
