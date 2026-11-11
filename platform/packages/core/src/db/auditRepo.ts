import type { SqlDriver } from './types.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import { safeParse, toJson } from '../util/json.js';
import { redactSecrets } from '../util/redact.js';

export type AuditEntry = {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  outcome: 'allowed' | 'denied' | 'success' | 'failure' | 'pending';
  detail: Record<string, unknown>;
  createdAt: string;
};

export class AuditRepo {
  constructor(private readonly db: SqlDriver) {}

  log(input: { actor: string; action: string; target?: string | null; outcome: AuditEntry['outcome']; detail?: Record<string, unknown> }): void {
    const detail = input.detail ?? {};
    const safe = JSON.parse(redactSecrets(JSON.stringify(detail))) as Record<string, unknown>;
    this.db.run('INSERT INTO audit_log (id, actor, action, target, outcome, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      newId('aud'),
      input.actor,
      input.action,
      input.target ?? null,
      input.outcome,
      toJson(safe),
      nowIso(),
    ]);
  }

  recent(limit = 100): AuditEntry[] {
    return this.db
      .all<{ id: string; actor: string; action: string; target: string | null; outcome: string; detail_json: string; created_at: string }>(
        'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?',
        [limit],
      )
      .map((r) => ({
        id: r.id,
        actor: r.actor,
        action: r.action,
        target: r.target,
        outcome: r.outcome as AuditEntry['outcome'],
        detail: safeParse<Record<string, unknown>>(r.detail_json, {}),
        createdAt: r.created_at,
      }));
  }
}
