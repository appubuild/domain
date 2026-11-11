import { Db } from '../src/db/db.js';
import { NodeSqlDriver } from '../src/db/nodeDriver.js';
import { requireTemplate } from '../src/characters/templates.js';
import type { Character, CharacterInput } from '../src/characters/types.js';
import { characterConfigSchema } from '../src/characters/types.js';

export function freshDb(): Db {
  const db = new Db(new NodeSqlDriver(':memory:'));
  db.migrate();
  return db;
}

export function makeCharacterInput(templateKey = 'jarvis-holographic', name?: string): CharacterInput {
  const t = requireTemplate(templateKey);
  return {
    name: name ?? t.name,
    templateKey: t.key,
    avatarModel: 'procedural',
    avatarVariant: t.key,
    avatarSpec: t.avatar,
    profileImage: null,
    config: characterConfigSchema.parse(t.config),
  };
}

export function makeCharacter(db: Db, templateKey = 'jarvis-holographic', name?: string): Character {
  return db.characters.create(makeCharacterInput(templateKey, name));
}
