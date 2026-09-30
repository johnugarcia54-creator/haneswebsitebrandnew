# Hanes Distribution: website

Scroll-driven campaign homepage for Hanes Distribution: truck hero, network film, live tracking, Hornby warehousing, the five house brands, Hisense appliances, offices and enquiries.

Static pages with no build step, plus one serverless function (`api/enquiry.js`) that emails every enquiry to the Hanes inbox. Hosted on Vercel: pushes to `main` go live, and every pull request gets its own preview.

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
- `404.html`: page not found (served by Vercel for unknown addresses)

Shared engines: `assets/globe.js` (the dotted globe on the Contact and home pages, with `assets/globe-dots.js`), `assets/sequence.js` (scroll-scrubbed frame sequences, used by the Hisense page) and `assets/flipbook.js` with `assets/flipbook.css` (the catalogue reader with real page turns, used by the Hisense page).

Every page shares `assets/site.css` and `assets/site.js`: the global bar that links the home page and every brand (it tucks away on scroll, and opens a full menu on phones) and the common footer.

- `frames2/<section>/lg` = 2560px frames (desktop / retina), `sm` = 1280px (phones)
- `films/`: full films for the modal player
- `stills/hisense-2026/`: marketing images taken from the Hisense 2026 catalogues
- `catalogues/<tv|fridge|laundry|air>/NNN.webp`: catalogue pages for the flipbook (900 × 1324). `001` is the front cover and the last page is a Hanes back cover. Contents pages, company and office pages, service centres, QR codes, addresses and all Chinese text were left out or removed.
- Enquiries: Enquiry@hanesdistribution.co.nz

## Enquiries (the back end)

Every form on the site (contact, the brand pricing forms, Hisense, Hanes Track and the "Get a quote" dialog) posts to `/api/enquiry`, which checks it, writes it up as an email and sends it to Enquiry@hanesdistribution.co.nz with Reply-To set to the customer. Nothing opens the visitor's email app. The function has a hidden spam trap, a minimum fill-in time, a same-site check and a limit of 5 enquiries per address every 10 minutes.

- `api/enquiry.js`: the endpoint (`GET` is a health check that reports whether email is configured)
- `api/_lib/enquiry.js`: validation, the email itself, and sending
- `assets/enquiry.js`: sends the forms from the browser, and the "Get a quote" dialog for any link with `data-quote`

If the email service is ever unreachable, the form falls back to opening the visitor's email app with everything filled in, so no enquiry is lost.

### Turning on email

In Vercel, open the project, then Settings, then Environment Variables, and add one of these, then redeploy:

1. **Resend** (recommended): `RESEND_API_KEY` from resend.com. Verify the hanesdistribution.co.nz domain in Resend, then set `ENQUIRY_FROM` to an address on it, for example `Hanes Distribution website <website@hanesdistribution.co.nz>`.
2. **Your own mailbox over SMTP** (Microsoft 365, Google Workspace and similar): `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, and optionally `ENQUIRY_FROM`.

Optional: `ENQUIRY_TO` sends enquiries somewhere else (separate several addresses with commas), and `ENQUIRY_RATE_MAX` changes the per-address limit.

## Search and sharing

`npm run seo` writes every page's title, description, canonical address, sharing tags (with the 1200 × 630 images in `og/`) and structured data for Google, plus `sitemap.xml` and `robots.txt`, from the list in `scripts/seo.mjs`. When the site moves to its own domain, run `npm run seo -- --site https://www.hanesdistribution.co.nz` and commit the result.

`vercel.json` adds security headers, caching for images, films and fonts, and short addresses such as `/hisense`, `/contact` and `/track`.

## Working on the site

- `npm install`, then `npm run dev` to run the whole site with the API on http://localhost:3000
- `npm test`: the enquiry API tests (sends through stand-in Resend and SMTP servers, so nothing leaves your machine)
- `npm run check`: every link, anchor, image and file, one `<h1>` per page, alt text, and the SEO tags, sitemap and robots.txt

- `node scripts/smoke.mjs <url>`: tests a deployed site (pages, sitemap, short URLs, headers, and the enquiry API without sending an email)

`npm test` and `npm run check` run on every push and pull request in GitHub Actions (`.github/workflows/ci.yml`), and the smoke test runs against every Vercel deployment (`.github/workflows/smoke.yml`).

