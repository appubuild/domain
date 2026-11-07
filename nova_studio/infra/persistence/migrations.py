"""L4 — the schema, and the only way it is allowed to change.

Every table in Nova Studio is created here and nowhere else. That is not a
tidiness rule: an adapter that ran its own ``CREATE TABLE IF NOT EXISTS`` at
open time would race the migration that renames the same table two versions
later, and the loser would be whichever process started first — which is to say,
the bug would appear on some machines and not others.

**Two chains, two databases.** The install database (``nova.db``) holds what
cannot be recomputed; the cache database (``cache.sqlite3``) holds what can.
Each carries its own ledger and its own ``user_version``, because they are
deleted on different schedules — the cache may be thrown away wholesale, the
install database may not — and one shared version number would mean the version
of one told you nothing about the other.

Six decisions, each one the shape of a failure it prevents:

**1. The ledger is a table, not just ``PRAGMA user_version``.**
``user_version`` says *where* a database is; ``schema_migrations`` says *what
ran, and when*, which is what a bug report actually needs ("migration 3 ran at
04:12, the crash was at 04:15"). Both are written: the pragma is the summary a
support engineer reads in one command, the table is the evidence.

**2. Forward-only, and a newer schema is refused whole.**
A migration that has shipped is never edited or removed — not because editing
is hard but because a database in the field has already run it, and a build
that "fixes" it in place would leave those installations silently different
from fresh ones. Meeting a database *newer* than this build is therefore the
same situation as meeting a ``.nova`` written by a future release: refuse with
:attr:`~nova_studio.ports.persistence.PersistenceErrorCode.UNSUPPORTED_VERSION`
rather than half-understand it (ADR-0015 rule 5, applied to the database).

**3. One transaction per migration.**
Either a migration is applied or it is not. A ledger row without its tables is
worse than no row at all, because the next start believes the work is done.

**4. Statements, never ``executescript``.**
``sqlite3.Cursor.executescript`` **commits any pending transaction before it
runs**, so wrapping it in a ``begin()`` gives you the appearance of atomicity
and none of the substance: a failure on the third statement leaves the first
two committed. A migration is therefore a *tuple* of statements, executed one
at a time. Splitting a SQL *script* into statements would need a parser that
understands ``BEGIN…END`` inside a trigger body, and a parser written for this
purpose is a place for a bug to hide for a year.

**5. Adoption, for databases that predate versioning.**
Today's ``cache.sqlite3`` has one table and no ledger. Creating it fresh is a
migration; pretending it never existed would mean every existing install grows
a second, empty copy of its own cache index. So a migration declares what it
``creates``, and a database found with those objects already present *records*
the migration without running it.

**6. The ledger itself is not versioned.**
``schema_migrations`` is created with ``CREATE TABLE IF NOT EXISTS`` before
anything else and has had exactly one shape since it was written. Versioning it
would be a bootstrap problem with no upside: a shape change here is a rewrite
of this module, not a migration.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Final

from nova_studio.core.clock import SystemClock
from nova_studio.ports.persistence import PersistenceErrorCode

if TYPE_CHECKING:
    from nova_studio.infra.persistence.sqlite import SqliteGateway
    from nova_studio.ports.clock import Clock

__all__ = [
    "CACHE_MIGRATIONS",
    "CACHE_SCHEMA_VERSION",
    "INSTALL_MIGRATIONS",
    "SCHEMA_VERSION",
    "Migration",
    "MigrationError",
    "applied_versions",
    "current_version",
    "ensure_schema",
]


class MigrationError(RuntimeError):
    """A schema that cannot be brought forward, with the reason as a code.

    Carries a :class:`PersistenceErrorCode` rather than a sentence so the layer
    above — the one that knows whether it was opening a cache index or a job
    history — decides what the user is told.
    """

    def __init__(self, message: str, *, code: PersistenceErrorCode) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class Migration:
    """One forward step, applied inside one transaction.

    ``creates`` names the tables (or indexes) the migration brings into being,
    spelled out rather than parsed out of the SQL: adoption (decision 5) needs
    to ask "is this already here?" and the honest answer is a name, not a
    regular expression over statement text.
    """

    version: int
    name: str
    statements: tuple[str, ...]
    creates: tuple[str, ...] = ()


#: The ledger. Not versioned, and deliberately so (decision 6).
_LEDGER_DDL: Final[str] = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    applied_ms INTEGER NOT NULL,
    adopted    INTEGER NOT NULL DEFAULT 0
)
"""

# ---------------------------------------------------------------------------
# The cache database
# ---------------------------------------------------------------------------

#: v1 — the derived-artefact index. Its own database because it is the one
#: thing a user may delete to get their disk back; see ``paths.py``.
_CACHE_INDEX_TABLE: Final[str] = """
CREATE TABLE IF NOT EXISTS cache_index (
    key          TEXT    PRIMARY KEY,
    kind         TEXT    NOT NULL,
    size_bytes   INTEGER NOT NULL,
    created_ms   INTEGER NOT NULL,
    last_used_ms INTEGER NOT NULL,
    pinned       INTEGER NOT NULL DEFAULT 0
)
"""

CACHE_MIGRATIONS: Final[tuple[Migration, ...]] = (
    Migration(
        version=1,
        name="cache_index",
        creates=("cache_index",),
        statements=(
            _CACHE_INDEX_TABLE,
            # The eviction planner's ordering — "oldest of this kind first" —
            # is the only query this table exists to serve quickly, so it is
            # the one index it carries.
            "CREATE INDEX IF NOT EXISTS cache_index_by_kind ON cache_index (kind, last_used_ms)",
        ),
    ),
)

CACHE_SCHEMA_VERSION: Final[int] = CACHE_MIGRATIONS[-1].version

# ---------------------------------------------------------------------------
# The install database
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# The migrations
# ---------------------------------------------------------------------------
#
# A migration is added when a table is needed by the stage that needs it, and
# not before: an empty table is a guess about a feature somebody has not
# designed yet. The DDL of what is planned lives in
# `docs/architecture/database-schema.md`, which is the document §6 points at.

#: v1 — what a window needs before it can show anything: the install's own
#: settings, and the projects it has seen. Both are read at boot, both are
#: small, and neither can be recomputed, which is why they are not in the cache
#: database.
_MIGRATION_1: Final[Migration] = Migration(
    version=1,
    name="install_core",
    creates=("settings", "recent_files"),
    statements=(
        # Scoped key/value. `scope` is there because a setting is not one
        # namespace: some belong to the install, some to a project, some to a
        # plugin — and a plugin that could write into the install's own keys
        # could turn the editor off. `value` is canonical JSON rather than a
        # column per type, because a setting's type is the setting's business
        # and a schema migration to add one is absurd.
        """
CREATE TABLE IF NOT EXISTS settings (
    scope      TEXT    NOT NULL,
    key        TEXT    NOT NULL,
    value      TEXT    NOT NULL,
    updated_ms INTEGER NOT NULL,
    PRIMARY KEY (scope, key)
)
""",
        # The projects this install has opened. `path` is the key because a
        # project is identified by where the user put it, and two entries for
        # one path are the duplicate the UI would then have to de-duplicate.
        """
CREATE TABLE IF NOT EXISTS recent_files (
    path        TEXT    PRIMARY KEY,
    project_id  TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    opened_ms   INTEGER NOT NULL,
    closed_ms   INTEGER,
    dirty       INTEGER NOT NULL DEFAULT 0,
    last_status TEXT    NOT NULL DEFAULT ''
)
""",
        # "Most recently opened first" is the only order this table is ever read
        # in, so it is the only one worth an index.
        "CREATE INDEX IF NOT EXISTS recent_files_by_opened ON recent_files (opened_ms DESC)",
    ),
)

#: v3 — an index that turned out to be decoration.
#:
#: `jobs_by_updated` was created for `prune`, on the theory that "older than a
#: timestamp" is a range scan. `EXPLAIN QUERY PLAN` disagrees: the planner picks
#: `jobs_by_status`, because four terminal statuses are more selective than any
#: cutoff. An index the planner declines is not free — it is written on every
#: `put` and read by nobody — so it goes.
#:
#: Removed by a *new* migration rather than by editing v2, because v2 has
#: shipped: a migration edited in place leaves every database that already ran
#: it silently different from a fresh one.
_MIGRATION_3: Final[Migration] = Migration(
    version=3,
    name="job_history_index_tidy",
    statements=("DROP INDEX IF EXISTS jobs_by_updated",),
)

#: v2 — the job history, which is what makes a crash survivable: after a power
#: cut there is no executor, nothing is running, and the only thing that can say
#: "these three exports were interrupted" is a row (ADR-0010 §6).
#:
#: ADR-0004 §1 names two tables, `export_jobs` and `ai_jobs`. There is one
#: here, with a `kind` column, for a reason worth writing down: the two tables
#: would have identical columns and identical state machines, `by_kind` already
#: partitions them, and a job kind that is neither export nor AI — a plugin's,
#: say — would have nowhere to go. One table, indexed by the thing that is
#: queried.
#:
#: The columns are the *index*; `record_json` is the record. Everything the
#: store queries — status, kind, time, attempts — is a column so a query is a
#: query; everything else is the record's own canonical wire form, so adding a
#: field to `JobRecord` is not a migration. Same split as the document and the
#: tables in ADR-0004 §3, one level down.
_MIGRATION_2: Final[Migration] = Migration(
    version=2,
    name="job_history",
    creates=("jobs",),
    statements=(
        """
CREATE TABLE IF NOT EXISTS jobs (
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
)
""",
        # `by_kind(kind, limit)` is the query the history panel makes.
        "CREATE INDEX IF NOT EXISTS jobs_by_kind ON jobs (kind, updated_ms DESC)",
        # `reconcile_interrupted` asks for the jobs that were running when the
        # process died: one status, read at start-up, over a table that is
        # mostly terminal rows.
        "CREATE INDEX IF NOT EXISTS jobs_by_status ON jobs (status)",
    ),
)

#: Every migration this build knows, in order. The list *is* the version
#: history; there is no directory to scan, because a directory scanned at
#: runtime is a deployment that can differ between two machines running the
#: same build.
INSTALL_MIGRATIONS: Final[tuple[Migration, ...]] = (_MIGRATION_1, _MIGRATION_2, _MIGRATION_3)

#: The newest install schema this build can open. Read by the tests, and by a
#: support engineer comparing it with `PRAGMA user_version` on a database in
#: the field.
SCHEMA_VERSION: Final[int] = INSTALL_MIGRATIONS[-1].version


# ---------------------------------------------------------------------------
# The runner
# ---------------------------------------------------------------------------


def applied_versions(gateway: SqliteGateway) -> tuple[int, ...]:
    """The versions recorded in ``gateway``, oldest first.

    Creates the ledger if it is not there, which is the ordinary case on a
    first run and on every database that predates versioning.
    """
    gateway.run(_LEDGER_DDL)
    rows = gateway.rows("SELECT version FROM schema_migrations ORDER BY version")
    # The gateway returns plain mappings, so the cast is the row mapper's job —
    # it is the one place that knows this column is an INTEGER.
    return tuple(int(str(row["version"])) for row in rows)


def current_version(gateway: SqliteGateway) -> int:
    """The version this database is at: 0 for one with nothing applied."""
    applied = applied_versions(gateway)
    return applied[-1] if applied else 0


def ensure_schema(
    gateway: SqliteGateway,
    *,
    migrations: tuple[Migration, ...] | None = None,
    clock: Clock | None = None,
) -> int:
    """Bring ``gateway`` up to the newest version of ``migrations``.

    Returns how many ran. The cache index passes its own chain
    (:data:`CACHE_MIGRATIONS`); the default is the install database's.

    The default is resolved *inside* the function rather than bound in the
    signature: a default bound at import time cannot be replaced, which would
    make the chain untestable — and a migration system you cannot test except
    by shipping it is a migration system you find out about in a year.

    Adoption counts as applied but not as run, and is therefore not counted:
    the caller wants to know whether anything *changed*. A database ahead of
    this build is refused with
    :attr:`~nova_studio.ports.persistence.PersistenceErrorCode.UNSUPPORTED_VERSION`,
    and so is a ledger with a hole in it, which is a database somebody edited
    by hand.
    """
    chain = migrations if migrations is not None else INSTALL_MIGRATIONS
    now = clock or SystemClock()
    applied = set(applied_versions(gateway))
    target = chain[-1].version if chain else 0

    if applied and max(applied) > target:
        raise MigrationError(
            f"this database is at version {max(applied)} but this build knows "
            f"only up to {target}; it was written by a newer Nova Studio",
            code=PersistenceErrorCode.UNSUPPORTED_VERSION,
        )

    ran = 0
    for migration in chain:
        if migration.version in applied:
            continue
        # A hole: a later version is recorded but an earlier one is not. Nobody
        # produces this by using the software, so it is hand-edited or copied
        # wrong, and running migration 2 without migration 1 would fail on a
        # missing table with a message that names neither.
        if any(version > migration.version for version in applied):
            raise MigrationError(
                f"migration {migration.version} ({migration.name}) is missing "
                f"but a later one is recorded: {sorted(applied)}",
                code=PersistenceErrorCode.CORRUPT,
            )
        if _adopts(gateway, migration):
            _record(gateway, migration, now.now_ms(), adopted=True)
            applied.add(migration.version)
            continue
        _apply(gateway, migration, now.now_ms())
        applied.add(migration.version)
        ran += 1
    return ran


def _adopts(gateway: SqliteGateway, migration: Migration) -> bool:
    """Whether every object ``migration`` creates is already there."""
    if not migration.creates:
        return False
    for name in migration.creates:
        found = gateway.value(
            "SELECT 1 FROM sqlite_master WHERE type IN ('table', 'index') AND name = ?",
            (name,),
        )
        if found is None:
            return False
    return True


def _apply(gateway: SqliteGateway, migration: Migration, now_ms: int) -> None:
    """Run one migration and record it, or leave nothing behind."""
    gateway.begin()
    try:
        for statement in migration.statements:
            gateway.run(statement)
        _record(gateway, migration, now_ms, adopted=False)
        # The pragma is the summary; written inside the same transaction so the
        # two cannot disagree about where this database is.
        gateway.run(f"PRAGMA user_version = {migration.version}")
    except Exception:
        gateway.rollback()
        raise
    else:
        gateway.commit()


def _record(
    gateway: SqliteGateway,
    migration: Migration,
    now_ms: int,
    *,
    adopted: bool,
) -> None:
    gateway.run(
        "INSERT INTO schema_migrations (version, name, applied_ms, adopted) VALUES (?, ?, ?, ?)",
        (migration.version, migration.name, now_ms, 1 if adopted else 0),
    )
