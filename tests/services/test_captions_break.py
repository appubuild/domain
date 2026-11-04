"""The Break stage (`services/captions/cues.py`).

The invariant under test is the one a viewer feels and cannot name: **an edit
that asks for a re-break gets one, and takes nothing else with it**. The rule
itself — which words go together, how long they stay up — is pinned in
`test_captions_segmentation.py`; this file pins what the *stage* adds:

* a locked cue is passed through untouched, because locking is a promise;
* the word objects survive, so karaoke, confidence and highlight flags do too;
* the layer, position, style and speaker travel to the new cues;
* and the document that comes out still passes the domain's own validation.
"""

from __future__ import annotations

import pytest

from nova_studio.core.result import Err
from nova_studio.domain.captions import (
    CAPTION_MAX_CPS,
    CaptionAnchor,
    CaptionDocument,
    CaptionLayer,
    CaptionLayerKind,
    CaptionPosition,
    CaptionSegment,
    CaptionWord,
    validate_caption_document,
)
from nova_studio.services.captions.cues import DEFAULT_BREAK_RULES, CueBreaker
from nova_studio.services.captions.pipeline import StageContext
from nova_studio.services.captions.segmentation import CueRules

pytestmark = pytest.mark.unit


# -- helpers -----------------------------------------------------------------


def _words(
    text: str,
    *,
    step: int = 480,
    hold: int = 400,
    start: int = 0,
    speaker: str | None = None,
    with_chars: bool = True,
) -> tuple[CaptionWord, ...]:
    """A run of words spoken at an even pace, comfortably readable."""
    words: list[CaptionWord] = []
    at = start
    for token in text.split():
        words.append(CaptionWord.of(token, at, at + hold, speaker=speaker, with_chars=with_chars))
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
    from dataclasses import replace

    return CaptionDocument(
        segments=tuple(replace(segment, index=i) for i, segment in enumerate(segments)),
        **over,  # type: ignore[arg-type]
    )


def _break(document: CaptionDocument, breaker: CueBreaker | None = None) -> CaptionDocument:
    result = (breaker or CueBreaker()).apply(document, StageContext())
    assert not isinstance(result, Err), result.error()
    return result.unwrap()


#: A paragraph long enough to need breaking, spoken at a readable pace.
PARAGRAPH = (
    "So we drove out to the coast and the whole way there the radio kept "
    "cutting out. By the time we arrived it was nearly dark and the tide was "
    "the highest I had ever seen it in my life."
)


class TestTheStageItself:
    def test_the_stage_calls_itself_break(self) -> None:
        assert CueBreaker().name == "break"

    def test_a_project_can_name_its_own_breaker(self) -> None:
        assert CueBreaker(name="shorts-break").name == "shorts-break"

    def test_a_breaker_starts_on_the_house_rules(self) -> None:
        assert CueBreaker().rules == DEFAULT_BREAK_RULES

    def test_a_breaker_can_carry_other_rules(self) -> None:
        rules = CueRules(max_chars_per_line=20, max_lines=1)
        assert CueBreaker(rules=rules).rules is rules

    def test_an_empty_document_breaks_into_an_empty_document(self) -> None:
        assert _break(CaptionDocument()).is_empty

    def test_a_twenty_character_line_makes_more_cues_than_a_broadcast_one(self) -> None:
        document = _document(_segment(_words(PARAGRAPH)))
        wide = _break(document)
        narrow = _break(document, CueBreaker(rules=CueRules(max_chars_per_line=20)))
        assert len(narrow.segments) > len(wide.segments)


class TestWhatTheStageRefusesToTouch:
    """ADR-0009 §7: the user's corrections outlive every regeneration."""

    def test_a_locked_cue_is_passed_through_untouched(self) -> None:
        locked = _segment(_words("we went to the market and bought fruit"), locked=True)
        assert _break(_document(locked)).segments[0] == locked

    def test_a_locked_cue_keeps_its_index(self) -> None:
        locked = _segment(_words("short and safe"), locked=True)
        free = _segment(_words(PARAGRAPH, start=10_000))
        broken = _break(_document(locked, free))
        assert broken.segments[0] == locked
        assert broken.segments[0].index == 0

    def test_a_cue_without_word_timings_is_passed_through_untouched(self) -> None:
        untimed = _segment((), text="no word timings here", end_ms=2_000)
        assert _break(_document(untimed)).segments[0] == untimed

    def test_wordless_text_is_not_re_wrapped(self) -> None:
        untimed = _segment((), text="what the provider said", end_ms=2_000)
        assert _break(_document(untimed)).segments[0].text == "what the provider said"

    def test_new_cues_are_never_locked(self) -> None:
        document = _document(_segment(_words(PARAGRAPH)))
        assert not any(segment.locked for segment in _break(document).segments)


class TestTheWordsThemselves:
    """Karaoke needs the words, not just the text."""

    def test_every_word_survives(self) -> None:
        words = _words(PARAGRAPH)
        document = _document(_segment(words))
        assert _break(document).word_count == len(words)

    def test_words_stay_in_order(self) -> None:
        words = _words(PARAGRAPH)
        document = _document(_segment(words))
        survived = tuple(word for segment in _break(document).segments for word in segment.words)
        assert survived == words

    def test_word_objects_are_carried_not_rebuilt(self) -> None:
        words = _words(PARAGRAPH)
        document = _document(_segment(words))
        survived = tuple(word for segment in _break(document).segments for word in segment.words)
        assert all(kept is original for kept, original in zip(survived, words, strict=False))

    def test_character_timings_survive(self) -> None:
        words = _words(PARAGRAPH)
        document = _document(_segment(words))
        survived = tuple(word for segment in _break(document).segments for word in segment.words)
        assert all(word.has_char_timings for word in survived)

    def test_highlighted_words_stay_highlighted(self) -> None:
        words = tuple(
            CaptionWord.of(
                token, index * 480, index * 480 + 400, highlight=index == 3, with_chars=False
            )
            for index, token in enumerate(PARAGRAPH.split())
        )
        document = _document(_segment(words))
        survived = tuple(word for segment in _break(document).segments for word in segment.words)
        assert [word.highlight for word in survived] == [word.highlight for word in words]

    def test_the_text_is_the_words_joined(self) -> None:
        document = _document(_segment(_words(PARAGRAPH)))
        for segment in _break(document).segments:
            assert segment.text == " ".join(word.text for word in segment.words)


class TestWhatACueInherits:
    def test_the_layer_travels_with_the_cue(self) -> None:
        document = _document(_segment(_words(PARAGRAPH), layer_id="primary"))
        assert {segment.layer_id for segment in _break(document).segments} == {"primary"}

    def test_the_position_travels_with_the_cue(self) -> None:
        position = CaptionPosition(anchor=CaptionAnchor.BOTTOM_CENTER, y=-0.2)
        document = _document(_segment(_words(PARAGRAPH), position=position))
        assert all(segment.position == position for segment in _break(document).segments)

    def test_style_overrides_travel_with_the_cue(self) -> None:
        document = _document(_segment(_words(PARAGRAPH), style_overrides={"colour": "#ff0000"}))
        assert all(
            segment.style_overrides == {"colour": "#ff0000"}
            for segment in _break(document).segments
        )

    def test_a_speaker_named_by_the_words_travels(self) -> None:
        document = _document(_segment(_words(PARAGRAPH, speaker="Alice")))
        assert {segment.speaker for segment in _break(document).segments} == {"Alice"}

    def test_a_speaker_named_only_by_the_cue_is_kept(self) -> None:
        # Words with no speaker of their own: the cue's name is all there is.
        document = _document(_segment(_words(PARAGRAPH), speaker="narrator"))
        assert {segment.speaker for segment in _break(document).segments} == {"narrator"}

    def test_a_speaker_change_splits_the_cue(self) -> None:
        first = _words("hello there my friend", speaker="A")
        second = _words("and then I said", start=10_000, speaker="B")
        document = _document(_segment(first + second))
        broken = _break(document)
        assert {segment.speaker for segment in broken.segments} == {"A", "B"}

    def test_confidence_is_the_worst_word_in_the_cue(self) -> None:
        words = tuple(
            CaptionWord.of(
                token,
                index * 480,
                index * 480 + 400,
                confidence=0.4 if index == 2 else 0.95,
                with_chars=False,
            )
            for index, token in enumerate(PARAGRAPH.split())
        )
        document = _document(_segment(words, confidence=1.0))
        broken = _break(document)
        assert any(segment.confidence == 0.4 for segment in broken.segments)


class TestTheDocumentThatComesOut:
    def test_indices_are_sequential(self) -> None:
        document = _document(_segment(_words(PARAGRAPH)))
        broken = _break(document)
        assert [segment.index for segment in broken.segments] == list(range(len(broken.segments)))

    def test_the_language_survives(self) -> None:
        document = _document(_segment(_words(PARAGRAPH)), language="en")
        assert _break(document).language == "en"

    def test_the_layers_survive(self) -> None:
        document = _document(_segment(_words(PARAGRAPH)))
        assert _break(document).layers == document.layers

    def test_the_edit_overlay_survives(self) -> None:
        from nova_studio.domain.captions import CaptionDelta, CaptionDeltaKind

        edit = CaptionDelta(key="0:0:hello", kind=CaptionDeltaKind.TEXT, after="Hello")
        document = _document(_segment(_words(PARAGRAPH)), edits=(edit,))
        assert _break(document).edits == (edit,)

    def test_cues_never_overlap(self) -> None:
        document = _document(_segment(_words(PARAGRAPH)))
        broken = _break(document)
        for earlier, later in zip(broken.segments, broken.segments[1:], strict=False):
            assert earlier.end_ms <= later.start_ms

    def test_the_stream_covers_the_same_span(self) -> None:
        words = _words(PARAGRAPH)
        document = _document(_segment(words))
        broken = _break(document)
        assert broken.segments[0].start_ms == words[0].start_ms
        assert broken.segments[-1].end_ms >= words[-1].end_ms

    def test_a_broken_document_validates(self) -> None:
        document = _document(_segment(_words(PARAGRAPH)))
        broken = _break(document)
        assert validate_caption_document(broken) == "", validate_caption_document(broken)

    def test_no_cue_is_read_faster_than_the_ceiling(self) -> None:
        document = _document(_segment(_words(PARAGRAPH)))
        for segment in _break(document).segments:
            assert segment.reading_rate() <= CAPTION_MAX_CPS

    def test_breaking_twice_changes_nothing(self) -> None:
        document = _document(_segment(_words(PARAGRAPH)))
        once = _break(document)
        assert _break(once).segments == once.segments

    def test_several_cues_are_broken_independently(self) -> None:
        first = _segment(_words("one two three four five six seven eight nine ten eleven"))
        second = _segment(_words(PARAGRAPH, start=60_000))
        broken = _break(_document(first, second))
        assert broken.segments[0].words[0].text == "one"
        assert broken.segments[-1].words[-1].text == "life."
        assert validate_caption_document(broken) == ""

    def test_a_locked_cue_sits_beside_broken_ones(self) -> None:
        locked = _segment(_words("leave this line exactly as it is"), locked=True)
        free = _segment(_words(PARAGRAPH, start=60_000))
        broken = _break(_document(locked, free))
        assert broken.segments[0] == locked
        assert validate_caption_document(broken) == ""

    def test_a_translation_layer_is_broken_on_its_own_layer(self) -> None:
        layer = CaptionLayer(
            layer_id="es", name="Spanish", language="es", kind=CaptionLayerKind.TRANSLATION
        )
        cues = _segment(_words(PARAGRAPH), layer_id="es")
        document = _document(cues, layers=(layer,))
        broken = _break(document)
        assert {segment.layer_id for segment in broken.segments} == {"es"}
