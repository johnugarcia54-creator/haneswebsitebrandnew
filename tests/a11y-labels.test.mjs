/* Accessibility checks on the page markup: npm test (Node 20+, no extra packages). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('each catalogue button is named by its visible caption first, so voice users can say what they see', () => {
  const s = readFileSync(root + 'hisense.html', 'utf8');
  const books = [...s.matchAll(/<button class="bk"[^>]*\saria-label="([^"]*)"[^>]*>[\s\S]*?<span class="bk__cap"><b>([^<]+)<\/b>/g)];
  assert.equal(books.length, 4, 'expected the four Hisense catalogues');
  for (const [, label, caption] of books)
    assert.ok(label.toLowerCase().startsWith(caption.trim().toLowerCase()), `"${label}" should start with the visible caption "${caption}" (WCAG 2.5.3)`);
});
