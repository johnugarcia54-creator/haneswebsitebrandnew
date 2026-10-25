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

// page, block id, a selector string the page's GSAP code uses to fade that block (or its children),
// and the selector whose pointer events are off while it is faded, with what that set must say
const blocks = [
  ['hanesteel.html', 'ctaCopy', "'#ctaCopy > :not(h2)'", "'#ctaCopy > :not(h2)'", "pointerEvents: 'none'"],
  ['bargainhub.html', 'ctaCopy', "'#ctaCopy'", "'#ctaCopy'", "pointerEvents: 'none'"],
  // a set at time 0 of a scrubbed timeline only renders once the playhead moves, unless immediateRender is on
  ['index.html', 'hsB', "'#hsB'", "'#hsB .btn'", "pointerEvents: 'none', immediateRender: true"],
];

for (const [page, id, sel, ptrSel, ptrOff] of blocks) {
  test(`${page} #${id}: its links stay reachable with Tab while it is faded`, () => {
    const html = read(page), js = scripts(html);
    const block = html.slice(html.indexOf(`id="${id}"`));
    assert.ok(/<a\s[^>]*href=/.test(block.slice(0, block.indexOf('</section>'))), `#${id} should hold a link`);
    const tweens = js.split('\n').filter(l => l.includes(sel) && /\.(fromTo|to|from|set)\(/.test(l));
    assert.ok(tweens.length, `no GSAP tween found for ${sel}`);
    for (const l of tweens) assert.ok(!/autoAlpha/.test(l), `${page}: ${sel} is faded with autoAlpha (visibility:hidden), so Tab skips its links:\n  ${l.trim()}`);
    assert.match(js, new RegExp(`\\$\\('#${id}'\\)\\.addEventListener\\('focusin'`), `${page}: #${id} should scroll to where it is shown when a link in it gets focus`);
    // only keyboard focus scrolls: a mouse press on a link also fires focusin, and the jump would lose the click
    const handler = js.slice(js.indexOf(`$('#${id}').addEventListener('focusin'`)).split('\n').slice(0, 4).join('\n');
    assert.ok(handler.includes(':focus-visible'), `${page}: #${id}'s focusin handler should only act on :focus-visible (keyboard) focus:\n${handler}`);
    // an invisible link must not take clicks
    const ptr = js.split('\n').filter(l => l.includes(ptrSel) && /\.(fromTo|set)\(/.test(l));
    assert.ok(ptr.some(l => l.includes(ptrOff)), `${page}: ${ptrSel} should start with ${ptrOff} while it is faded:\n  ${ptr.map(l => l.trim()).join('\n  ')}`);
  });
}
