"""The job history as rows.

The port's own contract is proved twice in ``test_jobs.py``, which runs against
both adapters. What is left is what a *rows* implementation can be asked that a
document cannot:

* that the queries it was written for are served by the indexes it was written
  with — an index the planner does not use is decoration;
* that a row it cannot parse hides itself and nothing else;
* that an install which predates the database is upgraded, not discarded;
* that the bytes in a row are the bytes the other adapter would have written,
  which is what makes the two interchangeable rather than merely similar;
* that it is safe to use from the several threads that do use it.
"""

from __future__ import annotations

import json
import threading
from typing import TYPE_CHECKING

import pytest

from nova_studio.core.jobs import JobRecord, JobStatus
from nova_studio.infra.persistence.job_store import (
    SqliteJobStore,
    import_json_history,
    open_job_store,
)
from nova_studio.infra.persistence.jobs import JsonJobStore, record_json
from nova_studio.infra.persistence.migrations import INSTALL_MIGRATIONS, ensure_schema
from nova_studio.infra.persistence.sqlite import SqliteGateway

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.unit


def _record(
    job_id: str = "j1",
    *,
    kind: str = "export.video",
    submitted_ms: int = 1_000,
    status: JobStatus = JobStatus.PENDING,
    started_ms: int | None = None,
    finished_ms: int | None = None,
) -> JobRecord:
    return JobRecord(
        job_id=job_id,
        kind=kind,
        submitted_ms=submitted_ms,
        status=status,
        started_ms=started_ms,
        finished_ms=finished_ms,
    )


@pytest.fixture
def store(tmp_path: Path) -> SqliteJobStore:
    gateway = SqliteGateway(tmp_path / "nova.db", shared=True)
    gateway.open()
    ensure_schema(gateway)
    return SqliteJobStore(gateway)


# ---------------------------------------------------------------------------
# What the rows are
# ---------------------------------------------------------------------------


class TestTheRow:
    def test_the_json_column_is_the_record_the_other_adapter_would_have_written(
        self, store: SqliteJobStore
    ) -> None:
        # One spelling of a record, so an upgrade is an import and not a
        # translation, and a bug in one adapter is not a difference in the data.
        record = _record("j1")
        store.put(record)
        row = store._gateway.rows("SELECT record_json FROM jobs WHERE job_id = 'j1'")[0]
        assert row["record_json"] == record_json(record)

    def test_the_columns_are_the_index_and_the_json_is_the_truth(
        self, store: SqliteJobStore
    ) -> None:
        # A field added to JobRecord lands in the JSON without a migration. The
        # columns carry only what is queried.
        store.put(_record("j1", status=JobStatus.RUNNING, started_ms=500))
        row = store._gateway.rows(
            "SELECT kind, status, started_ms, record_json FROM jobs WHERE job_id = 'j1'"
        )[0]
        assert row["kind"] == "export.video"
        assert row["status"] == "running"
        assert row["started_ms"] == 500
        assert json.loads(str(row["record_json"]))["attempts"] == 0

    def test_updated_ms_is_the_last_thing_that_happened_to_the_job(
        self, store: SqliteJobStore
    ) -> None:
        store.put(_record("running", status=JobStatus.RUNNING, started_ms=2_000))
        store.put(_record("done", status=JobStatus.SUCCEEDED, started_ms=1_000, finished_ms=9_000))
        order = [
            str(row["job_id"])
            for row in store._gateway.rows("SELECT job_id FROM jobs ORDER BY updated_ms DESC")
        ]
        # The finished job is "recent" because it finished, not because it was
        # submitted later — which is what the history panel shows.
        assert order == ["done", "running"]


# ---------------------------------------------------------------------------
# The queries the indexes exist for
# ---------------------------------------------------------------------------


class TestTheIndexes:
    def test_by_kind_is_served_by_its_index(self, store: SqliteJobStore) -> None:
        plan = store._gateway.rows(
            "EXPLAIN QUERY PLAN SELECT * FROM jobs WHERE kind = ? ORDER BY updated_ms DESC LIMIT ?",
            ("export.video", 50),
        )
        assert any("jobs_by_kind" in str(row["detail"]) for row in plan)

    def test_pruning_is_served_by_the_status_index(self, store: SqliteJobStore) -> None:
        # Not by `updated_ms`, which is why migration 3 drops that index: the
        # planner judges four terminal statuses more selective than any cutoff.
        plan = store._gateway.rows(
            "EXPLAIN QUERY PLAN DELETE FROM jobs WHERE finished_ms IS NOT NULL"
            " AND finished_ms < ?"
            " AND status IN ('succeeded','failed','cancelled','interrupted')",
            (1,),
        )
        assert any("jobs_by_status" in str(row["detail"]) for row in plan)
        assert not any("SCAN jobs" in str(row["detail"]) for row in plan)

    def test_the_index_the_planner_declined_is_gone(self, store: SqliteJobStore) -> None:
        names = {
            str(row["name"])
            for row in store._gateway.rows(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'"
            )
        }
        assert "jobs_by_updated" not in names
        assert "jobs_by_kind" in names

    def test_a_kind_that_was_never_run_is_empty_not_loud(self, store: SqliteJobStore) -> None:
        store.put(_record("j1"))
        assert store.by_kind("asr.transcribe") == ()

    def test_by_kind_keeps_the_newest_and_stops_at_the_limit(self, store: SqliteJobStore) -> None:
        for index in range(10):
            store.put(_record(f"j{index}", submitted_ms=index))
        assert [r.job_id for r in store.by_kind("export.video", limit=3)] == ["j9", "j8", "j7"]


# ---------------------------------------------------------------------------
# Corruption
# ---------------------------------------------------------------------------


class TestCorruption:
    def test_a_row_that_cannot_be_parsed_hides_only_itself(self, store: SqliteJobStore) -> None:
        store.put(_record("good"))
        store._gateway.run(
            "INSERT INTO jobs (job_id, kind, status, priority, params_hash, submitted_ms,"
            " updated_ms, attempts, record_json) VALUES ('bad', 'export.video', 'pending',"
            " 'normal', '', 1, 1, 0, '{not json')"
        )
        assert store.get("bad") is None
        assert store.get("good") is not None
        assert [r.job_id for r in store.active()] == ["good"]

    def test_a_row_whose_record_contradicts_its_columns_is_read_as_its_record(
        self, store: SqliteJobStore
    ) -> None:
        # The columns say `succeeded`; the record inside says `running`. The
        # record wins, because it is the one with the details — and a history
        # that disagrees with itself is still better shown than hidden.
        store.put(_record("j1", status=JobStatus.RUNNING, started_ms=1))
        store._gateway.run("UPDATE jobs SET status = 'succeeded' WHERE job_id = 'j1'")
        record = store.get("j1")
        assert record is not None
        assert record.status is JobStatus.RUNNING

    def test_pruning_keeps_a_row_that_cannot_prove_it_is_old(self, store: SqliteJobStore) -> None:
        # A row claiming to be terminal with no finish time: prune deletes what
        # it can *prove* is old, and this it cannot. Deleting it would be
        # tidying the history at the cost of a job the user may be waiting on.
        store._gateway.run(
            "INSERT INTO jobs (job_id, kind, status, priority, params_hash, submitted_ms,"
            " updated_ms, attempts, record_json) VALUES ('bad', 'x', 'succeeded', 'normal',"
            " '', 1, 1, 0, 'null')"
        )
        assert store.prune(older_than_ms=10**12) == 0
        assert store._gateway.value("SELECT COUNT(*) FROM jobs") == 1


# ---------------------------------------------------------------------------
# The upgrade: a file history becomes rows
# ---------------------------------------------------------------------------


class TestTheUpgrade:
    def test_opening_creates_and_migrates_the_database(self, tmp_path: Path) -> None:
        store = open_job_store(tmp_path)
        assert (tmp_path / "nova.db").exists()
        rows = store._gateway.rows("SELECT version FROM schema_migrations ORDER BY version")
        assert [row["version"] for row in rows] == [m.version for m in INSTALL_MIGRATIONS]

    def test_a_jobs_json_left_by_an_earlier_build_is_imported(self, tmp_path: Path) -> None:
        legacy = JsonJobStore(tmp_path / "jobs.json")
        legacy.put(_record("old1", status=JobStatus.RUNNING, started_ms=1_000))
        legacy.put(_record("old2", status=JobStatus.SUCCEEDED, started_ms=1_000, finished_ms=2_000))

        store = open_job_store(tmp_path)

        # Not lost, and not flattened into "interrupted" either: what happened
        # is what the file said happened.
        assert store.get("old1") is not None
        assert store.get("old2") is not None
        assert store.get("old2").status is JobStatus.SUCCEEDED

    def test_importing_twice_changes_nothing(self, tmp_path: Path) -> None:
        JsonJobStore(tmp_path / "jobs.json").put(_record("old1"))
        store = open_job_store(tmp_path)
        assert import_json_history(tmp_path / "jobs.json", store) == 0
        assert import_json_history(tmp_path / "jobs.json", store) == 0

    def test_the_file_is_left_where_it_was(self, tmp_path: Path) -> None:
        # Deleting another build's record of work is not ours to decide, and a
        # database that is thrown away can be rebuilt from it.
        (tmp_path / "jobs.json").write_text('{"version":1,"jobs":{}}', encoding="utf-8")
        open_job_store(tmp_path)
        assert (tmp_path / "jobs.json").exists()

    def test_a_file_that_is_not_a_history_is_not_a_failure(self, tmp_path: Path) -> None:
        (tmp_path / "jobs.json").write_text("{not json", encoding="utf-8")
        store = open_job_store(tmp_path)
        assert store.put(_record()).is_ok()


# ---------------------------------------------------------------------------
# Concurrency
# ---------------------------------------------------------------------------


class TestConcurrency:
    def test_ten_threads_writing_ten_jobs_each_lose_nothing(self, store: SqliteJobStore) -> None:
        # The history is written from job threads and read from the request
        # pool, so the gateway is shared and the writes interleave.
        def write(prefix: str) -> None:
            for index in range(10):
                store.put(_record(f"{prefix}-{index}"))

        threads = [threading.Thread(target=write, args=(f"t{n}",)) for n in range(10)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        rows = store._gateway.rows("SELECT COUNT(*) AS n FROM jobs")
        assert rows[0]["n"] == 100

    def test_reconciling_from_two_threads_marks_each_job_once(self, store: SqliteJobStore) -> None:
        for index in range(20):
            store.put(_record(f"j{index}", status=JobStatus.RUNNING, started_ms=1))
        results: list[tuple[JobRecord, ...]] = []
        barrier = threading.Barrier(2)

        def reconcile() -> None:
            barrier.wait()
            results.append(store.reconcile_interrupted())

        threads = [threading.Thread(target=reconcile) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        marked = [r.job_id for result in results for r in result]
        # One thread or the other marks a job; neither marks it twice, and a job
        # interrupted twice is a job the UI offers to resume twice.
        assert len(marked) == len(set(marked))
        assert all(store.get(job_id).status is JobStatus.INTERRUPTED for job_id in marked)
