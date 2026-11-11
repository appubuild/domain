/**
 * Model catalogue knowledge kept in the client for pickers. These are *labels for known
 * model ids*, not a claim about what your account can access — the provider is the
 * authority. `fetchProviderModels()` asks the provider directly (server-proxied) when a
 * key exists, and the UI prefers that live list.
 */
export type KnownModel = { id: string; label: string; context: string; tools: boolean; vision: boolean; audio: boolean; note?: string };

export const MODEL_CATALOGUE: Record<string, KnownModel[]> = {
  openai: [
    { id: 'gpt-4.1', label: 'GPT-4.1', context: '1M', tools: true, vision: true, audio: false, note: 'Strong general reasoning' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', context: '1M', tools: true, vision: true, audio: false, note: 'Cost-efficient default' },
    { id: 'gpt-4.1-nano', label: 'GPT-4.1 nano', context: '1M', tools: true, vision: true, audio: false, note: 'Fastest, cheapest' },
    { id: 'gpt-4o', label: 'GPT-4o', context: '128k', tools: true, vision: true, audio: true },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini', context: '128k', tools: true, vision: true, audio: true },
    { id: 'o4-mini', label: 'o4-mini', context: '200k', tools: true, vision: true, audio: false, note: 'Reasoning model' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', context: '200k', tools: true, vision: true, audio: false, note: 'Best coding / agentic balance' },
    { id: 'claude-opus-4-1', label: 'Claude Opus 4.1', context: '200k', tools: true, vision: true, audio: false, note: 'Most capable, priciest' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', context: '200k', tools: true, vision: true, audio: false, note: 'Fast and cheap' },
  ],
  google: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', context: '1M', tools: true, vision: true, audio: true },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', context: '1M', tools: true, vision: true, audio: true, note: 'Balanced default' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', context: '1M', tools: true, vision: true, audio: true },
    { id: 'models/gemini-2.0-flash-live-001', label: 'Gemini 2.0 Flash Live', context: '128k', tools: true, vision: true, audio: true, note: 'Live voice bridge' },
  ],
  'openai-compatible': [
    { id: 'local-model', label: 'Configured endpoint model', context: '—', tools: true, vision: false, audio: false, note: 'Set the exact id your endpoint expects' },
  ],
};

export async function fetchProviderModels(provider: string): Promise<KnownModel[]> {
  const res = await fetch(`/api/providers/${provider}/models`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error?: string };
    throw new Error(body.error ?? `Could not list models (${res.status})`);
  }
  const data = (await res.json()) as { models: Array<{ id: string; label?: string }> };
  return data.models.map((m) => ({ id: m.id, label: m.label ?? m.id, context: '—', tools: true, vision: false, audio: false }));
}
