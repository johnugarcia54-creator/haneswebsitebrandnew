/* The 404 page's "Page not found" eyebrow must be readable: it reaches WCAG AA (4.5:1) on the white page.
   Reads the colour straight from the page's stylesheet, assets/404.css, resolving var(--…) from its own :root tokens. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lum = hex => { const c = hex.replace('#', '').match(/../g).map(h => parseInt(h, 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('assets/404.css: the eyebrow reaches 4.5:1 on white', () => {
  const css = readFileSync(new URL('../assets/404.css', import.meta.url), 'utf8');
  const tokens = Object.fromEntries([...css.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]));
  const rule = css.match(/(?:^|\n)\.nf__eyebrow\{([^}]*)\}/);
  assert.ok(rule, 'assets/404.css: rule .nf__eyebrow not found');
  let color = rule[1].match(/(?:^|;)color:([^;]+)/)[1].trim();
  const v = color.match(/^var\((--[\w-]+)\)$/); if (v) color = tokens[v[1]];
  assert.match(color, /^#[0-9a-fA-F]{6}$/, 'assets/404.css .nf__eyebrow: unresolved colour');
  const r = ratio(color, '#ffffff');
  assert.ok(r >= 4.5, `assets/404.css .nf__eyebrow: ${color} on #ffffff is ${r.toFixed(2)}:1, below 4.5:1`);
});
