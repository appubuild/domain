"""The default caption pipeline (`services/captions/assembly.py`).

Every stage had its own tests before this file existed. What is being tested
here is the thing no single stage can answer: **that the twelve names of
ADR-0009 §3 now stand in one order, and that a document put in one end comes out
the other end captioned, positioned and animatable**. So there are two kinds of
test — ones that read the pipeline's shape, and one end-to-end run that asks a
viewer's questions of the result: is it short enough to read, is it out of the
way, does the word being spoken light up.
"""

from __future__ import annotations

from dataclasses import replace

import pytest

from nova_studio.core.errors import ErrorDomain, NovaError
from nova_studio.core.result import failed
from nova_studio.core.temporal import Timebase
from nova_studio.domain.captions import (
    CaptionDocument,
    CaptionSegment,
    CaptionWord,
    validate_caption_document,
)
from nova_studio.services.captions.assembly import (
    IO_STAGES,
    PURE_STAGES,
    STAGE_ORDER,
    default_pipeline,
)
from nova_studio.services.captions.bake import AnimationBaker, AnimationSpec
from nova_studio.services.captions.cues import CueBreaker
from nova_studio.services.captions.highlight import Highlighter
from nova_studio.services.captions.pipeline import CaptionPipeline, StageContext
from nova_studio.services.captions.segmentation import DEFAULT_CUE_RULES
from nova_studio.services.captions.styles import CaptionTemplate, WordAnimation, look_for

TB = Timebase(num=30, den=1)
CTX = StageContext()

pytestmark = pytest.mark.unit


def _words(*text: str, start_ms: int = 0, span_ms: int = 400) -> tuple[CaptionWord, ...]:
    return tuple(
        CaptionWord.of(word, start_ms + index * span_ms, start_ms + index * span_ms + span_ms - 50)
        for index, word in enumerate(text)
    )


def _document(*text: str) -> CaptionDocument:
    words = _words(*text)
    return CaptionDocument.of(
        CaptionSegment(
            index=0,
            start_ms=words[0].start_ms,
            end_ms=words[-1].end_ms,
            text=" ".join(text),
            words=words,
        )
    )


class TestTheShape:
    def test_all_twelve_names_are_known(self):
        assert len(STAGE_ORDER) == 12

    def test_the_twelve_are_in_adr_order(self):
        assert STAGE_ORDER == (
            "extract",
            "vad",
            "transcribe",
            "refine",
            "diarise",
            "translate",
            "break",
            "emoji",
            "highlight",
            "position",
            "resolve",
            "bake",
        )

    def test_five_stages_need_the_world_outside(self):
        assert frozenset({"extract", "vad", "transcribe", "diarise", "translate"}) == IO_STAGES

    def test_the_rest_are_pure(self):
        assert PURE_STAGES == (
            "refine",
            "break",
            "emoji",
            "highlight",
            "position",
            "resolve",
            "bake",
        )

    def test_every_stage_is_either_pure_or_io(self):
        assert set(PURE_STAGES) | set(IO_STAGES) == set(STAGE_ORDER)

    def test_no_stage_is_both(self):
        assert not set(PURE_STAGES) & set(IO_STAGES)

    def test_the_pipeline_registers_the_pure_stages(self):
        assert default_pipeline().names == PURE_STAGES

    def test_every_pure_stage_is_on_by_default(self):
        assert default_pipeline().enabled_names == (
            "refine",
            "break",
            "emoji",
            "highlight",
            "position",
            "bake",
        )


class TestResolve:
    def test_it_is_registered(self):
        assert default_pipeline().has("resolve")

    def test_it_is_switched_off_because_position_already_resolves(self):
        assert not default_pipeline().is_enabled("resolve")

    def test_it_can_be_switched_on(self):
        assert default_pipeline().enabled("resolve").is_enabled("resolve")

    def test_it_carries_the_same_placer_as_position(self):
        pipeline = default_pipeline()
        placer = dict(pipeline.stages)["position"]
        assert dict(pipeline.stages)["resolve"] is placer

    def test_a_plugin_can_insert_before_either_name(self):
        pipeline = default_pipeline().inserted("mine", object(), before="resolve")
        assert pipeline.names.index("mine") == pipeline.names.index("resolve") - 1


class TestTheStyleStage:
    def test_a_project_without_a_look_gets_no_style_stage(self):
        assert not default_pipeline().has("style")

    def test_a_look_brings_its_own_stage(self):
        assert default_pipeline(look=look_for(CaptionTemplate.TIKTOK)).has("style")

    def test_the_style_stage_sits_between_refine_and_break(self):
        names = default_pipeline(look=look_for(CaptionTemplate.TIKTOK)).names
        assert names.index("style") == names.index("break") - 1
        assert names.index("style") == names.index("refine") + 1

    def test_the_break_stage_uses_the_looks_own_line_budget(self):
        pipeline = default_pipeline(look=look_for(CaptionTemplate.TIKTOK))
        breaker = dict(pipeline.stages)["break"]
        assert breaker.rules.max_chars_per_line == 20

    def test_without_a_look_the_broadcast_budget_is_used(self):
        breaker = dict(default_pipeline().stages)["break"]
        assert breaker.rules == DEFAULT_CUE_RULES

    def test_a_caller_can_say_what_to_break_to(self):
        rules = replace(DEFAULT_CUE_RULES, max_chars_per_line=16)
        breaker = dict(default_pipeline(rules=rules).stages)["break"]
        assert breaker.rules.max_chars_per_line == 16


class TestStagesCanBeSupplied:
    def test_a_caller_can_bring_its_own_breaker(self):
        breaker = CueBreaker(rules=replace(DEFAULT_CUE_RULES, max_chars_per_line=24))
        assert dict(default_pipeline(breaker=breaker).stages)["break"] is breaker

    def test_a_caller_can_bring_its_own_highlighter(self):
        highlighter = Highlighter()
        assert dict(default_pipeline(highlighter=highlighter).stages)["highlight"] is highlighter

    def test_a_caller_can_bring_its_own_baker(self):
        baker = AnimationBaker(spec=AnimationSpec())
        assert dict(default_pipeline(baker=baker).stages)["bake"] is baker

    def test_a_stage_can_be_switched_off(self):
        pipeline = default_pipeline().disabled_stage("emoji")
        assert not pipeline.is_enabled("emoji")

    def test_the_pipeline_is_a_caption_pipeline(self):
        assert isinstance(default_pipeline(), CaptionPipeline)

    def test_building_one_does_not_change_another(self):
        first = default_pipeline()
        second = first.disabled_stage("emoji")
        assert first.is_enabled("emoji")
        assert not second.is_enabled("emoji")


class TestEndToEnd:
    """One document, the whole default pipeline, and a viewer's questions."""

    @pytest.fixture
    def document(self) -> CaptionDocument:
        return _document("um", "so", "we", "drink", "coffee", "3", "times", "a", "day")

    @pytest.fixture
    def run(self, document: CaptionDocument) -> CaptionDocument:
        return default_pipeline().run(document, CTX).unwrap()

    def test_it_finishes(self, document: CaptionDocument):
        assert default_pipeline().run(document, CTX).is_ok()

    def test_the_result_is_renderable(self, run: CaptionDocument):
        assert not validate_caption_document(run)

    def test_the_filler_is_gone(self, run: CaptionDocument):
        assert "um" not in run.segments[0].text

    def test_the_cues_are_short_enough_to_read(self, run: CaptionDocument):
        assert all(len(cue.text) <= DEFAULT_CUE_RULES.max_chars for cue in run.segments)

    def test_the_words_survive(self, run: CaptionDocument):
        assert "coffee" in run.segments[-1].text

    def test_a_dropped_filler_takes_its_time_with_it(self, run: CaptionDocument):
        assert run.segments[0].start_ms == 400

    def test_every_cue_is_positioned(self, run: CaptionDocument):
        assert all(cue.position is not None for cue in run.segments)

    def test_the_cue_earns_an_emoji(self, run: CaptionDocument):
        assert run.segments[-1].emoji

    def test_the_number_is_highlighted(self, run: CaptionDocument):
        assert any(word.highlight for cue in run.segments for word in cue.words)

    def test_the_document_is_still_valid_after_a_second_run(self, run: CaptionDocument):
        again = default_pipeline().run(run, CTX).unwrap()
        assert not validate_caption_document(again)

    def test_a_second_run_changes_nothing_that_a_viewer_can_see(self, run: CaptionDocument):
        again = default_pipeline().run(run, CTX).unwrap()
        assert [cue.text for cue in again.segments] == [cue.text for cue in run.segments]


class TestBakeFollowsThePipeline:
    def test_the_keyframes_come_from_the_finished_document(self):
        document = _document("we", "love", "coffee")
        run = (
            default_pipeline(
                look=look_for(CaptionTemplate.TIKTOK),
                baker=AnimationBaker(spec=AnimationSpec(mode=WordAnimation.BOUNCE)),
            )
            .run(document, CTX)
            .unwrap()
        )
        baked = (
            AnimationBaker(spec=AnimationSpec(mode=WordAnimation.BOUNCE))
            .bake(run, timebase=TB)
            .unwrap()
        )
        assert baked.keyframe_count > 0

    def test_the_baked_cues_are_the_cues_that_came_out(self):
        document = _document("we", "love", "coffee")
        run = default_pipeline().run(document, CTX).unwrap()
        baked = (
            AnimationBaker(spec=AnimationSpec(mode=WordAnimation.KARAOKE))
            .bake(run, timebase=TB)
            .unwrap()
        )
        assert [cue.text for cue in baked.cues] == [cue.text for cue in run.segments]


class TestWhatIsRefused:
    def test_the_pipeline_reports_a_stage_that_fails(self):
        class _No:
            name = "refine"

            def apply(self, document: CaptionDocument, ctx: StageContext):
                return failed(
                    NovaError(code="NS-CAPTION-4010", message="no", domain=ErrorDomain.CAPTION)
                )

        pipeline = default_pipeline().without("refine").inserted("refine", _No(), before="break")
        error = pipeline.run(_document("we", "love", "coffee"), CTX).unwrap_err()
        assert error.details["stage"] == "refine"

    def test_a_cue_too_fast_to_read_is_refused(self):
        words = _words("we", "love", "coffee", span_ms=100)
        document = CaptionDocument.of(
            CaptionSegment(
                index=0, start_ms=0, end_ms=words[-1].end_ms, text="we love coffee", words=words
            )
        )
        assert default_pipeline().run(document, CTX).is_err()
