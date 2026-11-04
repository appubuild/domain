"""L3 — where a transcript becomes a caption document (ADR-0009 §1, §2, §4).

This is the seam the whole engine is designed around. On one side sits a
:class:`~nova_studio.domain.asr.Transcript`: whatever a provider produced, or
whatever a file contained, or whatever a human typed. On the other sits a
:class:`~nova_studio.domain.captions.CaptionDocument`: the authoring source of
truth, with words, characters, speakers and layers.

Three decisions live in this one function:

**A transcript is validated before it is believed.** ADR-0009 §4 exists because
a transcript can be constructed and still be wrong — timestamps going
backwards, times past the end of the audio, some segments with word timings and
some without. Those become ``Err(NS-CAPTION-4004)`` carrying the sentence
:func:`~nova_studio.domain.asr.validate_transcript` produced, rather than a
caption track that is subtly wrong for the length of a film.

**Nothing from the provider leaks past this line.** The document holds
:class:`~nova_studio.domain.captions.CaptionWord` values, never a provider's own
word object. That is what makes re-transcription with a different model a
dropdown change rather than a migration.

**Word timings are preserved; character timings are derived and marked.** A
provider that supplies character timings is believed. One that supplies only
words gets :func:`~nova_studio.domain.captions.split_chars`, whose every
character is flagged ``estimated`` — so the UI can say "estimated", the
karaoke animation stays honest, and a later forced-alignment pass can replace
the guess with a measurement without anyone pretending the guess was one.
"""

from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING

from nova_studio.core.errors import ErrorDomain, NovaError
from nova_studio.core.result import Result, failed, ok
from nova_studio.domain.asr import TranscriptSegment, validate_transcript
from nova_studio.domain.captions import (
    CAPTION_MIN_DURATION_MS,
    DEFAULT_LAYER_ID,
    CaptionChar,
    CaptionDocument,
    CaptionLayer,
    CaptionSegment,
    CaptionWord,
    split_chars,
)
from nova_studio.ports.asr import AsrErrorCode
from nova_studio.services.captions.timing import held_until

if TYPE_CHECKING:
    from collections.abc import Sequence

    from nova_studio.domain.asr import Transcript

__all__ = ["document_from_transcript", "segments_from_transcript"]


def document_from_transcript(
    transcript: Transcript,
    *,
    layer: CaptionLayer | None = None,
    layer_id: str = DEFAULT_LAYER_ID,
    with_chars: bool = True,
    min_duration_ms: int = CAPTION_MIN_DURATION_MS,
) -> Result[CaptionDocument]:
    """Turn a transcript into the document the rest of the pipeline edits.

    Args:
        transcript: What a provider, a file or a human produced.
        layer: The layer the cues belong on — a translation layer for a
            translated transcript, a commentary layer for sound descriptions.
            Defaults to the primary layer.
        layer_id: Which layer each cue is filed under.  Ignored when ``layer``
            is given.
        with_chars: Derive character timings for words that have none.  Turn
            this off for the rare provider whose text animates better without
            them, and for a plain import that will be re-aligned anyway.
        min_duration_ms: How short a cue may be before it is held longer.  A
            transcript fresh from a provider is full of 200 ms fragments that
            nobody can read; this is the same rule the Break stage applies, so a
            document is showable the moment it is built and not only after a
            re-break.

    Returns:
        ``Ok(document)``, or ``Err`` with
        :attr:`~nova_studio.ports.asr.AsrErrorCode.ALIGNMENT_FAILED` and the
        sentence saying what is wrong with the transcript.
    """
    problem = validate_transcript(transcript)
    if problem:
        return failed(
            NovaError(
                code=AsrErrorCode.ALIGNMENT_FAILED,
                message=f"the transcript cannot be used as captions: {problem}",
                domain=ErrorDomain.CAPTION,
                remedy="Re-transcribe the clip, or fix the file and import it again.",
                details={"language": transcript.language},
                retryable=True,
            )
        )

    chosen = layer or CaptionLayer.primary(language=transcript.language)
    if layer is None and layer_id != DEFAULT_LAYER_ID:
        chosen = replace(chosen, layer_id=layer_id)

    segments = segments_from_transcript(
        transcript,
        layer_id=chosen.layer_id,
        with_chars=with_chars,
        min_duration_ms=min_duration_ms,
    )
    return ok(
        CaptionDocument(
            segments=segments,
            layers=(chosen,),
            language=transcript.language or transcript.translated_from or "",
        )
    )


def segments_from_transcript(
    transcript: Transcript,
    *,
    layer_id: str = DEFAULT_LAYER_ID,
    with_chars: bool = True,
    min_duration_ms: int = CAPTION_MIN_DURATION_MS,
) -> tuple[CaptionSegment, ...]:
    """The cues of a transcript, with their words and derived characters.

    Separate from :func:`document_from_transcript` so a caller that already has
    a document — a translation pass, a re-transcription — can build one layer's
    cues without being handed a whole document it then has to take apart.
    """
    source: Sequence[TranscriptSegment] = transcript.segments
    cues: list[CaptionSegment] = []
    for position, source_segment in enumerate(source):
        next_start = source[position + 1].start_ms if position + 1 < len(source) else None
        end_ms = held_until(
            source_segment.start_ms,
            source_segment.end_ms,
            min_duration_ms=min_duration_ms,
            next_start=next_start,
        )
        words = _words_of(source_segment, with_chars=with_chars)
        cues.append(
            CaptionSegment(
                index=position,
                start_ms=source_segment.start_ms,
                end_ms=end_ms,
                text=source_segment.text_or_derived,
                words=words,
                # A word may name a speaker the segment does not, and the other
                # way round; the word is the more precise of the two.
                speaker=source_segment.speaker or _speaker_of(words),
                layer_id=layer_id,
                confidence=source_segment.confidence,
            )
        )
    return tuple(cues)


def _words_of(segment: TranscriptSegment, *, with_chars: bool) -> tuple[CaptionWord, ...]:
    """The segment's words, with character timings where they can be had.

    No clamping here: :func:`~nova_studio.domain.asr.validate_transcript` has
    already refused words that overlap or stray outside their segment, and a
    clamp that can never fire is a clamp nobody can test.
    """
    words: list[CaptionWord] = []
    for source_word in segment.words:
        text = source_word.text.strip()
        if not text:
            # Providers emit empty words for leading and trailing silence.
            continue
        words.append(
            CaptionWord(
                text=text,
                start_ms=source_word.start_ms,
                end_ms=source_word.end_ms,
                confidence=source_word.confidence,
                speaker=source_word.speaker,
                chars=_chars_of(
                    text, source_word.start_ms, source_word.end_ms, with_chars=with_chars
                ),
            )
        )
    return tuple(words)


def _chars_of(
    text: str, start_ms: int, end_ms: int, *, with_chars: bool
) -> tuple[CaptionChar, ...]:
    """Character timings: measured if the provider had them, derived if not.

    Derived characters are every one of them flagged ``estimated`` by
    :func:`~nova_studio.domain.captions.split_chars`, which is what lets the UI
    show "estimated" and a later forced-alignment pass replace the guess.
    """
    if not with_chars:
        return ()
    return split_chars(text, start_ms, end_ms)


def _speaker_of(words: tuple[CaptionWord, ...]) -> str | None:
    """The speaker the words agree on, or nothing when they disagree."""
    named = {word.speaker for word in words if word.speaker}
    return next(iter(named)) if len(named) == 1 else None
