"""L2 port — asr: how speech becomes text without naming a model.

The caption engine is the product's differentiator, and this is the seam it
hangs from.  ADR-0009 §1 is explicit: ``TranscriptionProvider`` is a port, its
implementations are swappable (faster-whisper by default, an imported
transcript, a typed transcript, or anything a plugin contributes), and **no
other module may import ``faster_whisper``**.

Six protocols, one per stage of the ASR half of the pipeline (ADR-0009 §3:
``Extract → VAD → Transcribe → Refine → Diarise → Translate → …``):

``VoiceActivityDetector``
    Where the speech is.  Used *before* transcription to trim silence and to
    record the offsets that later correct the alignment pass's timings.
``TranscriptionProvider``
    Audio in, a normalised :class:`Transcript` out.  The ADR's name, kept:
    a provider is what a user picks in a dropdown.
``WordAligner``
    Turns a transcript into one with word timings.  Separate from transcription
    because the two need different settings and because a provider may supply
    text without timings at all.
``SpeakerDiariser``
    Who said it.
``Translator``
    The same transcript in another language.
``ModelResolver``
    Which models exist, and whether the weights are on this machine yet.

Contract rules an adapter must honour
-------------------------------------
1. **Audio arrives at 16 kHz mono float32** (ADR-0009 §4).  The caller resamples,
   so token↔time mapping never depends on a provider's own resampler.  An
   adapter that is handed anything else returns
   :attr:`AsrErrorCode.AUDIO_UNUSABLE` rather than silently resampling and
   drifting.
2. **The alignment pass runs with VAD off.**
   :meth:`~nova_studio.domain.asr.TranscriptionOptions.alignment` is the only
   sanctioned way to build those options: VAD removes frames, and removed frames
   desynchronise the token↔time mapping in a meaningful fraction of real audio.
3. **Validate before returning, and say what is wrong.**  Empty word lists,
   non-monotonic timestamps and times past the end of the audio are reported as
   ``Err`` with :attr:`AsrErrorCode.ALIGNMENT_FAILED` and the sentence
   :func:`~nova_studio.domain.asr.validate_transcript` produced — never as a
   transcript that is subtly wrong for the length of a film.
4. **A missing model is a state, not a crash.**  Weights are downloaded at
   runtime; :attr:`AsrErrorCode.MODEL_UNAVAILABLE` carries the remedy ("download
   the base model — 145 MB") and the UI offers the download instead of showing a
   traceback.
5. **Providers declare what they can do.**  :meth:`TranscriptionProvider.supports`
   exists because an imported SRT file has no word timings, and a menu item that
   silently does nothing is worse than one that is disabled with a reason.
6. **Nothing here mentions a model framework.**  No ``faster_whisper``, no
   ``ctranslate2``, no ``torch`` in any signature — transcripts are
   :class:`~nova_studio.domain.asr.Transcript`, audio is
   :class:`~nova_studio.domain.media.AudioBuffer`.

Every failure mode above is *expected* — no network, no weights, no speech in
the clip — which is why they are ``Result`` values and not exceptions.  A
provider that raises instead forces every caller to guess whether the user can
act on it.
"""

from __future__ import annotations

from enum import StrEnum
from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    from nova_studio.core import Result
    from nova_studio.domain.asr import (
        AsrCapability,
        AsrModelRef,
        SpeechRegion,
        Transcript,
        TranscriptionOptions,
    )
    from nova_studio.domain.media import AudioBuffer

__all__ = [
    "AsrErrorCode",
    "ModelResolver",
    "SpeakerDiariser",
    "TranscriptionProvider",
    "Translator",
    "VoiceActivityDetector",
    "WordAligner",
]


class AsrErrorCode(StrEnum):
    """The codes a speech provider may return in the ``Err`` half.

    The domain segment is ``CAPTION`` because that is what ADR-0009 §4 names for
    ASR-stage failures, and because the caption UI is what renders them.
    """

    #: The audio is empty, too short to transcribe, or not at the contracted
    #: 16 kHz mono float32.
    AUDIO_UNUSABLE = "NS-CAPTION-4001"
    #: The model is known but its weights are not on this machine (or the
    #: network refused them).  The remedy names the download.
    MODEL_UNAVAILABLE = "NS-CAPTION-4002"
    #: The provider ran and failed: an out-of-memory during inference, a corrupt
    #: model file, a killed worker.
    TRANSCRIBE_FAILED = "NS-CAPTION-4003"
    #: The result could not be trusted: empty word lists, timestamps going
    #: backwards, or timings past the end of the audio (ADR-0009 §4).
    ALIGNMENT_FAILED = "NS-CAPTION-4004"
    #: A requested language is not supported by this provider or model.
    UNSUPPORTED_LANGUAGE = "NS-CAPTION-4005"
    #: Speaker labelling failed or is unavailable for this provider.
    DIARISATION_FAILED = "NS-CAPTION-4006"


@runtime_checkable
class VoiceActivityDetector(Protocol):
    """Where the speech is, before anyone tries to recognise it.

    Two jobs, and the order matters (ADR-0009 §4): silence is trimmed so a model
    does not hallucinate over room tone, and the offsets of what was removed are
    kept so the alignment pass's timings can be corrected back onto the original
    timeline.
    """

    def detect(self, audio: AudioBuffer) -> Result[tuple[SpeechRegion, ...]]:
        """Return the regions of ``audio`` that contain speech.

        An empty tuple is a valid answer — a silent clip has no speech — not an
        error.  Regions are returned in order and are expected to be mergeable
        by :func:`~nova_studio.domain.asr.merge_regions`.
        """
        ...


@runtime_checkable
class TranscriptionProvider(Protocol):
    """Audio in, a normalised transcript out.  The ADR-0009 §1 port.

    Implementations wrap a model (faster-whisper), a file (an imported SRT or
    JSON transcript) or a human (the typed transcript that is also the
    deterministic test double).  All three return the same
    :class:`~nova_studio.domain.asr.Transcript`, which is what lets the rest of
    the pipeline be pure and testable with no weights present.
    """

    def transcribe(self, audio: AudioBuffer, options: TranscriptionOptions) -> Result[Transcript]:
        """Transcribe ``audio``.

        Args:
            audio: 16 kHz mono float32, as contracted.
            options: Provider settings, including the language hint.  Pass
                :meth:`~nova_studio.domain.asr.TranscriptionOptions.alignment`
                when the goal is timings rather than text.

        Returns:
            ``Ok(Transcript)`` — possibly empty, which is a valid answer for a
            silent clip — or ``Err`` with :attr:`AsrErrorCode.MODEL_UNAVAILABLE`,
            :attr:`AsrErrorCode.AUDIO_UNUSABLE` or
            :attr:`AsrErrorCode.TRANSCRIBE_FAILED`.
        """
        ...

    def supports(self, capability: AsrCapability) -> bool:
        """Whether this provider can do ``capability``.

        Asked before offering the user a feature: per-word highlighting needs
        word timings, and an imported transcript frequently has none.
        """
        ...


@runtime_checkable
class WordAligner(Protocol):
    """Turn a transcript into one whose words have times.

    Separate from transcription because the two passes want different settings
    (ADR-0009 §4) and because a provider may hand over accurate text with no
    timings at all — the case where forced alignment earns its keep.
    """

    def align(self, transcript: Transcript, audio: AudioBuffer) -> Result[Transcript]:
        """Return ``transcript`` with word timings filled in.

        The text is not re-recognised: alignment only places the words that are
        already there.  The result is validated before it is returned, and a
        transcript that fails validation is reported with
        :attr:`AsrErrorCode.ALIGNMENT_FAILED` rather than handed over broken.
        """
        ...


@runtime_checkable
class SpeakerDiariser(Protocol):
    """Who said which stretch.

    Speaker labels are what make an interview readable and what let a template
    place two speakers on opposite sides of the frame.
    """

    def diarise(self, audio: AudioBuffer, transcript: Transcript) -> Result[Transcript]:
        """Return ``transcript`` with speaker labels attached.

        Labels are attached to segments and, where the provider can, to words —
        a caption that switches speaker mid-sentence is a real case, and a
        segment-level label alone cannot express it.
        """
        ...


@runtime_checkable
class Translator(Protocol):
    """The same transcript, in another language."""

    def translate(self, transcript: Transcript, target_language: str) -> Result[Transcript]:
        """Return ``transcript`` translated into ``target_language``.

        Timing is preserved and text is replaced, because a translated caption
        must appear when the words were said, not when the translation finished.
        The result records its origin in
        :attr:`~nova_studio.domain.asr.Transcript.translated_from` so a later
        re-transcription knows which revision is derived from which.

        A language this provider cannot do is
        :attr:`AsrErrorCode.UNSUPPORTED_LANGUAGE`, not a silent pass-through.
        """
        ...


@runtime_checkable
class ModelResolver(Protocol):
    """Which models exist, and whether the weights are here yet.

    Model weights are downloaded at runtime into the user data directory; they
    are never shipped and never committed.  A model that has not been downloaded
    is therefore an ordinary state that the UI must be able to show, which is
    half of what this port is for.  (``requirements/asr.txt`` calls this the
    ``ModelDownloader``; the port covers resolve, list and remove because the
    question "is it there?" is asked far more often than "get it".)
    """

    def resolve(self, name: str) -> Result[AsrModelRef]:
        """Return the model ``name``, downloading it if necessary.

        Args:
            name: A model name the provider understands (``tiny``, ``base``,
                ``small``, ``medium``, ``large-v3``, a distil variant, or a
                provider-specific identifier).

        Returns:
            ``Ok(AsrModelRef)`` with a path once the weights are on disk, or
            ``Err`` with :attr:`AsrErrorCode.MODEL_UNAVAILABLE` when they cannot
            be fetched — offline, mirror unreachable, disk full.
        """
        ...

    def installed(self) -> tuple[AsrModelRef, ...]:
        """Models already on this machine.  No network access, ever.

        The settings screen calls this on open; it must answer from disk.
        """
        ...

    def remove(self, ref: AsrModelRef) -> Result[None]:
        """Delete a model's weights to reclaim the space.

        Models are large and a user with a 145 MB download on a metered
        connection needs to be able to take it back.
        """
        ...
