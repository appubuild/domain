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
