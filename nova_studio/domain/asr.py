"""L2 — asr: what a transcription produces, in our words.

This module is the *normalised* vocabulary a speech provider must hand back
(ADR-0009 §1): a provider returns a :class:`Transcript`, never a vendor object.
That is what makes faster-whisper replaceable by a cloud API, an NPU engine or a
user-supplied SRT file without the caption pipeline noticing.

Three decisions carry most of the weight here:

1. **Time is integer milliseconds.**  A transcript does not know the project's
   edit rate, so frames would be meaningless, and float seconds would drift the
   moment they are added to.  Milliseconds are exact, JSON-friendly and
   convertible to frames later with an explicit rounding mode
   (:func:`frames_for_ms`, ADR-0006).  Converting is the caption pipeline's job,
   performed once, at the boundary.
2. **Validate at the boundary, loudly.**  ADR-0009 §4: an empty word list, a
   non-monotonic timestamp or a value outside the audio becomes
   ``Err(NS-CAPTION-*)`` with a remedy, never a caption that silently displays
   the wrong words at the wrong time.  :func:`validate_transcript` is the pure
   half of that rule — adapters call it, services surface it.
3. **16 kHz mono float32 is a contract, not a hope** (ADR-0009 §4).  The caller
   resamples before audio reaches a provider, and
   :class:`TranscriptionOptions` carries the flags that matter — including
   ``vad_filter=False`` on the alignment pass, because VAD frame removal
   desynchronises the token↔time mapping in a meaningful fraction of real audio.

This is deliberately *not* the authoring model.  ``domain/captions.py`` will hold
``CaptionDocument`` — cues, styling, revisions, deltas, the thing the user edits.
A :class:`Transcript` is ASR truth, and the pipeline turns it into a document
(ADR-0009 §2, §7).  Conflating them is what makes re-transcription destructive.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from decimal import Decimal
from enum import StrEnum
from typing import Final

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.temporal import Rounding, Timebase, seconds_to_frames

__all__ = [
    "ASR_SAMPLE_RATE",
    "AsrCapability",
    "AsrModelRef",
    "SpeechRegion",
    "Transcript",
    "TranscriptSegment",
    "TranscriptWord",
    "TranscriptionOptions",
    "frames_for_ms",
    "is_language_tag",
    "merge_regions",
    "validate_transcript",
]

#: The rate every provider is fed (ADR-0009 §4): we resample, so token↔time
#: mapping is never at the mercy of a provider's own resampler.
ASR_SAMPLE_RATE: Final[int] = 16_000

#: A loose BCP-47 shape: ``bn``, ``en-US``, ``zh-Hans``, ``pt-BR``.
_LANGUAGE_TAG: Final[re.Pattern[str]] = re.compile(r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$")


def is_language_tag(value: str) -> bool:
    """Whether ``value`` looks like a BCP-47 language tag."""
    return bool(_LANGUAGE_TAG.match(value))


class AsrCapability(StrEnum):
    """What a provider can do, so the UI can ask instead of assume.

    A user importing an SRT file gets a transcript with no word timings; a
    provider must be able to say so, because "highlight each word" is otherwise
    a menu item that silently does nothing.
    """

    #: Word-level timestamps, needed for karaoke and per-word animation.
    WORD_TIMESTAMPS = "word_timestamps"
    #: Character-level timestamps, which beat our proportional estimate.
    CHAR_TIMESTAMPS = "char_timestamps"
    #: Translation to another language.
    TRANSLATION = "translation"
    #: Speaker labels.
    DIARISATION = "diarisation"
    #: Works with no network at all.
    OFFLINE = "offline"
    #: Can identify the spoken language when none is given.
    LANGUAGE_DETECTION = "language_detection"


@dataclass(frozen=True, slots=True)
class AsrModelRef:
    """A model that may or may not be on this machine yet.

    Weights are downloaded at runtime into the user data directory — never
    shipped and never committed (ADR: ``requirements/asr.txt``).  A model the
    user has not downloaded is a normal state, not an error, so ``path`` is
    simply empty.
    """

    name: str
    quantisation: str = "int8"
    path: str = ""
    size_bytes: int = 0

    def __post_init__(self) -> None:
        if not self.name:
            raise NovaInvariantError("a model reference must carry a name")
        if self.size_bytes < 0:
            raise NovaInvariantError(f"size_bytes must not be negative, got {self.size_bytes}")

    @property
    def is_downloaded(self) -> bool:
        """Whether the weights are on disk."""
        return bool(self.path)

    @property
    def label(self) -> str:
        """How the model is named in the UI: ``base.int8``."""
        return f"{self.name}.{self.quantisation}" if self.quantisation else self.name


@dataclass(frozen=True, slots=True)
class TranscriptionOptions:
    """Everything a provider is told, and nothing it is allowed to guess.

    ``vad_filter`` defaults to *on* because it helps the transcription pass
    (less silence to hallucinate over), and the alignment pass turns it *off* —
    :meth:`alignment` is the only sanctioned way to build that second set of
    options, so the rule from ADR-0009 §4 cannot be forgotten at a call site.
    """

    model: str = ""
    #: ``None`` asks the provider to detect the language.
    language: str | None = None
    #: ``"transcribe"`` (same language) or ``"translate"`` (to English).
    task: str = "transcribe"
    vad_filter: bool = True
    word_timestamps: bool = True
    beam_size: int = 5
    temperature: float = 0.0
    initial_prompt: str = ""

    def __post_init__(self) -> None:
        if self.task not in ("transcribe", "translate"):
            raise NovaInvariantError(f"task must be 'transcribe' or 'translate', got {self.task!r}")
        if self.beam_size < 1:
            raise NovaInvariantError(f"beam_size must be at least 1, got {self.beam_size}")
        if not 0.0 <= self.temperature <= 1.0:
            raise NovaInvariantError(
                f"temperature must be between 0.0 and 1.0, got {self.temperature}"
            )
        if self.language is not None and not is_language_tag(self.language):
            raise NovaInvariantError(f"{self.language!r} is not a BCP-47 language tag")

    @classmethod
    def alignment(cls, *, language: str | None = None, beam_size: int = 5) -> TranscriptionOptions:
        """Options for the alignment pass: word timings, **no VAD**.

        ADR-0009 §4: VAD removes frames, which desynchronises the token↔time
        mapping; a transcript aligned through VAD lands a beat early and gets
        worse along the timeline.  Silence trimming belongs to an earlier pass,
        whose offsets are applied to the timings afterwards.
        """
        return cls(
            language=language,
            vad_filter=False,
            word_timestamps=True,
            beam_size=beam_size,
        )

    @classmethod
    def plain(cls, *, language: str | None = None) -> TranscriptionOptions:
        """Options for a plain transcription with no word timings."""
        return cls(language=language, word_timestamps=False)


@dataclass(frozen=True, slots=True)
class TranscriptWord:
    """One recognised word and where it was said."""

    text: str
    start_ms: int
    end_ms: int
    confidence: float = 1.0
    speaker: str | None = None

    def __post_init__(self) -> None:
        if not self.text:
            raise NovaInvariantError("a word must carry text")
        if self.start_ms < 0 or self.end_ms < self.start_ms:
            raise NovaInvariantError(
                f"word times must be non-negative and ordered, got [{self.start_ms}, {self.end_ms}]"
            )
        if not 0.0 <= self.confidence <= 1.0:
            raise NovaInvariantError(
                f"confidence must be between 0.0 and 1.0, got {self.confidence}"
            )

    @property
    def duration_ms(self) -> int:
        """How long the word lasts."""
        return self.end_ms - self.start_ms

    def to_wire(self) -> dict[str, object]:
        """Serialise to the canonical JSON mapping."""
        return {
            "text": self.text,
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
            "confidence": self.confidence,
            "speaker": self.speaker,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> TranscriptWord:
        """Rebuild from what :meth:`to_wire` wrote."""
        _reject_unknown_fields(data, _WORD_FIELDS)
        raw_speaker = data["speaker"]
        if raw_speaker is not None and not isinstance(raw_speaker, str):
            raise NovaInvariantError("speaker must be a string or null")
        return cls(
            text=_wire_str(data, "text"),
            start_ms=_wire_int(data, "start_ms"),
            end_ms=_wire_int(data, "end_ms"),
            confidence=_wire_float(data, "confidence"),
            speaker=raw_speaker,
        )


@dataclass(frozen=True, slots=True)
class TranscriptSegment:
    """One stretch of speech: the unit a caption cue is built from."""

    start_ms: int
    end_ms: int
    index: int = 0
    text: str = ""
    words: tuple[TranscriptWord, ...] = ()
    confidence: float = 1.0
    speaker: str | None = None

    def __post_init__(self) -> None:
        if self.start_ms < 0 or self.end_ms < self.start_ms:
            raise NovaInvariantError(
                f"segment times must be non-negative and ordered, got "
                f"[{self.start_ms}, {self.end_ms}]"
            )
        if not 0.0 <= self.confidence <= 1.0:
            raise NovaInvariantError(
                f"confidence must be between 0.0 and 1.0, got {self.confidence}"
            )
        if self.index < 0:
            raise NovaInvariantError(f"index must not be negative, got {self.index}")
        for word in self.words:
            # Providers drift by a few milliseconds; the adapter clamps before
            # constructing, because a word outside its own segment is the bug
            # that shows as a caption appearing before its line begins.
            if word.start_ms < self.start_ms or word.end_ms > self.end_ms:
                raise NovaInvariantError(
                    f"word [{word.start_ms}, {word.end_ms}] falls outside its segment "
                    f"[{self.start_ms}, {self.end_ms}]; clamp it in the adapter"
                )

    @property
    def duration_ms(self) -> int:
        """How long the segment lasts."""
        return self.end_ms - self.start_ms

    @property
    def word_count(self) -> int:
        """Words in this segment."""
        return len(self.words)

    @property
    def text_or_derived(self) -> str:
        """The segment text, derived from its words when text was not supplied."""
        return self.text or " ".join(word.text for word in self.words)

    def clamp_to(self, duration_ms: int) -> TranscriptSegment:
        """Return the segment trimmed to fit inside an audio of ``duration_ms``.

        The last segment of a file routinely extends past the end because a
        decoder reports a slightly longer stream than the model was given.
        """
        if duration_ms < 0:
            raise NovaInvariantError(f"duration_ms must not be negative, got {duration_ms}")
        end = min(self.end_ms, duration_ms)
        start = min(self.start_ms, end)
        words = tuple(
            replace(word, start_ms=min(word.start_ms, end), end_ms=min(word.end_ms, end))
            if word.end_ms > end
            else word
            for word in self.words
        )
        return replace(self, start_ms=start, end_ms=end, words=words)

    def to_wire(self) -> dict[str, object]:
        """Serialise to the canonical JSON mapping."""
        return {
            "index": self.index,
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
            "text": self.text,
            "words": [word.to_wire() for word in self.words],
            "confidence": self.confidence,
            "speaker": self.speaker,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> TranscriptSegment:
        """Rebuild from what :meth:`to_wire` wrote."""
        _reject_unknown_fields(data, _SEGMENT_FIELDS)
        raw_words = data["words"]
        raw_speaker = data["speaker"]
        if not isinstance(raw_words, Sequence) or isinstance(raw_words, str | bytes):
            raise NovaInvariantError("words must be a list")
        if raw_speaker is not None and not isinstance(raw_speaker, str):
            raise NovaInvariantError("speaker must be a string or null")
        return cls(
            index=_wire_int(data, "index"),
            start_ms=_wire_int(data, "start_ms"),
            end_ms=_wire_int(data, "end_ms"),
            text=_wire_str(data, "text"),
            words=tuple(
                TranscriptWord.from_wire(word) for word in raw_words if isinstance(word, Mapping)
            ),
            confidence=_wire_float(data, "confidence"),
            speaker=raw_speaker,
        )


@dataclass(frozen=True, slots=True)
class Transcript:
    """A normalised transcription: what every provider must return.

    Immutable, JSON-serialisable and provider-agnostic — the three properties
    that let the pipeline after ``Transcribe`` be pure and therefore testable
    with no model weights anywhere on the machine (ADR-0009, Consequences).
    """

    segments: tuple[TranscriptSegment, ...] = ()
    language: str = ""
    model: str = ""
    audio_duration_ms: int = 0
    #: Set when this transcript is a translation of another one.
    translated_from: str | None = None

    def __post_init__(self) -> None:
        if self.language and not is_language_tag(self.language):
            raise NovaInvariantError(f"{self.language!r} is not a BCP-47 language tag")
        if self.audio_duration_ms < 0:
            raise NovaInvariantError(
                f"audio_duration_ms must not be negative, got {self.audio_duration_ms}"
            )
        for position, segment in enumerate(self.segments):
            if segment.index != position:
                raise NovaInvariantError(
                    f"segment indices must be sequential from 0, got {segment.index} "
                    f"at position {position}"
                )
            if position and segment.start_ms < self.segments[position - 1].end_ms:
                raise NovaInvariantError(
                    f"segment {position} starts at {segment.start_ms} before the previous "
                    f"segment ends at {self.segments[position - 1].end_ms}"
                )

    # -- derived views ----------------------------------------------------

    @property
    def duration_ms(self) -> int:
        """The longer of the last segment's end and the known audio duration."""
        last = max((segment.end_ms for segment in self.segments), default=0)
        return max(last, self.audio_duration_ms)

    @property
    def word_count(self) -> int:
        """Words across every segment."""
        return sum(segment.word_count for segment in self.segments)

    @property
    def is_empty(self) -> bool:
        """True when nothing was recognised at all."""
        return not self.segments

    @property
    def has_word_timings(self) -> bool:
        """Whether every segment carries word timings."""
        return bool(self.segments) and all(segment.words for segment in self.segments)

    def speakers(self) -> tuple[str, ...]:
        """Distinct speaker labels, in the order they first appear."""
        found: list[str] = []
        for segment in self.segments:
            label = segment.speaker
            if label is None:
                for word in segment.words:
                    if word.speaker is not None:
                        label = word.speaker
                        break
            if label is not None and label not in found:
                found.append(label)
        return tuple(found)

    def text(self) -> str:
        """The whole transcript as one string, segments separated by newlines."""
        return "\n".join(segment.text_or_derived for segment in self.segments)

    def clamped(self, duration_ms: int) -> Transcript:
        """Return the transcript trimmed to fit an audio of ``duration_ms``.

        A segment that lies entirely past the end is *dropped* rather than
        collapsed to zero length: a cue that shows for no time at all is worse
        than no cue, and a zero-duration segment fails validation.  Indices are
        renumbered so they stay sequential, which
        :meth:`__post_init__` requires.
        """
        kept = [
            segment
            for segment in (item.clamp_to(duration_ms) for item in self.segments)
            if segment.duration_ms > 0
        ]
        return replace(
            self,
            audio_duration_ms=duration_ms,
            segments=tuple(
                replace(segment, index=position) for position, segment in enumerate(kept)
            ),
        )

    # -- persistence ------------------------------------------------------

    def to_wire(self) -> dict[str, object]:
        """Serialise to the canonical JSON mapping.

        Used for the external-transcript provider's JSON import, for caching a
        transcription next to a project, and for attaching one to a bug report.
        """
        return {
            "language": self.language,
            "model": self.model,
            "audio_duration_ms": self.audio_duration_ms,
            "translated_from": self.translated_from,
            "segments": [segment.to_wire() for segment in self.segments],
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> Transcript:
        """Rebuild from what :meth:`to_wire` wrote."""
        _reject_unknown_fields(data, _TRANSCRIPT_FIELDS)
        raw_segments = data["segments"]
        raw_translated = data["translated_from"]
        if not isinstance(raw_segments, Sequence) or isinstance(raw_segments, str | bytes):
            raise NovaInvariantError("segments must be a list")
        if raw_translated is not None and not isinstance(raw_translated, str):
            raise NovaInvariantError("translated_from must be a string or null")
        return cls(
            segments=tuple(
                TranscriptSegment.from_wire(segment)
                for segment in raw_segments
                if isinstance(segment, Mapping)
            ),
            language=_wire_str(data, "language"),
            model=_wire_str(data, "model"),
            audio_duration_ms=_wire_int(data, "audio_duration_ms"),
            translated_from=raw_translated,
        )


@dataclass(frozen=True, slots=True)
class SpeechRegion:
    """A stretch of audio that contains speech, as decided by a VAD pass.

    Regions are used twice: to trim silence before transcription (so a model
    does not hallucinate over thirty seconds of room tone) and to keep the
    offsets by which the alignment pass's timings are later corrected.
    """

    start_ms: int
    end_ms: int
    confidence: float = 1.0

    def __post_init__(self) -> None:
        if self.start_ms < 0 or self.end_ms < self.start_ms:
            raise NovaInvariantError(
                f"region times must be non-negative and ordered, got "
                f"[{self.start_ms}, {self.end_ms}]"
            )
        if not 0.0 <= self.confidence <= 1.0:
            raise NovaInvariantError(
                f"confidence must be between 0.0 and 1.0, got {self.confidence}"
            )

    @property
    def duration_ms(self) -> int:
        """How long the region lasts."""
        return self.end_ms - self.start_ms

    def to_wire(self) -> dict[str, object]:
        """Serialise to the canonical JSON mapping."""
        return {
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
            "confidence": self.confidence,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> SpeechRegion:
        """Rebuild from what :meth:`to_wire` wrote."""
        _reject_unknown_fields(data, _REGION_FIELDS)
        return cls(
            start_ms=_wire_int(data, "start_ms"),
            end_ms=_wire_int(data, "end_ms"),
            confidence=_wire_float(data, "confidence"),
        )


def merge_regions(
    regions: Sequence[SpeechRegion], *, max_gap_ms: int = 250
) -> tuple[SpeechRegion, ...]:
    """Close gaps shorter than ``max_gap_ms`` between speech regions.

    A VAD splits on every breath; transcribing each sliver separately loses the
    context a language model needs and produces clipped captions.  Merging up to
    a quarter second keeps sentences together without swallowing real pauses.

    Args:
        regions: Regions in any order; they are sorted here.
        max_gap_ms: Largest silence to bridge.  ``0`` merges only overlaps.

    Returns:
        A new ordered, non-overlapping tuple of regions.
    """
    if max_gap_ms < 0:
        raise NovaInvariantError(f"max_gap_ms must not be negative, got {max_gap_ms}")
    if not regions:
        return ()
    ordered = sorted(regions, key=lambda region: (region.start_ms, region.end_ms))
    merged: list[SpeechRegion] = [ordered[0]]
    for region in ordered[1:]:
        previous = merged[-1]
        if region.start_ms - previous.end_ms <= max_gap_ms:
            merged[-1] = SpeechRegion(
                start_ms=previous.start_ms,
                end_ms=max(previous.end_ms, region.end_ms),
                confidence=min(previous.confidence, region.confidence),
            )
        else:
            merged.append(region)
    return tuple(merged)


def validate_transcript(transcript: Transcript) -> str:
    """Return why ``transcript`` cannot be used, or ``""`` when it is sound.

    ADR-0009 §4 turns silent corruption into a reported error: an empty word
    list, a timestamp going backwards or a cue past the end of the audio each
    become ``Err(NS-CAPTION-4004)`` carrying this sentence, rather than a
    caption track that is subtly wrong for the length of a film.

    The checks are the ones a transcript can fail *after* construction, because
    construction itself already refuses the states it can see.
    """
    if transcript.is_empty:
        return "the transcript contains no segments"
    if transcript.has_word_timings is False and any(
        segment.words for segment in transcript.segments
    ):
        return "some segments carry word timings and others do not"
    for segment in transcript.segments:
        if segment.end_ms == segment.start_ms:
            return f"segment {segment.index} has zero duration"
        previous_end = 0
        for word in segment.words:
            if word.start_ms < previous_end:
                return f"segment {segment.index} has a word that starts before the previous ends"
            previous_end = word.end_ms
    if transcript.audio_duration_ms and transcript.duration_ms > transcript.audio_duration_ms:
        return "the transcript extends past the end of the audio"
    return ""


def frames_for_ms(
    milliseconds: int, timebase: Timebase, rounding: Rounding = Rounding.FLOOR
) -> int:
    """Convert a transcript position to a timeline frame, with stated rounding.

    A cut boundary rounds down (a caption includes the frame it starts on);
    display values round to nearest-even.  Passing the mode explicitly is what
    keeps a caption's start frame and its displayed timecode from disagreeing
    (ADR-0006).
    """
    if milliseconds < 0:
        raise NovaInvariantError(f"milliseconds must not be negative, got {milliseconds}")
    return seconds_to_frames(Decimal(milliseconds) / Decimal(1000), timebase, rounding)


# -- wire helpers -------------------------------------------------------------

_WORD_FIELDS: Final[set[str]] = {"text", "start_ms", "end_ms", "confidence", "speaker"}
_SEGMENT_FIELDS: Final[set[str]] = {
    "index",
    "start_ms",
    "end_ms",
    "text",
    "words",
    "confidence",
    "speaker",
}
_TRANSCRIPT_FIELDS: Final[set[str]] = {
    "language",
    "model",
    "audio_duration_ms",
    "translated_from",
    "segments",
}
_REGION_FIELDS: Final[set[str]] = {"start_ms", "end_ms", "confidence"}


def _reject_unknown_fields(data: Mapping[str, object], expected: set[str]) -> None:
    if set(data) != expected:
        raise NovaInvariantError(
            f"fields must be exactly {sorted(expected)}, got {sorted(str(key) for key in data)}"
        )


def _wire_int(data: Mapping[str, object], key: str) -> int:
    raw = data[key]
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise NovaInvariantError(f"{key!r} must be an int, got {type(raw).__name__}")
    return raw


def _wire_str(data: Mapping[str, object], key: str) -> str:
    raw = data[key]
    if not isinstance(raw, str):
        raise NovaInvariantError(f"{key!r} must be a str, got {type(raw).__name__}")
    return raw


def _wire_float(data: Mapping[str, object], key: str) -> float:
    raw = data[key]
    if isinstance(raw, bool) or not isinstance(raw, int | float):
        raise NovaInvariantError(f"{key!r} must be a number, got {type(raw).__name__}")
    return float(raw)
