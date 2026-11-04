"""L3 — the caption runner: the five stages that need the world outside.

`assembly.py` registers the seven stages that are pure — a document in, a
document out — and deliberately does not register the other five, because
`extract`, `vad`, `transcribe`, `diarise` and `translate` need audio, a model or
the network, and a :class:`StageContext` carries frame geometry and a language
and nothing else. Those five are this module.

So the runner is the seam where ADR-0009 meets the machine. Three decisions
shape it.

**The ports are the constructor's arguments, not globals.** A runner that
reached for a provider through a module-level import could not be tested
without model weights, which would undo the one consequence the ADR calls
decisive. Here a test hands in fakes and gets a real run: the same code path a
user's machine takes, with a provider that answers in microseconds.

**Every failure names the stage it came from.** A provider returns
``NS-CAPTION-4003`` and the UI needs to say "transcription failed", not
"something went wrong"; the runner puts ``details["stage"]`` on any error that
arrived without one, and leaves an error that already knows alone.
Cancellation is not a fault and says so — ``NS-JOB-5005``, the code the UI
renders as "stopped".

**Two rules from ADR-0009 §4 hold here, because here is the only place they
can:**

1. **Audio reaches a provider as 16 kHz mono float32, always** — enforced in
   :meth:`CaptionRunner._contracted`, so a provider cannot be handed a 48 kHz
   stereo buffer and quietly desynchronise.
2. **The alignment pass runs with VAD off, and silence trimming is undone
   afterwards.** Trimming is what stops a model hallucinating over room tone,
   and it is also how a transcript ends up a beat early: the provider numbers
   its words against the *trimmed* audio. So :func:`_trimmed` keeps, next to the
   trimmed buffer, the table of where each piece came from, and
   :func:`_retimed` puts every timestamp back on the original timeline. The
   tokens are never shifted — only the numbers saying when they were said.

The pure half runs in the middle: the runner builds a document from the
transcript, hands it to a :class:`CaptionPipeline` (the default one from
`assembly.py` unless the caller brings another), bakes what comes out, and
returns all three — the words a provider said, the captions a viewer reads, and
the keyframes the renderer draws.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING, Final, Protocol, runtime_checkable

import numpy as np

from nova_studio.core.errors import ErrorDomain, NovaError, NovaInvariantError
from nova_studio.core.jobs import JobProgress
from nova_studio.core.result import Result, failed, ok
from nova_studio.domain.asr import (
    SpeechRegion,
    Transcript,
    TranscriptionOptions,
    TranscriptSegment,
    is_language_tag,
)
from nova_studio.domain.captions import CaptionLayer, CaptionLayerKind
from nova_studio.domain.media import AudioBuffer
from nova_studio.ports.asr import AsrErrorCode
from nova_studio.ports.jobs import JobErrorCode
from nova_studio.services.captions.assembly import default_pipeline
from nova_studio.services.captions.bake import AnimationBaker, BakedCaptions
from nova_studio.services.captions.build import document_from_transcript, segments_from_transcript
from nova_studio.services.captions.pipeline import StageContext
from nova_studio.services.captions.segmentation import DEFAULT_CUE_RULES

if TYPE_CHECKING:
    from collections.abc import Mapping

    from nova_studio.core.temporal import Timebase
    from nova_studio.domain.captions import CaptionDocument
    from nova_studio.ports.asr import (
        SpeakerDiariser,
        TranscriptionProvider,
        Translator,
        VoiceActivityDetector,
        WordAligner,
    )
    from nova_studio.ports.media import AudioResampler, MediaDecoder
    from nova_studio.services.captions.pipeline import CaptionPipeline
    from nova_studio.services.captions.segmentation import CueRules
    from nova_studio.services.captions.styles import CaptionLook

__all__ = [
    "PROVIDER_CHANNELS",
    "PROVIDER_SAMPLE_RATE",
    "TRIM_PADDING_MS",
    "CaptionRequest",
    "CaptionRun",
    "CaptionRunner",
    "ProgressSink",
]

#: ADR-0009 §4 — the sample rate every provider is contracted to see.
PROVIDER_SAMPLE_RATE: Final[int] = 16_000
#: And the channel count: mono, because a second channel doubles the work and
#: halves nothing.
PROVIDER_CHANNELS: Final[int] = 1
#: Silence kept at each end of a speech region, so a VAD boundary that landed a
#: little tight does not cut a word in half.
TRIM_PADDING_MS: Final[int] = 120

#: Where each stage sits on the progress bar.  Transcription is most of the run,
#: and a bar that spends ninety per cent of its life at five per cent looks hung.
_WEIGHTS: Final[Mapping[str, float]] = {
    "extract": 0.05,
    "vad": 0.15,
    "transcribe": 0.70,
    "align": 0.80,
    "diarise": 0.85,
    "translate": 0.90,
    "pipeline": 0.95,
    "bake": 0.98,
}


@runtime_checkable
class ProgressSink(Protocol):
    """All the runner wants from a job: somewhere to say how it is doing.

    Not `JobContext`: that protocol also answers who the job is, what it was
    submitted with and how to checkpoint it, and a runner that demanded all of
    it could not be handed anything simpler in a test.
    """

    def report(self, progress: JobProgress) -> None: ...
    def is_cancelled(self) -> bool: ...


@dataclass(frozen=True, slots=True)
class _Span:
    """One piece of the trimmed audio, and where in the original it came from.

    This table is the whole answer to "trimming moved my captions": the provider
    numbered its words against the trimmed buffer, and every one of those
    numbers goes back through here before anyone else sees it.
    """

    #: Where the piece begins in the trimmed audio.
    trimmed_start_ms: int
    #: Where the very same sample was in the untrimmed audio.
    original_start_ms: int
    length_ms: int

    @property
    def trimmed_end_ms(self) -> int:
        """Where the piece ends in the trimmed audio."""
        return self.trimmed_start_ms + self.length_ms

    def holds(self, trimmed_ms: int) -> bool:
        """Whether a moment in the trimmed audio falls inside this piece."""
        return self.trimmed_start_ms <= trimmed_ms < self.trimmed_end_ms

    def untrim(self, trimmed_ms: int) -> int:
        """The original time of a moment in the trimmed audio."""
        return self.original_start_ms + (trimmed_ms - self.trimmed_start_ms)


@dataclass(frozen=True, slots=True, kw_only=True)
class CaptionRequest:
    """What to caption, and how.

    Either `audio` — samples already in memory — or `path`, a file the runner
    takes them from. Everything else is optional and says how far the run
    should go: align the words, name the speakers, translate into a second
    language, dress the result in a house style.
    """

    audio: AudioBuffer | None = None
    #: A media file to extract audio from, when `audio` is not given.
    path: str = ""
    #: What the provider is told.
    options: TranscriptionOptions = field(default_factory=TranscriptionOptions)
    #: Translate into this BCP-47 tag, when the runner has a translator.
    target_language: str = ""
    #: The house style the cues are broken to.
    rules: CueRules | None = None
    #: The look they are dressed in, and whose animation mode is baked.
    look: CaptionLook | None = None
    #: The frame geometry the placement stages work in.
    ctx: StageContext = field(default_factory=StageContext)

    def __post_init__(self) -> None:
        if self.audio is None and not self.path:
            raise NovaInvariantError("a caption request needs audio, or a path to take it from")
        if self.target_language and not is_language_tag(self.target_language):
            raise NovaInvariantError(f"{self.target_language!r} is not a BCP-47 language tag")


@dataclass(frozen=True, slots=True)
class CaptionRun:
    """What a run produced: the words, the captions, and their keyframes.

    All three, because they answer different questions and a caller usually
    wants more than one: the transcript is what a re-transcription merges
    against (ADR-0009 §7), the document is what the timeline reconciles to
    (§8), and the baked keyframes are what the preview and the export draw
    (§6).
    """

    transcript: Transcript
    document: CaptionDocument
    baked: BakedCaptions
    #: The stages that ran, in order — the ones this module drove, then the pure
    #: ones the pipeline ran.  What a progress panel names and a bug report
    #: quotes.
    stages: tuple[str, ...] = ()
    #: Where the VAD found speech.  Empty when it did not run.
    speech: tuple[SpeechRegion, ...] = ()

    @property
    def cue_count(self) -> int:
        """How many cues the document holds."""
        return len(self.document.segments)

    @property
    def duration_ms(self) -> int:
        """How long the captions run for."""
        return self.document.duration_ms


@dataclass(frozen=True, slots=True, kw_only=True)
class CaptionRunner:
    """The five stages that need the world outside, in order.

    Every dependency is a port, so a run is a value in and a value out, and a
    test needs no model weights, no GPU and no network.
    """

    transcription: TranscriptionProvider
    #: Optional: silence trimming and speech regions (ADR-0009 §4).
    vad: VoiceActivityDetector | None = None
    #: Optional: forced alignment, which is where trustworthy word timings
    #: come from.
    aligner: WordAligner | None = None
    #: Optional: who is speaking.
    diariser: SpeakerDiariser | None = None
    #: Optional: a second language, as a second layer.
    translator: Translator | None = None
    #: Needed only when a request names a `path` instead of handing in audio.
    decoder: MediaDecoder | None = None
    #: Needed only when the audio is not already 16 kHz mono.
    resampler: AudioResampler | None = None

    def run(
        self,
        request: CaptionRequest,
        *,
        timebase: Timebase,
        pipeline: CaptionPipeline | None = None,
        job: ProgressSink | None = None,
    ) -> Result[CaptionRun]:
        """Caption one request, end to end.

        Args:
            request: What to caption and how.
            timebase: The project's frame rate. Baking needs it: keyframes are
                numbered in frames, and a caption is not finished until it has
                them.
            pipeline: The pure stages to run. Defaults to
                :func:`~nova_studio.services.captions.assembly.default_pipeline`
                built from the request's look.
            job: Where progress and cancellation come from, when the run is one.

        Returns:
            ``Ok`` with the transcript, the document and the keyframes, or the
            first ``Err`` a stage produced, named.
        """
        stages: list[str] = []
        audio = request.audio

        # -- extract ------------------------------------------------------
        if audio is None:
            _report(job, "extract", request.path)
            extracted = self._extract(request.path)
            problem = extracted.error()
            if problem is not None:
                return failed(_attributed(problem, "extract"))
            audio = extracted.unwrap()
            stages.append("extract")

        # -- the contract every provider is met with -----------------------
        contracted = self._contracted(audio)
        problem = contracted.error()
        if problem is not None:
            return failed(_attributed(problem, "extract"))
        audio = contracted.unwrap()
        duration_ms = _duration_ms(audio)

        # -- vad ----------------------------------------------------------
        spans: tuple[_Span, ...] = ()
        speech: tuple[SpeechRegion, ...] = ()
        if self.vad is not None:
            if _stopped(job):
                return failed(_cancelled("vad"))
            _report(job, "vad", "")
            found = self.vad.detect(audio)
            problem = found.error()
            if problem is not None:
                return failed(_attributed(problem, "vad"))
            speech = found.unwrap()
            if speech:
                audio, spans = _trimmed(audio, speech, duration_ms)
            stages.append("vad")

        # -- transcribe ---------------------------------------------------
        if _stopped(job):
            return failed(_cancelled("transcribe"))
        _report(job, "transcribe", request.options.model)
        said = self.transcription.transcribe(audio, request.options)
        problem = said.error()
        if problem is not None:
            return failed(_attributed(problem, "transcribe"))
        transcript = said.unwrap()
        stages.append("transcribe")

        # -- align --------------------------------------------------------
        if self.aligner is not None:
            if _stopped(job):
                return failed(_cancelled("align"))
            _report(job, "align", "")
            aligned = self.aligner.align(transcript, audio)
            problem = aligned.error()
            if problem is not None:
                return failed(_attributed(problem, "align"))
            transcript = aligned.unwrap()
            stages.append("align")

        # Speech was trimmed, so the provider numbered its words against the
        # trimmed audio: put every one of them back where it was said.
        if spans:
            transcript = _retimed(transcript, spans, duration_ms)

        # -- diarise ------------------------------------------------------
        if self.diariser is not None:
            if _stopped(job):
                return failed(_cancelled("diarise"))
            _report(job, "diarise", "")
            named = self.diariser.diarise(audio, transcript)
            problem = named.error()
            if problem is not None:
                return failed(_attributed(problem, "diarise"))
            transcript = named.unwrap()
            stages.append("diarise")

        # -- translate ----------------------------------------------------
        translated: Transcript | None = None
        if self.translator is not None and request.target_language:
            if _stopped(job):
                return failed(_cancelled("translate"))
            _report(job, "translate", request.target_language)
            in_other_words = self.translator.translate(transcript, request.target_language)
            problem = in_other_words.error()
            if problem is not None:
                return failed(_attributed(problem, "translate"))
            translated = in_other_words.unwrap()
            stages.append("translate")

        # -- build, then the pure half ------------------------------------
        rules = request.rules or DEFAULT_CUE_RULES
        built = document_from_transcript(transcript, rules=rules)
        problem = built.error()
        if problem is not None:
            return failed(problem)
        document = built.unwrap()
        if translated is not None:
            document = _with_translation(document, translated, request.target_language, rules)

        if _stopped(job):
            return failed(_cancelled("pipeline"))
        _report(job, "pipeline", "")
        chosen = pipeline if pipeline is not None else default_pipeline(look=request.look)
        run = chosen.run(document, request.ctx)
        problem = run.error()
        if problem is not None:
            return failed(problem)
        document = run.unwrap()
        stages.extend(chosen.enabled_names)

        # -- bake ---------------------------------------------------------
        if _stopped(job):
            return failed(_cancelled("bake"))
        _report(job, "bake", "")
        baked = _baker_of(chosen).bake(document, timebase=timebase, look=request.look)
        problem = baked.error()
        if problem is not None:
            return failed(problem)

        _report(job, "done", "")
        return ok(
            CaptionRun(
                transcript=transcript,
                document=document,
                baked=baked.unwrap(),
                stages=tuple(stages),
                speech=speech,
            )
        )

    # -- extract ----------------------------------------------------------

    def _extract(self, path: str) -> Result[AudioBuffer]:
        """The audio of a media file, decoded and in one piece."""
        if self.decoder is None:
            return failed(
                NovaError(
                    code=AsrErrorCode.AUDIO_UNUSABLE,
                    message=f"there is no decoder to take the audio out of {path!r}",
                    domain=ErrorDomain.CAPTION,
                    remedy="Configure a media decoder, or hand the runner audio directly.",
                    details={"path": path},
                    retryable=False,
                )
            )
        opened = self.decoder.open(path)
        problem = opened.error()
        if problem is not None:
            return failed(problem)
        media = opened.unwrap()
        try:
            source = media.audio()
            if source is None:
                return failed(
                    NovaError(
                        code=AsrErrorCode.AUDIO_UNUSABLE,
                        message=f"{path!r} has no audio track to caption",
                        domain=ErrorDomain.CAPTION,
                        remedy="Choose a clip that has sound, or import a transcript instead.",
                        details={"path": path},
                        retryable=False,
                    )
                )
            pieces = list(source.samples())
            failure = source.last_error()
            if failure is not None:
                return failed(failure)
            if not pieces:
                return failed(
                    NovaError(
                        code=AsrErrorCode.AUDIO_UNUSABLE,
                        message=f"{path!r} decoded to no audio at all",
                        domain=ErrorDomain.CAPTION,
                        remedy="Re-encode the clip, or import a transcript instead.",
                        details={"path": path},
                        retryable=False,
                    )
                )
        finally:
            media.close()
        return ok(pieces[0] if len(pieces) == 1 else _joined(pieces))

    def _contracted(self, audio: AudioBuffer) -> Result[AudioBuffer]:
        """`audio` as 16 kHz mono float32 — what every provider is promised.

        ADR-0009 §4 makes this the runner's job rather than the provider's: one
        rule, kept in one place, instead of a rule each adapter has to remember
        and one of them will forget.
        """
        mono = audio.to_mono() if audio.channels > 1 else audio
        if mono.sample_rate == PROVIDER_SAMPLE_RATE:
            return ok(mono)
        if self.resampler is None:
            return failed(
                NovaError(
                    code=AsrErrorCode.AUDIO_UNUSABLE,
                    message=(
                        f"audio is {mono.sample_rate} Hz, and a provider is contracted "
                        f"to see {PROVIDER_SAMPLE_RATE} Hz mono"
                    ),
                    domain=ErrorDomain.CAPTION,
                    remedy="Configure an audio resampler, or hand the runner 16 kHz mono.",
                    details={"sample_rate": mono.sample_rate},
                    retryable=False,
                )
            )
        resampled = self.resampler.resample(
            mono, sample_rate=PROVIDER_SAMPLE_RATE, channels=PROVIDER_CHANNELS
        )
        return ok(resampled)


# -- audio --------------------------------------------------------------------


def _joined(pieces: list[AudioBuffer]) -> AudioBuffer:
    """One buffer from several, in order.

    Concatenation is array arithmetic, and the only thing that needs it is the
    trimming below — so it lives here rather than in the domain, which has no
    opinion about how a runner assembles what it feeds a model.
    """
    return AudioBuffer(
        samples=np.concatenate([piece.samples for piece in pieces]),
        sample_rate=pieces[0].sample_rate,
    )


def _duration_ms(audio: AudioBuffer) -> int:
    """How long this audio is, in milliseconds."""
    return round(audio.frame_count / audio.sample_rate * 1_000)


def _frame_at(audio: AudioBuffer, ms: int) -> int:
    """The sample index of a moment, clamped to the buffer."""
    return min(max(round(ms * audio.sample_rate / 1_000), 0), audio.frame_count)


def _trimmed(
    audio: AudioBuffer, regions: tuple[SpeechRegion, ...], duration_ms: int
) -> tuple[AudioBuffer, tuple[_Span, ...]]:
    """The speech, with a little silence at each end, and where it came from.

    A region is widened by `TRIM_PADDING_MS` at both ends so a word is not cut
    in half by a boundary that landed tight; where two widened regions touch,
    the later one starts where the earlier ended, so nothing is counted twice
    and nothing is lost.

    Returns the trimmed buffer and the table that puts its times back.
    """
    pieces: list[AudioBuffer] = []
    spans: list[_Span] = []
    at_ms = 0
    up_to = 0
    for region in regions:
        from_ms = max(region.start_ms - TRIM_PADDING_MS, up_to)
        to_ms = min(region.end_ms + TRIM_PADDING_MS, duration_ms)
        if to_ms <= from_ms:
            continue
        pieces.append(audio.slice(_frame_at(audio, from_ms), _frame_at(audio, to_ms)))
        spans.append(
            _Span(trimmed_start_ms=at_ms, original_start_ms=from_ms, length_ms=to_ms - from_ms)
        )
        at_ms += to_ms - from_ms
        up_to = to_ms
    if not pieces:
        return audio, ()
    return _joined(pieces), tuple(spans)


# -- putting the timings back -------------------------------------------------


def _untrimmed(ms: int, spans: tuple[_Span, ...]) -> int:
    """The original time of a moment in the trimmed audio.

    A timestamp past the end of the trimmed audio — a provider that ran a little
    long — is placed after the last piece rather than folded back into it.
    """
    for span in spans:
        if span.holds(ms):
            return span.untrim(ms)
    last = spans[-1]
    overshoot = max(0, ms - last.trimmed_end_ms)
    return last.original_start_ms + last.length_ms + overshoot


def _retimed(transcript: Transcript, spans: tuple[_Span, ...], duration_ms: int) -> Transcript:
    """A transcript on the trimmed timeline, put back on the original one."""
    moved = replace(
        transcript,
        segments=tuple(_retimed_segment(segment, spans) for segment in transcript.segments),
    )
    return moved.clamped(duration_ms)


def _retimed_segment(segment: TranscriptSegment, spans: tuple[_Span, ...]) -> TranscriptSegment:
    return replace(
        segment,
        start_ms=_untrimmed(segment.start_ms, spans),
        end_ms=_untrimmed(max(segment.end_ms, segment.start_ms + 1), spans),
        words=tuple(
            replace(
                word,
                start_ms=_untrimmed(word.start_ms, spans),
                end_ms=_untrimmed(max(word.end_ms, word.start_ms + 1), spans),
            )
            for word in segment.words
        ),
    )


# -- the translation layer ----------------------------------------------------


def _with_translation(
    document: CaptionDocument,
    translated: Transcript,
    language: str,
    rules: CueRules,
) -> CaptionDocument:
    """`document` with the translation filed as a second layer.

    ADR-0009 §7: a translation is a second `CaptionLayer` **of the same
    document**, not a second document — it is the same programme, and an export
    writes it as another track rather than as another project.
    """
    layer = CaptionLayer(
        layer_id=language,
        name=language,
        language=language,
        kind=CaptionLayerKind.TRANSLATION,
    )
    cues = segments_from_transcript(translated, layer_id=layer.layer_id, rules=rules)
    return replace(
        document,
        layers=(*document.layers, layer),
        segments=(*document.segments, *cues),
    ).reindexed()


# -- plumbing -----------------------------------------------------------------


def _baker_of(pipeline: CaptionPipeline) -> AnimationBaker:
    """The baker this pipeline carries, or a plain one.

    A pipeline whose ``bake`` stage is a plugin's own object is not this
    module's to second-guess, so a stage that is not an `AnimationBaker` leaves
    the runner baking with the default.
    """
    for name, stage in pipeline.stages:
        if name == "bake" and isinstance(stage, AnimationBaker):
            return stage
    return AnimationBaker()


def _report(job: ProgressSink | None, stage: str, detail: str) -> None:
    """Say where the run is, when it is being watched."""
    if job is None:
        return
    job.report(JobProgress(fraction=_WEIGHTS.get(stage, 1.0), stage=stage, detail=detail))


def _stopped(job: ProgressSink | None) -> bool:
    """Whether the job was cancelled.

    Checked *between* stages, never inside one: a stage is not stopped
    mid-thought, it is simply not started.
    """
    return job is not None and job.is_cancelled()


def _cancelled(stage: str) -> NovaError:
    return NovaError(
        code=JobErrorCode.CANCELLED,
        message=f"the {stage} stage was stopped",
        domain=ErrorDomain.JOB,
        remedy="Run the captions again when you are ready.",
        details={"stage": stage},
        retryable=True,
    )


def _attributed(error: NovaError, stage: str) -> NovaError:
    """An error from a stage, with the stage's name on it.

    A stage that already named itself keeps its own answer; only one that
    forgot gets a name, because overwriting a specific answer with a vaguer one
    is how a bug report loses the thing it needed.
    """
    if "stage" in error.details:
        return error
    return error.with_details(stage=stage)
