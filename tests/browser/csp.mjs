/* =========================================================================================
   Browser check for the /auth CSP (ADDENDUM §10.2), run by hand: CI has no browser.
     node tests/browser/csp.mjs
   PLAYWRIGHT_MODULE, CHROMIUM_PATH as in tests/browser/bar.mjs.
   A throwaway copy of this site's vercel.json, plus a probe page under /auth/, is served by
   scripts/dev.mjs (so it gets exactly the headers Vercel sends). In Chromium the probe page:
   - may connect to https://mputtezdhevwwjgwktvi.supabase.co (answered locally, nothing leaves)
   - is refused by the CSP for any other Supabase project, any other host, and inline script
   And the real 404.html, as Vercel serves it for an unknown /auth/ path (under the /auth CSP),
   is fully styled: no style-src refusal and the page's own stylesheet applies.
   ========================================================================================= */
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const repo = fileURLToPath(new URL('../..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'csp-'));
mkdirSync(join(dir, 'auth'));
copyFileSync(join(repo, 'vercel.json'), join(dir, 'vercel.json'));
writeFileSync(join(dir, 'auth/probe.html'), '<!doctype html><html lang="en-NZ"><head><meta charset="utf-8"><title>probe</title><link rel="icon" href="data:,"><script src="/auth/probe.js"></script><script>window.inlineRan = true;</script></head><body><h1>probe</h1></body></html>');
writeFileSync(join(dir, 'auth/probe.js'), `
window.violations = [];
document.addEventListener('securitypolicyviolation', e => window.violations.push(e.violatedDirective + ' ' + e.blockedURI));
const tryFetch = u => fetch(u, { mode: 'cors' }).then(r => 'ok ' + r.status, e => 'blocked ' + e.name);
window.results = Promise.all([
  tryFetch('https://mputtezdhevwwjgwktvi.supabase.co/auth/v1/health'),
  tryFetch('https://otherproject1.supabase.co/auth/v1/health'),
  tryFetch('https://evil.example/collect'),
  tryFetch('/api/session-probe')
]);
`);

const server = createDevServer({ root: dir, env: {}, studioUrl: 'http://127.0.0.1:9', log: { warn() {}, error() {} } });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };

try {
  const page = await browser.newPage();
  const outbound = [];
  // nothing leaves this machine: every external request is answered here, and recorded
  await page.route(/^https:\/\//, r => { outbound.push(new URL(r.request().url()).host); r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{}' }); });
  const res = await page.goto(`${base}/auth/probe.html`);
  const csp = res.headers()['content-security-policy'];
  check(/connect-src 'self' https:\/\/mputtezdhevwwjgwktvi\.supabase\.co;/.test(csp) && !csp.includes('*'), `the page is served with the narrowed CSP (${csp})`);
  const results = await page.evaluate(() => window.results);
  await page.waitForTimeout(200);
  const violations = await page.evaluate(() => window.violations);
  check(results[0] === 'ok 200', `our Supabase project is reachable (${results[0]})`);
  check(results[1].startsWith('blocked'), `another Supabase project is refused (${results[1]})`);
  check(results[2].startsWith('blocked'), `any other host is refused (${results[2]})`);
  check(!results[3].startsWith('blocked'), `same-origin calls are allowed (${results[3]})`);
  check(await page.evaluate(() => window.inlineRan !== true), 'inline script does not run');
  check(violations.some(v => v.startsWith('connect-src https://otherproject1.supabase.co')) && violations.some(v => v.startsWith('connect-src https://evil.example')), `the CSP reports both refusals (${violations.join(', ')})`);
  check(outbound.length === 1 && outbound[0] === 'mputtezdhevwwjgwktvi.supabase.co', `only our project was contacted (${outbound.join(', ')})`);

  // the 404 page under the /auth header group, served from this repo
  const real = createDevServer({ root: repo, env: {}, studioUrl: 'http://127.0.0.1:9', log: { warn() {}, error() {} } });
  await new Promise(r => real.listen(0, '127.0.0.1', r));
  try {
    const p404 = await browser.newPage();
    await p404.addInitScript(() => { window.violations = []; document.addEventListener('securitypolicyviolation', e => window.violations.push(e.violatedDirective + ' ' + e.blockedURI)); });
    const r404 = await p404.goto(`http://127.0.0.1:${real.address().port}/auth/does-not-exist`, { waitUntil: 'load' });
    await p404.waitForTimeout(200);
    check(r404.status() === 404 && /style-src 'self'/.test(r404.headers()['content-security-policy'] || ''), `/auth/does-not-exist gets the 404 page under the /auth CSP (HTTP ${r404.status()})`);
    const v404 = await p404.evaluate(() => window.violations);
    check(v404.length === 0, `the 404 page breaks no CSP rule there (${v404.join(', ') || 'none'})`);
    const look = await p404.evaluate(() => { const t = document.querySelector('.tile'); const cs = getComputedStyle(t); return { radius: cs.borderRadius, c: cs.getPropertyValue('--c').trim(), grid: getComputedStyle(document.querySelector('.tiles')).display }; });
    check(look.radius === '22px' && look.c === '#b8894d' && look.grid === 'grid', `the 404 page is styled there (${JSON.stringify(look)})`);
  } finally { real.close(); }
} finally {
  await browser.close();
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(fails.length ? 1 : 0);
