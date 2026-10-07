/* =========================================================================================
   Milli in a real browser (ADDENDUM §8.2, §8.3, §8.8 accessibility list), run by hand: CI has no
   browser.   node tests/browser/milli.mjs [--skip-nudge]
   PLAYWRIGHT_MODULE, CHROMIUM_PATH, AXE_PATH as in tests/browser/axe.mjs (AXE_PATH is needed while
   axe-core is not installed in the repo: AXE_PATH=/path/to/axe-core/axe.min.js). PORT (default 3100) for
   the dev server; STUDIO_DEV_URL (default http://127.0.0.1:4290, where nothing listens) is where
   /api/guide goes unless a check stubs it.
   assets/site.js ships with MILLI_SHIPPED = false, so every page here gets site.js through
   Playwright route interception with that one constant flipped to true; the committed file is
   never touched.
   Checks: the launcher (56 px, bottom-left, z-index 9980, clear of the .skip pill, hidden under
   html.gb-open and body.is-loading); axe-core with the panel closed and open on index and
   bargainhub at 1280 and 390 px (nothing inside Milli, and nothing on the page that the same page
   without Milli doesn't have); the keyboard-only script (Tab to the launcher, open, choose, act,
   Esc back to the launcher); static mode never posts; the live path with a stubbed /api/guide
   (server text stays text; a 5xx falls back); the 390 px sheet (full screen, inert background,
   focus kept inside, no sideways scroll) and reflow at 320 x 640, 320 x 256 (400% zoom) and
   844 x 390 (every choice and the last answer can be scrolled into view); the footer is never
   under the launcher at the end of any page (360-1280 px); the launcher gives way to index's
   film player; the panel gives way to the burger menu; a stalled /api/guide never holds up the
   first open, and repeated clicks build one panel; a new answer opens at its first line; on a
   phone "Talk to a person" keeps the email in view; reduced motion; forced colours;
   history across a reload; the one Bargainhub hello (desktop only, once, dismissible); the
   launcher's gzipped size. Exit 1 on any failure.
   ========================================================================================= */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createDevServer } from '../../scripts/dev.mjs';

const require = createRequire(import.meta.url);
const loadPlaywright = () => {
  for (const m of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core', '/opt/node-tools/node_modules/playwright'].filter(Boolean)) {
    try { return require(m); } catch { /* next */ }
  }
  throw new Error('playwright not found: set PLAYWRIGHT_MODULE');
};
const { chromium } = loadPlaywright();
const axeSource = (() => {
  try { return readFileSync(process.env.AXE_PATH || require.resolve('axe-core/axe.min.js'), 'utf8'); } catch { throw new Error('axe-core not found: set AXE_PATH=/path/to/axe-core/axe.min.js'); }
})();
const root = fileURLToPath(new URL('../..', import.meta.url));
const skipNudge = process.argv.includes('--skip-nudge');

const server = createDevServer({ env: {}, studioUrl: process.env.STUDIO_DEV_URL || 'http://127.0.0.1:4290', log: { warn() {}, error() {} } });
await new Promise(r => server.listen(Number(process.env.PORT || 3100), '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

let failed = 0;
const ok = (cond, label, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? `  (${extra})` : ''}`); if (!cond) failed++; return cond; };

// a context whose site.js loads Milli; posts to /api/guide are counted
const context = async (opts = {}, { shipped = true } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  if (shipped) await ctx.route('**/assets/site.js', async route => {
    const r = await route.fetch();
    const body = (await r.text()).replace('MILLI_SHIPPED = false', 'MILLI_SHIPPED = true');
    if (!body.includes('MILLI_SHIPPED = true')) throw new Error('site.js no longer has MILLI_SHIPPED = false');
    await route.fulfill({ response: r, body });
  });
  ctx.posts = [];
  ctx.on('request', q => { if (q.url().includes('/api/guide') && q.method() !== 'GET') ctx.posts.push(q.postData()); });
  return ctx;
};
const ready = async (page, path, { launcher = true } = {}) => {
  await page.goto(`${base}/${path}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.body.classList.contains('is-loading'), null, { timeout: 30000 }).catch(() => {});
  if (launcher) await page.waitForSelector('.milli-l', { state: 'visible', timeout: 15000 });
};
const openPanel = async page => {
  await page.click('.milli-l');
  await page.waitForSelector('#milliPanel:not([hidden])', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('.milli-c button'), null, { timeout: 10000 });
  await page.waitForTimeout(350); // the open animation (none under reduced motion)
};
const axe = async (page, include, detail) => {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: axeSource });
  return page.evaluate(async ([include, detail]) => {
    const r = await window.axe.run(include ? { include: include.map(s => [s]) } : document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
    // a node is named by its markup without digits, inline styles or state (axe's shortest selector shifts when Milli adds
    // buttons; the office clocks tick; index's film-reel tabs change class and aria state as the reel plays)
    const bare = h => h.replace(/\s(style|class|tabindex|aria-(selected|pressed|current|expanded|hidden)|data-state)="[^"]*"/g, '').replace(/\d+/g, '#').slice(0, 160);
    const milli = n => { try { const e = document.querySelector(n.target[0]); return !!(e && e.closest('.milli-l, #milliPanel, .milli-nudge')); } catch { return true; } };
    return r.violations.flatMap(v => v.nodes.map(n => (detail ? { key: `${v.id} | ${bare(n.html)}`, rule: v.id, milli: milli(n) } : `${v.id} | ${bare(n.html)}`)));
  }, [include || null, !!detail]);
};
// what Milli adds to the page's own violations: the same page, same moment, with Milli's nodes taken out.
// A node outside Milli whose rule is already in tests/browser/axe-baseline.json for this page and width
// is a known page issue that can come and go with the page's own animation (index's film-reel tabs:
// label-content-name-mismatch), so it never counts; anything inside Milli, or any other rule, does.
const baseline = JSON.parse(readFileSync(root + 'tests/browser/axe-baseline.json', 'utf8')).known.map(l => l.split(' | '));
const axeAdded = async (page, where) => {
  const known = new Set(baseline.filter(([w]) => w === where).map(([, rule]) => rule));
  const withMilli = await axe(page, null, true);
  await page.evaluate(() => { window.__milliFocus = document.activeElement; window.__milliHold = [...document.querySelectorAll('.milli-l, #milliPanel, .milli-nudge')]; for (const n of window.__milliHold) n.remove(); });
  const without = new Set(await axe(page));
  await page.evaluate(() => { for (const n of window.__milliHold) document.body.append(n); if (window.__milliFocus) window.__milliFocus.focus(); });
  return withMilli.filter(k => !without.has(k.key) && (k.milli || !known.has(k.rule))).map(k => k.key);
};
const reveal = page => page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) { scrollTo(0, y); await new Promise(r => setTimeout(r, 25)); } scrollTo(0, 0); });
const active = page => page.evaluate(() => { const a = document.activeElement; return a ? (a.className && String(a.className)) + '|' + (a.textContent || '').trim().slice(0, 60) + '|' + (a.id || '') : ''; });

try {
  // ---------- 1. size
  const gz = gzipSync(readFileSync(root + 'assets/guide/milli.js'), { level: 9 }).length;
  ok(gz <= 3072, 'launcher code before the first click is 3 KB gzipped or less', `${gz} bytes`);

  // ---------- 2. launcher, axe closed and open, the sheet, on index and bargainhub at 1280 and 390
  for (const width of [1280, 390]) {
    for (const p of ['index.html', 'bargainhub.html']) {
      const label = `${p} @${width}`;
      const ctx = await context({ viewport: { width, height: 844 }, reducedMotion: 'reduce', ...(width < 500 && { hasTouch: true, isMobile: true }) });
      const page = await ctx.newPage();
      await ready(page, p);
      await reveal(page); await page.waitForTimeout(500);
      const L = await page.evaluate(() => {
        const b = document.querySelector('.milli-l'), r = b.getBoundingClientRect(), cs = getComputedStyle(b);
        const s = document.querySelector('.skip'), sr = s && s.getBoundingClientRect();
        return { w: r.width, h: r.height, left: r.left, bottom: innerHeight - r.bottom, z: cs.zIndex, tag: b.tagName, name: b.getAttribute('aria-label'), expanded: b.getAttribute('aria-expanded'),
          controls: b.getAttribute('aria-controls'), label: getComputedStyle(b.querySelector('.milli-l__t')).display,
          skip: sr ? !(r.right <= sr.left || sr.right <= r.left || r.bottom <= sr.top || sr.bottom <= r.top) : null, barZ: +getComputedStyle(document.getElementById('gb')).zIndex };
      });
      ok(L.tag === 'BUTTON' && L.h === 56 && L.w >= 56 && L.left >= 16 && L.bottom >= 16, `${label}: launcher is a 56 px button bottom-left`, `${L.w}x${L.h} at left ${L.left}, bottom ${L.bottom}`);
      ok(L.z === '9980' && L.barZ > 9980, `${label}: z-index 9980, under the bar (${L.barZ})`);
      ok(L.name === 'Ask Milli, our AI guide' && L.expanded === 'false' && L.controls === 'milliPanel', `${label}: named, aria-expanded, aria-controls`);
      ok(width > 760 ? L.label !== 'none' : L.label === 'none', `${label}: "Ask Milli" label ${width > 760 ? 'shown on desktop' : 'hidden on a phone'}`);
      if (L.skip !== null) ok(L.skip === false, `${label}: clear of the .skip pill`);
      const hiddenUnder = await page.evaluate(() => {
        const b = document.querySelector('.milli-l'), d = () => getComputedStyle(b).display;
        document.body.classList.add('is-loading'); const a = d(); document.body.classList.remove('is-loading');
        document.documentElement.classList.add('gb-open'); const c = d(); document.documentElement.classList.remove('gb-open');
        return [a, c, d()];
      });
      ok(hiddenUnder[0] === 'none' && hiddenUnder[1] === 'none' && hiddenUnder[2] !== 'none', `${label}: hidden while body.is-loading and html.gb-open`);
      const closedMilli = await axe(page, ['.milli-l']);
      ok(!closedMilli.length, `${label}: axe, panel closed, nothing in the launcher`, closedMilli.join('; '));
      const closedAll = await axeAdded(page, `${p} @${width}`);
      ok(!closedAll.length, `${label}: axe, panel closed, nothing new on the page`, closedAll.join('; '));

      await openPanel(page);
      const P = await page.evaluate(() => {
        const p = document.getElementById('milliPanel'), r = p.getBoundingClientRect();
        const others = [...document.body.children].filter(c => c !== p && !['SCRIPT', 'DIALOG', 'STYLE', 'LINK'].includes(c.tagName));
        return { rect: [r.left, r.top, r.width, r.height], modal: p.getAttribute('aria-modal'), inert: others.every(c => c.inert), anyInert: others.some(c => c.inert),
          lock: getComputedStyle(document.documentElement).overflow + '/' + getComputedStyle(document.body).overflow, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
          pw: p.scrollWidth, pcw: p.clientWidth, focus: document.activeElement && document.activeElement.className, textbox: !!p.querySelector('textarea, input'),
          notice: document.getElementById('milliNotice').textContent, h: p.querySelectorAll('h1').length, h2: p.querySelector('h2').textContent, lenis: p.hasAttribute('data-lenis-prevent') && p.querySelector('.milli-b').hasAttribute('data-lenis-prevent'),
          z: getComputedStyle(p).zIndex, expanded: document.querySelector('.milli-l').getAttribute('aria-expanded') };
      });
      ok(!P.textbox && P.notice === 'Milli is an AI guide answering from quick answers on this page right now. Choose a question below, or ask a person. Privacy statement', `${label}: static mode, the §11.2 notice, no text box`);
      ok(P.h === 0 && P.h2 === 'Milli · AI guide' && P.focus === 'milli-chip' && P.expanded === 'true' && P.lenis, `${label}: h2 only, focus on the first choice, aria-expanded, data-lenis-prevent`);
      if (width > 760) {
        ok(P.rect[2] === 380 && P.rect[3] <= 560 && P.modal === null && !P.anyInert && P.z === '9980', `${label}: a non-modal 380 x 560 card, nothing inert`, P.rect.join(','));
      } else {
        ok(P.rect[0] === 0 && P.rect[1] === 0 && P.rect[2] === width && Math.abs(P.rect[3] - 844) <= 1, `${label}: the sheet fills the screen`, P.rect.join(','));
        ok(P.modal === 'true' && P.inert && P.lock === 'hidden/hidden' && +P.z > L.barZ, `${label}: modal, background inert, page scroll locked, over the bar`, `${P.lock} z ${P.z}`);
        ok(P.sw <= P.cw && P.pw <= P.pcw, `${label}: no sideways scroll`, `${P.sw}/${P.cw}`);
        let inside = true;
        for (let i = 0; i < 14; i++) { await page.keyboard.press(i % 5 === 4 ? 'Shift+Tab' : 'Tab'); inside = inside && await page.evaluate(() => document.getElementById('milliPanel').contains(document.activeElement)); }
        ok(inside, `${label}: Tab and Shift+Tab stay inside the sheet`);
      }
      const openMilli = await axe(page, ['#milliPanel', '.milli-l']);
      ok(!openMilli.length, `${label}: axe, panel open, nothing in Milli`, openMilli.join('; '));
      await page.click('.milli-c button:nth-child(1)');
      await page.waitForTimeout(200);
      const answered = await axe(page, ['#milliPanel']);
      ok(!answered.length, `${label}: axe, after an answer with its actions, nothing in Milli`, answered.join('; '));
      const openAll = await axeAdded(page, `${p} @${width}`);
      ok(!openAll.length, `${label}: axe, panel open, nothing new on the page`, openAll.join('; '));
      await page.keyboard.press('Escape');
      const back = await page.evaluate(() => [document.activeElement.className, document.getElementById('milliPanel').hidden, [...document.body.children].some(c => c.inert), document.documentElement.classList.contains('milli-lock')]);
      ok(back[0] === 'milli-l' && back[1] && !back[2] && !back[3], `${label}: Esc closes, focus back on the launcher, nothing left inert or locked`);
      ok(ctx.posts.length === 0, `${label}: static mode posted nothing`);
      await ctx.close();
    }
  }

  // ---------- 3. the burger menu hides the launcher (390)
  {
    const ctx = await context({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await ready(page, 'index.html');
    await page.click('.gb__burger');
    await page.waitForTimeout(200);
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('.milli-l')).display === 'none'), 'index @390: burger menu open hides the launcher');
    await ctx.close();
  }
  {
    // 834: the desktop card is open when the burger menu opens; it must not stay, tabbable, under the menu
    const ctx = await context({ viewport: { width: 834, height: 1112 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await ready(page, 'index.html');
    await openPanel(page);
    await page.evaluate(() => document.querySelector('.gb__burger').click());
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => [document.documentElement.classList.contains('gb-open'), getComputedStyle(document.getElementById('milliPanel')).display]);
    ok(r[0] && r[1] === 'none', 'index @834: an open panel hides under the burger menu (not left tabbable beneath it)', r.join(' / '));
    await ctx.close();
  }

  // ---------- 3b. index's film player (a modal): the launcher gives way
  for (const width of [390, 1280]) {
    const ctx = await context({ viewport: { width, height: 844 }, reducedMotion: 'reduce', ...(width < 500 && { hasTouch: true, isMobile: true }) });
    const page = await ctx.newPage();
    await ready(page, 'index.html');
    await page.evaluate(() => document.querySelector('[data-film]').click());
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => [document.getElementById('modal').classList.contains('is-open'), getComputedStyle(document.querySelector('.milli-l')).display]);
    ok(r[0] && r[1] === 'none', `index @${width}: the film player open hides the launcher`, r.join(' / '));
    await page.evaluate(() => document.getElementById('modalClose').click());
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('.milli-l')).display !== 'none'), `index @${width}: and it comes back when the film closes`);
    await ctx.close();
  }

  // ---------- 3c. the end of every page: no footer link or text under the launcher (WCAG 2.4.11)
  {
    const pages = readdirSync(root).filter(n => n.endsWith('.html')).sort();
    for (const [width, height] of [[390, 844], [375, 667], [360, 740], [1280, 900]]) {
      const ctx = await context({ viewport: { width, height }, reducedMotion: 'reduce', ...(width < 500 && { hasTouch: true, isMobile: true }) });
      const bad = [];
      for (const p of pages) {
        const page = await ctx.newPage();
        await ready(page, p);
        await page.evaluate(async () => { for (let i = 0; i < 4; i++) { scrollTo(0, document.documentElement.scrollHeight); await new Promise(r => setTimeout(r, 150)); } });
        const hit = await page.evaluate(() => {
          const l = document.querySelector('.milli-l').getBoundingClientRect(), f = document.querySelector('body>footer:last-of-type');
          const over = r => r.width && r.height && !(r.right <= l.left - 4 || l.right + 4 <= r.left || r.bottom <= l.top - 4 || l.bottom + 4 <= r.top);
          const out = [];
          for (const e of f.querySelectorAll('a, button, span, p, li, h2')) {
            if (e.children.length && !/^(A|BUTTON)$/.test(e.tagName)) continue; // leaves and links only
            if (over(e.getBoundingClientRect())) out.push(`${e.tagName}:${e.textContent.trim().slice(0, 30)}`);
          }
          return out;
        });
        if (hit.length) bad.push(`${p}: ${hit.join(', ')}`);
        await page.close();
      }
      ok(!bad.length, `end of every page @${width}x${height}: nothing in the footer under the launcher`, bad.join('; '));
      await ctx.close();
    }
  }

  // ---------- 4. keyboard only: Tab to the launcher, open, choose, act, Esc back
  {
    const ctx = await context({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await ready(page, 'bargainhub.html');
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); scrollTo(0, 0); });
    let n = 0;
    for (; n < 400; n++) { await page.keyboard.press('Tab'); if (await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('milli-l'))) break; }
    ok(n < 400, 'keyboard: Tab reaches the launcher', `${n + 1} presses`);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#milliPanel:not([hidden]) .milli-c button');
    await page.waitForTimeout(100);
    ok((await active(page)).startsWith('milli-chip|How does the design studio work?'), 'keyboard: Enter opens, focus on the first choice', await active(page));
    for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
    ok((await active(page)).startsWith('milli-chip|Book a consultant'), 'keyboard: Tab through the choices', await active(page));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    ok((await active(page)).startsWith('milli-chip|Book a consultant'), 'keyboard: choosing never moves focus');
    ok(await page.evaluate(() => /You said: Book a consultant/.test(document.querySelector('[role=log]').textContent)), 'keyboard: the answer is in the log');
    await page.keyboard.press('Tab'); // Talk to a person
    await page.keyboard.press('Tab'); // the log itself (focusable, so it scrolls from the keyboard)
    ok((await active(page)).startsWith('milli-log|'), 'keyboard: then the log', await active(page));
    await page.keyboard.press('Tab'); // the answer's first action
    ok((await active(page)).startsWith('milli-a|Book a consultant'), 'keyboard: Tab reaches the answer\'s action', await active(page));
    await page.keyboard.press('Enter');
    await page.waitForSelector('dialog.qd[open]');
    ok(await page.evaluate(() => document.getElementById('qdTopic').textContent === 'Book a consultant'), 'keyboard: the action opens the enquiry dialog as "Book a consultant" (BOOKINGS_LIVE is false)');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    ok((await active(page)).startsWith('milli-a|Book a consultant'), 'keyboard: closing the dialog returns focus to the action', await active(page));
    await page.keyboard.press('Escape');
    ok((await active(page)).startsWith('milli-l|'), 'keyboard: Esc closes Milli and focus is back on the launcher', await active(page));
    ok(ctx.posts.length === 0, 'keyboard: static mode posted nothing');
    // history: a reload in the same tab brings the turns back
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.milli-l', { state: 'visible', timeout: 15000 });
    await openPanel(page);
    const turns = await page.evaluate(() => [document.querySelectorAll('.milli-log .milli-msg').length, JSON.parse(sessionStorage.getItem('bh_milli_history')).turns.length]);
    ok(turns[0] === 3 && turns[1] === 2, 'history: kept in sessionStorage across a reload and replayed', turns.join(' / '));
    await ctx.close();
  }

  // ---------- 5. reduced motion removes every animation; without it they run
  for (const motion of ['reduce', 'no-preference']) {
    const ctx = await context({ reducedMotion: motion });
    const page = await ctx.newPage();
    await ready(page, 'index.html');
    const blink = await page.evaluate(() => getComputedStyle(document.querySelector('.milli-l .mo')).animationName); // idle until opened
    await openPanel(page);
    const names = await page.evaluate(blink => {
      const m = document.querySelector('.milli-h .milli-m'); m.setAttribute('class', 'milli-m is-think');
      const a = [blink, getComputedStyle(m.querySelector('.ma')).animationName, getComputedStyle(document.getElementById('milliPanel')).animationName];
      return a;
    }, blink);
    if (motion === 'reduce') ok(names.every(n => n === 'none'), 'reduced motion: blink, antenna pulse and slide are all off', names.join(', '));
    else ok(names.join() === 'milli-blink,milli-pulse,milli-in', 'without reduced motion the animations exist (so the check above means something)', names.join(', '));
    await ctx.close();
  }

  // ---------- 6. forced colours: edges and focus stay visible
  {
    const ctx = await context({ forcedColors: 'active', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await ready(page, 'bargainhub.html');
    await openPanel(page);
    await page.click('.milli-c button:nth-child(3)');
    const f = await page.evaluate(() => {
      const cs = s => getComputedStyle(document.querySelector(s));
      const chip = cs('.milli-chip'), act = cs('.milli-a'), msg = cs('.milli-msg--you'), l = cs('.milli-l'), body = cs('.milli-l .mb');
      return { chip: chip.borderTopWidth + ' ' + chip.borderTopStyle, act: act.borderTopWidth + ' ' + act.borderTopStyle, msg: msg.borderTopWidth + ' ' + msg.borderTopStyle,
        launcher: l.borderTopWidth + ' ' + l.borderTopStyle, fill: body.fill, text: getComputedStyle(document.body).color };
    });
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); // keyboard focus, so :focus-visible applies
    f.outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle + ' ' + getComputedStyle(document.activeElement).outlineWidth);
    ok([f.chip, f.act, f.msg].every(x => /^1px solid$/.test(x)) && f.launcher === '2px solid' && /^solid [23]px$/.test(f.outline), 'forced colours: chips, actions, messages and the launcher keep their edges; focus ring solid', JSON.stringify(f));
    ok(f.fill === f.text, 'forced colours: the mascot follows the system text colour', `${f.fill} vs ${f.text}`);
    await page.screenshot({ path: process.env.MILLI_SHOTS ? `${process.env.MILLI_SHOTS}/forced-colours.png` : '/dev/null' }).catch(() => {});
    await ctx.close();
  }

  // ---------- 7. 320 px reflow (400% zoom of 1280)
  {
    const ctx = await context({ viewport: { width: 320, height: 640 }, reducedMotion: 'reduce', hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await ready(page, 'bargainhub.html');
    await openPanel(page);
    await page.click('.milli-c button:nth-child(3)');
    const r = await page.evaluate(() => { const p = document.getElementById('milliPanel'); return [p.scrollWidth, p.clientWidth, document.documentElement.scrollWidth, document.documentElement.clientWidth, [...p.querySelectorAll('button, a')].filter(b => !b.closest('.milli-n')).filter(b => { const q = b.getBoundingClientRect(); return q.width < 44 || q.height < 44; }).map(b => b.textContent + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height))]; });
    ok(r[0] <= r[1] && r[2] <= r[3], '320 px: no sideways scroll in the sheet or the page', r.slice(0, 4).join('/'));
    ok(!r[4].length, '320 px: every target at least 44 x 44 (the inline privacy link in the notice is a sentence link, exempt in WCAG 2.5.8)', r[4].join('; '));
    await ctx.close();
  }

  // ---------- 7b. short screens: 320 x 256 (1280 x 1024 at 400%) and 844 x 390 (a phone on its side).
  // Every choice, the notice link, the last answer and its actions can be scrolled fully into the panel.
  for (const [width, height] of [[320, 256], [844, 390]]) {
    for (const p of ['index.html', 'bargainhub.html']) {
      const ctx = await context({ viewport: { width, height }, reducedMotion: 'reduce', hasTouch: true, isMobile: true });
      const page = await ctx.newPage();
      await ready(page, p);
      await openPanel(page);
      await page.click('.milli-c button:nth-child(1)');
      await page.waitForTimeout(150);
      const r = await page.evaluate(() => {
        const panel = document.getElementById('milliPanel'), log = panel.querySelector('[role=log]'), last = log.lastElementChild;
        const targets = [panel.querySelector('.milli-n a'), ...panel.querySelectorAll('.milli-chip'), last, ...last.querySelectorAll('a, button')];
        const unreachable = [];
        const pr = panel.getBoundingClientRect();
        // the element's top edge, then its bottom edge, scrolled in; each must land inside the panel and be what is hit there
        // (an inline link is hit on its first line box; a message taller than the panel is checked at both ends)
        const seen = (t, end) => {
          t.scrollIntoView({ block: end ? 'end' : 'start', inline: 'nearest' });
          const box = end ? [...t.getClientRects()].at(-1) : t.getClientRects()[0], q = t.getBoundingClientRect();
          const y = end ? box.bottom - Math.min(6, box.height / 2) : box.top + Math.min(6, box.height / 2);
          const at = document.elementFromPoint(box.left + box.width / 2, y); // mid-width: hit testing follows the pills' rounded corners
          const fits = q.height <= pr.height ? q.top >= pr.top - 1 && q.bottom <= pr.bottom + 1 : (end ? q.bottom <= pr.bottom + 1 : q.top >= pr.top - 1);
          return fits && q.left >= pr.left - 1 && q.right <= pr.right + 1 && !!at && (t === at || t.contains(at)) ? '' : `[${Math.round(q.top)},${Math.round(q.bottom)}] in [${Math.round(pr.top)},${Math.round(pr.bottom)}]`;
        };
        for (const t of targets) {
          const miss = seen(t, false) || seen(t, true);
          if (miss) unreachable.push(`${t.tagName}.${t.className}: ${t.textContent.trim().slice(0, 30)} ${miss}`);
        }
        return { unreachable, sheet: panel.getAttribute('aria-modal'), sw: panel.scrollWidth <= panel.clientWidth };
      });
      ok(!r.unreachable.length, `${p} @${width}x${height}: every choice and the last answer can be scrolled into the panel`, r.unreachable.join('; '));
      ok(r.sheet === 'true' && r.sw, `${p} @${width}x${height}: the full-screen sheet, no sideways scroll`);
      await ctx.close();
    }
  }

  // ---------- 7c. a new answer opens at its first line (desktop card, 1280 x 640)
  {
    const ctx = await context({ viewport: { width: 1280, height: 640 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await ready(page, 'bargainhub.html');
    await openPanel(page);
    await page.click('.milli-c button:has-text("Packages")');
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const b = document.querySelector('.milli-b').getBoundingClientRect(), msgs = document.querySelectorAll('.milli-log .milli-msg');
      const you = msgs[msgs.length - 2].getBoundingClientRect(), ans = msgs[msgs.length - 1].querySelector('p').getBoundingClientRect();
      return [you.top >= b.top - 1 && you.bottom <= b.bottom + 1, ans.top >= b.top - 1 && ans.top + 20 <= b.bottom, Math.round(you.top), Math.round(ans.top), Math.round(b.top), Math.round(b.bottom)];
    });
    ok(r[0] && r[1], 'bargainhub @1280x640: after a choice, the question and the answer\'s first line are in view', r.join(','));
    await ctx.close();
  }

  // ---------- 7d. on a phone, "Talk to a person" keeps the answer (and the email) in view; its button opens the dialog
  {
    const ctx = await context({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await ready(page, 'index.html');
    await openPanel(page);
    await page.click('.milli-c button:has-text("Talk to a person")');
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const last = document.querySelector('.milli-log').lastElementChild, q = last.querySelector('p').getBoundingClientRect();
      const at = document.elementFromPoint(q.left + 5, q.top + 5);
      return { open: !document.getElementById('milliPanel').hidden, dialog: !!document.querySelector('dialog[open]'), email: /Enquiry@hanesdistribution\.co\.nz/.test(last.textContent), seen: !!at && last.contains(at) };
    });
    ok(r.open && !r.dialog && r.email && r.seen, 'index @390: "Talk to a person" shows the answer with the email, no dialog on top', JSON.stringify(r));
    await page.click('.milli-log .milli-a:has-text("Send an enquiry")');
    await page.waitForSelector('dialog.qd[open]');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    ok((await active(page)).startsWith('milli-l|'), 'index @390: its "Send an enquiry" opens the dialog; Esc returns to the launcher', await active(page));
    await ctx.close();
  }

  // ---------- 7e. a stalled /api/guide: the first open is quick, and repeated clicks build one panel
  {
    const ctx = await context({ reducedMotion: 'reduce' });
    await ctx.route('**/api/guide', () => { /* never answers */ });
    const page = await ctx.newPage();
    await ready(page, 'index.html');
    const t0 = Date.now();
    await page.click('.milli-l');
    await page.waitForTimeout(250);
    await page.click('.milli-l', { force: true }).catch(() => {});
    await page.waitForSelector('#milliPanel:not([hidden]) .milli-c button', { timeout: 5000 });
    const ms = Date.now() - t0;
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => ({ chips: document.querySelectorAll('.milli-chip').length, greetings: [...document.querySelectorAll('.milli-log .milli-msg')].filter(m => /Kia ora/.test(m.textContent)).length, panels: document.querySelectorAll('#milliPanel').length, busy: document.querySelector('.milli-l').getAttribute('aria-busy') }));
    ok(ms < 2000, 'stalled /api/guide: the panel still opens quickly', `${ms} ms`);
    ok(r.chips === 4 && r.greetings === 1 && r.panels === 1 && r.busy === null, 'stalled /api/guide: two clicks, one panel, one set of chips, one greeting', JSON.stringify(r));
    await ctx.close();
  }

  // ---------- 8. live path with a stubbed /api/guide: server text stays text, a 5xx falls back
  {
    const ctx = await context({ reducedMotion: 'reduce' });
    let asks = 0;
    await ctx.route('**/api/guide', async route => {
      const q = route.request();
      if (q.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"mode":"live"}' });
      const b = JSON.parse(q.postData());
      if (b.op === 'start') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"sid":"s1","sig":"g1"}' });
      asks++;
      if (asks === 1) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'live', reply: '<img src=x onerror="window.__pwned=1"><b>Bold</b> Bargainhub designs kitchens.', actions: ['go_bargainhub', 'javascript:alert(1)'], handoff: 'none', sig: 'r1', redacted: [] }) });
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"down"}' });
    });
    const page = await ctx.newPage();
    await ready(page, 'index.html');
    await page.click('.milli-l');
    await page.waitForSelector('#milliPanel textarea');
    const live = await page.evaluate(() => {
      const t = document.querySelector('#milliPanel textarea');
      return { focus: document.activeElement === t, label: t.labels[0] && t.labels[0].textContent, size: parseFloat(getComputedStyle(t).fontSize), notice: document.getElementById('milliNotice').textContent };
    });
    ok(live.focus && live.label === 'Ask Milli a question' && live.size >= 16, 'live: a labelled text box, 16 px or more, focused on open', JSON.stringify(live));
    ok(live.notice.startsWith('Milli is an AI guide. Your questions go to our AI provider, SpaceXAI (xAI) in the United States') && live.notice.endsWith('Privacy statement'), 'live: the §11.2 live notice before the first message');
    const liveAxe = await axe(page, ['#milliPanel']);
    ok(liveAxe.length === 0, 'live: axe, nothing in Milli', liveAxe.join('; '));
    await page.keyboard.type('Do you design kitchens?');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Bargainhub designs kitchens/.test(document.querySelector('[role=log]').textContent));
    const safe = await page.evaluate(() => ({ img: !!document.querySelector('#milliPanel img, #milliPanel b'), pwned: !!window.__pwned, links: [...document.querySelectorAll('.milli-log a')].map(a => a.getAttribute('href')) }));
    ok(!safe.img && !safe.pwned && safe.links.join() === '/bargainhub.html', 'live: the server\'s markup is shown as text; unknown actions dropped', JSON.stringify(safe));
    await page.keyboard.type('And bathrooms?');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('#milliPanel textarea'));
    const fb = await page.evaluate(() => [document.querySelector('[role=log]').lastElementChild.textContent, document.activeElement.className]);
    ok(fb[0] === "Milli said: Milli couldn't reach its AI service, so here are quick answers instead." && fb[1] === 'milli-chip', 'live: a 5xx falls back to static mode, the text box goes, focus moves to the first choice', fb.join(' | '));
    ok(ctx.posts.length === 3, 'live: start + two asks were the only posts', String(ctx.posts.length));
    await ctx.close();
  }

  // ---------- 9. the one hello: bargainhub, desktop, once, dismissible; never on index or a phone
  if (!skipNudge) {
    const run = async (p, opts) => {
      const ctx = await context({ reducedMotion: 'reduce', ...opts });
      const page = await ctx.newPage();
      await ready(page, p);
      await page.waitForTimeout(21500);
      const shown = await page.evaluate(() => { const n = document.querySelector('.milli-nudge'); return n && getComputedStyle(n).display !== 'none' ? n.textContent : null; });
      return { ctx, page, shown };
    };
    const [bh, idx, phone] = await Promise.all([run('bargainhub.html', {}), run('index.html', {}), run('bargainhub.html', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })]);
    ok(bh.shown && /Kia ora, I'm Milli, Hanes's AI guide/.test(bh.shown), 'hello: shown on bargainhub after 20 s on a desktop', bh.shown);
    ok(!idx.shown, 'hello: never on index');
    ok(!phone.shown, 'hello: never on a phone');
    ok((await axe(bh.page, ['.milli-nudge'])).length === 0, 'hello: axe, nothing in the hello');
    await bh.page.click('.milli-nudge button');
    ok(await bh.page.evaluate(() => !document.querySelector('.milli-nudge') && document.activeElement.className === 'milli-l'), 'hello: dismissed, focus on the launcher');
    await bh.page.reload({ waitUntil: 'load' });
    await bh.page.waitForSelector('.milli-l', { state: 'visible', timeout: 15000 });
    await bh.page.waitForTimeout(21500);
    ok(await bh.page.evaluate(() => !document.querySelector('.milli-nudge')), 'hello: only once (localStorage bh_milli_nudged)');
    for (const r of [bh, idx, phone]) await r.ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${failed} failure(s)`);
process.exit(failed ? 1 : 0);
