"""L4 — the `.nova` archive: one ZIP, staged writes, one atomic replace.

This is the adapter that decides *how a project's bytes are stored*, and the
format it implements is specified byte by byte in
[`project-file-format.md`](../../../docs/architecture/project-file-format.md).
Every decision below is a consequence of one of that document's rules; where a
rule and a convenience disagree, the rule wins.

**Staging is the whole game.** Nothing a caller writes is durable until
:meth:`ZipProjectArchive.commit`, which writes a temporary file *in the same
directory*, fsyncs it, and `os.replace`s it over the target. A crash can leave a
`.nova.tmp-<token>` file, which is litter; it can never leave a truncated
project, which would be work. This is also why a failed commit leaves the staged
changes in place: the caller may retry, and throwing the work away because the
disk was momentarily full is worse than asking again.

**The document is authoritative and the tables are derived** (ADR-0004 §3), so
the archive never consults a database to answer a question about a project. A
`.nova` file is self-describing: copy it to a USB stick and it opens, with no
sidecar, no registry and no app data directory.

**A newer format is refused whole.** Not partially parsed, not "opened with
warnings": a file written by a build we do not understand is a file we cannot
read correctly, and the honest answer is "update Nova Studio" (rule 5 of the
format's versioning section).

**Checksums are reported, not enforced.** `checksum.json` lets damage in *one*
entry be found, but what that damage means is somebody else's decision: a
corrupt thumbnail is discarded and regenerated, a corrupt caption document is
skipped and named, and a corrupt timeline document is the recovery flow. This
adapter says which entries disagree with their checksums and lets the session
choose the sentence (:meth:`damaged_entries`), because an adapter that decided
severity would be deciding it for the wrong layer.

On reading: the archive loads every JSON document eagerly and leaves blobs on
disk until they are asked for. A project is "tens of kilobytes of JSON" by
design — media is referenced, not embedded — so holding the documents in memory
is cheap, holding embedded proxies would not be.
"""

from __future__ import annotations

import contextlib
import os
import zipfile
from collections.abc import Mapping
from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import ErrorDomain, NovaError, NovaInvariantError
from nova_studio.core.result import Result, failed, ok
from nova_studio.domain.persistence import (
    CAPTION_PREFIX,
    CHECKSUM_DOCUMENT,
    MANIFEST_DOCUMENT,
    MEDIA_PREFIX,
    PROJECT_DOCUMENT,
    REVISION_PREFIX,
    TEMPLATE_PREFIX,
    TIMELINE_DOCUMENT,
    ProjectManifest,
    RevisionRef,
    is_valid_document_name,
    revision_document,
    revisions_to_prune,
)
from nova_studio.infra.persistence import paths
from nova_studio.infra.persistence.canonical import (
    CanonicalJsonError,
    digest_document,
    digest_of,
    dumps_canonical,
    loads_canonical,
)
from nova_studio.infra.persistence.journal import token
from nova_studio.ports.persistence import PersistenceErrorCode

if TYPE_CHECKING:
    from pathlib import Path

__all__ = [
    "DEFAULT_MAX_REVISIONS",
    "SIDECAR_SUBDIR",
    "SUPPORTED_FORMAT_VERSION",
    "ZipProjectArchive",
]

#: The format version this build writes and fully understands.
#:
#: Kept in step with the migration chain in `services/projects/migrations.py`
#: by a test rather than by an import: `infra` is the outer ring and does not
#: depend on `services`, and a constant is the kind of thing two modules can
#: silently disagree about for a year.
SUPPORTED_FORMAT_VERSION: Final[int] = 2

#: How many checkpoints the archive keeps (the format's default, §5.4).
#:
#: Bounded history is a size guarantee: a project open for eight hours is not
#: eight hours large. It is a constructor argument rather than a constant so a
#: caller can ask for more without the adapter growing a settings dependency.
DEFAULT_MAX_REVISIONS: Final[int] = 5

#: Caption sidecars live here and are never read as truth (§5.5).
SIDECAR_SUBDIR: Final[str] = f"{CAPTION_PREFIX}sidecar/"

#: Where the checkpoint *metadata* lives.
#:
#: A revision entry is a plain copy of `timeline/document.json`, byte for byte,
#: because that is the thing a checkpoint exists to preserve: `unzip -p` gives
#: you a timeline, and a diff between two revisions shows an edit. When it was
#: taken and what the user called it are metadata, and metadata does not belong
#: inside a document whose field set the decoder rejects unknown keys over.
#: So they live here, in one small entry beside the revisions they describe.
REVISION_INDEX_DOCUMENT: Final[str] = f"{REVISION_PREFIX}index.json"

#: The order §3 lists the entries in, so `unzip -l` reads top-down. Anything
#: not listed sorts last, alphabetically, which is where a future entry lands
#: until the table is updated.
_ENTRY_ORDER: Final[tuple[str, ...]] = (
    MANIFEST_DOCUMENT,
    PROJECT_DOCUMENT,
    TIMELINE_DOCUMENT,
    CHECKSUM_DOCUMENT,
)

#: Prefixes whose members are ordered after the named entries above.
_PREFIX_ORDER: Final[tuple[str, ...]] = (
    REVISION_PREFIX,
    CAPTION_PREFIX,
    TEMPLATE_PREFIX,
    MEDIA_PREFIX,
)


def _sort_key(name: str) -> tuple[int, int, str]:
    """Where an entry sits in the listing: named entries, then prefixes."""
    if name in _ENTRY_ORDER:
        return (0, _ENTRY_ORDER.index(name), name)
    for rank, prefix in enumerate(_PREFIX_ORDER):
        if name.startswith(prefix):
            return (1, rank, name)
    return (2, 0, name)


class ZipProjectArchive:
    """The `ProjectArchive` port, as a ZIP of canonical-JSON documents.

    Args:
        path: The `.nova` file. It need not exist yet — `commit` creates it.
        supported_format_version: The highest format version this build reads.
            A file declaring a higher one is refused whole.
        max_revisions: How many checkpoints to keep, oldest pruned first.
    """

    def __init__(
        self,
        path: Path,
        *,
        supported_format_version: int = SUPPORTED_FORMAT_VERSION,
        max_revisions: int = DEFAULT_MAX_REVISIONS,
    ) -> None:
        if max_revisions < 1:
            raise ValueError(f"an archive must keep at least one revision, got {max_revisions}")
        self._path = path
        self._supported = supported_format_version
        self._max_revisions = max_revisions
        #: Committed documents, read once on first use.
        self._documents: dict[str, Mapping[str, object]] | None = None
        self._blob_names: set[str] | None = None
        self._damaged: tuple[str, ...] | None = None
        #: Staged writes: documents, blobs and the checkpoints taken with them.
        self._staged_documents: dict[str, Mapping[str, object]] = {}
        self._staged_blobs: dict[str, bytes] = {}
        self._staged_revisions: dict[int, RevisionRef] | None = None
        self._staged_removals: set[str] = set()

    # -- properties --------------------------------------------------------

    @property
    def path(self) -> Path:
        """The file this archive is."""
        return self._path

    @property
    def is_staged(self) -> bool:
        """Whether there is work a `commit` would make durable."""
        return bool(self._staged_documents or self._staged_blobs or self._staged_removals)

    # -- reading -----------------------------------------------------------

    def read_manifest(self) -> Result[ProjectManifest]:
        """The manifest, or the reason this file cannot be opened."""
        problem = self._problem()
        if problem is not None:
            return failed(problem)
        manifest_document = self._document_named(MANIFEST_DOCUMENT)
        if manifest_document is None:
            return failed(
                _corrupt(
                    f"{self._path.name} is not a Nova Studio project: it has no '{MANIFEST_DOCUMENT}'"
                )
            )
        try:
            manifest = ProjectManifest.from_wire(manifest_document)
        except (NovaInvariantError, KeyError, TypeError) as error:
            return failed(_corrupt(f"the manifest of {self._path.name} cannot be read: {error}"))
        if manifest.is_from_a_newer_format(self._supported):
            return failed(_unsupported_version(manifest, self._supported))
        return ok(manifest)

    def read_document(self, name: str) -> Result[Mapping[str, object]]:
        """One canonical-JSON document, staged or committed."""
        if not is_valid_document_name(name):
            return failed(_corrupt(f"{name!r} is not a document name this archive will write"))
        if name in self._staged_removals:
            return failed(_no_such_document(name))
        if name in self._staged_documents:
            return ok(self._staged_documents[name])
        problem = self._problem()
        if problem is not None:
            return failed(problem)
        document = (self._documents or {}).get(name)
        if document is None:
            return failed(_no_such_document(name))
        return ok(document)

    def read_blob(self, name: str) -> Result[bytes]:
        """One binary entry. Blobs are read from the file, not held in memory."""
        if not is_valid_document_name(name):
            return failed(_corrupt(f"{name!r} is not a document name this archive will write"))
        if name in self._staged_blobs:
            return ok(self._staged_blobs[name])
        if name in self._staged_removals or not self._path.exists():
            return failed(_no_such_document(name))
        try:
            with zipfile.ZipFile(self._path) as archive, archive.open(name) as handle:
                return ok(handle.read())
        except (KeyError, zipfile.BadZipFile, OSError) as error:
            return failed(_no_such_document(name, cause=str(error)))

    def revisions(self) -> Result[tuple[RevisionRef, ...]]:
        """The stored checkpoints, oldest first."""
        problem = self._problem()
        if problem is not None:
            return failed(problem)
        revisions = self._committed_revisions()
        if self._staged_revisions is not None:
            revisions.update(self._staged_revisions)
        for sequence in tuple(revisions):
            name = revision_document(sequence)
            if name in self._staged_removals:
                del revisions[sequence]
        return ok(tuple(sorted(revisions.values(), key=lambda item: item.sequence)))

    def caption_document_ids(self) -> Result[tuple[str, ...]]:
        """The ids of the caption documents this archive holds.

        `project.json` deliberately does not list them, so the container is the
        only thing that knows. Entries under `captions/sidecar/` are exported
        copies and are ignored, exactly as §5.5 requires.
        """
        problem = self._problem()
        if problem is not None:
            return failed(problem)
        ids: set[str] = set()
        names = set(self._documents or ()) | set(self._staged_documents)
        for name in names:
            if not name.startswith(CAPTION_PREFIX) or name in self._staged_removals:
                continue
            if name.startswith(SIDECAR_SUBDIR):
                continue
            body = name[len(CAPTION_PREFIX) :]
            if "/" in body or not body.endswith(".json"):
                return failed(
                    _corrupt(
                        f"{name!r} is not a caption document; a project's captions are "
                        f"filed as '{CAPTION_PREFIX}<id>.json'"
                    )
                )
            ids.add(body[: -len(".json")])
        return ok(tuple(sorted(ids)))

    def damaged_entries(self) -> Result[tuple[str, ...]]:
        """The entries whose bytes disagree with `checksum.json`.

        An empty tuple is the common answer and means the file is intact — or
        carries no checksums at all, which is allowed (§5.8). Damage is reported
        rather than raised because the *meaning* of a damaged entry is a
        decision for the layer above: regenerate, skip or recover.
        """
        if self._damaged is not None:
            return ok(self._damaged)
        problem = self._problem()
        if problem is not None:
            return failed(problem)
        checksums = self._document_named(CHECKSUM_DOCUMENT)
        self._damaged = () if checksums is None else _damaged(checksums, self._path)
        return ok(self._damaged)

    # -- staged writes -----------------------------------------------------

    def write_manifest(self, manifest: ProjectManifest) -> Result[None]:
        """Stage the manifest."""
        return self.write_document(MANIFEST_DOCUMENT, manifest.to_wire())

    def write_document(self, name: str, document: Mapping[str, object]) -> Result[None]:
        """Stage one canonical-JSON document."""
        if not is_valid_document_name(name):
            return failed(_corrupt(f"{name!r} is not a document name this archive will write"))
        try:
            # Serialised now rather than at commit: a document that cannot be
            # written is a bug in the caller, and finding out at commit time —
            # after twenty others have been staged — is finding out too late.
            dumps_canonical(document)
        except CanonicalJsonError as error:
            return failed(_corrupt(str(error), name=name))
        self._staged_documents[name] = document
        self._staged_removals.discard(name)
        return ok(None)

    def write_blob(self, name: str, data: bytes) -> Result[None]:
        """Stage one binary entry."""
        if not is_valid_document_name(name):
            return failed(_corrupt(f"{name!r} is not a document name this archive will write"))
        self._staged_blobs[name] = bytes(data)
        self._staged_removals.discard(name)
        return ok(None)

    def checkpoint(self, *, recorded_at_ms: int, label: str = "") -> Result[RevisionRef]:
        """Stage the current timeline document as the next numbered revision.

        The revision is a copy of `timeline/document.json` as it stands — staged
        writes included — so a checkpoint taken after an edit records that edit.
        Pruning to the bound happens here, in the same breath, because a bounded
        set that is pruned by a different call is a set that is sometimes not
        bounded.
        """
        current = self.read_document(TIMELINE_DOCUMENT)
        problem = current.error()
        if problem is not None:
            return failed(problem)
        document = current.unwrap()
        existing = self.revisions()
        problem = existing.error()
        if problem is not None:
            return failed(problem)
        known = existing.unwrap()
        sequence = (known[-1].sequence + 1) if known else 1
        staged = dict(self._staged_revisions or self._committed_revisions())
        staged[sequence] = RevisionRef(
            sequence=sequence,
            recorded_at_ms=recorded_at_ms,
            label=label,
            checksum=digest_document(document),
        )
        for stale in revisions_to_prune(
            tuple(sorted(staged.values(), key=lambda item: item.sequence)),
            keep=self._max_revisions,
        ):
            self._staged_removals.add(staged.pop(stale.sequence).document_name)
        self._staged_revisions = staged
        problem = self.write_document(revision_document(sequence), document).error()
        if problem is not None:
            return failed(problem)
        problem = self._write_revision_index(staged).error()
        if problem is not None:
            return failed(problem)
        return ok(staged[sequence])

    def restore(self, sequence: int) -> Result[Mapping[str, object]]:
        """Stage revision ``sequence`` as the current timeline document.

        Staged, not committed: recovery always offers the user a look before it
        overwrites anything.
        """
        known = self.revisions()
        problem = known.error()
        if problem is not None:
            return failed(problem)
        revision = next((item for item in known.unwrap() if item.sequence == sequence), None)
        if revision is None:
            return failed(_no_such_revision(sequence))
        restored = self.read_document(revision.document_name)
        problem = restored.error()
        if problem is not None:
            return failed(problem)
        problem = self.write_document(TIMELINE_DOCUMENT, restored.unwrap()).error()
        if problem is not None:
            return failed(problem)
        return ok(restored.unwrap())

    # -- lifecycle ---------------------------------------------------------

    def commit(self) -> Result[None]:
        """Write every staged change atomically, fsync, and replace the target.

        Nothing is written when nothing is staged: a save of an unchanged project
        is a no-op, which is what lets autosave call this on a timer without
        wearing out a disk or changing a file's mtime and making a backup tool
        think something happened.
        """
        if not self.is_staged:
            return ok(None)
        # Loaded, but not *refused*: a save does not read the project, and a
        # caller staging a manifest is allowed to write a version this build
        # would refuse to open — that is what a format converter does.
        problem = self._load_problem()
        if problem is not None:
            return failed(problem)
        merged = dict(self._documents or {})
        merged.update(self._staged_documents)
        for name in self._staged_removals:
            merged.pop(name, None)
        blob_names = (self._blob_names or set()) | set(self._staged_blobs)
        blob_names -= self._staged_removals

        try:
            payloads = {name: dumps_canonical(document) for name, document in merged.items()}
            blobs = {name: self._blob_bytes(name) for name in sorted(blob_names)}
        except CanonicalJsonError as error:
            return failed(_corrupt(str(error)))

        checksums = {
            name: digest_of(data).digest
            for name, data in payloads.items()
            if name != CHECKSUM_DOCUMENT
        }
        checksums.update({name: digest_of(data).digest for name, data in blobs.items()})
        payloads[CHECKSUM_DOCUMENT] = dumps_canonical({"algorithm": "sha256", "entries": checksums})

        target = self._path
        staged = paths.temp_path(target, token())
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(staged, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for name in sorted(payloads, key=_sort_key):
                    archive.writestr(name, payloads[name])
                for name in sorted(blobs, key=_sort_key):
                    # Already compressed, and mappable by a thumbnailer.
                    archive.writestr(name, blobs[name], compress_type=zipfile.ZIP_STORED)
            with open(staged, "rb") as handle:  # noqa: PTH123 - fsync needs the fd
                os.fsync(handle.fileno())
            if target.exists():
                _copy_to_backup(target)
            staged.replace(target)
            _fsync_directory(target.parent)
        except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile) as error:
            _discard(staged)
            return failed(_io_failed(f"{target.name} could not be saved", str(error)))

        self._documents = merged
        self._blob_names = blob_names
        self._staged_documents.clear()
        self._staged_blobs.clear()
        self._staged_removals.clear()
        self._staged_revisions = None
        self._damaged = None
        return ok(None)

    def discard(self) -> None:
        """Drop every staged change, leaving the file as it was."""
        self._staged_documents.clear()
        self._staged_blobs.clear()
        self._staged_removals.clear()
        self._staged_revisions = None

    def close(self) -> None:
        """Release the archive. Staged changes are *not* committed by this."""
        self._documents = None
        self._blob_names = None
        self._damaged = None

    # -- internals ---------------------------------------------------------

    def _problem(self) -> NovaError | None:
        """Why this file cannot be *read*: it will not load, or it is from the future.

        The refusal is decided here and nowhere else, so that it is whole rather
        than per-call: once the manifest says this project was written by a newer
        build, no document in it may be read. Half-parsing a file we do not
        understand is how a project quietly loses the parts that were new.
        """
        problem = self._load_problem()
        if problem is not None:
            return problem
        return self._refusal()

    def _load_problem(self) -> NovaError | None:
        """Load the committed state, returning the reason it cannot be loaded."""
        if self._documents is None:
            load = self._load()
            return load.error()
        return None

    def _refusal(self) -> NovaError | None:
        """Whether this file is from a newer Nova Studio than ours."""
        manifest_document = self._document_named(MANIFEST_DOCUMENT)
        if manifest_document is None:
            return None
        try:
            manifest = ProjectManifest.from_wire(manifest_document)
        except (NovaInvariantError, KeyError, TypeError):
            return None
        if manifest.is_from_a_newer_format(self._supported):
            return _unsupported_version(manifest, self._supported)
        return None

    def _load(self) -> Result[None]:
        """Read the committed state once, lazily."""
        if self._documents is not None:
            return ok(None)
        self._documents = {}
        self._blob_names = set()
        if not self._path.exists():
            return ok(None)
        try:
            with zipfile.ZipFile(self._path) as archive:
                names = archive.namelist()
                for name in names:
                    if not is_valid_document_name(name):
                        return failed(
                            _corrupt(
                                f"{self._path.name} holds an entry named {name!r}, "
                                "which no project we wrote would contain"
                            )
                        )
                for name in names:
                    if name.endswith(".json"):
                        try:
                            self._documents[name] = loads_canonical(archive.read(name))
                        except CanonicalJsonError as error:
                            return failed(_corrupt(str(error), name=name))
                    else:
                        self._blob_names.add(name)
        except zipfile.BadZipFile as error:
            return failed(_corrupt(f"{self._path.name} is not a project file: {error}"))
        except OSError as error:
            return failed(_io_failed(f"{self._path.name} could not be read", str(error)))
        return ok(None)

    def _document_named(self, name: str) -> Mapping[str, object] | None:
        if name in self._staged_documents:
            return self._staged_documents[name]
        return (self._documents or {}).get(name)

    def _committed_revisions(self) -> dict[int, RevisionRef]:
        """The checkpoints the file on disk holds, keyed by sequence.

        Read from the index when it is there, and derived from the entry names
        when it is not: a project whose index was lost still has its checkpoints,
        and "when was this taken" is a question we can survive not answering.
        """
        revisions: dict[int, RevisionRef] = {}
        index = (self._documents or {}).get(REVISION_INDEX_DOCUMENT)
        if index is not None:
            raw = index.get("revisions")
            if isinstance(raw, list):
                for item in raw:
                    if not isinstance(item, Mapping):
                        continue
                    try:
                        revision = RevisionRef.from_wire(item)
                    except (NovaInvariantError, KeyError, TypeError):
                        continue
                    revisions[revision.sequence] = revision
        for name in self._documents or {}:
            if not name.startswith(REVISION_PREFIX) or not name.endswith(".json"):
                continue
            body = name[len(REVISION_PREFIX) : -len(".json")]
            if not body.isdigit():
                continue
            sequence = int(body)
            if sequence not in revisions:
                revisions[sequence] = RevisionRef(sequence=sequence, recorded_at_ms=0)
        return revisions

    def _write_revision_index(self, revisions: Mapping[int, RevisionRef]) -> Result[None]:
        """Stage the metadata for every checkpoint, oldest first."""
        ordered = sorted(revisions.values(), key=lambda item: item.sequence)
        return self.write_document(
            REVISION_INDEX_DOCUMENT,
            {"revisions": [item.to_wire() for item in ordered]},
        )

    def _blob_bytes(self, name: str) -> bytes:
        if name in self._staged_blobs:
            return self._staged_blobs[name]
        with zipfile.ZipFile(self._path) as archive, archive.open(name) as handle:
            return handle.read()


def _damaged(checksums: Mapping[str, object], path: Path) -> tuple[str, ...]:
    """The entries whose bytes no longer match the digests on file."""
    entries = checksums.get("entries")
    if not isinstance(entries, Mapping):
        return ()
    damaged: list[str] = []
    for name, expected in entries.items():
        if not isinstance(name, str) or not isinstance(expected, str):
            continue
        actual = _digest_entry(path, name)
        if actual is None or actual != expected:
            damaged.append(name)
    return tuple(sorted(damaged))


def _digest_entry(path: Path, name: str) -> str | None:
    try:
        with zipfile.ZipFile(path) as archive, archive.open(name) as handle:
            return digest_of(handle.read()).digest
    except (KeyError, zipfile.BadZipFile, OSError):
        # An entry that has gone away is damaged by any definition, and one we
        # cannot open is not something a checksum can clear.
        return None


def _copy_to_backup(target: Path) -> None:
    """Keep the previous version until the new one has been verified."""
    backup = paths.backup_path(target)
    with open(target, "rb") as source, open(backup, "wb") as sink:  # noqa: PTH123 - fsync
        while chunk := source.read(1024 * 1024):
            sink.write(chunk)
        sink.flush()
        os.fsync(sink.fileno())


def _fsync_directory(directory: Path) -> None:
    """Fsync a directory so the rename is durable, not merely visible."""
    try:
        handle = os.open(directory, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(handle)
    except OSError:
        pass
    finally:
        os.close(handle)


def _discard(path: Path) -> None:
    with contextlib.suppress(OSError):
        path.unlink(missing_ok=True)


def _corrupt(message: str, *, name: str = "") -> NovaError:
    """The bytes are not a project, or are not the project they claim to be."""
    return NovaError(
        PersistenceErrorCode.CORRUPT,
        message,
        domain=ErrorDomain.STORAGE,
        details={"document": name} if name else None,
        remedy="Open the project from a checkpoint, or restore it from a backup.",
        retryable=False,
    )


def _unsupported_version(manifest: ProjectManifest, supported: int) -> NovaError:
    """A file written by a build newer than ours. Refused whole, never parsed."""
    return NovaError(
        PersistenceErrorCode.UNSUPPORTED_VERSION,
        f"this project was written by a newer Nova Studio "
        f"(format {manifest.format_version}, this build reads {supported})",
        domain=ErrorDomain.STORAGE,
        details={
            "format_version": manifest.format_version,
            "supported_format_version": supported,
        },
        remedy="Update Nova Studio to open this project.",
        retryable=False,
    )


def _no_such_document(name: str, *, cause: str = "") -> NovaError:
    """An entry this archive does not hold."""
    return NovaError(
        PersistenceErrorCode.CORRUPT,
        f"this project holds no entry named '{name}'",
        domain=ErrorDomain.STORAGE,
        details={"document": name, **({"cause": cause} if cause else {})},
        retryable=False,
    )


def _no_such_revision(sequence: int) -> NovaError:
    """A checkpoint that was never taken."""
    return NovaError(
        PersistenceErrorCode.NO_SUCH_REVISION,
        f"this project has no checkpoint {sequence}",
        domain=ErrorDomain.STORAGE,
        details={"sequence": sequence},
        remedy="Choose an earlier checkpoint, or open the project as it stands.",
        retryable=False,
    )


def _io_failed(message: str, cause: str) -> NovaError:
    """The disk, the permissions or another process said no. Retryable."""
    return NovaError(
        PersistenceErrorCode.IO_FAILED,
        message,
        domain=ErrorDomain.STORAGE,
        details={"cause": cause},
        remedy="Check that the file is writable and the disk is not full, then try again.",
        retryable=True,
    )
