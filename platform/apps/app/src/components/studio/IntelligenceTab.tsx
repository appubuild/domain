import * as React from 'react';
import { Cpu, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import type { Character, ModelInfo, ProviderState } from '@/lib/types';
import { Badge, Button, Field, Panel, Select, Slider, Toggle, Skeleton } from '@/components/ui';
import { apiGet } from '@/lib/api';

export function CharacterStudioIntelligence({ draft, update }: { draft: Character; update: (m: (c: Character) => void) => void }) {
  const intel = draft.config.intelligence;
  const [providers, setProviders] = React.useState<ProviderState[] | null>(null);
  const [models, setModels] = React.useState<Record<string, ModelInfo[]>>({});
  const [loading, setLoading] = React.useState(true);

  const loadProviders = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ providers: ProviderState[]; models: Record<string, ModelInfo[]> }>('/providers');
      setProviders(res.providers);
      setModels(res.models ?? {});
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const setI = (patch: Partial<Character['config']['intelligence']>) => update((c) => Object.assign(c.config.intelligence, patch));
  const configuredProviders = (providers ?? []).filter((p) => p.configured);
  const selectedModels = intel.provider === 'auto' ? [] : models[intel.provider] ?? [];

  return (
    <div className="space-y-5">
      <Panel className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><Cpu className="h-4 w-4 text-holo-400" /> Brain</h3>
          <Button size="sm" variant="subtle" onClick={() => void loadProviders()} aria-label="Refresh providers"><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
        {loading ? <Skeleton className="h-10" /> : (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {(providers ?? []).map((p) => (
              <span key={p.key} className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${p.configured ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/5 text-slate-500'}`}>
                {p.configured ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                {p.label}
              </span>
            ))}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider" hint={configuredProviders.length === 0 ? 'No provider key configured yet — add one in AI Models.' : 'auto picks the best configured provider per request.'}>
            <Select value={intel.provider} onChange={(e) => setI({ provider: e.target.value as typeof intel.provider, model: '' })}>
              <option value="auto">auto</option>
              {(providers ?? []).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </Select>
          </Field>
          <Field label="Model" hint={intel.provider === 'auto' ? 'Chosen automatically per task complexity.' : selectedModels.length ? 'From the provider catalogue.' : 'Free text if the catalogue is unavailable.'}>
            {selectedModels.length > 0 ? (
              <Select value={intel.model} onChange={(e) => setI({ model: e.target.value })}>
                <option value="">Automatic</option>
                {selectedModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </Select>
            ) : (
              <input value={intel.model} onChange={(e) => setI({ model: e.target.value })} className="input" placeholder="e.g. gpt-4o-mini" />
            )}
          </Field>
        </div>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <Slider label="Temperature" value={intel.temperature} min={0} max={2} step={0.05} onChange={(temperature) => setI({ temperature })} format={(v) => v.toFixed(2)} />
          <Slider label="Max output tokens" value={intel.maxTokens} min={256} max={32000} step={256} onChange={(maxTokens) => setI({ maxTokens })} format={(v) => v.toLocaleString()} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Reasoning effort" hint="Maps to provider reasoning controls where supported.">
            <Select value={intel.reasoning} onChange={(e) => setI({ reasoning: e.target.value as typeof intel.reasoning })}>
              {['off', 'low', 'medium', 'high'].map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Fallback provider" hint="Used when the primary provider fails with a retryable error.">
            <Select value={intel.fallbackProvider} onChange={(e) => setI({ fallbackProvider: e.target.value as typeof intel.fallbackProvider })}>
              {['none', 'openai', 'anthropic', 'google'].map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </Field>
        </div>
        <Slider label="Context messages" value={intel.contextMessages} min={4} max={200} step={2} onChange={(contextMessages) => setI({ contextMessages })} format={(v) => `${v} messages`} />
      </Panel>

      <Panel className="p-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-100">Capability access</h3>
        <Toggle checked={intel.memoryAccess} onChange={(memoryAccess) => setI({ memoryAccess })} label="Memory" description="Inject retrieved memories into the system prompt." />
        <Toggle checked={intel.knowledgeAccess} onChange={(knowledgeAccess) => setI({ knowledgeAccess })} label="Knowledge base" description="Allow retrieval from this character's ingested documents." />
        <Toggle checked={intel.skillAccess} onChange={(skillAccess) => setI({ skillAccess })} label="Skills & tools" description="Let the model call enabled skills (still filtered by permissions)." />
      </Panel>
    </div>
  );
}
