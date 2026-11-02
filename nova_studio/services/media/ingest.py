"""L3 — ingest: turning a pile of paths into assets.

Import is the first thing a user does and the fastest way to convince them the
tool is broken: they select forty files, three of them are a README, a half-written
download and a folder, and the editor either imports thirty-seven or refuses the
lot.  This module is why Nova Studio imports thirty-seven and *says* which three
did not make it.

Three rules, all of them the same rule really:

1. **A batch never fails as a batch.**  One unreadable file is one
   :class:`IngestFailure` beside thirty-nine assets.  The probe port already
   returns ``Result[MediaInfo]`` per path, so the failure is there for the
   taking — the discipline is not to collapse it into a single ``Err``.
2. **The probe decides what a file is.**  Never the suffix (``domain/media.py``:
   suffixes lie).  An import therefore performs one probe per path and adopts
   the ``AssetKind`` it comes back with, which is why a ``.mov`` carrying only
   audio lands in the audio bin.
3. **Import is not undo, and it is not a project mutation.**  It returns assets;
   the caller decides what to do with them.  Adding them to a project is a
   command (ADR-0008) and belongs to the timeline service, which owns the edit.

What is deliberately *not* here: content hashing.  ADR-0015 wants a SHA-256 per
asset so a relink can be proved rather than hoped, and ``ContentHash`` exists in
the domain for exactly that — but hashing a file is I/O, and the port that would
carry it (``ports/filesystem.py``, alongside thumbnails and file watching) does
not exist yet.  Duplicates are therefore matched **by path** today, and the
media panel will say so rather than pretending otherwise.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import PurePath
from typing import TYPE_CHECKING

from nova_studio.core.errors import ErrorDomain, NovaError
from nova_studio.domain.media import AssetKind, MediaAsset

if TYPE_CHECKING:
    from collections.abc import Sequence

    from nova_studio.ports.ident import IdSource
    from nova_studio.ports.media import MediaProber

__all__ = [
    "IngestFailure",
    "IngestReport",
    "IngestedAsset",
    "MediaIngestor",
]

#: Shown when a path is empty, before any I/O is attempted.
_EMPTY_PATH = "NS-MEDIA-4001"


@dataclass(frozen=True, slots=True, kw_only=True)
class IngestedAsset:
    """One file that made it in, and anything odd about it."""

    asset: MediaAsset
    #: Things worth telling the user that are not reasons to refuse.
    warnings: tuple[str, ...] = ()

    @property
    def path(self) -> str:
        """Where the asset came from, for the report and the panel."""
        return self.asset.path


@dataclass(frozen=True, slots=True, kw_only=True)
class IngestFailure:
    """One file that did not, and why."""

    path: str
    error: NovaError

    @property
    def code(self) -> str:
        """The failure's code, which the frontend maps to a local message."""
        return self.error.code


@dataclass(frozen=True, slots=True, kw_only=True)
class IngestReport:
    """What a whole import produced."""

    entries: tuple[IngestedAsset, ...] = ()
    failures: tuple[IngestFailure, ...] = ()
    #: Paths skipped because the same path was already in the project, or was
    #: offered twice in one selection.
    duplicates: tuple[str, ...] = ()

    @property
    def assets(self) -> tuple[MediaAsset, ...]:
        """Just the assets, for the caller that is adding them to a project."""
        return tuple(entry.asset for entry in self.entries)

    @property
    def succeeded(self) -> bool:
        """Whether anything at all was imported."""
        return bool(self.entries)

    @property
    def is_complete(self) -> bool:
        """Whether every path offered became an asset."""
        return not self.failures and not self.duplicates

    def warnings_for(self, path: str) -> tuple[str, ...]:
        """The warnings recorded against one path."""
        for entry in self.entries:
            if entry.path == path:
                return entry.warnings
        return ()

    def summary(self) -> str:
        """One sentence for the status bar.

        Spelled out in words and not in a template, because the three nouns
        (imported / skipped / failed) are the ones a user scans for.
        """
        parts = [f"{_count(len(self.entries), 'file')} imported"]
        if self.duplicates:
            parts.append(f"{_count(len(self.duplicates), 'duplicate')} skipped")
        if self.failures:
            parts.append(f"{_count(len(self.failures), 'file')} could not be read")
        return ", ".join(parts)


class MediaIngestor:
    """Probes paths and turns the ones that read into assets.

    Holds a probe port and an id source, both injected, and no state: every
    import is independent, and two imports of the same folder produce the same
    report apart from the ids.
    """

    def __init__(self, *, prober: MediaProber, ids: IdSource) -> None:
        self._prober = prober
        self._ids = ids

    def ingest(
        self,
        paths: Sequence[str],
        *,
        existing: Sequence[MediaAsset] = (),
    ) -> IngestReport:
        """Probe every path, collecting what reads and reporting what does not.

        Args:
            paths: What the user selected, in the order they selected it.
            existing: The assets already in the project, so a second import of
                the same clip does not produce a second asset pointing at the
                same file.

        Returns:
            A report.  It never raises for a bad *file*; it raises only for a
            bad *call*, which by house rules is a
            :class:`~nova_studio.core.errors.NovaInvariantError`.
        """
        entries: list[IngestedAsset] = []
        failures: list[IngestFailure] = []
        duplicates: list[str] = []
        seen = {_key(asset.path) for asset in existing}

        for path in paths:
            if not path:
                failures.append(IngestFailure(path=path, error=_unreadable("the path is empty")))
                continue
            key = _key(path)
            if key in seen:
                duplicates.append(path)
                continue
            seen.add(key)

            probed = self._prober.probe(path)
            if probed.is_err():
                failures.append(IngestFailure(path=path, error=probed.unwrap_err()))
                continue

            asset = MediaAsset(asset_id=self._ids.new_entity_id(), path=path).with_probe(
                probed.unwrap()
            )
            entries.append(IngestedAsset(asset=asset, warnings=_warnings(asset)))

        return IngestReport(
            entries=tuple(entries), failures=tuple(failures), duplicates=tuple(duplicates)
        )


def _warnings(asset: MediaAsset) -> tuple[str, ...]:
    """What is odd about a file that imported successfully.

    An ``UNKNOWN`` asset still imports: the panel shows it greyed with a reason,
    which is more use than silently dropping a file the user can see is there.
    """
    probe = asset.probe
    if probe is None:  # pragma: no cover - ingest always probes first
        return ()
    warnings: list[str] = []
    if asset.kind is AssetKind.UNKNOWN:
        warnings.append(
            "no video or audio stream was found; the file is imported but cannot be used"
        )
    elif asset.kind is AssetKind.VIDEO and not probe.has_audio:
        warnings.append("this video has no audio track")
    elif asset.kind is AssetKind.AUDIO and probe.has_video:
        warnings.append("this audio file carries a picture (cover art) and was read as audio")
    if probe.duration_seconds <= 0:
        warnings.append("the file reported no duration")
    return tuple(warnings)


def _key(path: str) -> str:
    """The comparison key for duplicate detection.

    ``PurePath`` collapses ``a//b`` and ``./a`` without touching a disk, and
    ``casefold`` makes the comparison case-insensitive — which matters because
    the app is Windows-first, where ``CLIP.MOV`` and ``clip.mov`` are one file.
    Case-*sensitive* filesystems are the ones this could over-merge on, and the
    cost of that is a skipped import the user can redo, not a lost one.
    """
    return str(PurePath(path)).casefold()


def _unreadable(reason: str) -> NovaError:
    return NovaError(
        code=_EMPTY_PATH,
        message="this file could not be read",
        domain=ErrorDomain.MEDIA,
        remedy="Check that the file exists and is a media file this build can decode.",
        cause=reason,
        retryable=False,
    )


def _count(value: int, noun: str) -> str:
    return f"{value} {noun}" if value == 1 else f"{value} {noun}s"
