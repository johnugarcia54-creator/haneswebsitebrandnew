// The marketing opt-in: a visible keyboard focus ring in the quote dialog and 44px targets
// everywhere (WCAG 2.2 AA 2.4.7, 1.4.11; the site's 44px fingertip rule). The rendered
// sizes and focus ring are checked in a browser by tests/browser/optin.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = f => readFileSync(root + f, 'utf8');
const rule = (css, selector) => {
  const at = css.indexOf(selector + '{');
  assert.ok(at >= 0, `no rule for ${selector}`);
  return css.slice(at + selector.length + 1, css.indexOf('}', at));
};

test('the quote dialog opt-in is styled in site.css, with a visible focus ring, not inline', () => {
  const js = read('assets/enquiry.js');
  const dialog = js.slice(js.indexOf('class="qd__form"'), js.indexOf('</form>`'));
  assert.ok(dialog.includes('name="marketingOptIn"'));
  assert.doesNotMatch(dialog, /\sstyle=/, 'no inline style in the dialog markup');
  const css = read('assets/site.css');
  assert.match(rule(css, '.qd input[type=checkbox]:focus-visible'), /outline:2px solid #0071e3/);
  assert.match(rule(css, '.qd input[type=checkbox]:focus'), /box-shadow:none/);
  assert.match(rule(css, '.qd input[type=checkbox]'), /appearance:auto/);
  assert.match(rule(css, '.qd__optin'), /min-height:44px/);
});

test('the page-form opt-in labels are 44px targets, ticked in each page\'s accent', () => {
  for (const f of ['contact', 'hanestone', 'hanewood', 'hanesulation', 'hisense']) {
    const s = read(f + '.html');
    assert.match(rule(s, '.form__optin'), /min-height:44px/, f);
    const accent = rule(s, '.form__optin input').match(/accent-color:([^;]+)/)[1];
    assert.equal(accent, ['hanesulation', 'hisense'].includes(f) ? 'var(--gold)' : 'var(--blue,#0071e3)', f);
  }
});
