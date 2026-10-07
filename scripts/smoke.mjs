/* =========================================================================================
   Smoke test for a deployed site: node scripts/smoke.mjs https://your-deployment.vercel.app
   Runs in GitHub Actions after every Vercel deployment (.github/workflows/smoke.yml).
   Checks every page, the privacy statement, the sign-in pages (200, their strict CSP, noindex),
   the sitemap, robots.txt, sharing images, short URLs, security headers, the 404 page, the
   studio and its API through the rewrite (/studio, /studio/, /api/health, /api/auth/health,
   /api/crm/health, /api/guide once it exists, /api/ops/ip-echo hidden on production), and that
   the enquiry API answers and rejects bad requests.
   It only reads, apart from three enquiry posts that the API must refuse before anything is
   sent or forwarded (ENQUIRY_PROBES): it never sends an email, never creates a CRM lead or a
   Base44 row, and never asks the guide a question (no Grok tokens are spent).
   --local         skip what only Vercel and the studio provide (redirects, headers, rewrites)
   --production    also require what only production promises (DEPLOY_ENV=Production does the same)

   A production deployment's own address (hanes-the-website-new-<hash>-<team>.vercel.app, the
   URL Vercel reports) matches no production rule in vercel.json, so its /studio/ and /api/*
   go to STAGING Fly with x-studio-edge: not-this-environment and are refused there (ADDENDUM
   §2.3). For such a deployment the studio and API checks therefore run against the production
   address (PRODUCTION_HOST), which is the one that reaches production Fly, and the deployment
   address itself must fail closed: /studio/ and /api/auth/health answer 403 edge_only.
   ========================================================================================= */
import { pathToFileURL } from 'node:url';

export const PAGES = ['/', '/hanesteel.html', '/hanestone.html', '/hanewood.html', '/hanesulation.html', '/bargainhub.html', '/hisense.html', '/tracking.html', '/contact.html'];
export const AUTH_PAGES = ['/auth/login.html', '/auth/signup.html', '/auth/reset.html', '/auth/confirm.html', '/auth/update-password.html'];
export const SUPABASE_ORIGIN = 'https://mputtezdhevwwjgwktvi.supabase.co';
export const PRODUCTION_HOST = 'hanes-the-website-new.vercel.app';
export const PRODUCTION_BASE = `https://${PRODUCTION_HOST}`;

/* Where the studio and API checks run. On production they must go through the production
   address; any other address of a production build only reaches staging and must be refused. */
export function rewriteBases(base, { production = false, productionBase } = {}) {
  const prod = (productionBase || (new URL(base).host === PRODUCTION_HOST ? base : PRODUCTION_BASE)).replace(/\/+$/, '');
  if (!production || prod === base) return { studio: base, failClosed: null };
  return { studio: prod, failClosed: base };
}

/* The only posts the smoke test makes. Each is refused by /api/enquiry before the CRM forward
   and before any email (api/enquiry.js: origin, then validation and the spam trap), and each
   has a second reason to be refused, so one check that regresses still forwards nothing.
   tests/site.test.mjs runs them through the real handler with a forward set up and proves
   nothing reaches the studio. */
const PROBE = { subject: 'Smoke test', form: 'smoke', page: '/', fields: [['Message', 'Automated check, please ignore.']] };
export const ENQUIRY_PROBES = [
  // no name and not an email address: 400 from validation (no spam trap, or it would answer 200)
  { what: 'a bad email address is rejected (400)', status: 400, body: { ...PROBE, name: '', email: 'not-an-email', elapsed: 5000 }, headers: { 'X-Forwarded-For': '198.51.100.7' } },
  // another website's origin: 403, and the spam trap is filled too
  { what: 'posts from other websites are refused (403)', status: 403, body: { ...PROBE, name: 'Smoke Test', email: 'smoke@example.com', website: 'http://spam.example', elapsed: 0 }, headers: { Origin: 'https://evil.example' } },
  // the spam trap and a post faster than any person: accepted quietly, nothing sent
  { what: 'the spam trap accepts quietly without sending (200)', status: 200, body: { ...PROBE, name: 'Smoke Test', email: 'smoke@example.com', website: 'http://spam.example', elapsed: 0 } }
];

// a JSON answer must not carry anything that looks like a credential
const SECRETISH_KEY = /(secret|token|password|passwd|api[-_]?key|private|signature|credential)/i;
export function looksSecret(value, key = '') {
  if (value && typeof value === 'object') return Object.entries(value).some(([k, v]) => looksSecret(v, k));
  if (typeof value !== 'string') return false;
  if (SECRETISH_KEY.test(key) && value.length > 0) return true;
  return /\b(sk|pk|rk|sb_secret|sb_publishable|re|xai)[-_][A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|[A-Za-z0-9+/_-]{40,}/.test(value);
}

/* Vercel answers an external rewrite whose target it cannot reach with 502-504 and an
   x-vercel-error code starting ROUTER_EXTERNAL_TARGET (or a DNS_ code). On a preview that means
   the staging studio is not deployed yet; on production it is always a failure. */
export function studioNotDeployed(r, production) {
  return !production && [502, 503, 504].includes(r.status) && /^(ROUTER_EXTERNAL_TARGET|DNS_)/.test(r.headers.get('x-vercel-error') || '');
}

export async function smoke(base, { local = false, production = false, productionBase, log = console.log } = {}) {
  let failed = 0;
  const ok = (cond, what) => { log(`${cond ? 'pass' : 'FAIL'}  ${what}`); if (!cond) failed++; };
  const at = b => (p, o = {}) => fetch(b + p, { redirect: 'manual', ...o });
  const get = at(base);
  const bases = rewriteBases(base, { production, productionBase });
  const sget = at(bases.studio), via = bases.failClosed ? ` via ${bases.studio}` : '';
  const json = r => r.json().catch(() => null);

  for (const p of PAGES) {
    const r = await get(p), html = r.ok ? await r.text() : '';
    ok(r.status === 200 && html.includes('<link rel="canonical"') && html.includes('application/ld+json') && html.includes('assets/enquiry.js'), `${p} loads with its SEO tags and the enquiry script (HTTP ${r.status})`);
    ok(/<a class="gb__login" href="auth\/login\.html">Log in<\/a>/.test(html) && /href="privacy\.html"[^>]*>Privacy</.test(html), `${p} has Log in and Privacy`);
  }
  const pv = await get('/privacy.html'), pvHtml = pv.ok ? await pv.text() : '';
  ok(pv.status === 200 && pvHtml.includes('<link rel="canonical"') && pvHtml.includes('application/ld+json') && /<h1\b/.test(pvHtml), `/privacy.html loads with its SEO tags (HTTP ${pv.status})`);

  for (const [p, type] of [['/robots.txt', 'text/plain'], ['/sitemap.xml', 'xml'], ['/og/index.jpg', 'image/jpeg'], ['/og/logo.png', 'image/png'], ['/assets/enquiry.js', 'javascript'], ['/assets/site.js', 'javascript']]) {
    const r = await get(p);
    ok(r.status === 200 && (r.headers.get('content-type') || '').includes(type), `${p} is served (${type})`);
  }
  const sm = await (await get('/sitemap.xml')).text().catch(() => '');
  ok(sm.includes('/privacy.html</loc>') && !/\/(auth|studio)\//.test(sm), 'the sitemap lists privacy.html and none of the sign-in or studio pages');
  const nf = await get('/no-such-page');
  ok(nf.status === 404 && (await nf.text()).includes('Page not found'), 'unknown addresses get the 404 page');

  // ---------- the sign-in pages (stream W2): strict CSP, never indexed, never cached
  for (const p of AUTH_PAGES) {
    const r = await get(p), html = r.status === 200 ? await r.text() : '';
    ok(r.status === 200 && /<meta name="robots" content="noindex/.test(html), `${p} loads and is noindex (HTTP ${r.status})`);
    if (!local) {
      const csp = r.headers.get('content-security-policy') || '';
      ok(csp.includes(`connect-src 'self' ${SUPABASE_ORIGIN};`) && csp.includes("frame-ancestors 'none'") && !csp.includes('*'), `${p} has the strict CSP for our Supabase project only`);
      ok(/noindex/.test(r.headers.get('x-robots-tag') || '') && (r.headers.get('cache-control') || '').includes('no-store'), `${p} is noindex and no-store in its headers`);
    }
  }

  if (!local) {
    const rd = await get('/hisense');
    ok(rd.status === 308 && (rd.headers.get('location') || '').endsWith('/hisense.html'), '/hisense redirects to /hisense.html');
    const rt = await get('/track');
    ok([301, 308].includes(rt.status) && (rt.headers.get('location') || '').endsWith('/tracking.html'), '/track redirects to /tracking.html');
    const h = await get('/');
    ok(h.headers.get('x-content-type-options') === 'nosniff' && !!h.headers.get('referrer-policy'), 'security headers are set');
    const og = await get('/og/index.jpg');
    ok((og.headers.get('cache-control') || '').includes('max-age=604800'), 'images are cached');

    // ---------- the studio and its API, through the rewrite (all reads; on the production address for production)
    const st = await sget('/studio');
    ok([307, 308].includes(st.status) && /\/studio\/$/.test(st.headers.get('location') || ''), `/studio redirects to /studio/${via} (HTTP ${st.status})`);
    const sr = await sget('/studio/');
    if (studioNotDeployed(sr, production)) {
      // a preview whose staging studio (Fly) is not deployed yet: Vercel itself answers that the
      // rewrite target is unreachable. Said plainly, never counted as a pass; production always fails.
      log(`skip  the staging studio is not deployed yet: /studio/ and the studio API were not tested${via} (HTTP ${sr.status}, ${sr.headers.get('x-vercel-error')})`);
    } else {
    ok(sr.status === 200 && /noindex/.test(sr.headers.get('x-robots-tag') || ''), `/studio/ loads and is noindex${via} (HTTP ${sr.status}${sr.headers.get('x-vercel-error') ? ', ' + sr.headers.get('x-vercel-error') : ''})`);
    for (const p of ['/api/health', '/api/auth/health']) {
      const r = await sget(p), j = await json(r);
      ok(r.status === 200 && j && j.ok === true, `${p} answers ok through the rewrite${via} (HTTP ${r.status})`);
    }
    const crm = await sget('/api/crm/health'), cj = await json(crm);
    ok(crm.status === 200 && cj !== null && !looksSecret(cj), `/api/crm/health answers without secrets${via} (HTTP ${crm.status})`);
    // the guide: only once G1 is deployed, and only its GET (it never posts a question)
    const gd = await sget('/api/guide');
    if (gd.status === 404) log(`skip  /api/guide is not deployed yet${via}`);
    else { const gj = await json(gd); ok(gd.status === 200 && gj && typeof gj.mode === 'string' && !looksSecret(gj), `GET /api/guide answers its mode${via} (HTTP ${gd.status})`); }
    if (production) {
      const ie = await sget('/api/ops/ip-echo');
      ok(ie.status === 404, `/api/ops/ip-echo is hidden on production${via} (HTTP ${ie.status})`);
    }
    }
    // a production build on its own deployment address reaches only staging, without the production secret
    if (bases.failClosed) for (const p of ['/studio/', '/api/auth/health']) {
      const r = await get(p), j = await json(r);
      ok(r.status === 403 && j?.error?.code === 'edge_only', `${p} on the deployment address fails closed: 403 edge_only, the production secret is not sent (HTTP ${r.status})`);
    }
  }

  // ---------- the enquiry API (one GET, the refused probes, one refused method)
  const health = await get('/api/enquiry'), hj = (await json(health)) || {};
  ok(health.status === 200 && hj.ok === true, `GET /api/enquiry answers (email configured: ${hj.configured})`);
  for (const p of ENQUIRY_PROBES) {
    const r = await get('/api/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...p.headers }, body: JSON.stringify(p.body) });
    ok(r.status === p.status, `${p.what} (HTTP ${r.status})`);
  }
  ok((await get('/api/enquiry', { method: 'PUT' })).status === 405, 'other methods are refused (405)');
  return failed;
}

async function main() {
  const base = (process.argv[2] || '').replace(/\/+$/, '');
  const local = process.argv.includes('--local');
  if (!/^https?:\/\//.test(base)) { console.error('Usage: node scripts/smoke.mjs https://deployment-url [--local] [--production]'); process.exit(2); }
  const production = process.argv.includes('--production') || /^production$/i.test(process.env.DEPLOY_ENV || '') || new URL(base).host === PRODUCTION_HOST;

  // a deployment behind Vercel's login (Deployment Protection) can't be tested from outside: say so and stop
  const protectedAt = async b => {
    const first = await fetch(b + '/', { redirect: 'manual' });
    const loc = first.headers.get('location') || '';
    return (first.status === 401 || (first.status === 403 && /vercel/i.test(first.headers.get('server') || '')) || (first.status >= 300 && first.status < 400 && /vercel\.com\/(sso|login)|_vercel_sso|sso-api/i.test(loc))) ? first.status : 0;
  };
  let target = base;
  const shut = await protectedAt(base);
  if (shut && production && new URL(base).host !== PRODUCTION_HOST) {
    // Deployment Protection covers a production build's own address but not the production address: test that instead
    console.log(`::notice::${base} is behind Vercel Deployment Protection (HTTP ${shut}), so the checks run against ${PRODUCTION_BASE}; the fail-closed check of the deployment address is skipped.`);
    target = PRODUCTION_BASE;
  } else if (shut) {
    console.log(`::notice::${base} is behind Vercel Deployment Protection (HTTP ${shut}), so it was not tested. Turn protection off for previews, or test the project that serves the site.`);
    process.exit(0);
  }
  if (target !== base && await protectedAt(target)) { console.log(`::error::${target} is behind Vercel Deployment Protection too, so production was not tested.`); process.exit(1); }
  const failed = await smoke(target, { local, production });
  console.log(`\n${failed ? `${failed} check(s) failed` : 'All checks passed'} for ${target}${production ? ' (production)' : ''}`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
