# Phase 5 — monetization runtime: affiliate routing and advertising

**Date:** 2026-10-26 · **Branch:** `arena/b181432b-domain`

Before this phase, monetization existed only as schema + admin CRUD: `affiliate_providers`,
`ad_slots` and `ad_settings` could be edited, and the affiliate disclosure page promised
"registrar links appear on result rows and detail panels" — but no code ever produced one, and
no ad could ever render. Both are now real, both are off by default, and both fail closed.

---

## 1. Affiliate routing

| Piece | File | Responsibility |
| --- | --- | --- |
| Validation + selection | `src/lib/affiliate/links.ts` | Rebuild and verify every outbound URL; pick a provider per TLD |
| Runtime loader | `src/lib/affiliate/client.ts` | Read enabled providers/rules + the `affiliate_routing` flag (5-minute cache) |
| React hook | `src/lib/affiliate/use-affiliates.ts` | Expose links for a candidate; record clicks |
| UI | `candidate-row.tsx` | Labelled registrar buttons with `rel="noopener noreferrer sponsored"` |
| Server redirect | `supabase/functions/affiliate-click/index.ts` | Re-validate from the database, record the click, 302 |

### Three conditions before any link exists

1. the `affiliate_routing` feature flag is **on** (seeded off);
2. at least one provider row is enabled and passes validation;
3. that provider claims the extension — explicit `affiliate_tld_rules` row, then
   `supported_tlds`, then the single fallback provider.

No provider is seeded, no registrar is hard-coded, and there is no "demo" destination, so a
fresh install shows no registrar links and the existing copy stays accurate.

### What is refused, and why it matters

The URL template is administrator-editable data that becomes an `href`. Every link is rebuilt
from scratch and rejected unless all of the following hold:

| Check | Rejection |
| --- | --- |
| Template is `https://` | `template-not-https` |
| Template contains `{domain}` | `template-missing-domain-token` |
| Domain is a valid DNS name | `invalid-domain` |
| At least one allowlisted host exists | `no-allowed-hosts` |
| Substituted URL parses | `malformed-url` |
| No credentials, no explicit port | `malformed-url` |
| Host equals an allowlisted host or is its subdomain | `host-not-allowed` |

Tested spoofing attempts include `registrar-a.example.evil.com`, `evilregistrar-a.example` and
`registrar-a.example@evil.com` (where the real host is `evil.com`). All are refused.

With the click-through function deployed, the browser never receives the affiliate URL at all:
it links to `/functions/v1/affiliate-click?provider=…&domain=…`, and the function re-reads the
provider, re-checks the allowlist and the feature flag, records the click and answers 302 with
`referrer-policy: no-referrer`. Without the function, the client builds and validates the URL
itself and records clicks best-effort — and `recordAffiliateClick` reports `recorded: false`
rather than implying a click was counted when it was not.

---

## 2. Advertising

`resolveAdRender` / `adSlotView` (`src/lib/ads/config.ts`) gate every placement:

| Gate | Default | Failure |
| --- | --- | --- |
| Provider is AdSense | `none` | `provider-none` |
| Global switch | off | `globally-disabled` |
| Script switch | off | `script-disabled` |
| Publisher ID matches `ca-pub-[0-9]{10,20}` | absent | `invalid-publisher-id` |
| A slot exists for template **and** placement | — | `no-slot-for-template` |
| Slot enabled | off | `slot-disabled` |
| Unit ID matches `[0-9]{6,25}` | absent | `invalid-unit-id` |
| Consent | required | `consent-missing` |

Rendering nothing on failure is deliberate: no reserved space, no "Advertisement" caption over
an empty box. Verified against the built output — `out/blog/…/index.html` contains zero
`adsbygoogle` nodes with the seeded configuration.

Three states are modelled explicitly (`none` / `prompt` / `ad`) so consent is evaluated *after*
the other gates. That ordering is the bug I introduced and then caught in review: feeding
`readConsent()` straight into the gate made the prompt branch unreachable, because a missing
consent had already returned "don't render". `adSlotView` now asks "would this render if the
visitor agreed?" first.

Placements wired: blog post after-intro and end-of-content, CMS page end-of-content. Operators
choose IDs; there is no path for arbitrary JavaScript, and consent is a stored choice rather
than an assumption.

---

## 3. Verification

```
npx tsc --noEmit    exit 0
npx vitest run      230 passed / 14 files   (was 179)
npm run build       ✓ Exporting (2/2)  → out/ regenerated
dev server          / /generator/ /blog/ /admin/affiliates/ /admin/ad-settings/ all 200
```

New test files:

| File | Tests | Focus |
| --- | --- | --- |
| `affiliate/links.test.ts` | 24 | URL rejection matrix, host spoofing, provider selection order, click recording honesty |
| `ads/config.test.ts` | 24 | Every ad gate, consent ordering, slot ordering, row parsing |
| `ui/ad-slot.test.tsx` | 3 | Component emits nothing when unconfigured; never emits scripts or handlers |

Also fixed in passing: a stray non-English string that had crept into the registrar disclosure
copy, and the missing `next/link` import it exposed.

---

## 4. Deliberate limitations

- **The two new functions have never executed on Supabase.** No project is linked here, and
  `deno check` is unavailable, so they are reviewed and documented but unverified in production.
- **AdSense requests are untested against Google.** Test mode sets `data-adtest`, but no real
  ad request has been observed.
- **No ad-revenue or impression reporting.** `analytics_events` records first-party events; it
  does not reconcile with a provider's dashboard, and the admin UI claims nothing of the sort.
- **Click counts are approximate by design** — insert-only from the browser, no deduplication of
  a double-click, no bot filtering. The admin analytics page says "recorded clicks", not
  "clicks".

## 5. Next

1. Deploy both functions and verify: a real 302 with a live provider, a real RDAP answer, and
   click rows landing in `click_events`.
2. AdSense review submission with a real publisher ID; confirm consent gating under a CMP.
3. Admin surface for `affiliate_tld_rules` (currently SQL-only, because the generic CRUD manager
   needs a composite-key resource).
4. Playwright suite for the critical journeys once a browser is available.
