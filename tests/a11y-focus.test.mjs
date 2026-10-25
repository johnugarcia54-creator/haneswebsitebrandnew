/* Accessibility checks on the page markup: npm test (Node 20+, no extra packages). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pages = readdirSync(root).filter(f => f.endsWith('.html')).sort();
// every CSS rule as [selector list, declarations]; a rule inside @media is found on its own
const rules = css => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1], m[2]]);
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// an outline that shows: not none, and not a lone zero
const visible = d => /(?:^|;)\s*outline:\s*(?!none\b|0(?:[a-z]+)?\s*(?:;|!|$))/.test(d);

test('every element made focusable with tabindex="0" shows a focus outline (WCAG 2.4.7)', () => {
  let found = 0;
  for (const f of pages) {
    const s = readFileSync(root + f, 'utf8'), css = [...s.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
    for (const [tag] of s.matchAll(/<[a-z]+\b[^>]*\stabindex="0"[^>]*>/g)) {
      found++;
      const classes = ((/\sclass="([^"]*)"/.exec(tag) || [])[1] || '').split(/\s+/).filter(Boolean);
      const shown = classes.some(c => {
        const sel = new RegExp(`\\.${escRe(c)}:focus-visible$`);   // anywhere in a selector list
        return rules(css).some(([list, d]) => list.split(',').some(x => sel.test(x.trim())) && visible(d));
      });
      assert.ok(shown, `${f}: ${tag.slice(0, 90)} can take keyboard focus but no :focus-visible rule gives it an outline`);
    }
  }
  assert.ok(found >= 1, 'expected the Hanewood highlights gallery to be checked');
});
