"""L3 — export error codes (`NS-EXPORT-60xx`).

One enum for the whole feature, for the same reason `services/captions/codes.py`
gives: a UI that has to map four modules onto four tables renders four different
versions of "could not finish", and a user who reads four versions learns none
of them.

The band starts at ``6001`` because the numbers under it are taken — ``40xx`` is
caption authoring, ``50xx`` is media and jobs — and an export code that shares a
number with a caption code is a bug report nobody can route.

Every member answers the three questions a user is really asking:

* **Can I retry?** A deterministic failure says no; offering a button is a lie.
* **What do I do?** ``remedy`` lives on the error, not here — the enum cannot
  know which layer the project has.
* **Which part broke?** ``details`` carries the layer, the cue, the format.
"""

from __future__ import annotations

from enum import StrEnum

__all__ = ["ExportErrorCode"]


class ExportErrorCode(StrEnum):
    """What can go wrong writing captions out."""

    #: The document has no layer with the id that was asked for. A project whose
    #: translation was deleted between the export dialog and the click.
    LAYER_NOT_FOUND = "NS-EXPORT-6001"
    #: The layer exists and holds nothing. Refused rather than written as an
    #: empty file, because an empty sidecar is discovered at the worst possible
    #: moment — after the video has been uploaded.
    EMPTY_LAYER = "NS-EXPORT-6002"
    #: The cues of this layer cannot be rendered: they overlap, or one of them
    #: is too short to read or too fast to read. A player will do something with
    #: such a file, and never what the editor meant.
    INVALID_DOCUMENT = "NS-EXPORT-6003"
    #: A format was asked for that this build cannot write.
    UNKNOWN_FORMAT = "NS-EXPORT-6004"
    #: A file that is not the format it claims to be: no WebVTT header, or not
    #: one cue anywhere in it.  Reported with the reason, because "could not
    #: import" is not a sentence anyone can act on.
    MALFORMED_FILE = "NS-EXPORT-6005"
    #: One cue that cannot be read: a timing line that is not a timing line, an
    #: end before its start, or a cue that overlaps the one before it.  The cue
    #: and the line are named, so the user is pointed at a place in the file.
    MALFORMED_CUE = "NS-EXPORT-6006"
    #: A JSON transcript that does not describe one: unknown fields, a wrong
    #: type, a timestamp that is not a number.
    MALFORMED_JSON = "NS-EXPORT-6007"
