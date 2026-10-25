/* Accessibility checks on the page markup: npm test (Node 20+, no extra packages). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pages = readdirSync(root).filter(f => f.endsWith('.html')).sort();
const src = Object.fromEntries(pages.map(f => [f, readFileSync(root + f, 'utf8')]));

test('word-by-word reveals show every word at once when the visitor asks for reduced motion', () => {
  let reveals = 0;
  for (const f of pages) {
    const lines = src[f].split('\n');
    lines.forEach((line, i) => {
      // a scroll-scrubbed fade of the word spans that a statement is split into
      const m = /gsap\.to\('([^']+ \.w)'.*scrub: true/.exec(line);
      if (!m) return;
      reveals++;
      const where = `${f}:${i + 1} ${m[1]}`;
      assert.match(line, /^\s*else gsap\.to\(/, `${where} runs even with prefers-reduced-motion: reduce`);
      assert.ok(lines[i - 1].includes(`if (reduce) gsap.set('${m[1]}', { opacity: 1 });`), `${where} should show its words at full strength under reduced motion`);
    });
  }
  assert.ok(reveals >= 2, `expected the home and Bargainhub statements to be checked, found ${reveals}`);
});
