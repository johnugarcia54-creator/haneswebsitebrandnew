/* vercel.json (ADDENDUM §2.3 and §10.2): Vercel accepts it, and it routes every case of the
   §2.3 table exactly as specified, through the same evaluator scripts/dev.mjs uses. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { matchRoute, resolveFile } from '../scripts/routes.mjs';

const require = createRequire(import.meta.url);
const { routesSchema, normalizeRoutes, getTransformedRoutes } = require('@vercel/routing-utils');
const Ajv = require('ajv');

const root = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(readFileSync(root + 'vercel.json', 'utf8'));
const routes = config.routes;

const PROD_HOST = 'hanes-the-website-new.vercel.app';
const PREVIEW_ALIAS = 'hanes-the-website-new-git-staging-hanes.vercel.app';
const PROD_DEPLOYMENT_URL = 'hanes-the-website-new-k3j9x2abc-hanes.vercel.app';
const PROD_FLY = 'https://bargainhub-studio.fly.dev';
const STAGING_FLY = 'https://bargainhub-studio-staging.fly.dev';
// what §2.3 says each Vercel environment holds (stand-in values: no real secret is ever in the repo)
const PRODUCTION_ENV = { STUDIO_EDGE_SECRET_PROD: 'test-prod-value', STUDIO_EDGE_SECRET_STAGING: 'not-this-environment' };
const PREVIEW_ENV = { STUDIO_EDGE_SECRET_PROD: 'not-this-environment', STUDIO_EDGE_SECRET_STAGING: 'test-staging-value' };

// the deployment: this repository's files, plus the W2 sign-in pages and a font named in the case table
const EXTRA = new Set(['/auth/login.html', '/fonts/x.woff2']);
const filesystem = p => EXTRA.has(p) || !!resolveFile(root, p);
const run = (path, host = PROD_HOST, env = host === PROD_HOST ? PRODUCTION_ENV : PREVIEW_ENV) => matchRoute(routes, { path, host, env, filesystem });

const PERMISSIONS = 'camera=(), microphone=(), geolocation=(), payment=()';
const MARKETING = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': PERMISSIONS,
  'Content-Security-Policy': "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; upgrade-insecure-requests"
};
// W1a ships the wildcard until the Supabase ref is wired in; W1b narrows this one constant to
// 'self' https://mputtezdhevwwjgwktvi.supabase.co and adds a test that refuses any wildcard.
const AUTH_CONNECT_SRC = "'self' https://*.supabase.co";
const AUTH = {
  'Content-Security-Policy': `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src ${AUTH_CONNECT_SRC}; img-src 'self' data:; style-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`,
  'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Permissions-Policy': PERMISSIONS
};
const STUDIO = { 'X-Robots-Tag': 'noindex', 'Permissions-Policy': PERMISSIONS, 'x-vercel-enable-rewrite-caching': '1' };
const API = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'x-vercel-enable-rewrite-caching': '0' };
const LONG_CACHE = { 'Cache-Control': 'public, max-age=31536000, immutable' };
const WEEK_CACHE = { 'Cache-Control': 'public, max-age=604800, stale-while-revalidate=2592000' };

test('(a) routes validate against @vercel/routing-utils routesSchema (ajv, strict:false)', () => {
  const validate = new Ajv({ strict: false, allErrors: true }).compile(routesSchema);
  assert.equal(validate(routes), true, JSON.stringify(validate.errors, null, 2));
});

test('(b) normalizeRoutes accepts the routes without error', () => {
  const n = normalizeRoutes(routes);
  assert.equal(n.error, null, n.error && n.error.message);
});

test('(c) the routes form only: no redirects, rewrites, headers, cleanUrls or trailingSlash; region and function as specified', () => {
  for (const k of ['redirects', 'rewrites', 'headers', 'cleanUrls', 'trailingSlash']) assert.equal(k in config, false, `${k} must not be in vercel.json`);
  assert.deepEqual(Object.keys(config).sort(), ['$schema', 'functions', 'regions', 'routes']);
  assert.deepEqual(config.regions, ['syd1']);
  assert.deepEqual(config.functions, { 'api/enquiry.js': { maxDuration: 20 } });
});

test('route order is the contract: header routes, redirects, filesystem, production rewrites, staging rewrites', () => {
  const kind = r => r.handle ? 'fs' : r.continue ? 'header' : r.status ? 'redirect' : r.dest ? (r.has ? 'prod' : 'staging') : 'other';
  const seq = routes.map(kind);
  assert.equal(seq.includes('other'), false);
  const collapsed = seq.filter((k, i) => k !== seq[i - 1]);
  assert.deepEqual(collapsed, ['header', 'redirect', 'fs', 'prod', 'staging']);
  assert.equal(seq.filter(k => k === 'header').length, 6);
  assert.equal(seq.filter(k => k === 'prod').length, 2);
  assert.equal(seq.filter(k => k === 'staging').length, 2);
  for (const r of routes.filter(r => r.src)) assert.match(r.src, /^\^.*\$$/, `${r.src} is anchored`);
});

/* ---------- (d) the §2.3 case table ---------- */

test('/studio (prod) → 307 to /studio/', () => {
  const r = run('/studio');
  assert.equal(r.kind, 'redirect');
  assert.equal(r.status, 307);
  assert.equal(r.location, '/studio/');
});

for (const p of ['/studio/', '/studio/index.html', '/studio/src/app.js', '/studio/consultant.html']) {
  test(`${p} (prod) → production Fly with the production secret and the studio headers`, () => {
    const r = run(p);
    assert.equal(r.kind, 'proxy');
    assert.equal(r.dest, PROD_FLY + p.slice('/studio'.length));
    assert.deepEqual(r.requestHeaders, { 'x-studio-edge': PRODUCTION_ENV.STUDIO_EDGE_SECRET_PROD });
    assert.equal(r.respectOriginCacheControl, true);
    assert.deepEqual(r.headers, STUDIO);
  });
}

test('/studio/ itself is rewritten (empty capture → the studio root), and the query string is kept', () => {
  assert.equal(run('/studio/').dest, PROD_FLY + '/');
  assert.equal(run('/studio/x?y=1').dest, PROD_FLY + '/x?y=1');
  assert.equal(run('/studio/#/account'.split('#')[0]).dest, PROD_FLY + '/', 'the hash never reaches the server');
});

test('/api/enquiry (prod) → the website function from the filesystem, with the API headers', () => {
  for (const p of ['/api/enquiry', '/api/enquiry?x=1']) {
    const r = run(p);
    assert.equal(r.kind, 'filesystem');
    assert.equal(r.path, '/api/enquiry');
    assert.deepEqual(r.headers, API);
    assert.deepEqual(r.requestHeaders, {}, 'the function never receives the edge secret');
  }
  assert.equal(resolveFile(root, '/api/enquiry').type, 'function');
});

for (const [p, up] of [['/api/session', '/api/session'], ['/api/auth/exchange', '/api/auth/exchange'], ['/api/', '/api/'], ['/api/enquiry/x', '/api/enquiry/x'], ['/api/session?scope=mine', '/api/session?scope=mine']]) {
  test(`${p} (prod) → production Fly ${up}, caching off`, () => {
    const r = run(p);
    assert.equal(r.kind, 'proxy');
    assert.equal(r.dest, PROD_FLY + up);
    assert.equal(r.respectOriginCacheControl, false);
    assert.deepEqual(r.requestHeaders, { 'x-studio-edge': PRODUCTION_ENV.STUDIO_EDGE_SECRET_PROD });
    assert.deepEqual(r.headers, API);
  });
}

test('the preview alias goes to staging Fly with the staging secret', () => {
  for (const [p, dest] of [['/studio/', STAGING_FLY + '/'], ['/api/session', STAGING_FLY + '/api/session']]) {
    const r = run(p, PREVIEW_ALIAS, PREVIEW_ENV);
    assert.equal(r.kind, 'proxy');
    assert.equal(r.dest, dest);
    assert.deepEqual(r.requestHeaders, { 'x-studio-edge': PREVIEW_ENV.STUDIO_EDGE_SECRET_STAGING });
  }
});

test('a production deployment opened on its own URL chooses the STAGING secret, never the production one', () => {
  for (const p of ['/studio/', '/studio/src/app.js', '/api/session', '/api/auth/exchange']) {
    const r = run(p, PROD_DEPLOYMENT_URL, PRODUCTION_ENV);
    assert.equal(r.kind, 'proxy');
    assert.ok(r.dest.startsWith(STAGING_FLY + '/'), r.dest);
    assert.deepEqual(r.requestHeaders, { 'x-studio-edge': 'not-this-environment' });
    assert.ok(!JSON.stringify(r).includes(PRODUCTION_ENV.STUDIO_EDGE_SECRET_PROD));
  }
  // nor a look-alike host
  for (const h of ['hanes-the-website-new.vercel.app.evil.example', 'xhanes-the-website-new.vercel.app'])
    assert.ok(run('/api/session', h, PRODUCTION_ENV).dest.startsWith(STAGING_FLY));
});

test('local development (any other host) goes to the staging rules', () => {
  const r = run('/studio/', 'localhost:3000', { STUDIO_EDGE_SECRET_STAGING: 'dev-value' });
  assert.equal(r.dest, STAGING_FLY + '/');
  assert.deepEqual(r.requestHeaders, { 'x-studio-edge': 'dev-value' });
});

for (const [p, expected] of [
  ['/', MARKETING],
  ['/bargainhub.html', MARKETING],
  ['/privacy.html', MARKETING],
  ['/assets/site.js', MARKETING],
  ['/auth/login.html', AUTH],
  ['/fonts/x.woff2', { ...MARKETING, ...LONG_CACHE }],
  ['/vendor/gsap.min.js', { ...MARKETING, ...LONG_CACHE }],
  ['/og/index.jpg', { ...MARKETING, ...WEEK_CACHE }]
]) {
  test(`${p} → filesystem with its group's headers`, () => {
    const r = run(p);
    assert.equal(r.kind, 'filesystem');
    assert.deepEqual(r.headers, expected);
    assert.deepEqual(r.requestHeaders, {});
  });
}

const REDIRECTS = [
  ['/bargainhub', 308, '/bargainhub.html'], ['/hisense', 308, '/hisense.html'], ['/quote', 308, '/contact.html'],
  ['/catalogues', 307, '/hisense.html#catalogues'], ['/login', 307, '/auth/login.html'], ['/signup', 307, '/auth/signup.html'],
  ['/reset', 307, '/auth/reset.html'], ['/staff', 307, '/auth/login.html?next=/studio/%23/backoffice'], ['/privacy', 307, '/privacy.html'],
  ['/studio', 307, '/studio/'], ['/index', 308, '/'], ['/track', 308, '/tracking.html']
];
for (const [p, status, location] of REDIRECTS) {
  test(`${p} → ${status} ${location}`, () => {
    for (const host of [PROD_HOST, PREVIEW_ALIAS]) {
      const r = run(p, host);
      assert.equal(r.kind, 'redirect');
      assert.equal(r.status, status);
      assert.equal(r.location, location);
    }
  });
}

test('an unknown address is a 404 with the marketing headers (Vercel serves 404.html)', () => {
  const r = run('/no-such-page');
  assert.equal(r.kind, 'notfound');
  assert.deepEqual(r.headers, MARKETING);
});

/* ---------- (e) header groups never overlap ---------- */

test('(e) no header name is set by two groups on any path', () => {
  const groups = routes.filter(r => r.continue && r.headers);
  const paths = ['/', '/index.html', '/bargainhub.html', '/privacy.html', '/studio', '/studio/', '/studio/index.html', '/studio/src/app.js',
    '/studio/consultant.html', '/api/', '/api/enquiry', '/api/session', '/api/auth/exchange', '/auth/login.html', '/auth/', '/fonts/x.woff2',
    '/vendor/gsap.min.js', '/frames2/a/lg/1.webp', '/stills/x.jpg', '/catalogues/tv/001.webp', '/films/a.mp4', '/og/index.jpg',
    '/login', '/staff', '/catalogues', '/no-such-page', '/assets/site.css', '/sitemap.xml', '/robots.txt'];
  for (const p of paths) {
    const seen = new Map();
    for (const g of groups) {
      if (!new RegExp(g.src, g.caseSensitive ? '' : 'i').test(p)) continue;
      for (const name of Object.keys(g.headers)) {
        const k = name.toLowerCase();
        assert.equal(seen.has(k), false, `${p}: ${name} is set by ${seen.get(k)} and ${g.src}`);
        seen.set(k, g.src);
      }
    }
  }
});

test('the studio and API groups never get the marketing CSP or frame headers (Fly sets its own)', () => {
  for (const p of ['/studio/', '/api/session']) {
    const h = Object.keys(run(p).headers).map(k => k.toLowerCase());
    for (const k of ['content-security-policy', 'x-frame-options', 'referrer-policy']) assert.equal(h.includes(k), false, `${p} ${k}`);
  }
});

/* ---------- (f) rewrites carry the secret by env name only; production ones are host-bound ---------- */

test('(f) every rewrite sets x-studio-edge from an env name, and the production rewrites carry has host', () => {
  const rewrites = routes.filter(r => r.dest);
  assert.equal(rewrites.length, 4);
  for (const r of rewrites) {
    assert.match(r.dest, /^https:\/\/bargainhub-studio(-staging)?\.fly\.dev\//);
    assert.equal(r.continue, undefined);
    const prod = r.dest.startsWith(PROD_FLY + '/');
    const name = prod ? 'STUDIO_EDGE_SECRET_PROD' : 'STUDIO_EDGE_SECRET_STAGING';
    assert.deepEqual(r.transforms, [{ type: 'request.headers', op: 'set', target: { key: 'x-studio-edge' }, args: '$' + name, env: [name] }]);
    if (prod) assert.deepEqual(r.has, [{ type: 'host', value: PROD_HOST }]);
    else assert.equal(r.has, undefined);
    assert.equal(r.respectOriginCacheControl, r.src.startsWith('^/studio/'));
  }
  // the /api rewrites can never take the enquiry function
  for (const r of rewrites.filter(r => r.src.startsWith('^/api/'))) assert.equal(r.src, '^/api/((?!enquiry$).*)$');
});

test('no secret value is written in vercel.json', () => {
  const text = readFileSync(root + 'vercel.json', 'utf8');
  const args = [...text.matchAll(/"args":\s*"([^"]*)"/g)].map(m => m[1]);
  assert.equal(args.length, 4);
  for (const a of args) assert.match(a, /^\$STUDIO_EDGE_SECRET_(PROD|STAGING)$/);
  assert.equal(/not-this-environment|x-studio-edge"\s*:/.test(text), false);
});

/* ---------- (g) the five old redirects behave exactly as before (vercel.json at 8ea24e6) ---------- */

const OLD_REDIRECTS = [
  { source: '/index', destination: '/', permanent: true },
  { source: '/:page(hanesteel|hanestone|hanewood|hanesulation|bargainhub|hisense|tracking|contact)', destination: '/:page.html', permanent: true },
  { source: '/(contact-us|enquiry|enquire|quote)', destination: '/contact.html', permanent: true },
  { source: '/track', destination: '/tracking.html', permanent: true },
  { source: '/catalogues', destination: '/hisense.html#catalogues', permanent: false }
];

test('(g) the five old redirects keep their status and Location', () => {
  const old = getTransformedRoutes({ redirects: OLD_REDIRECTS });
  assert.equal(old.error, null);
  const paths = ['/index', '/hanesteel', '/hanestone', '/hanewood', '/hanesulation', '/bargainhub', '/hisense', '/tracking', '/contact',
    '/contact-us', '/enquiry', '/enquire', '/quote', '/track', '/catalogues'];
  for (const p of paths) {
    const before = matchRoute(old.routes, { path: p }), now = run(p);
    assert.equal(before.kind, 'redirect', p);
    assert.equal(now.kind, 'redirect', p);
    assert.equal(now.status, before.status, `${p} status`);
    assert.equal(now.location, before.location, `${p} Location`);
  }
  // and nothing else that used to be a page became a redirect
  for (const p of ['/index.html', '/contact.html', '/hisense.html', '/tracking.html']) assert.equal(run(p).kind, 'filesystem', p);
});

test('the site runs on Node 24, the newest LTS Vercel supports (owner rule, DEPENDENCY-POLICY.md)', () => {
  // engines.node sets the Vercel runtime of api/enquiry.js; CI tests Node 24 and keeps 22 covered
  const ci = readFileSync(root + '.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /node:\s*\[24, 22\]/);
  assert.match(ci, /node-version:\s*\$\{\{ matrix\.node \}\}/);
  const smoke = readFileSync(root + '.github/workflows/smoke.yml', 'utf8');
  assert.deepEqual([...smoke.matchAll(/node-version:\s*['"]?([^'"\s]+)/g)].map(m => m[1]), ['24']);
  const pkg = JSON.parse(readFileSync(root + 'package.json', 'utf8'));
  assert.deepEqual(pkg.engines, { node: '24.x' });
  const lock = JSON.parse(readFileSync(root + 'package-lock.json', 'utf8'));
  assert.deepEqual(lock.packages[''].engines, { node: '24.x' });
});
