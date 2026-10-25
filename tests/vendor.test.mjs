/* The vendored browser builds in vendor/: upstream files copied byte for byte, under a versioned name
   (vendor/ is served immutable for a year, so a new build needs a new address), each with a
   licence file that records where it came from. supabase-js has its own checks in auth.test.mjs,
   which also names the one older supabase-js build kept for the studio. */
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

test('each vendored build is the file its licence names, with the SHA-256 it records', () => {
  assert.deepEqual(SUPABASE, [SUPABASE_KEPT, SUPABASE_CURRENT].sort(), 'the supabase-js builds, by name');
  for (const [file, licence] of [[LENIS[0], 'vendor/lenis-LICENSE.txt'], [SUPABASE_CURRENT, 'vendor/supabase-js-LICENSE.txt']]) {
    const text = read(licence);
    assert.ok(text.startsWith(`vendor/${file} is the unmodified`), `${licence} names vendor/${file}`);
    const m = text.match(/SHA-256: +([0-9a-f]{64}) \(the vendored file\)/);
    assert.ok(m, `${licence} records a SHA-256`);
    assert.equal(sha256('vendor/' + file), m[1], file);
  }
  // the kept build has its own record, after the "Kept for the studio" line that names it
  const text = read('vendor/supabase-js-LICENSE.txt'), kept = text.slice(text.indexOf(`Kept for the studio (`));
  assert.ok(kept.includes(`vendor/${SUPABASE_KEPT}`), 'the licence names the kept build');
  const m = kept.match(/SHA-256: +([0-9a-f]{64}) \(the kept file\)/);
  assert.ok(m, 'and records its SHA-256');
  assert.equal(sha256('vendor/' + SUPABASE_KEPT), m[1], SUPABASE_KEPT);
});
