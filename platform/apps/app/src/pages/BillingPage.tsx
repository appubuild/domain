import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, BadgeCheck, Cloud, CreditCard, ExternalLink, KeyRound, LogOut, RefreshCw, ShieldQuestion, Sparkles, TrendingUp } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import type { LicenseState, SubscriptionState, UsageSummary } from '@/lib/types';
import { Badge, Button, EmptyState, ErrorState, Field, Modal, Panel, ProgressBar, Skeleton, Stat } from '@/components/ui';
import { useApp } from '@/store/app';
import { cn, formatCost, formatNumber, relativeTime } from '@/lib/utils';

type LicenseResponse = {
  license: LicenseState;
  subscription: SubscriptionState;
  deviceId: string;
  account: { provider: string; email: string; name: string | null; pictureUrl: string | null; signedInAt: string } | null;
  devMode: boolean;
  googleConfigured: boolean;
};

export function BillingPage() {
  const { toast, usage, refreshUsage } = useApp();
  const license = useQuery({ queryKey: ['license'], queryFn: () => apiGet<LicenseResponse>('/license') });
  const [activateOpen, setActivateOpen] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);

  React.useEffect(() => {
    void refreshUsage();
    // If Google redirected back here, finish the exchange and refresh entitlements.
    void completeGoogleSignIn().then(async (result) => {
      if (!result) return;
      toast({ title: result.ok ? 'Signed in' : 'Sign-in failed', description: result.message, tone: result.ok ? 'success' : 'error' });
      await license.refetch();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshUsage]);

  const refreshSubscription = async () => {
    setRefreshing(true);
    try {
      const res = await apiPost<{ subscription: SubscriptionState }>('/license/subscription/refresh', {});
      await license.refetch();
      toast({ title: 'Subscription state refreshed', description: res.subscription.reason, tone: res.subscription.status === 'active' ? 'success' : 'info' });
    } catch (err) {
      toast({ title: 'Refresh failed', description: err instanceof Error ? err.message : '', tone: 'error' });
    } finally {
      setRefreshing(false);
    }
  };

  const signOut = async () => {
    await apiPost('/auth/signout', {});
    await license.refetch();
    toast({ title: 'Signed out', tone: 'success' });
  };

  const l = license.data;

  return (
    <div className="mx-auto max-w-[1300px] space-y-5 px-6 py-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="p-5 lg:col-span-2">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg border border-holo-500/25 bg-holo-500/10 p-2 text-holo-300"><BadgeCheck className="h-4 w-4" /></div>
              <div>
                <h3 className="text-sm font-semibold text-slate-100">License</h3>
                <p className="text-[10px] text-slate-500">device {l?.deviceId ?? '—'}</p>
              </div>
            </div>
            {license.isLoading ? <Skeleton className="h-5 w-24" /> : <Badge tone={l?.license.mode === 'licensed' ? 'good' : l?.license.mode === 'development' ? 'accent' : l?.license.mode === 'expired' ? 'bad' : 'warn'}>{l?.license.mode ?? '—'}</Badge>}
          </div>
          {license.isLoading ? <Skeleton className="mt-3 h-16" /> : l ? (
            <>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-400">{l.license.reason}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <Stat label="Plan" value={l.license.plan} />
                <Stat label="Subject" value={l.license.subject ? l.license.subject.slice(0, 16) + '…' : '—'} hint={l.license.expiresAt ? `expires ${relativeTime(l.license.expiresAt)}` : 'no expiry'} />
                <Stat label="Validated" value={l.license.lastValidatedAt ? relativeTime(l.license.lastValidatedAt) : '—'} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {l.license.features.map((f) => <Badge key={f} tone="accent">{f}</Badge>)}
              </div>
              {l.devMode ? (
                <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-2.5 text-[10px] leading-relaxed text-amber-200/70">
                  Development mode is active because <code className="font-mono">AURA_DEV_LICENSE=1</code> is set on the server. This is a local development convenience, not a purchased license — it disappears when the variable is removed. There is no simulated checkout anywhere in this build.
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={() => setActivateOpen(true)}><KeyRound className="h-3.5 w-3.5" /> Activate license</Button>
                {l.license.mode !== 'unlicensed' ? <Button size="sm" variant="ghost" onClick={async () => { await apiPost('/license/deactivate', {}); await license.refetch(); toast({ title: 'License deactivated', tone: 'success' }); }}>Deactivate</Button> : null}
              </div>
            </>
          ) : license.error ? <ErrorState message={license.error.message} onRetry={() => void license.refetch()} /> : null}
        </Panel>

        <Panel className="p-5">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg border border-indigo-500/25 bg-indigo-500/10 p-2 text-indigo-300"><Cloud className="h-4 w-4" /></div>
            <h3 className="text-sm font-semibold text-slate-100">Cloud subscription</h3>
          </div>
          {license.isLoading ? <Skeleton className="mt-3 h-16" /> : l ? (
            <>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-slate-500">Status</span>
                <Badge tone={l.subscription.status === 'active' ? 'good' : 'neutral'}>{l.subscription.status}</Badge>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{l.subscription.reason}</p>
              {l.subscription.quotaTokensPerMonth > 0 ? (
                <div className="mt-3">
                  <p className="mb-1 flex justify-between text-[10px] text-slate-500"><span>Monthly quota</span><span>{formatNumber(l.subscription.quotaTokensPerMonth)} tokens</span></p>
                  <ProgressBar value={0} />
                </div>
              ) : null}
              <Button size="sm" variant="ghost" className="mt-3 w-full" onClick={() => void refreshSubscription()} loading={refreshing}><RefreshCw className="h-3 w-3" /> Refresh from backend</Button>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-600">Subscription state is only ever read from a real licensing backend. With none configured the app reports that honestly instead of inventing a plan.</p>
            </>
          ) : null}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><TrendingUp className="h-4 w-4 text-holo-400" /> API usage</h3>
            <Button size="sm" variant="subtle" onClick={() => void refreshUsage()} aria-label="Refresh usage"><RefreshCw className="h-3 w-3" /></Button>
          </div>
          {!usage ? <Skeleton className="h-24" /> : (
            <>
              <div className="grid gap-2 sm:grid-cols-4">
                <Stat label="Today requests" value={formatNumber(usage.today.requests)} />
                <Stat label="Today cost" value={formatCost(usage.today.costUsd)} hint="estimate" />
                <Stat label="7-day requests" value={formatNumber(usage.last7.requests)} />
                <Stat label="7-day cost" value={formatCost(usage.last7.costUsd)} hint="estimate" />
              </div>
              <h4 className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">By model</h4>
              {usage.byProvider.length === 0 ? <p className="py-3 text-center text-[11px] text-slate-600">No requests recorded yet.</p> : (
                <div className="space-y-1">
                  {usage.byProvider.map((row) => (
                    <div key={`${row.provider}-${row.model}`} className="flex items-center gap-2 rounded-lg bg-white/[0.02] px-2.5 py-1.5 text-[10px]">
                      <span className="min-w-0 flex-1 truncate"><span className="text-slate-400">{row.provider}</span><span className="text-slate-600"> / </span><span className="font-mono text-slate-300">{row.model}</span></span>
                      <span className="text-slate-500">{formatNumber(row.requests)} req</span>
                      <span className="text-slate-500">{formatNumber(row.inputTokens + row.outputTokens)} tok</span>
                      <span className="w-16 text-right text-slate-300">{formatCost(row.costUsd)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <p className="mt-3 text-[10px] leading-relaxed text-slate-600">Costs are estimates from a local price table applied to the token counts the provider returned. Your provider invoice is authoritative.</p>
        </Panel>

        <Panel className="p-5">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-100"><Sparkles className="h-4 w-4 text-holo-400" /> Google account</h3>
          {l?.account ? (
            <>
              <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                {l.account.pictureUrl ? <img src={l.account.pictureUrl} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" /> : <div className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-xs text-slate-300">{l.account.email.slice(0, 1).toUpperCase()}</div>}
                <div className="min-w-0">
                  <p className="truncate text-xs text-slate-200">{l.account.name ?? l.account.email}</p>
                  <p className="truncate text-[10px] text-slate-500">{l.account.email}</p>
                </div>
              </div>
              <p className="mt-2 text-[10px] text-slate-600">Signed in {relativeTime(l.account.signedInAt)}. The account is used to bind entitlements; it is not uploaded anywhere by this app.</p>
              <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={() => void signOut()}><LogOut className="h-3 w-3" /> Sign out</Button>
            </>
          ) : (
            <>
              <p className="text-[11px] leading-relaxed text-slate-400">{l?.googleConfigured ? 'Sign in with Google to link your license to an account.' : 'Google Sign-in requires GOOGLE_OAUTH_CLIENT_ID / SECRET set on the server. Without them the button would do nothing, so it is disabled instead of faked.'}</p>
              <Button size="sm" variant="ghost" className="mt-2 w-full" disabled={!l?.googleConfigured} onClick={() => void beginGoogleSignIn().catch((err: unknown) => toast({ title: 'Could not start sign-in', description: err instanceof Error ? err.message : 'Unknown error', tone: 'error' }))}>
                <ExternalLink className="h-3 w-3" /> {l?.googleConfigured ? 'Sign in with Google' : 'Not configured'}
              </Button>
            </>
          )}
          <div className="hairline my-3" />
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">What a license covers</h4>
          <ul className="space-y-1 text-[10px] leading-relaxed text-slate-500">
            <li className="flex gap-1.5"><Activity className="mt-0.5 h-2.5 w-2.5 shrink-0 text-holo-500" />The AURA app and all local features, permanently.</li>
            <li className="flex gap-1.5"><CreditCard className="mt-0.5 h-2.5 w-2.5 shrink-0 text-amber-500" />Not provider API usage — you pay OpenAI/Anthropic/Google directly.</li>
            <li className="flex gap-1.5"><Cloud className="mt-0.5 h-2.5 w-2.5 shrink-0 text-indigo-400" />Cloud sync/quota only if you subscribe to a real backend.</li>
            <li className="flex gap-1.5"><ShieldQuestion className="mt-0.5 h-2.5 w-2.5 shrink-0 text-slate-500" />No license checks phone home without a configured server.</li>
          </ul>
        </Panel>
      </div>

      <ActivateLicenseModal open={activateOpen} onClose={() => setActivateOpen(false)} onDone={() => license.refetch()} />
    </div>
  );
}

/**
 * Starts the real Google OAuth 2.0 authorization-code flow.
 *
 * We generate a random `state`, keep it in sessionStorage, and redirect to Google's consent
 * screen. The `?code=` return is handled by `completeGoogleSignIn()` below, which posts the
 * code to the server for a server-side exchange (the client secret never enters the browser).
 */
async function beginGoogleSignIn(): Promise<void> {
  const cfg = await (await fetch('/api/auth/google/config')).json() as { configured: boolean; clientId: string | null; redirectUri: string; note: string | null };
  if (!cfg.configured || !cfg.clientId) throw new Error(cfg.note ?? 'Google OAuth is not configured on this server.');
  const state = crypto.randomUUID();
  sessionStorage.setItem('aura.oauth.state', state);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

/** Reads `?code`/`?state` on return and completes the exchange; returns true when handled. */
export async function completeGoogleSignIn(): Promise<{ ok: boolean; message: string } | null> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) return null;
  const expected = sessionStorage.getItem('aura.oauth.state');
  if (!expected || state !== expected) {
    return { ok: false, message: 'OAuth state mismatch — the sign-in response was not initiated by this window.' };
  }
  sessionStorage.removeItem('aura.oauth.state');
  const redirectUri = `${url.origin}/billing`;
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, redirectUri }),
    });
    const payload = (await res.json()) as { account?: { email: string }; error?: string };
    url.search = '';
    window.history.replaceState({}, '', url.toString());
    return res.ok ? { ok: true, message: `Signed in as ${payload.account?.email ?? 'your account'}` } : { ok: false, message: payload.error ?? `Sign-in failed (${res.status})` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Sign-in failed' };
  }
}

function ActivateLicenseModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<unknown> }) {
  const { toast } = useApp();
  const [key, setKey] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ ok: boolean; message: string }>('/license/activate', { key: key.trim() });
      if (!res.ok) throw new Error(res.message);
      toast({ title: 'License activated', description: res.message, tone: 'success' });
      onClose();
      setKey('');
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Activation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Activate license" description="Paste the license key from your purchase email. The key is verified cryptographically offline against your device binding — no fake success, no network call required." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void submit()} loading={busy} disabled={key.trim().length < 10}>Activate</Button></>}>
      {error ? <div className="mb-2"><ErrorState message={error} /></div> : null}
      <Field label="License key" hint="Signature verification happens locally; invalid or expired keys are rejected with the specific reason.">
        <textarea value={key} onChange={(e) => setKey(e.target.value)} rows={4} className="input font-mono text-[10px]" placeholder="aura.lic.v1.…" spellCheck={false} />
      </Field>
    </Modal>
  );
}
