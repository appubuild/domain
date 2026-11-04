"""L3 — export: a transcript as JSON.

The two sidecar formats carry text and timings and throw everything else away.
This one carries a transcript whole — words, characters, speakers, confidence,
which model said it, what it was translated from — because it is written by the
domain itself (:meth:`Transcript.to_wire`) and read back by it
(:meth:`Transcript.from_wire`).

That makes it three different things, and it is worth saying which is which:

* **A cache.** Transcribing an hour of audio costs minutes; reading a file costs
  nothing. A transcript kept next to a project is the difference between
  reopening a project and re-running a model.
* **An interchange.** It is the shape `ExternalTranscriptProvider` reads
  (ADR-0009 §1), so a transcript that came from another tool — a script, a
  subtitle file someone aligned by hand, another editor's export — arrives here
  without a translation layer in between.
* **A bug report.** It is JSON, it is diffable, and it contains nothing the user
  cannot read and scrub before sending.

Reading is strict where the domain is strict and nowhere else: unknown fields
are refused, because a field this build does not know is a transcript from a
newer one, and quietly dropping it is how a speaker label or a character timing
goes missing between two machines.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import ErrorDomain, NovaError, NovaInvariantError
from nova_studio.core.result import Result, failed, ok
from nova_studio.services.export.codes import ExportErrorCode

if TYPE_CHECKING:
    from collections.abc import Mapping

    from nova_studio.domain.asr import Transcript

__all__ = ["from_transcript_json", "to_transcript_json"]

#: How the file is written: indented, and with the text as it was typed.  A
#: one-line file is smaller and no one can read a diff of it.
_INDENT: Final[int] = 2


def to_transcript_json(transcript: Transcript) -> str:
    """A transcript as indented, UTF-8-safe JSON.

    Args:
        transcript: What a provider or a pipeline produced.

    Returns:
        The whole file as text. Non-ASCII is written as it is rather than
        escaped, so a Japanese transcript is a Japanese file.
    """
    return json.dumps(transcript.to_wire(), indent=_INDENT, ensure_ascii=False) + "\n"


def from_transcript_json(text: str) -> Result[Transcript]:
    """Read a transcript from JSON.

    Returns:
        ``Ok`` with the transcript, or ``Err`` with
        :attr:`ExportErrorCode.MALFORMED_JSON` naming the first thing that is
        not as it should be.
    """
    from nova_studio.domain.asr import Transcript as TranscriptType

    try:
        raw = json.loads(text)
    except json.JSONDecodeError as error:
        return failed(
            NovaError(
                code=ExportErrorCode.MALFORMED_JSON,
                message=f"this is not JSON: {error}",
                domain=ErrorDomain.EXPORT,
                remedy="Check the file for a truncated download or a stray comma.",
                retryable=False,
            )
        )
    if not isinstance(raw, dict):
        return failed(
            NovaError(
                code=ExportErrorCode.MALFORMED_JSON,
                message=f"a transcript is a JSON object, got {type(raw).__name__}",
                domain=ErrorDomain.EXPORT,
                remedy="Export a transcript from Nova Studio, or write one in that shape.",
                retryable=False,
            )
        )
    wire: Mapping[str, object] = raw
    try:
        transcript = TranscriptType.from_wire(wire)
    except (NovaInvariantError, KeyError, TypeError, ValueError) as error:
        return failed(
            NovaError(
                code=ExportErrorCode.MALFORMED_JSON,
                message=f"this JSON is not a transcript: {error}",
                domain=ErrorDomain.EXPORT,
                remedy=(
                    "Check the fields against a transcript exported from Nova Studio; "
                    "a field this build does not know means the file came from a newer one."
                ),
                retryable=False,
            )
        )
    return ok(transcript)
