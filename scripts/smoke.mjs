/* =========================================================================================
   Smoke test for a deployed site: node scripts/smoke.mjs https://your-deployment.vercel.app
   Runs in GitHub Actions after every Vercel deployment (.github/workflows/smoke.yml).
   Checks every page, the sitemap, robots.txt, sharing images, short URLs, security headers,
   the 404 page, and that the enquiry API answers and rejects bad requests. It never sends a
   real email (the one test post trips the spam trap, which the API accepts without sending).
   Add --local to skip the checks that only Vercel provides (redirects and headers).
   ========================================================================================= */
const base = (process.argv[2] || '').replace(/\/+$/, '');
const local = process.argv.includes('--local');
if (!/^https?:\/\//.test(base)) { console.error('Usage: node scripts/smoke.mjs https://deployment-url [--local]'); process.exit(2); }

// a deployment behind Vercel's login (Deployment Protection) can't be tested from outside: say so and stop
const first = await fetch(base + '/', { redirect: 'manual' });
if (first.status === 401 || (first.status === 403 && /vercel/i.test(first.headers.get('server') || ''))) {
  console.log(`::notice::${base} is behind Vercel Deployment Protection (HTTP ${first.status}), so it was not tested. Turn protection off for previews, or test the project that serves the site.`);
  process.exit(0);
}

const pages = ['/', '/hanesteel.html', '/hanestone.html', '/hanewood.html', '/hanesulation.html', '/bargainhub.html', '/hisense.html', '/tracking.html', '/contact.html'];
let failed = 0;
const ok = (cond, what) => { console.log(`${cond ? 'pass' : 'FAIL'}  ${what}`); if (!cond) failed++; };
const get = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o });
const post = (body, headers = {}) => get('/api/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: JSON.stringify(body) });

for (const p of pages) {
  const r = await get(p), html = r.ok ? await r.text() : '';
  ok(r.status === 200 && html.includes('<link rel="canonical"') && html.includes('application/ld+json') && html.includes('assets/enquiry.js'), `${p} loads with its SEO tags and the enquiry script (HTTP ${r.status})`);
}
for (const [p, type] of [['/robots.txt', 'text/plain'], ['/sitemap.xml', 'xml'], ['/og/index.jpg', 'image/jpeg'], ['/og/logo.png', 'image/png'], ['/assets/enquiry.js', 'javascript']]) {
  const r = await get(p);
  ok(r.status === 200 && (r.headers.get('content-type') || '').includes(type), `${p} is served (${type})`);
}
const nf = await get('/no-such-page');
ok(nf.status === 404 && (await nf.text()).includes('Page not found'), 'unknown addresses get the 404 page');

if (!local) {
  const rd = await get('/hisense');
  ok(rd.status === 308 && (rd.headers.get('location') || '').endsWith('/hisense.html'), '/hisense redirects to /hisense.html');
  const rt = await get('/track');
  ok([301, 308].includes(rt.status) && (rt.headers.get('location') || '').endsWith('/tracking.html'), '/track redirects to /tracking.html');
  const h = await get('/');
  ok(h.headers.get('x-content-type-options') === 'nosniff' && !!h.headers.get('referrer-policy'), 'security headers are set');
  const og = await get('/og/index.jpg');
  ok((og.headers.get('cache-control') || '').includes('max-age=604800'), 'images are cached');
}

// ---------- the enquiry API
const health = await get('/api/enquiry'), hj = await health.json().catch(() => ({}));
ok(health.status === 200 && hj.ok === true, `GET /api/enquiry answers (email configured: ${hj.configured})`);
const good = { name: 'Smoke Test', email: 'smoke@example.com', subject: 'Smoke test', form: 'smoke', page: '/', elapsed: 5000, fields: [['Message', 'Automated check, please ignore.']] };
ok((await post({ ...good, email: 'not-an-email' }, { 'X-Forwarded-For': '198.51.100.7' })).status === 400, 'a bad email address is rejected (400)');
ok((await post(good, { Origin: 'https://evil.example' })).status === 403, 'posts from other websites are refused (403)');
const trap = await post({ ...good, website: 'http://spam.example' });
ok(trap.status === 200, 'the spam trap accepts quietly without sending (200)');
ok((await get('/api/enquiry', { method: 'PUT' })).status === 405, 'other methods are refused (405)');

console.log(`\n${failed ? `${failed} check(s) failed` : 'All checks passed'} for ${base}`);
process.exit(failed ? 1 : 0);
