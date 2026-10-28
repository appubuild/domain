# Domain generator — naming rules refactor & UI upgrade

Scope: upgrade the generator **in place**. Same Next.js static export, same Supabase project, same
design system, same auth. Nothing was rebuilt from scratch, and nothing that already worked was
removed except the two selectors the brief asked to delete.

Branch: `arena/b181432b-domain` · commit `00597b8` · production deployment
`dpl_9rZxqTA1Po3Pea8dq9kLfsXxgXTG` → `https://domainfits.vercel.app/`.

---

## 1. Root causes found in the audit

The generator did not need new copy; it needed the engine and the controls to agree with the copy.
Six defects were behind most of the symptoms:

| # | Root cause | Symptom in the old UI |
| --- | --- | --- |
| 1 | **Assembly was strategy-driven, not rule-driven.** `generate.ts` ran a list of strategies (`alternative-order`, `dual-partner`, `three-part`, `invention`, …) and each one had its own composition logic. | A candidate could contain two partners (`FinPayHub`) or an invented tail (`Payvo`), so "one root plus one partner" was false. |
| 2 | **The naming-style selector was the input to that strategy list.** Six styles mapped to strategy subsets, and the styles also carried a `position` (`root-first`/`partner-first`/`either`). | The user was asked to choose the word order, which is the engine's job; choosing "Prefix + root" produced names the rules did not allow. |
| 3 | **Partner vocabulary had no structure.** The pool was `dictionary words ∪ prefix libraries ∪ suffix libraries`, each entry only a string. | Partner length, industry relevance, semantic category and prefix/suffix suitability could not be enforced — only filtered after the fact. |
| 4 | **Total name length was an independent parameter** (`minLength`/`maxLength` sliders). | A user could ask for 4–6 letters and 5-letter partners on a 5-letter root and get nothing, because two controls disagreed about the same arithmetic. |
| 5 | **Industry detection existed but was invisible.** It ran inside the pipeline; the UI offered a large permanent multi-select of all 19 industries and an empty selection silently meant "detect". | Users could not see what had been detected, could not tell detection from override, and the panel dominated the page. |
| 6 | **The controls lived in a permanent side panel plus a separate "generate dock".** Two live regions, two copies of state, and the Generate button duplicated in both. | Nothing was sticky in a predictable place; on a phone the panel pushed the results off-screen. |

---

## 2. The naming rule, as implemented

Every candidate is **exactly two components**: the primary root and one partner root.

- `components` is always length 2, and `candidate.label === components.join("")`.
- Exactly one of the two components is the root; the root never appears inside the partner.
- The partner is one dictionary/industry/custom word of an allowed length — never a multi-word
  phrase, never an invented prefix or suffix, never a truncation.
- The partner is never placed on both sides of the root, and the root never repeats.
- Lengths are decimal letters only: extension, separators and case are excluded from every length
  decision (`pay-nest.com` is not a thing the engine can produce).
- The order (`root-partner` or `partner-root`) is chosen by the placement scorer, not by the user.

Enforced by `checkCandidate` (`src/lib/brain/constraints.ts`, `maxComponents: 2` is now structural,
not a setting) and by `tests/engine/generate.test.ts` over every candidate, not a sample.

`home` with partners of 3–5 letters currently yields `HomeNest`, `HomeRoom`, `HomeHouse`,
`HomeLot`, `VillaHome`, `ManorHome` — patterns, not availability claims.

## 3. Placement scoring (deterministic, no model)

`src/lib/brain/placement.ts` scores **both** orders for each (root, partner) pair and keeps the
better one:

| Signal | What it measures |
| --- | --- |
| `semantic` | Does the compound read as the intended idea in this industry |
| `natural` | Is this the order English puts these two words in |
| `junction` | Letters that meet at the seam: vowel collision, consonant pile-up, friendly pairs (`ea, ee, ie, oa, oo, ou, ue`) |
| `pronounceability` | Syllable shape and vowel share of the joined label |
| `brandability` | Spelling simplicity, memorability, distinctiveness |
| `industry` | Partner relevance to the resolved industry |
| `awkward` | Redundant (`pay` + `pay`), duplicated, or a junction nobody would say |
| `length` | Short two-letter partners are only allowed in front when they read as a word (`CoSecure` is rejected, `SecureIn` is not) |

Both orders are kept **only** when each independently clears `BOTH_PLACEMENTS_THRESHOLD` (76) and
they are not near-duplicates; otherwise the winner alone is emitted. The loser is not silently
discarded — `candidate.placement.reasons` says why the order won, and the diagnostics bar shows the
root-first / partner-first split.

Evidence from the current dictionaries: `home+land` 98/49 (root first), `home+stay` 94/62,
`home+hub` 80/76 (both kept), `pay+wallet` 94/58, `cloud+stack` 67/65 (rejected as ambiguous).

## 4. Industry detection and the partner dataset

- `src/lib/generator/industry.ts` wraps the brain's `detectIndustries` and exposes three states the
  UI must distinguish: **auto** (`pay` → Fintech & Payments, 0.85–0.95), **override** (the user's
  choice, used verbatim), **none** (no confident match → general vocabulary, never presented as a
  detection).
- Detection runs on every root change and is ranked (top 3); ambiguous roots get runner-up chips
  (`pay` also matches SaaS 0.75, `cloud` also matches Developer Tools and SaaS).
- A manual choice survives until **Reset** or until the root changes — the root field clears it,
  because an industry chosen for `pay` is not an industry for `home`.
- Partner lexicon: **667 words** (`src/lib/brain/partners.ts`), tagged with length, industry,
  semantic category, prefix/suffix suitability, pronunciation class and brandability. Lengths:
  2 → 33, 3 → 78, 4 → 145, 5 → 178, 6 → 124, 7 → 52, 8 → 37, ≥9 → 19. The 2–6 pool is **558** words.
- Industries: **19** in `dictionaries/industries.ts` and in the database (`automation` and
  `communication` added this pass: 83 new `industry_terms`, 16 new `*-p-*` `phrase_templates`).
- Extensibility: the lexicon is plain data in TypeScript, and the same vocabulary is seeded to
  Supabase (`industries`, `industry_terms`, `phrase_templates`) so it can be extended without a code
  change; no paid AI API is used anywhere.

## 5. Controls and layout

One sticky card, directly under the site header (`sticky top-[var(--site-header-h)] z-20`), and it
is the only sticky element on the page. Order of controls:

1. **Primary root** (one word, enforced — extra words are reported, not silently accepted) with the
   detected industry underneath, and **Generate** beside it.
2. **Extensions** (multi-select chips) — high in the card, above the numeric rules.
3. **Partner root length** — a 2/3/4/5/6 multi-select plus "Any", with a real example word per
   length in the tooltip.
4. **Industry** — a compact native `<select>` ("Automatic — Fintech & Payments" / override), the
   detection sentence, the vocabulary sample and runner-up chips. Compact, keyboard- and
   touch-operable, never a permanent side panel.
5. **How many names**, **Brandable ranking**, then the computed total-length sentence
   ("Pay (3 letters) + a 2/3/4/5/6-letter partner → 5–9 letters before the dot").
6. **Advanced** (collapsed): custom partner words, word libraries, dictionary/industry switches,
   syllables, consonant run, vowel share, required/excluded text.

On a phone the card collapses to row 1 (root + Generate) and the rest sits behind a **Setup** toggle
(`aria-expanded`/`aria-controls`); from `lg` up everything is visible. Generate is disabled only for
a real validation failure or while a request is running, where it shows "Generating…" and a progress
row rather than a fake percentage.

## 6. Filtering and sorting

`src/lib/generator/filters.ts` — filters run over the **whole** result set, then the page window is
taken from the filtered list (`PAGE_SIZE = 50`):

| Control | Behaviour |
| --- | --- |
| A → Z / Z → A | Case-insensitive, deterministic tie-break |
| Shortest / longest | Brand name only — `PayNest` is 7, not `paynest.com` |
| Brandability ↑ / ↓ (+ min score) | Sort plus an optional floor |
| Domain score ↑ / ↓ (+ min/max) | `overall` is `0.6·quality + 0.4·brandability`, labelled as a heuristic |
| Quality ↑ / ↓ | Descriptive quality alone |
| Extension | A name with several extensions is kept when **at least one** selected extension is its |
| Availability | Only recorded statuses; unrecorded is `unchecked`, never "available" |
| Search / required / excluded / favourites | Text and set membership |

Filters combine with AND, sorting never changes the set, changing a filter never regenerates,
clearing restores every name, and `rejectedBy` counts what each rule removed so an empty list can
explain itself. Scores are never described as availability or market value.

## 7. Quantity, dedupe and honesty

- Target counts: 25 / 50 / 100 / 250 / 500 / 1000, capped by `SANE_LIMITS.maxTarget` (5000) — the
  old arbitrary 100 cap is gone.
- The engine enumerates the whole pair space for the allowed lengths, scores it, dedupes by label,
  and keeps going until the target is met or the space is exhausted. Measured on `pay` with lengths
  2–6: 552 partner words → 596 pairs → 25/100/250/500 all met (57–76 ms), 1000 → **596 returned with
  `exhausted: true`**.
- Shortfalls are explained in the diagnostics bar (pool size, rejections by rule, the top rejecting
  rule, "auto-expand off", partner-length ceiling). Nothing is fabricated to reach a number.
- Display: `displayForm()` renders CamelCase (`PayNova`, `AILabs`) in the UI; `label` and every
  `domains[].domain` stay lower-case (`paynova.com`) for availability requests. The CamelCase form is
  never used to build a domain.

## 8. What changed, file by file

**New engine** — `src/lib/brain/partners.ts` (lexicon + metadata), `placement.ts` (order scoring),
`partner-engine.ts` (expansion + rejection accounting), `pipeline.ts` (rewritten orchestration,
`displayForm`), `src/lib/generator/industry.ts`, `src/lib/generator/root-insight.ts`.

**Deleted** — `src/lib/brain/generate.ts` (old strategy engine, 519 lines),
`src/lib/generator/naming-styles.ts` (316 lines), `src/components/generator/generate-dock.tsx`,
`tests/generator/naming-styles.test.ts`.

**Rewritten** — `generator-controls.tsx` (single sticky bar + Setup toggle), `generator-workspace.tsx`
(sticky card, results + right `aside` with root analysis and recent searches, no dock),
`url-state.ts` (styles and total length removed from the URL), `filters.ts`, `root-analysis.tsx`,
`results-panel.tsx`, `candidate-row.tsx`.

**Adjusted** — `types.ts`, `constraints.ts` (`maxComponents` structural), `score.ts`,
`scoring-profiles.ts`, `semantics.ts` (ranked detection + curated roots), `dictionaries/industries.ts`
(19 industries), `scripts/seed-sql.ts`, `supabase/seed/seed.sql`, `src/lib/brain/index.ts`
(+`displayForm`, −stale `GENERATION_STRATEGIES`), landing copy (`src/lib/content/landing.ts`,
`src/app/page.tsx`, `hero-search.tsx`).

**Tests** — new `tests/engine/{generate,partners,placement,quantity}.test.ts`,
`tests/generator/{controls,filters,industry}.test.ts(x)`; removed `naming-styles.test.ts`;
`results-panel`, `landing`, `landing-preview` and `export` fixtures updated to the two-part shape.

## 9. Test results (executed, not assumed)

| Gate | Result |
| --- | --- |
| `npx vitest run` | **963 passed / 46 files** (was 897 / 42) |
| `npx vitest run tests/engine tests/generator tests/ui` | **174 passed / 12 files** |
| `npx tsc --noEmit` | **0 errors** |
| `npm run build` | **exit 0** — static export, 19 industry pages, `/generator` 47.7 kB |
| `npm run typecheck:functions` | 3/3 (unchanged) |

The fifteen regressions from the brief map to:

| Requirement | Test |
| --- | --- |
| `home` → one partner only | `generate.test.ts` "builds every name from exactly one primary root and one partner root" (checked on every candidate) |
| No partner on both sides | `generate.test.ts` "never puts a partner on both sides of the root" |
| Industry suggestions pay / cloud / ai / chat / secure | `industry.test.ts` (five tests) |
| Manual override changes generation | `industry.test.ts` "changes the vocabulary that is actually generated" + "uses the chosen industry verbatim" |
| Partner lengths 2/3/4/5/6 | `controls.test.tsx` "offers exactly the partner lengths 2–6" + `quantity.test.ts` |
| Total-length maths | `controls.test.tsx` "computes the finished length instead of asking for it" |
| Old selectors gone | `controls.test.tsx` "has removed the naming-style and total-length pickers" |
| Extensions near the top | `controls.test.tsx` "offers the five inputs … in that order" |
| Generate reachable while scrolling | `controls.test.tsx` sticky-card assertions + `generator-workspace.tsx` contract |
| CamelCase display, lower-case domain | `filters.test.ts` "shows CamelCase but keeps the domain lower-case" |
| All sort/filter modes | `filters.test.ts` "orders every mode in the direction it claims", "sorts A→Z and Z→A" |
| Combined filters, clearing, dedupe, counts | `filters.test.ts` "combines filters with AND", "restores every name", "returns unique labels only" |
| Large quantities and limits | `quantity.test.ts` (1000 → 596 with `exhausted`), `generate.test.ts` |
| Desktop and mobile | `controls.test.tsx` "collapses the secondary controls on a phone and shows them from `lg` up" |
| Lint / type-check / build unchanged | `tsc --noEmit` and `npm run build` above; the repo ships no ESLint config, so type-check + build is the gate |

## 10. Deployment

- Push `00597b8` → branch deployment, then a production deployment created for the same commit
  (`dpl_9rZxqTA1Po3Pea8dq9kLfsXxgXTG`), alias `domainfits.vercel.app`.
- Live checks: `/generator/` renders the new control card, `/generator/?q=pay&pl=3,4&n=50` renders
  results, `/`, `/industries/`, `/blog/` unchanged.

## 11. Remaining limitations and decisions needing input

1. **No browser in this environment.** The generator was verified through the build, the rendered
   server HTML (dev server + production), and DOM-level component tests. Sticky behaviour and the
   mobile Setup toggle are asserted structurally, not observed in a real viewport — a manual pass on
   a phone is still worth five minutes.
2. **Pagination, not virtualisation.** 50 rows per page; a 5000-name list is filtered and sorted
   client-side in milliseconds, but the DOM is bounded by paging rather than by a virtual window.
3. **The database copy of the vocabulary is not read by the static build.** The lexicon ships in the
   bundle (needed offline and in the browser worker); Supabase holds the same rows so it can be
   extended from the admin side later. Wiring DB rows into the generator's partner pool would make
   generation depend on a network call — worth deciding deliberately.
4. **Availability is untouched.** Nothing here changes what a provider answer means; the engine still
   never says "available" without one.
5. **Two-letter partners are restricted to the forward order** (`SecureIn`, not `InSecure`). This is
   a deliberate readability rule and costs a handful of candidates.
6. **Industry names are still vocabulary-driven.** A root with no dictionary overlap gets the general
   pool and says so; there is no learned fallback, and none is claimed.
