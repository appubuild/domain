// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

const owner = '11111111-1111-4111-8111-111111111111';
const otherUser = '22222222-2222-4222-8222-222222222222';
const platformAdmin = '44444444-4444-4444-8444-444444444444';
const planKey = 'synthetic-test-plan';

describe('license entitlement migration', () => {
  let db: PGlite;
  let tenant: string;
  let otherTenant: string;
  let startsAt: Date;
  let endsAt: Date;

  const asUser = async (id: string) => {
    await db.exec('reset role');
    await db.query('select set_config($1, $2, false)', ['request.jwt.claim.sub', id]);
    await db.exec('set role authenticated');
  };
  const assign = (status: string, from: Date, until: Date | null) => db.query(
    'select public.land_expert_assign_license_window($1, $2, $3, $4, $5)',
    [tenant, planKey, status, from, until],
  );
  const canUse = async (feature: string, forTenant = tenant) => {
    const result = await db.query<{ allowed: boolean }>(
      'select public.land_expert_can_use_feature($1, $2) as allowed', [forTenant, feature],
    );
    return result.rows[0]!.allowed;
  };

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      insert into auth.users (id) values ('${owner}'), ('${otherUser}'), ('${platformAdmin}');
    `);
    for (const file of [
      '20261029010000_tenants_and_admin.sql',
      '20261029020000_license_entitlements.sql',
    ]) {
      const migration = await readFile(new URL(`../../../../supabase/migrations/${file}`, import.meta.url), 'utf8');
      await db.exec(migration);
    }
    await asUser(owner);
    tenant = (await db.query<{ land_expert_create_tenant: string }>(
      "select public.land_expert_create_tenant('Licensing test')",
    )).rows[0]!.land_expert_create_tenant;
    await asUser(otherUser);
    otherTenant = (await db.query<{ land_expert_create_tenant: string }>(
      "select public.land_expert_create_tenant('Other tenant')",
    )).rows[0]!.land_expert_create_tenant;
    await db.exec('reset role');
    await db.query('insert into public.land_expert_platform_admins (user_id) values ($1)', [platformAdmin]);
    await db.query(`insert into public.land_expert_plans
      (plan_key, display_name, member_limit, project_limit, enabled, features)
      values ($1, 'Synthetic test only', 4, 8, true, '{"drawing":true,"premium_export":false}'::jsonb)`, [planKey]);
    const window = await db.query<{ starts_at: Date; ends_at: Date }>(
      "select now() - interval '1 hour' as starts_at, now() + interval '1 hour' as ends_at",
    );
    startsAt = window.rows[0]!.starts_at;
    endsAt = window.rows[0]!.ends_at;
  }, 30_000);

  afterAll(async () => { await db.close(); });

  it('fails closed for an unconfigured tenant and restricts assignment to platform admins', async () => {
    await asUser(owner);
    expect(await canUse('drawing')).toBe(false);
    await expect(assign('active', startsAt, endsAt)).rejects.toThrow('platform administrator required');
    await expect(db.query('select public.land_expert_assign_license($1, $2, $3)', [tenant, planKey, 'active']))
      .rejects.toThrow();
    await db.exec('reset role');
    await expect(db.query("update public.land_expert_tenant_licenses set status = 'active' where tenant_id = $1", [tenant]))
      .rejects.toThrow('land_expert_license_state_window');
  });

  it('grants only explicit true features during an enabled plan and valid active period', async () => {
    await asUser(platformAdmin);
    await assign('active', startsAt, endsAt);
    await asUser(owner);
    expect(await canUse('drawing')).toBe(true);
    expect(await canUse('premium_export')).toBe(false);
    expect(await canUse('unlisted_feature')).toBe(false);
    expect(await canUse('INVALID FEATURE')).toBe(false);
  });

  it('rejects access across tenants even when another tenant has a valid license', async () => {
    await asUser(platformAdmin);
    await assign('active', startsAt, endsAt);
    await asUser(owner);
    expect(await canUse('drawing')).toBe(true);
    expect(await canUse('drawing', otherTenant)).toBe(false);
    await asUser(otherUser);
    expect(await canUse('drawing', tenant)).toBe(false);
  });

  it('fails closed before start, after expiry, and for delinquent or suspended status', async () => {
    await asUser(platformAdmin);
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const past = new Date(Date.now() - 60 * 60 * 1000);
    await assign('active', future, new Date(future.getTime() + 60 * 60 * 1000));
    await asUser(owner);
    expect(await canUse('drawing')).toBe(false);
    await asUser(platformAdmin);
    await assign('active', past, new Date(past.getTime() + 1000));
    await asUser(owner);
    expect(await canUse('drawing')).toBe(false);
    await asUser(platformAdmin);
    await assign('past_due', startsAt, endsAt);
    await asUser(owner);
    expect(await canUse('drawing')).toBe(false);
    await asUser(platformAdmin);
    await assign('suspended', startsAt, endsAt);
    await asUser(owner);
    expect(await canUse('drawing')).toBe(false);
  });

  it('requires valid time windows and an enabled plan to issue a license', async () => {
    await asUser(platformAdmin);
    await expect(assign('active', endsAt, startsAt)).rejects.toThrow('invalid license validity window');
    await expect(assign('unconfigured', startsAt, endsAt)).rejects.toThrow('invalid license status');
    await db.exec('reset role');
    await db.query('update public.land_expert_plans set enabled = false where plan_key = $1', [planKey]);
    await asUser(platformAdmin);
    await expect(assign('active', startsAt, endsAt)).rejects.toThrow('enabled plan not found');
  });

  it('prevents retroactive edits to a plan once it has been assigned', async () => {
    await db.exec('reset role');
    await expect(db.query("update public.land_expert_plans set features = '{\"drawing\":false}' where plan_key = $1", [planKey]))
      .rejects.toThrow('issued plan definitions are immutable');
  });
});
