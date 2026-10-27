# Phase 6 — admin completeness and the AI content studio

**Date:** 2026-10-27 · **Branch:** `arena/b181432b-domain`

Two gaps closed: the admin panel could not manage foreign-key columns at all (so
`affiliate_tld_rules` was SQL-only), and the AI content studio existed as a database table with
no way to use it.

---

## 1. Environment note (important for continuation)

The sandbox was rebuilt between turns: `node_modules/`, `.next/` and `out/` are excluded from
workspace snapshots, and the local `.git` had been reset to the base commit while the remote
still held the branch. Recovery was: `git fetch` → `git reset --hard origin/arena/b181432b-domain`
→ restore the working tree from a tar backup taken first → `npm install`. Commit history
(`f089b33` and earlier) is intact on the remote and in the working branch. Anyone resuming this
session should expect to run `npm install` and `npm run build` first.

---

## 2. Foreign-key fields in the generic CRUD manager

The manager was declarative but text-only for relationships, which is why
`affiliate_tld_rules.provider_id` had no UI. Added a `reference` field type:

```ts
{ key: "provider_id", type: "reference", required: true, immutable: true,
  reference: { table: "affiliate_providers", valueColumn: "id", labelColumn: "name" } }
```

Behaviour:

- options load from the referenced table when the drawer opens (500-row cap, optional filter
  and ordering);
- **a failed load degrades to a text input holding the current identifier**, with the reason
  shown — never a silently blanked field or a guessed option;
- a value that is no longer in the filtered list stays visible as
  `… (not in the current list)` so edits do not quietly rewrite the relationship;
- `nullable` fields write SQL `NULL` for an empty choice. Without this an empty uuid string
  would fail with a type error rather than meaning "no parent".

Applied to four fields: `affiliate_tld_rules.provider_id`, `posts.category_id`,
`industries.parent_id` and `phrase_templates.industry_id` (the last was a free-text UUID box).

New module: **Affiliate extension rules** (`/admin/affiliate-rules/`), identified by the
`(tld, provider_id)` tuple.

---

## 3. AI content studio

| Piece | File |
| --- | --- |
| Request shaping + response validation | `src/lib/ai/studio.ts` |
| Edge Function (provider call, admin auth, draft persistence) | `supabase/functions/ai-studio/index.ts` |
| Admin screen | `src/app/admin/(protected)/studio/page.tsx` |

### Draft-only, and structurally so

The function's **only** database write is an insert into `ai_drafts` with status
`pending_review`. It has no code path that touches `posts`, so "publish by accident" is not a
missing guard — it is not reachable. The admin screen offers Read / Copy / Accept / Reject; there
is no publish button, and copying text into a post creates a *draft* post that still needs a
rebuild to go live.

### Off by default, four times over

1. `AI_API_KEY` absent → the function answers **503**, and the client maps 503 to
   "no provider key is configured" rather than a generic error.
2. `ai_studio` feature flag false → **403**, mapped to "switched off for this site".
3. `NEXT_PUBLIC_AI_FN_URL` unset → the form is disabled with an explanation; no request is made.
4. Supabase unconfigured → the screen says so and shows no data.

The core generator continues to work with all of these off, as required.

### Authorisation

The function requires a bearer token, resolves the user against `auth/v1/user`, and then reads
`user_roles` with the service role. It deliberately does **not** call `is_admin()`: that helper
reads `auth.uid()` from the JWT claims, and a service-role REST call has no `sub`, so it would
always answer false. The rows consulted are the same ones the RLS policies use.

### Output validation

`parseStudioResponse` treats an empty or implausibly short completion (<40 chars) as
`invalid-response` with "Nothing was saved", so a provider error string can never be presented as
an article. Statuses map to specific reasons (503 → unconfigured, 403 → flag-off, 429 →
rate-limited, ≥400 → provider-error).

---

## 4. Verification

```
tsc --noEmit        exit 0
vitest run          261 passed / 16 files   (was 230)
next build          ✓ Exporting (2/2); /admin/studio and /admin/affiliate-rules emitted
dev server          / /admin/studio/ /admin/affiliate-rules/ /admin/posts/ /generator/ → 200
```

New tests:

| File | Tests | Focus |
| --- | --- | --- |
| `admin/registry-shape.test.ts` | 10 | Reference sources exist, nullable conventions, no duplicate keys, nav coverage |
| `ai/studio.test.ts` | 21 | Request validation, payload trimming, every failure mapping, empty-completion refusal |

Two failures during development were mistakes in my own tests, not the code: "domains" is
7 characters and therefore a valid topic (the minimum is 6), and `buildPayload` correctly returns
no word target for an outline. Both assertions were corrected and the boundary is now pinned
explicitly (`domain` passes, `domai` does not).

---

## 5. Limitations

- **The function has never run.** No Supabase project, no Deno runtime here. Admin auth, the
  provider call and draft persistence are reviewed and documented, not exercised.
- **No provider is assumed.** The default endpoint is OpenAI's chat-completions shape; a
  different provider needs `AI_BASE_URL`/`AI_MODEL`, and that path is untested.
- **No draft-to-post migration button.** Copying text is deliberate: it forces a human edit and
  avoids a one-click path from model output to published content.
- **No prompt history or cost tracking.** `ai_drafts` stores the topic summary, provider and
  model; it does not record token usage, so the admin panel makes no cost claims.

## 6. Next

1. Media library UI (`media` table exists with no screen) — uploads to Supabase Storage, alt-text
   enforcement, no arbitrary file types.
2. SEO diagnostics screen: orphan pages, missing meta, duplicate titles, redirect chains — all
   computed from real content, with no invented "SEO score".
3. Playwright suite for the critical journeys once a browser is available.
