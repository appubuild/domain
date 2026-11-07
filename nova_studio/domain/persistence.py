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

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from enum import StrEnum
from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain._wire import (
    reject_unknown_fields as _reject_unknown_fields,
    wire_int as _wire_int,
    wire_str as _wire_str,
)
from nova_studio.domain.media import ContentHash

if TYPE_CHECKING:
    from pathlib import Path

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
    "RecentProject",
    "RevisionRef",
    "Setting",
    "caption_document",
    "derived_path",
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


def derived_path(root: Path, kind: CacheKind, key: str) -> Path:
    """Where one derived artefact lives: ``<root>/<kind>/<key>``.

    One rule, in the domain, because two layers need it and they may not
    communicate directly: ``services/media`` decides *which* copy of a file a
    decode should read, and ``infra/persistence`` owns the cache index that
    records whether we still have it. A rule each of them spelled out would
    drift, and the drift would show up as a cache that reports entries it
    cannot find.

    The kind is a subdirectory so that "clear the thumbnail cache" is one
    ``rm`` and not a query, and so that a user cleaning up can see what they
    are about to delete.

    Args:
        root: The cache directory — what the app data layout decides.
        kind: Which family of artefact: the subdirectory.
        key: The artefact's key, which is also its file name.

    Raises:
        NovaInvariantError: The key is not safe to use as a file name. A cache
            key is built by a service from strings that came, ultimately, from
            a file the user picked, so the check is not paranoia — it is the
            same guard a project-id gets, for the same reason.
    """
    if not is_valid_document_name(key):
        raise NovaInvariantError(f"cache key {key!r} cannot be used as a file name")
    return root / str(kind) / key


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


# -- install state (ADR-0004 §6: the global database) -------------------------
#
# The two rows in `nova.db` that are not derived and cannot be recomputed. Both
# are small, both are read at boot, and both are shared by every project — which
# is why they are not in the cache database and not in the project file.

#: A scope or a key is a *name*, not free text: the column is a primary key
#: component and a name that could contain anything is a name that could
#: collide, or be mistaken for another scope's.
_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._:-]{0,63}$")


def is_valid_setting_name(name: str) -> bool:
    """Whether ``name`` may be a scope or a key.

    Lower-case and separated, because the two are compared, sorted and joined in
    a table where ``Install`` and ``install`` would be two settings that look
    like one bug.
    """
    return bool(_NAME_PATTERN.match(name))


@dataclass(frozen=True, slots=True)
class Setting:
    """One key's value, in one scope (ADR-0004 §1, table ``settings``).

    Scoped because a setting is not one namespace: the install has some, a
    project has some, a plugin has some — and a plugin that could write into the
    install's own keys could turn the editor off. *Which* scope a caller may
    write is a rule for the settings service that arrives with the settings
    panel; what this object enforces is the part that is true of every caller:
    a scope and a key are names, and a value is something JSON can spell.
    """

    scope: str
    key: str
    value: object
    updated_ms: int = 0

    def __post_init__(self) -> None:
        if not is_valid_setting_name(self.scope):
            raise NovaInvariantError(f"invalid setting scope {self.scope!r}")
        if not is_valid_setting_name(self.key):
            raise NovaInvariantError(f"invalid setting key {self.key!r}")
        if self.updated_ms < 0:
            raise NovaInvariantError(f"updated_ms must not be negative, got {self.updated_ms}")
        try:
            json.dumps(self.value, allow_nan=False)
        except (TypeError, ValueError) as error:
            # Refused here rather than at the column: a value that cannot be
            # written is a bug in the caller, and a database that stored it
            # would fail on the read, in a different process, with no stack.
            raise NovaInvariantError(
                f"setting {self.scope}/{self.key} is not JSON: {error}"
            ) from error

    @property
    def qualified(self) -> str:
        """The name a log line or an error message uses."""
        return f"{self.scope}/{self.key}"

    def with_value(self, value: object, *, at_ms: int) -> Setting:
        """This key holding ``value``, as of ``at_ms``."""
        return replace(self, value=value, updated_ms=at_ms)

    def to_wire(self) -> dict[str, object]:
        return {
            "scope": self.scope,
            "key": self.key,
            "value": self.value,
            "updated_ms": self.updated_ms,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> Setting:
        _reject_unknown_fields(data, _SETTING_FIELDS)
        return cls(
            scope=_wire_str(data, "scope"),
            key=_wire_str(data, "key"),
            value=data["value"],
            updated_ms=_wire_int(data, "updated_ms"),
        )


@dataclass(frozen=True, slots=True)
class RecentProject:
    """One project this install has seen (ADR-0004 §1, table ``recent_files``).

    Not "the project" — the *file*, keyed by where the user put it. A project
    that was renamed or moved is a different path and therefore a different row,
    which is the honest answer: the editor cannot know that two paths are one
    project without opening both.

    ``dirty`` and ``last_status`` are the last thing this install knew, not a
    promise: another window may have saved since. They exist so the home screen
    can say "unsaved" without opening the file to find out.
    """

    path: str
    project_id: str
    name: str
    opened_ms: int
    closed_ms: int | None = None
    dirty: bool = False
    last_status: str = ""

    def __post_init__(self) -> None:
        if not self.path:
            raise NovaInvariantError("a recent project must carry a path")
        if not self.project_id:
            raise NovaInvariantError("a recent project must carry a project id")
        if not self.name:
            raise NovaInvariantError("a recent project must carry a name")
        if self.opened_ms < 0:
            raise NovaInvariantError(f"opened_ms must not be negative, got {self.opened_ms}")
        if self.closed_ms is not None and self.closed_ms < self.opened_ms:
            raise NovaInvariantError(
                f"closed_ms must not precede opened_ms: {self.closed_ms} < {self.opened_ms}"
            )

    def closed(self, at_ms: int, *, dirty: bool = False) -> RecentProject:
        """This project, closed at ``at_ms``.

        ``dirty`` is passed rather than read from the caller's object because
        the workspace knows the project's state at close, and the row we hold
        may be several sessions old.
        """
        return replace(self, closed_ms=at_ms, dirty=dirty)

    def reopened(self, at_ms: int) -> RecentProject:
        """This project, opened again."""
        return replace(self, opened_ms=at_ms, closed_ms=None)

    def to_wire(self) -> dict[str, object]:
        return {
            "path": self.path,
            "project_id": self.project_id,
            "name": self.name,
            "opened_ms": self.opened_ms,
            "closed_ms": self.closed_ms,
            "dirty": self.dirty,
            "last_status": self.last_status,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> RecentProject:
        _reject_unknown_fields(data, _RECENT_FIELDS)
        raw_closed = data["closed_ms"]
        if raw_closed is not None and not isinstance(raw_closed, int):
            raise NovaInvariantError("closed_ms must be an integer or null")
        return cls(
            path=_wire_str(data, "path"),
            project_id=_wire_str(data, "project_id"),
            name=_wire_str(data, "name"),
            opened_ms=_wire_int(data, "opened_ms"),
            closed_ms=raw_closed,
            dirty=bool(data["dirty"]),
            last_status=_wire_str(data, "last_status"),
        )


_SETTING_FIELDS: Final[set[str]] = {"scope", "key", "value", "updated_ms"}
_RECENT_FIELDS: Final[set[str]] = {
    "path",
    "project_id",
    "name",
    "opened_ms",
    "closed_ms",
    "dirty",
    "last_status",
}


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
