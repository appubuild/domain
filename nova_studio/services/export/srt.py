"""L3 — export: SubRip (``.srt``), read and written.

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

**Reading one** is the other half, and it returns a
:class:`~nova_studio.domain.asr.Transcript` — the same shape every provider
returns — so an imported file goes through the *same* pipeline as a recognition
and a project cannot tell the two apart. Two things a reader refuses rather than
guesses at:

* **A cue that ends before it starts**, and **a cue that overlaps the one
  before it**: both are reported with the cue's number and the line, because
  silently trimming one to fit the other is the corruption ADR-0009 §4 exists to
  prevent.
* **A speaker's name.** SubRip has no speaker convention; ``NAME: text`` is a
  habit, and following it turns *"Chapter 2: the journey"* into a speaker called
  Chapter 2. So a leading name is left as text, and a file that needs speakers
  should be WebVTT.

No file is read or written: this layer has no I/O (ADR-0002), and the caller —
an API route, a CLI, an export job — decides where the bytes come from and go.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Final

from nova_studio.core.result import Result, failed, ok
from nova_studio.domain.asr import Transcript, TranscriptSegment
from nova_studio.domain.captions import DEFAULT_LAYER_ID
from nova_studio.services.export.layers import layer_cues
from nova_studio.services.export.parse import (
    blocks_of,
    malformed_cue,
    malformed_file,
    plain_text,
    timing_of,
)

if TYPE_CHECKING:
    from nova_studio.domain.captions import CaptionDocument, CaptionSegment

__all__ = ["from_srt", "srt_timestamp", "to_srt"]

#: How this format names itself in an error, so the message reads as English.
_FORMAT: Final[str] = "SubRip"


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


def from_srt(text: str, *, language: str = "") -> Result[Transcript]:
    """Read SubRip text as a transcript.

    Args:
        text: The whole file.
        language: The BCP-47 tag to file it under, when the file does not say.

    Returns:
        ``Ok`` with a transcript of one segment per cue — no word timings,
        because a SubRip file has none — or ``Err`` naming the cue that could
        not be read.
    """
    blocks = blocks_of(text)
    if not any("-->" in line for block in blocks for line in block):
        return failed(malformed_file(_FORMAT, "it holds no cues at all"))

    segments: list[TranscriptSegment] = []
    number = 0
    for block in blocks:
        at = _timing_line_of(block)
        if at is None:
            # Not a cue: a stray number at the end of a file, a header some
            # editor wrote.  Skipping it loses nothing; there is no text in a
            # block with no timings to lose.
            continue
        number += 1
        times = timing_of(block[at])
        if times is None:
            return failed(
                malformed_cue(
                    _FORMAT, number, f"{block[at]!r} is not a timing line", line=block[at]
                )
            )
        start_ms, end_ms = times
        if end_ms <= start_ms:
            return failed(
                malformed_cue(
                    _FORMAT,
                    number,
                    f"it ends at {end_ms} ms, before it starts at {start_ms} ms",
                    line=block[at],
                )
            )
        if segments and start_ms < segments[-1].end_ms:
            return failed(
                malformed_cue(
                    _FORMAT,
                    number,
                    f"it starts at {start_ms} ms, before cue {number - 1} ends "
                    f"at {segments[-1].end_ms} ms",
                    line=block[at],
                )
            )
        body = plain_text("\n".join(block[at + 1 :])).strip()
        if not body:
            # A cue with no text is a placeholder some editors leave behind:
            # there is nothing to import, and nothing lost by saying so.
            continue
        segments.append(
            TranscriptSegment(
                start_ms=start_ms,
                end_ms=end_ms,
                index=len(segments),
                text=body,
            )
        )
    if not segments:
        return failed(malformed_file(_FORMAT, "it holds no cues with text in them"))
    return ok(Transcript(segments=tuple(segments), language=language))


def _timing_line_of(block: tuple[str, ...]) -> int | None:
    """Which line of a SubRip block carries the timings, if any does."""
    for position, line in enumerate(block):
        if "-->" in line:
            return position
    return None


def _text_of(cue: CaptionSegment, speakers: bool) -> str:
    """A cue's text, with the speaker in front when asked for."""
    if speakers and cue.speaker:
        return f"{cue.speaker}: {cue.text}"
    return cue.text
