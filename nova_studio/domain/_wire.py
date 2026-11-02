"""Decoding untrusted wire data — shared by every domain module.

Every domain value object round-trips to JSON: the ``.nova`` project document
(ADR-0015), the rows in the project database (ADR-0004), the plugin payloads
(ADR-0011) and the HTTP API (ADR-0005).  That means a ``from_wire`` call is the
*only* place where data written by something else — an older build, a plugin, a
hand-edited file — becomes an object the rest of the system trusts.

So every field is checked at the door, and the checks are strict on purpose:

* **A field that is not recognised is an error, not a silent drop.**  A typo in
  a plugin's JSON that we ignored would resurrect itself as a bug months later,
  in a module that did nothing wrong.
* **A value of the wrong type is an error, never a coercion.**  ``bool`` is not
  an ``int`` here, even though Python says it is, because ``True`` where a
  duration was meant is a corrupted document, not a one.
* **Nothing is optional by accident.**  ``optional_*`` reads a field that must
  be *present* and may legitimately be ``null``; a field that is missing
  entirely raises, because a document written by another build would otherwise
  load half-empty and save back truncated.

These are private to the domain ring: they exist to serve ``from_wire``
methods, and no caller outside this package should import them.
"""

from __future__ import annotations

from collections.abc import Mapping

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.temporal import Rational

__all__ = [
    "optional_float",
    "optional_int",
    "optional_rational",
    "optional_str",
    "reject_unknown_fields",
    "wire_bool",
    "wire_float",
    "wire_int",
    "wire_mappings",
    "wire_rational",
    "wire_str",
]


def reject_unknown_fields(data: Mapping[str, object], expected: set[str]) -> None:
    """Refuse a mapping whose keys are not exactly the ones the version knows."""
    if set(data) != expected:
        raise NovaInvariantError(
            f"fields must be exactly {sorted(expected)}, got {sorted(str(key) for key in data)}"
        )


def wire_int(data: Mapping[str, object], key: str) -> int:
    raw = data[key]
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise NovaInvariantError(f"{key!r} must be an int, got {type(raw).__name__}")
    return raw


def wire_float(data: Mapping[str, object], key: str) -> float:
    raw = data[key]
    if isinstance(raw, bool) or not isinstance(raw, int | float):
        raise NovaInvariantError(f"{key!r} must be a number, got {type(raw).__name__}")
    return float(raw)


def wire_str(data: Mapping[str, object], key: str) -> str:
    raw = data[key]
    if not isinstance(raw, str):
        raise NovaInvariantError(f"{key!r} must be a str, got {type(raw).__name__}")
    return raw


def wire_bool(data: Mapping[str, object], key: str) -> bool:
    raw = data[key]
    if not isinstance(raw, bool):
        raise NovaInvariantError(f"{key!r} must be a bool, got {type(raw).__name__}")
    return raw


def wire_mappings(data: Mapping[str, object], key: str) -> list[Mapping[str, object]]:
    """A repeated field, checked as a list of mappings."""
    raw = data[key]
    if not isinstance(raw, list):
        raise NovaInvariantError(f"'{key}' must be a list, got {type(raw).__name__}")
    for entry in raw:
        if not isinstance(entry, Mapping):
            raise NovaInvariantError(
                f"every entry of '{key}' must be a mapping, got {type(entry).__name__}"
            )
    return [entry for entry in raw if isinstance(entry, Mapping)]


def wire_rational(data: Mapping[str, object], key: str) -> Rational:
    """An exact rational, stored as ``"num/den"`` so no precision is lost."""
    return Rational(wire_str(data, key))


def optional_int(data: Mapping[str, object], key: str) -> int | None:
    return None if data[key] is None else wire_int(data, key)


def optional_float(data: Mapping[str, object], key: str) -> float | None:
    return None if data[key] is None else wire_float(data, key)


def optional_str(data: Mapping[str, object], key: str) -> str | None:
    return None if data[key] is None else wire_str(data, key)


def optional_rational(data: Mapping[str, object], key: str) -> Rational | None:
    return None if data[key] is None else wire_rational(data, key)
