/* The vendored browser builds in vendor/: upstream files copied byte for byte, under a versioned name
   (vendor/ is served immutable for a year, so a new build needs a new address), each with a
   licence file that records where it came from. supabase-js has its own checks in auth.test.mjs. */
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
const SUPABASE = vendor.filter(f => /^supabase-js-\d+\.\d+\.\d+\.min\.js$/.test(f));

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
  for (const [file, licence] of [[LENIS[0], 'vendor/lenis-LICENSE.txt'], [SUPABASE[0], 'vendor/supabase-js-LICENSE.txt']]) {
    const text = read(licence);
    assert.ok(text.startsWith(`vendor/${file} is the unmodified`), `${licence} names vendor/${file}`);
    const m = text.match(/SHA-256: +([0-9a-f]{64}) \(the vendored file\)/);
    assert.ok(m, `${licence} records a SHA-256`);
    assert.equal(sha256('vendor/' + file), m[1], file);
  }
});
