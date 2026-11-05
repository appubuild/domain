"""`api/routers/timeline.py` and the editing half of `api/workspace.py`.

What is being pinned here is not that a clip moves — `tests/services/test_timeline_commands.py`
already pins that for every command. It is the rules an editor lives or dies by:

* **The timeline is changed by commands and by nothing else.** A client that
  could replace the edit wholesale would step around validation, undo, the
  journal and the preview cache in one request.
* **An edit is journalled before it is acknowledged**, and one that cannot be
  journalled is rolled back and reported — an editor that keeps an edit it
  cannot replay is an editor that lies after a crash.
* **Undo is an edit.** It is journalled like any other, because a replay that
  skipped it would hand the user back work they threw away.
* **The undo stack belongs to the session, not to the request.** One editor per
  open project, so Ctrl+Z still has something to undo on the next call.

The HTTP tests run through the real application against the real journal in a
temporary data directory; the journalling-failure tests inject a broken journal,
because a full disk is not something a test can arrange by writing files.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.api.workspace import (
    NS_PROJECT_JOURNAL_FAILED,
    NS_PROJECT_NOT_OPEN,
    NS_TIMELINE_OUT_OF_SYNC,
    ProjectWorkspace,
)
from nova_studio.core.errors import NovaError
from nova_studio.core.result import Result, err, ok
from nova_studio.domain.persistence import JournalEntry, JournalWindow
from nova_studio.domain.timeline import Clip, ClipKind, Timeline, Track, TrackKind

if TYPE_CHECKING:
    from pathlib import Path

    from fastapi.testclient import TestClient

    from nova_studio.core.events import EventBus

pytestmark = pytest.mark.unit

#: The clip the seed puts on the timeline, and where.
SEED_CLIP: dict[str, Any] = {
    "asset_id": "a1",
    "kind": "video",
    "name": "one",
    "start_frame": 0,
    "source_frames": 100,
}


@pytest.fixture
def workspace(bus: EventBus, isolated_data_dir: Path) -> ProjectWorkspace:
    """A workspace with nothing open, journalling into a temporary directory."""
    return ProjectWorkspace(bus, data_dir=isolated_data_dir)


def create(client: TestClient, auth: dict[str, str]) -> str:
    """A new project, open in the session."""
    response = client.post("/api/v1/projects", json={"name": "Demo"}, headers=auth)
    assert response.status_code == 201
    return str(response.json()["project"]["project_id"])


def command(client: TestClient, auth: dict[str, str], project_id: str, **body: Any) -> Any:
    """Post one command and return the response."""
    return client.post(f"/api/v1/projects/{project_id}/commands", json=body, headers=auth)


def seed(client: TestClient, auth: dict[str, str], project_id: str, *clips: Any) -> list[str]:
    """Put clips on a video track and return their ids, in order.

    Replacement is the only command that can fill an empty timeline, which is
    what it is for: the caption engine's 400 cues, and this test's two clips.
    """
    specs = [SEED_CLIP if clip is None else clip for clip in clips] or [SEED_CLIP]
    response = command(
        client,
        auth,
        project_id,
        type="replace-track-clips",
        track_id="v1",
        kind="video",
        clips=specs,
    )
    assert response.status_code == 200, response.json()
    clips_now = client.get(f"/api/v1/projects/{project_id}/timeline", headers=auth).json()
    return [str(clip["clip_id"]) for clip in clips_now["timeline"]["tracks"][0]["clips"]]


def clip_at(
    client: TestClient, auth: dict[str, str], project_id: str, clip_id: str
) -> dict[str, Any]:
    """One clip's row, as the timeline reports it."""
    body = client.get(f"/api/v1/projects/{project_id}/timeline", headers=auth).json()
    for track in body["timeline"]["tracks"]:
        for clip in track["clips"]:
            if clip["clip_id"] == clip_id:
                return dict(clip)
    raise AssertionError(f"{clip_id} is not on the timeline: {body}")


def journal_names(data_dir: Path, project_id: str) -> list[str]:
    """The names recorded in one project's journal, in order."""
    directory = data_dir / "autosave" / project_id
    lines = [
        line
        for path in sorted(directory.iterdir())
        for line in path.read_text().splitlines()
        if line
    ]
    return [str(json.loads(line)["name"]) for line in lines]


class TestReadingTheTimeline:
    def test_a_new_project_has_an_empty_edit(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        project_id = create(client, auth)
        body = client.get(f"/api/v1/projects/{project_id}/timeline", headers=auth).json()
        assert body["timeline"]["tracks"] == []
        assert body["timeline"]["clip_count"] == 0
        assert body["history"] == {
            "can_undo": False,
            "can_redo": False,
            "undo_label": "",
            "redo_label": "",
            "undo_depth": 0,
            "redo_depth": 0,
            "recent": [],
        }

    def test_the_rate_the_frontend_draws_with_is_the_projects(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        project_id = create(client, auth)
        timebase = client.get(f"/api/v1/projects/{project_id}/timeline", headers=auth).json()
        assert timebase["timeline"]["timebase"] == {"num": 30, "den": 1, "fps": 30.0}

    def test_a_clip_is_described_in_frames_not_seconds(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        project_id = create(client, auth)
        (clip_id,) = seed(client, auth, project_id)
        assert clip_at(client, auth, project_id, clip_id) == {
            "clip_id": clip_id,
            "asset_id": "a1",
            "kind": "video",
            "name": "one",
            "start_frame": 0,
            "end_frame": 100,
            "duration_frames": 100,
            "in_frame": 0,
            "out_frame": 100,
            "speed": 1.0,
            "enabled": True,
        }

    def test_a_project_that_is_not_open_has_no_timeline(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        response = client.get("/api/v1/projects/nope/timeline", headers=auth)
        assert response.status_code == 404
        assert response.json()["code"] == NS_PROJECT_NOT_OPEN


class TestApplyingACommand:
    def test_a_clip_moves(self, client: TestClient, auth: dict[str, str]) -> None:
        project_id = create(client, auth)
        (clip_id,) = seed(client, auth, project_id)
        response = command(
            client, auth, project_id, type="move-clip", clip_id=clip_id, to_start_frame=40
        )
        assert response.status_code == 200
        assert clip_at(client, auth, project_id, clip_id)["start_frame"] == 40

    def test_a_trim_moves_one_end(self, client: TestClient, auth: dict[str, str]) -> None:
        project_id = create(client, auth)
        (clip_id,) = seed(client, auth, project_id)
        response = command(
            client, auth, project_id, type="trim-clip", clip_id=clip_id, to_frame=60, edge="end"
        )
        assert response.status_code == 200
        clip = clip_at(client, auth, project_id, clip_id)
        assert clip["end_frame"] == 60
        assert clip["start_frame"] == 0, "a trim of the end must not move the head"

    def test_a_slip_moves_neither_end(self, client: TestClient, auth: dict[str, str]) -> None:
        project_id = create(client, auth)
        (clip_id,) = seed(client, auth, project_id)
        response = command(
            client, auth, project_id, type="slip-clip", clip_id=clip_id, delta_frames=5
        )
        assert response.status_code == 200
        clip = clip_at(client, auth, project_id, clip_id)
        assert clip["start_frame"] == 0
        assert clip["duration_frames"] == 100
        assert clip["in_frame"] == 5

    def test_a_split_names_the_clip_it_made(self, client: TestClient, auth: dict[str, str]) -> None:
        """The frontend cannot draw the second half if it is not told its id."""
        project_id = create(client, auth)
        (clip_id,) = seed(client, auth, project_id)
        response = command(
            client, auth, project_id, type="split-clip", clip_id=clip_id, at_frame=30
        )
        assert response.status_code == 200
        affected = response.json()["affected"]
        assert clip_id in affected
        made = [item for item in affected if item != clip_id]
        assert len(made) == 1
        assert clip_at(client, auth, project_id, made[0])["start_frame"] == 30

    def test_a_split_generates_the_id_the_client_did_not_send(
        self, client: TestClient, auth: dict[str, str], isolated_data_dir: Path
    ) -> None:
        project_id = create(client, auth)
        (clip_id,) = seed(client, auth, project_id)
        command(client, auth, project_id, type="split-clip", clip_id=clip_id, at_frame=30)
        directory = isolated_data_dir / "autosave" / project_id
        entries = [
            json.loads(line)
            for path in sorted(directory.iterdir())
            for line in path.read_text().splitlines()
            if line
        ]
        split = next(entry for entry in entries if entry["name"] == "split-clip")
        assert split["payload"]["new_clip_id"], (
            "the id must be recorded, or a replay invents another"
        )

    def test_a_lift_leaves_the_gap(self, client: TestClient, auth: dict[str, str]) -> None:
        project_id = create(client, auth)
        first, second = seed(
            client, auth, project_id, None, {**SEED_CLIP, "start_frame": 200, "name": "two"}
        )
        command(client, auth, project_id, type="lift-clip", clip_id=first)
        body = client.get(f"/api/v1/projects/{project_id}/timeline", headers=auth).json()
        remaining = [str(clip["clip_id"]) for clip in body["timeline"]["tracks"][0]["clips"]]
        assert remaining == [second]
        assert clip_at(client, auth, project_id, second)["start_frame"] == 200

    def test_a_ripple_delete_closes_only_the_gap_the_clip_left(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        """The 100 frames the deleted clip occupied, not the 100 the user left
        between them — a ripple that also closed the space between clips would
        destroy a pause the editor put there on purpose."""
        project_id = create(client, auth)
        first, second = seed(
            client, auth, project_id, None, {**SEED_CLIP, "start_frame": 200, "name": "two"}
        )
        command(client, auth, project_id, type="ripple-delete", clip_id=first)
        assert clip_at(client, auth, project_id, second)["start_frame"] == 100

    def test_the_answer_carries_what_the_frontend_must_redraw(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        project_id = create(client, auth)
        (clip_id,) = seed(client, auth, project_id)
        body = command(
            client, auth, project_id, type="move-clip", clip_id=clip_id, to_start_frame=40
        ).json()
        assert body["name"] == "move-clip"
        assert body["affected"] == [clip_id]
        assert "preview" in body["invalidate"]
        assert body["rerender"] is True
        assert body["history"]["can_undo"] is True
        assert body["history"]["undo_depth"] == 2  # the seed, then this
        assert body["pending_commands"] == 2

    def test_a_refused_command_changes_nothing(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        """A refused edit must not cost the user their redo future either."""
        project_id = create(client, auth)
        seed(client, auth, project_id)
        before = client.get(f"/api/v1/projects/{project_id}/timeline", headers=auth).json()
        response = command(
            client, auth, project_id, type="move-clip", clip_id="nope", to_start_frame=5
        )
        assert response.status_code == 409
        assert response.json()["code"] == "NS-COMMAND-4104"
        assert client.get(f"/api/v1/projects/{project_id}/timeline", headers=auth).json() == before

    def test_a_command_that_does_not_exist_is_a_validation_error(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        """Not a 500: the client sent a request that does not exist."""
        project_id = create(client, auth)
        response = command(client, auth, project_id, type="teleport-clip", clip_id="c1")
        assert response.status_code == 422

    def test_a_project_that_is_not_open_has_no_commands(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        response = command(client, auth, "nope", type="move-clip", clip_id="c1", to_start_frame=1)
        assert response.status_code == 404
        assert response.json()["code"] == NS_PROJECT_NOT_OPEN


class TestUndoAndRedo:
    def test_an_undo_puts_the_clip_back(self, client: TestClient, auth: dict[str, str]) -> None:
        project_id = create(client, auth)
        (clip_id,) = seed(client, auth, project_id)
        command(client, auth, project_id, type="move-clip", clip_id=clip_id, to_start_frame=40)
        response = client.post(f"/api/v1/projects/{project_id}/undo", headers=auth)
        assert response.status_code == 200
        assert response.json()["undone"] is True
        assert response.json()["name"] == "move-clip"
        assert clip_at(client, auth, project_id, clip_id)["start_frame"] == 0

    def test_a_redo_reapplies_it(self, client: TestClient, auth: dict[str, str]) -> None:
        project_id = create(client, auth)
        (clip_id,) = seed(client, auth, project_id)
        command(client, auth, project_id, type="move-clip", clip_id=clip_id, to_start_frame=40)
        client.post(f"/api/v1/projects/{project_id}/undo", headers=auth)
        response = client.post(f"/api/v1/projects/{project_id}/redo", headers=auth)
        assert response.status_code == 200
        assert response.json()["redone"] is True
        assert clip_at(client, auth, project_id, clip_id)["start_frame"] == 40

    def test_an_undo_on_a_fresh_timeline_is_not_a_mistake(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        project_id = create(client, auth)
        response = client.post(f"/api/v1/projects/{project_id}/undo", headers=auth)
        assert response.status_code == 200
        assert response.json()["undone"] is False
        assert response.json()["command_id"] == ""

    def test_a_new_edit_drops_what_could_have_been_redone(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        project_id = create(client, auth)
        (clip_id,) = seed(client, auth, project_id)
        command(client, auth, project_id, type="move-clip", clip_id=clip_id, to_start_frame=40)
        client.post(f"/api/v1/projects/{project_id}/undo", headers=auth)
        command(client, auth, project_id, type="move-clip", clip_id=clip_id, to_start_frame=80)
        history = client.get(f"/api/v1/projects/{project_id}/timeline", headers=auth).json()
        assert history["history"]["redo_depth"] == 0
        assert clip_at(client, auth, project_id, clip_id)["start_frame"] == 80

    def test_undo_and_redo_are_recorded_like_any_other_edit(
        self, client: TestClient, auth: dict[str, str], isolated_data_dir: Path
    ) -> None:
        """A replay that skipped them would hand back work the user threw away."""
        project_id = create(client, auth)
        (clip_id,) = seed(client, auth, project_id)
        command(client, auth, project_id, type="move-clip", clip_id=clip_id, to_start_frame=40)
        client.post(f"/api/v1/projects/{project_id}/undo", headers=auth)
        client.post(f"/api/v1/projects/{project_id}/redo", headers=auth)
        assert journal_names(isolated_data_dir, project_id) == [
            "replace-track-clips",
            "move-clip",
            "undo",
            "redo",
        ]

    def test_a_project_that_is_not_open_cannot_be_undone(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        response = client.post("/api/v1/projects/nope/undo", headers=auth)
        assert response.status_code == 404
        assert response.json()["code"] == NS_PROJECT_NOT_OPEN


class ToggleJournal:
    """A journal in memory that can be told to fail.

    A disk that fills up mid-edit is the one failure a test must be able to
    arrange and no filesystem will produce on demand, so the seam the workspace
    was given for it is what the test uses.
    """

    def __init__(self) -> None:
        self.entries: list[JournalEntry] = []
        self.broken = False

    def append(self, entry: JournalEntry) -> Result[None]:
        if self.broken:
            return err(NovaError("NS-STORAGE-4005", "the journal could not be written"))
        self.entries.append(entry)
        return ok(None)

    def read_since(self, sequence: int) -> Result[JournalWindow]:
        kept = tuple(entry for entry in self.entries if entry.sequence > sequence)
        return ok(JournalWindow(entries=kept))

    def truncate_through(self, sequence: int) -> Result[None]:
        self.entries = [entry for entry in self.entries if entry.sequence > sequence]
        return ok(None)

    def close(self) -> None:
        return None


class TestTheJournal:
    def test_an_entry_is_named_after_the_command_and_carries_its_arguments(
        self, client: TestClient, auth: dict[str, str], isolated_data_dir: Path
    ) -> None:
        project_id = create(client, auth)
        (clip_id,) = seed(client, auth, project_id)
        command(client, auth, project_id, type="move-clip", clip_id=clip_id, to_start_frame=40)
        directory = isolated_data_dir / "autosave" / project_id
        entries = [
            json.loads(line)
            for path in sorted(directory.iterdir())
            for line in path.read_text().splitlines()
            if line
        ]
        move = next(entry for entry in entries if entry["name"] == "move-clip")
        assert move["payload"] == {
            "clip_id": clip_id,
            "to_start_frame": 40,
            "to_track_id": "",
            "gesture": "",
        }

    def test_an_edit_that_cannot_be_recorded_is_not_kept(
        self, bus: EventBus, isolated_data_dir: Path
    ) -> None:
        """The one promise behind "a crash is a restart, not a loss": an edit we
        cannot replay is an edit we roll back and report, rather than an edit we
        quietly keep and lose later."""
        journals: list[ToggleJournal] = []

        def factory(*_args: Any, **_kwargs: Any) -> ToggleJournal:
            journal = ToggleJournal()
            journals.append(journal)
            return journal

        projects = ProjectWorkspace(bus, data_dir=isolated_data_dir, journal_factory=factory)
        opened = projects.create(name="Demo", path=isolated_data_dir / "demo.nova").unwrap()
        placed = projects.apply(
            opened.project_id, _replace_track_clips(), name="replace-track-clips", payload={}
        )
        assert placed.is_ok(), placed.unwrap_err()

        journals[0].broken = True
        result = projects.apply(
            opened.project_id, _move_clip("c1", 40), name="move-clip", payload={}
        )
        assert result.is_err()
        assert result.unwrap_err().code == NS_PROJECT_JOURNAL_FAILED

        after = projects.get(opened.project_id)
        assert after is not None
        assert after.journal_sequence == 1, "a failed entry must not move the sequence"
        timeline = after.project.timeline
        assert timeline.clip("c1") is not None, "the edit must have stood before it failed"
        assert timeline.clip("c1").start_frame == 0, (
            "the edit must not survive the failure of the guarantee"
        )


class TestEvents:
    def test_an_edit_is_announced(
        self, client: TestClient, auth: dict[str, str], bus: EventBus
    ) -> None:
        project_id = create(client, auth)
        (clip_id,) = seed(client, auth, project_id)
        command(client, auth, project_id, type="move-clip", clip_id=clip_id, to_start_frame=40)
        topics = [envelope.topic for envelope in bus.replay_from(0)]
        assert "command.executed" in topics
        assert "project.edited" in topics

    def test_an_undo_is_announced_as_a_reversion(
        self, client: TestClient, auth: dict[str, str], bus: EventBus
    ) -> None:
        project_id = create(client, auth)
        (clip_id,) = seed(client, auth, project_id)
        command(client, auth, project_id, type="move-clip", clip_id=clip_id, to_start_frame=40)
        client.post(f"/api/v1/projects/{project_id}/undo", headers=auth)
        topics = [envelope.topic for envelope in bus.replay_from(0)]
        assert "command.reverted" in topics


class TestTheWorkspaceItself:
    def test_the_editor_is_the_same_one_on_the_next_request(
        self, workspace: ProjectWorkspace, isolated_data_dir: Path
    ) -> None:
        """An undo stack rebuilt per request is not an undo stack."""
        opened = workspace.create(name="Demo", path=isolated_data_dir / "demo.nova").unwrap()
        first = workspace.timeline(opened.project_id).unwrap().editor
        second = workspace.timeline(opened.project_id).unwrap().editor
        assert first is second

    def test_a_project_that_is_not_open_has_no_editor(self, workspace: ProjectWorkspace) -> None:
        assert workspace.timeline("nope").unwrap_err().code == NS_PROJECT_NOT_OPEN
        assert workspace.undo("nope").unwrap_err().code == NS_PROJECT_NOT_OPEN
        assert workspace.redo("nope").unwrap_err().code == NS_PROJECT_NOT_OPEN

    def test_the_timeline_cannot_be_replaced_behind_the_editors_back(
        self, workspace: ProjectWorkspace, isolated_data_dir: Path
    ) -> None:
        """A second way to change the edit is a second thing to keep in step with
        the undo stack — so there is not one."""
        opened = workspace.create(name="Demo", path=isolated_data_dir / "demo.nova").unwrap()
        workspace.timeline(opened.project_id).unwrap()
        elsewhere = Timeline.of(Track(track_id="other"))
        result = workspace.store(
            opened.project_id, opened.project.with_timeline(elsewhere), name="edit"
        )
        assert result.is_err()
        assert result.unwrap_err().code == NS_TIMELINE_OUT_OF_SYNC

    def test_a_project_that_has_not_been_edited_has_no_editor_yet(
        self, workspace: ProjectWorkspace, isolated_data_dir: Path
    ) -> None:
        opened = workspace.create(name="Demo", path=isolated_data_dir / "demo.nova").unwrap()
        session = workspace.timeline(opened.project_id).unwrap()
        assert session.editor.can_undo is False
        assert session.editor.store.current() is opened.project.timeline


def _replace_track_clips() -> Any:
    from nova_studio.services.timeline import ReplaceTrackClipsCommand

    clip = Clip.of("c1", "a1", source_frames=100, kind=ClipKind.VIDEO)
    return ReplaceTrackClipsCommand(track_id="v1", clips=(clip,), kind=TrackKind.VIDEO)


def _move_clip(clip_id: str, to_start_frame: int) -> Any:
    from nova_studio.services.timeline import MoveClipCommand

    return MoveClipCommand(clip_id=clip_id, to_start_frame=to_start_frame)
