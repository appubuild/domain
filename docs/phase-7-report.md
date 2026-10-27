# Phase 7 — the media library

**Date:** 2026-10-27 · **Branch:** `arena/b181432b-domain` · **Commit:** _this phase_

The `media` table has existed since migration `0004` with RLS policies and public read, and no
way to put a row in it. This phase adds the storage bucket, the upload rules and the screen.

---

## 1. What was built

| Piece | File |
| --- | --- |
| Bucket, policies, metadata constraints | `supabase/migrations/0007_media_storage.sql` |
| Upload rules (pure, 47 tests) | `src/lib/media/library.ts` |
| Admin screen | `src/app/admin/(protected)/media/page.tsx` |
| Tests | `tests/media/library.test.ts` |

The screen is `/admin/media/`, under **Content → Media library**.

---

## 2. Decisions worth defending

### SVG is refused, and not because of the MIME check

An uploaded SVG is a document that can contain `<script>`; served from the site's own origin it
is stored cross-site scripting the moment anyone opens the file URL directly. A MIME check does
not help — the browser parses the file happily. The only reliable fix is not to accept it, so
the allowlist is JPEG, PNG, WebP and AVIF, and the error message explains why rather than
saying "invalid type". GIF is excluded too (animation in a CMS is usually a size accident, and
there is no pipeline to flatten it).

The `media_mime_type_allowed` constraint in the migration repeats the same four types, so a
direct SQL insert cannot register a row the app could never render. A test asserts the two
lists agree — that is the kind of drift nobody notices until an image silently 404s.

### The bucket is public, and that is the right trade

The site is a static export on shared hosting. A signed URL expires; a page cached for a week
would then show broken images. Uploaded images are public assets by definition — they appear on
public pages — so `media` is a public-read bucket and only administrators may write. Listing is
open as well; it exposes nothing that is not already in the page source.

### Alt text is required *before* upload

Asking afterwards is how it gets forgotten. The form will not send the file until the
description passes:

- empty → refused;
- `image`, `photo`, `screenshot`, `n/a`, `todo` → refused as placeholders (checked before the
  length rule, so the message asks for a description rather than more characters);
- the file name pasted back in, in any case or separator style → refused;
- under 8 or over 160 characters → refused.

Rows that already exist without usable alt text are **flagged, not hidden**: `mediaUsage()`
marks them and the library header counts them. Hiding them would lose the upload; flagging
makes the fix obvious. There is no seeded media, so a fresh install starts with an honest empty
state rather than stock photos.

### Paths are generated, never trusted

`buildStoragePath("../../etc/passwd\0.jpg", "image/png")` yields
`2026/03/etc-passwd-<token>.png`. The stem is NFKD-folded (so `Café Crème` → `cafe-creme`
rather than `caf-cr-me`), slugged, capped at 60 characters and falls back to `image` when
nothing survives. The extension comes from the **MIME type**, not the file name. A six-hex
token makes collisions negligible and a unique index on `storage_path` is the backstop. The
shape is enforced by a `check` constraint, and a test feeds the generated path through the same
pattern.

### Partial failures are cleaned up, in the safe direction

- **Upload succeeds, insert fails** → the stored object is deleted again. Otherwise it is an
  orphan: publicly fetchable, absent from the library, unmanaged forever.
- **Delete: row first, object second.** The inverse order risks a row pointing at a missing
  file, which renders a broken image on a live public page. If the object removal then fails,
  the toast says "Record deleted, file kept" and names the error — a residual file is
  untidy, a broken page is not.

### Nothing is guessed

Dimensions come from decoding the actual file (`Image` + `naturalWidth`); on failure the row
reads "dimensions not recorded" instead of a plausible-looking size. With Supabase
unconfigured the upload area is disabled and says why — it does not queue work that will
vanish.

---

## 3. Also fixed: two columns with no UI

`posts` had `cover_image_url` and `og_image_url` in the schema but neither was in the admin
registry, so a post's cover image could only be set by SQL. Both are now fields, with help text
pointing at the media library's **URL** button. (The pre-existing `cover_image_alt` field also
now has its URL companion.)

**Known gap, deliberate:** there is no media *picker* inside the post editor. Pasting a URL is
one step, and a picker would need its own modal, filtering and keyboard story; the honest
tradeoff is documented here rather than half-built. It is the obvious next refinement.

---

## 4. Verification

```
tsc --noEmit      exit 0
vitest run        308 passed / 17 files   (was 261)
npm run build     ✓ 63/63 pages exported, ✓ Exporting (2/2), /admin/media emitted
dev server        /admin/media/ /admin/studio/ /admin/affiliate-rules/ /admin/ /blog/ /  → 200
```

The migration is not just written, it is **executed**: `tests/admin/resources.test.ts` replays
every file in `supabase/migrations/` into PGlite, so `0007` is covered by the same run that
checks the registry against the live schema. To make that possible the file defines
`storage.buckets` / `storage.objects` with `create table if not exists` — a no-op on a real
Supabase project, where both already exist, and the reason the migration suite never skips it.
Storage *policies* still cannot be exercised this way (PGlite connects as superuser, which
bypasses RLS), so the test asserts their presence and shape instead of their behaviour.

## 5. Limitations

- **No upload has ever run.** No Supabase project and no service credentials here, so the
  bucket policies, the signed-in session and the `storage.objects` insert are reviewed and
  documented, not exercised. First deployment should upload one file and immediately try to
  delete it with a non-admin account — the second call must fail.
- **No image optimisation or responsive variants.** The static site serves original bytes.
- **No bulk import.** Files already sitting in the bucket have no rows and will not appear;
  they need a metadata row each (or a script — none is provided).
- **No orphan sweep.** Nothing detects objects in the bucket with no matching row; the upload
  path avoids creating them but a manual dashboard upload would.

## 6. Next

1. SEO diagnostics screen: orphan pages, missing meta, duplicate titles, redirect chains — all
   computed from real content, with no invented "SEO score".
2. A media picker inside the post/page editor (the gap above).
3. Playwright suite for the critical journeys once a browser is available.
