import { ProviderError, type ChatRequest, type ChatStreamEvent, type ConnectionTestResult, type ModelInfo, type ModelProvider, type ProviderKey } from './types.js';
import { parseSse, readErrorBody } from './sse.js';
import { estimatedCost } from './pricing.js';

/**
 * OpenAI adapter — Chat Completions streaming (SSE). Deliberately independent of any SDK
 * so the same code runs in Node and (through a proxy) the browser.
 *
 * Models are discovered live from GET /v1/models — never hardcoded, never assumed.
 */
export class OpenAiProvider implements ModelProvider {
  readonly key: ProviderKey;
  constructor(
    private readonly apiKey: string,
    private readonly opts: { baseUrl?: string; fetchImpl?: typeof fetch; key?: ProviderKey } = {},
  ) {
    this.key = opts.key ?? 'openai';
  }

  private base(): string {
    return (this.opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  async *streamChat(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const body: Record<string, unknown> = {
      model: request.model,
      messages: toOpenAiMessages(request.messages),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    }
    if (request.reasoning && request.reasoning !== 'off' && /^o\d|gpt-5|^o-/.test(request.model)) {
      body.reasoning_effort = request.reasoning;
    }

    let res: Response;
    try {
      res = await fetchImpl(`${this.base()}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (err) {
      if (isAbort(err)) throw new ProviderError('Request aborted', 'aborted');
      throw new ProviderError(`Network error contacting OpenAI: ${msg(err)}`, 'network');
    }

    if (!res.ok || !res.body) {
      throw await toProviderError(res, 'OpenAI');
    }

    let inputTokens = 0;
    let outputTokens = 0;
    const toolCalls = new Map<number, { id: string; name: string; args: string }>();
    let finish: 'stop' | 'length' | 'tool_calls' = 'stop';
    let sawUsage = false;

    for await (const evt of parseSse(res.body)) {
      if (evt.data === '[DONE]') break;
      let chunk: OpenAiChunk;
      try {
        chunk = JSON.parse(evt.data) as OpenAiChunk;
      } catch {
        continue;
      }
      if (chunk.error) {
        throw new ProviderError(chunk.error.message, 'server', undefined);
      }
      const choice = chunk.choices?.[0];
      if (choice?.delta?.content) {
        yield { type: 'text-delta', text: choice.delta.content };
      }
      if (choice?.delta?.reasoning_content) {
        yield { type: 'thinking-delta', text: choice.delta.reasoning_content };
      }
      for (const tc of choice?.delta?.tool_calls ?? []) {
        const slot = toolCalls.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
        toolCalls.set(tc.index, slot);
      }
      if (choice?.finish_reason === 'length') finish = 'length';
      if (choice?.finish_reason === 'tool_calls') finish = 'tool_calls';
      if (chunk.usage) {
        sawUsage = true;
        inputTokens = chunk.usage.prompt_tokens ?? 0;
        outputTokens = chunk.usage.completion_tokens ?? 0;
      }
    }

    for (const slot of toolCalls.values()) {
      if (!slot.name) continue;
      yield { type: 'tool-call', call: { id: slot.id || `call_${Math.random().toString(36).slice(2)}`, name: slot.name, arguments: slot.args || '{}' } };
      finish = 'tool_calls';
    }
    if (!sawUsage) {
      // Provider omitted usage; report an estimate explicitly flagged by pricing lookup.
      const est = estimateTokensSafely(request);
      inputTokens = est;
      outputTokens = 0;
    }
    yield { type: 'usage', usage: { inputTokens, outputTokens, costUsd: estimatedCost(request.model, inputTokens, outputTokens) } };
    yield { type: 'finish', reason: finish, model: request.model };
  }

  async listModels(): Promise<ModelInfo[]> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const res = await fetchImpl(`${this.base()}/models`, { headers: this.headers() });
    if (!res.ok) throw await toProviderError(res, 'OpenAI');
    const json = (await res.json()) as { data?: Array<{ id: string; created?: number }> };
    const ids = (json.data ?? []).map((m) => m.id).filter((id) => typeof id === 'string');
    return ids
      .filter((id) => /^(gpt|o\d|chatgpt|text-embedding)/.test(id))
      .sort()
      .map((id) => ({
        id,
        label: id,
        supportsTools: /^(gpt|o\d|chatgpt)/.test(id) && !id.includes('embedding'),
        supportsVision: /gpt-4o|gpt-4\.1|gpt-5|^o\d/.test(id),
        supportsAudio: /audio|realtime/.test(id),
        pricing: undefined,
      }));
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      const models = await this.listModels();
      return {
        ok: true,
        status: 'valid',
        message: `Key accepted. ${models.length} usable models visible.`,
        latencyMs: Date.now() - started,
        models,
      };
    } catch (err) {
      return mapTestError(err);
    }
  }
}

type OpenAiChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message: string };
};

function toOpenAiMessages(messages: ChatRequest['messages']): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content, ...(m.name ? { name: m.name } : {}) };
    return { role: m.role, content: m.content };
  });
}

export async function toProviderError(res: Response, provider: string): Promise<ProviderError> {
  const body = await readErrorBody(res);
  const retryAfter = Number(res.headers.get('retry-after') ?? '') || undefined;
  const detail = extractMessage(body);
  if (res.status === 401 || res.status === 403) return new ProviderError(`${provider} rejected the API key (${res.status}). ${detail}`, 'auth', res.status);
  if (res.status === 429) return new ProviderError(`${provider} rate limit reached. ${detail}`, 'rate_limit', res.status, retryAfter ?? 5);
  if (res.status === 400 || res.status === 404 || res.status === 422) return new ProviderError(`${provider} rejected the request (${res.status}). ${detail}`, 'invalid_request', res.status);
  return new ProviderError(`${provider} error ${res.status}. ${detail}`, res.status >= 500 ? 'server' : 'invalid_request', res.status);
}

function extractMessage(body: string): string {
  try {
    const json = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    if (typeof json.error === 'string') return json.error;
    return json.error?.message ?? json.message ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

function mapTestError(err: unknown): ConnectionTestResult {
  if (err instanceof ProviderError) {
    if (err.kind === 'auth') return { ok: false, status: 'invalid', message: err.message };
    if (err.kind === 'rate_limit') return { ok: false, status: 'rate_limited', message: err.message };
    return { ok: false, status: 'network_error', message: err.message };
  }
  return { ok: false, status: 'network_error', message: msg(err) };
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function estimateTokensSafely(request: ChatRequest): number {
  let chars = 0;
  for (const m of request.messages) chars += m.content.length;
  return Math.ceil(chars / 4);
}
