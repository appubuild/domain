"""The editor façade (`services/timeline/editor.py`).

The door every edit goes through. These tests are about the door, not the edits:
undo and redo ordering, the state the Edit menu reads, and the promise that a
rejected command costs the user nothing — including their redo future, which is
the bug users actually notice.
"""

from __future__ import annotations

from typing import Any

import pytest

from nova_studio.core.commands import CommandContext, CommandHistory, UndoScope
from nova_studio.core.temporal import Timebase
from nova_studio.domain.timeline import Clip, Timeline, Track, TrackKind
from nova_studio.services.timeline import (
    LiftClipCommand,
    MoveClipCommand,
    TimelineEditor,
    TimelineStore,
)

pytestmark = pytest.mark.unit

TB = Timebase(num=30, den=1)


def _clip(clip_id: str, *, start: int = 0, source: int = 100) -> Clip:
    return Clip.of(clip_id, "a1", start_frame=start, source_frames=source)


def _track(track_id: str, *clips: Clip, **over: Any) -> Track:
    return Track(track_id=track_id, kind=TrackKind.VIDEO, clips=clips, **over)


def _timeline(*tracks: Track) -> Timeline:
    return Timeline.of(*tracks, timebase=TB)


def _editor(*tracks: Track) -> tuple[TimelineEditor, TimelineStore]:
    store = TimelineStore(timeline=_timeline(*tracks))
    return TimelineEditor(store=store, project_id="p1"), store


class TestTheDoor:
    def test_an_edit_goes_through(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1")))
        result = editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=50))
        assert result.is_ok() is True
        assert store.current().clip("c1").start_frame == 50

    def test_a_rejected_edit_changes_nothing(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1"), _clip("c2", start=100)))
        result = editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=50))
        assert result.is_err() is True
        assert store.current().clip("c1").start_frame == 0

    def test_a_rejected_edit_is_not_undoable(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1"), _clip("c2", start=100)))
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=50))
        assert editor.can_undo is False

    def test_the_project_id_travels_with_the_context(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        assert editor.context().project_id == "p1"

    def test_the_context_carries_the_store(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1")))
        assert editor.context().services is store

    def test_the_context_names_the_scope(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        assert editor.context().scope_id == UndoScope.TIMELINE.value

    def test_a_caller_may_supply_its_own_context(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1")))
        ctx = CommandContext(services=store, project_id="other", scope_id="caption")
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=50), ctx)
        assert store.current().clip("c1").start_frame == 50


class TestUndoAndRedo:
    def test_undo_reverses_the_last_edit(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1"), _clip("c2", start=200)))
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=50))
        editor.undo()
        assert store.current().clip("c1").start_frame == 0

    def test_undo_returns_the_command_it_undid(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=50))
        assert editor.undo().unwrap().command_id == "timeline.move-clip"

    def test_undoing_an_empty_history_is_not_an_error(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        assert editor.undo().unwrap() is None

    def test_redoing_an_empty_history_is_not_an_error(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        assert editor.redo().unwrap() is None

    def test_redo_reapplies_the_edit(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1")))
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=50))
        editor.undo()
        editor.redo()
        assert store.current().clip("c1").start_frame == 50

    def test_edits_undo_in_reverse_order(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1"), _clip("c2", start=200)))
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=10))
        editor.execute(MoveClipCommand(clip_id="c2", to_start_frame=300))
        editor.undo()
        assert store.current().clip("c1").start_frame == 10
        editor.undo()
        assert store.current().clip("c1").start_frame == 0

    def test_a_new_edit_clears_the_redo_future(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1"), _clip("c2", start=200)))
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=10))
        editor.undo()
        editor.execute(MoveClipCommand(clip_id="c2", to_start_frame=300))
        assert editor.can_redo is False

    def test_a_rejected_edit_does_not_clear_the_redo_future(self) -> None:
        """The promise: trying something impossible costs nothing."""
        editor, _ = _editor(_track("v1", _clip("c1"), _clip("c2", start=200)))
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=10))
        editor.undo()
        editor.execute(MoveClipCommand(clip_id="c2", to_start_frame=0))
        assert editor.can_redo is True

    def test_a_round_trip_leaves_the_timeline_untouched(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1"), _clip("c2", start=200)))
        before = store.current()
        editor.execute(LiftClipCommand(clip_id="c1"))
        editor.undo()
        editor.redo()
        editor.undo()
        assert store.current() == before


class TestTheEditMenu:
    def test_nothing_to_undo_at_the_start(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        assert editor.can_undo is False

    def test_something_to_undo_after_an_edit(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=50))
        assert editor.can_undo is True

    def test_the_undo_label_is_the_command_that_would_be_undone(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=50))
        assert editor.undo_label == "command.timeline.move_clip"

    def test_the_redo_label_appears_after_an_undo(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=50))
        editor.undo()
        assert editor.redo_label == "command.timeline.move_clip"

    def test_the_labels_are_empty_with_nothing_to_do(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        assert (editor.undo_label, editor.redo_label) == ("", "")

    def test_the_depth_counts_both_stacks(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1"), _clip("c2", start=200)))
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=10))
        editor.execute(MoveClipCommand(clip_id="c2", to_start_frame=300))
        editor.undo()
        assert editor.depth == (1, 1)

    def test_the_history_panel_lists_what_happened(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=50))
        assert len(editor.recent()) == 1

    def test_the_history_panel_can_be_limited(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1"), _clip("c2", start=200)))
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=10))
        editor.execute(MoveClipCommand(clip_id="c2", to_start_frame=300))
        assert len(editor.recent(limit=1)) == 1

    def test_the_state_names_the_scope(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        assert editor.state().scope is UndoScope.TIMELINE


class TestWiring:
    def test_a_history_can_be_injected(self) -> None:
        store = TimelineStore(timeline=_timeline(_track("v1", _clip("c1"))))
        history = CommandHistory()
        editor = TimelineEditor(store=store, history=history)
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=50))
        assert history.state(UndoScope.TIMELINE).undo_depth == 1

    def test_the_editor_reads_the_state_from_its_injected_history(self) -> None:
        store = TimelineStore(timeline=_timeline(_track("v1", _clip("c1"))))
        editor = TimelineEditor(store=store, history=CommandHistory())
        assert editor.can_undo is False

    def test_the_clock_is_shared_with_the_context(self) -> None:
        store = TimelineStore(timeline=_timeline(_track("v1", _clip("c1"))))
        editor = TimelineEditor(store=store, clock=lambda: 7.0)
        assert editor.context().now() == 7.0

    def test_the_bus_is_shared_with_the_context(self) -> None:
        from nova_studio.core.events import EventBus

        store = TimelineStore(timeline=_timeline(_track("v1", _clip("c1"))))
        bus = EventBus()
        editor = TimelineEditor(store=store, bus=bus)
        assert editor.context().bus is bus

    def test_the_editor_edits_the_timeline_it_was_given(self) -> None:
        timeline = _timeline(_track("v1", _clip("c1")))
        editor, store = _editor(_track("v1", _clip("c1")))
        editor.store.reset(timeline)
        assert store.current() is timeline
