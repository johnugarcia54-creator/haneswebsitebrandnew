/* Tests for contact.html's inline script: npm test (Node 20+, no extra packages).
   Runs the "arrive with a #hash" statement in a vm against a fake document whose querySelector throws on bad selectors, like a browser. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../contact.html', import.meta.url), 'utf8');
const start = html.indexOf('// arriving from another page'), snippet = html.slice(start, html.indexOf('\n\n', start));

// just enough of CSS.escape and the selector parser for '#id' selectors
const esc = s => [...s].map((c, i) => /[\w-]|[^\x00-\x7f]/.test(c) && !(i === 0 && /\d/.test(c)) && !(i === 1 && /\d/.test(c) && s[0] === '-') ? c : /[\d\x00-\x1f]/.test(c) ? `\\${c.charCodeAt(0).toString(16)} ` : `\\${c}`).join('');
const unesc = s => s.replace(/\\([0-9a-f]{1,6}) ?|\\(.)/gi, (m, h, c) => h ? String.fromCodePoint(parseInt(h, 16)) : c);
const run = (hash, ids = []) => {
  const els = new Map(ids.map(id => [id, { id }])), calls = [];
  const querySelector = s => { if (!/^#(-?([A-Za-z_]|[^\x00-\x7f]|\\[0-9a-f]{1,6} ?|\\[^0-9a-f])|--)([\w-]|[^\x00-\x7f]|\\[0-9a-f]{1,6} ?|\\[^0-9a-f])*$/i.test(s)) throw new SyntaxError(`'${s}' is not a valid selector.`); return els.get(unesc(s.slice(1))) || null; };
  const document = { querySelector, getElementById: id => els.get(id) || null };
  const ctx = { document, location: { hash }, CSS: { escape: esc }, $: querySelector, go: id => calls.push(id), setTimeout: f => f() };
  vm.runInNewContext(snippet, ctx);
  return { calls, querySelector };
};

test('contact: a hash that is not a valid selector does not throw', () => {
  assert.doesNotThrow(() => run('#1'));
  assert.doesNotThrow(() => run('#1', ['1']));
  assert.doesNotThrow(() => run('#a['));
  assert.doesNotThrow(() => run('#%E0%A4%A'));
});

test('contact: a hash naming an element on the page scrolls to it', () => {
  assert.deepEqual(run('#enquiry', ['enquiry', 'help']).calls, ['#enquiry']);
  const r = run('#1', ['1']);
  assert.equal(r.calls.length, 1);
  assert.equal(r.querySelector(r.calls[0]).id, '1');
});

test('contact: no scroll for #top, an empty hash or a missing element', () => {
  assert.deepEqual(run('#top', ['top']).calls, []);
  assert.deepEqual(run('', ['enquiry']).calls, []);
  assert.deepEqual(run('#nope', ['enquiry']).calls, []);
});
