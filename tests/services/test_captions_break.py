"""The Break stage (`services/captions/cues.py`).

The invariant under test is the one a viewer feels and cannot name: **a cue
breaks where the sentence does, and it stays on screen long enough to be read**.
Everything else in the engine — karaoke, animation, styling — decorates the
cues this stage produces, so a bad break is a mistake no later stage can fix.

These tests pin the break without a transcription, a clock or a pixel: words in,
cues out, measured against the four constraints and two preferences the stage
docstring promises.
"""

from __future__ import annotations

import pytest

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.result import Err
from nova_studio.domain.captions import (
    CAPTION_MAX_CPS,
    CAPTION_MAX_LINE_CHARS,
    CAPTION_MAX_LINES,
    CAPTION_MIN_DURATION_MS,
    CaptionDocument,
    CaptionPosition,
    CaptionSegment,
    CaptionWord,
    validate_caption_document,
    wrap_caption,
)
from nova_studio.services.captions.cues import (
    DEFAULT_MAX_DURATION_MS,
    DEFAULT_MIN_DURATION_MS,
    MIN_WORDS_BEFORE_BACKOFF,
    CueBreaker,
)
from nova_studio.services.captions.pipeline import StageContext

pytestmark = pytest.mark.unit

#: The default context: two lines of 42 characters, twenty characters a second.
DEFAULT_MAX_CHARS = CAPTION_MAX_LINE_CHARS * CAPTION_MAX_LINES


# -- helpers -----------------------------------------------------------------


def _words(
    text: str,
    *,
    step: int = 400,
    hold: int = 350,
    start: int = 0,
    speaker: str | None = None,
    with_chars: bool = False,
) -> tuple[CaptionWord, ...]:
    """A run of words spoken at an even pace."""
    words: list[CaptionWord] = []
    at = start
    for word in text.split():
        words.append(CaptionWord.of(word, at, at + hold, speaker=speaker, with_chars=with_chars))
        at += step
    return tuple(words)


def _segment(
    words: tuple[CaptionWord, ...],
    *,
    text: str = "",
    speaker: str | None = None,
    start_ms: int | None = None,
    end_ms: int | None = None,
    **over: object,
) -> CaptionSegment:
    joined = text or " ".join(word.text for word in words)
    start = start_ms if start_ms is not None else (words[0].start_ms if words else 0)
    end = end_ms if end_ms is not None else (words[-1].end_ms if words else 0)
    return CaptionSegment(
        index=0,
        start_ms=start,
        end_ms=end,
        text=joined,
        words=words,
        speaker=speaker,
        **over,  # type: ignore[arg-type]
    )


def _document(*segments: CaptionSegment, **over: object) -> CaptionDocument:
    return CaptionDocument(
        segments=tuple(replace_index(segment, index) for index, segment in enumerate(segments)),
        **over,  # type: ignore[arg-type]
    )


def replace_index(segment: CaptionSegment, index: int) -> CaptionSegment:
    from dataclasses import replace

    return replace(segment, index=index)


def _break(
    document: CaptionDocument,
    ctx: StageContext | None = None,
    **over: int,
) -> CaptionDocument:
    """Run the stage and hand back the document, asserting it succeeded."""
    result = CueBreaker(**over).apply(document, ctx or StageContext())
    assert not isinstance(result, Err)
    return result.unwrap()


def _texts(document: CaptionDocument) -> tuple[str, ...]:
    return tuple(segment.text for segment in document.segments)


class TestTheStageItself:
    def test_the_stage_calls_itself_break(self) -> None:
        assert CueBreaker().name == "break"

    def test_a_project_can_name_its_own_breaker(self) -> None:
        assert CueBreaker(name="shorts-break").name == "shorts-break"

    def test_the_defaults_are_the_ones_the_adr_promises(self) -> None:
        breaker = CueBreaker()
        assert breaker.max_duration_ms == DEFAULT_MAX_DURATION_MS == 7_000
        assert breaker.min_duration_ms == DEFAULT_MIN_DURATION_MS == CAPTION_MIN_DURATION_MS
        assert breaker.backoff_words == MIN_WORDS_BEFORE_BACKOFF

    def test_a_max_duration_of_zero_is_a_bug_in_the_caller(self) -> None:
        with pytest.raises(NovaInvariantError, match="max_duration_ms"):
            CueBreaker(max_duration_ms=0)

    def test_a_negative_min_duration_is_a_bug_in_the_caller(self) -> None:
        with pytest.raises(NovaInvariantError, match="min_duration_ms"):
            CueBreaker(min_duration_ms=-1)

    def test_a_negative_backoff_is_a_bug_in_the_caller(self) -> None:
        with pytest.raises(NovaInvariantError, match="backoff_words"):
            CueBreaker(backoff_words=-1)

    def test_an_empty_document_breaks_into_an_empty_document(self) -> None:
        assert _break(CaptionDocument()).is_empty

    def test_running_the_stage_gives_a_document(self) -> None:
        document = _document(_segment(_words("one two three")))
        assert not isinstance(
            CueBreaker().apply(document, StageContext()),
            Err,
        )


class TestWhatTheStageRefusesToTouch:
    """ADR-0009 §7: the user's corrections outlive every regeneration."""

    def test_a_locked_segment_is_passed_through_untouched(self) -> None:
        locked = _segment(_words("we went to the market and bought fruit"), locked=True)
        document = _document(locked)
        assert _break(document).segments[0] == locked

    def test_a_locked_segment_keeps_its_index(self) -> None:
        locked = _segment(_words("short and safe"), locked=True)
        unlocked = _segment(_words("a much longer line of words that will be split apart"))
        document = _document(locked, unlocked)
        broken = _break(document)
        assert broken.segments[0] == locked
        assert broken.segments[0].index == 0

    def test_a_segment_without_word_timings_is_passed_through_untouched(self) -> None:
        untimed = _segment((), text="no timings here", start_ms=1_000, end_ms=2_500)
        assert _break(_document(untimed)).segments[0] == untimed

    def test_wordless_text_is_not_re_wrapped(self) -> None:
        untimed = _segment((), text="whatever the provider said")
        assert _break(_document(untimed)).segments[0].text == "whatever the provider said"

    def test_new_cues_are_never_locked(self) -> None:
        document = _document(_segment(_words("we went to the market and bought fruit")))
        assert not any(segment.locked for segment in _break(document).segments)


class TestTheDocumentAroundTheCues:
    def test_indices_are_sequential_after_a_break(self) -> None:
        document = _document(_segment(_words(" ".join(f"word{i}" for i in range(40)))))
        broken = _break(document)
        assert [segment.index for segment in broken.segments] == list(range(len(broken.segments)))

    def test_the_language_survives(self) -> None:
        document = _document(_segment(_words("bonsoir tout le monde")), language="fr")
        assert _break(document).language == "fr"

    def test_the_layer_overlay_survives(self) -> None:
        from nova_studio.domain.captions import CaptionDelta, CaptionDeltaKind

        edit = CaptionDelta(
            key="0:0:bonsoir",
            kind=CaptionDeltaKind.TEXT,
            after="Bonsoir",
        )
        document = _document(_segment(_words("bonsoir tout le monde")), edits=(edit,))
        assert _break(document).edits == (edit,)

    def test_the_layers_survive(self) -> None:
        document = _document(_segment(_words("bonsoir tout le monde")))
        assert _break(document).layers == document.layers

    def test_a_broken_document_passes_validation(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(60)))
        document = _document(_segment(words))
        broken = _break(document)
        assert validate_caption_document(broken) == "", validate_caption_document(broken)


class TestTheLineBudget:
    def test_a_short_line_needs_no_break(self) -> None:
        document = _document(_segment(_words("we went to the market")))
        broken = _break(document)
        assert len(broken.segments) == 1
        assert broken.segments[0].text == "we went to the market"

    def test_a_long_line_is_split(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(40)))
        document = _document(_segment(words))
        assert len(_break(document).segments) > 1

    def test_no_cue_needs_more_lines_than_the_budget_allows(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(60)))
        document = _document(_segment(words))
        for segment in _break(document).segments:
            lines = wrap_caption(
                segment.text,
                max_chars=CAPTION_MAX_LINE_CHARS,
                max_lines=CAPTION_MAX_LINES,
            )
            assert len(lines) <= CAPTION_MAX_LINES

    def test_no_cue_is_longer_than_two_full_lines(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(60)))
        document = _document(_segment(words))
        for segment in _break(document).segments:
            assert len(segment.text) <= DEFAULT_MAX_CHARS

    def test_a_wider_budget_makes_fewer_cues(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(40)))
        document = _document(_segment(words))
        narrow = _break(document, StageContext(max_line_chars=20, max_lines=1))
        wide = _break(document, StageContext(max_line_chars=60, max_lines=2))
        assert len(narrow.segments) > len(wide.segments)

    def test_the_fill_takes_every_word_it_can_hold(self) -> None:
        """Greedy: a cue stops one word before the wrap needs another line.

        :func:`wrap_caption` balances lines, which spends a little capacity —
        two balanced lines hold less than two full ones — so the honest measure
        of "full" is the wrap, not ``max_lines * max_line_chars``.
        """
        words = _words(" ".join(f"word{i}" for i in range(30)))
        document = _document(_segment(words))
        broken = _break(document)
        taken = 0
        for segment in broken.segments[:-1]:
            taken += len(segment.words)
            one_more = " ".join(word.text for word in words[: taken + 1])
            lines = wrap_caption(
                one_more, max_chars=CAPTION_MAX_LINE_CHARS, max_lines=CAPTION_MAX_LINES
            )
            assert len(lines) > CAPTION_MAX_LINES, one_more

    def test_a_single_unsplittable_word_is_not_dropped(self) -> None:
        one = _words("supercalifragilisticexpialidociousandthensomemoreletters")
        document = _document(_segment(one))
        broken = _break(document, StageContext(max_line_chars=5, max_lines=1))
        assert broken.word_count == 1
        assert broken.segments[0].text == one[0].text


class TestTheDurationBudget:
    def test_no_cue_outstays_its_welcome(self) -> None:
        # A slow speaker: 40 words, a second and a half apart.
        words = _words(" ".join(f"word{i}" for i in range(40)), step=1_500, hold=1_000)
        document = _document(_segment(words))
        for segment in _break(document).segments:
            assert segment.duration_ms <= DEFAULT_MAX_DURATION_MS

    def test_a_shorter_ceiling_makes_more_cues(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(40)), step=1_000, hold=900)
        document = _document(_segment(words))
        slow = _break(document, max_duration_ms=10_000)
        fast = _break(document, max_duration_ms=2_000)
        assert len(fast.segments) > len(slow.segments)

    def test_a_cue_starts_when_its_first_word_starts(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(40)), start=5_000)
        document = _document(_segment(words))
        assert _break(document).segments[0].start_ms == 5_000

    def test_a_cue_ends_when_its_last_word_ends(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(40)))
        document = _document(_segment(words))
        first = _break(document).segments[0]
        assert first.end_ms == first.words[-1].end_ms


class TestTheMinimumDuration:
    """A cue the eye cannot land on is worse than a slightly late one."""

    def test_a_brief_cue_is_lengthened(self) -> None:
        words = _words("hi", hold=100)
        document = _document(_segment(words))
        segment = _break(document).segments[0]
        assert segment.duration_ms >= DEFAULT_MIN_DURATION_MS

    def test_a_brief_cue_is_lengthened_forwards_not_backwards(self) -> None:
        words = _words("hi", start=4_000, hold=100)
        document = _document(_segment(words))
        segment = _break(document).segments[0]
        assert segment.start_ms == 4_000
        assert segment.end_ms == 4_000 + DEFAULT_MIN_DURATION_MS

    def test_the_lengthening_never_eats_the_next_word(self) -> None:
        # Two words spoken back to back; the first must not swallow the second.
        words = (
            CaptionWord.of("hi", 0, 50, with_chars=False),
            CaptionWord.of("there", 200, 250, with_chars=False),
        )
        document = _document(_segment(words))
        first, second = _break(document).segments
        assert first.end_ms <= second.start_ms

    def test_the_last_cue_may_run_past_the_last_word(self) -> None:
        words = _words("bye", hold=100)
        document = _document(_segment(words))
        assert _break(document).segments[0].end_ms > words[-1].end_ms

    def test_a_zero_minimum_disables_the_lengthening(self) -> None:
        words = _words("hi", hold=100)
        document = _document(_segment(words))
        segment = _break(document, min_duration_ms=0).segments[0]
        assert segment.end_ms == words[-1].end_ms

    def test_a_cue_is_never_left_with_no_duration(self) -> None:
        words = (
            CaptionWord.of("a", 1_000, 1_000, with_chars=False),
            CaptionWord.of("b", 2_000, 2_000, with_chars=False),
        )
        document = _document(_segment(words))
        for segment in _break(document, min_duration_ms=0).segments:
            assert segment.duration_ms >= 1


class TestTheReadingRate:
    """Characters per second is the only measure that predicts readability."""

    def test_a_fast_speaker_is_split_even_though_the_text_is_short(self) -> None:
        # "alpha beta gamma delta" is 23 characters in 400 ms: 57 cps.
        words = _words("alpha beta gamma delta", step=100, hold=90)
        document = _document(_segment(words))
        assert len(_break(document).segments) > 1

    def test_no_cue_exceeds_the_reading_rate(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(40)), step=300, hold=250)
        document = _document(_segment(words))
        for segment in _break(document).segments:
            assert segment.reading_rate() <= CAPTION_MAX_CPS

    def test_a_cue_is_never_split_finer_than_a_word(self) -> None:
        """Speech faster than reading cannot be fixed by breaking.

        A breaker that returned zero words here would loop for ever; one that
        dropped the word would lose it.  The engine emits the word and lets the
        pacing stage — or the user — deal with audio this fast.
        """
        words = _words("alpha beta gamma", step=100, hold=90)
        document = _document(_segment(words))
        broken = _break(document)
        assert broken.segment_count == len(words)
        assert broken.word_count == len(words)
        assert broken.segments[0].reading_rate() > CAPTION_MAX_CPS

    def test_a_more_generous_rate_makes_fewer_cues(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(30)), step=200, hold=190)
        document = _document(_segment(words))
        strict = _break(document, StageContext(max_reading_rate_cps=5))
        lenient = _break(document, StageContext(max_reading_rate_cps=100))
        assert len(strict.segments) > len(lenient.segments)


class TestSpeakerChanges:
    """Two people in one cue leaves the reader to work out who is talking."""

    def test_a_speaker_change_breaks_the_cue(self) -> None:
        first = _words("hello there my friend", speaker="A")
        second = _words("and then I said", start=2_000, speaker="B")
        document = _document(_segment(first + second))
        broken = _break(document)
        assert broken.segments[0].text == "hello there my friend"
        assert broken.segments[1].text == "and then I said"

    def test_no_cue_mixes_two_speakers(self) -> None:
        words = tuple(
            CaptionWord.of(
                f"word{index}",
                index * 300,
                index * 300 + 250,
                speaker="A" if index < 3 else "B",
                with_chars=False,
            )
            for index in range(6)
        )
        document = _document(_segment(words))
        for segment in _break(document).segments:
            assert len({word.speaker for word in segment.words}) == 1

    def test_a_cue_takes_the_speaker_of_its_words(self) -> None:
        words = _words("hello there my friend", speaker="A")
        document = _document(_segment(words))
        assert _break(document).segments[0].speaker == "A"

    def test_a_cue_with_no_word_speaker_keeps_the_segment_speaker(self) -> None:
        words = _words("hello there my friend")
        document = _document(_segment(words, speaker="narrator"))
        assert _break(document).segments[0].speaker == "narrator"


class TestBreakingAtPunctuation:
    """The preference that separates a caption from a word-wrap."""

    def test_a_break_lands_on_a_full_stop(self) -> None:
        words = _words(
            "we went to the market. we bought fruit for the festival",
            step=1_000,
            hold=900,
        )
        document = _document(_segment(words))
        assert _texts(_break(document))[0] == "we went to the market."

    def test_a_break_lands_on_a_question_mark(self) -> None:
        words = _words("did you see that? I did not see that at all", step=1_000, hold=900)
        document = _document(_segment(words))
        assert _texts(_break(document))[0] == "did you see that?"

    def test_a_break_lands_on_a_comma(self) -> None:
        words = _words("well, I suppose we could, go now if you want", step=1_000, hold=900)
        document = _document(_segment(words))
        assert _texts(_break(document))[0] == "well, I suppose we could,"

    def test_backoff_never_goes_further_than_it_is_allowed(self) -> None:
        # The full stop is five words back from the cut; the backoff is four.
        words = _words(
            "one two. three four five six seven eight nine ten eleven twelve",
            step=1_000,
            hold=900,
        )
        document = _document(_segment(words))
        first = _break(document).segments[0]
        assert "two." in first.text
        assert not first.text.endswith("two.")

    def test_backoff_never_leaves_a_fragment(self) -> None:
        words = _words(
            " ".join(f"word{i}" for i in range(30)) + " stop. more words here now",
            step=1_000,
            hold=900,
        )
        document = _document(_segment(words))
        for segment in _break(document).segments[:-1]:
            assert len(segment.words) > 1

    def test_disabling_backoff_makes_breaks_where_the_budget_runs_out(self) -> None:
        words = _words(
            "we went to the market. we bought fruit for the festival",
            step=1_000,
            hold=900,
        )
        document = _document(_segment(words))
        broken = _break(document, backoff_words=0)
        assert broken.segments[0].text != "we went to the market."

    def test_a_trailing_punctuation_word_is_not_left_alone(self) -> None:
        words = _words("alpha beta gamma delta epsilon zeta eta theta. omega", step=1_000, hold=900)
        document = _document(_segment(words))
        for segment in _break(document).segments[:-1]:
            assert len(segment.words) >= 2


class TestTheWordsThemselves:
    """Karaoke needs the words, not just the text."""

    def test_every_word_survives_the_break(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(45)))
        document = _document(_segment(words))
        assert _break(document).word_count == len(words)

    def test_words_stay_in_order(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(45)))
        document = _document(_segment(words))
        survived = tuple(word for segment in _break(document).segments for word in segment.words)
        assert survived == words

    def test_word_objects_are_carried_not_rebuilt(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(45)))
        document = _document(_segment(words))
        survived = tuple(word for segment in _break(document).segments for word in segment.words)
        assert all(kept is original for kept, original in zip(survived, words, strict=False))

    def test_character_timings_survive_the_break(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(30)), with_chars=True)
        document = _document(_segment(words))
        survived = tuple(word for segment in _break(document).segments for word in segment.words)
        assert all(word.has_char_timings for word in survived)

    def test_highlighted_words_stay_highlighted(self) -> None:
        words = tuple(
            CaptionWord.of(f"word{index}", index * 300, index * 300 + 250, highlight=index == 2)
            for index in range(30)
        )
        document = _document(_segment(words))
        survived = tuple(word for segment in _break(document).segments for word in segment.words)
        assert [word.highlight for word in survived] == [word.highlight for word in words]

    def test_the_text_is_the_words_joined(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(30)))
        document = _document(_segment(words))
        for segment in _break(document).segments:
            assert segment.text == " ".join(word.text for word in segment.words)


class TestWhatACueInherits:
    def test_the_layer_travels_with_the_cue(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(30)))
        document = _document(_segment(words, layer_id="primary"))
        assert {segment.layer_id for segment in _break(document).segments} == {"primary"}

    def test_the_position_travels_with_the_cue(self) -> None:
        position = CaptionPosition(anchor="bottom-centre", y=-0.2)  # type: ignore[arg-type]
        words = _words(" ".join(f"word{i}" for i in range(30)))
        document = _document(_segment(words, position=position))
        assert all(segment.position == position for segment in _break(document).segments)

    def test_style_overrides_travel_with_the_cue(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(30)))
        document = _document(_segment(words, style_overrides={"colour": "#ff0000"}))
        assert all(
            segment.style_overrides == {"colour": "#ff0000"}
            for segment in _break(document).segments
        )

    def test_confidence_travels_with_the_cue(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(30)))
        document = _document(_segment(words, confidence=0.4))
        assert all(segment.confidence == 0.4 for segment in _break(document).segments)


class TestACueStream:
    """The whole point: what the viewer actually sees, end to end."""

    def test_cues_are_in_time_order(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(45)))
        document = _document(_segment(words))
        times = [(segment.start_ms, segment.end_ms) for segment in _break(document).segments]
        assert times == sorted(times)

    def test_cues_never_overlap(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(45)))
        document = _document(_segment(words))
        broken = _break(document)
        for earlier, later in zip(broken.segments, broken.segments[1:], strict=False):
            assert earlier.end_ms <= later.start_ms

    def test_the_stream_covers_the_same_span(self) -> None:
        words = _words(" ".join(f"word{i}" for i in range(45)))
        document = _document(_segment(words))
        broken = _break(document)
        assert broken.segments[0].start_ms == words[0].start_ms
        assert broken.segments[-1].end_ms >= words[-1].end_ms

    def test_a_realistic_paragraph_breaks_into_readable_cues(self) -> None:
        text = (
            "So we drove out to the coast, and the whole way there the radio "
            "kept cutting out. By the time we arrived it was nearly dark, and "
            "the tide was the highest I had ever seen it."
        )
        words = _words(text, step=320, hold=280)
        document = _document(_segment(words))
        broken = _break(document)
        assert validate_caption_document(broken) == ""
        assert len(broken.segments) > 1
        for segment in broken.segments:
            assert len(segment.text) <= DEFAULT_MAX_CHARS
            assert segment.duration_ms <= DEFAULT_MAX_DURATION_MS
            assert segment.reading_rate() <= CAPTION_MAX_CPS

    def test_breaking_twice_changes_nothing(self) -> None:
        text = "We went to the market. We bought a great deal of fruit for the festival."
        words = _words(text, step=320, hold=280)
        document = _document(_segment(words))
        once = _break(document)
        assert _break(once).segments == once.segments

    def test_several_segments_are_broken_independently(self) -> None:
        first = _segment(_words("one two three four five six seven eight nine ten eleven"))
        second = _segment(
            _words(
                "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda",
                start=first.end_ms + 500,
            )
        )
        document = _document(first, second)
        broken = _break(document)
        assert broken.segments[0].words[0].text == "one"
        assert broken.segments[-1].words[-1].text == "lambda"
        assert validate_caption_document(broken) == ""

    def test_a_locked_cue_sits_beside_broken_ones(self) -> None:
        locked = _segment(_words("leave this line exactly as it is"), locked=True)
        free = _segment(_words(" ".join(f"word{i}" for i in range(30)), start=20_000))
        document = _document(locked, free)
        broken = _break(document)
        assert broken.segments[0] == locked
        assert validate_caption_document(broken) == ""
