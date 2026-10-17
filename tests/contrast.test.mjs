/* Form labels must be readable: every floating enquiry and tracking label reaches WCAG AA (4.5:1) on its white field.
   Reads the colour straight from each page's CSS, resolving var(--…) from the page's own :root tokens. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGES = { 'contact.html': ['.fl label'], 'hanestone.html': ['.fl label'], 'hanewood.html': ['.fl label'], 'tracking.html': ['.tf__field label', '.tf__sm label'] };
const lum = hex => { const c = hex.replace('#', '').match(/../g).map(h => parseInt(h, 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const [page, selectors] of Object.entries(PAGES)) {
  test(`${page}: form labels reach 4.5:1 on white`, () => {
    const html = readFileSync(new URL('../' + page, import.meta.url), 'utf8');
    const tokens = Object.fromEntries([...html.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]));
    for (const sel of selectors) {
      const rule = html.match(new RegExp('(?:^|\\n)' + esc(sel) + '\\{([^}]*)\\}'));
      assert.ok(rule, `${page}: rule ${sel} not found`);
      let color = rule[1].match(/(?:^|;)color:([^;]+)/)[1].trim();
      const v = color.match(/^var\((--[\w-]+)\)$/); if (v) color = tokens[v[1]];
      assert.match(color, /^#[0-9a-fA-F]{6}$/, `${page} ${sel}: unresolved colour`);
      const r = ratio(color, '#ffffff');
      assert.ok(r >= 4.5, `${page} ${sel}: ${color} on #ffffff is ${r.toFixed(2)}:1, below 4.5:1`);
    }
  });
}
