"""The edit decision list (ADR-0006, ADR-0008, ARCHITECTURE §7.2).

What is pinned here is what an editor cannot get wrong without the user
noticing:

* **Time is frames, never seconds.**  A clip's duration is derived once from
  its source length and its exact rational speed; two clips at "half speed"
  cannot drift apart because nothing is accumulated as a float.
* **A clip knows both of its time spaces.**  `start_frame` is timeline
  coordinates, `in_frame`/`out_frame` are source coordinates, and
  `source_frame_at` is the only thing that crosses between them — so trimming
  one end cannot move the other.
* **Top-first storage, bottom-first rendering.**  Tracks are stored the way the
  user sees them (index 0 at the top) and `resolve` returns contributions in
  paint order, so an inverted layer is a test failure rather than a mystery
  picture.
* **An overlap must be covered by a transition.**  Two clips fighting for the
  same frames with no transition between them is reported, not rendered
  arbitrarily.
* **Snapping targets the timeline's own geometry** — clip edges, markers, the
  ends — and never snaps a clip to itself.

Everything is pure: no clock, no decoder, no files.  The compositor is a
function of `(timeline, frame)`, and this is the model it consumes.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.core import NovaInvariantError
from nova_studio.core.temporal import DEFAULT_TIMEBASE, Rational, Timebase
from nova_studio.domain.timeline import (
    DEFAULT_SNAP_TOLERANCE_FRAMES,
    DEFAULT_TRANSITION_FRAMES,
    MIN_CLIP_FRAMES,
    UNIT_SPEED,
    Clip,
    ClipContribution,
    ClipKind,
    Marker,
    ResolvedFrame,
    Timeline,
    Track,
    TrackKind,
    Transition,
    TransitionAlignment,
    TransitionEdge,
    TransitionKind,
    snap_candidates,
    validate_timeline,
)

if TYPE_CHECKING:
    from collections.abc import Mapping

pytestmark = pytest.mark.unit


# -- builders -----------------------------------------------------------------


def _clip(
    clip_id: str = "c1",
    asset_id: str = "asset-1",
    start_frame: int = 0,
    in_frame: int = 0,
    out_frame: int = 100,
    **over: Any,
) -> Clip:
    return Clip(
        **{
            "clip_id": clip_id,
            "asset_id": asset_id,
            "start_frame": start_frame,
            "in_frame": in_frame,
            "out_frame": out_frame,
            **over,
        }
    )


def _placed(start_frame: int, source_frames: int, clip_id: str = "c1") -> Clip:
    """A clip at ``start_frame`` running for ``source_frames`` at normal speed."""
    return Clip.of(clip_id, "x", start_frame=start_frame, source_frames=source_frames)


def _track(track_id: str = "v1", kind: TrackKind = TrackKind.VIDEO, **over: Any) -> Track:
    return Track(**{"track_id": track_id, "kind": kind, **over})


def _transition(
    transition_id: str = "t1",
    clip_id: str = "c1",
    edge: TransitionEdge = TransitionEdge.START,
    **over: Any,
) -> Transition:
    return Transition(**{"transition_id": transition_id, "clip_id": clip_id, "edge": edge, **over})


def _timeline(*tracks: Track, timebase: Timebase = DEFAULT_TIMEBASE) -> Timeline:
    return Timeline.of(*tracks, timebase=timebase)


def _round_trip(wire: Mapping[str, Any]) -> Mapping[str, Any]:
    """JSON in and out, which is what the project file does."""
    return json.loads(json.dumps(wire))


class TestClip:
    def test_a_clip_is_a_source_slice_at_a_position(self) -> None:
        clip = _clip(start_frame=10, in_frame=5, out_frame=55)
        assert (clip.start_frame, clip.in_frame, clip.out_frame) == (10, 5, 55)
        assert (clip.source_frames, clip.duration_frames) == (50, 50)

    def test_the_out_point_is_exclusive(self) -> None:
        assert _clip(in_frame=0, out_frame=1).source_frames == 1

    def test_of_takes_a_length_rather_than_an_out_point(self) -> None:
        clip = Clip.of("c", "a", in_frame=10, source_frames=25)
        assert (clip.in_frame, clip.out_frame, clip.source_frames) == (10, 35, 25)

    def test_double_speed_halves_the_duration(self) -> None:
        clip = Clip.of("c", "a", source_frames=100, speed=Rational(2))
        assert clip.duration_frames == 50

    def test_half_speed_doubles_the_duration(self) -> None:
        clip = Clip.of("c", "a", source_frames=100, speed=Rational(1, 2))
        assert clip.duration_frames == 200

    def test_reverse_plays_backwards_at_the_same_length(self) -> None:
        clip = Clip.of("c", "a", source_frames=100, speed=Rational(-1))
        assert clip.is_reversed
        assert clip.duration_frames == 100

    def test_a_clip_rounds_to_at_least_one_frame(self) -> None:
        """Zero frames would be invisible but would still answer hit-tests."""
        clip = Clip.of("c", "a", source_frames=1, speed=Rational(10))
        assert clip.duration_frames == MIN_CLIP_FRAMES

    def test_the_end_frame_is_the_first_frame_after_the_clip(self) -> None:
        assert _clip(start_frame=10, out_frame=60).end_frame == 70

    def test_a_clip_must_have_an_id(self) -> None:
        with pytest.raises(NovaInvariantError, match="clip_id"):
            _clip(clip_id="")

    def test_a_clip_must_reference_an_asset(self) -> None:
        with pytest.raises(NovaInvariantError, match="must reference an asset"):
            _clip(asset_id="")

    def test_a_generated_clip_needs_no_asset(self) -> None:
        assert _clip(asset_id="", kind=ClipKind.SOLID).is_generated
        assert _clip(asset_id="", kind=ClipKind.ADJUSTMENT).is_generated
        assert _clip(asset_id="", kind=ClipKind.TEXT).is_generated

    def test_a_decoded_clip_is_not_generated(self) -> None:
        assert not _clip().is_generated

    def test_the_source_range_may_not_be_empty(self) -> None:
        with pytest.raises(NovaInvariantError, match="after in_frame"):
            _clip(in_frame=10, out_frame=10)

    def test_neither_time_may_be_negative(self) -> None:
        with pytest.raises(NovaInvariantError, match="in_frame"):
            _clip(in_frame=-1)
        with pytest.raises(NovaInvariantError, match="start_frame"):
            _clip(start_frame=-1)

    def test_a_stopped_clip_is_meaningless(self) -> None:
        with pytest.raises(NovaInvariantError, match="speed"):
            _clip(speed=Rational(0))

    def test_a_clip_knows_what_it_is_showing(self) -> None:
        clip = _clip(start_frame=10, out_frame=60)  # ten to sixty-nine inclusive
        assert clip.contains(10)
        assert clip.contains(69)
        assert not clip.contains(9)
        assert not clip.contains(70)

    def test_the_source_frame_follows_the_timeline_position(self) -> None:
        clip = _clip(start_frame=100, in_frame=500, out_frame=600)
        assert clip.source_frame_at(100) == 500
        assert clip.source_frame_at(149) == 549

    def test_the_source_frame_at_speed(self) -> None:
        clip = Clip.of("c", "a", in_frame=0, source_frames=100, speed=Rational(2))
        assert clip.source_frame_at(0) == 0
        assert clip.source_frame_at(10) == 20

    def test_reverse_reads_the_source_from_the_end(self) -> None:
        clip = Clip.of("c", "a", in_frame=0, source_frames=100, speed=Rational(-1))
        assert clip.source_frame_at(0) == 99
        assert clip.source_frame_at(9) == 90

    def test_the_source_frame_is_clamped_outside_the_clip(self) -> None:
        """The compositor holds the last frame during a transition, legitimately."""
        clip = _clip(start_frame=10, in_frame=0, out_frame=50)
        assert clip.source_frame_at(5) == 0
        assert clip.source_frame_at(999) == 49

    def test_the_inverse_of_the_source_mapping(self) -> None:
        clip = Clip.of("c", "a", start_frame=200, in_frame=10, source_frames=100)
        assert clip.timeline_frame_for_source(10) == 200
        assert clip.timeline_frame_for_source(59) == 249

    def test_the_inverse_also_clamps(self) -> None:
        clip = Clip.of("c", "a", start_frame=0, in_frame=10, source_frames=100)
        assert clip.timeline_frame_for_source(0) == 0
        assert clip.timeline_frame_for_source(999) == 99

    def test_a_duration_in_seconds_for_display(self) -> None:
        assert _clip(out_frame=30).duration_seconds(DEFAULT_TIMEBASE) == 1.0

    def test_moving_a_clip_never_goes_before_zero(self) -> None:
        assert _clip(start_frame=10).with_start(-5).start_frame == 0

    def test_shifting_moves_the_clip(self) -> None:
        assert _clip(start_frame=10).shifted(5).start_frame == 15

    def test_trimming_moves_one_or_both_source_ends(self) -> None:
        trimmed = _clip(in_frame=0, out_frame=100).trimmed(in_frame=10, out_frame=90)
        assert (trimmed.in_frame, trimmed.out_frame) == (10, 90)
        assert trimmed.duration_frames == 80

    def test_a_disabled_clip_contributes_nothing(self) -> None:
        assert not _clip(enabled=False).enabled

    def test_a_clip_survives_json(self) -> None:
        clip = Clip.of(
            "c1",
            "asset-1",
            start_frame=10,
            in_frame=5,
            source_frames=100,
            speed=Rational(3, 2),
            enabled=False,
            name="take 4",
            kind=ClipKind.IMAGE,
        )
        assert Clip.from_wire(_round_trip(clip.to_wire())) == clip

    def test_the_speed_is_stored_as_an_exact_rational(self) -> None:
        """A float here is how two clips at the same nominal speed drift apart."""
        assert _clip(speed=Rational(3, 2)).to_wire()["speed"] == "3/2"

    def test_a_wire_clip_rejects_unknown_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            Clip.from_wire(dict(_clip().to_wire(), extra=1))

    def test_normal_speed_is_one(self) -> None:
        assert Rational(1) == UNIT_SPEED


class TestTransition:
    def test_a_transition_hangs_off_one_end_of_one_clip(self) -> None:
        transition = _transition(clip_id="c1", edge=TransitionEdge.START)
        assert (transition.clip_id, transition.edge) == ("c1", TransitionEdge.START)

    def test_the_default_is_a_centred_dissolve(self) -> None:
        transition = _transition()
        assert transition.kind is TransitionKind.CROSS_DISSOLVE
        assert transition.alignment is TransitionAlignment.CENTER
        assert transition.duration_frames == DEFAULT_TRANSITION_FRAMES

    def test_a_centred_window_straddles_the_cut(self) -> None:
        clip = _placed(100, 100)
        assert _transition(edge=TransitionEdge.START, duration_frames=20).window(clip) == (90, 110)

    def test_an_end_transition_hangs_off_the_out_point(self) -> None:
        clip = _placed(100, 100)  # ends at frame 200
        assert _transition(edge=TransitionEdge.END, duration_frames=20).window(clip) == (190, 210)

    def test_a_start_aligned_window_follows_the_cut(self) -> None:
        clip = _placed(100, 100)
        window = _transition(duration_frames=20, alignment=TransitionAlignment.START).window(clip)
        assert window == (100, 120)

    def test_an_end_aligned_window_precedes_the_cut(self) -> None:
        clip = _placed(100, 100)
        window = _transition(duration_frames=20, alignment=TransitionAlignment.END).window(clip)
        assert window == (80, 100)

    def test_a_transition_covers_its_window(self) -> None:
        clip = _placed(100, 100)
        transition = _transition(duration_frames=20)
        assert transition.covers(clip, 95)
        assert not transition.covers(clip, 80)

    def test_progress_runs_from_zero_to_one(self) -> None:
        clip = _placed(100, 100)
        transition = _transition(duration_frames=20)
        start, _ = transition.window(clip)
        assert transition.progress(clip, start) == 0.0
        assert transition.progress(clip, start + 10) == 0.5
        assert transition.progress(clip, start + 20) == 1.0

    def test_progress_is_clamped_outside_the_window(self) -> None:
        clip = _placed(100, 100)
        transition = _transition(duration_frames=20)
        assert transition.progress(clip, 0) == 0.0
        assert transition.progress(clip, 999) == 1.0

    def test_a_transition_must_be_attached_to_a_clip(self) -> None:
        with pytest.raises(NovaInvariantError, match="must name the clip"):
            _transition(clip_id="")

    def test_a_transition_needs_a_duration(self) -> None:
        with pytest.raises(NovaInvariantError, match="duration_frames"):
            _transition(duration_frames=0)

    def test_a_transition_survives_json(self) -> None:
        transition = _transition(
            kind=TransitionKind.WIPE,
            duration_frames=18,
            alignment=TransitionAlignment.START,
            params={"angle": 45},
        )
        assert Transition.from_wire(_round_trip(transition.to_wire())) == transition

    def test_a_wire_transition_rejects_unknown_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            Transition.from_wire(dict(_transition().to_wire(), extra=1))


class TestTrack:
    def test_a_new_track_is_empty(self) -> None:
        track = _track()
        assert track.is_empty
        assert track.duration_frames == 0

    def test_a_track_is_as_long_as_its_last_clip(self) -> None:
        track = _track().with_clip(_clip("a", "x", start_frame=90))
        assert track.duration_frames == 190

    def test_a_track_must_have_an_id(self) -> None:
        with pytest.raises(NovaInvariantError, match="track_id"):
            _track(track_id="")

    def test_a_clip_cannot_appear_twice_on_one_track(self) -> None:
        with pytest.raises(NovaInvariantError, match="appears twice"):
            Track(track_id="v1", clips=(_clip("a", "x"), _clip("a", "y")))

    def test_a_transition_must_be_attached_to_a_clip_on_the_track(self) -> None:
        with pytest.raises(NovaInvariantError, match="not on this track"):
            Track(track_id="v1", clips=(_clip("a", "x"),), transitions=(_transition(clip_id="z"),))

    def test_adding_a_clip_keeps_position_order(self) -> None:
        track = _track().with_clip(_clip("b", "x", start_frame=50))
        track = track.with_clip(_clip("a", "x", start_frame=10))
        assert [clip.clip_id for clip in track.clips] == ["a", "b"]

    def test_adding_a_clip_twice_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="already on this track"):
            _track().with_clip(_clip("a", "x")).with_clip(_clip("a", "y"))

    def test_replacing_a_clip_keeps_its_position(self) -> None:
        track = _track().with_clip(_clip("a", "x", start_frame=10, out_frame=60))
        moved = track.replaced(_clip("a", "x", start_frame=90, out_frame=140))
        assert [clip.start_frame for clip in moved.clips] == [90]
        assert moved.clip_count == 1

    def test_replacing_a_clip_that_is_not_there_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="cannot be replaced"):
            _track().replaced(_clip("a", "x"))

    def test_removing_a_clip_takes_its_transitions_with_it(self) -> None:
        """A transition with no clip is a renderer crash waiting to happen."""
        track = _track().with_clip(_clip("a", "x")).with_transition(_transition(clip_id="a"))
        assert track.without_clip("a").transitions == ()

    def test_a_clip_can_be_found_by_id(self) -> None:
        track = _track().with_clip(_clip("a", "x"))
        assert track.clip("a") is not None
        assert track.clip("z") is None

    def test_a_clip_can_be_found_by_frame(self) -> None:
        track = _track().with_clip(_clip("a", "x", start_frame=10, out_frame=60))
        assert track.clip_at(30) is not None
        assert track.clip_at(5) is None

    def test_where_clips_overlap_the_later_one_wins(self) -> None:
        """The later clip is the one a transition is revealing."""
        track = _track().with_clip(_clip("a", "x", start_frame=0, out_frame=60))
        track = track.with_clip(_clip("b", "x", start_frame=50, out_frame=110))
        assert track.clip_at(55) is not None
        assert track.clip_at(55).clip_id == "b"

    def test_clips_in_a_range(self) -> None:
        track = _track().with_clip(_clip("a", "x", start_frame=0, out_frame=60))
        track = track.with_clip(_clip("b", "x", start_frame=100, out_frame=160))
        assert [clip.clip_id for clip in track.clips_between(50, 120)] == ["a", "b"]
        assert track.clips_between(60, 100) == ()

    def test_overlaps_are_found_and_reported(self) -> None:
        track = _track().with_clip(_clip("a", "x", start_frame=0, out_frame=60))
        track = track.with_clip(_clip("b", "x", start_frame=50, out_frame=110))
        assert [
            clip.clip_id
            for clip in track.overlapping(_clip("c", "x", start_frame=55, out_frame=155))
        ] == ["a", "b"]

    def test_a_clip_does_not_overlap_itself(self) -> None:
        clip = _clip("a", "x", start_frame=0, out_frame=60)
        track = _track().with_clip(clip)
        assert track.overlapping(clip) == ()

    def test_a_free_span_can_take_a_clip(self) -> None:
        track = _track().with_clip(_clip("a", "x", start_frame=0, out_frame=60))
        assert track.is_free(60, 120)
        assert not track.is_free(30, 90)
        assert track.is_free(30, 90, ignore_clip_id="a")

    def test_a_reversed_range_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="must not precede"):
            _track().clips_between(100, 50)

    def test_adding_a_transition_replaces_one_on_the_same_edge(self) -> None:
        track = _track().with_clip(_clip("a", "x"))
        track = track.with_transition(_transition("t1", clip_id="a", duration_frames=10))
        track = track.with_transition(_transition("t2", clip_id="a", duration_frames=30))
        assert [t.transition_id for t in track.transitions] == ["t2"]

    def test_a_transition_on_each_end_coexists(self) -> None:
        track = _track().with_clip(_clip("a", "x"))
        track = track.with_transition(_transition("t1", clip_id="a", edge=TransitionEdge.START))
        track = track.with_transition(_transition("t2", clip_id="a", edge=TransitionEdge.END))
        assert len(track.transitions) == 2

    def test_a_transition_can_be_found_by_clip_and_edge(self) -> None:
        track = _track().with_clip(_clip("a", "x"))
        track = track.with_transition(_transition("t1", clip_id="a", edge=TransitionEdge.END))
        assert track.transition_for("a", TransitionEdge.END) is not None
        assert track.transition_for("a", TransitionEdge.START) is None

    def test_a_track_can_be_muted_locked_or_hidden(self) -> None:
        track = _track(muted=True, locked=True, hidden=True)
        assert (track.muted, track.locked, track.hidden) == (True, True, True)

    def test_a_track_survives_json(self) -> None:
        track = _track(
            "v2",
            TrackKind.AUDIO,
            index=1,
            name="Music",
            muted=True,
            clips=(_clip("a", "x"),),
            transitions=(_transition(clip_id="a"),),
        )
        assert Track.from_wire(_round_trip(track.to_wire())) == track

    def test_a_wire_track_rejects_unknown_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            Track.from_wire(dict(_track().to_wire(), extra=1))


class TestMarker:
    def test_a_point_marker_marks_one_frame(self) -> None:
        marker = Marker(marker_id="m1", frame=120)
        assert not marker.is_range
        assert marker.end_frame == 120

    def test_a_range_marker_covers_frames(self) -> None:
        marker = Marker(marker_id="m1", frame=120, duration_frames=60)
        assert marker.is_range
        assert marker.end_frame == 180

    def test_a_marker_needs_an_id_and_a_frame(self) -> None:
        with pytest.raises(NovaInvariantError, match="marker_id"):
            Marker(marker_id="", frame=0)
        with pytest.raises(NovaInvariantError, match="frame"):
            Marker(marker_id="m1", frame=-1)

    def test_a_negative_range_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="duration_frames"):
            Marker(marker_id="m1", frame=0, duration_frames=-1)

    @pytest.mark.parametrize("colour", ["yellow", "#fff", "#gggggg", ""])
    def test_the_colour_must_be_a_hex_triple(self, colour: str) -> None:
        with pytest.raises(NovaInvariantError, match="colour"):
            Marker(marker_id="m1", frame=0, colour=colour)

    def test_a_marker_survives_json(self) -> None:
        marker = Marker(
            marker_id="m1", frame=120, name="Chorus", colour="#00ff00", duration_frames=60
        )
        assert Marker.from_wire(_round_trip(marker.to_wire())) == marker


class TestResolvedFrame:
    def test_an_empty_frame_is_empty(self) -> None:
        frame = ResolvedFrame(frame=0)
        assert frame.is_empty
        assert frame.top is None

    def test_the_last_contribution_is_the_topmost(self) -> None:
        clip = _clip("a", "x")
        track = _track().with_clip(clip)
        frame = ResolvedFrame(
            frame=0,
            contributions=(
                ClipContribution(clip=clip, track=track, source_frame=0),
                ClipContribution(clip=clip, track=track, source_frame=1),
            ),
        )
        assert frame.top is not None
        assert frame.top.source_frame == 1
        assert frame.clip_count == 2

    def test_a_contribution_knows_whether_it_is_transitioning(self) -> None:
        clip = _clip("a", "x", start_frame=100, out_frame=200)
        track = _track().with_clip(clip)
        plain = ClipContribution(clip=clip, track=track, source_frame=0)
        fading = ClipContribution(
            clip=clip,
            track=track,
            source_frame=0,
            transition=_transition(clip_id="a", duration_frames=20),
        )
        assert not plain.is_transitioning
        assert fading.is_transitioning
        assert plain.transition_progress(0) == 1.0
        assert fading.transition_progress(95) == 0.25  # window 90..110


class TestTimeline:
    def test_a_new_timeline_is_empty(self) -> None:
        timeline = Timeline()
        assert timeline.is_empty
        assert timeline.duration_frames == 0
        assert timeline.validate() == ""

    def test_of_assigns_indices_in_display_order(self) -> None:
        timeline = _timeline(_track("v1"), _track("a1", TrackKind.AUDIO))
        assert [track.index for track in timeline.tracks] == [0, 1]

    def test_the_duration_is_the_end_of_the_last_clip(self) -> None:
        timeline = _timeline(_track().with_clip(_clip("a", "x", start_frame=0, out_frame=60)))
        assert timeline.duration_frames == 60

    def test_counts_roll_up_from_the_tracks(self) -> None:
        timeline = _timeline(
            _track().with_clip(_clip("a", "x")).with_clip(_clip("b", "x", start_frame=100)),
            _track("a1", TrackKind.AUDIO),
        )
        assert (timeline.track_count, timeline.clip_count) == (2, 2)

    def test_tracks_can_be_selected_by_what_they_carry(self) -> None:
        timeline = _timeline(
            _track("v1"),
            _track("a1", TrackKind.AUDIO),
            _track("c1", TrackKind.CAPTION),
            _track("o1", TrackKind.OVERLAY),
        )
        assert [t.track_id for t in timeline.video_tracks] == ["v1", "o1"]
        assert [t.track_id for t in timeline.audio_tracks] == ["a1"]
        assert [t.track_id for t in timeline.caption_tracks] == ["c1"]

    def test_two_tracks_may_not_share_an_id(self) -> None:
        with pytest.raises(NovaInvariantError, match="share an id"):
            Timeline(tracks=(_track("v1"), _track("v1", TrackKind.AUDIO)))

    def test_two_markers_may_not_share_an_id(self) -> None:
        with pytest.raises(NovaInvariantError, match="share an id"):
            Timeline(markers=(Marker(marker_id="m", frame=0), Marker(marker_id="m", frame=10)))

    def test_a_clip_may_not_be_on_two_tracks(self) -> None:
        with pytest.raises(NovaInvariantError, match="more than one track"):
            Timeline(
                tracks=(
                    _track("v1").with_clip(_clip("a", "x")),
                    _track("v2").with_clip(_clip("a", "y")),
                )
            )

    def test_a_clip_can_be_found_anywhere(self) -> None:
        timeline = _timeline(_track().with_clip(_clip("a", "x")))
        assert timeline.clip("a") is not None
        assert timeline.clip("z") is None
        assert timeline.track_of("a") is not None
        assert timeline.track_of("z") is None

    def test_resolve_returns_contributions_bottom_first(self) -> None:
        """Stored top-first, painted bottom-first: the last entry is the top."""
        top = _track("v2").with_clip(_clip("top", "x"))
        bottom = _track("v1").with_clip(_clip("bottom", "x"))
        timeline = _timeline(top, bottom)
        resolved = timeline.resolve(0)
        assert [c.clip.clip_id for c in resolved.contributions] == ["bottom", "top"]
        assert resolved.top is not None
        assert resolved.top.clip.clip_id == "top"

    def test_resolve_reports_the_source_frame_to_decode(self) -> None:
        clip = _clip("a", "x", start_frame=100, in_frame=500, out_frame=600)
        timeline = _timeline(_track().with_clip(clip))
        assert timeline.resolve(110).top is not None
        assert timeline.resolve(110).top.source_frame == 510

    def test_resolve_finds_nothing_between_clips(self) -> None:
        timeline = _timeline(_track().with_clip(_clip("a", "x", start_frame=100, out_frame=200)))
        assert timeline.resolve(50).is_empty

    def test_resolve_skips_a_disabled_clip(self) -> None:
        timeline = _timeline(_track().with_clip(_clip("a", "x", enabled=False)))
        assert timeline.resolve(0).is_empty

    def test_resolve_skips_a_hidden_track(self) -> None:
        timeline = _timeline(_track(hidden=True).with_clip(_clip("a", "x")))
        assert timeline.resolve(0).is_empty

    def test_muting_is_a_mix_decision_not_a_picture_one(self) -> None:
        timeline = _timeline(_track(muted=True).with_clip(_clip("a", "x")))
        assert not timeline.resolve(0).is_empty

    def test_an_adjustment_track_carries_no_picture_of_its_own(self) -> None:
        timeline = _timeline(
            _track("adj", TrackKind.ADJUSTMENT).with_clip(_clip("a", "", kind=ClipKind.ADJUSTMENT))
        )
        assert timeline.resolve(0).is_empty

    def test_resolve_attaches_the_transition_in_progress(self) -> None:
        clip = _clip("a", "x", start_frame=100, out_frame=200)
        track = (
            _track()
            .with_clip(clip)
            .with_transition(
                _transition(clip_id="a", edge=TransitionEdge.START, duration_frames=20)
            )
        )
        resolved = _timeline(track).resolve(100)
        assert resolved.top is not None
        assert resolved.top.transition is not None
        assert resolved.top.is_transitioning

    def test_resolve_refuses_a_negative_frame(self) -> None:
        with pytest.raises(NovaInvariantError, match="frame"):
            Timeline().resolve(-1)

    def test_clips_between_spans_every_track(self) -> None:
        timeline = _timeline(
            _track("v1").with_clip(_clip("a", "x", start_frame=0, out_frame=60)),
            _track("a1", TrackKind.AUDIO).with_clip(
                _clip("b", "y", start_frame=100, out_frame=160)
            ),
        )
        assert sorted(c.clip_id for c in timeline.clips_between(0, 200)) == ["a", "b"]

    def test_adding_a_track_puts_it_at_the_bottom(self) -> None:
        timeline = _timeline(_track("v1")).with_track(_track("v2"))
        assert [track.track_id for track in timeline.tracks] == ["v1", "v2"]
        assert [track.index for track in timeline.tracks] == [0, 1]

    def test_adding_a_track_twice_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="already on this timeline"):
            _timeline(_track("v1")).with_track(_track("v1"))

    def test_replacing_a_track_keeps_its_position(self) -> None:
        timeline = _timeline(_track("v1"), _track("v2"))
        renamed = timeline.replaced(_track("v1", name="Interview"))
        assert renamed.track("v1") is not None
        assert renamed.track("v1").name == "Interview"

    def test_replacing_a_track_that_is_not_there_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="cannot be replaced"):
            Timeline().replaced(_track("v1"))

    def test_removing_a_track_closes_the_gap(self) -> None:
        timeline = _timeline(_track("v1"), _track("v2"), _track("v3"))
        pruned = timeline.without_track("v2")
        assert [track.index for track in pruned.tracks] == [0, 1]

    def test_reindexing_follows_the_given_order(self) -> None:
        timeline = _timeline(_track("v1"), _track("v2"))
        flipped = timeline.reindexed(tracks=tuple(reversed(timeline.tracks)))
        assert [track.track_id for track in flipped.tracks] == ["v2", "v1"]
        assert [track.index for track in flipped.tracks] == [0, 1]

    def test_markers_can_be_added_and_replaced(self) -> None:
        timeline = Timeline().with_marker(Marker(marker_id="m1", frame=10, name="first"))
        timeline = timeline.with_marker(Marker(marker_id="m1", frame=20, name="moved"))
        assert len(timeline.markers) == 1
        assert timeline.markers[0].frame == 20

    def test_a_marker_can_be_removed(self) -> None:
        timeline = Timeline().with_marker(Marker(marker_id="m1", frame=10))
        assert timeline.without_marker("m1").markers == ()

    def test_a_timeline_survives_json(self) -> None:
        timeline = _timeline(
            _track()
            .with_clip(_clip("a", "x", start_frame=10))
            .with_transition(_transition(clip_id="a")),
            _track("a1", TrackKind.AUDIO).with_clip(_clip("b", "y")),
            timebase=Timebase.of(30_000, 1001),
        ).with_marker(Marker(marker_id="m1", frame=5))
        assert Timeline.from_wire(_round_trip(timeline.to_wire())) == timeline

    def test_the_timebase_is_stored_as_an_exact_pair(self) -> None:
        timeline = _timeline(_track(), timebase=Timebase.of(30_000, 1001))
        assert timeline.to_wire()["timebase"] == [30_000, 1001]

    def test_a_wire_timeline_rejects_unknown_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            Timeline.from_wire(dict(Timeline().to_wire(), extra=1))

    def test_a_wire_timeline_rejects_a_malformed_timebase(self) -> None:
        with pytest.raises(NovaInvariantError, match="timebase"):
            Timeline.from_wire(dict(Timeline().to_wire(), timebase=29.97))


class TestSnapping:
    def test_a_dragged_edge_snaps_to_a_clip_edge(self) -> None:
        timeline = _timeline(_track().with_clip(_clip("a", "x", start_frame=100, out_frame=200)))
        assert snap_candidates(timeline, 102) == (100,)

    def test_snapping_targets_the_timeline_ends(self) -> None:
        timeline = _timeline(_track().with_clip(_clip("a", "x", start_frame=0, out_frame=60)))
        assert snap_candidates(timeline, 3) == (0,)
        assert snap_candidates(timeline, 57) == (60,)

    def test_snapping_targets_markers(self) -> None:
        timeline = _timeline(_track()).with_marker(Marker(marker_id="m1", frame=42))
        assert snap_candidates(timeline, 44) == (42,)

    def test_a_clip_does_not_snap_to_itself(self) -> None:
        """Otherwise the drag would be pinned where it started."""
        timeline = _timeline(_track().with_clip(_clip("a", "x", start_frame=100, out_frame=200)))
        assert snap_candidates(timeline, 102, ignore_clip_id="a") == ()

    def test_targets_come_out_nearest_first(self) -> None:
        timeline = _timeline(
            _track().with_clip(_clip("a", "x", start_frame=100, out_frame=150))
        ).with_marker(Marker(marker_id="m1", frame=103))
        assert snap_candidates(timeline, 100) == (100, 103)

    def test_the_tolerance_bounds_the_reach(self) -> None:
        timeline = _timeline(_track().with_clip(_placed(0, 60)))
        assert DEFAULT_SNAP_TOLERANCE_FRAMES == 5
        assert snap_candidates(timeline, 61, tolerance_frames=1) == (60,)
        assert snap_candidates(timeline, 30, tolerance_frames=2) == ()

    def test_a_negative_tolerance_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="tolerance_frames"):
            snap_candidates(Timeline(), 0, tolerance_frames=-1)


class TestValidateTimeline:
    def test_a_well_formed_timeline_passes(self) -> None:
        timeline = _timeline(
            _track()
            .with_clip(_clip("a", "x", start_frame=0, out_frame=60))
            .with_clip(_clip("b", "x", start_frame=60, out_frame=120))
        )
        assert validate_timeline(timeline) == ""

    def test_track_indices_must_follow_display_order(self) -> None:
        timeline = Timeline(tracks=(_track("v1"), _track("v2", index=7)))
        assert "must follow display order" in validate_timeline(timeline)

    def test_clips_must_be_in_position_order(self) -> None:
        track = Track(track_id="v1", clips=(_clip("b", "x", start_frame=100), _clip("a", "x")))
        assert "out of position order" in validate_timeline(Timeline(tracks=(track,)))

    def test_an_uncovered_overlap_is_reported(self) -> None:
        """The renderer would otherwise pick an arbitrary winner."""
        track = _track().with_clip(_clip("a", "x", start_frame=0, out_frame=60))
        track = track.with_clip(_clip("b", "x", start_frame=50, out_frame=110))
        message = validate_timeline(Timeline(tracks=(track,)))
        assert "overlapping between frames 50 and 60" in message
        assert "no transition" in message

    def test_a_transition_makes_the_overlap_legal(self) -> None:
        track = _track().with_clip(_clip("a", "x", start_frame=0, out_frame=60))
        track = track.with_clip(_clip("b", "x", start_frame=50, out_frame=110))
        track = track.with_transition(
            _transition(clip_id="b", edge=TransitionEdge.START, duration_frames=20)
        )
        assert validate_timeline(Timeline(tracks=(track,))) == ""

    def test_a_transition_that_does_not_cover_the_whole_overlap_is_not_enough(self) -> None:
        track = _track().with_clip(_clip("a", "x", start_frame=0, out_frame=60))
        track = track.with_clip(_clip("b", "x", start_frame=50, out_frame=110))
        track = track.with_transition(
            _transition(clip_id="b", edge=TransitionEdge.START, duration_frames=4)
        )
        assert "no transition" in validate_timeline(Timeline(tracks=(track,)))

    def test_the_timeline_validates_itself(self) -> None:
        assert Timeline().validate() == ""
