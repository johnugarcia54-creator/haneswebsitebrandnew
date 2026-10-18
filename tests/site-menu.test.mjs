/* Tests for the phone menu in assets/site.js: npm test (no browser, no extra packages).
   Runs the script against a small stand-in for the page: the bar, the page around it and the window. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../assets/site.js', import.meta.url), 'utf8');

function el(name) {
  const on = {}, attrs = {};
  return { name, inert: false, on, attrs,
    addEventListener: (t, f) => { (on[t] ||= []).push(f); },
    setAttribute: (k, v) => { attrs[k] = v; },
    focus() { page.focused = this; },
    fire(t, e = {}) { for (const f of on[t] || []) f(e); } };
}
let page;

function load() {
  const classes = new Set(), win = {};
  const btn = el('burger'), link = el('panel link');
  const gb = { ...el('bar'), querySelector: s => (s === '.gb__burger' ? btn : null), querySelectorAll: s => (s === '.gb__panel a' ? [link] : []) };
  const main = el('main'), footer = el('footer'), loader = el('loader');
  loader.inert = true;   // already inert before the menu opens
  page = { btn, link, gb, main, footer, loader, win, focused: null };
  const document = {
    documentElement: { classList: { toggle: (c, v) => (v ? classes.add(c) : classes.delete(c)), contains: c => classes.has(c) } },
    body: { children: [gb, loader, main, footer] },
    getElementById: id => (id === 'gb' ? gb : null) };
  const ctx = { document, innerWidth: 390,
    addEventListener: (t, f) => { (win[t] ||= []).push(f); } };
  page.ctx = ctx;
  page.fireWin = (t, e = {}) => { for (const f of win[t] || []) f(e); };
  page.open = () => classes.has('gb-open');
  vm.runInNewContext(code, ctx);
  return page;
}

test('opening the menu makes the rest of the page inert, but not the bar', () => {
  const p = load();
  p.btn.fire('click');
  assert.equal(p.open(), true);
  assert.equal(p.btn.attrs['aria-expanded'], 'true');
  assert.equal(p.main.inert, true);
  assert.equal(p.footer.inert, true);
  assert.equal(p.gb.inert, false);
});

test('closing the menu restores the page, leaving what was already inert alone', () => {
  const p = load();
  p.btn.fire('click'); p.btn.fire('click');
  assert.equal(p.open(), false);
  assert.equal(p.main.inert, false);
  assert.equal(p.footer.inert, false);
  assert.equal(p.loader.inert, true);
});

test('Escape, choosing a link and widening to desktop each restore the page', () => {
  const p = load();
  p.btn.fire('click');
  p.fireWin('keydown', { key: 'Escape' });
  assert.equal(p.open(), false);
  assert.equal(p.main.inert, false);
  assert.equal(p.focused, p.btn);

  p.btn.fire('click');
  p.link.fire('click');
  assert.equal(p.main.inert, false);

  p.btn.fire('click');
  assert.equal(p.main.inert, true);
  p.ctx.innerWidth = 1280;
  p.fireWin('resize');
  assert.equal(p.open(), false);
  assert.equal(p.main.inert, false);
  assert.equal(p.footer.inert, false);
});
