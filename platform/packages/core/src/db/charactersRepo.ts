import type { SqlDriver } from './types.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import { safeParse, toJson } from '../util/json.js';
import { characterInputSchema, TEMPLATE_KEYS } from '../characters/types.js';
import type { AvatarSpec, Character, CharacterConfig, CharacterInput, TemplateKey } from '../characters/types.js';
import { deepMerge } from '../util/merge.js';

type Row = {
  id: string;
  name: string;
  template_key: string;
  description: string;
  avatar_model: string;
  avatar_variant: string;
  profile_image: string | null;
  config_json: string;
  is_default: number;
  archived: number;
  created_at: string;
  updated_at: string;
  memory_count?: number;
  conversation_count?: number;
};

type StoredConfig = CharacterConfig & { avatarSpec: AvatarSpec };

export class CharactersRepo {
  constructor(private readonly db: SqlDriver) {}

  private toRecord(row: Row): Character {
    const stored = safeParse<StoredConfig | null>(row.config_json, null);
    if (!stored) throw new Error(`Character ${row.id} has corrupt configuration`);
    const { avatarSpec, ...config } = stored;
    const templateKey = (TEMPLATE_KEYS as readonly string[]).includes(row.template_key)
      ? (row.template_key as TemplateKey)
      : 'professional-assistant';
    const parsed = characterInputSchema.safeParse({
      name: row.name,
      templateKey,
      avatarModel: row.avatar_model === 'vrm' ? 'vrm' : 'procedural',
      avatarVariant: row.avatar_variant,
      avatarSpec,
      profileImage: row.profile_image,
      config,
    });
    if (!parsed.success) throw new Error(`Character ${row.id} failed validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
    return {
      id: row.id,
      ...parsed.data,
      isDefault: row.is_default === 1,
      archived: row.archived === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      stats:
        row.memory_count === undefined && row.conversation_count === undefined
          ? undefined
          : { memoryCount: Number(row.memory_count ?? 0), conversationCount: Number(row.conversation_count ?? 0) },
    };
  }

  list(includeArchived = false): Character[] {
    const rows = this.db.all<Row>(
      `SELECT c.*,
        (SELECT COUNT(*) FROM memories m WHERE m.character_id = c.id) AS memory_count,
        (SELECT COUNT(*) FROM conversations v WHERE v.character_id = c.id AND v.archived = 0) AS conversation_count
       FROM characters c ${includeArchived ? '' : 'WHERE c.archived = 0'} ORDER BY c.is_default DESC, c.created_at ASC`,
    );
    return rows.map((r) => this.toRecord(r));
  }

  get(id: string): Character | null {
    const row = this.db.get<Row>('SELECT * FROM characters WHERE id = ?', [id]);
    return row ? this.toRecord(row) : null;
  }

  create(input: CharacterInput, opts: { makeDefault?: boolean } = {}): Character {
    const valid = characterInputSchema.parse(input);
    const id = newId('chr');
    const now = nowIso();
    const stored: StoredConfig = { ...valid.config, avatarSpec: valid.avatarSpec };
    const first = this.count() === 0;
    const makeDefault = opts.makeDefault === true || first;
    this.db.transaction(() => {
      if (makeDefault) this.db.run('UPDATE characters SET is_default = 0');
      this.db.run(
        `INSERT INTO characters (id, name, template_key, description, avatar_model, avatar_variant, profile_image, config_json, is_default, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          id,
          valid.name,
          valid.templateKey,
          valid.config.description,
          valid.avatarModel,
          valid.avatarVariant,
          valid.profileImage,
          toJson(stored),
          makeDefault ? 1 : 0,
          now,
          now,
        ],
      );
    });
    const created = this.get(id);
    if (!created) throw new Error('Character insert failed');
    return created;
  }

  update(id: string, input: Partial<CharacterInput>): Character {
    const existing = this.get(id);
    if (!existing) throw new Error('Character not found');
    const merged = characterInputSchema.parse({
      name: input.name ?? existing.name,
      templateKey: input.templateKey ?? existing.templateKey,
      avatarModel: input.avatarModel ?? existing.avatarModel,
      avatarVariant: input.avatarVariant ?? existing.avatarVariant,
      avatarSpec: input.avatarSpec ?? existing.avatarSpec,
      profileImage: input.profileImage === undefined ? existing.profileImage : input.profileImage,
      config: deepMerge(existing.config as unknown as Record<string, unknown>, (input.config ?? {}) as Record<string, unknown>) as unknown as CharacterConfig,
    });
    const stored: StoredConfig = { ...merged.config, avatarSpec: merged.avatarSpec };
    this.db.run(
      `UPDATE characters SET name = ?, template_key = ?, description = ?, avatar_model = ?, avatar_variant = ?,
       profile_image = ?, config_json = ?, updated_at = ? WHERE id = ?`,
      [
        merged.name,
        merged.templateKey,
        merged.config.description,
        merged.avatarModel,
        merged.avatarVariant,
        merged.profileImage,
        toJson(stored),
        nowIso(),
        id,
      ],
    );
    const updated = this.get(id);
    if (!updated) throw new Error('Character update failed');
    return updated;
  }

  duplicate(id: string, name?: string): Character {
    const source = this.get(id);
    if (!source) throw new Error('Character not found');
    const { id: _id, isDefault: _d, archived: _a, createdAt: _c, updatedAt: _u, stats: _s, ...input } = source;
    return this.create({ ...input, name: name ?? `${source.name} copy` }, { makeDefault: false });
  }

  remove(id: string): void {
    const existing = this.get(id);
    if (!existing) throw new Error('Character not found');
    this.db.transaction(() => {
      this.db.run('DELETE FROM memories_fts WHERE rowid IN (SELECT rowid FROM memories WHERE character_id = ?)', [id]);
      this.db.run('DELETE FROM characters WHERE id = ?', [id]);
      if (existing.isDefault) {
        const next = this.db.get<{ id: string }>('SELECT id FROM characters WHERE archived = 0 ORDER BY created_at LIMIT 1');
        if (next) this.db.run('UPDATE characters SET is_default = 1 WHERE id = ?', [next.id]);
      }
    });
  }

  setDefault(id: string): void {
    if (!this.get(id)) throw new Error('Character not found');
    this.db.transaction(() => {
      this.db.run('UPDATE characters SET is_default = 0');
      this.db.run('UPDATE characters SET is_default = 1, updated_at = ? WHERE id = ?', [nowIso(), id]);
    });
  }

  getDefault(): Character | null {
    const row = this.db.get<Row>('SELECT * FROM characters WHERE is_default = 1 AND archived = 0 LIMIT 1');
    if (row) return this.toRecord(row);
    const any = this.db.get<Row>('SELECT * FROM characters WHERE archived = 0 ORDER BY created_at LIMIT 1');
    return any ? this.toRecord(any) : null;
  }

  count(): number {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM characters')?.n ?? 0);
  }
}
