import type { SqlDriver } from './types.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';

export type UsageEvent = {
  id: string;
  provider: string;
  model: string;
  characterId: string | null;
  taskId: string | null;
  inputTokens: number;
  outputTokens: number;
  audioSeconds: number;
  costUsd: number;
  createdAt: string;
};

export type UsageSummary = {
  today: { requests: number; inputTokens: number; outputTokens: number; costUsd: number };
  last7: { requests: number; inputTokens: number; outputTokens: number; costUsd: number };
  byProvider: Array<{ provider: string; model: string; requests: number; inputTokens: number; outputTokens: number; costUsd: number }>;
  recent: UsageEvent[];
};

type Row = {
  id: string;
  provider: string;
  model: string;
  character_id: string | null;
  task_id: string | null;
  input_tokens: number;
  output_tokens: number;
  audio_seconds: number;
  cost_usd: number;
  created_at: string;
};

export class UsageRepo {
  constructor(private readonly db: SqlDriver) {}

  private map(r: Row): UsageEvent {
    return {
      id: r.id,
      provider: r.provider,
      model: r.model,
      characterId: r.character_id,
      taskId: r.task_id,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      audioSeconds: r.audio_seconds,
      costUsd: r.cost_usd,
      createdAt: r.created_at,
    };
  }

  record(input: Omit<UsageEvent, 'id' | 'createdAt'>): void {
    this.db.run(
      `INSERT INTO usage_events (id, provider, model, character_id, task_id, input_tokens, output_tokens, audio_seconds, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId('use'),
        input.provider,
        input.model,
        input.characterId,
        input.taskId,
        Math.round(input.inputTokens),
        Math.round(input.outputTokens),
        input.audioSeconds,
        input.costUsd,
        nowIso(),
      ],
    );
  }

  summary(): UsageSummary {
    const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    const agg = (from: string) =>
      this.db.get<{ requests: number; i: number; o: number; c: number }>(
        `SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o, COALESCE(SUM(cost_usd),0) AS c
         FROM usage_events WHERE created_at >= ?`,
        [from],
      ) ?? { requests: 0, i: 0, o: 0, c: 0 };
    const today = agg(since(1));
    const week = agg(since(7));
    const byProvider = this.db.all<{ provider: string; model: string; requests: number; i: number; o: number; c: number }>(
      `SELECT provider, model, COUNT(*) AS requests, SUM(input_tokens) AS i, SUM(output_tokens) AS o, SUM(cost_usd) AS c
       FROM usage_events WHERE created_at >= ? GROUP BY provider, model ORDER BY c DESC`,
      [since(30)],
    );
    const recent = this.db.all<Row>('SELECT * FROM usage_events ORDER BY created_at DESC LIMIT 25').map((r) => this.map(r));
    return {
      today: { requests: today.requests, inputTokens: today.i, outputTokens: today.o, costUsd: today.c },
      last7: { requests: week.requests, inputTokens: week.i, outputTokens: week.o, costUsd: week.c },
      byProvider: byProvider.map((r) => ({ provider: r.provider, model: r.model, requests: Number(r.requests), inputTokens: Number(r.i), outputTokens: Number(r.o), costUsd: Number(r.c) })),
      recent,
    };
  }

  reset(): void {
    this.db.run('DELETE FROM usage_events');
  }
}
