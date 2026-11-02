// Finds and merges duplicate promotions and duplicate shows. Run every week after add-shows.mjs, before the build.
//
//   node scripts/dedupe.mjs          report only
//   node scripts/dedupe.mjs --fix    merge them
//
// Two promotions are the same when they have
//   - the same website or Facebook page (bit.ly links and Facebook profile/group links don't count), or
//   - the same name (ignoring case, accents, punctuation and a "(XYZ)" suffix) in the same area, or
//   - a show on the same date in the same city, and the same name once generic words
//     (wrestling, pro, championship, the …) are dropped ("Crypt" = "Crypt Wrestling").
// Same-name promotions in different states are NOT merged (they are usually different companies); they are listed
// under "check by hand".
// The keeper is the higher tier, then the one with a watch platform, then more shows, then the older entry. Shows,
// past shows, results, wrestler promotions, recurring rules, Watch specials and removed.txt lines move to the keeper;
// the keeper takes the duplicate's website, watch, watchLinks and cities when it has none. A duplicate that owns a
// title (titles.tsv) or logo is reported, not merged. Also drops repeated shows of one promotion on one date in
// one city (keeps the first one listed).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = path.join(root, 'data-src');
const FIX = process.argv.includes('--fix');
const rd = (f) => fs.readFileSync(path.join(D, f), 'utf8');
const wr = (f, s) => fs.writeFileSync(path.join(D, f), s);
const promotions = JSON.parse(rd('promotions.json'));
const shows = JSON.parse(rd('shows.json'));
const past = JSON.parse(rd('past.json'));
const watch = JSON.parse(rd('watch.json'));
const recurring = JSON.parse(rd('recurring.json'));

const norm = (n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(.*?\)/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const GENERIC = /\b(the|pro|professional|wrestling|wrestle|championship|entertainment|federation|alliance|association|presents|live)\b/g;
const core = (n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(GENERIC, '').replace(/\s+/g, '');
const site = (u) => {
  if (!u || /bit\.ly|facebook\.com\/(profile\.php|groups)|instagram\.com\/?$/i.test(u)) return '';
  return u.toLowerCase().replace(/^https?:\/\/(www\.|m\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
};
const showCount = (id) => shows.filter((s) => s.promotion === id).length;
const titleOwners = new Set(rd('titles.tsv').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')[1]));
const logoOwners = new Set(rd('logos.tsv').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')[0]));
const order = new Map(promotions.map((p, i) => [p.id, i]));
const better = (a, b) => (b.tier - a.tier) || ((b.watch?.length ? 1 : 0) - (a.watch?.length ? 1 : 0)) || (showCount(b.id) - showCount(a.id)) || (order.get(a.id) - order.get(b.id));

// Union-find over promotions that match.
const parent = new Map(promotions.map((p) => [p.id, p.id]));
const find = (x) => (parent.get(x) === x ? x : find(parent.get(x)));
const why = [];
const join = (a, b, reason) => { const ra = find(a.id), rb = find(b.id); if (ra !== rb) { parent.set(rb, ra); why.push(`${a.id} = ${b.id} (${reason})`); } };
const MAJORS = new Set(['wwe', 'nxt', 'aew', 'roh', 'tna', 'aaa', 'cmll', 'njpw', 'other']);
const pool = promotions.filter((p) => !MAJORS.has(p.id));
const bySite = new Map(), byName = new Map();
const byNameAnyArea = new Map();
for (const p of pool) {
  const s = site(p.website);
  if (s) { if (bySite.has(s)) join(bySite.get(s), p, `same website ${s}`); else bySite.set(s, p); }
  const k = `${norm(p.name)}|${p.area}`;
  if (byName.has(k)) join(byName.get(k), p, 'same name and area'); else byName.set(k, p);
  const n = norm(p.name);
  if (!byNameAnyArea.has(n)) byNameAnyArea.set(n, []);
  byNameAnyArea.get(n).push(p);
}
const pById = new Map(promotions.map((p) => [p.id, p]));
const slot = new Map();
for (const s of shows) {
  const k = `${s.date}|${s.city}`;
  for (const other of slot.get(k) ?? []) {
    const a = pById.get(other), b = pById.get(s.promotion);
    if (a && b && a.id !== b.id && !MAJORS.has(a.id) && !MAJORS.has(b.id) && core(a.name) && core(a.name) === core(b.name)) join(a, b, `same show ${k}`);
  }
  slot.set(k, [...(slot.get(k) ?? []), s.promotion]);
}

const groups = new Map();
for (const p of pool) { const r = find(p.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); }
const merges = [];
for (const g of groups.values()) {
  if (g.length < 2) continue;
  g.sort(better);
  const [keep, ...dups] = g;
  for (const d of dups) merges.push({ keep, d });
}

const blocked = merges.filter(({ d }) => titleOwners.has(d.id) || logoOwners.has(d.id));
const todo = merges.filter((m) => !blocked.includes(m));
console.log(`Duplicate promotions: ${merges.length}`);
for (const w of why) console.log(`  ${w}`);
for (const { keep, d } of todo) console.log(`  ${FIX ? 'merged' : 'would merge'} ${d.id} (${d.name}, ${d.area}, ${showCount(d.id)} shows) into ${keep.id} (${keep.name})`);
for (const { keep, d } of blocked) console.log(`  ! not merged: ${d.id} into ${keep.id} — ${d.id} owns a title or logo; merge by hand`);
const merged = new Set(todo.map((m) => m.d.id));
const hand = [...byNameAnyArea.values()].filter((g) => g.length > 1 && new Set(g.map((p) => find(p.id))).size > 1);
if (hand.length) {
  console.log('Same name, different area (check by hand; not merged):');
  for (const g of hand) console.log(`  ${g.map((p) => `${p.id} (${p.area})`).join('  ')}`);
}

if (!FIX) {
  const dupShows = new Set(); let n = 0;
  for (const s of shows) { const k = `${s.promotion}|${s.date}|${s.city}`; if (dupShows.has(k)) n++; dupShows.add(k); }
  console.log(`Repeated shows (same promotion, date, city): ${n}`);
  if (merges.length || n) console.log('Run with --fix to merge.');
  process.exit(0);
}

const to = new Map(todo.map(({ keep, d }) => [d.id, keep.id]));
const map = (id) => to.get(id) ?? id;
for (const { keep, d } of todo) {
  if (!keep.website && d.website) keep.website = d.website;
  if (!keep.watch?.length && d.watch?.length) keep.watch = d.watch;
  if (d.watchLinks) keep.watchLinks = { ...d.watchLinks, ...(keep.watchLinks ?? {}) };
  keep.cities = [...new Set([...(keep.cities ?? []), ...(d.cities ?? [])])];
}
const fixShow = (s) => {
  const p = map(s.promotion);
  if (p !== s.promotion) { if (s.id?.startsWith(`${s.promotion}-`)) s.id = p + s.id.slice(s.promotion.length); s.promotion = p; }
  return s;
};
const dedupeShows = (list) => {
  const seen = new Set(); let dropped = 0;
  const out = list.map(fixShow).filter((s) => { const k = `${s.promotion}|${s.date}|${s.city}`; if (seen.has(k)) { dropped++; return false; } seen.add(k); return true; });
  return [out, dropped];
};
const [newShows, droppedShows] = dedupeShows(shows);
const [newPast, droppedPast] = dedupeShows(past);
for (const s of watch.specials ?? []) s.promotion = map(s.promotion);
for (const r of recurring.rules ?? recurring.shows ?? []) if (r.promotion) r.promotion = map(r.promotion);
const keptPromos = promotions.filter((p) => !merged.has(p.id));

const lines = (f, fn) => wr(f, rd(f).split('\n').map((l) => (!l || l.startsWith('#') ? l : fn(l))).join('\n'));
lines('results.txt', (l) => { const c = l.split('|'); if (c.length > 1) c[1] = map(c[1]); return c.join('|'); });
lines('removed.txt', (l) => { const c = l.split('|'); c[0] = map(c[0].trim()); return c.join('|'); });
lines('wrestlers.tsv', (l) => { const c = l.split('\t'); if (c.length > 2) c[2] = [...new Set(c[2].split(',').map((x) => map(x.trim())))].join(','); return c.join('\t'); });

wr('promotions.json', `[\n${keptPromos.map((p) => `  ${JSON.stringify(p)}`).join(',\n')}\n]\n`);
wr('shows.json', `[\n${newShows.map((s) => `  ${JSON.stringify(s)}`).join(',\n')}\n]\n`);
wr('past.json', `${JSON.stringify(newPast, null, 1)}\n`);
wr('watch.json', `${JSON.stringify(watch, null, 1)}\n`);
wr('recurring.json', `${JSON.stringify(recurring, null, 1)}\n`);
console.log(`✓ merged ${todo.length} promotion(s); dropped ${droppedShows} repeated show(s) and ${droppedPast} repeated past show(s)`);
