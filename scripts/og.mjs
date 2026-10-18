/* =========================================================================================
   Sharing images: the 1200 x 630 cards in og/ that scripts/seo.mjs points every page at.
   Each card is a page photo, darkened on the left, with the brand, a headline, one line
   about the range and the Hanes mark. The words live in the OG list below, and
   npm run check refuses any certification claim in them (see WITHDRAWN).

   npm run og                       redraw every card in the list
   npm run og -- hanestone.jpg      redraw one
   Needs Playwright, which the site does not install:
   PLAYWRIGHT=/path/to/playwright/index.mjs CHROMIUM=/path/to/chrome npm run og
   ========================================================================================= */
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export const OG = [
  { file: 'hanesteel.jpg', photo: 'stills/hanesteel/door-2000.webp', eyebrow: 'Hanesteel',
    headline: 'Windows and doors, built for New Zealand.',
    line: 'Aluminium and uPVC for New Zealand homes, supplied from Christchurch.' },
  { file: 'hanestone.jpg', photo: 'stills/range/hanestone-1200.webp', eyebrow: 'Hanestone',
    headline: 'Trusus gypsum board.',
    line: 'Gypsum plasterboard for walls and ceilings. Bulk orders for retailers and merchants.' }
];

// Claims taken off the site in October 2026. No card may make them again.
export const WITHDRAWN = /codemark|branz|mbie|certifi|appraised|substitute for gib|gib®?\s+(?:alternative|equivalent|replacement)/i;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const at = p => pathToFileURL(root + p).href;

const card = c => `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:'Inter Tight';font-weight:700;src:url(${at('fonts/inter-tight-latin-700-normal.woff2')})}
@font-face{font-family:'Inter';font-weight:400;src:url(${at('fonts/inter-latin-400-normal.woff2')})}
@font-face{font-family:'Inter';font-weight:600;src:url(${at('fonts/inter-latin-600-normal.woff2')})}
*{margin:0;box-sizing:border-box}
html,body{width:1200px;height:630px;overflow:hidden;background:#0a0907}
.photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.shade{position:absolute;inset:0;background:
  linear-gradient(90deg,rgba(10,9,7,.9) 0%,rgba(10,9,7,.77) 30%,rgba(10,9,7,.45) 58%,rgba(10,9,7,.1) 85%,rgba(10,9,7,.05) 100%),
  linear-gradient(0deg,rgba(10,9,7,.6) 0%,rgba(10,9,7,0) 32%)}
.copy{position:absolute;left:72px;top:0;bottom:0;width:640px;display:flex;flex-direction:column;justify-content:center}
.eyebrow{font:600 22px/1 Inter;letter-spacing:.005em;color:#e6cf8f;margin-bottom:21px}
h1{font:700 72px/.98 'Inter Tight';letter-spacing:-.035em;color:#f7f3ea;max-width:640px}
p{font:400 23.6px/1.44 Inter;color:rgba(240,238,234,.88);max-width:560px;margin-top:22px}
.mark{position:absolute;left:72px;bottom:44px;display:flex;align-items:center;gap:12px;font:600 20px/1 Inter;color:#f7f3ea}
.mark i{width:34px;height:34px;border-radius:8px;background:#f7f3ea;color:#0a0907;font:700 15px/34px Inter;font-style:normal;text-align:center}
.mark span{font-weight:400;color:#b8b0a0}
</style>
<img class="photo" src="${at(c.photo)}" alt="">
<div class="shade"></div>
<div class="copy"><div class="eyebrow">${esc(c.eyebrow)}</div><h1>${esc(c.headline).replace(/\n/g, '<br>')}</h1><p>${esc(c.line)}</p></div>
<div class="mark"><i>H</i>Hanes <span>Distribution</span></div>`;

async function main(only) {
  const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  const dir = mkdtempSync(join(tmpdir(), 'hanes-og-'));
  try {
    for (const c of OG.filter(c => !only.length || only.includes(c.file))) {
      if (WITHDRAWN.test(`${c.eyebrow} ${c.headline} ${c.line}`)) throw new Error(`${c.file}: withdrawn claim in the card text`);
      const html = join(dir, 'card.html');
      writeFileSync(html, card(c));
      await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const fits = await page.evaluate(() => [...document.querySelectorAll('.copy > *, .mark')].every(e => { const r = e.getBoundingClientRect(); return r.top >= 24 && r.bottom <= 606 && e.scrollWidth <= e.clientWidth; }));
      if (!fits) throw new Error(`${c.file}: the words don't fit the card`);
      await page.screenshot({ path: root + 'og/' + c.file, type: 'jpeg', quality: 86 });
      console.log('og/' + c.file);
    }
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
