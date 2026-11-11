import { describe, expect, it } from 'vitest';
import { OpenAiProvider } from '../src/providers/openai.js';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import { GoogleProvider } from '../src/providers/google.js';
import { parseSse } from '../src/providers/sse.js';
import { ProviderError } from '../src/providers/types.js';
import { ModelRouter } from '../src/router/router.js';
import { SecretVault, keyHint, validateKeyShape } from '../src/secrets/vault.js';

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('SSE parser', () => {
  it('handles chunk boundaries, multi-line data and comments', async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(': keepalive\n\nevent: delta\ndata: line1\ndata: line2\n\n'));
        c.enqueue(enc.encode('data: tail'));
        c.enqueue(enc.encode('X\r\n\r\n'));
        c.close();
      },
    });
    const events = [];
    for await (const e of parseSse(stream)) events.push(e);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ event: 'delta', data: 'line1\nline2', id: undefined });
    expect(events[1]?.data).toBe('tailX');
  });
});

describe('OpenAI adapter', () => {
  it('streams text + usage and builds a valid request', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} };
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\n',
        'data: [DONE]\n\n',
      ]);
    }) as unknown as typeof fetch;
    const p = new OpenAiProvider('sk-test-key-123456', { fetchImpl });
    let text = '';
    let usage: { inputTokens: number; outputTokens: number } | null = null;
    for await (const e of p.streamChat({ model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'hi' }], maxTokens: 100, temperature: 0.3 })) {
      if (e.type === 'text-delta') text += e.text;
      if (e.type === 'usage') usage = e.usage;
    }
    expect(text).toBe('Hello');
    expect(usage?.inputTokens).toBe(12);
    expect(captured!.url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(String(captured!.init.body));
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(100);
    expect((captured!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-key-123456');
  });

  it('assembles streamed tool calls', async () => {
    const fetchImpl = (async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"web__search","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"rust\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ])) as unknown as typeof fetch;
    const p = new OpenAiProvider('sk-x', { fetchImpl });
    const calls = [];
    for await (const e of p.streamChat({ model: 'gpt-4o', messages: [{ role: 'user', content: 'x' }] })) if (e.type === 'tool-call') calls.push(e.call);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('web__search');
    expect(JSON.parse(calls[0]!.arguments)).toEqual({ query: 'rust' });
  });

  it('maps 401 to auth error and 429 to rate_limit', async () => {
    const p401 = new OpenAiProvider('sk-x', { fetchImpl: (async () => jsonResponse({ error: { message: 'Incorrect API key' } }, 401)) as unknown as typeof fetch });
    await expect(p401.testConnection()).resolves.toMatchObject({ ok: false, status: 'invalid' });
    const p429 = new OpenAiProvider('sk-x', { fetchImpl: (async () => jsonResponse({ error: { message: 'slow down' } }, 429)) as unknown as typeof fetch });
    const res = await p429.testConnection();
    expect(res.status).toBe('rate_limited');
  });

  it('throws ProviderError instead of returning fake output on failure', async () => {
    const p = new OpenAiProvider('sk-x', { fetchImpl: (async () => jsonResponse({ error: { message: 'boom' } }, 500)) as unknown as typeof fetch });
    let error: unknown = null;
    try {
      for await (const _ of p.streamChat({ model: 'm', messages: [{ role: 'user', content: 'x' }] })) void _;
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe('server');
  });

  it('lists only usable models from /v1/models', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        data: [
          { id: 'gpt-4.1-mini' },
          { id: 'gpt-4o-audio-preview' },
          { id: 'text-embedding-3-small' },
          { id: 'dall-e-3' },
          { id: 'whisper-1' },
        ],
      })) as unknown as typeof fetch;
    const models = await new OpenAiProvider('sk-x', { fetchImpl }).listModels();
    expect(models.map((m) => m.id)).toEqual(['gpt-4.1-mini', 'gpt-4o-audio-preview', 'text-embedding-3-small']);
  });
});

describe('Anthropic adapter', () => {
  it('sends system separately and parses text deltas + tools', async () => {
    let captured: RequestInit | null = null;
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      captured = init ?? {};
      return sseResponse([
        'event: message_start\ndata: {"message":{"usage":{"input_tokens":9}}}\n\n',
        'event: content_block_delta\ndata: {"index":0,"delta":{"type":"text_delta","text":"Sure"}}\n\n',
        'event: message_delta\ndata: {"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
      ]);
    }) as unknown as typeof fetch;
    const p = new AnthropicProvider('sk-ant-x', { fetchImpl });
    let text = '';
    for await (const e of p.streamChat({ model: 'claude-sonnet-4-5', messages: [{ role: 'system', content: 'be terse' }, { role: 'user', content: 'hi' }] })) {
      if (e.type === 'text-delta') text += e.text;
    }
    expect(text).toBe('Sure');
    const body = JSON.parse(String(captured!.body));
    expect(body.system).toBe('be terse');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect((captured!.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-x');
  });
});

describe('Google adapter', () => {
  it('parses delta events and function calls', async () => {
    const fetchImpl = (async () =>
      sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Hi "}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"system__time","args":{}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":2}}\n\n',
      ])) as unknown as typeof fetch;
    const p = new GoogleProvider('AIza-test', { fetchImpl });
    const texts: string[] = [];
    const calls: string[] = [];
    for await (const e of p.streamChat({ model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'time?' }] })) {
      if (e.type === 'text-delta') texts.push(e.text);
      if (e.type === 'tool-call') calls.push(e.call.name);
    }
    expect(texts.join('')).toBe('Hi ');
    expect(calls).toEqual(['system__time']);
  });
});

describe('Model router', () => {
  const keys = new Map<string, string>([['openai', 'sk-a'], ['anthropic', 'sk-ant-b']]);
  const router = new ModelRouter({ getApiKey: async (p) => keys.get(p) ?? null });

  it('resolves explicit provider and auto order', async () => {
    expect(await router.resolve({ provider: 'auto', model: '' })).toEqual({ provider: 'openai', model: 'gpt-4.1-mini' });
    expect(await router.resolve({ provider: 'anthropic', model: 'claude-sonnet-4-5' })).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-5' });
  });

  it('fails honestly when no provider is configured', async () => {
    const empty = new ModelRouter({ getApiKey: async () => null });
    await expect(empty.resolve({ provider: 'auto', model: '' })).rejects.toThrow(/No AI provider is configured/);
  });

  it('falls back only on retryable errors and announces the switch', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('openai.com')) return jsonResponse({ error: { message: 'overloaded' } }, 503);
      // The fallback target is Anthropic, so answer in Anthropic's event schema.
      return sseResponse([
        'event: message_start\ndata: {"message":{"usage":{"input_tokens":5}}}\n\n',
        'event: content_block_delta\ndata: {"index":0,"delta":{"type":"text_delta","text":"fallback ok"}}\n\n',
        'event: message_delta\ndata: {"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
      ]);
    }) as unknown as typeof fetch;
    const r = new ModelRouter({
      getApiKey: async (p) => (p === 'openai' ? 'sk-a' : p === 'anthropic' ? 'sk-ant-b' : null),
      fetchImpl,
    });
    const switches: string[] = [];
    let text = '';
    for await (const e of r.stream(
      { provider: 'openai', model: 'gpt-4.1-mini', fallbackProvider: 'anthropic' },
      { messages: [{ role: 'user', content: 'hello' }] },
      { onFallback: (i) => switches.push(`${i.from.provider}->${i.to.provider}`) },
    )) {
      if (e.type === 'text-delta') text += e.text;
    }
    expect(switches).toEqual(['openai->anthropic']);
    expect(text).toBe('fallback ok');
    expect(calls.some((c) => c.includes('openai.com'))).toBe(true);
  });

  it('does not fall back on auth errors', async () => {
    const r = new ModelRouter({
      getApiKey: async (p) => (p === 'openai' ? 'sk-bad' : 'sk-ant-b'),
      fetchImpl: (async () => jsonResponse({ error: { message: 'bad key' } }, 401)) as unknown as typeof fetch,
    });
    await expect(async () => {
      for await (const _ of r.stream({ provider: 'openai', model: 'gpt-4.1-mini', fallbackProvider: 'anthropic' }, { messages: [{ role: 'user', content: 'x' }] })) void _;
    }).rejects.toThrow(/rejected the API key/);
  });
});

describe('secret vault', () => {
  it('round-trips and rejects a wrong key', async () => {
    const vault = await SecretVault.fromKeyBytes(SecretVault.generateKeyBytes());
    const ct = await vault.encrypt('sk-super-secret-value');
    expect(ct).not.toContain('sk-super-secret-value');
    expect(await vault.decrypt(ct)).toBe('sk-super-secret-value');
    const other = await SecretVault.fromKeyBytes(SecretVault.generateKeyBytes());
    await expect(other.decrypt(ct)).rejects.toThrow(/Decryption failed/);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', async () => {
    const vault = await SecretVault.fromKeyBytes(SecretVault.generateKeyBytes());
    expect(await vault.encrypt('same')).not.toBe(await vault.encrypt('same'));
  });

  it('hints the key without exposing it and validates shapes', () => {
    expect(keyHint('sk-1234567890abcdef')).toBe('sk-…cdef');
    expect(validateKeyShape('openai', 'sk-' + 'x'.repeat(30)).ok).toBe(true);
    expect(validateKeyShape('openai', 'AIza' + 'x'.repeat(30)).ok).toBe(false);
    expect(validateKeyShape('google', 'AIza' + 'x'.repeat(30)).ok).toBe(true);
    expect(validateKeyShape('openai', 'short').ok).toBe(false);
    expect(validateKeyShape('anthropic', 'sk-a b').ok).toBe(false);
  });
});
