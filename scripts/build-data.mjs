// Builds the app's data files from the human-editable sources in data-src/.
//
//   npm run build-data
//
// Works in the app project and in the standalone data repo (which has no src/data).
// Reads:  data-src/cities.json, promotions.json, wrestlers.tsv, photos.tsv, career.json, titles.tsv, reigns.tsv, results.txt, shows.json,
//         brands.tsv, watch.json (TV/streaming listings) and past.json (shows already held; past shows in shows.json are moved there automatically)
// Writes: src/data/*.json (bundled into the app) and data-bundle/ringsideradar-data.json
//         (one file to host online so the app can pick up new shows without a rebuild).
// Fails loudly if anything points at a wrestler, title, city or promotion that doesn't exist.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => path.join(root, 'data-src', f);
const errors = [];
const err = (m) => errors.push(m);

const readJson = (f) => JSON.parse(fs.readFileSync(src(f), 'utf8'));
const readRows = (f) => fs.readFileSync(src(f), 'utf8').split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() && !l.startsWith('#'));

export const slug = (name) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// Cities and promotions
const cities = readJson('cities.json');
const CITY = new Set(cities.map((c) => c.id));
const promotions = readJson('promotions.json');
const PROMO = new Set(promotions.map((p) => p.id));
for (const p of promotions) {
  for (const c of p.cities) if (!CITY.has(c)) err(`promotion ${p.id}: unknown city "${c}"`);
  if (![1, 2, 3, 4].includes(p.tier)) err(`promotion ${p.id}: tier must be 1-4`);
}

// Promotion logos (data-src/logos.tsv): free-licensed / public-domain logos from Wikimedia Commons, hosted in docs/logos/.
if (fs.existsSync(src('logos.tsv'))) {
  for (const row of readRows('logos.tsv')) {
    const [id, url, file, by, license] = row.split('\t');
    const p = promotions.find((x) => x.id === id);
    if (!p) { err(`logos.tsv: unknown promotion "${id}"`); continue; }
    if (!/^https:\/\/charlies3dprinting-sketch\.github\.io\/ringsideradar-data\/logos\/[a-z0-9-]+\.png$/.test(url)) { err(`logos.tsv: ${id} logo must be a hosted copy in docs/logos/`); continue; }
    if (fs.existsSync(path.join(root, 'docs')) && !fs.existsSync(path.join(root, 'docs', 'logos', url.split('/').pop()))) err(`logos.tsv: docs/logos/${url.split('/').pop()} is missing`);
    p.logo = { url, file, by: by || 'Unknown', license: license || '' };
  }
}

// Wrestlers (keyed by display name in the sources, by slug in the app)
const wrestlers = [];
const byName = new Map();
for (const row of readRows('wrestlers.tsv')) {
  const [name, gender, promos, followers = '0'] = row.split('\t');
  const id = slug(name);
  if (byName.has(name)) { err(`wrestler listed twice: ${name}`); continue; }
  if (!['m', 'f'].includes(gender)) err(`wrestler ${name}: gender must be m or f`);
  const ps = promos.split(',').map((s) => s.trim()).filter(Boolean);
  ps.forEach((p) => { if (!PROMO.has(p)) err(`wrestler ${name}: unknown promotion "${p}"`); });
  const w = { id, name, gender, promotions: ps, followersK: Number(followers) || 0 };
  wrestlers.push(w);
  byName.set(name, w);
}
if (new Set(wrestlers.map((w) => w.id)).size !== wrestlers.length) err('two wrestler names produce the same id');
const wid = (name, where) => {
  const w = byName.get(name.trim());
  if (!w) { err(`${where}: "${name.trim()}" is not in wrestlers.tsv`); return slug(name); }
  return w.id;
};

// PWI rankings (data-src/pwi.txt): each wrestler keeps their best placing as a ranking stat.
// Anyone ranked by PWI but not in wrestlers.tsv is added under the hidden "other" promotion.
const norm = (n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/["“”']/g, '').replace(/\./g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const ALIASES = { 'gunther': 'Gunther', 'iyo sky': 'Iyo Sky', 'natalya': 'Nattie', 'oleg boltin': 'Boltin Oleg', 'isiah broner': 'Isaiah Broner', 'drill moloney': 'Drilla Moloney' };
const byNorm = new Map(wrestlers.map((w) => [norm(w.name), w]));
const pwiLists = [];
if (fs.existsSync(src('pwi.txt'))) {
  let cur = null;
  for (const line of fs.readFileSync(src('pwi.txt'), 'utf8').split('\n').map((l) => l.replace(/\r$/, '').trim())) {
    if (!line || (line.startsWith('#') && !line.startsWith('##'))) continue;
    if (line.startsWith('##')) {
      const [id, gender, cutoff, source] = line.slice(2).split('|').map((x) => x.trim());
      if (!isDate(cutoff)) err(`pwi.txt: bad cutoff date in "${line}"`);
      cur = { id, gender, cutoff, source, names: [] };
      pwiLists.push(cur);
    } else if (cur) cur.names.push(line);
  }
}
if (pwiLists.length && !PROMO.has('other')) err('pwi.txt needs a promotion with id "other" in promotions.json');
for (const L of pwiLists) {
  const seen = new Set();
  L.names.forEach((name, i) => {
    const key = norm(name);
    if (seen.has(key)) return;
    seen.add(key);
    let w = byNorm.get(key) ?? (ALIASES[key] ? byName.get(ALIASES[key]) : undefined);
    if (!w) {
      const gender = L.gender === 'f' || pwiLists.some((o) => o.gender === 'f' && o.names.some((n) => norm(n) === key)) ? 'f' : 'm';
      w = { id: slug(name), name, gender, promotions: ['other'], followersK: 0 };
      if (wrestlers.some((x) => x.id === w.id)) { err(`pwi.txt: "${name}" clashes with an existing wrestler id; add an alias`); return; }
      wrestlers.push(w); byName.set(name, w); byNorm.set(key, w);
    }
    const rank = i + 1, of = L.names.length;
    const score = 1 - (rank - 1) / of; // 1 = top of the list
    if (!w.pwi || score > 1 - (w.pwi.rank - 1) / w.pwi.of) w.pwi = { list: L.id, rank, of, cutoff: L.cutoff };
  });
}

// Photos (data-src/photos.tsv): free-licensed Wikimedia Commons images, credited on the wrestler page.
if (fs.existsSync(src('photos.tsv'))) {
  for (const row of readRows('photos.tsv')) {
    const [name, url, file, by, license] = row.split('\t');
    const w = byName.get(name) ?? byNorm.get(norm(name));
    if (!w) { err(`photos.tsv: "${name}" is not a wrestler`); continue; }
    if (!/^https:\/\/charlies3dprinting-sketch\.github\.io\/ringsideradar-data\/photos\/[a-z0-9-]+\.jpg$/.test(url)) { err(`photos.tsv: ${name} photo must be a hosted copy in docs/photos/`); continue; }
    if (!fs.existsSync(path.join(root, 'docs', 'photos', url.split('/').pop())) && fs.existsSync(path.join(root, 'docs'))) err(`photos.tsv: ${name}: docs/photos/${url.split('/').pop()} is missing`);
    w.photo = { url: url.split('?')[0], file, by: by || 'Unknown', license: license || '' };
  }
}

// WWE brands (data-src/brands.tsv): Raw or SmackDown, so the rankings can split them.
if (fs.existsSync(src('brands.tsv'))) {
  for (const row of readRows('brands.tsv')) {
    const [name, brand] = row.split('\t');
    const w = byName.get(name) ?? byNorm.get(norm(name));
    if (!w) { err(`brands.tsv: "${name}" is not a wrestler`); continue; }
    if (!['raw', 'smackdown'].includes(brand)) { err(`brands.tsv: ${name}: brand must be raw or smackdown`); continue; }
    if (!w.promotions.includes('wwe')) err(`brands.tsv: ${name} isn't listed with WWE`);
    w.brand = brand;
  }
}

// Career championships (data-src/career.json): { wrestlerId: { page, c: [[promotion, ["Title (n times)", ...]], ...] } }
// from each wrestler's Wikipedia "Championships and accomplishments" section. Shown on wrestler pages only.
if (fs.existsSync(src('career.json'))) {
  const career = readJson('career.json');
  const byId = new Map(wrestlers.map((w) => [w.id, w]));
  for (const [id, v] of Object.entries(career)) {
    const w = byId.get(id);
    if (!w) { err(`career.json: unknown wrestler id "${id}"`); continue; }
    if (!v.page || !Array.isArray(v.c)) { err(`career.json: ${id} needs page and c`); continue; }
    // Biggest promotions first, then wherever they held the most titles.
    const MAJOR = /\b(WWE|WWF|World Wrestling (Entertainment|Federation)|NXT|All Elite|AEW|New Japan|NJPW|Ring of Honor|ROH|TNA|Impact|Total Nonstop|AAA|CMLL|Consejo|WCW|World Championship Wrestling|ECW|Extreme Championship)\b/i;
    const reignsIn = (t) => t.reduce((a, x) => a + (Number((x.match(/\((\d+) times?\)/) ?? [])[1]) || 1), 0);
    const c = v.c.slice().sort((a, b) => Number(MAJOR.test(b[0])) - Number(MAJOR.test(a[0])) || reignsIn(b[1]) - reignsIn(a[1]));
    w.career = { page: v.page, c };
  }
}

// Titles and reigns
const titles = readRows('titles.tsv').map((row) => {
  const [id, promotion, name, gender, kind = ''] = row.split('\t');
  if (!PROMO.has(promotion)) err(`title ${id}: unknown promotion "${promotion}"`);
  if (!id.startsWith(promotion + '-')) err(`title ${id}: id must start with "${promotion}-" (the ranking uses it to find the promotion)`);
  return kind.trim() === 'tag' ? { id, promotion, name, gender, tag: true } : { id, promotion, name, gender };
});
const TAG = new Set(titles.filter((t) => t.tag).map((t) => t.id));
const TITLE = new Set(titles.map((t) => t.id));
// Tag reigns are written "Team Name: Member + Member" and become one reign per member (same team name).
const reigns = readRows('reigns.tsv').flatMap((row) => {
  const [title, holder, start, end = ''] = row.split('\t');
  if (!TITLE.has(title)) err(`reign: unknown title "${title}"`);
  if (!isDate(start)) err(`reign ${title} ${holder}: bad start date "${start}"`);
  if (end && !isDate(end)) err(`reign ${title} ${holder}: bad end date "${end}"`);
  if (TAG.has(title)) {
    const [team, members = ''] = holder.split(/:(.*)/s);
    const names = members.split('+').map((m) => m.trim()).filter(Boolean);
    if (names.length < 2) err(`reign ${title}: tag reigns need "Team: A + B", got "${holder}"`);
    return names.map((m) => ({ title, wrestler: wid(m, `reign ${title}`), team: team.trim(), start, end: end || null }));
  }
  return [{ title, wrestler: wid(holder, `reign ${title}`), start, end: end || null }];
});
for (const t of titles) {
  const cur = reigns.filter((r) => r.title === t.id && r.end === null);
  if (new Set(cur.map((r) => r.team ?? r.wrestler)).size > 1) err(`title ${t.id} has more than one current champion`);
}

// Results: one line per match; multi-person matches become one result per loser.
const results = [];
for (const row of readRows('results.txt')) {
  const [date, promotion, winnerRaw, losers, title] = row.split('|');
  if (!isDate(date)) { err(`result: bad date in "${row}"`); continue; }
  if (!PROMO.has(promotion)) err(`result ${date}: unknown promotion "${promotion}"`);
  if (title !== '-' && !TITLE.has(title)) err(`result ${date}: unknown title "${title}"`);
  const draw = winnerRaw.startsWith('=');
  const a = wid(winnerRaw.replace(/^=/, ''), `result ${date}`);
  const ls = losers.split(',');
  // One row = one match. Multi-person matches become one pairing per loser that share a match id, so the app
  // counts the win once.
  const m = ls.length > 1 ? `${date}-${promotion}-${results.length}` : undefined;
  for (const l of ls) {
    const b = wid(l, `result ${date}`);
    results.push({ date, promotion, a, b, winner: draw ? null : a, title: title === '-' ? null : title, ...(m ? { m } : {}) });
  }
}

// Shows. Anything dated before today moves from shows.json to past.json (kept for a year for promotion show history).
const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const allShows = readJson('shows.json');
const pastFile = src('past.json');
const pastRaw = fs.existsSync(pastFile) ? JSON.parse(fs.readFileSync(pastFile, 'utf8')) : [];
const rawShows = allShows.filter((s) => !(isDate(s.date) && s.date < todayIso));
const moved = allShows.filter((s) => isDate(s.date) && s.date < todayIso);
const showId = (s, i, list) => s.id ?? `${s.promotion}-${s.date}${list.filter((x) => x.promotion === s.promotion && x.date === s.date).length > 1 ? `-${i}` : ''}`;
if (moved.length) {
  const have = new Set(pastRaw.map((s) => s.id));
  for (const [i, s] of allShows.entries()) {
    if (!moved.includes(s)) continue;
    const id = showId(s, i, allShows);
    if (have.has(id)) continue;
    pastRaw.push({ id, promotion: s.promotion, name: s.name, date: s.date, time: s.time || 'TBA', city: s.city, venue: s.venue, lat: s.lat, lng: s.lng, featuring: s.featuring ?? [] });
  }
  fs.writeFileSync(src('shows.json'), JSON.stringify(rawShows, null, 1) + '\n');
}
const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
const past = pastRaw.filter((s) => s.date >= yearAgo && PROMO.has(s.promotion) && CITY.has(s.city)).sort((a, b) => a.date.localeCompare(b.date));
fs.writeFileSync(pastFile, JSON.stringify(past, null, 1) + '\n');

// Watch tab listings
const watch = fs.existsSync(src('watch.json')) ? readJson('watch.json') : { series: [], specials: [], changes: [] };
delete watch._help;
const SERIES = new Set(watch.series.map((x) => x.id));
for (const x of watch.series) {
  if (!PROMO.has(x.promotion)) err(`watch series ${x.id}: unknown promotion "${x.promotion}"`);
  if (!(x.day >= 0 && x.day <= 6)) err(`watch series ${x.id}: day must be 0-6`);
  if (x.time && !/^\d{2}:\d{2}$/.test(x.time)) err(`watch series ${x.id}: time must be HH:MM or ""`);
  if (!['free', 'sub', 'ppv'].includes(x.access)) err(`watch series ${x.id}: access must be free, sub or ppv`);
}
for (const x of watch.specials) {
  if (!PROMO.has(x.promotion)) err(`watch special ${x.id}: unknown promotion "${x.promotion}"`);
  if (!isDate(x.date)) err(`watch special ${x.id}: bad date`);
  if (x.time && !/^\d{2}:\d{2}$/.test(x.time)) err(`watch special ${x.id}: time must be HH:MM or ""`);
  if (!['free', 'sub', 'ppv'].includes(x.access)) err(`watch special ${x.id}: access must be free, sub or ppv`);
}
for (const c of watch.changes) if (!SERIES.has(c.series)) err(`watch change ${c.date}: unknown series "${c.series}"`);
watch.specials = watch.specials.filter((x) => x.date >= todayIso);
watch.changes = watch.changes.filter((x) => x.date >= todayIso || (x.to ?? '') >= todayIso);

const shows = rawShows.map((s, i) => {
  const where = `show ${s.date} ${s.name}`;
  if (!PROMO.has(s.promotion)) err(`${where}: unknown promotion "${s.promotion}"`);
  if (!CITY.has(s.city)) err(`${where}: unknown city "${s.city}"`);
  if (!isDate(s.date)) err(`${where}: bad date`);
  if (typeof s.lat !== 'number' || typeof s.lng !== 'number') err(`${where}: needs lat/lng`);
  if (s.card) err(`${where}: "card" is no longer used; list advertised names in "featuring"`);
  const id = showId(s, i, rawShows);
  const out = { id, promotion: s.promotion, name: s.name, date: s.date, time: s.time || 'TBA', city: s.city, venue: s.venue, lat: s.lat, lng: s.lng };
  for (const k of ['price', 'ticketUrl', 'promoted', 'approx', 'note', 'source']) if (s[k] !== undefined) out[k] = s[k];
  // Advertised names. Wrestlers we track link to their profiles; anyone else (legends, guests) shows as plain text.
  out.featuring = (s.featuring ?? []).map((n) => byName.get(n)?.id ?? n);
  return out;
});
if (new Set(shows.map((s) => s.id)).size !== shows.length) err('two shows share an id');

if (errors.length) {
  console.error(`\n✗ ${errors.length} problem(s) in data-src/:\n  - ` + errors.join('\n  - '));
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const meta = {
  source: 'curated',
  generatedAt: today,
  builtAt: new Date().toISOString(), // lets phones tell apart two builds from the same day
  note: 'Real promotions, champions, results and shows researched from public sources (promotion sites, ticket pages, Wikipedia, news). Rankings start from the latest PWI 500 / Women\'s 250. Follower counts and viewership/attendance scores are rough estimates.',
};
const pwi = pwiLists.map(({ id, gender, cutoff, source, names }) => ({ id, gender, cutoff, source, size: names.length }));
const files = { cities, promotions, wrestlers, titles, reigns, results, shows, meta, watch, past };
// Inside the app project, refresh the bundled copy. In the standalone data repo there is no src/data.
const out = path.join(root, 'src', 'data');
if (fs.existsSync(out)) for (const [k, v] of Object.entries(files)) fs.writeFileSync(path.join(out, `${k}.json`), JSON.stringify(v, null, 1) + '\n');

const bundleDir = path.join(root, 'data-bundle');
fs.mkdirSync(bundleDir, { recursive: true });
fs.writeFileSync(path.join(bundleDir, 'ringsideradar-data.json'), JSON.stringify({ version: 1, ...files }));

console.log(`✓ PWI lists: ${pwi.map((l) => `${l.id} (${l.size})`).join(', ') || 'none'}; ${wrestlers.filter((w) => w.pwi).length} wrestlers ranked by PWI`);
console.log(`✓ ${promotions.length} promotions, ${wrestlers.length} wrestlers, ${titles.length} titles, ${reigns.length} reigns, ${results.length} results, ${shows.length} shows (${past.length} past, ${moved.length} archived now), ${cities.length} cities`);
console.log(`✓ Watch: ${watch.series.length} weekly series, ${watch.specials.length} upcoming specials, ${watch.changes.length} schedule changes`);

// Share pages (link previews for wrestlers, promotions, shows and championships) in docs/p/.
await import('./build-share.mjs').then((m) => m.buildShare({ root, promotions, wrestlers, titles, shows, past, cities, reigns })).catch((e) => console.error('share pages failed:', e.message));
const unused = wrestlers.filter((w) => !w.pwi && !results.some((r) => r.a === w.id || r.b === w.id) && !reigns.some((r) => r.wrestler === w.id) && !shows.some((s) => s.featuring.includes(w.id)));
if (unused.length) console.log(`  note: ${unused.length} wrestler(s) have no results, titles or bookings yet: ${unused.map((w) => w.name).join(', ')}`);
