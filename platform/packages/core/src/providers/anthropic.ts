import { ProviderError, type ChatRequest, type ChatStreamEvent, type ConnectionTestResult, type ModelInfo, type ModelProvider } from './types.js';
import { parseSse, readErrorBody } from './sse.js';
import { estimatedCost } from './pricing.js';

/**
 * Anthropic Messages API adapter (SSE). Distinct from OpenAI: separate system param,
 * `x-api-key` + version header, tool_use blocks, and its own event schema.
 * The Claude Agent SDK is a *separate* integration type and is not faked here.
 */
export class AnthropicProvider implements ModelProvider {
  readonly key = 'anthropic' as const;
  constructor(
    private readonly apiKey: string,
    private readonly opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
  ) {}

  private base(): string {
    return (this.opts.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }

  async *streamChat(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const messages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      messages,
      stream: true,
    };
    if (system) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    }
    if (request.reasoning && request.reasoning !== 'off') {
      body.thinking = { type: 'enabled', budget_tokens: request.reasoning === 'high' ? 8000 : request.reasoning === 'medium' ? 4000 : 2000 };
    }

    let res: Response;
    try {
      res = await fetchImpl(`${this.base()}/messages`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: request.signal });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw new ProviderError('Request aborted', 'aborted');
      throw new ProviderError(`Network error contacting Anthropic: ${err instanceof Error ? err.message : String(err)}`, 'network');
    }
    if (!res.ok || !res.body) throw await anthropicError(res);

    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = 'end_turn';
    const toolBlocks = new Map<number, { id: string; name: string; json: string }>();

    for await (const evt of parseSse(res.body)) {
      const type = evt.event;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(evt.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (type === 'message_start') {
        const usage = (data.message as { usage?: { input_tokens?: number } } | undefined)?.usage;
        inputTokens = usage?.input_tokens ?? 0;
      } else if (type === 'content_block_start') {
        const block = data.content_block as { type?: string; id?: string; name?: string } | undefined;
        if (block?.type === 'tool_use') {
          toolBlocks.set(Number(data.index ?? 0), { id: block.id ?? '', name: block.name ?? '', json: '' });
        }
      } else if (type === 'content_block_delta') {
        const delta = data.delta as { type?: string; text?: string; thinking?: string; partial_json?: string } | undefined;
        if (delta?.type === 'text_delta' && delta.text) yield { type: 'text-delta', text: delta.text };
        if (delta?.type === 'thinking_delta' && delta.thinking) yield { type: 'thinking-delta', text: delta.thinking };
        if (delta?.type === 'input_json_delta' && delta.partial_json) {
          const slot = toolBlocks.get(Number(data.index ?? 0));
          if (slot) slot.json += delta.partial_json;
        }
      } else if (type === 'content_block_stop') {
        const slot = toolBlocks.get(Number(data.index ?? 0));
        if (slot?.name) {
          yield { type: 'tool-call', call: { id: slot.id, name: slot.name, arguments: slot.json || '{}' } };
          stopReason = 'tool_use';
        }
      } else if (type === 'message_delta') {
        const delta = data.delta as { stop_reason?: string } | undefined;
        const usage = data.usage as { output_tokens?: number } | undefined;
        if (usage?.output_tokens) outputTokens = usage.output_tokens;
        if (delta?.stop_reason) stopReason = delta.stop_reason;
      } else if (type === 'error') {
        const err = data.error as { message?: string; type?: string } | undefined;
        throw new ProviderError(err?.message ?? 'Anthropic stream error', err?.type === 'rate_limit_error' ? 'rate_limit' : 'server');
      }
    }

    yield { type: 'usage', usage: { inputTokens, outputTokens, costUsd: estimatedCost(request.model, inputTokens, outputTokens) } };
    yield { type: 'finish', reason: stopReason === 'tool_use' ? 'tool_calls' : stopReason === 'max_tokens' ? 'length' : 'stop', model: request.model };
  }

  async listModels(): Promise<ModelInfo[]> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const res = await fetchImpl(`${this.base()}/models?limit=100`, { headers: this.headers() });
    if (!res.ok) throw await anthropicError(res);
    const json = (await res.json()) as { data?: Array<{ id: string; display_name?: string; created_at?: string }> };
    return (json.data ?? []).map((m) => ({
      id: m.id,
      label: m.display_name ?? m.id,
      contextWindow: 200_000,
      supportsTools: true,
      supportsVision: true,
      supportsAudio: false,
      pricing: undefined,
    }));
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      const models = await this.listModels();
      return { ok: true, status: 'valid', message: `Key accepted. ${models.length} models visible.`, latencyMs: Date.now() - started, models };
    } catch (err) {
      if (err instanceof ProviderError) {
        if (err.kind === 'auth') return { ok: false, status: 'invalid', message: err.message };
        if (err.kind === 'rate_limit') return { ok: false, status: 'rate_limited', message: err.message };
        return { ok: false, status: 'network_error', message: err.message };
      }
      return { ok: false, status: 'network_error', message: err instanceof Error ? err.message : String(err) };
    }
  }
}

async function anthropicError(res: Response): Promise<ProviderError> {
  const body = await readErrorBody(res);
  let detail = body.slice(0, 200);
  try {
    const j = JSON.parse(body) as { error?: { message?: string; type?: string } };
    detail = j.error?.message ?? detail;
  } catch {
    /* keep raw */
  }
  if (res.status === 401 || res.status === 403) return new ProviderError(`Anthropic rejected the API key (${res.status}). ${detail}`, 'auth', res.status);
  if (res.status === 429) return new ProviderError(`Anthropic rate limit reached. ${detail}`, 'rate_limit', res.status, Number(res.headers.get('retry-after')) || 5);
  if (res.status === 400 || res.status === 404) return new ProviderError(`Anthropic rejected the request (${res.status}). ${detail}`, 'invalid_request', res.status);
  return new ProviderError(`Anthropic error ${res.status}. ${detail}`, res.status >= 500 ? 'server' : 'invalid_request', res.status);
}
