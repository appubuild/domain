"""The edit geometry (`services/timeline/ripple.py`).

Pure functions, so these tests are the cheapest ones in the suite: no context, no
store, no clock. What they pin is the thing that is easy to get wrong and
expensive to discover in production — **every delta inverts.** A ripple that
cannot be put back exactly is a bug the user meets as "my clips are somewhere
else now".
"""

from __future__ import annotations

import pytest

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.temporal import Timebase
from nova_studio.domain.timeline import Clip, ClipKind, Timeline, Track, TrackKind
from nova_studio.services.timeline.ripple import (
    lift_clip,
    reinsert_clip,
    ripple_delete,
    slip_clip,
    source_frames_for,
    split_clip,
    undo_ripple,
)

pytestmark = pytest.mark.unit

TB = Timebase(num=30, den=1)


def _clip(clip_id: str, *, start: int = 0, source: int = 100, **over: object) -> Clip:
    return Clip.of(clip_id, "a1", start_frame=start, source_frames=source, **over)  # type: ignore[arg-type]


def _timeline(*tracks: Track) -> Timeline:
    return Timeline.of(*tracks, timebase=TB)


def _track(track_id: str, *clips: Clip, **over: object) -> Track:
    return Track(track_id=track_id, kind=TrackKind.VIDEO, clips=clips, **over)  # type: ignore[arg-type]


def _shape(timeline: Timeline) -> tuple[tuple[str, tuple[tuple[str, int], ...]], ...]:
    """A comparable fingerprint: track id plus ``(clip_id, start_frame)`` pairs."""
    return tuple(
        (track.track_id, tuple((clip.clip_id, clip.start_frame) for clip in track.clips))
        for track in timeline.tracks
    )


class TestSourceFramesFor:
    def test_unit_speed_consumes_one_for_one(self) -> None:
        assert source_frames_for(_clip("c1"), 100) == 100

    def test_double_speed_eats_twice_as_much(self) -> None:
        assert source_frames_for(_clip("c1", speed=2), 100) == 200

    def test_half_speed_eats_half_as_much(self) -> None:
        assert source_frames_for(_clip("c1", speed=1 / 2), 100) == 50

    def test_reverse_consumes_as_much_as_forward(self) -> None:
        assert source_frames_for(_clip("c1", speed=-1), 100) == 100

    def test_zero_frames_consumes_nothing(self) -> None:
        assert source_frames_for(_clip("c1"), 0) == 0


class TestLift:
    def test_a_lift_removes_the_clip(self) -> None:
        track = _track("v1", _clip("c1"), _clip("c2", start=100))
        lifted, _ = lift_clip(track, "c1")
        assert [clip.clip_id for clip in lifted.clips] == ["c2"]

    def test_the_delta_carries_the_clip(self) -> None:
        _, delta = lift_clip(_track("v1", _clip("c1")), "c1")
        assert delta.clip.clip_id == "c1"

    def test_the_delta_names_the_track(self) -> None:
        _, delta = lift_clip(_track("v9", _clip("c1")), "c1")
        assert delta.track_id == "v9"

    def test_reinserting_puts_it_back_exactly(self) -> None:
        track = _track("v1", _clip("c1"), _clip("c2", start=100))
        lifted, delta = lift_clip(track, "c1")
        assert reinsert_clip(lifted, delta) == track

    def test_a_lift_leaves_the_gap(self) -> None:
        """The other clips do not move: that is the difference from a ripple."""
        track = _track("v1", _clip("c1"), _clip("c2", start=100))
        lifted, _ = lift_clip(track, "c1")
        assert lifted.clip("c2").start_frame == 100

    def test_lifting_a_clip_that_is_not_there_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            lift_clip(_track("v1", _clip("c1")), "ghost")


class TestRipple:
    def test_the_clip_is_removed(self) -> None:
        timeline = _timeline(_track("v1", _clip("c1"), _clip("c2", start=100)))
        next_timeline, _ = ripple_delete(timeline, "v1", "c1")
        assert next_timeline.clip("c1") is None

    def test_the_gap_closes_on_the_same_track(self) -> None:
        timeline = _timeline(_track("v1", _clip("c1"), _clip("c2", start=100)))
        next_timeline, _ = ripple_delete(timeline, "v1", "c1")
        assert next_timeline.clip("c2").start_frame == 0

    def test_the_gap_closes_on_other_tracks_too(self) -> None:
        """A ripple is not a per-track edit; that is what locking is for."""
        timeline = _timeline(
            _track("v1", _clip("c1"), _clip("c2", start=100)),
            _track("a1", _clip("c3", start=100)),
        )
        next_timeline, _ = ripple_delete(timeline, "v1", "c1")
        assert next_timeline.clip("c3").start_frame == 0

    def test_a_clip_that_starts_before_the_cut_does_not_move(self) -> None:
        timeline = _timeline(_track("v1", _clip("c1"), _clip("c2", start=50)))
        next_timeline, _ = ripple_delete(timeline, "v1", "c1")
        assert next_timeline.clip("c2").start_frame == 50

    def test_a_locked_track_keeps_its_timing(self) -> None:
        timeline = _timeline(
            _track("v1", _clip("c1"), _clip("c2", start=100)),
            _track("a1", _clip("c3", start=100), locked=True),
        )
        next_timeline, _ = ripple_delete(timeline, "v1", "c1")
        assert next_timeline.clip("c3").start_frame == 100

    def test_the_delta_records_every_clip_that_moved(self) -> None:
        timeline = _timeline(
            _track("v1", _clip("c1"), _clip("c2", start=100)),
            _track("a1", _clip("c3", start=100)),
        )
        _, delta = ripple_delete(timeline, "v1", "c1")
        assert delta.moved == (("v1", "c2"), ("a1", "c3"))

    def test_the_delta_carries_the_distance(self) -> None:
        timeline = _timeline(_track("v1", _clip("c1", source=100), _clip("c2", start=100)))
        _, delta = ripple_delete(timeline, "v1", "c1")
        assert delta.shift_frames == 100

    def test_undo_restores_the_timeline_exactly(self) -> None:
        timeline = _timeline(
            _track("v1", _clip("c1"), _clip("c2", start=100)),
            _track("a1", _clip("c3", start=100)),
            _track("a2", _clip("c4", start=200), locked=True),
        )
        next_timeline, delta = ripple_delete(timeline, "v1", "c1")
        assert undo_ripple(next_timeline, delta) == timeline

    def test_undo_restores_a_clip_with_its_source_range(self) -> None:
        clip = Clip.of("c1", "a1", start_frame=0, in_frame=10, source_frames=50)
        timeline = _timeline(_track("v1", clip, _clip("c2", start=100)))
        next_timeline, delta = ripple_delete(timeline, "v1", "c1")
        restored = undo_ripple(next_timeline, delta).clip("c1")
        assert (restored.in_frame, restored.out_frame) == (10, 60)

    def test_rippling_a_clip_that_is_not_there_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            ripple_delete(_timeline(_track("v1", _clip("c1"))), "v1", "ghost")

    def test_rippling_on_a_track_that_is_not_there_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            ripple_delete(_timeline(_track("v1", _clip("c1"))), "ghost", "c1")

    def test_track_order_survives(self) -> None:
        timeline = _timeline(
            _track("v1", _clip("c1"), _clip("c2", start=100)),
            _track("a1", _clip("c3", start=100)),
        )
        next_timeline, _ = ripple_delete(timeline, "v1", "c1")
        assert [track.track_id for track in next_timeline.tracks] == ["v1", "a1"]

    def test_clips_stay_in_position_order(self) -> None:
        timeline = _timeline(
            _track("v1", _clip("c1"), _clip("c2", start=100), _clip("c3", start=300))
        )
        next_timeline, _ = ripple_delete(timeline, "v1", "c1")
        starts = [clip.start_frame for clip in next_timeline.track("v1").clips]
        assert starts == sorted(starts)


class TestSplit:
    def test_a_split_makes_two_clips(self) -> None:
        left, right = split_clip(_clip("c1", source=100), 40, "c2")
        assert (left.clip_id, right.clip_id) == ("c1", "c2")

    def test_the_left_half_keeps_the_start(self) -> None:
        left, _ = split_clip(_clip("c1", source=100), 40, "c2")
        assert left.start_frame == 0

    def test_the_right_half_starts_at_the_cut(self) -> None:
        _, right = split_clip(_clip("c1", source=100), 40, "c2")
        assert right.start_frame == 40

    def test_the_source_range_is_divided(self) -> None:
        left, right = split_clip(_clip("c1", source=100), 40, "c2")
        assert (left.in_frame, left.out_frame) == (0, 40)
        assert (right.in_frame, right.out_frame) == (40, 100)

    def test_speed_decides_how_much_source_the_left_half_eats(self) -> None:
        left, right = split_clip(_clip("c1", source=400, speed=2), 50, "c2")
        assert (left.out_frame, right.in_frame) == (100, 100)

    def test_a_reversed_clip_splits_from_the_other_end(self) -> None:
        """Reversed, the earlier half is the one nearer the end of the source."""
        left, right = split_clip(_clip("c1", source=100, speed=-1), 40, "c2")
        assert (left.in_frame, left.out_frame) == (60, 100)
        assert (right.in_frame, right.out_frame) == (0, 60)

    def test_both_halves_keep_the_speed(self) -> None:
        left, right = split_clip(_clip("c1", source=100, speed=-2), 25, "c2")
        assert left.speed == right.speed == -2

    def test_the_halves_together_cover_the_original(self) -> None:
        clip = _clip("c1", source=100, start=10)
        left, right = split_clip(clip, 60, "c2")
        assert (left.source_frames + right.source_frames) == clip.source_frames
        assert (left.start_frame, right.end_frame) == (
            clip.start_frame,
            clip.start_frame + clip.duration_frames,
        )

    def test_the_right_half_keeps_the_asset_and_kind(self) -> None:
        clip = Clip.of("c1", "a9", start_frame=0, source_frames=100, kind=ClipKind.AUDIO)
        _, right = split_clip(clip, 50, "c2")
        assert (right.asset_id, right.kind) == ("a9", ClipKind.AUDIO)

    def test_a_cut_outside_the_clip_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            split_clip(_clip("c1", source=100), 100, "c2")

    def test_a_cut_at_the_very_start_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            split_clip(_clip("c1", source=100), 0, "c2")

    def test_the_two_halves_need_two_ids(self) -> None:
        with pytest.raises(NovaInvariantError):
            split_clip(_clip("c1", source=100), 40, "c1")

    def test_a_cut_that_leaves_nothing_on_the_left_is_a_bug(self) -> None:
        """At 1/100 speed, forty timeline frames do not eat one source frame."""
        with pytest.raises(NovaInvariantError):
            split_clip(_clip("c1", source=100, speed=1 / 100), 40, "c2")


class TestSlip:
    def test_a_slip_moves_the_source_window(self) -> None:
        slipped = slip_clip(_clip("c1", source=100), 10)
        assert (slipped.in_frame, slipped.out_frame) == (10, 110)

    def test_a_slip_does_not_move_the_clip(self) -> None:
        slipped = slip_clip(_clip("c1", source=100, start=50), 10)
        assert slipped.start_frame == 50

    def test_a_slip_does_not_change_the_length(self) -> None:
        clip = _clip("c1", source=100, start=50)
        assert slip_clip(clip, 10).duration_frames == clip.duration_frames

    def test_a_slip_can_go_backwards(self) -> None:
        clip = Clip.of("c1", "a1", start_frame=0, in_frame=30, source_frames=50)
        assert (slip_clip(clip, -10).in_frame) == 20

    def test_a_slip_past_the_start_of_the_source_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            slip_clip(_clip("c1", source=100), -1)

    def test_a_slip_of_nothing_changes_nothing(self) -> None:
        clip = _clip("c1", source=100)
        assert slip_clip(clip, 0) == clip

    def test_slipping_there_and_back_is_the_same_clip(self) -> None:
        clip = _clip("c1", source=100, start=50)
        assert slip_clip(slip_clip(clip, 25), -25) == clip
