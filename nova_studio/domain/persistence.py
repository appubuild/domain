"""L2 — persistence vocabulary: what we store, and the rules for storing it.

This module is the *language* of durable state, and deliberately not the state
itself.  It holds the things a project file and a session database must agree
about — the manifest, a revision, a journal entry, a cache entry — plus the two
policies that are pure decisions rather than I/O (when to checkpoint; what to
evict).  The timeline graph, the caption documents and the project aggregate
arrive later in ``domain/timeline.py``, ``domain/captions.py`` and
``domain/project.py``; they will be persisted through this vocabulary, not
around it.

Three rules from the ADRs are enforced here rather than left to convention:

1. **The document is authoritative, rows are a derived index** (ADR-0004 §3).
   Everything that survives a save therefore has a canonical JSON form defined
   in this module, and every ``from_wire`` rejects a malformed document instead
   of half-parsing it — a timeline laid out against silently-truncated
   structure is the worst failure mode in the app.
2. **Time arrives as data.**  Nothing here reads a clock; every object carries
   the timestamps its creator was given (ADR-0002 rule 1).  That is what makes
   "was this checkpoint taken before or after that edit?" answerable in a test
   without sleeping.
3. **A newer-than-supported format is refused, never partially parsed**
   (ADR-0015 rule 5).  :meth:`ProjectManifest.is_from_a_newer_format` is the
   check; opening such a file is one precise error, not a crash halfway through
   a rebuild.

The document-name helpers carry a security rule as well as a formatting one:
``is_valid_document_name`` rejects absolute paths, ``..`` escapes and
backslashes, because a ``.nova`` file is a ZIP and a crafted entry name is a
classic path-traversal attack (zip-slip).  The name rules live in the domain so
that the adapter and its tests are checked against the same predicate.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from enum import StrEnum
from typing import Final

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.media import ContentHash

__all__ = [
    "CAPTION_PREFIX",
    "CHECKSUM_DOCUMENT",
    "FONT_PREFIX",
    "MANIFEST_DOCUMENT",
    "MEDIA_INDEX_DOCUMENT",
    "MEDIA_PREFIX",
    "PLUGIN_DOCUMENT",
    "PREVIEW_IMAGE",
    "PROJECT_DOCUMENT",
    "REVISION_PREFIX",
    "TEMPLATE_PREFIX",
    "TIMELINE_DOCUMENT",
    "CacheBudget",
    "CacheEntry",
    "CacheKind",
    "CheckpointPolicy",
    "JournalEntry",
    "JournalWindow",
    "ProjectManifest",
    "RevisionRef",
    "caption_document",
    "caption_document",
    "is_valid_document_name",
    "revision_document",
    "revisions_to_prune",
    "select_for_eviction",
]


# -- the fixed layout of a ``.nova`` container (ADR-0015) ----------------------

MANIFEST_DOCUMENT: Final[str] = "manifest.json"
PROJECT_DOCUMENT: Final[str] = "project.json"
TIMELINE_DOCUMENT: Final[str] = "timeline/document.json"
MEDIA_INDEX_DOCUMENT: Final[str] = "media/index.json"
CHECKSUM_DOCUMENT: Final[str] = "checksum.json"
PLUGIN_DOCUMENT: Final[str] = "plugins.json"
PREVIEW_IMAGE: Final[str] = "preview.jpg"

REVISION_PREFIX: Final[str] = "timeline/revisions/"
CAPTION_PREFIX: Final[str] = "captions/"
TEMPLATE_PREFIX: Final[str] = "templates/"
FONT_PREFIX: Final[str] = "fonts/"
MEDIA_PREFIX: Final[str] = "media/"


def revision_document(sequence: int) -> str:
    """The document name of checkpoint ``sequence``.

    Zero-padded so that lexical order equals chronological order — a
    support engineer listing the archive with ``unzip -l`` sees the revisions
    in the order they were taken.
    """
    if sequence < 0:
        raise NovaInvariantError(f"revision sequence must not be negative, got {sequence}")
    return f"{REVISION_PREFIX}{sequence:06d}.json"


def caption_document(document_id: str) -> str:
    """The document name of one caption document."""
    if not document_id or "/" in document_id or "\\" in document_id:
        raise NovaInvariantError(f"caption document id must be a bare name, got {document_id!r}")
    return f"{CAPTION_PREFIX}{document_id}.json"


def is_valid_document_name(name: str) -> bool:
    """Whether ``name`` may be written into a project container.

    Rejects the zip-slip family: absolute paths, ``..`` segments, backslashes,
    drive letters and empty names.  Entry names are relative POSIX paths inside
    the archive; anything else is a crafted file, not a project.
    """
    if not name or name.startswith("/") or ":" in name or "\\" in name:
        return False
    if name.endswith("/"):
        return False
    return all(part not in ("", ".", "..") for part in name.split("/"))


# -- what a project file declares about itself --------------------------------


@dataclass(frozen=True, slots=True)
class ProjectManifest:
    """``manifest.json`` — the identity and format level of a project file.

    ``format_version`` is the number ADR-0015 rule 5 turns into a decision:
    higher than what this build understands means *refuse*, lower means
    *migrate*.  It is stored, never assumed, so a file written in five years
    still says which migration chain applies to it.
    """

    project_id: str
    format_version: int
    app_version: str
    created_ms: int
    modified_ms: int

    def __post_init__(self) -> None:
        if not self.project_id:
            raise NovaInvariantError("a project manifest must carry a project id")
        if self.format_version < 1:
            raise NovaInvariantError(f"format version must be positive, got {self.format_version}")
        if not self.app_version:
            raise NovaInvariantError("a project manifest must record the app version")
        if self.created_ms < 0 or self.modified_ms < 0:
            raise NovaInvariantError("timestamps must not be negative")
        if self.modified_ms < self.created_ms:
            raise NovaInvariantError(
                f"modified_ms must not precede created_ms: {self.modified_ms} < {self.created_ms}"
            )

    def is_from_a_newer_format(self, supported_version: int) -> bool:
        """True when this file was written by a newer Nova Studio than ours.

        The caller refuses to open it (ADR-0015 rule 5) rather than attempting
        a partial parse that would leave the user's project half-loaded.
        """
        return self.format_version > supported_version

    def touched(self, modified_ms: int) -> ProjectManifest:
        """Return the manifest as of ``modified_ms``.

        Refuses to move backwards: a save that went back in time would make the
        "recently modified" ordering of the project manager lie, and the only
        way it can happen is a caller passing the wrong clock.
        """
        if modified_ms < self.modified_ms:
            raise NovaInvariantError(
                f"cannot move modified_ms backwards: {modified_ms} < {self.modified_ms}"
            )
        return replace(self, modified_ms=modified_ms)

    def to_wire(self) -> dict[str, object]:
        """Serialise to the canonical JSON mapping."""
        return {
            "project_id": self.project_id,
            "format_version": self.format_version,
            "app_version": self.app_version,
            "created_ms": self.created_ms,
            "modified_ms": self.modified_ms,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> ProjectManifest:
        """Rebuild from what :meth:`to_wire` wrote."""
        _reject_unknown_fields(data, _MANIFEST_FIELDS)
        return cls(
            project_id=_wire_str(data, "project_id"),
            format_version=_wire_int(data, "format_version"),
            app_version=_wire_str(data, "app_version"),
            created_ms=_wire_int(data, "created_ms"),
            modified_ms=_wire_int(data, "modified_ms"),
        )


@dataclass(frozen=True, slots=True)
class RevisionRef:
    """A checkpoint: one numbered copy of the timeline document.

    Revisions exist so that crash recovery has somewhere to start from and so
    that "go back to how it was an hour ago" is a file read rather than an undo
    stack that dies with the process (ADR-0015 §5–6).
    """

    sequence: int
    recorded_at_ms: int
    label: str = ""
    checksum: ContentHash | None = None

    def __post_init__(self) -> None:
        if self.sequence < 0:
            raise NovaInvariantError(f"revision sequence must not be negative, got {self.sequence}")
        if self.recorded_at_ms < 0:
            raise NovaInvariantError("recorded_at_ms must not be negative")

    @property
    def document_name(self) -> str:
        """Where this revision lives inside the container."""
        return revision_document(self.sequence)

    def to_wire(self) -> dict[str, object]:
        """Serialise to the canonical JSON mapping."""
        return {
            "sequence": self.sequence,
            "recorded_at_ms": self.recorded_at_ms,
            "label": self.label,
            "checksum": self.checksum.to_wire() if self.checksum else None,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> RevisionRef:
        """Rebuild from what :meth:`to_wire` wrote."""
        _reject_unknown_fields(data, _REVISION_FIELDS)
        raw_checksum = data["checksum"]
        if raw_checksum is not None and not isinstance(raw_checksum, Mapping):
            raise NovaInvariantError("checksum must be a mapping or null")
        return cls(
            sequence=_wire_int(data, "sequence"),
            recorded_at_ms=_wire_int(data, "recorded_at_ms"),
            label=_wire_str(data, "label"),
            checksum=ContentHash.from_wire(raw_checksum) if raw_checksum is not None else None,
        )


def revisions_to_prune(revisions: Sequence[RevisionRef], keep: int) -> tuple[RevisionRef, ...]:
    """Return the oldest revisions beyond a bound of ``keep``.

    Bounded history is a size guarantee, not a preference: ``timeline/revisions``
    holds ``keep`` checkpoints (ADR-0015 default 5) and a project that has been
    open for eight hours is not eight hours large.  The returned sequence is
    oldest-first, which is the order a caller deletes in.

    Raises:
        NovaInvariantError: If ``keep`` is less than one — pruning every
            revision would leave crash recovery with nothing to replay onto.
    """
    if keep < 1:
        raise NovaInvariantError(f"must keep at least one revision, got {keep}")
    ordered = sorted(revisions, key=lambda revision: revision.sequence)
    excess = len(ordered) - keep
    return tuple(ordered[:excess]) if excess > 0 else ()


# -- the crash-recovery journal ----------------------------------------------


@dataclass(frozen=True, slots=True)
class JournalEntry:
    """One line of the append-only command journal (NDJSON).

    The journal is what makes a crash a restart rather than a loss (ADR-0015
    rule 6): commands are appended as they are executed, and a checkpoint of
    the document is taken every so often.  Recovery replays the entries after
    the last checkpoint — which is why the sequence number is the entry's
    identity and must never be reused.
    """

    sequence: int
    recorded_at_ms: int
    name: str
    payload: Mapping[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.sequence < 0:
            raise NovaInvariantError(f"journal sequence must not be negative, got {self.sequence}")
        if self.recorded_at_ms < 0:
            raise NovaInvariantError("recorded_at_ms must not be negative")
        if not self.name:
            raise NovaInvariantError("a journal entry must name the command it records")
        if not isinstance(self.payload, Mapping):
            raise NovaInvariantError("payload must be a mapping")
        # Copied, because a frozen dataclass that shares a mapping with its
        # caller is only frozen in name: the caller could still mutate it.
        object.__setattr__(self, "payload", dict(self.payload))

    def to_wire(self) -> dict[str, object]:
        """Serialise to one NDJSON line.

        ``payload`` is copied into a plain dict so that a caller cannot mutate
        a frozen entry through the mapping it handed in.
        """
        return {
            "seq": self.sequence,
            "at_ms": self.recorded_at_ms,
            "name": self.name,
            "payload": dict(self.payload),
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> JournalEntry:
        """Rebuild from what :meth:`to_wire` wrote."""
        _reject_unknown_fields(data, _JOURNAL_FIELDS)
        raw_payload = data["payload"]
        if not isinstance(raw_payload, Mapping):
            raise NovaInvariantError("payload must be a mapping")
        return cls(
            sequence=_wire_int(data, "seq"),
            recorded_at_ms=_wire_int(data, "at_ms"),
            name=_wire_str(data, "name"),
            payload=dict(raw_payload),
        )


@dataclass(frozen=True, slots=True)
class JournalWindow:
    """What a journal read returns: entries, where to continue, and any damage.

    A torn last line is the *expected* state after a crash — the process was
    killed between writing the entry and writing its newline.  Returning it as
    a flag rather than an error is what lets recovery use the entries that did
    make it to disk instead of declaring the whole journal corrupt.
    """

    entries: tuple[JournalEntry, ...] = ()
    #: The sequence to pass to the next read; ``0`` when nothing was read.
    next_sequence: int = 0
    #: True when a partial trailing line was discarded.
    torn_tail: bool = False


@dataclass(frozen=True, slots=True)
class CheckpointPolicy:
    """When to write a checkpoint: whichever limit is reached first.

    Pure decision, no I/O — the service that owns the clock counts commands and
    elapsed time and asks this object.  Keeping the thresholds here means the
    recovery guarantee ("you lose at most N commands or T seconds") is
    reviewable in one line instead of buried in a save loop.
    """

    max_revisions: int = 5
    commands_between_checkpoints: int = 200
    seconds_between_checkpoints: int = 120

    def __post_init__(self) -> None:
        if self.max_revisions < 1:
            raise NovaInvariantError(f"must keep at least one revision, got {self.max_revisions}")
        if self.commands_between_checkpoints < 1:
            raise NovaInvariantError(
                "commands_between_checkpoints must be positive, got "
                f"{self.commands_between_checkpoints}"
            )
        if self.seconds_between_checkpoints < 1:
            raise NovaInvariantError(
                "seconds_between_checkpoints must be positive, got "
                f"{self.seconds_between_checkpoints}"
            )

    def should_checkpoint(self, *, commands_since: int, elapsed_ms: int) -> bool:
        """Whether a checkpoint is due.

        Args:
            commands_since: Commands executed since the last checkpoint.
            elapsed_ms: Milliseconds since the last checkpoint.
        """
        return (
            commands_since >= self.commands_between_checkpoints
            or elapsed_ms >= self.seconds_between_checkpoints * 1000
        )


# -- the cache index ---------------------------------------------------------


class CacheKind(StrEnum):
    """What a cache entry holds.

    Kinds are separate so that a "clear video cache" action can leave the
    waveform peaks alone, and so that a budget can be reasoned about per kind.
    """

    PROXY = "proxy"
    THUMBNAIL = "thumbnail"
    WAVEFORM = "waveform"
    ANALYSIS = "analysis"
    PREVIEW = "preview"


@dataclass(frozen=True, slots=True)
class CacheEntry:
    """One row of ``cache_index``: a derived artefact and its cost.

    Caches are *derived*: everything here can be recomputed, which is why
    eviction is allowed to be aggressive and why ``pinned`` exists — a proxy
    being generated right now must not be evicted from under the job that is
    writing it.
    """

    key: str
    kind: CacheKind
    size_bytes: int
    created_ms: int
    last_used_ms: int
    pinned: bool = False

    def __post_init__(self) -> None:
        if not self.key:
            raise NovaInvariantError("a cache entry must carry a key")
        if self.size_bytes < 0:
            raise NovaInvariantError(f"size_bytes must not be negative, got {self.size_bytes}")
        if self.created_ms < 0 or self.last_used_ms < 0:
            raise NovaInvariantError("timestamps must not be negative")
        if self.last_used_ms < self.created_ms:
            raise NovaInvariantError(
                f"last_used_ms must not precede created_ms: {self.last_used_ms} < {self.created_ms}"
            )

    def touch(self, at_ms: int) -> CacheEntry:
        """Return the entry as last used at ``at_ms``."""
        if at_ms < self.last_used_ms:
            raise NovaInvariantError(
                f"cannot move last_used_ms backwards: {at_ms} < {self.last_used_ms}"
            )
        return replace(self, last_used_ms=at_ms)

    def age_ms(self, now_ms: int) -> int:
        """Milliseconds since the entry was created."""
        return max(0, now_ms - self.created_ms)

    def idle_ms(self, now_ms: int) -> int:
        """Milliseconds since the entry was last used — the eviction ranking key."""
        return max(0, now_ms - self.last_used_ms)

    def to_wire(self) -> dict[str, object]:
        """Serialise to the canonical JSON mapping."""
        return {
            "key": self.key,
            "kind": str(self.kind),
            "size_bytes": self.size_bytes,
            "created_ms": self.created_ms,
            "last_used_ms": self.last_used_ms,
            "pinned": self.pinned,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> CacheEntry:
        """Rebuild from what :meth:`to_wire` wrote."""
        _reject_unknown_fields(data, _CACHE_ENTRY_FIELDS)
        raw_kind = _wire_str(data, "kind")
        raw_pinned = data["pinned"]
        if not isinstance(raw_pinned, bool):
            raise NovaInvariantError("pinned must be a bool")
        try:
            kind = CacheKind(raw_kind)
        except ValueError as error:
            raise NovaInvariantError(f"unknown cache kind {raw_kind!r}") from error
        return cls(
            key=_wire_str(data, "key"),
            kind=kind,
            size_bytes=_wire_int(data, "size_bytes"),
            created_ms=_wire_int(data, "created_ms"),
            last_used_ms=_wire_int(data, "last_used_ms"),
            pinned=raw_pinned,
        )


@dataclass(frozen=True, slots=True)
class CacheBudget:
    """How much derived data we are willing to keep.

    A budget turns "the cache grew until the disk filled up" into a number a
    user can set.  ``max_entries == 0`` means unlimited entries; ``max_bytes``
    is always enforced.
    """

    max_bytes: int
    max_entries: int = 0

    def __post_init__(self) -> None:
        if self.max_bytes <= 0:
            raise NovaInvariantError(f"max_bytes must be positive, got {self.max_bytes}")
        if self.max_entries < 0:
            raise NovaInvariantError(f"max_entries must not be negative, got {self.max_entries}")

    def headroom_bytes(self, used_bytes: int) -> int:
        """Bytes still available before the budget is reached."""
        return max(0, self.max_bytes - used_bytes)

    def needs_eviction(self, used_bytes: int, needed_bytes: int) -> bool:
        """Whether admitting ``needed_bytes`` would break the budget."""
        return used_bytes + needed_bytes > self.max_bytes


def select_for_eviction(
    entries: Sequence[CacheEntry],
    needed_bytes: int,
    budget: CacheBudget,
) -> tuple[CacheEntry, ...]:
    """Choose which cache entries to drop to admit ``needed_bytes``.

    Least-recently-used first, ties broken by oldest creation and then by key so
    the choice is deterministic and a test can assert it exactly.  Pinned
    entries are never chosen — they are in use.

    The function returns the *smallest* set that reaches the budget, not
    everything old: throwing away a whole thumbnail cache to make room for one
    proxy is the kind of policy that makes the editor feel slow for an hour.

    Args:
        entries: Current cache contents.
        needed_bytes: Bytes about to be admitted.
        budget: The byte/entry budget to stay within.

    Returns:
        Entries to delete, oldest-first.  May be empty when nothing needs to go,
        and may be *insufficient* when everything evictable is pinned — the
        caller compares the freed bytes against what it needed and reports
        rather than silently exceeding the budget.
    """
    used_bytes = sum(entry.size_bytes for entry in entries)
    if not budget.needs_eviction(used_bytes, needed_bytes) and not _over_entry_budget(
        len(entries), budget
    ):
        return ()

    # Least-recently-used first: last_used_ms ascending.
    candidates = sorted(
        (entry for entry in entries if not entry.pinned),
        key=lambda entry: (entry.last_used_ms, entry.created_ms, entry.key),
    )

    target = used_bytes + needed_bytes - budget.max_bytes
    if _over_entry_budget(len(entries), budget):
        # Also make room for the entry count, which means evicting at least one.
        target = max(target, 1)

    chosen: list[CacheEntry] = []
    freed = 0
    for entry in candidates:
        if freed >= target and not _over_entry_budget(len(entries) - len(chosen), budget):
            break
        chosen.append(entry)
        freed += entry.size_bytes
    return tuple(chosen)


def _over_entry_budget(count: int, budget: CacheBudget) -> bool:
    return budget.max_entries > 0 and count >= budget.max_entries


# -- wire helpers -------------------------------------------------------------
#
# Shared with ``domain/media.py`` in spirit, duplicated in code: each module
# keeps its own field sets so that adding a field to one document cannot
# silently change what another accepts.

_MANIFEST_FIELDS: Final[set[str]] = {
    "project_id",
    "format_version",
    "app_version",
    "created_ms",
    "modified_ms",
}
_REVISION_FIELDS: Final[set[str]] = {"sequence", "recorded_at_ms", "label", "checksum"}
_JOURNAL_FIELDS: Final[set[str]] = {"seq", "at_ms", "name", "payload"}
_CACHE_ENTRY_FIELDS: Final[set[str]] = {
    "key",
    "kind",
    "size_bytes",
    "created_ms",
    "last_used_ms",
    "pinned",
}


def _reject_unknown_fields(data: Mapping[str, object], expected: set[str]) -> None:
    if set(data) != expected:
        raise NovaInvariantError(
            f"fields must be exactly {sorted(expected)}, got {sorted(str(key) for key in data)}"
        )


def _wire_int(data: Mapping[str, object], key: str) -> int:
    raw = data[key]
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise NovaInvariantError(f"{key!r} must be an int, got {type(raw).__name__}")
    return raw


def _wire_str(data: Mapping[str, object], key: str) -> str:
    raw = data[key]
    if not isinstance(raw, str):
        raise NovaInvariantError(f"{key!r} must be a str, got {type(raw).__name__}")
    return raw
