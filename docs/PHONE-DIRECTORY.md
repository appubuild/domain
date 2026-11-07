# Service Phone Directory — Operations Guide

All service phone numbers on the website come from **one file**:
`src/data/serviceNumbers.ts`. No component contains a hard-coded number.

## The flow the visitor sees

1. **Pick a service** — a card, the homepage/service-area picker, or the header
   "Call Now" sheet.
2. **The two lines appear** — primary first ("Call Now"), alternate beside it
   ("Call Alternate").
3. **Tap** — each button is its own `tel:+1…` link, so a phone dials directly.

There is no ZIP code step, no availability check and no location lookup anywhere
in the app. Numbers are never printed on listing pages before a service is
chosen.

## Current status

| | |
|---|---|
| Service groups | 10 |
| Numbers | 20 (two per group) |
| Active / published | **20** |
| Pending verification | 0 |
| Inactive | 0 |
| Owner confirmation | 2026-11-07 — all twenty lines confirmed correct and live |

## The 10 groups and where they appear

| Directory group | Numbers (primary / alternate) | Website service pages |
| --- | --- | --- |
| Roofing | 800-779-3921 / 888-863-0629 | `/services/roofing`, `/services/roof-repair` |
| Plumbing | 800-736-1462 / 888-861-2884 | `/services/plumbing` |
| HVAC | 800-816-9035 / 888-391-0143 | `/services/hvac`, `/services/ac-repair` |
| Electrical | 800-692-4680 / 888-925-0361 | `/services/electrical` |
| Appliance | 800-692-7205 / 888-560-3029 | call sheet only (no service page) |
| Garage Door | 800-738-5598 / 888-714-0941 | call sheet only |
| Gutters | 800-741-8602 / 888-729-0842 | call sheet only |
| Tree Service | 800-763-9887 / 888-835-0252 | call sheet only |
| Window | 800-779-8592 / 888-353-0358 | `/services/window-installation` |
| Bathroom & Kitchen Remodeling | 800-692-6718 / 888-884-4234 | `/services/bathroom-remodeling`, `/services/kitchen-remodeling` |

Services with **no** assigned group — water damage, pest control, locksmith,
bedroom remodeling, door installation, concrete & paving — deliberately show a
"contact our team" panel. They never borrow another trade's number, and their
cards show "Ask about this" instead of "Call Now".

## Editing the directory

Every entry looks like this:

```ts
{
  id: 'roofing-1',
  number: '800-779-3921',
  priority: 1,                          // 1 = Call Now, 2+ = Call Alternate
  status: 'active',                     // 'active' | 'pending-verification' | 'inactive'
  campaign: ownerConfirmedCampaign(),   // nationwide, confirmed 2026-11-07
}
```

- **Change a number** — replace `number`; nothing else needs to change.
- **Pause a line** — set `status: 'inactive'`. It disappears immediately.
- **Hold a line back** — set `status: 'pending-verification'`. Hidden from
  visitors; in `npm run dev` you still see a clearly labelled preview.
- **Add a number or a network** — add another object to the group's `numbers`
  array (fill in `network` / `campaign` for tracking). No component changes.
- **Restrict a line to some states or ZIPs** — do **not** use `states`/`zipCodes`
  while the site collects no location: `resolveServiceCall` deliberately withholds
  those numbers, because it cannot honour the restriction. Only `nationwide: true`
  campaigns are published. If you ever need geo-restricted routing, that is the
  point to reintroduce a location step (or route by area code at the network).

After editing, rebuild (`npm run build`) and re-upload `dist`.

## Where the numbers are rendered

| Surface | Behaviour |
| --- | --- |
| Service cards (`/`, `/services`) | "Call Now" button only — no number until the sheet opens |
| `CallSheet` (header, footer, CTA bands, cards) | Step 1 service picker → step 2 the chosen service's two lines |
| Service page (`/services/<slug>`) | `#call` section renders that service's two lines inline |
| Homepage / `/service-area` | `ServiceCallDirectory` — pick a service, numbers appear below |
| Availability-style language | Removed — no page asks for a ZIP code |

## Tests

```bash
npm run test
```

28 assertions cover directory structure, the live/active state, campaign
permissions, service→number mapping (no cross-assignment), two-number support,
`tel:` formatting, priority ordering, active/inactive filtering, and the rendered
markup — including "cards and listing pages must contain zero `tel:` links" and
"each service page exposes only its own two numbers".

`npm run audit` additionally fails if any non-service route renders a `tel:` link,
or if a ZIP input reappears on any page.

## Campaign architecture (ready for the call networks)

`ServicePhoneNumber.campaign` already supports the fields a tracking network
needs: `network`, `campaign`, `nationwide`, `states`, `zipCodes`, `notes`. The
publish decision lives in `src/lib/phoneDirectory.ts` (`isCampaignPermitted`), so
filling in data — or swapping that one function for an API call later — is all
that is required to bring in a real routing network.
