"""L3 — edit geometry: what a structural edit does to a timeline, as pure functions.

Every NLE has the same handful of structural edits — lift, ripple, slip, split —
and the same reason to keep them out of the commands that carry them: **the
geometry is the hard part, the undo bookkeeping is the easy part, and mixing
them is how an edit gets a delta that does not invert.**  So this module is pure
and total: functions from `(timeline, arguments)` to `(timeline, delta)`, with no
context, no store, no clock.  `commands.py` wraps each one with the four
integers needed to put it back.

The invariants that make the delta small:

* **A lift is one clip.**  Removing a clip and leaving a gap changes exactly one
  thing, so the undo delta is the clip itself.
* **A ripple is a clip plus a list of ids.**  Ripple delete closes the gap on
  every *unlocked* track — that is what locking is for — and every clip it moves
  moves by the same number of frames, so the delta is the removed clip (which
  carries the distance) and the ids that travelled.  No snapshots.
* **A slip moves source, not time.**  `in_frame` and `out_frame` shift together,
  `start_frame` does not, so the clip never changes position or length and
  nothing around it moves at all.
* **A split is one clip becoming two at one frame**, with the source consumed by
  the left half computed from the *speed*, because at half speed a 100-frame
  timeline span eats 50 source frames and at double speed it eats 200.

What is deliberately not checked here: **source bounds.**  `Clip` carries the
source range it uses, not the length of the media behind it, so the timeline
cannot know that a slip ran off the end of a file.  Clamping that is the
conform step's job, in `services/render`; this module only refuses the states it
can see (a reversed range, a clip shorter than one frame).
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from fractions import Fraction
from typing import TYPE_CHECKING

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.timeline import MIN_CLIP_FRAMES, Clip

if TYPE_CHECKING:
    from nova_studio.domain.timeline import Timeline, Track

__all__ = [
    "Lifted",
    "Rippled",
    "lift_clip",
    "reinsert_clip",
    "ripple_delete",
    "slip_clip",
    "source_frames_for",
    "split_clip",
    "undo_ripple",
]


@dataclass(frozen=True, slots=True, kw_only=True)
class Lifted:
    """What lifting one clip changed."""

    track_id: str
    clip: Clip


@dataclass(frozen=True, slots=True, kw_only=True)
class Rippled:
    """What a ripple delete changed.

    The distance travelled is not stored: it is :attr:`removed`'s duration, and
    storing it twice is how two numbers drift apart.
    """

    track_id: str
    #: The clip that was removed, carrying the size of the gap it left.
    removed: Clip
    #: ``(track_id, clip_id)`` for every clip pulled left, oldest track first.
    moved: tuple[tuple[str, str], ...] = ()

    @property
    def shift_frames(self) -> int:
        """How far everything after the cut travelled."""
        return self.removed.duration_frames

    @property
    def moved_count(self) -> int:
        """How many clips moved — the sentence a ripple reports to the user."""
        return len(self.moved)


# -- lifting ------------------------------------------------------------------


def lift_clip(track: Track, clip_id: str) -> tuple[Track, Lifted]:
    """Remove a clip and leave the gap behind.

    Raises:
        NovaInvariantError: If the clip is not on this track.
    """
    clip = _clip(track, clip_id)
    return track.without_clip(clip_id), Lifted(track_id=track.track_id, clip=clip)


def reinsert_clip(track: Track, delta: Lifted) -> Track:
    """Put a lifted clip back.  The inverse of :func:`lift_clip`.

    The track must have the room: nothing here moves out of the way, because
    "the gap is still there" is exactly the promise a lift makes.
    """
    return track.with_clip(delta.clip)


# -- ripple -------------------------------------------------------------------


def ripple_delete(timeline: Timeline, track_id: str, clip_id: str) -> tuple[Timeline, Rippled]:
    """Delete a clip and close the gap on every unlocked track.

    "After the cut" means *starting at or after the removed clip's end*, so a
    clip that overlaps it — which is legal under a transition — does not move.
    A locked track keeps its timing entirely, which is the whole point of
    locking: a finished mix must survive an edit on the picture track.

    Raises:
        NovaInvariantError: If the track or the clip is not on this timeline.
    """
    track = timeline.track(track_id)
    if track is None:
        raise NovaInvariantError(f"track {track_id!r} is not on this timeline")
    removed = _clip(track, clip_id)
    cut = removed.end_frame
    distance = removed.duration_frames

    moved: list[tuple[str, str]] = []
    tracks: list[Track] = []
    for existing in timeline.tracks:
        if existing.locked:
            tracks.append(existing)
            continue
        travellers = tuple(clip for clip in existing.clips if clip.start_frame >= cut)
        if not travellers:
            tracks.append(existing)
            continue
        moved.extend((existing.track_id, clip.clip_id) for clip in travellers)
        tracks.append(
            replace(
                existing,
                clips=tuple(
                    clip.shifted(-distance) if clip.start_frame >= cut else clip
                    for clip in existing.clips
                ),
            )
        )

    next_timeline = _with_tracks(timeline, tracks).replaced(
        next(candidate for candidate in tracks if candidate.track_id == track_id).without_clip(
            clip_id
        )
    )
    return next_timeline, Rippled(track_id=track_id, removed=removed, moved=tuple(moved))


def undo_ripple(timeline: Timeline, delta: Rippled) -> Timeline:
    """Reopen the gap and put the clip back.  The inverse of :func:`ripple_delete`.

    The gap is reopened *before* the clip is reinserted, so the two can never
    fight over the same frames: every clip that travelled goes back to where it
    was, and only then does the removed clip reclaim its own span.
    """
    distance = delta.shift_frames
    by_track: dict[str, tuple[str, ...]] = {}
    for track_id, clip_id in delta.moved:
        by_track[track_id] = (*by_track.get(track_id, ()), clip_id)

    tracks: list[Track] = []
    for existing in timeline.tracks:
        travellers = by_track.get(existing.track_id, ())
        if not travellers:
            tracks.append(existing)
            continue
        tracks.append(
            replace(
                existing,
                clips=tuple(
                    clip.shifted(distance) if clip.clip_id in travellers else clip
                    for clip in existing.clips
                ),
            )
        )

    next_timeline = _with_tracks(timeline, tracks)
    track = next_timeline.track(delta.track_id)
    if track is None:  # pragma: no cover - guarded by ripple_delete
        raise NovaInvariantError(f"track {delta.track_id!r} is not on this timeline")
    return next_timeline.replaced(track.with_clip(delta.removed))


# -- splitting and slipping ---------------------------------------------------


def split_clip(clip: Clip, at_frame: int, new_clip_id: str) -> tuple[Clip, Clip]:
    """Cut one clip into two at a timeline frame.

    The left half keeps the id, the start and the speed; the right half takes
    ``new_clip_id`` and starts at ``at_frame``.  Speed decides how much source
    the left half eats — see :func:`source_frames_for`.

    Raises:
        NovaInvariantError: If ``at_frame`` is not strictly inside the clip, or
            if the cut would leave a half with no frames in it.
    """
    if not clip.start_frame < at_frame < clip.end_frame:
        raise NovaInvariantError(
            f"frame {at_frame} is not inside clip {clip.clip_id!r} "
            f"[{clip.start_frame}, {clip.end_frame})"
        )
    if not new_clip_id:
        raise NovaInvariantError("the right half of a split needs an id")
    if new_clip_id == clip.clip_id:
        raise NovaInvariantError("the right half of a split needs its own id")

    consumed = source_frames_for(clip, at_frame - clip.start_frame)
    if consumed < MIN_CLIP_FRAMES:
        raise NovaInvariantError(
            f"splitting clip {clip.clip_id!r} at frame {at_frame} leaves the left half empty"
        )
    if clip.source_frames - consumed < MIN_CLIP_FRAMES:
        raise NovaInvariantError(
            f"splitting clip {clip.clip_id!r} at frame {at_frame} leaves the right half empty"
        )

    if clip.speed >= 0:
        left = replace(clip, out_frame=clip.in_frame + consumed)
        right = replace(
            clip, clip_id=new_clip_id, in_frame=clip.in_frame + consumed, start_frame=at_frame
        )
    else:
        # Reversed: the clip plays from the top of the source range downwards,
        # so the *earlier* half is the one nearer out_frame.
        left = replace(clip, in_frame=clip.out_frame - consumed)
        right = replace(
            clip, clip_id=new_clip_id, out_frame=clip.out_frame - consumed, start_frame=at_frame
        )
    return left, right


def slip_clip(clip: Clip, delta_frames: int) -> Clip:
    """Move the source window without moving the clip.

    ``in_frame`` and ``out_frame`` shift together, so the clip keeps its
    position, its length and its neighbours' timing — which is what makes a slip
    the safest way to fix a line reading.

    Raises:
        NovaInvariantError: If the window would start before the source does.
            The *upper* bound cannot be checked here: the timeline does not know
            how long the media is (see the module docstring).
    """
    in_frame = clip.in_frame + delta_frames
    if in_frame < 0:
        raise NovaInvariantError(
            f"slipping clip {clip.clip_id!r} by {delta_frames} frames would start before frame 0"
        )
    return replace(clip, in_frame=in_frame, out_frame=clip.out_frame + delta_frames)


def source_frames_for(clip: Clip, timeline_frames: int) -> int:
    """How many source frames a span of timeline frames consumes.

    At half speed a 100-frame timeline span eats 50 source frames; at double
    speed it eats 200.  Rounded once, from the exact rational speed, so a trim
    and a split agree on where the boundary is (ADR-0006).
    """
    return round(abs(Fraction(clip.speed)) * timeline_frames)


# -- internals ----------------------------------------------------------------


def _clip(track: Track, clip_id: str) -> Clip:
    clip = track.clip(clip_id)
    if clip is None:
        raise NovaInvariantError(f"clip {clip_id!r} is not on track {track.track_id!r}")
    return clip


def _with_tracks(timeline: Timeline, tracks: list[Track]) -> Timeline:
    """Rebuild a timeline from a parallel list of tracks, preserving order."""
    return replace(timeline, tracks=tuple(tracks))
