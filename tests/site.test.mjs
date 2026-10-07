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
