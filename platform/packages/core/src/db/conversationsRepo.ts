import type { SqlDriver } from './types.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import { safeParse, toJson } from '../util/json.js';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';
export type Message = {
  id: string;
  conversationId: string;
  characterId: string;
  role: MessageRole;
  content: string;
  meta: Record<string, unknown>;
  createdAt: string;
};
export type Conversation = {
  id: string;
  characterId: string;
  title: string;
  mode: 'companion' | 'agent';
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  messageCount?: number;
};

type ConvRow = {
  id: string;
  character_id: string;
  title: string;
  mode: string;
  created_at: string;
  updated_at: string;
  archived: number;
  message_count?: number;
};
type MsgRow = {
  id: string;
  conversation_id: string;
  character_id: string;
  role: string;
  content: string;
  meta_json: string;
  created_at: string;
};

export class ConversationsRepo {
  constructor(private readonly db: SqlDriver) {}

  private conv(r: ConvRow): Conversation {
    return {
      id: r.id,
      characterId: r.character_id,
      title: r.title,
      mode: r.mode === 'agent' ? 'agent' : 'companion',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      archived: r.archived === 1,
      messageCount: r.message_count,
    };
  }

  private msg(r: MsgRow): Message {
    return {
      id: r.id,
      conversationId: r.conversation_id,
      characterId: r.character_id,
      role: (['user', 'assistant', 'system', 'tool'] as const).includes(r.role as never) ? (r.role as MessageRole) : 'system',
      content: r.content,
      meta: safeParse<Record<string, unknown>>(r.meta_json, {}),
      createdAt: r.created_at,
    };
  }

  create(characterId: string, title = 'New conversation', mode: 'companion' | 'agent' = 'companion'): Conversation {
    const id = newId('cnv');
    const now = nowIso();
    this.db.run(
      'INSERT INTO conversations (id, character_id, title, mode, created_at, updated_at, archived) VALUES (?, ?, ?, ?, ?, ?, 0)',
      [id, characterId, title, mode, now, now],
    );
    return this.get(id)!;
  }

  get(id: string): Conversation | null {
    const row = this.db.get<ConvRow>('SELECT * FROM conversations WHERE id = ?', [id]);
    return row ? this.conv(row) : null;
  }

  list(characterId?: string, limit = 50): Conversation[] {
    const rows = characterId
      ? this.db.all<ConvRow>(
          `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
           FROM conversations c WHERE c.character_id = ? AND c.archived = 0 ORDER BY c.updated_at DESC LIMIT ?`,
          [characterId, limit],
        )
      : this.db.all<ConvRow>(
          `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
           FROM conversations c WHERE c.archived = 0 ORDER BY c.updated_at DESC LIMIT ?`,
          [limit],
        );
    return rows.map((r) => this.conv(r));
  }

  rename(id: string, title: string): void {
    this.db.run('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?', [title.slice(0, 200), nowIso(), id]);
  }

  archive(id: string): void {
    this.db.run('UPDATE conversations SET archived = 1, updated_at = ? WHERE id = ?', [nowIso(), id]);
  }

  delete(id: string): void {
    this.db.run('DELETE FROM conversations WHERE id = ?', [id]);
  }

  addMessage(input: {
    conversationId: string;
    characterId: string;
    role: MessageRole;
    content: string;
    meta?: Record<string, unknown>;
  }): Message {
    const id = newId('msg');
    const now = nowIso();
    this.db.transaction(() => {
      this.db.run(
        'INSERT INTO messages (id, conversation_id, character_id, role, content, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, input.conversationId, input.characterId, input.role, input.content, toJson(input.meta ?? {}), now],
      );
      this.db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [now, input.conversationId]);
      const count = Number(
        this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?', [input.conversationId])?.n ?? 0,
      );
      if (count === 1 && input.role === 'user') {
        this.db.run('UPDATE conversations SET title = ? WHERE id = ?', [input.content.slice(0, 80), input.conversationId]);
      }
    });
    const row = this.db.get<MsgRow>('SELECT * FROM messages WHERE id = ?', [id]);
    if (!row) throw new Error('Message insert failed');
    return this.msg(row);
  }

  messages(conversationId: string, limit = 500): Message[] {
    return this.db
      .all<MsgRow>('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?', [
        conversationId,
        limit,
      ])
      .map((r) => this.msg(r));
  }

  recentMessages(conversationId: string, limit: number): Message[] {
    const rows = this.db.all<MsgRow>(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
      [conversationId, limit],
    );
    return rows.reverse().map((r) => this.msg(r));
  }

  searchMessages(query: string, characterId?: string, limit = 30): Message[] {
    const like = `%${query.replace(/[%_]/g, (c) => `\\${c}`)}%`;
    const rows = characterId
      ? this.db.all<MsgRow>(
          `SELECT * FROM messages WHERE content LIKE ? ESCAPE '\\' AND character_id = ? ORDER BY created_at DESC LIMIT ?`,
          [like, characterId, limit],
        )
      : this.db.all<MsgRow>(`SELECT * FROM messages WHERE content LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?`, [
          like,
          limit,
        ]);
    return rows.map((r) => this.msg(r));
  }

  deleteHistory(characterId?: string): void {
    if (characterId) this.db.run('DELETE FROM conversations WHERE character_id = ?', [characterId]);
    else this.db.run('DELETE FROM conversations');
  }
}
