"""L3 — the caption engine's error codes (`NS-CAPTION-40xx`).

One enum, because a caption failure is a caption failure whichever stage
produced it, and a UI that has to map twelve modules onto twelve tables renders
twelve different versions of "could not finish".

The ``40xx`` band is split: ``4001``–``4006`` belong to :mod:`nova_studio.ports.asr`
and describe **speech recognition** — unreadable audio, missing weights, a
transcript whose timings cannot be trusted. ``4010`` and up describe **caption
authoring** — what happens after the words exist. The two halves meet at the
seam ADR-0009 §1 draws, and keeping them apart is what lets the UI say "your
model is missing" in one case and "your template is broken" in the other
instead of "something went wrong" in both.

Every member answers the same three questions a user is really asking:

* **Can I retry?** A transient failure says yes and the UI offers a button; a
  deterministic one says no and offering a button is a lie.
* **What do I do?** ``remedy`` on the error, not in the enum — the enum cannot
  know whether the missing model is 145 MB or 3 GB.
* **Which part broke?** ``details`` carries the stage, the cue, the template
  field — whatever makes the message point at something on screen.
"""

from __future__ import annotations

from enum import StrEnum

__all__ = ["CaptionErrorCode"]


class CaptionErrorCode(StrEnum):
    """What can go wrong once the words exist.

    Ordered by when it can happen in a run, not by number, so the list reads as
    the story of a generation: the pipeline starts, a stage fails, the result is
    checked, the styling is read, the animation is baked, the regeneration is
    merged, and the document is committed to the timeline.
    """

    #: A stage returned ``Err``.  The stage's name travels in
    #: ``details["stage"]``, which is what makes the message actionable: "the
    #: Break stage could not finish" is a sentence a user can act on, and
    #: "something went wrong" is not.
    #:
    #: Not retryable — a stage is pure, so the same input gives the same answer.
    STAGE_FAILED = "NS-CAPTION-4010"
    #: An object registered as a stage has no ``apply``.  A plugin bug, not a
    #: user problem: it is reported so a plugin that half-registers cannot leave
    #: captions silently ungenerated.
    NOT_A_STAGE = "NS-CAPTION-4011"
    #: The pipeline finished and produced a document no renderer may be given —
    #: overlapping cues, a cue too short to read, a reading rate nobody can
    #: manage (ADR-0009 §2 rule 4).  The sentence from
    #: :func:`~nova_studio.domain.captions.validate_caption_document` is carried
    #: in the message so the user is told *which cue*.
    INVALID_RESULT = "NS-CAPTION-4012"
    #: A caption template does not describe a style: an unknown field, a colour
    #: that is not a colour, an out-of-range weight.  Refused whole rather than
    #: partially applied, because a half-applied template is a style nobody
    #: chose and nobody can name.
    TEMPLATE_INVALID = "NS-CAPTION-4013"
    #: A style preset the :class:`~nova_studio.services.captions.animation.AnimationBaker`
    #: does not know — a mode name from a newer template, or a typo in one.
    UNKNOWN_ANIMATION_MODE = "NS-CAPTION-4014"
    #: A re-transcription could not be merged without dropping human edits
    #: (ADR-0009 §7).  Reported instead of guessed: silently discarding a
    #: correction is the one thing a regeneration must never do.
    MERGE_CONFLICT = "NS-CAPTION-4015"
    #: The document could not be reconciled onto the timeline — a locked track,
    #: a clip that would land outside its track, a project whose caption track
    #: was deleted.  The project is left as it was.
    COMMIT_FAILED = "NS-CAPTION-4016"
