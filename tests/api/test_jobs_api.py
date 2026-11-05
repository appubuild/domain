"""`api/routers/jobs.py`: the endpoints a client uses when it arrives late.

The steady-state flow is subscription — progress arrives on the socket — so what
is pinned here is the *other* half of the contract: the two moments a request is
the right shape.

* **Arriving late.** A client that reconnected, or a window opened over a
  running export, needs the whole picture from one GET. So the row carries the
  progress inside it, and the tests assert that rather than asserting a field
  list.
* **History outliving the pools.** The list is read from the store, not from the
  executor's tables, because after a restart the tables are empty and the file
  is the only thing that remembers. Several of these tests write only to the
  store, which is exactly the state a restarted editor wakes up in.

The executor is a stand-in (`tests/api/job_fakes.py`): whether a worker really
starts is the executor's own question, and it is asked of the real thing with
real processes in `tests/infra/test_jobs.py`. What the store is *not* is a
stand-in — it is the real `JsonJobStore`, so the file format is under test too.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient

from nova_studio.api.app import create_app
from nova_studio.core.errors import NovaError
from nova_studio.core.jobs import JobProgress, JobStatus
from nova_studio.infra.persistence.jobs import JsonJobStore, job_history_path
from nova_studio.ports.jobs import JobErrorCode
from nova_studio.services.render import EXPORT_JOB_KIND, export_job_spec
from tests.api.conftest import BASE_URL
from tests.api.job_fakes import FakeExecutor, record_of

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

    from fastapi import FastAPI

    from nova_studio.api.state import SessionState
    from nova_studio.core.events import EventBus

pytestmark = pytest.mark.unit

#: The kind the history rows carry.
KIND: str = EXPORT_JOB_KIND


@pytest.fixture
def store(tmp_path: Path) -> JsonJobStore:
    """The real history, in a temporary data directory."""
    return JsonJobStore(job_history_path(tmp_path))


@pytest.fixture
def executor(store: JsonJobStore) -> FakeExecutor:
    """A stand-in executor, writing into the real store."""
    return FakeExecutor(store)


@pytest.fixture
def jobs_app(bus: EventBus, session: SessionState, executor: FakeExecutor) -> Iterator[FastAPI]:
    """The application, running against the stand-in executor.

    Built by the test rather than taken from the `app` fixture, because the
    point of the stand-in is that *this* session's pools are not real: an
    export started by mistake here would spawn a worker and encode a file.
    """
    app = create_app(bus, session=session)
    app.state.jobs = executor
    return app


@pytest.fixture
def client(jobs_app: FastAPI) -> Iterator[TestClient]:
    with TestClient(jobs_app, base_url=BASE_URL) as test_client:
        yield test_client


def listed(client: TestClient, auth: dict[str, str]) -> dict[str, object]:
    """The history, asserted to have arrived."""
    response = client.get("/api/v1/jobs", headers=auth)
    assert response.status_code == 200, response.json()
    body: dict[str, object] = response.json()
    return body


class TestTheHistory:
    """`GET /api/v1/jobs` — what a session remembers."""

    def test_it_is_empty_when_nothing_has_run(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        assert listed(client, auth) == {"jobs": [], "count": 0}

    def test_it_is_newest_first(
        self, executor: FakeExecutor, client: TestClient, auth: dict[str, str]
    ) -> None:
        executor.finish("old", record_of("old", KIND, status=JobStatus.SUCCEEDED, submitted_ms=100))
        executor.finish("new", record_of("new", KIND, status=JobStatus.SUCCEEDED, submitted_ms=900))
        body = listed(client, auth)
        jobs: list[dict[str, object]] = body["jobs"]  # type: ignore[assignment]
        assert [job["job_id"] for job in jobs] == ["new", "old"]
        assert body["count"] == 2

    def test_a_job_from_a_previous_run_is_listed(
        self, store: JsonJobStore, client: TestClient, auth: dict[str, str]
    ) -> None:
        """The case a restart produces: in the file, and nowhere in memory."""
        store.put(record_of("before", KIND, status=JobStatus.INTERRUPTED))
        body = listed(client, auth)
        assert body["count"] == 1
        job: dict[str, object] = body["jobs"][0]  # type: ignore[index, assignment]
        assert job["job_id"] == "before"
        assert job["status"] == "interrupted"
        assert job["active"] is False

    def test_a_running_row_carries_the_progress_it_is_showing(
        self, executor: FakeExecutor, client: TestClient, auth: dict[str, str]
    ) -> None:
        """One request resyncs a reconnecting client: the bar and the label come
        inside the row, because a second request for them could disagree."""
        executor.finish(
            "running",
            record_of(
                "running",
                KIND,
                status=JobStatus.RUNNING,
                progress=JobProgress(fraction=0.25, stage="encoding", detail="frame 30/120"),
            ),
        )
        job: dict[str, object] = listed(client, auth)["jobs"][0]  # type: ignore[index, assignment]
        assert job["active"] is True
        progress: dict[str, object] = job["progress"]  # type: ignore[assignment]
        assert progress["percent"] == 25
        assert progress["stage"] == "encoding"
        assert progress["detail"] == "frame 30/120"

    def test_it_needs_a_token(self, client: TestClient) -> None:
        assert client.get("/api/v1/jobs").status_code == 401


class TestOneJob:
    """`GET /api/v1/jobs/{id}` — the resync read."""

    def test_it_answers_with_the_whole_record(
        self, executor: FakeExecutor, client: TestClient, auth: dict[str, str]
    ) -> None:
        executor.finish("job-1", record_of("job-1", KIND, status=JobStatus.SUCCEEDED))
        response = client.get("/api/v1/jobs/job-1", headers=auth)
        assert response.status_code == 200
        body = response.json()
        assert body["job_id"] == "job-1"
        assert body["kind"] == KIND
        assert body["status"] == "succeeded"
        assert body["submitted_ms"] == 1_000
        assert body["finished_ms"] == 1_200
        # Against the executor's fixed now, so the number is assertable.
        assert body["elapsed_ms"] == 200
        assert body["progress"]["percent"] == 0
        assert body["error_code"] is None

    def test_a_failed_job_carries_its_code(
        self, executor: FakeExecutor, client: TestClient, auth: dict[str, str]
    ) -> None:
        executor.finish("job-bad", record_of("job-bad", KIND, status=JobStatus.FAILED))
        body = client.get("/api/v1/jobs/job-bad", headers=auth).json()
        assert body["status"] == "failed"
        assert body["error_code"] == "NS-JOB-5006"
        assert body["active"] is False

    def test_an_unknown_id_is_a_404(self, client: TestClient, auth: dict[str, str]) -> None:
        response = client.get("/api/v1/jobs/nope", headers=auth)
        assert response.status_code == 404
        assert response.headers["content-type"].startswith("application/problem+json")
        assert response.json()["code"] == "NS-PROJECT-4040"

    def test_a_job_only_in_the_history_still_answers(
        self, store: JsonJobStore, client: TestClient, auth: dict[str, str]
    ) -> None:
        """A client reconnecting after a restart asks about an id the pools have
        never heard of, and must not be told it does not exist."""
        store.put(record_of("survivor", KIND, status=JobStatus.INTERRUPTED))
        assert client.get("/api/v1/jobs/survivor", headers=auth).status_code == 200

    def test_it_needs_a_token(self, client: TestClient) -> None:
        assert client.get("/api/v1/jobs/x").status_code == 401


class TestCancelling:
    """`POST /api/v1/jobs/{id}/cancel` — ask, and answer at once."""

    def test_it_answers_before_the_job_has_stopped(
        self, executor: FakeExecutor, client: TestClient, auth: dict[str, str]
    ) -> None:
        """`cancelled: true` means the request was *made*. The job ends on the
        socket, or on the watchdog's watch — not inside this request."""
        executor.submit(export_job_spec(), body=None).unwrap()
        response = client.post("/api/v1/jobs/job-0001/cancel", headers=auth)
        assert response.status_code == 200
        assert response.json() == {
            "job_id": "job-0001",
            "cancelled": True,
            "status": "pending",
        }
        assert executor.cancelled == ["job-0001"]

    def test_a_job_that_has_already_finished_is_a_conflict(
        self, store: JsonJobStore, client: TestClient, auth: dict[str, str]
    ) -> None:
        """409, not 200: a UI offering a cancel button for a finished job has a
        bug, and an endpoint that shrugged would hide it."""
        store.put(record_of("done", KIND, status=JobStatus.SUCCEEDED))
        response = client.post("/api/v1/jobs/done/cancel", headers=auth)
        assert response.status_code == 409
        assert response.json()["code"] == JobErrorCode.JOB_FAILED

    def test_a_job_interrupted_by_a_restart_is_a_conflict_too(
        self, store: JsonJobStore, client: TestClient, auth: dict[str, str]
    ) -> None:
        """The stand-in has no handle for it — the worker died with the previous
        process — so the router's own read of the record is what refuses."""
        store.put(record_of("gone", KIND, status=JobStatus.INTERRUPTED))
        assert client.post("/api/v1/jobs/gone/cancel", headers=auth).status_code == 409

    def test_an_unknown_id_is_a_404(self, client: TestClient, auth: dict[str, str]) -> None:
        assert client.post("/api/v1/jobs/nope/cancel", headers=auth).status_code == 404

    def test_a_refusal_the_router_did_not_predict_is_served_as_its_own_status(
        self, executor: FakeExecutor, client: TestClient, auth: dict[str, str]
    ) -> None:
        """A slot, a breaker, a history that will not write: none of these are
        the generic handler's business, and a 500 would lose the remedy."""
        executor.finish("live", record_of("live", KIND, status=JobStatus.RUNNING))
        executor.refuse_cancel = NovaError(JobErrorCode.KIND_DISABLED, "the breaker is open")
        response = client.post("/api/v1/jobs/live/cancel", headers=auth)
        assert response.status_code == 503
        assert response.json()["code"] == JobErrorCode.KIND_DISABLED

    def test_it_needs_a_token(self, client: TestClient) -> None:
        assert client.post("/api/v1/jobs/x/cancel").status_code == 401
