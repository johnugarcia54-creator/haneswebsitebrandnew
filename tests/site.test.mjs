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
  // not shipped (today): nothing is requested, so no failed request is ever logged
  assert.match(SITE_JS, /MILLI_SHIPPED = false/);
  let p = page();
  boot(p);
  assert.equal(p.added.length + p.idles.length + p.listeners.filter(l => l[0] === 'load').length, 0);
  const shipped = SITE_JS.replace('MILLI_SHIPPED = false', 'MILLI_SHIPPED = true');
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
  const run = files => {
    const dir = mkdtempSync(join(tmpdir(), 'site-milli-'));
    try {
      const all = { 'package.json': JSON.stringify({ homepage: 'https://example.test' }), 'sitemap.xml': '<urlset></urlset>', 'robots.txt': 'Sitemap: https://example.test/sitemap.xml\n', 'assets/enquiry.js': '', ...files };
      for (const [f, s] of Object.entries(all)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), s); }
      const r = spawnSync(process.execPath, [root + 'scripts/check.mjs'], { env: { ...process.env, SITE_CHECK_ROOT: dir }, encoding: 'utf8' });
      return { code: r.status, out: r.stdout + r.stderr };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const on = SITE_JS.replace('MILLI_SHIPPED = false', 'MILLI_SHIPPED = true');
  assert.equal(run({ 'assets/site.js': SITE_JS }).code, 0);
  let r = run({ 'assets/site.js': on });
  assert.equal(r.code, 1);
  assert.match(r.out, /MILLI_SHIPPED is true but assets\/guide\/milli\.js does not exist/);
  r = run({ 'assets/site.js': SITE_JS, 'assets/guide/milli.js': '' });
  assert.equal(r.code, 0);
  assert.match(r.out, /warning {2}assets\/guide\/milli\.js exists but assets\/site\.js does not load it yet/);
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
  const seo = read('scripts/seo.mjs');
  assert.doesNotMatch(seo, /AggregateRating|"Review"|ratingValue/);
});
