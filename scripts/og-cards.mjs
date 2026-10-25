/* =========================================================================================
   Renders the sharing cards listed in og/cards.json (og:image and twitter:image, 1200 x 630)
   from scripts/og/card.html with the local Chromium, then writes each image's sha256 back to
   the manifest. Only the site's own photos (stills/) and fonts (fonts/) are used; nothing is
   generated. Run by hand after changing a card's text or photo:
     node scripts/og-cards.mjs            every rendered card in the manifest
     node scripts/og-cards.mjs hanesteel-2  only og/hanesteel-2.jpg
   PLAYWRIGHT_MODULE, CHROMIUM_PATH as in tests/browser/bar.mjs. tests/og.test.mjs checks the
   text against the SEO-H0 never-say list and each image against its sha256.
   ========================================================================================= */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const loadPlaywright = () => {
  for (const m of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node-tools/node_modules/playwright'].filter(Boolean)) {
    try { return require(m); } catch { /* next */ }
  }
  throw new Error('playwright not found: set PLAYWRIGHT_MODULE');
};

const MANIFEST = root + 'og/cards.json';
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const only = process.argv.slice(2).map(a => a.replace(/\.jpg$/, '') + '.jpg');
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  for (const card of manifest.cards) {
    if (card.rendered === false || (only.length && !only.includes(card.file))) continue; // an original card, kept as it is
    await page.goto(pathToFileURL(root + 'scripts/og/card.html').href);
    await page.evaluate(async c => {
      const img = document.getElementById('bg');
      img.style.objectPosition = c.position;
      img.src = c.photoUrl;
      document.getElementById('eyebrow').textContent = c.eyebrow;
      document.getElementById('title').textContent = c.title;
      document.getElementById('sub').textContent = c.text;
      await img.decode();
      await document.fonts.ready;
    }, { ...card, photoUrl: pathToFileURL(root + card.photo).href });
    const jpg = await page.screenshot({ type: 'jpeg', quality: 86 });
    writeFileSync(root + 'og/' + card.file, jpg);
    card.sha256 = createHash('sha256').update(jpg).digest('hex');
    console.log(`og/${card.file}  ${jpg.length} bytes  ${card.sha256}`);
  }
} finally {
  await browser.close();
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
