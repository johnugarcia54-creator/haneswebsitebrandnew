/* The sharing cards (og:image, twitter:image): og/cards.json lists the exact text in each
   rendered card; nothing in it may be on the SEO-H0 never-say list, and each image must be the
   one rendered from it (scripts/og-cards.mjs writes the sha256). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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

test('og/cards.json lists every sharing card on the site, and every page shares one of them', () => {
  const files = readdirSync(root + 'og').filter(f => /\.(jpe?g|png|webp)$/.test(f) && f !== 'logo.png').sort();
  assert.deepEqual(cards.map(c => c.file).sort(), files, 'every image in og/ (the logo aside) has a manifest entry, and every entry an image');
  const pages = readdirSync(root).filter(f => f.endsWith('.html'));
  for (const p of pages) {
    const m = read(p).match(/<meta property="og:image" content="https:\/\/hanes-the-website-new\.vercel\.app\/og\/([^"]+)">/);
    if (m) assert.ok(cards.some(c => c.file === m[1]), `${p} shares og/${m[1]}, which is not in og/cards.json`);
  }
  // the cards re-rendered for SEO-H0
  const want = { 'hanesteel-2.jpg': 'Aluminium and uPVC windows and doors, built for New Zealand homes.' };
  for (const [f, t] of Object.entries(want)) assert.equal(cards.find(c => c.file === f).text, t);
  assert.deepEqual(cards.filter(c => c.rendered !== false).map(c => c.file).sort(),
    ['contact-2.jpg', 'hanesteel-2.jpg', 'hanestone-2.jpg', 'hanesulation-2.jpg', 'hanewood-2.jpg']);
});

test('og/cards.json: no card says anything on the never-say list', () => {
  for (const c of cards) {
    assert.ok(Array.isArray(c.photoText), `${c.file}: photoText lists any lettering legible in the photo`);
    const text = [c.eyebrow, c.title, c.text, ...c.photoText].join('\n');
    for (const re of NEVER) assert.doesNotMatch(text, re, `og/${c.file} matches ${re}`);
  }
});

test('each card image is the one rendered from its manifest entry (sha256), 1200 x 630, from a local photo', () => {
  for (const c of cards) {
    const b = readFileSync(root + 'og/' + c.file);
    assert.match(c.sha256, /^[0-9a-f]{64}$/, c.file);
    assert.equal(createHash('sha256').update(b).digest('hex'), c.sha256, `og/${c.file}: re-run node scripts/og-cards.mjs`);
    assert.deepEqual(jpegSize(b), [1200, 630], c.file);
    if (c.rendered !== false) assert.ok(existsSync(root + c.photo) && /^stills\//.test(c.photo), `${c.file}: ${c.photo}`);
  }
  // the template loads nothing from the network: only the repo's fonts and the photo it is given
  assert.doesNotMatch(read('scripts/og/card.html'), /https?:\/\//);
});

test('the pages that share a card point og:image and twitter:image at it, under a new name (link previews cache by URL)', () => {
  for (const old of ['hanesteel.jpg', 'hanestone.jpg', 'hanewood.jpg', 'hanesulation.jpg', 'contact.jpg']) {
    assert.equal(existsSync(root + 'og/' + old), false, `og/${old} (the card with the claim) is gone`);
    for (const p of readdirSync(root).filter(f => f.endsWith('.html'))) assert.ok(!read(p).includes('/og/' + old), `${p} still names og/${old}`);
  }
  for (const c of cards.filter(c => c.rendered !== false)) {
    const page = read(c.page);
    for (const m of ['property="og:image"', 'name="twitter:image"'])
      assert.ok(page.includes(`<meta ${m} content="https://hanes-the-website-new.vercel.app/og/${c.file}">`), `${c.file}: ${m}`);
  }
});
