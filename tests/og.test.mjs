/* The sharing cards (og:image, twitter:image): og/cards.json lists the exact text in each
   rendered card; nothing in it may be on the SEO-H0 never-say list, and each image must be the
   one rendered from it (scripts/og-cards.mjs writes the sha256). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NEVER } from './_never-say.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = f => readFileSync(root + f, 'utf8');
const { cards } = JSON.parse(read('og/cards.json'));

// a baseline JPEG's size from its SOF0 or SOF2 marker
const jpegSize = b => {
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m === 0xc0 || m === 0xc2) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
};

test('og/cards.json: the cards that replaced the ones with claims baked in', () => {
  assert.deepEqual(cards.map(c => c.file), ['hanesteel.jpg', 'hanestone.jpg']);
  const steel = cards.find(c => c.file === 'hanesteel.jpg');
  assert.equal(steel.text, 'Aluminium and uPVC windows and doors, built for New Zealand homes.');
});

test('og/cards.json: no card says anything on the never-say list', () => {
  for (const c of cards) {
    const text = [c.eyebrow, c.title, c.text].join('\n');
    for (const re of NEVER) assert.doesNotMatch(text, re, `og/${c.file} matches ${re}`);
  }
});

test('each card image is the one rendered from its manifest entry (sha256), 1200 x 630, from a local photo', () => {
  for (const c of cards) {
    const b = readFileSync(root + 'og/' + c.file);
    assert.match(c.sha256, /^[0-9a-f]{64}$/, c.file);
    assert.equal(createHash('sha256').update(b).digest('hex'), c.sha256, `og/${c.file}: re-run node scripts/og-cards.mjs`);
    assert.deepEqual(jpegSize(b), [1200, 630], c.file);
    assert.ok(existsSync(root + c.photo) && /^stills\//.test(c.photo), `${c.file}: ${c.photo}`);
  }
  // the template loads nothing from the network: only the repo's fonts and the photo it is given
  assert.doesNotMatch(read('scripts/og/card.html'), /https?:\/\//);
});

test('the pages that share a card point og:image and twitter:image at it', () => {
  for (const c of cards) {
    const page = read(c.file.replace(/\.jpg$/, '.html'));
    for (const m of ['property="og:image"', 'name="twitter:image"'])
      assert.ok(page.includes(`<meta ${m} content="https://hanes-the-website-new.vercel.app/og/${c.file}">`), `${c.file}: ${m}`);
  }
});
