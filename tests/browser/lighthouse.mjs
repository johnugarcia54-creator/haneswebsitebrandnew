/* =========================================================================================
   Mobile Lighthouse for the performance budget (ADDENDUM §6.7), run by hand: CI has no browser.
     node tests/browser/lighthouse.mjs [base-url] [--runs 3] [--pages index.html,bargainhub.html]
   Without a base URL it serves this checkout through scripts/dev.mjs on a free loopback port.
   LIGHTHOUSE_BIN   a lighthouse CLI (default: npx --yes lighthouse@13.5.0)
   CHROMIUM_PATH    the browser (default /opt/pw-browsers/chromium-1194/chrome-linux/chrome)
   Prints each run's performance score and the median per page. Budget: within 3 points of
   the baseline (home 92, Bargainhub 78 on the deployed site; measure main the same way here
   for a like-for-like local baseline).
   ========================================================================================= */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDevServer } from '../../scripts/dev.mjs';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : d; };
const runs = Number(opt('--runs', 3));
const pages = opt('--pages', 'index.html,bargainhub.html').split(',');
let base = args[0], server = null;
if (!base) {
  server = createDevServer({ env: {}, log: { warn() {}, error: console.error } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}
const chrome = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const [cmd, ...pre] = (process.env.LIGHTHOUSE_BIN || 'npx --yes lighthouse@13.5.0').split(' ');
const dir = mkdtempSync(join(tmpdir(), 'lh-'));
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

try {
  for (const p of pages) {
    const scores = [];
    for (let i = 0; i < runs; i++) {
      const out = join(dir, `${p}-${i}.json`);
      // spawn, not spawnSync: the in-process dev server must keep answering while lighthouse runs
      const r = await new Promise(res => spawn(cmd, [...pre, `${base}/${p}`, '--only-categories=performance', '--form-factor=mobile',
        '--chrome-flags=--headless=new --no-sandbox', '--output=json', `--output-path=${out}`, '--quiet'],
      { env: { ...process.env, CHROME_PATH: chrome }, stdio: ['ignore', 'ignore', 'inherit'] }).on('exit', res));
      if (r !== 0) { console.log(`FAIL ${p} run ${i + 1}: lighthouse exited ${r}`); continue; }
      const j = JSON.parse(readFileSync(out, 'utf8'));
      const s = Math.round(j.categories.performance.score * 100);
      const a = j.audits;
      console.log(`${p} run ${i + 1}: ${s}  (FCP ${a['first-contentful-paint'].displayValue}, LCP ${a['largest-contentful-paint'].displayValue}, TBT ${a['total-blocking-time'].displayValue}, CLS ${a['cumulative-layout-shift'].displayValue})`);
      scores.push(s);
    }
    if (scores.length) console.log(`${p} median: ${median(scores)} of ${scores.join(', ')}  (lighthouse ${JSON.parse(readFileSync(join(dir, `${p}-0.json`), 'utf8')).lighthouseVersion})`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
  if (server) server.close();
}
