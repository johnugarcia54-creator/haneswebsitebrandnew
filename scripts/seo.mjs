/* =========================================================================================
   Search and sharing, for every page, from one list: the title and description, the
   canonical address, Open Graph and Twitter cards (with the images in og/), structured
   data for Google (JSON-LD), sitemap.xml and robots.txt.

   npm run seo                                             rewrite everything for the current address
   npm run seo -- --site https://www.hanesdistribution.co.nz   move the site to a new address
                                                           (saved as "homepage" in package.json)
   Edit the PAGES list below, then run it again. Each page's tags live between
   <!-- seo --> and <!-- /seo -->, so don't edit those by hand.
   ========================================================================================= */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkgFile = root + 'package.json', pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
const i = process.argv.indexOf('--site');
if (i > 0) { pkg.homepage = process.argv[i + 1].replace(/\/+$/, ''); writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n'); }
const SITE = (pkg.homepage || '').replace(/\/+$/, '');
if (!/^https:\/\/[^/]+$/.test(SITE)) throw new Error('Set the site address: npm run seo -- --site https://example.co.nz');

const ORG = 'Hanes Distribution', EMAIL = 'Enquiry@hanesdistribution.co.nz';
const BRANDS = ['Hanesteel', 'Hanestone', 'Hanewood', 'Hanesulation', 'Bargainhub'];

export const PAGES = [
  { file: 'index.html', path: '/', name: 'Home', priority: '1.0',
    title: 'Hanes Distribution — Building supply and logistics, NZ',
    description: 'Building products supplied across New Zealand: sourcing in Asia, 4PL logistics, live tracking, Christchurch warehousing and five house brands.',
    og: 'index.jpg', ogAlt: 'A Hanes Distribution truck: engineered supply, delivered nationwide', about: 'org' },
  { file: 'hanesteel.html', name: 'Hanesteel', priority: '0.8',
    title: 'Hanesteel — Aluminium and uPVC windows and doors, NZ',
    description: 'Hanesteel aluminium and uPVC windows and doors for New Zealand homes, supplied by Hanes Distribution from Christchurch. Request a quote online.',
    og: 'hanesteel-2.jpg', ogAlt: 'A Hanesteel front door: windows and doors built for New Zealand', brand: 'Aluminium and uPVC windows and doors for New Zealand homes.' },
  { file: 'hanestone.html', name: 'Hanestone', priority: '0.8',
    title: 'Hanestone — Trusus gypsum board for walls and ceilings',
    description: 'Hanestone Trusus gypsum plasterboard for walls and ceilings. Bulk supply to New Zealand merchants from Christchurch. Ask for a merchant quote.',
    og: 'hanestone-2.jpg', ogAlt: 'Hanestone Trusus gypsum board on a ceiling frame', brand: 'Trusus gypsum board for walls and ceilings.' },
  { file: 'hanewood.html', name: 'Hanewood', priority: '0.8',
    title: 'Hanewood — MDF, HDF, plywood, H3.2 plywood and LVL',
    description: 'Hanewood MDF, HDF, plywood, H3.2 radiata pine plywood and LVL for merchants and retailers. Stocked in Christchurch, delivered nationwide.',
    og: 'hanewood-2.jpg', ogAlt: 'A forklift carrying Hanewood plywood through the warehouse', brand: 'MDF, HDF, plywood, H3.2 radiata pine plywood and LVL.' },
  { file: 'hanesulation.html', name: 'Hanesulation', priority: '0.8',
    title: 'Hanesulation — Glass wool insulation, R2 to R7',
    description: 'Hanesulation glass wool insulation for walls and ceilings, supplied wholesale to NZ merchants. Held in Christchurch and delivered nationwide.',
    og: 'hanesulation-2.jpg', ogAlt: 'A roll of Hanesulation glass wool insulation', brand: 'Glass wool insulation for walls and ceilings, R2 to R7.' },
  { file: 'bargainhub.html', name: 'Bargainhub Interiors', priority: '0.8',
    title: 'Bargainhub Interiors — Kitchens, bathrooms, whole homes',
    description: 'Kitchens, bathrooms and whole-home interiors from Bargainhub, designed in plan and 3D, supplied on one order and delivered nationwide.',
    og: 'bargainhub.jpg', ogAlt: 'A Bargainhub kitchen in stone and timber', brand: 'Kitchens, bathrooms and whole-home interiors.' },
  { file: 'hisense.html', name: 'Hisense appliances', priority: '0.8',
    title: 'Hisense TVs and appliances, supplied by Hanes Distribution',
    description: 'Hisense TVs, refrigeration, laundry, air conditioning, cooking and ventilation, supplied nationwide by Hanes. Flip through the 2026 catalogues.',
    og: 'hisense.jpg', ogAlt: 'A Hisense four-door fridge in a modern kitchen', about: 'hisense' },
  { file: 'tracking.html', name: 'Hanes Track', priority: '0.6',
    title: 'Hanes Track — Shipment tracking from factory to site',
    description: 'Hanes Track follows every order through six milestones, from the factory in Asia to your site in New Zealand. Request a shipment update online.',
    og: 'tracking.jpg', ogAlt: 'Hanes Track: a shipment crossing the globe to New Zealand', about: 'track' },
  { file: 'contact.html', name: 'Contact', priority: '0.7',
    title: 'Contact Hanes Distribution — Offices and enquiries',
    description: 'Contact Hanes Distribution: head office and showroom in Sockburn, warehouse in Hornby, Christchurch, and offices in Hong Kong and Zhangzhou.',
    og: 'contact-2.jpg', ogAlt: 'A container ship at sea, on its way to New Zealand', about: 'contact' },
  { file: 'privacy.html', name: 'Privacy statement', priority: '0.3',
    title: 'Privacy statement — Hanes Distribution and Bargainhub',
    description: 'How Hanes Distribution and Bargainhub collect, use, store and share your personal information, who processes it for us and where, and your rights.',
    og: 'index.jpg', ogAlt: 'A Hanes Distribution truck: engineered supply, delivered nationwide' }
];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const url = p => SITE + (p.path || '/' + p.file);
const place = (name, street, locality, region, country) => ({ '@type': 'Place', name, address: { '@type': 'PostalAddress', streetAddress: street, addressLocality: locality, ...(region ? { addressRegion: region } : {}), addressCountry: country } });

function graph(p) {
  const u = url(p), org = { '@id': SITE + '/#organization' };
  const items = [
    { '@type': 'Organization', '@id': org['@id'], name: ORG, url: SITE + '/', logo: { '@type': 'ImageObject', url: SITE + '/og/logo.png', width: 512, height: 512 }, email: EMAIL,
      contactPoint: [{ '@type': 'ContactPoint', contactType: 'sales', email: EMAIL, areaServed: 'NZ', availableLanguage: ['en'] }],
      address: { '@type': 'PostalAddress', streetAddress: '93 Main South Road', addressLocality: 'Sockburn, Christchurch', addressRegion: 'Canterbury', addressCountry: 'NZ' },
      areaServed: { '@type': 'Country', name: 'New Zealand' },
      location: [
        place('Head office and showroom', '93 Main South Road', 'Sockburn, Christchurch', 'Canterbury', 'NZ'),
        place('Warehouse', '44 Anchorage Road', 'Hornby, Christchurch', 'Canterbury', 'NZ'),
        place('Asia branch', 'World Trust Tower, 50 Stanley Street', 'Central, Hong Kong', '', 'HK'),
        place('China branch', "301/13 Huayuan, Yan'an Square", 'Zhangzhou', 'Fujian', 'CN')],
      brand: BRANDS.map(b => ({ '@type': 'Brand', name: b })) },
    { '@type': 'WebSite', '@id': SITE + '/#website', url: SITE + '/', name: ORG, publisher: org, inLanguage: 'en-NZ' },
    { '@type': p.about === 'contact' ? 'ContactPage' : 'WebPage', '@id': u + '#webpage', url: u, name: p.title, description: p.description, inLanguage: 'en-NZ',
      isPartOf: { '@id': SITE + '/#website' }, publisher: org,
      primaryImageOfPage: { '@type': 'ImageObject', url: `${SITE}/og/${p.og}`, width: 1200, height: 630 },
      ...(p.path === '/' ? {} : { breadcrumb: { '@id': u + '#breadcrumb' } }),
      about: p.brand ? { '@type': 'Brand', name: p.name.replace(' Interiors', ''), description: p.brand, url: u }
        : p.about === 'hisense' ? { '@type': 'Brand', name: 'Hisense' }
        : p.about === 'track' ? { '@type': 'Service', name: 'Hanes Track', serviceType: 'Shipment tracking', provider: org, areaServed: 'NZ' }
        : org }
  ];
  if (p.path !== '/') items.push({ '@type': 'BreadcrumbList', '@id': u + '#breadcrumb', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
    { '@type': 'ListItem', position: 2, name: p.name, item: u }] });
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': items }).replace(/</g, '\\u003c');
}

function block(p) {
  const u = url(p), img = `${SITE}/og/${p.og}`;
  return `<!-- seo -->
<link rel="canonical" href="${esc(u)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${ORG}">
<meta property="og:locale" content="en_NZ">
<meta property="og:url" content="${esc(u)}">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(p.ogAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(p.title)}">
<meta name="twitter:description" content="${esc(p.description)}">
<meta name="twitter:image" content="${esc(img)}">
<script type="application/ld+json">${graph(p)}</script>
<!-- /seo -->`;
}

const today = new Date().toISOString().slice(0, 10);
const lastmod = f => {
  try {
    if (execSync(`git status --porcelain -- "${f}"`, { cwd: root }).toString().trim()) return today;
    return execSync(`git log -1 --format=%cs -- "${f}"`, { cwd: root }).toString().trim() || today;
  } catch { return today; }
};

for (const p of PAGES) {
  const file = root + p.file;
  let s = readFileSync(file, 'utf8');
  if (!existsSync(root + 'og/' + p.og)) throw new Error(`Missing og/${p.og}`);
  s = s.replace(/\n?<!-- seo -->[\s\S]*?<!-- \/seo -->/, '')
    .replace(/\n?<link rel="canonical"[^>]*>/g, '')
    .replace(/\n?<meta name="robots"[^>]*>/g, '')
    .replace(/\n?<meta property="og:[^"]*"[^>]*>/g, '')
    .replace(/\n?<meta name="twitter:[^"]*"[^>]*>/g, '')
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(p.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(p.description)}">\n${block(p)}`);
  if (!s.includes('<!-- seo -->')) throw new Error(`${p.file}: no <meta name="description"> to anchor the tags`);
  writeFileSync(file, s);
}

writeFileSync(root + 'sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.map(p => `  <url><loc>${esc(url(p))}</loc><lastmod>${lastmod(p.file)}</lastmod><priority>${p.priority}</priority></url>`).join('\n')}
</urlset>
`);
writeFileSync(root + 'robots.txt', `# Hanes Distribution
User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${SITE}/sitemap.xml
`);
console.log(`SEO written for ${PAGES.length} pages at ${SITE}, plus sitemap.xml and robots.txt`);
