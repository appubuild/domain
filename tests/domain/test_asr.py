"""The ASR vocabulary: transcripts, regions, options, models.

Everything here is testable with no model weights, no network and no GPU —
which is exactly the property ADR-0009 buys by making the pipeline after
``Transcribe`` pure.  The behaviours pinned are the ones that decide whether a
caption appears at the right moment:

* **Time is integer milliseconds**, so nothing drifts and nothing needs a
  timebase it does not have; conversion to frames is explicit and rounded.
* **Validation is a sentence, not a mystery.**  A transcript with words out of
  order, a segment with no duration, or timings past the end of the audio must
  be *reported* — silently broken captions are the failure this exists to
  prevent.
* **The alignment pass runs with VAD off**, and the options object is the only
  way to get it, so the rule cannot be forgotten at a call site.
* **VAD gaps merge up to a quarter second**, because a model that sees one word
  at a time hallucinates and clips.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.core import Timebase
from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.asr import (
    ASR_SAMPLE_RATE,
    AsrCapability,
    AsrModelRef,
    SpeechRegion,
    Transcript,
    TranscriptionOptions,
    TranscriptSegment,
    TranscriptWord,
    frames_for_ms,
    is_language_tag,
    merge_regions,
    validate_transcript,
)

if TYPE_CHECKING:
    from collections.abc import Mapping

pytestmark = pytest.mark.unit


def _word(text: str, start_ms: int, end_ms: int, **overrides: Any) -> TranscriptWord:
    return TranscriptWord(**{"text": text, "start_ms": start_ms, "end_ms": end_ms, **overrides})


def _segment(index: int, start_ms: int, end_ms: int, **overrides: Any) -> TranscriptSegment:
    return TranscriptSegment(
        **{"index": index, "start_ms": start_ms, "end_ms": end_ms, **overrides}
    )


def _transcript(**overrides: Any) -> Transcript:
    defaults: dict[str, Any] = {
        "segments": (
            _segment(
                0,
                0,
                1_000,
                text="hello world",
                words=(_word("hello", 0, 500), _word("world", 500, 1_000)),
            ),
            _segment(
                1,
                1_200,
                2_400,
                text="second line",
                words=(_word("second", 1_200, 1_800), _word("line", 1_800, 2_400)),
            ),
        ),
        "language": "en",
        "model": "base",
        "audio_duration_ms": 3_000,
    }
    return Transcript(**{**defaults, **overrides})


def _round_trip(wire: Mapping[str, Any]) -> Mapping[str, Any]:
    return json.loads(json.dumps(wire))


class TestLanguageTags:
    @pytest.mark.parametrize(
        ("value", "valid"),
        [
            ("en", True),
            ("bn-BD", True),
            ("zh-Hans", True),
            ("EN", False),
            ("english", False),
            ("", False),
        ],
    )
    def test_bcp47_shape(self, value: str, valid: bool) -> None:
        assert is_language_tag(value) is valid


class TestTranscriptWord:
    def test_duration_and_confidence(self) -> None:
        word = _word("hello", 500, 900, confidence=0.75)
        assert word.duration_ms == 400
        assert word.confidence == 0.75

    @pytest.mark.parametrize(
        ("overrides", "fragment"),
        [
            ({"text": ""}, "must carry text"),
            ({"start_ms": -1}, "non-negative and ordered"),
            ({"start_ms": 900, "end_ms": 500}, "non-negative and ordered"),
            ({"confidence": 1.5}, "between 0.0 and 1.0"),
        ],
    )
    def test_invariants_are_checked(self, overrides: dict[str, Any], fragment: str) -> None:
        with pytest.raises(NovaInvariantError, match=fragment):
            _word(**{"text": "hello", "start_ms": 0, "end_ms": 500, **overrides})

    def test_the_wire_form_survives_a_json_boundary(self) -> None:
        word = _word("hello", 0, 500, confidence=0.5, speaker="A")
        assert TranscriptWord.from_wire(_round_trip(word.to_wire())) == word

    def test_a_corrupt_word_is_rejected(self) -> None:
        with pytest.raises(NovaInvariantError, match="speaker must be a string"):
            TranscriptWord.from_wire(dict(_word("hi", 0, 100).to_wire()) | {"speaker": 1})


class TestTranscriptSegment:
    def test_text_is_derived_from_words_when_missing(self) -> None:
        segment = _segment(0, 0, 900, words=(_word("a", 0, 300), _word("b", 300, 900)))
        assert segment.text_or_derived == "a b"
        assert segment.word_count == 2

    def test_a_word_may_not_escape_its_segment(self) -> None:
        """A caption appearing before its line begins is this bug, caught early."""
        with pytest.raises(NovaInvariantError, match="falls outside its segment"):
            _segment(0, 500, 1_000, words=(_word("early", 0, 200),))

    def test_clamping_trims_the_tail_to_the_audio(self) -> None:
        segment = _segment(0, 900, 1_200, words=(_word("tail", 900, 1_200),))
        clamped = segment.clamp_to(1_000)
        assert clamped.end_ms == 1_000
        assert clamped.words[0].end_ms == 1_000

    def test_clamping_a_segment_that_starts_later_than_the_audio(self) -> None:
        segment = _segment(0, 2_000, 2_500)
        clamped = segment.clamp_to(1_000)
        assert clamped.start_ms == 1_000 and clamped.end_ms == 1_000

    @pytest.mark.parametrize(
        ("overrides", "fragment"),
        [
            ({"start_ms": -1}, "non-negative and ordered"),
            ({"index": -1}, "must not be negative"),
            ({"confidence": -0.1}, "between 0.0 and 1.0"),
        ],
    )
    def test_invariants_are_checked(self, overrides: dict[str, Any], fragment: str) -> None:
        with pytest.raises(NovaInvariantError, match=fragment):
            _segment(**{"index": 0, "start_ms": 0, "end_ms": 500, **overrides})

    def test_the_wire_form_survives_a_json_boundary(self) -> None:
        segment = _segment(1, 0, 900, text="a b", words=(_word("a", 0, 300),), speaker="A")
        assert TranscriptSegment.from_wire(_round_trip(segment.to_wire())) == segment


class TestTranscript:
    def test_duration_is_the_longer_of_content_and_audio(self) -> None:
        assert _transcript().duration_ms == 3_000
        assert _transcript(audio_duration_ms=0).duration_ms == 2_400

    def test_word_count_and_text(self) -> None:
        transcript = _transcript()
        assert transcript.word_count == 4
        assert transcript.text() == "hello world\nsecond line"

    def test_speakers_are_listed_in_first_appearance_order(self) -> None:
        transcript = _transcript(
            segments=(
                _segment(0, 0, 500, text="hi", speaker="A"),
                _segment(1, 600, 900, text="hey", speaker="B"),
                _segment(2, 1_000, 1_400, text="yes", speaker="A"),
            )
        )
        assert transcript.speakers() == ("A", "B")

    def test_a_speaker_may_be_recorded_on_a_word_alone(self) -> None:
        transcript = _transcript(
            segments=(_segment(0, 0, 600, words=(_word("hi", 0, 300, speaker="B"),)),)
        )
        assert transcript.speakers() == ("B",)

    def test_has_word_timings_requires_every_segment(self) -> None:
        assert _transcript().has_word_timings
        mixed = _transcript(
            segments=(_segment(0, 0, 500, words=(_word("a", 0, 500),)), _segment(1, 600, 900))
        )
        assert not mixed.has_word_timings

    def test_segments_must_be_sequential_and_ordered(self) -> None:
        with pytest.raises(NovaInvariantError, match="sequential from 0"):
            Transcript(segments=(_segment(1, 0, 500),))
        with pytest.raises(NovaInvariantError, match="starts at 100 before"):
            Transcript(segments=(_segment(0, 0, 500), _segment(1, 100, 900)))

    def test_an_empty_transcript_is_a_valid_answer(self) -> None:
        """A silent clip has no speech; that is a result, not a failure."""
        assert Transcript().is_empty
        assert Transcript().word_count == 0

    def test_the_wire_form_survives_a_json_boundary(self) -> None:
        transcript = _transcript(translated_from="bn")
        assert Transcript.from_wire(_round_trip(transcript.to_wire())) == transcript

    def test_a_corrupt_transcript_is_rejected(self) -> None:
        with pytest.raises(NovaInvariantError, match="not a BCP-47"):
            Transcript(language="ENGLISH")
        with pytest.raises(NovaInvariantError, match="segments must be a list"):
            Transcript.from_wire(dict(_transcript().to_wire()) | {"segments": {}})


class TestTranscriptionOptions:
    def test_the_alignment_pass_runs_without_vad(self) -> None:
        """ADR-0009 §4: VAD desynchronises the token↔time mapping."""
        options = TranscriptionOptions.alignment(language="en")
        assert options.vad_filter is False
        assert options.word_timestamps is True

    def test_plain_transcription_has_no_word_timings(self) -> None:
        assert TranscriptionOptions.plain().word_timestamps is False

    def test_the_default_pass_keeps_vad_on(self) -> None:
        assert TranscriptionOptions().vad_filter is True

    @pytest.mark.parametrize(
        ("overrides", "fragment"),
        [
            ({"task": "summarise"}, "must be 'transcribe' or 'translate'"),
            ({"beam_size": 0}, "at least 1"),
            ({"temperature": 1.5}, "between 0.0 and 1.0"),
            ({"language": "ENGLISH"}, "not a BCP-47"),
        ],
    )
    def test_invariants_are_checked(self, overrides: dict[str, Any], fragment: str) -> None:
        with pytest.raises(NovaInvariantError, match=fragment):
            TranscriptionOptions(**overrides)


class TestAsrModelRef:
    def test_a_model_without_a_path_is_not_downloaded(self) -> None:
        assert not AsrModelRef(name="base").is_downloaded
        assert AsrModelRef(name="base", path="/data/models/base").is_downloaded

    def test_the_label_is_what_the_ui_shows(self) -> None:
        assert AsrModelRef(name="large-v3", quantisation="int8").label == "large-v3.int8"

    def test_invariants_are_checked(self) -> None:
        with pytest.raises(NovaInvariantError, match="must carry a name"):
            AsrModelRef(name="")
        with pytest.raises(NovaInvariantError, match="must not be negative"):
            AsrModelRef(name="base", size_bytes=-1)


class TestSpeechRegions:
    def test_a_region_knows_its_duration(self) -> None:
        assert SpeechRegion(start_ms=1_000, end_ms=1_500).duration_ms == 500

    def test_short_gaps_are_closed(self) -> None:
        regions = (
            SpeechRegion(0, 1_000),
            SpeechRegion(1_100, 2_000),
        )
        assert [region.end_ms for region in merge_regions(regions)] == [2_000]

    def test_real_pauses_are_kept(self) -> None:
        regions = (SpeechRegion(0, 1_000), SpeechRegion(3_000, 4_000))
        assert len(merge_regions(regions, max_gap_ms=250)) == 2

    def test_unordered_input_is_sorted(self) -> None:
        regions = (SpeechRegion(3_000, 4_000), SpeechRegion(0, 1_000))
        merged = merge_regions(regions)
        assert [region.start_ms for region in merged] == [0, 3_000]

    def test_overlapping_regions_are_fused(self) -> None:
        merged = merge_regions((SpeechRegion(0, 1_000), SpeechRegion(800, 1_500)))
        assert len(merged) == 1 and merged[0].end_ms == 1_500

    def test_merging_keeps_the_lower_confidence(self) -> None:
        merged = merge_regions(
            (SpeechRegion(0, 1_000, confidence=0.9), SpeechRegion(1_050, 2_000, confidence=0.5))
        )
        assert merged[0].confidence == 0.5

    def test_nothing_to_merge(self) -> None:
        assert merge_regions(()) == ()

    def test_the_wire_form_survives_a_json_boundary(self) -> None:
        region = SpeechRegion(0, 500, confidence=0.8)
        assert SpeechRegion.from_wire(_round_trip(region.to_wire())) == region


class TestValidateTranscript:
    def test_a_sound_transcript_has_nothing_to_report(self) -> None:
        assert validate_transcript(_transcript()) == ""

    def test_an_empty_transcript_is_reported(self) -> None:
        assert validate_transcript(Transcript()) == "the transcript contains no segments"

    def test_a_zero_duration_segment_is_reported(self) -> None:
        transcript = _transcript(segments=(_segment(0, 500, 500),))
        assert validate_transcript(transcript) == "segment 0 has zero duration"

    def test_words_out_of_order_inside_a_segment_are_reported(self) -> None:
        """Constructed directly: the invariant here is the pipeline's, not the
        dataclass's, because a provider can produce this shape."""
        segment = _segment(0, 0, 2_000)
        bad = replace_words(segment, (_word("b", 1_000, 1_500), _word("a", 0, 500)))
        transcript = Transcript(segments=(bad,), language="en")
        assert validate_transcript(transcript) == (
            "segment 0 has a word that starts before the previous ends"
        )

    def test_mixed_word_timings_are_reported(self) -> None:
        transcript = _transcript(
            segments=(
                _segment(0, 0, 500, words=(_word("a", 0, 500),)),
                _segment(1, 600, 900),
            )
        )
        assert validate_transcript(transcript) == (
            "some segments carry word timings and others do not"
        )

    def test_timings_past_the_end_of_the_audio_are_reported(self) -> None:
        transcript = _transcript(audio_duration_ms=1_000)
        assert validate_transcript(transcript) == (
            "the transcript extends past the end of the audio"
        )

    def test_clamping_fixes_the_overrun(self) -> None:
        transcript = _transcript(audio_duration_ms=1_000).clamped(1_000)
        assert validate_transcript(transcript) == ""


def replace_words(
    segment: TranscriptSegment, words: tuple[TranscriptWord, ...]
) -> TranscriptSegment:
    """Swap the words of a segment without re-running its invariants.

    A test helper for producing the shapes a careless provider *can* emit, so
    that :func:`validate_transcript` can be shown to catch them.
    """
    # Deliberate: bypassing a checked invariant to produce a provider-shaped bug.
    object.__setattr__(segment, "words", words)
    return segment


class TestFramesForMs:
    def test_a_caption_boundary_rounds_down(self) -> None:
        """A cut includes the frame it starts on."""
        assert frames_for_ms(50, Timebase.of(30)) == 1  # 1.5 frames → 1

    def test_display_rounding_can_be_asked_for(self) -> None:
        from nova_studio.core import Rounding

        assert frames_for_ms(50, Timebase.of(30), Rounding.NEAREST_EVEN) == 2

    def test_negative_time_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="must not be negative"):
            frames_for_ms(-1, Timebase.of(30))

    def test_the_contracted_rate_is_sixteen_kilohertz(self) -> None:
        """ADR-0009 §4: we resample, so token↔time mapping is ours to control."""
        assert ASR_SAMPLE_RATE == 16_000


class TestCapabilities:
    def test_capabilities_are_stable_strings(self) -> None:
        assert AsrCapability.WORD_TIMESTAMPS == "word_timestamps"
        assert AsrCapability.DIARISATION == "diarisation"
        assert len(set(AsrCapability)) == 6
