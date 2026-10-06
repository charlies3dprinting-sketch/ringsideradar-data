// Share pages for Ringside Radar links: one small static page per wrestler, promotion, show and championship,
// written to docs/p/ (GitHub Pages). Each page has link-preview tags (title, description, image) and buttons that
// open the app (or the Play Store). Called by build-data.mjs; safe to run on its own after a build.
import fs from 'node:fs';
import path from 'node:path';

const SITE = 'https://charlies3dprinting-sketch.github.io/ringsideradar-data';
const PLAY = 'https://play.google.com/store/apps/details?id=com.ringsideradar.app';
const ICON = `${SITE}/icon-180.png`;
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmt = (d) => { const [y, m, dd] = d.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, dd)); return `${DAYS[dt.getUTCDay()]}, ${MONTHS[m - 1]} ${dd}, ${y}`; };

/** App deep link: ringsideradar://<route>. On Android an intent link falls back to the Play Store when the app isn't installed. */
/** The website. Anyone not on Android goes straight to the same page there (it has the full details). */
const WEB = 'https://ringsideradar.com';
const intent = (route) => `intent://${route}#Intent;scheme=ringsideradar;package=com.ringsideradar.app;S.browser_fallback_url=${encodeURIComponent(PLAY)};end`;

function page({ title, description, image, route, heading, lines = [], kicker = '' }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Ringside Radar</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Ringside Radar">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image || ICON)}"><meta name="twitter:card" content="summary">
<link rel="icon" href="${SITE}/icon-180.png"><link rel="stylesheet" href="${SITE}/p/share.css">
<link rel="canonical" href="${WEB}/${esc(route)}">
</head><body><main>
${image ? `<img class="hero" src="${esc(image)}" alt="">` : ''}
${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ''}<h1>${esc(heading || title)}</h1>
${lines.map((l) => `<p>${esc(l)}</p>`).join('\n')}
<a class="btn ghost" href="${WEB}/${esc(route)}">See it on ringsideradar.com</a>
<a class="btn" id="open" href="ringsideradar://${esc(route)}">Open in Ringside Radar</a>
<a class="btn ghost" href="${PLAY}">Get the app on Google Play</a>
<p class="small">Ringside Radar: find wrestling shows near you, live rankings and a passport for every show you attend.</p>
</main><script>if(/Android/i.test(navigator.userAgent))document.getElementById('open').href=${JSON.stringify(intent(route))};else location.replace(${JSON.stringify(`${WEB}/${route}`)});</script></body></html>
`;
}

/** Pages whose id comes from the query string (fans, groups, teams, rankings): no per-item preview, just open the app. */
function dynamicPage(kind, routePrefix, label) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(label)} · Ringside Radar</title><meta property="og:title" content="${esc(label)} on Ringside Radar">
<meta property="og:description" content="Wrestling shows near you, live rankings and a fan passport."><meta property="og:image" content="${ICON}">
<link rel="stylesheet" href="${SITE}/p/share.css"></head><body><main>
<p class="kicker">Ringside Radar</p><h1 id="h">${esc(label)}</h1>
<a class="btn" id="open" href="#">Open in Ringside Radar</a><a class="btn ghost" href="${PLAY}">Get the app on Google Play</a>
</main><script>
var q=new URLSearchParams(location.search),id=q.get('id')||q.get('w')||'';
var route=${JSON.stringify(routePrefix)}+encodeURIComponent(id);
if(${JSON.stringify(kind)}==='fan'&&id)document.getElementById('h').textContent='@'+id;
if(!/Android/i.test(navigator.userAgent))location.replace(${JSON.stringify(WEB)}+'/'+(route==='rankings'||route.indexOf('rankings')===0?'rankings':route));
document.getElementById('open').href=/Android/i.test(navigator.userAgent)?'intent://'+route+'#Intent;scheme=ringsideradar;package=com.ringsideradar.app;S.browser_fallback_url='+encodeURIComponent(${JSON.stringify(PLAY)})+';end':'ringsideradar://'+route;
</script></body></html>
`;
}

const CSS = `:root{--bg:#f2f3f5;--card:#fff;--ink:#11151c;--sub:#5b6472;--accent:#c8102e}
@media (prefers-color-scheme:dark){:root{--bg:#0e1116;--card:#171b22;--ink:#eef1f6;--sub:#9aa3b2;--accent:#ff4d5e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px 16px}
main{max-width:480px;margin:0 auto;background:var(--card);border-radius:18px;padding:24px;display:grid;gap:10px}
.hero{width:120px;height:120px;border-radius:60px;object-fit:cover;justify-self:center}
.kicker{margin:0;color:var(--accent);font-weight:700;font-size:12px;letter-spacing:.1em;text-transform:uppercase}
h1{margin:0;font-size:30px;line-height:1.1;font-style:italic;text-transform:uppercase;letter-spacing:.01em}
p{margin:0;color:var(--sub)}.small{font-size:13px;margin-top:8px}
.btn{display:block;text-align:center;padding:14px;border-radius:12px;background:var(--accent);color:#fff;font-weight:700;text-decoration:none;margin-top:6px}
.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--sub)}`;

export function buildShare({ root, promotions, wrestlers, titles, shows, past, cities, reigns }) {
  const docs = path.join(root, 'docs');
  if (!fs.existsSync(docs)) return;
  const out = path.join(docs, 'p');
  fs.rmSync(out, { recursive: true, force: true });
  for (const d of ['w', 'p', 's', 't']) fs.mkdirSync(path.join(out, d), { recursive: true });
  const P = Object.fromEntries(promotions.map((p) => [p.id, p]));
  const C = Object.fromEntries(cities.map((c) => [c.id, c]));
  const W = Object.fromEntries(wrestlers.map((w) => [w.id, w]));
  const write = (f, html) => fs.writeFileSync(path.join(out, f), html);
  let n = 0;
  for (const w of wrestlers) {
    const champ = reigns.filter((r) => r.wrestler === w.id && r.end === null).map((r) => titles.find((t) => t.id === r.title)?.name).filter(Boolean);
    const next = shows.filter((s) => (s.featuring ?? []).includes(w.id)).slice(0, 1)[0];
    const promos = w.promotions.map((p) => P[p]?.short).filter(Boolean).join(' · ');
    write(`w/${w.id}.html`, page({
      title: w.name, kicker: promos, image: w.photo?.url, route: `wrestler/${w.id}`,
      description: [champ.length ? `Champion: ${champ.join(', ')}` : '', next ? `Next: ${P[next.promotion]?.short} ${next.name}, ${fmt(next.date)}, ${C[next.city]?.name}` : '', 'Rankings, titles, matches and bookings on Ringside Radar.'].filter(Boolean).join(' · '),
      lines: [champ.length ? `Champion: ${champ.join(', ')}` : '', next ? `Next show: ${P[next.promotion]?.short} ${next.name} · ${fmt(next.date)} · ${C[next.city]?.name}, ${C[next.city]?.state}` : ''].filter(Boolean),
    })); n++;
  }
  for (const p of promotions.filter((x) => !x.hidden)) {
    const next = shows.filter((s) => s.promotion === p.id).slice(0, 1)[0];
    write(`p/${p.id}.html`, page({
      title: p.name, kicker: p.area, image: p.logo?.url, route: `promotion/${p.id}`,
      description: `${p.name}${next ? ` · next show ${fmt(next.date)} in ${C[next.city]?.name}` : ''} · roster, champions and shows on Ringside Radar.`,
      lines: [next ? `Next show: ${next.name} · ${fmt(next.date)} · ${C[next.city]?.name}, ${C[next.city]?.state}` : ''].filter(Boolean),
    })); n++;
  }
  for (const s of [...shows, ...past]) {
    const p = P[s.promotion], c = C[s.city];
    const names = (s.featuring ?? []).map((x) => W[x]?.name ?? x).slice(0, 4);
    write(`s/${s.id}.html`, page({
      title: `${p?.short ?? ''} ${s.name}`.trim(), kicker: `${fmt(s.date)} · ${c?.name}, ${c?.state}`, image: p?.logo?.url, route: `show/${s.id}`,
      description: `${fmt(s.date)} · ${s.venue}, ${c?.name}, ${c?.state}${names.length ? ` · ${names.join(', ')}` : ''}`,
      lines: [`${s.venue}`, `${c?.name}, ${c?.state}${s.time && s.time !== 'TBA' ? ` · Bell ${s.time}` : ''}`, names.length ? `Featuring ${names.join(', ')}` : ''].filter(Boolean),
    })); n++;
  }
  for (const t of titles) {
    const cur = reigns.filter((r) => r.title === t.id && r.end === null);
    const holder = cur.length ? cur[0].team ?? W[cur[0].wrestler]?.name ?? cur[0].wrestler : 'Vacant';
    write(`t/${t.id}.html`, page({
      title: t.name, kicker: P[t.promotion]?.name ?? '', image: cur.length && !cur[0].team ? W[cur[0].wrestler]?.photo?.url : P[t.promotion]?.logo?.url, route: `title/${t.id}`,
      description: `Current champion: ${holder}. Lineage and title matches on Ringside Radar.`, lines: [`Current champion: ${holder}`],
    })); n++;
  }
  write('fan.html', dynamicPage('fan', 'fan/', 'A fan on Ringside Radar'));
  write('group.html', dynamicPage('group', 'group/', 'Join my group'));
  write('team.html', dynamicPage('team', 'team/', 'Tag team'));
  write('show.html', dynamicPage('show', 'show/', 'Wrestling show'));
  write('wrestler.html', dynamicPage('wrestler', 'wrestler/', 'Wrestler'));
  write('rankings.html', dynamicPage('rankings', 'rankings', 'Live wrestling rankings'));
  write('share.css', CSS);
  console.log(`✓ ${n} share pages in docs/p/`);
}
