/* =========================================================================================
   Browser check for the site bar (ADDENDUM §6.1), run by hand: CI has no browser.
     node tests/browser/bar.mjs
   PLAYWRIGHT_MODULE  where playwright is installed (default: the 'playwright' package, then
                      /opt/node-tools/node_modules/playwright)
   CHROMIUM_PATH      the browser (default /opt/pw-browsers/chromium-1194/chrome-linux/chrome)
   On every root page, served by scripts/dev.mjs:
   - 880 to 1440 px, every 10 px: the burger is hidden; the logo, each bar link, Log in and
     Get a quote sit in order without overlapping, inside the bar and the window, with at least
     MIN_LOGO_GAP px of visible space between the logo and the first link's text; the same
     sweep again signed in, where the longer "My account" takes Log in's place
   - 320, 390, 600, 834 and 879 px: the bar links, Log in and Get a quote are hidden and the
     burger shows; opened, the panel shows Log in; Escape closes it
   - 390 px: the page never scrolls sideways
   - 390, 834, 880, 1024 and 1440 px: Tab walks the bar in the order it is shown
   - a Supabase token key with "keep me signed in" turns every Log in into My account
     (/studio/#/account), and nothing on the page loads supabase-js
   ========================================================================================= */
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDevServer } from '../../scripts/dev.mjs';

const require = createRequire(import.meta.url);
const loadPlaywright = () => {
  for (const m of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node-tools/node_modules/playwright'].filter(Boolean)) {
    try { return require(m); } catch { /* next */ }
  }
  throw new Error('playwright not found: set PLAYWRIGHT_MODULE');
};
const { chromium } = loadPlaywright();

const root = fileURLToPath(new URL('../..', import.meta.url));
const pages = readdirSync(root).filter(f => f.endsWith('.html')).sort();
const server = createDevServer({ env: {}, log: { warn() {}, error: console.error } });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const fails = [];
let passes = 0, tightest = { gap: Infinity };
const check = (ok, msg) => { if (ok) passes++; else { console.log(`FAIL ${msg}`); fails.push(msg); } };
const MIN_LOGO_GAP = 16; // visible px between "Distribution" and the first bar link's text
const tightestBy = {};

// what the bar shows at the current width, in reading order
const measure = () => {
  const vis = el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const box = el => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, name: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20) }; };
  const gb = document.querySelector('#gb .gb__in');
  const items = [gb.querySelector('.gb__logo'), ...gb.querySelectorAll('.gb__list a'), gb.querySelector('.gb__login'), gb.querySelector('.gb__quote')];
  return {
    width: innerWidth, bar: box(gb),
    shown: items.map(el => el && vis(el)), boxes: items.map(el => el && box(el)),
    firstPad: parseFloat(getComputedStyle(items[1]).paddingLeft) || 0,
    burger: vis(gb.querySelector('.gb__burger')),
    scrollW: document.documentElement.scrollWidth
  };
};

async function sweep(page, p, label) {
  for (let w = 880; w <= 1440; w += 10) {
    await page.setViewportSize({ width: w, height: 900 });
    const m = await page.evaluate(measure);
    check(!m.burger, `${p} @${w}: burger hidden`);
    check(m.boxes[m.boxes.length - 2].name === label, `${p} @${w}: the bar reads ${label} (${m.boxes[m.boxes.length - 2].name})`);
    check(m.shown.every(Boolean), `${p} @${w}: logo, ${m.shown.length - 3} links, Log in and Get a quote all shown (${m.shown.map(Number).join('')})`);
    for (let i = 1; i < m.boxes.length; i++) {
      const a = m.boxes[i - 1], b = m.boxes[i];
      if (i === 1 && b.l - a.r < tightest.gap) tightest = { gap: b.l - a.r, page: p, width: w, between: `${a.name} | ${b.name}` };
      if (i === 1) {
        const seen = b.l + m.firstPad - a.r, t = tightestBy[label];
        if (!t || seen < t.gap) tightestBy[label] = { gap: seen, page: p, width: w };
        check(seen >= MIN_LOGO_GAP, `${p} @${w} (${label}): only ${seen.toFixed(1)} px between the logo and "${b.name}" (at least ${MIN_LOGO_GAP})`);
      }
      check(b.l >= a.r - 0.5, `${p} @${w}: "${a.name}" (right ${a.r.toFixed(1)}) overlaps "${b.name}" (left ${b.l.toFixed(1)})`);
    }
    const last = m.boxes[m.boxes.length - 1], first = m.boxes[0];
    check(first.l >= 0 && last.r <= w, `${p} @${w}: the bar fits the window (${first.l.toFixed(1)}..${last.r.toFixed(1)})`);
    check(m.boxes.every(x => x.t >= m.bar.t - 0.5 && x.b <= m.bar.b + 0.5), `${p} @${w}: every item inside the 44px bar`);
  }
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  for (const p of pages) {
    const page = await ctx.newPage();
    await page.goto(`${base}/${p}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await sweep(page, p, 'Log in');
    for (const w of [320, 390, 600, 834, 879]) {
      await page.setViewportSize({ width: w, height: 800 });
      const m = await page.evaluate(measure);
      check(m.burger, `${p} @${w}: burger shown`);
      check(m.shown.slice(1).every(x => !x), `${p} @${w}: bar links, Log in and Get a quote hidden (${m.shown.map(Number).join('')})`);
      if (w === 390) check(m.scrollW <= w, `${p} @390: no sideways scroll (scrollWidth ${m.scrollW})`);
      await page.click('#gb .gb__burger');
      await page.waitForTimeout(450);
      const panel = await page.evaluate(() => {
        const a = document.querySelector('#gbPanel .gb__sm .gb__login'), r = a.getBoundingClientRect(), s = getComputedStyle(a);
        return { text: a.textContent.trim(), visible: r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && Number(s.opacity) > 0.5 && r.bottom <= innerHeight + 2000, expanded: document.querySelector('#gb .gb__burger').getAttribute('aria-expanded') };
      });
      check(panel.visible && panel.text === 'Log in' && panel.expanded === 'true', `${p} @${w}: the open panel shows Log in (${JSON.stringify(panel)})`);
      await page.keyboard.press('Escape');
      check(await page.evaluate(() => !document.documentElement.classList.contains('gb-open')), `${p} @${w}: Escape closes the panel`);
    }
    // keyboard order through the bar matches what is on screen, at the review widths
    for (const w of [390, 834, 880, 1024, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`${base}/${p}`, { waitUntil: 'load' }); // a fresh page: Tab starts at the top
      await page.evaluate(() => document.fonts.ready);
      const expected = await page.evaluate(() => [...document.querySelectorAll('#gb .gb__in a, #gb .gb__in button')]
        .filter(el => { const r = el.getBoundingClientRect(), st = getComputedStyle(el); return r.width > 0 && st.display !== 'none' && st.visibility !== 'hidden'; })
        .map(el => (el.textContent.trim() || el.getAttribute('aria-label')).slice(0, 24)));
      const got = [];
      for (let i = 0; i < 40 && got.length < expected.length; i++) {
        await page.keyboard.press('Tab');
        const t = await page.evaluate(() => { const a = document.activeElement; return a && a.closest('#gb .gb__in') ? (a.textContent.trim() || a.getAttribute('aria-label')).slice(0, 24) : null; });
        if (t) got.push(t); else if (got.length) break;
      }
      check(JSON.stringify(got) === JSON.stringify(expected), `${p} @${w}: Tab order in the bar ${JSON.stringify(got)} matches the screen ${JSON.stringify(expected)}`);
    }
    await page.close();
  }

  // signed in (and kept signed in): every Log in becomes My account; supabase-js is never loaded
  const signed = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await signed.addInitScript(() => { try { localStorage.setItem('sb-mputtezdhevwwjgwktvi-auth-token', '{"access_token":"x"}'); localStorage.setItem('bh_remember', '1'); } catch {} });
  for (const p of pages) {
    const page = await signed.newPage();
    const scripts = [];
    page.on('request', r => { if (r.resourceType() === 'script') scripts.push(r.url()); });
    await page.goto(`${base}/${p}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const links = await page.evaluate(() => [...document.querySelectorAll('a.gb__login, a.gf__login')].map(a => [a.textContent.trim(), a.getAttribute('href')]));
    check(links.length >= 3 && links.every(([t, h]) => t === 'My account' && h === '/studio/#/account'), `${p}: signed in, every Log in reads My account (${JSON.stringify(links)})`);
    check(!scripts.some(u => /supabase/i.test(u)), `${p}: supabase-js is never loaded (${scripts.filter(u => /supabase/i.test(u)).join(', ')})`);
    await sweep(page, p, 'My account');
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`\ntightest logo-to-links gap from 880 to 1440 px: ${tightest.gap.toFixed(1)} px (${tightest.page} @${tightest.width}, ${tightest.between})`);
for (const [label, t] of Object.entries(tightestBy)) console.log(`tightest visible logo-to-text gap with ${label}: ${t.gap.toFixed(1)} px (${t.page} @${t.width}; at least ${MIN_LOGO_GAP})`);
console.log(`${passes} checks passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
