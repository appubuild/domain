"""`api/routers/media.py` and the importing half of `api/workspace.py`.

What is being pinned is a rule about batches, and a rule about honesty:

* **An import is a report, never a failure.** One unreadable file in a selection
  of forty is one entry in `failures` and a 200, because the alternative teaches
  users to import one file at a time and guess which one was bad.
* **A path is used, never improved.** A relative path is refused at the boundary:
  it would resolve against the server's working directory, which for a packaged
  build is wherever the shortcut happened to point.
* **Nothing is recorded when nothing changed.** An import that added no assets
  must not make the project dirty, or the autosave indicator becomes a liar.

The files are encoded in a temporary directory by `tests/media/encoding.py`, so
these are real probes through the real adapter — the one way to be sure the
answer describes a file and not a double.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import pytest

from nova_studio.api.workspace import NS_PROJECT_NOT_OPEN, ProjectWorkspace
from tests.media.encoding import write_audio_only, write_video

if TYPE_CHECKING:
    from pathlib import Path

    from fastapi.testclient import TestClient

    from nova_studio.core.events import EventBus

pytest.importorskip("av", reason="importing media needs a real prober")

pytestmark = [pytest.mark.unit, pytest.mark.media]


@pytest.fixture
def workspace(bus: EventBus, isolated_data_dir: Path) -> ProjectWorkspace:
    """A workspace with nothing open, journalling into a temporary directory."""
    return ProjectWorkspace(bus, data_dir=isolated_data_dir)


@pytest.fixture
def clip(tmp_path: Path) -> Path:
    return write_video(tmp_path / "clip.mp4")


@pytest.fixture
def voice(tmp_path: Path) -> Path:
    return write_audio_only(tmp_path / "voice.m4a")


def create(client: TestClient, auth: dict[str, str]) -> str:
    response = client.post("/api/v1/projects", json={"name": "Demo"}, headers=auth)
    assert response.status_code == 201
    return str(response.json()["project"]["project_id"])


def import_paths(
    client: TestClient, auth: dict[str, str], project_id: str, *paths: Path
) -> dict[str, object]:
    body = client.post(
        f"/api/v1/projects/{project_id}/media/import",
        json={"paths": [str(path) for path in paths]},
        headers=auth,
    )
    assert body.status_code == 200, body.json()
    return dict(body.json())


class TestTheBin:
    def test_a_new_project_has_an_empty_bin(self, client: TestClient, auth: dict[str, str]) -> None:
        project_id = create(client, auth)
        body = client.get(f"/api/v1/projects/{project_id}/media", headers=auth).json()
        assert body == {"project_id": project_id, "assets": [], "total": 0, "missing": 0}

    def test_a_project_that_is_not_open_has_no_bin(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        response = client.get("/api/v1/projects/nope/media", headers=auth)
        assert response.status_code == 404
        assert response.json()["code"] == NS_PROJECT_NOT_OPEN


class TestImporting:
    def test_a_clip_comes_in_probed(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        """The bin row must be drawable without another request."""
        project_id = create(client, auth)
        (asset,) = import_paths(client, auth, project_id, clip)["assets"]  # type: ignore[misc]
        assert asset["kind"] == "video"
        assert asset["name"] == "clip.mp4"
        assert asset["probed"] is True
        assert asset["linked"] is True
        assert asset["duration_seconds"] == pytest.approx(1.001, abs=0.01)
        (video,) = asset["video"]
        assert video["frame_rate"] == "30000/1001", (
            "a rounded rate drifts a frame every few minutes"
        )
        assert (video["width"], video["height"]) == (320, 240)
        assert video["frame_count"] == 30

    def test_its_audio_comes_in_too(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        project_id = create(client, auth)
        (asset,) = import_paths(client, auth, project_id, clip)["assets"]  # type: ignore[misc]
        (audio,) = asset["audio"]
        assert audio["codec_name"] == "aac"
        assert audio["sample_rate"] == 48_000
        assert audio["channels"] == 2

    def test_a_file_with_no_picture_comes_in_as_audio(
        self, client: TestClient, auth: dict[str, str], voice: Path
    ) -> None:
        project_id = create(client, auth)
        (asset,) = import_paths(client, auth, project_id, voice)["assets"]  # type: ignore[misc]
        assert asset["kind"] == "audio"
        assert asset["video"] == []

    def test_a_file_that_is_not_media_is_a_failure_inside_a_200(
        self, client: TestClient, auth: dict[str, str], clip: Path, tmp_path: Path
    ) -> None:
        """A batch cannot fail as a batch: the user gets the good ones and a
        list of the bad ones, in one answer."""
        notes = tmp_path / "notes.txt"
        notes.write_text("this is not footage", encoding="utf-8")
        project_id = create(client, auth)
        report = import_paths(client, auth, project_id, clip, notes)
        assert len(report["assets"]) == 1  # type: ignore[arg-type]
        (failure,) = report["failures"]  # type: ignore[misc]
        assert failure["path"] == str(notes)
        assert failure["code"] == "NS-MEDIA-4001"
        assert failure["remedy"], "a failure with no remedy is a dead end"

    def test_a_missing_file_says_so_per_path(
        self, client: TestClient, auth: dict[str, str], tmp_path: Path
    ) -> None:
        project_id = create(client, auth)
        report = import_paths(client, auth, project_id, tmp_path / "gone.mp4")
        assert report["assets"] == []  # type: ignore[arg-type]
        (failure,) = report["failures"]  # type: ignore[misc]
        assert failure["code"] == "NS-MEDIA-4001"

    def test_the_same_path_twice_is_one_asset(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        """Two assets pointing at one file is two things to relink later."""
        project_id = create(client, auth)
        import_paths(client, auth, project_id, clip)
        again = import_paths(client, auth, project_id, clip)
        assert again["assets"] == []  # type: ignore[arg-type]
        assert again["duplicates"] == [str(clip)]  # type: ignore[arg-type]
        assert client.get(f"/api/v1/projects/{project_id}/media", headers=auth).json()["total"] == 1

    def test_a_path_offered_twice_in_one_selection_is_one_asset(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        project_id = create(client, auth)
        report = import_paths(client, auth, project_id, clip, clip)
        assert len(report["assets"]) == 1  # type: ignore[arg-type]
        assert report["duplicates"] == [str(clip)]  # type: ignore[arg-type]

    def test_a_relative_path_never_reaches_the_disk(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        project_id = create(client, auth)
        response = client.post(
            f"/api/v1/projects/{project_id}/media/import",
            json={"paths": ["clip.mp4"]},
            headers=auth,
        )
        assert response.status_code == 422

    def test_an_empty_selection_is_refused(self, client: TestClient, auth: dict[str, str]) -> None:
        project_id = create(client, auth)
        response = client.post(
            f"/api/v1/projects/{project_id}/media/import", json={"paths": []}, headers=auth
        )
        assert response.status_code == 422

    def test_a_project_that_is_not_open_imports_nothing(
        self, client: TestClient, auth: dict[str, str], clip: Path
    ) -> None:
        response = client.post(
            "/api/v1/projects/nope/media/import",
            json={"paths": [str(clip)]},
            headers=auth,
        )
        assert response.status_code == 404
        assert response.json()["code"] == NS_PROJECT_NOT_OPEN


class TestWhatAnImportRecords:
    def test_it_is_journalled(
        self,
        client: TestClient,
        auth: dict[str, str],
        clip: Path,
        isolated_data_dir: Path,
    ) -> None:
        """The bin is part of the project: a crash before the next save must not
        take it back."""
        project_id = create(client, auth)
        report = import_paths(client, auth, project_id, clip)
        assert report["journal_sequence"] == 1
        assert report["pending_commands"] == 1
        directory = isolated_data_dir / "autosave" / project_id
        entries = [
            json.loads(line)
            for path in sorted(directory.iterdir())
            for line in path.read_text().splitlines()
            if line
        ]
        (entry,) = entries
        assert entry["name"] == "import-media"
        assert entry["payload"]["paths"] == [str(clip)]

    def test_an_import_that_added_nothing_records_nothing(
        self, client: TestClient, auth: dict[str, str], tmp_path: Path
    ) -> None:
        """An autosave indicator that counts failed imports as work is a liar."""
        project_id = create(client, auth)
        report = import_paths(client, auth, project_id, tmp_path / "gone.mp4")
        assert report["assets"] == []  # type: ignore[arg-type]
        assert report["journal_sequence"] == 0
        assert report["pending_commands"] == 0

    def test_the_summary_is_what_the_status_bar_shows(
        self, client: TestClient, auth: dict[str, str], clip: Path, tmp_path: Path
    ) -> None:
        project_id = create(client, auth)
        report = import_paths(client, auth, project_id, clip, tmp_path / "gone.mp4", clip)
        assert report["summary"] == (  # type: ignore[arg-type]
            "1 file imported, 1 duplicate skipped, 1 file could not be read"
        )


class TestTheWorkspaceItself:
    def test_assets_of_a_project_that_is_not_open(self, workspace: ProjectWorkspace) -> None:
        assert workspace.assets("nope").unwrap_err().code == NS_PROJECT_NOT_OPEN

    def test_an_import_into_a_project_that_is_not_open(self, workspace: ProjectWorkspace) -> None:
        result = workspace.import_media("nope", ["/tmp/clip.mp4"])
        assert result.unwrap_err().code == NS_PROJECT_NOT_OPEN

    def test_the_bin_is_read_in_import_order(
        self, workspace: ProjectWorkspace, isolated_data_dir: Path, clip: Path, voice: Path
    ) -> None:
        opened = workspace.create(name="Demo", path=isolated_data_dir / "demo.nova").unwrap()
        workspace.import_media(opened.project_id, [str(clip), str(voice)]).unwrap()
        assets = workspace.assets(opened.project_id).unwrap()
        assert [asset.display_name for asset in assets] == ["clip.mp4", "voice.m4a"]
