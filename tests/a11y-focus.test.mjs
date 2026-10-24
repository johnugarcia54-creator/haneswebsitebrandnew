/* Accessibility checks on the page markup: npm test (Node 20+, no extra packages). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pages = readdirSync(root).filter(f => f.endsWith('.html')).sort();

test('every element made focusable with tabindex="0" shows a focus outline (WCAG 2.4.7)', () => {
  let found = 0;
  for (const f of pages) {
    const s = readFileSync(root + f, 'utf8'), css = [...s.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
    for (const [tag] of s.matchAll(/<[a-z]+\b[^>]*\stabindex="0"[^>]*>/g)) {
      found++;
      const classes = ((/\sclass="([^"]*)"/.exec(tag) || [])[1] || '').split(/\s+/).filter(Boolean);
      const shown = classes.some(c => new RegExp(`\\.${c}:focus-visible\\{[^}]*outline:\\s*(?!none)`).test(css));
      assert.ok(shown, `${f}: ${tag.slice(0, 90)} can take keyboard focus but no :focus-visible rule gives it an outline`);
    }
  }
  assert.ok(found >= 1, 'expected the Hanewood highlights gallery to be checked');
});
