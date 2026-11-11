import { ProviderError, type ChatRequest, type ChatStreamEvent, type ModelProvider, type ProviderKey } from '../providers/types.js';
import { OpenAiProvider } from '../providers/openai.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { GoogleProvider } from '../providers/google.js';

export type RouterTarget = {
  provider: ProviderKey;
  model: string;
};

export type RouterDeps = {
  /** Resolve a decrypted API key for a provider, or null if not configured. */
  getApiKey: (provider: ProviderKey) => Promise<string | null>;
  /** Optional OpenAI-compatible base URLs configured by the user. */
  getBaseUrl?: (provider: ProviderKey) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  /** Default model per provider, used when a character leaves `model` empty. */
  defaultModel?: (provider: ProviderKey) => string | null;
};

export const DEFAULT_MODELS: Record<ProviderKey, string> = {
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-sonnet-4-5',
  google: 'gemini-2.5-flash',
  'openai-compatible': 'gpt-4o-mini',
};

const KEY_LABEL: Record<ProviderKey, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  'openai-compatible': 'OpenAI-compatible endpoint',
};

/**
 * Model Router: chooses the provider/model for a turn and streams with fallback.
 * - explicit provider+model from character config wins
 * - `auto` picks the first configured provider in a stable preference order
 * - fallback only triggers on retryable errors (never on auth/invalid-request), so a
 *   bad key surfaces immediately instead of silently switching brains
 */
export class ModelRouter {
  constructor(private readonly deps: RouterDeps) {}

  async availableProviders(): Promise<ProviderKey[]> {
    const out: ProviderKey[] = [];
    for (const p of ['openai', 'anthropic', 'google', 'openai-compatible'] as ProviderKey[]) {
      if (await this.deps.getApiKey(p)) out.push(p);
    }
    return out;
  }

  async resolve(preferred: { provider: ProviderKey | 'auto'; model: string; fallbackProvider?: ProviderKey | 'none' }): Promise<RouterTarget> {
    const order: ProviderKey[] =
      preferred.provider === 'auto'
        ? ['openai', 'anthropic', 'google', 'openai-compatible']
        : [preferred.provider, ...(preferred.fallbackProvider && preferred.fallbackProvider !== 'none' ? [preferred.fallbackProvider] : [])];

    for (const p of order) {
      const key = await this.deps.getApiKey(p);
      if (!key) continue;
      const model = preferred.provider !== 'auto' && preferred.model ? preferred.model : this.deps.defaultModel?.(p) ?? DEFAULT_MODELS[p];
      return { provider: p, model };
    }
    throw new ProviderError(
      'No AI provider is configured. Add an API key in Settings → AI Providers, or start a local model server and add it as an OpenAI-compatible provider.',
      'not_configured',
    );
  }

  async provider(providerKey: ProviderKey): Promise<ModelProvider> {
    const apiKey = await this.deps.getApiKey(providerKey);
    if (!apiKey) throw new ProviderError(`${KEY_LABEL[providerKey]} is not configured.`, 'not_configured');
    const baseUrl = (await this.deps.getBaseUrl?.(providerKey)) ?? undefined;
    const fetchImpl = this.deps.fetchImpl;
    switch (providerKey) {
      case 'openai':
        return new OpenAiProvider(apiKey, { baseUrl, fetchImpl });
      case 'anthropic':
        return new AnthropicProvider(apiKey, { baseUrl, fetchImpl });
      case 'google':
        return new GoogleProvider(apiKey, { baseUrl, fetchImpl });
      case 'openai-compatible':
        if (!baseUrl) throw new ProviderError('OpenAI-compatible provider needs a base URL (e.g. http://127.0.0.1:1234/v1).', 'not_configured');
        return new OpenAiProvider(apiKey, { baseUrl, fetchImpl, key: 'openai-compatible' });
    }
  }

  /**
   * Streams a turn with one automatic retry on retryable failure, then fallback
   * provider if configured. Emits a `provider-switched` synthetic event via onFallback.
   */
  async *stream(
    preferred: { provider: ProviderKey | 'auto'; model: string; fallbackProvider?: ProviderKey | 'none' },
    request: Omit<ChatRequest, 'model'>,
    hooks: { onFallback?: (info: { from: RouterTarget; to: RouterTarget; reason: string }) => void } = {},
  ): AsyncGenerator<ChatStreamEvent & { provider?: ProviderKey; model?: string }> {
    const target = await this.resolve(preferred);
    let current = target;
    const tried = new Set<string>();

    for (let attempt = 0; attempt < 3; attempt++) {
      tried.add(`${current.provider}:${current.model}`);
      const prov = await this.provider(current.provider);
      let yielded = false;
      let retryable: ProviderError | null = null;
      try {
        for await (const evt of prov.streamChat({ ...request, model: current.model })) {
          yielded = true;
          yield { ...evt, provider: current.provider, model: current.model };
        }
        return;
      } catch (err) {
        const pe = err instanceof ProviderError ? err : new ProviderError(err instanceof Error ? err.message : String(err), 'server');
        if (yielded || !pe.retryable || request.signal?.aborted) throw pe;
        retryable = pe;
      }
      if (!retryable) return;
      // retry same target once after a short backoff, unless rate-limited hard
      if (attempt === 0 && retryable.kind === 'network') {
        await sleep(400);
        continue;
      }
      const fallback = preferred.fallbackProvider && preferred.fallbackProvider !== 'none' ? preferred.fallbackProvider : null;
      const fallbackKey = fallback ? await this.deps.getApiKey(fallback) : null;
      if (!fallback || !fallbackKey || tried.has(`${fallback}:${this.deps.defaultModel?.(fallback) ?? DEFAULT_MODELS[fallback]}`)) {
        throw retryable;
      }
      const to: RouterTarget = { provider: fallback, model: this.deps.defaultModel?.(fallback) ?? DEFAULT_MODELS[fallback] };
      hooks.onFallback?.({ from: current, to, reason: retryable.message });
      current = to;
    }
    throw new ProviderError('All provider attempts failed.', 'server');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
