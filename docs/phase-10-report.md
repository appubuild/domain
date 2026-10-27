# Phase 10 — the media picker, and DomainFits on the public internet

**Date:** 2026-10-27 · **Branch:** `arena/b181432b-domain` · **Commit:** `5deb13b`
**Live:** <https://domainfits.vercel.app>

Two deliverables: image fields in the admin are no longer "paste a URL from somewhere", and the
site is deployed, publicly reachable, and reading its content from the live Supabase project.

---

## 1. The media picker

Before this phase, `posts.cover_image_url` was a text input. An editor had to upload a file in
`/admin/media`, copy its public URL out of the library table, and paste it back into the post
form — a workflow that works only if you already know it.

Now a field can declare `type: "media"`, and it renders three things:

| Part | Behaviour |
| --- | --- |
| URL input | Still a plain text input. Always editable, always the stored value. |
| **Pick** | Opens a dialog over the `media` table: filter box, thumbnails, alt-text status, file name, size and dimensions. Empty, loading and error states each say what happened. |
| **Clear** | Empties the field and its preview. |
| Preview | Only rendered for an `http(s)` URL, so a half-typed value never shows a broken image. |

The dialog queries the library **when it opens**, not when the form mounts — a post form that
never touches an image issues no query at all.

### Alt text is filled, never overwritten

Picking an image writes the sibling alt field (`altKey`) **only if that field is empty**:

```ts
altTextForPick(row, currentAlt) // string | null
```

`null` means "leave the field alone". Returning `""` would have been the obvious
implementation and the wrong one: it would blank a description the author had already written
the moment they re-picked the same image. Re-picking is idempotent.

The check reads live draft state (the parent passes `getSiblingValue` down), so an alt value
typed in this session — not yet saved — also counts as filled.

### What is wired

| Resource | Field | Alt field | Recommended size |
| --- | --- | --- | --- |
| `posts` | `cover_image_url` | `cover_image_alt` | 1600×900 |
| `posts` | `og_image_url` | — | 1200×630 |
| `pages` | `og_image_url` | — | 1200×630 |

`pages.og_image_url` existed in the schema (`0004_content`) but was missing from the admin
registry; it is now present. `posts.cover_image_alt` is required by the registry shape test for
`cover_image_url` because a cover image without alt text is an accessibility bug, not a style
choice.

### The stored value is still just a URL

This is deliberate. The picker is a convenience over the `media` table, not a new source of
truth:

- rows imported by hand, or uploaded before the picker existed, still render;
- a URL from another host (a CDN, a partner asset) can still be typed;
- when Storage is unconfigured the field degrades to a text input instead of a dead control.

Picking writes nothing into `media` and nothing new into the content table — it only fills the
same string column that always held the URL.

### Tests

8 new tests, **399 total across 22 files**:

- `tests/admin/registry-shape.test.ts` — the media fields are real image columns, every
  `altKey` points at a text field, the cover image must declare an `altKey`, no media field is
  ever also a sanitised/rich-text field, and no media field is a list column (a thumbnail in a
  table cell is noise).
- `tests/media/library.test.ts` — `altTextForPick` fills when empty, returns `null` when the
  author wrote something, and does not invent text for a row with no alt.

`tsc --noEmit` clean · `npm run build` exit 0, `✓ Exporting (2/2)`.

---

## 2. Deployed

| | |
| --- | --- |
| Project | `domainfits` (`prj_hU5cKmOSxtqOUAnQve0MAWPiIEU7`) |
| Team | Md Sobur ALi's projects (`team_CndNJhdffoDJmlDj4gQglIUJ`) |
| Repository | `appubuild/domain`, branch `arena/b181432b-domain` |
| Commit | `5deb13b` |
| Deployment | `dpl_5BdKxxLAWgLFjni6fXiGymzLuy4G` — **READY** |
| Production URL | <https://domainfits.vercel.app> |
| Branch alias | `domainfits-git-arena-b18-…-md-sobur-alis-projects-c5b69b29.vercel.app` |

Environment (all `NEXT_PUBLIC_*`, i.e. publishable and inlined at build time — the service-role
key is **not** on Vercel):

| Variable | Targets |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | production, preview, development |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | production, preview, development |
| `NEXT_PUBLIC_DATA_BACKEND=supabase` | production, preview, development |
| `NEXT_PUBLIC_SITE_NAME=DomainFits` | production, preview, development |
| `NEXT_PUBLIC_APP_URL=https://domainfits.vercel.app` | **production only** |

`NEXT_PUBLIC_APP_URL` is production-only on purpose: a preview deployment should not emit
canonicals and sitemap entries pointing at the production origin.

### The build really talked to the database

An env var being present is not the same as the read succeeding — `source.ts` falls back to the
offline content pack on failure. So the deployment was verified from the outside:

- Build log: `[redirects] 0 rule(s) compiled … (source: supabase)` **with no warning line**.
  The warning is emitted on a non-2xx response or a thrown fetch, so its absence means the anon
  REST call returned 2xx.
- `GET /redirects.json` on the live site:

  ```json
  { "generatedAt": "2026-10-27T11:11:01.767Z", "source": "supabase",
    "canonicalHost": "domainfits.vercel.app", "redirects": [] }
  ```

  `redirects: []` is correct — the `redirects` table is empty — and `source` is what the build
  actually did.
- `sitemap.xml` lists absolute `https://domainfits.vercel.app/…` URLs, so `NEXT_PUBLIC_APP_URL`
  reached the build, and it contains all 17 industry pages from the database.
- `/`, `/industries/`, `/admin/login/` all return rendered HTML.

Vercel egress to `*.supabase.co` works; nothing had to be worked around.

### One consequence worth stating

The hosting is still a **static export**. Publishing a page in the admin changes the database
immediately, but the public HTML changes only after the next deployment. That is the documented
contract for this architecture (see `deployment.md`), not a bug — but it means the answer to
"why is my edit not live?" is always "it needs a rebuild".

---

## 3. Deviation carried forward: the `0007` storage shim

Unchanged from phase 9 and still worth restating, because the deploy makes the media library
reachable for the first time. `0007_media_storage.sql` contains a guarded shim that defines
`storage.buckets` / `storage.objects` if they do not exist, so the migration suite can be
replayed against PGlite instead of skipping the file. On the live project those tables already
exist and belong to `supabase_storage_admin`, so only the bucket row, the four policies and the
`media` constraints were applied. Every statement in the shim is `IF NOT EXISTS`, so the repo
file is correct for both targets.

---

## 4. What is still on you

1. **Create the first administrator.** No `auth.users` row exists yet, so `/admin/login/` cannot
   grant access to anyone. Sign up through the site's auth flow (or the Supabase dashboard),
   then grant the role:

   ```sql
   insert into public.user_roles (user_id, role_id)
   select u.id, r.id
   from auth.users u, public.roles r
   where u.email = 'you@example.com' and r.name = 'admin';
   ```

2. **Deploy the Edge Functions** (`availability`, AI studio) and set their secrets — service-role
   key, registrar/provider credentials, AI provider key. Until then availability reports
   `unknown`/`unsupported` honestly and the AI studio stays off.
3. **Auto-deploy is off on this project.** It was created through the API, which leaves
   `gitProviderOptions.createDeployments = "disabled"`; pushing to `main` will not build.
   Either turn on Project → Settings → Git → *Deploy on push*, or create deployments
   explicitly. Until then, a content edit plus a push produces no new public HTML.
4. **A real domain**, if `domainfits.vercel.app` is not the long-term home. When it changes,
   update `NEXT_PUBLIC_APP_URL` and rebuild — canonicals, OG URLs and the sitemap all bake it in.

---

## 5. Files touched

```
src/lib/admin/resources.ts               # "media" field type, AdminMediaField, 3 fields wired
src/components/admin/resource-manager.tsx # MediaField, FieldControl sibling plumbing
src/lib/media/library.ts                  # altTextForPick
tests/admin/registry-shape.test.ts        # 5 media-field tests
tests/media/library.test.ts               # 3 altTextForPick tests
docs/phase-10-report.md                   # this file
docs/deployment.md                        # Vercel section
```
