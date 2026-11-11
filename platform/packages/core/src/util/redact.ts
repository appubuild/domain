const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-ant-[A-Za-z0-9_-]{10,}/g, 'sk-ant-***REDACTED***'],
  [/sk-[A-Za-z0-9_-]{16,}/g, 'sk-***REDACTED***'],
  [/(AIza)[A-Za-z0-9_-]{20,}/g, '$1***REDACTED***'],
  [/Bearer\s+[A-Za-z0-9._-]{16,}/gi, 'Bearer ***REDACTED***'],
  [/("(?:apiKey|api_key|token|secret|password|authorization)"\s*:\s*")[^"]+(")/gi, '$1***REDACTED***$2'],
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const [re, replacement] of SECRET_PATTERNS) out = out.replace(re, replacement);
  return out;
}

/** Structural redaction for exported objects: removes known secret-bearing keys. */
const SECRET_KEYS = new Set(['apiKey', 'api_key', 'token', 'secret', 'password', 'authorization', 'licenseKeyRaw', 'clientSecret']);
export function redactObject<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redactObject(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.has(k) ? undefined : redactObject(v);
    }
    return out as T;
  }
  return value;
}
