// scripts/check.mjs's app-page and HTML-sink rules, run against a small fixture site
// (SITE_CHECK_ROOT): letter case and sub-folders must not get past them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const check = fileURLToPath(new URL('../scripts/check.mjs', import.meta.url));
const page = body => `<!doctype html><html lang="en-NZ"><head><meta charset="utf-8"><title>Sign in</title><meta name="robots" content="noindex"><script src="app.js"></script></head><body><h1>Sign in</h1>${body}</body></html>`;

function run(files) {
  const dir = mkdtempSync(join(tmpdir(), 'site-check-'));
  try {
    const all = {
      'package.json': JSON.stringify({ homepage: 'https://example.test' }),
      'sitemap.xml': '<urlset></urlset>',
      'robots.txt': 'Sitemap: https://example.test/sitemap.xml\n',
      'assets/enquiry.js': '',
      ...files
    };
    for (const [f, s] of Object.entries(all)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), s); }
    const r = spawnSync(process.execPath, [check], { env: { ...process.env, SITE_CHECK_ROOT: dir }, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('check.mjs: a clean app page passes, at the top level and in a sub-folder', () => {
  const r = run({ 'auth/login.html': page(''), 'auth/app.js': 'el.textContent = x;', 'auth/account/index.html': page(''), 'auth/account/app.js': '' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /and 2 app pages: 0 errors/);
});

test('check.mjs: an upper-case inline <SCRIPT> is caught, also in a sub-folder', () => {
  const r = run({ 'auth/login.html': page('<SCRIPT>alert(1)</SCRIPT>'), 'auth/app.js': '', 'auth/deep/x.html': page('<Script type="module">go()</Script>'), 'auth/deep/app.js': '' });
  assert.equal(r.code, 1);
  assert.match(r.out, /ERROR {4}auth\/login\.html: inline <script>/);
  assert.match(r.out, /ERROR {4}auth\/deep\/x\.html: inline <script>/);
});

test('check.mjs: HTML sinks are caught in sub-folders of auth/ and assets/guide/', () => {
  const r = run({ 'auth/login.html': page(''), 'auth/app.js': '', 'auth/lib/render.js': 'node.innerHTML = s;', 'assets/guide/ui/bubble.mjs': 'document.write(s);' });
  assert.equal(r.code, 1);
  assert.match(r.out, /auth\/lib\/render\.js: innerHTML is not allowed/);
  assert.match(r.out, /assets\/guide\/ui\/bubble\.mjs: document\.write is not allowed/);
});
