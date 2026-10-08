# Scriptora — end-to-end test script

Everything below runs against the live dev server (Vite, port 5173). No real backend,
no API keys — all state is mock data persisted in `localStorage` (`scriptora.db.v8`).

## 0. Bring the preview up

The dev server is started for you and shown as a **live preview**. If it ever stops
(e.g. after a sandbox restart, which also wipes `node_modules`), run:

```bash
npm run dev:auto     # installs dependencies when missing, then starts Vite on 0.0.0.0:5173
```

Manual equivalent: `npm ci && npm run dev`.

## 1. Demo accounts

| Role      | Email                  | Password      | Lands on            |
|-----------|------------------------|---------------|---------------------|
| Author    | demo@scriptora.app     | password123   | `/dashboard`        |
| Admin     | admin@scriptora.app    | password123   | `/admin`            |
| Moderator | moderator@scriptora.app| password123   | `/admin/reviews`    |

Each demo page also has a one-click "Sign in as demo author / admin" button.

## 2. Guided flows (fastest full sweep)

1. **Public first-run flow — 20 steps.** Open `/demo` → *Start guided run* → *Sign in as
   demo author* → walk the steps in order. A floating bar (bottom centre) shows
   `n/20`, Prev / Done / Next / Exit; steps tick themselves off as you land on them.
   Links: header nav ("Guided demo") and footer → Resources.
2. **Admin flow — 15 steps.** Sign in as admin → `/admin/demo` (sidebar: *Demo flow*) →
   *Start guided run*. Ends on the audit log, which should list everything you just did.

Progress lives in `localStorage` (`scriptora.demo.first-run.v1` / `scriptora.demo.admin.v1`),
so a refresh keeps your place. *Reset* on either demo page clears it.

## 3. Critical-path checklist (do these even if you skip the flows)

**Author path**
- [ ] Register a new account → onboarding survey → *Skip* also works → `/dashboard`.
- [ ] `/dashboard/books/new` → create via **Blank**, **Template**, **AI** and **Import**.
- [ ] `/dashboard/books` → switch All / Drafts / Published / Private / Archived / Trash,
      toggle grid⇄list, search, filter, sort; duplicate, rename, archive, trash, restore,
      delete permanently.
- [ ] Editor (`/dashboard/books/book_keeper_ledger/editor`):
      write text → *Saving… → Saved* indicator; `Ctrl/⌘+S`, undo/redo, find & replace,
      comments, versions (create + restore must change the document), Layers tab,
      Design mode drag/resize/rotate, Elements/Assets/AI/Structure tabs,
      page reorder by drag, automatic page numbers, auto TOC, header/footer,
      trim presets, Cover mode (front/spine/back + barcode + spine width).
- [ ] Navigate away mid-edit and back — no text loss.
- [ ] `/dashboard/exports` → run a PDF and an EPUB export, watch progress, then open a
      preflight report and use **Fix** / **Ignore** / **View issue**.
- [ ] `/dashboard/publishing` → all 10 steps; a step must block Next until valid.
- [ ] `/dashboard/marketplace` → set price, publish to marketplace, run a promo.
- [ ] `/marketplace` → open a title → buy it → `/read/:bookId`: page/scroll view, TOC,
      bookmarks, progress, font size, light/dark, fullscreen.
- [ ] `/dashboard/earnings`, `/analytics`, `/reviews`, `/library`, `/wishlist`,
      `/subscription`, `/settings` (9 sections), `/notifications`, `/activity`, `/search`.

**Admin path** (`/admin`)
- [ ] Dashboard + Analytics charts respond to the period selector.
- [ ] Users: search/filter, edit a user's plan, reset usage, suspend → restore (with confirmations).
- [ ] Books: approve / request changes / unpublish. Templates: feature + publish.
- [ ] Orders: open an order, issue a refund, see revenue change.
- [ ] Plans: lower a FREE-plan limit → the author app shows the upgrade prompt.
- [ ] Reviews: hide/restore. Reports: resolve with a note.
- [ ] CMS/Homepage/Pages/Blog: edit a section → the public site reflects it without a rebuild.
- [ ] Promotions, Notifications, AI, Storage, Flags (toggle a flag), Email (resend a failed event).
- [ ] Settings: change theme colours → whole app re-themes; toggle maintenance mode.
- [ ] Audit log: filter, inspect a before/after diff, export CSV, clear.

**Cross-cutting**
- [ ] Command palette `Ctrl/⌘+K`; shortcuts panel `?` / `Ctrl/⌘+/`.
- [ ] `/403`, `/500`, `/maintenance`, and any bad URL → 404 page.
- [ ] Light / dark / system themes — check contrast on tables, charts and modals.
- [ ] Resize to ~375px width: drawers open, no horizontal scrollbar anywhere.
- [ ] Keyboard-only pass on one form and one modal (focus trap, Escape closes).
- [ ] Refresh mid-session — books, settings, theme and CMS edits survive.

## 4. Reporting a bug

Send me: the **route**, what you clicked, what you expected, what happened, plus a
screenshot if it is visual. I fix on this same branch and the preview hot-reloads.

## 5. Known limitations (not bugs)

- Phase 1 is mock-only: no real database, payments, AI provider or file storage.
- `ThemeProvider` polls the CMS theme every 1.5 s (deliberate, cheap, being optimised).
- `PricingPage` fetches plans twice; `CreateBookPage`'s "Estimated pages" is a placeholder.
- PDF export is a simplified generator through a cast — it opens, but it is not a print engine.

## 6. Headless checks (no browser needed)

```bash
npm run smoke                                  # render every route anonymously
SMOKE_AS=demo  node scripts/smoke.mjs /dashboard /dashboard/books
SMOKE_AS=admin node scripts/smoke.mjs /admin /admin/settings /admin/audit-logs
SMOKE_BUILD=1 node scripts/smoke.mjs /        # rebuild the test bundle first
```

`scripts/smoke.mjs` bundles the app into one classic script (`vite.smoke.config.ts`)
and renders it in jsdom, so it catches the class of failure that typechecking misses:
a runtime exception that blanks the page. It prints rendered size, first text,
headings, link/button counts and any thrown error per route.

**Fixed by this harness:** a seed chapter (`mbook_saltstone` → "The Twenty-Minute Braise")
referenced `chapterBodies.saltandstone[3]`/`[4]` when the array only had three entries, so
`countWords(null)` threw while the seed was being built and **every** page rendered blank.
The seed now points at its own prose block, `stripHtml`/`countWords` tolerate null, and
`App.tsx` wraps the whole tree in `ErrorBoundary` so a future runtime error shows a
recoverable error screen instead of a white page.

## 7. Editor canvas regression (fixed)

Symptom: in Write and Design mode the page looked blank and you could not type.

Cause: `EditorPage` keeps `zoom` as a multiplier (1 = 100%) but `PageCanvas` consumed it as a
percentage, so the page box was computed as `5in x 96 x 0.01` = **4.8px** and the text was
scaled to 1%. Only the Cover/title pages (drawn with elements, not the flow editor) looked
sane, which is why it survived earlier checks.

Fix: the page is laid out at its natural pixel size (`480 x 768` for 5 x 8 in) and scaled
once with `transform: scale(zoom)`; the flow editor no longer scales itself. Also added
click-anywhere-on-the-page focus (`focus('end')`) and a full-height prose area, so a click
on empty space drops the caret into the text.

Guard: `npm run check:editor` asserts the page box is 480x768, that the prose holds the page
text, that clicking the page focuses the editor, that zoom-in scales to 1.1, and that Design
and Write modes both render.

## 8. Performance checks

```bash
npm run build && npm run report:size   # chunk sizes (raw + gzip) and initial download
npm run check:theme                    # theme written to the database reaches the UI
```

See `PERFORMANCE.md` for the before/after numbers, what changed (vendor chunk splitting,
no more 1.5 s theme polling, one `usePlans()` call instead of two) and what was deliberately
left alone.

## 9. Editor canvas upgrade checks (headless)

`npm run check:editor` now asserts behaviour instead of printing a transcript. It builds
the smoke bundle in jsdom and walks the real editor:

| Group | Assertions |
| --- | --- |
| Context toolbar | toolbar renders; font family/weight/size, highlight, colour, super/subscript, clear formatting, paragraph spacing, text direction, hyperlink, alignment |
| Page management | page actions menu opens; *Insert page after* increases the page count; thumbnails render |
| Chapters | collapse/expand toggle exists and the state actually changes |
| Elements library | entries render; Design mode activates the object layer; inserting an entry adds an object to the page; the new object appears in the layer list |
| Layers + lock | lock toggles exist, toggling changes the label (so a locked object can be unlocked), hide/show toggles exist |
| Preview parity | preview renders the same `data-page-id` canvas, read-only |
| Export safety | export modal shows *Canvas checks* with the page count |

Result on this branch: **RESULT: PASS**, `errors: []`.

Also re-run after the upgrade: `npm run smoke` (all routes OK), `npm run check:theme`
(PASS), `npm run build` (entry 490.6 kB raw / 149.6 kB gzip; EditorPage lazy at 643.3 kB /
190.1 kB gzip).

### Behaviour verified by hand before committing

* Write ↔ Design switching preserves text and objects (same model, different rendering).
* Overflow badge + *Continue on a new page* splits content and links the new page with
  `continuationOf`; on a page with nothing after the cursor the action explains itself.
* Text floats respect an image's area in both the editor and preview (same component).
* Space-separated repo path on Windows still works (`npm run dev:recover`).
