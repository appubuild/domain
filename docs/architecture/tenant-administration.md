# Phase 8 — tenant administration foundation (partial)

## Implemented

Migration `20261029010000_tenants_and_admin.sql` adds a database-side starting point for organizations (tenants):

- Tenant records, memberships, roles (`owner`, `admin`, `surveyor`, `viewer`), plan catalog, per-tenant license state, platform-admin registry and tenant audit events.
- RLS read rules scope tenants, memberships and license state to a caller's own tenant memberships. Managers can read their tenant audit trail; provisioned platform administrators can review audit events across tenants.
- Authenticated clients have no direct write grants to these tables. Tenant creation, rename, role change and license assignment happen through narrowly scoped `SECURITY DEFINER` RPCs with a pinned `search_path` and explicit authorization checks.
- A small bilingual tenant panel is available after Supabase sign-in: it lists a user’s own organizations, role and informational license state, and offers create/rename controls. A tenant is created atomically with its caller as owner, an `unconfigured` license and an audit event. Only an existing tenant owner can change a non-owner member's role; self-promotion, changing the owner role, membership writes and platform-admin self-provisioning are not available to client callers.
- Only a platform administrator provisioned by a trusted database operator can assign an enabled plan. Plans are intentionally **not seeded**: commercial plan names, prices and caps have not been approved. License assignment is recorded in the tenant audit log. Audit details are restricted to small typed fields; credentials, cloud backups and free-form client metadata are not recorded.

The `admin` tenant role is not a platform administrator. A tenant owner cannot grant themselves platform privileges. Provisioning a first platform administrator is an out-of-band Supabase operator task and has not been performed in a live project.

## Verification

`apps/web/src/cloud/tenants.test.ts` runs the actual SQL migration in an isolated PGlite PostgreSQL engine. Six database-level tests cover atomic tenant initialization, tenant-separated RLS reads, audit visibility, direct-write denial, owner-only role updates, platform-admin-only license assignment, and resistance to platform-admin self-promotion. The test creates minimal `auth.users`, `auth.uid()`, `anon` and `authenticated` stand-ins; it is a useful local policy check, **not** a live Supabase integration test or independent security audit. Two UI interaction tests cover create, rename, role display, and disabling rename for a viewer using a mock Supabase client; they do not establish browser-level or provider integration.

## Explicitly incomplete / not production-ready

- The migration is not applied to a live Supabase project. The Phase 7 cloud-backup table remains account-owned; it has not been migrated into tenants or verified against this tenant model.
- The tenant panel is not a full administration console: there is no tenant switching, invitation/acceptance, member removal, ownership transfer, membership UI, or support workflow. Role editing can affect only an already provisioned membership; no public invitation path exists.
- Plans have no rows. Plan catalogs, pricing, renewals, expiry, payment, grace periods, seat/project enforcement, quotas and feature gating are not implemented. The limits columns are schema placeholders and do **not** enforce limits on local projects or cloud backups.
- No global admin console, platform-admin provisioning runbook implementation, support impersonation or abuse controls exist. Tenant creation rate limits are not implemented.
- Migrations and RPCs have not been independently reviewed, tested against Supabase/PostgREST's deployed roles, tested under concurrent transactions, or checked with multiple live accounts. The local PGlite tests do not establish production isolation.
- Tenant records currently have no suspend/delete lifecycle. Data retention, tenant export/deletion, audit retention and data-protection/legal requirements need decisions before launch.

Do not enable this migration in production until the schema has a security review, is tested on a disposable Supabase project with the intended grants and JWT claims, and data ownership/migration behavior is decided. Do not put service-role credentials in the browser or application environment exposed to Vite.

The tenant panel uses the current signed-in user to resolve their own role and calls only the protected database RPCs for writes. Displayed license state is informational: the plan catalog is empty by design, and no feature or usage is blocked by a license.
