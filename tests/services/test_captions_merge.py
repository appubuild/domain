"""Regeneration (`services/captions/merge.py`).

The invariant under test is ADR-0009 §7: **a re-transcription never costs the
user their work**. That is the moment every other caption tool destroys hours of
corrections, so the tests are written from the editor's side of the screen: fix
a name, move a line, delete one, lock one — then run the model again and check
that what you did is still there.

The second invariant is the one that keeps it honest: an edit that cannot be
re-attached is *reported*, never guessed at. A correction attached to the wrong
cue is a wrong caption with the user's name on it.
"""

from __future__ import annotations

import pytest

from nova_studio.core.errors import ErrorDomain
from nova_studio.core.result import Err
from nova_studio.domain.asr import Transcript, TranscriptSegment, TranscriptWord
from nova_studio.domain.captions import (
    CaptionDeltaKind,
    CaptionDocument,
    CaptionLayer,
    CaptionLayerKind,
    CaptionRevision,
    CaptionSegment,
    RevisionOrigin,
    alignment_key,
)
from nova_studio.ports.asr import AsrErrorCode
from nova_studio.services.captions.build import document_from_transcript
from nova_studio.services.captions.codes import CaptionErrorCode
from nova_studio.services.captions.merge import (
    apply_edit,
    record_deletion,
    record_insertion,
    record_style_edit,
    record_text_edit,
    record_timing_edit,
    regenerate,
)
from nova_studio.services.captions.segmentation import CueRules

pytestmark = pytest.mark.unit


# -- helpers -----------------------------------------------------------------


def _transcript(text: str, *, language: str = "en") -> Transcript:
    """One segment of evenly-spaced speech."""
    words = tuple(
        TranscriptWord(token, index * 400, index * 400 + 350)
        for index, token in enumerate(text.split())
    )
    return Transcript(
        segments=(
            TranscriptSegment(start_ms=0, end_ms=words[-1].end_ms, index=0, text=text, words=words),
        ),
        language=language,
    )


def _document(text: str = "Hello there frend", **over: object) -> CaptionDocument:
    return document_from_transcript(_transcript(text), **over).unwrap()  # type: ignore[arg-type]


def _edited(document: CaptionDocument, delta, **over: object) -> CaptionDocument:
    result = apply_edit(document, delta, **over)  # type: ignore[arg-type]
    assert not isinstance(result, Err), result.error()
    return result.unwrap()


def _regenerated(document: CaptionDocument, text: str, **over: object):
    result = regenerate(document, _transcript(text), **over)  # type: ignore[arg-type]
    assert not isinstance(result, Err), result.error()
    return result.unwrap()


class TestTheBaseIsReplaced:
    def test_a_new_transcription_replaces_the_cues(self) -> None:
        document = _document("Hello there frend")
        outcome = _regenerated(document, "Hello there friend how are you")
        assert outcome.document.text == "Hello there friend how are you"

    def test_the_new_base_is_broken_again(self) -> None:
        long = (
            "So we drove out to the coast and the whole way there the radio kept "
            "cutting out and by the time we arrived it was nearly dark outside"
        )
        outcome = _regenerated(_document("Hello there frend"), long)
        assert len(outcome.document.segments) > 1
        assert " ".join(cue.text for cue in outcome.document.segments) == long

    def test_the_cues_are_re_broken_to_the_rules(self) -> None:
        document = _document("Hello there frend")
        outcome = _regenerated(
            document,
            "Hello there friend how are you",
            rules=CueRules(max_chars_per_line=6, max_lines=1),
        )
        assert all(len(cue.text) <= 6 for cue in outcome.document.segments)

    def test_the_language_follows_the_transcript(self) -> None:
        document = _document("Hello there frend")
        outcome = _regenerated(
            document,
            "Hello there friend",
        )
        assert outcome.document.language == "en"

    def test_an_unusable_transcript_is_refused(self) -> None:
        document = _document("Hello there frend")
        result = regenerate(document, Transcript())
        assert isinstance(result, Err)
        error = result.error()
        assert error is not None
        assert error.code == AsrErrorCode.ALIGNMENT_FAILED
        assert error.domain is ErrorDomain.CAPTION

    def test_a_refusal_leaves_the_document_alone(self) -> None:
        document = _document("Hello there frend")
        assert isinstance(regenerate(document, Transcript()), Err)
        assert document.edits == _document("Hello there frend").edits

    def test_a_revision_is_recorded_when_the_caller_has_one(self) -> None:
        revision = CaptionRevision(revision_id="r2", created_ms=5_000, origin=RevisionOrigin.MERGE)
        outcome = _regenerated(_document(), "Hello there frend", revision=revision)
        assert outcome.document.current_revision == revision

    def test_no_revision_is_invented_when_none_is_given(self) -> None:
        # A builder that made up its own history would be untestable.
        assert _regenerated(_document(), "Hello there frend").document.revisions == ()


class TestCorrectionsSurvive:
    """Fix a line, run the model again, find your fix still there."""

    def test_a_text_correction_re_attaches(self) -> None:
        document = _edited(
            _document(),
            record_text_edit(_document().segments[0], "Hello there, friend", created_ms=1_000),
        )
        outcome = _regenerated(document, "Hello there frend")
        assert outcome.document.text == "Hello there, friend"
        assert outcome.applied and not outcome.unmatched

    def test_a_timing_correction_re_attaches(self) -> None:
        document = _document()
        document = _edited(
            document, record_timing_edit(document.segments[0], 100, 2_500, created_ms=1_000)
        )
        outcome = _regenerated(document, "Hello there frend")
        assert outcome.document.segments[0].start_ms == 100
        assert outcome.document.segments[0].end_ms == 2_500

    def test_a_style_correction_re_attaches(self) -> None:
        document = _document()
        document = _edited(
            document,
            record_style_edit(document.segments[0], {"colour": "#ff0000"}, created_ms=1_000),
        )
        outcome = _regenerated(document, "Hello there frend")
        assert outcome.document.segments[0].style_overrides == {"colour": "#ff0000"}

    def test_a_deletion_re_applies(self) -> None:
        document = _document()
        document = _edited(document, record_deletion(document.segments[0], created_ms=1_000))
        assert _regenerated(document, "Hello there frend").document.segments == ()

    def test_an_insertion_survives_without_matching_anything(self) -> None:
        document = _document()
        document = _edited(document, record_insertion("[applause]", 8_000, 9_000, created_ms=1_000))
        outcome = _regenerated(document, "Hello there frend")
        assert any(cue.text == "[applause]" for cue in outcome.document.segments)

    def test_several_corrections_on_one_cue_all_land(self) -> None:
        # Order matters: the text edit re-creates the key the timing edit was
        # filed under, which is why the domain anchors as it goes.
        document = _document()
        document = _edited(
            document, record_text_edit(document.segments[0], "Hello there, friend", created_ms=1)
        )
        document = _edited(
            document, record_timing_edit(document.segments[0], 100, 2_500, created_ms=2)
        )
        outcome = _regenerated(document, "Hello there frend")
        assert outcome.document.segments[0].text == "Hello there, friend"
        assert outcome.document.segments[0].start_ms == 100

    def test_a_correction_the_new_transcription_already_made_is_reported(self) -> None:
        # The model got it right this time. The edit is not "lost" — the base
        # already says it — but the user is told, rather than being left to
        # wonder whether it applied.
        document = _edited(
            _document(),
            record_text_edit(_document().segments[0], "Hello there, friend", created_ms=1_000),
        )
        outcome = _regenerated(document, "Hello there friend")
        assert outcome.document.text == "Hello there friend"
        assert outcome.unmatched
        assert outcome.needs_review

    def test_word_timings_dropped_by_a_text_edit_are_reported(self) -> None:
        document = _document()
        document = _edited(
            document, record_text_edit(document.segments[0], "Hello there, friend", created_ms=1)
        )
        outcome = _regenerated(document, "Hello there frend")
        assert outcome.timings_dropped


class TestWhatARegenerationKeeps:
    def test_a_locked_cue_is_not_re_transcribed(self) -> None:
        from dataclasses import replace

        document = CaptionDocument.of(
            replace(_document("Hello there frend").segments[0], locked=True)
        )
        outcome = _regenerated(document, "Hello there friend how are you")
        assert outcome.document.segments == (document.segments[0],)
        assert outcome.locked == (document.segments[0],)

    def test_a_fresh_cue_covered_by_a_locked_one_is_dropped(self) -> None:
        from dataclasses import replace

        locked = replace(_document("Hello there frend").segments[0], locked=True)
        document = CaptionDocument.of(locked)
        outcome = _regenerated(
            document,
            "Hello there friend how are you",
        )
        assert len(outcome.document.segments) == 1

    def test_cues_on_another_layer_are_carried_over(self) -> None:
        layer = CaptionLayer(
            layer_id="es", name="Spanish", language="es", kind=CaptionLayerKind.TRANSLATION
        )
        translation = CaptionSegment(
            index=0, start_ms=0, end_ms=1_500, text="Hola amigo", layer_id="es"
        )
        document = replace_layers(
            _document("Hello there frend"), (CaptionLayer.primary(), layer), (translation,)
        )
        outcome = _regenerated(document, "Hello there friend")
        assert "Hola amigo" in outcome.document.text

    def test_a_regeneration_on_one_layer_leaves_the_other_alone(self) -> None:
        layer = CaptionLayer(layer_id="es", name="Spanish", language="es")
        translation = CaptionSegment(
            index=0, start_ms=0, end_ms=1_500, text="Hola amigo", layer_id="es"
        )
        document = replace_layers(
            _document("Hello there frend"), (CaptionLayer.primary(), layer), (translation,)
        )
        outcome = _regenerated(document, "Hello there friend", layer_id="es")
        assert outcome.document.text.count("Hola amigo") == 0

    def test_nothing_is_locked_when_nothing_was(self) -> None:
        assert _regenerated(_document(), "Hello there frend").locked == ()


def replace_layers(
    document: CaptionDocument,
    layers: tuple[CaptionLayer, ...],
    segments: tuple[CaptionSegment, ...],
) -> CaptionDocument:
    from dataclasses import replace

    return replace(
        document,
        layers=layers,
        segments=(
            *document.segments,
            *(replace(segment, index=index) for index, segment in enumerate(segments)),
        ),
    ).reindexed()


class TestTheReviewList:
    def test_a_clean_regeneration_needs_no_review(self) -> None:
        outcome = _regenerated(_document(), "Hello there frend")
        assert not outcome.needs_review
        assert outcome.review() == ""

    def test_a_review_says_how_much_survived(self) -> None:
        document = _edited(
            _document(),
            record_text_edit(_document().segments[0], "Hello there, friend", created_ms=1_000),
        )
        outcome = _regenerated(document, "Hello there frend")
        assert "1 correction(s) re-attached" in outcome.review()

    def test_a_review_says_what_could_not_be_matched(self) -> None:
        document = _edited(
            _document(),
            record_text_edit(_document().segments[0], "Hello there, friend", created_ms=1_000),
        )
        outcome = _regenerated(document, "Hello there friend")
        assert "could not be matched" in outcome.review()


class TestRecordingAnEdit:
    def test_a_text_edit_remembers_what_was_there_before(self) -> None:
        cue = _document().segments[0]
        delta = record_text_edit(cue, "Hello there, friend", created_ms=1_000)
        assert delta.before == "Hello there frend"
        assert delta.after == "Hello there, friend"

    def test_an_edit_is_filed_under_the_cues_alignment_key(self) -> None:
        cue = _document().segments[0]
        assert record_text_edit(cue, "x", created_ms=0).key == cue.key

    def test_a_timing_edit_carries_the_new_times(self) -> None:
        cue = _document().segments[0]
        delta = record_timing_edit(cue, 100, 2_500, created_ms=1_000)
        assert (delta.start_ms, delta.end_ms) == (100, 2_500)
        assert delta.before == f"{cue.start_ms}:{cue.end_ms}"

    def test_a_style_edit_carries_the_mapping_not_a_string(self) -> None:
        cue = _document().segments[0]
        delta = record_style_edit(cue, {"colour": "#ff0000"}, created_ms=1_000)
        assert delta.style == {"colour": "#ff0000"}

    def test_a_deletion_keeps_the_text_it_removed(self) -> None:
        cue = _document().segments[0]
        delta = record_deletion(cue, created_ms=1_000)
        assert delta.kind is CaptionDeltaKind.DELETE
        assert delta.before == cue.text

    def test_an_insertion_is_keyed_by_its_own_text_and_time(self) -> None:
        delta = record_insertion("[applause]", 8_000, 9_000, created_ms=1_000)
        assert delta.key == alignment_key("[applause]", 8_000)
        assert delta.kind is CaptionDeltaKind.INSERT

    def test_an_edit_can_be_filed_under_a_revision(self) -> None:
        cue = _document().segments[0]
        delta = record_text_edit(cue, "x", created_ms=1, revision_id="r7")
        assert delta.revision_id == "r7"


class TestApplyingAnEdit:
    def test_an_edit_is_applied_and_recorded(self) -> None:
        document = _document()
        delta = record_text_edit(document.segments[0], "Hello there, friend", created_ms=1_000)
        applied = _edited(document, delta)
        assert applied.segments[0].text == "Hello there, friend"
        assert applied.edits == (delta,)

    def test_an_insertion_applies_without_a_match(self) -> None:
        document = _document()
        applied = _edited(document, record_insertion("[applause]", 8_000, created_ms=1_000))
        assert any(cue.text == "[applause]" for cue in applied.segments)

    def test_an_edit_that_matches_nothing_is_refused(self) -> None:
        # Guessing which cue was meant is how a correction lands on the wrong
        # line, and the user sees the damage at export.
        document = _document()
        stranger = CaptionSegment(
            index=0, start_ms=90_000, end_ms=91_000, text="a cue from another film"
        )
        result = apply_edit(document, record_deletion(stranger, created_ms=1_000))
        assert isinstance(result, Err)
        error = result.error()
        assert error is not None
        assert error.code == CaptionErrorCode.MERGE_CONFLICT

    def test_a_refused_edit_records_nothing(self) -> None:
        document = _document()
        stranger = CaptionSegment(index=0, start_ms=90_000, end_ms=91_000, text="nope")
        assert isinstance(apply_edit(document, record_deletion(stranger, created_ms=1)), Err)
        assert document.edits == ()

    def test_a_refused_edit_says_which_key_failed(self) -> None:
        document = _document()
        stranger = CaptionSegment(index=0, start_ms=90_000, end_ms=91_000, text="nope")
        result = apply_edit(document, record_deletion(stranger, created_ms=1))
        assert isinstance(result, Err)
        error = result.error()
        assert error is not None and error.details["key"] == stranger.key
