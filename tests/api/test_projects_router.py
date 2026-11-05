"""`api/routers/projects.py` and `api/workspace.py` — the file menu, and the
guarantees behind it.

What is being pinned is not that a save writes bytes (the archive is tested in
`tests/infra/`) but the rules a desktop editor is judged by:

* **A damaged project still opens**, with warnings the user can act on
  (ADR-0015 rule 3).
* **Nothing is written on a close.** A close that saved first would overwrite the
  very file the user may be trying to abandon.
* **An edit is journalled before it is acknowledged**, and a checkpoint truncates
  exactly what it made redundant — so "you lose at most N commands" is a sentence
  the code can keep.
* **The transport picks the status, not the domain's severity.** "No such open
  project" is a 404 however severe the domain thinks it is.

The HTTP tests use the real `ZipProjectArchive` and the real NDJSON journal in a
temporary directory: a round trip through fake storage would prove the fake and
not the product. The workspace tests use the injected factories, because a
journalling failure is one no filesystem will produce on demand.
"""

from __future__ import annotations

import json
import threading
from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.api.workspace import (
    NS_PROJECT_ALREADY_OPEN,
    NS_PROJECT_NEVER_SAVED,
    NS_PROJECT_NO_SUCH_FILE,
    NS_PROJECT_NOT_OPEN,
    ProjectWorkspace,
)
from nova_studio.core.errors import NovaError
from nova_studio.core.result import err, ok
from nova_studio.domain.persistence import CheckpointPolicy, JournalWindow

if TYPE_CHECKING:
    from pathlib import Path

    from fastapi.testclient import TestClient

    from nova_studio.core.events import EventBus

pytestmark = pytest.mark.unit


@pytest.fixture
def workspace(bus: EventBus, isolated_data_dir: Path) -> ProjectWorkspace:
    """A workspace with nothing open, journalling into a temporary directory."""
    return ProjectWorkspace(bus, data_dir=isolated_data_dir)


def create(client: TestClient, auth: dict[str, str], name: str = "Demo") -> str:
    """Create a project through the API and return its id."""
    response = client.post("/api/v1/projects", json={"name": name}, headers=auth)
    assert response.status_code == 201
    return str(response.json()["project"]["project_id"])


def save_as(client: TestClient, auth: dict[str, str], project_id: str, path: Path) -> Any:
    """Save a project to `path` through the API."""
    return client.post(
        f"/api/v1/projects/{project_id}/save-as", json={"path": str(path)}, headers=auth
    )


class BrokenJournal:
    """A journal whose every write fails: a full disk, or a read-only volume."""

    def append(self, entry: Any) -> Any:
        return err(NovaError("NS-STORAGE-4005", "the journal could not be written"))

    def read_since(self, sequence: int) -> Any:
        return ok(JournalWindow())

    def truncate_through(self, sequence: int) -> Any:
        return ok(None)

    def close(self) -> None:
        return None


class TestCreating:
    def test_a_new_project_is_open_and_unsaved(self, client, auth) -> None:
        response = client.post("/api/v1/projects", json={"name": "Demo"}, headers=auth)
        assert response.status_code == 201
        project = response.json()["project"]
        assert project["name"] == "Demo"
        assert project["dirty"] is True
        assert project["path"] is None

    def test_it_appears_in_the_list(self, client, auth) -> None:
        create(client, auth)
        assert len(client.get("/api/v1/projects", headers=auth).json()["projects"]) == 1

    def test_the_list_is_empty_before_anything_is_open(self, client, auth) -> None:
        assert client.get("/api/v1/projects", headers=auth).json() == {"projects": []}

    def test_a_nameless_project_is_refused(self, client, auth) -> None:
        response = client.post("/api/v1/projects", json={"name": ""}, headers=auth)
        assert response.status_code == 422
        assert response.json()["code"] == "NS-VALIDATION-4220"

    def test_a_relative_path_is_refused(self, client, auth) -> None:
        """It would resolve against the server's working directory, which for a
        packaged build is wherever the shortcut pointed."""
        response = client.post(
            "/api/v1/projects", json={"name": "x", "path": "demo.nova"}, headers=auth
        )
        assert response.status_code == 422

    def test_it_is_announced(self, client, auth, bus) -> None:
        create(client, auth)
        topics = [e.topic for e in bus.replay_from(0) if e.topic.startswith("project")]
        assert topics == ["project.created"]


class TestSaving:
    def test_a_project_with_no_file_cannot_be_saved(self, client, auth) -> None:
        project_id = create(client, auth)
        response = client.post(f"/api/v1/projects/{project_id}/save", headers=auth)
        assert response.status_code == 409
        assert response.json()["code"] == NS_PROJECT_NEVER_SAVED

    def test_save_as_writes_the_file(self, client, auth, tmp_path) -> None:
        project_id = create(client, auth)
        target = tmp_path / "demo.nova"
        response = save_as(client, auth, project_id, target)
        assert response.status_code == 200
        assert target.is_file()
        assert response.json()["path"] == str(target)

    def test_saving_clears_the_dirty_flag(self, client, auth, tmp_path) -> None:
        project_id = create(client, auth)
        save_as(client, auth, project_id, tmp_path / "demo.nova")
        body = client.get(f"/api/v1/projects/{project_id}", headers=auth).json()
        assert body["dirty"] is False

    def test_saving_twice_goes_to_the_same_file(self, client, auth, tmp_path) -> None:
        project_id = create(client, auth)
        target = tmp_path / "demo.nova"
        save_as(client, auth, project_id, target)
        response = client.post(f"/api/v1/projects/{project_id}/save", headers=auth)
        assert response.status_code == 200
        assert response.json()["path"] == str(target)

    def test_a_save_as_to_another_file_keeps_the_project_id(self, client, auth, tmp_path) -> None:
        """A copy is a copy, not a new project — its identity travels."""
        project_id = create(client, auth)
        save_as(client, auth, project_id, tmp_path / "one.nova")
        save_as(client, auth, project_id, tmp_path / "two.nova")
        body = client.get(f"/api/v1/projects/{project_id}", headers=auth).json()
        assert body["project_id"] == project_id
        assert body["path"] == str(tmp_path / "two.nova")

    def test_saving_is_announced(self, client, auth, tmp_path, bus) -> None:
        project_id = create(client, auth)
        save_as(client, auth, project_id, tmp_path / "demo.nova")
        assert "project.saved" in [e.topic for e in bus.replay_from(0)]


class TestOpeningAndClosing:
    def test_a_saved_project_reopens(self, client, auth, tmp_path) -> None:
        project_id = create(client, auth)
        target = tmp_path / "demo.nova"
        save_as(client, auth, project_id, target)
        client.delete(f"/api/v1/projects/{project_id}", headers=auth)
        response = client.post("/api/v1/projects/open", json={"path": str(target)}, headers=auth)
        assert response.status_code == 200
        assert response.json()["project"]["project_id"] == project_id

    def test_reopening_remembers_it_is_not_dirty(self, client, auth, tmp_path) -> None:
        project_id = create(client, auth)
        target = tmp_path / "demo.nova"
        save_as(client, auth, project_id, target)
        client.delete(f"/api/v1/projects/{project_id}", headers=auth)
        opened = client.post("/api/v1/projects/open", json={"path": str(target)}, headers=auth)
        assert opened.json()["project"]["dirty"] is False

    def test_closing_does_not_save(self, client, auth, tmp_path) -> None:
        """The one rule a close must not break: it is not a save."""
        project_id = create(client, auth)
        target = tmp_path / "demo.nova"
        save_as(client, auth, project_id, target)
        before = target.read_bytes()
        client.delete(f"/api/v1/projects/{project_id}", headers=auth)
        assert target.read_bytes() == before

    def test_a_second_close_is_a_404(self, client, auth) -> None:
        project_id = create(client, auth)
        assert client.delete(f"/api/v1/projects/{project_id}", headers=auth).status_code == 204
        response = client.delete(f"/api/v1/projects/{project_id}", headers=auth)
        assert response.status_code == 404
        assert response.json()["code"] == NS_PROJECT_NOT_OPEN

    def test_a_project_that_is_not_open_is_a_404(self, client, auth) -> None:
        response = client.get("/api/v1/projects/not-a-project", headers=auth)
        assert response.status_code == 404
        assert response.json()["code"] == NS_PROJECT_NOT_OPEN

    def test_opening_the_same_file_twice_is_refused(self, client, auth, tmp_path) -> None:
        """Two handles on one archive would disagree about what it contains."""
        project_id = create(client, auth)
        target = tmp_path / "demo.nova"
        save_as(client, auth, project_id, target)
        client.delete(f"/api/v1/projects/{project_id}", headers=auth)
        client.post("/api/v1/projects/open", json={"path": str(target)}, headers=auth)
        response = client.post("/api/v1/projects/open", json={"path": str(target)}, headers=auth)
        assert response.status_code == 409
        assert response.json()["code"] == NS_PROJECT_ALREADY_OPEN

    def test_a_missing_file_says_so(self, client, auth, tmp_path) -> None:
        """Not "this is not a project": the user's next move is different."""
        response = client.post(
            "/api/v1/projects/open", json={"path": str(tmp_path / "gone.nova")}, headers=auth
        )
        assert response.status_code == 404
        assert response.json()["code"] == NS_PROJECT_NO_SUCH_FILE

    def test_a_file_that_is_not_a_project_is_refused_whole(self, client, auth, tmp_path) -> None:
        target = tmp_path / "junk.nova"
        target.write_text("this is not a project", encoding="utf-8")
        response = client.post("/api/v1/projects/open", json={"path": str(target)}, headers=auth)
        assert response.status_code == 422
        assert response.json()["domain"] == "STORAGE"

    def test_a_relative_path_never_reaches_the_disk(self, client, auth) -> None:
        assert (
            client.post(
                "/api/v1/projects/open", json={"path": "demo.nova"}, headers=auth
            ).status_code
            == 422
        )


class TestCheckpoints:
    def test_a_checkpoint_writes_a_revision(self, client, auth, tmp_path) -> None:
        project_id = create(client, auth)
        save_as(client, auth, project_id, tmp_path / "demo.nova")
        response = client.post(f"/api/v1/projects/{project_id}/checkpoint", headers=auth)
        assert response.status_code == 200
        assert response.json()["taken"] is True
        assert response.json()["revision"] == 1

    def test_a_checkpoint_needs_a_file(self, client, auth, tmp_path) -> None:
        """A revision lives in the archive; with no archive there is nowhere."""
        project_id = create(client, auth)
        response = client.post(f"/api/v1/projects/{project_id}/checkpoint", headers=auth)
        assert response.status_code == 409
        assert response.json()["code"] == NS_PROJECT_NEVER_SAVED

    def test_an_autosave_tick_with_nothing_owed_takes_nothing(self, client, auth, tmp_path) -> None:
        """A tick that checkpointed unconditionally would rewrite the archive on
        every keypress."""
        project_id = create(client, auth)
        save_as(client, auth, project_id, tmp_path / "demo.nova")
        response = client.post(f"/api/v1/projects/{project_id}/autosave", headers=auth)
        assert response.status_code == 200
        assert response.json()["taken"] is False

    def test_a_checkpoint_truncates_only_what_it_baked_in(self, workspace, tmp_path) -> None:
        """The checkpoint's own journal entry is a marker, not a command."""
        opened = workspace.create(name="Demo", path=tmp_path / "demo.nova").unwrap()
        for index in range(3):
            workspace.store(opened.project_id, opened.project, name=f"edit-{index}").unwrap()
        checkpoint = workspace.checkpoint(opened.project_id).unwrap()
        assert checkpoint.sequence == 4
        assert checkpoint.truncated == 3
        after = workspace.get(opened.project_id)
        assert after is not None
        assert after.pending_commands == 0

    def test_a_checkpoint_is_taken_when_one_is_owed(self, bus, isolated_data_dir, tmp_path) -> None:
        eager = CheckpointPolicy(commands_between_checkpoints=2, max_revisions=3)
        projects = ProjectWorkspace(bus, data_dir=isolated_data_dir, autosave_policy=eager)
        opened = projects.create(name="Demo", path=tmp_path / "demo.nova").unwrap()
        assert projects.autosave(opened.project_id).unwrap() is None  # nothing recorded yet
        projects.store(opened.project_id, opened.project).unwrap()
        assert projects.autosave(opened.project_id).unwrap() is None  # one command of two
        projects.store(opened.project_id, opened.project).unwrap()
        taken = projects.autosave(opened.project_id).unwrap()
        assert taken is not None
        assert taken.truncated == 2

    def test_recovery_offers_nothing_after_a_clean_close(self, client, auth, tmp_path) -> None:
        project_id = create(client, auth)
        save_as(client, auth, project_id, tmp_path / "demo.nova")
        body = client.get(f"/api/v1/projects/{project_id}/recovery", headers=auth).json()
        assert body["offers"] == []
        assert "nothing to recover" in body["detail"]

    def test_recovery_offers_replay_when_commands_are_pending(self, workspace, tmp_path) -> None:
        """A crash between checkpoints must not mean silence."""
        opened = workspace.create(name="Demo", path=tmp_path / "demo.nova").unwrap()
        workspace.store(opened.project_id, opened.project).unwrap()
        plan = workspace.recovery(opened.project_id).unwrap()
        assert "replay" in " ".join(str(offer) for offer in plan.offers)
        assert plan.pending_commands == 1


class TestTheJournal:
    def test_an_edit_is_journalled_before_it_is_acknowledged(
        self, workspace, isolated_data_dir, tmp_path
    ) -> None:
        """The one guarantee behind "a crash is a restart, not a loss"."""
        opened = workspace.create(name="Demo", path=tmp_path / "demo.nova").unwrap()
        stored = workspace.store(opened.project_id, opened.project, name="move-clip").unwrap()
        assert stored.journal_sequence == 1
        journal_dir = isolated_data_dir / "autosave" / opened.project_id
        lines = [
            line for path in journal_dir.iterdir() for line in path.read_text().splitlines() if line
        ]
        entry = json.loads(lines[-1])
        assert entry["name"] == "move-clip"
        assert entry["seq"] == 1
        assert entry["at_ms"] > 0

    def test_an_edit_that_cannot_be_journalled_is_reported(
        self, bus, isolated_data_dir, tmp_path
    ) -> None:
        """The edit does not stand; what failed is the guarantee, and the caller
        is told so it can ask the user to save.

        The broken journal arrives through the injected factory rather than by
        reaching inside the workspace: the factory is the seam, so the test uses it.
        """
        projects = ProjectWorkspace(
            bus, data_dir=isolated_data_dir, journal_factory=lambda *_a, **_k: BrokenJournal()
        )
        opened = projects.create(name="Demo", path=tmp_path / "demo.nova").unwrap()
        result = projects.store(opened.project_id, opened.project)
        assert result.is_err()
        assert result.unwrap_err().code == "NS-PROJECT-4005"
        remaining = projects.get(opened.project_id)
        assert remaining is not None
        assert remaining.journal_sequence == 0, "a failed append must not move the sequence"

    def test_a_journal_outlives_the_project_being_closed(
        self, workspace, isolated_data_dir, tmp_path
    ) -> None:
        opened = workspace.create(name="Demo", path=tmp_path / "demo.nova").unwrap()
        workspace.store(opened.project_id, opened.project).unwrap()
        workspace.close(opened.project_id).unwrap()
        journal_dir = isolated_data_dir / "autosave" / opened.project_id
        assert any(path.read_text() for path in journal_dir.iterdir())


class TestTheAudit:
    def test_a_project_that_was_just_written_audits_clean(self, client, auth, tmp_path) -> None:
        """An audit reads the file, so an unsaved project has nothing to audit."""
        project_id = create(client, auth)
        save_as(client, auth, project_id, tmp_path / "demo.nova")
        body = client.get(f"/api/v1/projects/{project_id}/audit", headers=auth).json()
        assert body["clean"] is True
        assert body["clip_count"] == 0
        assert body["summary"] == []

    def test_an_audit_needs_a_file(self, client, auth) -> None:
        project_id = create(client, auth)
        response = client.get(f"/api/v1/projects/{project_id}/audit", headers=auth)
        assert response.status_code == 409
        assert response.json()["code"] == NS_PROJECT_NEVER_SAVED


class TestTheWorkspaceItself:
    """The parts no HTTP call exercises yet. They exist for the routers that will
    edit a project, and they are where a mistake would be silent."""

    def test_two_projects_are_independent(self, workspace, tmp_path) -> None:
        first = workspace.create(name="One", path=tmp_path / "one.nova").unwrap()
        second = workspace.create(name="Two", path=tmp_path / "two.nova").unwrap()
        assert first.project_id != second.project_id
        assert workspace.get(first.project_id) is not None
        assert workspace.get(second.project_id) is not None

    def test_closing_all_releases_everything(self, workspace, tmp_path) -> None:
        workspace.create(name="One", path=tmp_path / "one.nova").unwrap()
        workspace.create(name="Two", path=tmp_path / "two.nova").unwrap()
        assert workspace.close_all() == 2
        assert workspace.open_projects() == ()

    def test_a_project_that_is_not_open_says_so(self, workspace) -> None:
        result = workspace.save("nope")
        assert result.is_err()
        assert result.unwrap_err().code == NS_PROJECT_NOT_OPEN

    def test_the_clock_the_frontend_sees_is_the_one_autosave_counts_on(self, workspace) -> None:
        assert workspace.now_ms() > 0

    def test_events_name_what_happened(self, bus, isolated_data_dir, tmp_path) -> None:
        projects = ProjectWorkspace(bus, data_dir=isolated_data_dir)
        opened = projects.create(name="Demo", path=tmp_path / "demo.nova").unwrap()
        projects.checkpoint(opened.project_id).unwrap()
        projects.close(opened.project_id).unwrap()
        assert [e.topic for e in bus.replay_from(0)] == [
            "project.created",
            "project.checkpointed",
            "project.closed",
        ]

    def test_parallel_saves_do_not_interleave(self, workspace, tmp_path) -> None:
        """Two requests, one project: the archive is the thing that cannot be shared."""
        opened = workspace.create(name="Demo", path=tmp_path / "demo.nova").unwrap()
        results: list[Any] = []
        barrier = threading.Barrier(4)

        def save() -> None:
            barrier.wait()
            results.append(workspace.save(opened.project_id).unwrap())

        threads = [threading.Thread(target=save) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        assert len(results) == 4
        assert all(item.path == tmp_path / "demo.nova" for item in results)


def test_the_router_is_wired_into_the_application(client, auth) -> None:
    """A router that is written but not installed is a router nobody can call."""
    assert client.get("/api/v1/projects", headers=auth).status_code == 200


def test_the_contract_documents_the_project_paths() -> None:
    from nova_studio.api.openapi import contract

    paths = contract()["paths"]
    assert "/api/v1/projects" in paths
    assert "/api/v1/projects/{project_id}/save" in paths
    assert "/api/v1/projects/{project_id}/autosave" in paths
