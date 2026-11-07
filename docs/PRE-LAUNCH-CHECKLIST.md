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

## 3b. Admin console (Phase 1 demo)

- [ ] `/admin` is live for review only. It uses **demo credentials stored in the
      browser bundle** (`info@safehomenetwork.com` / `Sa123456`) — not real
      security. Do not share the URL publicly and do not store real business
      data behind it.
- [ ] `robots.txt` disallows `/admin` and the console sets `noindex,nofollow`.
- [ ] Phase 2 (PHP + MySQL auth + REST API) must be approved and completed before
      the panel is treated as production: hashed passwords, server sessions,
      CSRF, rate limiting, per-endpoint authorisation.
- [ ] The panel's dashboards are simulated data — never quote those figures as
      real traffic, calls or revenue.

## 4. Contact form delivery

The form is usable today: submitting opens the visitor's email app with the
message pre-filled and addressed to `SITE.contact.email` (no fake success, no
dead end).

- [ ] Optional: connect a real endpoint — set `VITE_CONTACT_ENDPOINT` (Formspree,
      Netlify Forms, your API, an email service) and, if used,
      `VITE_SPAM_PROTECTION_SITE_KEY`, then rebuild. The page then posts directly
      and shows a genuine confirmation.

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
