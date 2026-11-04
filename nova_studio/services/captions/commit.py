"""L3 — what a caption document asks the timeline to hold (ADR-0009 §8).

A caption document is the authoring source of truth, and it is *not* the
timeline. But captions have to be visible on the timeline: the editor drags a
cue, trims it against a cut, sees it next to the picture, and exports a project
in which the caption track is part of the edit. ADR-0009 §8 resolves that with
one sentence — captions also live on the timeline as clips, **reconciled in one
transaction** — and this module is the reconciler's pure half.

It answers exactly one question: *given this document, which clips should that
track hold?* It never touches a timeline, never opens a project and never
mutates anything, which is what lets it be tested with a document and a frame
rate and nothing else — and what keeps `services/captions` from importing
`services/timeline`, a sibling feature (ADR-0002 rule 4).

Three decisions are worth stating:

**A clip per cue.** One `CaptionSegment` is one `Clip` of
:attr:`~nova_studio.domain.timeline.ClipKind.CAPTION`. Not a clip per layer, not
a single clip for the whole document: a cue is the unit an editor trims and
moves, and a clip that could not be trimmed would be a caption the editor cannot
fix on the timeline.

**The clip id is the cue's address.** ``"<track>.<layer>.<index>"``, derived, not
stored: the document has no ids of its own, and an id invented per commit would
change every time, which would make every commit a full replacement. A derived
id is stable across commits, so a re-transcription that keeps a cue's position
replaces one clip and not the whole track.

**No asset.** A caption clip is generated: its content is the document, so it
carries an empty ``asset_id`` and the renderer resolves the id back to the cue.
That is why :attr:`ClipKind.CAPTION` counts as generated in the domain.

Applying the answer is somebody else's job:
:class:`~nova_studio.services.timeline.commands.ReplaceTrackClipsCommand` makes a
track hold exactly these clips, in one command, with one undo entry — which is
the "one transaction" the ADR asks for. The two halves meet in the application
layer, which is the only place allowed to know about both.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Final

from nova_studio.core.temporal import Rounding
from nova_studio.domain.asr import frames_for_ms
from nova_studio.domain.captions import DEFAULT_LAYER_ID
from nova_studio.domain.timeline import MIN_CLIP_FRAMES, Clip, ClipKind

if TYPE_CHECKING:
    from nova_studio.core.temporal import Timebase
    from nova_studio.domain.captions import CaptionDocument, CaptionSegment

__all__ = [
    "DEFAULT_CAPTION_TRACK_ID",
    "CaptionCommit",
    "caption_clip",
    "clip_id_for",
    "commit_document",
    "commit_layer",
]

#: The track a project's captions are committed to, when nobody says otherwise.
DEFAULT_CAPTION_TRACK_ID: Final[str] = "captions"


@dataclass(frozen=True, slots=True)
class CaptionCommit:
    """What one caption layer wants one timeline track to hold."""

    track_id: str
    layer_id: str
    clips: tuple[Clip, ...] = ()

    @property
    def is_empty(self) -> bool:
        """Whether there is anything to put on the track."""
        return not self.clips

    @property
    def clip_ids(self) -> tuple[str, ...]:
        """Every clip id, in cue order — what a diff compares."""
        return tuple(clip.clip_id for clip in self.clips)


def commit_document(
    document: CaptionDocument,
    timebase: Timebase,
    *,
    track_id: str = DEFAULT_CAPTION_TRACK_ID,
) -> tuple[CaptionCommit, ...]:
    """One commit per layer: the primary, then every translation beside it.

    A layer is a track, because a translation is a separate piece of work with
    its own history — and because two languages on one track would be two clips
    fighting for the same frames.
    """
    return tuple(
        commit_layer(document, timebase, track_id=track_id, layer_id=layer.layer_id)
        for layer in document.layers
    )


def commit_layer(
    document: CaptionDocument,
    timebase: Timebase,
    *,
    track_id: str = DEFAULT_CAPTION_TRACK_ID,
    layer_id: str = DEFAULT_LAYER_ID,
) -> CaptionCommit:
    """The clips one layer's cues ask for, in cue order."""
    cues = document.on_layer(layer_id)
    return CaptionCommit(
        track_id=track_id,
        layer_id=layer_id,
        clips=tuple(
            caption_clip(cue, timebase, track_id=track_id, layer_id=layer_id) for cue in cues
        ),
    )


def caption_clip(
    cue: CaptionSegment,
    timebase: Timebase,
    *,
    track_id: str = DEFAULT_CAPTION_TRACK_ID,
    layer_id: str = DEFAULT_LAYER_ID,
) -> Clip:
    """One cue as one clip.

    Milliseconds to frames goes through
    :func:`~nova_studio.domain.asr.frames_for_ms` with rounding **stated**,
    because a caption's start frame and its displayed timecode must agree — and
    they only do if both sides say which way they rounded (ADR-0006).
    """
    start = frames_for_ms(cue.start_ms, timebase, Rounding.FLOOR)
    end = frames_for_ms(cue.end_ms, timebase, Rounding.FLOOR)
    return Clip.of(
        clip_id_for(track_id, layer_id, cue.index),
        "",  # generated: the document is the source, not an asset
        start_frame=start,
        source_frames=max(MIN_CLIP_FRAMES, end - start),
        kind=ClipKind.CAPTION,
        name=cue.text,
    )


def clip_id_for(track_id: str, layer_id: str, index: int) -> str:
    """The address of a cue's clip.

    Derived rather than stored, so a commit that changes nothing produces the
    same ids and therefore no diff at all.
    """
    return f"{track_id}.{layer_id}.{index}"
