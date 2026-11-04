"""L3 — export: what SubRip and WebVTT have in common when you read them.

The two sidecar formats are written differently and read almost identically:
blocks separated by blank lines, a timing line with an arrow in it, then text
that may carry markup. This module is that shared part, so the two readers
cannot drift — a timestamp one accepts and the other refuses is a bug a user
meets as "your file imports in SRT but not in VTT".

Three rules, in the order a reader meets them:

**Be liberal about what is accepted and exact about what is reported.** A
timestamp may be ``HH:MM:SS,mmm`` or ``MM:SS.mmm`` or use a full stop where
SubRip wants a comma, because files in the wild do all of those; a timestamp
that cannot be read at all is reported with the line it was on, because "could
not import" is not a sentence anyone can act on.

**Markup is dropped, not guessed at.** ``<i>``, ``<b>``, ``<c.colour>``,
``<00:00:01.000>`` and SubRip's ASS-style ``{\\an8}`` all disappear, leaving
their text. A transcript is plain text with timings (ADR-0009 §1), and a
caption's styling is a template's business, not a file's.

**A voice tag is kept, because it is meaning and not markup.** ``<v Ada>`` says
who is talking; throwing that away loses the one piece of semantics the format
carries that plain text does not.

Nothing here touches a document: readers return a
:class:`~nova_studio.domain.asr.Transcript`, the same shape every provider
returns, so an imported file goes through the very same pipeline as a
recognition and a project cannot tell the two apart.
"""

from __future__ import annotations

import re
from typing import Final

from nova_studio.core.errors import ErrorDomain, NovaError
from nova_studio.services.export.codes import ExportErrorCode

__all__ = [
    "ARROW",
    "blocks_of",
    "malformed_cue",
    "malformed_file",
    "plain_text",
    "timestamp_of",
    "timing_of",
    "unescape",
    "voice_of",
]

#: What sits between two timestamps, whatever else is on the line.
ARROW: Final[str] = "-->"


#: Anything that looks like a tag: ``<i>``, ``<c.blue>``, ``<00:00:01.000>``.
_TAG: Final[re.Pattern[str]] = re.compile(r"<[^>]*>")

#: SubRip files converted from ASS carry ``{\an8}`` and friends at the front.
_OVERRIDE: Final[re.Pattern[str]] = re.compile(r"\{[^{}]*\}")

#: A WebVTT voice span: ``<v Ada>`` at the start of a cue's text.
_VOICE: Final[re.Pattern[str]] = re.compile(r"^<v[ .]([^>]*)>")

#: The entities WebVTT defines, plus the one every file in the wild uses too.
_ENTITIES: Final[dict[str, str]] = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&nbsp;": "\u00a0",
    "&lrm;": "",
    "&rlm;": "",
}

#: A byte-order mark, which Windows editors put at the front of a text file.
_BOM: Final[str] = "\ufeff"


def blocks_of(text: str) -> tuple[tuple[str, ...], ...]:
    """The blocks of a sidecar file: groups of lines with a blank line between.

    A block is a cue, a header, a note or a style — the reader decides which.
    """
    blocks: list[tuple[str, ...]] = []
    current: list[str] = []
    for line in text.replace(_BOM, "").replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if not line.strip():
            if current:
                blocks.append(tuple(current))
                current = []
            continue
        current.append(line.rstrip())
    if current:
        blocks.append(tuple(current))
    return tuple(blocks)


def timestamp_of(text: str) -> int | None:
    """``text`` as milliseconds, or ``None`` when it is not a timestamp.

    Accepts what files actually contain rather than what a specification
    insists on: ``SS.mmm``, ``MM:SS.mmm`` and ``HH:MM:SS,mmm``, with a comma or
    a full stop before the milliseconds, and one to three digits after it — a
    file that writes ``.5`` means 500 ms, not 5.

    Which part is which is decided by the number of colons, not by trying the
    longest pattern first: ``02:03.5`` is two minutes and three and a half
    seconds, and an hour-long reading of it would put a cue an hour late.
    """
    head, _, fraction = _split_fraction(text.strip())
    parts = head.split(":")
    if not 1 <= len(parts) <= 3:
        return None
    if not all(part.isdigit() for part in parts):
        return None
    numbers = [int(part) for part in parts]
    if len(numbers) == 3:
        hours, minutes, seconds = numbers
    elif len(numbers) == 2:
        hours, (minutes, seconds) = 0, numbers
    else:
        hours, minutes, (seconds,) = 0, 0, numbers
    return hours * 3_600_000 + minutes * 60_000 + seconds * 1_000 + _milliseconds(fraction)


def _split_fraction(text: str) -> tuple[str, str, str]:
    """A timestamp split at its last comma or full stop."""
    comma, dot = text.rfind(","), text.rfind(".")
    at = max(comma, dot)
    if at < 0:
        return text, "", ""
    return text[:at], text[at], text[at + 1 :]


def _milliseconds(fraction: str) -> int:
    """A millisecond field of one to three digits: ``"5"`` is 500, not 5."""
    if not fraction:
        return 0
    if not fraction.isdigit() or len(fraction) > 3:
        return 0
    return int(fraction.ljust(3, "0"))


def timing_of(line: str) -> tuple[int, int] | None:
    """The two timestamps of a timing line, or ``None`` if it has none.

    Tolerant about what surrounds them: ``00:00:01,000 --> 00:00:03,000
    align:center`` reads the same as the bare arrow, because WebVTT puts its
    settings on the same line and SubRip files in the wild put all sorts there.
    """
    if ARROW not in line:
        return None
    before, _, after = line.partition(ARROW)
    start = timestamp_of(before)
    end = timestamp_of(after.split()[0]) if after.split() else None
    if start is None or end is None:
        return None
    return start, end


def plain_text(text: str, *, unescape_entities: bool = False) -> str:
    """A cue's text as a transcript wants it: no tags, no overrides.

    Args:
        text: One cue's payload, possibly several lines.
        unescape_entities: Whether ``&amp;`` and friends become what they name.
            On for WebVTT, which defines them; off for SubRip, which does not,
            so a file that literally says ``&amp;`` keeps it.
    """
    stripped = _OVERRIDE.sub("", _TAG.sub("", text))
    return unescape(stripped) if unescape_entities else stripped


def unescape(text: str) -> str:
    """The entities WebVTT defines, turned back into what they name."""
    for entity, character in _ENTITIES.items():
        text = text.replace(entity, character)
    return text


def malformed_file(format_name: str, reason: str) -> NovaError:
    """The error for a file that is not the format it claims to be."""
    return NovaError(
        code=ExportErrorCode.MALFORMED_FILE,
        message=f"this is not a {format_name} file: {reason}",
        domain=ErrorDomain.EXPORT,
        remedy="Check that the file is the format you chose, and that it is not empty.",
        retryable=False,
    )


def malformed_cue(format_name: str, number: int, reason: str, *, line: str = "") -> NovaError:
    """The error for one cue that cannot be read, naming the cue and the line."""
    return NovaError(
        code=ExportErrorCode.MALFORMED_CUE,
        message=f"cue {number} of this {format_name} file cannot be read: {reason}",
        domain=ErrorDomain.EXPORT,
        remedy="Fix the cue the message names in a subtitle editor, then import again.",
        details={"cue": number, "line": line},
        retryable=False,
    )


def voice_of(text: str) -> tuple[str, str] | None:
    """A leading ``<v Speaker>`` as ``(speaker, rest)``, if the cue opens one.

    The speaker runs to the end of the cue, which is how the format means it: a
    voice tag is not a span you close, it is the voice of everything after it.
    """
    found = _VOICE.match(text)
    if found is None:
        return None
    return found.group(1).strip(), text[found.end() :]
