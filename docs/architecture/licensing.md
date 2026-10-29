# Phase 9 — licensing foundation (partial)

## Implemented

Migration `20261029020000_license_entitlements.sql` extends the Phase 8 plan/license records without seeding commercial values:

- Plans can carry a JSON object of explicit Boolean feature entitlements. No plan names, prices, limits, trial duration or feature grants are invented here.
- Tenant licenses can have a validity window. `land_expert_assign_license_window` is an authenticated RPC restricted to a trusted platform admin; it requires an explicit start and optional end, validates window/status/plan, updates the license, and appends an audit event.
- The legacy unbounded Phase 8 assignment RPC is revoked so it cannot issue a license without a start time. Previously assigned Phase 8 rows without a validity start fail closed in the feature check and must be reissued through the bounded RPC.
- `land_expert_can_use_feature(tenant_id, feature_key)` authorizes only a caller who is a member of that tenant, when the plan is enabled, the license is `trial` or `active`, the start time has arrived, the end has not passed, and the feature value is explicitly JSON `true`. Unknown/malformed keys, unconfigured licenses, delinquent/suspended/cancelled licenses, and cross-tenant requests return false.
- Once a plan is assigned, its key, display name, limits and features cannot be edited in place. A trusted operator must create a new plan key instead of changing issued entitlements retroactively. Plans remain editable before first assignment; only trusted database operators can create or edit plan rows.

## Verification

`apps/web/src/cloud/license-entitlements.test.ts` executes the Phase 8 and Phase 9 migrations in PGlite with minimal stand-ins for Supabase auth/roles. Six tests cover fail-closed defaults and legacy RPC revocation, platform-admin-only assignment, explicit feature grants, tenant isolation, start/end/status checks, window and plan validation, and plan immutability. This is local PostgreSQL-engine evidence only—not live Supabase/PostgREST testing, billing integration, or an independent security audit.

## Not implemented / not production-ready

- The feature check is an authorization primitive, **not an application-wide feature gate**. Existing local projects and cloud backups are not tenant resources and do not call this function. There are no seat/project quota checks, no project ownership migration, and no automatic blocking of any app feature.
- No payment provider, purchase flow, webhooks, invoices, renewals, refunds, proration, tax handling, grace-period policy, license key issuance/redemption, offline activation, or customer self-service billing UI exists.
- No plan rows or prices are seeded. A trusted operator must explicitly create plans and approved feature flags before assignment. Perpetual validity can currently be represented by a null end time; whether perpetual licenses should be supported is a product policy decision.
- The migration has not been applied to a live Supabase project. No live role grants, JWT claims, concurrent updates, clock skew, payment events, or multi-tenant usage have been tested. A previously active Phase 8 license with no validity window requires a deliberate reissue.
- Phase 8 remains partial: invitation/membership lifecycle, tenant data ownership, tenant switching and live cross-tenant review are still open. Licensing depends on those ownership/resource decisions before usage caps can be safely enforced.

Do not sell, activate, or describe plan limits as enforced until a pricing/plan specification is approved, feature checks are wired into server/database authorization boundaries, usage is tied to tenant-owned data, billing state transitions are reviewed, and the migrations are validated against a disposable Supabase project.
