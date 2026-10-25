/* The vendored browser builds in vendor/ (GSAP and ScrollTrigger, Lenis, supabase-js): upstream files
   copied byte for byte, under a versioned name (vendor/ is served immutable for a year, so a new
   build needs a new address), each with a licence file that records where it came from.
   supabase-js has its own checks in auth.test.mjs, which also names the one older supabase-js
   build kept for the studio. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = f => readFileSync(root + f, 'utf8');
const sha256 = f => createHash('sha256').update(readFileSync(root + f)).digest('hex');
const vendor = readdirSync(root + 'vendor');
const pages = readdirSync(root).filter(f => f.endsWith('.html')).sort();
const LENIS = vendor.filter(f => /^lenis.*\.js$/.test(f));
const GSAP = vendor.filter(f => /^gsap.*\.js$/i.test(f)), SCROLLTRIGGER = vendor.filter(f => /^scrolltrigger.*\.js$/i.test(f));
const SUPABASE = vendor.filter(f => /^supabase-js.*\.js$/.test(f)).sort();
// by name, as in auth.test.mjs: the build auth.js loads, and 2.117.3, kept while the studio names it
const SUPABASE_CURRENT = 'supabase-js-2.118.0.min.js', SUPABASE_KEPT = 'supabase-js-2.117.3.min.js';

test('exactly one vendored Lenis build, named by its version, and its licence names that version', () => {
  assert.equal(LENIS.length, 1, LENIS.join());
  assert.match(LENIS[0], /^lenis-\d+\.\d+\.\d+\.min\.js$/, 'the file name carries the version');
  const version = LENIS[0].match(/(\d+\.\d+\.\d+)/)[1], v = version.replaceAll('.', '\\.');
  assert.match(read('vendor/' + LENIS[0]), new RegExp(`[\`'"]${v}[\`'"]`), 'the build is that version');
  const licence = read('vendor/lenis-LICENSE.txt');
  assert.match(licence, new RegExp(`Package: +lenis ${v} `));
  assert.match(licence, /The MIT License/);
  assert.match(licence, /sha512-[A-Za-z0-9+/=]+/, 'records the tarball integrity');
  assert.doesNotMatch(read('package.json'), /lenis/, 'not a dependency of the site');
});

test('every page that starts Lenis loads that one build, and no other page loads any', () => {
  let starts = 0;
  for (const f of pages) {
    const s = read(f), tags = s.match(/<script\b[^>]*lenis[^>]*>/g) || [];
    if (!/new Lenis\(/.test(s)) { assert.deepEqual(tags, [], f); continue; }
    starts++;
    assert.deepEqual(tags, [`<script src="vendor/${LENIS[0]}">`], f);
  }
  assert.ok(starts > 0, 'some page starts Lenis');
});

test('exactly one vendored GSAP build and one ScrollTrigger build, both named by one version, and the licence names it', () => {
  assert.equal(GSAP.length, 1, GSAP.join());
  assert.equal(SCROLLTRIGGER.length, 1, SCROLLTRIGGER.join());
  assert.match(GSAP[0], /^gsap-\d+\.\d+\.\d+\.min\.js$/, 'the file name carries the version');
  assert.match(SCROLLTRIGGER[0], /^ScrollTrigger-\d+\.\d+\.\d+\.min\.js$/, 'the file name carries the version');
  const version = GSAP[0].match(/(\d+\.\d+\.\d+)/)[1], v = version.replaceAll('.', '\\.');
  assert.equal(SCROLLTRIGGER[0], `ScrollTrigger-${version}.min.js`, 'both come from the same gsap package');
  for (const [file, name] of [[GSAP[0], 'GSAP'], [SCROLLTRIGGER[0], 'ScrollTrigger']]) {
    const build = read('vendor/' + file);
    assert.ok(build.startsWith(`/*!\n * ${name} ${version}\n`), `${file} is the ${name} build`);
    assert.match(build, new RegExp(`\\.version=[\`'"]${v}[\`'"]`), `${file} is that version`);
  }
  const licence = read('vendor/gsap-LICENSE.txt');
  assert.match(licence, new RegExp(`Package: +gsap ${v} `));
  assert.match(licence, new RegExp(`Tarball: +https://registry\\.npmjs\\.org/gsap/-/gsap-${v}\\.tgz\n`));
  assert.match(licence, /sha512-[A-Za-z0-9+/=]+/, 'records the tarball integrity');
  assert.ok(licence.includes("Standard 'no charge' license: https://gsap.com/standard-license."), 'quotes the package.json license field');
  assert.doesNotMatch(read('package.json'), /gsap/i, 'not a dependency of the site');
});

test('the GSAP licence quotes the licence lines both builds carry, unchanged', () => {
  const licence = read('vendor/gsap-LICENSE.txt');
  for (const file of [GSAP[0], SCROLLTRIGGER[0]]) {
    const lines = read('vendor/' + file).split('\n').slice(0, 8);
    const at = lines.findIndex(l => l.startsWith(' * @license '));
    assert.ok(at > 0, `${file} has a @license line`);
    assert.ok(licence.includes(lines[at] + '\n' + lines[at + 1] + '\n'), `the licence quotes ${file}'s licence lines`);
  }
});

test('every page that uses GSAP loads that one build of each, gsap first, and no other page loads either', () => {
  let uses = 0;
  for (const f of pages) {
    const s = read(f), tags = s.match(/<script\b[^>]*(gsap|scrolltrigger)[^>]*>/gi) || [];
    if (!/\b(gsap|ScrollTrigger)\.\w+\(/.test(s)) { assert.deepEqual(tags, [], f); continue; }
    uses++;
    assert.deepEqual(tags, [`<script src="vendor/${GSAP[0]}">`, `<script src="vendor/${SCROLLTRIGGER[0]}">`], f);
  }
  assert.ok(uses > 0, 'some page uses GSAP');
});

test('no page, sign-in page or script names an unversioned or missing build in vendor/', () => {
  const files = [...pages, ...readdirSync(root + 'auth').filter(f => /\.(html|js)$/.test(f)).map(f => 'auth/' + f),
    ...readdirSync(root + 'auth/zh').filter(f => /\.(html|js)$/.test(f)).map(f => 'auth/zh/' + f),
    ...readdirSync(root + 'assets').filter(f => f.endsWith('.js')).map(f => 'assets/' + f)];
  let named = 0;
  for (const f of files) {
    for (const [, name] of read(f).matchAll(/\bvendor\/([^\s"'`)>?#]+)/g)) {
      named++;
      assert.ok(vendor.includes(name), `${f}: vendor/${name} is not in vendor/`);
      assert.match(name, /-\d+\.\d+\.\d+\.min\.js$/, `${f}: vendor/${name} carries no version`);
    }
  }
  assert.ok(named > 0, 'some file names a build in vendor/');
  for (const f of vendor.filter(f => f.endsWith('.js'))) assert.match(f, /-\d+\.\d+\.\d+\.min\.js$/, `vendor/${f} carries its version`);
});

test('each vendored build is the file its licence names, with the SHA-256 it records', () => {
  assert.deepEqual(SUPABASE, [SUPABASE_KEPT, SUPABASE_CURRENT].sort(), 'the supabase-js builds, by name');
  for (const [file, licence] of [[LENIS[0], 'vendor/lenis-LICENSE.txt'], [SUPABASE_CURRENT, 'vendor/supabase-js-LICENSE.txt']]) {
    const text = read(licence);
    assert.ok(text.startsWith(`vendor/${file} is the unmodified`), `${licence} names vendor/${file}`);
    const m = text.match(/SHA-256: +([0-9a-f]{64}) \(the vendored file\)/);
    assert.ok(m, `${licence} records a SHA-256`);
    assert.equal(sha256('vendor/' + file), m[1], file);
  }
  // the GSAP licence names its two builds, and gives the SHA-256 of each after it
  const gsap = read('vendor/gsap-LICENSE.txt');
  assert.ok(gsap.startsWith(`vendor/${GSAP[0]} is the unmodified`), `gsap-LICENSE.txt names vendor/${GSAP[0]}`);
  assert.ok(gsap.includes(`vendor/${SCROLLTRIGGER[0]} is the unmodified`), `gsap-LICENSE.txt names vendor/${SCROLLTRIGGER[0]}`);
  for (const file of [GSAP[0], SCROLLTRIGGER[0]]) {
    const m = gsap.match(new RegExp(`\\b([0-9a-f]{64}) \\(vendor/${file.replaceAll('.', '\\.')}\\)\n`));
    assert.ok(m, `gsap-LICENSE.txt records the SHA-256 of ${file}`);
    assert.equal(sha256('vendor/' + file), m[1], file);
  }
  // the kept build has its own record, after the "Kept for the studio" line that names it
  const text = read('vendor/supabase-js-LICENSE.txt'), kept = text.slice(text.indexOf(`Kept for the studio (`));
  assert.ok(kept.includes(`vendor/${SUPABASE_KEPT}`), 'the licence names the kept build');
  const m = kept.match(/SHA-256: +([0-9a-f]{64}) \(the kept file\)/);
  assert.ok(m, 'and records its SHA-256');
  assert.equal(sha256('vendor/' + SUPABASE_KEPT), m[1], SUPABASE_KEPT);
});
