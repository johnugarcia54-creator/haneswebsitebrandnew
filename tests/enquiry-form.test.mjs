/* Tests for the browser side of enquiries (assets/enquiry.js): npm test (Node 20+, no extra packages).
   Runs the script in a small stand-in page, with a stand-in fetch, so nothing is sent. Like a real
   browser, the stand-in page takes focus away from a button the moment it is disabled. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../assets/enquiry.js', import.meta.url), 'utf8');

const classes = () => { const s = new Set(); return { add: (...c) => c.forEach(x => s.add(x)), remove: (...c) => c.forEach(x => s.delete(x)), toggle: (c, on) => on ? s.add(c) : s.delete(c), contains: c => s.has(c) }; };
const attrs = el => {
  const a = {};
  Object.assign(el, { setAttribute: (k, v) => { a[k] = String(v); }, getAttribute: k => k in a ? a[k] : null, removeAttribute: k => { delete a[k]; }, hasAttribute: k => k in a });
  return el;
};

// a page with one form (name, email, a Send enquiry button and a status line), and a fetch the test answers
const page = () => {
  const body = { tagName: 'BODY' };
  const document = { body, activeElement: body, readyState: 'complete', addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  let disabled = false;
  const btn = attrs({ tagName: 'BUTTON', type: 'submit', textContent: 'Send enquiry', innerHTML: 'Send enquiry', classList: classes(),
    focus() { if (!disabled) document.activeElement = btn; } });
  Object.defineProperty(btn, 'disabled', { get: () => disabled, set: v => { disabled = Boolean(v); if (disabled && document.activeElement === btn) document.activeElement = body; } });
  const status = { textContent: '', classList: classes() };
  const form = attrs({ id: 'enqForm', dataset: {}, reset() {},
    elements: { name: { value: 'Ana Tester' }, email: { value: 'ana@example.co.nz' }, website: { value: '' } },
    querySelector: s => s === '[type="submit"]' ? btn : s === 'input[name="website"]' ? {} : null });
  let answer;
  const fetch = () => new Promise(r => { answer = (code, json = {}) => r({ ok: code < 300, status: code, json: async () => json }); });
  const location = { protocol: 'https:', pathname: '/contact.html', search: '', href: '' };
  const window = {};
  vm.runInNewContext(code, { window, document, location, fetch, URLSearchParams, HTMLDialogElement: undefined });
  return { HanesEnquiry: window.HanesEnquiry, document, form, btn, status, location, reply: (c, j) => answer(c, j) };
};
const tick = () => new Promise(r => setTimeout(r, 0));

for (const [what, code] of [['sent', 200], ['rate limited', 429], ['handed to the email app', 503]]) {
  test(`the Send button keeps keyboard focus while sending and once ${what}`, async () => {
    const p = page();
    p.btn.focus();
    assert.equal(p.document.activeElement, p.btn);
    const sending = p.HanesEnquiry.submit(p.form, { status: p.status });
    assert.equal(p.document.activeElement, p.btn, 'focus dropped to the page while sending');
    assert.equal(p.btn.getAttribute('aria-disabled'), 'true');
    assert.equal(p.btn.textContent, 'Sending…');
    assert.equal(await p.HanesEnquiry.submit(p.form, { status: p.status }), false, 'a second press must not send twice');
    p.reply(code); await tick();
    assert.equal(await sending, code === 200);
    assert.equal(p.document.activeElement, p.btn, 'focus dropped to the page after sending');
    assert.equal(p.btn.getAttribute('aria-disabled'), null);
    assert.equal(p.btn.innerHTML, 'Send enquiry');
    assert.ok(p.status.classList.contains('is-on'));
  });
}
