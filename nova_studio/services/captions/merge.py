"""L3 — regeneration: a new transcription that keeps the user's work (ADR-0009 §7).

Re-transcription is the moment a caption tool destroys hours of work. The clip
is re-run through a better model, and every correction the editor made — the
name spelled right, the line split where they wanted it, the cue moved off a
face — disappears, because the tool stored captions as *text* and the new
transcription is new text.

This module is the antidote, and it has exactly one idea: **a human edit is a
delta filed under a key, not a change to a string.**
:func:`~nova_studio.domain.captions.alignment_key` is normalised text plus a
*bucketed* start time, so a re-transcription that moves a cue 300 ms or
re-punctuates the sentence produces the same key and the correction re-attaches.
:func:`~nova_studio.domain.captions.merge_deltas` does the matching; this module
is the workflow around it.

The workflow answers the four questions a regeneration actually raises:

**What happens to a locked cue?** It is not re-transcribed. Any new cue that
overlaps it is dropped and the locked one is kept — locking is the promise that
a regeneration will not touch this line, and a promise kept only for cues that
happen to match would be no promise at all.

**What happens to the other layers?** They are kept. Re-transcribing the primary
language must not throw away the translation layer (ADR-0009 §8): a second
`CaptionLayer` is a separate piece of work with its own history.

**What happens to edits that cannot be re-attached?** They are *returned*, in
:attr:`CaptionRegeneration.unmatched`, for the review list. Silently guessing
would be worse than asking: a correction attached to the wrong cue is a wrong
caption with the user's name on it.

**What happens to word timings under a text edit?** They are dropped, and the
key is reported in :attr:`~CaptionMergeOutcome.timings_dropped`. A corrected
line's words are the new text's words; pretending the old timings still apply is
how karaoke ends up highlighting the wrong syllable. Reporting it means the UI
can offer a forced-alignment pass.

Recording is the other half: :func:`record_text_edit` and friends turn what the
editor just did into a delta, and :func:`apply_edit` both applies it and files
it — because an edit applied but not recorded is an edit the next regeneration
will eat.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import TYPE_CHECKING

from nova_studio.core.errors import ErrorDomain, NovaError
from nova_studio.core.result import Result, failed, ok
from nova_studio.domain.asr import validate_transcript
from nova_studio.domain.captions import (
    DEFAULT_LAYER_ID,
    DEFAULT_MERGE_TOLERANCE_MS,
    CaptionDelta,
    CaptionDeltaKind,
    CaptionMergeOutcome,
    CaptionSegment,
    CaptionTarget,
    alignment_key,
    merge_deltas,
)
from nova_studio.ports.asr import AsrErrorCode
from nova_studio.services.captions.codes import CaptionErrorCode
from nova_studio.services.captions.segmentation import DEFAULT_CUE_RULES, CueRules, build_cues

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

    from nova_studio.domain.asr import Transcript
    from nova_studio.domain.captions import CaptionDocument, CaptionRevision

__all__ = [
    "CaptionRegeneration",
    "apply_edit",
    "record_deletion",
    "record_insertion",
    "record_style_edit",
    "record_text_edit",
    "record_timing_edit",
    "regenerate",
]


@dataclass(frozen=True, slots=True)
class CaptionRegeneration:
    """What a regeneration did, including what it could not do.

    Deliberately *not* an error: a regeneration that re-attached nine
    corrections out of ten is nine corrections saved, and throwing the tenth
    away along with them is the behaviour this module exists to prevent. The
    caller shows the review list and lets the user decide.
    """

    #: The document: new base, locked cues kept, surviving edits re-applied.
    document: CaptionDocument
    #: What :func:`merge_deltas` did with the edit overlay.
    outcome: CaptionMergeOutcome
    #: Locked cues that were kept instead of re-transcribed.
    locked: tuple[CaptionSegment, ...] = ()

    @property
    def applied(self) -> tuple[CaptionDelta, ...]:
        """The corrections that found a home."""
        return self.outcome.applied

    @property
    def unmatched(self) -> tuple[CaptionDelta, ...]:
        """The corrections that did not — the review list."""
        return self.outcome.unmatched

    @property
    def timings_dropped(self) -> tuple[str, ...]:
        """Cues whose word timings a text edit invalidated."""
        return self.outcome.timings_dropped

    @property
    def needs_review(self) -> bool:
        """Whether the user must look at anything before trusting the result."""
        return self.outcome.needs_review

    def review(self) -> str:
        """One sentence for the review panel, or ``""`` when there is nothing."""
        if not self.needs_review:
            return ""
        parts = [f"{len(self.applied)} correction(s) re-attached"]
        if self.unmatched:
            parts.append(f"{len(self.unmatched)} could not be matched")
        if self.timings_dropped:
            parts.append(f"{len(self.timings_dropped)} cue(s) need re-aligning")
        return ", ".join(parts) + "."


def regenerate(
    document: CaptionDocument,
    transcript: Transcript,
    *,
    rules: CueRules = DEFAULT_CUE_RULES,
    layer_id: str = DEFAULT_LAYER_ID,
    tolerance_ms: int = DEFAULT_MERGE_TOLERANCE_MS,
    revision: CaptionRevision | None = None,
) -> Result[CaptionRegeneration]:
    """Fold a new transcription into a document that carries human edits.

    Args:
        document: What the project has now — cues, edits, locked lines.
        transcript: What the provider just said, freshly.
        rules: The house style to break the new base to.
        layer_id: Which layer the transcription belongs to.  Cues on every
            other layer are carried over untouched.
        tolerance_ms: How far from its original timing a correction may drift
            and still be re-attached by text match.
        revision: The revision to record, if the caller has a clock and an id
            generator to hand.  A builder that invented its own history would
            be untestable.

    Returns:
        ``Ok`` with the regenerated document and the review list, or ``Err``
        with :attr:`~nova_studio.ports.asr.AsrErrorCode.ALIGNMENT_FAILED` when
        the transcript itself cannot be trusted.
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

    fresh = tuple(replace(cue, layer_id=layer_id) for cue in build_cues(transcript, rules))
    kept = tuple(cue for cue in document.segments if cue.layer_id != layer_id)
    base, locked = _keep_locked((*fresh, *kept), document.segments)

    outcome = merge_deltas(base, document.edits, tolerance_ms=tolerance_ms)
    rebuilt = replace(
        document,
        segments=outcome.segments,
        language=transcript.language or document.language,
        revisions=(*document.revisions, revision) if revision else document.revisions,
    )
    return ok(CaptionRegeneration(document=rebuilt, outcome=outcome, locked=locked))


# -- recording what the editor did -------------------------------------------


def record_text_edit(
    cue: CaptionSegment,
    after: str,
    *,
    created_ms: int,
    revision_id: str | None = None,
) -> CaptionDelta:
    """A delta for "this line says this now"."""
    return CaptionDelta(
        key=cue.key,
        kind=CaptionDeltaKind.TEXT,
        target=CaptionTarget.SEGMENT,
        before=cue.text,
        after=after,
        created_ms=created_ms,
        revision_id=revision_id,
    )


def record_timing_edit(
    cue: CaptionSegment,
    start_ms: int,
    end_ms: int,
    *,
    created_ms: int,
    revision_id: str | None = None,
) -> CaptionDelta:
    """A delta for "this line belongs here now"."""
    return CaptionDelta(
        key=cue.key,
        kind=CaptionDeltaKind.TIMING,
        target=CaptionTarget.SEGMENT,
        before=f"{cue.start_ms}:{cue.end_ms}",
        after=f"{start_ms}:{end_ms}",
        start_ms=start_ms,
        end_ms=end_ms,
        created_ms=created_ms,
        revision_id=revision_id,
    )


def record_style_edit(
    cue: CaptionSegment,
    style: Mapping[str, object],
    *,
    created_ms: int,
    revision_id: str | None = None,
) -> CaptionDelta:
    """A delta for "this line looks like this now".

    The style rides in ``style``, not in ``before``/``after``: a style is a
    mapping, and flattening it into a string is how a delta stops being
    comparable and starts being prose.
    """
    return CaptionDelta(
        key=cue.key,
        kind=CaptionDeltaKind.STYLE,
        target=CaptionTarget.SEGMENT,
        style=dict(style),
        created_ms=created_ms,
        revision_id=revision_id,
    )


def record_deletion(
    cue: CaptionSegment,
    *,
    created_ms: int,
    revision_id: str | None = None,
) -> CaptionDelta:
    """A delta for "this line should not be here"."""
    return CaptionDelta(
        key=cue.key,
        kind=CaptionDeltaKind.DELETE,
        target=CaptionTarget.SEGMENT,
        before=cue.text,
        created_ms=created_ms,
        revision_id=revision_id,
    )


def record_insertion(
    text: str,
    start_ms: int,
    end_ms: int | None = None,
    *,
    created_ms: int,
    revision_id: str | None = None,
) -> CaptionDelta:
    """A delta for a cue the user typed, which has no original to match."""
    return CaptionDelta(
        key=alignment_key(text, start_ms),
        kind=CaptionDeltaKind.INSERT,
        target=CaptionTarget.SEGMENT,
        after=text,
        start_ms=start_ms,
        end_ms=end_ms,
        created_ms=created_ms,
        revision_id=revision_id,
    )


def apply_edit(
    document: CaptionDocument,
    delta: CaptionDelta,
    *,
    tolerance_ms: int = DEFAULT_MERGE_TOLERANCE_MS,
) -> Result[CaptionDocument]:
    """Apply a recorded edit now, and file it for the next regeneration.

    Both halves or neither: an edit applied but not recorded is an edit the next
    re-transcription will eat, and one recorded but not applied is a lie the
    user can see on screen.

    Raises:
        Returns ``Err`` with :attr:`CaptionErrorCode.MERGE_CONFLICT` when the
        delta matches no cue — a cue edited out from under the editor, or a key
        that no longer exists. Guessing which cue was meant is how a correction
        lands on the wrong line.
    """
    outcome = merge_deltas(document.segments, (delta,), tolerance_ms=tolerance_ms)
    if outcome.unmatched:
        return failed(
            NovaError(
                code=CaptionErrorCode.MERGE_CONFLICT,
                message=(
                    f"the edit under {delta.key!r} matches no cue in this document; "
                    "the cue it was made on is gone"
                ),
                domain=ErrorDomain.CAPTION,
                remedy="Re-apply the edit to the cue you meant, or undo and try again.",
                details={"key": delta.key, "kind": str(delta.kind)},
                retryable=True,
            )
        )
    return ok(replace(document, segments=outcome.segments, edits=(*document.edits, delta)))


# -- what a regeneration keeps -----------------------------------------------


def _keep_locked(
    fresh: Sequence[CaptionSegment],
    previous: Sequence[CaptionSegment],
) -> tuple[tuple[CaptionSegment, ...], tuple[CaptionSegment, ...]]:
    """Drop any fresh cue a locked cue covers, and keep the locked one.

    A locked cue is a line the user has taken responsibility for; re-transcribing
    the audio underneath it and showing the provider's guess instead is the
    single fastest way to lose an afternoon.
    """
    locked = tuple(cue for cue in previous if cue.locked)
    if not locked:
        return tuple(fresh), ()
    surviving = tuple(cue for cue in fresh if not any(_overlaps(cue, lock) for lock in locked))
    merged = sorted((*surviving, *locked), key=lambda cue: (cue.start_ms, cue.end_ms))
    return tuple(merged), locked


def _overlaps(one: CaptionSegment, other: CaptionSegment) -> bool:
    """Whether two cues share any moment.  Touching edges do not count."""
    return one.start_ms < other.end_ms and other.start_ms < one.end_ms
