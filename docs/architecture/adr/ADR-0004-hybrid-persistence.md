# ADR-0004 — Hybrid normalised + document persistence in SQLite

**Status:** Accepted · **Date:** 2026-09-24 · **Deciders:** Architecture Group

## Context

An NLE's data has two very different access patterns:

* **Whole-graph access** at interactive rates. Seeking, playing, scrubbing, ripple-editing
  and exporting all need the entire timeline graph (tracks → clips → effects → keyframes →
  caption layers). A 20-minute project with word-level captions can hold ~40 000 keyframes
  and ~15 000 caption words.
* **Indexed queries** over collections. "Assets tagged `b-roll` and unused", "all caption
  segments overlapping 00:01:23", "export history for this project", "which cache entries
  can be evicted".

Fully normalising the timeline means a seek touches dozens of tables. Keeping only a JSON
document means every list/filter query is a full scan and cannot be indexed.

We also require: zero-admin deployment, single-file projects, transactional autosave, and
crash recovery that never leaves a half-written project.

## Decision

**SQLite, hybrid model.**

1. **Queryable collections are normalised tables**: `projects`, `assets`, `asset_metadata`,
   `tags`, `tracks`, `clips`, `effects`, `keyframes`, `markers`, `caption_documents`,
   `caption_segments`, `caption_words`, `templates`, `fonts`, `settings`, `plugins`,
   `export_jobs`, `ai_jobs`, `recent_files`, `cache_index`, `audio_analysis`.
2. **The timeline graph additionally has an authoritative versioned document**: the `.nova`
   project file (ADR-0015) and a `project_revisions` row per checkpoint. The document is the
   unit of load/save/undo-snapshot/share; the tables are the unit of query.
3. **Both are written in the same SQLite transaction** by the repository layer. A command
   that mutates the timeline updates the document *and* the affected rows atomically.
   Therefore they cannot diverge; if they ever do (crash during a non-transactional external
   write, user-edited file), `ProjectIntegrityChecker` detects it and offers a
   direction-of-truth rebuild.
4. **SQLite pragmas:** `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`,
   `busy_timeout=5000`, `cache_size=-65536` (64 MiB), `temp_store=MEMORY`,
   `mmap_size=268435456`. One writer connection serialised by an in-process lock; readers
   are concurrent.
5. **No ORM.** Hand-written SQL in repository adapters behind `ports/repositories.py`, with
   typed row mappers. Migrations are ordered, versioned, forward-only SQL files
   (`infra/persistence/migrations/NNNN_*.sql`) applied inside a transaction and recorded in
   `schema_migrations`.
6. **Two databases per install:** a global `nova.db` (settings, recent files, fonts,
   plugins, templates, caches) and a per-project `project.nova` SQLite container
   (ADR-0015). Rationale: the global DB must be writable and shared across projects, while a
   project must be a single portable file a user can copy, back up or attach to a bug report.

## Consequences

**Positive**

* Project open is one file read + document parse — O(size), no join storm.
* Every collection query is indexed; e.g. `caption_segments` has
  `(document_id, start_frame)` and `(document_id, speaker_id)` indexes.
* Transactional autosave: a crash loses at most the work since the last commit, never
  corrupts the project.
* Single-file projects are copyable, diffable (document is canonical-JSON), and portable.
* WAL gives concurrent readers during background export/AI without blocking the UI.

**Negative / accepted**

* Dual representation costs code: every mutation touches document + rows. Mitigated by
  concentrating this in the repository layer and covering it with round-trip property tests
  (`tests/persistence/test_document_table_roundtrip.py`).
* SQLite writes are serialised. For a single-user desktop editor the write rate is
  tens/second at worst — far below the limit. Background jobs batch their writes.
* Large documents are re-serialised on save. Mitigated by canonical, stable key ordering and
  by revision checkpointing being incremental in the `.nova` container (ADR-0015 §5).

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| Fully normalised, no document | Seek/playback would issue hundreds of queries; project file would need a bespoke exporter anyway |
| Document-only (pure JSON project) | No indexed queries; media library and history features degrade to full scans |
| PostgreSQL / DuckDB | Server process or single-writer analytics engine; neither fits a zero-admin portable desktop app |
| ORM (SQLAlchemy) | Identity-map overhead on large graphs, hidden query costs, migration coupling; explicit SQL is auditable and faster here |
| Custom binary format for projects | Undiffable, unrepairable, and blocks third-party tooling; we use a documented container instead |
