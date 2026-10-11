// Pulls upcoming US pro-wrestling events from the Ticketmaster Discovery API (covers Ticketmaster and Universe,
// which many indies sell through) and writes them as candidate lines for scripts/add-shows.mjs.
//
//   TM_API_KEY=xxxx node scripts/fetch-ticketmaster.mjs [days=90]
//
// Output: sources/ticketmaster.txt in the add-shows format
//   promotion|state|website|date|time|show name|venue and street|city|ticket link|source|lat|lng
// The promotion field is Ticketmaster's attraction/promoter name; the weekly run checks each line against
// promotions.json (fix spelling, skip duplicates, skip non-wrestling), then feeds the good ones to add-shows.mjs.
// The free key comes from https://developer.ticketmaster.com (5,000 calls/day). In GitHub it is the TM_API_KEY secret.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const key = process.env.TM_API_KEY;
if (!key) { console.error('Set TM_API_KEY (free key from developer.ticketmaster.com).'); process.exit(1); }
const days = Number(process.argv[2] ?? 90);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const iso = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z');
const start = new Date(); const end = new Date(Date.now() + days * 864e5);
// Amateur / school / MMA results that also match "wrestling".
const NOT_PRO = /\b(ncaa|ncaa?w|college|university|high school|hs |dual|duals|usa wrestling|freestyle|greco|folkstyle|youth|tournament of champions|state championships?|mma|ufc|sumo)\b/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seen = new Set(); const lines = [];
for (const q of [{ classificationName: 'wrestling' }, { keyword: 'wrestling' }]) {
  for (let page = 0; page < 5; page++) { // size 200 × page < 1000 (API deep-paging cap)
    const u = new URL('https://app.ticketmaster.com/discovery/v2/events.json');
    Object.entries({ apikey: key, countryCode: 'US', size: '200', page: String(page), sort: 'date,asc',
      startDateTime: iso(start), endDateTime: iso(end), ...q }).forEach(([k, v]) => u.searchParams.set(k, v));
    const res = await fetch(u);
    if (!res.ok) { console.error(`HTTP ${res.status} for ${JSON.stringify(q)} page ${page}`); break; }
    const j = await res.json();
    for (const e of j._embedded?.events ?? []) {
      if (seen.has(e.id)) continue; seen.add(e.id);
      const cls = (e.classifications ?? []).map((c) => [c.segment?.name, c.genre?.name, c.subGenre?.name].join('/')).join(' ');
      if (!/wrestl/i.test(`${e.name} ${cls}`) || NOT_PRO.test(`${e.name} ${cls}`)) continue;
      const v = e._embedded?.venues?.[0] ?? {};
      const promo = e._embedded?.attractions?.[0]?.name || e.promoter?.name || e.name; // promoter is often just "Live Nation"
      const date = e.dates?.start?.localDate; if (!date) continue;
      let time = 'TBA';
      if (e.dates.start.localTime) { const [h, m] = e.dates.start.localTime.split(':').map(Number); time = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; }
      const venue = [v.name, v.address?.line1].filter(Boolean).join(', ');
      lines.push([promo, v.state?.stateCode ?? '', '', date, time, e.name, venue, v.city?.name ?? '', e.url ?? '', e.url ?? '',
        v.location?.latitude ?? '', v.location?.longitude ?? ''].map((x) => String(x).replace(/\|/g, '/')).join('|'));
    }
    if ((j.page?.totalPages ?? 0) <= page + 1) break;
    await sleep(250); // 5 requests/second limit
  }
}
lines.sort((a, b) => a.split('|')[3].localeCompare(b.split('|')[3]));
fs.mkdirSync(path.join(root, 'sources'), { recursive: true });
fs.writeFileSync(path.join(root, 'sources', 'ticketmaster.txt'),
  `# Ticketmaster Discovery API, fetched ${new Date().toISOString().slice(0, 10)}, next ${days} days. Candidates: review before add-shows.\n` + lines.join('\n') + '\n');
console.log(`✓ ${lines.length} wrestling events written to sources/ticketmaster.txt`);
