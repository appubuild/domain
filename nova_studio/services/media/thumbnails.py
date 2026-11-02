"""L3 — the thumbnail strip: which frames to decode, and nothing else.

A filmstrip, a scrub-hover preview and a media-bin tile all ask the same
question: *give me N pictures from this clip.*  What they never ask is the
expensive follow-up — **decode N frames of 4K long-GOP footage**, which for a
hard codec means seeking into a group of pictures and decoding forward to the
target, once per thumbnail.

So this module answers the cheap half: which frame *indices* to ask for.  It is
pure integer arithmetic over a frame count and, optionally, the clip's keyframe
list — no I/O, no decoder, no numpy — because the expensive half belongs to
``infra`` and the *deciding* half belongs here where it can be tested in
microseconds.

Two rules do the work:

1. **Spread evenly.**  A strip of eight from a ten-minute clip must show the
   beginning, the middle and the end, not eight frames from the first second.
   Spacing is deterministic — ``floor(i * frame_count / wanted)`` — so the same
   clip yields the same strip every time it is laid out, in this session or in
   a project reopened a year from now (ADR-0015: the cache key must be stable).
2. **Land on a keyframe when one is near.**  ``ports/media.py`` contract rule 3
   says a source may charge a whole GOP for a sparse seek, and
   :meth:`~nova_studio.ports.media.VideoFrameSource.keyframe_indices` publishes
   where the cheap landing spots are.  Snapping each target *backwards* to the
   nearest keyframe costs a fraction of a frame of accuracy and saves a decode
   that is invisible at thumbnail scale.

Snapping is why this returns a tuple rather than a count: two targets can snap
to the same keyframe, and the caller gets fewer, cheaper thumbnails instead of
two identical decodes.
"""

from __future__ import annotations

from typing import Final

from nova_studio.core.errors import NovaInvariantError

__all__ = [
    "DEFAULT_STRIP_COUNT",
    "snap_to_keyframe",
    "thumbnail_indices",
]

#: How many thumbnails a media-bin tile asks for until the user changes it.
DEFAULT_STRIP_COUNT: Final = 8


def thumbnail_indices(
    frame_count: int,
    *,
    wanted: int = DEFAULT_STRIP_COUNT,
    keyframes: tuple[int, ...] = (),
) -> tuple[int, ...]:
    """The frame indices to decode for a strip of ``wanted`` thumbnails.

    Args:
        frame_count: Frames in the clip.  ``0`` yields no indices.
        wanted: How many thumbnails are being asked for.
        keyframes: The clip's keyframe indices, if a decoder published them.
            They need not be sorted, and indices past the end are ignored.

    Returns:
        Indices in ascending order, deduplicated, every one of them inside
        ``[0, frame_count)``.  Possibly shorter than ``wanted`` — see the
        keyframe note above.

    Raises:
        NovaInvariantError: On a negative frame count or a non-positive
            ``wanted``, both of which are bugs in the caller.
    """
    if frame_count < 0:
        raise NovaInvariantError(f"frame_count must not be negative, got {frame_count}")
    if wanted < 1:
        raise NovaInvariantError(f"wanted must be at least 1, got {wanted}")
    if frame_count == 0:
        return ()

    if wanted >= frame_count:
        # Asking for more pictures than the clip has frames: every frame is in
        # the strip, because there is nothing between them to skip.
        return tuple(range(frame_count))
    landing = _usable_keyframes(keyframes, frame_count)
    indices = {snap_to_keyframe(index * frame_count // wanted, landing) for index in range(wanted)}
    return tuple(sorted(indices))


def snap_to_keyframe(index: int, keyframes: tuple[int, ...]) -> int:
    """The nearest keyframe at or before ``index``, or ``index`` itself.

    Backwards only: snapping *forward* would show a frame the user has not
    scrubbed to, and the last keyframe may sit past the end of the range a
    caller is allowed to read.
    """
    if index < 0:
        raise NovaInvariantError(f"index must not be negative, got {index}")
    candidates = [keyframe for keyframe in keyframes if keyframe <= index]
    return max(candidates) if candidates else index


def _usable_keyframes(keyframes: tuple[int, ...], frame_count: int) -> tuple[int, ...]:
    """Sorted, in-range keyframes: the only ones worth snapping to."""
    return tuple(sorted(keyframe for keyframe in keyframes if 0 <= keyframe < frame_count))
