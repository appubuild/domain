import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Session } from '@supabase/supabase-js';
import { z } from 'zod';
import { getCloudClient } from '../../../../packages/cloud/src/client';
import { openProjectRepository } from '../../../../packages/storage/src/projects';
import { createBackup, parseBackup } from '../../../../packages/storage/src/transfer';
import './cloud.css';

const metadata = z.array(z.object({ id: z.string().uuid(), created_at: z.string().datetime({ offset: true }) }).strict()).max(50);
type Row = z.infer<typeof metadata>[number];
type Message = { kind: 'success' | 'error'; key: string };

export function CloudPanel() {
  const { t, i18n } = useTranslation();
  const client = getCloudClient();
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(client));
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState<Message | null>(null);
  const mounted = useRef(true);
  const user = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    if (!client) return () => { mounted.current = false; };
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, next) => {
      if (!mounted.current) return;
      if (user.current !== (next?.user.id ?? null)) setRows([]);
      user.current = next?.user.id ?? null; setSession(next); setAuthLoading(false);
    });
    return () => { mounted.current = false; user.current = null; subscription.unsubscribe(); };
  }, [client]);
  const active = (id: string) => mounted.current && user.current === id;
  const authenticate = async (action: 'signIn' | 'signUp') => {
    if (!client || busy || !email.trim() || !password) return;
    setBusy(true); setMessage(null);
    try {
      const result = action === 'signIn'
        ? await client.auth.signInWithPassword({ email: email.trim(), password })
        : await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: new URL(`${import.meta.env.BASE_URL}settings`, window.location.origin).href } });
      if (result.error) throw result.error;
      if (mounted.current) { setPassword(''); if (action === 'signUp' && !result.data.session) setMessage({ kind: 'success', key: 'cloudSignupCheckEmail' }); }
    } catch { if (mounted.current) setMessage({ kind: 'error', key: 'cloudAuthError' }); }
    finally { if (mounted.current) setBusy(false); }
  };
  const signOut = async () => {
    if (!client || busy) return;
    setBusy(true); setMessage(null);
    try { const { error } = await client.auth.signOut({ scope: 'local' }); if (error) throw error; }
    catch { if (mounted.current) setMessage({ kind: 'error', key: 'cloudSignoutError' }); }
    finally { if (mounted.current) setBusy(false); }
  };
  const refresh = async () => {
    if (!client || !session || busy) return;
    const id = session.user.id; setBusy(true); setMessage(null);
    try {
      const result = await client.from('land_expert_cloud_backups').select('id,created_at').eq('owner_id', id).order('created_at', { ascending: false }).limit(50);
      if (result.error) throw result.error;
      const parsed = metadata.parse(result.data);
      if (active(id)) { setRows(parsed); setMessage({ kind: 'success', key: 'cloudRefreshed' }); }
    } catch { if (active(id)) setMessage({ kind: 'error', key: 'cloudListError' }); }
    finally { if (mounted.current) setBusy(false); }
  };
  const upload = async () => {
    if (!client || !session || busy || !window.confirm(t('cloudUploadConfirm'))) return;
    const id = session.user.id; setBusy(true); setMessage(null);
    let repo: Awaited<ReturnType<typeof openProjectRepository>> | null = null;
    try {
      repo = await openProjectRepository();
      const backup = createBackup(await repo.list());
      if (!active(id)) return;
      const result = await client.from('land_expert_cloud_backups').insert({ id: crypto.randomUUID(), owner_id: id, backup });
      if (result.error) throw result.error;
      if (active(id)) { setRows([]); setMessage({ kind: 'success', key: 'cloudUploadSuccess' }); }
    } catch { if (active(id)) setMessage({ kind: 'error', key: 'cloudUploadError' }); }
    finally { repo?.close(); if (mounted.current) setBusy(false); }
  };
  const restore = async (row: Row) => {
    if (!client || !session || busy) return;
    const id = session.user.id; setBusy(true); setMessage(null);
    let repo: Awaited<ReturnType<typeof openProjectRepository>> | null = null;
    try {
      const result = await client.from('land_expert_cloud_backups').select('backup').eq('id', row.id).eq('owner_id', id).single();
      if (result.error) throw result.error;
      const text = z.object({ backup: z.string() }).strict().parse(result.data).backup;
      const projects = parseBackup(text);
      if (!active(id) || !window.confirm(t('cloudRestoreConfirm', { count: projects.length }))) return;
      repo = await openProjectRepository();
      if (!active(id)) return;
      await repo.restore(projects);
      if (active(id)) setMessage({ kind: 'success', key: 'cloudRestoreSuccess' });
    } catch { if (active(id)) setMessage({ kind: 'error', key: 'cloudRestoreError' }); }
    finally { repo?.close(); if (mounted.current) setBusy(false); }
  };
  const remove = async (row: Row) => {
    if (!client || !session || busy || !window.confirm(t('cloudDeleteConfirm'))) return;
    const id = session.user.id; setBusy(true); setMessage(null);
    try {
      const result = await client.from('land_expert_cloud_backups').delete().eq('id', row.id).eq('owner_id', id).select('id');
      if (result.error || result.data?.length !== 1) throw result.error ?? new Error('Backup unavailable');
      if (active(id)) { setRows(existing => existing.filter(item => item.id !== row.id)); setMessage({ kind: 'success', key: 'cloudDeleteSuccess' }); }
    } catch { if (active(id)) setMessage({ kind: 'error', key: 'cloudDeleteError' }); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <section className="cloud-card" aria-labelledby="cloud-title">
    <h2 id="cloud-title">{t('cloudTitle')}</h2><p>{t('cloudPrivacy')}</p>
    {!client ? <p>{t('cloudNotConfigured')}</p> : authLoading ? <p role="status">{t('cloudLoading')}</p> : !session ? <>
      <form onSubmit={event => { event.preventDefault(); void authenticate('signIn'); }}>
        <label htmlFor="cloud-email">{t('cloudEmail')}</label><input id="cloud-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} />
        <label htmlFor="cloud-password">{t('cloudPassword')}</label><input id="cloud-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} maxLength={128} />
        <div className="cloud-actions"><button disabled={busy} type="submit">{t('cloudSignIn')}</button><button disabled={busy || !email.trim() || password.length < 6} type="button" onClick={() => { void authenticate('signUp'); }}>{t('cloudSignUp')}</button></div>
      </form><p>{t('cloudSessionHint')}</p>
    </> : <>
      <p>{t('cloudSignedIn', { email: session.user.email ?? '' })}</p>
      <div className="cloud-actions"><button type="button" disabled={busy} onClick={() => { void upload(); }}>{t('cloudUpload')}</button><button type="button" disabled={busy} onClick={() => { void refresh(); }}>{t('cloudRefresh')}</button><button type="button" disabled={busy} onClick={() => { void signOut(); }}>{t('cloudSignOut')}</button></div>
      <p>{t('cloudSnapshotHint')}</p>
      {rows.length > 0 && <ul>{rows.map(row => <li key={row.id}><span>{new Intl.DateTimeFormat(i18n.resolvedLanguage === 'bn' ? 'bn-BD' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.created_at))} <small>{row.id}</small></span><div className="cloud-actions"><button type="button" disabled={busy} onClick={() => { void restore(row); }} aria-label={t('cloudRestoreNamed', { id: row.id })}>{t('cloudRestore')}</button><button type="button" disabled={busy} onClick={() => { void remove(row); }} aria-label={t('cloudDeleteNamed', { id: row.id })}>{t('cloudDelete')}</button></div></li>)}</ul>}
    </>}
    {busy && <p role="status">{t('cloudWorking')}</p>}
    {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'cloud-error' : 'cloud-success'}>{t(message.key)}</p>}
  </section>;
}
