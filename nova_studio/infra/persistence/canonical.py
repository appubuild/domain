"""L4 — canonical JSON: the byte-level spelling of a project document.

`docs/architecture/project-file-format.md` §4 makes canonical JSON a *format*
property rather than a stylistic one, and it buys two things that a video editor
needs and a normal JSON dump does not give:

* **A checksum over a document is stable across saves and across machines.** Two
  saves of an unchanged project are byte-identical, so "has this project
  changed" is a hash comparison and not a structural diff. That is what makes
  autosave able to skip a write, and what makes a corruption check possible at
  all: a checksum over bytes that shuffle every time is noise.
* **`diff` between two revisions shows the edit and nothing else.** A support
  engineer attaching a project to a bug report, and a user looking at what
  changed overnight, are both reading the same file.

The rules, and why each one is here:

1. **Keys sorted** — at every depth, so a document rebuilt from a dict with a
   different insertion order serialises to the same bytes.
2. **No insignificant whitespace** — `,` and `:` with nothing after them.
3. **UTF-8, no BOM, `LF`, one trailing newline.** The trailing newline is what
   keeps the file a text file: `unzip -p project.nova timeline/document.json`
   ends the way a person expects.
4. **No `NaN`, `Infinity` or `-Infinity`.** JSON has no such literals, so a
   writer that emits them has written a file no other reader can parse. This is
   refused loudly here, at the boundary, rather than producing a `.nova` that
   opens in Nova Studio and nowhere else.
5. **Integers stay integers.** Nothing in a project is a float that could come
   back as `30.000000000000004`, which is why rational time travels as a
   two-element array (`[30000, 1001]`) rather than as a decimal.

Reading is stricter than `json.loads` by default: `NaN` and `Infinity` are
*accepted* by the standard library and are the reason rule 4 has to be enforced
in both directions. A file containing them was not written by us.
"""

from __future__ import annotations

import hashlib
import json
from typing import TYPE_CHECKING, Any, Final

from nova_studio.domain.media import ContentHash, ContentHashAlgorithm

if TYPE_CHECKING:
    from collections.abc import Mapping

__all__ = [
    "CanonicalJsonError",
    "digest_document",
    "digest_of",
    "dumps_canonical",
    "loads_canonical",
]

#: The separators canonical JSON uses: no whitespace anywhere.
_SEPARATORS: Final[tuple[str, str]] = (",", ":")


class CanonicalJsonError(ValueError):
    """Bytes that are not canonical JSON, or a document that cannot be one.

    A `ValueError` subclass so the archive can convert every spelling of "these
    bytes are not a project document" in one `except` clause — a JSON syntax
    error, a UTF-8 error and a `NaN` are three stdlib exceptions that a caller
    cannot act on differently.
    """


def dumps_canonical(document: Mapping[str, object]) -> bytes:
    """Serialise one document to canonical JSON bytes.

    Args:
        document: The mapping a domain `to_wire()` produced: plain dicts, lists,
            strings, integers, booleans and `None`, with rationals already
            written as two-element integer arrays.

    Raises:
        CanonicalJsonError: The document holds a float that has no JSON
            spelling (`NaN`, `Infinity`) or a value JSON cannot represent.
    """
    try:
        text = json.dumps(
            document,
            ensure_ascii=False,
            separators=_SEPARATORS,
            sort_keys=True,
            allow_nan=False,
        )
    except (TypeError, ValueError) as error:
        raise CanonicalJsonError(f"this document cannot be written as JSON: {error}") from error
    return text.encode("utf-8") + b"\n"


def loads_canonical(data: bytes) -> Mapping[str, object]:
    """Parse one canonical JSON document.

    Raises:
        CanonicalJsonError: The bytes are not UTF-8, not JSON, not a JSON
            *object*, or contain a literal JSON has no spelling for.
    """

    def reject_constant(name: str) -> Any:
        raise CanonicalJsonError(f"JSON has no spelling for {name}: these bytes are corrupt")

    try:
        document = json.loads(
            data.decode("utf-8"),
            parse_constant=reject_constant,
        )
    except UnicodeDecodeError as error:
        raise CanonicalJsonError("this document is not UTF-8") from error
    except json.JSONDecodeError as error:
        raise CanonicalJsonError(f"this document is not JSON: {error}") from error
    except CanonicalJsonError:
        raise
    if not isinstance(document, dict):
        raise CanonicalJsonError("a project document is a JSON object, not a list or a scalar")
    return document


def digest_of(data: bytes) -> ContentHash:
    """The SHA-256 of some bytes, named with the algorithm that produced it.

    The algorithm travels with the digest so that a project written years ago
    stays verifiable after the default changes.
    """
    return ContentHash(
        digest=hashlib.sha256(data).hexdigest(),
        algorithm=ContentHashAlgorithm.SHA256,
    )


def digest_document(document: Mapping[str, object]) -> ContentHash:
    """The digest of a document *as it is written* — canonical bytes and all.

    Digesting the dictionary instead would answer a different question: two
    dicts with different key orders are equal but are not the same bytes, and
    the whole point of a checksum on disk is the bytes.
    """
    return digest_of(dumps_canonical(document))
