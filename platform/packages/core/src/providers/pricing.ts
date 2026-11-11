/**
 * Public list prices (USD per 1M tokens) for cost *estimation* only.
 * Marked `estimate: true` everywhere it surfaces; users must verify against provider
 * billing. Unknown models return 0 rather than a guessed number.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'o4-mini': { input: 1.1, output: 4.4 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-opus-4-1': { input: 15, output: 75 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-3-5-haiku-latest': { input: 0.8, output: 4 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
};

export function estimatedCost(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(PRICING).find((k) => model === k || model.startsWith(`${k}-`) || model.includes(k));
  const price = key ? PRICING[key] : undefined;
  if (!price) return 0;
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

export function modelPricing(model: string): { input: number; output: number } | undefined {
  const key = Object.keys(PRICING).find((k) => model === k || model.startsWith(`${k}-`) || model.includes(k));
  return key ? PRICING[key] : undefined;
}
