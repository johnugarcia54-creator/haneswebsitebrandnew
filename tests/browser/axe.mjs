/* =========================================================================================
   axe-core accessibility pass (WCAG 2.2 AA rules), run by hand: CI has no browser.
     node tests/browser/axe.mjs [--rules color-contrast] [--pages a.html,b.html]
   PLAYWRIGHT_MODULE, CHROMIUM_PATH as in tests/browser/bar.mjs.
   AXE_PATH         axe.min.js (default: the 'axe-core' package)
   Every root page at 390 and 1280 px, plus the enquiry dialog open, plus each page form with a
   value typed (so its floating label sits small above the value). Prints every violation with
   its targets.
   Known violations that were already on main before W1b live in tests/browser/axe-baseline.json
   (one "<page @width[ view]> | <rule> | <target>" line each). By default only violations NOT in
   that list fail the run (exit 1), so a regression cannot hide among the old ones:
     --baseline <file>        compare against another list
     --no-baseline            fail on every violation, old or new
     --write-baseline <file>  record what this run finds as the new list (exits 0)
   axe names each node by its shortest unique selector, so a markup change near an old violation
   can rename it and show it as new: check the element, then rewrite the list if it is the same one.
   ========================================================================================= */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDevServer } from '../../scripts/dev.mjs';

const require = createRequire(import.meta.url);
const loadPlaywright = () => {
  for (const m of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node-tools/node_modules/playwright'].filter(Boolean)) {
    try { return require(m); } catch { /* next */ }
  }
  throw new Error('playwright not found: set PLAYWRIGHT_MODULE');
};
const { chromium } = loadPlaywright();
const axeSource = readFileSync(process.env.AXE_PATH || require.resolve('axe-core/axe.min.js'), 'utf8');
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const onlyRules = arg('--rules', null);
const root = fileURLToPath(new URL('../..', import.meta.url));
const pages = arg('--pages', null)?.split(',') || readdirSync(root).filter(f => f.endsWith('.html')).sort();

const server = createDevServer({ env: {}, log: { warn() {}, error() {} } });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let total = 0;
const found = [];
const defaultBaseline = fileURLToPath(new URL('./axe-baseline.json', import.meta.url));
const writeTo = arg('--write-baseline', null);
const baselineFile = process.argv.includes('--no-baseline') || writeTo ? null : arg('--baseline', existsSync(defaultBaseline) ? defaultBaseline : null);
const baseline = new Set(baselineFile ? JSON.parse(readFileSync(baselineFile, 'utf8')).known : []);
const key = (label, rule, target) => `${label} | ${rule} | ${target}`;

const audit = async (page, label, include) => {
  await page.addScriptTag({ content: axeSource });
  const res = await page.evaluate(async ({ only, include }) => {
    const opts = { runOnly: only ? { type: 'rule', values: only.split(',') } : { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] };
    const r = await window.axe.run(include ? { include: [include] } : document, opts);
    return r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target.join(' '), text: `${n.target.join(' ')}  ${(n.any[0] && n.any[0].message) || n.failureSummary.split('\n').slice(1).join(' ')}`.slice(0, 260) })) }));
  }, { only: onlyRules, include });
  let fresh = 0;
  for (const v of res) {
    for (const n of v.nodes) found.push(key(label, v.id, n.target));
    const novel = v.nodes.filter(n => !baseline.has(key(label, v.id, n.target)));
    total += novel.length; fresh += novel.length;
    if (!novel.length) { console.log(`known ${label}: ${v.id} (${v.impact}), ${v.nodes.length} node(s) in the baseline`); continue; }
    console.log(`FAIL ${label}: ${v.id} (${v.impact}), ${novel.length} new node(s)${novel.length < v.nodes.length ? ` (+${v.nodes.length - novel.length} known)` : ''}`);
    for (const n of novel.slice(0, Number(process.env.AXE_MAX_NODES || 8))) console.log(`       ${n.text}`);
  }
  if (!fresh) console.log(`ok   ${label}`);
};

try {
  for (const width of [390, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    for (const p of pages) {
      const page = await ctx.newPage();
      await page.goto(`${base}/${p}`, { waitUntil: 'load' });
      await page.waitForFunction(() => !document.body.classList.contains('is-loading'), null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(600);
      // reveal everything that scroll animations hold back, so axe sees the finished page
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) { scrollTo(0, y); await new Promise(r => setTimeout(r, 30)); } });
      await page.waitForTimeout(800);
      await audit(page, `${p} @${width}`);
      // page forms with a typed value: the floating labels shrink above the value
      const filled = await page.evaluate(() => {
        let n = 0;
        for (const i of document.querySelectorAll('form input:not([type=checkbox]):not([type=hidden]):not([name=website]), form textarea')) { i.value = i.type === 'email' ? 'a@example.com' : 'Sample'; i.dispatchEvent(new Event('input', { bubbles: true })); n++; }
        return n;
      });
      if (filled) await audit(page, `${p} @${width} forms filled`, 'form');
      // the enquiry dialog, on pages that have the script
      const opened = await page.evaluate(() => { if (!window.HanesEnquiry) return false; window.HanesEnquiry.open('Bargainhub kitchens and interiors', 'x', 'hint'); return true; });
      if (opened) { await page.waitForTimeout(700); await audit(page, `${p} @${width} enquiry dialog`, 'dialog.qd'); }
      await page.close();
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (writeTo) {
  const known = [...new Set(found)].sort();
  writeFileSync(writeTo, JSON.stringify({ note: 'Accessibility violations already on main before W1b (tests/browser/axe.mjs compares against this list; fix them, then rewrite it with --write-baseline)', recorded: new Date().toISOString().slice(0, 10), known }, null, 1) + '\n');
  console.log(`\nwrote ${known.length} known violation(s) to ${writeTo}`);
  process.exit(0);
}
const gone = baselineFile ? [...baseline].filter(k => pages.includes(k.split(' @')[0]) && !found.includes(k)).length : 0;
console.log(`\n${total} violating node(s)${baselineFile ? ` not in the baseline (${found.length} in all; ${gone} baseline entr${gone === 1 ? 'y' : 'ies'} not seen this run)` : ''}`);
process.exit(total ? 1 : 0);
