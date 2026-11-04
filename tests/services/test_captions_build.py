"""Where a transcript becomes a caption document (`services/captions/build.py`).

The invariant under test is ADR-0009 §1 and §4 together: **no provider object
crosses this line, and no transcript is believed before it is checked**. A
caption track that is subtly wrong for the length of a film is the failure this
function exists to prevent, so the tests are mostly about the ways a transcript
can be constructed and still be unusable.
"""

from __future__ import annotations

import pytest

from nova_studio.core.errors import ErrorDomain
from nova_studio.core.result import Err
from nova_studio.domain.asr import Transcript, TranscriptSegment, TranscriptWord
from nova_studio.domain.captions import (
    CAPTION_MIN_DURATION_MS,
    CaptionLayer,
    CaptionLayerKind,
    validate_caption_document,
)
from nova_studio.ports.asr import AsrErrorCode
from nova_studio.services.captions.build import (
    document_from_transcript,
    segments_from_transcript,
)

pytestmark = pytest.mark.unit


# -- helpers -----------------------------------------------------------------


def _word(
    text: str,
    start_ms: int,
    end_ms: int,
    *,
    confidence: float = 1.0,
    speaker: str | None = None,
) -> TranscriptWord:
    return TranscriptWord(text, start_ms, end_ms, confidence=confidence, speaker=speaker)


def _segment(
    start_ms: int,
    end_ms: int,
    *words: TranscriptWord,
    index: int = 0,
    text: str = "",
    speaker: str | None = None,
    confidence: float = 1.0,
) -> TranscriptSegment:
    return TranscriptSegment(
        start_ms,
        end_ms,
        index=index,
        text=text or " ".join(word.text for word in words),
        words=words,
        speaker=speaker,
        confidence=confidence,
    )


def _transcript(*segments: TranscriptSegment, **over: object) -> Transcript:
    return Transcript(segments=segments, **over)  # type: ignore[arg-type]


def _speech() -> Transcript:
    """Two cues of ordinary speech, with word timings."""
    return _transcript(
        _segment(
            0,
            1_200,
            _word("Hello", 0, 500, confidence=0.9),
            _word("there", 600, 1_200),
            index=0,
        ),
        _segment(
            1_500,
            2_400,
            _word("how", 1_500, 1_800),
            _word("are", 1_800, 2_000),
            _word("you", 2_000, 2_400),
            index=1,
        ),
        language="en",
        audio_duration_ms=10_000,
    )


def _built(transcript: Transcript, **over: object):
    result = document_from_transcript(transcript, **over)  # type: ignore[arg-type]
    assert not isinstance(result, Err), result.error()
    return result.unwrap()


class TestBelievingATranscript:
    """ADR-0009 §4: a transcript that cannot be trusted is reported, not used."""

    def test_a_sound_transcript_becomes_a_document(self) -> None:
        document = _built(_speech())
        assert document.segment_count == 2
        assert document.text == "Hello there\nhow are you"

    def test_an_empty_transcript_is_refused(self) -> None:
        result = document_from_transcript(Transcript())
        assert isinstance(result, Err)
        assert result.error() is not None
        assert "no segments" in result.error().message

    def test_a_refused_transcript_says_which_code(self) -> None:
        result = document_from_transcript(Transcript())
        assert isinstance(result, Err)
        error = result.error()
        assert error is not None
        assert error.code == AsrErrorCode.ALIGNMENT_FAILED
        assert error.domain is ErrorDomain.CAPTION

    def test_a_refusal_is_retryable(self) -> None:
        # A different model or a trimmed clip may well work; a deterministically
        # broken document would not be.
        result = document_from_transcript(Transcript())
        assert isinstance(result, Err)
        error = result.error()
        assert error is not None and error.retryable

    def test_a_refusal_tells_the_user_what_to_do(self) -> None:
        result = document_from_transcript(Transcript())
        assert isinstance(result, Err)
        error = result.error()
        assert error is not None and error.remedy

    def test_a_zero_duration_segment_is_refused(self) -> None:
        flat = _transcript(_segment(500, 500, _word("hi", 500, 500), index=0))
        result = document_from_transcript(flat)
        assert isinstance(result, Err)
        assert "zero duration" in (result.error().message if result.error() else "")

    def test_words_out_of_order_are_refused(self) -> None:
        backwards = _transcript(
            _segment(
                0,
                1_000,
                _word("one", 400, 700),
                _word("two", 100, 300),
                index=0,
            )
        )
        result = document_from_transcript(backwards)
        assert isinstance(result, Err)
        assert "before the previous ends" in (result.error().message if result.error() else "")

    def test_a_transcript_past_the_end_of_the_audio_is_refused(self) -> None:
        long = _transcript(
            _segment(0, 9_000, _word("hello", 0, 500), index=0), audio_duration_ms=2_000
        )
        result = document_from_transcript(long)
        assert isinstance(result, Err)
        assert "past the end" in (result.error().message if result.error() else "")

    def test_a_transcript_that_cannot_be_checked_is_still_usable(self) -> None:
        # No audio duration: the builder cannot compare, so it does not claim to.
        unknown = _transcript(_segment(0, 800, _word("hello", 0, 500), index=0))
        assert _built(unknown).segment_count == 1

    def test_the_refusal_carries_the_language(self) -> None:
        result = document_from_transcript(Transcript(language="bn"))
        assert isinstance(result, Err)
        error = result.error()
        assert error is not None and error.details["language"] == "bn"


class TestTheDocumentItBuilds:
    def test_the_cues_keep_the_transcript_times(self) -> None:
        document = _built(_speech())
        assert [(s.start_ms, s.end_ms) for s in document.segments] == [(0, 1_200), (1_500, 2_400)]

    def test_the_cues_keep_the_transcript_text(self) -> None:
        document = _built(_speech())
        assert document.segments[0].text == "Hello there"

    def test_a_segment_without_words_keeps_its_text(self) -> None:
        untimed = _transcript(_segment(0, 1_500, index=0, text="no word timings here"))
        document = _built(untimed)
        assert document.segments[0].text == "no word timings here"
        assert document.segments[0].words == ()

    def test_indices_are_sequential(self) -> None:
        document = _built(_speech())
        assert [segment.index for segment in document.segments] == [0, 1]

    def test_the_document_validates(self) -> None:
        document = _built(_speech())
        assert validate_caption_document(document) == ""

    def test_the_language_comes_from_the_transcript(self) -> None:
        assert _built(_speech()).language == "en"

    def test_a_translated_transcript_names_the_source_language(self) -> None:
        translated = _transcript(
            _segment(0, 800, _word("hola", 0, 500), index=0),
            language="es",
            translated_from="en",
        )
        assert _built(translated).language == "es"

    def test_a_languageless_transcript_falls_back_to_its_source(self) -> None:
        translated = _transcript(
            _segment(0, 800, _word("hola", 0, 500), index=0), language="", translated_from="en"
        )
        assert _built(translated).language == "en"


class TestLayers:
    def test_cues_land_on_the_primary_layer_by_default(self) -> None:
        document = _built(_speech())
        assert {segment.layer_id for segment in document.segments} == {"primary"}

    def test_the_document_defines_the_layer_its_cues_use(self) -> None:
        document = _built(_speech())
        assert [layer.layer_id for layer in document.layers] == ["primary"]

    def test_a_translation_can_be_built_onto_its_own_layer(self) -> None:
        layer = CaptionLayer(
            layer_id="es", name="Spanish", language="es", kind=CaptionLayerKind.TRANSLATION
        )
        document = _built(_speech(), layer=layer)
        assert {segment.layer_id for segment in document.segments} == {"es"}
        assert document.layers[0].kind is CaptionLayerKind.TRANSLATION

    def test_a_layer_id_can_be_chosen_without_building_a_layer(self) -> None:
        document = _built(_speech(), layer_id="commentary")
        assert {segment.layer_id for segment in document.segments} == {"commentary"}
        assert document.layers[0].layer_id == "commentary"


class TestTheWords:
    def test_every_word_survives(self) -> None:
        assert _built(_speech()).word_count == 5

    def test_a_word_keeps_its_timing(self) -> None:
        document = _built(_speech())
        first = document.segments[0].words[0]
        assert (first.start_ms, first.end_ms) == (0, 500)

    def test_a_word_keeps_its_confidence(self) -> None:
        document = _built(_speech())
        assert document.segments[0].words[0].confidence == 0.9

    def test_a_word_keeps_its_speaker(self) -> None:
        named = _transcript(_segment(0, 800, _word("hello", 0, 400, speaker="A"), index=0))
        assert _built(named).segments[0].words[0].speaker == "A"

    def test_a_speaker_named_only_by_the_segment_still_counts(self) -> None:
        named = _transcript(_segment(0, 800, _word("hello", 0, 400), index=0, speaker="A"))
        assert _built(named).segments[0].speaker == "A"

    def test_two_speakers_in_one_segment_are_not_flattened(self) -> None:
        mixed = _transcript(
            _segment(
                0,
                1_200,
                _word("hello", 0, 400, speaker="A"),
                _word("there", 600, 1_000, speaker="B"),
                index=0,
            )
        )
        assert _built(mixed).segments[0].speaker is None

    def test_character_timings_are_derived_when_the_provider_has_none(self) -> None:
        document = _built(_speech())
        assert document.segments[0].words[0].has_char_timings

    def test_derived_characters_say_they_are_estimated(self) -> None:
        document = _built(_speech())
        assert not document.segments[0].words[0].has_measured_char_timings

    def test_derived_characters_stay_inside_their_word(self) -> None:
        document = _built(_speech())
        for word in (word for segment in document.segments for word in segment.words):
            for char in word.chars:
                assert word.start_ms <= char.start_ms
                assert char.end_ms <= word.end_ms

    def test_character_timings_can_be_turned_off(self) -> None:
        document = _built(_speech(), with_chars=False)
        assert all(not word.has_char_timings for word in document.segments[0].words)

    def test_a_blank_word_is_dropped_rather_than_shown(self) -> None:
        gappy = _transcript(
            _segment(0, 900, _word("  ", 0, 100), _word("hello", 200, 600), index=0)
        )
        document = _built(gappy)
        assert tuple(word.text for word in document.segments[0].words) == ("hello",)

    def test_a_word_with_leading_space_is_trimmed(self) -> None:
        padded = _transcript(_segment(0, 900, _word(" hello", 0, 600), index=0))
        assert _built(padded).segments[0].words[0].text == "hello"

    def test_overlapping_words_are_refused_before_they_reach_a_cue(self) -> None:
        # Validated upstream, so no stage has to guess which word yields.
        overlapping = _transcript(
            _segment(0, 900, _word("one", 0, 500), _word("two", 400, 900), index=0)
        )
        assert isinstance(document_from_transcript(overlapping), Err)


class TestTheMinimumDuration:
    """A transcript is full of fragments nobody can read."""

    def test_a_fragment_is_held_longer(self) -> None:
        brief = _transcript(_segment(0, 200, _word("hi", 0, 200), index=0))
        assert _built(brief).segments[0].duration_ms >= CAPTION_MIN_DURATION_MS

    def test_holding_never_runs_into_the_next_cue(self) -> None:
        brief = _transcript(
            _segment(0, 200, _word("hi", 0, 200), index=0),
            _segment(300, 1_200, _word("there", 300, 1_200), index=1),
        )
        first, second = _built(brief).segments
        assert first.end_ms <= second.start_ms

    def test_the_last_cue_may_run_past_the_audio_it_came_from(self) -> None:
        brief = _transcript(_segment(0, 200, _word("hi", 0, 200), index=0))
        assert _built(brief).segments[0].end_ms > 200

    def test_holding_can_be_turned_off(self) -> None:
        brief = _transcript(_segment(0, 200, _word("hi", 0, 200), index=0))
        assert _built(brief, min_duration_ms=0).segments[0].end_ms == 200

    def test_a_cue_held_to_nothing_still_last_a_millisecond(self) -> None:
        # Two cues squeezed against each other, with holding switched off.
        brief = _transcript(
            _segment(0, 100, _word("hi", 0, 100), index=0),
            _segment(100, 200, _word("so", 100, 200), index=1),
        )
        document = _built(brief, min_duration_ms=0)
        assert [segment.duration_ms for segment in document.segments] == [100, 100]


class TestBuildingCuesAlone:
    """A translation pass needs cues, not a document it must take apart."""

    def test_segments_can_be_built_without_a_document(self) -> None:
        cues = segments_from_transcript(_speech())
        assert len(cues) == 2
        assert cues[0].text == "Hello there"

    def test_cues_can_be_filed_under_another_layer(self) -> None:
        cues = segments_from_transcript(_speech(), layer_id="es")
        assert all(cue.layer_id == "es" for cue in cues)
