"""The caption runner (`services/captions/runner.py`).

The runner is the seam where ADR-0009 meets the machine, so the tests here are
about the two rules that only this module can keep:

* **A provider is met on our terms** — 16 kHz mono, whatever the clip was, or
  the run does not start (§4).
* **Trimming silence must not move the words.** The VAD cuts the room tone, the
  provider numbers its words against what is left, and the runner has to put
  every one of those numbers back on the timeline the viewer is watching. A
  transcript that comes back two seconds early is the bug this file exists for.

Everything else — a stage that fails, a job that is stopped, a translation that
becomes a second layer — is tested with fakes, because a port is a port and a
run needs no model weights to be a real run.
"""

from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING

import numpy as np
import pytest

from nova_studio.core.errors import ErrorDomain, NovaError, NovaInvariantError
from nova_studio.core.result import Result, failed, ok
from nova_studio.core.temporal import Timebase
from nova_studio.domain.asr import (
    SpeechRegion,
    Transcript,
    TranscriptionOptions,
    TranscriptSegment,
    TranscriptWord,
)
from nova_studio.domain.captions import CaptionLayerKind
from nova_studio.domain.media import AudioBuffer
from nova_studio.ports.asr import AsrErrorCode
from nova_studio.ports.jobs import JobErrorCode
from nova_studio.services.captions.runner import (
    PROVIDER_SAMPLE_RATE,
    TRIM_PADDING_MS,
    CaptionRequest,
    CaptionRunner,
)

if TYPE_CHECKING:
    from nova_studio.core.jobs import JobProgress

TB = Timebase(num=30, den=1)
pytestmark = pytest.mark.unit


# -- fakes --------------------------------------------------------------------


def _audio(
    seconds: float = 8.0, rate: int = PROVIDER_SAMPLE_RATE, channels: int = 1
) -> AudioBuffer:
    frames = int(seconds * rate)
    return AudioBuffer(samples=np.zeros((frames, channels), dtype=np.float32), sample_rate=rate)


def _transcript(at_ms: int = 0, text: str = "we drink coffee at dawn") -> Transcript:
    """A transcript whose words start at ``at_ms`` and run 400 ms each."""
    words = tuple(
        TranscriptWord(text=word, start_ms=at_ms + index * 400, end_ms=at_ms + index * 400 + 350)
        for index, word in enumerate(text.split())
    )
    return Transcript(
        segments=(
            TranscriptSegment(
                start_ms=at_ms,
                end_ms=at_ms + len(words) * 400,
                index=0,
                text=text,
                words=words,
            ),
        ),
        language="en",
        model="fake",
        audio_duration_ms=at_ms + len(words) * 400,
    )


class _Provider:
    """A provider that says the words it is given, from zero."""

    def __init__(self, transcript: Transcript | None = None) -> None:
        self.transcript = transcript or _transcript()
        self.calls: list[tuple[int, int, bool]] = []

    def transcribe(self, audio: AudioBuffer, options: TranscriptionOptions) -> Result[Transcript]:
        self.calls.append((audio.frame_count, audio.sample_rate, audio.channels))
        return ok(self.transcript)

    def supports(self, capability: str) -> bool:
        return True


class _Failing:
    """A port that cannot go on."""

    def __init__(self, code: str = AsrErrorCode.TRANSCRIBE_FAILED, stage: str | None = None):
        self.code = code
        self.stage = stage

    def _no(self) -> Result[object]:
        details = {"stage": self.stage} if self.stage else None
        return failed(
            NovaError(
                code=self.code,
                message="this port cannot go on",
                domain=ErrorDomain.CAPTION,
                details=details,
            )
        )

    def transcribe(self, audio: AudioBuffer, options: TranscriptionOptions) -> Result[Transcript]:
        return self._no()  # type: ignore[return-value]

    def detect(self, audio: AudioBuffer) -> Result[tuple[SpeechRegion, ...]]:
        return self._no()  # type: ignore[return-value]

    def align(self, transcript: Transcript, audio: AudioBuffer) -> Result[Transcript]:
        return self._no()  # type: ignore[return-value]

    def diarise(self, audio: AudioBuffer, transcript: Transcript) -> Result[Transcript]:
        return self._no()  # type: ignore[return-value]

    def translate(self, transcript: Transcript, target_language: str) -> Result[Transcript]:
        return self._no()  # type: ignore[return-value]

    def supports(self, capability: str) -> bool:
        return True


class _Vad:
    def __init__(self, *regions: SpeechRegion) -> None:
        self.regions = regions

    def detect(self, audio: AudioBuffer) -> Result[tuple[SpeechRegion, ...]]:
        return ok(self.regions)


class _Aligner:
    """An aligner that leaves a mark so a test knows it ran."""

    def __init__(self) -> None:
        self.calls = 0

    def align(self, transcript: Transcript, audio: AudioBuffer) -> Result[Transcript]:
        self.calls += 1
        return ok(replace(transcript, model="aligned"))


class _Diariser:
    def diarise(self, audio: AudioBuffer, transcript: Transcript) -> Result[Transcript]:
        return ok(
            replace(
                transcript,
                segments=tuple(replace(segment, speaker="A") for segment in transcript.segments),
            )
        )


class _Translator:
    def __init__(self) -> None:
        self.target = ""

    def translate(self, transcript: Transcript, target_language: str) -> Result[Transcript]:
        self.target = target_language
        return ok(
            replace(transcript, language=target_language, translated_from=transcript.language)
        )


class _Job:
    """A job that remembers what it was told."""

    def __init__(self, *, cancelled: bool = False) -> None:
        self.cancelled = cancelled
        self.reports: list[JobProgress] = []

    def report(self, progress: JobProgress) -> None:
        self.reports.append(progress)

    def is_cancelled(self) -> bool:
        return self.cancelled


# -- the run ------------------------------------------------------------------


class TestTheRun:
    def test_a_provider_alone_is_enough(self):
        run = CaptionRunner(transcription=_Provider()).run(
            CaptionRequest(audio=_audio()), timebase=TB
        )
        assert run.is_ok()

    def test_the_transcript_comes_back(self):
        run = (
            CaptionRunner(transcription=_Provider())
            .run(CaptionRequest(audio=_audio()), timebase=TB)
            .unwrap()
        )
        assert run.transcript.text() == "we drink coffee at dawn"

    def test_the_document_has_the_cues(self):
        run = (
            CaptionRunner(transcription=_Provider())
            .run(CaptionRequest(audio=_audio()), timebase=TB)
            .unwrap()
        )
        assert run.cue_count == 1

    def test_the_keyframes_come_back(self):
        run = (
            CaptionRunner(transcription=_Provider())
            .run(CaptionRequest(audio=_audio()), timebase=TB)
            .unwrap()
        )
        assert len(run.baked.cues) == run.cue_count

    def test_the_stages_that_ran_are_named(self):
        run = (
            CaptionRunner(transcription=_Provider())
            .run(CaptionRequest(audio=_audio()), timebase=TB)
            .unwrap()
        )
        assert run.stages == (
            "transcribe",
            "refine",
            "break",
            "emoji",
            "highlight",
            "position",
            "bake",
        )

    def test_the_stages_a_port_added_are_named_too(self):
        runner = CaptionRunner(transcription=_Provider(), vad=_Vad(), aligner=_Aligner())
        run = runner.run(CaptionRequest(audio=_audio()), timebase=TB).unwrap()
        assert run.stages[:3] == ("vad", "transcribe", "align")

    def test_the_duration_is_the_captions(self):
        run = (
            CaptionRunner(transcription=_Provider())
            .run(CaptionRequest(audio=_audio()), timebase=TB)
            .unwrap()
        )
        assert run.duration_ms == 1_950

    def test_the_captions_are_valid(self):
        from nova_studio.domain.captions import validate_caption_document

        run = (
            CaptionRunner(transcription=_Provider())
            .run(CaptionRequest(audio=_audio()), timebase=TB)
            .unwrap()
        )
        assert not validate_caption_document(run.document)


class TestTheContract:
    """ADR-0009 §4: 16 kHz mono, always."""

    def test_a_provider_sees_sixteen_kilohertz_mono(self):
        provider = _Provider()
        CaptionRunner(transcription=provider).run(CaptionRequest(audio=_audio()), timebase=TB)
        assert provider.calls == [(int(8.0 * PROVIDER_SAMPLE_RATE), PROVIDER_SAMPLE_RATE, 1)]

    def test_stereo_is_folded_down(self):
        provider = _Provider()
        CaptionRunner(transcription=provider).run(
            CaptionRequest(audio=_audio(channels=2)), timebase=TB
        )
        assert provider.calls[0][2] == 1

    def test_a_forty_eight_kilohertz_clip_is_resampled(self):
        class _Resampler:
            def __init__(self) -> None:
                self.asked: tuple[int, int] | None = None

            def resample(
                self, buffer: AudioBuffer, *, sample_rate: int, channels: int
            ) -> AudioBuffer:
                self.asked = (sample_rate, channels)
                return _audio(rate=sample_rate, channels=channels)

        resampler = _Resampler()
        provider = _Provider()
        runner = CaptionRunner(transcription=provider, resampler=resampler)
        assert runner.run(CaptionRequest(audio=_audio(rate=48_000)), timebase=TB).is_ok()
        assert resampler.asked == (PROVIDER_SAMPLE_RATE, 1)
        assert provider.calls[0][1] == PROVIDER_SAMPLE_RATE

    def test_a_clip_at_the_wrong_rate_with_no_resampler_is_refused(self):
        result = CaptionRunner(transcription=_Provider()).run(
            CaptionRequest(audio=_audio(rate=48_000)), timebase=TB
        )
        assert result.unwrap_err().code == AsrErrorCode.AUDIO_UNUSABLE

    def test_the_refusal_says_what_the_contract_is(self):
        error = (
            CaptionRunner(transcription=_Provider())
            .run(CaptionRequest(audio=_audio(rate=48_000)), timebase=TB)
            .unwrap_err()
        )
        assert str(PROVIDER_SAMPLE_RATE) in error.message

    def test_the_vad_filter_is_left_to_the_options(self):
        """Alignment turns VAD off; the runner does not second-guess a caller."""
        provider = _Provider()
        options = TranscriptionOptions.alignment()
        CaptionRunner(transcription=provider).run(
            CaptionRequest(audio=_audio(), options=options), timebase=TB
        )
        assert options.vad_filter is False


class TestTrimming:
    """The rule this module exists to keep: trimming must not move the words."""

    def test_silence_before_the_speech_is_gone(self):
        provider = _Provider(_transcript(at_ms=0))
        runner = CaptionRunner(
            transcription=provider, vad=_Vad(SpeechRegion(start_ms=2_000, end_ms=4_000))
        )
        runner.run(CaptionRequest(audio=_audio()), timebase=TB).unwrap()
        frames, rate, _ = provider.calls[0]
        assert round(frames / rate, 2) == 2.24  # 2 s of speech plus padding at both ends

    def test_a_word_inside_the_speech_is_put_back(self):
        """The provider numbered it from zero; it was said at 2 000 ms."""
        provider = _Provider(_transcript(at_ms=0))
        runner = CaptionRunner(
            transcription=provider, vad=_Vad(SpeechRegion(start_ms=2_000, end_ms=4_000))
        )
        run = runner.run(CaptionRequest(audio=_audio()), timebase=TB).unwrap()
        first = run.document.segments[0].words[0]
        assert first.start_ms == 2_000 - TRIM_PADDING_MS

    def test_the_padding_is_why_it_lands_where_it_lands(self):
        """A word the provider placed at 120 ms was spoken at 2 000 ms exactly."""
        provider = _Provider(_transcript(at_ms=TRIM_PADDING_MS))
        runner = CaptionRunner(
            transcription=provider, vad=_Vad(SpeechRegion(start_ms=2_000, end_ms=4_000))
        )
        run = runner.run(CaptionRequest(audio=_audio()), timebase=TB).unwrap()
        assert run.document.segments[0].words[0].start_ms == 2_000

    def test_a_second_region_is_put_back_after_the_gap(self):
        """Two speeches with three seconds of room tone between them."""
        words = tuple(
            TranscriptWord(text=word, start_ms=at, end_ms=at + 350)
            for word, at in (("one", 0), ("two", 400), ("three", 3_000))
        )
        transcript = Transcript(
            segments=(
                TranscriptSegment(
                    start_ms=0, end_ms=3_400, index=0, text="one two three", words=words
                ),
            ),
            language="en",
            model="fake",
            audio_duration_ms=3_400,
        )
        runner = CaptionRunner(
            transcription=_Provider(transcript),
            vad=_Vad(
                SpeechRegion(start_ms=1_000, end_ms=1_800),
                SpeechRegion(start_ms=5_000, end_ms=5_400),
            ),
        )
        run = runner.run(CaptionRequest(audio=_audio(seconds=8.0)), timebase=TB).unwrap()
        said = [word.start_ms for cue in run.document.segments for word in cue.words]
        assert said[0] == 1_000 - TRIM_PADDING_MS
        assert said[1] == said[0] + 400
        # A provider that ran past the end of what it was given is placed after
        # the last piece rather than folded back into one.
        assert said[-1] > 5_000

    def test_the_speech_regions_are_remembered(self):
        region = SpeechRegion(start_ms=2_000, end_ms=4_000)
        runner = CaptionRunner(transcription=_Provider(), vad=_Vad(region))
        run = runner.run(CaptionRequest(audio=_audio()), timebase=TB).unwrap()
        assert run.speech == (region,)

    def test_a_vad_that_finds_nothing_leaves_the_audio_alone(self):
        provider = _Provider()
        runner = CaptionRunner(transcription=provider, vad=_Vad())
        run = runner.run(CaptionRequest(audio=_audio()), timebase=TB).unwrap()
        assert run.speech == ()
        assert provider.calls[0][0] == int(8.0 * PROVIDER_SAMPLE_RATE)

    def test_a_vad_that_fails_names_itself(self):
        runner = CaptionRunner(transcription=_Provider(), vad=_Failing(AsrErrorCode.AUDIO_UNUSABLE))
        error = runner.run(CaptionRequest(audio=_audio()), timebase=TB).unwrap_err()
        assert error.details["stage"] == "vad"

    def test_the_trimmed_transcript_is_clamped_to_the_audio(self):
        runner = CaptionRunner(
            transcription=_Provider(_transcript(at_ms=0)),
            vad=_Vad(SpeechRegion(start_ms=2_000, end_ms=4_000)),
        )
        run = runner.run(CaptionRequest(audio=_audio()), timebase=TB).unwrap()
        assert run.transcript.duration_ms <= 8_000


class TestExtraction:
    def test_a_path_with_no_decoder_is_refused(self):
        result = CaptionRunner(transcription=_Provider()).run(
            CaptionRequest(path="clip.mp4"), timebase=TB
        )
        error = result.unwrap_err()
        assert error.code == AsrErrorCode.AUDIO_UNUSABLE
        assert error.details["path"] == "clip.mp4"

    def test_a_clip_with_no_audio_track_is_refused(self):
        class _NoAudio:
            def open(self, path: str) -> Result[object]:
                return ok(_Media(audio_source=None))

        result = CaptionRunner(transcription=_Provider(), decoder=_NoAudio()).run(
            CaptionRequest(path="clip.mp4"), timebase=TB
        )
        assert "no audio track" in result.unwrap_err().message

    def test_a_clip_that_decodes_to_nothing_is_refused(self):
        class _Silent:
            def open(self, path: str) -> Result[object]:
                return ok(_Media(audio_source=_Samples(())))

        result = CaptionRunner(transcription=_Provider(), decoder=_Silent()).run(
            CaptionRequest(path="clip.mp4"), timebase=TB
        )
        assert "no audio at all" in result.unwrap_err().message

    def test_a_decoder_that_fails_is_reported_as_such(self):
        class _Broken:
            def open(self, path: str) -> Result[object]:
                return failed(
                    NovaError(
                        code="NS-MEDIA-5001",
                        message="the file is not a video",
                        domain=ErrorDomain.MEDIA,
                    )
                )

        result = CaptionRunner(transcription=_Provider(), decoder=_Broken()).run(
            CaptionRequest(path="clip.mp4"), timebase=TB
        )
        assert result.unwrap_err().code == "NS-MEDIA-5001"

    def test_audio_taken_from_a_file_is_closed_again(self):
        source = _Samples((_audio(seconds=1.0), _audio(seconds=1.0)))
        media = _Media(audio_source=source)

        class _Decoder:
            def open(self, path: str) -> Result[object]:
                return ok(media)

        runner = CaptionRunner(transcription=_Provider(), decoder=_Decoder())
        run = runner.run(CaptionRequest(path="clip.mp4"), timebase=TB).unwrap()
        assert media.closed
        assert run.stages[0] == "extract"

    def test_several_buffers_become_one(self):
        source = _Samples((_audio(seconds=1.0), _audio(seconds=2.0)))
        provider = _Provider()

        class _Decoder:
            def open(self, path: str) -> Result[object]:
                return ok(_Media(audio_source=source))

        runner = CaptionRunner(transcription=provider, decoder=_Decoder())
        runner.run(CaptionRequest(path="clip.mp4"), timebase=TB).unwrap()
        assert provider.calls[0][0] == int(3.0 * PROVIDER_SAMPLE_RATE)

    def test_a_source_that_fails_midway_is_reported(self):
        source = _Samples(
            (_audio(seconds=1.0),),
            failure=NovaError(
                code="NS-MEDIA-5002", message="the stream is corrupt", domain=ErrorDomain.MEDIA
            ),
        )

        class _Decoder:
            def open(self, path: str) -> Result[object]:
                return ok(_Media(audio_source=source))

        result = CaptionRunner(transcription=_Provider(), decoder=_Decoder()).run(
            CaptionRequest(path="clip.mp4"), timebase=TB
        )
        assert result.unwrap_err().code == "NS-MEDIA-5002"


class _Samples:
    """An audio sample source that yields what it was built with."""

    def __init__(self, buffers: tuple[AudioBuffer, ...], failure: NovaError | None = None) -> None:
        self.buffers = buffers
        self.failure = failure

    def info(self) -> object:
        return object()

    def sample_count(self) -> int:
        return sum(buffer.frame_count for buffer in self.buffers)

    def samples(self, start: int = 0, count: int | None = None):
        yield from self.buffers

    def last_error(self) -> NovaError | None:
        return self.failure

    def close(self) -> None:
        return None


class _Media:
    """A decoded medium that may or may not have sound."""

    def __init__(self, audio_source: _Samples | None) -> None:
        self.audio_source = audio_source
        self.closed = False

    def info(self) -> object:
        return object()

    def video(self, stream_index: int | None = None) -> None:
        return None

    def audio(self, stream_index: int | None = None) -> _Samples | None:
        return self.audio_source

    def close(self) -> None:
        self.closed = True


class TestTheOtherPorts:
    def test_the_aligner_runs_after_the_provider(self):
        aligner = _Aligner()
        runner = CaptionRunner(transcription=_Provider(), aligner=aligner)
        run = runner.run(CaptionRequest(audio=_audio()), timebase=TB).unwrap()
        assert aligner.calls == 1
        assert run.transcript.model == "aligned"

    def test_an_aligner_that_fails_names_itself(self):
        runner = CaptionRunner(transcription=_Provider(), aligner=_Failing())
        error = runner.run(CaptionRequest(audio=_audio()), timebase=TB).unwrap_err()
        assert error.details["stage"] == "align"

    def test_the_diariser_names_the_speaker(self):
        runner = CaptionRunner(transcription=_Provider(), diariser=_Diariser())
        run = runner.run(CaptionRequest(audio=_audio()), timebase=TB).unwrap()
        assert run.document.segments[0].speaker == "A"

    def test_a_diariser_that_fails_names_itself(self):
        runner = CaptionRunner(
            transcription=_Provider(), diariser=_Failing(AsrErrorCode.DIARISATION_FAILED)
        )
        error = runner.run(CaptionRequest(audio=_audio()), timebase=TB).unwrap_err()
        assert error.details["stage"] == "diarise"

    def test_a_translation_becomes_a_second_layer(self):
        runner = CaptionRunner(transcription=_Provider(), translator=_Translator())
        run = runner.run(CaptionRequest(audio=_audio(), target_language="de"), timebase=TB).unwrap()
        assert [layer.layer_id for layer in run.document.layers] == ["primary", "de"]

    def test_the_translation_layer_is_marked_as_one(self):
        runner = CaptionRunner(transcription=_Provider(), translator=_Translator())
        run = runner.run(CaptionRequest(audio=_audio(), target_language="de"), timebase=TB).unwrap()
        assert run.document.layers[-1].kind is CaptionLayerKind.TRANSLATION

    def test_the_translated_cues_are_filed_under_it(self):
        runner = CaptionRunner(transcription=_Provider(), translator=_Translator())
        run = runner.run(CaptionRequest(audio=_audio(), target_language="de"), timebase=TB).unwrap()
        assert {cue.layer_id for cue in run.document.segments} == {"primary", "de"}

    def test_a_translation_sits_on_top_of_the_original(self):
        """ADR-0009 §7: same moment, another language, one document."""
        runner = CaptionRunner(transcription=_Provider(), translator=_Translator())
        run = runner.run(CaptionRequest(audio=_audio(), target_language="de"), timebase=TB).unwrap()
        first, second = run.document.segments[0], run.document.segments[-1]
        assert first.start_ms == second.start_ms

    def test_no_target_language_means_no_translation(self):
        runner = CaptionRunner(transcription=_Provider(), translator=_Translator())
        run = runner.run(CaptionRequest(audio=_audio()), timebase=TB).unwrap()
        assert len(run.document.layers) == 1

    def test_a_translator_that_fails_names_itself(self):
        runner = CaptionRunner(
            transcription=_Provider(),
            translator=_Failing(AsrErrorCode.UNSUPPORTED_LANGUAGE),
        )
        error = runner.run(
            CaptionRequest(audio=_audio(), target_language="de"), timebase=TB
        ).unwrap_err()
        assert error.details["stage"] == "translate"

    def test_the_translator_is_told_which_language(self):
        translator = _Translator()
        runner = CaptionRunner(transcription=_Provider(), translator=translator)
        runner.run(CaptionRequest(audio=_audio(), target_language="de"), timebase=TB)
        assert translator.target == "de"


class TestProgress:
    def test_a_job_is_told_where_the_run_is(self):
        job = _Job()
        CaptionRunner(transcription=_Provider()).run(
            CaptionRequest(audio=_audio()), timebase=TB, job=job
        )
        assert [report.stage for report in job.reports][:2] == ["transcribe", "pipeline"]

    def test_progress_never_runs_backwards(self):
        job = _Job()
        CaptionRunner(transcription=_Provider()).run(
            CaptionRequest(audio=_audio()), timebase=TB, job=job
        )
        fractions = [report.fraction for report in job.reports]
        assert fractions == sorted(fractions)

    def test_the_run_finishes_at_one(self):
        job = _Job()
        CaptionRunner(transcription=_Provider()).run(
            CaptionRequest(audio=_audio()), timebase=TB, job=job
        )
        assert job.reports[-1].fraction == 1.0

    def test_a_stopped_job_stops_the_run(self):
        job = _Job(cancelled=True)
        result = CaptionRunner(transcription=_Provider()).run(
            CaptionRequest(audio=_audio()), timebase=TB, job=job
        )
        assert result.unwrap_err().code == JobErrorCode.CANCELLED

    def test_being_stopped_is_not_a_fault(self):
        job = _Job(cancelled=True)
        error = (
            CaptionRunner(transcription=_Provider())
            .run(CaptionRequest(audio=_audio()), timebase=TB, job=job)
            .unwrap_err()
        )
        assert error.retryable

    def test_being_stopped_says_where(self):
        job = _Job(cancelled=True)
        error = (
            CaptionRunner(transcription=_Provider())
            .run(CaptionRequest(audio=_audio()), timebase=TB, job=job)
            .unwrap_err()
        )
        assert error.details["stage"] == "transcribe"


class TestWhatIsRefused:
    def test_a_request_with_no_audio_and_no_path(self):
        with pytest.raises(NovaInvariantError, match="needs audio"):
            CaptionRequest()

    def test_a_target_language_that_is_not_one(self):
        with pytest.raises(NovaInvariantError, match="BCP-47"):
            CaptionRequest(audio=_audio(), target_language="german")

    def test_a_provider_that_fails_names_itself(self):
        runner = CaptionRunner(transcription=_Failing())
        error = runner.run(CaptionRequest(audio=_audio()), timebase=TB).unwrap_err()
        assert error.details["stage"] == "transcribe"

    def test_a_port_that_named_itself_keeps_its_own_answer(self):
        runner = CaptionRunner(transcription=_Failing(stage="align"))
        error = runner.run(CaptionRequest(audio=_audio()), timebase=TB).unwrap_err()
        assert error.details["stage"] == "align"

    def test_a_transcript_that_cannot_be_captions_is_refused(self):
        words = tuple(
            TranscriptWord(text=word, start_ms=index * 10, end_ms=index * 10 + 9)
            for index, word in enumerate(["too", "fast", "to", "read", "at", "all"])
        )
        broken = Transcript(
            segments=(
                TranscriptSegment(start_ms=0, end_ms=60, index=0, text="too fast", words=words),
            ),
            language="en",
            model="fake",
            audio_duration_ms=60,
        )
        result = CaptionRunner(transcription=_Provider(broken)).run(
            CaptionRequest(audio=_audio()), timebase=TB
        )
        assert result.is_err()


class TestTheLook:
    def test_a_look_decides_how_the_captions_move(self):
        from nova_studio.services.captions.styles import CaptionTemplate, look_for

        runner = CaptionRunner(transcription=_Provider())
        run = runner.run(
            CaptionRequest(audio=_audio(), look=look_for(CaptionTemplate.TIKTOK)), timebase=TB
        ).unwrap()
        assert {cue.mode for cue in run.baked.cues} == {"bounce"}

    def test_a_caller_can_bring_its_own_pipeline(self):
        from nova_studio.services.captions.assembly import default_pipeline

        pipeline = default_pipeline().without("emoji")
        runner = CaptionRunner(transcription=_Provider())
        run = runner.run(CaptionRequest(audio=_audio()), timebase=TB, pipeline=pipeline).unwrap()
        assert not any(cue.emoji for cue in run.document.segments)

    def test_a_stage_that_cannot_finish_stops_the_run(self):
        from nova_studio.services.captions.assembly import default_pipeline

        class _No:
            name = "refine"

            def apply(self, document, ctx):
                return failed(
                    NovaError(code="NS-CAPTION-4010", message="no", domain=ErrorDomain.CAPTION)
                )

        pipeline = default_pipeline().without("refine").inserted("refine", _No(), before="break")
        result = CaptionRunner(transcription=_Provider()).run(
            CaptionRequest(audio=_audio()), timebase=TB, pipeline=pipeline
        )
        assert result.unwrap_err().details["stage"] == "refine"
