"""The edit commands (`services/timeline/commands.py`).

Every command is pinned the same way — validate, execute, undo, and put it back —
because ADR-0008 accepts the cost of writing `undo` for everything and buys that
cost down with one rule: **execute then undo must leave the timeline exactly as
it was.** The round trip is the test; the summary is the user's sentence.
"""

from __future__ import annotations

import pytest

from nova_studio.core.commands import CommandHistory, CommandOutcome, UndoScope
from nova_studio.core.temporal import Timebase
from nova_studio.domain.timeline import Clip, Timeline, Track, TrackKind, validate_timeline
from nova_studio.services.timeline import (
    LiftClipCommand,
    MoveClipCommand,
    RippleDeleteCommand,
    SlipClipCommand,
    SplitClipCommand,
    TimelineEditor,
    TimelineStore,
    TrimClipCommand,
    TrimEdge,
)

pytestmark = pytest.mark.unit

TB = Timebase(num=30, den=1)


def _clip(clip_id: str, *, start: int = 0, source: int = 100, **over: object) -> Clip:
    return Clip.of(clip_id, "a1", start_frame=start, source_frames=source, **over)  # type: ignore[arg-type]


def _track(track_id: str, *clips: Clip, **over: object) -> Track:
    return Track(track_id=track_id, kind=TrackKind.VIDEO, clips=clips, **over)  # type: ignore[arg-type]


def _timeline(*tracks: Track) -> Timeline:
    return Timeline.of(*tracks, timebase=TB)


def _editor(*tracks: Track) -> tuple[TimelineEditor, TimelineStore]:
    store = TimelineStore(timeline=_timeline(*tracks))
    return TimelineEditor(store=store, project_id="p1"), store


def _shape(timeline: Timeline) -> tuple[tuple[str, tuple[tuple[str, int], ...]], ...]:
    return tuple(
        (track.track_id, tuple((clip.clip_id, clip.start_frame) for clip in track.clips))
        for track in timeline.tracks
    )


def _pair(*tracks: Track) -> tuple[TimelineEditor, Timeline]:
    editor, _ = _editor(*tracks)
    return editor, editor.store.current()


class TestMoveClip:
    def test_a_clip_moves(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1"), _clip("c2", start=200)))
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=50))
        assert store.current().clip("c1").start_frame == 50

    def test_the_outcome_names_what_changed(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        outcome = editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=50)).unwrap()
        assert outcome.affected == frozenset({"c1"})

    def test_the_outcome_says_the_preview_must_be_redrawn(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        outcome: CommandOutcome = editor.execute(
            MoveClipCommand(clip_id="c1", to_start_frame=50)
        ).unwrap()
        assert "preview" in outcome.invalidate
        assert outcome.rerender is True

    def test_the_summary_is_a_sentence(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        outcome = editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=50)).unwrap()
        assert "frame 50" in outcome.summary

    def test_undo_puts_it_back(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1"), _clip("c2", start=200)))
        before = store.current()
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=50))
        editor.undo()
        assert store.current() == before

    def test_a_clip_moves_to_another_track(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1")), _track("v2", _clip("c2", start=200)))
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=400, to_track_id="v2"))
        assert store.current().track_of("c1").track_id == "v2"

    def test_undo_brings_it_home(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1")), _track("v2", _clip("c2", start=200)))
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=200, to_track_id="v2"))
        editor.undo()
        assert store.current().track_of("c1").track_id == "v1"
        assert store.current().clip("c1").start_frame == 0

    def test_moving_onto_another_clip_is_refused(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1"), _clip("c2", start=100)))
        result = editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=50))
        assert result.is_err() is True
        assert store.current().clip("c1").start_frame == 0

    def test_the_refusal_says_which_track_and_frame(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1"), _clip("c2", start=100)))
        error = editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=50)).unwrap_err()
        assert "v1" in error.message and "50" in error.message

    def test_moving_onto_a_locked_track_is_refused(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")), _track("v2", locked=True))
        error = editor.execute(
            MoveClipCommand(clip_id="c1", to_start_frame=0, to_track_id="v2")
        ).unwrap_err()
        assert "locked" in error.message

    def test_moving_before_the_start_of_time_is_refused(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        error = editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=-1)).unwrap_err()
        assert "0" in error.message

    def test_moving_a_clip_that_is_not_there_is_refused(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        error = editor.execute(MoveClipCommand(clip_id="ghost", to_start_frame=10)).unwrap_err()
        assert "ghost" in error.message

    def test_moving_to_a_track_that_is_not_there_is_refused(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        error = editor.execute(
            MoveClipCommand(clip_id="c1", to_start_frame=0, to_track_id="ghost")
        ).unwrap_err()
        assert "ghost" in error.message

    def test_a_refused_move_is_not_remembered(self) -> None:
        """A rejected edit must not cost the user their redo future."""
        editor, _ = _editor(_track("v1", _clip("c1"), _clip("c2", start=100)))
        editor.execute(MoveClipCommand(clip_id="c1", to_start_frame=50))
        editor.undo()
        editor.execute(MoveClipCommand(clip_id="c2", to_start_frame=50))
        assert editor.can_redo is False

    def test_a_move_has_no_merge_key_without_a_gesture(self) -> None:
        assert MoveClipCommand(clip_id="c1", to_start_frame=0).merge_key() is None

    def test_a_gesture_gives_a_move_a_merge_key(self) -> None:
        command = MoveClipCommand(clip_id="c1", to_start_frame=0, gesture="drag-1")
        assert command.merge_key() == ("c1", "drag-1")

    def test_merging_keeps_where_the_drag_began(self) -> None:
        first = MoveClipCommand(clip_id="c1", to_start_frame=10, gesture="d")
        second = MoveClipCommand(clip_id="c1", to_start_frame=40, gesture="d")
        first.from_start_frame = 0
        merged = second.merge_into(first)
        assert (merged.from_start_frame, merged.to_start_frame) == (0, 40)


class TestTrimClip:
    def test_the_tail_moves(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1", source=100)))
        editor.execute(TrimClipCommand(clip_id="c1", to_frame=60))
        assert store.current().clip("c1").out_frame == 60

    def test_trimming_the_tail_keeps_the_head(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1", source=100, start=10)))
        editor.execute(TrimClipCommand(clip_id="c1", to_frame=60))
        assert store.current().clip("c1").start_frame == 10

    def test_the_head_moves_the_source_with_it(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1", source=100)))
        editor.execute(TrimClipCommand(clip_id="c1", to_frame=40, edge=TrimEdge.START))
        clip = store.current().clip("c1")
        assert (clip.start_frame, clip.in_frame) == (40, 40)

    def test_trimming_the_head_shortens_the_clip(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1", source=100)))
        editor.execute(TrimClipCommand(clip_id="c1", to_frame=40, edge=TrimEdge.START))
        assert store.current().clip("c1").duration_frames == 60

    def test_speed_decides_how_much_source_a_trim_eats(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1", source=400, speed=2)))
        editor.execute(TrimClipCommand(clip_id="c1", to_frame=50))
        assert store.current().clip("c1").out_frame == 100

    def test_undo_puts_the_tail_back(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1", source=100)))
        before = store.current()
        editor.execute(TrimClipCommand(clip_id="c1", to_frame=60))
        editor.undo()
        assert store.current() == before

    def test_undo_puts_the_head_back(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1", source=100)))
        before = store.current()
        editor.execute(TrimClipCommand(clip_id="c1", to_frame=40, edge=TrimEdge.START))
        editor.undo()
        assert store.current() == before

    def test_trimming_to_nothing_is_refused(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1", source=100, start=10)))
        error = editor.execute(TrimClipCommand(clip_id="c1", to_frame=10)).unwrap_err()
        assert "no frames" in error.message

    def test_trimming_the_head_past_the_tail_is_refused(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1", source=100)))
        error = editor.execute(
            TrimClipCommand(clip_id="c1", to_frame=100, edge=TrimEdge.START)
        ).unwrap_err()
        assert "inside" in error.message

    def test_trimming_a_clip_that_is_not_there_is_refused(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        error = editor.execute(TrimClipCommand(clip_id="ghost", to_frame=10)).unwrap_err()
        assert "ghost" in error.message

    def test_the_two_ends_are_different_gestures(self) -> None:
        """A head trim and a tail trim in one drag must never merge."""
        head = TrimClipCommand(clip_id="c1", to_frame=10, edge=TrimEdge.START, gesture="d")
        tail = TrimClipCommand(clip_id="c1", to_frame=90, gesture="d")
        assert head.merge_key() != tail.merge_key()

    def test_merging_a_trim_keeps_the_clip_as_it_was(self) -> None:
        original = _clip("c1", source=100)
        first = TrimClipCommand(clip_id="c1", to_frame=90, gesture="d")
        second = TrimClipCommand(clip_id="c1", to_frame=70, gesture="d")
        first.saved = original
        assert second.merge_into(first).saved is original


class TestSlipClip:
    def test_the_window_moves(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1", source=100, start=50)))
        editor.execute(SlipClipCommand(clip_id="c1", delta_frames=10))
        clip = store.current().clip("c1")
        assert (clip.in_frame, clip.out_frame) == (10, 110)

    def test_the_clip_does_not_move(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1", source=100, start=50)))
        editor.execute(SlipClipCommand(clip_id="c1", delta_frames=10))
        assert store.current().clip("c1").start_frame == 50

    def test_undo_puts_the_window_back(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1", source=100, start=50)))
        before = store.current()
        editor.execute(SlipClipCommand(clip_id="c1", delta_frames=10))
        editor.undo()
        assert store.current() == before

    def test_slipping_before_the_source_starts_is_refused(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1", source=100)))
        error = editor.execute(SlipClipCommand(clip_id="c1", delta_frames=-1)).unwrap_err()
        assert "beginning of the source" in error.message

    def test_slipping_a_clip_that_is_not_there_is_refused(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        error = editor.execute(SlipClipCommand(clip_id="ghost", delta_frames=5)).unwrap_err()
        assert "ghost" in error.message

    def test_a_slip_drag_accumulates(self) -> None:
        """Three nudges of five frames are one undo step of fifteen."""
        first = SlipClipCommand(clip_id="c1", delta_frames=5, gesture="d", applied=5)
        second = SlipClipCommand(clip_id="c1", delta_frames=5, gesture="d", applied=5)
        merged = second.merge_into(first)
        assert (merged.delta_frames, merged.applied) == (10, 10)


class TestSplitClip:
    def test_the_clip_becomes_two(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1", source=100)))
        editor.execute(SplitClipCommand(clip_id="c1", at_frame=40, new_clip_id="c1b"))
        assert store.current().clip_count == 2

    def test_the_left_half_keeps_the_id(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1", source=100)))
        editor.execute(SplitClipCommand(clip_id="c1", at_frame=40, new_clip_id="c1b"))
        assert store.current().clip("c1").start_frame == 0

    def test_the_right_half_takes_the_new_id(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1", source=100)))
        editor.execute(SplitClipCommand(clip_id="c1", at_frame=40, new_clip_id="c1b"))
        assert store.current().clip("c1b").start_frame == 40

    def test_undo_puts_the_clip_back_together(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1", source=100)))
        before = store.current()
        editor.execute(SplitClipCommand(clip_id="c1", at_frame=40, new_clip_id="c1b"))
        editor.undo()
        assert store.current() == before

    def test_the_outcome_names_both_halves(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1", source=100)))
        outcome = editor.execute(
            SplitClipCommand(clip_id="c1", at_frame=40, new_clip_id="c1b")
        ).unwrap()
        assert outcome.affected == frozenset({"c1", "c1b"})

    def test_a_cut_outside_the_clip_is_refused(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1", source=100)))
        error = editor.execute(
            SplitClipCommand(clip_id="c1", at_frame=400, new_clip_id="c1b")
        ).unwrap_err()
        assert "not inside" in error.message

    def test_splitting_a_clip_that_is_not_there_is_refused(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        error = editor.execute(
            SplitClipCommand(clip_id="ghost", at_frame=10, new_clip_id="x")
        ).unwrap_err()
        assert "ghost" in error.message


class TestLiftClip:
    def test_the_clip_is_removed(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1"), _clip("c2", start=200)))
        editor.execute(LiftClipCommand(clip_id="c1"))
        assert store.current().clip("c1") is None

    def test_the_gap_is_left_behind(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1"), _clip("c2", start=200)))
        editor.execute(LiftClipCommand(clip_id="c1"))
        assert store.current().clip("c2").start_frame == 200

    def test_undo_puts_it_back(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1"), _clip("c2", start=200)))
        before = store.current()
        editor.execute(LiftClipCommand(clip_id="c1"))
        editor.undo()
        assert store.current() == before

    def test_lifting_a_clip_that_is_not_there_is_refused(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        error = editor.execute(LiftClipCommand(clip_id="ghost")).unwrap_err()
        assert "ghost" in error.message

    def test_undoing_a_lift_that_never_ran_is_refused(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        editor, _ = _editor(_track("v1", _clip("c1")))
        error = LiftClipCommand(clip_id="c1").undo(editor.context()).unwrap_err()
        assert error.code == "NS-COMMAND-4103"


class TestRippleDelete:
    def test_the_clip_is_removed(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1"), _clip("c2", start=100)))
        editor.execute(RippleDeleteCommand(clip_id="c1"))
        assert store.current().clip("c1") is None

    def test_the_gap_closes(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1"), _clip("c2", start=100)))
        editor.execute(RippleDeleteCommand(clip_id="c1"))
        assert store.current().clip("c2").start_frame == 0

    def test_other_tracks_close_the_gap_too(self) -> None:
        editor, store = _editor(
            _track("v1", _clip("c1"), _clip("c2", start=100)),
            _track("a1", _clip("c3", start=100)),
        )
        editor.execute(RippleDeleteCommand(clip_id="c1"))
        assert store.current().clip("c3").start_frame == 0

    def test_a_locked_track_is_left_alone(self) -> None:
        editor, store = _editor(
            _track("v1", _clip("c1"), _clip("c2", start=100)),
            _track("a1", _clip("c3", start=100), locked=True),
        )
        editor.execute(RippleDeleteCommand(clip_id="c1"))
        assert store.current().clip("c3").start_frame == 100

    def test_undo_puts_everything_back(self) -> None:
        editor, store = _editor(
            _track("v1", _clip("c1"), _clip("c2", start=100)),
            _track("a1", _clip("c3", start=100)),
        )
        before = store.current()
        editor.execute(RippleDeleteCommand(clip_id="c1"))
        editor.undo()
        assert store.current() == before

    def test_the_summary_says_how_much_moved(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1"), _clip("c2", start=100)))
        outcome = editor.execute(RippleDeleteCommand(clip_id="c1")).unwrap()
        assert "1 clips" in outcome.summary

    def test_a_ripple_is_a_medium_command(self) -> None:
        """Its delta is a list of ids, not four integers."""
        assert RippleDeleteCommand(clip_id="c1").memory_class.value == "medium"

    def test_deleting_a_clip_that_is_not_there_is_refused(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        error = editor.execute(RippleDeleteCommand(clip_id="ghost")).unwrap_err()
        assert "ghost" in error.message


class TestTheGuard:
    def test_an_edit_that_would_break_the_timeline_is_refused(self) -> None:
        """Trimming a tail over the next clip is an overlap waiting to happen."""
        editor, _ = _editor(_track("v1", _clip("c1", source=100), _clip("c2", start=200)))
        result = editor.execute(TrimClipCommand(clip_id="c1", to_frame=250))
        assert result.is_err() is True

    def test_the_timeline_is_left_as_it_was(self) -> None:
        editor, store = _editor(_track("v1", _clip("c1", source=100), _clip("c2", start=200)))
        before = store.current()
        editor.execute(TrimClipCommand(clip_id="c1", to_frame=250))
        assert store.current() == before

    def test_the_refusal_explains_itself(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1", source=100), _clip("c2", start=200)))
        error = editor.execute(TrimClipCommand(clip_id="c1", to_frame=250)).unwrap_err()
        assert "overlapping" in error.message

    def test_a_refused_edit_is_not_undoable(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1", source=100), _clip("c2", start=200)))
        editor.execute(TrimClipCommand(clip_id="c1", to_frame=250))
        assert editor.can_undo is False

    def test_an_edit_is_allowed_on_a_timeline_that_arrived_broken(self) -> None:
        """The guard is about what the command did, not about the project."""
        broken = _track("v1", _clip("c1", source=100), _clip("c2", start=50))
        editor, _ = _editor(broken)
        result = editor.execute(MoveClipCommand(clip_id="c2", to_start_frame=300))
        assert result.is_ok() is True

    def test_the_guard_does_not_fire_on_a_timeline_that_arrived_broken(self) -> None:
        """The rule is about what *this* command did; it cannot fix yesterday."""
        broken = _track("v1", _clip("c1", source=100), _clip("c2", start=50))
        editor, store = _editor(broken, _track("v2", _clip("c3", start=400)))
        result = editor.execute(TrimClipCommand(clip_id="c1", to_frame=140))
        assert result.is_ok() is True
        assert "overlapping" in validate_timeline(store.current())


class TestWithoutAStore:
    def test_a_command_reports_a_missing_store(self) -> None:
        from nova_studio.core.commands import CommandContext

        ctx = CommandContext(services=None, project_id="p1")
        result = MoveClipCommand(clip_id="c1", to_start_frame=10).execute(ctx)
        assert result.unwrap_err().code == "NS-COMMAND-4101"

    def test_validating_without_a_store_is_refused_too(self) -> None:
        from nova_studio.core.commands import CommandContext

        ctx = CommandContext(services=None, project_id="p1")
        assert MoveClipCommand(clip_id="c1", to_start_frame=10).validate(ctx).is_err() is True

    def test_a_command_can_be_run_with_an_injected_context(self) -> None:
        editor, _ = _editor(_track("v1", _clip("c1")))
        history = CommandHistory()
        result = history.execute(MoveClipCommand(clip_id="c1", to_start_frame=10), editor.context())
        assert result.is_ok() is True
        assert history.state(UndoScope.TIMELINE).undo_depth == 1

    def test_the_shape_helper_agrees_with_the_timeline(self) -> None:
        editor, _ = _pair(_track("v1", _clip("c1"), _clip("c2", start=200)))
        assert _shape(editor.store.current()) == (("v1", (("c1", 0), ("c2", 200))),)
