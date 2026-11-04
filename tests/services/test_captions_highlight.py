"""The Highlight stage (`services/captions/highlight.py`).

A caption is read in a second and a half, and in that time a viewer takes one
thing away. Every phone-caption style that works is the same idea: something in
the line is *the* word. This stage decides which, and the invariant under test
is that **it decides the same way every time and takes nothing else with it** —
the words that come back are the words that went in, with one flag changed.

The second invariant is restraint: a cue with six highlighted words is a cue
with none, so the best two win, a highlight a human set is never unset, and a
filler is never the word of the line even with Refine switched off.

Tests are named for what a viewer would see.
"""

from __future__ import annotations

import pytest

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.captions import (
    CaptionDocument,
    CaptionSegment,
    CaptionWord,
    validate_caption_document,
)
from nova_studio.services.captions.highlight import (
    DEFAULT_HIGHLIGHT_RULES,
    Highlighter,
    HighlightRules,
    held_words,
    highlight_segment,
    highlight_words,
    is_number,
    term_counts,
    term_counts_of,
)
from nova_studio.services.captions.pipeline import CaptionPipeline, StageContext

pytestmark = pytest.mark.unit

#: A word of ordinary length, for the tests that do not care about timing.
PLAIN = 150
#: Long enough to be a held word next to a median of ``PLAIN``.
HELD = 600


# -- helpers -----------------------------------------------------------------


def _words(spec: tuple[tuple[str, int], ...], start: int = 0) -> tuple[CaptionWord, ...]:
    """Words from ``((text, duration_ms), ...)``, laid end to end."""
    out: list[CaptionWord] = []
    at = start
    for text, duration in spec:
        out.append(CaptionWord.of(text, at, at + duration))
        at += duration + 20
    return tuple(out)


def _plain(*text: str, start: int = 0) -> tuple[CaptionWord, ...]:
    return _words(tuple((token, PLAIN) for token in text), start)


def _segment(
    spec: tuple[tuple[str, int], ...] | tuple[str, ...],
    *,
    start: int = 0,
    **over: object,
) -> CaptionSegment:
    words = (
        _words(spec, start)  # type: ignore[arg-type]
        if spec and isinstance(spec[0], tuple)
        else _plain(*spec, start=start)  # type: ignore[arg-type]
    )
    return CaptionSegment(
        index=0,
        start_ms=words[0].start_ms,
        end_ms=words[-1].end_ms + 100,
        text=" ".join(word.text for word in words),
        words=words,
        **over,  # type: ignore[arg-type]
    )


def _document(*segments: CaptionSegment) -> CaptionDocument:
    return CaptionDocument.of(*segments)


def _human_marked(*text: str) -> CaptionSegment:
    """A cue whose first word the user highlighted by hand, before the stage ran."""
    lead = CaptionWord.of(text[0], 0, PLAIN, highlight=True)
    rest = _words(tuple((token, PLAIN) for token in text[1:]), start=PLAIN + 20)
    return CaptionSegment(
        index=0,
        start_ms=0,
        end_ms=rest[-1].end_ms + 100,
        text=" ".join(text),
        words=(lead, *rest),
    )


def _marked(
    *segments: CaptionSegment, rules: HighlightRules = DEFAULT_HIGHLIGHT_RULES
) -> tuple[tuple[tuple[str, bool], ...], ...]:
    """Every cue's words as ``(text, highlighted)``, in document order."""
    applied = Highlighter(rules=rules).apply(_document(*segments), StageContext()).unwrap()
    return tuple(
        tuple((word.text, word.highlight) for word in segment.words) for segment in applied.segments
    )


def _chosen(
    *segments: CaptionSegment, rules: HighlightRules = DEFAULT_HIGHLIGHT_RULES
) -> tuple[str, ...]:
    """The words one document ended up emphasising, in order."""
    return tuple(text for cue in _marked(*segments, rules=rules) for text, marked in cue if marked)


# -- the stage ---------------------------------------------------------------


class TestTheStage:
    def test_its_name_is_highlight(self) -> None:
        assert Highlighter().name == "highlight"

    def test_it_returns_a_document(self) -> None:
        result = Highlighter().apply(_document(_segment(("we", "made", "47"))), StageContext())
        assert result.is_ok() is True

    def test_the_document_still_validates(self) -> None:
        """A readable cue: the words are spoken at a pace a viewer can follow."""
        spoken = (("we", 300), ("made", 400), ("47", 400), ("dollars", 500))
        applied = Highlighter().apply(_document(_segment(spoken)), StageContext()).unwrap()
        assert validate_caption_document(applied) == ""

    def test_an_empty_document_is_fine(self) -> None:
        applied = Highlighter().apply(_document(), StageContext()).unwrap()
        assert applied.is_empty is True

    def test_a_wordless_segment_is_fine(self) -> None:
        segment = CaptionSegment(index=0, start_ms=0, end_ms=1_000, text="hello there")
        applied = Highlighter().apply(_document(segment), StageContext()).unwrap()
        assert applied.segments[0].words == ()

    def test_marked_twice_is_marked_once(self) -> None:
        """The stage is idempotent: a second pass has nothing to add."""
        once = (
            Highlighter()
            .apply(_document(_segment(("Nova", "made", "47", "dollars"))), StageContext())
            .unwrap()
        )
        twice = Highlighter().apply(once, StageContext()).unwrap()
        assert twice == once

    def test_a_locked_segment_is_left_alone(self) -> None:
        locked = _segment(("we", "made", "47"), locked=True)
        applied = Highlighter().apply(_document(locked), StageContext()).unwrap()
        assert applied.segments[0] == locked

    def test_it_runs_in_a_pipeline(self) -> None:
        pipeline = CaptionPipeline().with_stage("highlight", Highlighter())
        applied = pipeline.run(_document(_segment(("we", "made", "47"))), StageContext()).unwrap()
        assert applied.segments[0].words[2].highlight is True

    def test_it_can_be_switched_off(self) -> None:
        pipeline = (
            CaptionPipeline().with_stage("highlight", Highlighter()).disabled_stage("highlight")
        )
        applied = pipeline.run(_document(_segment(("we", "made", "47"))), StageContext()).unwrap()
        assert applied.segments[0].words[2].highlight is False


# -- numbers -----------------------------------------------------------------


class TestNumbers:
    def test_a_number_is_the_word_of_the_line(self) -> None:
        assert _chosen(_segment(("we", "made", "47", "dollars"))) == ("47", "dollars")

    def test_a_decimal_is_a_number(self) -> None:
        assert is_number("3.5") is True

    def test_a_thousand_separator_is_a_number(self) -> None:
        assert is_number("1,000") is True

    def test_a_percentage_is_a_number(self) -> None:
        assert is_number("30%") is True

    def test_a_word_is_not_a_number(self) -> None:
        assert is_number("forty") is False

    def test_numbers_can_be_left_alone(self) -> None:
        rules = HighlightRules(numbers=False)
        assert _chosen(_segment(("we", "made", "47", "dollars")), rules=rules) == ("dollars",)

    def test_a_number_outranks_a_held_word(self) -> None:
        rules = HighlightRules(max_per_segment=1)
        spec = (("we", PLAIN), ("made", PLAIN), ("PAUSED", HELD), ("47", PLAIN))
        assert _chosen(_segment(spec), rules=rules) == ("47",)


# -- quantities --------------------------------------------------------------


class TestQuantities:
    def test_a_unit_beside_a_number_is_part_of_it(self) -> None:
        assert _chosen(_segment(("wait", "5", "minutes", "please"))) == ("5", "minutes")

    def test_a_percentage_sign_counts_as_a_unit(self) -> None:
        assert _chosen(_segment(("up", "30", "%", "today"))) == ("30", "%")

    def test_a_word_that_is_not_a_unit_is_left(self) -> None:
        assert _chosen(_segment(("wait", "5", "monkeys", "please"))) == ("5",)

    def test_a_unit_without_a_number_is_nothing(self) -> None:
        assert _chosen(_segment(("wait", "a", "few", "minutes"))) == ()

    def test_quantities_can_be_left_alone(self) -> None:
        rules = HighlightRules(quantities=False)
        assert _chosen(_segment(("wait", "5", "minutes", "please")), rules=rules) == ("5",)

    def test_a_project_can_add_its_own_unit(self) -> None:
        rules = DEFAULT_HIGHLIGHT_RULES.with_units("subscribers")
        assert _chosen(_segment(("we", "hit", "1000", "subscribers")), rules=rules) == (
            "1000",
            "subscribers",
        )

    def test_a_project_can_take_a_unit_back(self) -> None:
        rules = DEFAULT_HIGHLIGHT_RULES.without_units("minutes")
        assert _chosen(_segment(("wait", "5", "minutes", "please")), rules=rules) == ("5",)


# -- held words --------------------------------------------------------------


class TestHeldWords:
    def test_a_word_the_speaker_held_is_the_word_of_the_line(self) -> None:
        spec = (("it", PLAIN), ("was", PLAIN), ("huge", HELD), ("really", PLAIN))
        assert _chosen(_segment(spec)) == ("huge",)

    def test_an_evenly_spoken_line_highlights_nothing(self) -> None:
        assert _chosen(_segment(("it", "was", "quite", "good", "today"))) == ()

    def test_a_word_held_just_a_little_is_not_emphasis(self) -> None:
        spec = (("it", PLAIN), ("was", PLAIN), ("fine", PLAIN + 60), ("really", PLAIN))
        assert _chosen(_segment(spec)) == ()

    def test_a_held_word_below_the_floor_is_not_emphasis(self) -> None:
        """A fast talker's median is short; the floor stops everything popping."""
        spec = (("hi", 30), ("there", 30), ("now", 90), ("go", 30))
        assert _chosen(_segment(spec)) == ()

    def test_held_words_can_be_left_alone(self) -> None:
        rules = HighlightRules(held_words=False)
        spec = (("it", PLAIN), ("was", PLAIN), ("huge", HELD), ("really", PLAIN))
        assert _chosen(_segment(spec), rules=rules) == ()

    def test_the_median_comes_from_the_whole_document(self) -> None:
        """A fast talker's ordinary word is not emphasis next to a slow cue."""
        fast = _segment(tuple((token, 60) for token in ("a", "b", "c", "d")))
        slow = _segment(tuple((token, 300) for token in ("e", "f", "g", "h")))
        assert _chosen(fast, slow) == ()

    def test_held_words_reports_indices(self) -> None:
        words = _words((("a", PLAIN), ("b", HELD), ("c", PLAIN)))
        assert held_words(words, PLAIN, DEFAULT_HIGHLIGHT_RULES) == frozenset({1})

    def test_a_filler_is_never_held(self) -> None:
        words = _words((("a", PLAIN), ("um", HELD), ("c", PLAIN)))
        assert held_words(words, PLAIN, DEFAULT_HIGHLIGHT_RULES) == frozenset()


# -- names -------------------------------------------------------------------


class TestNames:
    def test_a_name_is_marked_the_first_time(self) -> None:
        assert _chosen(_segment(("hello", "Nova", "here", "again"))) == ("Nova",)

    def test_the_second_mention_in_one_cue_is_not_new(self) -> None:
        assert _chosen(_segment(("hello", "Nova", "said", "Nova", "again"))) == ("Nova",)

    def test_the_second_cue_is_not_new(self) -> None:
        first = _segment(("hello", "Nova", "here", "now"), start=0)
        second = _segment(("Nova", "left", "the", "room"), start=5_000)
        assert _chosen(first, second) == ("Nova",)

    def test_the_first_word_of_a_cue_is_not_a_name(self) -> None:
        """Refine capitalises the start of a sentence, so it means nothing."""
        assert _chosen(_segment(("Nova", "went", "to", "town"))) == ()

    def test_names_can_be_left_alone(self) -> None:
        rules = HighlightRules(names=False)
        assert _chosen(_segment(("hello", "Nova", "here", "again")), rules=rules) == ()

    def test_a_shouted_word_is_emphasis_not_a_name(self) -> None:
        assert _chosen(_segment(("we", "LOVE", "this", "place"))) == ("LOVE",)


# -- shouting ----------------------------------------------------------------


class TestShouting:
    def test_a_capitalised_word_is_emphasis(self) -> None:
        assert _chosen(_segment(("we", "NEVER", "do", "that"))) == ("NEVER",)

    def test_a_single_letter_is_not_a_shout(self) -> None:
        assert _chosen(_segment(("so", "I", "said", "yes"))) == ()

    def test_a_capitalised_word_with_no_letters_is_not_a_shout(self) -> None:
        assert _chosen(_segment(("page", "42", "of", "the", "report"))) == ("42",)

    def test_shouting_can_be_left_alone(self) -> None:
        rules = HighlightRules(shouted=False)
        assert _chosen(_segment(("we", "NEVER", "do", "that")), rules=rules) == ()


# -- repeated terms ----------------------------------------------------------


class TestRepeatedTerms:
    def _coffee(self) -> tuple[CaptionSegment, ...]:
        return (
            _segment(("we", "love", "coffee", "here"), start=0),
            _segment(("more", "coffee", "please", "now"), start=5_000),
            _segment(("that", "coffee", "was", "hot"), start=10_000),
        )

    def test_a_term_said_three_times_is_what_it_is_about(self) -> None:
        assert _chosen(*self._coffee()) == ("coffee", "coffee", "coffee")

    def test_a_term_said_twice_is_not_yet_the_subject(self) -> None:
        cues = self._coffee()[:2]
        assert _chosen(*cues) == ()

    def test_the_count_is_over_the_whole_document(self) -> None:
        assert term_counts(_document(*self._coffee()))["coffee"] == 3

    def test_stop_words_are_never_the_subject(self) -> None:
        cues = (
            _segment(("we", "think", "that", "this"), start=0),
            _segment(("and", "that", "is", "that"), start=5_000),
            _segment(("that", "was", "all", "then"), start=10_000),
        )
        assert _chosen(*cues) == ()

    def test_short_words_are_not_terms(self) -> None:
        rules = HighlightRules(min_term_chars=2)
        cues = (
            _segment(("a", "cat", "sat", "down"), start=0),
            _segment(("the", "cat", "ran", "off"), start=5_000),
            _segment(("that", "cat", "is", "back"), start=10_000),
        )
        assert _chosen(*cues, rules=rules) == ("cat", "cat", "cat")

    def test_how_many_repeats_it_takes_is_a_setting(self) -> None:
        rules = HighlightRules(min_term_repeats=2)
        assert _chosen(*self._coffee()[:2], rules=rules) == ("coffee", "coffee")

    def test_repeated_terms_can_be_left_alone(self) -> None:
        rules = HighlightRules(repeated_terms=False)
        assert _chosen(*self._coffee(), rules=rules) == ()

    def test_a_project_can_stop_list_a_word(self) -> None:
        rules = DEFAULT_HIGHLIGHT_RULES.with_stop_words("coffee")
        assert _chosen(*self._coffee(), rules=rules) == ()

    def test_a_project_can_un_stop_list_a_word(self) -> None:
        rules = DEFAULT_HIGHLIGHT_RULES.without_stop_words("please")
        assert "please" not in rules.stop_words

    def test_the_tally_ignores_numbers_and_fillers(self) -> None:
        words = _plain("47", "47", "um", "um", "coffee")
        assert term_counts_of(words, DEFAULT_HIGHLIGHT_RULES) == {"coffee": 1}


# -- the cap -----------------------------------------------------------------


class TestTheCap:
    def test_two_is_the_default(self) -> None:
        assert _chosen(_segment(("we", "made", "47", "dollars", "and", "cents"))) == (
            "47",
            "dollars",
        )

    def test_one_when_asked(self) -> None:
        rules = HighlightRules(max_per_segment=1)
        assert _chosen(_segment(("we", "made", "47", "dollars")), rules=rules) == ("47",)

    def test_none_when_asked(self) -> None:
        rules = HighlightRules(max_per_segment=0)
        assert _chosen(_segment(("we", "made", "47", "dollars")), rules=rules) == ()

    def test_a_tie_goes_to_the_earlier_word(self) -> None:
        rules = HighlightRules(max_per_segment=1)
        assert _chosen(_segment(("we", "made", "47", "and", "88")), rules=rules) == ("47",)

    def test_a_cue_is_not_a_christmas_tree(self) -> None:
        spec = (("we", PLAIN), ("sold", PLAIN), ("47", PLAIN), ("at", PLAIN), ("12", PLAIN))
        assert len(_chosen(_segment(spec))) == 2


# -- what a highlight must respect -------------------------------------------


class TestWhatIsRespected:
    def test_a_highlight_already_set_is_kept(self) -> None:
        assert _chosen(_human_marked("nothing", "we", "made", "47", "dollars"))[0] == "nothing"

    def test_a_kept_highlight_does_not_spend_the_cap(self) -> None:
        """A human's choice outranks a heuristic's, and does not cost it room."""
        rules = HighlightRules(max_per_segment=1)
        marked = _chosen(_human_marked("nothing", "we", "made", "47", "dollars"), rules=rules)
        assert marked == ("nothing", "47")

    def test_existing_highlights_can_be_overridden(self) -> None:
        rules = HighlightRules(respect_existing=False, max_per_segment=1)
        marked = _chosen(_human_marked("nothing", "we", "made", "47", "dollars"), rules=rules)
        assert marked == ("47",)

    def test_a_filler_is_never_the_word_of_the_line(self) -> None:
        """True even with Refine switched off."""
        assert _chosen(_segment(("um", "hello", "um", "there"))) == ()

    def test_fillers_can_be_treated_like_any_other_word(self) -> None:
        rules = HighlightRules(skip_fillers=False, min_term_repeats=2, min_term_chars=2)
        assert _chosen(_segment(("um", "hello", "um", "there")), rules=rules) == ("um", "um")


# -- what survives -----------------------------------------------------------


class TestWhatSurvives:
    def test_the_text(self) -> None:
        segment = _segment(("we", "made", "47", "dollars"))
        marked = highlight_segment(segment, DEFAULT_HIGHLIGHT_RULES)
        assert tuple(word.text for word in marked.words) == ("we", "made", "47", "dollars")

    def test_the_timings(self) -> None:
        segment = _segment(("we", "made", "47", "dollars"))
        marked = highlight_segment(segment, DEFAULT_HIGHLIGHT_RULES)
        assert [word.start_ms for word in marked.words] == [word.start_ms for word in segment.words]

    def test_the_characters(self) -> None:
        segment = _segment(("we", "made", "47", "dollars"))
        marked = highlight_segment(segment, DEFAULT_HIGHLIGHT_RULES)
        assert marked.words[2].chars == segment.words[2].chars

    def test_the_confidence(self) -> None:
        words = _words((("we", PLAIN), ("made", PLAIN), ("47", PLAIN)))
        segment = CaptionSegment(
            index=0,
            start_ms=0,
            end_ms=1_000,
            text="we made 47",
            words=tuple(replace_confidence(word) for word in words),
        )
        marked = highlight_segment(segment, DEFAULT_HIGHLIGHT_RULES)
        assert marked.words[0].confidence == 0.5

    def test_the_speaker(self) -> None:
        segment = _segment(("we", "made", "47", "dollars"), speaker="A")
        marked = highlight_segment(segment, DEFAULT_HIGHLIGHT_RULES)
        assert marked.speaker == "A"

    def test_the_segment_itself_is_untouched(self) -> None:
        segment = _segment(("we", "made", "47", "dollars"))
        marked = highlight_segment(segment, DEFAULT_HIGHLIGHT_RULES)
        assert (marked.index, marked.start_ms, marked.end_ms, marked.text) == (
            segment.index,
            segment.start_ms,
            segment.end_ms,
            segment.text,
        )

    def test_no_words_are_added_or_lost(self) -> None:
        segment = _segment(("we", "made", "47", "dollars"))
        marked = highlight_segment(segment, DEFAULT_HIGHLIGHT_RULES)
        assert len(marked.words) == len(segment.words)

    def test_a_document_with_nothing_to_mark_is_untouched(self) -> None:
        document = _document(_segment(("there", "is", "nothing", "here")))
        assert Highlighter().apply(document, StageContext()).unwrap() == document


def replace_confidence(word: CaptionWord) -> CaptionWord:
    """The same word, with a confidence for the test above to see again."""
    from dataclasses import replace

    return replace(word, confidence=0.5)


# -- the rules ---------------------------------------------------------------


class TestTheRules:
    def test_the_defaults_are_a_value(self) -> None:
        assert Highlighter().rules == HighlightRules()

    def test_a_negative_cap_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="max_per_segment"):
            HighlightRules(max_per_segment=-1)

    def test_a_factor_below_one_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="held_factor"):
            HighlightRules(held_factor=0.5)

    def test_one_mention_is_not_a_repetition(self) -> None:
        with pytest.raises(NovaInvariantError, match="min_term_repeats"):
            HighlightRules(min_term_repeats=1)

    def test_the_rules_are_frozen(self) -> None:
        with pytest.raises(Exception):  # noqa: B017 - frozen is the point
            HighlightRules().max_per_segment = 9  # type: ignore[misc]

    def test_adding_a_stop_word_leaves_the_rest_alone(self) -> None:
        rules = DEFAULT_HIGHLIGHT_RULES.with_stop_words("coffee")
        assert "coffee" in rules.stop_words
        assert "the" in rules.stop_words

    def test_mark_one_line_on_its_own(self) -> None:
        """What an inspector panel asks: what would a style emphasise here?"""
        segment = _segment(("we", "made", "47", "dollars"))
        assert highlight_words(segment.words, DEFAULT_HIGHLIGHT_RULES)[2].highlight is True
