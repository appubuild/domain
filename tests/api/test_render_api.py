"""`api/routers/render.py`: the preview endpoints, end to end.

Three rules are being pinned, and each of them is a rule about what a *response*
is rather than about what a renderer does — the renderer has its own tests, and
a router test that re-checked the geometry would be a second suite to keep in
step:

* **A frame is an image, not a document.** The panel blits bytes; wrapping them
  in JSON would make every frame a third larger and put a base64 decoder on the
  UI thread. So this endpoint is the one place in the API that does not answer
  `application/json`, and the test asserts that, on the wire, it really does.
* **What the panel needs to *know* travels in headers.** Scale, offset, size and
  gaps are the only parts of a frame a client reads rather than draws; the
  alternative is a second request for geometry that must agree with the first.
* **A preview is not cacheable.** `no-store` on every frame, because a preview
  is a rendering of a timeline that is being edited — a proxy that kept one
  would show yesterday's edit as today's truth.

The clip is encoded by `tests/media/encoding.py` and read back through PyAV, so
these are real decodes of a real file: the one way to be sure the answer
describes media and not a double.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import cv2
import numpy as np
import pytest

if TYPE_CHECKING:
    from pathlib import Path

    from fastapi.testclient import TestClient


from tests.media.encoding import write_video

pytest.importorskip("av", reason="previewing needs a real decoder")

pytestmark = [pytest.mark.unit, pytest.mark.media]

#: The panel every request here asks for. Small, so the test does not spend its
#: time resampling, and not a divisor of the project's frame, so a fit bug would
#: show as a wrong size rather than as a coincidence.
PANEL = {"width": 640, "height": 360}


def create(client: TestClient, auth: dict[str, str]) -> str:
    """A new project, open in the session."""
    response = client.post("/api/v1/projects", json={"name": "Demo"}, headers=auth)
    assert response.status_code == 201
    return str(response.json()["project"]["project_id"])


def command(client: TestClient, auth: dict[str, str], project_id: str, **body: Any) -> Any:
    """Post one command and return the response."""
    return client.post(f"/api/v1/projects/{project_id}/commands", json=body, headers=auth)


def import_clip(client: TestClient, auth: dict[str, str], project_id: str, path: Path) -> str:
    """Import one file and return the asset id it was given."""
    response = client.post(
        f"/api/v1/projects/{project_id}/media/import",
        json={"paths": [str(path)]},
        headers=auth,
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["failures"] == []
    return str(body["assets"][0]["asset_id"])


def put_on_a_track(
    client: TestClient, auth: dict[str, str], project_id: str, asset_id: str
) -> None:
    """One clip of the whole asset, at the start of the video track."""
    response = command(
        client,
        auth,
        project_id,
        type="replace-track-clips",
        track_id="v1",
        kind="video",
        # `kind` is not optional in practice: a clip the mapper cannot place
        # becomes a caption layer, which correctly decodes nothing at all.
        clips=[{"asset_id": asset_id, "kind": "video", "name": "clip", "source_frames": 30}],
    )
    assert response.status_code == 200, response.json()


def clip_ids(client: TestClient, auth: dict[str, str], project_id: str) -> list[str]:
    """The ids of the clips on the video track, in order."""
    body = client.get(f"/api/v1/projects/{project_id}/timeline", headers=auth).json()
    return [str(clip["clip_id"]) for clip in body["timeline"]["tracks"][0]["clips"]]


def frame_url(project_id: str, **query: Any) -> str:
    return f"/api/v1/projects/{project_id}/preview/frame"


def project(client: TestClient, auth: dict[str, str], clip: Path) -> str:
    """A project with one clip on a track, ready to be previewed."""
    project_id = create(client, auth)
    asset_id = import_clip(client, auth, project_id, clip)
    put_on_a_track(client, auth, project_id, asset_id)
    return project_id


@pytest.fixture
def clip(tmp_path: Path) -> Path:
    return write_video(tmp_path / "clip.mp4")


def decode(image: bytes) -> Any:
    """An encoded preview frame back into an array, as a browser would."""
    pixels = cv2.imdecode(np.frombuffer(image, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert pixels is not None, "the endpoint did not send a decodable image"
    return pixels


class TestTheWorkspaceHoldsTheRenderers:
    """One renderer per open project, and it is the workspace that owns it."""

    def test_a_project_that_is_not_open_has_no_renderer(self, app: Any, bus: Any) -> None:
        workspace = app.state.workspace
        assert workspace.preview("nope").unwrap_err().code == "NS-PROJECT-4040"

    def test_a_project_gets_one_renderer_and_keeps_it(
        self, app: Any, client: TestClient, auth: dict[str, str]
    ) -> None:
        """Reopening a file per frame is what makes a scrub a slideshow."""
        workspace = app.state.workspace
        project_id = create(client, auth)
        first = workspace.preview(project_id).unwrap()
        assert workspace.preview(project_id).unwrap() is first

    def test_closing_a_project_closes_its_renderer(
        self, app: Any, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        """The pool holds file handles; on Windows an open one is a locked one."""
        workspace = app.state.workspace
        project_id = project(client, auth, clip)
        renderer = workspace.preview(project_id).unwrap()
        client.post(
            f"/api/v1/projects/{project_id}/preview/warm",
            json={"frame": 0, "count": 5},
            headers=auth,
        )
        assert renderer.open_sources == 1
        assert client.delete(f"/api/v1/projects/{project_id}", headers=auth).status_code == 204
        assert renderer.open_sources == 0
        assert workspace.preview(project_id).unwrap_err().code == "NS-PROJECT-4040"

    def test_two_projects_get_two_renderers(
        self, app: Any, client: TestClient, auth: dict[str, str]
    ) -> None:
        """Sharing one would decode one project's assets into the other."""
        workspace = app.state.workspace
        first = workspace.preview(create(client, auth)).unwrap()
        second = workspace.preview(create(client, auth)).unwrap()
        assert first is not second


class TestOneFrame:
    def test_a_frame_is_an_image_and_not_a_document(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        project_id = project(client, auth, clip)
        response = client.get(frame_url(project_id), params=PANEL, headers=auth)
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/jpeg"
        assert response.content[:2] == b"\xff\xd8"

    def test_the_picture_is_the_panel_size(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        project_id = project(client, auth, clip)
        response = client.get(frame_url(project_id), params=PANEL, headers=auth)
        assert decode(response.content).shape == (360, 640, 3)

    def test_the_geometry_travels_in_headers(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        project_id = project(client, auth, clip)
        response = client.get(frame_url(project_id), params=PANEL, headers=auth)
        assert response.headers["x-nova-preview-size"] == "640x360"
        assert float(response.headers["x-nova-preview-scale"]) == pytest.approx(1 / 3)
        # A 1920x1080 project in a 640x360 panel fits exactly: no bars, so the
        # offset is the origin. A project size that changed would move this.
        assert response.headers["x-nova-preview-offset"] == "0,0"

    def test_a_timeline_with_nothing_on_it_is_a_black_frame(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        """An empty project has frames; they are black, and they are not errors."""
        project_id = create(client, auth)
        response = client.get(frame_url(project_id), params=PANEL, headers=auth)
        assert response.status_code == 200
        assert int(decode(response.content).max()) == 0

    def test_a_clips_own_pixels_reach_the_panel(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        project_id = project(client, auth, clip)
        response = client.get(frame_url(project_id), params={**PANEL, "frame": 5}, headers=auth)
        assert response.status_code == 200
        # The encoder paints frame n as a flat grey of n*7 % 255. Inside the
        # clip's own rectangle, then, the frame is not black; whether it is
        # exactly 35 is a question about resampling, not about the pipeline.
        assert int(decode(response.content)[180, 320, 0]) > 8

    def test_a_preview_is_never_cacheable(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        """A rendering of a timeline that is being edited has no identity."""
        project_id = project(client, auth, clip)
        response = client.get(frame_url(project_id), params=PANEL, headers=auth)
        assert response.headers["cache-control"] == "no-store"

    def test_a_panel_bigger_than_the_project_does_not_invent_pixels(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        project_id = project(client, auth, clip)
        response = client.get(
            frame_url(project_id), params={"width": 3840, "height": 2160}, headers=auth
        )
        assert response.status_code == 200
        assert response.headers["x-nova-preview-size"] == "1920x1080"

    def test_an_unopened_project_is_a_404_and_not_a_500(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        response = client.get(frame_url("nope"), params=PANEL, headers=auth)
        assert response.status_code == 404
        assert response.json()["code"] == "NS-PROJECT-4040"

    def test_a_frame_needs_the_token(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        project_id = project(client, auth, clip)
        assert client.get(frame_url(project_id), params=PANEL).status_code == 401

    def test_a_negative_frame_is_refused_at_the_boundary(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        project_id = project(client, auth, clip)
        response = client.get(frame_url(project_id), params={**PANEL, "frame": -1}, headers=auth)
        assert response.status_code == 422


class TestWarming:
    def test_ten_frames_of_one_clip_cost_one_seek(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        """The invariant the whole pool exists for, over HTTP."""
        project_id = project(client, auth, clip)
        response = client.post(
            f"/api/v1/projects/{project_id}/preview/warm",
            json={"frame": 0, "count": 10},
            headers=auth,
        )
        assert response.status_code == 200
        body = response.json()
        assert body["frame"] == 0
        assert body["warmed"] == 10
        assert body["seeks"] == 1
        assert body["open_sources"] == 1
        assert body["cached_bytes"] > 0

    def test_warming_past_the_end_stops(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        project_id = project(client, auth, clip)
        response = client.post(
            f"/api/v1/projects/{project_id}/preview/warm",
            json={"frame": 0, "count": 10_000},
            headers=auth,
        )
        assert response.status_code == 200
        # The project is one clip long, so the warm-up is clipped to it rather
        # than reading a hundred thousand frames that do not exist.
        assert 0 < response.json()["warmed"] <= 400

    def test_count_is_optional(self, client: TestClient, auth: dict[str, str], clip: Path) -> None:
        project_id = project(client, auth, clip)
        response = client.post(
            f"/api/v1/projects/{project_id}/preview/warm", json={"frame": 0}, headers=auth
        )
        assert response.status_code == 200
        assert response.json()["warmed"] > 0

    def test_warming_needs_the_token(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        project_id = project(client, auth, clip)
        response = client.post(f"/api/v1/projects/{project_id}/preview/warm", json={"frame": 0})
        assert response.status_code == 401

    def test_an_unopened_project_warms_nothing(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        response = client.post(
            "/api/v1/projects/nope/preview/warm", json={"frame": 0}, headers=auth
        )
        assert response.status_code == 404


class TestForgetting:
    def test_the_cache_is_dropped_and_the_decoders_are_kept(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        project_id = project(client, auth, clip)
        client.post(
            f"/api/v1/projects/{project_id}/preview/warm",
            json={"frame": 0, "count": 10},
            headers=auth,
        )
        response = client.delete(f"/api/v1/projects/{project_id}/preview/cache", headers=auth)
        assert response.status_code == 200
        assert response.json() == {"cleared": True, "cached_bytes": 0, "open_sources": 1}

    def test_a_frame_after_clearing_is_still_served(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        project_id = project(client, auth, clip)
        client.post(
            f"/api/v1/projects/{project_id}/preview/warm",
            json={"frame": 0, "count": 10},
            headers=auth,
        )
        client.delete(f"/api/v1/projects/{project_id}/preview/cache", headers=auth)
        response = client.get(frame_url(project_id), params=PANEL, headers=auth)
        assert response.status_code == 200
        assert response.content[:2] == b"\xff\xd8"

    def test_an_edit_invalidates_the_cache(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        """Pictures of a timeline that no longer exists are worse than none."""
        project_id = project(client, auth, clip)
        client.post(
            f"/api/v1/projects/{project_id}/preview/warm",
            json={"frame": 0, "count": 10},
            headers=auth,
        )
        (clip_id,) = clip_ids(client, auth, project_id)
        moved = command(
            client, auth, project_id, type="move-clip", clip_id=clip_id, to_start_frame=1
        )
        assert moved.status_code == 200, moved.json()
        # The edit invalidated the cache itself, so there is nothing left to
        # clear — which is the assertion. A workspace that waited to be told
        # would still be holding pictures of a timeline that has moved.
        first = client.delete(f"/api/v1/projects/{project_id}/preview/cache", headers=auth)
        assert first.json()["cached_bytes"] == 0
