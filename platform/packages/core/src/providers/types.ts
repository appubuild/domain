import { z } from 'zod';

export const PROVIDER_KEYS = ['openai', 'anthropic', 'google', 'openai-compatible'] as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[number];

export const PROVIDER_META: Record<ProviderKey, { label: string; docsUrl: string; keyPrefix: string; keyUrl: string; modelsPathNote: string }> = {
  openai: { label: 'OpenAI', docsUrl: 'https://platform.openai.com/docs', keyPrefix: 'sk-', keyUrl: 'https://platform.openai.com/api-keys', modelsPathNote: 'GET /v1/models' },
  anthropic: { label: 'Anthropic', docsUrl: 'https://docs.anthropic.com', keyPrefix: 'sk-ant-', keyUrl: 'https://console.anthropic.com/settings/keys', modelsPathNote: 'GET /v1/models' },
  google: { label: 'Google Gemini', docsUrl: 'https://ai.google.dev/gemini-api/docs', keyPrefix: 'AIza', keyUrl: 'https://aistudio.google.com/app/apikey', modelsPathNote: 'GET /v1beta/models' },
  'openai-compatible': {
    label: 'OpenAI-compatible',
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    keyPrefix: '',
    keyUrl: '',
    modelsPathNote: 'GET {baseUrl}/models',
  },
};

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';
export type ChatMessage = {
  role: ChatRole;
  content: string;
  /** tool result linkage for providers that require it */
  toolCallId?: string;
  name?: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolCall = { id: string; name: string; arguments: string };

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  reasoning?: 'off' | 'low' | 'medium' | 'high';
  signal?: AbortSignal;
};

export type ChatUsage = { inputTokens: number; outputTokens: number; costUsd: number };

export type ChatStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'thinking-delta'; text: string }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'usage'; usage: ChatUsage }
  | { type: 'finish'; reason: 'stop' | 'length' | 'tool_calls' | 'error'; model: string }
  | { type: 'error'; error: ProviderError };

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate_limit' | 'network' | 'invalid_request' | 'server' | 'aborted' | 'not_configured' | 'content_filter',
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  get retryable(): boolean {
    return this.kind === 'rate_limit' || this.kind === 'network' || this.kind === 'server';
  }
}

export type ConnectionTestResult = {
  ok: boolean;
  status: 'valid' | 'invalid' | 'rate_limited' | 'network_error' | 'unsupported';
  message: string;
  latencyMs?: number;
  models?: ModelInfo[];
};

export type ModelInfo = {
  id: string;
  label: string;
  contextWindow?: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsAudio: boolean;
  /** USD per 1M tokens, when publicly known. 0 when unknown/free. */
  pricing?: { input: number; output: number };
};

export interface ModelProvider {
  readonly key: ProviderKey;
  /** Streams a chat completion. Must throw ProviderError, never return fake output. */
  streamChat(request: ChatRequest): AsyncGenerator<ChatStreamEvent, void, unknown>;
  listModels(): Promise<ModelInfo[]>;
  testConnection(): Promise<ConnectionTestResult>;
}

export const modelInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  contextWindow: z.number().optional(),
  supportsTools: z.boolean(),
  supportsVision: z.boolean(),
  supportsAudio: z.boolean(),
  pricing: z.object({ input: z.number(), output: z.number() }).optional(),
});
