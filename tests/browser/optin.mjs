/* =========================================================================================
   Browser check for the marketing opt-in (run by hand: CI has no browser).
     node tests/browser/optin.mjs
   PLAYWRIGHT_MODULE  where playwright is installed (default: the 'playwright' package, then
                      /opt/node-tools/node_modules/playwright)
   CHROMIUM_PATH      the browser (default /opt/pw-browsers/chromium-1194/chrome-linux/chrome)
   Checks, at 320, 390 and 1280 px:
   - the quote dialog's checkbox shows a solid 2px focus outline after Tab from the message
     box (WCAG 2.4.7 / 1.4.11), and its label is at least 44px tall
   - the opt-in label on the five page forms is at least 44px tall
   - the gold pages tick the box in gold, not blue
   ========================================================================================= */
import { createRequire } from 'node:module';
import { createDevServer } from '../../scripts/dev.mjs';

const require = createRequire(import.meta.url);
const loadPlaywright = () => {
  for (const m of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node-tools/node_modules/playwright'].filter(Boolean)) {
    try { return require(m); } catch { /* next */ }
  }
  throw new Error('playwright not found: set PLAYWRIGHT_MODULE');
};
const { chromium } = loadPlaywright();

const server = createDevServer({ env: {}, log: { warn() {}, error: console.error } });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };

try {
  for (const width of [320, 390, 1280]) {
    const page = await (await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })).newPage();

    await page.goto(`${base}/index.html`);
    await page.evaluate(() => document.querySelector('[data-quote]').click());
    await page.locator('dialog[open] textarea').focus();
    await page.keyboard.press('Tab');
    const d = await page.evaluate(() => {
      const a = document.activeElement, c = getComputedStyle(a);
      return { name: a.name, style: c.outlineStyle, w: parseFloat(c.outlineWidth), color: c.outlineColor, label: a.closest('label').getBoundingClientRect().height, box: a.getBoundingClientRect().width };
    });
    check(d.name === 'marketingOptIn', `${width}px dialog: Tab from the message reaches the opt-in (${d.name})`);
    check(d.style === 'solid' && d.w >= 2 && d.color === 'rgb(0, 113, 227)', `${width}px dialog: focus outline ${d.style} ${d.w}px ${d.color}`);
    check(d.label >= 44, `${width}px dialog: opt-in label ${d.label}px tall`);
    check(d.box === 18, `${width}px dialog: checkbox ${d.box}px wide`);

    for (const f of ['contact', 'hanestone', 'hanewood', 'hanesulation', 'hisense']) {
      await page.goto(`${base}/${f}.html`);
      const p = await page.evaluate(() => {
        const l = document.querySelector('.form__optin'), i = l.querySelector('input');
        return { h: l.getBoundingClientRect().height, accent: getComputedStyle(i).accentColor };
      });
      check(p.h >= 44, `${width}px ${f}: opt-in label ${p.h}px tall`);
      if (f === 'hanesulation' || f === 'hisense') check(p.accent !== 'rgb(0, 113, 227)', `${width}px ${f}: tick colour ${p.accent} (gold, not blue)`);
    }
    await page.context().close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
process.exit(fails.length ? 1 : 0);
