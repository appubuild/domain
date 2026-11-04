"""The Refine stage (`services/captions/refine.py`).

The invariant under test is the one that makes this stage worth having at all:
**speech is cleaned, meaning is not.** A filler, a false start and a stutter
come out; a repeated word that was emphasis stays, a speaker's "hmm" stays, and
a word that survives is the very same object the provider gave us — confidence,
characters and highlight flag intact.

The second invariant is that nothing here is destructive by accident: a segment
left with nothing readable is *dropped*, never left empty, and a locked segment
is not touched at all.

Tests are named for what a viewer would notice, not for the function they call.
"""

from __future__ import annotations

import pytest

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.captions import (
    CaptionAnchor,
    CaptionDocument,
    CaptionLayer,
    CaptionPosition,
    CaptionSegment,
    CaptionWord,
    validate_caption_document,
)
from nova_studio.services.captions.pipeline import CaptionPipeline, StageContext
from nova_studio.services.captions.refine import (
    DEFAULT_FILLERS,
    DEFAULT_REFINE_RULES,
    FILLERS_BY_LANGUAGE,
    Refiner,
    RefineRules,
    is_filler,
    refine_segment,
    refine_words,
    tidy_text,
)

pytestmark = pytest.mark.unit


# -- helpers -----------------------------------------------------------------


def _words(
    text: str, *, step: int = 400, hold: int = 350, start: int = 0
) -> tuple[CaptionWord, ...]:
    """Words spoken at an even pace, none of them outside the span we give."""
    tokens = text.split()
    span = max(1, step * len(tokens))
    gap = max(1, span // max(1, len(tokens)))
    return tuple(
        CaptionWord.of(token, start + i * gap, start + i * gap + max(1, gap - 50))
        for i, token in enumerate(tokens)
    )


def _segment(
    text: str, *, words: tuple[CaptionWord, ...] | None = None, **over: object
) -> CaptionSegment:
    spoken = words if words is not None else _words(text)
    end_ms = spoken[-1].end_ms if spoken else 1_000
    return CaptionSegment(
        index=0,
        start_ms=0,
        end_ms=end_ms,
        text=text,
        words=spoken,
        **over,  # type: ignore[arg-type]
    )


def _document(*segments: CaptionSegment) -> CaptionDocument:
    return CaptionDocument.of(*segments)


def _refined(*texts: str, rules: RefineRules = DEFAULT_REFINE_RULES) -> tuple[CaptionSegment, ...]:
    document = _document(*(_segment(text) for text in texts))
    return Refiner(rules=rules).apply(document, StageContext()).unwrap().segments


def _text(*texts: str, rules: RefineRules = DEFAULT_REFINE_RULES) -> tuple[str, ...]:
    return tuple(segment.text for segment in _refined(*texts, rules=rules))


# -- the stage ---------------------------------------------------------------


class TestTheStage:
    def test_its_name_is_refine(self) -> None:
        assert Refiner().name == "refine"

    def test_it_returns_a_document(self) -> None:
        result = Refiner().apply(_document(_segment("um hello there")), StageContext())
        assert result.is_ok() is True

    def test_a_clean_document_passes_validation(self) -> None:
        refined = (
            Refiner().apply(_document(_segment("um hello there friends")), StageContext()).unwrap()
        )
        assert validate_caption_document(refined) == ""

    def test_the_segments_are_reindexed(self) -> None:
        refined = (
            Refiner()
            .apply(
                _document(
                    _segment("um hello there"),
                    _segment("um goodbye now"),
                    _segment("um"),
                ),
                StageContext(),
            )
            .unwrap()
        )
        assert tuple(segment.index for segment in refined.segments) == (0, 1)

    def test_a_locked_segment_is_left_alone(self) -> None:
        locked = _segment("um hello there", locked=True)
        refined = Refiner().apply(_document(locked), StageContext()).unwrap()
        assert refined.segments[0] == locked

    def test_cleaning_twice_changes_nothing(self) -> None:
        """A second pass has nothing left to remove: the stage is idempotent."""
        once = (
            Refiner()
            .apply(_document(_segment("um I I I went to the shop")), StageContext())
            .unwrap()
        )
        twice = Refiner().apply(once, StageContext()).unwrap()
        assert twice == once

    def test_it_runs_in_a_pipeline(self) -> None:
        pipeline = CaptionPipeline().with_stage("refine", Refiner())
        refined = pipeline.run(_document(_segment("um hello there")), StageContext()).unwrap()
        assert refined.segments[0].text == "Hello there"

    def test_it_can_be_switched_off(self) -> None:
        pipeline = CaptionPipeline().with_stage("refine", Refiner()).disabled_stage("refine")
        kept = pipeline.run(_document(_segment("um hello there")), StageContext()).unwrap()
        assert kept.segments[0].text == "um hello there"


# -- fillers -----------------------------------------------------------------


class TestFillers:
    def test_a_filler_goes(self) -> None:
        assert _text("um hello there") == ("Hello there",)

    def test_a_filler_goes_wherever_it_stands(self) -> None:
        assert _text("hello um there") == ("Hello there",)

    def test_several_fillers_go(self) -> None:
        assert _text("um so uh hello there") == ("So hello there",)

    def test_a_capitalised_filler_goes(self) -> None:
        assert _text("Um hello there") == ("Hello there",)

    def test_a_filler_with_punctuation_goes(self) -> None:
        assert _text("Um, hello there") == ("Hello there",)

    def test_every_default_filler_is_recognised(self) -> None:
        for filler in sorted(DEFAULT_FILLERS):
            assert is_filler(CaptionWord.of(filler, 0, 100), DEFAULT_REFINE_RULES) is True

    def test_a_real_word_is_not_a_filler(self) -> None:
        assert is_filler(CaptionWord.of("hello", 0, 100), DEFAULT_REFINE_RULES) is False

    def test_an_answer_is_not_a_filler(self) -> None:
        """Deleting a speaker's "hmm" would delete the answer."""
        for answer in ("hmm", "mm-hmm", "huh", "yeah"):
            assert is_filler(CaptionWord.of(answer, 0, 100), DEFAULT_REFINE_RULES) is False

    def test_a_project_can_add_its_own(self) -> None:
        rules = DEFAULT_REFINE_RULES.with_fillers("like")
        assert _text("it was like really good", rules=rules) == ("It was really good",)

    def test_a_project_can_take_one_back(self) -> None:
        rules = DEFAULT_REFINE_RULES.without_fillers("ah")
        assert _text("ah hello there", rules=rules) == ("Ah hello there",)

    def test_a_language_adds_its_own_fillers(self) -> None:
        rules = DEFAULT_REFINE_RULES.for_language("de")
        assert _text("äh hello there", rules=rules) == ("Hello there",)

    def test_an_unknown_language_changes_nothing(self) -> None:
        assert DEFAULT_REFINE_RULES.for_language("xx") == DEFAULT_REFINE_RULES

    def test_a_language_keeps_the_defaults(self) -> None:
        rules = DEFAULT_REFINE_RULES.for_language("fr")
        assert _text("euh um hello there", rules=rules) == ("Hello there",)

    def test_every_language_set_is_tagged_as_one(self) -> None:
        for language in FILLERS_BY_LANGUAGE:
            assert len(language) == 2


# -- stutters ----------------------------------------------------------------


class TestStutters:
    def test_a_three_times_stutter_keeps_one(self) -> None:
        assert _text("I I I went to the shop") == ("I went to the shop",)

    def test_a_longer_stutter_keeps_one(self) -> None:
        assert _text("the the the the cat") == ("The cat",)

    def test_two_of_the_same_word_is_emphasis(self) -> None:
        """Collapsing "very very" would change what the speaker meant."""
        assert _text("it was very very good") == ("It was very very good",)

    def test_the_surviving_word_covers_the_whole_stutter(self) -> None:
        """So a karaoke sweep crosses it instead of leaving a hole."""
        words = _words("I I I went")
        kept = refine_words(words, DEFAULT_REFINE_RULES)
        assert (kept[0].start_ms, kept[0].end_ms) == (words[0].start_ms, words[2].end_ms)

    def test_the_surviving_word_keeps_its_characters(self) -> None:
        words = _words("I I I went")
        kept = refine_words(words, DEFAULT_REFINE_RULES)
        assert kept[0].chars == words[0].chars

    def test_the_run_can_be_as_short_as_two_when_asked(self) -> None:
        rules = RefineRules(min_repeat_run=2)
        assert _text("it was very very good", rules=rules) == ("It was very good",)

    def test_stutters_can_be_left_alone(self) -> None:
        rules = RefineRules(min_repeat_run=99)
        assert _text("I I I went", rules=rules) == ("I I I went",)

    def test_a_stutter_is_not_a_false_start(self) -> None:
        """Three different words three times is a repetition of a phrase."""
        assert _text("go to the go to the shop") == ("Go to the shop",)


# -- false starts ------------------------------------------------------------


class TestFalseStarts:
    def test_a_two_word_false_start_keeps_one_copy(self) -> None:
        assert _text("if we if we go now") == ("If we go now",)

    def test_a_three_word_false_start_keeps_one_copy(self) -> None:
        assert _text("we're going to we're going to start") == ("We're going to start",)

    def test_the_longest_match_wins(self) -> None:
        assert _text("a b c a b c d e") == ("A b c d e",)

    def test_a_false_start_interrupted_by_a_filler_is_still_one(self) -> None:
        assert _text("go to the um go to the shop") == ("Go to the shop",)

    def test_capitalisation_does_not_hide_it(self) -> None:
        assert _text("Go to the go to the shop") == ("Go to the shop",)

    def test_a_repeat_longer_than_allowed_is_kept(self) -> None:
        rules = RefineRules(max_phrase_words=2)
        assert _text("we're going to we're going to start", rules=rules) == (
            "We're going to we're going to start",
        )

    def test_words_that_merely_rhyme_are_kept(self) -> None:
        assert _text("go to the shop go to the till") == ("Go to the shop go to the till",)

    def test_false_starts_can_be_left_alone(self) -> None:
        rules = RefineRules(phrase_repeats=False)
        assert _text("if we if we go now", rules=rules) == ("If we if we go now",)

    def test_the_second_copy_is_dropped_whole(self) -> None:
        segments = _refined("if we if we go now")
        assert tuple(word.text for word in segments[0].words) == ("if", "we", "go", "now")


# -- tidying -----------------------------------------------------------------


class TestTidying:
    def test_repeated_spaces_collapse(self) -> None:
        assert tidy_text("hello    there") == "Hello there"

    def test_a_space_before_punctuation_goes(self) -> None:
        assert tidy_text("hello , world") == "Hello, world"

    def test_a_missing_space_after_a_full_stop_comes_back(self) -> None:
        assert tidy_text("world.How") == "World. How"

    def test_an_abbreviation_is_not_split(self) -> None:
        assert tidy_text("see e.g. this") == "See e.g. this"

    def test_a_decimal_point_is_not_a_full_stop(self) -> None:
        assert tidy_text("version 3.5 is out") == "Version 3.5 is out"

    def test_a_thousand_separator_is_not_a_comma(self) -> None:
        assert tidy_text("it costs 1,000 dollars") == "It costs 1,000 dollars"

    def test_a_sentence_starts_with_a_capital(self) -> None:
        assert tidy_text("hello there. how are you") == "Hello there. How are you"

    def test_a_lone_i_is_capitalised(self) -> None:
        assert tidy_text("i think so") == "I think so"

    def test_a_capital_is_not_added_after_an_initial(self) -> None:
        assert tidy_text("U.S.A. is big") == "U.S.A. is big"

    def test_nothing_is_ever_lowered(self) -> None:
        assert tidy_text("HELLO there") == "HELLO there"

    def test_a_leading_comma_left_by_a_filler_goes(self) -> None:
        assert tidy_text(", hello there") == "Hello there"

    def test_tidying_can_be_switched_off(self) -> None:
        rules = RefineRules(tidy_punctuation=False)
        assert _text("hello , world", rules=rules) == ("hello , world",)

    def test_a_wordless_segment_is_still_tidied(self) -> None:
        segment = _segment("hello , world", words=())
        refined = refine_segment(segment, DEFAULT_REFINE_RULES)
        assert refined is not None
        assert refined.text == "Hello, world"


# -- the text and the words --------------------------------------------------


class TestTheTextAndTheWords:
    def test_the_text_is_the_words_that_survived(self) -> None:
        segments = _refined("um hello there")
        assert tuple(word.text for word in segments[0].words) == ("hello", "there")

    def test_the_text_is_rebuilt_from_those_words(self) -> None:
        assert _refined("um hello there")[0].text == "Hello there"

    def test_punctuation_a_human_added_survives(self) -> None:
        """The text and the words disagree, so the words are taken out of it."""
        spoken = _words("Um hello world")
        segment = _segment("Um, hello world.", words=spoken)
        refined = refine_segment(segment, DEFAULT_REFINE_RULES)
        assert refined is not None
        assert refined.text == "Hello world."

    def test_only_one_copy_of_a_dropped_word_goes(self) -> None:
        spoken = _words("Um hello um world")
        segment = _segment("Um, hello, um, world.", words=spoken)
        refined = refine_segment(segment, DEFAULT_REFINE_RULES)
        assert refined is not None
        assert refined.text == "Hello, world."

    def test_a_segment_that_was_all_filler_is_dropped(self) -> None:
        assert _refined("um uh er") == ()

    def test_a_segment_of_only_punctuation_is_dropped(self) -> None:
        assert _refined("...") == ()

    def test_it_can_be_kept_when_asked(self) -> None:
        rules = RefineRules(drop_empty_segments=False)
        assert len(_refined("...", rules=rules)) == 1

    def test_a_kept_but_emptied_segment_keeps_its_text(self) -> None:
        """An empty caption is not a caption: it keeps what it had."""
        rules = RefineRules(drop_empty_segments=False)
        assert _refined("um uh er", rules=rules)[0].text == "um uh er"

    def test_the_span_is_not_tightened(self) -> None:
        """A cue's boundaries are the Break stage's business, not this one's."""
        segment = _segment("um hello there")
        refined = refine_segment(segment, DEFAULT_REFINE_RULES)
        assert refined is not None
        assert (refined.start_ms, refined.end_ms) == (segment.start_ms, segment.end_ms)


# -- what a cleanup must not take --------------------------------------------


class TestWhatSurvives:
    def test_speaker(self) -> None:
        segment = _segment("um hello there", speaker="A")
        assert refine_segment(segment, DEFAULT_REFINE_RULES).speaker == "A"  # type: ignore[union-attr]

    def test_confidence_is_never_raised(self) -> None:
        segment = _segment("um hello there", confidence=0.4)
        assert refine_segment(segment, DEFAULT_REFINE_RULES).confidence == 0.4  # type: ignore[union-attr]

    def test_the_highlight_flag(self) -> None:
        words = (
            _words("um")[0],
            _words("hello", start=1_000)[0].__class__.of("hello", 1_000, 1_400, highlight=True),
        )
        segment = _segment("um hello", words=words)
        refined = refine_segment(segment, DEFAULT_REFINE_RULES)
        assert refined is not None
        assert refined.words[0].highlight is True

    def test_the_characters(self) -> None:
        segment = _segment("um hello there")
        refined = refine_segment(segment, DEFAULT_REFINE_RULES)
        assert refined is not None
        assert refined.words[0].chars == segment.words[1].chars

    def test_the_layer(self) -> None:
        document = CaptionDocument(
            segments=(_segment("um hola", layer_id="es"),),
            layers=(CaptionLayer.primary(), CaptionLayer(layer_id="es")),
        )
        refined = Refiner().apply(document, StageContext()).unwrap()
        assert refined.segments[0].layer_id == "es"

    def test_the_position(self) -> None:
        position = CaptionPosition(anchor=CaptionAnchor.TOP_CENTER)
        segment = _segment("um hello there", position=position)
        assert refine_segment(segment, DEFAULT_REFINE_RULES).position == position  # type: ignore[union-attr]

    def test_the_style_overrides(self) -> None:
        segment = _segment("um hello there", style_overrides={"colour": "red"})
        assert refine_segment(segment, DEFAULT_REFINE_RULES).style_overrides == {"colour": "red"}  # type: ignore[union-attr]

    def test_a_document_with_nothing_to_do_is_untouched(self) -> None:
        document = _document(_segment("Hello there friends"))
        assert Refiner().apply(document, StageContext()).unwrap() == document


# -- the rules ---------------------------------------------------------------


class TestTheRules:
    def test_the_defaults_are_a_value(self) -> None:
        assert Refiner().rules == RefineRules()

    def test_a_run_of_one_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="min_repeat_run"):
            RefineRules(min_repeat_run=1)

    def test_an_unbounded_false_start_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="max_phrase_words"):
            RefineRules(max_phrase_words=0)

    def test_the_rules_are_frozen(self) -> None:
        with pytest.raises(Exception):  # noqa: B017 - frozen is the point
            RefineRules().fillers = frozenset()  # type: ignore[misc]

    def test_adding_a_filler_leaves_the_rest_alone(self) -> None:
        rules = DEFAULT_REFINE_RULES.with_fillers("like")
        assert "um" in rules.fillers
        assert "like" in rules.fillers

    def test_a_filler_added_twice_is_one_filler(self) -> None:
        first = DEFAULT_REFINE_RULES.with_fillers("like")
        assert first.with_fillers("like", "Like") == first
