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
- `404.html`: page not found (served by Vercel for unknown addresses)

Every page shares `assets/site.css` and `assets/site.js`: the global bar that links the home page and every brand (it tucks away on scroll, and opens a full menu on phones) and the common footer.

- `frames2/<section>/lg` = 2560px frames (desktop / retina), `sm` = 1280px (phones)
- `films/`: full films for the modal player
- Enquiries: Enquiry@hanesdistribution.co.nz
