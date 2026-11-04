"""The Position and Resolve stages (`services/captions/positioning.py`).

The invariant under test is the one a viewer sees and an editor cannot fix by
re-wording a line: **a caption does not cover what it must not cover**. Lower
thirds, faces, logos, HUDs, and the other caption on screen at the same moment.

The second invariant is the one that makes it usable: **the answer is a
fraction, not a pixel**. A nudge has to mean the same thing in a 480 p proxy and
a 4 K export, so the stage stores offsets of the safe area and the tests measure
in both.

No font, no shaper, no frame: a box is estimated from the lines and the widest
line, which is why the tests talk about *where the box went* rather than how
many pixels of text fit.
"""

from __future__ import annotations

import pytest

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.result import Err
from nova_studio.domain.captions import (
    CaptionAnchor,
    CaptionDocument,
    CaptionLayer,
    CaptionPosition,
    CaptionRect,
    CaptionSegment,
    CaptionWord,
    SafeArea,
)
from nova_studio.services.captions.pipeline import CaptionPipeline, StageContext
from nova_studio.services.captions.positioning import (
    DEFAULT_CHAR_ASPECT,
    DEFAULT_MAX_SHIFT_LINES,
    DEFAULT_PADDING_FRACTION,
    CuePlacer,
    cue_box,
)

pytestmark = pytest.mark.unit

FRAME = (1920, 1080)
#: What the default safe area leaves: 5% in, 10% up from the bottom.
SAFE = SafeArea().inset(*FRAME)


# -- helpers -----------------------------------------------------------------


def _cue(
    text: str = "hello there friends",
    *,
    start_ms: int = 0,
    end_ms: int = 2_000,
    **over: object,
) -> CaptionSegment:
    """A cue whose words fit inside its own span, however long the text."""
    tokens = text.split()
    step = max(1, (end_ms - start_ms) // max(1, len(tokens)))
    words = tuple(
        CaptionWord.of(token, start_ms + index * step, start_ms + index * step + step - 1)
        for index, token in enumerate(tokens)
    )
    return CaptionSegment(
        index=0,
        start_ms=start_ms,
        end_ms=end_ms,
        text=text,
        words=words,
        **over,  # type: ignore[arg-type]
    )


def _placed(*cues: CaptionSegment, ctx: StageContext | None = None, **over: object):
    result = CuePlacer(**over).apply(  # type: ignore[arg-type]
        CaptionDocument.of(*cues), ctx or StageContext()
    )
    assert not isinstance(result, Err)
    return result.unwrap()


def _box(cue: CaptionSegment, ctx: StageContext | None = None) -> CaptionRect:
    return cue_box(cue, ctx or StageContext(), aspect=DEFAULT_CHAR_ASPECT).rect


class TestTheStageItself:
    def test_the_stage_calls_itself_position(self) -> None:
        assert CuePlacer().name == "position"

    def test_the_estimates_are_estimates(self) -> None:
        placer = CuePlacer()
        assert placer.char_aspect == DEFAULT_CHAR_ASPECT
        assert placer.padding_fraction == DEFAULT_PADDING_FRACTION
        assert placer.max_shift_lines == DEFAULT_MAX_SHIFT_LINES

    def test_a_character_must_have_a_width(self) -> None:
        with pytest.raises(NovaInvariantError, match="char_aspect"):
            CuePlacer(char_aspect=0)

    def test_padding_must_not_be_negative(self) -> None:
        with pytest.raises(NovaInvariantError, match="padding_fraction"):
            CuePlacer(padding_fraction=-0.1)

    def test_a_shift_limit_must_not_be_negative(self) -> None:
        with pytest.raises(NovaInvariantError, match="max_shift_lines"):
            CuePlacer(max_shift_lines=-1)

    def test_an_empty_document_is_placed_as_an_empty_document(self) -> None:
        assert _placed().is_empty


class TestTheBox:
    def test_a_cue_sits_at_the_bottom_by_default(self) -> None:
        box = _box(_cue())
        assert box.bottom == SAFE.bottom

    def test_a_cue_is_centred_horizontally_by_default(self) -> None:
        box = _box(_cue())
        assert abs((box.x + box.width / 2) - (SAFE.x + SAFE.width / 2)) <= 1

    def test_an_anchor_puts_the_cue_where_it_says(self) -> None:
        cue = _cue(position=CaptionPosition(anchor=CaptionAnchor.TOP_LEFT))
        box = _box(cue)
        assert (box.x, box.y) == (SAFE.x, SAFE.y)

    def test_a_middle_anchor_centres_it_vertically(self) -> None:
        cue = _cue(position=CaptionPosition(anchor=CaptionAnchor.MIDDLE_RIGHT))
        box = _box(cue)
        assert box.right == SAFE.right
        assert abs((box.y + box.height / 2) - (SAFE.y + SAFE.height / 2)) <= 1

    def test_a_box_stays_inside_the_safe_area(self) -> None:
        cue = _cue(position=CaptionPosition(anchor=CaptionAnchor.TOP_RIGHT, x=0.9, y=0.9))
        box = _box(cue)
        assert box.right <= SAFE.right
        assert box.bottom <= SAFE.bottom

    def test_an_offset_moves_the_cue(self) -> None:
        box = _box(_cue(position=CaptionPosition(y=-0.2)))
        assert box.bottom < SAFE.bottom

    def test_a_longer_cue_is_wider(self) -> None:
        short = _box(_cue("hi"))
        long = _box(_cue("a much longer line of caption text"))
        assert long.width > short.width

    def test_a_two_line_cue_is_twice_as_tall(self) -> None:
        one = _cue("hello")
        two = _cue("a much longer line of caption text that must wrap onto two lines here")
        assert len(one.lines()) == 1
        assert len(two.lines()) == 2
        assert _box(two).height == 2 * _box(one).height

    def test_the_box_scales_with_the_frame(self) -> None:
        # The same fractions at twice the size: why a nudge means one thing at
        # any resolution.  Within a pixel or two, for the rounding.
        cue = _cue()
        small = cue_box(cue, StageContext(frame_size=FRAME), aspect=DEFAULT_CHAR_ASPECT).rect
        big = cue_box(cue, StageContext(frame_size=(3840, 2160)), aspect=DEFAULT_CHAR_ASPECT).rect
        assert abs(big.x - 2 * small.x) <= 2
        assert abs(big.width - 2 * small.width) <= 2
        assert abs(big.height - 2 * small.height) <= 2

    def test_a_cue_can_carry_its_own_safe_area(self) -> None:
        tight = SafeArea(left=0.2, right=0.2, top=0.2, bottom=0.2)
        cue = _cue(position=CaptionPosition(anchor=CaptionAnchor.TOP_LEFT, safe_area=tight))
        assert _box(cue).x == tight.inset(*FRAME).x
        assert _box(cue).y == tight.inset(*FRAME).y

    def test_the_box_knows_its_anchor(self) -> None:
        cue = _cue(position=CaptionPosition(anchor=CaptionAnchor.TOP_LEFT))
        assert cue_box(cue, StageContext(), aspect=DEFAULT_CHAR_ASPECT).anchor is (
            CaptionAnchor.TOP_LEFT
        )

    def test_a_box_knows_what_it_is_on_screen_with(self) -> None:
        ctx = StageContext()
        first = cue_box(_cue(start_ms=0, end_ms=1_000), ctx, aspect=DEFAULT_CHAR_ASPECT)
        second = cue_box(_cue(start_ms=900, end_ms=2_000), ctx, aspect=DEFAULT_CHAR_ASPECT)
        third = cue_box(_cue(start_ms=1_000, end_ms=3_000), ctx, aspect=DEFAULT_CHAR_ASPECT)
        assert first.on_screen_with(second)
        assert not first.on_screen_with(third)


class TestGettingOutOfTheWay:
    def test_an_unobstructed_cue_is_not_moved(self) -> None:
        cue = _cue()
        assert _placed(cue).segments[0].position == CaptionPosition()

    def test_a_cue_covering_a_protected_region_is_moved(self) -> None:
        lower_third = CaptionRect(x=100, y=800, width=900, height=200)
        ctx = StageContext(protected=(lower_third,))
        before = _box(_cue(), ctx)
        assert before.overlaps(lower_third)
        after = _box(_placed(_cue(), ctx=ctx).segments[0], ctx)
        assert not after.overlaps(lower_third)

    def test_a_bottom_cue_moves_up(self) -> None:
        # Away from the edge it is sitting on: moving down would leave the frame.
        lower_third = CaptionRect(x=100, y=800, width=900, height=200)
        ctx = StageContext(protected=(lower_third,))
        moved = _placed(_cue(), ctx=ctx).segments[0]
        assert moved.position is not None and moved.position.y < 0

    def test_a_top_cue_moves_down(self) -> None:
        banner = CaptionRect(x=100, y=60, width=900, height=100)
        cue = _cue(position=CaptionPosition(anchor=CaptionAnchor.TOP_CENTER))
        ctx = StageContext(protected=(banner,))
        moved = _placed(cue, ctx=ctx).segments[0]
        assert moved.position is not None and moved.position.y > 0

    def test_a_cue_that_cannot_escape_stays_put(self) -> None:
        # Moved, never hidden: a caption over a logo is a mistake a viewer can
        # read past, and a caption the engine dropped is information gone.
        wall = CaptionRect(x=0, y=0, width=1920, height=1080)
        ctx = StageContext(protected=(wall,))
        placed = _placed(_cue(), ctx=ctx)
        assert placed.segments[0].position == CaptionPosition()

    def test_a_cue_moves_no_further_than_it_is_allowed(self) -> None:
        lower_third = CaptionRect(x=100, y=800, width=900, height=200)
        ctx = StageContext(protected=(lower_third,))
        box = _box(_cue(), ctx)
        moved = _placed(_cue(), ctx=ctx, max_shift_lines=DEFAULT_MAX_SHIFT_LINES).segments[0]
        assert moved.position is not None
        shift = abs(moved.position.y) * SAFE.height
        assert shift <= DEFAULT_MAX_SHIFT_LINES * box.height * (1 + DEFAULT_PADDING_FRACTION)

    def test_an_offset_stays_inside_what_the_domain_allows(self) -> None:
        lower_third = CaptionRect(x=100, y=0, width=900, height=1000)
        ctx = StageContext(protected=(lower_third,))
        for cue in _placed(_cue(), _cue(start_ms=3_000, end_ms=5_000), ctx=ctx).segments:
            assert cue.position is not None
            assert -1.0 <= cue.position.x <= 1.0
            assert -1.0 <= cue.position.y <= 1.0

    def test_placing_twice_changes_nothing(self) -> None:
        lower_third = CaptionRect(x=100, y=800, width=900, height=200)
        ctx = StageContext(protected=(lower_third,))
        once = _placed(_cue(), ctx=ctx)
        assert _placed(*once.segments, ctx=ctx).segments == once.segments


class TestWhatIsNeverMoved:
    def test_a_locked_cue_is_left_exactly_where_it_is(self) -> None:
        lower_third = CaptionRect(x=100, y=800, width=900, height=200)
        locked = _cue(locked=True)
        ctx = StageContext(protected=(lower_third,))
        assert _placed(locked, ctx=ctx).segments[0] == locked

    def test_a_locked_cue_is_an_obstacle_for_others(self) -> None:
        # If it does not move, everything else has to go around it.
        locked = _cue(locked=True)
        other = _cue("a second line", start_ms=0, end_ms=2_000)
        document = CaptionDocument.of(locked, other)
        placed = CuePlacer().apply(document, StageContext()).unwrap()
        boxes = [_box(cue) for cue in placed.segments]
        assert not boxes[0].overlaps(boxes[1])


class TestTwoCaptionsAtOnce:
    """A translation beside its original is two boxes that must never touch."""

    def _bilingual(self) -> CaptionDocument:
        layers = (CaptionLayer.primary(), CaptionLayer(layer_id="es", name="Spanish"))
        return CaptionDocument(
            segments=(
                _cue("hello there friends", layer_id="primary"),
                _cue("hola mis amigos", layer_id="es"),
            ),
            layers=layers,
        )

    def test_two_concurrent_cues_do_not_overlap(self) -> None:
        placed = CuePlacer().apply(self._bilingual(), StageContext()).unwrap()
        boxes = [_box(cue) for cue in placed.segments]
        assert not boxes[0].overlaps(boxes[1])

    def test_the_first_one_keeps_its_anchor(self) -> None:
        placed = CuePlacer().apply(self._bilingual(), StageContext()).unwrap()
        assert placed.segments[0].position == CaptionPosition()

    def test_cues_that_never_meet_do_not_push_each_other(self) -> None:
        document = CaptionDocument.of(
            _cue("first line", start_ms=0, end_ms=2_000),
            _cue("second line", start_ms=10_000, end_ms=12_000),
        )
        placed = CuePlacer().apply(document, StageContext()).unwrap()
        assert all(cue.position == CaptionPosition() for cue in placed.segments)

    def test_a_translation_that_starts_higher_is_left_alone(self) -> None:
        layers = (CaptionLayer.primary(), CaptionLayer(layer_id="es", name="Spanish"))
        document = CaptionDocument(
            segments=(
                _cue("hello there friends", layer_id="primary"),
                _cue(
                    "hola mis amigos",
                    layer_id="es",
                    position=CaptionPosition(anchor=CaptionAnchor.TOP_CENTER),
                ),
            ),
            layers=layers,
        )
        placed = CuePlacer().apply(document, StageContext()).unwrap()
        assert placed.segments[1].position == CaptionPosition(anchor=CaptionAnchor.TOP_CENTER)


class TestTheDocumentThatComesOut:
    def test_indices_stay_sequential(self) -> None:
        document = CaptionDocument.of(
            _cue("first", start_ms=0, end_ms=2_000),
            _cue("second", start_ms=3_000, end_ms=5_000),
        )
        placed = CuePlacer().apply(document, StageContext()).unwrap()
        assert [cue.index for cue in placed.segments] == [0, 1]

    def test_the_words_are_untouched(self) -> None:
        cue = _cue()
        assert _placed(cue).segments[0].words == cue.words

    def test_the_text_is_untouched(self) -> None:
        cue = _cue("the exact words of the line")
        assert _placed(cue).segments[0].text == "the exact words of the line"

    def test_the_layer_is_untouched(self) -> None:
        layers = (CaptionLayer.primary(), CaptionLayer(layer_id="es", name="Spanish"))
        document = CaptionDocument(segments=(_cue(layer_id="es"),), layers=layers)
        placed = CuePlacer().apply(document, StageContext()).unwrap()
        assert placed.segments[0].layer_id == "es"

    def test_the_stage_runs_inside_a_pipeline(self) -> None:
        lower_third = CaptionRect(x=100, y=800, width=900, height=200)
        document = CaptionDocument.of(_cue())
        pipeline = CaptionPipeline().with_stage("position", CuePlacer())
        result = pipeline.run(document, StageContext(protected=(lower_third,)))
        assert not isinstance(result, Err)
        moved = result.unwrap().segments[0]
        assert moved.position is not None and moved.position.y < 0

    def test_the_stage_can_be_switched_off(self) -> None:
        lower_third = CaptionRect(x=100, y=800, width=900, height=200)
        document = CaptionDocument.of(_cue())
        pipeline = CaptionPipeline().with_stage("position", CuePlacer()).disabled_stage("position")
        kept = pipeline.run(document, StageContext(protected=(lower_third,))).unwrap()
        assert kept.segments[0].position is None
