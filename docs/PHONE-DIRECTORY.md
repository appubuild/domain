# Service Phone Directory — Operations Guide

All service phone numbers on the website come from **one file**:
`src/data/serviceNumbers.ts`. No component contains a hard-coded number.

## Current status

| | |
|---|---|
| Service groups | 10 |
| Numbers imported | 20 (two per group) |
| Active / published | **0** |
| Pending verification | **20** |
| Inactive | 0 |

Every number ships as `pending-verification`. That means **no number is shown to
the public** right now — visitors see a contact message instead. This is the
correct state until each number and its call-campaign terms are verified.

> A number is only published when **both** are true:
> 1. `status: 'active'`
> 2. its `campaign` permissions allow traffic from the visitor's location
>    (nationwide, or a matching state/ZIP list)

## The 10 groups and where they appear

| Directory group | Numbers (priority 1 / 2) | Website service pages |
| --- | --- | --- |
| Roofing | 800-779-3921 / 888-863-0629 | `/services/roofing`, `/services/roof-repair` |
| Plumbing | 800-736-1462 / 888-861-2884 | `/services/plumbing` |
| HVAC | 800-816-9035 / 888-391-0143 | `/services/hvac`, `/services/ac-repair` |
| Electrical | 800-692-4680 / 888-925-0361 | `/services/electrical` |
| Appliance | 800-692-7205 / 888-560-3029 | finder only (no service page) |
| Garage Door | 800-738-5598 / 888-714-0941 | finder only |
| Gutters | 800-741-8602 / 888-729-0842 | finder only |
| Tree Service | 800-763-9887 / 888-835-0252 | finder only |
| Window | 800-779-8592 / 888-353-0358 | `/services/window-installation` |
| Bathroom & Kitchen Remodeling | 800-692-6718 / 888-884-4234 | `/services/bathroom-remodeling`, `/services/kitchen-remodeling` |

Services with **no** authorized group — water damage, pest control, locksmith,
bedroom remodeling, door installation, concrete & paving — deliberately show a
contact message. They never borrow another trade's number.

## Activating a number (after you verify it)

Open `src/data/serviceNumbers.ts` and change only that number's object:

```ts
{
  id: 'roofing-1',
  number: '800-779-3921',
  priority: 1,
  status: 'active',                       // ← was 'pending-verification'
  campaign: {
    network: 'Network A',                 // who owns the line
    campaign: 'Roofing nationwide',       // campaign / tracking pool
    nationwide: true,                     // ONLY if confirmed in writing
    // states: ['GA', 'FL'],              // or restrict instead
    // zipCodes: ['30301'],
    notes: 'Confirmed with network on 2026-11-12',
  },
}
```

Rules worth keeping:

- `nationwide: true` only when the campaign terms explicitly allow nationwide
  traffic. If you are unsure, use `states` or `zipCodes`.
- `priority: 1` becomes the **Call Now** button; every other published number
  becomes a **Call Alternate** button, in ascending priority order.
- Retire a line with `status: 'inactive'` — it stays in the file for history and
  disappears from the site immediately.
- Adding a whole new network or group needs no component changes: add the group,
  then map it in `src/data/serviceNumberMapping.ts`.

After editing, rebuild (`npm run build`) and re-upload `dist`.

## What visitors see

1. **Location confirmed** → *Primary call connection* with **Call Now**, plus
   *Alternate call connection* with **Call Alternate**. Each button is its own
   `<a href="tel:+1…">` — calls are never auto-dialled, auto-redirected or
   forwarded.
2. **Location known, campaign permissions unknown/restricted** → a verification
   message naming the city and state, with a contact link. No number is shown.
3. **No ZIP yet** → a prompt to confirm the ZIP code first.
4. **Nothing active for that service** → a clear contact message.

ZIP validity and campaign eligibility are always presented as two separate
things: a ZIP code proves a US location exists, never that a campaign will
accept the call.

## Local preview of unpublished numbers

When you run `npm run dev`, unpublished numbers are rendered **with a "Not
published" badge and an amber preview notice**, so you can review the layout
without publishing anything. Production builds (`npm run build`) never show
them. The flag is `PREVIEW_UNPUBLISHED_NUMBERS` in `src/data/serviceNumbers.ts`
and is hard-wired to the dev environment.

## ZIP code lookup

- Provider: `https://api.zippopotam.us/us/{ZIP}` (free, no key, CORS enabled).
- Override the endpoint with `VITE_ZIP_LOOKUP_URL` if you change providers.
- Client-side only: nothing is sent to your server, and the ZIP is cached in
  `sessionStorage` to avoid duplicate lookups.
- 8-second timeout, abort handling, friendly messages for not-found, busy,
  network and timeout errors, plus a **Retry** button that keeps working.
- If the lookup fails, the coverage check still runs (it uses local data) and the
  call panel explains that the location could not be confirmed.

## Tests

```bash
npm run test
```

33 assertions cover the directory structure, service-to-number mapping (no
cross-assignment), two-number support, `tel:` formatting, priority ordering,
active/inactive filtering, campaign eligibility (nationwide, state and ZIP
rules), ZIP validation, and the ZIP API's success, cache, 404, 5xx, network and
abort paths.

## Campaign architecture (ready for the call networks)

`ServicePhoneNumber.campaign` already supports the fields a tracking network
needs: `network`, `campaign`, `nationwide`, `states`, `zipCodes`, `notes`. The
eligibility decision lives in `src/lib/phoneDirectory.ts`
(`evaluateCampaign`), so when the networks provide their real geo rules you only
fill in data — or, for a live API, replace that one function with a fetch.
