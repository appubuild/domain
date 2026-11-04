"""`services/timeline/sync.py` — the transaction half of a generated track.

A caption track is a projection of a `CaptionDocument` (ADR-0009 §8), and the
edit it asks for is "hold exactly this", never "add this". `ReplaceTrackClipsCommand`
does that for one track; this module does it for several **in one transaction**,
which is the part the ADR actually demands: three caption layers must arrive as
one undo entry, and a failure on the third must leave no trace of the first two.

Pinned here, beyond the obvious:

* **one undo entry** for a multi-track sync, and one undo that takes every track
  away again — including the tracks it created;
* **rollback** — a locked track in the middle of the plan fails the whole sync and
  nothing is applied, not even the tracks that would have succeeded;
* **a no-op sync dirties nothing** — syncing a project that already holds these
  clips reports nothing changed and issues no new version;
* **an empty plan conjures no track** — committing an empty document leaves the
  timeline exactly as it was;
* **the report is taken before the edit**, so it says what the sync asked to
  change and not, uselessly, "nothing".

The captions half (`services/captions/commit.py`) is deliberately not imported
here beyond one test that wires the two together the way a use case will, because
the two packages may not import each other (`docs/architecture/services.md` §1,
rule 2) — the handshake is a `TrackSync`, which either side can satisfy.
"""

from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from nova_studio.core.temporal import Timebase
from nova_studio.domain.captions import (
    CaptionDocument,
    CaptionLayer,
    CaptionLayerKind,
    CaptionSegment,
    CaptionWord,
)
from nova_studio.domain.timeline import (
    Clip,
    ClipKind,
    Timeline,
    Track,
    TrackKind,
    validate_timeline,
)
from nova_studio.services.captions.commit import commit_document
from nova_studio.services.timeline import (
    ReplaceTrackClipsCommand,
    TimelineEditor,
    TimelineStore,
)
from nova_studio.services.timeline.sync import (
    SyncReport,
    TrackSync,
    sync_report,
    sync_tracks,
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


def _plan(*specs: tuple[str, str]) -> tuple[TrackSync, ...]:
    """A plan of one clip per track: ``(track_id, clip_id)``."""
    return tuple(TrackSync(track_id=name, clips=(_clip(cid),)) for name, cid in specs)


def _plan_for(document: CaptionDocument) -> tuple[TrackSync, ...]:
    """A layer is a track: the wiring a real use case will do.

    `commit_document` hands every layer the same track when nobody says
    otherwise (one track per layer is the caller's choice), so the caller
    derives one id per layer and lets the sync apply them as one transaction.
    """
    return tuple(
        TrackSync(track_id=f"captions.{commit.layer_id}", clips=commit.clips)
        for commit in commit_document(document, TB)
    )


def _cue(
    text: str, *, start_ms: int = 0, end_ms: int = 2_000, layer_id: str = "primary"
) -> CaptionSegment:
    tokens = text.split()
    step = max(1, (end_ms - start_ms) // max(1, len(tokens)))
    words = tuple(
        CaptionWord.of(token, start_ms + i * step, start_ms + i * step + step - 1)
        for i, token in enumerate(tokens)
    )
    return CaptionSegment(
        index=0,
        start_ms=start_ms,
        end_ms=end_ms,
        text=text,
        words=words,
        layer_id=layer_id,
    )


# -- making several tracks hold exactly these clips ---------------------------


class TestItMakesTracksHoldExactlyTheseClips:
    def test_a_missing_track_is_created(self) -> None:
        editor, store = _editor()
        assert sync_tracks(editor, _plan(("captions", "c1"))).is_ok()
        assert store.current().track("captions") is not None

    def test_every_track_in_the_plan_is_made(self) -> None:
        editor, store = _editor()
        sync_tracks(editor, _plan(("captions.primary", "c1"), ("captions.de", "c2")))
        assert store.current().track("captions.primary") is not None
        assert store.current().track("captions.de") is not None

    def test_a_track_holds_exactly_the_clips_it_was_given(self) -> None:
        editor, store = _editor(_track("captions", _clip("stale")))
        sync_tracks(editor, (TrackSync(track_id="captions", clips=(_clip("fresh"),)),))
        assert tuple(c.clip_id for c in store.current().track("captions").clips) == ("fresh",)

    def test_old_clips_are_gone(self) -> None:
        editor, store = _editor(_track("captions", _clip("stale")))
        sync_tracks(editor, _plan(("captions", "fresh")))
        assert store.current().clip("stale") is None

    def test_a_track_outside_the_plan_is_left_alone(self) -> None:
        editor, store = _editor(_track("v1", _clip("shot"), kind=TrackKind.VIDEO))
        sync_tracks(editor, _plan(("captions", "c1")))
        assert store.current().track("v1").clips[0].clip_id == "shot"

    def test_clips_are_sorted_by_the_command(self) -> None:
        editor, store = _editor()
        sync_tracks(
            editor,
            (
                TrackSync(
                    track_id="captions",
                    clips=(_clip("late", start=90), _clip("early", start=0)),
                ),
            ),
        )
        assert tuple(c.clip_id for c in store.current().track("captions").clips) == (
            "early",
            "late",
        )

    def test_the_created_track_is_the_kind_it_was_asked_to_be(self) -> None:
        editor, store = _editor()
        sync_tracks(
            editor,
            (
                TrackSync(
                    track_id="chapters",
                    clips=(_clip("ch1"),),
                    kind=TrackKind.OVERLAY,
                ),
            ),
        )
        assert store.current().track("chapters").kind is TrackKind.OVERLAY

    def test_the_created_track_gets_its_name(self) -> None:
        editor, store = _editor()
        sync_tracks(editor, (TrackSync(track_id="captions", clips=(_clip("c1"),), name="English"),))
        assert store.current().track("captions").name == "English"

    def test_the_kind_defaults_to_caption(self) -> None:
        editor, store = _editor()
        sync_tracks(editor, _plan(("captions", "c1")))
        assert store.current().track("captions").kind is TrackKind.CAPTION

    def test_the_timeline_still_validates_afterwards(self) -> None:
        editor, store = _editor(_track("v1", _clip("shot"), kind=TrackKind.VIDEO))
        sync_tracks(editor, _plan(("captions", "c1"), ("captions.de", "c2")))
        assert validate_timeline(store.current()) == ""

    def test_it_works_with_a_context(self) -> None:
        editor, store = _editor()
        assert sync_tracks(editor, _plan(("captions", "c1")), ctx=None).is_ok()
        assert store.current().track("captions") is not None


# -- one transaction ---------------------------------------------------------


class TestItIsOneTransaction:
    def test_a_multi_track_sync_is_one_undo_entry(self) -> None:
        editor, store = _editor()
        sync_tracks(
            editor,
            _plan(("captions.primary", "c1"), ("captions.de", "c2"), ("captions.fr", "c3")),
        )
        editor.undo()
        assert store.current().tracks == ()

    def test_one_undo_takes_away_every_track_it_made(self) -> None:
        editor, store = _editor(_track("v1", _clip("shot"), kind=TrackKind.VIDEO))
        sync_tracks(editor, _plan(("captions.primary", "c1"), ("captions.de", "c2")))
        editor.undo()
        assert [t.track_id for t in store.current().tracks] == ["v1"]

    def test_redo_brings_them_all_back(self) -> None:
        editor, store = _editor()
        sync_tracks(editor, _plan(("captions.primary", "c1"), ("captions.de", "c2")))
        editor.undo()
        editor.redo()
        assert len(store.current().tracks) == 2

    def test_one_undo_restores_the_clips_a_track_used_to_hold(self) -> None:
        editor, store = _editor(_track("captions", _clip("stale")))
        sync_tracks(editor, _plan(("captions", "fresh")))
        editor.undo()
        assert store.current().clip("stale") is not None
        assert store.current().clip("fresh") is None

    def test_the_undo_stack_holds_exactly_one_entry(self) -> None:
        editor, _ = _editor()
        sync_tracks(editor, _plan(("captions.primary", "c1"), ("captions.de", "c2")))
        assert editor.can_undo
        editor.undo()
        assert not editor.can_undo

    def test_a_single_track_needs_no_composite(self) -> None:
        """One track is already atomic, so it is executed bare."""
        editor, store = _editor()
        sync_tracks(editor, _plan(("captions", "c1")))
        editor.undo()
        assert store.current().tracks == ()

    def test_a_locked_track_fails_the_whole_sync(self) -> None:
        editor, _ = _editor(
            _track("v1", _clip("shot"), kind=TrackKind.VIDEO),
            _track("captions.de", _clip("old"), locked=True),
        )
        result = sync_tracks(editor, _plan(("captions.primary", "c1"), ("captions.de", "c2")))
        assert result.is_err()

    def test_a_failed_sync_leaves_nothing_behind(self) -> None:
        editor, store = _editor(_track("captions.de", _clip("old"), locked=True))
        sync_tracks(editor, _plan(("captions.primary", "c1"), ("captions.de", "c2")))
        assert store.current().track("captions.primary") is None

    def test_a_failed_sync_leaves_the_locked_track_untouched(self) -> None:
        editor, store = _editor(_track("captions.de", _clip("old"), locked=True))
        sync_tracks(editor, _plan(("captions.primary", "c1"), ("captions.de", "c2")))
        assert store.current().track("captions.de").clips[0].clip_id == "old"

    def test_a_failed_sync_leaves_the_undo_stack_empty(self) -> None:
        editor, _ = _editor(_track("captions.de", _clip("old"), locked=True))
        sync_tracks(editor, _plan(("captions.primary", "c1"), ("captions.de", "c2")))
        assert not editor.can_undo

    def test_the_failure_says_which_track_refused(self) -> None:
        editor, _ = _editor(_track("captions.de", _clip("old"), locked=True))
        problem = sync_tracks(
            editor, (TrackSync(track_id="captions.de", clips=(_clip("c2"),)),)
        ).error()
        assert problem is not None
        assert "captions.de" in problem.message
        assert "locked" in problem.message


# -- doing nothing when there is nothing to do --------------------------------


class TestItDoesNothingWhenThereIsNothingToDo:
    def test_an_empty_plan_does_nothing(self) -> None:
        editor, store = _editor()
        assert sync_tracks(editor, ()).unwrap().is_empty
        assert store.current().tracks == ()

    def test_an_empty_plan_conjures_no_track(self) -> None:
        editor, store = _editor()
        sync_tracks(editor, (TrackSync(track_id="captions"),))
        assert store.current().track("captions") is None

    def test_an_empty_track_in_the_plan_is_skipped(self) -> None:
        editor, _ = _editor()
        report = sync_tracks(
            editor, (_plan(("captions", "c1"))[0], TrackSync(track_id="captions.de"))
        ).unwrap()
        assert report.skipped == ("captions.de",)

    def test_a_track_that_already_holds_these_clips_is_not_changed(self) -> None:
        editor, _ = _editor(_track("captions", _clip("c1")))
        report = sync_tracks(editor, _plan(("captions", "c1"))).unwrap()
        assert report.changed == ()
        assert report.unchanged == ("captions",)

    def test_a_no_op_sync_issues_no_new_version(self) -> None:
        editor, store = _editor(_track("captions", _clip("c1")))
        before = store.current()
        sync_tracks(editor, _plan(("captions", "c1")))
        assert store.current() is before

    def test_a_no_op_sync_reports_nothing_done(self) -> None:
        editor, _ = _editor(_track("captions", _clip("c1")))
        assert sync_tracks(editor, _plan(("captions", "c1"))).unwrap().summary() == (
            "nothing to sync"
        )

    def test_only_the_tracks_that_differ_are_reported_changed(self) -> None:
        editor, _ = _editor(
            _track("captions.primary", _clip("c1")),
            _track("captions.de", _clip("stale")),
        )
        report = sync_tracks(
            editor, _plan(("captions.primary", "c1"), ("captions.de", "c2"))
        ).unwrap()
        assert report.changed == ("captions.de",)
        assert report.unchanged == ("captions.primary",)


# -- refusing to conjure a track ---------------------------------------------


class TestItCreatesOnlyWhatItIsAllowedTo:
    def test_a_missing_track_is_created_when_allowed(self) -> None:
        editor, store = _editor()
        sync_tracks(
            editor,
            (TrackSync(track_id="captions", clips=(_clip("c1"),), create=True),),
        )
        assert store.current().track("captions") is not None

    def test_a_missing_track_is_refused_when_not_allowed(self) -> None:
        editor, _ = _editor()
        result = sync_tracks(
            editor,
            (TrackSync(track_id="captions", clips=(_clip("c1"),), create=False),),
        )
        assert result.is_err()

    def test_the_refusal_says_the_track_is_not_there(self) -> None:
        editor, _ = _editor()
        problem = sync_tracks(
            editor,
            (TrackSync(track_id="captions", clips=(_clip("c1"),), create=False),),
        ).error()
        assert problem is not None
        assert "captions" in problem.message

    def test_an_existing_track_is_replaced_even_when_not_allowed_to_create(
        self,
    ) -> None:
        editor, store = _editor(_track("captions", _clip("stale")))
        assert sync_tracks(
            editor,
            (TrackSync(track_id="captions", clips=(_clip("fresh"),), create=False),),
        ).is_ok()
        assert store.current().clip("fresh") is not None

    def test_create_defaults_to_true(self) -> None:
        assert TrackSync(track_id="captions").create is True


# -- the report --------------------------------------------------------------


class TestTheReport:
    def test_nothing_is_skipped_in_a_full_plan(self) -> None:
        editor, _ = _editor()
        report = sync_report(editor, _plan(("captions", "c1")))
        assert report.skipped == ()

    def test_a_missing_track_is_changed(self) -> None:
        editor, _ = _editor()
        assert sync_report(editor, _plan(("captions", "c1"))).changed == ("captions",)

    def test_a_track_holding_something_else_is_changed(self) -> None:
        editor, _ = _editor(_track("captions", _clip("stale")))
        assert sync_report(editor, _plan(("captions", "c1"))).changed == ("captions",)

    def test_the_clips_are_counted(self) -> None:
        editor, _ = _editor()
        plan = (TrackSync(track_id="captions", clips=(_clip("c1"), _clip("c2", start=30))),)
        assert sync_report(editor, plan).clips == 2

    def test_the_summary_names_the_tracks(self) -> None:
        editor, _ = _editor()
        summary = sync_report(editor, _plan(("captions.primary", "c1"))).summary()
        assert "captions.primary" in summary

    def test_the_summary_counts_the_clips(self) -> None:
        editor, _ = _editor()
        summary = sync_report(editor, _plan(("captions", "c1"))).summary()
        assert "1 clips" in summary

    def test_an_empty_report_says_so(self) -> None:
        assert SyncReport().summary() == "nothing to sync"

    def test_an_empty_report_is_empty(self) -> None:
        assert SyncReport().is_empty

    def test_a_report_with_a_changed_track_is_not_empty(self) -> None:
        assert not SyncReport(changed=("captions",)).is_empty

    def test_a_report_of_only_unchanged_tracks_is_empty(self) -> None:
        assert SyncReport(unchanged=("captions",), clips=1).is_empty

    def test_the_report_is_taken_before_the_edit(self) -> None:
        """Asked afterwards, the answer would always be 'nothing changed'."""
        editor, _ = _editor()
        report = sync_tracks(editor, _plan(("captions", "c1"))).unwrap()
        assert report.changed == ("captions",)


# -- the value ---------------------------------------------------------------


class TestTrackSync:
    def test_a_plan_with_clips_is_not_empty(self) -> None:
        assert not TrackSync(track_id="captions", clips=(_clip("c1"),)).is_empty

    def test_a_plan_without_clips_is_empty(self) -> None:
        assert TrackSync(track_id="captions").is_empty

    def test_a_plan_with_no_clips_at_all_is_empty(self) -> None:
        assert TrackSync(track_id="captions", clips=()).is_empty

    def test_it_is_frozen(self) -> None:
        plan = TrackSync(track_id="captions")
        with pytest.raises(FrozenInstanceError):
            plan.track_id = "other"  # type: ignore[misc]

    def test_the_name_defaults_to_blank(self) -> None:
        assert TrackSync(track_id="captions").name == ""

    def test_the_kind_defaults_to_caption(self) -> None:
        assert TrackSync(track_id="captions").kind is TrackKind.CAPTION


# -- wiring the two halves together -------------------------------------------


class TestItSyncsWhatTheCaptionsFeatureCommitted:
    def test_a_document_commits_as_one_transaction(self) -> None:
        document = CaptionDocument(
            segments=(
                _cue("good morning"),
                _cue("guten morgen", layer_id="de"),
                _cue("bonjour", layer_id="fr"),
            ),
            layers=(
                CaptionLayer.primary("en"),
                CaptionLayer(layer_id="de", language="de", kind=CaptionLayerKind.TRANSLATION),
                CaptionLayer(layer_id="fr", language="fr", kind=CaptionLayerKind.TRANSLATION),
            ),
        ).reindexed()
        plan = _plan_for(document)
        editor, store = _editor()
        assert sync_tracks(editor, plan).is_ok()
        assert len(store.current().tracks) == 3
        editor.undo()
        assert store.current().tracks == ()

    def test_a_second_sync_of_the_same_document_changes_nothing(self) -> None:
        document = CaptionDocument(
            segments=(_cue("good morning"), _cue("guten morgen", layer_id="de")),
            layers=(
                CaptionLayer.primary("en"),
                CaptionLayer(layer_id="de", language="de", kind=CaptionLayerKind.TRANSLATION),
            ),
        ).reindexed()
        plan = _plan_for(document)
        editor, store = _editor()
        sync_tracks(editor, plan)
        before = store.current()
        report = sync_tracks(editor, plan).unwrap()
        assert report.is_empty
        assert store.current() is before

    def test_the_same_plan_is_what_the_command_would_have_done(self) -> None:
        """Both roads — the sync and the bare command — end in the same place."""
        document = CaptionDocument(
            segments=(_cue("good morning"),), layers=(CaptionLayer.primary("en"),)
        ).reindexed()
        commit = commit_document(document, TB)[0]
        one, store_one = _editor()
        two, store_two = _editor()
        sync_tracks(one, (TrackSync(track_id=commit.track_id, clips=commit.clips),))
        two.execute(ReplaceTrackClipsCommand(track_id=commit.track_id, clips=commit.clips))
        assert store_one.current() == store_two.current()
