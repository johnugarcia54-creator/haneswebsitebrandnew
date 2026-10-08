/* The shared site bar, footer and assets/site.js (ADDENDUM §6.1, §6.2, §3.3.4 and §12.2). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = f => readFileSync(root + f, 'utf8');
const pages = readdirSync(root).filter(f => f.endsWith('.html')).sort();

test('every root page is covered (the 10 pages of §6.1 plus privacy.html)', () => {
  for (const p of ['404.html', 'bargainhub.html', 'contact.html', 'hanesteel.html', 'hanestone.html', 'hanesulation.html', 'hanewood.html',
    'hisense.html', 'index.html', 'privacy.html', 'tracking.html']) assert.ok(pages.includes(p), p);
});

for (const p of pages) {
  test(`${p}: Log in in the bar before Get a quote, in the burger panel, and Privacy and Log in in the footer`, () => {
    const s = read(p), abs = p === '404.html';
    const login = abs ? '/auth/login.html' : 'auth/login.html', privacy = abs ? '/privacy.html' : 'privacy.html';
    const bar = s.slice(s.indexOf('<nav class="gb__in"'), s.indexOf('</nav>', s.indexOf('<nav class="gb__in"')));
    assert.match(bar, new RegExp(`</ul>\\s*<a class="gb__login" href="${login}">Log in</a>\\s*<a class="gb__quote"`));
    assert.equal((bar.match(/gb__login/g) || []).length, 1);
    const sm = s.match(/<div class="gb__sm">(.*?)<\/div>/)[1];
    assert.match(sm, new RegExp(`<a class="gb__login" href="${login}">Log in</a>$`));
    const foot = s.slice(s.search(/<footer( class="gf[^"]*")?>/), s.indexOf('</footer>', s.search(/<footer( class="gf[^"]*")?>/)));
    assert.ok(foot.includes(`<a class="gf__login" href="${login}">Log in</a>`), 'footer Log in');
    assert.match(foot, new RegExp(`<a href="${privacy}"( aria-current="page")?>Privacy</a>`), 'footer Privacy');
    assert.equal((s.match(/class="(gb__login|gf__login)"/g) || []).length, 3, 'exactly three Log in links');
    if (abs) for (const x of s.matchAll(/\s(?:href|src)="([^"#][^"]*)"/g)) assert.match(x[1], /^(\/|https?:|mailto:)/, `404.html uses absolute paths: ${x[1]}`);
  });
}

test('the burger takes over below 880 px, in the stylesheet and in the script', () => {
  const css = read('assets/site.css'), js = read('assets/site.js');
  assert.match(css, /@media \(max-width:879px\)\{\s*\.gb__list\{display:none\}\s*\.gb__burger\{display:block\}/);
  assert.equal(/max-width:833px\)\{\s*\.gb__list/.test(css), false);
  assert.match(css, /\.gb__in>\.gb__quote,\.gb__in>\.gb__login\{display:none\}/);
  assert.match(js, /innerWidth > 879/);
  assert.equal(/innerWidth > 833/.test(js), false);
});

/* ---------- assets/site.js in a minimal DOM stub ---------- */
import vm from 'node:vm';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const SITE_JS = read('assets/site.js');

function storage(init = {}, { throws = false } = {}) {
  const m = new Map(Object.entries(init));
  const s = {
    get length() { return m.size; },
    key: i => [...m.keys()][i] ?? null,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    dump: () => Object.fromEntries(m)
  };
  return throws ? null : s;
}
function anchor(attrs, text) {
  const a = { attrs: { ...attrs }, textContent: text,
    getAttribute: k => (k in a.attrs ? a.attrs[k] : null), setAttribute: (k, v) => { a.attrs[k] = String(v); }, removeAttribute: k => { delete a.attrs[k]; } };
  return a;
}
// a page with the three Log in links and the bargainhub data-book links
function page({ store = storage(), storageThrows = false, cookie = '', path = '/bargainhub.html', fetch, readyState = 'complete', idle = true } = {}) {
  const links = [anchor({ class: 'gb__login', href: 'auth/login.html' }, 'Log in'), anchor({ class: 'gb__login', href: 'auth/login.html' }, 'Log in'), anchor({ class: 'gf__login', href: 'auth/login.html' }, 'Log in')];
  const books = [anchor({ href: 'contact.html?topic=Book%20a%20consultant#enquiry', 'data-book': '', 'data-quote': 'Book a consultant', 'data-quote-subject': 'Bargainhub consultant booking', 'data-quote-hint': 'x' }, 'Book a consultant')];
  const calls = [], added = [], listeners = [], idles = [], order = [];
  const document = {
    cookie, readyState,
    get head() { return { append: el => added.push(el) }; },
    documentElement: { classList: { toggle() {}, contains: () => false } },
    getElementById: () => null,
    createElement: tag => ({ tag, remove() {} }),
    querySelectorAll: sel => {
      order.push(sel);
      if (sel === 'a.gb__login, a.gf__login') return links;
      if (sel === 'a[data-book]') return books;
      return [];
    }
  };
  const w = {
    document, location: { pathname: path },
    fetch: fetch || ((url, o = {}) => { calls.push([url, o]); return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: { id: 'u1' }, csrfToken: 'csrf-1' }) }); }),
    addEventListener: (t, f, o) => listeners.push([t, f, o]),
    requestIdleCallback: idle ? (f, o) => idles.push([f, o]) : undefined,
    setTimeout: f => f()
  };
  Object.defineProperty(w, 'localStorage', { get() { if (storageThrows) throw new Error('SecurityError'); return store; } });
  w.window = w; w.globalThis = w;
  return { w, links, books, calls, added, listeners, idles, order, store };
}
function boot(p, source = SITE_JS) {
  const ctx = vm.createContext(p.w);
  vm.runInContext(source, ctx);
  return p.w.HanesSite;
}
const flush = () => new Promise(r => setTimeout(r, 10));
const TOKEN = 'sb-mputtezdhevwwjgwktvi-auth-token';

test('bhAuthHygiene (§3.3.4): the whole table', async () => {
  const cases = [
    // [what, storage, cookie, result, keys left, server calls]
    ['no Supabase token', { bh_remember: '1', other: 'x' }, '', 'none', ['bh_remember', 'other'], 0],
    ['token, kept signed in (bh_remember=1)', { [TOKEN]: 't', bh_remember: '1' }, '', 'kept', [TOKEN, 'bh_remember'], 0],
    ['token, this browser session (bh_live=1)', { [TOKEN]: 't' }, 'a=b; bh_live=1', 'kept', [TOKEN], 0],
    ['token, bh_live first in the cookie string', { [TOKEN]: 't' }, 'bh_live=1; a=b', 'kept', [TOKEN], 0],
    ['token, browser closed and reopened (no marker)', { [TOKEN]: 't', 'sb-otherref1-auth-token': 'u', 'sb-x-auth-token-code-verifier': 'v', keep: 'k' }, '', 'cleared', ['sb-x-auth-token-code-verifier', 'keep'], 2],
    ['token, bh_remember other than 1', { [TOKEN]: 't', bh_remember: 'true' }, '', 'cleared', ['bh_remember'], 2],
    ['token, look-alike cookies do not count', { [TOKEN]: 't' }, 'xbh_live=1; bh_live=10; bh_live=0', 'cleared', [], 2],
    ['not a Supabase token key (upper case, no ref)', { 'sb-ABC-auth-token': 't', 'sb--auth-token': 'u' }, '', 'none', ['sb-ABC-auth-token', 'sb--auth-token'], 0]
  ];
  for (const [what, init, cookie, result, left, n] of cases) {
    const p = page({ store: storage(init), cookie });
    const site = boot(p);
    await flush();
    assert.equal(site.bhAuthHygiene(p.w), result === 'cleared' ? 'none' : result, `${what}: a second run finds nothing more to do`);
    assert.deepEqual(Object.keys(p.store.dump()).sort(), [...left].sort(), `${what}: keys left`);
    assert.equal(p.calls.length, n, `${what}: server calls`);
    if (n) {
      assert.equal(JSON.stringify(p.calls[0]), JSON.stringify(['/api/session', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } }]));
      assert.equal(p.calls[1][0], '/api/auth/logout');
      assert.equal(p.calls[1][1].method, 'POST');
      assert.equal(p.calls[1][1].credentials, 'same-origin');
      assert.equal(p.calls[1][1].headers['X-CSRF-Token'], 'csrf-1');
    }
    // and the result itself, on a fresh copy of the same state
    const q = page({ store: storage(init), cookie });
    const fn = boot(q).bhAuthHygiene;
    assert.equal(fn(page({ store: storage(init), cookie }).w), result, what);
  }
});

test('bhAuthHygiene: logout only when /api/session reports a signed-in user with a CSRF token', async () => {
  for (const s of [{ user: null, csrfToken: null }, { user: { id: 'u' }, csrfToken: null }, { user: { id: 'u' }, csrfToken: '' }, null]) {
    const calls = [];
    const p = page({ store: storage({ [TOKEN]: 't' }), fetch: (u, o) => { calls.push(u); return Promise.resolve({ ok: true, json: () => Promise.resolve(s) }); } });
    boot(p); await flush();
    assert.deepEqual(calls, ['/api/session'], JSON.stringify(s));
  }
  const calls = [];
  const p = page({ store: storage({ [TOKEN]: 't' }), fetch: u => { calls.push(u); return Promise.resolve({ ok: false, status: 502 }); } });
  boot(p); await flush();
  assert.deepEqual(calls, ['/api/session']);
});

test('bhAuthHygiene never throws and never blocks: blocked storage, a throwing or failing fetch', async () => {
  let p = page({ storageThrows: true });
  let site = boot(p);
  assert.equal(site.bhAuthHygiene(p.w), 'unavailable');
  assert.equal(p.links[0].textContent, 'Log in');
  const rejections = [];
  const onRej = e => rejections.push(e);
  process.on('unhandledRejection', onRej);
  try {
    p = page({ store: storage({ [TOKEN]: 't' }), fetch: () => { throw new TypeError('fetch is not available'); } });
    site = boot(p);
    assert.equal(p.store.getItem(TOKEN), null, 'the key is gone even when fetch throws');
    p = page({ store: storage({ [TOKEN]: 't' }), fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
    boot(p);
    p = page({ store: storage({ [TOKEN]: 't' }), fetch: () => Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError('bad json')) }) });
    boot(p);
    // fetch never resolves: the page still finishes booting
    p = page({ store: storage({ [TOKEN]: 't' }), fetch: () => new Promise(() => {}) });
    site = boot(p);
    assert.equal(typeof site.swapLogin, 'function');
    await flush();
  } finally { process.off('unhandledRejection', onRej); }
  assert.deepEqual(rejections, []);
  // a removeItem that throws
  const st = storage({ [TOKEN]: 't' }); st.removeItem = () => { throw new Error('quota'); };
  p = page({ store: st });
  assert.equal(boot(p).bhAuthHygiene(page({ store: st }).w), 'unavailable');
});

test('My account: shown only while a Supabase session is kept, and only after the hygiene ran', async () => {
  // signed in and remembered: every Log in becomes My account, with an absolute link
  let p = page({ store: storage({ [TOKEN]: 't', bh_remember: '1' }) });
  boot(p);
  for (const a of p.links) { assert.equal(a.textContent, 'My account'); assert.equal(a.getAttribute('href'), '/studio/#/account'); }
  // browser closed with the box unticked: the hygiene clears the token first, so it stays Log in
  p = page({ store: storage({ [TOKEN]: 't' }) });
  boot(p);
  for (const a of p.links) { assert.equal(a.textContent, 'Log in'); assert.equal(a.getAttribute('href'), 'auth/login.html'); }
  // signed out
  p = page({ store: storage({}) });
  boot(p);
  assert.equal(p.links[2].textContent, 'Log in');
  // blocked storage: Log in, no error
  p = page({ storageThrows: true });
  boot(p);
  assert.equal(p.links[0].textContent, 'Log in');
  // the swap is the first DOM query, after the hygiene (which only reads storage)
  p = page({ store: storage({ [TOKEN]: 't', bh_remember: '1' }) });
  boot(p);
  assert.equal(p.order[0], 'a.gb__login, a.gf__login');
});

test('BOOKINGS_LIVE is false: Book a consultant keeps opening the enquiry dialog; true sends it to studio/#/book', () => {
  assert.match(SITE_JS, /const BOOKINGS_LIVE = false;/);
  let p = page();
  const site = boot(p);
  assert.equal(site.BOOKINGS_LIVE, false);
  assert.equal(p.books[0].getAttribute('data-quote'), 'Book a consultant');
  assert.match(p.books[0].getAttribute('href'), /^contact\.html/);
  // flipping the one line
  p = page();
  boot(p, SITE_JS.replace('const BOOKINGS_LIVE = false;', 'const BOOKINGS_LIVE = true;'));
  const a = p.books[0];
  assert.equal(a.getAttribute('href'), 'studio/#/book');
  for (const k of ['data-quote', 'data-quote-subject', 'data-quote-hint']) assert.equal(a.getAttribute(k), null, k);
  assert.equal(a.getAttribute('data-book'), '');
});

test('Milli: loaded after load and idle (4 s timeout) only when shipped, never on /auth/ or /studio/', () => {
  // shipped (W3 merged): the committed site.js has it on; switched off, nothing is requested
  assert.match(SITE_JS, /MILLI_SHIPPED = true/);
  const shipped = SITE_JS, off = SITE_JS.replace('MILLI_SHIPPED = true', 'MILLI_SHIPPED = false');
  let p = page();
  boot(p, off);
  assert.equal(p.added.length + p.idles.length + p.listeners.filter(l => l[0] === 'load').length, 0);
  // page still loading: waits for load, then for idle, then adds the script
  p = page({ readyState: 'interactive' });
  boot(p, shipped);
  assert.equal(p.added.length, 0);
  const load = p.listeners.find(l => l[0] === 'load');
  assert.ok(load, 'waits for load');
  load[1]();
  assert.equal(p.added.length, 0, 'not before idle');
  assert.equal(JSON.stringify(p.idles[0][1]), '{"timeout":4000}');
  p.idles[0][0]();
  assert.equal(p.added.length, 1);
  assert.equal(p.added[0].src, '/assets/guide/milli.js');
  assert.equal(typeof p.added[0].onerror, 'function');
  // already loaded, no requestIdleCallback (Safari): a timer instead
  p = page({ idle: false });
  boot(p, shipped);
  assert.equal(p.added.length, 1);
  // only once
  assert.equal(p.w.HanesSite.loadMilli(p.w), false);
  // never on the sign-in pages or in the studio
  for (const path of ['/auth/login.html', '/auth/', '/studio/', '/studio/consultant.html']) {
    p = page({ path });
    boot(p, shipped);
    assert.equal(p.added.length + p.idles.length, 0, path);
  }
});

test('check.mjs keeps MILLI_SHIPPED honest', () => {
  const run = (files, extraEnv = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'site-milli-'));
    try {
      const all = { 'package.json': JSON.stringify({ homepage: 'https://example.test' }), 'sitemap.xml': '<urlset></urlset>', 'robots.txt': 'Sitemap: https://example.test/sitemap.xml\n', 'assets/enquiry.js': '', ...files };
      for (const [f, s] of Object.entries(all)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), s); }
      const r = spawnSync(process.execPath, [root + 'scripts/check.mjs'], { env: { ...process.env, SITE_CHECK_RELEASE: '', SITE_CHECK_ROOT: dir, ...extraEnv }, encoding: 'utf8' });
      return { code: r.status, out: r.stdout + r.stderr };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const on = SITE_JS, OFF = SITE_JS.replace('MILLI_SHIPPED = true', 'MILLI_SHIPPED = false');
  assert.equal(run({ 'assets/site.js': OFF }).code, 0);
  assert.equal(run({ 'assets/site.js': on, 'assets/guide/milli.js': '' }).code, 0);
  let r = run({ 'assets/site.js': on });
  assert.equal(r.code, 1);
  assert.match(r.out, /MILLI_SHIPPED is true but assets\/guide\/milli\.js does not exist/);
  // the guide merged without switching it on: an error, so Milli can never silently stay off
  r = run({ 'assets/site.js': OFF, 'assets/guide/milli.js': '' });
  assert.equal(r.code, 1);
  assert.match(r.out, /ERROR {4}assets\/site\.js: assets\/guide\/milli\.js exists but MILLI_SHIPPED is false/);
  // only an explicit hold makes it a warning
  r = run({ 'assets/site.js': OFF.replace('MILLI_SHIPPED = false;', 'MILLI_SHIPPED = false; // held'), 'assets/guide/milli.js': '' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /warning {2}assets\/guide\/milli\.js exists but is held/);
  assert.equal(run({ 'assets/site.js': on, 'assets/guide/milli.js': '' }).code, 0);
});

// the contract block, with its common indentation removed
export const hygieneBlock = s => {
  const m = s.match(/\n([ \t]*)\/\/ BEGIN bhAuthHygiene\n([\s\S]*?)\n[ \t]*\/\/ END bhAuthHygiene/);
  if (!m) return null;
  return m[2].split('\n').map(l => (l.startsWith(m[1]) ? l.slice(m[1].length) : l)).join('\n');
};

test('bhAuthHygiene is one delimited block of about 25 lines, and every copy in this repo is identical', () => {
  const block = hygieneBlock(SITE_JS);
  assert.ok(block, 'BEGIN/END markers');
  assert.match(block, /^function bhAuthHygiene\(w = globalThis\) \{/);
  const lines = block.split('\n').length;
  assert.ok(lines >= 15 && lines <= 30, `${lines} lines`);
  assert.doesNotMatch(block, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  for (const f of ['auth/auth-lib.js', 'auth/auth.js']) {
    if (!existsSync(root + f)) continue;
    const other = hygieneBlock(read(f));
    if (other !== null || f === 'auth/auth-lib.js') assert.equal(other, block, `${f} carries the same bhAuthHygiene`);
  }
});

test('the marketing pages never load the Supabase SDK, Turnstile or the guide up front', () => {
  for (const p of pages) {
    const s = read(p);
    for (const x of s.matchAll(/<(?:script|link)\b[^>]*\s(?:src|href)="([^"]*)"/gi)) assert.doesNotMatch(x[1], /supabase|challenges\.cloudflare\.com|assets\/guide\//i, `${p}: ${x[1]}`);
    assert.match(s, /<script src="\/?assets\/site\.js" defer><\/script>/, `${p} loads site.js`);
  }
  assert.doesNotMatch(SITE_JS, /supabase\.co|supabase-js|import\(/i);
});

/* ---------- bargainhub.html (§6.2 and the integrator's decision on the sample reviews) ---------- */
test('bargainhub.html: Design your kitchen goes to studio/ in the five places of §6.2', () => {
  const s = read('bargainhub.html');
  const go = 'href="studio/">Design your kitchen';
  const section = (start, end) => s.slice(s.indexOf(start), s.indexOf(end, s.indexOf(start)));
  assert.match(section('<div class="b-intro" id="bIntro">', '</div>\n      <div class="b-label"'), /<div class="b-intro__go"><a class="btn btn--dark" href="studio\/">Design your kitchen/);
  assert.ok(section('<nav class="subnav"', '</nav>').includes('<li><a href="studio/">Design your kitchen</a></li>'), 'subnav');
  assert.match(section('<section class="design"', '</section>'), /<\/ol>\s*<div class="design__btns"><a class="btn btn--dark" href="studio\/">Design your kitchen/);
  assert.match(section('<section class="studio"', '</section>'), /<div class="studio__btns">\s*<a class="btn btn--dark" href="studio\/">Design your kitchen/);
  assert.match(section('<section class="cta" id="quote">', '</section>'), /<div class="cta__btns">\s*<a class="btn btn--white" href="studio\/">Design your kitchen/);
  assert.equal(s.split(go).length - 1, 5);
  // .b-intro lets the scroll through; its button takes the pointer back
  assert.match(s, /\.b-intro\{[^}]*pointer-events:none/);
  assert.match(s, /\.b-intro__go a\{pointer-events:auto\}/);
  // the studio content stays indexed (only /studio/ itself is noindex)
  assert.match(s, /<meta name="robots" content="index, follow/);
});

test('bargainhub.html: every Book a consultant opens the enquiry dialog with that topic and carries data-book', () => {
  const s = read('bargainhub.html');
  const books = [...s.matchAll(/<a\b[^>]*\sdata-book\b[^>]*>([^<]*)/g)];
  assert.equal(books.length, 4);
  const where = ['pkg__cta', 'show__btns', 'studio__btns', 'cta__btns'];
  for (const w of where) assert.ok(new RegExp(`class="${w}"[\\s\\S]{0,600}?data-book data-quote="Book a consultant"`).test(s), w);
  for (const [tag, text] of books) {
    assert.match(tag, /data-quote="Book a consultant"/);
    assert.match(tag, /href="contact\.html\?topic=Bargainhub%20kitchens%20and%20interiors#enquiry"/, 'works without JavaScript');
    assert.match(text.trim(), /^Book a (consultant|showroom visit)$/);
  }
  assert.ok(s.includes('>Book a showroom visit</a>'));
});

test('bargainhub.html: no sample reviews, ratings or review counts; the reviews section says they are coming soon', () => {
  const s = read('bargainhub.html');
  for (const bad of [/Sample reviews/i, /SAMPLE REVIEWS/, /\bREVIEWS\s*=/, /rvAvg|rvStars|rvCount/, /\b4\.9\b/, /\b30 reviews\b/, /AggregateRating|"@type":\s*"Review"/i, /class="(rcard|wall|feat|score|stars)"/])
    assert.doesNotMatch(s, bad);
  assert.match(s, /<section class="reviews" id="reviews"[^>]*>[\s\S]*?Reviews from our first clients <span class="muted">are coming soon\.<\/span>/);
  assert.match(s, /<li><a href="#reviews" data-scroll>Reviews<\/a><\/li>/, 'the subnav still finds the section');
  // only the integrator's line, no other copy (decision 2)
  const rv = s.slice(s.indexOf('<section class="reviews"'), s.indexOf('</section>', s.indexOf('<section class="reviews"')));
  assert.equal(rv.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 'Reviews Reviews from our first clients are coming soon.');
  const seo = read('scripts/seo.mjs');
  assert.doesNotMatch(seo, /AggregateRating|"Review"|ratingValue/);
});

/* ---------- tracking.html's form and the enquiry fallback email ---------- */
test('tracking.html: the form has the §11.2 notice with the privacy link and the unticked news box', () => {
  const s = read('tracking.html');
  const form = s.slice(s.indexOf('<form class="tf" id="trackForm"'), s.indexOf('</form>', s.indexOf('id="trackForm"')));
  assert.ok(form.includes('<label class="form__optin"><input type="checkbox" name="marketingOptIn" value="yes"><span>Send me occasional news and offers.</span></label>'));
  assert.doesNotMatch(form, /marketingOptIn"[^>]*checked/);
  assert.ok(form.includes("We'll use your details to reply and follow up on your enquiry. They're kept in our customer system, which Base44 runs for us in the United States. Our <a href=\"privacy.html\">privacy statement</a> explains how to see or correct them."));
  const css = s.slice(s.indexOf('.form__optin{'), s.indexOf('}', s.indexOf('.form__optin{')));
  assert.match(css, /min-height:44px/);
});

test('enquiry.js: when the website cannot send, the fallback email ends with Reference: <submissionId>', async () => {
  const src = read('assets/enquiry.js');
  const posted = [];
  const status = { textContent: '', classList: { add() {}, remove() {}, toggle() {} } };
  const input = v => ({ value: v });
  const form = {
    elements: { name: input('Aroha Smith'), email: input('aroha@example.com'), website: input(''), marketingOptIn: { checked: false } },
    dataset: {}, setAttribute() {}, removeAttribute() {}, reset() {}, querySelector: () => null
  };
  const w = {
    location: { protocol: 'https:', pathname: '/tracking.html', search: '', href: '' },
    crypto: { randomUUID: () => '0b5c6f1e-7f2d-4b8a-9c1d-2e3f4a5b6c7d' },
    document: { readyState: 'complete', querySelectorAll: () => [], querySelector: () => null, addEventListener() {} },
    fetch: (u, o) => { posted.push(JSON.parse(o.body)); return Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: 'send_failed' }) }); },
    URLSearchParams, Date, JSON, Promise, String, Boolean, encodeURIComponent, setTimeout, Event: class {}
  };
  w.window = w;
  vm.runInContext(src, vm.createContext(w));
  const ok = await w.HanesEnquiry.submit(form, { subject: 'Tracking request: HD123', form: 'hanes track', status, fields: [['Tracking ID or order number', 'HD123']] });
  assert.equal(ok, false);
  assert.equal(posted[0].submissionId, '0b5c6f1e-7f2d-4b8a-9c1d-2e3f4a5b6c7d');
  assert.match(w.location.href, /^mailto:Enquiry@hanesdistribution\.co\.nz\?subject=/);
  const body = decodeURIComponent(w.location.href.split('&body=')[1]);
  assert.equal(body, 'Tracking request: HD123\n\nName: Aroha Smith\nEmail: aroha@example.com\nTracking ID or order number: HD123\n\nReference: 0b5c6f1e-7f2d-4b8a-9c1d-2e3f4a5b6c7d');
});

test('contrast (WCAG 1.4.3): the dialog topic, "(optional)" and the floating form labels use the darker grey', () => {
  const css = read('assets/site.css');
  assert.match(css, /\.qd__eyebrow\{[^}]*color:#6e6e73\}/);
  assert.match(css, /\.qd__f em\{[^}]*color:#6e6e73\}/);
  for (const f of ['contact.html', 'hanestone.html', 'hanewood.html']) assert.match(read(f), /\.fl label\{[^}]*color:var\(--ink-2\)/, f);
  const t = read('tracking.html');
  assert.match(t, /\.tf__field label\{[^}]*color:var\(--ink-2\)/);
  assert.match(t, /\.tf__sm label\{[^}]*color:var\(--ink-2\)/);
});

test('BOOKINGS_LIVE flips only links: hisense.html\'s catalogue buttons (button[data-book]) are left alone', () => {
  assert.match(SITE_JS, /querySelectorAll\('a\[data-book\]'\)/);
  assert.match(read('hisense.html'), /<button[^>]*data-book="tv"/);
});

/* ---------- scripts/smoke.mjs: reads only, and its enquiry posts can never create a lead ---------- */
import http from 'node:http';
import { ENQUIRY_PROBES, smoke, looksSecret, AUTH_PAGES, rewriteBases, PRODUCTION_BASE } from '../scripts/smoke.mjs';
import enquiryHandler from '../api/enquiry.js';
import { validate } from '../api/_lib/enquiry.js';
import { createDevServer } from '../scripts/dev.mjs';

test('smoke.mjs posts only its three ENQUIRY_PROBES, and nothing to the guide, the CRM or the studio', () => {
  const src = read('scripts/smoke.mjs');
  assert.equal((src.match(/method: 'POST'/g) || []).length, 1, 'one POST site');
  assert.match(src, /for \(const p of ENQUIRY_PROBES\) \{\n\s+const r = await get\('\/api\/enquiry', \{ method: 'POST'/);
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /leads\/ingest|base44|api\.x\.ai|grok|xai\.com/i);
  assert.doesNotMatch(code, /'\/api\/guide'[^)]*method/);
  assert.doesNotMatch(src, /method: '(PATCH|DELETE)'/);
  assert.equal(ENQUIRY_PROBES.length, 3);
  // each probe is refused by validation or carries the spam trap, and only the origin probe comes from elsewhere
  for (const p of ENQUIRY_PROBES) {
    const v = validate(p.body);
    assert.ok(v.spam || v.error, `${p.what}: validation refuses it`);
    assert.ok(!v.data, p.what);
  }
});

test('smoke.mjs ENQUIRY_PROBES through the real /api/enquiry with the CRM forward and email set up: nothing leaves', async () => {
  const saved = { ...process.env }, realFetch = globalThis.fetch, outbound = [];
  Object.assign(process.env, { STUDIO_INGEST_URL: 'http://127.0.0.1:9/api/leads/ingest', LEADS_INGEST_SECRET: 'test-only', STUDIO_EDGE_SECRET_PROD: 'test-only', RESEND_API_KEY: 'test-only', RESEND_API_URL: 'http://127.0.0.1:9' });
  globalThis.fetch = async (...a) => { outbound.push(String(a[0])); throw new Error('no network in this test'); };
  try {
    for (const [i, p] of ENQUIRY_PROBES.entries()) {
      const headers = { host: 'site.test', origin: 'https://site.test', 'x-forwarded-for': `203.0.113.${50 + i}`, ...Object.fromEntries(Object.entries(p.headers || {}).map(([k, v]) => [k.toLowerCase(), v])) };
      const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
      await enquiryHandler({ method: 'POST', headers, body: p.body, socket: {} }, res);
      assert.equal(res.statusCode, p.status, `${p.what}: ${res.body}`);
    }
    assert.deepEqual(outbound, [], 'no forward to the studio and no email');
  } finally {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('looksSecret: catches credential-looking answers, passes the health shapes', () => {
  for (const ok of [{ ok: true, state: 'held' }, { ok: true, mode: 'static' }, { ok: false, auth: 'jwks_empty' }]) assert.equal(looksSecret(ok), false, JSON.stringify(ok));
  for (const bad of [{ ok: true, token: 'abc' }, { ok: true, apiKey: 'x' }, { ok: true, note: 'sb_secret_abcdefghijklmnopqrstuv' }, { ok: true, jwt: 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig' }, { nested: { password: 'p' } }])
    assert.equal(looksSecret(bad), true, JSON.stringify(bad));
});

test('smoke.mjs against scripts/dev.mjs with a stub studio behind the rewrite: everything passes but the sign-in pages still to come', async () => {
  const studioSeen = [];
  const studio = http.createServer((req, res) => {
    studioSeen.push(`${req.method} ${req.url} edge=${req.headers['x-studio-edge'] || ''}`);
    res.setHeader('Content-Type', 'application/json');
    const answers = { '/api/health': { ok: true, version: 'x', schema: 1 }, '/api/auth/health': { ok: true, auth: 'ok' }, '/api/crm/health': { ok: true, state: 'held' } };
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><title>studio</title>'); }
    if (answers[req.url]) return res.end(JSON.stringify(answers[req.url]));
    res.statusCode = 404; res.end('{"error":{"code":"not_found"}}');
  });
  await new Promise(r => studio.listen(0, '127.0.0.1', r));
  const site = createDevServer({ env: { STUDIO_EDGE_SECRET_STAGING: 'stub-edge' }, studioUrl: `http://127.0.0.1:${studio.address().port}`, log: { warn() {}, error() {} } });
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  const lines = [];
  try {
    const base = `http://127.0.0.1:${site.address().port}`;
    // this server plays the production address itself
    const failed = await smoke(base, { production: true, productionBase: base, log: l => lines.push(l) });
    const fails = lines.filter(l => l.startsWith('FAIL'));
    const missing = AUTH_PAGES.filter(p => !existsSync(root + p.slice(1)));
    assert.equal(failed, fails.length);
    for (const f of fails) assert.ok(missing.some(p => f.includes(p)), `only a sign-in page not built yet may fail: ${f}`);
    for (const want of ['/studio redirects to /studio/', '/studio/ loads and is noindex', '/api/health answers ok', '/api/auth/health answers ok', '/api/crm/health answers without secrets', '/api/ops/ip-echo is hidden on production', 'posts from other websites are refused (403)', 'the spam trap accepts quietly'])
      assert.ok(lines.some(l => l.startsWith('pass') && l.includes(want)), want);
    assert.ok(lines.includes('skip  /api/guide is not deployed yet'));
    // the studio saw reads only, each with the edge header from dev.mjs
    assert.ok(studioSeen.length >= 5);
    for (const s of studioSeen) assert.match(s, /^GET .* edge=stub-edge$/, s);
  } finally { site.close(); studio.close(); }
});

test('rewriteBases: production checks the studio on the production address; previews on their own', () => {
  const dep = 'https://hanes-the-website-new-abc123-team.vercel.app';
  assert.deepEqual(rewriteBases(dep, { production: true }), { studio: PRODUCTION_BASE, failClosed: dep });
  assert.deepEqual(rewriteBases(PRODUCTION_BASE, { production: true }), { studio: PRODUCTION_BASE, failClosed: null });
  assert.deepEqual(rewriteBases(dep, { production: false }), { studio: dep, failClosed: null });
  assert.equal(PRODUCTION_BASE, 'https://hanes-the-website-new.vercel.app');
});

test('smoke.mjs on a production deployment address: studio and API checks use the production address, the deployment address fails closed', async () => {
  // a stub edge gate: only the production value passes; header-less GET /api/health is answered by the gate itself
  const seen = [];
  const studio = http.createServer((req, res) => {
    const edge = req.headers['x-studio-edge'] || '';
    seen.push(`${req.method} ${req.url} edge=${edge}`);
    res.setHeader('Content-Type', 'application/json');
    if (edge !== 'prod-edge') {
      if (req.url === '/api/health' && !edge) return res.end('{"ok":true}');
      res.statusCode = 403; return res.end('{"error":{"code":"edge_only"}}');
    }
    const answers = { '/api/health': { ok: true }, '/api/auth/health': { ok: true }, '/api/crm/health': { ok: true, state: 'held' } };
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><title>studio</title>'); }
    if (answers[req.url]) return res.end(JSON.stringify(answers[req.url]));
    res.statusCode = 404; res.end('{"error":{"code":"not_found"}}');
  });
  await new Promise(r => studio.listen(0, '127.0.0.1', r));
  const studioUrl = `http://127.0.0.1:${studio.address().port}`, quiet = { warn() {}, error() {} };
  // the production address sends the production value; the deployment address only "not-this-environment" (§2.3)
  const prodSite = createDevServer({ env: { STUDIO_EDGE_SECRET_STAGING: 'prod-edge' }, studioUrl, log: quiet });
  const depSite = createDevServer({ env: { STUDIO_EDGE_SECRET_STAGING: 'not-this-environment' }, studioUrl, log: quiet });
  await Promise.all([prodSite, depSite].map(s => new Promise(r => s.listen(0, '127.0.0.1', r))));
  const prodBase = `http://127.0.0.1:${prodSite.address().port}`, depBase = `http://127.0.0.1:${depSite.address().port}`;
  const lines = [];
  try {
    await smoke(depBase, { production: true, productionBase: prodBase, log: l => lines.push(l) });
    const fails = lines.filter(l => l.startsWith('FAIL'));
    const missing = AUTH_PAGES.filter(p => !existsSync(root + p.slice(1)));
    for (const f of fails) assert.ok(missing.some(p => f.includes(p)), `only a sign-in page not built yet may fail: ${f}`);
    for (const want of ['/studio redirects to /studio/', '/studio/ loads and is noindex', '/api/health answers ok', '/api/auth/health answers ok', '/api/crm/health answers without secrets', '/api/ops/ip-echo is hidden on production'])
      assert.ok(lines.some(l => l.startsWith('pass') && l.includes(want) && l.includes(`via ${prodBase}`)), want);
    for (const p of ['/studio/', '/api/auth/health'])
      assert.ok(lines.some(l => l.startsWith('pass') && l.includes(`${p} on the deployment address fails closed: 403 edge_only`)), p);
    // which base each check used: every studio read with the production value, plus exactly the two fail-closed reads
    const prodReads = seen.filter(s => s.endsWith('edge=prod-edge')).map(s => s.split(' ')[1]).sort();
    assert.deepEqual(prodReads, ['/', '/api/auth/health', '/api/crm/health', '/api/guide', '/api/health', '/api/ops/ip-echo']);
    const depReads = seen.filter(s => !s.endsWith('edge=prod-edge'));
    assert.deepEqual(depReads.sort(), ['GET / edge=not-this-environment', 'GET /api/auth/health edge=not-this-environment']);
    // and the same deployment address, if it wrongly carried the production value, would fail the check
    const bad = [];
    await smoke(prodBase, { production: true, productionBase: prodBase.replace(/:\d+$/, ':' + depSite.address().port), log: l => bad.push(l) });
    assert.ok(bad.some(l => l.startsWith('FAIL') && l.includes('/studio/ on the deployment address fails closed')));
  } finally { prodSite.close(); depSite.close(); studio.close(); }
});

test('check.mjs on the release build (SITE_CHECK_RELEASE=1): a Log in link to a sign-in page not built yet fails', () => {
  const r = spawnSync(process.execPath, [root + 'scripts/check.mjs'], { env: { ...process.env, SITE_CHECK_ROOT: '', SITE_CHECK_RELEASE: '1' }, encoding: 'utf8' });
  if (existsSync(root + 'auth/login.html')) assert.doesNotMatch(r.stdout, /auth\/login\.html: is linked from the pages but not built/);
  else {
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /ERROR {4}auth\/login\.html: is linked from the pages but not built/);
  }
  const dev = spawnSync(process.execPath, [root + 'scripts/check.mjs'], { env: { ...process.env, SITE_CHECK_ROOT: '', SITE_CHECK_RELEASE: '' }, encoding: 'utf8' });
  assert.doesNotMatch(dev.stdout, /is linked from the pages but not built/);
});

test('404.html has no inline style or script, so it renders the same under the /auth CSP (style-src \'self\')', () => {
  const s = read('404.html');
  assert.doesNotMatch(s, /<style\b/i);
  assert.doesNotMatch(s, /\sstyle="/i);
  assert.doesNotMatch(s, /<script\b(?![^>]*\ssrc=)[^>]*>(?!<\/script>)/i);
  assert.match(s, /<link rel="stylesheet" href="\/assets\/404\.css">/);
  assert.ok(existsSync(root + 'assets/404.css'));
});

test('smoke: an undeployed staging studio is a stated skip on previews, never on production', async () => {
  const { studioNotDeployed } = await import('../scripts/smoke.mjs');
  const res = (status, err) => new Response('', { status, headers: err ? { 'x-vercel-error': err } : {} });
  assert.equal(studioNotDeployed(res(502, 'ROUTER_EXTERNAL_TARGET_CONNECTION_ERROR'), false), true);
  assert.equal(studioNotDeployed(res(502, 'DNS_HOSTNAME_NOT_FOUND'), false), true);
  // production always fails; so do a studio that answers itself, or a 502 without Vercel's code
  assert.equal(studioNotDeployed(res(502, 'ROUTER_EXTERNAL_TARGET_CONNECTION_ERROR'), true), false);
  assert.equal(studioNotDeployed(res(502), false), false);
  assert.equal(studioNotDeployed(res(500, 'ROUTER_EXTERNAL_TARGET_ERROR'), false), false);
  assert.equal(studioNotDeployed(res(403), false), false);
});

test('smoke: a refusal names only the studio error code, never other body text', async () => {
  const { refusalCode } = await import('../scripts/smoke.mjs');
  assert.equal(refusalCode({ status: 403 }, { error: { code: 'edge_only' } }), ', edge_only');
  assert.equal(refusalCode({ status: 200 }, { error: { code: 'edge_only' } }), '');
  assert.equal(refusalCode({ status: 403 }, { error: { code: 'Bearer abc.def' } }), '');
  assert.equal(refusalCode({ status: 403 }, null), '');
});

// what a visitor or a screen reader meets: the text outside <style>, <script> and comments, plus every aria-label and alt
const userFacing = html => {
  const attrs = [...html.matchAll(/\s(?:aria-label|alt)="([^"]*)"/g)].map(m => m[1]);
  const text = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return [text, ...attrs].join(' ');
};

test('trust (SEO-H0): hanesteel.html claims no certification in its text, aria-labels or alt text', () => {
  const s = read('hanesteel.html');
  assert.deepEqual(userFacing(s).match(/[^.\n]*\bcertified\b[^.\n]*/gi) || [], []);
  assert.match(s, /<a href="#certified" data-scroll>Standards<\/a>/);
  assert.match(s, /<div class="eyebrow" data-reveal>Standards<\/div>\s*<h2 class="h" style="margin-top:12px">Built for New Zealand homes\.<\/h2>/);
  assert.match(s, /<section class="cert" id="certified">/, 'the anchor stays, so old links still land');
});

test('trust (SEO-H0): hanesulation.html claims no certification in its text, aria-labels or alt text', () => {
  const s = read('hanesulation.html');
  assert.deepEqual(userFacing(s).match(/[^.\n]*\bcertified\b[^.\n]*/gi) || [], []);
  assert.match(s, /<a href="#certified" data-scroll>Standards<\/a>/);
  assert.match(s, /<div class="eyebrow" data-reveal>Standards<\/div>\s*<h2 class="h" style="margin-top:12px">Ready to sell\.<\/h2>/);
  assert.match(s, /<section class="cert" id="certified">/, 'the anchor stays, so old links still land');
});

// enquiry.js in a sandbox: every post is recorded and answered by `answer` (a 502 by default)
function enquirySandbox({ answer = () => ({ ok: false, status: 502 }) } = {}) {
  const posted = [];
  let n = 0;
  const el = (extra = {}) => ({ textContent: '', innerHTML: '', placeholder: '', classList: { add() {}, remove() {}, toggle() {} }, listeners: {},
    addEventListener(t, f) { this.listeners[t] = f; }, setAttribute() {}, removeAttribute() {}, focus() {}, scrollIntoView() {}, ...extra });
  const input = v => ({ value: v, focus() {} });
  const form = (values = {}) => el({
    elements: { name: input('Aroha Smith'), email: input('aroha@example.com'), website: input(''), marketingOptIn: { checked: false },
      phone: input(''), business: input(''), region: input(''), message: input(''), ...values },
    dataset: {}, reset() {}, reportValidity: () => true, querySelector: s => (s === 'input[name="website"]' ? {} : null)
  });
  const dlgForm = form();
  const parts = { form: dlgForm, '.qd__x': el(), '.qd__send': el(), '#qdTopic': el(), '#qdStatus': el() };
  const dlg = el({ querySelector: s => parts[s] || null, showModal() {}, close() {} });
  const w = {
    location: { protocol: 'https:', pathname: '/contact.html', search: '', href: '' },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` },
    document: { readyState: 'complete', querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
      createElement: () => dlg, body: { append() {} }, documentElement: { classList: { add() {}, remove() {} } }, activeElement: null },
    fetch: (u, o) => { const b = JSON.parse(o.body); posted.push(b); const a = answer(b); return Promise.resolve({ ...a, json: () => Promise.resolve({}) }); },
    URLSearchParams, Date, JSON, Promise, String, Boolean, encodeURIComponent, setTimeout, Event: class {}
  };
  w.window = w;
  vm.runInContext(read('assets/enquiry.js'), vm.createContext(w));
  const send = () => dlgForm.listeners.submit({ preventDefault() {} });
  return { w, posted, form, dlgForm, send };
}

test('enquiry.js: a retry of the same fill keeps its submissionId; an edited retry gets a new one', async () => {
  const s = enquirySandbox();
  const f = s.form();
  const go = (fields, o = {}) => s.w.HanesEnquiry.submit(f, { subject: 'Website enquiry', form: 'contact page', fields, ...o });
  await go([['Message', 'Two windows']]);
  await go([['Message', 'Two windows']]);
  assert.equal(s.posted[1].submissionId, s.posted[0].submissionId, 'an unchanged retry is the same enquiry');
  await go([['Message', 'Three windows']]);
  assert.notEqual(s.posted[2].submissionId, s.posted[1].submissionId, 'edited fields: a new enquiry');
  f.elements.email.value = 'aroha@example.org';
  await go([['Message', 'Three windows']]);
  assert.notEqual(s.posted[3].submissionId, s.posted[2].submissionId, 'an edited email: a new enquiry');
  await go([['Message', 'Three windows']], { marketingOptIn: true });
  assert.notEqual(s.posted[4].submissionId, s.posted[3].submissionId, 'a changed news choice: a new enquiry');
  await go([['Message', 'Three windows']], { marketingOptIn: true, subject: 'Hanesteel quote' });
  assert.notEqual(s.posted[5].submissionId, s.posted[4].submissionId, 'a changed subject: a new enquiry');
  await go([['Message', 'Three windows']], { marketingOptIn: true, subject: 'Hanesteel quote' });
  assert.equal(s.posted[6].submissionId, s.posted[5].submissionId);
});

test('enquiry.js quote dialog: a new topic is a new enquiry, never the id of an earlier failed one', async () => {
  const s = enquirySandbox();
  const { open } = s.w.HanesEnquiry;
  s.dlgForm.elements.message.value = 'Kitchen for a new build';
  open('Bargainhub kitchen'); await s.send();
  open('Bargainhub kitchen'); await s.send();
  assert.equal(s.posted[1].submissionId, s.posted[0].submissionId, 'the same topic, unchanged: a retry');
  open('Hanesteel windows'); await s.send();
  assert.notEqual(s.posted[2].submissionId, s.posted[1].submissionId, 'another topic: a new enquiry');
  open('Bargainhub kitchen'); open('Hanesteel windows'); await s.send();
  assert.notEqual(s.posted[3].submissionId, s.posted[2].submissionId, 'opened on another topic in between: the fill starts again');
  assert.equal(new Set(s.posted.map(p => p.submissionId)).size, 3);
});

test('owner rule: no shipped file, script or README names an AI model', () => {
  const walk = d => readdirSync(root + d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
  const files = [...pages, 'README.md', ...['scripts', 'api', 'assets', 'auth'].flatMap(walk).filter(f => /\.(m?js|html|css|json)$/.test(f))];
  assert.ok(files.includes('scripts/smoke.mjs') && files.includes('auth/auth-lib.js'));
  for (const f of files) assert.deepEqual(read(f).match(/[^\n]*\b(grok|claude|opus|sonnet|gpt|gemini|openai)\b[^\n]*/gi) || [], [], f);
});
