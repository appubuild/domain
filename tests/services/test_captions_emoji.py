"""The Emoji stage (`services/captions/emoji.py`).

The invariant under test is that **the picture is chosen from the words, by
data, and changes nothing else**: the text, the timings, the words and the
highlight flags come out exactly as they went in, and one field is set.

The second invariant is restraint in the other direction — an emoji is not
forced on a line that has not earned one, an emoji a human chose is never
replaced, and a locked cue is left alone.

Tests are named for what a viewer would see on screen.
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
from nova_studio.services.captions.emoji import (
    DEFAULT_EMOJI,
    DEFAULT_EMOJI_RULES,
    EmojiDecorator,
    EmojiRules,
    decorate_segment,
    emoji_for,
)
from nova_studio.services.captions.pipeline import CaptionPipeline, StageContext

pytestmark = pytest.mark.unit


# -- helpers -----------------------------------------------------------------


def _words(text: str, start: int = 0) -> tuple[CaptionWord, ...]:
    out: list[CaptionWord] = []
    at = start
    for token in text.split():
        out.append(CaptionWord.of(token, at, at + 300))
        at += 320
    return tuple(out)


def _segment(text: str, **over: object) -> CaptionSegment:
    words = _words(text)
    return CaptionSegment(
        index=0,
        start_ms=0,
        end_ms=words[-1].end_ms + 100,
        text=text,
        words=words,
        **over,  # type: ignore[arg-type]
    )


def _document(*segments: CaptionSegment) -> CaptionDocument:
    return CaptionDocument.of(*segments)


def _decorated(*texts: str, rules: EmojiRules = DEFAULT_EMOJI_RULES) -> tuple[str, ...]:
    """The emoji each cue ended up with, in document order."""
    applied = (
        EmojiDecorator(rules=rules)
        .apply(_document(*(_segment(text) for text in texts)), StageContext())
        .unwrap()
    )
    return tuple(segment.emoji for segment in applied.segments)


# -- the stage ---------------------------------------------------------------


class TestTheStage:
    def test_its_name_is_emoji(self) -> None:
        assert EmojiDecorator().name == "emoji"

    def test_it_returns_a_document(self) -> None:
        result = EmojiDecorator().apply(_document(_segment("i love coffee")), StageContext())
        assert result.is_ok() is True

    def test_the_document_still_validates(self) -> None:
        applied = (
            EmojiDecorator().apply(_document(_segment("good morning")), StageContext()).unwrap()
        )
        assert validate_caption_document(applied) == ""

    def test_an_empty_document_is_fine(self) -> None:
        applied = EmojiDecorator().apply(_document(), StageContext()).unwrap()
        assert applied.is_empty is True

    def test_a_wordless_segment_is_left_alone(self) -> None:
        """With no words there is nothing to match against."""
        segment = CaptionSegment(index=0, start_ms=0, end_ms=1_000, text="hello there")
        applied = EmojiDecorator().apply(_document(segment), StageContext()).unwrap()
        assert applied.segments[0].emoji == ""

    def test_decorating_twice_changes_nothing(self) -> None:
        once = EmojiDecorator().apply(_document(_segment("i love coffee")), StageContext()).unwrap()
        twice = EmojiDecorator().apply(once, StageContext()).unwrap()
        assert twice == once

    def test_a_locked_segment_is_left_alone(self) -> None:
        locked = _segment("i love coffee", locked=True)
        applied = EmojiDecorator().apply(_document(locked), StageContext()).unwrap()
        assert applied.segments[0] == locked

    def test_it_runs_in_a_pipeline(self) -> None:
        pipeline = CaptionPipeline().with_stage("emoji", EmojiDecorator())
        applied = pipeline.run(_document(_segment("i love coffee")), StageContext()).unwrap()
        assert applied.segments[0].emoji == "❤️"

    def test_it_can_be_switched_off(self) -> None:
        pipeline = CaptionPipeline().with_stage("emoji", EmojiDecorator()).disabled_stage("emoji")
        applied = pipeline.run(_document(_segment("i love coffee")), StageContext()).unwrap()
        assert applied.segments[0].emoji == ""


# -- matching ----------------------------------------------------------------


class TestMatching:
    def test_a_word_earns_its_picture(self) -> None:
        assert _decorated("i love coffee so much") == ("❤️",)

    def test_a_word_anywhere_in_the_line(self) -> None:
        assert _decorated("we drank coffee all day") == ("☕",)

    def test_capitalisation_does_not_matter(self) -> None:
        assert _decorated("I Love Coffee") == ("❤️",)

    def test_punctuation_does_not_matter(self) -> None:
        assert _decorated("coffee, please") == ("☕",)

    def test_a_line_with_nothing_to_decorate_gets_nothing(self) -> None:
        assert _decorated("the report is on the table") == ("",)

    def test_every_default_entry_is_reachable(self) -> None:
        """An entry nobody can match is a typo in a data table."""
        for phrase, emoji in DEFAULT_EMOJI.items():
            assert emoji_for(_words(phrase)) == emoji

    def test_the_default_map_is_concrete(self) -> None:
        """A particle is a sentence before it is a picture."""
        for particle in ("no", "yes", "time", "work", "the", "and"):
            assert particle not in DEFAULT_EMOJI


# -- phrases -----------------------------------------------------------------


class TestPhrases:
    def test_a_phrase_beats_its_own_words(self) -> None:
        assert _decorated("happy birthday to you") == ("🎂",)

    def test_good_morning_is_one_sunrise(self) -> None:
        assert _decorated("good morning everyone") == ("🌅",)

    def test_thank_you_is_one_prayer(self) -> None:
        assert _decorated("thank you all") == ("🙏",)

    def test_a_phrase_in_the_middle_of_a_line(self) -> None:
        assert _decorated("we said thank you loudly") == ("🙏",)

    def test_phrases_can_be_turned_off(self) -> None:
        """A phrase is not a phrase any more: its first word is all that counts."""
        rules = EmojiRules(phrases=False)
        assert _decorated("happy birthday to you", rules=rules) == ("😊",)

    def test_the_longest_phrase_wins(self) -> None:
        rules = DEFAULT_EMOJI_RULES.with_mapping({"new": "🆕", "new year": "🎊"})
        assert _decorated("new year resolution", rules=rules) == ("🎊",)

    def test_a_phrase_is_still_a_phrase_with_punctuation(self) -> None:
        assert _decorated("Good Morning, everyone") == ("🌅",)


# -- how many ----------------------------------------------------------------


class TestHowMany:
    def test_one_is_the_default(self) -> None:
        assert _decorated("coffee and pizza") == ("☕",)

    def test_two_when_asked(self) -> None:
        rules = EmojiRules(max_per_segment=2)
        assert _decorated("coffee and pizza", rules=rules) == ("☕🍕",)

    def test_two_are_joined_without_a_space(self) -> None:
        """The field is a run of pictures; a space would make it text."""
        rules = EmojiRules(max_per_segment=2)
        assert " " not in _decorated("coffee and pizza", rules=rules)[0]

    def test_none_when_asked(self) -> None:
        rules = EmojiRules(max_per_segment=0)
        assert _decorated("i love coffee", rules=rules) == ("",)

    def test_the_same_emoji_is_not_repeated_in_one_cue(self) -> None:
        rules = EmojiRules(max_per_segment=2)
        assert _decorated("coffee with more coffee", rules=rules) == ("☕",)


# -- a project's own map -----------------------------------------------------


class TestTheMapIsData:
    def test_a_project_can_add_its_own(self) -> None:
        rules = DEFAULT_EMOJI_RULES.with_mapping({"nova": "🌟"})
        assert _decorated("welcome to nova", rules=rules) == ("🌟",)

    def test_adding_leaves_the_rest_alone(self) -> None:
        rules = DEFAULT_EMOJI_RULES.with_mapping({"nova": "🌟"})
        assert rules.mapping.get("coffee") == "☕"

    def test_a_project_can_take_one_away(self) -> None:
        rules = DEFAULT_EMOJI_RULES.without_words("coffee")
        assert _decorated("we drank coffee all day", rules=rules) == ("",)

    def test_taking_one_away_leaves_the_rest(self) -> None:
        rules = DEFAULT_EMOJI_RULES.without_words("coffee")
        assert _decorated("we ate pizza", rules=rules) == ("🍕",)

    def test_the_default_map_is_shared_not_copied(self) -> None:
        assert EmojiRules().mapping is DEFAULT_EMOJI


# -- what a decoration must respect ------------------------------------------


class TestWhatIsRespected:
    def test_an_emoji_already_there_is_kept(self) -> None:
        segment = _segment("i love coffee", emoji="🥳")
        applied = EmojiDecorator().apply(_document(segment), StageContext()).unwrap()
        assert applied.segments[0].emoji == "🥳"

    def test_an_existing_emoji_can_be_overridden(self) -> None:
        rules = EmojiRules(keep_existing=False)
        segment = _segment("i love coffee", emoji="🥳")
        applied = EmojiDecorator(rules=rules).apply(_document(segment), StageContext()).unwrap()
        assert applied.segments[0].emoji == "❤️"

    def test_a_cue_that_earns_nothing_is_cleared_when_the_stage_owns_it(self) -> None:
        segment = _segment("the report is on the table", emoji="🥳")
        rules = EmojiRules(keep_existing=False)
        applied = EmojiDecorator(rules=rules).apply(_document(segment), StageContext()).unwrap()
        assert applied.segments[0].emoji == ""

    def test_the_text_is_untouched(self) -> None:
        segment = _segment("i love coffee")
        assert decorate_segment(segment, DEFAULT_EMOJI_RULES).text == "i love coffee"

    def test_the_words_are_untouched(self) -> None:
        segment = _segment("i love coffee")
        assert decorate_segment(segment, DEFAULT_EMOJI_RULES).words == segment.words

    def test_the_timing_is_untouched(self) -> None:
        segment = _segment("i love coffee")
        decorated = decorate_segment(segment, DEFAULT_EMOJI_RULES)
        assert (decorated.start_ms, decorated.end_ms) == (segment.start_ms, segment.end_ms)

    def test_a_highlight_survives(self) -> None:
        words = tuple(
            replace_highlight(word) if word.text == "coffee" else word
            for word in _words("we drank coffee all day")
        )
        segment = CaptionSegment(
            index=0, start_ms=0, end_ms=3_000, text="we drank coffee all day", words=words
        )
        decorated = decorate_segment(segment, DEFAULT_EMOJI_RULES)
        assert decorated.words[2].highlight is True
        assert decorated.emoji == "☕"

    def test_a_document_with_nothing_to_decorate_is_untouched(self) -> None:
        document = _document(_segment("the report is on the table"))
        assert EmojiDecorator().apply(document, StageContext()).unwrap() == document


def replace_highlight(word: CaptionWord) -> CaptionWord:
    from dataclasses import replace

    return replace(word, highlight=True)


# -- the rules ---------------------------------------------------------------


class TestTheRules:
    def test_the_defaults_are_a_value(self) -> None:
        assert EmojiDecorator().rules == EmojiRules()

    def test_a_negative_cap_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="max_per_segment"):
            EmojiRules(max_per_segment=-1)

    def test_a_zero_word_phrase_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="max_phrase_words"):
            EmojiRules(max_phrase_words=0)

    def test_the_rules_are_frozen(self) -> None:
        with pytest.raises(Exception):  # noqa: B017 - frozen is the point
            EmojiRules().max_per_segment = 9  # type: ignore[misc]

    def test_one_cue_on_its_own(self) -> None:
        """What an inspector panel asks: what would this line wear?"""
        segment = _segment("we won the game")
        assert decorate_segment(segment, DEFAULT_EMOJI_RULES).emoji == "🏆"
