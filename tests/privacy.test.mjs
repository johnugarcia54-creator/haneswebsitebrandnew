// privacy.html against ADDENDUM §11.1-11.2: the processor table's places, the Milli line,
// the deletion caveat, and the tables readable at phone width (each cell carries its column).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const s = readFileSync(fileURLToPath(new URL('../privacy.html', import.meta.url)), 'utf8');
const row = name => {
  const m = s.match(new RegExp(`<tr role="row"><th scope="row" role="rowheader">${name.replace(/[.()]/g, '\\$&')}</th>(.*?)</tr>`));
  assert.ok(m, `no row for ${name}`);
  return [...m[1].matchAll(/<td role="cell" data-label="([^"]+)">([^<]*)<\/td>/g)].map(x => [x[1], x[2]]);
};

test('processor table: where each provider holds information, as §11.1 lists it', () => {
  assert.deepEqual(row('Fly.io')[1], ['Where', 'Sydney, Australia']);
  assert.deepEqual(row('Supabase')[1], ['Where', 'Sydney, Australia (a US company)']);
  assert.deepEqual(row('Resend')[1], ['Where', 'United States']);
});

test('Milli line matches the §11.2 notice, and deletion names the inbox and backups', () => {
  assert.ok(s.includes('Use the enquiry or booking form instead.'));
  assert.match(s, /we delete it there too\. Copies in our encrypted backups are not changed, and expire within 13 months\./);
});

test('every table cell is labelled with its column, for the stacked phone layout', () => {
  for (const t of s.match(/<table\b[\s\S]*?<\/table>/g)) {
    assert.match(t, /^<table role="table">/);
    assert.doesNotMatch(t, /<td>/, 'a cell without role and data-label');
    const heads = [...t.matchAll(/<th scope="col" role="columnheader">([^<]*)<\/th>/g)].map(x => x[1]);
    for (const r of t.match(/<tr role="row"><th scope="row"[\s\S]*?<\/tr>/g)) {
      assert.deepEqual([...r.matchAll(/data-label="([^"]+)"/g)].map(x => x[1]), heads.slice(1));
    }
  }
  assert.match(s, /@media \(max-width:640px\)\{[^\n]*\.tbl table,\.tbl tbody,\.tbl tr,\.tbl th,\.tbl td\{display:block\}/);
});

test('privacy.html names the agency and privacy contact from COMPANY.md, with no O10 placeholders left', () => {
  const html = readFileSync(new URL('../privacy.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('data-owner-ask="O10"'));
  assert.ok(html.includes('COMPANY.md'));
  assert.ok(html.includes('This statement is from Hanes Distribution'));
  assert.ok(html.includes('The Privacy Officer, Hanes Distribution'));
  assert.ok(html.includes('93 Main South Road, Sockburn, Christchurch, New Zealand'));
  assert.ok(html.includes('mailto:Enquiry@hanesdistribution.co.nz'));
});
