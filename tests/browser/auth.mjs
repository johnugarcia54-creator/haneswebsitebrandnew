/* =========================================================================================
   Browser check for the five sign-in pages (stream W2; ADDENDUM §3.3, §6.3, §10.2), run by hand:
   CI has no browser.
     node tests/browser/auth.mjs
   PLAYWRIGHT_MODULE, CHROMIUM_PATH as in tests/browser/bar.mjs.
   AXE_PATH      axe.min.js (default: the 'axe-core' package)
   PORT          the dev server (default 3000); STUB_PORT the stub studio (default 4190)

   scripts/dev.mjs serves the site with vercel.json's headers, and routes /api/* to a stub
   studio on STUB_PORT, exactly as Vercel does. Nothing leaves this machine: Supabase and
   Cloudflare Turnstile are answered by Playwright routes.
   A. As committed (placeholder keys): every page at 390, 834 and 1440 px gets exactly the
      /auth CSP, has zero CSP violations and zero console errors, makes no request to Supabase
      or Cloudflare, says "Sign-in is being set up" (sign-up: "Accounts open soon"), has one
      h1, no inline script, no horizontal scroll, and passes axe (WCAG 2.2 AA rules).
   A always serves a placeholder copy of auth/config.js, so it tests that state whatever is committed.
   B. With test keys (a test copy of auth/config.js served by a route) and stubbed Supabase:
      the keyboard flow on the sign-in page, sign-in with the remember choice and the landing,
      the uniform error with Resend, Retry when the studio is down, sign-up closed, open and
      failing, the code preview after 600 ms, reset, and the confirm flows in their order:
      token_hash gone from the address bar before anything else, nothing consumed without a
      click, invite exchange before update-password, recovery without an exchange until the
      password is set, then revokeOthers:true; no Referer on any request. axe on every state.
      B serves the pages with the Turnstile CSP, as vercel.json will once the site key is set.
   C. The publishable key without a Turnstile site key (the Friday state): the /auth CSP without
      Cloudflare, sign-in, Resend and reset with no widget, nothing loaded from Cloudflare and no
      captcha token sent; sign-up stays closed even when the studio says it is open.
   ========================================================================================= */
import http from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDevServer } from '../../scripts/dev.mjs';
import { pickConfig } from '../../auth/config.js';

const require = createRequire(import.meta.url);
const loadPlaywright = () => {
  for (const m of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node-tools/node_modules/playwright'].filter(Boolean)) {
    try { return require(m); } catch { /* next */ }
  }
  throw new Error('playwright not found: set PLAYWRIGHT_MODULE');
};
const { chromium } = loadPlaywright();
const axePath = process.env.AXE_PATH || (() => { try { return require.resolve('axe-core/axe.min.js'); } catch { return null; } })();
if (!axePath || !existsSync(axePath)) throw new Error('axe-core not found: set AXE_PATH to axe.min.js');
const axeSource = readFileSync(axePath, 'utf8');

const root = fileURLToPath(new URL('../..', import.meta.url));
const CSP_REST = "connect-src 'self' https://mputtezdhevwwjgwktvi.supabase.co; img-src 'self' data:; style-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
const CSP_TURNSTILE = `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; ${CSP_REST}`;
const CSP_NO_TURNSTILE = `default-src 'self'; script-src 'self'; frame-src 'none'; ${CSP_REST}`;
// what vercel.json serves: it follows the committed Turnstile site key (tests/config.test.mjs)
const CSP = ['hanes-the-website-new.vercel.app', 'localhost:3000'].some(h => pickConfig(h).turnstileReady) ? CSP_TURNSTILE : CSP_NO_TURNSTILE;
const SB = 'https://mputtezdhevwwjgwktvi.supabase.co';
const PAGES = ['login', 'signup', 'reset', 'confirm', 'update-password'];
const PORT = Number(process.env.PORT || 3000), STUB_PORT = Number(process.env.STUB_PORT || 4190);

/* ---------- the stub studio (what the rewrite reaches) ---------- */
const studioState = { publicSignup: false, settingsStatus: 200, exchange: [] };
const studioSeen = [];
const studio = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const entry = { method: req.method, url: req.url, body: body ? JSON.parse(body) : null, origin: req.headers.origin || null, referer: req.headers.referer || null };
    studioSeen.push(entry);
    const json = (status, v) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.url === '/api/settings/public') return studioState.settingsStatus === 200 ? json(200, { revision: 1, settings: { accounts: { publicSignup: studioState.publicSignup } } }) : json(studioState.settingsStatus, { error: { code: 'unavailable' } });
    if (req.url === '/api/session') return json(200, { user: null, csrfToken: null, level: 'visitor' });
    if (req.url === '/api/codes/preview') return json(200, entry.body && entry.body.code === 'SARAH-7K2Q' ? { valid: true, consultantFirstName: 'Sarah', percentBp: 500 } : { valid: false });
    if (req.url === '/api/auth/exchange') {
      const a = studioState.exchange.length ? studioState.exchange.shift() : [200, { user: { id: 'u1' }, csrfToken: 'c', level: 'client' }];
      return json(a[0], a[1]);
    }
    if (req.url.startsWith('/') && !req.url.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><html lang="en-NZ"><title>studio stub</title><h1>Studio</h1></html>'); }
    json(404, { error: { code: 'not_found' } });
  });
});
await new Promise((r, j) => studio.once('error', j).listen(STUB_PORT, '127.0.0.1', r));
const server = createDevServer({ env: { STUDIO_EDGE_SECRET_STAGING: 'stub-edge' }, studioUrl: `http://127.0.0.1:${STUB_PORT}`, log: { warn() {}, error: console.error } });
await new Promise((r, j) => server.once('error', j).listen(PORT, '127.0.0.1', r));
const base = `http://localhost:${PORT}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const fails = [];
let passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { console.log(`FAIL ${msg}`); fails.push(msg); } };

/* ---------- stubs for the third parties ---------- */
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub, amr) => `${b64u({ alg: 'ES256', typ: 'JWT', kid: 'k1' })}.${b64u({ sub, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), session_id: 's1', amr: [{ method: amr, timestamp: Math.floor(Date.now() / 1000) }] })}.c2ln`;
const user = { id: '7b6a1c55-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'aroha@example.co.nz', email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const sessionBody = amr => ({ access_token: jwt(user.id, amr), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + amr, user });
const TURNSTILE_STUB = `window.turnstile = {
  render(el, o) { const d = document.createElement('div'); d.className = 'ts-stub'; d.textContent = 'Security check passed (test)'; el.append(d);
    window.__tsRenders = (window.__tsRenders || []).concat([{ sitekey: o.sitekey, action: o.action, size: o.size }]);
    setTimeout(() => o.callback('ts-token-' + (window.__tsRenders.length)), 30); window.__tsCb = o.callback; return 'w1'; },
  reset() { window.__tsResets = (window.__tsResets || 0) + 1; setTimeout(() => window.__tsCb && window.__tsCb('ts-token-r' + window.__tsResets), 30); },
  getResponse() { return ''; }
};`;
// test copies of auth/config.js: whatever is committed, every key is replaced
const CONFIG_SRC = readFileSync(root + 'auth/config.js', 'utf8');
const configWith = (pk, ts) => CONFIG_SRC.replace(/publishableKey: '[^']*'/g, `publishableKey: '${pk}'`).replace(/turnstileSiteKey: '[^']*'/g, `turnstileSiteKey: '${ts}'`);
const TEST_CONFIG = configWith('sb_publishable_testOnlyKey123', '1x00000000000000000000AA');
const TEST_CONFIG_NO_TURNSTILE = configWith('sb_publishable_testOnlyKey123', 'PLACEHOLDER_TURNSTILE_SITE_KEY');
const PLACEHOLDER_CONFIG = configWith('PLACEHOLDER_SUPABASE_PUBLISHABLE_KEY', 'PLACEHOLDER_TURNSTILE_SITE_KEY');

// a context that records requests, console output and CSP violations
async function context({ width = 1280, configured = false, turnstile = true, gotrue = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const log = { requests: [], console: [], sb: [] };
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  ctx.on('request', r => log.requests.push({ url: r.url(), method: r.method(), referer: r.headers().referer || null }));
  ctx.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log.console.push(`${m.type()}: ${m.text()}`); });
  ctx.on('weberror', e => log.console.push(`pageerror: ${e.error().message}`));
  const body = !configured ? PLACEHOLDER_CONFIG : turnstile ? TEST_CONFIG : TEST_CONFIG_NO_TURNSTILE;
  await ctx.route(`${base}/auth/config.js`, r => r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body, headers: { 'Cache-Control': 'no-store' } }));
  // with a Turnstile key the pages get the Turnstile CSP, as vercel.json will in the same commit
  const policy = configured && turnstile ? CSP_TURNSTILE : CSP_NO_TURNSTILE;
  if (policy !== CSP) await ctx.route(/\/auth\/[a-z-]+\.html(\?|$)/, async r => { const res = await r.fetch(); await r.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': policy } }); });
  if (configured) {
    await ctx.route('https://challenges.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: TURNSTILE_STUB, headers: { 'Access-Control-Allow-Origin': '*' } }));
    await ctx.route(`${SB}/**`, async r => {
      const req = r.request(), url = new URL(req.url());
      const cors = { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Credentials': 'true' };
      if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
      let body = null; try { body = req.postDataJSON(); } catch { /* none */ }
      const key = `${req.method()} ${url.pathname}${url.pathname === '/auth/v1/token' ? '?' + url.searchParams.get('grant_type') : ''}`;
      log.sb.push({ key, body, apikey: req.headers().apikey || null, referer: req.headers().referer || null });
      const answer = gotrue[key] ? gotrue[key](body) : {
        'POST /auth/v1/token?password': [200, sessionBody('password')],
        'POST /auth/v1/verify': [200, sessionBody('otp')],
        'PUT /auth/v1/user': [200, user],
        'GET /auth/v1/user': [200, user],
        'POST /auth/v1/signup': [200, { ...user, email_confirmed_at: null, identities: [] }],
        'POST /auth/v1/recover': [200, {}],
        'POST /auth/v1/resend': [200, {}],
        'POST /auth/v1/logout': [204, null]
      }[key] || [404, { code: 'not_found', msg: 'stub' }];
      return r.fulfill({ status: answer[0], headers: { ...cors, 'Content-Type': 'application/json' }, body: answer[1] === null ? '' : JSON.stringify(answer[1]) });
    });
  }
  return { ctx, log };
}
const csp = page => page.evaluate(() => window.__csp);

async function axe(page, label) {
  await page.evaluate(axeSource); // evaluated by the test harness, so the page's CSP (which refuses inline scripts) stays untouched
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] }))
    .violations.map(x => `${x.id}: ${x.nodes.map(n => n.target.join(' ')).join(', ')}`));
  check(v.length === 0, `${label}: axe clean (${v.join(' | ')})`);
}
async function noScroll(page, label) {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  check(sw <= iw, `${label}: no horizontal scroll (${sw} > ${iw})`);
}
const visible = (page, sel) => page.locator(sel).isVisible();
// every target is at least 44 px tall (links inside a sentence are exempt, WCAG 2.5.8)
async function targets(page, label) {
  const small = await page.evaluate(() => [...document.querySelectorAll('.gb a, .gf a, .auth__links a, .auth__alt a, .auth__closed a, button, .auth__check, .auth input:not([type=checkbox])')]
    .filter(e => e.offsetParent !== null).map(e => [e.id || e.className || e.textContent.trim(), Math.round(e.getBoundingClientRect().height)]));
  check(small.length >= 5, `${label}: the target check sees the page (${small.length} targets)`);
  small.splice(0, small.length, ...small.filter(([, h]) => h < 44));
  check(small.length === 0, `${label}: every target is at least 44 px tall (${JSON.stringify(small)})`);
  const narrow = await page.evaluate(() => [...document.querySelectorAll('.gf a')].filter(e => e.offsetParent !== null && e.getBoundingClientRect().width < 44).map(e => e.textContent.trim()));
  check(narrow.length === 0, `${label}: the footer links are at least 44 px wide (${narrow.join(', ')})`);
  // the copyright and the footer links sit on one line (their text centres within 1 px)
  const mid = await page.evaluate(() => [document.querySelector('.gf__base>span:first-child'), document.querySelector('.gf__links a')].map(e => {
    const r = document.createRange(); r.selectNodeContents(e); const b = r.getBoundingClientRect(); return b.top + b.height / 2;
  }));
  const wrapped = Math.abs(mid[0] - mid[1]) > 15; // a narrow footer puts the links on their own line
  check(wrapped || Math.abs(mid[0] - mid[1]) <= 1, `${label}: the footer text shares one line (${mid.map(Math.round).join(' vs ')})`);
}
const text = (page, sel) => page.locator(sel).innerText();

try {
  /* ================= A. as committed: placeholders ================= */
  for (const width of [390, 834, 1440]) {
    for (const p of PAGES) {
      const label = `A ${p} @${width}`;
      const { ctx, log } = await context({ width });
      const page = await ctx.newPage();
      const resp = await page.goto(`${base}/auth/${p}.html${p === 'confirm' ? '?token_hash=abc123def456&type=email' : ''}`, { waitUntil: 'networkidle' });
      check(resp.headers()['content-security-policy'] === CSP_NO_TURNSTILE, `${label}: exactly the /auth CSP without Cloudflare`);
      check(resp.headers()['referrer-policy'] === 'no-referrer' && /noindex/.test(resp.headers()['x-robots-tag'] || ''), `${label}: no-referrer and noindex headers`);
      await page.waitForTimeout(150);
      const msg = p === 'signup' ? "Accounts open soon. Send us an enquiry and we'll set you up, or ask your consultant for an invitation." : 'Sign-in is being set up.';
      check((await page.locator('main').innerText()).includes(msg), `${label}: says "${msg.slice(0, 30)}…"`);
      check(!(await visible(page, '#form')), `${label}: no form while not set up`);
      check((await page.locator('h1').count()) === 1, `${label}: one h1`);
      check((await page.locator('script:not([src])').count()) === 0, `${label}: no inline script`);
      check(!log.requests.some(r => /supabase\.co|cloudflare\.com/.test(r.url)), `${label}: no request to Supabase or Cloudflare`);
      check(!log.requests.some(r => /\/vendor\/supabase-js/.test(r.url)), `${label}: supabase-js is not loaded while the keys are placeholders`);
      if (p === 'confirm') check(!page.url().includes('token_hash'), `${label}: token_hash removed from the address bar`);
      check((await csp(page)).length === 0, `${label}: zero CSP violations (${(await csp(page)).join(', ')})`);
      check(log.console.length === 0, `${label}: zero console errors (${log.console.join(' | ')})`);
      await noScroll(page, label);
      if (width !== 834) await axe(page, label);
      await ctx.close();
    }
  }
  // 400% zoom of a 1280 px window is 320 px wide: still no horizontal scroll
  for (const p of PAGES) {
    const { ctx } = await context({ width: 320, configured: p !== 'signup' });
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/${p}.html${p === 'confirm' ? '?token_hash=abc123def456&type=invite' : ''}`, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await noScroll(page, `A ${p} @320`);
    await targets(page, `A ${p} @320`);
    await ctx.close();
  }
  // sign-up when the settings read fails: closed, never a broken form
  studioState.settingsStatus = 503;
  {
    const { ctx, log } = await context({ configured: true });
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/signup.html`, { waitUntil: 'load' });
    await page.locator('#closed').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    check(await visible(page, '#closed') && !(await visible(page, '#form')), 'A signup: a failed settings read shows Accounts open soon');
    check(!log.requests.some(r => /supabase\.co|cloudflare\.com/.test(r.url)), 'A signup closed: no call to Supabase or Cloudflare');
    check(!log.requests.some(r => /\/vendor\/supabase-js/.test(r.url)), 'A signup closed: supabase-js is not loaded');
    await ctx.close();
  }
  studioState.settingsStatus = 200;

  /* ================= B. with test keys and stubbed Supabase ================= */
  // B1. keyboard flow on the sign-in page, then a sign-in that lands by level
  {
    const { ctx, log } = await context({ configured: true });
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/login.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => (window.__tsRenders || []).length === 1);
    check(await visible(page, '#form') && !(await visible(page, '#notice')), 'B login: form shown once set up, the loading note gone');
    check(log.requests.filter(r => /\/vendor\/supabase-js-[\d.]+\.min\.js$/.test(r.url)).length === 1, 'B login: supabase-js loaded once, once the keys are real');
    const order = [];
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press('Tab');
      order.push(await page.evaluate(() => { const a = document.activeElement; return a.id || a.className || a.tagName; }));
    }
    check(JSON.stringify(order.slice(0, 8)) === JSON.stringify(['auth__skip', 'gb__logo', 'gb__back', 'email', 'password', 'auth__show', 'remember', 'auth__go']), `B login: keyboard order ${order.join(' > ')}`);
    const r0 = await page.evaluate(() => window.__tsRenders[0]);
    check(r0.sitekey === '1x00000000000000000000AA' && r0.action === 'login', 'B login: Turnstile rendered explicitly with the site key and action');
    // Enter with empty fields: field errors announced, nothing sent
    await page.focus('#email');
    await page.keyboard.press('Enter');
    check(await page.locator('#email[aria-invalid=true]').count() === 1 && (await page.evaluate(() => document.activeElement.id)) === 'email', 'B login: empty submit marks the email field and focuses it');
    check(log.sb.length === 0, 'B login: nothing sent with empty fields');
    await page.fill('#email', 'aroha@example.co.nz');
    await page.fill('#password', 'a-good-long-password');
    await page.keyboard.press('Enter');
    await page.waitForURL(`${base}/studio/#/account`);
    const signIn = log.sb.find(x => x.key === 'POST /auth/v1/token?password');
    check(!!signIn && signIn.body.gotrue_meta_security && /^ts-token/.test(signIn.body.gotrue_meta_security.captcha_token), 'B login: signInWithPassword carries the Turnstile token');
    check(signIn && signIn.apikey === 'sb_publishable_testOnlyKey123', 'B login: the publishable key is the only key sent');
    const ex = studioSeen.filter(s => s.url === '/api/auth/exchange').at(-1);
    check(ex && ex.body.accessToken && ex.body.accessToken.split('.').length === 3 && Object.keys(ex.body).join() === 'accessToken', 'B login: then POST /api/auth/exchange {accessToken}');
    check(ex && ex.origin === base, 'B login: the exchange carries our Origin');
    const cookies = await ctx.cookies(base);
    const live = cookies.find(c => c.name === 'bh_live');
    check(!!live && live.value === '1' && live.expires === -1 && live.sameSite === 'Strict', 'B login: unticked sets the session cookie bh_live=1 (no expiry, SameSite=Strict)');
    check(await page.evaluate(() => Object.keys(localStorage).includes('sb-mputtezdhevwwjgwktvi-auth-token') && localStorage.getItem('bh_remember') === null), 'B login: Supabase session stored, bh_remember not set');
    check(log.requests.every(r => !r.referer), 'B login: no Referer on any request');
    check(log.console.length === 0, `B login: zero console errors (${log.console.join(' | ')})`);
    await ctx.close();
  }
  // B2. remember ticked, a next, a refusal, the uniform error and Resend, Retry
  {
    const { ctx, log } = await context({ configured: true });
    const page = await ctx.newPage();
    studioState.exchange.push([200, { user: { id: 'u2' }, csrfToken: 'c', level: 'admin' }]);
    await page.goto(`${base}/auth/login.html?next=/studio/%23/backoffice`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => (window.__tsRenders || []).length === 1);
    await page.fill('#email', 'staff@example.co.nz'); await page.fill('#password', 'a-good-long-password');
    await page.check('#remember');
    await page.click('button[type=submit]');
    await page.waitForURL(`${base}/studio/#/backoffice`);
    check(await page.evaluate(() => localStorage.getItem('bh_remember')) === '1', 'B login: ticked keeps bh_remember=1');
    check(!(await ctx.cookies(base)).some(c => c.name === 'bh_live'), 'B login: ticked leaves no bh_live');
    await ctx.close();
  }
  for (const evil of ['//evil.example', 'https://evil.example/', 'javascript:alert(1)', '/studio/%2e%2e/x', '/\\evil.example']) {
    const { ctx } = await context({ configured: true });
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/login.html?next=${encodeURIComponent(evil)}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => (window.__tsRenders || []).length === 1);
    await page.fill('#email', 'aroha@example.co.nz'); await page.fill('#password', 'a-good-long-password');
    await page.click('button[type=submit]');
    await page.waitForURL(u => u.pathname.startsWith('/studio/'));
    check(page.url() === `${base}/studio/#/account`, `B login: next=${evil} ignored, landing used (${page.url()})`);
    await ctx.close();
  }
  {
    const { ctx, log } = await context({ configured: true, gotrue: { 'POST /auth/v1/token?password': () => [400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' }] } });
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/login.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => (window.__tsRenders || []).length === 1);
    await page.fill('#email', 'aroha@example.co.nz'); await page.fill('#password', 'wrong-password-123');
    await page.click('button[type=submit]');
    await page.locator('#alert').waitFor({ state: 'visible' });
    check(await text(page, '#alert') === "That email and password don't match, or the account isn't confirmed yet.", 'B login: the uniform error');
    check(await page.evaluate(() => document.activeElement.id) === 'alert', 'B login: the error takes focus (announced)');
    check(await visible(page, '#resend'), 'B login: Resend confirmation offered');
    await page.waitForFunction(() => window.__tsResets >= 1);
    await page.waitForTimeout(80);
    await page.click('#resend');
    await page.locator('#notice').waitFor({ state: 'visible' });
    const rs = log.sb.find(x => x.key === 'POST /auth/v1/resend');
    check(rs && rs.body.type === 'signup' && rs.body.email === 'aroha@example.co.nz' && rs.body.gotrue_meta_security && /^ts-token/.test(rs.body.gotrue_meta_security.captcha_token), 'B login: resend({type:signup}) with a fresh Turnstile token');
    check((await text(page, '#notice')).startsWith("If that email has an account waiting for confirmation, we've sent a new link."), 'B login: resend answer never reveals the account');
    await axe(page, 'B login error state');
    check((await csp(page)).length === 0, 'B login error: zero CSP violations');
    await ctx.close();
  }
  {
    const { ctx } = await context({ configured: true, width: 390 });
    const page = await ctx.newPage();
    studioState.exchange.push([503, { error: { code: 'auth_unavailable', message: 'x' } }]);
    await page.goto(`${base}/auth/login.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => (window.__tsRenders || []).length === 1);
    await page.fill('#email', 'aroha@example.co.nz'); await page.fill('#password', 'a-good-long-password');
    await page.click('button[type=submit]');
    await page.locator('#retry').waitFor({ state: 'visible' });
    check(await text(page, '#alert') === "You're signed in, but the studio is unavailable for a moment.", 'B login: studio down message');
    await noScroll(page, 'B login retry @390');
    await targets(page, 'B login retry @390');
    await axe(page, 'B login retry @390');
    await page.click('#retry');
    await page.waitForURL(`${base}/studio/#/account`);
    check(true, 'B login: Retry signs in');
    await ctx.close();
  }
  for (const [status, code, want] of [[403, 'signup_closed', 'Your account is confirmed. Accounts open soon.'], [409, 'link_requires_invitation', 'This email belongs to a staff account. Use the invitation we sent, or ask Back Office.'], [403, 'account_disabled', 'This account is disabled. Contact us.']]) {
    const { ctx, log } = await context({ configured: true });
    const page = await ctx.newPage();
    studioState.exchange.push([status, { error: { code, message: 'x' } }]);
    await page.goto(`${base}/auth/login.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => (window.__tsRenders || []).length === 1);
    await page.fill('#email', 'aroha@example.co.nz'); await page.fill('#password', 'a-good-long-password');
    await page.click('button[type=submit]');
    await page.locator('#alert').waitFor({ state: 'visible' });
    check(await text(page, '#alert') === want, `B login ${code}: "${want}"`);
    check(!(await page.evaluate(() => Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k)))), `B login ${code}: the Supabase session is ended here`);
    await ctx.close();
  }
  // B3a. sign-up closed (the Friday state) with real keys: no supabase-js, no Turnstile
  {
    studioState.publicSignup = false;
    const { ctx, log } = await context({ configured: true, width: 390 });
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/signup.html`, { waitUntil: 'networkidle' });
    await page.locator('#closed').waitFor({ state: 'visible' });
    check(!log.requests.some(r => /\/vendor\/supabase-js|supabase\.co|cloudflare\.com/.test(r.url)), 'B signup closed: supabase-js, Supabase and Turnstile are never loaded');
    await ctx.close();
  }
  // B3. sign-up open: the form, the code preview, the answer
  studioState.publicSignup = true;
  for (const width of [390, 834, 1440]) {
    const { ctx, log } = await context({ configured: true, width });
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/signup.html?code=SARAH-7K2Q&next=/studio/%23/account`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => (window.__tsRenders || []).length === 1);
    check(await visible(page, '#form') && !(await visible(page, '#closed')), `B signup @${width}: the form when sign-up is open`);
    await page.waitForFunction(() => document.getElementById('codeNote').textContent !== '', null, { timeout: 3000 });
    check(await text(page, '#codeNote') === 'Code recorded: your consultant Sarah will apply your 5% discount on your quote.', `B signup @${width}: prefilled code previewed`);
    await noScroll(page, `B signup @${width}`);
    await targets(page, `B signup @${width}`);
    if (width !== 834) await axe(page, `B signup @${width}`);
    if (width === 1440) {
      const t0 = Date.now();
      await page.fill('#code', 'NOPE');
      await page.waitForFunction(() => document.getElementById('codeNote').textContent === "We don't recognise that code.");
      const previews = studioSeen.filter(s => s.url === '/api/codes/preview');
      check(Date.now() - t0 >= 550 && previews.at(-1).body.code === 'NOPE', 'B signup: preview after 600 ms idle');
      await page.fill('#name', 'Aroha Ngata'); await page.fill('#email', 'aroha@example.co.nz'); await page.fill('#password', 'a-good-long-password');
      await page.click('button[type=submit]');
      check(await page.locator('#privacy[aria-invalid=true]').count() === 1, 'B signup: the privacy tick is required');
      check(!log.sb.some(x => x.key === 'POST /auth/v1/signup'), 'B signup: nothing sent without the tick');
      await page.check('#privacy');
      await page.click('button[type=submit]');
      await page.locator('#done').waitFor({ state: 'visible' });
      check(await text(page, '#done') === 'Check your email to confirm your account.', 'B signup: the one answer');
      const su = log.sb.find(x => x.key === 'POST /auth/v1/signup');
      check(su && su.body.data.name === 'Aroha Ngata' && su.body.data.signup_code === 'NOPE' && su.body.data.privacy_notice_version === '2026-10-09' && su.body.data.marketing_opt_in === false
        && /^ts-token/.test(su.body.gotrue_meta_security.captcha_token), 'B signup: signUp with name, code, notice version, opt-in and Turnstile');
      await axe(page, 'B signup done');
    }
    check((await csp(page)).length === 0 && log.console.length === 0, `B signup @${width}: zero CSP violations and console errors (${log.console.join(' | ')})`);
    await ctx.close();
  }
  studioState.publicSignup = false;
  // B3b. forced colours (Windows contrast themes): focus stays visible on the fields, and the button keeps its edge
  {
    const { ctx } = await context({ configured: true, width: 390 });
    const page = await ctx.newPage();
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto(`${base}/auth/login.html`, { waitUntil: 'networkidle' });
    await page.locator('#form').waitFor({ state: 'visible' });
    await page.focus('#email');
    const st = await page.evaluate(() => { const c = getComputedStyle(document.activeElement); return [c.outlineStyle, parseFloat(c.outlineWidth)]; });
    check(st[0] !== 'none' && st[1] >= 2, `B forced colours: the focused field has a visible outline (${st.join(' ')})`);
    const btn = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.auth__go')); return [c.borderTopStyle, parseFloat(c.borderTopWidth)]; });
    check(btn[0] === 'solid' && btn[1] >= 1, `B forced colours: the Sign in button keeps a border (${btn.join(' ')})`);
    await ctx.close();
  }
  // B4. reset
  {
    const { ctx, log } = await context({ configured: true, width: 390 });
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/reset.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => (window.__tsRenders || []).length === 1);
    check(!(await visible(page, '#notice')), 'B reset: the loading note goes once the form is ready');
    await page.fill('#email', 'nobody@example.co.nz');
    await page.keyboard.press('Enter');
    await page.locator('#done').waitFor({ state: 'visible' });
    check(await text(page, '#done') === "If that email has an account, we've sent a link.", 'B reset: always the same answer');
    const rc = log.sb.find(x => x.key === 'POST /auth/v1/recover');
    check(rc && /^ts-token/.test(rc.body.gotrue_meta_security.captcha_token), 'B reset: resetPasswordForEmail carries Turnstile');
    check(new URL(rc ? `${SB}/auth/v1/recover?${''}` : SB) && log.requests.some(r => r.url.startsWith(`${SB}/auth/v1/recover?redirect_to=${encodeURIComponent(base + '/auth/confirm.html')}`)), 'B reset: redirect to /auth/confirm.html');
    await axe(page, 'B reset done @390');
    check((await csp(page)).length === 0 && log.console.length === 0, 'B reset: zero CSP violations and console errors');
    await ctx.close();
  }
  // B5. confirm: invite (exchange before update-password), then setting the password
  {
    const { ctx, log } = await context({ configured: true, width: 390 });
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/confirm.html?token_hash=abc123def456&type=invite`, { waitUntil: 'networkidle' });
    check(!page.url().includes('token_hash') && page.url().endsWith('/auth/confirm.html?type=invite'), 'B confirm invite: token_hash gone from the address bar');
    await page.waitForTimeout(400);
    check(!log.sb.some(x => x.key === 'POST /auth/v1/verify'), 'B confirm: nothing is consumed without a click');
    check(await text(page, 'h1') === 'Accept your invitation' && await text(page, 'button[type=submit]') === 'Confirm and continue', 'B confirm invite: wording');
    await axe(page, 'B confirm invite @390');
    // reading the privacy statement, as the page asks, never loses the link: it opens in its own tab
    const [tab] = await Promise.all([ctx.waitForEvent('page'), page.click('#privacy-read a')]);
    await tab.waitForLoadState('load');
    check(new URL(tab.url()).pathname === '/privacy.html' && page.url().endsWith('/auth/confirm.html?type=invite'), 'B confirm invite: the privacy statement opens in a new tab');
    check(await tab.evaluate(() => window.opener === null && document.referrer === ''), 'B confirm invite: the new tab has no opener and no Referer');
    await tab.close();
    check(await visible(page, '#form') && !(await visible(page, '#alert')), 'B confirm invite: the Confirm button is still there after reading it');
    await page.click('button[type=submit]');
    check(await page.locator('#privacy[aria-invalid=true]').count() === 1 && !log.sb.some(x => x.key === 'POST /auth/v1/verify'), 'B confirm invite: the privacy tick is required first');
    await page.check('#privacy');
    const before = studioSeen.length;
    await page.click('button[type=submit]');
    await page.waitForURL(`${base}/auth/update-password.html?invite=1`);
    const v = log.sb.find(x => x.key === 'POST /auth/v1/verify');
    check(v && v.body.token_hash === 'abc123def456' && v.body.type === 'invite', 'B confirm invite: verifyOtp({token_hash, type})');
    const ex = studioSeen.slice(before).filter(s => s.url === '/api/auth/exchange');
    check(ex.length === 1 && ex[0].body.purpose === 'invite' && ex[0].body.privacyNoticeVersion === '2026-10-09', 'B confirm invite: the invite exchange before update-password');
    check(log.requests.filter(r => r.url.includes('token_hash')).every(r => r.url.startsWith(`${base}/auth/confirm.html`)) && log.sb.every(x => !x.referer), 'B confirm: the token never leaves in a URL or a Referer');
    await page.locator('#form').waitFor({ state: 'visible' });
    check(await text(page, 'h1') === 'Choose your password', 'B update-password: the session survived the page change (hygiene kept it)');
    await page.fill('#password', 'short');
    await page.click('button[type=submit]');
    check(await page.locator('#password[aria-invalid=true]').count() === 1 && !log.sb.some(x => x.key === 'PUT /auth/v1/user'), 'B update-password: 12 characters at least, checked first');
    await page.fill('#password', 'my-own-new-password');
    const mark = studioSeen.length;
    await page.click('button[type=submit]');
    await page.locator('#done').waitFor({ state: 'visible' });
    check(await text(page, '#done') === "Password set. You're signed in on this device only.", 'B update-password: Password set');
    const put = log.sb.findIndex(x => x.key === 'PUT /auth/v1/user');
    const ex2 = studioSeen.slice(mark).filter(s => s.url === '/api/auth/exchange');
    check(put >= 0 && log.sb[put].body.password === 'my-own-new-password' && ex2.length === 1 && ex2[0].body.revokeOthers === true, 'B update-password: updateUser, then the exchange with revokeOthers:true');
    await axe(page, 'B update-password done @390');
    check(await page.evaluate(() => document.activeElement.id) === 'done', 'B update-password: the message takes focus (announced)');
    await page.keyboard.press('Tab');
    check(await page.evaluate(() => document.activeElement.id) === 'continue' && await page.getAttribute('#continue', 'href') === '/studio/#/account', 'B update-password: Continue is the next stop and goes to the landing');
    await page.waitForTimeout(3500);
    check(page.url().startsWith(`${base}/auth/update-password.html`), 'B update-password: no timed redirect (WCAG 2.2.1)');
    await page.keyboard.press('Enter');
    await page.waitForURL(`${base}/studio/#/account`, { timeout: 5000 });
    check((await csp(page)).length === 0 && log.console.length === 0, `B confirm invite: zero CSP violations and console errors (${log.console.join(' | ')})`);
    await ctx.close();
  }
  // B6. confirm: recovery has no exchange until the password is set
  {
    const { ctx, log } = await context({ configured: true });
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/confirm.html?token_hash=abc123def456&type=recovery`, { waitUntil: 'networkidle' });
    const before = studioSeen.length;
    await page.click('button[type=submit]');
    await page.waitForURL(`${base}/auth/update-password.html`);
    await page.locator('#form').waitFor({ state: 'visible' });
    check(studioSeen.slice(before).every(s => s.url !== '/api/auth/exchange'), 'B confirm recovery: no exchange before the password is set');
    studioState.exchange.push([401, { error: { code: 'reauth_required', message: 'x' } }]);
    await page.fill('#password', 'my-own-new-password');
    await page.click('button[type=submit]');
    await page.waitForURL(`${base}/auth/login.html?reason=reauth`);
    await page.locator('#notice').waitFor({ state: 'visible' });
    check(await text(page, '#notice') === 'Your new password is saved. Sign in with it to continue.', 'B update-password: 401 reauth_required goes to sign in');
    check((await csp(page)).length === 0, 'B recovery: zero CSP violations');
    await ctx.close();
  }
  // B7. confirm: email goes through the exchange to next; a used link says so
  {
    const { ctx } = await context({ configured: true });
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/confirm.html?token_hash=abc123def456&type=email&next=/studio/%23/account`, { waitUntil: 'networkidle' });
    check(page.url() === `${base}/auth/confirm.html?type=email&next=%2Fstudio%2F%23%2Faccount`, `B confirm email: next kept, token gone (${page.url()})`);
    const before = studioSeen.length;
    await page.click('button[type=submit]');
    await page.waitForURL(`${base}/studio/#/account`);
    check(studioSeen.slice(before).some(s => s.url === '/api/auth/exchange' && Object.keys(s.body).join() === 'accessToken'), 'B confirm email: the plain exchange');
    await ctx.close();
  }
  {
    // the history entry itself never held the token: back to the previous page and forward again
    const { ctx, log } = await context({ configured: true });
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/reset.html`, { waitUntil: 'load' });
    await page.goto(`${base}/auth/confirm.html?token_hash=abc123def456&type=recovery`, { waitUntil: 'load' });
    await page.locator('#form').waitFor({ state: 'visible' });
    await page.goBack({ waitUntil: 'load' });
    await page.goForward({ waitUntil: 'load' });
    check(page.url() === `${base}/auth/confirm.html?type=recovery`, `B confirm: the history entry holds no token (${page.url()})`);
    check(!log.sb.some(x => x.key === 'POST /auth/v1/verify'), 'B confirm: going back and forward consumes nothing');
    await ctx.close();
  }
  {
    const { ctx } = await context({ configured: true, width: 390, gotrue: { 'POST /auth/v1/verify': () => [403, { code: 'otp_expired', error_code: 'otp_expired', msg: 'Token has expired or is invalid' }] } });
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/confirm.html?token_hash=abc123def456&type=email`, { waitUntil: 'networkidle' });
    await page.click('button[type=submit]');
    await page.locator('#alert').waitFor({ state: 'visible' });
    check(await text(page, '#alert') === 'This link has expired or was already used. Ask for a new one.' && await visible(page, '#linkHelpEmail'), 'B confirm: an expired link says so and offers the way on');
    check(!(await visible(page, '#linkHelp')) && !(await visible(page, '#linkHelpInvite')), 'B confirm email: no reset or invitation help for a confirmation link');
    await axe(page, 'B confirm expired @390');
    await ctx.close();
  }
  for (const [type, help] of [['invite', '#linkHelpInvite'], ['recovery', '#linkHelp'], ['email_change', '#linkHelpEmail']]) {
    // a link without its token (for one, a reload): the help matches what the link was for
    const { ctx } = await context({ configured: true });
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/confirm.html?type=${type}`, { waitUntil: 'networkidle' });
    const shown = [];
    for (const id of ['#linkHelp', '#linkHelpInvite', '#linkHelpEmail']) if (await visible(page, id)) shown.push(id);
    check(await text(page, '#alert') === 'This link is incomplete. Open the link from your email again, or ask for a new one.' && shown.join() === help, `B confirm ${type} without a token: ${help} only (${shown.join()})`);
    if (type === 'invite') await axe(page, 'B confirm invite incomplete');
    await ctx.close();
  }
  {
    const { ctx } = await context({ configured: true });
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/update-password.html?invite=1`, { waitUntil: 'networkidle' });
    check(await visible(page, '#linkHelpInvite') && !(await visible(page, '#linkHelp')), 'B update-password invite without a session: invitation help, not a reset link');
    await ctx.close();
  }
  {
    const { ctx } = await context({ configured: true });
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/update-password.html`, { waitUntil: 'networkidle' });
    check(await text(page, '#alert') === 'Your link has expired. Open the link from your email again, or ask for a new one.', 'B update-password without a session: says so');
    await ctx.close();
  }

  /* ================= C. the publishable key, no Turnstile site key yet ================= */
  // C1. sign-in with no widget and no captcha token, then the landing
  {
    const { ctx, log } = await context({ configured: true, turnstile: false });
    const page = await ctx.newPage();
    const resp = await page.goto(`${base}/auth/login.html`, { waitUntil: 'networkidle' });
    check(resp.headers()['content-security-policy'] === CSP_NO_TURNSTILE, 'C login: the /auth CSP without Cloudflare');
    check(await visible(page, '#form') && !(await visible(page, '#notice')), 'C login: the form is shown without Turnstile');
    check(await page.evaluate(() => !window.turnstile && document.getElementById('captcha').childElementCount === 0), 'C login: no widget');
    await axe(page, 'C login');
    await page.fill('#email', 'aroha@example.co.nz'); await page.fill('#password', 'a-good-long-password');
    await page.click('button[type=submit]');
    await page.waitForURL(`${base}/studio/#/account`);
    const signIn = log.sb.find(x => x.key === 'POST /auth/v1/token?password');
    check(!!signIn && !(signIn.body.gotrue_meta_security && signIn.body.gotrue_meta_security.captcha_token), `C login: signInWithPassword sends no captcha token (${JSON.stringify(signIn && signIn.body.gotrue_meta_security)})`);
    check(studioSeen.filter(x => x.url === '/api/auth/exchange').length > 0, 'C login: then the exchange');
    check(!log.requests.some(r => /cloudflare\.com/.test(r.url)), 'C login: nothing from Cloudflare');
    check((await csp(page)).length === 0 && log.console.length === 0, `C login: zero CSP violations and console errors (${log.console.join(' | ')})`);
    await ctx.close();
  }
  // C2. the uniform error, then Resend without a token
  {
    const { ctx, log } = await context({ configured: true, turnstile: false, gotrue: { 'POST /auth/v1/token?password': () => [400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' }] } });
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/login.html`, { waitUntil: 'networkidle' });
    await page.fill('#email', 'aroha@example.co.nz'); await page.fill('#password', 'wrong-password-123');
    await page.click('button[type=submit]');
    await page.locator('#alert').waitFor({ state: 'visible' });
    check(await text(page, '#alert') === "That email and password don't match, or the account isn't confirmed yet.", 'C login: the uniform error');
    await page.click('#resend');
    await page.locator('#notice').waitFor({ state: 'visible' });
    const rs = log.sb.find(x => x.key === 'POST /auth/v1/resend');
    check(rs && rs.body.type === 'signup' && !(rs.body.gotrue_meta_security && rs.body.gotrue_meta_security.captcha_token), 'C login: resend({type:signup}) with no captcha token');
    // (the browser logs the 400 itself as a console error, so only CSP is counted here, as in B)
    check(!log.requests.some(r => /cloudflare\.com/.test(r.url)) && (await csp(page)).length === 0, 'C login error: nothing from Cloudflare, zero CSP violations');
    check(log.console.every(m => /status of 400/.test(m)), `C login error: no console error but the 400 itself (${log.console.join(' | ')})`);
    await ctx.close();
  }
  // C3. reset
  {
    const { ctx, log } = await context({ configured: true, turnstile: false, width: 390 });
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/reset.html`, { waitUntil: 'networkidle' });
    check(await visible(page, '#form') && await page.evaluate(() => document.getElementById('captcha').childElementCount === 0), 'C reset: the form, with no widget');
    await page.fill('#email', 'nobody@example.co.nz');
    await page.keyboard.press('Enter');
    await page.locator('#done').waitFor({ state: 'visible' });
    check(await text(page, '#done') === "If that email has an account, we've sent a link.", 'C reset: always the same answer');
    const rc = log.sb.find(x => x.key === 'POST /auth/v1/recover');
    check(rc && !(rc.body.gotrue_meta_security && rc.body.gotrue_meta_security.captcha_token), 'C reset: resetPasswordForEmail sends no captcha token');
    await axe(page, 'C reset done @390');
    check(!log.requests.some(r => /cloudflare\.com/.test(r.url)) && (await csp(page)).length === 0 && log.console.length === 0, 'C reset: nothing from Cloudflare, zero CSP violations and console errors');
    await ctx.close();
  }
  // C4. sign-up stays closed without Turnstile, even when the studio says it is open
  studioState.publicSignup = true;
  {
    const seen = studioSeen.length;
    const { ctx, log } = await context({ configured: true, turnstile: false, width: 390 });
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/signup.html`, { waitUntil: 'networkidle' });
    await page.locator('#closed').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    check(await visible(page, '#closed') && !(await visible(page, '#form')), 'C signup: Accounts open soon without Turnstile');
    check(!studioSeen.slice(seen).some(x => x.url === '/api/settings/public'), 'C signup: the studio setting is not even asked');
    check(!log.requests.some(r => /\/vendor\/supabase-js|supabase\.co|cloudflare\.com/.test(r.url)), 'C signup: supabase-js, Supabase and Cloudflare are never loaded');
    await axe(page, 'C signup closed @390');
    await ctx.close();
  }
  studioState.publicSignup = false;
} finally {
  await browser.close();
  server.close();
  studio.close();
}
console.log(`\n${passes} checks passed, ${fails.length} failed.`);
process.exit(fails.length ? 1 : 0);
