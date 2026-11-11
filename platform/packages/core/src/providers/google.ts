import { ProviderError, type ChatRequest, type ChatStreamEvent, type ConnectionTestResult, type ModelInfo, type ModelProvider } from './types.js';
import { readErrorBody } from './sse.js';
import { estimatedCost } from './pricing.js';

/**
 * Google Gemini adapter — generateContent / streamGenerateContent (SSE via alt=sse).
 * Gemini Live (bidirectional audio) is handled by the dedicated VoiceGateway proxy,
 * not here; this adapter is for text/tool turns.
 */
export class GoogleProvider implements ModelProvider {
  readonly key = 'google' as const;
  constructor(
    private readonly apiKey: string,
    private readonly opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
  ) {}

  private base(): string {
    return (this.opts.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  }

  async *streamChat(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const contents = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const body: Record<string, unknown> = { contents };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const generationConfig: Record<string, unknown> = {};
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.maxTokens !== undefined) generationConfig.maxOutputTokens = request.maxTokens;
    if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
    if (request.tools?.length) {
      body.tools = [{ functionDeclarations: request.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
    }
    if (request.reasoning && request.reasoning !== 'off') {
      generationConfig.thinkingConfig = { thinkingBudget: request.reasoning === 'high' ? 8192 : request.reasoning === 'medium' ? 4096 : 1024 };
      body.generationConfig = generationConfig;
    }

    let res: Response;
    try {
      res = await fetchImpl(`${this.base()}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw new ProviderError('Request aborted', 'aborted');
      throw new ProviderError(`Network error contacting Gemini: ${err instanceof Error ? err.message : String(err)}`, 'network');
    }
    if (!res.ok || !res.body) throw await googleError(res);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason = 'STOP';

    const handle = (json: GeminiResponse) => {
      const chunk: ChatStreamEvent[] = [];
      const usage = json.usageMetadata;
      if (usage) {
        inputTokens = usage.promptTokenCount ?? inputTokens;
        outputTokens = usage.candidatesTokenCount ?? outputTokens;
      }
      for (const cand of json.candidates ?? []) {
        for (const part of cand.content?.parts ?? []) {
          if (part.text) chunk.push({ type: 'text-delta', text: part.text });
          if (part.functionCall) {
            chunk.push({
              type: 'tool-call',
              call: { id: `gem_${part.functionCall.name}_${Date.now().toString(36)}`, name: part.functionCall.name ?? '', arguments: JSON.stringify(part.functionCall.args ?? {}) },
            });
          }
        }
        if (cand.finishReason) finishReason = cand.finishReason;
      }
      return chunk;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, '');
          for (const line of raw.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            let parsed: GeminiResponse;
            try {
              parsed = JSON.parse(payload) as GeminiResponse;
            } catch {
              continue;
            }
            if (parsed.error) throw new ProviderError(parsed.error.message ?? 'Gemini error', mapKind(parsed.error.status), undefined);
            for (const e of handle(parsed)) yield e;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'usage', usage: { inputTokens, outputTokens, costUsd: estimatedCost(request.model, inputTokens, outputTokens) } };
    yield { type: 'finish', reason: finishReason === 'MAX_TOKENS' ? 'length' : finishReason === 'SAFETY' ? 'error' : 'stop', model: request.model };
  }

  async listModels(): Promise<ModelInfo[]> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const res = await fetchImpl(`${this.base()}/models?pageSize=200`, { headers: { 'x-goog-api-key': this.apiKey } });
    if (!res.ok) throw await googleError(res);
    const json = (await res.json()) as { models?: Array<{ name: string; displayName?: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] }> };
    return (json.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => {
        const id = m.name.replace(/^models\//, '');
        return {
          id,
          label: m.displayName ?? id,
          contextWindow: m.inputTokenLimit,
          supportsTools: true,
          supportsVision: /gemini/.test(id),
          supportsAudio: /live|audio|native/.test(id),
          pricing: undefined,
        };
      });
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      const models = await this.listModels();
      return { ok: true, status: 'valid', message: `Key accepted. ${models.length} models visible.`, latencyMs: Date.now() - started, models };
    } catch (err) {
      if (err instanceof ProviderError) {
        if (err.kind === 'auth' || err.kind === 'invalid_request') return { ok: false, status: 'invalid', message: err.message };
        if (err.kind === 'rate_limit') return { ok: false, status: 'rate_limited', message: err.message };
        return { ok: false, status: 'network_error', message: err.message };
      }
      return { ok: false, status: 'network_error', message: err instanceof Error ? err.message : String(err) };
    }
  }
}

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name?: string; args?: Record<string, unknown> } }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { code?: number; message?: string; status?: string };
};

function mapKind(status?: string): ProviderError['kind'] {
  if (!status) return 'server';
  if (status.includes('PERMISSION') || status.includes('UNAUTHENTICATED') || status.includes('API_KEY')) return 'auth';
  if (status.includes('RESOURCE_EXHAUSTED')) return 'rate_limit';
  if (status.includes('INVALID')) return 'invalid_request';
  return 'server';
}

async function googleError(res: Response): Promise<ProviderError> {
  const body = await readErrorBody(res);
  let detail = body.slice(0, 220);
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    detail = j.error?.message ?? detail;
  } catch {
    /* ignore */
  }
  if (res.status === 401 || res.status === 403) return new ProviderError(`Gemini rejected the API key (${res.status}). ${detail}`, 'auth', res.status);
  if (res.status === 429) return new ProviderError(`Gemini quota/rate limit. ${detail}`, 'rate_limit', res.status, 5);
  if (res.status === 400 || res.status === 404) return new ProviderError(`Gemini rejected the request (${res.status}). ${detail}`, 'invalid_request', res.status);
  return new ProviderError(`Gemini error ${res.status}. ${detail}`, res.status >= 500 ? 'server' : 'invalid_request', res.status);
}
