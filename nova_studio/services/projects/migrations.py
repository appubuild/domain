"""L3 — project migrations: the ordered chain that keeps an old file readable.

A project file outlives the code that wrote it. Ten years of format evolution is
a stated requirement, and the only way to honour it is to make "the model gained
a field" a non-event for everyone who saved a project last week. So
`docs/architecture/project-file-format.md` §7 puts a number in the manifest and
an ordered chain of pure functions behind it, and this module is that chain.

The rules it keeps:

* **A migration is a pure function** from one mapping to another. No clock, no
  filesystem, no network — which is what makes it unit-testable against a
  fixture and safe to run on a file the user cannot afford to lose.
* **One step per version.** ``v1 → v2`` is one function that does one thing, so
  a project written at v1 and read by a v4 build goes ``1→2→3→4`` and each step
  is the same function that was tested when it was written.
* **Only forward.** There is no downgrade: an older build refuses a newer file
  by version, so a backward step would never be asked for.
* **A gap is an error, and a loud one.** A chain with a missing link fails
  rather than handing the decoder a document in a version it does not
  understand, because a half-migrated project is a corrupted one.

A migration runs on a **document**, not on the archive: the reader hands it the
mapping it just read and gets back the mapping the decoder expects. Which keeps
this module ignorant of ZIPs, paths and manifests.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import ErrorDomain, NovaError, NovaInvariantError
from nova_studio.core.result import Result, failed, ok

if TYPE_CHECKING:
    from collections.abc import Callable

__all__ = [
    "MIGRATIONS",
    "MIGRATION_FAILED",
    "DocumentKind",
    "DocumentMigration",
    "migrated",
    "migrations_between",
]

#: A migration that could not be applied. The project is left alone; the caller
#: decides whether that is fatal (the timeline) or a warning (one caption
#: document among several).
MIGRATION_FAILED: Final[str] = "NS-PROJECT-4005"


class DocumentKind(StrEnum):
    """Which kind of document a migration rewrites.

    A kind rather than a free string so that a migration naming a document that
    does not exist is a typo the type checker sees.
    """

    PROJECT = "project"
    TIMELINE = "timeline"
    CAPTIONS = "captions"


@dataclass(frozen=True, slots=True)
class DocumentMigration:
    """One step: this document, from this version to the next."""

    from_version: int
    to_version: int
    kind: DocumentKind
    #: What it does, in the language of the changelog rather than of the code.
    description: str
    transform: Callable[[Mapping[str, object]], Mapping[str, object]]

    def __post_init__(self) -> None:
        if self.to_version != self.from_version + 1:
            raise NovaInvariantError(
                f"a migration moves one version at a time, "
                f"got {self.from_version} → {self.to_version}"
            )

    def __call__(self, document: Mapping[str, object]) -> Mapping[str, object]:
        return self.transform(document)


# -- the chain ---------------------------------------------------------------


def _captions_gain_an_emoji(document: Mapping[str, object]) -> Mapping[str, object]:
    """v1 → v2: every cue gains an empty ``emoji``.

    Before the Emoji stage (ADR-0009 §3) a cue had nowhere to put one, so a
    document written at v1 has no such key and the decoder — which rejects a
    mapping whose keys are not exactly the ones its version declares — would
    refuse the whole document, taking every caption in the project with it.
    The field's default is exactly what those projects had: none.
    """
    segments = document.get("segments")
    if not isinstance(segments, list):
        return document
    upgraded = []
    for entry in segments:
        if isinstance(entry, Mapping) and "emoji" not in entry:
            upgraded.append({**entry, "emoji": ""})
        else:
            upgraded.append(entry)
    return {**document, "segments": upgraded}


#: Every migration this build knows, in the order it was written.
MIGRATIONS: Final[tuple[DocumentMigration, ...]] = (
    DocumentMigration(
        from_version=1,
        to_version=2,
        kind=DocumentKind.CAPTIONS,
        description="every cue gains an empty emoji",
        transform=_captions_gain_an_emoji,
    ),
)


def migrations_between(
    kind: DocumentKind, from_version: int, to_version: int
) -> Result[tuple[DocumentMigration, ...]]:
    """The steps that carry a document of ``kind`` from one version to another.

    Returns ``Err`` when a link in the chain does not exist, or when the walk is
    backwards — a project whose format is newer than this build is refused by
    version long before it reaches here, so the only way to ask for a downgrade
    is a bug in the caller.
    """
    if from_version == to_version:
        return ok(())
    if to_version < from_version:
        return failed(
            _migration_failed(
                f"a {kind} document cannot be taken backwards from v{from_version} to v{to_version}"
            )
        )
    steps: list[DocumentMigration] = []
    at = from_version
    while at < to_version:
        step = next(
            (
                migration
                for migration in MIGRATIONS
                if migration.kind is kind
                and migration.from_version == at
                and migration.to_version <= to_version
            ),
            None,
        )
        if step is None:
            return failed(
                _migration_failed(
                    f"no migration takes a {kind} document from v{at} to v{at + 1}, "
                    f"so v{from_version} cannot be read",
                    remedy="Open the project with a build that understands this version.",
                )
            )
        steps.append(step)
        at = step.to_version
    return ok(tuple(steps))


def migrated(
    kind: DocumentKind,
    document: Mapping[str, object],
    *,
    from_version: int,
    to_version: int,
) -> Result[Mapping[str, object]]:
    """A document as this build's decoder expects it.

    A document already at the target version is returned untouched — the common
    case, and one worth not copying a megabyte of JSON for.
    """
    steps = migrations_between(kind, from_version, to_version)
    error = steps.error()
    if error is not None:
        return failed(error)
    for step in steps.unwrap():
        document = step(document)
    return ok(document)


def _migration_failed(message: str, *, remedy: str = "") -> NovaError:
    return NovaError(
        code=MIGRATION_FAILED,
        message=message,
        domain=ErrorDomain.PROJECT,
        remedy=remedy,
        retryable=False,
    )
