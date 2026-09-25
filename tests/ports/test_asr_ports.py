"""The ASR port contract, driven by providers that need no model weights.

The doubles here are the deterministic side of ADR-0009's central promise: the
pipeline after ``Transcribe`` is pure, so it is verifiable on a machine with no
network, no GPU and no weights.  A ``ManualProvider`` — the typed transcript —
is not just a test double; it is also one of the real implementations the ADR
names, which is why it appears here as a first-class fake.

The rules pinned are the ones that decide whether captions are right:

* **16 kHz mono float32 is enforced, not assumed.**  Anything else is
  ``NS-CAPTION-4001`` rather than a silent resample that drifts.
* **The alignment pass runs with VAD off**, and the provider can prove it saw
  those options.
* **A broken alignment is reported, not returned** — empty word lists and
  timestamps past the end of the audio become ``NS-CAPTION-4004`` with the
  sentence the domain validator wrote.
* **A missing model is a state with a remedy**, not a crash.
* **Providers declare their capabilities** instead of offering menu items that
  do nothing.

Conformance, narrowness and the ``runtime_checkable`` limitation are pinned as in
the sibling port suites; purity is checked by parsing the port's imports, which
is what enforces ADR-0009 §1's "no other module may import ``faster_whisper``".
"""

from __future__ import annotations

import pathlib
from typing import TYPE_CHECKING, Any

import numpy as np
import pytest

from nova_studio.core import ErrorDomain, error_result, ok
from nova_studio.domain.asr import (
    ASR_SAMPLE_RATE,
    AsrCapability,
    AsrModelRef,
    SpeechRegion,
    Transcript,
    TranscriptionOptions,
    TranscriptSegment,
    TranscriptWord,
    validate_transcript,
)
from nova_studio.domain.media import AudioBuffer
from nova_studio.ports.asr import (
    AsrErrorCode,
    ModelResolver,
    SpeakerDiariser,
    TranscriptionProvider,
    Translator,
    VoiceActivityDetector,
    WordAligner,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

pytestmark = pytest.mark.unit


def _audio(seconds: float = 1.0, *, rate: int = ASR_SAMPLE_RATE, channels: int = 1) -> AudioBuffer:
    frames = max(0, int(seconds * rate))
    samples = np.zeros((frames, channels), dtype=np.float32)
    return AudioBuffer(samples=samples, sample_rate=rate)


def _word(text: str, start_ms: int, end_ms: int) -> TranscriptWord:
    return TranscriptWord(text=text, start_ms=start_ms, end_ms=end_ms)


def _transcript_with_text_only() -> Transcript:
    return Transcript(
        segments=(
            TranscriptSegment(index=0, start_ms=0, end_ms=1_000, text="hello world"),
            TranscriptSegment(index=1, start_ms=1_200, end_ms=2_000, text="second line"),
        ),
        language="en",
        model="manual",
        audio_duration_ms=2_000,
    )


class ManualProvider:
    """The typed transcript: deterministic, offline, and a real implementation."""

    def __init__(self, transcript: Transcript | None = None) -> None:
        self._transcript = transcript or _transcript_with_text_only()
        self.calls: list[TranscriptionOptions] = []
        self.audio_seen: list[tuple[int, int]] = []

    def transcribe(self, audio: AudioBuffer, options: TranscriptionOptions) -> Any:
        self.audio_seen.append((audio.sample_rate, audio.channels))
        self.calls.append(options)
        if audio.sample_rate != ASR_SAMPLE_RATE or audio.channels != 1:
            return error_result(
                AsrErrorCode.AUDIO_UNUSABLE,
                f"expected {ASR_SAMPLE_RATE} Hz mono, got {audio.sample_rate} Hz "
                f"x {audio.channels}",
                domain=ErrorDomain.CAPTION,
                remedy="Resample to 16 kHz mono before calling a provider.",
            )
        if audio.is_empty:
            return error_result(
                AsrErrorCode.AUDIO_UNUSABLE,
                "the audio is empty",
                domain=ErrorDomain.CAPTION,
            )
        return ok(self._transcript)

    def supports(self, capability: AsrCapability) -> bool:
        """A typed transcript has words only if the typist entered timings."""
        return capability in (AsrCapability.OFFLINE,)


class FakeAligner:
    """Places the words it is given, and refuses to return a broken result."""

    def __init__(self, *, options_seen: list[TranscriptionOptions] | None = None) -> None:
        self._options_seen = options_seen if options_seen is not None else []

    def align(self, transcript: Transcript, audio: AudioBuffer) -> Any:
        if audio.sample_rate != ASR_SAMPLE_RATE:
            return error_result(
                AsrErrorCode.AUDIO_UNUSABLE,
                "alignment needs 16 kHz audio",
                domain=ErrorDomain.CAPTION,
            )
        words: list[TranscriptWord] = []
        segments: list[TranscriptSegment] = []
        for segment in transcript.segments:
            tokens = segment.text_or_derived.split()
            if not tokens:
                continue
            span = segment.duration_ms
            step = span // len(tokens)
            placed = tuple(
                _word(token, segment.start_ms + index * step, segment.start_ms + (index + 1) * step)
                for index, token in enumerate(tokens)
            )
            words.extend(placed)
            segments.append(
                TranscriptSegment(
                    index=len(segments),
                    start_ms=segment.start_ms,
                    end_ms=segment.end_ms,
                    text=segment.text_or_derived,
                    words=placed,
                )
            )
        aligned = Transcript(
            segments=tuple(segments),
            language=transcript.language,
            model=transcript.model,
            audio_duration_ms=transcript.audio_duration_ms or int(audio.duration_seconds * 1000),
        )
        problem = validate_transcript(aligned)
        if problem:
            return error_result(AsrErrorCode.ALIGNMENT_FAILED, problem, domain=ErrorDomain.CAPTION)
        return ok(aligned)


class FakeDiariser:
    def __init__(self, speakers: Sequence[str] = ("A", "B")) -> None:
        self._speakers = tuple(speakers)

    def diarise(self, audio: AudioBuffer, transcript: Transcript) -> Any:
        if transcript.is_empty:
            return error_result(
                AsrErrorCode.DIARISATION_FAILED,
                "there is no speech to attribute",
                domain=ErrorDomain.CAPTION,
            )
        labelled = tuple(
            TranscriptSegment(
                index=segment.index,
                start_ms=segment.start_ms,
                end_ms=segment.end_ms,
                text=segment.text,
                words=segment.words,
                speaker=self._speakers[segment.index % len(self._speakers)],
            )
            for segment in transcript.segments
        )
        return ok(
            Transcript(
                segments=labelled,
                language=transcript.language,
                model=transcript.model,
                audio_duration_ms=transcript.audio_duration_ms,
            )
        )


class FakeTranslator:
    def __init__(self, *, supported: Sequence[str] = ("bn", "es", "fr")) -> None:
        self._supported = frozenset(supported)

    def translate(self, transcript: Transcript, target_language: str) -> Any:
        if target_language not in self._supported:
            return error_result(
                AsrErrorCode.UNSUPPORTED_LANGUAGE,
                f"{target_language} is not supported by this provider",
                domain=ErrorDomain.CAPTION,
                remedy="Choose one of: " + ", ".join(sorted(self._supported)),
            )
        translated = tuple(
            TranscriptSegment(
                index=segment.index,
                start_ms=segment.start_ms,
                end_ms=segment.end_ms,
                text=f"[{target_language}] {segment.text_or_derived}",
                words=segment.words,
                speaker=segment.speaker,
            )
            for segment in transcript.segments
        )
        return ok(
            Transcript(
                segments=translated,
                language=target_language,
                model=transcript.model,
                audio_duration_ms=transcript.audio_duration_ms,
                translated_from=transcript.language,
            )
        )


class FakeVad:
    def __init__(self, regions: Sequence[SpeechRegion] = (SpeechRegion(0, 1_000),)) -> None:
        self._regions = tuple(regions)

    def detect(self, audio: AudioBuffer) -> Any:
        if audio.is_empty:
            return ok(())
        return ok(self._regions)


class FakeModelResolver:
    """Models on a machine that has downloaded exactly one of them."""

    def __init__(self, *, offline: bool = False) -> None:
        self._models = {
            "base": AsrModelRef(name="base", path="/data/models/base", size_bytes=145_000_000)
        }
        self._offline = offline
        self.removed: list[str] = []

    def resolve(self, name: str) -> Any:
        if name in self._models:
            return ok(self._models[name])
        if self._offline:
            return error_result(
                AsrErrorCode.MODEL_UNAVAILABLE,
                f"{name} is not installed and this machine is offline",
                domain=ErrorDomain.CAPTION,
                remedy=f"Connect to the internet to download {name}.",
            )
        downloaded = AsrModelRef(name=name, path=f"/data/models/{name}")
        self._models[name] = downloaded
        return ok(downloaded)

    def installed(self) -> tuple[AsrModelRef, ...]:
        return tuple(self._models.values())

    def remove(self, ref: AsrModelRef) -> Any:
        self._models.pop(ref.name, None)
        self.removed.append(ref.name)
        return ok(None)


class TestProtocolConformance:
    def test_each_double_satisfies_its_port(self) -> None:
        assert isinstance(ManualProvider(), TranscriptionProvider)
        assert isinstance(FakeAligner(), WordAligner)
        assert isinstance(FakeDiariser(), SpeakerDiariser)
        assert isinstance(FakeTranslator(), Translator)
        assert isinstance(FakeVad(), VoiceActivityDetector)
        assert isinstance(FakeModelResolver(), ModelResolver)

    def test_subclass_checks_work_because_every_member_is_a_method(self) -> None:
        assert issubclass(ManualProvider, TranscriptionProvider)
        assert issubclass(FakeModelResolver, ModelResolver)


class TestNarrowness:
    def test_a_provider_is_not_an_aligner(self) -> None:
        provider = ManualProvider()
        assert isinstance(provider, TranscriptionProvider)
        assert not isinstance(provider, WordAligner)

    def test_a_translator_is_not_a_diariser(self) -> None:
        translator = FakeTranslator()
        assert isinstance(translator, Translator)
        assert not isinstance(translator, SpeakerDiariser)

    def test_a_partial_double_is_refused(self) -> None:
        class OnlySupports:
            def supports(self, capability: AsrCapability) -> bool:
                return False

        assert not isinstance(OnlySupports(), TranscriptionProvider)


class TestRuntimeCheckableLimitations:
    def test_a_double_with_the_right_names_and_wrong_behaviour_passes(self) -> None:
        class WrongProvider:
            def transcribe(self, audio: AudioBuffer, options: TranscriptionOptions) -> Transcript:
                return Transcript()

            def supports(self, capability: AsrCapability) -> bool:
                return True

        assert isinstance(WrongProvider(), TranscriptionProvider)

    def test_the_mistake_surfaces_at_the_call_not_at_the_check(self) -> None:
        class WrongProvider:
            def transcribe(self, audio: AudioBuffer, options: TranscriptionOptions) -> Transcript:
                return Transcript()

            def supports(self, capability: AsrCapability) -> bool:
                return True

        result = WrongProvider().transcribe(_audio(), TranscriptionOptions())
        assert not hasattr(result, "is_ok"), "a bare value has no Result protocol"


class TestErrorCodes:
    def test_codes_are_stable_strings(self) -> None:
        assert AsrErrorCode.AUDIO_UNUSABLE == "NS-CAPTION-4001"
        assert AsrErrorCode.MODEL_UNAVAILABLE == "NS-CAPTION-4002"
        assert AsrErrorCode.TRANSCRIBE_FAILED == "NS-CAPTION-4003"
        assert AsrErrorCode.ALIGNMENT_FAILED == "NS-CAPTION-4004"
        assert AsrErrorCode.UNSUPPORTED_LANGUAGE == "NS-CAPTION-4005"
        assert AsrErrorCode.DIARISATION_FAILED == "NS-CAPTION-4006"

    def test_codes_are_unique_and_namespaced(self) -> None:
        values = [code.value for code in AsrErrorCode]
        assert len(values) == len(set(values))
        assert all(value.startswith("NS-CAPTION-") for value in values)

    def test_a_missing_model_error_carries_the_remedy(self) -> None:
        failure = error_result(
            AsrErrorCode.MODEL_UNAVAILABLE,
            "base is not installed and this machine is offline",
            domain=ErrorDomain.CAPTION,
            details={"model": "base", "size_bytes": 145_000_000},
            remedy="Connect to the internet to download base.",
        )
        error = failure.unwrap_err()
        assert error.code == "NS-CAPTION-4002"
        assert error.domain is ErrorDomain.CAPTION
        assert error.remedy


class TestTheContractedAudio:
    def test_sixteen_kilohertz_mono_is_accepted(self) -> None:
        result = ManualProvider().transcribe(_audio(), TranscriptionOptions())
        assert result.is_ok()

    @pytest.mark.parametrize(("rate", "channels"), [(48_000, 1), (16_000, 2), (44_100, 2)])
    def test_anything_else_is_refused_rather_than_silently_resampled(
        self, rate: int, channels: int
    ) -> None:
        result = ManualProvider().transcribe(
            _audio(rate=rate, channels=channels), TranscriptionOptions()
        )
        error = result.unwrap_err()
        assert error.code == AsrErrorCode.AUDIO_UNUSABLE
        assert "Resample to 16 kHz mono" in (error.remedy or "")

    def test_empty_audio_is_refused(self) -> None:
        result = ManualProvider().transcribe(_audio(0.0), TranscriptionOptions())
        assert result.unwrap_err().message == "the audio is empty"


class TestTheDeclaredFlow:
    def test_a_provider_returns_a_normalised_transcript(self) -> None:
        transcript = ManualProvider().transcribe(_audio(2.0), TranscriptionOptions()).unwrap()
        assert transcript.text() == "hello world\nsecond line"
        assert transcript.language == "en"

    def test_a_provider_declares_its_capabilities(self) -> None:
        """An imported transcript has no word timings; the UI must be told."""
        provider = ManualProvider()
        assert provider.supports(AsrCapability.OFFLINE)
        assert not provider.supports(AsrCapability.WORD_TIMESTAMPS)

    def test_alignment_adds_word_timings_without_rerecognising_text(self) -> None:
        provider = ManualProvider()
        transcript = provider.transcribe(_audio(2.0), TranscriptionOptions()).unwrap()
        aligned = FakeAligner().align(transcript, _audio(2.0)).unwrap()
        assert aligned.text() == transcript.text()
        assert aligned.has_word_timings
        assert aligned.word_count == 4

    def test_the_alignment_pass_sees_vad_disabled(self) -> None:
        """ADR-0009 §4: VAD desynchronises the token↔time mapping."""
        provider = ManualProvider()
        options = TranscriptionOptions.alignment(language="en")
        provider.transcribe(_audio(2.0), options)
        assert provider.calls[-1].vad_filter is False
        assert provider.calls[-1].word_timestamps is True

    def test_a_broken_alignment_is_reported_not_returned(self) -> None:
        """Timings past the end of the audio would captions that outlive the clip."""
        transcript = Transcript(
            segments=(TranscriptSegment(index=0, start_ms=0, end_ms=500, text="hello"),),
            language="en",
            audio_duration_ms=100,
        )
        result = FakeAligner().align(transcript, _audio(0.1))
        assert result.unwrap_err().code == AsrErrorCode.ALIGNMENT_FAILED

    def test_diarisation_labels_segments(self) -> None:
        transcript = FakeAligner().align(_transcript_with_text_only(), _audio(2.0)).unwrap()
        labelled = FakeDiariser().diarise(_audio(2.0), transcript).unwrap()
        assert labelled.speakers() == ("A", "B")

    def test_diarising_silence_is_reported(self) -> None:
        result = FakeDiariser().diarise(_audio(1.0), Transcript())
        assert result.unwrap_err().code == AsrErrorCode.DIARISATION_FAILED

    def test_translation_keeps_the_timing_and_records_its_origin(self) -> None:
        transcript = _transcript_with_text_only()
        translated = FakeTranslator().translate(transcript, "bn").unwrap()
        assert [segment.start_ms for segment in translated.segments] == [
            segment.start_ms for segment in transcript.segments
        ]
        assert translated.translated_from == "en"
        assert translated.language == "bn"

    def test_an_unsupported_language_is_refused_with_alternatives(self) -> None:
        result = FakeTranslator().translate(_transcript_with_text_only(), "xx")
        error = result.unwrap_err()
        assert error.code == AsrErrorCode.UNSUPPORTED_LANGUAGE
        assert "bn, es, fr" in (error.remedy or "")

    def test_vad_regions_come_back_ordered_and_a_silent_clip_is_empty(self) -> None:
        assert FakeVad().detect(_audio()).unwrap() == (SpeechRegion(0, 1_000),)
        assert FakeVad().detect(_audio(0.0)).unwrap() == ()


class TestModelResolution:
    def test_an_installed_model_is_resolved_from_disk(self) -> None:
        ref = FakeModelResolver().resolve("base").unwrap()
        assert ref.is_downloaded
        assert ref.label == "base.int8"

    def test_a_missing_model_is_downloaded_when_possible(self) -> None:
        resolver = FakeModelResolver()
        assert resolver.resolve("small").unwrap().is_downloaded
        assert {ref.name for ref in resolver.installed()} == {"base", "small"}

    def test_offline_machines_get_a_state_with_a_remedy(self) -> None:
        """A missing model is an ordinary state, not a crash."""
        result = FakeModelResolver(offline=True).resolve("medium")
        error = result.unwrap_err()
        assert error.code == AsrErrorCode.MODEL_UNAVAILABLE
        assert error.remedy

    def test_installed_never_touches_the_network(self) -> None:
        assert len(FakeModelResolver(offline=True).installed()) == 1

    def test_removing_reclaims_the_space(self) -> None:
        resolver = FakeModelResolver()
        resolver.remove(AsrModelRef(name="base", path="/data/models/base"))
        assert resolver.installed() == ()
        assert resolver.removed == ["base"]


class TestPortPurity:
    """ADR-0009 §1: no module outside an adapter may name a model framework."""

    _PATH = pathlib.Path("nova_studio/ports/asr.py")

    def _imported_modules(self) -> list[str]:
        import ast

        tree = ast.parse(self._PATH.read_text(encoding="utf-8"))
        modules: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                modules.append(node.module)
        return modules

    @pytest.mark.parametrize(
        "banned", ["faster_whisper", "ctranslate2", "torch", "onnxruntime", "subprocess"]
    )
    def test_it_names_no_model_framework(self, banned: str) -> None:
        offenders = [name for name in self._imported_modules() if name.split(".")[0] == banned]
        assert not offenders, f"ports/asr.py names {banned}: {offenders}"

    def test_it_imports_no_outer_ring(self) -> None:
        offenders = [
            name
            for name in self._imported_modules()
            if name.startswith(("nova_studio.infra", "nova_studio.services", "nova_studio.api"))
        ]
        assert not offenders, f"ports/asr.py reaches into an outer ring: {offenders}"

    def test_it_speaks_in_domain_types(self) -> None:
        assert "nova_studio.domain.asr" in self._imported_modules()
        assert "nova_studio.domain.media" in self._imported_modules()
