"""L3 — export: WebVTT (``.vtt``), read and written.

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

**Reading one** is the other half, and it returns a
:class:`~nova_studio.domain.asr.Transcript` — the same shape every provider
returns — so an imported file goes through the *same* pipeline as a recognition.
What the reader does with the things only WebVTT has:

* **``<v Ada>`` becomes the speaker.** It is the one piece of meaning the format
  carries that plain text does not, so it is kept rather than stripped.
* **Entities are put back**: ``&amp;``, ``&lt;``, ``&gt;``, ``&nbsp;`` and the
  two direction marks, which the writer escapes and nothing else will.
* **``NOTE``, ``STYLE`` and ``REGION`` blocks are skipped**, because they are
  not cues and a file that carries them is still a perfectly good file.
* **Cue settings are read for nothing.** They say where a caption goes in a
  player that honours them; a project's own placement is a pipeline stage, and
  importing a guess would overwrite a decision the editor is about to make.

The refusals are the ones `srt.py` makes, for the same reasons: a cue that ends
before it starts, and a cue that overlaps the one before it, are reported with
the cue's number rather than trimmed to fit.

No file is read or written: this layer has no I/O (ADR-0002).
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
    voice_of,
)

if TYPE_CHECKING:
    from nova_studio.domain.captions import CaptionDocument, CaptionSegment

__all__ = ["from_vtt", "to_vtt", "vtt_timestamp"]

#: How this format names itself in an error, so the message reads as English.
_FORMAT: Final[str] = "WebVTT"

#: Blocks that are not cues, however much they look like them.
_NOT_A_CUE: Final[frozenset[str]] = frozenset({"NOTE", "STYLE", "REGION"})

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


def from_vtt(text: str, *, language: str = "") -> Result[Transcript]:
    """Read WebVTT text as a transcript.

    Args:
        text: The whole file.
        language: The BCP-47 tag to file it under, when neither the file nor its
            header says.

    Returns:
        ``Ok`` with a transcript of one segment per cue — no word timings,
        because a WebVTT file has none unless it carries timestamp tags, which
        are dropped with the rest of the markup — or ``Err`` naming the cue that
        could not be read.
    """
    blocks = blocks_of(text)
    if not blocks or not blocks[0][0].startswith(_HEADER):
        return failed(malformed_file(_FORMAT, "it does not start with WEBVTT"))

    segments: list[TranscriptSegment] = []
    number = 0
    for block in blocks[1:]:
        if block[0].split()[0].upper() in _NOT_A_CUE:
            continue
        at = _timing_line_of(block)
        if at is None:
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
        # The voice tag is taken off before the markup is stripped: it is
        # meaning, and stripping it would lose who is talking.
        raw = "\n".join(block[at + 1 :])
        named = voice_of(raw)
        said = plain_text(named[1] if named else raw, unescape_entities=True).strip()
        if not said:
            continue
        segments.append(
            TranscriptSegment(
                start_ms=start_ms,
                end_ms=end_ms,
                index=len(segments),
                text=said,
                speaker=named[0] if named else None,
            )
        )
    if not segments:
        return failed(malformed_file(_FORMAT, "it holds no cues with text in them"))
    return ok(Transcript(segments=tuple(segments), language=language))


def _timing_line_of(block: tuple[str, ...]) -> int | None:
    """Which line of a WebVTT block carries the timings, if any does."""
    for position, line in enumerate(block):
        if "-->" in line:
            return position
    return None


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
