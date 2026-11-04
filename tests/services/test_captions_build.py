"""Where a transcript becomes a document (`services/captions/build.py`).

The invariant under test is ADR-0009 §1 and §4 together: **no provider object
crosses this line, and no transcript is believed before it is checked**. A
caption track that is subtly wrong for the length of a film is the failure this
function exists to prevent, so the tests are mostly about the ways a transcript
can be constructed and still be unusable.

How the words are broken is not tested here — that is
`test_captions_segmentation.py`, and the builder deliberately shares it. What is
tested is what the builder *adds*: validation, layers, language, sequential
indices, and a document that is showable the moment it exists.
"""

from __future__ import annotations

import pytest

from nova_studio.core.errors import ErrorDomain
from nova_studio.core.result import Err
from nova_studio.domain.asr import Transcript, TranscriptSegment, TranscriptWord
from nova_studio.domain.captions import (
    CaptionLayer,
    CaptionLayerKind,
    validate_caption_document,
)
from nova_studio.ports.asr import AsrErrorCode
from nova_studio.services.captions.build import (
    document_from_transcript,
    segments_from_transcript,
)
from nova_studio.services.captions.segmentation import CueRules

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

    def test_a_refusal_names_the_code_the_port_owns(self) -> None:
        # 4001–4006 are the speech-recognition band; the builder is where a
        # provider's failure is turned into a caption-shaped answer.
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
            _segment(0, 1_000, _word("one", 400, 700), _word("two", 100, 300), index=0)
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
    def test_indices_are_sequential(self) -> None:
        assert [segment.index for segment in _built(_speech()).segments] == [0, 1]

    def test_the_document_validates(self) -> None:
        assert validate_caption_document(_built(_speech())) == ""

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

    def test_a_document_has_no_history_yet(self) -> None:
        # Revisions are recorded by whoever runs the generation (ADR-0009 §7),
        # not by the builder: a function that invents history is untestable.
        assert _built(_speech()).revisions == ()

    def test_a_document_carries_no_edits_yet(self) -> None:
        assert _built(_speech()).edits == ()

    def test_the_rules_can_be_chosen(self) -> None:
        rules = CueRules(max_chars_per_line=12, max_lines=1)
        document = _built(_speech(), rules=rules)
        assert all(len(segment.text) <= 12 for segment in document.segments)


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

    def test_a_layer_wins_over_a_layer_id(self) -> None:
        layer = CaptionLayer(layer_id="es", name="Spanish", language="es")
        document = _built(_speech(), layer=layer, layer_id="commentary")
        assert {segment.layer_id for segment in document.segments} == {"es"}


class TestBuildingCuesAlone:
    """A translation pass needs cues, not a document it must take apart."""

    def test_segments_can_be_built_without_a_document(self) -> None:
        cues = segments_from_transcript(_speech())
        assert len(cues) == 2
        assert cues[0].text == "Hello there"

    def test_cues_can_be_filed_under_another_layer(self) -> None:
        cues = segments_from_transcript(_speech(), layer_id="es")
        assert all(cue.layer_id == "es" for cue in cues)

    def test_cues_can_be_broken_to_other_rules(self) -> None:
        cues = segments_from_transcript(
            _speech(), rules=CueRules(max_chars_per_line=6, max_lines=1)
        )
        assert all(len(cue.text) <= 6 for cue in cues)
        assert len(cues) > 2
