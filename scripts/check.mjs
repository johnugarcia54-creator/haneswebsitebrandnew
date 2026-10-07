/* =========================================================================================
   Site check: npm run check. Fails (exit 1) on anything that would break for a visitor or
   a search engine, so it runs before every deploy (see .github/workflows/ci.yml).
   - every link, image, video, script, stylesheet and CSS url() points at a real file
   - every #anchor exists on the page it points to
   - every page has one <h1>, a title, a description, a canonical address, sharing tags
     and valid structured data, and every image has alt text
   - the sitemap lists every page, and robots.txt points at it
   - no page still sends enquiries through the visitor's email app
   - links into PROXIED_PREFIXES (served by the studio through the rewrite) are not file-checked
   - app pages (any .html under auth/, when present): noindex, one <h1>, lang="en-NZ", no inline script,
     <style>, style="" or on*= handler (the /auth CSP would block them), every local file exists
   - no innerHTML, outerHTML, insertAdjacentHTML or document.write in any .js under auth/ or assets/guide/
   - no form still promises "We only use your details to reply to you"
   SITE_CHECK_ROOT=<dir> checks another copy of the site (the tests use it for fixtures)
   ========================================================================================= */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.SITE_CHECK_ROOT ? resolve(process.env.SITE_CHECK_ROOT) + sep : fileURLToPath(new URL('..', import.meta.url));
// paths the site rewrites to the studio server (vercel.json): there is no file here to check
const PROXIED_PREFIXES = ['studio/'];
const proxied = p => PROXIED_PREFIXES.some(x => p === x.replace(/\/$/, '') || p.startsWith(x));
const SITE = JSON.parse(readFileSync(root + 'package.json', 'utf8')).homepage.replace(/\/+$/, '');
const pages = readdirSync(root).filter(f => f.endsWith('.html')).sort();
const errors = [], warn = [];
const err = (f, m) => errors.push(`${f}: ${m}`);

const src = {}, ids = {};
for (const f of pages) {
  src[f] = readFileSync(root + f, 'utf8');
  ids[f] = new Set([...src[f].matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
}
// markup without scripts (so template strings in JavaScript don't count as links)
const markup = s => s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, m => /src=/.test(m.slice(0, m.indexOf('>'))) ? m.slice(0, m.indexOf('>') + 1) : '');
const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

for (const f of pages) {
  const s = src[f], m = markup(s);
  // ---------- links and files
  const refs = [...m.matchAll(/\s(?:href|src|poster|data-src)="([^"]*)"/g)].map(x => x[1]);
  for (const x of m.matchAll(/\ssrcset="([^"]*)"/g)) for (const part of x[1].split(',')) refs.push(part.trim().split(/\s+/)[0]);
  for (const x of m.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)) if (!x[2].startsWith('data:') && !x[2].includes('${')) refs.push(x[2]);
  for (let r of refs) {
    r = decode(r.trim());
    if (!r) { err(f, 'empty link'); continue; }
    if (/^(data:|mailto:|tel:|https?:|\/\/)/.test(r)) {
      if (r.startsWith('mailto:') && r.includes('?')) err(f, `enquiry button opens the email app: ${r.slice(0, 60)}`);
      if (/^https?:/.test(r) && r.startsWith(SITE)) { /* absolute link to this site: fine */ }
      continue;
    }
    if (r.startsWith('javascript:')) { err(f, `javascript: link ${r}`); continue; }
    if (r === '#') { err(f, 'link to "#" goes nowhere'); continue; }
    const [pathq, hash] = r.split('#'), path = pathq.split('?')[0];
    let target = path ? path.replace(/^\//, '') || 'index.html' : f;
    if (path && proxied(target)) continue;
    if (path && !existsSync(root + decodeURIComponent(target))) { err(f, `missing file: ${r}`); continue; }
    if (hash && target.endsWith('.html') && ids[target] && !ids[target].has(hash) && hash !== 'top') err(f, `missing anchor: ${r}`);
  }
  // ---------- images need alt text
  for (const x of m.matchAll(/<img\b[^>]*>/g)) if (!/\salt="/.test(x[0])) err(f, `image without alt text: ${x[0].slice(0, 80)}`);
  // ---------- search and sharing
  const title = (s.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  const desc = decode((s.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '');
  const h1 = (m.match(/<h1\b/g) || []).length;
  if (!title) err(f, 'no <title>'); else if (title.length > 70) warn.push(`${f}: title is ${title.length} characters (search results show about 60)`);
  if (!desc) err(f, 'no meta description'); else if (desc.length > 170 || desc.length < 50) warn.push(`${f}: description is ${desc.length} characters (aim for 120 to 160)`);
  if (h1 !== 1) err(f, `${h1} <h1> headings (want 1)`);
  if (!/<html lang="en-NZ">/.test(s)) err(f, 'missing lang="en-NZ"');
  if (f === '404.html') { if (!/<meta name="robots" content="noindex">/.test(s)) err(f, '404 page should be noindex'); continue; }
  const canon = (s.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  if (!canon || !canon.startsWith(SITE + '/')) err(f, `canonical should start with ${SITE}/ (got ${canon})`);
  for (const k of ['og:title', 'og:description', 'og:image', 'og:url']) if (!s.includes(`property="${k}"`)) err(f, `missing ${k}`);
  if (!s.includes('name="twitter:card"')) err(f, 'missing twitter:card');
  const og = (s.match(/<meta property="og:image" content="([^"]+)"/) || [])[1];
  if (og && !existsSync(root + og.replace(SITE + '/', ''))) err(f, `sharing image missing: ${og}`);
  const ld = [...s.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (!ld.length) err(f, 'no structured data');
  for (const x of ld) { try { JSON.parse(x[1]); } catch (e) { err(f, `structured data is not valid JSON: ${e.message}`); } }
}

// ---------- app pages (any .html under auth/): served under a strict CSP with no inline code
// every file under a folder, at any depth, as paths relative to the site root
const walk = d => !existsSync(root + d) ? [] : readdirSync(root + d, { withFileTypes: true })
  .sort((a, b) => a.name.localeCompare(b.name))
  .flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`) : e.isFile() ? [`${d}/${e.name}`] : []);
const appPages = walk('auth').filter(n => n.endsWith('.html'));
for (const f of appPages) {
  const dir = f.slice(0, f.lastIndexOf('/')), s = readFileSync(root + f, 'utf8');
  const m = s.replace(/<!--[\s\S]*?-->/g, '');
  if (!/<meta name="robots" content="noindex[^"]*">/.test(m)) err(f, 'app page should have <meta name="robots" content="noindex">');
  const h1 = (m.match(/<h1\b/gi) || []).length;
  if (h1 !== 1) err(f, `${h1} <h1> headings (want 1)`);
  if (!/<html lang="en-NZ">/.test(m)) err(f, 'missing lang="en-NZ"');
  if (!/<title>[^<]+<\/title>/.test(m)) err(f, 'no <title>');
  for (const x of m.matchAll(/<script\b([^>]*)>/gi)) if (!/\ssrc\s*=\s*"[^"]+"/i.test(x[1])) err(f, `inline <script> (only external files are allowed): ${x[0].slice(0, 60)}`);
  if (/<style\b/i.test(m)) err(f, '<style> block (use a stylesheet file)');
  for (const x of m.matchAll(/<[a-z][^>]*?\sstyle\s*=/gi)) err(f, `style="" attribute: ${x[0].slice(0, 60)}`);
  for (const x of m.matchAll(/<[a-z][^>]*?\s(on[a-z]+)\s*=/gi)) err(f, `inline event handler ${x[1]}=`);
  for (const x of m.matchAll(/\s(?:src|href)="([^"]*)"/g)) {
    const r = decode(x[1].trim());
    if (!r) { err(f, 'empty link'); continue; }
    if (/^(data:|mailto:|tel:|https?:|\/\/|#)/.test(r)) continue;
    if (r.startsWith('javascript:')) { err(f, `javascript: link ${r}`); continue; }
    const path = r.split('#')[0].split('?')[0];
    const target = path.startsWith('/') ? path.slice(1) || 'index.html' : `${dir}/${path}`;
    if (proxied(target)) continue;
    if (!existsSync(root + decodeURIComponent(target))) err(f, `missing file: ${r}`);
  }
}

// ---------- browser code that handles credentials or guide text never parses HTML
for (const dir of ['auth', 'assets/guide']) {
  for (const f of walk(dir).filter(n => /\.(m?js)$/.test(n))) {
    const s = readFileSync(root + f, 'utf8');
    for (const x of s.matchAll(/\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write(?:ln)?)\b/g)) err(f, `${x[1]} is not allowed here (build nodes with textContent)`);
  }
}

// ---------- the old enquiry promise is gone everywhere (ADDENDUM §6.4: the honest notice replaced it)
for (const f of [...pages, 'assets/enquiry.js']) {
  const s = f.endsWith('.html') ? src[f] : readFileSync(root + f, 'utf8');
  if (s.includes('We only use your details to reply to you')) err(f, 'still says "We only use your details to reply to you" (use the enquiry notice and link the privacy statement)');
}

// ---------- sitemap and robots
const sitemap = existsSync(root + 'sitemap.xml') ? readFileSync(root + 'sitemap.xml', 'utf8') : '';
if (!sitemap) err('sitemap.xml', 'missing');
for (const f of pages) {
  if (f === '404.html') continue;
  const u = f === 'index.html' ? `${SITE}/` : `${SITE}/${f}`;
  if (!sitemap.includes(`<loc>${u}</loc>`)) err('sitemap.xml', `missing ${u}`);
}
const robots = existsSync(root + 'robots.txt') ? readFileSync(root + 'robots.txt', 'utf8') : '';
if (!robots.includes(`Sitemap: ${SITE}/sitemap.xml`)) err('robots.txt', 'should point at the sitemap');

for (const w of warn) console.log('warning  ' + w);
for (const e of errors) console.log('ERROR    ' + e);
console.log(`\nChecked ${pages.length} pages and ${appPages.length} app pages: ${errors.length} errors, ${warn.length} warnings.`);
process.exit(errors.length ? 1 : 0);
