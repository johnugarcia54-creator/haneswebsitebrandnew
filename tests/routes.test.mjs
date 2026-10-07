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
