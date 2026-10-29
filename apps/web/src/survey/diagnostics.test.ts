import { describe, expect, it } from 'vitest';
import { createUnreadableDiagnostic, MAX_DIAGNOSTIC_BYTES, MAX_DIAGNOSTIC_RECORDS } from '../../../../packages/storage/src/diagnostics';
import { parseBackup } from '../../../../packages/storage/src/transfer';

describe('unreadable record diagnostic export', () => {
  it('preserves JSON-safe fields and is deliberately not a restorable project backup', () => {
    const raw = [{ id: 'future-id', schemaVersion: 2, nested: { coordinates: [[90.4, 23.8]], name: 'জমি', note: null, yes: true } }];
    const text = createUnreadableDiagnostic(raw);
    expect(JSON.parse(text)).toEqual({ format: 'land-expert-unreadable-diagnostic', version: 1, records: raw });
    expect(() => parseBackup(text)).toThrow();
  });
  it('rejects unsupported or lossy structured-clone values without partial output', () => {
    const cycle: { self?: unknown } = {}; cycle.self = cycle;
    const shared = { value: 'x' };
    for (const raw of [undefined, NaN, Infinity, -0, 1n, new Date(), new Uint8Array([1, 2]), cycle, { first: shared, second: shared }, [1, , 3]]) {
      expect(() => createUnreadableDiagnostic([{ raw }])).toThrow();
    }
  });
  it('rejects empty, excessive, oversized or too deeply nested diagnostics', () => {
    expect(() => createUnreadableDiagnostic([])).toThrow();
    expect(() => createUnreadableDiagnostic(Array.from({ length: MAX_DIAGNOSTIC_RECORDS + 1 }, () => ({})))).toThrow();
    expect(() => createUnreadableDiagnostic([{ data: 'x'.repeat(MAX_DIAGNOSTIC_BYTES) }])).toThrow();
    let nested: unknown = 'end';
    for (let i = 0; i < 130; i++) nested = { child: nested };
    expect(() => createUnreadableDiagnostic([nested])).toThrow();
  });
});
