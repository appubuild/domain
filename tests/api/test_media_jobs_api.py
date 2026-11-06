"""`api/routers/media.py::ensure_media` and `api/routers/system.py::*_cache`.

Three promises, and they are the ones a client actually plans around:

* **Asking is free, and asking twice is free.** "What is missing" is a pure
  question about the project and the cache, so the endpoint can be called on an
  import, on a repaint, on a timer. A project that is up to date queues nothing
  and says so.
* **The answer is 202 with jobs, never a wait.** A proxy is minutes of CPU; a
  handler that transcoded inline would hold a connection, block a worker in the
  ASGI pool and be indistinguishable from a hang (ADR-0010).
* **The cache is install-wide and disposable.** Reading it is how a panel says
  "your proxies cost 4 GB"; deleting it is a button, because losing it costs a
  rebuild and nothing else (ADR-0015 rule 6).

Most of these tests stand the executor up as a double, because what is being
pinned is a response. The last one uses the application's real executor and
waits — the only way to prove the pieces are connected at all: that the body
pickles, that a worker builds its own cache index, and that the artefact it
promotes is the one the cache then lists.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any

import pytest
from fastapi.testclient import TestClient

from nova_studio.api.app import create_app
from nova_studio.core.errors import NovaError
from nova_studio.domain.persistence import CacheKind
from nova_studio.infra.persistence.jobs import JsonJobStore, job_history_path
from nova_studio.ports.jobs import JobErrorCode
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

#: The source is a real h264 file, which is what earns it a proxy: long-GOP
#: footage charges a whole group of pictures for a sparse seek, and that is
#: exactly what scrubbing does.


@pytest.fixture
def clip(tmp_path: Path) -> Path:
    return write_video(tmp_path / "clip.mp4", gop=10)


@pytest.fixture
def executor(tmp_path: Path) -> FakeExecutor:
    """A stand-in executor, on the real history format."""
    return FakeExecutor(JsonJobStore(job_history_path(tmp_path)))


@pytest.fixture
def media_app(bus: EventBus, session: SessionState, executor: FakeExecutor) -> FastAPI:
    """The application, with a stand-in executor and the real job factory.

    The factory is *not* replaced: what it builds is a value, and building it is
    part of what the handler does. Only running it is someone else's job.
    """
    app = create_app(bus, session=session)
    app.state.jobs = executor
    return app


@pytest.fixture
def client(media_app: FastAPI) -> Iterator[TestClient]:
    with TestClient(media_app, base_url=BASE_URL) as test_client:
        yield test_client


def opened(client: TestClient, auth: dict[str, str]) -> str:
    response = client.post("/api/v1/projects", json={"name": "Demo"}, headers=auth)
    assert response.status_code == 201
    return str(response.json()["project"]["project_id"])


def imported(client: TestClient, auth: dict[str, str], project_id: str, *paths: Path) -> str:
    """Import one file and answer with the asset id it got."""
    body = client.post(
        f"/api/v1/projects/{project_id}/media/import",
        json={"paths": [str(path) for path in paths]},
        headers=auth,
    )
    assert body.status_code == 200, body.json()
    return str(body.json()["assets"][0]["asset_id"])


def placed(client: TestClient, auth: dict[str, str], project_id: str, asset_id: str) -> None:
    """Put the asset on the timeline, which is what makes it earn a proxy."""
    response = client.post(
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
    assert response.status_code == 200, response.json()


def ensure(client: TestClient, auth: dict[str, str], project_id: str, **overrides: Any) -> Any:
    return client.post(
        f"/api/v1/projects/{project_id}/media/ensure",
        json=overrides,
        headers=auth,
    )


class TestAskingForMedia:
    """`POST /api/v1/projects/{id}/media/ensure`."""

    def test_a_clip_on_the_timeline_queues_a_proxy_and_a_strip(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        project_id = opened(client, auth)
        asset_id = imported(client, auth, project_id, clip)
        placed(client, auth, project_id, asset_id)

        response = ensure(client, auth, project_id)

        assert response.status_code == 202, response.json()
        body = response.json()
        assert body["proxies"] == 1
        assert body["strips"] == 1
        assert {job["kind"] for job in body["jobs"]} == {"proxy", "thumbnail"}
        assert all(job["asset_id"] == asset_id for job in body["jobs"])
        assert all(job["job_id"] for job in body["jobs"])

    def test_the_jobs_are_submitted_under_their_own_kinds(
        self, client: TestClient, auth: dict[str, str], clip: Path, executor: FakeExecutor
    ) -> None:
        project_id = opened(client, auth)
        asset_id = imported(client, auth, project_id, clip)
        placed(client, auth, project_id, asset_id)

        ensure(client, auth, project_id)

        kinds = {spec.kind for spec, _body, _hash in executor.submitted}
        assert kinds == {"media.proxy", "media.thumbnail"}

    def test_a_proxy_runs_in_a_process_and_a_strip_on_a_thread(
        self, client: TestClient, auth: dict[str, str], clip: Path, executor: FakeExecutor
    ) -> None:
        """A transcode is minutes of CPU; eight seeks are milliseconds."""
        project_id = opened(client, auth)
        asset_id = imported(client, auth, project_id, clip)
        placed(client, auth, project_id, asset_id)

        ensure(client, auth, project_id)

        by_kind = {spec.kind: spec for spec, _body, _hash in executor.submitted}
        assert by_kind["media.proxy"].isolation.value == "process"
        assert by_kind["media.thumbnail"].isolation.value == "thread"

    def test_identical_requests_collapse(
        self, client: TestClient, auth: dict[str, str], clip: Path, executor: FakeExecutor
    ) -> None:
        """Twenty panels asking for the same clip share one transcode."""
        project_id = opened(client, auth)
        asset_id = imported(client, auth, project_id, clip)
        placed(client, auth, project_id, asset_id)

        ensure(client, auth, project_id)

        # Keyed on the artefact, not merely the asset: a different target size
        # is different work, and work that must not be deduped away.
        keys = {spec.dedupe_key for spec, _body, _hash in executor.submitted}
        assert len(keys) == 2
        assert all(key and asset_id in key for key in keys)
        assert {key.split(":", 1)[0] for key in keys} == {"proxy", "thumbnail"}

    def test_the_body_crosses_the_process_boundary(
        self, client: TestClient, auth: dict[str, str], clip: Path, executor: FakeExecutor
    ) -> None:
        """A job that cannot be pickled is a job that fails in the worker,
        forty seconds after the user asked for it."""
        import pickle

        from nova_studio.services.media import ProxyJob

        project_id = opened(client, auth)
        asset_id = imported(client, auth, project_id, clip)
        placed(client, auth, project_id, asset_id)

        ensure(client, auth, project_id)

        for _spec, body, _hash in executor.submitted:
            revived = pickle.loads(pickle.dumps(body))
            owned = (
                revived.request.asset_id
                if isinstance(revived, ProxyJob)
                else revived.requests[0].asset_id
            )
            assert owned == asset_id

    def test_a_clip_that_is_not_on_the_timeline_earns_no_proxy(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        """Importing two hundred files must not queue two hundred transcodes."""
        project_id = opened(client, auth)
        imported(client, auth, project_id, clip)

        response = ensure(client, auth, project_id)

        assert response.status_code == 202, response.json()
        body = response.json()
        assert body["proxies"] == 0
        assert body["strips"] == 1

    def test_proxies_can_be_left_out(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        """A panel that only needs tiles should be able to say so."""
        project_id = opened(client, auth)
        asset_id = imported(client, auth, project_id, clip)
        placed(client, auth, project_id, asset_id)

        response = ensure(client, auth, project_id, proxies=False)

        body = response.json()
        assert body["proxies"] == 0
        assert body["strips"] == 1

    def test_thumbnails_can_be_left_out(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        project_id = opened(client, auth)
        asset_id = imported(client, auth, project_id, clip)
        placed(client, auth, project_id, asset_id)

        response = ensure(client, auth, project_id, thumbnails=False)

        body = response.json()
        assert body["proxies"] == 1
        assert body["strips"] == 0

    def test_a_project_that_is_up_to_date_queues_nothing(
        self, client: TestClient, auth: dict[str, str], clip: Path, media_app: FastAPI
    ) -> None:
        """The ordinary answer after the first pass — and the reason the
        endpoint can be called on a repaint."""
        project_id = opened(client, auth)
        asset_id = imported(client, auth, project_id, clip)
        placed(client, auth, project_id, asset_id)
        ensure(client, auth, project_id)

        _hold_everything(media_app, project_id)
        response = ensure(client, auth, project_id)

        body = response.json()
        assert body["jobs"] == []
        assert "already" in body["summary"]

    def test_a_project_that_is_not_open_is_a_404(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        response = ensure(client, auth, "not-open")
        assert response.status_code == 404
        assert response.json()["code"] == "NS-PROJECT-4040"

    def test_it_needs_a_token(self, client: TestClient) -> None:
        assert client.post("/api/v1/projects/any/media/ensure", json={}).status_code == 401

    def test_a_busy_pool_is_a_503_and_starts_nothing(
        self, client: TestClient, auth: dict[str, str], clip: Path, executor: FakeExecutor
    ) -> None:
        executor.refuse = NovaError(JobErrorCode.QUEUE_FULL, "every slot is busy")
        project_id = opened(client, auth)
        asset_id = imported(client, auth, project_id, clip)
        placed(client, auth, project_id, asset_id)

        response = ensure(client, auth, project_id)

        assert response.status_code == 503
        assert executor.submitted == []


class TestTheCacheEndpoints:
    """`GET` and `DELETE /api/v1/system/cache`."""

    def test_a_fresh_install_holds_nothing(self, client: TestClient, auth: dict[str, str]) -> None:
        body = client.get("/api/v1/system/cache", headers=auth).json()
        assert body == {"entries": [], "total": 0, "size_bytes": 0}

    def test_what_we_hold_is_listed_oldest_use_first(
        self, client: TestClient, auth: dict[str, str], media_app: FastAPI, tmp_path: Path
    ) -> None:
        cache = media_app.state.workspace.media_cache
        for key, size in (("proxy-a1-h720.mkv", 4_096), ("thumb-a1-f0-w320.jpg", 1_024)):
            path = cache.path_for(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"x" * size)
            cache.record(key, size_bytes=size)

        body = client.get("/api/v1/system/cache", headers=auth).json()

        assert body["total"] == 2
        assert body["size_bytes"] == 5_120
        assert [entry["key"] for entry in body["entries"]] == [
            "proxy-a1-h720.mkv",
            "thumb-a1-f0-w320.jpg",
        ]

    def test_deleting_everything_frees_the_disk_and_says_how_much(
        self, client: TestClient, auth: dict[str, str], media_app: FastAPI
    ) -> None:
        cache = media_app.state.workspace.media_cache
        path = cache.path_for("proxy-a1-h720.mkv")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x" * 2_048)
        cache.record("proxy-a1-h720.mkv", size_bytes=2_048)

        response = client.delete("/api/v1/system/cache", headers=auth)

        assert response.status_code == 200, response.json()
        body = response.json()
        assert body["entries"] == 1
        assert body["size_bytes"] == 2_048
        assert not path.exists()
        assert client.get("/api/v1/system/cache", headers=auth).json()["total"] == 0

    def test_one_kind_can_be_deleted_on_its_own(
        self, client: TestClient, auth: dict[str, str], media_app: FastAPI
    ) -> None:
        """Stale thumbnails are a different problem from a disk that is full."""
        cache = media_app.state.workspace.media_cache
        for key in ("proxy-a1-h720.mkv", "thumb-a1-f0-w320.jpg"):
            path = cache.path_for(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"x" * 128)
            cache.record(key, size_bytes=128)

        response = client.delete("/api/v1/system/cache", params={"kind": "thumbnail"}, headers=auth)

        assert response.status_code == 200, response.json()
        assert response.json()["entries"] == 1
        remaining = client.get("/api/v1/system/cache", headers=auth).json()
        assert [entry["kind"] for entry in remaining["entries"]] == [str(CacheKind.PROXY)]

    def test_a_kind_we_do_not_have_is_a_422(self, client: TestClient, auth: dict[str, str]) -> None:
        response = client.delete("/api/v1/system/cache", params={"kind": "telepathy"}, headers=auth)
        assert response.status_code == 422

    def test_both_need_a_token(self, client: TestClient) -> None:
        assert client.get("/api/v1/system/cache").status_code == 401
        assert client.delete("/api/v1/system/cache").status_code == 401


class TestTheWiring:
    """The whole loop, with the real executor."""

    def test_ensuring_media_makes_it_and_then_lists_it(
        self, bus: EventBus, session: SessionState, clip: Path, tmp_path: Path
    ) -> None:
        """Every other test here stands the executor up as a double. What a
        double cannot prove is that the pieces are connected at all: that the
        body pickles, that a worker builds its own cache index from `data_dir`,
        and that the artefact it promotes is the one the cache then lists.

        So this one runs the real thing and waits — on the jobs endpoint, in a
        loop, which is the one place a test may poll because it is not a client.
        """
        from tests.api.conftest import client_for

        app = create_app(bus, session=session)
        with client_for(app) as client:
            auth = {"Authorization": f"Bearer {session.token.value}"}
            project_id = opened(client, auth)
            asset_id = imported(client, auth, project_id, clip)
            placed(client, auth, project_id, asset_id)

            response = ensure(client, auth, project_id)
            assert response.status_code == 202, response.json()
            jobs = response.json()["jobs"]
            assert len(jobs) == 2

            for job in jobs:
                assert _settles(client, auth, str(job["job_id"])) == "succeeded"

            listed = client.get("/api/v1/system/cache", headers=auth).json()
            assert listed["total"] == len(jobs) or listed["total"] > 1
            assert listed["size_bytes"] > 0
            kinds = {entry["kind"] for entry in listed["entries"]}
            assert str(CacheKind.PROXY) in kinds
            assert str(CacheKind.THUMBNAIL) in kinds

            # Asking again now queues nothing: the work is already done.
            again = ensure(client, auth, project_id)
            assert again.json()["jobs"] == []

            freed = client.delete("/api/v1/system/cache", headers=auth).json()
            assert freed["entries"] >= 2


def _settles(client: TestClient, auth: dict[str, str], job_id: str) -> str:
    """Watch one job to its end, and answer with the status it ended on."""
    deadline = time.monotonic() + 120.0
    row: dict[str, Any] = {}
    while time.monotonic() < deadline:
        row = client.get(f"/api/v1/jobs/{job_id}", headers=auth).json()
        if not row.get("active"):
            break
        time.sleep(0.05)
    return str(row.get("status", ""))


def _hold_everything(app: FastAPI, project_id: str) -> None:
    """Pretend everything that was queued has landed, so a second ask is empty.

    The executor here is a double, so nothing really ran; the cache is the only
    thing that has to believe it did. The keys are whatever the planners ask
    for, never what a test guesses — a target size picked here would be a
    coincidence waiting to break.
    """
    from nova_studio.services.media import (
        proxy_requests,
        thumbnail_requests,
    )

    workspace = app.state.workspace
    cache = workspace.media_cache
    shown = workspace.get(project_id)
    assert shown is not None
    wanted = tuple(proxy_requests(shown.project, cache=cache)) + tuple(
        thumbnail_requests(shown.project, cache=cache)
    )
    assert wanted, "there must be something to hold"
    for request in wanted:
        path = cache.path_for(request.key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x" * 512)
        cache.record(request.key, size_bytes=512)
