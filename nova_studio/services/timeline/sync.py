"""L3 — timeline: reconciling a track that is a projection of something else.

Some tracks are not edited, they are **generated**. A caption track is a
projection of a `CaptionDocument` (ADR-0009 §8); a chapters track is a projection
of a list of markers; a beat grid is a projection of an analysis. All three have
the same shape: the source of truth lives elsewhere, and the only correct edit
is **"hold exactly this"** — never "add this" or "remove that", which is what a
diff between two states would produce and which leaves a track that is neither
what the document says nor what the timeline said.

This module is that edit, made once. `ReplaceTrackClipsCommand` does it for one
track; :func:`sync_tracks` does it for several **inside one transaction**, which
is the part ADR-0009 §8 actually asks for. A project with a primary caption layer
and two translations is three tracks, and a commit that arrived as three undo
entries would mean Ctrl+Z steps through a caption track rebuilding itself one
language at a time — while a failure after the first left a timeline that is
neither the old captions nor the new ones.

Four decisions are worth stating:

* **One composite command, so it is one undo entry and one rollback.**
  :class:`~nova_studio.core.commands.CompositeCommand` runs its children in order
  and rolls them back on the first failure, which is the whole of what
  "transaction" means here.
* **A track that already holds exactly these clips is not touched.** The command
  itself reports no change, so a re-sync of an unchanged project dirties nothing
  and re-renders nothing.
* **A missing track is created only when asked**, and never when there is
  nothing to put on it — a commit of an empty document conjures no track.
* **A locked track is a refusal, not a crash.** It is the guard against a
  rebuild destroying a finished mix, and it is reported so the user can decide.

Where this sits next to the captions feature: `services/captions/commit.py`
decides *what* a document asks a track to hold, and this module decides *how*
the timeline is made to hold it. The two never import each other (rule 2 of
`docs/architecture/services.md` §1 — feature isolation), which is why the
handshake is a plain value: a :class:`TrackSync` is a track id and some clips,
and either side can be replaced without the other noticing.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from nova_studio.core.commands import Command, CommandContext, CompositeCommand
from nova_studio.core.result import Result, failed, ok
from nova_studio.domain.timeline import TrackKind
from nova_studio.services.timeline.commands import ReplaceTrackClipsCommand

if TYPE_CHECKING:
    from collections.abc import Sequence

    from nova_studio.domain.timeline import Clip
    from nova_studio.services.timeline.editor import TimelineEditor

__all__ = ["TrackSync", "sync_report", "sync_tracks"]


@dataclass(frozen=True, slots=True)
class TrackSync:
    """What one track must hold when the sync is finished.

    Deliberately not a caption type: a track that is a projection of something
    looks the same whether that something is a caption document, a chapter list
    or a beat grid.
    """

    track_id: str
    clips: tuple[Clip, ...] = ()
    #: The kind of track to create when it is not there yet.  Caption is the
    #: default because that is what a generated track almost always is: a
    #: caption document, a chapter list, a beat grid.
    kind: TrackKind = TrackKind.CAPTION
    #: The name of a track created this way.
    name: str = ""
    #: Whether a missing track may be created.  Off for a sync that must never
    #: conjure a track the project did not have.
    create: bool = True

    @property
    def is_empty(self) -> bool:
        """Whether there is anything to put on the track."""
        return not self.clips


@dataclass(frozen=True, slots=True)
class SyncReport:
    """What a sync did, for a log line, a status bar or a test."""

    #: Tracks whose contents changed.
    changed: tuple[str, ...] = ()
    #: Tracks that already held what was asked of them.
    unchanged: tuple[str, ...] = ()
    #: Tracks that were left alone because there was nothing to put on them.
    skipped: tuple[str, ...] = ()
    #: How many clips the timeline was asked to hold, all told.
    clips: int = 0

    @property
    def is_empty(self) -> bool:
        """Whether the sync did nothing at all."""
        return not self.changed

    def summary(self) -> str:
        """One line for a log or an undo label."""
        if self.is_empty:
            return "nothing to sync"
        tracks = ", ".join(self.changed)
        return f"synced {len(self.changed)} track(s) — {tracks} — {self.clips} clips"


def sync_tracks(
    editor: TimelineEditor,
    tracks: Sequence[TrackSync],
    *,
    ctx: CommandContext | None = None,
    display_name: str = "",
) -> Result[SyncReport]:
    """Make several tracks hold exactly what they are given, in one transaction.

    Args:
        editor: The timeline to edit.
        tracks: What each track must hold. Order does not matter: a track's
            clips are sorted by the command, and the tracks themselves are
            independent of one another.
        ctx: The command context, when the caller has one.
        display_name: What the undo entry calls itself.

    Returns:
        ``Ok`` with what the sync did, or the first ``Err`` a command produced —
        a locked track, a track that was told not to be created and is not there.
        In that case **nothing** was applied: the composite rolled back.
    """
    planned = [track for track in tracks if not track.is_empty]
    skipped = tuple(track.track_id for track in tracks if track.is_empty)
    if not planned:
        return ok(SyncReport(skipped=skipped))

    # The report is taken *before* the edit, because that is the question it
    # answers: what does this sync ask to change?  Asked afterwards, every track
    # would already hold what it was given and the answer would always be
    # "nothing" — which is true, useless, and hides a re-render.
    report = sync_report(editor, planned, skipped=skipped)
    result = editor.execute(_command_for(planned, display_name=display_name), ctx)
    problem = result.error()
    if problem is not None:
        return failed(problem)
    return ok(report)


def sync_report(
    editor: TimelineEditor,
    tracks: Sequence[TrackSync],
    *,
    skipped: tuple[str, ...] = (),
) -> SyncReport:
    """What these tracks ask for, against what the timeline holds now.

    A caller that wants to know whether a sync is worth doing — before it dirties
    a project — asks this first.
    """
    timeline = editor.store.current()
    changed: list[str] = []
    unchanged: list[str] = []
    clips = 0
    for track in tracks:
        clips += len(track.clips)
        existing = timeline.track(track.track_id)
        if existing is not None and existing.clips == track.clips:
            unchanged.append(track.track_id)
        else:
            changed.append(track.track_id)
    return SyncReport(
        changed=tuple(changed),
        unchanged=tuple(unchanged),
        skipped=skipped,
        clips=clips,
    )


def _command_for(tracks: Sequence[TrackSync], *, display_name: str) -> Command:
    """The one command that does the whole sync.

    A single track is executed bare: a composite of one is noise, and one command
    is already atomic. Several tracks become a `CompositeCommand`, so they are
    one undo entry and one rollback.
    """
    commands = tuple(
        ReplaceTrackClipsCommand(
            track_id=track.track_id,
            clips=track.clips,
            kind=track.kind,
            track_name=track.name,
            create=track.create,
        )
        for track in tracks
    )
    if len(commands) == 1:
        return commands[0]
    return CompositeCommand(
        commands,
        display_name=display_name or "sync the caption tracks",
    )
