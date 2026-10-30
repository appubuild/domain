# Phase 7 — accounts and cloud backups (partial)

## Scope

This phase adds an optional Supabase-backed account system and manual cloud backup storage for local project data. Nothing here is required to use the app; the local-only mode continues to work with no account.

## Authentication

Only the Supabase email/password flow is supported. The user must enter credentials; no silent login, no SSO, no social providers. The session is kept in browser memory only and is lost on reload; it is never written to cookies or local storage by the app. Sign-up requires email confirmation. Password reset is not available.

## Cloud client safety

The client only initializes when `VITE_SUPABASE_URL` is a valid HTTPS `*.supabase.co` URL with no credentials in the URL itself, and `VITE_SUPABASE_ANON_KEY` is either a `sb_publishable_*` token or a JWT whose claims identify the `anon` role. Any other value — including a service-role key — causes the client to be disabled entirely, leaving the app in local-only mode.

## Data model

The database migration creates `public.land_expert_cloud_backups` with `id`, `owner_id` (FK to `auth.users`), `created_at` and a `backup` text column constrained to 1–10 MiB. Row-level security is enabled; `authenticated` may read, delete, and insert rows they own. The migration has not been applied to a live project and RLS has not been independently audited.

## Upload

A user must press the upload button explicitly. The app reads all readable local projects from IndexedDB, serializes them through the same bounded backup format used locally (max 100 projects, max 10 MiB, strict UTF-8, no unreadable records), and sends that JSON to the cloud. Unsaved drawings, temporary reference images and the current auth session are **not** included. If the read fails because of unreadable records, the upload is rejected; the user must resolve the diagnostic first.

## Restore

A restore downloads a single backup row, validates the format and then calls the local repository `restore` method. If any project ID in the backup already exists locally, the restore fails and no local copy is modified. The user must refresh the saved-project list after a successful restore.

## Deletion

Each row can be deleted explicitly by its owner. There is no trash, soft delete, or undo.

## Security and privacy

Data stored in the cloud is **not** end-to-end encrypted by the app. It travels over HTTPS to the Supabase service and is held per the service's retention and backup policies. The app cannot enforce additional server-side protections. Users should keep their own verified local backups in addition to any cloud copy.

## Evidence and limitations

Tests use a mocked Supabase HTTP API that returns a synthetic JWT signed by the mock. The mock verifies that the client sends the correct bearer token on each request and that the UI surfaces correct success and error states. The upload test reads a real IndexedDB record, serializes it through the production backup code and verifies the cloud body contains the expected geometry. The restore test confirms a second restore is rejected when IDs conflict and that restore after local deletion succeeds. The delete test confirms the row is removed from the mock list. Accessibility scans at 320 and 1366 px in both languages pass with no axe violations.

Real Supabase, email confirmation, RLS under concurrent clients, cross-device restore, password reset, other identity providers, rate limiting, provider outage recovery, and physical mobile devices remain unverified. Phase 7 is not production-ready.
