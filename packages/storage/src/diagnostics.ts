/** Diagnostic exports are not backups and must not silently coerce structured-clone values. */
export const MAX_DIAGNOSTIC_BYTES = 10 * 1024 * 1024;
export const MAX_DIAGNOSTIC_RECORDS = 100;
const MAX_NODES = 1_000_000;
const MAX_DEPTH = 128;

export function createUnreadableDiagnostic(records: unknown[]): string {
  if (!records.length || records.length > MAX_DIAGNOSTIC_RECORDS) throw new Error('Unsupported diagnostic record count');
  const seen = new WeakSet<object>();
  const pending: { value: unknown; depth: number }[] = [{ value: records, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw new Error('Diagnostic data is too complex');
    if (value === null || typeof value === 'boolean') continue;
    if (typeof value === 'string') {
      if (value.length > MAX_DIAGNOSTIC_BYTES) throw new Error('Diagnostic data is too large');
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error('Unsupported diagnostic value');
      continue;
    }
    if (typeof value !== 'object' || seen.has(value)) throw new Error('Unsupported diagnostic value');
    seen.add(value);
    if (Object.getOwnPropertySymbols(value).length) throw new Error('Unsupported diagnostic value');
    if (Array.isArray(value)) {
      if (value.length > MAX_NODES || Object.getOwnPropertyNames(value).length !== value.length + 1) throw new Error('Unsupported diagnostic array');
      for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('Unsupported diagnostic array');
        pending.push({ value: descriptor.value, depth: depth + 1 });
      }
    } else {
      if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Unsupported diagnostic object');
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (const descriptor of Object.values(descriptors)) {
        if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('Unsupported diagnostic property');
        pending.push({ value: descriptor.value, depth: depth + 1 });
      }
    }
  }
  const text = JSON.stringify({ format: 'land-expert-unreadable-diagnostic', version: 1, records });
  if (new TextEncoder().encode(text).byteLength > MAX_DIAGNOSTIC_BYTES) throw new Error('Diagnostic data exceeds size limit');
  return text;
}
