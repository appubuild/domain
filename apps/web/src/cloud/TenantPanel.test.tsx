import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SupabaseClient } from '@supabase/supabase-js';
import '../../../../packages/localization/src';
import { TenantPanel } from './TenantPanel';

afterEach(cleanup);

const tenantId = '55555555-5555-4555-8555-555555555555';
const userId = '11111111-1111-4111-8111-111111111111';

function createClient(initialName: string | null, role = 'owner') {
  let name = initialName;
  let status = 'unconfigured';
  const rpc = vi.fn(async (functionName: string, args: Record<string, string>) => {
    if (functionName === 'land_expert_create_tenant') name = args.p_name ?? null;
    if (functionName === 'land_expert_rename_tenant') name = args.p_name ?? null;
    return { data: tenantId, error: null };
  });
  const eqCalls: Array<[string, string]> = [];
  const from = vi.fn((table: string) => {
    const result = () => {
      if (table === 'land_expert_tenants') return { data: name ? [{ id: tenantId, name, created_at: '2026-10-29T00:00:00Z' }] : [], error: null };
      if (table === 'land_expert_tenant_memberships') return { data: name ? [{ tenant_id: tenantId, role }] : [], error: null };
      if (table === 'land_expert_tenant_licenses') return { data: name ? [{ tenant_id: tenantId, status, plan_key: null }] : [], error: null };
      return { data: [], error: null };
    };
    const builder = {
      select: vi.fn(() => builder),
      order: vi.fn(() => builder),
      eq: vi.fn((column: string, value: string) => { eqCalls.push([column, value]); return builder; }),
      then: (resolve: (value: ReturnType<typeof result>) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  });
  return { rpc, from, eqCalls, setStatus: (next: string) => { status = next; } };
}

describe('tenant administration controls', () => {
  it('creates and renames a tenant through the protected RPC controls', async () => {
    const user = userEvent.setup();
    const mock = createClient(null);
    render(<TenantPanel client={mock as unknown as SupabaseClient} userId={userId} />);
    await screen.findByText('You do not belong to an organization yet.');

    await user.type(screen.getByLabelText('Organization name'), 'North Field');
    await user.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(await screen.findByText('North Field')).toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledWith('land_expert_create_tenant', { p_name: 'North Field' });
    expect(await screen.findByText('Organization created. You are its owner.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rename North Field' }));
    const rename = screen.getByDisplayValue('North Field');
    await user.clear(rename);
    await user.type(rename, 'North District');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByText('North District')).toBeInTheDocument();
    expect(mock.rpc).toHaveBeenLastCalledWith('land_expert_rename_tenant', { p_tenant_id: tenantId, p_name: 'North District' });
    expect(await screen.findByText('Organization name updated.')).toBeInTheDocument();
  });

  it('shows role and license information but disables rename for a viewer', async () => {
    const mock = createClient('Community Group', 'viewer');
    mock.setStatus('active');
    render(<TenantPanel client={mock as unknown as SupabaseClient} userId={userId} />);
    expect(await screen.findByText('Viewer · Active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename Community Group' })).toBeDisabled();
    expect(mock.eqCalls).toContainEqual(['user_id', userId]);
    await waitFor(() => expect(mock.from).toHaveBeenCalledTimes(3));
  });
});
