"""L3 — where a transcript becomes a caption document (ADR-0009 §1, §2, §4).

This is the seam the whole engine is designed around. On one side sits a
:class:`~nova_studio.domain.asr.Transcript`: whatever a provider produced, or
whatever a file contained, or whatever a human typed. On the other sits a
:class:`~nova_studio.domain.captions.CaptionDocument`: the authoring source of
truth, with cues, words, characters, speakers and layers.

Four decisions live in this one function, and the breaking itself is *not* one
of them — that is :mod:`services.captions.segmentation`, shared with the Break
stage, because a document must be readable the moment it exists and a re-break
must produce the same answer.

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

**A document is a thing that can be shown.** Cues get a layer, a language and
sequential indices, so what comes back is a document the pipeline can edit and
the timeline can commit — not a bag of cues the caller has to assemble.
"""

from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING

from nova_studio.core.errors import ErrorDomain, NovaError
from nova_studio.core.result import Result, failed, ok
from nova_studio.domain.asr import validate_transcript
from nova_studio.domain.captions import (
    DEFAULT_LAYER_ID,
    CaptionDocument,
    CaptionLayer,
    CaptionSegment,
)
from nova_studio.ports.asr import AsrErrorCode
from nova_studio.services.captions.segmentation import DEFAULT_CUE_RULES, CueRules, build_cues

if TYPE_CHECKING:
    from nova_studio.domain.asr import Transcript

__all__ = ["document_from_transcript", "segments_from_transcript"]


def document_from_transcript(
    transcript: Transcript,
    *,
    layer: CaptionLayer | None = None,
    layer_id: str = DEFAULT_LAYER_ID,
    rules: CueRules = DEFAULT_CUE_RULES,
) -> Result[CaptionDocument]:
    """Turn a transcript into the document the rest of the pipeline edits.

    Args:
        transcript: What a provider, a file or a human produced.
        layer: The layer the cues belong on — a translation layer for a
            translated transcript, a commentary layer for sound descriptions.
            Defaults to the primary layer.
        layer_id: Which layer each cue is filed under.  Ignored when ``layer``
            is given.
        rules: The house style to break to.

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

    cues = segments_from_transcript(transcript, layer_id=chosen.layer_id, rules=rules)
    return ok(
        CaptionDocument(
            segments=cues,
            layers=(chosen,),
            language=transcript.language or transcript.translated_from or "",
        )
    )


def segments_from_transcript(
    transcript: Transcript,
    *,
    layer_id: str = DEFAULT_LAYER_ID,
    rules: CueRules = DEFAULT_CUE_RULES,
) -> tuple[CaptionSegment, ...]:
    """The cues of a transcript, filed under one layer.

    Separate from :func:`document_from_transcript` so a caller that already has
    a document — a translation pass, a re-transcription — can build one layer's
    cues without being handed a whole document it then has to take apart.
    """
    return tuple(replace(cue, layer_id=layer_id) for cue in build_cues(transcript, rules))
