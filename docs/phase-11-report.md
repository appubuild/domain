# Phase 11 — Affiliate & monetization, made operable

**Date:** 2026-10-27 · **Branch:** `arena/b181432b-domain` · **Live:** <https://domainfits.vercel.app>

The tables, the admin forms, the link validator and the `<AdSlot>` component all existed before
this phase. What did not exist was any way to tell whether **any of it was working**. Advertising
has nine hard gates and registrar routing has three; a form that saves successfully tells you
nothing about either. This phase closes that gap and puts the placements where the schema
already said they were.

---

## 1. What was actually missing

Reading the code rather than the plan:

| Already built (phases 4–9) | Gap this phase fixed |
| --- | --- |
| `ad_settings`, `ad_slots`, `affiliate_providers`, `affiliate_tld_rules`, `click_events` (migration `0005`) | — |
| Admin CRUD for all four tables | No screen answered "would this render?" |
| `resolveAdRender` / `adSlotView` with 8 gate reasons | 5 of the 7 seeded placements had no page that ever requested them |
| Affiliate link builder, host allowlist, disclosure, click tracking | — |
| `advertising` / `affiliate_routing` feature flags (off) | The `advertising` flag was **not read by anything** — configuration alone could switch ads on |
| `blog-post` mid-content placement in the seed | `blog/[slug]` only requested `after-intro` and `end-of-content`, so `blog-post-mid` was dead |

---

## 2. Placements now exist on every template that has a page

| Template | Position | Page | Status before |
| --- | --- | --- | --- |
| `home` | `after-intro` | `/` | not wired |
| `generator` | `sidebar` | `/generator/` (results column, below the panel) | not wired |
| `industry` | `after-intro` | `/industries/[slug]/` | not wired |
| `blog-index` | `mid-content` | `/blog/` — after the third post | not wired |
| `blog-post` | `after-intro` | `/blog/[slug]/` | wired |
| `blog-post` | `mid-content` | `/blog/[slug]/` — mid-article | not wired |
| `blog-post` | `end-of-content` | `/blog/[slug]/` | wired |
| `page` | `end-of-content` | `/[slug]/` | wired |
| `tld` | `after-intro` | — | **no page of that shape exists** |

`tld` stays unwired on purpose and the status screen says so ("no page yet"). Inventing a
per-extension page to make a slot look used would be the opposite of the rule this project runs
on. It is listed in `WIRED_PLACEMENTS` with `page: null`, so the omission is visible rather than
forgotten.

### "mid-content" means mid-content

`blog/[slug]` splits the article body at the block boundary nearest the middle
(`splitArticleBody` in `src/lib/content/article.ts`, 7 tests):

- it only cuts **between** top-level blocks, never inside one;
- fewer than four blocks → no cut, so a two-paragraph post gets no mid-article ad;
- `lead + rest` is always byte-identical to the input, so a bad index cannot eat content.

The blog index does the same thing structurally: the placement appears after the third post, and
a list of three or fewer posts has no middle, so it is not rendered.

---

## 3. The feature flag is now a real gate

`feature_flags.advertising` was decorative: the seed documents it as "Render advertising slots",
but `resolveAdRender` never read it, so an operator could turn ads on by configuration alone.
It is now the **first** gate (`reason: "flag-off"`), fetched alongside the settings in
`loadAdConfig` and defaulting to `false` when the row is missing:

```
flag → provider → global switch → script → publisher ID → slot exists → slot enabled → unit ID → consent
```

That gives one switch that turns ads off regardless of how the rest is configured — the thing
you want at 2 a.m. — while `ad_settings` stays the configuration. Consent remains a visitor-side
gate and is evaluated after the rest, so a slot that *would* render asks instead of vanishing.

---

## 4. `/admin/monetization/` — the status screen

New screen under **Monetization → Monetization status**. It does not re-implement any decision:
it calls `adReadiness` / `affiliateReadiness` (`src/lib/monetization/status.ts`), which call the
same `resolveAdRender` the public `<AdSlot>` calls. The panel cannot drift from the site.

- **Advertising** — flag, publisher, "placements ready (x/y)", test/live mode, one-line summary;
  a table of every placement with its page, a `renders` badge, or the blocking reason plus a
  plain-language explanation.
- **Shadowed rows** — two rows for the same template/position are legal in the database, and only
  the lowest `display_order` ever renders. A dead row is labelled `shadowed` with the winner's
  key instead of looking configured.
- **Pages waiting for a placement** — the reverse gap: a wired position with no row.
- **Affiliate routing** — flag, enabled/total providers, extension rules, clicks in the last 30
  days. The click count is read only when the session has an admin role; otherwise it prints
  `—` and says why. **An unreadable counter is never shown as zero** (tested).

Nothing on the screen is an estimate, a projection or a health score — it is the same
all-or-nothing boolean the browser uses, plus the reason.

---

## 5. Verification

```
tsc --noEmit                 clean
vitest run                   429 tests / 24 files       (was 399 / 22)
npm run build                exit 0, Exporting (2/2)
```

New tests: `tests/monetization/status.test.ts` (22 — first-gate ordering, shadowing, unwired
placements, "unreadable ≠ zero"), `tests/content/article.test.ts` (7 — split safety), plus the
`flag-off` gate in `tests/ads/config.test.ts` and the nav allowlist.

The build's `/admin/monetization` route is exported as static HTML like every other admin
screen; the data it shows is fetched in the browser, so a configuration change is visible on
the next page load without a rebuild.

---

## 6. What is still not live (and is not a bug)

- **No publisher ID, no ad unit IDs.** `ad_settings` is `provider: 'none'`, every placement is
  disabled, and both flags are off — exactly as seeded. The site renders no ad containers at
  all, which is the intended default state.
- **No affiliate provider rows.** The generator therefore shows its honest empty line
  ("Registrar links are only shown when an affiliate provider is configured for the extension")
  instead of a link to nowhere.
- **`affiliate-click` Edge Function is not deployed.** Until it is, clicks are counted directly
  from the browser into `click_events` (allowed by an insert-only policy) and the affiliate URL
  is exposed to the client — both are documented in `security.md`. Deploying it moves
  validation server-side and hides the destination; it needs the service-role secret, which is
  yours to set.

---

## 7. Deployed

| | |
| --- | --- |
| Deployment | `dpl_Hw5QENjk3VG84DyBvLGptYViZgGt` — **READY**, promoted to production |
| Commit | `a60b7e5` (branch `arena/b181432b-domain`) |
| URL | <https://domainfits.vercel.app> |
| Build | 67 static pages (one more than phase 10: `/admin/monetization`), `✓ Exporting (2/2)` |
| Database read | `[redirects] … (source: supabase)` with no warning; `/redirects.json` regenerated at 11:26 UTC |

A push of this phase's docs commit produced a second, git-sourced **preview** deployment on its
own (`dpl_6JATaYT4VU13Dd4LRrBswD8nkZ4F`, READY), so pushes do build — previews for this branch,
production aliases only from `main`. `docs/deployment.md` §4 records that, and notes the project
object still claims `createDeployments: "disabled"`, which the deployments list disproves.

Checked on the live site afterwards: `/` and `/blog/` render with **no ad container anywhere**
(the correct state while every gate is closed), and `/admin/monetization/` answers with the
administrator sign-in gate rather than an empty panel.

## 8. Files touched

```
src/lib/ads/config.ts                    # flagEnabled + "flag-off" as the first gate
src/lib/ads/use-ads.ts                   # reads feature_flags.advertising
src/lib/monetization/status.ts           # new: adReadiness, affiliateReadiness, wiring map
src/lib/content/article.ts               # new: splitArticleBody for the mid-content cut
src/app/admin/(protected)/monetization/page.tsx   # new status screen
src/lib/admin/resources.ts               # nav entry
src/app/page.tsx                         # home · after-intro
src/app/generator/page.tsx (workspace)   # generator · sidebar
src/app/industries/[slug]/page.tsx       # industry · after-intro
src/app/blog/page.tsx                    # blog-index · mid-content
src/app/blog/[slug]/page.tsx             # blog-post · mid-content
tests/monetization/status.test.ts        # new
tests/content/article.test.ts            # new
docs/admin-guide.md                      # "Turning monetization on" section
```
