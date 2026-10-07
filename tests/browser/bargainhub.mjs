/* =========================================================================================
   Browser check for the bargainhub.html entries (ADDENDUM §6.2), run by hand.
     node tests/browser/bargainhub.mjs [--shots <dir>]
   PLAYWRIGHT_MODULE, CHROMIUM_PATH as in tests/browser/bar.mjs.
   At 390, 834, 1024 and 1440 px, served by scripts/dev.mjs with a stub studio behind the rewrite:
   - the intro's Design your kitchen is the element under the pointer (the intro itself ignores
     the pointer) and a real click lands on /studio/ through the rewrite
   - all five Design your kitchen links go to studio/
   - every Book a consultant link opens the enquiry dialog with the topic "Book a consultant"
   - the reviews section shows no ratings or sample reviews, only "Reviews from our first
     clients are coming soon", and the Reviews link still finds it
   - no sideways scroll, no console errors
   --shots <dir> saves a screenshot of each section at each width.
   ========================================================================================= */
import http from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { createDevServer } from '../../scripts/dev.mjs';

const require = createRequire(import.meta.url);
const loadPlaywright = () => {
  for (const m of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node-tools/node_modules/playwright'].filter(Boolean)) {
    try { return require(m); } catch { /* next */ }
  }
  throw new Error('playwright not found: set PLAYWRIGHT_MODULE');
};
const { chromium } = loadPlaywright();
const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });

const studio = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><title>Studio stub</title><link rel="icon" href="data:,"><h1 id="stub">studio ${req.url}</h1>`);
});
await new Promise(r => studio.listen(0, '127.0.0.1', r));
const server = createDevServer({ env: { STUDIO_EDGE_SECRET_STAGING: 'stub-edge' }, studioUrl: `http://127.0.0.1:${studio.address().port}`, log: { warn() {}, error: console.error } });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const fails = [];
let passes = 0;
// bring an element on screen; the #quote copy only fades in at the end of its scroll
const reveal = el => {
  const q = el.closest('#quote');
  if (q) scrollTo(0, q.getBoundingClientRect().top + scrollY + q.offsetHeight - innerHeight);
  else el.scrollIntoView({ block: 'center' });
};
const check = (ok, msg) => { if (ok) passes++; else { console.log(`FAIL ${msg}`); fails.push(msg); } };

try {
  for (const width of [390, 834, 1024, 1440]) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 800 ? 844 : 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`${base}/bargainhub.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.body.classList.contains('is-loading'), null, { timeout: 30000 });
    await page.waitForTimeout(1800); // the intro's entrance animation

    // the intro button takes the click although .b-intro ignores the pointer
    const hit = await page.evaluate(() => {
      const a = document.querySelector('.b-intro .b-intro__go a'), r = a.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { inside: a === top || a.contains(top), pe: getComputedStyle(a).pointerEvents, introPe: getComputedStyle(a.closest('.b-intro')).pointerEvents, h: r.height, w: r.width };
    });
    check(hit.inside && hit.pe === 'auto' && hit.introPe === 'none', `@${width}: the intro's Design your kitchen is clickable over .b-intro (${JSON.stringify(hit)})`);
    check(hit.h >= 44, `@${width}: the intro button is at least 44px tall (${hit.h})`);
    if (shotsAt) await page.screenshot({ path: `${shotsAt}/bargainhub-${width}-intro.png` });

    const links = await page.evaluate(() => ({
      design: [...document.querySelectorAll('a')].filter(a => /Design your kitchen/.test(a.textContent)).map(a => a.getAttribute('href')),
      book: [...document.querySelectorAll('a[data-book]')].map(a => [a.textContent.trim(), a.dataset.quote])
    }));
    check(links.design.length === 5 && links.design.every(h => h === 'studio/'), `@${width}: five Design your kitchen links to studio/ (${JSON.stringify(links.design)})`);
    check(links.book.length === 4 && links.book.every(([t, q]) => /^Book a (consultant|showroom visit)$/.test(t) && q === 'Book a consultant'), `@${width}: four data-book links (${JSON.stringify(links.book)})`);

    // each Book a consultant opens the dialog with the topic (scrolled into view and clicked for real)
    for (let i = 0; i < links.book.length; i++) {
      const a = page.locator('a[data-book]').nth(i);
      await a.evaluate(reveal);
      await page.waitForTimeout(700);
      await a.click({ timeout: 10000 });
      const topic = await page.waitForSelector('dialog.qd[open] #qdTopic', { timeout: 5000 }).then(el => el.textContent()).catch(() => null);
      check(topic === 'Book a consultant', `@${width}: ${links.book[i][0]} #${i + 1} opens the enquiry dialog with "Book a consultant" (${topic})`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }

    // the reviews section: the honest line, no ratings, reached by its subnav link
    const rv = await page.evaluate(() => {
      const s = document.querySelector('#reviews');
      return { text: s.textContent.replace(/\s+/g, ' ').trim(), stars: s.querySelectorAll('.stars, .rcard, svg').length };
    });
    check(/Reviews from our first clients are coming soon\./.test(rv.text) && !/4\.9|\d+ reviews|★/.test(rv.text) && rv.stars === 0, `@${width}: reviews say only that they are coming soon (${rv.text})`);
    await page.locator('.subnav a[href="#reviews"]').click();
    await page.waitForTimeout(2200);
    const rvTop = await page.evaluate(() => document.querySelector('#reviews').getBoundingClientRect().top);
    check(rvTop > -5 && rvTop < 200, `@${width}: the Reviews link scrolls to the section (top ${rvTop.toFixed(0)})`);
    if (shotsAt) await page.screenshot({ path: `${shotsAt}/bargainhub-${width}-reviews.png` });

    // the design steps and the studio section, with their buttons on screen
    for (const sel of ['#design .design__btns a', '#studio .studio__btns', '#quote .cta__btns']) {
      await page.locator(sel).first().evaluate(reveal);
      await page.waitForTimeout(900);
      const box = await page.locator(sel).first().boundingBox();
      check(box && box.y >= 0 && box.y + box.height <= (width < 800 ? 844 : 900), `@${width}: ${sel} sits on screen (${box && box.y.toFixed(0)})`);
      if (shotsAt) await page.screenshot({ path: `${shotsAt}/bargainhub-${width}-${sel.split(' ')[0].slice(1)}.png` });
    }

    const sx = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(sx <= 0, `@${width}: no sideways scroll (${sx}px)`);

    // a real click on the subnav's Design your kitchen lands on the studio through the rewrite
    if (width === 1440 || width === 390) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(1600);
      await Promise.all([page.waitForURL(`${base}/studio/`), page.locator('.b-intro .b-intro__go a').click({ timeout: 10000 })]);
      check(/studio \/$/.test(await page.locator('#stub').textContent()), `@${width}: the intro button opens /studio/ through the rewrite`);
    }
    check(errors.length === 0, `@${width}: no console errors (${errors.join(' | ')})`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
  studio.close();
}
console.log(`\n${passes} checks passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
