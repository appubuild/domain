// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

const owner = '11111111-1111-4111-8111-111111111111';
const otherOwner = '22222222-2222-4222-8222-222222222222';
const member = '33333333-3333-4333-8333-333333333333';
const platformAdmin = '44444444-4444-4444-8444-444444444444';

describe('tenant administration database security migration', () => {
  let db: PGlite;
  let firstTenant: string;
  let secondTenant: string;

  const asUser = async (id: string) => {
    await db.exec('reset role');
    await db.query('select set_config($1, $2, false)', ['request.jwt.claim.sub', id]);
    await db.exec('set role authenticated');
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
      insert into auth.users (id) values
        ('${owner}'), ('${otherOwner}'), ('${member}'), ('${platformAdmin}');
    `);
    const migration = await readFile(new URL('../../../../supabase/migrations/20261029010000_tenants_and_admin.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await asUser(owner);
    firstTenant = (await db.query<{ land_expert_create_tenant: string }>(
      "select public.land_expert_create_tenant('  North Survey  ')"
    )).rows[0]!.land_expert_create_tenant;
    await asUser(otherOwner);
    secondTenant = (await db.query<{ land_expert_create_tenant: string }>(
      "select public.land_expert_create_tenant('South Survey')"
    )).rows[0]!.land_expert_create_tenant;
    await db.exec('reset role');
    await db.query(
      "insert into public.land_expert_tenant_memberships (tenant_id, user_id, role) values ($1, $2, 'surveyor')",
      [firstTenant, member],
    );
    await db.query('insert into public.land_expert_platform_admins (user_id) values ($1)', [platformAdmin]);
    await db.query(`insert into public.land_expert_plans (plan_key, display_name, member_limit, project_limit, enabled)
      values ('approved-test', 'Approved test plan', 8, 25, true)`);
  }, 30_000);

  afterAll(async () => { await db.close(); });

  it('creates a tenant and owner atomically with an unconfigured license and audit event', async () => {
    const tenant = await db.query<{ name: string; role: string; status: string }>(`
      select t.name, m.role, l.status
      from public.land_expert_tenants t
      join public.land_expert_tenant_memberships m on m.tenant_id = t.id and m.user_id = $2
      join public.land_expert_tenant_licenses l on l.tenant_id = t.id
      where t.id = $1
    `, [firstTenant, owner]);
    expect(tenant.rows).toEqual([{ name: 'North Survey', role: 'owner', status: 'unconfigured' }]);
    expect((await db.query('select action from public.land_expert_audit_log where tenant_id = $1', [firstTenant])).rows)
      .toEqual([{ action: 'tenant.created' }]);
  });

  it('isolates tenant, membership, license and audit reads by membership and role', async () => {
    await asUser(owner);
    expect((await db.query('select id from public.land_expert_tenants')).rows).toEqual([{ id: firstTenant }]);
    expect((await db.query('select tenant_id from public.land_expert_tenant_memberships')).rows)
      .toEqual([{ tenant_id: firstTenant }, { tenant_id: firstTenant }]);
    expect((await db.query('select tenant_id from public.land_expert_tenant_licenses')).rows)
      .toEqual([{ tenant_id: firstTenant }]);
    expect((await db.query('select tenant_id from public.land_expert_audit_log')).rows)
      .toEqual([{ tenant_id: firstTenant }]);

    await asUser(otherOwner);
    expect((await db.query('select id from public.land_expert_tenants')).rows).toEqual([{ id: secondTenant }]);
    expect((await db.query('select tenant_id from public.land_expert_tenant_memberships')).rows)
      .toEqual([{ tenant_id: secondTenant }]);
    expect((await db.query('select tenant_id from public.land_expert_tenant_licenses')).rows)
      .toEqual([{ tenant_id: secondTenant }]);
    expect((await db.query('select tenant_id from public.land_expert_audit_log')).rows)
      .toEqual([{ tenant_id: secondTenant }]);

    await asUser(member);
    expect((await db.query('select tenant_id from public.land_expert_audit_log')).rows).toEqual([]);
  });

  it('rejects direct client writes and prevents non-owner role changes or owner self-demotion', async () => {
    await asUser(otherOwner);
    await expect(db.query('update public.land_expert_tenants set name = $1 where id = $2', ['Intrusion', firstTenant]))
      .rejects.toThrow();
    await expect(db.query('select public.land_expert_set_member_role($1, $2, $3)', [firstTenant, member, 'admin']))
      .rejects.toThrow('tenant owner required');

    await asUser(owner);
    await expect(db.query('select public.land_expert_set_member_role($1, $2, $3)', [firstTenant, owner, 'viewer']))
      .rejects.toThrow('non-owner membership not found');
    expect((await db.query('select role from public.land_expert_tenant_memberships where user_id = $1', [owner])).rows)
      .toEqual([{ role: 'owner' }]);
  });

  it('audits authorized owner changes and leaves membership invitation out of scope', async () => {
    await asUser(owner);
    await db.query('select public.land_expert_rename_tenant($1, $2)', [firstTenant, 'North District']);
    await db.query('select public.land_expert_set_member_role($1, $2, $3)', [firstTenant, member, 'admin']);
    const rows = await db.query<{ name: string; role: string; actions: string[] }>(`
      select t.name, m.role, array_agg(a.action order by a.id) as actions
      from public.land_expert_tenants t
      join public.land_expert_tenant_memberships m on m.tenant_id = t.id and m.user_id = $2
      join public.land_expert_audit_log a on a.tenant_id = t.id
      where t.id = $1 group by t.name, m.role
    `, [firstTenant, member]);
    expect(rows.rows[0]).toMatchObject({ name: 'North District', role: 'admin' });
    expect(rows.rows[0]?.actions).toEqual(['tenant.created', 'tenant.renamed', 'membership.role_changed']);

    await expect(db.query('insert into public.land_expert_tenant_memberships (tenant_id, user_id, role) values ($1, $2, $3)', [firstTenant, platformAdmin, 'viewer']))
      .rejects.toThrow();
  });

  it('requires a separately provisioned platform admin for license changes', async () => {
    await asUser(owner);
    await expect(db.query('select public.land_expert_assign_license($1, $2, $3)', [firstTenant, 'approved-test', 'active']))
      .rejects.toThrow('platform administrator required');
    expect((await db.query('select plan_key, status from public.land_expert_tenant_licenses where tenant_id = $1', [firstTenant])).rows)
      .toEqual([{ plan_key: null, status: 'unconfigured' }]);

    await asUser(platformAdmin);
    await db.query('select public.land_expert_assign_license($1, $2, $3)', [firstTenant, 'approved-test', 'active']);
    expect((await db.query("select action from public.land_expert_audit_log where tenant_id = $1 order by id desc limit 1", [firstTenant])).rows)
      .toEqual([{ action: 'license.assigned' }]);
    await db.exec('reset role');
    expect((await db.query('select plan_key, status, updated_by from public.land_expert_tenant_licenses where tenant_id = $1', [firstTenant])).rows)
      .toEqual([{ plan_key: 'approved-test', status: 'active', updated_by: platformAdmin }]);
    expect((await db.query("select action, details from public.land_expert_audit_log where tenant_id = $1 order by id desc limit 1", [firstTenant])).rows)
      .toEqual([{ action: 'license.assigned', details: { plan_key: 'approved-test', status: 'active' } }]);
  });

  it('does not expose platform-admin membership or allow self-promotion', async () => {
    await asUser(owner);
    await expect(db.query('select * from public.land_expert_platform_admins')).rejects.toThrow();
    await expect(db.query('insert into public.land_expert_platform_admins (user_id) values ($1)', [owner])).rejects.toThrow();
    await expect(db.query('select public.land_expert_assign_license($1, $2, $3)', [firstTenant, 'approved-test', 'active']))
      .rejects.toThrow('platform administrator required');
  });
});
