import * as React from 'react';
import { Brain, Cpu, Gauge, Plus, Sparkles, Trash2, Zap } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Separator, Slider, Switch } from '@/components/ui/primitives';
import { Modal, Tabs, useConfirm } from '@/components/ui/overlays';
import { BarsChart, DonutChart } from '@/components/ui/charts';
import { EmptyState, ProgressList, StatCard } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useAdminOverview, useAiModels, useAdminSettings, keys } from '@/hooks/queries';
import { adminService, aiService } from '@/services';
import { formatCurrency, formatNumber } from '@/lib/format';
import { useAdminAction, useAdminActor, StatusPill } from './shared';
import type { AiModelConfig } from '@/types/domain';

export default function AdminAiPage() {
  const actor = useAdminActor();
  const confirm = useConfirm();
  const { success } = useToast();
  const { data: models, isLoading, refetch } = useAiModels();
  const { data: settings } = useAdminSettings();
  const { data: overview } = useAdminOverview();
  const [tab, setTab] = React.useState<'models' | 'usage' | 'policy'>('models');
  const [editing, setEditing] = React.useState<AiModelConfig | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  const rows = (models ?? []) as AiModelConfig[];
  const totalUsage = rows.reduce((total, model) => total + model.used, 0);
  const totalSpend = rows.reduce((total, model) => total + model.used * model.creditsPerUse, 0);

  const save = useAdminAction(
    ({ id, patch }: { id: string; patch: Partial<AiModelConfig> }) => { const result = adminService.updateAiModel(id, patch); refetch(); return result; },
    { success: 'Model updated', detail: 'Routing changes apply to the next generation.', invalidate: [keys.aiModels] },
  );

  return (
    <div>
      <PageHeader title="AI controls" description="Model routing, credit costs, usage limits and the safety policy behind every AI action.">
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5" /> Add model</Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Configured models" value={formatNumber(rows.length)} change={`${rows.filter((model) => model.enabled).length} enabled`} icon={<Cpu className="h-4 w-4" />} />
        <StatCard label="Requests" value={formatNumber(overview?.ai.requests ?? 0)} change={`Top: ${overview?.ai.topFeature ?? '—'}`} icon={<Sparkles className="h-4 w-4" />} />
        <StatCard label="Credits consumed" value={formatNumber(totalUsage)} icon={<Zap className="h-4 w-4" />} />
        <StatCard label="Mock spend" value={formatCurrency(totalSpend)} change="credits × cost" icon={<Gauge className="h-4 w-4" />} />
      </div>

      <Tabs
        className="mt-4"
        value={tab}
        onValueChange={(value) => setTab(value as typeof tab)}
        size="sm"
        tabs={[
          { value: 'models', label: 'Models', count: rows.length },
          { value: 'usage', label: 'Usage' },
          { value: 'policy', label: 'Policy' },
        ]}
      />

      {tab === 'models' && (
        <Card className="mt-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Model registry</CardTitle>
            <CardDescription className="text-xs">Each purpose routes independently — writing, images, proofreading, translation and covers.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading && Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded bg-muted" />)}
            {rows.map((model) => (
              <div key={model.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-medium">{model.provider} · {model.model} <Badge variant="outline" className="text-2xs">{model.purpose}</Badge> <StatusPill value={model.enabled ? 'active' : 'disabled'} /></p>
                    <p className="text-2xs text-muted-foreground">{model.creditsPerUse} credits per use · {formatNumber(model.used)} / {formatNumber(model.monthlyLimit)} used this month · {model.latencyMs} ms median latency</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch checked={model.enabled} onCheckedChange={(checked) => save.mutate({ id: model.id, patch: { enabled: checked } })} />
                    <Button size="xs" variant="outline" onClick={() => setEditing(model)}>Edit</Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={async () => {
                        const ok = await confirm({ title: `Remove ${model.model}?`, description: 'Calls routed to this model fall back to the next enabled model for the same purpose.', destructive: true, confirmLabel: 'Remove model' });
                        if (ok) { adminService.removeAiModel(model.id); success('Model removed'); void refetch(); }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="mt-2">
                  <ProgressList items={[{ label: 'Monthly quota used', value: Math.min(100, Math.round((model.used / Math.max(1, model.monthlyLimit)) * 100)), hint: `${formatNumber(model.used)} of ${formatNumber(model.monthlyLimit)}` }]} />
                </div>
              </div>
            ))}
            {!isLoading && rows.length === 0 && <EmptyState icon={<Cpu className="h-5 w-5" />} title="No models configured" description="Add a provider model to enable AI features." />}
          </CardContent>
        </Card>
      )}

      {tab === 'usage' && (
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Usage by model</CardTitle></CardHeader>
            <CardContent><BarsChart data={rows.map((model) => ({ label: model.model.slice(0, 16), used: model.used }))} dataKey="used" currency={false} height={260} /></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Purpose mix</CardTitle></CardHeader>
            <CardContent>
              <DonutChart
                height={220}
                data={['writing', 'image', 'proofreading', 'translation', 'cover'].map((purpose) => ({
                  name: purpose,
                  value: rows.filter((model) => model.purpose === purpose).reduce((total, model) => total + model.used, 0),
                }))}
              />
            </CardContent>
          </Card>
          <Card className="lg:col-span-3">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Credit cost reference</CardTitle></CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {(['continue', 'improve', 'expand', 'summarize', 'chapter', 'translate'] as const).map((action) => (
                <div key={action} className="rounded border p-2 text-center">
                  <p className="text-xs font-medium capitalize">{action}</p>
                  <p className="text-2xs text-muted-foreground">{aiService.creditCost(action)} credits</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'policy' && (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Platform defaults</CardTitle>
              <CardDescription className="text-xs">These values feed new accounts and plan limits.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="flex items-center justify-between rounded border p-2 text-xs"><span>AI features enabled globally</span><StatusPill value={settings?.ai.enabled ? 'active' : 'disabled'} /></p>
              <p className="flex items-center justify-between rounded border p-2 text-xs"><span>Default provider</span><span className="font-medium">{settings?.ai.defaultProvider ?? '—'}</span></p>
              <p className="flex items-center justify-between rounded border p-2 text-xs"><span>Default monthly credits</span><span className="font-medium">{formatNumber(settings?.ai.monthlyCreditsDefault ?? 0)}</span></p>
              <p className="flex items-center justify-between rounded border p-2 text-xs"><span>Image generation for new accounts</span><StatusPill value={settings?.ai.imageGenerationDefault ? 'active' : 'disabled'} /></p>
              <p className="flex items-center justify-between rounded border p-2 text-xs"><span>Moderation pass on generated text</span><StatusPill value={settings?.ai.moderationEnabled ? 'active' : 'disabled'} /></p>
              <p className="flex items-center justify-between rounded border p-2 text-xs"><span>Shared book memory across devices</span><StatusPill value={settings?.ai.sharedMemory ? 'active' : 'disabled'} /></p>
              <Separator />
              <p className="text-2xs text-muted-foreground">Change the defaults in <strong>Settings → AI</strong>. Models above decide which provider serves each purpose.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Safety &amp; guardrails</CardTitle>
              <CardDescription className="text-xs">Applies to every generation and image request.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {[
                'Block prompts that request harmful or illegal content.',
                'Strip personally identifying information from prompts before routing.',
                'Rate-limit image generation per account per hour.',
                'Log every request with the acting user for audit.',
                'Never store API keys in the client — providers are called server-side in Phase 4.',
                'Show the model that produced each suggestion in the editor.',
              ].map((rule) => (
                <label key={rule} className="flex items-start gap-2 rounded border p-2">
                  <input type="checkbox" defaultChecked className="mt-0.5 accent-primary" />
                  <span>{rule}</span>
                </label>
              ))}
              <Separator />
              <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-2 text-2xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                No provider keys are required in this build — the AI layer is a deterministic mock with the same interface a real provider will implement.
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Modal
        open={Boolean(editing)}
        onOpenChange={(next) => !next && setEditing(null)}
        title={editing ? `Edit ${editing.model}` : 'Edit model'}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => { if (editing) { save.mutate({ id: editing.id, patch: editing }); setEditing(null); } }}>Save model</Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="m-provider" className="text-xs">Provider</Label><Input id="m-provider" value={editing.provider} onChange={(event) => setEditing({ ...editing, provider: event.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="m-model" className="text-xs">Model</Label><Input id="m-model" value={editing.model} onChange={(event) => setEditing({ ...editing, model: event.target.value })} /></div>
              <div className="space-y-1.5">
                <Label htmlFor="m-purpose" className="text-xs">Purpose</Label>
                <select id="m-purpose" value={editing.purpose} onChange={(event) => setEditing({ ...editing, purpose: event.target.value as AiModelConfig['purpose'] })} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                  {['writing', 'image', 'proofreading', 'translation', 'cover'].map((purpose) => <option key={purpose} value={purpose}>{purpose}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="m-credits" className="text-xs">Credits per use</Label><Input id="m-credits" type="number" value={editing.creditsPerUse} onChange={(event) => setEditing({ ...editing, creditsPerUse: Number(event.target.value) })} /></div>
              <div className="space-y-1.5"><Label htmlFor="m-limit" className="text-xs">Monthly limit</Label><Input id="m-limit" type="number" value={editing.monthlyLimit} onChange={(event) => setEditing({ ...editing, monthlyLimit: Number(event.target.value) })} /></div>
              <div className="space-y-1.5"><Label htmlFor="m-latency" className="text-xs">Latency (ms)</Label><Input id="m-latency" type="number" value={editing.latencyMs} onChange={(event) => setEditing({ ...editing, latencyMs: Number(event.target.value) })} /></div>
            </div>
            <Slider label="Quality score" value={editing.quality} min={1} max={100} onChange={(value) => setEditing({ ...editing, quality: value })} format={(value) => `${value}/100`} />
            <label className="flex items-center justify-between rounded border p-2 text-xs">Enabled <Switch checked={editing.enabled} onCheckedChange={(checked) => setEditing({ ...editing, enabled: checked })} /></label>
          </div>
        )}
      </Modal>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Add a model"
        description="Purpose routing picks the first enabled model for the requested capability."
        footer={<Button variant="outline" onClick={() => setCreateOpen(false)}>Close</Button>}
      >
        <div className="space-y-2">
          {[
            { provider: 'Anthropic', model: 'claude-sonnet', purpose: 'writing' as const },
            { provider: 'OpenAI', model: 'gpt-4o-mini', purpose: 'writing' as const },
            { provider: 'OpenAI', model: 'dall-e-3', purpose: 'image' as const },
            { provider: 'Stability', model: 'sdxl', purpose: 'cover' as const },
          ].map((preset) => (
            <Button
              key={preset.model}
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                adminService.createAiModel({
                  id: `ai_${preset.model.replace(/[^a-z0-9]/gi, '_')}`,
                  provider: preset.provider,
                  model: preset.model,
                  purpose: preset.purpose,
                  enabled: false,
                  creditsPerUse: preset.purpose === 'image' ? 8 : 2,
                  monthlyLimit: preset.purpose === 'image' ? 2000 : 50000,
                  used: 0,
                  latencyMs: preset.purpose === 'image' ? 3400 : 900,
                  quality: 82,
                });
                success('Model added', `${preset.provider} ${preset.model} is disabled until you enable it.`);
                setCreateOpen(false);
                void refetch();
              }}
            >
              <Brain className="h-3.5 w-3.5" /> {preset.provider} · {preset.model} ({preset.purpose})
            </Button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
