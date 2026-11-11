import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Chrome, Globe, Info, Link2, MessageSquare, Plug, Plus, RefreshCw, Server, ShieldAlert, Terminal, Trash2, Cloud, FileText } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import type { McpServer } from '@/lib/types';
import type { Integration } from '@/lib/types';
import { Badge, Button, EmptyState, ErrorState, Field, Modal, Panel, Select, Skeleton } from '@/components/ui';
import { useApp } from '@/store/app';
import { cn, relativeTime } from '@/lib/utils';

const ICONS: Record<string, React.ReactNode> = {
  browser: <Chrome className="h-4 w-4" />,
  'mcp-stdio': <Terminal className="h-4 w-4" />,
  'mcp-http': <Globe className="h-4 w-4" />,
  slack: <MessageSquare className="h-4 w-4" />,
  'google-drive': <Cloud className="h-4 w-4" />,
  notion: <FileText className="h-4 w-4" />,
  webhook: <Link2 className="h-4 w-4" />,
};

export function IntegrationsPage() {
  const { system, toast } = useApp();
  const [addOpen, setAddOpen] = React.useState(false);
  const integrations = useQuery({ queryKey: ['integrations'], queryFn: () => apiGet<{ integrations: Integration[]; notes: string[] }>('/integrations') });
  const mcp = useQuery({ queryKey: ['mcp-servers'], queryFn: () => apiGet<{ servers: McpServer[] }>('/integrations/mcp') });

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Integrations</h2>
          <p className="mt-0.5 text-xs text-slate-500">Real transports only — each one reports its actual capability and blockers.</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /> Add connection</Button>
      </div>

      <Panel className="mb-4 p-3.5">
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-holo-400" />
          {system?.capabilities.computerControl
            ? 'Desktop bridge detected: browser automation and system integrations can execute on this machine.'
            : 'Server mode: browser automation, screen control and native app integrations require the Windows desktop runtime. They are listed with their true state rather than hidden.'}
        </p>
      </Panel>

      {integrations.isLoading ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div> : integrations.error ? <ErrorState message={integrations.error.message} onRetry={() => void integrations.refetch()} /> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(integrations.data?.integrations ?? []).map((i) => (
            <Panel key={i.key} className="panel-hover p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-holo-300">{ICONS[i.key] ?? <Plug className="h-4 w-4" />}</span>
                  <div>
                    <h3 className="text-xs font-semibold text-slate-100">{i.name}</h3>
                    <p className="text-[10px] text-slate-500">{i.category}</p>
                  </div>
                </div>
                <Badge tone={i.hasConfig ? 'good' : 'neutral'}>{i.status}</Badge>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{i.how}</p>
              <p className="mt-1.5 flex items-start gap-1 text-[10px] leading-relaxed text-slate-600"><AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0" />{i.needs}</p>
              {i.lastError ? <p className="mt-1.5 rounded bg-rose-500/[0.06] px-1.5 py-1 text-[10px] text-rose-300/80">{i.lastError}</p> : null}
              {i.lastError === null && i.hasConfig ? <p className="mt-1.5 text-[10px] text-emerald-400/70">Configured</p> : null}
            </Panel>
          ))}
        </div>
      )}

      <Panel className="mt-4 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400"><Server className="h-3.5 w-3.5" /> MCP servers</h3>
          <Button size="sm" variant="ghost" onClick={() => void mcp.refetch()} aria-label="Refresh MCP servers"><RefreshCw className="h-3 w-3" /></Button>
        </div>
        {mcp.isLoading ? <Skeleton className="h-12" /> : (mcp.data?.servers ?? []).length === 0 ? (
          <p className="py-4 text-center text-[11px] text-slate-600">No MCP servers registered. Add an HTTP/SSE endpoint you control to extend the tool set.</p>
        ) : (
          <div className="space-y-1">
            {mcp.data!.servers.map((srv) => (
              <McpRow key={srv.id} server={srv} onChanged={() => void mcp.refetch()} onError={(msg) => toast({ title: 'MCP error', description: msg, tone: 'error' })} />
            ))}
          </div>
        )}
      </Panel>

      {integrations.data?.notes?.length ? (
        <div className="mt-4 space-y-1">
          {integrations.data.notes.map((n) => (
            <p key={n} className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-[11px] leading-relaxed text-slate-500"><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />{n}</p>
          ))}
        </div>
      ) : null}

      <AddConnectionModal open={addOpen} onClose={() => setAddOpen(false)} onDone={async () => { await Promise.all([integrations.refetch(), mcp.refetch()]); }} />
    </div>
  );
}

function AddConnectionModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<unknown> }) {
  const { toast } = useApp();
  const [kind, setKind] = React.useState('mcp-http');
  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (kind !== 'mcp-http' && kind !== 'mcp-stdio') {
        throw new Error('Only MCP connections are configurable in this build. Webhooks are documented but not implemented — no fake save.');
      }
      await apiPost('/integrations/mcp', {
        name,
        transport: kind === 'mcp-http' ? 'http-sse' : 'stdio-command',
        endpoint: url,
      });
      toast({ title: 'MCP server saved', description: 'Use "Connect" on the server row to perform a real handshake and list its tools.', tone: 'success' });
      onClose();
      setName('');
      setUrl('');
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save connection');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add a connection" description="MCP servers extend the agent's tool set. Endpoints are verified and their tools are gated by the same permission system." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!name.trim() || !url.trim()}>Save</Button></>}>
      {error ? <div className="mb-2"><ErrorState message={error} /></div> : null}
      <Field label="Type">
        <Select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="mcp-http">MCP server (HTTP/SSE)</option>
          <option value="mcp-stdio">MCP server (stdio command)</option>
        </Select>
      </Field>
      <Field label="Display name"><input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="My private tools" maxLength={60} /></Field>
      <Field label={kind === 'mcp-stdio' ? 'Command' : 'Endpoint URL'} hint={kind === 'mcp-stdio' ? 'stdio servers are refused in server mode: they would run arbitrary local executables. Use the desktop build with explicit approval.' : 'Must be an https URL you control. Localhost is allowed; plain http is rejected.'}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} className="input font-mono text-[11px]" placeholder={kind === 'mcp-stdio' ? '/usr/local/bin/my-mcp-server' : 'https://tools.example.com/mcp'} />
      </Field>
    </Modal>
  );
}

function McpRow({ server, onChanged, onError }: { server: McpServer; onChanged: () => void; onError: (msg: string) => void }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const tools = React.useMemo(() => {
    try {
      return JSON.parse(server.tools_json) as Array<{ name: string }>;
    } catch {
      return [];
    }
  }, [server.tools_json]);

  const act = async (action: 'connect' | 'disconnect') => {
    setBusy(action);
    try {
      await apiPost(`/integrations/mcp/${server.id}/${action}`, {});
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'MCP operation failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg bg-white/[0.02] px-2.5 py-2">
      <span className={cn('dot', server.status === 'connected' ? 'bg-emerald-400' : server.status === 'error' ? 'bg-rose-400' : 'bg-slate-600')} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] text-slate-300">{server.name}</p>
        <p className="truncate text-[10px] text-slate-600">{server.transport} · {server.endpoint}{tools.length ? ` · ${tools.length} tools` : ''}</p>
      </div>
      <Badge className="px-1.5 py-0 text-[8px]">{server.status}</Badge>
      {server.status === 'connected' ? (
        <Button size="sm" variant="subtle" onClick={() => void act('disconnect')} loading={busy === 'disconnect'}>Disconnect</Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => void act('connect')} loading={busy === 'connect'}>Connect</Button>
      )}
    </div>
  );
}
