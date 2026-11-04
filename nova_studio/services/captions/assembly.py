"""L3 — the default caption pipeline: the twelve names, wired in one place.

ADR-0009 §3 names the pipeline as a sentence —
`Extract → VAD → Transcribe → Refine → Diarise → Translate → Break → Emoji →
Highlight → Position → Resolve → Bake` — and until now that sentence lived in
docstrings. This module is where it becomes a value: :func:`default_pipeline`
registers the stages, in that order, with the settings a caller asked for.

Three questions this module exists to answer, because they are the ones a
caller hits first.

**Why only seven of the twelve are here.** Five of the stages — `extract`,
`vad`, `transcribe`, `diarise`, `translate` — need audio, a model or the
network. A :class:`StageContext` carries frame geometry and a language, and
deliberately nothing else (see its own docstring): a stage that reached for a
decoder through its context would be a stage that cannot run in CI. So those
five are not stages in the list; they are the body of the runner, which holds
the ports and calls them in order. `STAGE_ORDER` still names all twelve,
because the order of the whole pass is one fact and it belongs in one place —
and because a plugin that asks "what comes before me" deserves a true answer.

**Why `resolve` is registered and switched off.** `Position` and `Resolve` are
one pass in `positioning.py`, for the reason that module gives: a placement
that ignores collisions is not a placement. The second name is still
registered, carrying the same placer and switched off, so that the pipeline has
twelve slots a plugin can insert *before*, and so that a caller who inserts a
stage that changes boxes between the two passes can switch resolution back on
and let it run on its own.

**Why `style` is here at all.** A house style is usually applied once, when a
project is set up, and `StyleStage` is that step as a stage (ADR-0009 §5). It
is not one of the twelve names — those describe one generation pass end to end
— but it has to sit *somewhere*, and where it sits matters: after `refine`, so
the look gets the last word on the text, and before `break`, so the breaker
uses the look's own line budget rather than the broadcast default. A project
that styles itself passes no look and gets no style stage at all.

The order that leaves, and why:

* `refine` first — clean the raw ASR text before anything measures or dresses it.
* `style` next — the look decides the text's final shape.
* `break` — group the clean words into cues, to the look's own line budget.
* `emoji`, then `highlight` — both decorate a cue, and neither may move it.
* `position` (and `resolve`) — the only stages that move a cue, so they run once
  the cue's text and length have stopped changing.
* `bake` last — animation is keyframes over a cue's final timings, so it is
  computed after every stage that could still change them.
"""

from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING, Final

from nova_studio.services.captions.bake import AnimationBaker, AnimationSpec
from nova_studio.services.captions.cues import DEFAULT_BREAK_RULES, CueBreaker
from nova_studio.services.captions.emoji import EmojiDecorator, EmojiRules
from nova_studio.services.captions.highlight import (
    DEFAULT_HIGHLIGHT_RULES,
    Highlighter,
)
from nova_studio.services.captions.pipeline import CaptionPipeline
from nova_studio.services.captions.positioning import CuePlacer
from nova_studio.services.captions.refine import Refiner
from nova_studio.services.captions.styles import CaptionLook, StyleStage

if TYPE_CHECKING:
    from nova_studio.services.captions.segmentation import CueRules

__all__ = [
    "IO_STAGES",
    "PURE_STAGES",
    "STAGE_ORDER",
    "default_pipeline",
]

#: The twelve stages of ADR-0009 §3, in run order.  One fact, one place: the
#: runner walks this list for the five that need audio, and
#: :func:`default_pipeline` registers the rest.
STAGE_ORDER: Final[tuple[str, ...]] = (
    "extract",
    "vad",
    "transcribe",
    "refine",
    "diarise",
    "translate",
    "break",
    "emoji",
    "highlight",
    "position",
    "resolve",
    "bake",
)

#: The five that need audio, a model or the network, and are therefore the
#: runner's body rather than entries in a `CaptionPipeline` (see the module
#: docstring).
IO_STAGES: Final[frozenset[str]] = frozenset(
    {"extract", "vad", "transcribe", "diarise", "translate"}
)

#: The stages that are pure: a document in, a document out.
PURE_STAGES: Final[tuple[str, ...]] = tuple(name for name in STAGE_ORDER if name not in IO_STAGES)


def default_pipeline(
    *,
    look: CaptionLook | None = None,
    rules: CueRules | None = None,
    refiner: Refiner | None = None,
    breaker: CueBreaker | None = None,
    decorator: EmojiDecorator | None = None,
    highlighter: Highlighter | None = None,
    placer: CuePlacer | None = None,
    baker: AnimationBaker | None = None,
) -> CaptionPipeline:
    """The caption pipeline a project runs by default.

    Every argument is optional and every one of them is a stage rather than a
    setting, so that "the same pipeline, but twenty characters a line" is
    ``default_pipeline(breaker=CueBreaker(rules=replace(DEFAULT_BREAK_RULES,
    max_chars_per_line=20)))`` and not a second function.

    Args:
        look: The house style. When given, a `StyleStage` is registered between
            `refine` and `break`, and the breaker is built with the look's own
            line budget — a TikTok look breaks shorter than a broadcast one, and
            that has to be the same decision as the one the template made.
        rules: The line budget to break to when there is no look.
        refiner, decorator, highlighter, placer, baker: The stages themselves,
            for a caller who has configured one. ``None`` means the default.

    Returns:
        A pipeline with the seven document stages of ADR-0009 §3 in order
        (`resolve` among them, switched off), plus `style` when a look is given.
    """
    pipeline = CaptionPipeline()
    if refiner is not None:
        pipeline = pipeline.with_stage("refine", refiner)
    else:
        pipeline = pipeline.with_stage("refine", Refiner())
    if look is not None:
        pipeline = pipeline.with_stage("style", StyleStage(look=look))
    if breaker is not None:
        pipeline = pipeline.with_stage("break", breaker)
    else:
        pipeline = pipeline.with_stage("break", _breaker_for(look, rules))
    if decorator is not None:
        pipeline = pipeline.with_stage("emoji", decorator)
    else:
        pipeline = pipeline.with_stage("emoji", EmojiDecorator(rules=EmojiRules()))
    if highlighter is not None:
        pipeline = pipeline.with_stage("highlight", highlighter)
    else:
        pipeline = pipeline.with_stage("highlight", Highlighter(rules=DEFAULT_HIGHLIGHT_RULES))
    placed = placer if placer is not None else CuePlacer()
    pipeline = pipeline.with_stage("position", placed)
    # Registered so the pipeline has a slot between `position` and `bake`, and
    # switched off because the placer already resolves — see the module docstring.
    pipeline = pipeline.with_stage("resolve", placed).disabled_stage("resolve")
    if baker is not None:
        pipeline = pipeline.with_stage("bake", baker)
    else:
        pipeline = pipeline.with_stage("bake", AnimationBaker(spec=AnimationSpec()))
    return pipeline


def _breaker_for(look: CaptionLook | None, rules: CueRules | None) -> CueBreaker:
    """The breaker this pipeline breaks with.

    A look wins over a caller's rules, because a template that says "twenty
    characters a line" is a stronger statement than a default, and silently
    ignoring it would produce captions that fit the broadcast rule and overflow
    the TikTok one.
    """
    if look is not None:
        return CueBreaker(rules=look.rules())
    if rules is not None:
        return CueBreaker(rules=rules)
    return CueBreaker(rules=replace(DEFAULT_BREAK_RULES))
