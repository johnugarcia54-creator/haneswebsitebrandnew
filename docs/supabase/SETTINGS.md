# Supabase settings for the website's sign-in pages

A checklist for whoever has the Supabase dashboard (project `mputtezdhevwwjgwktvi`). It should take
about two minutes. It covers only what the website's `/auth/*` pages need. The studio's full checklist
(SMTP, sessions, CAPTCHA, sign-up switch) belongs to stream A1 (ADDENDUM §3.4, §3.5).

**Staging tonight** marks the steps that must be done before staging can be tested. Production
uses the same Supabase project (integrator decision 1), so the same settings cover it.

## 1. URL configuration

Dashboard → Authentication → URL Configuration.

| # | Setting | Value | Staging tonight |
|---|---|---|---|
| 1.1 | Site URL | `https://hanes-the-website-new.vercel.app` (no trailing slash; it moves to `https://www.hanesdistribution.co.nz` with the SEC-2 cutover) | yes |
| 1.2 | Redirect URLs: production | `https://hanes-the-website-new.vercel.app/auth/**` | yes |
| 1.3 | Redirect URLs: previews and staging | `https://hanes-the-website-new-*-johnugarcia54-5453s-projects.vercel.app/auth/**` | yes |
| 1.4 | Redirect URLs: local tests | `http://localhost:3000/auth/**` | no |

About 1.3: the branch alias for `build/website` is longer than the 63 characters Vercel allows in one
DNS label, so Vercel shortens it. Before saving, check the preview's real address (Vercel →
hanes-the-website-new → Deployments → the preview → Domains) and confirm it matches the pattern. The
`*` matches inside one label only, so no host outside this team's previews of this project matches it.

## 2. Email templates: the four token_hash links

Dashboard → Authentication → Emails → Templates. In each template, replace the default
`{{ .ConfirmationURL }}` link with the one below. Change only the link's `href`, and copy it exactly.

| # | Template | Link (`href`) | Subject | Staging tonight |
|---|---|---|---|---|
| 2.1 | Invite user | `{{ .SiteURL }}/auth/confirm.html?token_hash={{ .TokenHash }}&type=invite` | You're invited to the Bargainhub studio | yes |
| 2.2 | Reset password | `{{ .SiteURL }}/auth/confirm.html?token_hash={{ .TokenHash }}&type=recovery` | Reset your Bargainhub password | yes |
| 2.3 | Confirm signup | `{{ .SiteURL }}/auth/confirm.html?token_hash={{ .TokenHash }}&type=email&next=/studio/%23/account` | Confirm your Bargainhub account | no (sign-up is closed) |
| 2.4 | Change email address | `{{ .SiteURL }}/auth/confirm.html?token_hash={{ .TokenHash }}&type=email_change` | Confirm your new email | no (not offered on Friday) |
| 2.5 | Magic link, Reauthentication | keep the defaults (not used) | – | – |

Why these links: a token_hash link spends nothing when it is opened. The token is spent only when
the person presses **Confirm** on `/auth/confirm.html`, so a mail scanner that opens the link
cannot use it up.

`{{ .SiteURL }}` is always the production origin (1.1), so these links always open the production
site, even when staging sent the email. Staging and production share one Supabase project, so an
email sent from staging still links to production. Test the email links against production, or
open staging's link by hand on the staging host with the same `?token_hash=…&type=…`.

## 3. If the templates are still the defaults (the fallback)

`/auth/confirm.html` also accepts the default `{{ .ConfirmationURL }}` link. That link goes to
Supabase's `/auth/v1/verify` first, which **spends the token as soon as the link is opened**, and then
returns to the page with the session in the address-bar hash. The page reads the hash once, removes it
from the address bar, and still waits for the privacy tick and **Confirm and continue**. If a mail
scanner opened the link first, the person sees "This invitation link has expired or was already used.
Ask for a new one."

The default link returns to the address it was sent with, which must be under `/auth/` (step 1).
An invitation sent with the dashboard's own **Invite user** button returns to the Site URL (the
home page), and the home page does not read the hash. Send invitations from Back Office, with
`redirect_to` set to `<origin>/auth/confirm.html`, or apply step 2 first.

## 4. Done when

- [ ] 1.1 to 1.3 saved
- [ ] 2.1 and 2.2 saved and checked: send yourself a reset email, and the link reads `…/auth/confirm.html?token_hash=…&type=recovery`
- [ ] 2.3 and 2.4 saved (before sign-up opens)
