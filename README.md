# Hanes Distribution: website

Scroll-driven campaign homepage for Hanes Distribution: truck hero, network film, live tracking, Hornby warehousing, the five house brands, Hisense appliances, offices and enquiries.

Static pages with no build step, plus one serverless function (`api/enquiry.js`) that emails every enquiry to the Hanes inbox. Hosted on Vercel: pushes to `main` go live, and every pull request gets its own preview. The Bargainhub design studio and its API are served on the same address from a separate server (see How it fits together).

## Pages

- `index.html`: Hanes Distribution home page
- `hanesteel.html`: Hanesteel windows and doors
- `hanestone.html`: Hanestone plasterboard
- `hanewood.html`: Hanewood MDF, HDF, plywood, H3.2 radiata pine plywood and LVL
- `hanesulation.html`: Hanesulation insulation
- `bargainhub.html`: Bargainhub kitchens and interiors
- `tracking.html`: Hanes Track, following one shipment through all six milestones on a live-rendered globe (land dots in `assets/globe-dots.js`)
- `hisense.html`: Hisense TVs and home appliances, supplied through Hanes Distribution, with the 2026 catalogues in a flipbook
- `contact.html`: Contact, with the offices on a live globe and an enquiry form
- `privacy.html`: the privacy statement (a draft for legal review)
- `404.html`: page not found (served by Vercel for unknown addresses; every link on it is absolute)

Shared engines: `assets/globe.js` (the dotted globe on the Contact and home pages, with `assets/globe-dots.js`), `assets/sequence.js` (scroll-scrubbed frame sequences, used by the Hisense page) and `assets/flipbook.js` with `assets/flipbook.css` (the catalogue reader with real page turns, used by the Hisense page).

Every page shares `assets/site.css` and `assets/site.js`: the global bar that links the home page and every brand, with Log in and Get a quote (below 880 px it becomes a burger that opens the full menu), and the common footer with Privacy and Log in. `assets/site.js` also:

- runs `bhAuthHygiene()` first: when a visitor signed in without "Keep me signed in" and has since closed the browser, it removes the Supabase session from this browser and signs the studio session out (the same function, between its BEGIN and END lines, is copied unchanged into the sign-in pages and the studio)
- shows My account (`/studio/#/account`) in place of Log in while a Supabase session is kept in the browser; it never loads the Supabase SDK
- keeps every Book a consultant link (`data-book`) on the enquiry dialog while `BOOKINGS_LIVE` is `false`; set it to `true` when bookings ship and they go to `studio/#/book`
- loads Milli, the guide (`assets/guide/milli.js`), after the page has loaded and the browser is idle, once `MILLI_SHIPPED` is `true` (`npm run check` fails if it is true without the file, and also fails while the file exists but the flag is still false, unless the line says `MILLI_SHIPPED = false; // held`)

- `frames2/<section>/lg` = 2560px frames (desktop / retina), `sm` = 1280px (phones)
- `films/`: full films for the modal player
- `stills/hisense-2026/`: marketing images taken from the Hisense 2026 catalogues
- `catalogues/<tv|fridge|laundry|air>/NNN.webp`: catalogue pages for the flipbook (900 × 1324). `001` is the front cover and the last page is a Hanes back cover. Contents pages, company and office pages, service centres, QR codes, addresses and all Chinese text were left out or removed.
- Enquiries: Enquiry@hanesdistribution.co.nz

## How it fits together

One address serves everything: today `https://hanes-the-website-new.vercel.app`.

| Path | Served by |
|---|---|
| the pages above, `assets/`, images, films, fonts | Vercel, from this repository |
| `/auth/*.html` (log in, sign up, reset, confirm, set a password) | Vercel, from this repository; sign-in itself is Supabase (project `mputtezdhevwwjgwktvi`, Sydney) |
| `/api/enquiry` | Vercel: the enquiry function in this repository |
| `/studio/` and everything under it, every other `/api/*` | rewritten to the Bargainhub studio server on Fly.io (`bargainhub-studio.fly.dev` for production, `bargainhub-studio-staging.fly.dev` for previews and local work), with a secret `x-studio-edge` header the studio's edge gate checks |

`vercel.json` is written in Vercel's `routes` form, in this order: one header route per path group (the sign-in pages get a strict Content-Security-Policy that only lets them talk to this site and the Supabase project), the short addresses and old redirects, the files of this repository, then the studio rewrites. `scripts/routes.mjs` evaluates those routes exactly as Vercel does; `scripts/dev.mjs` serves through it and `tests/config.test.mjs` checks it.

Enquiries go by email to Enquiry@hanesdistribution.co.nz and, in production only, are also handed to the studio's CRM outbox (`api/_lib/crm-forward.js`), from which they reach the Base44 CRM. Previews never forward leads.

## Enquiries (the back end)

Every form on the site (contact, the brand pricing forms, Hisense, Hanes Track and the "Get a quote" dialog) posts to `/api/enquiry`, which checks it, writes it up as an email and sends it to Enquiry@hanesdistribution.co.nz with Reply-To set to the customer. Nothing opens the visitor's email app. The function has a hidden spam trap, a minimum fill-in time, a same-site check and a limit of 5 enquiries per address every 10 minutes.

- `api/enquiry.js`: the endpoint (`GET` is a health check that reports whether email is configured)
- `api/_lib/enquiry.js`: validation, the email itself, and sending
- `assets/enquiry.js`: sends the forms from the browser, and the "Get a quote" dialog for any link with `data-quote`

If the email service is ever unreachable, the form falls back to opening the visitor's email app with everything filled in and a `Reference:` line (the enquiry's id, so it can be matched to a lead the CRM may already hold), so no enquiry is lost.

### Turning on email

In Vercel, open the project, then Settings, then Environment Variables, and add one of these, then redeploy:

1. **Resend** (recommended): `RESEND_API_KEY` from resend.com. Verify the hanesdistribution.co.nz domain in Resend, then set `ENQUIRY_FROM` to an address on it, for example `Hanes Distribution website <website@hanesdistribution.co.nz>`.
2. **Your own mailbox over SMTP** (Microsoft 365, Google Workspace and similar): `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, and optionally `ENQUIRY_FROM`.

Optional: `ENQUIRY_TO` sends enquiries somewhere else (separate several addresses with commas), and `ENQUIRY_RATE_MAX` changes the per-address limit.

### Every environment variable (names only: values live in Vercel, never in this repository)

| Name | Production | Preview | What it does |
|---|---|---|---|
| `RESEND_API_KEY`, `ENQUIRY_FROM` | set | as Production | send enquiry emails through Resend |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | optional | optional | or send them through a mailbox |
| `ENQUIRY_TO`, `ENQUIRY_RATE_MAX` | optional | optional | where enquiries go; the per-address limit |
| `STUDIO_EDGE_SECRET_PROD` | the production edge value | `not-this-environment` | the `x-studio-edge` header on the production rewrites and on the CRM forward |
| `STUDIO_EDGE_SECRET_STAGING` | `not-this-environment` | the staging edge value | the header on the staging rewrites |
| `STUDIO_INGEST_URL`, `LEADS_INGEST_SECRET` | set | unset | the CRM forward (`https://bargainhub-studio.fly.dev/api/leads/ingest` and its signing key) |

Both edge secret names exist in both environments, so a production build opened on its own deployment address sends `not-this-environment` to staging and is refused. The Supabase URL, its publishable key and the Turnstile site key are public and committed in `auth/config.js`.

Local and test only: `PORT`, `HOST`, `STUDIO_DEV_URL` and `STUDIO_EDGE_SECRET_STAGING` (dev server), `DEPLOY_ENV` (smoke test), `SITE_CHECK_ROOT` (site check), `RESEND_API_URL` (tests), `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`, `AXE_PATH`, `LIGHTHOUSE_BIN` (browser checks).

## Search and sharing

`npm run seo` writes every page's title, description, canonical address, sharing tags (with the 1200 × 630 images in `og/`) and structured data for Google, plus `sitemap.xml` and `robots.txt`, from the list in `scripts/seo.mjs`. When the site moves to its own domain, run `npm run seo -- --site https://www.hanesdistribution.co.nz` and commit the result.

`vercel.json` adds security headers, caching for images, films and fonts, and short addresses such as `/hisense`, `/contact`, `/track`, `/login` and `/studio`. The studio content on `bargainhub.html` is indexed; `/studio/` itself and the sign-in pages are not.

## Working on the site

Node 24 (the newest LTS Vercel runs; CI also tests 22).

- `npm install`, then `npm run dev` to run the whole site with the enquiry API on http://localhost:3000, routed exactly as `vercel.json` routes it. `/studio/` and the studio's API go to `STUDIO_DEV_URL` (default `http://127.0.0.1:4190`, where a locally run studio server listens); set `STUDIO_EDGE_SECRET_STAGING` to the value its edge gate expects, if it runs one. The dev server listens on 127.0.0.1 only unless `HOST` says otherwise, and never sends the production secret.
- `npm test`: the enquiry API, the CRM forward, the routes and `vercel.json`, the site bar, `assets/site.js` (sign-in hygiene, My account, bookings, the guide loader), the forms' notices and the smoke test's safety (stand-in servers only, so nothing leaves your machine)
- `npm run check`: every link, anchor, image and file, one `<h1>` per page, alt text, the SEO tags, sitemap and robots.txt, the sign-in pages' rules, and the guide flag. `SITE_CHECK_RELEASE=1 npm run check` is the release build's check: it also fails while a Log in link points at a sign-in page not built yet
- `node scripts/smoke.mjs <url>`: tests a deployed site: pages, sign-in pages and their headers, sitemap, short URLs, headers, the studio through the rewrite and the enquiry API. It only reads, apart from three enquiry posts the API refuses before anything is emailed or forwarded, so it never creates a CRM lead and never asks the guide anything. Add `--local` for a local server, `--production` (or `DEPLOY_ENV=Production`) for production-only checks. On a production build's own deployment address (the URL Vercel reports to GitHub) the studio and API checks run against `https://hanes-the-website-new.vercel.app`, the only address that reaches production Fly, and the deployment address must answer `/studio/` and `/api/auth/health` with 403 `edge_only` (it sends staging only `not-this-environment`).
- Browser checks, run by hand with Playwright and Chromium (CI has no browser): `node tests/browser/bar.mjs` (the bar from 880 to 1440 px and the burger below), `hygiene.mjs` (sign-in hygiene and My account), `bargainhub.mjs` (the studio and booking buttons), `csp.mjs` (the sign-in pages' CSP), `optin.mjs` (the news box), `axe.mjs` (accessibility) and `lighthouse.mjs` (mobile performance).

`npm test` and `npm run check` run on every push and pull request in GitHub Actions (`.github/workflows/ci.yml`), and the smoke test runs against every Vercel deployment (`.github/workflows/smoke.yml`).

