/* Keyboard reach for the scroll-scrubbed call-to-action blocks: npm test (Node 20+, no extra packages).
   GSAP's autoAlpha sets visibility:hidden, and the browser's Tab order skips hidden elements, so a block of
   links that is only revealed by scrolling can never be reached with Tab or read by a screen reader.
   These blocks must fade with opacity only, and must scroll to where they are shown when focus enters them. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = f => readFileSync(new URL(f, root), 'utf8');
const scripts = s => [...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

// page, block id, a selector string the page's GSAP code uses to fade that block (or its children)
const blocks = [
  ['hanesteel.html', 'ctaCopy', "'#ctaCopy > :not(h2)'"],
  ['bargainhub.html', 'ctaCopy', "'#ctaCopy'"],
  ['index.html', 'hsB', "'#hsB'"],
];

for (const [page, id, sel] of blocks) {
  test(`${page} #${id}: its links stay reachable with Tab while it is faded`, () => {
    const html = read(page), js = scripts(html);
    const block = html.slice(html.indexOf(`id="${id}"`));
    assert.ok(/<a\s[^>]*href=/.test(block.slice(0, block.indexOf('</section>'))), `#${id} should hold a link`);
    const tweens = js.split('\n').filter(l => l.includes(sel) && /\.(fromTo|to|from|set)\(/.test(l));
    assert.ok(tweens.length, `no GSAP tween found for ${sel}`);
    for (const l of tweens) assert.ok(!/autoAlpha/.test(l), `${page}: ${sel} is faded with autoAlpha (visibility:hidden), so Tab skips its links:\n  ${l.trim()}`);
    assert.match(js, new RegExp(`\\$\\('#${id}'\\)\\.addEventListener\\('focusin'`), `${page}: #${id} should scroll to where it is shown when a link in it gets focus`);
  });
}
