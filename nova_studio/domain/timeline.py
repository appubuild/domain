"""L2 — timeline: the edit decision list.

Everything the viewer sees is decided here: which source, which frames, at what
speed, on which track, and what happens where two clips meet.  This module is
the *document* of those decisions — immutable, validated at construction, and
pure, so that the compositor can be handed ``(timeline, frame)`` and return a
frame without touching anything else.

Frame accuracy, not seconds
---------------------------
Positions and durations are **integers in frames** at the timeline's
:class:`~nova_studio.core.temporal.Timebase` (ADR-0006).  Nothing here divides
frame counts by a floating-point rate and accumulates the result; a clip's
duration is computed once from its source length and its speed and then stored
as a whole number of frames.  Seconds appear only at the edges — in timecode
display and in the audio domain — never as the unit of an edit decision.

Order: top-first storage, bottom-first rendering
------------------------------------------------
``Timeline.tracks`` is stored **top first**, because that is how an editor
displays them and how a user names them ("V2 is above V1").  Compositing is the
opposite: :meth:`Timeline.resolve` returns contributions **bottom first**, in
painter's-algorithm order, so the last entry is the topmost clip.  Storing in
display order and rendering in paint order is a common source of inverted
layering, so both are stated here and pinned by tests.

Overlaps are allowed, but only under a transition
-------------------------------------------------
Two clips on one track may overlap — that is how an A/B dissolve is built — but
an overlap that no transition covers is a bug, not a feature: the renderer would
draw one of them arbitrarily.  :func:`validate_timeline` reports it, and the
editor refuses to save a project in that state.

Deliberately not here
---------------------
* **Mutation policy.**  Moving, trimming, rippling and slipping are
  :class:`~nova_studio.core.commands.Command` s in ``services`` (ADR-0008);
  this module offers the pure ``with_*`` builders those commands compose.
* **Effects, fades and colour.**  Those are an ``EffectChain`` on a clip and a
  grade on the timeline (``domain/effects.py``); a clip holds identity and
  timing, not looks.
* **Proxies.**  A clip references an asset id; resolving that to original,
  proxy or thumbnail is a policy the media layer owns.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Final

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.temporal import (
    DEFAULT_TIMEBASE,
    Rational,
    Timebase,
    frames_to_seconds,
)
from nova_studio.domain._wire import (
    reject_unknown_fields as _reject_unknown_fields,
    wire_int as _wire_int,
    wire_mappings as _wire_mappings,
    wire_str as _wire_str,
)

__all__ = [
    "DEFAULT_SNAP_TOLERANCE_FRAMES",
    "DEFAULT_TRANSITION_FRAMES",
    "MARKER_COLOUR_PATTERN",
    "MIN_CLIP_FRAMES",
    "UNIT_SPEED",
    "Clip",
    "ClipContribution",
    "ClipKind",
    "Marker",
    "ResolvedFrame",
    "Timeline",
    "Track",
    "TrackKind",
    "Transition",
    "TransitionAlignment",
    "TransitionEdge",
    "TransitionKind",
    "snap_candidates",
    "validate_timeline",
]

#: A clip is at least one frame long.  A zero-frame clip cannot be seen, cannot
#: be trimmed and makes every overlap test ambiguous, so it is refused.
MIN_CLIP_FRAMES: Final[int] = 1

#: A dissolve of about half a second at 25 fps — long enough to read as a
#: transition rather than a glitch.
DEFAULT_TRANSITION_FRAMES: Final[int] = 12

#: How far a dragged edge reaches for a snap target, in frames.  The UI converts
#: pixels to frames; five frames is a little over a fifth of a second at 24 fps,
#: which is where snapping stops feeling magnetic and starts feeling wrong.
DEFAULT_SNAP_TOLERANCE_FRAMES: Final[int] = 5

#: Markers are coloured by hex, because that is what the frontend hands back and
#: what every colour picker produces.
MARKER_COLOUR_PATTERN: Final[re.Pattern[str]] = re.compile(r"^#[0-9a-fA-F]{6}$")


class TrackKind(StrEnum):
    """What a track carries, which decides how it is composited and mixed."""

    #: Pictures.  Higher tracks paint over lower ones.
    VIDEO = "video"
    #: Sound.  Tracks are summed, never painted.
    AUDIO = "audio"
    #: Caption clips, committed from a
    #: :class:`~nova_studio.domain.captions.CaptionDocument` (ADR-0009 §8).
    CAPTION = "caption"
    #: Titles, lower thirds, motion graphics.
    OVERLAY = "overlay"
    #: Carries no picture of its own: its effects apply to everything below.
    ADJUSTMENT = "adjustment"


class ClipKind(StrEnum):
    """What a clip *is*, which decides what a decoder or generator is asked for."""

    #: Moving picture with or without sound.
    VIDEO = "video"
    #: Sound only.
    AUDIO = "audio"
    #: A still, held for its duration.
    IMAGE = "image"
    #: Generated text.
    TEXT = "text"
    #: A caption cue committed to the timeline (ADR-0009 §8).
    CAPTION = "caption"
    #: A generated colour field.
    SOLID = "solid"
    #: No picture of its own; an effect carrier.
    ADJUSTMENT = "adjustment"


class TransitionKind(StrEnum):
    """The named transitions the picker offers.

    They are *names*, not code paths: the transition stage renders them from the
    same interpolation machinery, and a plugin contributes a new one by
    registering a name and an evaluator (ADR-0009 §6's principle applied here).
    """

    CROSS_DISSOLVE = "cross-dissolve"
    DIP_TO_BLACK = "dip-to-black"
    DIP_TO_WHITE = "dip-to-white"
    WIPE = "wipe"
    SLIDE = "slide"
    PUSH = "push"
    ZOOM = "zoom"
    CUSTOM = "custom"


class TransitionEdge(StrEnum):
    """Which end of a clip the transition sits on."""

    #: The transition begins at the clip's in-point, going back over the
    #: previous clip.
    START = "start"
    #: The transition begins at the clip's out-point, going forward over the
    #: next clip.
    END = "end"


class TransitionAlignment(StrEnum):
    """How the transition's duration straddles the cut."""

    #: Half on each side — the default, and what "centred on cut" means.
    CENTER = "center"
    #: Entirely after the cut.
    START = "start"
    #: Entirely before the cut.
    END = "end"


#: Kinds of clip that are generated rather than read from an asset, and so need
#: no asset id.
_GENERATED_CLIP_KINDS: Final[frozenset[ClipKind]] = frozenset(
    {ClipKind.SOLID, ClipKind.ADJUSTMENT, ClipKind.TEXT}
)

#: Playing at the rate it was recorded at.
UNIT_SPEED: Final[Rational] = Rational(1)


@dataclass(frozen=True, slots=True, kw_only=True)
class Clip:
    """One clip: a slice of one source, placed at one position, at one speed.

    ``in_frame``/``out_frame`` are source coordinates and ``out_frame`` is
    exclusive, matching how containers count frames; ``start_frame`` is a
    timeline coordinate.  Keeping the two spaces separate is what lets a clip be
    trimmed from either end without arithmetic on the other.
    """

    clip_id: str
    asset_id: str
    kind: ClipKind = ClipKind.VIDEO
    #: Position on the timeline, in frames.
    start_frame: int = 0
    #: First source frame used, inclusive.
    in_frame: int = 0
    #: Last source frame used, **exclusive**.
    out_frame: int = MIN_CLIP_FRAMES
    #: Playback rate as an exact rational: ``2`` is double speed, ``-1`` is
    #: reverse.  A float would make two clips of the same nominal speed drift
    #: apart over a long timeline (ADR-0006).
    speed: Rational = UNIT_SPEED
    #: A disabled clip contributes nothing, but stays put for the user to
    #: re-enable — the NLE equivalent of commenting out a line.
    enabled: bool = True
    name: str = ""

    def __post_init__(self) -> None:
        if not self.clip_id:
            raise NovaInvariantError("clip_id must not be empty")
        if not self.asset_id and self.kind not in _GENERATED_CLIP_KINDS:
            raise NovaInvariantError(
                f"a {self.kind} clip must reference an asset, got an empty asset_id"
            )
        if self.in_frame < 0:
            raise NovaInvariantError(f"in_frame must not be negative, got {self.in_frame}")
        if self.out_frame <= self.in_frame:
            raise NovaInvariantError(
                f"out_frame ({self.out_frame}) must be after in_frame ({self.in_frame})"
            )
        if self.start_frame < 0:
            raise NovaInvariantError(f"start_frame must not be negative, got {self.start_frame}")
        if self.speed == 0:
            raise NovaInvariantError("speed must not be zero")

    @classmethod
    def of(
        cls,
        clip_id: str,
        asset_id: str,
        *,
        start_frame: int = 0,
        in_frame: int = 0,
        source_frames: int = MIN_CLIP_FRAMES,
        kind: ClipKind = ClipKind.VIDEO,
        speed: Rational = UNIT_SPEED,
        enabled: bool = True,
        name: str = "",
    ) -> Clip:
        """Build a clip from a source *length* rather than an out-point.

        The common case: "take 100 frames of this asset and put them there".
        """
        return cls(
            clip_id=clip_id,
            asset_id=asset_id,
            kind=kind,
            start_frame=start_frame,
            in_frame=in_frame,
            out_frame=in_frame + source_frames,
            speed=speed,
            enabled=enabled,
            name=name,
        )

    @property
    def source_frames(self) -> int:
        """How many source frames the clip uses."""
        return self.out_frame - self.in_frame

    @property
    def duration_frames(self) -> int:
        """How many timeline frames the clip occupies.

        Rounded once, from the exact rational speed, and never below one: a
        clip that rounds to zero frames would be invisible but would still
        answer hit-tests, which is the worst of both.
        """
        return max(MIN_CLIP_FRAMES, round(Rational(self.source_frames) / abs(self.speed)))

    @property
    def end_frame(self) -> int:
        """The first timeline frame *after* the clip."""
        return self.start_frame + self.duration_frames

    @property
    def is_reversed(self) -> bool:
        """Whether the clip plays backwards."""
        return self.speed < 0

    @property
    def is_generated(self) -> bool:
        """Whether the clip is generated rather than decoded from an asset."""
        return self.kind in _GENERATED_CLIP_KINDS

    def contains(self, frame: int) -> bool:
        """Whether the clip is showing at ``frame``."""
        return self.start_frame <= frame < self.end_frame

    def source_frame_at(self, frame: int) -> int:
        """The source frame shown at timeline ``frame``, clamped to the clip.

        Clamping rather than raising is deliberate: the compositor asks this
        during a transition, when it is legitimately holding the last frame of a
        clip that has ended.
        """
        offset = frame - self.start_frame
        if self.speed >= 0:
            source = self.in_frame + round(offset * abs(self.speed))
        else:
            source = self.out_frame - 1 - round(offset * abs(self.speed))
        return min(max(source, self.in_frame), self.out_frame - 1)

    def timeline_frame_for_source(self, source_frame: int) -> int:
        """The inverse of :meth:`source_frame_at`: where a source frame lands."""
        clamped = min(max(source_frame, self.in_frame), self.out_frame - 1)
        if self.speed >= 0:
            offset = round(Rational(clamped - self.in_frame) / abs(self.speed))
        else:
            offset = round(Rational(self.out_frame - 1 - clamped) / abs(self.speed))
        return self.start_frame + offset

    def duration_seconds(self, timebase: Timebase) -> float:
        """How long the clip is, in seconds.  For display and audio only."""
        return frames_to_seconds(self.duration_frames, timebase)

    def with_start(self, start_frame: int) -> Clip:
        """The same clip, moved to a new position."""
        return replace(self, start_frame=max(0, start_frame))

    def shifted(self, delta_frames: int) -> Clip:
        """The same clip, moved by ``delta_frames``."""
        return self.with_start(self.start_frame + delta_frames)

    def trimmed(self, *, in_frame: int | None = None, out_frame: int | None = None) -> Clip:
        """The same clip, with one or both source ends moved."""
        return replace(
            self,
            in_frame=self.in_frame if in_frame is None else in_frame,
            out_frame=self.out_frame if out_frame is None else out_frame,
        )

    def to_wire(self) -> dict[str, object]:
        """A JSON-ready mapping."""
        return {
            "clip_id": self.clip_id,
            "asset_id": self.asset_id,
            "kind": self.kind.value,
            "start_frame": self.start_frame,
            "in_frame": self.in_frame,
            "out_frame": self.out_frame,
            "speed": f"{self.speed.numerator}/{self.speed.denominator}",
            "enabled": self.enabled,
            "name": self.name,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> Clip:
        """Rebuild from :meth:`to_wire`, rejecting unknown fields."""
        _reject_unknown_fields(data, _CLIP_FIELDS)
        return cls(
            clip_id=_wire_str(data, "clip_id"),
            asset_id=_wire_str(data, "asset_id"),
            kind=ClipKind(_wire_str(data, "kind")),
            start_frame=_wire_int(data, "start_frame"),
            in_frame=_wire_int(data, "in_frame"),
            out_frame=_wire_int(data, "out_frame"),
            speed=Rational(_wire_str(data, "speed")),
            enabled=bool(data["enabled"]),
            name=_wire_str(data, "name"),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class Transition:
    """What happens at one end of one clip.

    Attached to a clip and an edge rather than to a pair of clips, because that
    is how editors behave: delete the clip and its transitions go with it, and
    trimming a clip's end drags the transition's cut with it.
    """

    transition_id: str
    clip_id: str
    edge: TransitionEdge = TransitionEdge.START
    kind: TransitionKind = TransitionKind.CROSS_DISSOLVE
    duration_frames: int = DEFAULT_TRANSITION_FRAMES
    alignment: TransitionAlignment = TransitionAlignment.CENTER
    #: Parameters for the transition evaluator, for a plugin-contributed kind.
    params: Mapping[str, object] | None = None

    def __post_init__(self) -> None:
        if not self.transition_id:
            raise NovaInvariantError("transition_id must not be empty")
        if not self.clip_id:
            raise NovaInvariantError("transition_id must name the clip it is attached to")
        if self.duration_frames < 1:
            raise NovaInvariantError(
                f"duration_frames must be at least 1, got {self.duration_frames}"
            )

    def window(self, clip: Clip) -> tuple[int, int]:
        """The ``[start, end)`` frame range the transition covers.

        The window hangs off the clip's edge, and :attr:`alignment` says how:
        centred on the cut, entirely after it, or entirely before it.
        """
        cut = clip.start_frame if self.edge is TransitionEdge.START else clip.end_frame
        if self.alignment is TransitionAlignment.CENTER:
            start = cut - self.duration_frames // 2
        elif self.alignment is TransitionAlignment.END:
            start = cut - self.duration_frames
        else:
            start = cut
        return (start, start + self.duration_frames)

    def covers(self, clip: Clip, frame: int) -> bool:
        """Whether the transition is in progress at ``frame``."""
        start, end = self.window(clip)
        return start <= frame < end

    def progress(self, clip: Clip, frame: int) -> float:
        """How far through the transition ``frame`` is, ``0.0``–``1.0``."""
        start, end = self.window(clip)
        if end <= start:
            return 1.0
        return min(1.0, max(0.0, (frame - start) / (end - start)))

    def to_wire(self) -> dict[str, object]:
        """A JSON-ready mapping."""
        return {
            "transition_id": self.transition_id,
            "clip_id": self.clip_id,
            "edge": self.edge.value,
            "kind": self.kind.value,
            "duration_frames": self.duration_frames,
            "alignment": self.alignment.value,
            "params": dict(self.params) if self.params else None,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> Transition:
        """Rebuild from :meth:`to_wire`, rejecting unknown fields."""
        _reject_unknown_fields(data, _TRANSITION_FIELDS)
        params = data["params"]
        if params is not None and not isinstance(params, Mapping):
            raise NovaInvariantError(
                f"'params' must be a mapping or null, got {type(params).__name__}"
            )
        return cls(
            transition_id=_wire_str(data, "transition_id"),
            clip_id=_wire_str(data, "clip_id"),
            edge=TransitionEdge(_wire_str(data, "edge")),
            kind=TransitionKind(_wire_str(data, "kind")),
            duration_frames=_wire_int(data, "duration_frames"),
            alignment=TransitionAlignment(_wire_str(data, "alignment")),
            params=dict(params) if params is not None else None,
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class Track:
    """One lane of the timeline.

    Storage order is display order: index ``0`` is the topmost track.  Clips are
    kept sorted by position, and a track is what owns the rule that two clips
    may not occupy the same frames without a transition between them.
    """

    track_id: str
    kind: TrackKind = TrackKind.VIDEO
    index: int = 0
    name: str = ""
    #: No picture and no sound, but still selected, moved and trimmed.
    muted: bool = False
    #: Immune to editing until unlocked — the guard against wrecking a finished
    #: mix with one drag.
    locked: bool = False
    #: Not rendered.  Unlike a disabled clip, a hidden track keeps its timing.
    hidden: bool = False
    clips: tuple[Clip, ...] = ()
    transitions: tuple[Transition, ...] = ()

    def __post_init__(self) -> None:
        if not self.track_id:
            raise NovaInvariantError("track_id must not be empty")
        seen: set[str] = set()
        for clip in self.clips:
            if clip.clip_id in seen:
                raise NovaInvariantError(f"clip {clip.clip_id!r} appears twice on one track")
            seen.add(clip.clip_id)
        known = set(seen)
        for transition in self.transitions:
            if transition.clip_id not in known:
                raise NovaInvariantError(
                    f"transition {transition.transition_id!r} is attached to "
                    f"{transition.clip_id!r}, which is not on this track"
                )

    @property
    def is_empty(self) -> bool:
        """Whether the track holds anything."""
        return not self.clips

    @property
    def duration_frames(self) -> int:
        """The end of the last clip, or ``0`` for an empty track."""
        return max((clip.end_frame for clip in self.clips), default=0)

    @property
    def clip_count(self) -> int:
        """How many clips the track holds."""
        return len(self.clips)

    def clip(self, clip_id: str) -> Clip | None:
        """The clip with this id, or ``None``."""
        for clip in self.clips:
            if clip.clip_id == clip_id:
                return clip
        return None

    def clip_at(self, frame: int) -> Clip | None:
        """The clip showing at ``frame``.

        Where two clips overlap — which is legal only under a transition — the
        later one wins, because it is the one the transition is revealing.
        """
        found: Clip | None = None
        for clip in self.clips:
            if clip.contains(frame):
                found = clip
        return found

    def clips_between(self, start_frame: int, end_frame: int) -> tuple[Clip, ...]:
        """Every clip overlapping ``[start_frame, end_frame)``, in position order."""
        _check_range(start_frame, end_frame)
        return tuple(
            clip
            for clip in self.clips
            if clip.start_frame < end_frame and clip.end_frame > start_frame
        )

    def overlapping(self, clip: Clip, *, ignore_clip_id: str | None = None) -> tuple[Clip, ...]:
        """Clips that share frames with ``clip``.

        The clip itself is always excluded; ``ignore_clip_id`` ignores one other
        as well, which is how a move is validated against the track the clip
        already sits on.
        """
        ignored = {clip.clip_id} if ignore_clip_id is None else {clip.clip_id, ignore_clip_id}
        return tuple(
            other
            for other in self.clips
            if other.clip_id not in ignored
            and other.start_frame < clip.end_frame
            and other.end_frame > clip.start_frame
        )

    def is_free(
        self,
        start_frame: int,
        end_frame: int,
        *,
        ignore_clip_id: str | None = None,
    ) -> bool:
        """Whether a clip could occupy ``[start_frame, end_frame)`` unopposed."""
        _check_range(start_frame, end_frame)
        return not any(
            clip.clip_id != ignore_clip_id
            and clip.start_frame < end_frame
            and clip.end_frame > start_frame
            for clip in self.clips
        )

    def transition_for(self, clip_id: str, edge: TransitionEdge) -> Transition | None:
        """The transition on one end of one clip, if there is one."""
        for transition in self.transitions:
            if transition.clip_id == clip_id and transition.edge is edge:
                return transition
        return None

    def with_clip(self, clip: Clip) -> Track:
        """Add a clip, keeping the track sorted by position."""
        if any(existing.clip_id == clip.clip_id for existing in self.clips):
            raise NovaInvariantError(f"clip {clip.clip_id!r} is already on this track")
        ordered = sorted((*self.clips, clip), key=lambda item: (item.start_frame, item.clip_id))
        return replace(self, clips=tuple(ordered))

    def replaced(self, clip: Clip) -> Track:
        """Replace the clip with this id, keeping position order."""
        if not any(existing.clip_id == clip.clip_id for existing in self.clips):
            raise NovaInvariantError(
                f"clip {clip.clip_id!r} is not on this track, so it cannot be replaced"
            )
        ordered = sorted(
            (clip if existing.clip_id == clip.clip_id else existing for existing in self.clips),
            key=lambda item: (item.start_frame, item.clip_id),
        )
        return replace(self, clips=tuple(ordered))

    def without_clip(self, clip_id: str) -> Track:
        """Remove a clip — and the transitions attached to it, since a
        transition with no clip is a renderer crash waiting to happen."""
        return replace(
            self,
            clips=tuple(clip for clip in self.clips if clip.clip_id != clip_id),
            transitions=tuple(
                transition for transition in self.transitions if transition.clip_id != clip_id
            ),
        )

    def with_transition(self, transition: Transition) -> Track:
        """Add a transition, replacing any on the same clip and edge."""
        if not any(clip.clip_id == transition.clip_id for clip in self.clips):
            raise NovaInvariantError(
                f"transition {transition.transition_id!r} is attached to "
                f"{transition.clip_id!r}, which is not on this track"
            )
        kept = tuple(
            existing
            for existing in self.transitions
            if not (existing.clip_id == transition.clip_id and existing.edge is transition.edge)
        )
        return replace(self, transitions=(*kept, transition))

    def to_wire(self) -> dict[str, object]:
        """A JSON-ready mapping."""
        return {
            "track_id": self.track_id,
            "kind": self.kind.value,
            "index": self.index,
            "name": self.name,
            "muted": self.muted,
            "locked": self.locked,
            "hidden": self.hidden,
            "clips": [clip.to_wire() for clip in self.clips],
            "transitions": [transition.to_wire() for transition in self.transitions],
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> Track:
        """Rebuild from :meth:`to_wire`, rejecting unknown fields."""
        _reject_unknown_fields(data, _TRACK_FIELDS)
        clips = _wire_mappings(data, "clips")
        transitions = _wire_mappings(data, "transitions")
        return cls(
            track_id=_wire_str(data, "track_id"),
            kind=TrackKind(_wire_str(data, "kind")),
            index=_wire_int(data, "index"),
            name=_wire_str(data, "name"),
            muted=bool(data["muted"]),
            locked=bool(data["locked"]),
            hidden=bool(data["hidden"]),
            clips=tuple(Clip.from_wire(entry) for entry in clips),
            transitions=tuple(Transition.from_wire(entry) for entry in transitions),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class Marker:
    """A named point or range on the timeline: a chapter, a note, a cue."""

    marker_id: str
    frame: int
    name: str = ""
    colour: str = "#ffcc00"
    #: ``0`` for a point marker; longer for a range such as a chapter.
    duration_frames: int = 0

    def __post_init__(self) -> None:
        if not self.marker_id:
            raise NovaInvariantError("marker_id must not be empty")
        if self.frame < 0:
            raise NovaInvariantError(f"frame must not be negative, got {self.frame}")
        if self.duration_frames < 0:
            raise NovaInvariantError(
                f"duration_frames must not be negative, got {self.duration_frames}"
            )
        if not MARKER_COLOUR_PATTERN.match(self.colour):
            raise NovaInvariantError(
                f"colour must match {MARKER_COLOUR_PATTERN.pattern}, got {self.colour!r}"
            )

    @property
    def end_frame(self) -> int:
        """The first frame after the marker's range."""
        return self.frame + self.duration_frames

    @property
    def is_range(self) -> bool:
        """Whether the marker covers frames rather than marking one."""
        return self.duration_frames > 0

    def to_wire(self) -> dict[str, object]:
        """A JSON-ready mapping."""
        return {
            "marker_id": self.marker_id,
            "frame": self.frame,
            "name": self.name,
            "colour": self.colour,
            "duration_frames": self.duration_frames,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> Marker:
        """Rebuild from :meth:`to_wire`, rejecting unknown fields."""
        _reject_unknown_fields(data, _MARKER_FIELDS)
        return cls(
            marker_id=_wire_str(data, "marker_id"),
            frame=_wire_int(data, "frame"),
            name=_wire_str(data, "name"),
            colour=_wire_str(data, "colour"),
            duration_frames=_wire_int(data, "duration_frames"),
        )


@dataclass(frozen=True, slots=True)
class ClipContribution:
    """One clip's presence in one frame.

    What the compositor consumes: a source frame to decode and, where a
    transition is in progress, how far through it this frame is.
    """

    clip: Clip
    track: Track
    #: The source frame to decode.
    source_frame: int
    #: The transition in progress at this frame, if any.
    transition: Transition | None = None

    @property
    def is_transitioning(self) -> bool:
        """Whether this contribution is part of a transition."""
        return self.transition is not None

    def transition_progress(self, frame: int) -> float:
        """How far through the transition this frame is; ``1.0`` when none."""
        if self.transition is None:
            return 1.0
        return self.transition.progress(self.clip, frame)


@dataclass(frozen=True, slots=True)
class ResolvedFrame:
    """Everything visible at one frame, bottom first.

    The last entry is the topmost and is drawn last.  Empty when the frame is
    between clips, which the compositor turns into transparency rather than an
    error.
    """

    frame: int
    contributions: tuple[ClipContribution, ...] = ()

    @property
    def is_empty(self) -> bool:
        """Whether anything at all is showing."""
        return not self.contributions

    @property
    def top(self) -> ClipContribution | None:
        """The topmost contribution, or ``None`` on an empty frame."""
        return self.contributions[-1] if self.contributions else None

    @property
    def clip_count(self) -> int:
        """How many clips contribute to this frame."""
        return len(self.contributions)


@dataclass(frozen=True, slots=True, kw_only=True)
class Timeline:
    """The edit decision list: tracks, markers and the rate they run at.

    Immutable.  Every edit is a new timeline built with :meth:`with_track` and
    friends, wrapped in a :class:`~nova_studio.core.commands.Command` so that it
    can be undone (ADR-0008).  That is also what makes the compositor a pure
    function of ``(timeline, frame)`` — the classic NLE bug class "preview looks
    different from export" is structurally impossible.
    """

    timebase: Timebase = DEFAULT_TIMEBASE
    #: Display order: index 0 is the topmost track.
    tracks: tuple[Track, ...] = ()
    markers: tuple[Marker, ...] = ()

    def __post_init__(self) -> None:
        track_ids = [track.track_id for track in self.tracks]
        if len(track_ids) != len(set(track_ids)):
            raise NovaInvariantError("two tracks share an id")
        marker_ids = [marker.marker_id for marker in self.markers]
        if len(marker_ids) != len(set(marker_ids)):
            raise NovaInvariantError("two markers share an id")
        clip_ids = [clip.clip_id for track in self.tracks for clip in track.clips]
        if len(clip_ids) != len(set(clip_ids)):
            duplicates = sorted({name for name in clip_ids if clip_ids.count(name) > 1})
            raise NovaInvariantError(f"clips appear on more than one track: {duplicates}")

    @classmethod
    def of(cls, *tracks: Track, timebase: Timebase = DEFAULT_TIMEBASE) -> Timeline:
        """A timeline from tracks, with indices assigned in display order."""
        return cls(
            timebase=timebase,
            tracks=tuple(replace(track, index=index) for index, track in enumerate(tracks)),
        )

    @property
    def is_empty(self) -> bool:
        """Whether there is anything to play."""
        return all(track.is_empty for track in self.tracks)

    @property
    def track_count(self) -> int:
        """How many tracks the timeline has."""
        return len(self.tracks)

    @property
    def clip_count(self) -> int:
        """How many clips the timeline holds, across every track."""
        return sum(track.clip_count for track in self.tracks)

    @property
    def duration_frames(self) -> int:
        """The end of the last clip on any track."""
        return max((track.duration_frames for track in self.tracks), default=0)

    @property
    def video_tracks(self) -> tuple[Track, ...]:
        """Tracks that carry pictures, in display order."""
        return tuple(
            track for track in self.tracks if track.kind in (TrackKind.VIDEO, TrackKind.OVERLAY)
        )

    @property
    def audio_tracks(self) -> tuple[Track, ...]:
        """Tracks that carry sound, in display order."""
        return tuple(track for track in self.tracks if track.kind is TrackKind.AUDIO)

    @property
    def caption_tracks(self) -> tuple[Track, ...]:
        """Caption tracks, in display order (ADR-0009 §8)."""
        return tuple(track for track in self.tracks if track.kind is TrackKind.CAPTION)

    def track(self, track_id: str) -> Track | None:
        """The track with this id, or ``None``."""
        for track in self.tracks:
            if track.track_id == track_id:
                return track
        return None

    def clip(self, clip_id: str) -> Clip | None:
        """The clip with this id, anywhere on the timeline."""
        for track in self.tracks:
            found = track.clip(clip_id)
            if found is not None:
                return found
        return None

    def track_of(self, clip_id: str) -> Track | None:
        """The track a clip lives on."""
        for track in self.tracks:
            if track.clip(clip_id) is not None:
                return track
        return None

    def resolve(self, frame: int) -> ResolvedFrame:
        """Everything showing at ``frame``, in painter's-algorithm order.

        Bottom first, so the last contribution is the topmost.  Disabled clips
        and hidden tracks contribute nothing; a muted track still shows its
        pictures, because muting is a mix decision and the audio stage handles
        it.
        """
        if frame < 0:
            raise NovaInvariantError(f"frame must not be negative, got {frame}")
        contributions: list[ClipContribution] = []
        for track in reversed(self.tracks):
            if track.hidden or track.kind is TrackKind.ADJUSTMENT:
                continue
            for clip in track.clips:
                if not clip.enabled or not clip.contains(frame):
                    continue
                transition = _transition_in_progress(track, clip, frame)
                contributions.append(
                    ClipContribution(
                        clip=clip,
                        track=track,
                        source_frame=clip.source_frame_at(frame),
                        transition=transition,
                    )
                )
        return ResolvedFrame(frame=frame, contributions=tuple(contributions))

    def clips_between(self, start_frame: int, end_frame: int) -> tuple[Clip, ...]:
        """Every clip overlapping the range, across all tracks."""
        _check_range(start_frame, end_frame)
        return tuple(
            clip for track in self.tracks for clip in track.clips_between(start_frame, end_frame)
        )

    def with_track(self, track: Track) -> Timeline:
        """Add a track at the bottom of the stack."""
        if any(existing.track_id == track.track_id for existing in self.tracks):
            raise NovaInvariantError(f"track {track.track_id!r} is already on this timeline")
        return replace(self, tracks=(*self.tracks, replace(track, index=len(self.tracks))))

    def replaced(self, track: Track) -> Timeline:
        """Replace the track with this id, keeping display order."""
        if not any(existing.track_id == track.track_id for existing in self.tracks):
            raise NovaInvariantError(
                f"track {track.track_id!r} is not on this timeline, so it cannot be replaced"
            )
        return replace(
            self,
            tracks=tuple(
                track if existing.track_id == track.track_id else existing
                for existing in self.tracks
            ),
        )

    def without_track(self, track_id: str) -> Timeline:
        """Remove a track and everything on it."""
        return self.reindexed(
            tracks=tuple(track for track in self.tracks if track.track_id != track_id)
        )

    def reindexed(self, *, tracks: Sequence[Track] | None = None) -> Timeline:
        """Renumber track indices in display order.

        Indices are presentation, not identity: any operation that adds, removes
        or reorders tracks ends with this, so that a track's index always matches
        where the user sees it.
        """
        chosen = tuple(tracks) if tracks is not None else self.tracks
        return replace(
            self,
            tracks=tuple(replace(track, index=index) for index, track in enumerate(chosen)),
        )

    def with_marker(self, marker: Marker) -> Timeline:
        """Add a marker, replacing any with the same id."""
        kept = tuple(
            existing for existing in self.markers if existing.marker_id != marker.marker_id
        )
        return replace(self, markers=(*kept, marker))

    def without_marker(self, marker_id: str) -> Timeline:
        """Remove a marker."""
        return replace(
            self, markers=tuple(marker for marker in self.markers if marker.marker_id != marker_id)
        )

    def validate(self) -> str:
        """``""`` when the timeline can be rendered, otherwise the first problem."""
        return validate_timeline(self)

    def to_wire(self) -> dict[str, object]:
        """A JSON-ready mapping: the document inside the project file."""
        return {
            "timebase": [self.timebase.num, self.timebase.den],
            "tracks": [track.to_wire() for track in self.tracks],
            "markers": [marker.to_wire() for marker in self.markers],
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> Timeline:
        """Rebuild from :meth:`to_wire`, rejecting unknown fields."""
        _reject_unknown_fields(data, _TIMELINE_FIELDS)
        rate = data["timebase"]
        if not isinstance(rate, list) or len(rate) != 2:
            raise NovaInvariantError("'timebase' must be a [num, den] pair")
        return cls(
            timebase=Timebase.of(int(rate[0]), int(rate[1])),
            tracks=tuple(Track.from_wire(entry) for entry in _wire_mappings(data, "tracks")),
            markers=tuple(Marker.from_wire(entry) for entry in _wire_mappings(data, "markers")),
        )


def _transition_in_progress(track: Track, clip: Clip, frame: int) -> Transition | None:
    for transition in track.transitions:
        if transition.clip_id == clip.clip_id and transition.covers(clip, frame):
            return transition
    return None


def snap_candidates(
    timeline: Timeline,
    frame: int,
    *,
    tolerance_frames: int = DEFAULT_SNAP_TOLERANCE_FRAMES,
    ignore_clip_id: str | None = None,
) -> tuple[int, ...]:
    """The frames a dragged edge would snap to, nearest first.

    Snapping is what makes an edit feel precise: a cut lands on the frame the
    user meant rather than three frames to one side.  The targets are the
    timeline's own geometry — the start, the end, every clip edge and every
    marker — never a grid the user did not ask for.

    Results are sorted by distance from ``frame``, so a caller takes the first
    one; the dragged clip's own edges are excluded, or a clip would snap to
    itself and never move.
    """
    if tolerance_frames < 0:
        raise NovaInvariantError(f"tolerance_frames must not be negative, got {tolerance_frames}")
    candidates = {0, timeline.duration_frames}
    for track in timeline.tracks:
        for clip in track.clips:
            if clip.clip_id == ignore_clip_id:
                continue
            candidates.add(clip.start_frame)
            candidates.add(clip.end_frame)
    for marker in timeline.markers:
        candidates.add(marker.frame)
        candidates.add(marker.end_frame)
    within = [item for item in candidates if abs(item - frame) <= tolerance_frames]
    return tuple(sorted(within, key=lambda item: (abs(item - frame), item)))


def validate_timeline(timeline: Timeline) -> str:
    """Return ``""`` or a sentence naming the first thing that is wrong.

    The checks are the ones a timeline can fall into *after* construction —
    index drift, uncovered overlaps — because construction already refuses the
    states it can see (a clip with no asset, a reversed range, a duplicate id).

    A project in one of these states must not be saved: the renderer would pick
    an arbitrary winner where two clips fight, and the user would see a different
    picture tomorrow than they saw today.
    """
    for position, track in enumerate(timeline.tracks):
        if track.index != position:
            return (
                f"track {track.track_id!r} has index {track.index} but sits at position "
                f"{position}; track indices must follow display order"
            )
        for index, clip in enumerate(track.clips):
            if index > 0 and clip.start_frame < track.clips[index - 1].start_frame:
                return (
                    f"track {track.track_id!r} has clips out of position order: "
                    f"{clip.clip_id!r} starts before {track.clips[index - 1].clip_id!r}"
                )
        for index, clip in enumerate(track.clips):
            for other in track.clips[index + 1 :]:
                if clip.start_frame >= other.end_frame or other.start_frame >= clip.end_frame:
                    continue
                start = max(clip.start_frame, other.start_frame)
                end = min(clip.end_frame, other.end_frame)
                if _overlap_is_covered(track, clip, other, start, end):
                    continue
                return (
                    f"track {track.track_id!r} has {clip.clip_id!r} and {other.clip_id!r} "
                    f"overlapping between frames {start} and {end} with no transition between them"
                )
    return ""


def _overlap_is_covered(
    track: Track,
    first: Clip,
    second: Clip,
    start: int,
    end: int,
) -> bool:
    """Whether a transition on either clip covers every frame of the overlap."""
    covered = dict.fromkeys(range(start, end), False)
    for transition in track.transitions:
        if transition.clip_id not in (first.clip_id, second.clip_id):
            continue
        clip = first if transition.clip_id == first.clip_id else second
        window_start, window_end = transition.window(clip)
        for frame in range(start, end):
            if window_start <= frame < window_end:
                covered[frame] = True
    return all(covered.values())


def _check_range(start_frame: int, end_frame: int) -> None:
    if start_frame < 0 or end_frame < 0:
        raise NovaInvariantError(f"frames must not be negative, got [{start_frame}, {end_frame})")
    if end_frame < start_frame:
        raise NovaInvariantError(
            f"end_frame ({end_frame}) must not precede start_frame ({start_frame})"
        )


# -- wire helpers -------------------------------------------------------------

_CLIP_FIELDS: Final[set[str]] = {
    "clip_id",
    "asset_id",
    "kind",
    "start_frame",
    "in_frame",
    "out_frame",
    "speed",
    "enabled",
    "name",
}
_TRANSITION_FIELDS: Final[set[str]] = {
    "transition_id",
    "clip_id",
    "edge",
    "kind",
    "duration_frames",
    "alignment",
    "params",
}
_TRACK_FIELDS: Final[set[str]] = {
    "track_id",
    "kind",
    "index",
    "name",
    "muted",
    "locked",
    "hidden",
    "clips",
    "transitions",
}
_MARKER_FIELDS: Final[set[str]] = {"marker_id", "frame", "name", "colour", "duration_frames"}
_TIMELINE_FIELDS: Final[set[str]] = {"timebase", "tracks", "markers"}
