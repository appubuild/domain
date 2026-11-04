"""`ReplaceTrackClipsCommand` — the applying half of the caption reconciler.

The invariant is the one ADR-0009 §8 asks for: **a commit is one transaction**.
Forty cues arrive on the timeline as one undo entry, and a track that is locked
is not rewritten even though the caller asked for it.

Three things are pinned beyond the usual round trip:

* the reconciler's seam — `services/captions.commit_document` produces the clips,
  this command applies them, and the track ends up holding exactly the cues;
* a commit that changes nothing changes nothing: no re-render, no dirty flag;
* a track created by a commit is removed again by its undo, because an undo that
  left an empty track behind would be an undo that did not quite undo.
"""

from __future__ import annotations

import pytest

from nova_studio.core.temporal import Timebase
from nova_studio.domain.captions import (
    CaptionDocument,
    CaptionLayer,
    CaptionSegment,
    CaptionWord,
)
from nova_studio.domain.timeline import (
    Clip,
    ClipKind,
    Timeline,
    Track,
    TrackKind,
    Transition,
    TransitionEdge,
    TransitionKind,
    validate_timeline,
)
from nova_studio.services.captions.commit import commit_document, commit_layer
from nova_studio.services.timeline import (
    ReplaceTrackClipsCommand,
    TimelineEditor,
    TimelineStore,
)

pytestmark = pytest.mark.unit

TB = Timebase(num=30, den=1)


# -- helpers -----------------------------------------------------------------


def _clip(clip_id: str, *, start: int = 0, source: int = 30, **over: object) -> Clip:
    return Clip.of(
        clip_id,
        "",
        start_frame=start,
        source_frames=source,
        kind=ClipKind.CAPTION,
        **over,  # type: ignore[arg-type]
    )


def _track(
    track_id: str, *clips: Clip, kind: TrackKind = TrackKind.CAPTION, **over: object
) -> Track:
    return Track(track_id=track_id, kind=kind, clips=clips, **over)  # type: ignore[arg-type]


def _editor(*tracks: Track) -> tuple[TimelineEditor, TimelineStore]:
    store = TimelineStore(timeline=Timeline.of(*tracks, timebase=TB))
    return TimelineEditor(store=store, project_id="p1"), store


def _document_cues() -> tuple[CaptionSegment, ...]:
    return (
        _cue("hello there"),
        _cue("good to see you", start_ms=2_000, end_ms=4_000),
    )


def _cue(
    text: str,
    *,
    start_ms: int = 0,
    end_ms: int = 2_000,
) -> CaptionSegment:
    tokens = text.split()
    step = max(1, (end_ms - start_ms) // max(1, len(tokens)))
    words = tuple(
        CaptionWord.of(token, start_ms + i * step, start_ms + i * step + step - 1)
        for i, token in enumerate(tokens)
    )
    return CaptionSegment(index=0, start_ms=start_ms, end_ms=end_ms, text=text, words=words)


# -- making a track hold exactly these clips ---------------------------------


class TestItReplaces:
    def test_a_missing_track_is_created(self) -> None:
        _, store = _editor()
        TimelineEditor(store=store, project_id="p1").execute(
            ReplaceTrackClipsCommand(
                track_id="captions", clips=(_clip("c1"), _clip("c2", start=60))
            )
        )
        assert store.current().track("captions") is not None

    def test_the_created_track_is_a_caption_track(self) -> None:
        _, store = _editor()
        TimelineEditor(store=store, project_id="p1").execute(
            ReplaceTrackClipsCommand(track_id="captions", clips=(_clip("c1"),))
        )
        assert store.current().track("captions").kind is TrackKind.CAPTION

    def test_the_created_track_goes_to_the_bottom(self) -> None:
        _, store = _editor(_track("v1", _clip("shot")))
        TimelineEditor(store=store, project_id="p1").execute(
            ReplaceTrackClipsCommand(track_id="captions", clips=(_clip("c1"),))
        )
        assert store.current().tracks[-1].track_id == "captions"

    def test_old_clips_are_gone(self) -> None:
        _, store = _editor(_track("captions", _clip("stale")))
        TimelineEditor(store=store, project_id="p1").execute(
            ReplaceTrackClipsCommand(track_id="captions", clips=(_clip("fresh"),))
        )
        assert store.current().clip("stale") is None
        assert store.current().clip("fresh") is not None

    def test_the_track_holds_exactly_what_was_asked_for(self) -> None:
        _, store = _editor(_track("captions", _clip("stale1"), _clip("stale2", start=60)))
        wanted = (_clip("a"), _clip("b", start=30), _clip("c", start=60))
        TimelineEditor(store=store, project_id="p1").execute(
            ReplaceTrackClipsCommand(track_id="captions", clips=wanted)
        )
        assert store.current().track("captions").clips == wanted

    def test_a_commit_can_empty_a_track(self) -> None:
        _, store = _editor(_track("captions", _clip("stale")))
        TimelineEditor(store=store, project_id="p1").execute(
            ReplaceTrackClipsCommand(track_id="captions", clips=())
        )
        assert store.current().track("captions").is_empty is True

    def test_the_clips_are_kept_in_position_order(self) -> None:
        _, store = _editor()
        TimelineEditor(store=store, project_id="p1").execute(
            ReplaceTrackClipsCommand(
                track_id="captions",
                clips=(_clip("late", start=90), _clip("early", start=0)),
            )
        )
        starts = [clip.start_frame for clip in store.current().track("captions").clips]
        assert starts == sorted(starts)

    def test_the_track_keeps_its_own_name_and_flags(self) -> None:
        _, store = _editor(
            _track("captions", _clip("stale"), name="English", muted=True, hidden=True)
        )
        TimelineEditor(store=store, project_id="p1").execute(
            ReplaceTrackClipsCommand(track_id="captions", clips=(_clip("fresh"),))
        )
        track = store.current().track("captions")
        assert (track.name, track.muted, track.hidden) == ("English", True, True)

    def test_an_existing_video_track_is_replaced_in_place(self) -> None:
        """The command reconciles a track; it does not move it in the stack."""
        _, store = _editor(_track("v1", _clip("shot"), kind=TrackKind.VIDEO))
        TimelineEditor(store=store, project_id="p1").execute(
            ReplaceTrackClipsCommand(track_id="v1", clips=(_clip("other"),))
        )
        tracks = store.current().tracks
        assert (tracks[0].track_id, tracks[0].kind) == ("v1", TrackKind.VIDEO)

    def test_the_timeline_still_validates_afterwards(self) -> None:
        _, store = _editor(_track("captions", _clip("stale")))
        TimelineEditor(store=store, project_id="p1").execute(
            ReplaceTrackClipsCommand(track_id="captions", clips=(_clip("a"), _clip("b", start=60)))
        )
        assert validate_timeline(store.current()) == ""


# -- what it refuses ---------------------------------------------------------


class TestWhatItRefuses:
    def test_a_locked_track_is_not_rewritten(self) -> None:
        _, store = _editor(_track("captions", _clip("finished"), locked=True))
        result = TimelineEditor(store=store, project_id="p1").execute(
            ReplaceTrackClipsCommand(track_id="captions", clips=(_clip("fresh"),))
        )
        assert result.is_err() is True
        assert store.current().clip("finished") is not None

    def test_the_refusal_is_a_precondition(self) -> None:
        _, store = _editor(_track("captions", _clip("finished"), locked=True))
        result = TimelineEditor(store=store, project_id="p1").execute(
            ReplaceTrackClipsCommand(track_id="captions", clips=(_clip("fresh"),))
        )
        assert result.unwrap_err().code == "NS-COMMAND-4104"

    def test_a_missing_track_is_not_created_when_told_not_to(self) -> None:
        _, store = _editor()
        result = TimelineEditor(store=store, project_id="p1").execute(
            ReplaceTrackClipsCommand(track_id="captions", clips=(_clip("c1"),), create=False)
        )
        assert result.is_err() is True
        assert store.current().track("captions") is None

    def test_committing_nothing_creates_nothing(self) -> None:
        """A document with no cues leaves no empty track behind."""
        _, store = _editor()
        TimelineEditor(store=store, project_id="p1").execute(
            ReplaceTrackClipsCommand(track_id="captions", clips=())
        )
        assert store.current().track("captions") is None

    def test_committing_what_is_already_there_changes_nothing(self) -> None:
        clips = (_clip("a"), _clip("b", start=60))
        _, store = _editor(_track("captions", *clips))
        outcome = (
            TimelineEditor(store=store, project_id="p1")
            .execute(ReplaceTrackClipsCommand(track_id="captions", clips=clips))
            .unwrap()
        )
        assert outcome.marks_dirty is False
        assert outcome.rerender is False

    def test_nothing_to_do_leaves_the_timeline_alone(self) -> None:
        clips = (_clip("a"),)
        editor, store = _editor(_track("captions", *clips))
        before = store.current()
        editor.execute(ReplaceTrackClipsCommand(track_id="captions", clips=clips))
        assert store.current() == before


# -- undo --------------------------------------------------------------------


class TestUndo:
    def test_undo_restores_the_track_exactly(self) -> None:
        editor, store = _editor(_track("captions", _clip("stale1"), _clip("stale2", start=60)))
        before = store.current()
        editor.execute(ReplaceTrackClipsCommand(track_id="captions", clips=(_clip("fresh"),)))
        editor.undo()
        assert store.current() == before

    def test_undo_removes_a_track_it_created(self) -> None:
        editor, store = _editor(_track("v1", _clip("shot"), kind=TrackKind.VIDEO))
        before = store.current()
        editor.execute(ReplaceTrackClipsCommand(track_id="captions", clips=(_clip("c1"),)))
        editor.undo()
        assert store.current() == before
        assert store.current().track("captions") is None

    def test_undo_restores_the_transitions_that_survived(self) -> None:
        editor, store = _editor(
            _track(
                "captions",
                _clip("a"),
                transitions=(
                    Transition(
                        transition_id="t1",
                        clip_id="a",
                        edge=TransitionEdge.START,
                        kind=TransitionKind.CROSS_DISSOLVE,
                    ),
                ),
            )
        )
        before = store.current()
        editor.execute(
            ReplaceTrackClipsCommand(track_id="captions", clips=(_clip("a"), _clip("b", start=60)))
        )
        editor.undo()
        assert store.current() == before

    def test_a_whole_commit_is_one_undo_entry(self) -> None:
        """Forty cues, one Ctrl+Z: the "one transaction" of ADR-0009 §8."""
        editor, _ = _editor(_track("captions", _clip("stale")))
        clips = tuple(_clip(f"c{index}", start=index * 30) for index in range(40))
        editor.execute(ReplaceTrackClipsCommand(track_id="captions", clips=clips))
        assert editor.depth == (1, 0)

    def test_redo_reapplies_the_whole_commit(self) -> None:
        editor, store = _editor(_track("captions", _clip("stale")))
        clips = tuple(_clip(f"c{index}", start=index * 30) for index in range(10))
        editor.execute(ReplaceTrackClipsCommand(track_id="captions", clips=clips))
        editor.undo()
        editor.redo()
        assert store.current().track("captions").clips == clips

    def test_undoing_a_commit_that_did_nothing_is_harmless(self) -> None:
        editor, store = _editor()
        before = store.current()
        editor.execute(ReplaceTrackClipsCommand(track_id="captions", clips=()))
        assert store.current() == before


# -- transitions -------------------------------------------------------------


class TestTransitions:
    def _with_transition(self) -> tuple[TimelineEditor, TimelineStore]:
        return _editor(
            _track(
                "captions",
                _clip("a"),
                _clip("b", start=60),
                transitions=(
                    Transition(
                        transition_id="t-keep",
                        clip_id="a",
                        edge=TransitionEdge.START,
                        kind=TransitionKind.CROSS_DISSOLVE,
                    ),
                    Transition(
                        transition_id="t-drop",
                        clip_id="b",
                        edge=TransitionEdge.START,
                        kind=TransitionKind.CROSS_DISSOLVE,
                    ),
                ),
            )
        )

    def test_a_transition_on_a_clip_that_is_still_there_survives(self) -> None:
        editor, store = self._with_transition()
        editor.execute(
            ReplaceTrackClipsCommand(track_id="captions", clips=(_clip("a"), _clip("c", start=60)))
        )
        assert (
            store.current().track("captions").transition_for("a", TransitionEdge.START) is not None
        )

    def test_a_transition_on_a_clip_that_is_gone_is_dropped(self) -> None:
        """Keeping it would break the track's own invariant."""
        editor, store = self._with_transition()
        editor.execute(
            ReplaceTrackClipsCommand(track_id="captions", clips=(_clip("a"), _clip("c", start=60)))
        )
        assert store.current().track("captions").transition_for("c", TransitionEdge.START) is None

    def test_the_timeline_still_validates(self) -> None:
        editor, store = self._with_transition()
        editor.execute(
            ReplaceTrackClipsCommand(track_id="captions", clips=(_clip("a"), _clip("c", start=60)))
        )
        assert validate_timeline(store.current()) == ""


# -- the reconciler, end to end ----------------------------------------------


class TestTheReconciler:
    def _document(self) -> CaptionDocument:
        return CaptionDocument.of(*_document_cues())

    def test_the_track_holds_exactly_the_cues(self) -> None:
        editor, store = _editor()
        commit = commit_document(self._document(), TB)[0]
        editor.execute(ReplaceTrackClipsCommand(commit.track_id, commit.clips))
        assert store.current().track("captions").clips == commit.clips

    def test_the_clips_sit_at_the_cue_times(self) -> None:
        editor, store = _editor()
        commit = commit_document(self._document(), TB)[0]
        editor.execute(ReplaceTrackClipsCommand(commit.track_id, commit.clips))
        starts = [clip.start_frame for clip in store.current().track("captions").clips]
        assert starts == [0, 60]

    def test_recommitting_an_unchanged_document_changes_nothing(self) -> None:
        """The point of deriving the id: a re-transcription is not a rebuild."""
        editor, store = _editor()
        first = commit_document(self._document(), TB)[0]
        editor.execute(ReplaceTrackClipsCommand(first.track_id, first.clips))
        before = store.current()
        second = commit_document(self._document(), TB)[0]
        outcome = editor.execute(ReplaceTrackClipsCommand(second.track_id, second.clips)).unwrap()
        assert store.current() == before
        assert outcome.marks_dirty is False

    def test_one_cue_changed_replaces_one_clip(self) -> None:
        editor, store = _editor()
        first = commit_document(self._document(), TB)[0]
        editor.execute(ReplaceTrackClipsCommand(first.track_id, first.clips))
        document = CaptionDocument.of(
            _cue("hello there"),
            _cue("good to see you all", start_ms=2_000, end_ms=4_000),
        )
        second = commit_document(document, TB)[0]
        outcome = editor.execute(ReplaceTrackClipsCommand(second.track_id, second.clips)).unwrap()
        kept = first.clip_ids[0] in outcome.affected
        assert kept is True
        assert store.current().clip("captions.primary.1").name == "good to see you all"

    def test_undo_takes_the_whole_commit_back(self) -> None:
        editor, store = _editor()
        before = store.current()
        commit = commit_document(self._document(), TB)[0]
        editor.execute(ReplaceTrackClipsCommand(commit.track_id, commit.clips))
        editor.undo()
        assert store.current() == before

    def test_a_layer_can_go_to_its_own_track(self) -> None:
        """One track per layer is the caller's choice."""
        editor, store = _editor()
        spanish = CaptionSegment(
            index=0,
            start_ms=0,
            end_ms=2_000,
            text="hola",
            words=(CaptionWord.of("hola", 0, 1_900),),
            layer_id="es",
        )
        document = CaptionDocument(
            segments=(*_document_cues(), spanish),
            layers=(CaptionLayer.primary(), CaptionLayer(layer_id="es")),
        ).reindexed()
        commit = commit_layer(document, TB, track_id="captions.es", layer_id="es")
        editor.execute(ReplaceTrackClipsCommand(commit.track_id, commit.clips))
        assert commit.is_empty is False
        assert store.current().track("captions.es").clip_count == 1
