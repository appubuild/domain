import type { Migration } from './types.js';

/**
 * Versioned, forward-only migrations. Each entry is applied inside a transaction and
 * recorded in `schema_migrations`. Never edit an applied migration; add a new one.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'core_entities',
    up: `
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE characters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        template_key TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        avatar_model TEXT NOT NULL DEFAULT 'procedural',
        avatar_variant TEXT NOT NULL DEFAULT 'holo-jarvis',
        profile_image TEXT,
        config_json TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_characters_updated ON characters(updated_at DESC);

      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'companion',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_conversations_character ON conversations(character_id, updated_at DESC);

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        character_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        meta_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        layer TEXT NOT NULL,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        confidence REAL NOT NULL DEFAULT 0.7,
        source TEXT NOT NULL DEFAULT 'extraction',
        source_conversation_id TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        embedding_json TEXT,
        hash TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_memories_character_layer ON memories(character_id, layer, importance DESC);
      CREATE UNIQUE INDEX idx_memories_character_hash ON memories(character_id, hash);

      CREATE VIRTUAL TABLE memories_fts USING fts5(
        content, tags, tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_name TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        storage_path TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE document_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        character_id TEXT,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_chunks_document ON document_chunks(document_id, chunk_index);
      CREATE VIRTUAL TABLE document_chunks_fts USING fts5(content, tokenize='unicode61 remove_diacritics 2');
    `,
  },
  {
    version: 2,
    name: 'skills_tasks_integrations',
    up: `
      CREATE TABLE skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        version TEXT NOT NULL,
        category TEXT NOT NULL,
        origin TEXT NOT NULL DEFAULT 'builtin',
        enabled INTEGER NOT NULL DEFAULT 1,
        permissions_json TEXT NOT NULL DEFAULT '[]',
        input_schema_json TEXT NOT NULL DEFAULT '{}',
        output_schema_json TEXT NOT NULL DEFAULT '{}',
        config_json TEXT NOT NULL DEFAULT '{}',
        source_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL,
        conversation_id TEXT,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'agent',
        status TEXT NOT NULL DEFAULT 'queued',
        plan_json TEXT NOT NULL DEFAULT '[]',
        result_json TEXT,
        error TEXT,
        progress REAL NOT NULL DEFAULT 0,
        requires_confirmation INTEGER NOT NULL DEFAULT 0,
        scheduled_for TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX idx_tasks_status ON tasks(status, created_at DESC);
      CREATE INDEX idx_tasks_character ON tasks(character_id, created_at DESC);

      CREATE TABLE task_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        step_id TEXT,
        level TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_task_events_task ON task_events(task_id, created_at);

      CREATE TABLE permissions (
        permission TEXT PRIMARY KEY,
        decision TEXT NOT NULL,
        scope_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        auth_json TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'disconnected',
        tools_json TEXT NOT NULL DEFAULT '[]',
        last_error TEXT,
        last_connected_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE integrations (
        key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'disconnected',
        config_json TEXT NOT NULL DEFAULT '{}',
        last_error TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE usage_events (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        character_id TEXT,
        task_id TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        audio_seconds REAL NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_usage_created ON usage_events(created_at DESC);
    `,
  },
  {
    version: 3,
    name: 'identity_licensing_audit',
    up: `
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        picture_url TEXT,
        created_at TEXT NOT NULL,
        last_login_at TEXT NOT NULL
      );

      CREATE TABLE entitlements (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        plan TEXT NOT NULL,
        subject TEXT,
        license_key_hint TEXT,
        device_id TEXT,
        issued_at TEXT NOT NULL,
        expires_at TEXT,
        features_json TEXT NOT NULL DEFAULT '[]',
        signature TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        source TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        outcome TEXT NOT NULL,
        detail_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

      CREATE TABLE provider_credentials (
        provider TEXT PRIMARY KEY,
        encrypted_key TEXT NOT NULL,
        key_hint TEXT NOT NULL,
        base_url TEXT,
        added_at TEXT NOT NULL,
        last_verified_at TEXT,
        last_status TEXT NOT NULL DEFAULT 'unverified'
      );
    `,
  },
];
