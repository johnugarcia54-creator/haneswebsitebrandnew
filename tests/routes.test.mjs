/* The route evaluator itself (scripts/routes.mjs), on small hand-made route lists:
   continue accumulation, first match wins, handle:filesystem, $1 substitution, has host,
   env expansion with both secret names, and the deployment filesystem model. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matchRoute, expandEnv, substitute, hostName, resolveFile } from '../scripts/routes.mjs';

const none = () => false;
const files = (...list) => p => list.includes(p);

test('continue routes accumulate headers, and a later route replaces a header of the same name', () => {
  const routes = [
    { src: '^/.*$', continue: true, headers: { 'X-A': '1', 'X-B': 'first' } },
    { src: '^/b/.*$', continue: true, headers: { 'x-b': 'second' } },
    { handle: 'filesystem' }
  ];
  const r = matchRoute(routes, { path: '/b/c.html', filesystem: files('/b/c.html') });
  assert.equal(r.kind, 'filesystem');
  assert.deepEqual(r.headers, { 'X-A': '1', 'x-b': 'second' });
  const miss = matchRoute(routes, { path: '/z', filesystem: none });
  assert.equal(miss.kind, 'notfound');
  assert.equal(miss.status, 404);
  assert.deepEqual(miss.headers, { 'X-A': '1', 'X-B': 'first' }, 'a 404 still carries the headers collected');
});

test('the first non-continue match wins, before the filesystem and before later routes', () => {
  const routes = [
    { src: '^/a$', status: 308, headers: { Location: '/first' } },
    { src: '^/a$', status: 307, headers: { Location: '/second' } },
    { handle: 'filesystem' },
    { src: '^/a$', dest: 'https://late.example/a' }
  ];
  const r = matchRoute(routes, { path: '/a', filesystem: files('/a') });
  assert.equal(r.kind, 'redirect');
  assert.equal(r.status, 308);
  assert.equal(r.location, '/first');
});

test('handle:filesystem serves an existing file before any rewrite after it, and misses fall through', () => {
  const routes = [{ handle: 'filesystem' }, { src: '^/api/(.*)$', dest: 'https://up.example/api/$1' }];
  assert.equal(matchRoute(routes, { path: '/api/enquiry', filesystem: files('/api/enquiry') }).kind, 'filesystem');
  const r = matchRoute(routes, { path: '/api/session?x=1', filesystem: files('/api/enquiry') });
  assert.equal(r.kind, 'proxy');
  assert.equal(r.dest, 'https://up.example/api/session?x=1', 'the query string travels with the proxy');
});

test('$1 substitution in dest and in header values; an empty capture gives an empty string', () => {
  const routes = [
    { src: '^/(one|two)$', status: 308, headers: { Location: '/$1.html' } },
    { src: '^/s/(.*)$', dest: 'https://up.example/$1' }
  ];
  assert.equal(matchRoute(routes, { path: '/two' }).location, '/two.html');
  assert.equal(matchRoute(routes, { path: '/s/' }).dest, 'https://up.example/');
  assert.equal(matchRoute(routes, { path: '/s/a/b.js' }).dest, 'https://up.example/a/b.js');
  assert.equal(substitute('$1-$2-$9', ['x', 'a', 'b']), 'a-b-');
});

test('src matching is case-insensitive unless caseSensitive is set (Vercel default)', () => {
  const routes = [{ src: '^/abc$', status: 307, headers: { Location: '/x' } }];
  assert.equal(matchRoute(routes, { path: '/ABC' }).kind, 'redirect');
  assert.equal(matchRoute([{ ...routes[0], caseSensitive: true }], { path: '/ABC' }).kind, 'notfound');
});

test('has host binds a route to one host name (port and letter case ignored); missing is its inverse', () => {
  const routes = [
    { src: '^/x$', has: [{ type: 'host', value: 'prod.example.app' }], dest: 'https://prod.up/x' },
    { src: '^/x$', dest: 'https://staging.up/x' }
  ];
  assert.equal(matchRoute(routes, { path: '/x', host: 'prod.example.app' }).dest, 'https://prod.up/x');
  assert.equal(matchRoute(routes, { path: '/x', host: 'PROD.example.app:443' }).dest, 'https://prod.up/x');
  assert.equal(matchRoute(routes, { path: '/x', host: 'prod-abc123.example.app' }).dest, 'https://staging.up/x');
  assert.equal(matchRoute(routes, { path: '/x', host: 'sub.prod.example.app' }).dest, 'https://staging.up/x', 'the host value is anchored');
  const miss = [{ src: '^/y$', missing: [{ type: 'host', value: 'a.example' }], status: 404 }];
  assert.equal(matchRoute(miss, { path: '/y', host: 'a.example' }).kind, 'notfound');
  assert.equal(matchRoute(miss, { path: '/y', host: 'b.example' }).kind, 'status');
  assert.equal(hostName('[::1]:3000'), '[::1]');
  assert.equal(hostName('LocalHost:3000'), 'localhost');
});

test('env expansion in request.headers transforms, with both secret names', () => {
  const t = name => ({ type: 'request.headers', op: 'set', target: { key: 'x-studio-edge' }, args: `$${name}`, env: [name] });
  const routes = [
    { src: '^/p/(.*)$', has: [{ type: 'host', value: 'prod.app' }], dest: 'https://prod.up/$1', transforms: [t('STUDIO_EDGE_SECRET_PROD')] },
    { src: '^/p/(.*)$', dest: 'https://staging.up/$1', transforms: [t('STUDIO_EDGE_SECRET_STAGING')] }
  ];
  const env = { STUDIO_EDGE_SECRET_PROD: 'p-value', STUDIO_EDGE_SECRET_STAGING: 's-value' };
  assert.deepEqual(matchRoute(routes, { path: '/p/a', host: 'prod.app', env }).requestHeaders, { 'x-studio-edge': 'p-value' });
  assert.deepEqual(matchRoute(routes, { path: '/p/a', host: 'other.app', env }).requestHeaders, { 'x-studio-edge': 's-value' });
  const unset = matchRoute(routes, { path: '/p/a', host: 'other.app', env: {} });
  assert.equal(unset.requestHeaders['x-studio-edge'], '');
  assert.deepEqual(unset.missingEnv, ['STUDIO_EDGE_SECRET_STAGING']);
  // only listed names expand, ${NAME} works, and a longer name is never cut short
  assert.equal(expandEnv('Bearer ${A} $A_B $A $C', ['A', 'A_B'], { A: '1', A_B: '2', C: '3' }), 'Bearer 1 2 1 $C');
});

test('append and delete transforms; unknown handles, conditions and transforms fail loudly', () => {
  const routes = [{ src: '^/.*$', continue: true, transforms: [
    { type: 'request.headers', op: 'set', target: { key: 'X-K' }, args: 'a' },
    { type: 'request.headers', op: 'append', target: { key: 'x-k' }, args: 'b' },
    { type: 'request.headers', op: 'set', target: { key: 'x-gone' }, args: 'z' },
    { type: 'request.headers', op: 'delete', target: { key: 'x-gone' } }] }];
  assert.deepEqual(matchRoute(routes, { path: '/' }).requestHeaders, { 'x-k': 'ab' });
  assert.throws(() => matchRoute([{ handle: 'miss' }], { path: '/' }), /not supported/);
  assert.throws(() => matchRoute([{ src: '^/$', has: [{ type: 'header', key: 'x' }], status: 200 }], { path: '/' }), /not supported/);
  assert.throws(() => matchRoute([{ src: '^/$', transforms: [{ type: 'response.headers', op: 'set', target: { key: 'x' } }] }], { path: '/' }), /not supported/);
});

test('a local dest with continue rewrites the path for the routes after it', () => {
  const routes = [{ src: '^/old/(.*)$', dest: '/new/$1', continue: true }, { handle: 'filesystem' }];
  const r = matchRoute(routes, { path: '/old/a.html', filesystem: files('/new/a.html') });
  assert.equal(r.kind, 'filesystem');
  assert.equal(r.path, '/new/a.html');
});

test('resolveFile models the deployment: static files, api functions, nothing private', () => {
  const root = mkdtempSync(join(tmpdir(), 'routes-fs-'));
  try {
    for (const d of ['api/_lib', 'scripts', 'sub', '.git', 'node_modules/x']) mkdirSync(join(root, d), { recursive: true });
    for (const f of ['index.html', 'a.html', 'sub/index.html', 'api/enquiry.js', 'api/_lib/enquiry.js', 'scripts/dev.mjs', '.git/config', 'node_modules/x/i.js', 'vercel.json', 'package.json'])
      writeFileSync(join(root, f), 'x');
    writeFileSync(join(root, '.vercelignore'), '# comment\nscripts/\n');
    const r = p => { const x = resolveFile(root, p); return x && x.type; };
    assert.equal(r('/'), 'static');
    assert.equal(r('/a.html'), 'static');
    assert.equal(r('/a'), null, 'no extension guessing');
    assert.equal(r('/sub/'), 'static');
    assert.equal(r('/sub'), null, 'no folder without the slash');
    assert.equal(r('/api/enquiry'), 'function');
    assert.equal(r('/api/enquiry.js'), null);
    assert.equal(r('/api/_lib/enquiry'), null);
    assert.equal(r('/api/_lib/enquiry.js'), null);
    assert.equal(r('/api/'), null);
    assert.equal(r('/api/enquiry/x'), null);
    assert.equal(r('/scripts/dev.mjs'), null, '.vercelignore is honoured');
    assert.equal(r('/.git/config'), null);
    assert.equal(r('/node_modules/x/i.js'), null);
    assert.equal(r('/vercel.json'), null);
    assert.equal(r('/package.json'), null);
    assert.equal(r('/sub/../a.html'), null);
    assert.equal(r('/%2e%2e/etc/passwd'), null);
    assert.equal(r('/%E0%A4%A'), null, 'a bad escape is a miss, not a crash');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/* ---------- scripts/dev.mjs serves vercel.json's routes through the evaluator ---------- */
import http from 'node:http';
import { createDevServer } from '../scripts/dev.mjs';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));
const raw = (port, path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method, headers }, res => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', c => { data += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
  });
  req.on('error', reject);
  req.end(body);
});

async function withServers(env, fn) {
  const seen = [];
  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Upstream': 'studio-stub' });
      res.end(JSON.stringify({ stub: true, url: req.url }));
    });
  });
  const stubPort = await listen(stub);
  const quiet = { warn() {}, error() {} };
  const dev = createDevServer({ env, studioUrl: `http://127.0.0.1:${stubPort}`, log: quiet });
  const port = await listen(dev);
  try { await fn(port, seen); } finally { await close(dev); await close(stub); }
}

test('dev.mjs: pages, redirects, /studio/ proxied with the staging secret, /api/enquiry local, /api/session proxied', async () => {
  await withServers({ STUDIO_EDGE_SECRET_STAGING: 'dev-test-value' }, async (port, seen) => {
    const home = await raw(port, '/');
    assert.equal(home.status, 200);
    assert.match(home.headers['content-type'], /text\/html/);
    assert.equal(home.headers['content-security-policy'], "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; upgrade-insecure-requests");

    const st = await raw(port, '/studio');
    assert.equal(st.status, 307);
    assert.equal(st.headers.location, '/studio/');
    assert.equal(seen.length, 0, 'the redirect never reaches the studio');

    const root = await raw(port, '/studio/', { headers: { 'X-Forwarded-For': '203.0.113.9', 'X-Real-IP': '203.0.113.9', 'X-Studio-Edge': 'forged' } });
    assert.equal(root.status, 200);
    assert.equal(root.headers['x-upstream'], 'studio-stub');
    assert.equal(root.headers['x-robots-tag'], 'noindex');
    assert.equal(root.headers['x-vercel-enable-rewrite-caching'], '1');
    assert.equal(seen[0].url, '/');
    assert.equal(seen[0].headers['x-studio-edge'], 'dev-test-value');
    assert.equal(seen[0].headers['x-real-ip'], '127.0.0.1');
    assert.equal(seen[0].headers['x-forwarded-for'], '127.0.0.1');
    assert.match(seen[0].headers.host, /^127\.0\.0\.1:\d+$/);

    await raw(port, '/studio/src/app.js?v=2');
    assert.equal(seen[1].url, '/src/app.js?v=2');

    const enq = await raw(port, '/api/enquiry');
    assert.equal(enq.status, 200);
    assert.equal(JSON.parse(enq.body).ok, true);
    assert.equal(enq.headers['cache-control'], 'no-store');
    assert.equal(enq.headers['x-robots-tag'], 'noindex');
    assert.equal(seen.length, 2, '/api/enquiry is the local function, not the studio');

    const sess = await raw(port, '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }, body: '{"a":1}' });
    assert.equal(sess.status, 200);
    assert.equal(sess.headers['cache-control'], 'no-store');
    assert.equal(seen[2].url, '/api/session');
    assert.equal(seen[2].method, 'POST');
    assert.equal(seen[2].body, '{"a":1}');
    assert.equal(seen[2].headers.origin, 'http://localhost:3000', 'Origin passes unchanged');
    assert.equal(seen[2].headers['x-studio-edge'], 'dev-test-value');

    await raw(port, '/api/enquiry/x');
    assert.equal(seen[3].url, '/api/enquiry/x', 'nested /api paths go to the studio');

    const lost = await raw(port, '/no-such-page');
    assert.equal(lost.status, 404);
    assert.match(lost.body, /Page not found/);

    const login = await raw(port, '/login');
    assert.equal(login.status, 307);
    assert.equal(login.headers.location, '/auth/login.html');

    for (const p of ['/scripts/dev.mjs', '/package.json', '/.git/config']) assert.equal((await raw(port, p)).status, 404, p);
    // the function's source is never served: under /api/ it is just another studio path
    const lib = await raw(port, '/api/_lib/enquiry.js');
    assert.equal(lib.headers['x-upstream'], 'studio-stub');
    assert.equal(seen[4].url, '/api/_lib/enquiry.js');
    assert.equal(seen.length, 5);
  });
});

test('dev.mjs never sends the production secret, even for the production host; without a value no edge header is sent', async () => {
  await withServers({ STUDIO_EDGE_SECRET_PROD: 'prod-test-value', STUDIO_EDGE_SECRET_STAGING: 'staging-test-value' }, async (port, seen) => {
    await raw(port, '/studio/', { headers: { Host: 'hanes-the-website-new.vercel.app' } });
    assert.equal(seen[0].headers['x-studio-edge'], undefined);
    assert.ok(!JSON.stringify(seen[0].headers).includes('prod-test-value'));
    await raw(port, '/studio/', { headers: { Host: 'hanes-the-website-new-abc123-hanes.vercel.app' } });
    assert.equal(seen[1].headers['x-studio-edge'], 'staging-test-value');
  });
  await withServers({}, async (port, seen) => {
    await raw(port, '/api/session', { headers: { 'X-Studio-Edge': 'forged' } });
    assert.equal(seen[0].headers['x-studio-edge'], undefined);
  });
});

test('dev.mjs: a studio that is not running gives 502 with the route headers', async () => {
  const dead = http.createServer();
  const deadPort = await listen(dead);
  await close(dead);
  const dev = createDevServer({ env: {}, studioUrl: `http://127.0.0.1:${deadPort}`, log: { warn() {}, error() {} } });
  const port = await listen(dev);
  try {
    const r = await raw(port, '/studio/');
    assert.equal(r.status, 502);
    assert.equal(r.headers['x-robots-tag'], 'noindex');
  } finally { await close(dev); }
});

test('dev.mjs: only the staging secret reaches the routes, and the server listens on loopback by default', async () => {
  const { devRouteEnv } = await import('../scripts/dev.mjs');
  assert.deepEqual(devRouteEnv({ STUDIO_EDGE_SECRET_PROD: 'p', STUDIO_EDGE_SECRET_STAGING: 's', PATH: '/bin' }), { STUDIO_EDGE_SECRET_STAGING: 's' });
  assert.deepEqual(devRouteEnv({ STUDIO_EDGE_SECRET_PROD: 'p' }), {});

  const free = http.createServer();
  const port = await listen(free);
  await close(free);
  const { spawn } = await import('node:child_process');
  const env = { ...process.env, PORT: String(port) };
  delete env.HOST;
  const child = spawn(process.execPath, [new URL('../scripts/dev.mjs', import.meta.url).pathname], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const line = await new Promise((resolve, reject) => {
      let out = '';
      child.stdout.on('data', c => { out += c; if (out.includes('\n')) resolve(out.split('\n')[0]); });
      child.on('exit', code => reject(new Error(`dev.mjs exited ${code}`)));
    });
    assert.equal(line, `Hanes website on http://127.0.0.1:${port}`);
  } finally { child.kill(); }
});
