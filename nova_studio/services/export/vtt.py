"""L3 — export: WebVTT (``.vtt``).

WebVTT is what the web platform reads, and it is the only one of the two
sidecar formats that knows anything about *where* a caption goes and *who* is
saying it. So unlike :mod:`~nova_studio.services.export.srt`, this writer has
decisions to make, and each one is a trade the module would rather state than
hide:

* **Cue settings are written, but only when they say something.** ``align``
  comes from the cue's anchor, and ``position`` and ``line`` from its offset —
  both written only when the offset is not zero, because a cue that sits where
  its anchor puts it needs no settings at all. The mapping from a fraction of
  the safe area to WebVTT's percentage of the frame is an **approximation**, and
  it says so below: the two coordinate systems do not agree about what the
  number counts from.
* **Speaker names become voice tags.** ``<v Ada>`` is the one piece of
  semantics the format offers, and a transcript of a conversation without it
  loses who said what.
* **Text is escaped.** ``&``, ``<`` and ``>`` become entities, because a cue
  that mentions ``a < b`` is otherwise a cue that opens a tag.

Timestamps are ``HH:MM:SS.mmm`` — a full stop, not SubRip's comma — and the
file starts with ``WEBVTT`` on a line of its own, followed by a blank line, as
the specification requires a browser to demand.

No file is written: this layer has no I/O (ADR-0002).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Final

from nova_studio.core.result import Result, failed, ok
from nova_studio.domain.captions import DEFAULT_LAYER_ID
from nova_studio.services.export.layers import layer_cues

if TYPE_CHECKING:
    from nova_studio.domain.captions import CaptionDocument, CaptionSegment

__all__ = ["to_vtt", "vtt_timestamp"]

#: How the anchor's horizontal half is said in WebVTT.
_ALIGN: Final[dict[str, str]] = {"left": "left", "center": "center", "right": "right"}

#: Where each vertical half of the frame puts a cue, as a WebVTT ``line``
#: percentage measured from the top.  An approximation of an anchor, not a
#: measurement of it.
_LINE: Final[dict[str, int]] = {"top": 10, "middle": 50, "bottom": 90}

#: What the file starts with.  A browser rejects a file that does not.
_HEADER: Final[str] = "WEBVTT"


def vtt_timestamp(ms: int) -> str:
    """``ms`` as WebVTT writes it: ``HH:MM:SS.mmm``."""
    whole, milliseconds = divmod(max(ms, 0), 1_000)
    minutes, seconds = divmod(whole, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{milliseconds:03d}"


def to_vtt(
    document: CaptionDocument,
    *,
    layer_id: str = DEFAULT_LAYER_ID,
    settings: bool = True,
    voice: bool = True,
) -> Result[str]:
    """One layer of a document, as WebVTT text.

    Args:
        document: What a pipeline finished with.
        layer_id: Which layer to write. Defaults to the primary one.
        settings: Whether to write ``align``, ``position`` and ``line``. Turn
            this off for a player that ignores them — or, more often, misreads
            them.
        voice: Whether a cue with a speaker is written as ``<v Speaker>text``.

    Returns:
        ``Ok`` with the whole file as text, or ``Err`` from
        :func:`~nova_studio.services.export.layers.layer_cues`.
    """
    found = layer_cues(document, layer_id)
    problem = found.error()
    if problem is not None:
        return failed(problem)
    cues = found.unwrap()

    blocks = [_block(cue, settings=settings, voice=voice) for cue in cues]
    return ok(f"{_HEADER}\n\n" + "\n".join(blocks))


def _block(cue: CaptionSegment, *, settings: bool, voice: bool) -> str:
    """One WebVTT cue: a timing line with its settings, then the payload."""
    timing = f"{vtt_timestamp(cue.start_ms)} --> {vtt_timestamp(cue.end_ms)}"
    if settings:
        timing = f"{timing} {_settings_of(cue)}"
    text = _escaped(cue.text)
    if voice and cue.speaker:
        text = f"<v {_escaped(cue.speaker)}>{text}"
    return f"{timing}\n{text}\n"


def _settings_of(cue: CaptionSegment) -> str:
    """The cue settings this cue asks for.

    ``align`` always — WebVTT default is ``center``, and a cue anchored bottom
    *left* that renders centred is a caption sitting in the wrong place — and
    ``position`` and ``line`` only when the cue was nudged off its anchor.

    The percentages are the honest part to be careful about: a Nova Studio
    offset is a fraction of the **safe area**, and WebVTT's is a percentage of
    the **frame**, so the two differ by the safe area's margin. Exported this
    way a nudged cue lands very nearly where the editor put it and never off
    the frame, which is the choice that fails best.
    """
    position = cue.position
    horizontal, vertical = _halves_of(cue)
    parts = [f"align:{_ALIGN.get(horizontal, 'center')}"]
    if position is not None and position.x:
        parts.append(f"position:{_percentage(50.0 + position.x * 50.0)}")
    if position is not None and position.y:
        parts.append(f"line:{_percentage(_LINE.get(vertical, 90) - position.y * 40.0)}")
    return " ".join(parts)


def _halves_of(cue: CaptionSegment) -> tuple[str, str]:
    """The horizontal and vertical halves of a cue's anchor."""
    anchor = cue.position.anchor.value if cue.position is not None else "bottom-center"
    vertical, _, horizontal = anchor.partition("-")
    return horizontal or "center", vertical or "bottom"


def _percentage(value: float) -> str:
    """A number as WebVTT wants a percentage: two decimals, no trailing zeros."""
    return f"{min(max(value, 0.0), 100.0):g}%"


def _escaped(text: str) -> str:
    """Text with the three characters WebVTT would read as markup escaped."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
