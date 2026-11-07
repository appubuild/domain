# Pre-launch checklist (owner-facing)

These are the items that used to appear as amber "before launch" notes **on the
public website**. They have been removed from every page — visitors never see
developer instructions, environment variable names or sample-data labels. Keep
this file in the repo (or in Drive) as the internal checklist instead.

---

## 1. Business identity

- [ ] Set `SITE.legalName` in `src/config/site.ts` to your registered entity name.
- [ ] Add `SITE.contact.addressLines` **only** if you have a public business
      address you are willing to publish. Do not invent an address.
- [ ] Confirm the ownership/affiliation disclosure is accurate for your state.

## 2. Service phone numbers

- [x] 20 numbers live in `src/data/serviceNumbers.ts` (owner-confirmed 2026-11-07).
- [ ] If any line is authorized only in certain states/ZIPs, restrict it:
      `campaign: ownerConfirmedCampaign({ states: ['GA', 'FL'] })`.
- [ ] Optional: add a company-wide line to `SITE.contact.phone` /
      `phoneDisplay` (header, footer, contact page).
- [ ] Optional: provider-specific numbers in `src/config/providers.ts` — only
      numbers the provider has authorized you to publish.

## 3. Phone lines and the (removed) ZIP check

- [x] 20 numbers live in `src/data/serviceNumbers.ts`, two per trade.
- [x] The ZIP input, ZIP validation and availability checker were removed from
      every page. Nothing asks a visitor for a location any more.
- [ ] If a line is ever restricted to certain states, remember that the public
      site withholds `states` / `zipCodes` campaigns on purpose — geo-restricted
      routing needs a location step (or network-level area-code routing) before
      it can be published.
- [ ] Optional: add a company-wide line to `SITE.contact.phone` /
      `phoneDisplay` (header, footer, contact page). Note that this would make
      `tel:` links appear on non-service pages, which `npm run audit` currently
      treats as an error — update that check if you set it.

## 3b. Admin console

Choose one mode and confirm it explicitly.

**Demo mode (no API) — review only**

- [ ] `VITE_API_BASE_URL` is empty. The panel uses **demo credentials in the
      browser bundle** (`info@safehomenetwork.com` / `Sa123456`); the login screen
      and profile page say so. Do not share `/admin` and do not store real data.
- [ ] Dashboards are simulated and labelled; never quote those figures.

**Connected mode (API) — production**

- [ ] `api/` is deployed and `/api/v1/health` returns `200`.
- [ ] The seeded owner password has been changed; every team member has their own
      account and role.
- [ ] `VITE_API_BASE_URL` was set at build time; the demo-credentials panel no
      longer appears and signing in sets an HttpOnly cookie.
- [ ] Saving in Settings / Services / SEO persists after a page reload and is
      reflected on the public site.
- [ ] A `viewer` account receives `403` on save (role enforcement).
- [ ] Analytics shows only recorded data; “Simulated data” is gone once live data
      loads. Calls/revenue stay at zero until recorded.
- [ ] HTTPS is enforced, `COOKIE_SECURE=true`, and `CORS_ALLOWED_ORIGINS` lists
      only your origins (same-origin hosting preferred).
- [ ] `php api/tools/maintenance.php` is on a daily cron.
- [ ] `robots.txt` disallows `/admin` and the console sets `noindex,nofollow`.

## 4. Contact form delivery

The form is usable today: submitting opens the visitor's email app with the
message pre-filled and addressed to `SITE.contact.email` (no fake success, no
dead end).

- [ ] Preferred: deploy the API and build with `VITE_API_BASE_URL` — the form
      posts to `POST /v1/leads` and submissions appear in Admin → Leads.
- [ ] Without the API: set `VITE_CONTACT_ENDPOINT` (Formspree, Netlify Forms, an
      email service) and, if used, `VITE_SPAM_PROTECTION_SITE_KEY`, then rebuild.
- [ ] Send a real test message and confirm it reaches the inbox or the Leads
      screen, with the reference shown to the visitor.

## 5. Legal review

- [ ] Privacy Policy, Terms & Conditions, Disclaimer, Do-Not-Sell-or-Share and
      Accessibility pages reviewed by counsel for your entity and the states you
      operate in.
- [ ] Review again if you enable advertising pixels, remarketing tags, call
      tracking or any tool that discloses personal information for cross-context
      behavioral advertising.

## 6. Imagery

- [ ] Hero and 15 service photographs are AI-generated placeholders. Replace with
      licensed photography using the same filenames in `public/images/`, or update
      the `image` field in `src/config/services.ts`.

## 7. Analytics & search

- [ ] Set `VITE_GA_MEASUREMENT_ID` if you want GA4 (loads only after consent).
- [ ] Verify the domain in Google Search Console and submit `/sitemap.xml`.

---

### Why these are not on the site anymore

A production website should never show its own setup instructions. The audit
script (`npm run audit`) now fails the build if any of this copy reappears on a
public page — it scans every route for `VITE_`, `src/config`, "before launch",
"example coverage", "sample dataset", "not configured", `localhost` and similar
strings.
