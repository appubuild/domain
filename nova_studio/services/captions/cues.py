"""L3 — the Break stage: re-breaking a document's cues (ADR-0009 §3).

:mod:`services.captions.segmentation` owns *the rule*: which words a viewer
reads together, and how long they stay up. This module owns *the stage*: the
same rule, applied to a document that already exists.

That distinction is the whole module, and it is worth having. A first pass runs
the rule over a transcript (:func:`~services.captions.build.document_from_transcript`),
which is why a document is showable the moment it is built. Everything after
that is an edit — a re-transcription, a new house style, a project cropped to
vertical — and an edit does not start from a transcript; it starts from cues
that may be locked, styled, positioned and carrying corrections nobody wants
re-flowed.

So the stage adds the four things a transcript does not have:

* **A locked cue is passed through untouched.** Locking is how an editor says
  "I have fixed this line"; re-flowing it is the fastest way there is to lose
  hours of corrections (ADR-0009 §7).
* **The words are carried, not rebuilt.** The breaker hands back the very
  objects it was given, so character timings, per-word confidence and highlight
  flags survive a re-break — which is what keeps karaoke working after it.
* **What an editor chose is kept.** Layer, position, style overrides and the
  cue's own confidence travel from the old cue to the new ones.
* **Nothing overlaps.** Every cue is bounded by the next, so a document that
  validated before the stage validates after it.

The rules themselves live in :class:`~services.captions.segmentation.CueRules`
and nowhere else: a TikTok break and a documentary break differ by one object,
not by a second code path — and a second code path here is exactly how "the
presets disagree about where the line goes" starts.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING, Final

from nova_studio.core.result import Result, ok
from nova_studio.domain.captions import CaptionSegment, CaptionWord
from nova_studio.services.captions.segmentation import (
    DEFAULT_CUE_RULES,
    CueRules,
    CueSpan,
    cue_spans,
)

if TYPE_CHECKING:
    from nova_studio.domain.captions import CaptionDocument
    from nova_studio.services.captions.pipeline import StageContext

__all__ = ["DEFAULT_BREAK_RULES", "CueBreaker"]


#: The rules a fresh breaker is built with, named so a caller can say
#: ``CueBreaker(rules=replace(DEFAULT_BREAK_RULES, max_chars_per_line=20))``
#: without importing the module that owns them.
DEFAULT_BREAK_RULES: Final[CueRules] = DEFAULT_CUE_RULES


@dataclass(frozen=True, slots=True, kw_only=True)
class CueBreaker:
    """The Break stage: group a document's words into readable cues.

    A value rather than a function so a pipeline can carry its own settings —
    the same class in one pipeline breaks to the broadcast default and in
    another to twenty characters a line.
    """

    #: The stage's name in the pipeline.
    name: str = "break"
    #: How to break.  The stage does *not* read the line budget from
    #: ``StageContext``: how much text fits on a line is a house style, and a
    #: house style belongs to the pipeline that was built for it, not to the
    #: frame the project happens to be.
    rules: CueRules = field(default_factory=CueRules)

    def apply(self, document: CaptionDocument, ctx: StageContext) -> Result[CaptionDocument]:
        """Re-break every unlocked cue, leaving locked ones exactly as they are."""
        rebuilt: list[CaptionSegment] = []
        for segment in document.segments:
            if segment.locked or not segment.words:
                # Locked: the user's line, not the engine's to re-flow.
                # Wordless: there is nothing to re-break without inventing
                # timings, and inventing timings is a provider's job.
                rebuilt.append(segment)
                continue
            rebuilt.extend(
                self._cue(span, segment) for span in cue_spans(segment.words, self.rules)
            )
        return ok(replace(document, segments=tuple(rebuilt)).reindexed())

    def _cue(self, span: CueSpan[CaptionWord], segment: CaptionSegment) -> CaptionSegment:
        """One document cue from one span, wearing what the old cue wore."""
        return CaptionSegment(
            index=0,  # the document reindexes
            start_ms=span.start_ms,
            end_ms=span.end_ms,
            text=span.text,
            words=span.words,
            speaker=_speaker_of(span.words) or segment.speaker,
            layer_id=segment.layer_id,
            position=segment.position,
            style_overrides=segment.style_overrides,
            confidence=_confidence_of(span.words, segment),
        )


def _speaker_of(words: tuple[CaptionWord, ...]) -> str | None:
    """Whose line this is, by the words' say-so.

    A span never holds two speakers — :class:`CueRules` breaks on a change — so
    the only question is whether the words carry a name at all.
    """
    named = {word.speaker for word in words if word.speaker}
    return next(iter(named)) if len(named) == 1 else None


def _confidence_of(words: tuple[CaptionWord, ...], segment: CaptionSegment) -> float | None:
    """A cue is as certain as its least certain word.

    The worst word rather than the best: one misheard name in a line is the
    thing an editor has to find, and averaging it away is how a review pass
    misses it.
    """
    confidences = [word.confidence for word in words if word.confidence is not None]
    if confidences:
        return min(confidences)
    return segment.confidence
