"""The workspace remembering what it saw.

The recording is a decoration on two operations that matter — opening a project
and closing one — so the property under test is not that the row is written, it
is that **the decoration cannot break the operation**. A user whose project will
not open because the recent list could not be written would be right to be
furious, and the failure would be invisible in every other test, because every
other test runs without a recent-files store at all.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.api.workspace import ProjectWorkspace
from nova_studio.core.result import Result, err
from nova_studio.infra.persistence.recent import open_recent_files

if TYPE_CHECKING:
    from pathlib import Path

    from nova_studio.core.events import EventBus
    from nova_studio.domain.persistence import RecentProject

pytestmark = pytest.mark.unit


class BrokenRecentFiles:
    """A store that refuses everything, to prove nothing depends on it."""

    def __init__(self) -> None:
        self.calls = 0

    def record(self, entry: RecentProject) -> Result[None]:
        self.calls += 1
        return err(_broken())

    def mark_closed(self, path: str, *, at_ms: int, dirty: bool = False) -> Result[None]:
        self.calls += 1
        return err(_broken())

    def recent(self, *, limit: int = 20) -> tuple[RecentProject, ...]:
        return ()

    def forget(self, path: str) -> Result[None]:
        return err(_broken())

    def close(self) -> None:
        return None


def _broken() -> Any:
    from nova_studio.core.errors import NovaError
    from nova_studio.ports.persistence import PersistenceErrorCode

    return NovaError(PersistenceErrorCode.UNWRITABLE, "no")


@pytest.fixture
def recent(tmp_path: Path) -> Any:
    return open_recent_files(tmp_path / "data")


def test_opening_a_project_remembers_where_it_was(
    bus: EventBus, isolated_data_dir: Path, recent: Any, tmp_path: Path
) -> None:
    workspace = ProjectWorkspace(bus, data_dir=isolated_data_dir, recent=recent)
    path = tmp_path / "demo.nova"
    opened = workspace.create(name="Demo", path=path).unwrap()
    workspace.close(opened.project_id)

    entries = recent.recent()
    assert [entry.path for entry in entries] == [str(path)]
    assert entries[0].name == "Demo"
    assert entries[0].project_id == str(opened.project_id)
    assert entries[0].closed_ms is not None


def test_closing_a_dirty_project_says_so(
    bus: EventBus, isolated_data_dir: Path, recent: Any, tmp_path: Path
) -> None:
    workspace = ProjectWorkspace(bus, data_dir=isolated_data_dir, recent=recent)
    path = tmp_path / "dirty.nova"
    opened = workspace.create(name="Dirty", path=path).unwrap()  # created dirty
    workspace.close(opened.project_id)
    assert recent.recent()[0].dirty is True


def test_a_project_with_nowhere_to_live_is_not_remembered(
    bus: EventBus, isolated_data_dir: Path, recent: Any
) -> None:
    # "Recent" means somewhere to come back to. A project that has never been
    # saved has no path, and a row with an empty one would be a list entry that
    # cannot be opened.
    workspace = ProjectWorkspace(bus, data_dir=isolated_data_dir, recent=recent)
    workspace.create(name="Untitled")
    assert recent.recent() == ()


def test_a_store_that_refuses_does_not_stop_the_project_opening(
    bus: EventBus, isolated_data_dir: Path, tmp_path: Path
) -> None:
    broken = BrokenRecentFiles()
    workspace = ProjectWorkspace(bus, data_dir=isolated_data_dir, recent=broken)
    opened = workspace.create(name="Demo", path=tmp_path / "demo.nova")
    assert opened.is_ok()
    assert broken.calls == 1


def test_a_store_that_refuses_does_not_stop_the_close(
    bus: EventBus, isolated_data_dir: Path, tmp_path: Path
) -> None:
    broken = BrokenRecentFiles()
    workspace = ProjectWorkspace(bus, data_dir=isolated_data_dir, recent=broken)
    opened = workspace.create(name="Demo", path=tmp_path / "demo.nova").unwrap()
    assert workspace.close(opened.project_id).unwrap() is True
    assert broken.calls == 2


def test_without_a_store_nothing_is_recorded_and_nothing_fails(
    bus: EventBus, isolated_data_dir: Path, tmp_path: Path
) -> None:
    # The default, because a workspace is also built in tests with no data
    # directory: absence must be a no-op, not a branch somebody forgot.
    workspace = ProjectWorkspace(bus, data_dir=isolated_data_dir)
    opened = workspace.create(name="Demo", path=tmp_path / "demo.nova")
    assert opened.is_ok()
    assert workspace.close(opened.unwrap().project_id).unwrap() is True


def test_a_save_as_moves_the_entry_with_the_project(
    bus: EventBus, isolated_data_dir: Path, recent: Any, tmp_path: Path
) -> None:
    workspace = ProjectWorkspace(bus, data_dir=isolated_data_dir, recent=recent)
    opened = workspace.create(name="Demo", path=tmp_path / "demo.nova").unwrap()
    workspace.save(opened.project_id).unwrap()
    elsewhere = tmp_path / "elsewhere.nova"
    workspace.save_as(opened.project_id, elsewhere).unwrap()

    # Both files exist, so both are listed — but the one the user is working on
    # is the newest, and it carries the project's name, not the file's.
    assert [entry.path for entry in recent.recent()] == [
        str(elsewhere),
        str(tmp_path / "demo.nova"),
    ]
    assert recent.recent()[0].name == "Demo"


def test_opening_again_keeps_one_row(
    bus: EventBus, isolated_data_dir: Path, recent: Any, tmp_path: Path
) -> None:
    workspace = ProjectWorkspace(bus, data_dir=isolated_data_dir, recent=recent)
    path = tmp_path / "again.nova"
    first = workspace.create(name="Again", path=path).unwrap()
    workspace.save(first.project_id).unwrap()  # a path is not a file until it is written
    workspace.close(first.project_id)
    opened = workspace.open(path).unwrap()
    assert [entry.path for entry in recent.recent()] == [str(path)]
    assert recent.recent()[0].project_id == str(opened.project_id)
