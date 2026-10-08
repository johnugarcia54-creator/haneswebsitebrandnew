/* =========================================================================================
   Browser check for bhAuthHygiene and the My account swap (ADDENDUM §3.3.4, §6.1), run by hand.
     node tests/browser/hygiene.mjs
   PLAYWRIGHT_MODULE, CHROMIUM_PATH as in tests/browser/bar.mjs.
   scripts/dev.mjs serves the site and routes /api/* (except /api/enquiry) to a stub studio,
   exactly as vercel.json does, with the staging edge header. On every root page and on an
   unknown address (the 404 page):
   - token + bh_remember=1, or token + bh_live=1: kept, My account, no call to the studio
   - token and neither marker: the key is removed, Log in stays, GET /api/session then
     POST /api/auth/logout with the CSRF token reach the studio through the rewrite
   - no token: Log in, no call to the studio, no console error
   ========================================================================================= */
import http from 'node:http';
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

// the stub studio: a signed-in session, and a logout that wants the CSRF token
const seen = [];
const studio = http.createServer((req, res) => {
  seen.push({ method: req.method, url: req.url, csrf: req.headers['x-csrf-token'] || null, edge: req.headers['x-studio-edge'] || null });
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/session') return res.end(JSON.stringify({ user: { id: 'u1' }, csrfToken: 'csrf-stub', level: 'client' }));
  if (req.url === '/api/auth/logout' && req.method === 'POST') return res.end('{"ok":true}');
  res.statusCode = 404; res.end('{}');
});
await new Promise(r => studio.listen(0, '127.0.0.1', r));
const root = fileURLToPath(new URL('../..', import.meta.url));
const pages = [...readdirSync(root).filter(f => f.endsWith('.html')).sort(), 'no-such-page'];
const server = createDevServer({ env: { STUDIO_EDGE_SECRET_STAGING: 'stub-edge' }, studioUrl: `http://127.0.0.1:${studio.address().port}`, log: { warn() {}, error: console.error } });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const fails = [];
let passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { console.log(`FAIL ${msg}`); fails.push(msg); } };
const TOKEN = 'sb-mputtezdhevwwjgwktvi-auth-token';

const CASES = [
  ['remembered', { [TOKEN]: '{}', bh_remember: '1' }, false, 'My account', true, 0],
  ['this browser session', { [TOKEN]: '{}' }, true, 'My account', true, 0],
  ['browser closed', { [TOKEN]: '{}' }, false, 'Log in', false, 2],
  ['signed out', {}, false, 'Log in', false, 0]
];

try {
  for (const p of pages) {
    for (const [what, store, live, label, tokenLeft, calls] of CASES) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
      if (live) await ctx.addCookies([{ name: 'bh_live', value: '1', url: base, sameSite: 'Strict' }]);
      await ctx.addInitScript(s => { if (location.pathname !== '/__blank') return; for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, store);
      const page = await ctx.newPage();
      // seed storage on the origin first, as a real earlier visit would have
      await page.route(`${base}/__blank`, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>x</title>' }));
      await page.goto(`${base}/__blank`);
      const errors = [];
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', e => errors.push(e.message));
      seen.length = 0;
      await page.goto(`${base}/${p}`, { waitUntil: 'load' });
      await page.waitForTimeout(calls ? 400 : 100);
      const r = await page.evaluate(t => ({
        labels: [...document.querySelectorAll('a.gb__login, a.gf__login')].map(a => `${a.textContent.trim()}|${a.getAttribute('href')}`),
        token: localStorage.getItem(t) !== null
      }), TOKEN);
      const want = label === 'My account' ? 'My account|/studio/#/account' : null;
      check(r.labels.length === 3 && r.labels.every(x => (want ? x === want : x.startsWith('Log in|'))), `${p} ${what}: ${label} (${r.labels.join(', ')})`);
      check(r.token === tokenLeft, `${p} ${what}: token ${tokenLeft ? 'kept' : 'absent'}`);
      check(seen.length === calls, `${p} ${what}: ${calls} studio calls (${JSON.stringify(seen)})`);
      if (calls) {
        check(seen[0].method === 'GET' && seen[0].url === '/api/session' && seen[0].edge === 'stub-edge', `${p} ${what}: GET /api/session through the rewrite`);
        check(seen[1] && seen[1].method === 'POST' && seen[1].url === '/api/auth/logout' && seen[1].csrf === 'csrf-stub', `${p} ${what}: POST /api/auth/logout with the CSRF token`);
      }
      // the unknown address answers 404 by design; anything else in the console is a fault
      const real = errors.filter(e => !(p === 'no-such-page' && /status of 404/.test(e)));
      check(real.length === 0, `${p} ${what}: no console errors (${real.join(' | ')})`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.close();
  studio.close();
}
console.log(`\n${passes} checks passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
