/* Tests for the sharing image words in scripts/og.mjs: npm test (no browser needed). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OG, WITHDRAWN } from '../scripts/og.mjs';

test('the withdrawn claims from the old cards are refused', () => {
  for (const s of ['Aluminium and uPVC, low-E glass, NZS 4211 and CodeMark certified.',
    'An MBIE-recognised substitute for GIB® plasterboard.', 'BRANZ appraised', 'Certified for New Zealand'])
    assert.match(s, WITHDRAWN);
});

test('no sharing image makes a withdrawn claim', () => {
  assert.ok(OG.some(c => c.file === 'hanesteel.jpg') && OG.some(c => c.file === 'hanestone.jpg'));
  for (const c of OG) assert.doesNotMatch(`${c.eyebrow} ${c.headline} ${c.line}`, WITHDRAWN, c.file);
});
