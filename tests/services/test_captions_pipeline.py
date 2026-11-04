"""The caption pipeline (`services/captions/pipeline.py`).

The invariant under test is ADR-0009 §3: **a stage is a named, pure, replaceable
step, and nothing else in the engine knows what any stage does**. That is what
lets the engine be verified in CI on a machine with no network and no GPU, and
what lets a plugin insert a pass between two stages without either of them
learning about it.

So the tests use stages that do almost nothing — append a cue, fail, refuse to
run — because the pipeline's job is ordering, skipping and reporting, not
captioning.
"""

from __future__ import annotations

import pytest

from nova_studio.core.errors import NovaError, NovaInvariantError
from nova_studio.core.result import Err, Result, failed, ok
from nova_studio.domain.captions import (
    CAPTION_MIN_DURATION_MS,
    CaptionDocument,
    CaptionSegment,
)
from nova_studio.services.captions.codes import CaptionErrorCode
from nova_studio.services.captions.pipeline import (
    CaptionPipeline,
    StageContext,
    stage_failed,
)

pytestmark = pytest.mark.unit


# -- stages that do almost nothing -------------------------------------------


def _cue(index: int, text: str = "a line of caption") -> CaptionSegment:
    """A cue at ``index`` seconds, long enough to read and slow enough to read."""
    return CaptionSegment(
        index=index, start_ms=index * 1_000, end_ms=index * 1_000 + 900, text=text
    )


class _Append:
    """A stage that adds one cue at the end."""

    def __init__(self, text: str = "added") -> None:
        self.text = text

    def apply(self, document: CaptionDocument, ctx: StageContext) -> Result[CaptionDocument]:
        return ok(
            document.with_segments((*document.segments, _cue(len(document.segments), self.text)))
        )


class _Fail:
    """A stage that cannot go on."""

    def __init__(self, code: str = "NS-CAPTION-4010", stage: str | None = None) -> None:
        self.code = code
        self.stage = stage

    def apply(self, document: CaptionDocument, ctx: StageContext) -> Result[CaptionDocument]:
        details = {"stage": self.stage} if self.stage else None
        return failed(
            NovaError(code=self.code, message="this stage refuses to continue", details=details)
        )


class _NotAStage:
    """Registered by mistake; the pipeline must say so rather than skip it."""

    def run(self, document: CaptionDocument) -> CaptionDocument:
        return document


class _Record:
    """A stage that remembers the context it was handed."""

    def __init__(self) -> None:
        self.seen: StageContext | None = None

    def apply(self, document: CaptionDocument, ctx: StageContext) -> Result[CaptionDocument]:
        self.seen = ctx
        return ok(document)


def _two_cues() -> CaptionDocument:
    return CaptionDocument.of(_cue(0), _cue(1))


def _run(pipeline: CaptionPipeline, document: CaptionDocument | None = None, ctx=None):
    result = pipeline.run(document if document is not None else _two_cues(), ctx or StageContext())
    assert not isinstance(result, Err)
    return result.unwrap()


class TestTheContext:
    def test_text_metrics_are_not_part_of_the_context(self) -> None:
        # How much text fits a line is a house style, and a house style belongs
        # to the pipeline (CueRules), not to the frame the project happens to be.
        assert not hasattr(StageContext(), "max_line_chars")

    def test_the_default_frame_is_1080p(self) -> None:
        assert StageContext().frame_size == (1920, 1080)

    def test_nothing_is_protected_by_default(self) -> None:
        assert StageContext().protected == ()

    def test_a_frame_must_be_positive(self) -> None:
        with pytest.raises(NovaInvariantError, match="frame must be positive"):
            StageContext(frame_size=(0, 1080))

    def test_a_line_height_must_be_a_fraction(self) -> None:
        with pytest.raises(NovaInvariantError, match="line_height_fraction"):
            StageContext(line_height_fraction=0.0)

    def test_each_context_has_its_own_safe_area(self) -> None:
        # A mutable default shared between contexts is the bug that makes one
        # project's margins appear in another's.
        assert StageContext().safe_area is not StageContext().safe_area

    def test_a_stage_is_given_the_context(self) -> None:
        stage = _Record()
        ctx = StageContext(language="bn")
        _run(CaptionPipeline().with_stage("record", stage), ctx=ctx)
        assert stage.seen is ctx


class TestRegistration:
    def test_a_new_pipeline_has_no_stages(self) -> None:
        assert CaptionPipeline().names == ()

    def test_a_stage_is_appended_in_order(self) -> None:
        pipeline = CaptionPipeline().with_stage("one", object()).with_stage("two", object())
        assert pipeline.names == ("one", "two")

    def test_a_stage_can_be_inserted_before_another(self) -> None:
        pipeline = (
            CaptionPipeline()
            .with_stage("one", object())
            .with_stage("three", object())
            .inserted("two", object(), before="three")
        )
        assert pipeline.names == ("one", "two", "three")

    def test_inserting_before_the_first_stage_puts_it_first(self) -> None:
        pipeline = (
            CaptionPipeline().with_stage("one", object()).inserted("zero", object(), before="one")
        )
        assert pipeline.names == ("zero", "one")

    def test_a_duplicate_name_is_a_bug_in_the_caller(self) -> None:
        pipeline = CaptionPipeline().with_stage("one", object())
        with pytest.raises(NovaInvariantError, match="already in this pipeline"):
            pipeline.with_stage("one", object())

    def test_inserting_before_a_stage_that_does_not_exist_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError, match="no stage named"):
            CaptionPipeline().with_stage("one", object()).inserted("two", object(), before="nine")

    def test_a_stage_knows_whether_it_is_registered(self) -> None:
        pipeline = CaptionPipeline().with_stage("one", object())
        assert pipeline.has("one")
        assert not pipeline.has("two")

    def test_a_stage_can_be_removed(self) -> None:
        pipeline = CaptionPipeline().with_stage("one", object()).with_stage("two", object())
        assert pipeline.without("one").names == ("two",)

    def test_removing_a_stage_that_does_not_exist_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError, match="no stage named"):
            CaptionPipeline().without("one")


class TestSwitchingStagesOff:
    """'Re-break my captions but don't move them' is a thing users ask for."""

    def test_a_stage_is_on_until_it_is_switched_off(self) -> None:
        pipeline = CaptionPipeline().with_stage("one", _Append())
        assert pipeline.is_enabled("one")

    def test_a_disabled_stage_stays_in_the_order(self) -> None:
        pipeline = CaptionPipeline().with_stage("one", _Append()).disabled_stage("one")
        assert pipeline.names == ("one",)
        assert pipeline.enabled_names == ()

    def test_a_disabled_stage_does_not_run(self) -> None:
        pipeline = CaptionPipeline().with_stage("one", _Append()).disabled_stage("one")
        assert _run(pipeline).segment_count == 2

    def test_a_disabled_stage_can_be_switched_back_on(self) -> None:
        pipeline = (
            CaptionPipeline().with_stage("one", _Append()).disabled_stage("one").enabled("one")
        )
        assert _run(pipeline).segment_count == 3

    def test_only_the_disabled_stage_is_skipped(self) -> None:
        pipeline = (
            CaptionPipeline()
            .with_stage("one", _Append())
            .with_stage("two", _Append())
            .disabled_stage("one")
        )
        assert pipeline.enabled_names == ("two",)
        assert _run(pipeline).segment_count == 3

    def test_switching_on_a_stage_that_does_not_exist_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError, match="no stage named"):
            CaptionPipeline().enabled("one")

    def test_switching_off_a_stage_that_does_not_exist_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError, match="no stage named"):
            CaptionPipeline().disabled_stage("one")

    def test_removing_a_disabled_stage_forgets_it_was_disabled(self) -> None:
        pipeline = (
            CaptionPipeline().with_stage("one", object()).disabled_stage("one").without("one")
        )
        assert pipeline.disabled == frozenset()


class TestRunning:
    def test_an_empty_pipeline_hands_the_document_back(self) -> None:
        document = _two_cues()
        assert _run(CaptionPipeline(), document) is document

    def test_stages_run_in_the_order_they_were_registered(self) -> None:
        pipeline = (
            CaptionPipeline().with_stage("a", _Append("first")).with_stage("b", _Append("second"))
        )
        assert _run(pipeline).segments[-2:] == (
            _cue(2, "first"),
            _cue(3, "second"),
        )

    def test_each_stage_sees_the_previous_stages_answer(self) -> None:
        pipeline = CaptionPipeline().with_stage("a", _Append()).with_stage("b", _Append())
        assert _run(pipeline).segment_count == 4

    def test_a_stage_that_cannot_go_on_stops_the_pipeline(self) -> None:
        pipeline = CaptionPipeline().with_stage("a", _Append()).with_stage("b", _Fail())
        result = pipeline.run(_two_cues(), StageContext())
        assert isinstance(result, Err)
        assert result.error() is not None

    def test_a_failure_names_the_stage_that_failed(self) -> None:
        pipeline = CaptionPipeline().with_stage("b", _Fail())
        result = pipeline.run(_two_cues(), StageContext())
        assert isinstance(result, Err)
        error = result.error()
        assert error is not None
        assert error.details["stage"] == "b"

    def test_a_stage_that_named_itself_keeps_its_own_answer(self) -> None:
        # Overwriting it would turn "the template is broken" into "stage b".
        pipeline = CaptionPipeline().with_stage("b", _Fail(stage="template-loader"))
        result = pipeline.run(_two_cues(), StageContext())
        assert isinstance(result, Err)
        error = result.error()
        assert error is not None and error.details["stage"] == "template-loader"

    def test_a_failure_keeps_the_stages_own_code(self) -> None:
        pipeline = CaptionPipeline().with_stage("b", _Fail(code=CaptionErrorCode.TEMPLATE_INVALID))
        result = pipeline.run(_two_cues(), StageContext())
        assert isinstance(result, Err)
        error = result.error()
        assert error is not None and error.code == CaptionErrorCode.TEMPLATE_INVALID

    def test_an_object_that_is_not_a_stage_is_reported(self) -> None:
        pipeline = CaptionPipeline().with_stage("b", _NotAStage())
        result = pipeline.run(_two_cues(), StageContext())
        assert isinstance(result, Err)
        error = result.error()
        assert error is not None
        assert error.code == CaptionErrorCode.NOT_A_STAGE
        assert error.details["stage"] == "b"

    def test_a_disabled_stage_that_would_fail_does_not_run(self) -> None:
        pipeline = CaptionPipeline().with_stage("b", _Fail()).disabled_stage("b")
        assert _run(pipeline).segment_count == 2


class TestTheResultIsChecked:
    """ADR-0009 §2 rule 4: the document that leaves is renderable."""

    def test_a_sound_result_passes(self) -> None:
        assert _run(CaptionPipeline().with_stage("a", _Append())).segment_count == 3

    def test_an_unreadable_result_is_refused(self) -> None:
        # One cue too short to read: what Break produces before Resolve runs.
        too_brief = CaptionDocument.of(
            CaptionSegment(index=0, start_ms=0, end_ms=CAPTION_MIN_DURATION_MS - 1, text="hi")
        )

        class _Keep:
            def apply(
                self, document: CaptionDocument, ctx: StageContext
            ) -> Result[CaptionDocument]:
                return ok(document)

        result = CaptionPipeline().with_stage("keep", _Keep()).run(too_brief, StageContext())
        assert isinstance(result, Err)
        error = result.error()
        assert error is not None
        assert error.code == CaptionErrorCode.INVALID_RESULT

    def test_the_refusal_says_which_cue_is_wrong(self) -> None:
        too_brief = CaptionDocument.of(
            CaptionSegment(index=0, start_ms=0, end_ms=CAPTION_MIN_DURATION_MS - 1, text="hi")
        )
        result = CaptionPipeline().run(too_brief, StageContext())
        assert isinstance(result, Err)
        error = result.error()
        assert error is not None and "segment 0" in error.message

    def test_a_refused_result_offers_a_remedy(self) -> None:
        too_brief = CaptionDocument.of(
            CaptionSegment(index=0, start_ms=0, end_ms=CAPTION_MIN_DURATION_MS - 1, text="hi")
        )
        result = CaptionPipeline().run(too_brief, StageContext())
        assert isinstance(result, Err)
        error = result.error()
        assert error is not None and error.remedy


class TestTheOneMessage:
    def test_a_stage_failure_names_the_stage(self) -> None:
        error = stage_failed("break", "the cue never ends")
        assert "break" in error.message

    def test_a_stage_failure_says_why(self) -> None:
        assert "the cue never ends" in stage_failed("break", "the cue never ends").message

    def test_a_stage_failure_carries_the_stage_for_the_ui(self) -> None:
        assert stage_failed("break", "boom").details["stage"] == "break"

    def test_a_stage_failure_uses_the_pipelines_code(self) -> None:
        assert stage_failed("break", "boom").code == CaptionErrorCode.STAGE_FAILED

    def test_a_stage_failure_is_not_retryable(self) -> None:
        # A stage is pure: the same input gives the same answer.
        assert not stage_failed("break", "boom").retryable

    def test_a_stage_failure_offers_a_remedy(self) -> None:
        assert stage_failed("break", "boom").remedy
