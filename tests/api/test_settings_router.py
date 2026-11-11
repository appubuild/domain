"""`api/routers/settings.py` and the settings half of `api/workspace.py`.

What is pinned here is not that a channel count can be changed —
`tests/services/test_projects_settings.py` pins that for the command. It is the
four rules that make settings an *edit* rather than a form:

* **A setting is changed by a command and by nothing else.** A client that could
  replace the project's settings wholesale would step around validation, undo,
  the journal and the preview cache in one request.
* **A change is journalled before it is acknowledged**, and one that cannot be
  journalled is rolled back and reported. A settings change is the edit a user is
  least likely to notice they have lost, because nothing on the timeline looks
  different afterwards.
* **The settings stack is not the timeline stack.** Changing the frame size and
  moving a clip are two intentions, and Ctrl+Z must be able to tell them apart.
* **A patch records the decision, not the result.** The journal holds "channels
  is now 6", so a replay re-applies that decision against whatever the settings
  are when it runs.

The HTTP tests run through the real application against the real journal in a
temporary data directory; the journalling-failure test injects a broken journal,
because a full disk is not something a test can arrange by writing files.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.api.workspace import (
    NS_PROJECT_JOURNAL_FAILED,
    NS_PROJECT_NOT_OPEN,
    ProjectWorkspace,
)
from nova_studio.core.errors import NovaError
from nova_studio.core.result import Result, err, ok
from nova_studio.domain.persistence import JournalEntry, JournalWindow
from nova_studio.domain.project import (
    DEFAULT_CHANNELS,
    DEFAULT_FRAME_HEIGHT,
    DEFAULT_FRAME_WIDTH,
    DEFAULT_SAMPLE_RATE,
)
from nova_studio.services.projects import SetSettingsCommand

if TYPE_CHECKING:
    from pathlib import Path

    from fastapi.testclient import TestClient

    from nova_studio.core.events import EventBus

pytestmark = pytest.mark.unit


@pytest.fixture
def workspace(bus: EventBus, isolated_data_dir: Path) -> ProjectWorkspace:
    """A workspace with nothing open, journalling into a temporary directory."""
    return ProjectWorkspace(bus, data_dir=isolated_data_dir)


def create(client: TestClient, auth: dict[str, str]) -> str:
    """A new project, open in the session."""
    response = client.post("/api/v1/projects", json={"name": "Demo"}, headers=auth)
    assert response.status_code == 201
    return str(response.json()["project"]["project_id"])


def patch(client: TestClient, auth: dict[str, str], project_id: str, **body: Any) -> Any:
    """Change one or more settings and return the response."""
    return client.patch(f"/api/v1/projects/{project_id}/settings", json=body, headers=auth)


def settings_of(client: TestClient, auth: dict[str, str], project_id: str) -> dict[str, Any]:
    """The settings, as the endpoint reports them."""
    response = client.get(f"/api/v1/projects/{project_id}/settings", headers=auth)
    assert response.status_code == 200, response.json()
    return dict(response.json())


def journal_entries(data_dir: Path, project_id: str) -> list[dict[str, Any]]:
    """One project's journal, in the order it was written."""
    directory = data_dir / "autosave" / project_id
    lines = [
        line
        for path in sorted(directory.iterdir())
        for line in path.read_text().splitlines()
        if line
    ]
    return [json.loads(line) for line in lines]


class TestReading:
    def test_a_new_project_renders_to_the_defaults(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        project_id = create(client, auth)
        body = settings_of(client, auth, project_id)

        assert body["settings"]["frame_size"] == {
            "width": DEFAULT_FRAME_WIDTH,
            "height": DEFAULT_FRAME_HEIGHT,
        }
        assert body["settings"]["sample_rate"] == DEFAULT_SAMPLE_RATE
        assert body["settings"]["channels"] == DEFAULT_CHANNELS
        assert body["settings"]["use_proxies"] is True
        assert body["settings"]["working_colour_space"] == 1  # BT.709

    def test_the_answer_carries_what_a_user_needs_before_changing_the_frame(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        """An odd dimension is a 4:2:0 export that fails later."""
        project_id = create(client, auth)
        patch(client, auth, project_id, frame_size={"width": 1080, "height": 1919})

        body = settings_of(client, auth, project_id)
        assert body["settings"]["even_dimensions"] is False
        assert body["settings"]["aspect_ratio"] == pytest.approx(1080 / 1919)

    def test_a_vertical_frame_says_so_by_its_ratio(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        project_id = create(client, auth)
        patch(client, auth, project_id, frame_size={"width": 1080, "height": 1920})

        body = settings_of(client, auth, project_id)
        assert body["settings"]["aspect_ratio"] == pytest.approx(0.5625)
        assert body["settings"]["even_dimensions"] is True

    def test_the_history_travels_with_the_answer(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        project_id = create(client, auth)
        patch(client, auth, project_id, channels=6)

        body = settings_of(client, auth, project_id)
        assert body["history"]["can_undo"] is True
        assert body["history"]["can_redo"] is False
        assert body["history"]["undo_depth"] == 1

    def test_a_project_that_is_not_open_has_no_settings(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        response = client.get("/api/v1/projects/nope/settings", headers=auth)

        assert response.status_code == 404
        assert response.json()["code"] == NS_PROJECT_NOT_OPEN

    def test_the_settings_are_the_projects_not_the_previews(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        """1080p in the project stays 1080p in the project, however small the
        preview pane is drawn — which is the only way a layer 100 px from the
        centre lands in the same place in both."""
        project_id = create(client, auth)
        patch(client, auth, project_id, frame_size={"width": 3840, "height": 2160})

        assert settings_of(client, auth, project_id)["settings"]["frame_size"] == {
            "width": 3840,
            "height": 2160,
        }


class TestChanging:
    def test_one_setting_changes(self, client: TestClient, auth: dict[str, str]) -> None:
        project_id = create(client, auth)
        response = patch(client, auth, project_id, channels=6)

        assert response.status_code == 200, response.json()
        assert response.json()["settings"]["channels"] == 6
        assert settings_of(client, auth, project_id)["settings"]["channels"] == 6

    def test_a_patch_leaves_what_it_did_not_name(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        """Two panels can hold two settings open at once; neither knows the
        other's values, and neither's answer is a whole replacement."""
        project_id = create(client, auth)
        patch(client, auth, project_id, channels=6)
        patch(client, auth, project_id, sample_rate=44_100)

        body = settings_of(client, auth, project_id)
        assert body["settings"]["channels"] == 6
        assert body["settings"]["sample_rate"] == 44_100

    def test_an_empty_body_names_nothing_and_is_refused(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        project_id = create(client, auth)
        response = patch(client, auth, project_id)

        assert response.status_code == 409
        assert "at least one setting" in response.json()["detail"]

    def test_a_value_the_domain_refuses_is_a_conflict_not_a_crash(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        project_id = create(client, auth)
        response = patch(client, auth, project_id, channels=3)

        assert response.status_code == 409
        assert response.json()["code"] == "NS-COMMAND-4104"
        assert settings_of(client, auth, project_id)["settings"]["channels"] == DEFAULT_CHANNELS

    def test_a_value_the_wire_refuses_never_reaches_the_command(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        """A 422 rather than a 409: the request is not one this contract names.

        The distinction matters to the frontend, because a 422 is a bug it must
        fix and a 409 is a sentence it must print.
        """
        project_id = create(client, auth)
        response = patch(client, auth, project_id, sample_rate=0)

        assert response.status_code == 422

    def test_a_field_we_do_not_know_is_rejected(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        """A client sending a field we do not know is either newer than we are
        or broken, and silently dropping it is how two versions of an editor
        disagree about what was saved."""
        project_id = create(client, auth)
        response = patch(client, auth, project_id, frame_rate=25)

        assert response.status_code == 422

    def test_the_answer_says_what_must_be_redrawn(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        project_id = create(client, auth)
        body = patch(client, auth, project_id, frame_size={"width": 3840, "height": 2160}).json()

        assert body["rerender"] is True
        assert body["marks_dirty"] is True
        assert "preview" in body["invalidate"]
        assert "settings" in body["invalidate"]

    def test_asking_for_what_is_already_there_dirties_nothing(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        project_id = create(client, auth)
        body = patch(client, auth, project_id, sample_rate=DEFAULT_SAMPLE_RATE).json()

        assert body["marks_dirty"] is False
        assert body["rerender"] is False
        assert body["settings"]["sample_rate"] == DEFAULT_SAMPLE_RATE

    def test_a_change_makes_the_project_unsaved(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        project_id = create(client, auth)
        patch(client, auth, project_id, channels=6)

        assert settings_of(client, auth, project_id)["dirty"] is True

    def test_a_project_that_is_not_open_cannot_be_changed(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        response = patch(client, auth, "nope", channels=6)

        assert response.status_code == 404
        assert response.json()["code"] == NS_PROJECT_NOT_OPEN

    def test_the_settings_survive_a_save_and_an_open(
        self, client: TestClient, auth: dict[str, str], isolated_data_dir: Path
    ) -> None:
        project_id = create(client, auth)
        patch(client, auth, project_id, channels=6, use_proxies=False)
        path = isolated_data_dir / "demo.nova"

        saved = client.post(
            f"/api/v1/projects/{project_id}/save-as", json={"path": str(path)}, headers=auth
        )
        assert saved.status_code == 200, saved.json()
        client.delete(f"/api/v1/projects/{project_id}", headers=auth)

        reopened = client.post("/api/v1/projects/open", json={"path": str(path)}, headers=auth)
        assert reopened.status_code == 200, reopened.json()
        reopened_id = str(reopened.json()["project"]["project_id"])

        body = settings_of(client, auth, reopened_id)
        assert body["settings"]["channels"] == 6
        assert body["settings"]["use_proxies"] is False


class TestUndoAndRedo:
    def test_an_undo_puts_the_setting_back(self, client: TestClient, auth: dict[str, str]) -> None:
        project_id = create(client, auth)
        patch(client, auth, project_id, channels=6)

        response = client.post(f"/api/v1/projects/{project_id}/settings/undo", headers=auth)
        assert response.status_code == 200, response.json()
        assert response.json()["undone"] is True
        assert response.json()["settings"]["channels"] == DEFAULT_CHANNELS

    def test_a_redo_reapplies_it(self, client: TestClient, auth: dict[str, str]) -> None:
        project_id = create(client, auth)
        patch(client, auth, project_id, channels=6)
        client.post(f"/api/v1/projects/{project_id}/settings/undo", headers=auth)

        response = client.post(f"/api/v1/projects/{project_id}/settings/redo", headers=auth)
        assert response.status_code == 200, response.json()
        assert response.json()["redone"] is True
        assert response.json()["settings"]["channels"] == 6

    def test_an_undo_on_untouched_settings_is_not_a_mistake(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        project_id = create(client, auth)
        response = client.post(f"/api/v1/projects/{project_id}/settings/undo", headers=auth)

        assert response.status_code == 200
        assert response.json()["undone"] is False

    def test_the_settings_stack_is_not_the_timeline_stack(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        """The promise of a second scope: undoing a settings change must not
        quietly undo the cut the user made ten minutes ago."""
        project_id = create(client, auth)
        seeded = client.post(
            f"/api/v1/projects/{project_id}/commands",
            json={
                "type": "replace-track-clips",
                "track_id": "v1",
                "kind": "video",
                "clips": [{"asset_id": "a1", "kind": "video", "source_frames": 100}],
            },
            headers=auth,
        )
        assert seeded.status_code == 200, seeded.json()
        (clip_id,) = [
            str(clip["clip_id"])
            for clip in client.get(f"/api/v1/projects/{project_id}/timeline", headers=auth).json()[
                "timeline"
            ]["tracks"][0]["clips"]
        ]
        client.post(
            f"/api/v1/projects/{project_id}/commands",
            json={"type": "move-clip", "clip_id": clip_id, "to_start_frame": 40},
            headers=auth,
        )
        patch(client, auth, project_id, channels=6)

        # The settings undo is the settings undo, and nothing else.
        client.post(f"/api/v1/projects/{project_id}/settings/undo", headers=auth)
        assert settings_of(client, auth, project_id)["settings"]["channels"] == DEFAULT_CHANNELS

        timeline = client.get(f"/api/v1/projects/{project_id}/timeline", headers=auth).json()
        clip = timeline["timeline"]["tracks"][0]["clips"][0]
        assert clip["start_frame"] == 40, "the cut must not have travelled with it"

        # And the timeline's Ctrl+Z is still the cut.
        client.post(f"/api/v1/projects/{project_id}/undo", headers=auth)
        timeline = client.get(f"/api/v1/projects/{project_id}/timeline", headers=auth).json()
        assert timeline["timeline"]["tracks"][0]["clips"][0]["start_frame"] == 0

    def test_a_new_change_drops_what_could_have_been_redone(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        project_id = create(client, auth)
        patch(client, auth, project_id, channels=6)
        client.post(f"/api/v1/projects/{project_id}/settings/undo", headers=auth)
        patch(client, auth, project_id, sample_rate=44_100)

        response = client.post(f"/api/v1/projects/{project_id}/settings/redo", headers=auth)
        assert response.json()["redone"] is False

    def test_undo_and_redo_are_recorded_like_any_other_edit(
        self, client: TestClient, auth: dict[str, str], isolated_data_dir: Path
    ) -> None:
        """A replay that skipped them would hand the user back the render target
        they deliberately threw away."""
        project_id = create(client, auth)
        patch(client, auth, project_id, channels=6)
        client.post(f"/api/v1/projects/{project_id}/settings/undo", headers=auth)
        client.post(f"/api/v1/projects/{project_id}/settings/redo", headers=auth)

        names = [entry["name"] for entry in journal_entries(isolated_data_dir, project_id)]
        assert names == ["set-settings", "undo", "redo"]

    def test_a_project_that_is_not_open_cannot_be_undone(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        response = client.post("/api/v1/projects/nope/settings/undo", headers=auth)

        assert response.status_code == 404
        assert response.json()["code"] == NS_PROJECT_NOT_OPEN


class TestTheJournal:
    def test_an_entry_records_the_decision_not_the_settings(
        self, client: TestClient, auth: dict[str, str], isolated_data_dir: Path
    ) -> None:
        """The payload is the patch, so a replay re-applies a decision against
        whatever the settings are when it runs, rather than restoring a
        snapshot that is already out of date."""
        project_id = create(client, auth)
        patch(client, auth, project_id, channels=6)

        entries = journal_entries(isolated_data_dir, project_id)
        assert [entry["name"] for entry in entries] == ["set-settings"]
        assert entries[0]["payload"] == {"channels": 6}

    def test_a_two_field_patch_records_both(
        self, client: TestClient, auth: dict[str, str], isolated_data_dir: Path
    ) -> None:
        project_id = create(client, auth)
        patch(client, auth, project_id, channels=6, use_proxies=False)

        entries = journal_entries(isolated_data_dir, project_id)
        assert entries[0]["payload"] == {"channels": 6, "use_proxies": False}

    def test_a_frame_size_is_recorded_in_parts_a_human_can_read(
        self, client: TestClient, auth: dict[str, str], isolated_data_dir: Path
    ) -> None:
        project_id = create(client, auth)
        patch(client, auth, project_id, frame_size={"width": 3840, "height": 2160})

        entries = journal_entries(isolated_data_dir, project_id)
        assert entries[0]["payload"] == {"frame_size": {"width": 3840, "height": 2160}}

    def test_the_entry_names_the_command_the_frontend_sent(
        self, client: TestClient, auth: dict[str, str], isolated_data_dir: Path
    ) -> None:
        """One vocabulary: the wire name is the journal name, so there is no
        second table of names to drift."""
        project_id = create(client, auth)
        patch(client, auth, project_id, channels=6)

        entries = journal_entries(isolated_data_dir, project_id)
        assert entries[0]["name"] == "set-settings"
        assert entries[0]["name"] == SetSettingsCommand(channels=6).command_id.removeprefix(
            "project."
        )


class ToggleJournal:
    """A journal that can be made to fail, because a full disk cannot be arranged.

    It keeps its entries in a list so a test can read them back without a
    filesystem, and it is handed to the workspace by a `journal_factory` — the
    seam that exists in the constructor for exactly this reason.
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


class TestDurability:
    def test_a_change_that_cannot_be_recorded_is_not_kept(
        self, bus: EventBus, isolated_data_dir: Path
    ) -> None:
        """The one promise behind \"a crash is a restart, not a loss\": a change
        we cannot replay is a change we roll back and report, rather than a
        change we quietly keep and lose later."""
        journals: list[ToggleJournal] = []

        def factory(*_args: Any, **_kwargs: Any) -> ToggleJournal:
            journal = ToggleJournal()
            journals.append(journal)
            return journal

        projects = ProjectWorkspace(bus, data_dir=isolated_data_dir, journal_factory=factory)
        opened = projects.create(name="Demo", path=isolated_data_dir / "demo.nova").unwrap()
        kept = projects.apply_settings(
            opened.project_id, SetSettingsCommand(channels=6), name="set-settings", payload={}
        )
        assert kept.is_ok(), kept.unwrap_err()

        journals[0].broken = True
        result = projects.apply_settings(
            opened.project_id,
            SetSettingsCommand(sample_rate=44_100),
            name="set-settings",
            payload={},
        )
        assert result.is_err()
        assert result.unwrap_err().code == NS_PROJECT_JOURNAL_FAILED

        after = projects.get(opened.project_id)
        assert after is not None
        assert after.journal_sequence == 1, "a failed entry must not move the sequence"
        assert after.project.settings.channels == 6, "the change that stood must stand"
        assert after.project.settings.sample_rate == DEFAULT_SAMPLE_RATE, (
            "the change must not survive the failure of the guarantee"
        )

    def test_a_rolled_back_change_is_not_undoable(
        self, bus: EventBus, isolated_data_dir: Path
    ) -> None:
        journals: list[ToggleJournal] = []

        def factory(*_args: Any, **_kwargs: Any) -> ToggleJournal:
            journal = ToggleJournal()
            journals.append(journal)
            return journal

        projects = ProjectWorkspace(bus, data_dir=isolated_data_dir, journal_factory=factory)
        opened = projects.create(name="Demo", path=isolated_data_dir / "demo.nova").unwrap()

        journals[0].broken = True
        projects.apply_settings(
            opened.project_id, SetSettingsCommand(channels=6), name="set-settings", payload={}
        )

        assert projects.undo_settings(opened.project_id).unwrap().command is None


class TestEvents:
    def test_a_change_is_announced(
        self, client: TestClient, auth: dict[str, str], bus: EventBus
    ) -> None:
        project_id = create(client, auth)
        patch(client, auth, project_id, channels=6)

        topics = [envelope.topic for envelope in bus.replay_from(0)]
        assert "command.executed" in topics
        assert "project.edited" in topics

    def test_an_undo_is_announced_too(
        self, client: TestClient, auth: dict[str, str], bus: EventBus
    ) -> None:
        project_id = create(client, auth)
        patch(client, auth, project_id, channels=6)
        client.post(f"/api/v1/projects/{project_id}/settings/undo", headers=auth)

        topics = [envelope.topic for envelope in bus.replay_from(0)]
        assert topics.count("project.edited") == 2, "the undo is an edit, and says so"


class TestTheEditor:
    def test_the_editor_is_the_same_one_on_the_next_request(
        self, client: TestClient, auth: dict[str, str]
    ) -> None:
        """The undo stack belongs to the session, not to the request."""
        project_id = create(client, auth)
        patch(client, auth, project_id, channels=6)

        assert settings_of(client, auth, project_id)["history"]["undo_depth"] == 1

    def test_a_project_that_is_not_open_has_no_settings_editor(
        self, workspace: ProjectWorkspace
    ) -> None:
        assert workspace.settings("nope").is_err() is True

    def test_undoing_settings_does_not_undo_the_timeline(
        self, workspace: ProjectWorkspace, isolated_data_dir: Path
    ) -> None:
        """The other half of the two-stack promise: the timeline's Ctrl+Z is the
        timeline's, even after the settings have been changed twice."""
        opened = workspace.create(name="Demo", path=isolated_data_dir / "demo.nova").unwrap()
        workspace.apply_settings(
            opened.project_id, SetSettingsCommand(channels=6), name="set-settings", payload={}
        )
        workspace.apply_settings(
            opened.project_id, SetSettingsCommand(channels=8), name="set-settings", payload={}
        )

        undone = workspace.undo_settings(opened.project_id).unwrap()
        assert undone.command is not None
        assert workspace.get(opened.project_id).project.settings.channels == 6
        assert workspace.timeline(opened.project_id).unwrap().editor.can_undo is False
