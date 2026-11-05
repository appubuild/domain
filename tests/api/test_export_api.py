"""`api/routers/export.py`: the one verb, and the promise it makes.

What is being pinned is the *shape of the answer*, not the work: an export takes
minutes, so the handler's whole job is to refuse what cannot succeed, queue what
can, and describe the job it just made. The encoder is never touched here — it
is opened inside a worker, or in this case not at all, because the executor is a
stand-in (`tests/api/job_fakes.py`).

The four things a client depends on:

* **202 with a job id, not 200 with a file.** A request that blocked for nine
  minutes is indistinguishable from a hang.
* **A refusal before a worker exists.** A container the domain does not have, or
  a range that covers nothing, is a 422 now — not a failed job ninety seconds
  from now.
* **A busy pool says 503 and starts nothing**, so the client may ask again.
* **The frame count comes from the project**, resolved against the timeline as
  it stands, because a range that ends past the last clip is a range the domain
  trims rather than a range that fails.

One test encodes a real clip, because the frame count has to come from a
timeline that really has frames. The rest work on an empty project, which is
also the case every one of the refusal tests wants.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any

import pytest
from fastapi.testclient import TestClient

from nova_studio.api.app import create_app
from nova_studio.core.errors import NovaError
from nova_studio.infra.persistence.jobs import JsonJobStore, job_history_path
from nova_studio.ports.jobs import JobErrorCode
from nova_studio.services.render import EXPORT_JOB_KIND
from tests.api.conftest import BASE_URL
from tests.api.job_fakes import FakeExecutor

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

    from fastapi import FastAPI

    from nova_studio.api.state import SessionState
    from nova_studio.core.events import EventBus

from tests.media.encoding import write_video

pytestmark = [pytest.mark.unit, pytest.mark.media]

#: Where every test here asks for the file to go. Absolute, as the schema
#: insists, because a worker's working directory is not the user's.
DESTINATION: str = "/tmp/nova-export-test.mp4"


@pytest.fixture
def executor(tmp_path: Path) -> FakeExecutor:
    """A stand-in executor, on the real history format."""
    return FakeExecutor(JsonJobStore(job_history_path(tmp_path)))


@pytest.fixture
def export_app(bus: EventBus, session: SessionState, executor: FakeExecutor) -> Iterator[FastAPI]:
    """The application, with a stand-in executor and the real job factory.

    The factory is *not* replaced: what it builds is a value, and building it
    is part of what the handler does. Only running it is someone else's job.
    """
    app = create_app(bus, session=session)
    app.state.jobs = executor
    return app


@pytest.fixture
def client(export_app: FastAPI) -> Iterator[TestClient]:
    with TestClient(export_app, base_url=BASE_URL) as test_client:
        yield test_client


def submit(client: TestClient, auth: dict[str, str], project_id: str, **overrides: Any) -> Any:
    """Ask for an export, with the defaults the dialog would send."""
    body = {"path": DESTINATION, **overrides}
    return client.post(f"/api/v1/projects/{project_id}/exports", json=body, headers=auth)


def opened(client: TestClient, auth: dict[str, str]) -> str:
    """A new, empty project."""
    response = client.post("/api/v1/projects", json={"name": "Demo"}, headers=auth)
    assert response.status_code == 201
    return str(response.json()["project"]["project_id"])


def with_a_clip(client: TestClient, auth: dict[str, str], clip: Path) -> str:
    """A project holding one 30-frame clip, so there is something to export."""
    project_id = opened(client, auth)
    imported = client.post(
        f"/api/v1/projects/{project_id}/media/import",
        json={"paths": [str(clip)]},
        headers=auth,
    )
    assert imported.status_code == 200, imported.json()
    asset_id = str(imported.json()["assets"][0]["asset_id"])
    placed = client.post(
        f"/api/v1/projects/{project_id}/commands",
        json={
            "type": "replace-track-clips",
            "track_id": "v1",
            "kind": "video",
            "clips": [
                {
                    "asset_id": asset_id,
                    "kind": "video",
                    "name": "clip",
                    "source_frames": 30,
                }
            ],
        },
        headers=auth,
    )
    assert placed.status_code == 200, placed.json()
    return project_id


@pytest.fixture
def clip(tmp_path: Path) -> Path:
    return write_video(tmp_path / "clip.mp4")


class TestStartingOne:
    """`POST /api/v1/projects/{id}/exports` — 202, and the job it made."""

    def test_it_is_accepted_and_answers_with_the_job(
        self, client: TestClient, auth: dict[str, str], executor: FakeExecutor, clip: Path
    ) -> None:
        project_id = with_a_clip(client, auth, clip)
        response = submit(client, auth, project_id)
        assert response.status_code == 202
        body = response.json()
        assert body["job_id"] == "job-0001"
        assert body["project_id"] == project_id
        assert body["frames"] == 30
        assert DESTINATION in body["detail"]
        assert body["status"] == "pending"

    def test_the_job_is_submitted_under_the_export_kind(
        self, client: TestClient, auth: dict[str, str], executor: FakeExecutor, clip: Path
    ) -> None:
        project_id = with_a_clip(client, auth, clip)
        submit(client, auth, project_id)
        assert len(executor.submitted) == 1
        spec, _body, params_hash = executor.submitted[0]
        assert spec.kind == EXPORT_JOB_KIND
        assert spec.isolation.value == "process"
        # A fingerprint, so two rows asking for the same thing are recognisable
        # as the same export rather than as two the user has to compare.
        assert params_hash

    def test_the_range_the_client_asked_for_is_the_range_the_job_got(
        self, client: TestClient, auth: dict[str, str], executor: FakeExecutor, clip: Path
    ) -> None:
        project_id = with_a_clip(client, auth, clip)
        submit(client, auth, project_id, start_frame=5, end_frame=15)
        _spec, body, _hash = executor.submitted[0]
        assert (body.request.start_frame, body.request.end_frame) == (5, 15)

    def test_the_priority_the_client_asked_for_is_the_priority_the_job_got(
        self, client: TestClient, auth: dict[str, str], executor: FakeExecutor, clip: Path
    ) -> None:
        project_id = with_a_clip(client, auth, clip)
        submit(client, auth, project_id, priority="high")
        spec, _body, _hash = executor.submitted[0]
        assert spec.priority.value == "high"

    def test_the_size_defaults_to_the_projects(
        self,
        export_app: FastAPI,
        client: TestClient,
        auth: dict[str, str],
        executor: FakeExecutor,
        clip: Path,
    ) -> None:
        """A dialog that had to know the project's frame size to ask for it
        would be doing the domain's arithmetic in JavaScript."""
        project_id = with_a_clip(client, auth, clip)
        submit(client, auth, project_id)
        _spec, body, _hash = executor.submitted[0]
        project = export_app.state.workspace.get(project_id).project
        size = project.settings.frame_size
        assert (body.request.spec.video.width, body.request.spec.video.height) == (
            size.width,
            size.height,
        )

    def test_the_body_a_worker_would_get_crosses_the_process_boundary(
        self, client: TestClient, auth: dict[str, str], executor: FakeExecutor, clip: Path
    ) -> None:
        """The one failure this catches is silent and expensive: a factory that
        captured a decoder, a lock or a lambda would pickle-fail *after* a
        process had been scheduled, so the executor refuses it at submit time
        and the 202 is never written."""
        import pickle

        project_id = with_a_clip(client, auth, clip)
        submit(client, auth, project_id)
        _spec, body, _hash = executor.submitted[0]
        back = pickle.loads(pickle.dumps(body))
        assert back.request.path == DESTINATION
        assert back.project.timeline.duration_frames == 30

    def test_it_needs_a_token(self, client: TestClient, auth: dict[str, str], clip: Path) -> None:
        project_id = with_a_clip(client, auth, clip)
        response = client.post(f"/api/v1/projects/{project_id}/exports", json={"path": DESTINATION})
        assert response.status_code == 401


class TestRefusing:
    """What must never reach a worker."""

    def test_a_project_that_is_not_open_is_a_404(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        response = submit(client, auth, "nope")
        assert response.status_code == 404
        assert response.json()["code"] == "NS-PROJECT-4040"

    def test_a_container_the_domain_does_not_have_is_a_422(
        self, client: TestClient, auth: dict[str, str], executor: FakeExecutor
    ) -> None:
        project_id = opened(client, auth)
        response = submit(client, auth, project_id, container="avi")
        assert response.status_code == 422
        assert response.headers["content-type"].startswith("application/problem+json")
        assert executor.submitted == []

    def test_a_range_that_covers_nothing_is_a_422(
        self, client: TestClient, auth: dict[str, str], executor: FakeExecutor
    ) -> None:
        """An empty project has no frames, and an export of no frames is a
        request nobody meant to make."""
        project_id = opened(client, auth)
        response = submit(client, auth, project_id, end_frame=0)
        assert response.status_code == 422
        assert executor.submitted == []

    def test_a_range_past_the_last_clip_is_trimmed_not_refused(
        self, client: TestClient, auth: dict[str, str], executor: FakeExecutor, clip: Path
    ) -> None:
        """Asking for more than the project has is normal: the domain ends the
        export at the last frame rather than at the user's guess."""
        project_id = with_a_clip(client, auth, clip)
        response = submit(client, auth, project_id, end_frame=10_000)
        assert response.status_code == 202
        assert response.json()["frames"] == 30

    def test_a_priority_the_scheduler_does_not_have_is_a_422(
        self, client: TestClient, auth: dict[str, str], executor: FakeExecutor, clip: Path
    ) -> None:
        """Silently degrading it to `low` would make the user wait behind
        everything else and never tell them why."""
        project_id = with_a_clip(client, auth, clip)
        response = submit(client, auth, project_id, priority="urgent")
        assert response.status_code == 422
        assert executor.submitted == []

    def test_a_busy_pool_is_a_503_and_starts_nothing(
        self, client: TestClient, auth: dict[str, str], executor: FakeExecutor, clip: Path
    ) -> None:
        """Nothing was queued, so the client may ask again — which is exactly
        what the status promises."""
        project_id = with_a_clip(client, auth, clip)
        executor.refuse = NovaError(JobErrorCode.QUEUE_FULL, "no export slot right now")
        response = submit(client, auth, project_id)
        assert response.status_code == 503
        assert response.json()["code"] == JobErrorCode.QUEUE_FULL
        assert executor.submitted == []


@pytest.mark.integration
def test_an_export_really_runs_in_a_worker_and_lands_in_the_history(
    app: FastAPI, session: SessionState, clip: Path, tmp_path: Path
) -> None:
    """The wiring, not the work.

    Every other test here stands the executor up as a double, which is the
    right thing when what is being pinned is a response. What a double cannot
    prove is that these pieces are connected at all: that the factory's body
    pickles, that `spawn` gives the worker a decoder of its own, that the
    record is written before the work starts, and that the file the worker
    promotes is the path the dialog chose.

    So this one uses the application's *real* executor and waits — on the
    history endpoint, in a loop, which is the one place a test may poll
    because it is not a client.
    """
    from tests.api.conftest import client_for

    destination = tmp_path / "exported.mp4"
    with client_for(app) as client:
        auth = {"Authorization": f"Bearer {session.token.value}"}
        project_id = with_a_clip(client, auth, clip)
        response = submit(client, auth, project_id, path=str(destination))
        assert response.status_code == 202, response.json()
        job_id = str(response.json()["job_id"])

        deadline = time.monotonic() + 120.0
        row: dict[str, Any] = {}
        while time.monotonic() < deadline:
            row = client.get(f"/api/v1/jobs/{job_id}", headers=auth).json()
            if not row["active"]:
                break
            time.sleep(0.05)

        assert row.get("status") == "succeeded", row
        assert row["progress"]["percent"] == 100
        assert row["artefacts"] == [str(destination)]
        assert destination.is_file()
        assert destination.stat().st_size > 0
        # And it is in the history, which is what a restarted editor reads.
        assert client.get("/api/v1/jobs", headers=auth).json()["count"] >= 1
