"""L4 feature — persistence: the adapters that put a project on a disk.

**Purpose.** Be the only place in Nova Studio that knows what a `.nova` file
*is* on the inside, where the app's data lives, and how a crash is survived.
`ports/persistence.py` declares the six capabilities; `domain/persistence.py`
owns the vocabulary; this package is the machinery. A service asks for an
archive and gets one — it never opens a ZIP, never names a column and never
calls `fsync`.

**The decision the architecture left open.** ADR-0004 §6 calls the per-project
store a SQLite container while ADR-0015 defines `.nova` as a ZIP of
canonical-JSON documents. Both are right about different halves of the problem,
so this package answers it explicitly:

    The **archive is the project**: one ZIP of canonical-JSON documents, the
    portable artefact, self-describing, copyable, openable by any zip tool.
    SQLite is a **sidecar for derived data only** — the cache index of proxies,
    thumbnails and waveforms that live in the app data directory, is rebuilt
    when it goes missing, and is never needed to open a project.

SQLite's WAL and shared-memory files cannot live inside a ZIP member, which is
the mechanical reason. The architectural reason is stronger: a project that
needs a database to be read is a project that can be orphaned by a database, and
the recovery path for a missing sidecar is "rebuild from the document" — which is
the path a crash takes anyway, so there is only one path.

**Folder structure.**

```
infra/persistence/
├── __init__.py    this file: the contract, and the decision above
├── canonical.py   canonical JSON in and out, and the digests over it
├── paths.py       where things live: app data, journals, backups, staging
├── archive.py     ZipProjectArchive — the .nova container
├── journal.py     NdjsonJournal — the append-only command log
├── sqlite.py      SqliteGateway — the ONLY module that may import sqlite3
├── migrations.py  the ONLY module that may CREATE a table; the ledger and the
│                  chain, with one chain per database
├── cache.py       SqliteCacheIndex — derived artefacts and what they cost
├── job_store.py   SqliteJobStore — the job history in rows
├── jobs.py        JsonJobStore — the job history as one JSON document, kept so
│                  a file from before the rows can be upgraded
├── settings.py    SqliteSettingsStore — scoped key/value install state
├── recent.py      SqliteRecentFiles — the projects this install has seen
└── work.py        PersistenceUnitOfWork — document first, then rows

No adapter in this list creates its own table. `migrations.py` is the only
place a `CREATE` is written, because an adapter that ran its own
`CREATE TABLE IF NOT EXISTS` at open time would race the migration that
renames that table two versions later, and the loser would be whichever
process happened to start first.
```

**Backend / frontend.** Nothing in the frontend speaks to this package. The API
layer opens a project through `services/projects/session.py`, which takes a
`ProjectArchive` — so a test can hand the session an in-memory archive and the
whole open/save/audit path runs without a filesystem, while production hands it
this one.

**State management.** Two kinds of state, deliberately separated. An archive
holds its committed documents in memory and its **staged** writes beside them,
because "nothing is durable until `commit`" is the property that makes a crash
safe. A journal holds one open file handle, because an append has to be a
`write`, a `flush` and an `fsync` rather than three syscalls and a close. No
global state, no singletons, no caches that outlive their owner.

**Functions and APIs.**

| Call | Answers |
| --- | --- |
| `ZipProjectArchive(path)` | "read, stage and atomically write this project file" |
| `.read_manifest()` / `.read_document(name)` / `.read_blob(name)` | "what does this project hold" |
| `.checkpoint(recorded_at_ms, label)` | "remember this moment, and keep only five of them" |
| `.restore(sequence)` | "give me the project as it was at this checkpoint" |
| `.damaged_entries()` | "which parts of this file disagree with their checksums" |
| `.commit()` / `.discard()` | "make it durable" / "I have changed my mind" |
| `open_journal(data_root, project_id, started_ms)` | "the crash log for this project" |
| `open_cache_index(path)` · `SqliteCacheIndex` | "what derived bytes do we hold" |
| `open_job_store(root)` · `SqliteJobStore` | "what jobs ran, and how did they end" |
| `import_json_history(store, path)` | "adopt the history from before the rows" |
| `job_history_path(root)` · `JsonJobStore` | the same history as one JSON document; kept only for that upgrade |
| `open_settings_store(root)` · `SqliteSettingsStore` | "what did this install decide to remember" |
| `open_recent_files(root)` · `SqliteRecentFiles` | "which projects has this install seen, and was one left dirty" |
| `ensure_schema(gateway, migrations=…)` | "bring this database up to this build, or refuse it" |
| `PersistenceUnitOfWork(archive=…, rows=…)` | "commit these two together or not at all" |

**Events.** None. Persistence is called, it does not announce itself — the
caller already knows whether the save worked, and an event would be a second
notification of something the return value just said.

**Error handling.** `Result[T]` everywhere, on the port's codes:
`NS-STORAGE-4001` unwritable, `-4002` corrupt, `-4003` unsupported version,
`-4004` no such revision, `-4005` I/O failed. Two rules shape them. A failure
that leaves the user's work intact is **retryable** and says so (a full disk);
a failure that means the bytes are not a project is not (a truncated file). And
**corruption is reported per entry**, never for the whole file: one damaged
thumbnail is a regeneration, not a refusal to open someone's edit.

**Caching.** The archive caches the documents it read, because a project is tens
of kilobytes of JSON and open is a handful of reads. It does **not** cache blobs,
which may be megabytes of proxy, and it does not cache across a `commit`.

**Performance.** A save is: serialise every document (small), write one
temporary ZIP, fsync it, copy the old file to `.bak`, `os.replace`, fsync the
directory. The two fsyncs are the expensive part and they are the reason a crash
cannot lose the previous version. A save of an unchanged project writes nothing
at all, because `commit` with nothing staged returns early — which is what lets
autosave run on a timer.

**Testing.** `tests/infra/` pins this package against the real filesystem with
`tmp_path`, because the properties that matter here — atomicity, fsync, a torn
journal tail — are exactly the properties an in-memory fake cannot witness. The
port contract itself is pinned against fakes in
`tests/ports/test_persistence_ports.py`, so the two suites meet in the middle.

**Database schema.** Two databases, and `docs/architecture/database-schema.md` is
the normative description of both: every table, every index, the reason each
column is a column, and the migration that created it.

| Database | Tables | May it be deleted? |
| --- | --- | --- |
| `nova.db` | `schema_migrations`, `settings`, `recent_files`, `jobs` | No — it is the history |
| `cache.sqlite3` | `schema_migrations`, `cache_index` | Yes — costs a rebuild, loses nothing |

Per-project data is **not** in a database: it is the document set inside the
`.nova` file (ADR-0004 §3). Two rules hold across both files. **Rows are an
index, `record_json` is the record** — adding a field to `JobRecord` is not a
migration. And **a read never raises**: a row that will not parse hides itself,
because a corrupt thumbnail is a regeneration, not a refusal to open someone's
edit.

**Future expansion.**

* **A cloud-synced project store** — one more `ProjectArchive` adapter; no
  service changes, because the port is the only contract.
* **A second cache backend** (a plain directory, or a memory-mapped index) — one
  more `CacheIndex`.
* **Embedded proxies as entries** once the product decides the portability is
  worth the size: the layout already reserves `media/`.
"""

from __future__ import annotations

from nova_studio.infra.persistence.archive import (
    DEFAULT_MAX_REVISIONS,
    SUPPORTED_FORMAT_VERSION,
    ZipProjectArchive,
)
from nova_studio.infra.persistence.cache import (
    CACHE_INDEX_DDL,
    SqliteCacheIndex,
    open_cache_index,
)
from nova_studio.infra.persistence.canonical import (
    CanonicalJsonError,
    digest_document,
    digest_of,
    dumps_canonical,
    loads_canonical,
)
from nova_studio.infra.persistence.job_store import (
    SqliteJobStore,
    import_json_history,
    open_job_store,
)
from nova_studio.infra.persistence.jobs import JOB_HISTORY_NAME, JsonJobStore, job_history_path
from nova_studio.infra.persistence.journal import NdjsonJournal, open_journal
from nova_studio.infra.persistence.migrations import (
    CACHE_MIGRATIONS,
    CACHE_SCHEMA_VERSION,
    INSTALL_MIGRATIONS,
    SCHEMA_VERSION,
    Migration,
    MigrationError,
    applied_versions,
    current_version,
    ensure_schema,
)
from nova_studio.infra.persistence.paths import (
    AUTOSAVE_SUBDIR,
    BACKUP_SUFFIX,
    CACHE_DATABASE_NAME,
    INSTALL_DATABASE_NAME,
    backup_path,
    cache_database_path,
    install_database_path,
    is_journal_name,
    is_safe_project_id,
    journal_dir,
)
from nova_studio.infra.persistence.recent import (
    DEFAULT_KEEP,
    SqliteRecentFiles,
    open_recent_files,
)
from nova_studio.infra.persistence.settings import SqliteSettingsStore, open_settings_store
from nova_studio.infra.persistence.sqlite import SqliteError, SqliteGateway
from nova_studio.infra.persistence.work import (
    PersistenceCommitError,
    PersistenceUnitOfWork,
)

__all__ = [
    "AUTOSAVE_SUBDIR",
    "BACKUP_SUFFIX",
    "CACHE_DATABASE_NAME",
    "CACHE_INDEX_DDL",
    "CACHE_MIGRATIONS",
    "CACHE_SCHEMA_VERSION",
    "DEFAULT_KEEP",
    "DEFAULT_MAX_REVISIONS",
    "INSTALL_DATABASE_NAME",
    "INSTALL_MIGRATIONS",
    "JOB_HISTORY_NAME",
    "SCHEMA_VERSION",
    "SUPPORTED_FORMAT_VERSION",
    "CanonicalJsonError",
    "JsonJobStore",
    "Migration",
    "MigrationError",
    "NdjsonJournal",
    "PersistenceCommitError",
    "PersistenceUnitOfWork",
    "SqliteCacheIndex",
    "SqliteError",
    "SqliteGateway",
    "SqliteJobStore",
    "SqliteRecentFiles",
    "SqliteSettingsStore",
    "ZipProjectArchive",
    "applied_versions",
    "backup_path",
    "cache_database_path",
    "current_version",
    "digest_document",
    "digest_of",
    "dumps_canonical",
    "ensure_schema",
    "import_json_history",
    "install_database_path",
    "is_journal_name",
    "is_safe_project_id",
    "job_history_path",
    "journal_dir",
    "loads_canonical",
    "open_cache_index",
    "open_job_store",
    "open_journal",
    "open_recent_files",
    "open_settings_store",
]
