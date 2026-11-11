import { describe, expect, it } from 'vitest';
import { NodeSqlDriver } from '../src/db/nodeDriver.js';
import { Db } from '../src/db/db.js';
import { currentSchemaVersion, migrate, MIGRATIONS } from '../src/db/index.js';
import { freshDb, makeCharacter, makeCharacterInput } from './helpers.js';

describe('migrations', () => {
  it('applies all migrations and is idempotent', () => {
    const driver = new NodeSqlDriver(':memory:');
    const first = migrate(driver);
    expect(first.currentVersion).toBe(MIGRATIONS.length);
    const second = migrate(driver);
    expect(second.applied).toEqual([]);
    driver.close();
  });

  it('creates FTS5 tables', () => {
    const db = freshDb();
    const tables = db.driver.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_fts'");
    expect(tables.map((t) => t.name).sort()).toEqual(['document_chunks_fts', 'memories_fts']);
    db.close();
  });

  it('rolls back a failed migration without corrupting version', () => {
    const driver = new NodeSqlDriver(':memory:');
    expect(() =>
      migrate(driver, [
        { version: 1, name: 'ok', up: 'CREATE TABLE a (id TEXT);' },
        { version: 2, name: 'bad', up: 'CREATE TABLE a (id TEXT); CREATE TABLE a (id TEXT);' },
      ]),
    ).toThrow(/Migration 2/);
    expect(currentSchemaVersion(driver)).toBe(1);
    driver.close();
  });
});

describe('characters repository', () => {
  it('persists all seven templates and validates round-trip', () => {
    const db = freshDb();
    const keys = ['jarvis-holographic', 'friendly-male', 'friendly-female', 'anime-female-a', 'anime-female-b', 'coding-expert', 'professional-assistant'] as const;
    for (const k of keys) makeCharacter(db, k);
    const list = db.characters.list();
    expect(list).toHaveLength(7);
    for (const c of list) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.avatarSpec.palette.primary).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.config.personality.systemPrompt.length).toBeGreaterThan(40);
    }
    db.close();
  });

  it('keeps first character default and allows reassignment', () => {
    const db = freshDb();
    const a = makeCharacter(db, 'jarvis-holographic', 'A');
    const b = makeCharacter(db, 'friendly-male', 'B');
    expect(db.characters.getDefault()?.id).toBe(a.id);
    db.characters.setDefault(b.id);
    expect(db.characters.getDefault()?.id).toBe(b.id);
    db.close();
  });

  it('duplicates a character with a new id and independent config', () => {
    const db = freshDb();
    const a = makeCharacter(db);
    const copy = db.characters.duplicate(a.id, 'Copy');
    expect(copy.id).not.toBe(a.id);
    expect(copy.name).toBe('Copy');
    db.characters.update(copy.id, { config: { ...copy.config, personality: { ...copy.config.personality, humor: 0.1 } } });
    expect(db.characters.get(a.id)?.config.personality.humor).toBeCloseTo(0.35);
    db.close();
  });

  it('deletes character and cascades conversations + memories', () => {
    const db = freshDb();
    const a = makeCharacter(db);
    const conv = db.conversations.create(a.id);
    db.conversations.addMessage({ conversationId: conv.id, characterId: a.id, role: 'user', content: 'hello there friend' });
    db.memories.insert({ characterId: a.id, layer: 'long_term', category: 'fact', content: 'User prefers green tea.', embedding: null });
    db.characters.remove(a.id);
    expect(db.conversations.list()).toHaveLength(0);
    expect(db.memories.count(a.id)).toBe(0);
    db.close();
  });

  it('rejects invalid character input', () => {
    const db = freshDb();
    const input = makeCharacterInput();
    expect(() => db.characters.create({ ...input, name: '' })).toThrow();
    expect(() => db.characters.create({ ...input, avatarSpec: { ...input.avatarSpec, palette: { ...input.avatarSpec.palette, primary: 'blue' } } })).toThrow();
    db.close();
  });

  it('persists across database reopen (file-backed)', () => {
    const path = `/tmp/aura-test-${Date.now()}.sqlite`;
    const db1 = new Db(new NodeSqlDriver(path));
    db1.migrate();
    const created = db1.characters.create(makeCharacterInput('coding-expert', 'Persisted'));
    db1.close();
    const db2 = new Db(new NodeSqlDriver(path));
    db2.migrate();
    expect(db2.characters.get(created.id)?.name).toBe('Persisted');
    db2.close();
  });
});
