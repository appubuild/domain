import { useEffect, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import './cloud.css';

const tenantsSchema = z.array(z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  created_at: z.string().datetime({ offset: true }),
}).strict());
const membershipsSchema = z.array(z.object({
  tenant_id: z.string().uuid(), role: z.enum(['owner', 'admin', 'surveyor', 'viewer']),
}).strict());
const licensesSchema = z.array(z.object({
  tenant_id: z.string().uuid(),
  status: z.enum(['unconfigured', 'trial', 'active', 'past_due', 'suspended', 'cancelled']),
  plan_key: z.string().nullable(),
}).strict());
type Tenant = z.infer<typeof tenantsSchema>[number] & { role: z.infer<typeof membershipsSchema>[number]['role']; status: z.infer<typeof licensesSchema>[number]['status']; plan: string | null };

export function TenantPanel({ client, userId }: { client: SupabaseClient; userId: string }) {
  const { t } = useTranslation();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true); setError(false); setMessage(null);
    try {
      const [tenantResult, membershipResult, licenseResult] = await Promise.all([
        client.from('land_expert_tenants').select('id,name,created_at').order('created_at', { ascending: true }),
        client.from('land_expert_tenant_memberships').select('tenant_id,role').eq('user_id', userId),
        client.from('land_expert_tenant_licenses').select('tenant_id,status,plan_key'),
      ]);
      if (tenantResult.error || membershipResult.error || licenseResult.error) throw new Error('Tenant list unavailable');
      const records = tenantsSchema.parse(tenantResult.data);
      const roles = membershipsSchema.parse(membershipResult.data);
      const licenses = licensesSchema.parse(licenseResult.data);
      const roleByTenant = new Map(roles.map(item => [item.tenant_id, item.role]));
      const licenseByTenant = new Map(licenses.map(item => [item.tenant_id, item]));
      const joined: Tenant[] = records.map(item => {
        const role = roleByTenant.get(item.id);
        const license = licenseByTenant.get(item.id);
        if (!role || !license) throw new Error('Tenant access details unavailable');
        return { ...item, role, status: license.status, plan: license.plan_key };
      });
      setTenants(joined);
    } catch {
      setTenants([]); setError(true);
    } finally { setBusy(false); setLoaded(true); }
  };

  useEffect(() => { void refresh(); }, [client, userId]);

  const createTenant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = name.trim();
    if (busy || !normalized || normalized.length > 100 || /[\u0000-\u001f\u007f]/u.test(normalized)) return;
    setBusy(true); setError(false); setMessage(null);
    try {
      const { data, error: rpcError } = await client.rpc('land_expert_create_tenant', { p_name: normalized });
      if (rpcError || !z.string().uuid().safeParse(data).success) throw new Error('Tenant could not be created');
      setName(''); await refresh(); setMessage('tenantCreated');
    } catch { setError(true); }
    finally { setBusy(false); }
  };

  const renameTenant = async (event: FormEvent<HTMLFormElement>, tenantId: string) => {
    event.preventDefault();
    const normalized = editName.trim();
    if (busy || !normalized || normalized.length > 100 || /[\u0000-\u001f\u007f]/u.test(normalized)) return;
    setBusy(true); setError(false); setMessage(null);
    try {
      const { error: rpcError } = await client.rpc('land_expert_rename_tenant', { p_tenant_id: tenantId, p_name: normalized });
      if (rpcError) throw rpcError;
      setEditing(null); setEditName(''); await refresh(); setMessage('tenantRenamed');
    } catch { setError(true); }
    finally { setBusy(false); }
  };

  return <section className="tenant-card" aria-labelledby="tenant-title">
    <header><h3 id="tenant-title">{t('tenantTitle')}</h3><p>{t('tenantDescription')}</p></header>
    <form className="tenant-create" onSubmit={event => { void createTenant(event); }}>
      <label htmlFor="tenant-name">{t('tenantNameLabel')}</label>
      <input id="tenant-name" value={name} onChange={event => setName(event.target.value)} maxLength={100} required disabled={busy} />
      <button type="submit" disabled={busy || !name.trim()}>{t('tenantCreate')}</button>
    </form>
    {!loaded ? <p role="status">{t('tenantLoading')}</p> : error && tenants.length === 0 ? <p role="alert">{t('tenantLoadError')}</p> : tenants.length === 0 ? <p>{t('tenantEmpty')}</p> : <ul className="tenant-list">
      {tenants.map(tenant => <li key={tenant.id}>
        <div className="tenant-main"><strong>{tenant.name}</strong><span>{t(`tenantRole_${tenant.role}`)} · {t(`tenantLicense_${tenant.status}`)}{tenant.plan ? ` (${tenant.plan})` : ''}</span></div>
        {editing === tenant.id ? <form className="tenant-rename" onSubmit={event => { void renameTenant(event, tenant.id); }}>
          <label className="sr-only" htmlFor={`tenant-rename-${tenant.id}`}>{t('tenantNameLabel')}</label>
          <input id={`tenant-rename-${tenant.id}`} value={editName} onChange={event => setEditName(event.target.value)} maxLength={100} required disabled={busy} />
          <button type="submit" disabled={busy || !editName.trim()}>{t('tenantSaveName')}</button>
          <button type="button" disabled={busy} onClick={() => { setEditing(null); setEditName(''); }}>{t('cancelProjectAction')}</button>
        </form> : <button type="button" disabled={busy || !['owner', 'admin'].includes(tenant.role)} aria-label={t('tenantRenameNamed', { name: tenant.name })} onClick={() => { setEditing(tenant.id); setEditName(tenant.name); }}>{t('tenantRename')}</button>}
      </li>)}
    </ul>}
    {error && tenants.length > 0 && <p role="alert">{t('tenantOperationError')}</p>}
    {message && <p role="status">{t(message)}</p>}
    <div className="tenant-footer"><button type="button" disabled={busy} onClick={() => { void refresh(); }}>{t('tenantRefresh')}</button><span>{t('tenantPlanNotice')}</span></div>
    {busy && loaded && <p role="status">{t('tenantWorking')}</p>}
  </section>;
}
