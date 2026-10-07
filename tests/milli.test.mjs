/* Milli, the guide (ADDENDUM §8.1-8.6, §11.2, §12.2): the static tree in assets/guide/guide-faq.json
   and the widget in assets/guide/ (milli.js, the launcher; milli-panel.js, the panel).
   - every answer rests on a sentence still in its page's visible text (or is the integrator's
     mandated Hanestone line), every figure in an answer is in its quotes, and nothing on the
     ADDENDUM §8.5 "Never say" list (as amended at 9670114, SEO-H0) appears anywhere in the file
   - every chip and follow-up exists, "Talk to a person" is last, every action id maps to a target
   - the widget runs against a DOM stub that throws on innerHTML, outerHTML, insertAdjacentHTML and
     document.write: static mode has no text box and sends nothing; live mode only after
     GET /api/guide says so; history keeps 6 turns; network errors, 5xx, mode:'static' and being
     offline fall back to static mode
   - the launcher stays at 3 KB gzipped or less */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = f => readFileSync(root + f, 'utf8');
const FAQ_SRC = read('assets/guide/guide-faq.json'), FAQ = JSON.parse(FAQ_SRC);
const LAUNCHER = read('assets/guide/milli.js'), PANEL = read('assets/guide/milli-panel.js');
const HANESTONE = 'Trusus gypsum plasterboard for walls and ceilings, in bulk for merchants. Ask us for the product documents.';
const NOTICE_STATIC = 'Milli is an AI guide answering from quick answers on this page right now. Choose a question below, or ask a person.';
const NOTICE_LIVE = "Milli is an AI guide. Your questions go to our AI provider, SpaceXAI (xAI) in the United States, to write a reply. It deletes them after replying and doesn't train on them. We don't keep what you type, only counts. Please don't share personal details here; use the enquiry or booking form instead.";
const FALLBACK = "Milli couldn't reach its AI service, so here are quick answers instead.";

// ---------- the visible text of a page: no head, scripts, styles, SVG, hidden or aria-hidden parts
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: '–', mdash: '—', middot: '·', hellip: '…', times: '×' };
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'cite', 'code', 'data', 'em', 'i', 'kbd', 'mark', 'q', 's', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u']);
const SKIP = new Set(['head', 'script', 'style', 'template', 'noscript', 'svg', 'title']);
const visibleText = html => {
  const out = [], stack = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) { if (!stack.some(s => s.skip)) out.push(m[4]); continue; }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) { const i = stack.map(s => s.tag).lastIndexOf(tag); if (i >= 0) stack.length = i; if (!INLINE.has(tag)) out.push(' '); continue; }
    if (tag === 'br') { out.push(' '); continue; }
    if (!INLINE.has(tag)) out.push(' ');
    if (VOID.has(tag) || /\/\s*$/.test(m[3])) continue;
    const skip = SKIP.has(tag) || /\shidden(\s|=|$)/.test(m[3]) || /\saria-hidden="true"/.test(m[3]);
    stack.push({ tag, skip });
    if (SKIP.has(tag) && tag !== 'svg') { // raw text elements: jump to the end tag
      const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
      re.lastIndex = end < 0 ? html.length : end;
    }
  }
  return out.join('').replace(/&(#x?[0-9a-f]+|\w+);/gi, (x, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? x))
    .replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
};
const norm = s => s.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const nodes = Object.entries(FAQ.nodes);
const said = n => [n.label, n.answer].join('\n');

test('visibleText leaves out what a visitor cannot see', () => {
  const t = visibleText('<head><title>T</title></head><body><p>One <b>two</b></p><div hidden>no</div><span aria-hidden="true">no</span><script>no()</script><svg><text>no</text></svg><p>three&nbsp;&amp; four&rsquo;s</p></body>');
  assert.equal(t, "One two three & four's");
});

test('guide-faq.json: every chip, follow-up and node is well formed, and "Talk to a person" is last', () => {
  assert.match(FAQ.version, /^\d{4}-\d{2}-\d{2}\./);
  for (const k of ['index', 'bargainhub', 'hanesteel', 'hanestone', 'hanewood', 'hanesulation', 'hisense']) {
    const c = FAQ.chips[k];
    assert.ok(Array.isArray(c) && c.length >= 3, k);
    for (const id of c) assert.ok(FAQ.nodes[id], `${k}: chip ${id}`);
    assert.equal(c.at(-1), 'person', `${k}: Talk to a person is last`);
  }
  // §8.2 starter chips, word for word
  const labels = k => FAQ.chips[k].map(id => FAQ.nodes[id].label);
  assert.deepEqual(labels('index'), ['Which brand do I need?', 'Start a kitchen design', 'Track a shipment', 'Talk to a person']);
  assert.deepEqual(labels('bargainhub'), ['How does the design studio work?', "What's free?", 'Packages', 'Book a consultant', 'Talk to a person']);
  for (const b of ['hanesteel', 'hanestone', 'hanewood', 'hanesulation', 'hisense']) assert.deepEqual(labels(b), ['Is this for homeowners or trade?', 'Get pricing', 'Talk to a person']);
  const reach = new Set(Object.values(FAQ.chips).flat());
  for (const [id, n] of nodes) {
    assert.equal(typeof n.label, 'string', id); assert.ok(n.label.length > 0 && n.label.length <= 60, id);
    assert.equal(typeof n.answer, 'string', id);
    assert.ok(n.answer.split(/\s+/).length <= 80, `${id}: at most 80 words (§8.1)`);
    assert.doesNotMatch(said(n), /[<>]|https?:|www\.|\*\*|__|\]\(|`|#/, `${id}: no HTML, URLs or markdown`);
    assert.doesNotMatch(said(n), /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, `${id}: no emoji`);
    for (const x of n.next || []) { assert.ok(FAQ.nodes[x], `${id}: next ${x}`); reach.add(x); }
    assert.ok(Array.isArray(n.sources) !== Boolean(n.mandated), `${id}: either quoted sources or an integrator mandate`);
  }
  for (const [id] of nodes) assert.ok(reach.has(id), `${id} is reachable from a chip`);
});

test('guide-faq.json: every quote is still in its page\'s visible text', () => {
  const cache = {};
  let n = 0;
  for (const [id, node] of nodes) {
    for (const s of node.sources || []) {
      assert.ok(/^[a-z0-9-]+\.html$/.test(s.page) && existsSync(root + s.page), `${id}: page ${s.page}`);
      cache[s.page] ??= visibleText(read(s.page));
      assert.ok(s.quote.length >= 10 && cache[s.page].includes(norm(s.quote)), `${id}: "${s.quote}" is not in the visible text of ${s.page}`);
      n++;
    }
  }
  assert.ok(n >= 30, `${n} quotes`);
});

test('guide-faq.json: every figure, price and email in an answer is in its own quotes', () => {
  for (const [id, n] of nodes) {
    const quotes = (n.sources || []).map(s => norm(s.quote)).join('\n');
    for (const x of n.answer.match(/\$?\d[\d,.]*\w*/g) || []) assert.ok(n.mandated || quotes.includes(x), `${id}: "${x}" is not in its quotes`);
    for (const x of n.answer.match(/\S+@\S+/g) || []) assert.equal(x.replace(/\.$/, ''), 'Enquiry@hanesdistribution.co.nz', id);
    if (/\$/.test(n.answer)) {
      assert.equal(id, 'packages', `${id}: the only money Milli states is the whole-home package price`);
      assert.deepEqual(n.answer.match(/\$\S+( \+ GST)?/g), ['$45k + GST']);
      assert.match(n.answer, /^Whole-home packages start from \$45k \+ GST\./);
    }
  }
  assert.ok(FAQ.nodes.packages.answer.includes('$45k + GST'));
  assert.doesNotMatch(FAQ.nodes.kitchen.answer + FAQ.nodes.studio.answer, /\$|price/i, 'never a kitchen price');
});

test('guide-faq.json: Hanestone is answered in the integrator\'s exact words, and only those', () => {
  const m = nodes.filter(([, n]) => n.mandated);
  assert.deepEqual(m.map(([id]) => id), ['brand-plasterboard']);
  assert.equal(FAQ.nodes['brand-plasterboard'].answer, HANESTONE);
  assert.match(FAQ.nodes['brand-plasterboard'].mandated, /^integrator/);
  assert.deepEqual(FAQ.nodes['brand-plasterboard'].actions, [{ id: 'go_hanestone' }]);
});

// ADDENDUM §8.5 "Never say" (amended at 9670114) and the integrator's SEO-H0 list
const NEVER = [
  /codemark/i, /branz/i, /\bmbie\b/i, /\bnzs\b/i, /as\s*\/\s*nzs/i, /\b(4211|4859(\.1)?|2269(\.1)?|4357(\.1)?|2208|4666|4223)\b/, /\bh3\.2\b/i, /\bh[1-6](\.\d)?\b/i,
  /\br-?values?\b/i, /\br\s?\d+(\.\d+)?\b/i, /\bu[gf]\b/i, /\bu-?values?\b/i, /w\/m²k/i, /\blow-?e\b/i, /\bgib\b/i, /certif/i, /\bstandards?\b/i, /\btest(ed|s|ing)?\b/i,
  /\bcompl(y|ies|iant|iance)\b/i, /\bapproved\b/i, /\bbuilding code\b/i, /soft-?coat/i, /akzo/i, /renolit/i, /\bpremium\b/i, /\binsulated against\b/i,
  /\b4\.9\b/, /\b30 reviews?\b/i, /\breviews?\b/i, /\bratings?\b/i, /\bstars?\b/i, /\bsample\b/i, /HAN-\d/i, /\bexample shipment\b/i,
  /opening hours/i, /\bopen (on|from|until|mon|tue|wed|thu|fri|sat|sun)/i, /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i, /\b(mon|tues?|wed|thur?s?|fri|sat|sun)(day)?\b/i,
  /\+64/, /\b0[2-9][\d\s-]{6,}\d\b/, /\b0800\b/, /\bphone (us|number)\b/i, /\bcall us\b/i,
  /\binstall/i, /\bfitting service\b/i, /\bwarrant/i, /\bguarantee/i, /\bdeposit/i, /\brefund/i, /\blead[- ]times?\b/i, /\b\d+\s*(days?|weeks?|months?)\b/i,
  /\bin stock\b/i, /\bout of stock\b/i, /\bstock levels?\b/i, /\bavailable now\b/i, /\bdiscount/i, /\b\d+\s?%/, /\bper ?cent\b/i, /\bsale\b/i, /\bfree (delivery|shipping|measure)/i,
  /\bmeasure (up|your site|on site)\b/i, /\bfinance\b/i
];
test('guide-faq.json never contains a "Never say" term, anywhere in the file', () => {
  for (const re of NEVER) assert.doesNotMatch(FAQ_SRC, re, `guide-faq.json matches ${re}`);
  // and the widget's own fixed strings neither
  for (const [f, s] of [['milli.js', LAUNCHER], ['milli-panel.js', PANEL]]) {
    const strings = [...s.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)].map(x => x[1] ?? x[2]).filter(x => / /.test(x) && !/[{};]/.test(x)).join('\n');
    for (const re of NEVER.filter(r => !/stars|test|sample/.test(String(r)))) assert.doesNotMatch(strings, re, `${f} matches ${re}`);
  }
});

test('guide-faq.json: enquiry topics are ones the site already uses', () => {
  const known = new Set(['General enquiry']);
  for (const x of read('contact.html').matchAll(/<option>([^<]+)<\/option>/g)) known.add(x[1]);
  for (const p of ['index.html', 'bargainhub.html', 'hanesteel.html']) for (const x of read(p).matchAll(/data-quote="([^"]+)"/g)) known.add(x[1]);
  for (const [k, t] of Object.entries(FAQ.topics)) assert.ok(known.has(t), `${k}: ${t}`);
});

// ---------- a DOM just big enough for the widget, which refuses every HTML-parsing sink
class Node0 { constructor() { this.parentNode = null; } remove() { if (this.parentNode) this.parentNode.removeChild(this); } }
class Text extends Node0 { constructor(s) { super(); this.data = String(s); this.nodeType = 3; } get textContent() { return this.data; } set textContent(v) { this.data = String(v); } }
const forbid = name => { throw new Error(`${name} is not allowed`); };
class El extends Node0 {
  constructor(doc, tag) {
    super();
    Object.assign(this, { ownerDocument: doc, tagName: tag.toUpperCase(), nodeType: 1, childNodes: [], attributes: {}, listeners: {}, hidden: false, disabled: false, inert: false, value: '', scrollTop: 0, scrollHeight: 100 });
    this.style = { props: {}, setProperty: (k, v) => { this.style.props[k] = v; } };
    const el = this;
    this.classList = { add: (...c) => c.forEach(x => this.cls().add(x) && el.syncCls()), remove: (...c) => { c.forEach(x => this.cls().delete(x)); el.syncCls(); },
      toggle: (c, on) => { const s = this.cls(); on = on === undefined ? !s.has(c) : on; if (on) s.add(c); else s.delete(c); el.syncCls(); return on; }, contains: c => this.cls().has(c) };
  }
  cls() { return (this._cls ??= new Set((this.attributes.class || '').split(/\s+/).filter(Boolean))); }
  syncCls() { this.attributes.class = [...this.cls()].join(' '); }
  get innerHTML() { return forbid('innerHTML'); } set innerHTML(v) { forbid('innerHTML'); }
  get outerHTML() { return forbid('outerHTML'); } set outerHTML(v) { forbid('outerHTML'); }
  insertAdjacentHTML() { forbid('insertAdjacentHTML'); }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get id() { return this.attributes.id || ''; }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this._cls = null; if (k === 'hidden') this.hidden = true; }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; if (k === 'hidden') this.hidden = false; }
  hasAttribute(k) { return k in this.attributes; }
  append(...ns) { for (let n of ns) { if (typeof n === 'string') n = new Text(n); if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); } }
  insertBefore(n, ref) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; const i = this.childNodes.indexOf(ref); this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n); return n; }
  removeChild(n) { this.childNodes = this.childNodes.filter(x => x !== n); n.parentNode = null; return n; }
  contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this.childNodes = []; if (String(v)) this.append(new Text(v)); }
  addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); }
  dispatch(t, e = {}) { const ev = { type: t, target: this, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...e }; for (const f of this.listeners[t] || []) f(ev); return ev; }
  click() { this.dispatch('click'); }
  focus() { this.ownerDocument.activeElement = this; }
  all() { return [this, ...this.children.flatMap(c => c.all())]; }
  find(fn) { return this.all().find(fn) || null; }
  findAll(fn) { return this.all().filter(fn); }
}
const flush = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await flush(); };

// fetch scripted per test: GET /api/guide and the POSTs; guide-faq.json is served from disk
const boot = async ({ path = '/index.html', guide = { status: 404 }, posts = [], online = true, width = 1280, session = {} } = {}) => {
  const doc = { activeElement: null };
  Object.assign(doc, {
    createElement: t => new El(doc, t), createElementNS: (ns, t) => new El(doc, t), createTextNode: s => new Text(s),
    write: () => forbid('document.write'), writeln: () => forbid('document.writeln'), currentScript: { src: 'https://site.test/assets/guide/milli.js' }
  });
  doc.documentElement = new El(doc, 'html'); doc.head = new El(doc, 'head'); doc.body = new El(doc, 'body');
  doc.documentElement.append(doc.head, doc.body);
  const page = new El(doc, 'main'); doc.body.append(page);
  const calls = [], dialogs = [], assigned = [];
  const store = { ...session };
  const sessionStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const local = {};
  const w = {
    document: doc, location: { pathname: path, origin: 'https://site.test', assign: u => assigned.push(u) }, navigator: { onLine: online },
    sessionStorage, localStorage: { getItem: k => local[k] ?? null, setItem: (k, v) => { local[k] = String(v); } },
    matchMedia: q => ({ matches: /max-width:760px/.test(q) ? width <= 760 : false, addEventListener() {} }),
    HanesEnquiry: { open: (...a) => dialogs.push(a) }, HanesSite: { BOOKINGS_LIVE: false },
    setTimeout, clearTimeout, URL, Promise, JSON, Date, AbortController, String, Array, Object, Error,
    fetch: async (url, opt = {}) => {
      const u = String(url), method = opt.method || 'GET';
      calls.push({ url: u, method, body: opt.body ? JSON.parse(opt.body) : null });
      if (u.endsWith('/guide-faq.json')) return { status: 200, ok: true, json: async () => JSON.parse(FAQ_SRC) };
      const r = method === 'GET' ? guide : posts.shift();
      if (!r || r.throws) throw new TypeError('network');
      return { status: r.status, ok: r.status < 300, json: async () => { if (r.body === undefined) throw new SyntaxError('not json'); return r.body; } };
    }
  };
  w.window = w; w.globalThis = w;
  const ctx = vm.createContext(w);
  vm.runInContext(LAUNCHER, ctx, { filename: 'milli.js' });
  const M = w.HanesMilli;
  // the launcher would add <link> and <script>; here the panel source runs directly
  vm.runInContext(PANEL, ctx, { filename: 'milli-panel.js' });
  await M.panel.open();
  await settle();
  const panel = doc.body.find(e => e.id === 'milliPanel');
  return { w, doc, M, panel, calls, dialogs, assigned, store, page,
    text: () => panel.textContent,
    textarea: () => panel.find(e => e.tagName === 'TEXTAREA'),
    chips: () => panel.find(e => e.getAttribute('role') === 'group').children,
    log: () => panel.find(e => e.getAttribute('role') === 'log'),
    posts: () => calls.filter(c => c.method === 'POST') };
};

test('the launcher: a real 56 px button, named, bottom-left, and 3 KB gzipped or less', () => {
  const gz = gzipSync(LAUNCHER, { level: 9 }).length;
  assert.ok(gz <= 3072, `milli.js is ${gz} bytes gzipped (budget 3072)`);
  assert.match(LAUNCHER, /createElement|el\('button'/);
  assert.match(LAUNCHER, /'aria-label': 'Ask Milli, our AI guide'/);
  assert.match(LAUNCHER, /\.milli-l\{position:fixed;left:max\(16px,env\(safe-area-inset-left\)\);bottom:max\(16px,env\(safe-area-inset-bottom\)\);z-index:9980;/);
  assert.match(LAUNCHER, /min-width:56px;height:56px/);
  assert.match(LAUNCHER, /html\.gb-open \.milli-l,body\.is-loading \.milli-l/);
  assert.match(LAUNCHER, /prefers-reduced-motion:reduce\)\{\.milli-m \*\{animation:none!important\}/);
  assert.match(LAUNCHER, /'bh_milli_nudged'/);
  assert.match(LAUNCHER, /page === 'bargainhub'/);
  assert.match(LAUNCHER, /20000/);
});

test('no HTML parsing anywhere in assets/guide/ (the check.mjs rule, and the DOM stub refuses it)', () => {
  for (const s of [LAUNCHER, PANEL]) assert.doesNotMatch(s, /\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/);
  assert.doesNotMatch(PANEL, /\beval\(|new Function|setAttribute\('on|\.on(click|error|load) = [^n]/);
});

test('static mode: the §11.2 notice with the privacy link, chips for the page, and no text box', async () => {
  const t = await boot({ path: '/index.html', guide: { status: 404, body: { error: 'not_found' } } });
  assert.equal(t.M.panel.state().mode, 'static');
  assert.equal(t.textarea(), null, 'no text box in static mode');
  assert.equal(t.panel.find(e => e.tagName === 'FORM'), null);
  const notice = t.panel.find(e => e.id === 'milliNotice');
  assert.equal(notice.textContent, NOTICE_STATIC + ' Privacy statement');
  assert.equal(notice.find(e => e.tagName === 'A').getAttribute('href'), '/privacy.html');
  assert.equal(t.panel.getAttribute('role'), 'dialog');
  assert.equal(t.panel.getAttribute('aria-labelledby'), 'milliTitle');
  assert.equal(t.panel.find(e => e.id === 'milliTitle').tagName, 'H2');
  assert.equal(t.panel.find(e => e.id === 'milliTitle').textContent, 'Milli · AI guide');
  assert.equal(t.panel.find(e => e.tagName === 'H1'), null, 'never an h1');
  assert.deepEqual(t.chips().map(c => c.textContent), ['Which brand do I need?', 'Start a kitchen design', 'Track a shipment', 'Talk to a person']);
  assert.equal(t.panel.find(e => e.getAttribute('role') === 'group').getAttribute('aria-label'), 'Suggested questions');
  assert.equal(t.log().getAttribute('aria-live'), 'polite');
  assert.ok(t.panel.find(e => e.getAttribute('role') === 'status'));
  assert.ok(t.panel.find(e => e.getAttribute('role') === 'alert'));
  assert.equal(t.log().textContent, "Milli said: Kia ora, I'm Milli, Hanes's AI guide.");
  assert.equal(t.log().find(e => e.getAttribute('lang') === 'mi').textContent, 'Kia ora');
  assert.equal(t.doc.activeElement, t.chips()[0], 'focus goes to the first choice (there is no input)');
  assert.equal(t.M.btn.getAttribute('aria-expanded'), 'true');
  assert.equal(t.M.btn.getAttribute('aria-controls'), 'milliPanel');
  // tab order: header (nothing to focus) → notice link → chips → log → close, the close button last
  const kids = t.panel.children.map(e => e.getAttribute('class'));
  assert.deepEqual(kids, ['milli-h', 'milli-n', 'milli-c', 'milli-log', 'milli-st', 'milli-st milli-st--err', 'milli-x']);
  // choosing: finished messages with hidden prefixes, actions after their message, focus stays put
  const chip = t.chips()[1];
  chip.focus(); chip.click();
  assert.equal(t.doc.activeElement, chip, 'new messages never move focus');
  const msgs = t.log().children;
  assert.equal(msgs.at(-2).textContent, 'You said: Start a kitchen design');
  assert.equal(msgs.at(-1).childNodes[0].textContent, 'Milli said: ');
  assert.equal(msgs.at(-1).childNodes[1].textContent, FAQ.nodes.kitchen.answer);
  const acts = msgs.at(-1).findAll(e => e.tagName === 'A');
  assert.deepEqual(acts.map(a => [a.textContent, a.getAttribute('href')]), [['Open the design studio', '/studio/'], ['Bargainhub kitchens and interiors', '/bargainhub.html']]);
  // a follow-up question: buttons in the log
  t.chips()[0].click();
  const next = t.log().children.at(-1).findAll(e => e.tagName === 'BUTTON');
  assert.deepEqual(next.map(b => b.textContent), ['Windows and doors', 'Plasterboard', 'Plywood, board and LVL', 'Insulation', 'Kitchens and interiors', 'Home appliances']);
  next[1].click();
  assert.equal(t.log().children.at(-1).childNodes[1].textContent, HANESTONE);
  // nothing was ever posted, so nothing typed could be sent
  assert.equal(t.posts().length, 0);
  assert.equal(await t.M.panel.send('my phone is 021 555 1234'), false);
  assert.equal(t.posts().length, 0, 'send() refuses in static mode');
  assert.deepEqual(t.calls.map(c => c.method + ' ' + c.url).sort(), ['GET /api/guide', 'GET https://site.test/assets/guide/guide-faq.json']);
});

test('static mode: "Talk to a person" shows the email and opens the enquiry dialog; booking uses the dialog while BOOKINGS_LIVE is false', async () => {
  const t = await boot({ path: '/bargainhub.html' });
  assert.deepEqual(t.chips().map(c => c.textContent), ['How does the design studio work?', "What's free?", 'Packages', 'Book a consultant', 'Talk to a person']);
  t.chips().at(-1).click();
  assert.match(t.log().children.at(-1).textContent, /Enquiry@hanesdistribution\.co\.nz/);
  assert.deepEqual(t.dialogs.at(-1).slice(0, 2), ['Bargainhub kitchens and interiors', 'Bargainhub kitchens and interiors']);
  t.chips()[3].click();
  const book = t.log().children.at(-1).find(e => e.tagName === 'BUTTON' && e.textContent === 'Book a consultant');
  book.click();
  assert.deepEqual(t.dialogs.at(-1).slice(0, 2), ['Book a consultant', 'Bargainhub consultant booking']);
  assert.equal(t.dialogs.at(-1)[3], book, 'focus comes back to the action when the dialog closes');
  t.w.HanesSite.BOOKINGS_LIVE = true;
  t.chips()[3].click();
  const link = t.log().children.at(-1).find(e => e.tagName === 'A' && e.textContent === 'Book a consultant');
  assert.equal(link.getAttribute('href'), '/studio/#/book');
  // the packages answer, with its only allowed figure
  t.chips()[2].click();
  assert.match(t.log().children.at(-1).textContent, /Whole-home packages start from \$45k \+ GST\./);
  // without the enquiry script (privacy.html, 404.html) a person is still one step away
  const p = await boot({ path: '/privacy.html' });
  delete p.w.HanesEnquiry;
  p.chips().at(-1).click();
  assert.deepEqual(p.assigned, ['/contact.html#enquiry']);
});

test('every action id in the tree maps to a fixed target, and unknown ids are dropped', async () => {
  const t = await boot();
  const ids = new Set(nodes.flatMap(([, n]) => (n.actions || []).map(a => a.id).concat(n.opens || [])));
  for (const id of ids) {
    const a = t.M.panel.action(id);
    assert.ok(a && a.label && (a.href || a.dialog), id);
    if (a.href) assert.match(a.href, /^(\/[a-z0-9-]*\.html(#[a-z]+)?|\/studio\/(#\/book)?|https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=[\w%+]+)$/, id);
    if (a.href && a.href.endsWith('.html')) assert.ok(existsSync(root + a.href.slice(1)), `${id} → ${a.href}`);
  }
  for (const id of ['go_hanesteel', 'go_hanestone', 'go_hanewood', 'go_hanesulation', 'go_bargainhub', 'go_hisense', 'open_enquiry', 'open_studio', 'open_signup', 'open_login', 'open_booking', 'open_packages', 'open_showroom', 'open_privacy'])
    assert.ok(t.M.panel.action(id), id);
  assert.equal(t.M.panel.action('open_packages').href, '/bargainhub.html#packages');
  assert.match(read('bargainhub.html'), /id="packages"/);
  for (const id of ['go_evil', 'javascript:alert(1)', 'studio_cad', 'https://evil.test', '', null, 'toString', '__proto__', 'constructor']) assert.equal(t.M.panel.action(id), null, String(id));
  assert.match(read('contact.html'), /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=93\+Main\+South\+Road%2C\+Sockburn%2C\+Christchurch"/, 'open_showroom is the contact page\'s map link');
});

const LIVE = { status: 200, body: { ok: true, mode: 'live' } };
test('live mode only when GET /api/guide says so: the live notice, a labelled text box, and a signed history', async () => {
  for (const guide of [{ status: 404 }, { status: 502, body: undefined }, { status: 200, body: { ok: true, mode: 'static' } }, { status: 200, body: { mode: 'live' } }, { throws: true }])
    assert.equal((await boot({ guide })).M.panel.state().mode, 'static', JSON.stringify(guide));
  assert.equal((await boot({ guide: LIVE, online: false })).M.panel.state().mode, 'static', 'offline');
  const t = await boot({
    guide: LIVE, posts: [
      { status: 200, body: { sid: 's1', sig: 'g1' } },
      { status: 200, body: { mode: 'live', reply: '<img src=x onerror=alert(1)> Bargainhub designs kitchens.', actions: ['go_bargainhub', 'open_evil', { id: 'open_studio' }], handoff: 'booking', sig: 'r1', redacted: [] } }
    ]
  });
  assert.equal(t.M.panel.state().mode, 'live');
  const box = t.textarea();
  assert.ok(box);
  assert.equal(t.doc.activeElement, box, 'on open, focus goes to the input');
  assert.equal(t.panel.find(e => e.tagName === 'LABEL').textContent, 'Ask Milli a question');
  assert.equal(t.panel.find(e => e.tagName === 'LABEL').getAttribute('for'), box.getAttribute('id'));
  assert.equal(box.getAttribute('aria-describedby'), 'milliNotice milliCount');
  assert.equal(box.getAttribute('maxlength'), '500');
  assert.equal(t.panel.find(e => e.id === 'milliNotice').textContent, NOTICE_LIVE + ' Privacy statement');
  box.value = 'Do you design kitchens?';
  box.dispatch('input');
  assert.equal(t.panel.find(e => e.id === 'milliCount').textContent, '23 of 500 characters');
  box.dispatch('keydown', { key: 'Enter', shiftKey: true });
  assert.equal(t.posts().length, 0, 'Shift+Enter is a new line');
  box.dispatch('keydown', { key: 'Enter' });
  assert.equal(t.panel.find(e => e.getAttribute('role') === 'status').textContent, 'Milli is writing a reply…');
  await settle();
  const [start, ask] = t.posts();
  assert.deepEqual(start.body, { op: 'start', surface: 'website', page: 'index' });
  assert.equal(ask.url, '/api/guide');
  assert.deepEqual(Object.keys(ask.body).sort(), ['elapsedMs', 'history', 'op', 'page', 'sid', 'sig', 'surface', 'text', 'website']);
  assert.equal(ask.body.text, 'Do you design kitchens?');
  assert.equal(ask.body.website, '');
  assert.equal(ask.body.sid, 's1');
  const last = t.log().children.at(-1);
  assert.equal(last.childNodes[1].textContent, '<img src=x onerror=alert(1)> Bargainhub designs kitchens.', 'server text stays text');
  assert.equal(last.find(e => e.tagName === 'IMG'), null);
  assert.deepEqual(last.findAll(e => e.getAttribute('class') === 'milli-a').map(a => a.textContent), ['Bargainhub kitchens and interiors', 'Open the design studio', 'Book a consultant']);
  assert.equal(t.panel.find(e => e.getAttribute('role') === 'status').textContent, '');
  const saved = JSON.parse(t.store.bh_milli_history);
  assert.deepEqual(saved.turns.at(-1).sig, 'r1');
  assert.equal(saved.sid, 's1');
});

test('live mode falls back to static on 5xx, a network error, mode:"static" and offline; 429 keeps the box with an alert', async () => {
  for (const [name, post, online] of [['5xx', { status: 503, body: { error: 'x' } }, true], ['network', { throws: true }, true],
    ['static answer', { status: 200, body: { mode: 'static', reason: 'cap' } }, true], ['offline', null, false]]) {
    const t = await boot({ guide: LIVE, posts: [{ status: 200, body: { sid: 's', sig: 'g' } }, post] });
    t.w.navigator.onLine = online;
    t.textarea().focus();
    await t.M.panel.send('Hello');
    await settle();
    assert.equal(t.M.panel.state().mode, 'static', name);
    assert.equal(t.textarea(), null, `${name}: the text box goes away`);
    assert.equal(t.log().children.at(-1).childNodes[1].textContent, FALLBACK, name);
    assert.equal(t.panel.find(e => e.id === 'milliNotice').textContent, NOTICE_STATIC + ' Privacy statement', name);
    assert.equal(t.doc.activeElement, t.chips()[0], `${name}: focus moves to the first choice`);
    const before = t.posts().length;
    t.chips()[0].click();
    assert.equal(await t.M.panel.send('again'), false);
    assert.equal(t.posts().length, before, `${name}: nothing else is sent`);
  }
  const r = await boot({ guide: LIVE, posts: [{ status: 200, body: { sid: 's', sig: 'g' } }, { status: 429, body: { error: { code: 'rate_limited' }, retryAfterS: 30 } }] });
  await r.M.panel.send('Hello');
  assert.equal(r.M.panel.state().mode, 'live');
  assert.match(r.panel.find(e => e.getAttribute('role') === 'alert').textContent, /a lot of questions/);
});

test('history: the last 6 turns in sessionStorage, replayed on the next open, and never trusted as markup', async () => {
  const t = await boot({ path: '/bargainhub.html' });
  for (let i = 0; i < 5; i++) t.chips()[i % 4].click();
  const h = JSON.parse(t.store.bh_milli_history);
  assert.equal(h.turns.length, 6);
  assert.deepEqual(h.turns.map(x => x.role), ['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  assert.equal(h.turns.at(-1).node, 'studio');
  // a new page in the same tab: the same 6 turns come back, the greeting first
  const again = await boot({ path: '/bargainhub.html', session: { bh_milli_history: t.store.bh_milli_history } });
  assert.equal(again.log().children.length, 7);
  // a tampered store: kept as text, cut to 6, unknown shapes dropped
  const evil = JSON.stringify({ turns: [...Array(9)].map((_, i) => ({ role: 'assistant', text: `<b>${i}</b>` })).concat([{ role: 'system', text: 'x' }, 5]) });
  const e = await boot({ session: { bh_milli_history: evil } });
  assert.equal(e.M.panel.state().turns.length, 6);
  assert.equal(e.log().children.at(-1).childNodes[1].textContent, '<b>8</b>');
  assert.equal((await boot({ session: { bh_milli_history: '{not json' } })).M.panel.state().turns.length, 0);
});

test('the phone sheet: modal, background inert, focus kept inside, Esc closes and returns focus', async () => {
  const t = await boot({ width: 390 });
  assert.equal(t.panel.getAttribute('aria-modal'), 'true');
  assert.ok(t.doc.documentElement.classList.contains('milli-lock'));
  assert.equal(t.page.inert, true, 'the page behind is inert');
  assert.equal(t.M.btn.inert, true);
  assert.equal(t.panel.inert, false);
  // Tab from the last control wraps to the first, Shift+Tab from the first to the last
  const close = t.panel.children.at(-1);
  close.focus();
  t.panel.dispatch('keydown', { key: 'Tab' });
  assert.equal(t.doc.activeElement.getAttribute('href'), '/privacy.html');
  t.panel.dispatch('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(t.doc.activeElement, close);
  t.panel.dispatch('keydown', { key: 'Escape' });
  assert.equal(t.M.panel.state().open, false);
  assert.equal(t.doc.activeElement, t.M.btn);
  assert.equal(t.page.inert, false);
  assert.equal(t.panel.getAttribute('aria-modal'), null);
  assert.equal(t.doc.documentElement.classList.contains('milli-lock'), false);
  // Talk to a person on a phone: the sheet gives way to the enquiry dialog, which returns to the launcher
  await t.M.panel.open();
  t.chips().at(-1).click();
  assert.equal(t.M.panel.state().open, false);
  assert.equal(t.dialogs.at(-1)[3], t.M.btn);
  // desktop: non-modal, nothing inert
  const dsk = await boot({ width: 1280 });
  assert.equal(dsk.panel.getAttribute('aria-modal'), null);
  assert.equal(dsk.page.inert, false);
  dsk.panel.dispatch('keydown', { key: 'Escape' });
  assert.equal(dsk.doc.activeElement, dsk.M.btn);
});

test('milli.css: the sheet, 44 px targets, 16 px input text, reduced motion and forced colours', () => {
  const css = read('assets/guide/milli.css');
  assert.match(css, /@media \(max-width:760px\)\{[\s\S]*?inset|@media \(max-width:760px\)\{[\s\S]*?top:var\(--milli-top,0\);right:0;bottom:auto;left:0/);
  assert.match(css, /height:100dvh;height:var\(--milli-h,100dvh\)/);
  assert.match(css, /overscroll-behavior:contain/);
  assert.match(css, /font:400 max\(16px,1rem\)/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /\.milli-x\{[^}]*width:44px;height:44px/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\s*\.milli-p,\.milli-p \*\{animation:none!important;transition:none!important;scroll-behavior:auto!important\}/);
  assert.match(css, /@media \(forced-colors:active\)/);
  assert.match(css, /\.milli-p\{position:fixed;left:max\(16px,env\(safe-area-inset-left\)\);[^}]*z-index:9980;[^}]*width:380px;[^}]*height:560px/);
});
