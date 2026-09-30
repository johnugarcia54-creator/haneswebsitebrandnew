# Hanes Distribution: website

Scroll-driven campaign homepage for Hanes Distribution: truck hero, network film, live tracking, Hornby warehousing, the five house brands, Hisense appliances, offices and enquiries.

Static site with no build step. Open `index.html`, or serve the folder with GitHub Pages.

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
