// Link previews for shared ringsideradar.com pages.
//
// The site is a single-page app: every page is the same index.html, filled in by JavaScript. Chat apps and social
// sites don't run JavaScript when they build a link preview, so for shareable pages (wrestler, promotion, show,
// championship, team, fan, group) this Cloudflare Pages Function serves index.html with that page's own title,
// description and image in the <head>. The details come from the small share pages the weekly data update already
// builds on GitHub Pages (docs/p/ in ringsideradar-data), so new wrestlers and shows get previews with no redeploy.

const DATA_SITE = 'https://charlies3dprinting-sketch.github.io/ringsideradar-data';
const SITE_NAME = 'Ringside Radar';

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const unesc = (s = '') => String(s).replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]));

/** og:title / og:description / og:image from a pre-built share page, or null. */
async function fromSharePage(path) {
  try {
    const res = await fetch(`${DATA_SITE}/p/${path}`, { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!res.ok) return null;
    const html = await res.text();
    const get = (prop) => { const m = html.match(new RegExp(`<meta property="og:${prop}" content="([^"]*)"`)); return m ? unesc(m[1]) : ''; };
    // "4LPW 4LPW": a show named after its promotion.
    const title = get('title').replace(/^(.+) \1$/, '$1');
    if (!title) return null;
    const image = get('image');
    return { title, description: get('description'), image: image.endsWith('/icon-180.png') ? '' : image };
  } catch {
    return null;
  }
}

const SHARE_DIR = { wrestler: 'w', promotion: 'p', show: 's', title: 't' };

/** Title, description and image for one page. */
async function lookup(kind, id, url) {
  if (SHARE_DIR[kind] && /^[a-z0-9._-]+$/i.test(id)) {
    const m = await fromSharePage(`${SHARE_DIR[kind]}/${id}.html`);
    if (m) {
      // A WWE brand page (/promotion/wwe?brand=raw) shares the WWE preview with the brand's name.
      if (kind === 'promotion' && id === 'wwe') {
        const brand = url.searchParams.get('brand');
        if (brand === 'raw') m.title = 'WWE Raw';
        if (brand === 'smackdown') m.title = 'WWE SmackDown';
      }
      return m;
    }
  }
  const name = decodeURIComponent(id).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  switch (kind) {
    case 'fan': return { title: `@${decodeURIComponent(id)}`, description: 'Shows they’ve been to, passport stamps and badges. Follow them on Ringside Radar.' };
    case 'group': return { title: 'Join my fan group', description: 'A fan group with its own leaderboard. Check in at shows to climb it.' };
    case 'team': return { title: name, description: 'Tag team members, title reigns and matches on Ringside Radar.' };
    case 'wrestler': return { title: name, description: 'Rankings, titles, matches and bookings on Ringside Radar.' };
    case 'show': return { title: 'Wrestling show', description: 'Date, venue, who’s booked and tickets on Ringside Radar.' };
    default: return null;
  }
}

class SetAttr {
  constructor(attr, value) { this.attr = attr; this.value = value; }
  element(el) { if (this.value != null) el.setAttribute(this.attr, this.value); }
}

/** Serve index.html with this page's preview tags. */
export async function preview(context, kind, id) {
  const url = new URL(context.request.url);
  const [page, meta] = await Promise.all([context.env.ASSETS.fetch(new URL('/', url)), lookup(kind, id, url)]);
  if (!meta || !page.ok) return page;
  const canonical = `${url.origin}${url.pathname}${url.search}`;
  const fullTitle = `${meta.title} · ${SITE_NAME}`;
  const image = meta.image || `${url.origin}/og-image.png`;
  const res = new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(fullTitle); } })
    .on('meta[name="description"]', new SetAttr('content', meta.description))
    .on('meta[property="og:title"]', new SetAttr('content', meta.title))
    .on('meta[property="og:description"]', new SetAttr('content', meta.description))
    .on('meta[property="og:url"]', new SetAttr('content', canonical))
    .on('meta[property="og:image"]', new SetAttr('content', image))
    // Square photos and logos read better as a small card than stretched into a wide banner.
    .on('meta[property="og:image:width"]', { element(el) { if (meta.image) el.remove(); } })
    .on('meta[property="og:image:height"]', { element(el) { if (meta.image) el.remove(); } })
    .on('meta[name="twitter:card"]', new SetAttr('content', meta.image ? 'summary' : 'summary_large_image'))
    .on('link[rel="canonical"]', new SetAttr('href', canonical))
    .transform(page);
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'public, max-age=300');
  out.headers.set('Content-Type', 'text/html; charset=utf-8');
  return out;
}
