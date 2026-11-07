# The database schema

**Status:** Normative for ADR-0004 · **Owner:** Architecture Group · **Last reviewed:** 2026-11-07

This is the specification that [`ARCHITECTURE.md`](ARCHITECTURE.md) §6 and ADR-0004 §6 point
at. It is the contract between `domain/persistence` (which decides *what* is stored) and
`infra/persistence` (which decides *how those bytes are written and found again*). Every
table, index and column Nova Studio has is described here; a column not described here is
not part of the schema, and a reader may ignore it.

Normative words: **must**, **must not**, **may**. A migration that produces something this
document does not describe is wrong; a query that depends on something this document does
not promise is also wrong.

Companion documents: [`project-file-format.md`](project-file-format.md) is the byte-level
contract of the `.nova` container, and [`media-and-rendering.md`](media-and-rendering.md)
§7 is what the derived-media cache holds.

---

## 1. What the schema has to survive

| Requirement | Consequence here |
| --- | --- |
| Ten years of schema evolution | An ordered, forward-only migration chain with a ledger (§4). |
| Zero administration | SQLite, no server, no ORM, no connection pool (§9). |
| A crash or a power cut | One transaction per migration (§4.2); one statement per write (§5). |
| A user deleting the cache to get their disk back | The cache is its **own database** (§3.2), never a table beside data that matters. |
| An install that predates versioning | Adoption: a migration whose objects are already there is recorded, not re-run (§4.4). |
| A database written by a newer Nova Studio | Refused whole, `NS-STORAGE-4003` (§4.5). |
| A support engineer reading a bug report | `PRAGMA user_version` is one command, and `schema_migrations` says what ran and when (§4.1). |
| Two windows, or a job thread and a request thread | WAL, one writer, and `shared=True` where a gateway is genuinely shared (§9). |

Non-goals: the database is **not** the project (that is the `.nova` document), **not** the
undo stack (that is the journal, §2), and **not** a store for media bytes (§2).

---

## 2. Where state lives

Five places, chosen so that each has one reason to exist and one lifetime:

| Store | What it holds | Where | May it be deleted? |
| --- | --- | --- | --- |
| `.nova` (ZIP of canonical JSON) | the project: manifest, settings, the authoritative timeline graph, captions, revisions | wherever the user put it | **No** — that is the edit |
| `nova.db` (SQLite, WAL) | install state that cannot be recomputed: settings, the recent-files registry, the job history | the app data directory | No — it *is* the history |
| `cache.sqlite3` (SQLite, WAL) | the index of derived bytes: proxies, thumbnails, waveforms, analysis | the app data directory | **Yes** — costs a rebuild, loses nothing |
| `cache/` (directories) | the derived bytes themselves | beside the index | Yes — the index simply stops finding them |
| `autosave/<project>/cmds-*.ndjson` | the command journal since the last checkpoint | the app data directory | Yes — costs the unsaved tail, which is all it holds |

The asymmetry is the design: **everything in the bottom three can be recomputed; nothing in
the top two can.** An eviction policy, a "clear cache" button and a post-crash report are
all consequences of that one line.

---

## 3. The two databases

```
<data_root>/
├── nova.db            install state: settings, recent_files, jobs      (§5.2–5.4)
├── cache.sqlite3      derived artefacts: cache_index                   (§5.5)
└── cache/…            the bytes the index describes
```

**Why two, and not one.** They are deleted on different schedules. `rm cache.sqlite3` is a
supported way to reclaim disk and costs a rebuild; there is no supported way to delete
`nova.db`, because the job history and the preferences would go with it. A single database
would mean either that clearing the cache was destructive or that the cache could not be
cleared — and one shared version number would tell a support engineer nothing about either
file.

**Why there is no database inside the project.** ADR-0004 §6 proposed a per-project SQLite
container. That was superseded on 2026-11-04 (recorded in `ARCHITECTURE.md` §6): SQLite's
`-wal` and `-shm` files cannot live inside a ZIP member, and a project that needed a
database to be read is a project a database can orphan. The `.nova` archive is
self-describing, so the recovery path for a missing sidecar is the same path a crash takes —
rebuild from the document — which means there is one path and not two.

---

## 4. Migrations

Every table is created by `infra/persistence/migrations.py` and by nothing else. An adapter
that ran its own `CREATE TABLE IF NOT EXISTS` at open time would race the migration that
renames that table two versions later, and the loser would be whichever process started
first — a bug that appears on some machines and not others.

### 4.1 The ledger

```sql
CREATE TABLE schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    applied_ms INTEGER NOT NULL,
    adopted    INTEGER NOT NULL DEFAULT 0
);
```

Both databases carry their own copy. `PRAGMA user_version` is written inside the same
transaction as the ledger row, so the summary a support engineer reads in one command and
the evidence a bug report needs cannot disagree.

The ledger itself is not versioned: it has had exactly one shape since it was written, and
changing it would be a rewrite of the module, not a migration.

### 4.2 The rules

1. **Forward-only.** A migration that has shipped is never edited or removed — not because
   editing is hard, but because a database in the field has already run it and a build that
   "fixes" it in place would leave that install silently different from a fresh one.
2. **One transaction per migration.** Either a migration is applied or it is not. A ledger
   row without its tables is worse than no row, because the next start believes the work is
   done.
3. **Statements, never `executescript`.** `sqlite3` commits any pending transaction before a
   script runs, so wrapping `executescript` in a `begin()` gives the appearance of atomicity
   and none of the substance. A migration is a *tuple* of statements; splitting a SQL script
   would need a parser that understands `BEGIN…END` inside a trigger body, and that parser
   is where a bug would live for a year.
4. **Adoption.** A migration declares what it `creates`, and a database found with those
   objects already present *records* the migration without running it (§4.4).
5. **A newer schema is refused whole** (§4.5).
6. **The default is resolved at call time**, not bound in the signature, so the chain can be
   replaced in a test. A migration system you cannot test except by shipping it is a
   migration system you find out about in a year.

### 4.3 The chain

| v | Name | Creates | Added |
| --- | --- | --- | --- |
| 1 | `install_core` | `settings`, `recent_files`, `recent_files_by_opened` | stage 5 |
| 2 | `job_history` | `jobs`, `jobs_by_kind`, `jobs_by_status` (and `jobs_by_updated`) | stage 5 |
| 3 | `job_history_index_tidy` | — (drops `jobs_by_updated`) | stage 5 |

`jobs_by_updated` is the reason migration 3 exists and the reason the rule about editing a
shipped migration is worth having: it was created for `prune` on the theory that "older than
a timestamp" is a range scan, and `EXPLAIN QUERY PLAN` disagreed — the planner picks
`jobs_by_status`, because four terminal statuses are more selective than any cutoff. An
index the planner declines is not free: it is written on every `put` and read by nobody.

**Adding a migration** is allowed only with the stage that needs the table. An empty table
is a guess about a feature nobody has designed yet; when a stage needs one, it adds a
migration, declares `creates` for adoption, and writes the DDL into §5 of this document.

### 4.4 Adoption

A database that predates versioning — today's `cache.sqlite3`, which has one table and no
ledger — is *adopted*: if every object a migration creates is already present, the migration
is recorded with `adopted = 1` and not run. The distinction is recorded because "applied"
would claim we created something we did not, and a support engineer comparing two
installations deserves the truth.

### 4.5 Refusals

| Situation | Answer |
| --- | --- |
| A database ahead of this build | `NS-STORAGE-4003`, and **nothing is written** — a refused database is one a newer build can still open. |
| A ledger with a hole (v2 recorded, v1 not) | `NS-STORAGE-4002`. Nobody produces this by using the software; running v2 without v1 would fail with a message naming neither. |
| A migration whose second statement fails | Rolled back: neither its table nor its ledger row survives. The migration *before* it stands — one transaction per migration. |

---

## 5. The tables

### 5.1 `schema_migrations` — both databases

See §4.1. Present in `nova.db` and in `cache.sqlite3`, each with its own versions.

### 5.2 `settings` — `nova.db`

```sql
CREATE TABLE settings (
    scope      TEXT    NOT NULL,
    key        TEXT    NOT NULL,
    value      TEXT    NOT NULL,
    updated_ms INTEGER NOT NULL,
    PRIMARY KEY (scope, key)
);
```

* **`scope` is part of the key** because a setting is not one namespace: the install has
  some, a project has some, a plugin has some, and a plugin that could write the install's
  keys could turn the editor off. *Which* scope a caller may write is a rule for the
  settings service (stage 6/10); what the store enforces is the storage half.
* **`value` is JSON**, not a column per type: a setting's type is the setting's business, and
  a migration to add a boolean is absurd. Typed access belongs to the service that knows
  what each setting is.
* **`updated_ms`** is what makes "does this need syncing / when did the user change it"
  answerable without a second table.

Queries: one key (`get`), one scope (`entries`). Both are primary-key lookups; the table is
small by construction, so it carries no index beyond the primary key.

What must **not** go here: anything large (a value is a preference, not a document), and
anything the project owns (that is the `.nova` document).

### 5.3 `recent_files` — `nova.db`

```sql
CREATE TABLE recent_files (
    path        TEXT    PRIMARY KEY,
    project_id  TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    opened_ms   INTEGER NOT NULL,
    closed_ms   INTEGER,
    dirty       INTEGER NOT NULL DEFAULT 0,
    last_status TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX recent_files_by_opened ON recent_files (opened_ms DESC);
```

* **`path` is the key.** A project is where the user put it. Two rows for one path are two
  entries in a list that is supposed to be short; a row keyed by project id would keep a
  stale path alive forever after a move.
* **`dirty` and `last_status` are the last thing this install knew**, not a promise — another
  window may have saved since. They exist so the home screen can say "unsaved" without
  opening the file to find out.
* **The list is bounded by the store** (20 entries, `DEFAULT_KEEP`), enforced inside the
  same transaction as the write. A "recent" list that a caller had to prune is a list that
  grows forever.
* **A close is not a deletion.** `mark_closed` stamps `closed_ms` and `dirty`. A table of
  "projects open right now" is what the workspace is for; this one survives the close.

Queries: `recent(limit)` → `ORDER BY opened_ms DESC LIMIT ?`, served by
`recent_files_by_opened` (asserted by a test, not assumed).

### 5.4 `jobs` — `nova.db`

```sql
CREATE TABLE jobs (
    job_id       TEXT    PRIMARY KEY,
    kind         TEXT    NOT NULL,
    status       TEXT    NOT NULL,
    priority     TEXT    NOT NULL,
    params_hash  TEXT    NOT NULL DEFAULT '',
    submitted_ms INTEGER NOT NULL,
    updated_ms   INTEGER NOT NULL,
    started_ms   INTEGER,
    finished_ms  INTEGER,
    attempts     INTEGER NOT NULL DEFAULT 0,
    error_code   TEXT,
    record_json  TEXT    NOT NULL
);
CREATE INDEX jobs_by_kind   ON jobs (kind, updated_ms DESC);
CREATE INDEX jobs_by_status ON jobs (status);
```

ADR-0004 §1 names two tables, `export_jobs` and `ai_jobs`. There is one, with a `kind`
column, because the two would have identical columns and identical state machines, `by_kind`
already partitions them, and a job kind that is neither export nor AI — a plugin's — would
have nowhere to go.

* **`record_json` is the record; the columns are the index** (§6). Everything the store
  queries is a column; everything else is the record's own canonical JSON.
* **`updated_ms`** is the newest timestamp the record carries (finished, else started, else
  submitted), because "recent" in a job history means "the last thing that happened to it".
* **`priority`, `params_hash`, `attempts`, `error_code` are columns with no query yet.**
  They are the fields the next queries will filter on — retry by `attempts`, "was the input
  changed" by `params_hash`, "what failed" by `error_code` — and they are recorded here
  rather than invented later. A stage that ends without such a query **must** drop them,
  with a migration, rather than leave them as decoration.

Queries, and the index each is served by:

| Port method | Shape | Index |
| --- | --- | --- |
| `by_kind(kind, limit)` | `WHERE kind = ? ORDER BY updated_ms DESC LIMIT ?` | `jobs_by_kind` |
| `active()` | `WHERE status IN (…non-terminal…)` | `jobs_by_status` |
| `reconcile_interrupted()` | `active()`, then one upsert per record, in one transaction | `jobs_by_status` |
| `prune(older_than_ms)` | `WHERE finished_ms < ? AND status IN (…terminal…)` | `jobs_by_status` |
| `get(job_id)` | `WHERE job_id = ?` | primary key |

What must **not** go here: job *output*. Artefacts are paths on disk; the record names them.

### 5.5 `cache_index` — `cache.sqlite3`

```sql
CREATE TABLE cache_index (
    key          TEXT    PRIMARY KEY,
    kind         TEXT    NOT NULL,
    size_bytes   INTEGER NOT NULL,
    created_ms   INTEGER NOT NULL,
    last_used_ms INTEGER NOT NULL,
    pinned       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX cache_index_by_kind ON cache_index (kind, last_used_ms);
```

The one table in the cache database. It stores **bookkeeping only, never bytes** — the bytes
live in `cache/`, beside it, so a user cleaning up can see what they are about to delete.

Which entries to evict is decided by `domain/persistence.select_for_eviction`, a pure
function over these rows; the adapter executes the decision. An adapter that decided policy
would be a second policy, and the two would disagree within a week.

**Deleting this file is supported.** `rm cache.sqlite3` and `rm -r cache/` is a documented
way to reclaim disk, and the only consequence is that proxies and thumbnails are rebuilt
(§7). Nothing in this table is the user's work.

**Recreating it without the runner:** `infra/persistence/cache.CACHE_INDEX_DDL` is the
schema as one script, for a repair tool or a fixture. It is *derived* from
`CACHE_MIGRATIONS[0].statements` rather than written beside it — a second hand-written copy
is a copy that drifts the first time either is changed.

---

## 6. Rows are an index; documents are the truth

ADR-0004 §3 — *the document is authoritative, the tables are a derived index* — applies one
level down, inside `jobs`:

* The columns carry what is **queried**: kind, status, timestamps, attempts.
* `record_json` carries what is **read whole**: progress, artefacts, the resume checkpoint.

The payoff is the same as it is for the project: **a new field on `JobRecord` is not a
migration.** A column per field would make every schema version a negotiation with a table
nobody has queried yet.

The same rule is why a project has no `projects` row. What the install holds is a registry of
*paths* (`recent_files`), not a second copy of the project: a row that duplicated the
document would be a second truth, and two truths disagree after the first crash.

Where a column and its record disagree, **the record wins** — it is the one with the
details. A history that contradicts itself is still better shown than hidden.

---

## 7. Reads degrade, they do not fail

Every table is read on a path that has to work — the window is drawing, the service is
starting, a panel is listing. So:

| Symptom | Answer |
| --- | --- |
| A row whose JSON will not parse | Skipped. One bad record hides itself; the next write for that id overwrites it. |
| A column that contradicts its record | The record wins (§6). |
| A value that JSON cannot spell | Refused at construction, in the domain, not at the column. |
| A table that is missing entirely | Reads return empty; writes return `NS-STORAGE-4001`. |
| A terminal row with no `finished_ms` | Kept by `prune`, which deletes only what it can *prove* is old. |
| A corrupt or foreign database file | Refused at open (`NS-STORAGE-4002`/`4003`), never partially read. |

The one place a failure is fatal is `open_job_store` at start-up: a service whose history
cannot be opened has nothing to report interrupted jobs *from*, and saying so loudly is
better than starting with a history that quietly forgets.

---

## 8. Concurrency, pragmas and locks

* **Pragmas applied by `SqliteGateway`:** `journal_mode=WAL`, `synchronous=NORMAL`,
  `foreign_keys=ON`. WAL is what lets the preview thread read the cache index while a proxy
  job writes it; `NORMAL` survives a process crash and risks only the last commit on a
  machine-level power loss, which is the trade every desktop app makes for a responsive
  save; foreign keys are off in SQLite unless asked, and a constraint nobody enforces is a
  comment.
* **ADR-0004 §4 also lists** `busy_timeout=5000`, `cache_size=-65536`, `temp_store=MEMORY`
  and `mmap_size=268435456`. They are **not applied yet**: each is a performance decision,
  and adding one without a measurement that justifies it is how a database ends up with
  pragmas nobody remembers choosing. `busy_timeout` is the first candidate — it is the
  difference between waiting for a writer and failing instantly.
* **One writer, no pool.** SQLite serialises writers, and a desktop editor writes from one
  place at a time; a pool would add a failure mode (leaked connections) to solve a problem
  we do not have.
* **`shared=True` is opt-in**, and says so in the constructor: it sets
  `check_same_thread=False` and guards every statement with a lock. The cache index and the
  two new install stores use it, because they are read from the request pool and written
  from job threads. The default remains one connection, one owner.
* **Lock ordering** is always store lock → gateway lock, never the reverse.

---

## 9. Performance

| Assumption | Why it holds |
| --- | --- |
| Every table is small — hundreds to thousands of rows | Job history is pruned; settings and recent files are bounded; the cache index is metadata about files. |
| Every read is indexed | §5 lists the index for each query, and `EXPLAIN QUERY PLAN` is asserted in a test rather than believed. |
| Writes are one statement | `put` is one upsert; a reconcile is one transaction. |
| Nothing in a row is large | Records are envelopes; artefacts are paths. |

What would change this: caption segments and word timings (stage 9) and audio analysis
(stage 8) are the first collections measured in hundreds of thousands of rows. When they
arrive, they arrive **with their migration, their indexes and their measurements** — and if
they belong anywhere but `nova.db`, that is a stage-9 decision, made with numbers.

---

## 10. Testing

| Suite | Covers |
| --- | --- |
| `tests/infra/test_persistence_migrations.py` (13) | A fresh install, v1→v3 upgrade with its data intact, adoption of a pre-versioning cache index, a database from a newer build refused without being written to, a hand-edited ledger refused as corrupt, and atomicity: a migration whose second statement fails leaves neither its table nor its ledger row. |
| `tests/infra/test_persistence_job_store.py` (18) | The row shape, `EXPLAIN QUERY PLAN` for each index, a row that will not parse, a row that contradicts its columns, the `jobs.json` → rows upgrade, ten threads writing, two threads reconciling. |
| `tests/infra/test_jobs.py` (47 × 2) | The `JobStore` port contract, run against **both** adapters, so the SQL store is proved to be a second implementation of one contract rather than a second behaviour. |
| `tests/infra/test_persistence_install_state.py` (26) | Settings round-trips with types, scope isolation, an unreadable row hiding itself, the recent-list bound, the index, and both stores' failure codes. |
| `tests/api/test_recent_files.py` (8) | The wiring: open, create-with-a-path, save-as, close — and a store that refuses everything, proving the project still opens and closes. |
| `tests/ports/test_persistence_ports.py` | The port's purity (it names no storage mechanism), its narrowness, and in-memory fakes that satisfy `SettingsStore` and `RecentFiles`. |

Deliberately not tested here: query latency under load (§9 — there is nothing large enough
yet), crash-during-commit of the database file itself (the project's crash safety is
`project-file-format.md` §8 and is tested there), and behaviour on a full disk (a test that
fills a disk is a test nobody can run twice).

---

## 11. Deletion, privacy and backup

* **A user may delete** `cache.sqlite3` and `cache/` at any time. The editor rebuilds what
  it needs and says nothing.
* **A user may not usefully delete** `nova.db`; it holds the job history and the
  preferences. It is regenerated empty if it is missing.
* **Nothing here holds a session token, a password or a licence key.** The token lives in
  the endpoint file the shell was handed (ADR-0005) and is never written to a database.
* **`recent_files.path` is a path on the user's own disk**, recorded because they opened
  that file. It is the one table a privacy-minded user might want cleared, which is why
  `forget` exists.
* **A backup needs the `.nova` files and nothing else.** Every other store is derived or
  reconstructed.

---

## 12. Open decisions

| Decision | When |
| --- | --- |
| Whether assets, tracks, clips, keyframes, markers and caption segments get rows as well as documents — and in which database | stage 7 (timeline) and stage 9 (captions), with measurements (§9) |
| `busy_timeout` and the remaining ADR-0004 §4 pragmas | when there is a contention or latency measurement that justifies one |
| The settings service: which scope a caller may write, and where defaults live | stage 6 (settings panel), stage 10 (plugins) |
| Full-text search over captions (`FTS5` or not) | stage 9 |
| Whether `jobs` keeps the four columns that have no query yet (§5.4) | the stage that would have used them |
| **Who closes a shared gateway.** `open_job_store` and `open_recent_files` hand out gateways that a caller must close, and today some callers are long-lived app state with no shutdown path of their own. The candidates are (a) a DI container that owns every adapter it built and closes them in reverse order, or (b) a `contextlib.ExitStack` per scope. | stage 6, the first stage with several of them |
| **Where `SqliteSettingsStore` is used.** The store is built and tested; nothing writes through it, because there is no settings panel. Defaults still live in code. | stage 6 |
