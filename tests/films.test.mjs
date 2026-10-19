/* Tests for the films that play by themselves: npm test (Node 20+, no extra packages).
   A muted looping film that starts on its own runs for more than 5 seconds next to other content, so
   (WCAG 2.2.2 Pause, Stop, Hide) each one needs a button to pause it, and none may start on its own
   for a visitor who has asked for reduced motion. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pages = readdirSync(root).filter(f => f.endsWith('.html')).sort();
const src = Object.fromEntries(pages.map(f => [f, readFileSync(root + f, 'utf8')]));
const loopingFilms = f => [...src[f].matchAll(/<video\b[^>]*>/g)].map(m => m[0]).filter(v => /\sloop\b/.test(v) && /\smuted\b/.test(v))
  .map(v => (v.match(/\sid="([^"]+)"/) || [])[1]);

test('the home and Hisense pages still have their looping films', () => {
  assert.deepEqual(loopingFilms('index.html'), ['netVideo', 'bVideo']);
  assert.deepEqual(loopingFilms('hisense.html'), ['film']);
});

test('every looping film has a button that pauses it', () => {
  for (const f of pages) for (const id of loopingFilms(f)) {
    const btn = [...src[f].matchAll(/<button\b[^>]*>/g)].map(m => m[0]).find(b => b.includes(`aria-controls="${id}"`));
    assert.ok(btn, `${f}: #${id} loops on its own but has no pause button (a <button aria-controls="${id}">)`);
    assert.match(src[f], new RegExp(`\\$\\('#${id}'\\)|getElementById\\('${id}'\\)|"${id}"|'${id}'`), `${f}: #${id} is never wired up`);
  }
});

test('no film starts on its own under prefers-reduced-motion', () => {
  for (const f of pages) {
    const js = [...src[f].matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
    for (const m of js.matchAll(/new IntersectionObserver\(/g)) {
      const body = js.slice(m.index, m.index + 400);
      if (!/\.play\(/.test(body.slice(0, body.indexOf('observe(') + 1 || undefined))) continue;
      // the observer that starts a film must sit behind the page's reduced-motion check
      const line = js.slice(js.lastIndexOf('\n', m.index) + 1, m.index);
      const fn = js.slice(js.lastIndexOf('=> {', m.index), m.index);
      assert.ok(/!reduce\b/.test(line) || /if \(reduce\) return/.test(fn),
        `${f}: an IntersectionObserver plays a film without checking prefers-reduced-motion`);
    }
  }
});
