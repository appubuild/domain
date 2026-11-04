"""The Bake stage, from the outside in.

The promise being tested is the one ADR-0009 §6 makes: caption animation is
the editor's own keyframes, so what a preview shows and what an export writes
cannot drift apart — both read these numbers. So the tests ask what a renderer
would ask (what is this word's scale at this frame?) and what an editor would
ask (can I see the overshoot?), never how the baker got there.
"""

from __future__ import annotations

from itertools import pairwise

import pytest

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.temporal import Timebase
from nova_studio.domain.captions import CaptionDocument, CaptionSegment, CaptionWord
from nova_studio.services.captions.bake import (
    DEFAULT_BAKE_SPEC,
    PARAM_FILL,
    PARAM_OFFSET,
    PARAM_OPACITY,
    PARAM_SCALE,
    SPECS,
    AnimationBaker,
    AnimationSpec,
    BakedCaptions,
    BakedCue,
    BakedPiece,
    Granularity,
    bake_cue,
    spec_for,
)
from nova_studio.services.captions.pipeline import StageContext
from nova_studio.services.captions.styles import CaptionTemplate, WordAnimation, look_for

TB = Timebase(num=30, den=1)

pytestmark = pytest.mark.unit


def _words(*text: str, start_ms: int = 0, span_ms: int = 400) -> tuple[CaptionWord, ...]:
    return tuple(
        CaptionWord.of(
            word,
            start_ms + index * span_ms,
            start_ms + index * span_ms + span_ms - 50,
        )
        for index, word in enumerate(text)
    )


def _segment(*text: str, index: int = 0, start_ms: int = 0, **over: object) -> CaptionSegment:
    words = _words(*text, start_ms=start_ms)
    defaults = {
        "index": index,
        "start_ms": words[0].start_ms,
        "end_ms": words[-1].end_ms,
        "text": " ".join(text),
        "words": words,
    }
    return CaptionSegment(**{**defaults, **over})  # type: ignore[arg-type]


def _document(*segments: CaptionSegment) -> CaptionDocument:
    return CaptionDocument.of(*segments)


def _baked(*words: str, spec: AnimationSpec = DEFAULT_BAKE_SPEC, **over: object) -> BakedCue:
    return bake_cue(_segment(*words, **over), spec, TB)


def _peak(piece: BakedPiece, name: str = PARAM_SCALE) -> float:
    parameter = piece.parameter(name)
    assert parameter is not None
    return max(
        parameter.at(frame)[0] for frame in range(piece.start_frame - 2, piece.end_frame + 8)
    )


class TestTheBaker:
    def test_it_is_called_bake(self):
        assert AnimationBaker().name == "bake"

    def test_out_of_the_box_it_animates_nothing(self):
        baked = AnimationBaker().bake(_document(_segment("good", "morning")), timebase=TB).unwrap()
        assert baked.keyframe_count == 0

    def test_the_document_passes_through_the_stage(self):
        document = _document(_segment("good", "morning"))
        ctx = StageContext()
        assert AnimationBaker().apply(document, ctx).unwrap() is document

    def test_one_cue_becomes_one_baked_cue(self):
        document = _document(_segment("one"), _segment("two"))
        baked = AnimationBaker(spec=SPECS[WordAnimation.ZOOM]).bake(document, timebase=TB).unwrap()
        assert len(baked.cues) == 2

    def test_the_timebase_is_carried(self):
        baked = AnimationBaker().bake(_document(_segment("hi")), timebase=TB).unwrap()
        assert baked.timebase is TB

    def test_the_cue_keeps_its_text(self):
        assert _baked("good", "morning").text == "good morning"

    def test_a_cue_can_be_looked_up_by_its_index(self):
        baked = (
            AnimationBaker().bake(_document(_segment("one"), _segment("two")), timebase=TB).unwrap()
        )
        assert baked.cue(1) is baked.cues[1]

    def test_a_cue_that_is_not_there_is_none(self):
        assert (
            AnimationBaker().bake(_document(_segment("one")), timebase=TB).unwrap().cue(9) is None
        )

    def test_only_the_pieces_on_screen_at_a_frame_come_back(self):
        document = _document(_segment("first", "cue"), _segment("second", "cue", start_ms=2000))
        baked = AnimationBaker().bake(document, timebase=TB).unwrap()
        assert len(baked.pieces_at(0)) == 2
        assert len(baked.pieces_at(1000)) == 0

    def test_baking_leaves_the_document_alone(self):
        document = _document(_segment("good", "morning"))
        AnimationBaker(spec=SPECS[WordAnimation.BOUNCE]).bake(document, timebase=TB)
        assert document.segments[0].text == "good morning"


class TestNothingIsAnimated:
    def test_every_parameter_is_constant(self):
        cue = _baked("good", "morning")
        constants = [() for piece in cue.pieces for parameter in piece.parameters]
        assert [
            parameter.keyframes for piece in cue.pieces for parameter in piece.parameters
        ] == constants

    def test_a_word_is_fully_there(self):
        piece = _baked("good").pieces[0]
        assert piece.parameter(PARAM_OPACITY).at(0) == (1.0,)

    def test_a_word_is_where_it_belongs(self):
        piece = _baked("good").pieces[0]
        assert piece.parameter(PARAM_OFFSET).at(0) == (0.0, 0.0)

    def test_nothing_is_ever_filled(self):
        piece = _baked("good").pieces[0]
        assert piece.parameter(PARAM_FILL).at(piece.end_frame) == (0.0,)

    def test_the_cue_itself_does_not_fade(self):
        assert _baked("good").parameter(PARAM_OPACITY).keyframes == ()


class TestKaraoke:
    @pytest.fixture
    def cue(self) -> BakedCue:
        return _baked("we", "love", "coffee", spec=SPECS[WordAnimation.KARAOKE])

    def test_the_words_do_not_move(self, cue):
        assert _peak(cue.pieces[1]) == 1.0

    def test_a_word_is_visible_before_it_is_spoken(self, cue):
        piece = cue.pieces[1]
        assert piece.parameter(PARAM_OPACITY).at(piece.start_frame - 1) == (1.0,)

    def test_a_word_fills_as_it_is_spoken(self, cue):
        piece = cue.pieces[1]
        assert piece.parameter(PARAM_FILL).at(piece.start_frame) == (0.0,)
        assert piece.parameter(PARAM_FILL).at(piece.end_frame) == (1.0,)

    def test_a_word_half_spoken_is_half_filled(self, cue):
        piece = cue.pieces[1]
        middle = (piece.start_frame + piece.end_frame) // 2
        assert 0.3 < piece.parameter(PARAM_FILL).at(middle)[0] < 0.7

    def test_a_word_stays_filled_once_it_is_spoken(self, cue):
        piece = cue.pieces[1]
        assert piece.parameter(PARAM_FILL).at(60) == (1.0,)

    def test_every_word_is_filled_in_turn(self, cue):
        assert [piece.parameter(PARAM_FILL).at(piece.end_frame) for piece in cue.pieces] == [
            (1.0,),
            (1.0,),
            (1.0,),
        ]


class TestSlide:
    @pytest.fixture
    def piece(self) -> BakedPiece:
        return _baked("we", "love", "coffee", spec=SPECS[WordAnimation.SLIDE]).pieces[1]

    def test_a_word_starts_off_from_where_it_belongs(self, piece):
        assert piece.parameter(PARAM_OFFSET).at(piece.start_frame) == (0.0, 0.75)

    def test_a_word_arrives_where_it_belongs(self, piece):
        assert piece.parameter(PARAM_OFFSET).at(piece.end_frame) == (0.0, 0.0)

    def test_it_slides_upwards(self, piece):
        first = piece.parameter(PARAM_OFFSET).at(piece.start_frame)[1]
        middle = piece.parameter(PARAM_OFFSET).at(piece.start_frame + 2)[1]
        assert 0.0 < middle < first

    def test_a_word_fades_up_as_it_arrives(self, piece):
        assert piece.parameter(PARAM_OPACITY).at(piece.start_frame) == (0.0,)
        assert piece.parameter(PARAM_OPACITY).at(piece.end_frame) == (1.0,)

    def test_a_word_is_invisible_before_it_arrives(self, piece):
        assert piece.parameter(PARAM_OPACITY).at(piece.start_frame - 1) == (0.0,)

    def test_a_sliding_word_does_not_change_size(self, piece):
        assert _peak(piece) == 1.0


class TestZoom:
    @pytest.fixture
    def piece(self) -> BakedPiece:
        return _baked("we", "love", "coffee", spec=SPECS[WordAnimation.ZOOM]).pieces[1]

    def test_a_word_starts_smaller(self, piece):
        assert piece.parameter(PARAM_SCALE).at(piece.start_frame) == (0.6,)

    def test_a_word_ends_full_size(self, piece):
        assert piece.parameter(PARAM_SCALE).at(piece.start_frame + 5) == (1.0,)

    def test_it_grows(self, piece):
        assert piece.parameter(PARAM_SCALE).at(piece.start_frame + 2)[0] > 0.6

    def test_it_does_not_overshoot(self, piece):
        assert _peak(piece) == 1.0

    def test_a_zooming_word_stays_where_it_belongs(self, piece):
        assert piece.parameter(PARAM_OFFSET).at(piece.start_frame) == (0.0, 0.0)


class TestBounce:
    @pytest.fixture
    def piece(self) -> BakedPiece:
        return _baked("we", "love", "coffee", spec=SPECS[WordAnimation.BOUNCE]).pieces[1]

    def test_it_overshoots_and_settles(self, piece):
        assert round(_peak(piece), 2) == 1.18
        assert piece.parameter(PARAM_SCALE).at(piece.end_frame) == (1.0,)

    def test_the_overshoot_is_a_keyframe_an_editor_can_grab(self, piece):
        assert [keyframe.frame for keyframe in piece.parameter(PARAM_SCALE).keyframes] == [
            12,
            15,
            18,
        ]

    def test_it_settles_from_above(self, piece):
        assert piece.parameter(PARAM_SCALE).at(piece.start_frame + 5)[0] > 1.0

    def test_a_bouncing_word_fades_up(self, piece):
        assert piece.parameter(PARAM_OPACITY).at(piece.start_frame) == (0.0,)


class TestLetters:
    def test_a_word_can_arrive_a_letter_at_a_time(self):
        cue = _baked(
            "coffee", spec=AnimationSpec(mode=WordAnimation.ZOOM, granularity=Granularity.CHAR)
        )
        assert [piece.text for piece in cue.pieces] == list("coffee")

    def test_a_letter_knows_it_is_a_letter(self):
        cue = _baked(
            "coffee", spec=AnimationSpec(mode=WordAnimation.KARAOKE, granularity=Granularity.CHAR)
        )
        assert cue.pieces[0].is_letter

    def test_a_whole_word_knows_it_is_not(self):
        assert not _baked("coffee").pieces[0].is_letter

    def test_letters_know_which_word_they_came_from(self):
        cue = _baked("we", "love", spec=AnimationSpec(granularity=Granularity.CHAR))
        assert {piece.word_index for piece in cue.pieces} == {0, 1}

    def test_letters_are_staggered(self):
        def starts(spec: AnimationSpec) -> list[int]:
            return [
                piece.parameter(PARAM_SCALE).keyframes[0].frame
                for piece in _baked("coffee", spec=spec).pieces
            ]

        def gaps(spec: AnimationSpec) -> list[int]:
            frames = starts(spec)
            return [later - earlier for earlier, later in pairwise(frames)]

        without = AnimationSpec(mode=WordAnimation.ZOOM, granularity=Granularity.CHAR, stagger_ms=0)
        staggered = AnimationSpec(
            mode=WordAnimation.ZOOM, granularity=Granularity.CHAR, stagger_ms=100
        )
        assert all(
            staggered_gap - plain_gap == 3
            for staggered_gap, plain_gap in zip(gaps(staggered), gaps(without), strict=True)
        )

    def test_a_letter_fills_as_it_is_spoken(self):
        cue = _baked(
            "coffee", spec=AnimationSpec(mode=WordAnimation.KARAOKE, granularity=Granularity.CHAR)
        )
        assert [piece.parameter(PARAM_FILL).at(piece.end_frame)[0] for piece in cue.pieces] == [
            1.0
        ] * 6

    def test_a_word_with_no_letter_times_falls_back_to_the_whole_word(self):
        word = CaptionWord(text="coffee", start_ms=0, end_ms=400)
        segment = CaptionSegment(index=0, start_ms=0, end_ms=400, text="coffee", words=(word,))
        cue = bake_cue(segment, AnimationSpec(granularity=Granularity.CHAR), TB)
        assert [(piece.text, piece.is_letter) for piece in cue.pieces] == [("coffee", False)]


class TestTheCue:
    def test_a_cue_can_fade_in_and_out(self):
        spec = AnimationSpec(cue_fade_in_ms=100, cue_fade_out_ms=100)
        cue = _baked("good", "morning", spec=spec)
        opacity = cue.parameter(PARAM_OPACITY)
        assert opacity.at(0) == (0.0,)
        assert opacity.at(6) == (1.0,)

    def test_a_cue_that_does_not_fade_is_constant(self):
        assert _baked("good").parameter(PARAM_OPACITY).at(0) == (1.0,)

    def test_the_cues_frames_come_from_its_milliseconds(self):
        cue = _baked("good", "morning")
        assert (cue.start_frame, cue.end_frame) == (0, 22)

    def test_a_cue_is_at_least_one_frame_long(self):
        segment = CaptionSegment(index=0, start_ms=0, end_ms=10, text="hi", words=())
        assert bake_cue(segment, DEFAULT_BAKE_SPEC, TB).end_frame == 1

    def test_the_mode_is_recorded(self):
        cue = _baked("good", spec=SPECS[WordAnimation.BOUNCE])
        assert cue.mode == "bounce"

    def test_which_cue_it_stands_for_can_be_said(self):
        assert bake_cue(_segment("good", index=3), DEFAULT_BAKE_SPEC, TB, 3).segment_index == 3

    def test_a_cue_with_no_words_has_no_pieces(self):
        segment = CaptionSegment(index=0, start_ms=0, end_ms=400, text="hi", words=())
        assert bake_cue(segment, DEFAULT_BAKE_SPEC, TB).pieces == ()

    def test_the_keyframes_a_cue_carries_can_be_counted(self):
        cue = _baked("good", "morning", spec=SPECS[WordAnimation.ZOOM])
        assert cue.keyframe_count == 8


class TestWhereTheModeComesFrom:
    def test_a_look_decides_for_a_cue_that_says_nothing(self):
        baked = (
            AnimationBaker()
            .bake(_document(_segment("good")), timebase=TB, look=look_for(CaptionTemplate.TIKTOK))
            .unwrap()
        )
        assert baked.cues[0].mode == "bounce"

    def test_a_cue_can_speak_for_itself(self):
        segment = _segment("good", style_overrides={"word_animation": "slide"})
        baked = (
            AnimationBaker()
            .bake(_document(segment), timebase=TB, look=look_for(CaptionTemplate.TIKTOK))
            .unwrap()
        )
        assert baked.cues[0].mode == "slide"

    def test_the_bakers_own_spec_is_the_last_word(self):
        baker = AnimationBaker(spec=SPECS[WordAnimation.ZOOM])
        baked = baker.bake(_document(_segment("good")), timebase=TB).unwrap()
        assert baked.cues[0].mode == "zoom"

    def test_a_mode_nobody_knows_is_an_error(self):
        segment = _segment("good", style_overrides={"word_animation": "vortex"})
        result = AnimationBaker().bake(_document(segment), timebase=TB)
        assert result.unwrap_err().code == "NS-CAPTION-4014"

    def test_the_error_names_the_cue(self):
        document = _document(
            _segment("one"), _segment("two", style_overrides={"word_animation": "vortex"})
        )
        error = AnimationBaker().bake(document, timebase=TB).unwrap_err()
        assert error.details["segment"] == 1

    def test_the_error_names_the_mode(self):
        segment = _segment("good", style_overrides={"word_animation": "vortex"})
        error = AnimationBaker().bake(_document(segment), timebase=TB).unwrap_err()
        assert error.details["mode"] == "vortex"

    def test_the_error_says_what_is_known(self):
        segment = _segment("good", style_overrides={"word_animation": "vortex"})
        assert (
            "karaoke" in AnimationBaker().bake(_document(segment), timebase=TB).unwrap_err().remedy
        )

    def test_one_bad_cue_stops_the_whole_document(self):
        document = _document(
            _segment("one"), _segment("two", style_overrides={"word_animation": "vortex"})
        )
        assert AnimationBaker().bake(document, timebase=TB).is_err()


class TestTheSpec:
    def test_every_mode_has_a_spec(self):
        assert set(SPECS) == set(WordAnimation)

    def test_a_spec_can_be_looked_up_by_name(self):
        assert spec_for("bounce").unwrap().mode is WordAnimation.BOUNCE

    def test_a_mode_nobody_knows_has_no_spec(self):
        assert spec_for("vortex").is_err()

    def test_the_default_spec_animates_nothing(self):
        assert DEFAULT_BAKE_SPEC.mode is WordAnimation.NONE

    def test_modes_are_presets_and_not_code_paths(self):
        assert SPECS[WordAnimation.SLIDE].mode is WordAnimation.SLIDE
        assert SPECS[WordAnimation.KARAOKE].enter_ms == 0

    @pytest.mark.parametrize(
        "change",
        [
            {"enter_ms": -1},
            {"zoom_from": 0.0},
            {"zoom_from": 1.5},
            {"overshoot": 0.9},
            {"slide_lines": -1.0},
            {"stagger_ms": -1},
            {"cue_fade_in_ms": -1},
            {"cue_fade_out_ms": -1},
        ],
    )
    def test_a_spec_that_makes_no_sense_is_refused(self, change):
        with pytest.raises(NovaInvariantError):
            AnimationSpec(**change)

    def test_a_spec_says_how_long_a_piece_takes_to_arrive(self):
        assert AnimationSpec(enter_ms=200).enter_ms == 200


class TestWhatComesOut:
    def test_it_is_baked_captions(self):
        baked = AnimationBaker().bake(_document(_segment("good")), timebase=TB).unwrap()
        assert isinstance(baked, BakedCaptions)

    def test_the_pieces_are_baked_pieces(self):
        cue = _baked("good")
        assert isinstance(cue.pieces[0], BakedPiece)

    def test_a_piece_knows_its_own_frames(self):
        piece = _baked("good", "morning").pieces[1]
        assert (piece.start_frame, piece.end_frame) == (12, 22)

    def test_a_piece_that_has_no_such_parameter_is_none(self):
        assert _baked("good").pieces[0].parameter("rotation") is None

    def test_a_cue_that_has_no_such_parameter_is_none(self):
        assert _baked("good").parameter("rotation") is None

    def test_every_piece_carries_every_parameter(self):
        piece = _baked("good").pieces[0]
        assert [parameter.name for parameter in piece.parameters] == [
            PARAM_FILL,
            PARAM_SCALE,
            PARAM_OFFSET,
            PARAM_OPACITY,
        ]
