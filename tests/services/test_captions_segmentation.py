"""The cue breaker (`services/captions/segmentation.py`).

Captions are the difference between a transcript and something a person can
actually watch, and the difference is entirely this file: how long a cue stays
up, how fast it may be read, and where it ends. These tests pin the rules and
the one promise that matters most — **no word is ever dropped**. A viewer is
reading this text; losing half a sentence to a tidy-looking break is worse than
a long line.
"""

from __future__ import annotations

import pytest

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.asr import Transcript, TranscriptSegment, TranscriptWord
from nova_studio.domain.captions import CAPTION_MAX_CPS
from nova_studio.services.captions.segmentation import (
    DEFAULT_CUE_RULES,
    CueRules,
    build_cues,
)

pytestmark = pytest.mark.unit


def _words(
    text: str,
    *,
    start_ms: int = 0,
    word_ms: int = 400,
    gap_ms: int = 80,
    speaker: str | None = None,
) -> tuple[TranscriptWord, ...]:
    words: list[TranscriptWord] = []
    at = start_ms
    for token in text.split():
        words.append(TranscriptWord(text=token, start_ms=at, end_ms=at + word_ms, speaker=speaker))
        at += word_ms + gap_ms
    return tuple(words)


def _transcript(
    *texts: str,
    word_ms: int = 400,
    gap_ms: int = 80,
    speaker: str | None = None,
    untimed: bool = False,
) -> Transcript:
    segments: list[TranscriptSegment] = []
    at = 0
    for index, text in enumerate(texts):
        words = () if untimed else _words(text, start_ms=at, word_ms=word_ms, gap_ms=gap_ms)
        end = (words[-1].end_ms if words else at + len(text.split()) * (word_ms + gap_ms)) + 200
        segments.append(
            TranscriptSegment(
                index=index,
                start_ms=at,
                end_ms=end,
                text=text,
                words=words,
                speaker=speaker,
            )
        )
        at = end + 500
    return Transcript(segments=tuple(segments))


class TestTheRules:
    def test_the_defaults_are_the_broadcast_convention(self) -> None:
        assert (DEFAULT_CUE_RULES.max_lines, DEFAULT_CUE_RULES.max_chars_per_line) == (2, 42)

    def test_a_cue_may_hold_two_lines_worth(self) -> None:
        assert DEFAULT_CUE_RULES.max_chars == 84

    def test_the_reading_rate_ceiling_is_the_domains(self) -> None:
        # Broadcast convention is quoted as 21; the domain refuses a cue above
        # CAPTION_MAX_CPS, and a breaker that may build a cue the document
        # validator rejects is a breaker with a bug.
        assert DEFAULT_CUE_RULES.max_reading_rate_cps == float(CAPTION_MAX_CPS)

    def test_zero_characters_a_line_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            CueRules(max_chars_per_line=0)

    def test_no_lines_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            CueRules(max_lines=0)

    def test_a_zero_length_cue_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            CueRules(max_duration_ms=0)

    def test_a_non_positive_reading_rate_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            CueRules(max_reading_rate_cps=0.0)

    def test_a_negative_silence_break_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            CueRules(silence_break_ms=-1)

    def test_a_negative_minimum_is_a_bug(self) -> None:
        with pytest.raises(NovaInvariantError):
            CueRules(min_duration_ms=-1)


class TestBreaking:
    def test_a_short_utterance_is_one_cue(self) -> None:
        assert len(build_cues(_transcript("hello there friends"))) == 1

    def test_the_cue_keeps_the_text(self) -> None:
        assert build_cues(_transcript("hello there friends"))[0].text == "hello there friends"

    def test_the_cue_starts_with_its_first_word(self) -> None:
        assert build_cues(_transcript("hello there"))[0].start_ms == 0

    def test_the_cue_ends_with_its_last_word(self) -> None:
        # Long enough to read at the cap, so nothing is added to the end.
        cues = build_cues(_transcript("hello there friends"))
        assert cues[0].end_ms == 1_360

    def test_a_long_utterance_is_broken(self) -> None:
        text = " ".join(f"word{i}" for i in range(40))
        assert len(build_cues(_transcript(text))) > 1

    def test_no_cue_exceeds_the_character_budget(self) -> None:
        text = " ".join(f"word{i}" for i in range(60))
        rules = CueRules(max_chars_per_line=20, max_lines=2)
        assert all(len(cue.text) <= rules.max_chars for cue in build_cues(_transcript(text), rules))

    def test_no_cue_exceeds_the_duration_cap(self) -> None:
        rules = CueRules(max_duration_ms=2_000)
        cues = build_cues(_transcript(" ".join(f"word{i}" for i in range(30))), rules)
        assert all(cue.duration_ms <= 2_400 for cue in cues)

    def test_no_cue_exceeds_the_reading_rate(self) -> None:
        """The cap that catches a fast speaker in a short-looking cue.

        Cues with no room are skipped: when the next line starts before this
        one could be read, the only choices are to overlap or to keep the
        timing the speaker gave, and this pass never overlaps.
        """
        rules = CueRules(max_reading_rate_cps=10.0)
        cues = build_cues(_transcript(" ".join(f"word{i}" for i in range(30))), rules)
        for cue, following in zip(cues, (*cues[1:], None), strict=True):
            if following is not None and cue.end_ms >= following.start_ms:
                continue
            assert len(cue.text) / (cue.duration_ms / 1000) <= 10.0

    def test_a_cue_with_no_room_keeps_the_timing_the_speaker_gave(self) -> None:
        """You cannot read a word slower than it was said."""
        words = _words("supercalifragilistic wonderful", word_ms=200, gap_ms=0)
        transcript = Transcript(
            segments=(TranscriptSegment(start_ms=0, end_ms=1_000, words=words),)
        )
        rules = CueRules(max_reading_rate_cps=5.0, min_duration_ms=0)
        assert build_cues(transcript, rules)[0].duration_ms == 200

    def test_no_word_is_ever_dropped(self) -> None:
        text = " ".join(f"word{i}" for i in range(55))
        cues = build_cues(_transcript(text))
        assert " ".join(cue.text for cue in cues) == text

    def test_words_keep_their_timings(self) -> None:
        cues = build_cues(_transcript("hello there friends"))
        assert [word.text for word in cues[0].words] == ["hello", "there", "friends"]

    def test_every_word_is_timed(self) -> None:
        """Karaoke needs word timings on every cue, not just some."""
        cues = build_cues(_transcript("hello there friends"))
        assert cues[0].has_word_timings is True

    def test_every_word_carries_character_timings(self) -> None:
        cues = build_cues(_transcript("hello there"))
        assert cues[0].has_char_timings is True

    def test_a_word_longer_than_a_cue_gets_one_of_its_own(self) -> None:
        """Never truncate: a long word is a cue, not half a word."""
        long_word = "x" * 100
        cues = build_cues(_transcript(f"a {long_word} b"))
        assert any(cue.text == long_word for cue in cues)

    def test_cues_are_indexed_in_order(self) -> None:
        text = " ".join(f"word{i}" for i in range(40))
        assert [cue.index for cue in build_cues(_transcript(text))] == list(
            range(len(build_cues(_transcript(text))))
        )

    def test_cues_never_overlap(self) -> None:
        text = " ".join(f"word{i}" for i in range(40))
        cues = build_cues(_transcript(text))
        assert all(cues[i].end_ms <= cues[i + 1].start_ms for i in range(len(cues) - 1))


class TestSilenceAndPunctuation:
    def test_a_long_gap_ends_the_cue(self) -> None:
        words = (
            TranscriptWord(text="one", start_ms=0, end_ms=400),
            TranscriptWord(text="two", start_ms=5_000, end_ms=5_400),
        )
        transcript = Transcript(
            segments=(TranscriptSegment(start_ms=0, end_ms=6_000, words=words),)
        )
        assert len(build_cues(transcript)) == 2

    def test_a_short_gap_does_not(self) -> None:
        words = (
            TranscriptWord(text="one", start_ms=0, end_ms=400),
            TranscriptWord(text="two", start_ms=500, end_ms=900),
        )
        transcript = Transcript(
            segments=(TranscriptSegment(start_ms=0, end_ms=1_200, words=words),)
        )
        assert len(build_cues(transcript)) == 1

    def test_the_gap_threshold_is_a_rule(self) -> None:
        words = (
            TranscriptWord(text="one", start_ms=0, end_ms=400),
            TranscriptWord(text="two", start_ms=1_000, end_ms=1_400),
        )
        transcript = Transcript(
            segments=(TranscriptSegment(start_ms=0, end_ms=2_000, words=words),)
        )
        assert len(build_cues(transcript, CueRules(silence_break_ms=500))) == 2

    def test_a_cue_ends_on_a_full_stop(self) -> None:
        words = _words("first part ends. second part follows", word_ms=300)
        transcript = Transcript(
            segments=(TranscriptSegment(start_ms=0, end_ms=words[-1].end_ms + 200, words=words),)
        )
        assert build_cues(transcript)[0].text.endswith("ends.")

    def test_punctuation_breaking_can_be_turned_off(self) -> None:
        words = _words("first part ends. second part follows", word_ms=300)
        transcript = Transcript(
            segments=(TranscriptSegment(start_ms=0, end_ms=words[-1].end_ms + 200, words=words),)
        )
        cues = build_cues(transcript, CueRules(punctuation_break=False))
        assert len(cues) == 1

    def test_a_cue_is_not_ended_on_punctuation_before_it_can_be_read(self) -> None:
        """Otherwise a burst of short sentences strobes."""
        # Two short sentences spoken in 600 ms: slow enough to be read, but far
        # under the minimum on-screen time, so punctuation must not close it.
        words = _words("a. b.", word_ms=300, gap_ms=0)
        transcript = Transcript(
            segments=(TranscriptSegment(start_ms=0, end_ms=1_000, words=words),)
        )
        assert len(build_cues(transcript, CueRules(min_duration_ms=2_000))) == 1

    def test_the_same_words_do_end_on_punctuation_once_they_can_be_read(self) -> None:
        """The guard is the minimum, not a refusal to break on punctuation."""
        words = _words("a. b.", word_ms=300, gap_ms=0)
        transcript = Transcript(
            segments=(TranscriptSegment(start_ms=0, end_ms=1_000, words=words),)
        )
        assert len(build_cues(transcript, CueRules(min_duration_ms=300))) == 2


class TestTheMinimumOnScreenTime:
    def test_a_brief_cue_is_held_longer(self) -> None:
        words = _words("hi", word_ms=100, gap_ms=0)
        transcript = Transcript(
            segments=(TranscriptSegment(start_ms=0, end_ms=1_000, words=words),)
        )
        assert build_cues(transcript)[0].duration_ms == DEFAULT_CUE_RULES.min_duration_ms

    def test_holding_never_overlaps_the_next_cue(self) -> None:
        """A caption outliving the next line is a caption on top of it."""
        words = (
            TranscriptWord(text="one", start_ms=0, end_ms=100),
            TranscriptWord(text="two", start_ms=5_000, end_ms=5_100),
        )
        transcript = Transcript(
            segments=(TranscriptSegment(start_ms=0, end_ms=6_000, words=words),)
        )
        cues = build_cues(transcript)
        assert cues[0].end_ms <= cues[1].start_ms

    def test_the_minimum_is_a_rule(self) -> None:
        words = _words("hi", word_ms=100, gap_ms=0)
        transcript = Transcript(
            segments=(TranscriptSegment(start_ms=0, end_ms=1_000, words=words),)
        )
        assert build_cues(transcript, CueRules(min_duration_ms=2_000))[0].duration_ms == 2_000

    def test_a_minimum_of_zero_leaves_short_cues_alone(self) -> None:
        words = _words("hi", word_ms=100, gap_ms=0)
        transcript = Transcript(
            segments=(TranscriptSegment(start_ms=0, end_ms=1_000, words=words),)
        )
        assert build_cues(transcript, CueRules(min_duration_ms=0))[0].duration_ms == 100


class TestWithoutWordTimings:
    def test_a_provider_with_no_word_timings_still_gets_cues(self) -> None:
        cues = build_cues(_transcript("hello there friends", untimed=True))
        assert len(cues) == 1

    def test_the_words_are_spread_across_the_segment(self) -> None:
        cues = build_cues(_transcript("hello there friends", untimed=True))
        assert [word.text for word in cues[0].words] == ["hello", "there", "friends"]

    def test_the_derived_timings_stay_inside_the_segment(self) -> None:
        cues = build_cues(_transcript("hello there friends", untimed=True))
        assert cues[0].words[-1].end_ms <= cues[0].end_ms

    def test_the_derived_timings_are_ordered(self) -> None:
        cues = build_cues(_transcript("hello there friends", untimed=True))
        assert [word.start_ms for word in cues[0].words] == sorted(
            word.start_ms for word in cues[0].words
        )

    def test_a_longer_word_is_held_longer(self) -> None:
        """The split is weighted by length, not even."""
        cues = build_cues(_transcript("a supercalifragilistic b", untimed=True))
        spans = {word.text: word.duration_ms for word in cues[0].words}
        assert spans["supercalifragilistic"] > spans["a"]

    def test_the_derived_characters_are_marked_estimated(self) -> None:
        cues = build_cues(_transcript("hello there", untimed=True))
        assert cues[0].words[0].chars[0].estimated is True


class TestSegmentsAndSpeakers:
    def test_each_transcript_segment_ends_a_cue(self) -> None:
        cues = build_cues(_transcript("first bit here", "second bit here"))
        assert len(cues) == 2

    def test_cues_do_not_run_past_their_segment(self) -> None:
        cues = build_cues(_transcript("first bit here", "second bit here"))
        assert cues[0].end_ms <= cues[1].start_ms

    def test_a_speaker_is_carried_to_the_cue(self) -> None:
        cues = build_cues(_transcript("hello there", speaker="Alice"))
        assert cues[0].speaker == "Alice"

    def test_a_word_speaker_wins_over_the_segments(self) -> None:
        words = _words("hello there", speaker="Bob")
        transcript = Transcript(
            segments=(TranscriptSegment(start_ms=0, end_ms=1_200, words=words, speaker="Alice"),)
        )
        assert build_cues(transcript)[0].speaker == "Bob"

    def test_a_speaker_change_ends_the_cue(self) -> None:
        """Two people in one caption leaves the reader to work out who."""
        words = (
            TranscriptWord(text="hello", start_ms=0, end_ms=400, speaker="A"),
            TranscriptWord(text="there", start_ms=480, end_ms=880, speaker="B"),
        )
        transcript = Transcript(
            segments=(TranscriptSegment(start_ms=0, end_ms=1_000, words=words),)
        )
        cues = build_cues(transcript)
        assert [cue.text for cue in cues] == ["hello", "there"]
        assert [cue.speaker for cue in cues] == ["A", "B"]

    def test_two_speakers_in_one_cue_is_nobody(self) -> None:
        """With speaker_break off — the look that labels speakers in one line."""
        words = (
            TranscriptWord(text="hello", start_ms=0, end_ms=400, speaker="A"),
            TranscriptWord(text="there", start_ms=480, end_ms=880, speaker="B"),
        )
        transcript = Transcript(
            segments=(TranscriptSegment(start_ms=0, end_ms=1_000, words=words),)
        )
        assert build_cues(transcript, CueRules(speaker_break=False))[0].speaker is None

    def test_speaker_breaking_can_be_turned_off(self) -> None:
        words = (
            TranscriptWord(text="hello", start_ms=0, end_ms=400, speaker="A"),
            TranscriptWord(text="there", start_ms=480, end_ms=880, speaker="B"),
        )
        transcript = Transcript(
            segments=(TranscriptSegment(start_ms=0, end_ms=1_000, words=words),)
        )
        assert len(build_cues(transcript, CueRules(speaker_break=False))) == 1

    def test_confidence_is_the_worst_word_in_the_cue(self) -> None:
        words = (
            TranscriptWord(text="hello", start_ms=0, end_ms=400, confidence=0.9),
            TranscriptWord(text="there", start_ms=480, end_ms=880, confidence=0.4),
        )
        transcript = Transcript(
            segments=(TranscriptSegment(start_ms=0, end_ms=1_000, words=words),)
        )
        assert build_cues(transcript)[0].confidence == 0.4

    def test_an_empty_transcript_builds_nothing(self) -> None:
        assert build_cues(Transcript()) == ()

    def test_a_segment_with_no_text_builds_nothing(self) -> None:
        transcript = Transcript(segments=(TranscriptSegment(start_ms=0, end_ms=500),))
        assert build_cues(transcript) == ()


class TestSegmentInvariants:
    def test_a_built_cue_satisfies_the_domain(self) -> None:
        """The domain refuses a cue whose words are not in its text."""
        cues = build_cues(_transcript("hello there friends"))
        assert cues[0].words and cues[0].text

    def test_a_built_cue_survives_a_round_trip(self) -> None:
        from nova_studio.domain.captions import CaptionSegment

        cues = build_cues(_transcript("hello there friends"))
        assert CaptionSegment.from_wire(cues[0].to_wire()) == cues[0]

    def test_a_long_cue_set_survives_a_round_trip(self) -> None:
        from nova_studio.domain.captions import CaptionSegment

        text = " ".join(f"word{i}" for i in range(40))
        for cue in build_cues(_transcript(text)):
            assert CaptionSegment.from_wire(cue.to_wire()) == cue
