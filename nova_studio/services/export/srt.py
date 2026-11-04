"""L3 — export: SubRip (``.srt``).

SubRip is the format every player, every platform and every grandmother's media
centre understands, and that is the whole argument for writing it: it is the
sidecar you upload when the destination is unknown. It also has no idea about
styling — no italics tags anyone agrees on, no position, no animation — so an
SRT export is **text and timings and nothing else**. What a cue looks like is
not this file's business and pretending otherwise produces files that render
differently in every player that reads them.

Three rules keep the output boring, which is what a sidecar should be:

* **LF line endings, UTF-8, one blank line between cues.** Windows editors and
  ``ffmpeg`` both cope, and a file with CRLF in a Linux muxer is a support
  ticket.
* **Cues are numbered from one**, in the order they are shown, with no gaps: a
  player that meets a gap does not have to keep reading, and several do not.
* **Timestamps are ``HH:MM:SS,mmm``** — a comma, not a full stop — with a
  fixed three-digit millisecond field, because a two-digit one makes
  ``00:00:01,50`` ambiguous to parsers that count characters.

Speaker names are the one decoration offered, off by default, because
``SPEAKER: text`` is a convention most players simply show as text rather than
a convention they break on.

No file is written: this layer has no I/O (ADR-0002), and the caller — an API
route, a CLI, an export job — decides where the bytes go.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from nova_studio.core.result import Result, failed, ok
from nova_studio.domain.captions import DEFAULT_LAYER_ID
from nova_studio.services.export.layers import layer_cues

if TYPE_CHECKING:
    from nova_studio.domain.captions import CaptionDocument, CaptionSegment

__all__ = ["srt_timestamp", "to_srt"]


def srt_timestamp(ms: int) -> str:
    """``ms`` as SubRip writes it: ``HH:MM:SS,mmm``.

    Hours are not wrapped at 24 and are written at two digits or more, which is
    what the format's reference parser accepts.
    """
    whole, milliseconds = divmod(max(ms, 0), 1_000)
    minutes, seconds = divmod(whole, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}"


def to_srt(
    document: CaptionDocument,
    *,
    layer_id: str = DEFAULT_LAYER_ID,
    speakers: bool = False,
) -> Result[str]:
    """One layer of a document, as SubRip text.

    Args:
        document: What a pipeline finished with.
        layer_id: Which layer to write. Defaults to the primary one.
        speakers: Whether to prefix a cue with who is saying it, as
            ``SPEAKER: text``. Off by default: a caption a viewer reads is
            usually better without it, and a transcription someone reviews is
            usually better with it.

    Returns:
        ``Ok`` with the whole file as text, or ``Err`` from
        :func:`~nova_studio.services.export.layers.layer_cues`.
    """
    found = layer_cues(document, layer_id)
    problem = found.error()
    if problem is not None:
        return failed(problem)
    cues = found.unwrap()

    blocks = [_block(number, cue, speakers) for number, cue in enumerate(cues, start=1)]
    return ok("\n".join(blocks))


def _block(number: int, cue: CaptionSegment, speakers: bool) -> str:
    """One SubRip cue: a number, a line of timings, then the text."""
    timing = f"{srt_timestamp(cue.start_ms)} --> {srt_timestamp(cue.end_ms)}"
    return f"{number}\n{timing}\n{_text_of(cue, speakers)}\n"


def _text_of(cue: CaptionSegment, speakers: bool) -> str:
    """A cue's text, with the speaker in front when asked for."""
    if speakers and cue.speaker:
        return f"{cue.speaker}: {cue.text}"
    return cue.text
