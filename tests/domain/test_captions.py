"""The caption authoring model (ADR-0009 §2, §7, §8).

This is the document the user edits, so the properties pinned here are the ones
a caption editor lives or dies by:

* **A character is what a person sees.**  ``graphemes`` does not split a flag,
  an accented letter or an emoji sequence, because caption animation animates
  characters and a half-glyph mid-animation is a visible bug.
* **Derived timings are labelled as derived.**  ``split_chars`` produces
  ``estimated`` characters, so the UI can say "estimated" instead of presenting
  a weighted guess as a measurement.
* **A cue is never silently truncated.**  ``wrap_caption`` returns more lines
  rather than dropping words, and balances them, because 21 + 21 reads and
  40 + 2 does not.
* **Human edits survive re-transcription.**  ``merge_deltas`` re-attaches
  corrections by alignment key, falls back to a text match within a tolerance,
  and returns what it could not place instead of guessing.  The one
  destructive rule — a text edit discards word timings — is reported in
  ``timings_dropped``.
* **A document that cannot be shown is refused before it reaches the
  renderer.**  ``validate_caption_document`` names the first problem: an
  overlap, a cue too short to read, a cue read faster than anyone can read.

Everything here is pure.  No audio, no model, no clock: the caption engine after
``Transcribe`` is verifiable with no weights on the machine, which is the
decisive property ADR-0009 buys.
"""

from __future__ import annotations

import itertools
import json
from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.core import NovaInvariantError
from nova_studio.core.temporal import DEFAULT_TIMEBASE, Rounding
from nova_studio.domain.captions import (
    ALIGNMENT_KEY_BUCKET_MS,
    CAPTION_DOCUMENT_VERSION,
    CAPTION_MAX_CPS,
    CAPTION_MAX_LINE_CHARS,
    CAPTION_MAX_LINES,
    CAPTION_MIN_DURATION_MS,
    DEFAULT_LAYER_ID,
    DEFAULT_MERGE_TOLERANCE_MS,
    CaptionAnchor,
    CaptionChar,
    CaptionDelta,
    CaptionDeltaKind,
    CaptionDocument,
    CaptionLayer,
    CaptionLayerKind,
    CaptionPosition,
    CaptionRect,
    CaptionRevision,
    CaptionSegment,
    CaptionTarget,
    CaptionWord,
    RevisionOrigin,
    SafeArea,
    alignment_key,
    graphemes,
    merge_deltas,
    normalise_text,
    reading_rate_cps,
    split_chars,
    validate_caption_document,
    wrap_caption,
)

if TYPE_CHECKING:
    from collections.abc import Mapping

pytestmark = pytest.mark.unit


# -- builders -----------------------------------------------------------------


def _word(text: str = "hello", start_ms: int = 0, end_ms: int = 500, **over: Any) -> CaptionWord:
    return CaptionWord(**{"text": text, "start_ms": start_ms, "end_ms": end_ms, **over})


def _segment(
    index: int = 0,
    start_ms: int = 0,
    end_ms: int = 1_000,
    text: str = "hello world",
    **over: Any,
) -> CaptionSegment:
    return CaptionSegment(
        **{"index": index, "start_ms": start_ms, "end_ms": end_ms, "text": text, **over}
    )


def _words(*specs: tuple[str, int, int]) -> tuple[CaptionWord, ...]:
    return tuple(CaptionWord.of(text, start, end) for text, start, end in specs)


def _timed(text: str = "hello world", start_ms: int = 0, end_ms: int = 1_000) -> CaptionSegment:
    """A cue whose words are timed and split halfway through its span."""
    midpoint = start_ms + (end_ms - start_ms) // 2
    first, second = text.split(" ", 1)
    return _segment(
        start_ms=start_ms,
        end_ms=end_ms,
        text=text,
        words=_words((first, start_ms, midpoint), (second, midpoint, end_ms)),
    )


def _delta(key: str, kind: CaptionDeltaKind, **over: Any) -> CaptionDelta:
    return CaptionDelta(**{"key": key, "kind": kind, **over})


def _round_trip(wire: Mapping[str, Any]) -> Mapping[str, Any]:
    """JSON in and out, which is what the project file does."""
    return json.loads(json.dumps(wire))


class TestGraphemes:
    def test_ascii_splits_per_character(self) -> None:
        assert graphemes("abc") == ("a", "b", "c")

    def test_a_precomposed_accented_letter_is_one_character(self) -> None:
        assert graphemes("café") == ("c", "a", "f", "é")

    def test_a_decomposed_accented_letter_is_one_character(self) -> None:
        """A combining mark must not become a character of its own."""
        assert graphemes("café") == ("c", "a", "f", "é")

    def test_an_emoji_is_one_character(self) -> None:
        assert graphemes("a😀b") == ("a", "😀", "b")

    def test_a_flag_is_one_character(self) -> None:
        """Two regional indicators: splitting them shows two letters mid-animation."""
        assert graphemes("🇧🇩") == ("🇧🇩",)

    def test_a_skin_tone_emoji_is_one_character(self) -> None:
        assert graphemes("👍🏽") == ("👍🏽",)

    def test_a_zwj_sequence_is_one_character(self) -> None:
        assert graphemes("👨‍👩‍👧") == ("👨‍👩‍👧",)

    def test_cjk_splits_per_glyph(self) -> None:
        assert graphemes("日本語") == ("日", "本", "語")

    def test_the_empty_string_has_no_characters(self) -> None:
        assert graphemes("") == ()


class TestSplitChars:
    def test_characters_cover_the_whole_word_exactly(self) -> None:
        chars = split_chars("hello", 0, 500)
        assert chars[0].start_ms == 0
        assert chars[-1].end_ms == 500

    def test_character_timings_never_go_backwards(self) -> None:
        chars = split_chars("hello", 100, 900)
        assert all(a.end_ms <= b.end_ms for a, b in itertools.pairwise(chars))

    def test_a_vowel_is_held_longer_than_a_consonant(self) -> None:
        """ADR-0009 §2: the split is weighted by character class, not length."""
        chars = split_chars("hat", 0, 300)
        durations = {char.text: char.duration_ms for char in chars}
        assert durations["a"] > durations["h"]
        assert durations["a"] > durations["t"]

    def test_punctuation_is_barely_held(self) -> None:
        chars = split_chars("a-b", 0, 1_000)
        durations = {char.text: char.duration_ms for char in chars}
        assert durations["-"] < durations["b"]

    def test_a_wide_glyph_is_held_longer_than_a_letter(self) -> None:
        chars = split_chars("a日", 0, 1_000)
        assert chars[1].duration_ms > chars[0].duration_ms

    def test_derived_timings_are_marked_estimated(self) -> None:
        """A guess must never be presented as a measurement."""
        assert all(char.estimated for char in split_chars("hello", 0, 500))

    def test_a_zero_length_word_gives_zero_length_characters(self) -> None:
        chars = split_chars("hi", 500, 500)
        assert [char.duration_ms for char in chars] == [0, 0]

    def test_empty_text_has_no_characters(self) -> None:
        assert split_chars("", 0, 500) == ()

    def test_reversed_time_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="must not precede"):
            split_chars("hi", 500, 400)


class TestNormaliseText:
    def test_punctuation_and_case_are_folded_away(self) -> None:
        assert normalise_text("Hello, World!") == "hello world"

    def test_whitespace_is_collapsed(self) -> None:
        assert normalise_text("hello   world") == "hello world"

    def test_compatibility_forms_are_folded(self) -> None:
        assert normalise_text("ﬁle") == normalise_text("file")

    def test_repunctuating_a_sentence_does_not_change_its_key(self) -> None:
        """The whole point: a correction survives a re-transcription."""
        assert normalise_text("Hello, world!") == normalise_text("hello world")


class TestAlignmentKey:
    def test_the_key_is_text_and_a_bucketed_time(self) -> None:
        assert alignment_key("Hello, world!", 1_234) == "hello world@1000"

    def test_the_bucket_absorbs_a_small_drift(self) -> None:
        assert ALIGNMENT_KEY_BUCKET_MS == 500
        assert alignment_key("hello", 0) == alignment_key("hello", 499)

    def test_a_drift_across_a_bucket_changes_the_key(self) -> None:
        assert alignment_key("hello", 0) != alignment_key("hello", 500)

    def test_a_negative_time_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="start_ms"):
            alignment_key("hello", -1)


class TestReadingRate:
    def test_characters_per_second(self) -> None:
        assert reading_rate_cps(_segment(text="a" * 20, end_ms=1_000)) == 20.0

    def test_a_zero_duration_cue_reads_as_infinitely_fast(self) -> None:
        """It is unreadable; dividing by zero would hide that."""
        assert reading_rate_cps(_segment(text="hello", end_ms=0)) == float("inf")

    def test_the_ceiling_is_twenty(self) -> None:
        assert CAPTION_MAX_CPS == 20
        assert reading_rate_cps(_segment(text="a" * 20, end_ms=1_000)) <= CAPTION_MAX_CPS
        assert reading_rate_cps(_segment(text="a" * 40, end_ms=1_000)) > CAPTION_MAX_CPS


class TestWrapCaption:
    def test_a_short_caption_is_one_line(self) -> None:
        assert wrap_caption("Hello there") == ("Hello there",)

    def test_a_long_caption_is_split(self) -> None:
        lines = wrap_caption("Hello there, this is a fairly long caption line for testing")
        assert len(lines) == 2

    def test_the_lines_are_balanced_not_greedily_filled(self) -> None:
        """21 + 21 reads; 40 + 2 does not."""
        lines = wrap_caption("Hello there, this is a fairly long caption line for testing")
        assert [len(line) for line in lines] == [29, 29]

    def test_no_line_exceeds_the_character_budget_unless_it_must(self) -> None:
        lines = wrap_caption("one two three four five six seven eight nine ten eleven twelve")
        assert all(len(line) <= CAPTION_MAX_LINE_CHARS for line in lines)

    def test_text_is_never_truncated(self) -> None:
        long_text = " ".join(["word"] * 40)
        lines = wrap_caption(long_text)
        assert " ".join(lines) == long_text
        assert len(lines) > CAPTION_MAX_LINES

    def test_an_unbreakable_word_gets_its_own_line(self) -> None:
        lines = wrap_caption("supercalifragilisticexpialidocious and more words here now")
        assert lines[0] == "supercalifragilisticexpialidocious"

    def test_cjk_breaks_between_glyphs(self) -> None:
        """Scriptio continua has no spaces to break on."""
        text = "これはテスト用の非常に長い字幕のテキストです" * 2
        lines = wrap_caption(text)
        assert len(lines) == 2
        assert "".join(lines) == text

    def test_latin_keeps_its_spaces_when_joined(self) -> None:
        text = "one two three four five six seven eight nine ten eleven twelve thirteen"
        assert " ".join(wrap_caption(text)) == text

    def test_a_single_character_budget_still_makes_progress(self) -> None:
        assert wrap_caption("a b c", max_chars=1) == ("a", "b", "c")

    def test_empty_text_has_no_lines(self) -> None:
        assert wrap_caption("") == ()

    def test_whitespace_is_collapsed_before_breaking(self) -> None:
        assert wrap_caption("short   enough") == ("short enough",)

    @pytest.mark.parametrize("max_chars", [0, -1])
    def test_a_non_positive_budget_is_refused(self, max_chars: int) -> None:
        with pytest.raises(NovaInvariantError, match="max_chars"):
            wrap_caption("hello", max_chars=max_chars)

    def test_zero_lines_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="max_lines"):
            wrap_caption("hello", max_lines=0)


class TestSafeArea:
    def test_the_defaults_keep_captions_inside_overscan(self) -> None:
        area = SafeArea()
        assert area.left == 0.05
        assert area.bottom == 0.10

    def test_the_inset_is_in_pixels_for_a_frame_size(self) -> None:
        rect = SafeArea().inset(1920, 1080)
        assert (rect.x, rect.y, rect.width, rect.height) == (96, 54, 1728, 918)

    def test_a_margin_may_not_swallow_the_frame(self) -> None:
        """The 0.45 cap per side is what guarantees a frame is left."""
        with pytest.raises(NovaInvariantError, match="within"):
            SafeArea(left=0.6, right=0.6)

    def test_a_margin_may_not_be_negative(self) -> None:
        with pytest.raises(NovaInvariantError, match="within"):
            SafeArea(top=-0.1)

    def test_a_zero_sized_frame_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="positive"):
            SafeArea().inset(0, 0)

    def test_an_area_survives_json(self) -> None:
        area = SafeArea(left=0.1, right=0.2, top=0.3, bottom=0.4)
        assert SafeArea.from_wire(_round_trip(area.to_wire())) == area


class TestCaptionRect:
    def test_edges_are_exclusive(self) -> None:
        rect = CaptionRect(x=10, y=20, width=100, height=50)
        assert (rect.right, rect.bottom) == (110, 70)

    def test_overlapping_boxes_are_detected(self) -> None:
        a = CaptionRect(x=0, y=0, width=100, height=50)
        b = CaptionRect(x=50, y=25, width=100, height=50)
        assert a.overlaps(b)
        assert b.overlaps(a)

    def test_touching_boxes_are_not_a_collision(self) -> None:
        """Two stacked cue lines sit exactly against each other; that is normal."""
        a = CaptionRect(x=0, y=0, width=100, height=50)
        b = CaptionRect(x=0, y=50, width=100, height=50)
        assert not a.overlaps(b)

    def test_separated_boxes_are_not_a_collision(self) -> None:
        a = CaptionRect(x=0, y=0, width=10, height=10)
        b = CaptionRect(x=100, y=100, width=10, height=10)
        assert not a.overlaps(b)

    def test_a_box_can_be_moved(self) -> None:
        assert CaptionRect(0, 0, 10, 10).shifted(5, -5) == CaptionRect(5, -5, 10, 10)

    def test_a_negative_size_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="negative"):
            CaptionRect(x=0, y=0, width=-1, height=10)


class TestCaptionPosition:
    def test_captions_start_at_the_bottom(self) -> None:
        assert CaptionPosition().anchor is CaptionAnchor.BOTTOM_CENTER

    def test_the_offset_is_a_fraction_of_the_safe_area(self) -> None:
        position = CaptionPosition(x=0.5, y=-0.25)
        assert (position.x, position.y) == (0.5, -0.25)

    @pytest.mark.parametrize(("field", "value"), [("x", 2.0), ("y", -2.0), ("rotation_deg", 400.0)])
    def test_nonsense_is_refused(self, field: str, value: float) -> None:
        with pytest.raises(NovaInvariantError):
            CaptionPosition(**{field: value})

    def test_a_position_survives_json(self) -> None:
        position = CaptionPosition(
            anchor=CaptionAnchor.TOP_LEFT,
            x=0.25,
            y=-0.5,
            rotation_deg=90.0,
            safe_area=SafeArea(left=0.1),
        )
        assert CaptionPosition.from_wire(_round_trip(position.to_wire())) == position


class TestCaptionChar:
    def test_a_character_is_one_grapheme(self) -> None:
        assert CaptionChar(text="😀", start_ms=0, end_ms=10).text == "😀"

    def test_two_graphemes_are_not_a_character(self) -> None:
        with pytest.raises(NovaInvariantError, match="exactly one"):
            CaptionChar(text="ab", start_ms=0, end_ms=10)

    def test_reversed_time_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="must not precede"):
            CaptionChar(text="a", start_ms=10, end_ms=0)

    def test_negative_time_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="start_ms"):
            CaptionChar(text="a", start_ms=-1, end_ms=10)

    def test_a_measured_character_says_so(self) -> None:
        """A provider that supplies real timings overrides the derived ones."""
        assert not CaptionChar(text="a", start_ms=0, end_ms=10, estimated=False).estimated

    def test_shifting_moves_the_whole_character(self) -> None:
        shifted = CaptionChar(text="a", start_ms=100, end_ms=200).shifted(50)
        assert (shifted.start_ms, shifted.end_ms) == (150, 250)

    def test_a_character_survives_json(self) -> None:
        char = CaptionChar(text="é", start_ms=1, end_ms=2, estimated=False)
        assert CaptionChar.from_wire(_round_trip(char.to_wire())) == char


class TestCaptionWord:
    def test_of_derives_character_timings(self) -> None:
        word = CaptionWord.of("hello", 0, 500)
        assert word.has_char_timings
        assert word.chars[-1].end_ms == 500

    def test_of_can_skip_character_timings(self) -> None:
        assert not CaptionWord.of("hello", 0, 500, with_chars=False).has_char_timings

    def test_derived_characters_are_not_measured(self) -> None:
        word = CaptionWord.of("hello", 0, 500)
        assert word.has_char_timings
        assert not word.has_measured_char_timings

    def test_measured_characters_make_the_word_measured(self) -> None:
        word = CaptionWord(text="hi", start_ms=0, end_ms=200).with_chars(
            (
                CaptionChar(text="h", start_ms=0, end_ms=100, estimated=False),
                CaptionChar(text="i", start_ms=100, end_ms=200, estimated=False),
            )
        )
        assert word.has_measured_char_timings

    def test_characters_must_join_to_make_the_word(self) -> None:
        with pytest.raises(NovaInvariantError, match="must join"):
            CaptionWord(
                text="hi",
                start_ms=0,
                end_ms=200,
                chars=(CaptionChar(text="x", start_ms=0, end_ms=100),),
            )

    def test_a_character_may_not_leave_the_word(self) -> None:
        with pytest.raises(NovaInvariantError, match="outside the word"):
            CaptionWord(
                text="hi",
                start_ms=0,
                end_ms=200,
                chars=(
                    CaptionChar(text="h", start_ms=0, end_ms=100),
                    CaptionChar(text="i", start_ms=100, end_ms=300),
                ),
            )

    def test_characters_must_be_in_order(self) -> None:
        with pytest.raises(NovaInvariantError, match="out of order"):
            CaptionWord(
                text="hi",
                start_ms=0,
                end_ms=200,
                chars=(
                    CaptionChar(text="h", start_ms=100, end_ms=200),
                    CaptionChar(text="i", start_ms=0, end_ms=100),
                ),
            )

    def test_a_word_must_have_text(self) -> None:
        with pytest.raises(NovaInvariantError, match="must have text"):
            _word(text="   ")

    def test_confidence_is_a_fraction(self) -> None:
        with pytest.raises(NovaInvariantError, match="confidence"):
            _word(confidence=1.5)

    def test_a_highlighted_word_is_marked_for_karaoke(self) -> None:
        assert _word(highlight=True).highlight

    def test_shifting_carries_the_characters(self) -> None:
        shifted = CaptionWord.of("hi", 100, 300).shifted(50)
        assert (shifted.start_ms, shifted.end_ms) == (150, 350)
        assert shifted.chars[0].start_ms == 150

    def test_a_word_survives_json(self) -> None:
        word = CaptionWord.of("hello", 0, 500, confidence=0.9, speaker="A", highlight=True)
        assert CaptionWord.from_wire(_round_trip(word.to_wire())) == word

    def test_a_wire_word_rejects_unknown_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            CaptionWord.from_wire(dict(_word().to_wire(), extra=1))


class TestCaptionSegment:
    def test_a_cue_needs_text_and_time(self) -> None:
        segment = _segment()
        assert (segment.start_ms, segment.end_ms, segment.duration_ms) == (0, 1_000, 1_000)

    def test_a_cue_may_not_end_before_it_starts(self) -> None:
        with pytest.raises(NovaInvariantError, match="must not precede"):
            _segment(start_ms=500, end_ms=400)

    def test_a_cue_may_not_be_blank(self) -> None:
        with pytest.raises(NovaInvariantError, match="must have text"):
            _segment(text="  ")

    def test_a_word_may_not_leave_its_cue(self) -> None:
        with pytest.raises(NovaInvariantError, match="outside the segment"):
            _segment(words=_words(("hello", 0, 400), ("world", 500, 2_000)))

    def test_words_may_not_go_backwards(self) -> None:
        with pytest.raises(NovaInvariantError, match="start before the previous"):
            _segment(words=_words(("hello", 200, 400), ("world", 100, 300)))

    def test_words_must_appear_in_the_cue_text(self) -> None:
        """Timings for words that are not on screen are the worst possible state."""
        with pytest.raises(NovaInvariantError, match="not in its text"):
            _segment(text="hello world", words=_words(("goodbye", 0, 400)))

    def test_punctuation_in_the_cue_text_does_not_hide_the_words(self) -> None:
        segment = _segment(text="Hello, world!", words=_words(("Hello", 0, 400)))
        assert segment.has_word_timings

    def test_counts_fall_back_to_the_text_when_words_are_untimed(self) -> None:
        segment = _segment(text="hello world")
        assert (segment.word_count, segment.char_count) == (0, 11)

    def test_counts_use_the_words_when_they_are_timed(self) -> None:
        timed = _timed()
        assert (timed.word_count, timed.char_count) == (2, 10)

    def test_a_cue_knows_whether_it_can_be_animated_per_letter(self) -> None:
        assert _segment().has_char_timings is False
        assert _timed().has_char_timings is True

    def test_the_alignment_key_comes_from_the_cue(self) -> None:
        cue = _segment(text="Hello, world!", start_ms=1_234, end_ms=2_234)
        assert cue.key == "hello world@1000"

    def test_the_frame_range_is_start_inclusive_end_exclusive(self) -> None:
        """A one-frame cue is (n, n + 1), never an empty range."""
        assert _segment(end_ms=1_000).frame_range(DEFAULT_TIMEBASE) == (0, 30)
        assert _segment(end_ms=1).frame_range(DEFAULT_TIMEBASE) == (0, 1)

    def test_the_frame_range_rounds_as_asked(self) -> None:
        segment = _segment(start_ms=20, end_ms=1_020)
        assert segment.frame_range(DEFAULT_TIMEBASE, Rounding.FLOOR)[0] == 0

    def test_replacing_the_text_discards_timings_that_no_longer_describe_it(self) -> None:
        corrected = _timed().with_text("hello there")
        assert corrected.text == "hello there"
        assert not corrected.has_word_timings

    def test_moving_a_cue_carries_its_words(self) -> None:
        moved = _timed().with_timing(5_000, 6_000)
        assert (moved.start_ms, moved.end_ms) == (5_000, 6_000)
        assert moved.words[0].start_ms == 5_000

    def test_shrinking_a_cue_drops_the_words_it_no_longer_covers(self) -> None:
        """Dropped, not clipped: a clipped word claims speech stopped mid-word."""
        shrunk = _timed().with_timing(0, 400)
        assert shrunk.words == ()

    def test_shifting_a_cue_moves_everything_inside_it(self) -> None:
        shifted = _timed().shifted(250)
        assert shifted.start_ms == 250
        assert shifted.words[0].chars[0].start_ms == 250

    def test_a_style_override_can_be_set_and_cleared(self) -> None:
        styled = _segment().with_style({"colour": "yellow"})
        assert dict(styled.style_overrides or {}) == {"colour": "yellow"}
        assert styled.with_style(None).style_overrides is None

    def test_a_locked_cue_is_left_alone(self) -> None:
        assert _segment(locked=True).locked

    def test_lines_come_from_the_wrapper(self) -> None:
        assert _segment(text="short").lines() == ("short",)

    def test_a_cue_defaults_to_the_primary_layer(self) -> None:
        assert _segment().layer_id == DEFAULT_LAYER_ID

    def test_a_cue_survives_json(self) -> None:
        segment = _timed()
        segment = CaptionSegment(
            **{
                **{
                    "index": segment.index,
                    "start_ms": segment.start_ms,
                    "end_ms": segment.end_ms,
                    "text": segment.text,
                    "words": segment.words,
                },
                "speaker": "A",
                "position": CaptionPosition(anchor=CaptionAnchor.TOP_LEFT),
                "style_overrides": {"colour": "yellow"},
                "locked": True,
                "confidence": 0.8,
            }
        )
        assert CaptionSegment.from_wire(_round_trip(segment.to_wire())) == segment

    def test_a_wire_cue_rejects_unknown_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            CaptionSegment.from_wire(dict(_segment().to_wire(), extra=1))


class TestCaptionLayer:
    def test_the_primary_layer_is_created_for_you(self) -> None:
        layer = CaptionLayer.primary("en")
        assert (layer.layer_id, layer.name, layer.language) == ("primary", "Primary", "en")
        assert layer.kind is CaptionLayerKind.PRIMARY

    def test_a_translation_layer_is_its_own_track(self) -> None:
        layer = CaptionLayer(layer_id="bn", language="bn", kind=CaptionLayerKind.TRANSLATION)
        assert layer.kind is CaptionLayerKind.TRANSLATION

    def test_a_layer_must_have_an_id(self) -> None:
        with pytest.raises(NovaInvariantError, match="layer_id"):
            CaptionLayer(layer_id="")

    def test_a_layer_survives_json(self) -> None:
        layer = CaptionLayer(
            layer_id="bn",
            name="Bangla",
            language="bn",
            kind=CaptionLayerKind.TRANSLATION,
            visible=False,
            locked=True,
        )
        assert CaptionLayer.from_wire(_round_trip(layer.to_wire())) == layer


class TestCaptionRevision:
    def test_a_revision_records_where_the_text_came_from(self) -> None:
        revision = CaptionRevision(
            revision_id="rev-2",
            created_ms=1_000,
            origin=RevisionOrigin.ASR,
            provider="faster-whisper",
            model="large-v3",
            parent_id="rev-1",
        )
        assert revision.origin is RevisionOrigin.ASR
        assert revision.parent_id == "rev-1"

    def test_a_revision_must_have_an_id(self) -> None:
        with pytest.raises(NovaInvariantError, match="revision_id"):
            CaptionRevision(revision_id="", created_ms=0)

    def test_a_revision_survives_json(self) -> None:
        revision = CaptionRevision(
            revision_id="rev-1", created_ms=5, origin=RevisionOrigin.MERGE, label="re-align"
        )
        assert CaptionRevision.from_wire(_round_trip(revision.to_wire())) == revision


class TestCaptionDelta:
    def test_a_text_delta_carries_before_and_after(self) -> None:
        delta = _delta(
            "hello world@0", CaptionDeltaKind.TEXT, before="hello world", after="hello there"
        )
        assert (delta.before, delta.after) == ("hello world", "hello there")

    def test_a_text_delta_must_have_the_new_text(self) -> None:
        with pytest.raises(NovaInvariantError, match="needs the new text"):
            _delta("key@0", CaptionDeltaKind.TEXT)

    def test_a_timing_delta_needs_both_ends(self) -> None:
        with pytest.raises(NovaInvariantError, match="start_ms and end_ms"):
            _delta("key@0", CaptionDeltaKind.TIMING, start_ms=100)

    def test_a_style_delta_needs_the_overrides(self) -> None:
        with pytest.raises(NovaInvariantError, match="overrides"):
            _delta("key@0", CaptionDeltaKind.STYLE)

    def test_a_delta_must_have_a_key(self) -> None:
        with pytest.raises(NovaInvariantError, match="alignment key"):
            _delta("", CaptionDeltaKind.DELETE)

    def test_a_delta_addresses_a_granularity(self) -> None:
        delta = _delta("k@0", CaptionDeltaKind.TEXT, after="x", target=CaptionTarget.WORD)
        assert delta.target is CaptionTarget.WORD

    def test_a_delta_survives_json(self) -> None:
        delta = _delta(
            "hello world@0",
            CaptionDeltaKind.STYLE,
            style={"colour": "yellow"},
            created_ms=99,
            revision_id="rev-1",
        )
        assert CaptionDelta.from_wire(_round_trip(delta.to_wire())) == delta


class TestMergeDeltas:
    def test_a_correction_re_attaches_by_exact_key(self) -> None:
        base = (_segment(0, 0, 1_000, "hello world"),)
        delta = _delta(alignment_key("hello world", 0), CaptionDeltaKind.TEXT, after="hello there")
        outcome = merge_deltas(base, (delta,))
        assert outcome.segments[0].text == "hello there"
        assert outcome.all_reattached
        assert not outcome.needs_review

    def test_a_correction_survives_a_drift_within_tolerance(self) -> None:
        """A re-transcription that moved the cue 700 ms later (ADR-0009 §7)."""
        base = (_segment(0, 700, 1_700, "hello world"),)
        delta = _delta(alignment_key("hello world", 0), CaptionDeltaKind.TEXT, after="hello there")
        assert merge_deltas(base, (delta,)).segments[0].text == "hello there"

    def test_a_correction_beyond_the_tolerance_is_reported_not_guessed(self) -> None:
        """Attaching a correction to the wrong cue is a wrong caption with the
        user's name on it."""
        base = (_segment(0, 9_000, 10_000, "hello world"),)
        delta = _delta(alignment_key("hello world", 0), CaptionDeltaKind.TEXT, after="hello there")
        outcome = merge_deltas(base, (delta,))
        assert outcome.unmatched == (delta,)
        assert outcome.segments[0].text == "hello world"
        assert outcome.needs_review

    def test_the_tolerance_is_two_seconds(self) -> None:
        assert DEFAULT_MERGE_TOLERANCE_MS == 2_000

    def test_a_timing_correction_moves_the_whole_cue(self) -> None:
        base = (_timed(),)
        delta = _delta(
            alignment_key("hello world", 0), CaptionDeltaKind.TIMING, start_ms=2_000, end_ms=3_000
        )
        moved = merge_deltas(base, (delta,)).segments[0]
        assert (moved.start_ms, moved.end_ms) == (2_000, 3_000)
        assert moved.words[0].start_ms == 2_000

    def test_a_deletion_removes_the_cue_and_closes_the_gap(self) -> None:
        base = (_segment(0, 0, 1_000, "first cue"), _segment(1, 1_200, 2_000, "second cue"))
        delta = _delta(alignment_key("first cue", 0), CaptionDeltaKind.DELETE)
        outcome = merge_deltas(base, (delta,))
        assert [segment.text for segment in outcome.segments] == ["second cue"]
        assert outcome.segments[0].index == 0

    def test_an_insert_is_added_rather_than_matched(self) -> None:
        """A cue the user typed has no original to be re-attached to."""
        base = (_segment(0, 0, 1_000, "first cue"),)
        delta = _delta(
            alignment_key("typed by hand", 2_000),
            CaptionDeltaKind.INSERT,
            after="typed by hand",
            start_ms=2_000,
            end_ms=3_000,
        )
        outcome = merge_deltas(base, (delta,))
        assert [segment.text for segment in outcome.segments] == ["first cue", "typed by hand"]
        assert outcome.applied == (delta,)

    def test_an_insert_without_an_end_gets_a_readable_duration(self) -> None:
        delta = _delta("x@0", CaptionDeltaKind.INSERT, after="x", start_ms=500)
        segment = merge_deltas((), (delta,)).segments[0]
        assert segment.end_ms == 500 + CAPTION_MIN_DURATION_MS

    def test_a_style_correction_is_re_applied(self) -> None:
        base = (_segment(0, 0, 1_000, "hello world"),)
        delta = _delta(
            alignment_key("hello world", 0),
            CaptionDeltaKind.STYLE,
            style={"colour": "yellow"},
        )
        styled = merge_deltas(base, (delta,)).segments[0]
        assert dict(styled.style_overrides or {}) == {"colour": "yellow"}

    def test_deltas_apply_in_order_so_both_land_on_one_cue(self) -> None:
        """A text edit followed by a timing edit on the same cue."""
        base = (_segment(0, 0, 1_000, "hello world"),)
        deltas = (
            _delta(alignment_key("hello world", 0), CaptionDeltaKind.TEXT, after="hello there"),
            _delta(
                alignment_key("hello world", 0),
                CaptionDeltaKind.TIMING,
                end_ms=2_000,
                start_ms=0,
            ),
        )
        outcome = merge_deltas(base, deltas)
        assert outcome.segments[0].text == "hello there"
        assert outcome.segments[0].end_ms == 2_000
        assert len(outcome.applied) == 2

    def test_discarded_word_timings_are_reported(self) -> None:
        """The one destructive rule, and it is never silent (ADR-0009 §7)."""
        base = (_timed(),)
        delta = _delta(alignment_key("hello world", 0), CaptionDeltaKind.TEXT, after="hello there")
        outcome = merge_deltas(base, (delta,))
        assert outcome.timings_dropped == (delta.key,)
        assert outcome.needs_review
        assert outcome.all_reattached

    def test_untimed_cues_lose_nothing(self) -> None:
        base = (_segment(0, 0, 1_000, "hello world"),)
        delta = _delta(alignment_key("hello world", 0), CaptionDeltaKind.TEXT, after="hello there")
        assert merge_deltas(base, (delta,)).timings_dropped == ()

    def test_a_delete_that_matches_nothing_is_reported(self) -> None:
        delta = _delta(alignment_key("never existed", 0), CaptionDeltaKind.DELETE)
        assert merge_deltas((_segment(),), (delta,)).unmatched == (delta,)

    def test_merging_preserves_time_order(self) -> None:
        base = (_segment(0, 0, 1_000, "first cue"), _segment(1, 1_200, 2_000, "second cue"))
        delta = _delta(
            alignment_key("typed by hand", 500),
            CaptionDeltaKind.INSERT,
            after="typed by hand",
            start_ms=500,
            end_ms=1_000,
        )
        outcome = merge_deltas(base, (delta,))
        assert [segment.text for segment in outcome.segments] == [
            "first cue",
            "typed by hand",
            "second cue",
        ]
        assert [segment.index for segment in outcome.segments] == [0, 1, 2]


class TestCaptionDocument:
    def test_an_empty_document_is_valid(self) -> None:
        document = CaptionDocument()
        assert document.is_empty
        assert document.duration_ms == 0
        assert document.validate() == ""

    def test_of_builds_a_document_and_numbers_the_cues(self) -> None:
        document = CaptionDocument.of(
            _segment(7, 0, 1_000, "first"), _segment(3, 1_200, 2_000, "second"), language="en"
        )
        assert [segment.index for segment in document.segments] == [0, 1]
        assert document.language == "en"

    def test_counts_roll_up_from_the_cues(self) -> None:
        document = CaptionDocument.of(_timed(), _timed("second cue", 1_200, 2_200))
        assert (document.segment_count, document.word_count, document.char_count) == (2, 4, 19)

    def test_the_duration_is_the_end_of_the_last_cue(self) -> None:
        assert CaptionDocument.of(_segment(0, 0, 1_000), _segment(1, 1_200, 2_000)).duration_ms == (
            2_000
        )

    def test_speakers_are_listed_in_first_heard_order(self) -> None:
        document = CaptionDocument.of(
            _segment(0, 0, 1_000, "a", speaker="A"),
            _segment(1, 1_200, 2_000, "b", speaker="B"),
            _segment(2, 2_200, 3_000, "c", speaker="A"),
        )
        assert document.speakers == ("A", "B")

    def test_the_cue_at_a_moment(self) -> None:
        document = CaptionDocument.of(_segment(0, 0, 1_000, "first"), _segment(1, 1_200, 2_000))
        assert document.segment_at(500) is not None
        assert document.segment_at(1_100) is None
        assert document.segment_at(2_000) is None

    def test_cues_overlapping_a_range(self) -> None:
        document = CaptionDocument.of(_segment(0, 0, 1_000), _segment(1, 1_200, 2_000))
        assert [s.index for s in document.segments_between(500, 1_500)] == [0, 1]
        assert [s.index for s in document.segments_between(1_000, 1_100)] == []

    def test_a_reversed_range_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="must not precede"):
            CaptionDocument().segments_between(1_000, 500)

    def test_cues_can_be_selected_by_layer(self) -> None:
        document = CaptionDocument(
            layers=(CaptionLayer.primary("en"), CaptionLayer(layer_id="bn")),
            segments=(_segment(0, 0, 1_000, "hi"), _segment(1, 0, 1_000, "hai", layer_id="bn")),
        )
        assert [segment.text for segment in document.on_layer("bn")] == ["hai"]

    def test_a_cue_may_not_sit_on_an_undefined_layer(self) -> None:
        with pytest.raises(NovaInvariantError, match="does not define"):
            CaptionDocument(segments=(_segment(layer_id="bn"),))

    def test_a_document_must_have_a_layer(self) -> None:
        with pytest.raises(NovaInvariantError, match="at least one layer"):
            CaptionDocument(layers=())

    def test_reindexing_reorders_and_renumbers(self) -> None:
        document = CaptionDocument.of(_segment(0, 5_000, 6_000, "late"), _segment(1, 0, 1_000, "x"))
        assert [s.text for s in document.reindexed().segments] == ["x", "late"]
        assert [s.index for s in document.reindexed().segments] == [0, 1]

    def test_replacing_the_cues_renumbers_them(self) -> None:
        document = CaptionDocument().with_segments([_segment(9, 0, 1_000, "only")])
        assert document.segments[0].index == 0

    def test_revisions_accumulate(self) -> None:
        first = CaptionRevision(revision_id="r1", created_ms=1, origin=RevisionOrigin.ASR)
        second = CaptionRevision(revision_id="r2", created_ms=2, origin=RevisionOrigin.MERGE)
        document = CaptionDocument().with_revision(first).with_revision(second)
        assert document.current_revision == second
        assert len(document.revisions) == 2

    def test_a_document_with_no_revisions_has_no_current_one(self) -> None:
        assert CaptionDocument().current_revision is None

    def test_the_edit_overlay_is_carried(self) -> None:
        delta = _delta("k@0", CaptionDeltaKind.DELETE)
        assert CaptionDocument().with_edits([delta]).edits == (delta,)

    def test_the_text_is_the_cues_one_per_line(self) -> None:
        document = CaptionDocument.of(
            _segment(0, 0, 1_000, "first"), _segment(1, 1_200, 2_000, "x")
        )
        assert document.text == "first\nx"

    def test_a_document_survives_json(self) -> None:
        document = CaptionDocument(
            language="en",
            layers=(CaptionLayer.primary("en"), CaptionLayer(layer_id="bn")),
            segments=(_timed(), _segment(1, 1_200, 2_000, "second cue", speaker="B")),
            revisions=(CaptionRevision(revision_id="r1", created_ms=1),),
            edits=(_delta("hello world@0", CaptionDeltaKind.DELETE),),
        )
        assert CaptionDocument.from_wire(_round_trip(document.to_wire())) == document

    def test_a_future_version_is_refused_rather_than_guessed(self) -> None:
        wire = dict(CaptionDocument().to_wire())
        wire["version"] = CAPTION_DOCUMENT_VERSION + 1
        with pytest.raises(NovaInvariantError, match="newer than"):
            CaptionDocument.from_wire(wire)

    def test_a_wire_document_rejects_unknown_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            CaptionDocument.from_wire(dict(CaptionDocument().to_wire(), extra=1))

    def test_a_wire_document_rejects_a_malformed_cue_list(self) -> None:
        wire = dict(CaptionDocument().to_wire())
        wire["segments"] = "not a list"
        with pytest.raises(NovaInvariantError, match="must be a list"):
            CaptionDocument.from_wire(wire)


class TestValidateCaptionDocument:
    def test_a_well_formed_document_passes(self) -> None:
        document = CaptionDocument.of(
            _segment(0, 0, 1_000, "first cue"), _segment(1, 1_200, 2_200, "second cue")
        )
        assert validate_caption_document(document) == ""

    def test_indices_must_be_sequential(self) -> None:
        document = CaptionDocument(segments=(_segment(0, 0, 1_000), _segment(5, 1_200, 2_000)))
        assert "indices must be sequential" in validate_caption_document(document)

    def test_overlapping_cues_are_caught(self) -> None:
        document = CaptionDocument(segments=(_segment(0, 0, 1_500), _segment(1, 1_200, 2_000)))
        assert "before segment 0 ends" in validate_caption_document(document)

    def test_a_cue_too_short_to_read_is_caught(self) -> None:
        document = CaptionDocument(segments=(_segment(0, 0, 200, "hi"),))
        assert f"below the {CAPTION_MIN_DURATION_MS} ms minimum" in (
            validate_caption_document(document)
        )

    def test_a_cue_read_too_fast_is_caught(self) -> None:
        long_text = "a" * 60
        document = CaptionDocument(segments=(_segment(0, 0, 1_000, long_text),))
        assert "cps ceiling" in validate_caption_document(document)

    def test_the_first_problem_is_the_one_reported(self) -> None:
        document = CaptionDocument(
            segments=(_segment(0, 0, 100), _segment(1, 50, 200, "overlapping too"))
        )
        assert validate_caption_document(document).startswith("segment 0 lasts 100 ms")

    def test_the_document_validates_itself(self) -> None:
        assert CaptionDocument().validate() == ""
