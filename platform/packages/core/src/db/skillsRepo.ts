import type { SqlDriver } from './types.js';
import { nowIso } from '../util/time.js';
import { safeParse, toJson } from '../util/json.js';

export type SkillRecord = {
  id: string;
  name: string;
  description: string;
  version: string;
  category: string;
  origin: 'builtin' | 'user' | 'mcp' | 'taught';
  enabled: boolean;
  permissions: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  config: Record<string, unknown>;
  source: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: string;
  name: string;
  description: string;
  version: string;
  category: string;
  origin: string;
  enabled: number;
  permissions_json: string;
  input_schema_json: string;
  output_schema_json: string;
  config_json: string;
  source_json: string | null;
  created_at: string;
  updated_at: string;
};

export class SkillsRepo {
  constructor(private readonly db: SqlDriver) {}

  private map(r: Row): SkillRecord {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      version: r.version,
      category: r.category,
      origin: r.origin as SkillRecord['origin'],
      enabled: r.enabled === 1,
      permissions: safeParse<string[]>(r.permissions_json, []),
      inputSchema: safeParse<Record<string, unknown>>(r.input_schema_json, {}),
      outputSchema: safeParse<Record<string, unknown>>(r.output_schema_json, {}),
      config: safeParse<Record<string, unknown>>(r.config_json, {}),
      source: safeParse<Record<string, unknown> | null>(r.source_json, null),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  list(): SkillRecord[] {
    return this.db.all<Row>('SELECT * FROM skills ORDER BY category, name').map((r) => this.map(r));
  }

  get(id: string): SkillRecord | null {
    const row = this.db.get<Row>('SELECT * FROM skills WHERE id = ?', [id]);
    return row ? this.map(row) : null;
  }

  upsertBuiltin(skill: Omit<SkillRecord, 'createdAt' | 'updatedAt' | 'origin'> & { origin?: SkillRecord['origin'] }): void {
    const existing = this.get(skill.id);
    const now = nowIso();
    if (!existing) {
      this.db.run(
        `INSERT INTO skills (id, name, description, version, category, origin, enabled, permissions_json, input_schema_json, output_schema_json, config_json, source_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          skill.id,
          skill.name,
          skill.description,
          skill.version,
          skill.category,
          skill.origin ?? 'builtin',
          skill.enabled ? 1 : 0,
          toJson(skill.permissions),
          toJson(skill.inputSchema),
          toJson(skill.outputSchema),
          toJson(skill.config),
          skill.source ? toJson(skill.source) : null,
          now,
          now,
        ],
      );
      return;
    }
    // Builtin catalog updates metadata/version but preserves user enablement + config.
    this.db.run(
      `UPDATE skills SET name = ?, description = ?, version = ?, category = ?, permissions_json = ?, input_schema_json = ?, output_schema_json = ?, updated_at = ?
       WHERE id = ?`,
      [skill.name, skill.description, skill.version, skill.category, toJson(skill.permissions), toJson(skill.inputSchema), toJson(skill.outputSchema), now, skill.id],
    );
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db.run('UPDATE skills SET enabled = ?, updated_at = ? WHERE id = ?', [enabled ? 1 : 0, nowIso(), id]);
  }

  updateConfig(id: string, config: Record<string, unknown>): void {
    this.db.run('UPDATE skills SET config_json = ?, updated_at = ? WHERE id = ?', [toJson(config), nowIso(), id]);
  }

  save(input: Omit<SkillRecord, 'createdAt' | 'updatedAt'>): SkillRecord {
    const now = nowIso();
    this.db.run(
      `INSERT INTO skills (id, name, description, version, category, origin, enabled, permissions_json, input_schema_json, output_schema_json, config_json, source_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, version=excluded.version, category=excluded.category,
         enabled=excluded.enabled, permissions_json=excluded.permissions_json, input_schema_json=excluded.input_schema_json,
         output_schema_json=excluded.output_schema_json, config_json=excluded.config_json, source_json=excluded.source_json, updated_at=excluded.updated_at`,
      [
        input.id,
        input.name,
        input.description,
        input.version,
        input.category,
        input.origin,
        input.enabled ? 1 : 0,
        toJson(input.permissions),
        toJson(input.inputSchema),
        toJson(input.outputSchema),
        toJson(input.config),
        input.source ? toJson(input.source) : null,
        now,
        now,
      ],
    );
    return this.get(input.id)!;
  }

  remove(id: string): void {
    const s = this.get(id);
    if (!s) throw new Error('Skill not found');
    if (s.origin === 'builtin') throw new Error('Builtin skills cannot be deleted; disable them instead');
    this.db.run('DELETE FROM skills WHERE id = ?', [id]);
  }
}
