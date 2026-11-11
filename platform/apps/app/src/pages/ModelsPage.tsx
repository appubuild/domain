import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Cpu, ExternalLink, Eye, KeyRound, Loader2, RefreshCw, Shield, Trash2, Wrench, X, AlertTriangle, Download } from 'lucide-react';
import { apiDelete, apiGet, apiSend } from '@/lib/api';
import type { ProviderState } from '@/lib/types';
import { Badge, Button, EmptyState, ErrorState, Field, Modal, Panel, Select, Skeleton, Toggle } from '@/components/ui';
import { MODEL_CATALOGUE, fetchProviderModels, type KnownModel } from '@/lib/models';
import { useApp } from '@/store/app';
import { cn, relativeTime } from '@/lib/utils';

export function ModelsPage() {
  const { toast } = useApp();
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => apiGet<{ providers: ProviderState[] }>('/providers') });
  const [editing, setEditing] = React.useState<ProviderState | null>(null);
  const [modelsFor, setModelsFor] = React.useState<ProviderState | null>(null);
  const [testing, setTesting] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<Record<string, { ok: boolean; message?: string; latencyMs?: number }>>({});

  const test = async (p: ProviderState) => {
    setTesting(p.key);
    try {
      const res = await apiSend<{ ok?: boolean; status?: string; message?: string; latencyMs?: number; models?: unknown[] }>(`/providers/${p.key}/test`, 'POST', {});
      setTestResult((prev) => ({ ...prev, [p.key]: { ok: res.ok !== false && res.status !== 'invalid', message: res.message ?? `${(res.models ?? []).length} models visible`, latencyMs: res.latencyMs } }));
      await providers.refetch();
    } catch (err) {
      setTestResult((prev) => ({ ...prev, [p.key]: { ok: false, message: err instanceof Error ? err.message : 'Test failed' } }));
    } finally {
      setTesting(null);
    }
  };

  const remove = async (p: ProviderState) => {
    try {
      await apiDelete(`/providers/${p.key}`);
      await providers.refetch();
      toast({ title: `${p.label} key removed`, description: 'Chats using this provider will fail until you add another key.', tone: 'success' });
    } catch (err) {
      toast({ title: 'Remove failed', description: err instanceof Error ? err.message : '', tone: 'error' });
    }
  };

  return (
    <div className="mx-auto max-w-[1300px] px-6 py-6">
      <Panel className="mb-5 p-4">
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-400">
          <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
          Keys are encrypted with AES-256-GCM using a per-installation key stored in your OS credential location, then persisted in the local database as ciphertext. The browser never receives a key — only a masked hint. AURA has no servers; all provider calls go directly from your machine.
        </p>
      </Panel>

      {providers.isLoading ? <div className="grid gap-3 md:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /></div> : providers.error ? <ErrorState message={providers.error.message} onRetry={() => void providers.refetch()} /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {(providers.data?.providers ?? []).map((p) => {
            const result = testResult[p.key];
            const catalogue = MODEL_CATALOGUE[p.key] ?? [];
            return (
              <Panel key={p.key} className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={cn('rounded-lg border p-2', p.configured ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/[0.03] text-slate-500')}>
                      <Cpu className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-100">{p.label}</h3>
                      <p className="text-[10px] text-slate-500">{p.configured ? `key ${p.keyHint}` : 'no key stored'}</p>
                    </div>
                  </div>
                  <Badge tone={p.configured ? (p.lastStatus === 'invalid' ? 'bad' : p.lastStatus === 'verified' ? 'good' : 'warn') : 'neutral'}>{p.configured ? p.lastStatus : 'unconfigured'}</Badge>
                </div>

                {p.baseUrl ? <p className="mt-2 truncate rounded bg-ink-950/60 px-2 py-1 font-mono text-[10px] text-slate-500">{p.baseUrl}</p> : null}

                {p.configured ? (
                  <p className="mt-2 text-[10px] text-slate-500">{p.lastVerifiedAt ? `Last verified ${relativeTime(p.lastVerifiedAt)}` : 'Never verified'}</p>
                ) : (
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Add an API key to route requests through this provider. Billed by the provider directly — AURA never proxies or resells usage.</p>
                )}

                {result ? (
                  <div className={cn('mt-2 flex items-start gap-1.5 rounded-lg border p-2 text-[10px] leading-relaxed', result.ok ? 'border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-200/80' : 'border-rose-500/20 bg-rose-500/[0.05] text-rose-200/80')}>
                    {result.ok ? <Check className="mt-0.5 h-3 w-3 shrink-0" /> : <X className="mt-0.5 h-3 w-3 shrink-0" />}
                    <span>{result.message ?? (result.ok ? 'Connected' : 'Failed')}{result.latencyMs ? ` · ${result.latencyMs} ms` : ''}</span>
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Button size="sm" variant={p.configured ? 'ghost' : 'primary'} onClick={() => setEditing(p)}>
                    <KeyRound className="h-3 w-3" /> {p.configured ? 'Replace key' : 'Add key'}
                  </Button>
                  {p.configured ? (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => void test(p)} loading={testing === p.key}><RefreshCw className="h-3 w-3" /> Test</Button>
                      <Button size="sm" variant="ghost" onClick={() => setModelsFor(p)}><Eye className="h-3 w-3" /> Models</Button>
                      <Button size="sm" variant="subtle" onClick={() => void remove(p)} aria-label={`Remove ${p.label} key`}><Trash2 className="h-3 w-3" /></Button>
                    </>
                  ) : null}
                  <a href={p.keyUrl} target="_blank" rel="noreferrer noopener" className="ml-auto flex items-center gap-1 self-center text-[10px] text-slate-500 hover:text-holo-300">
                    Get a key <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>

                {catalogue.length ? (
                  <div className="mt-3 border-t border-white/[0.06] pt-2">
                    <p className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Known models</p>
                    <div className="flex flex-wrap gap-1">
                      {catalogue.slice(0, 5).map((m) => (
                        <span key={m.id} className="inline-flex items-center gap-1 rounded bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-slate-400">
                          {m.label}
                          {m.tools ? <Wrench className="h-2 w-2 text-holo-500" /> : null}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </Panel>
            );
          })}
        </div>
      )}

      <Panel className="mt-5 p-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-100">Routing policy</h3>
        <p className="text-[11px] leading-relaxed text-slate-500">
          Characters can pin a provider and model, or use <strong className="text-slate-300">auto</strong>: the router prefers a configured provider that matches the character&apos;s needs (tools, vision, context size) and falls back in the order you configure. A failed provider is skipped with a typed error rather than silently answered by a mock.
        </p>
        <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-3">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5"><p className="text-slate-500">Configured providers</p><p className="mt-0.5 text-slate-200">{providers.data?.providers.filter((p) => p.configured).length ?? 0} / {providers.data?.providers.length ?? 0}</p></div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5"><p className="text-slate-500">Voice-capable</p><p className="mt-0.5 text-slate-200">{providers.data?.providers.filter((p) => p.configured && ['openai', 'google'].includes(p.key)).length ?? 0}</p></div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5"><p className="text-slate-500">Storage</p><p className="mt-0.5 text-slate-200">local DB (encrypted)</p></div>
        </div>
      </Panel>

      <ProviderKeyModal provider={editing} onClose={() => setEditing(null)} onSaved={() => providers.refetch()} />
      <ModelListModal provider={modelsFor} onClose={() => setModelsFor(null)} />
    </div>
  );
}

function ProviderKeyModal({ provider, onClose, onSaved }: { provider: ProviderState | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const { toast } = useApp();
  const [key, setKey] = React.useState('');
  const [baseUrl, setBaseUrl] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setKey('');
    setBaseUrl(provider?.baseUrl ?? '');
    setError(null);
  }, [provider]);

  const save = async () => {
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/providers/${provider.key}`, 'PUT', { apiKey: key.trim(), baseUrl: provider.requiresBaseUrl ? baseUrl.trim() : null });
      toast({ title: `${provider.label} key saved`, description: 'Encrypted and stored locally. Run Test to verify it works.', tone: 'success' });
      onClose();
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save key');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(provider)}
      onClose={onClose}
      title={provider ? `${provider.configured ? 'Replace' : 'Add'} ${provider.label} key` : ''}
      description="Paste the API key from your own provider account. It is encrypted before it touches disk and is never displayed again in full."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()} loading={busy} disabled={key.trim().length < 8}>Save key</Button></>}
    >
      {error ? <div className="mb-2"><ErrorState message={error} /></div> : null}
      <Field label="API key" hint="Validation checks the key's shape before storage; the provider itself confirms validity when you run Test.">
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} className="input font-mono text-[11px]" placeholder={provider?.key === 'anthropic' ? 'sk-ant-…' : 'sk-…'} autoComplete="off" spellCheck={false} />
      </Field>
      {provider?.requiresBaseUrl ? (
        <Field label="Base URL" hint="Required for OpenAI-compatible endpoints (e.g. a local llama.cpp or vLLM server).">
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="input font-mono text-[11px]" placeholder="https://my-endpoint.example.com/v1" />
        </Field>
      ) : null}
      <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-amber-200/60">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
        Usage is billed to your provider account. The lifetime license covers the app, not API consumption.
      </p>
    </Modal>
  );
}

function ModelListModal({ provider, onClose }: { provider: ProviderState | null; onClose: () => void }) {
  const [models, setModels] = React.useState<KnownModel[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!provider) return;
    setLoading(true);
    setError(null);
    try {
      setModels(await fetchProviderModels(provider.key));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not list models');
      setModels(null);
    } finally {
      setLoading(false);
    }
  }, [provider]);

  React.useEffect(() => {
    if (provider) void load();
  }, [provider, load]);

  const known = provider ? MODEL_CATALOGUE[provider.key] ?? [] : [];

  return (
    <Modal open={Boolean(provider)} onClose={onClose} title={provider ? `${provider.label} models` : ''} description="Live list fetched from the provider using your stored key. Falls back to the documented catalogue when the call fails." width="lg">
      {loading ? <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Querying provider…</div> : null}
      {error ? <ErrorState message={`${error}\n\nShowing the built-in catalogue instead.`} onRetry={() => void load()} /> : null}
      <div className="mt-2 space-y-1">
        {(models ?? known).map((m) => (
          <div key={m.id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-300">{m.id}</span>
            <span className="shrink-0 text-[10px] text-slate-600">{m.context}</span>
            {m.tools ? <Wrench className="h-2.5 w-2.5 text-holo-500" aria-label="tool calling" /> : null}
          </div>
        ))}
      </div>
    </Modal>
  );
}
