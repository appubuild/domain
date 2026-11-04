"""L3 — the caption pipeline: twelve stages, each replaceable (ADR-0009 §3).

``Extract → VAD → Transcribe → Refine → Diarise → Translate → Break → Emoji →
Highlight → Position → Resolve → Bake``.

That sentence is the whole design. Every stage is a pure function from one
immutable document to the next, which is the decision that makes the caption
engine verifiable in CI on a machine with no network, no GPU and no model
weights (ADR-0009, Consequences) — and the decision that lets a plugin insert a
stage without touching any other.

So this module is deliberately almost nothing: a registration list, an enable
set, and a runner. It knows what a stage *is* and nothing about what any stage
does. Three rules carry the weight:

1. **A stage is a named, pure function.** ``apply`` takes a document and a
   context and returns a document. No I/O: extraction and transcription are
   ports, and everything after ``Transcribe`` is arithmetic on text and time.
2. **Ordering is explicit, and so is skipping.** A stage may be disabled by
   name — "re-break my captions but don't move them" is a thing a user asks for
   constantly, and answering it by commenting out a call is not an answer.
3. **Fail fast, and say which stage.** A pipeline that runs on after a failure
   produces a document that is half-reflowed, and the user discovers it at
   export. The error names the stage, so the message is "the Break stage could
   not finish" and not "something went wrong".

Validation happens once, at the end: intermediate documents are allowed to be
in a state no renderer would accept — a cue too short to read is exactly what
``Break`` produces before ``Resolve`` fixes it — but the document that leaves
the pipeline is not (ADR-0009 §2 rule 4).
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING

from nova_studio.core.errors import ErrorDomain, NovaError, NovaInvariantError
from nova_studio.core.result import Result, failed, ok
from nova_studio.domain.captions import (
    CAPTION_MAX_CPS,
    CAPTION_MAX_LINE_CHARS,
    CAPTION_MAX_LINES,
    SafeArea,
    validate_caption_document,
)
from nova_studio.services.captions.codes import CaptionErrorCode

if TYPE_CHECKING:
    from nova_studio.domain.captions import CaptionDocument, CaptionRect

__all__ = ["CaptionPipeline", "StageContext", "stage_failed"]


def stage_failed(stage: str, reason: str) -> NovaError:
    """The one message a broken stage produces, with the stage's name in it."""
    return NovaError(
        code=CaptionErrorCode.STAGE_FAILED,
        message=f"the {stage} stage could not finish: {reason}",
        domain=ErrorDomain.CAPTION,
        remedy="Undo the last caption change, or re-run the pipeline with this stage disabled.",
        details={"stage": stage},
        retryable=False,
    )


@dataclass(frozen=True, slots=True, kw_only=True)
class StageContext:
    """What a stage may read.

    Geometry is in **fractions of the safe area**, never in pixels of a
    particular preview: a nudge has to mean the same thing in a 480 p proxy and
    a 4 K export, which is the only way the two can match.

    Text *metrics* are not here on purpose. Measuring a string needs a font and
    a shaper, which is a port this feature does not have yet; the layout stages
    therefore work in lines and fractions, and the renderer supplies real
    extents when it draws.
    """

    #: The frame the captions will be drawn on, in pixels.
    frame_size: tuple[int, int] = (1920, 1080)
    #: Where captions may be drawn.
    safe_area: SafeArea = field(default_factory=SafeArea)
    #: Region no caption may cover: a lower third, a detected face, a logo.
    protected: tuple[CaptionRect, ...] = ()
    max_line_chars: int = CAPTION_MAX_LINE_CHARS
    max_lines: int = CAPTION_MAX_LINES
    #: Height of one line as a fraction of the safe area's height.
    line_height_fraction: float = 0.06
    #: Fastest a cue may be read, in characters per second.
    max_reading_rate_cps: float = CAPTION_MAX_CPS
    language: str = ""

    def __post_init__(self) -> None:
        if self.frame_size[0] <= 0 or self.frame_size[1] <= 0:
            raise NovaInvariantError(f"a frame must be positive, got {self.frame_size}")
        if self.max_line_chars < 1 or self.max_lines < 1:
            raise NovaInvariantError("a caption needs at least one line of one character")
        if not 0.0 < self.line_height_fraction <= 1.0:
            raise NovaInvariantError(
                f"line_height_fraction must be in (0, 1], got {self.line_height_fraction}"
            )
        if self.max_reading_rate_cps <= 0:
            raise NovaInvariantError(
                f"max_reading_rate_cps must be positive, got {self.max_reading_rate_cps}"
            )


@dataclass(frozen=True, slots=True)
class CaptionPipeline:
    """An ordered list of stages, some of them switched on.

    Frozen and rebuilt on every change, so a pipeline can be handed to a worker
    without anyone worrying about a plugin inserting a stage mid-run.
    """

    stages: tuple[tuple[str, object], ...] = ()
    #: Names of the stages that are switched off.  A set rather than a flag on
    #: the stage, because a stage is a value shared between pipelines that want
    #: different things from it.
    disabled: frozenset[str] = frozenset()

    @property
    def names(self) -> tuple[str, ...]:
        """Every stage's name, in run order — enabled or not."""
        return tuple(name for name, _ in self.stages)

    @property
    def enabled_names(self) -> tuple[str, ...]:
        """The stages that will actually run, in order."""
        return tuple(name for name in self.names if name not in self.disabled)

    def has(self, name: str) -> bool:
        """Whether a stage with this name is registered."""
        return name in self.names

    def is_enabled(self, name: str) -> bool:
        """Whether a stage is registered and switched on."""
        return self.has(name) and name not in self.disabled

    def with_stage(self, name: str, stage: object) -> CaptionPipeline:
        """Append a stage.  Fails on a duplicate name via :meth:`inserted` rules."""
        return self.inserted(name, stage, before=None)

    def inserted(self, name: str, stage: object, *, before: str | None = None) -> CaptionPipeline:
        """Add a stage, optionally in front of an existing one.

        This is the plugin seam: a plugin that wants to run its own pass between
        ``Break`` and ``Position`` asks for that, and no existing stage learns
        anything about it.

        Raises:
            NovaError: On a duplicate name, or a ``before`` that names no stage.
        """
        if self.has(name):
            raise NovaInvariantError(f"a stage named {name!r} is already in this pipeline")
        if before is None:
            return replace(self, stages=(*self.stages, (name, stage)))
        if not self.has(before):
            raise NovaInvariantError(f"there is no stage named {before!r} to insert before")
        stages: list[tuple[str, object]] = []
        for existing_name, existing_stage in self.stages:
            if existing_name == before:
                stages.append((name, stage))
            stages.append((existing_name, existing_stage))
        return replace(self, stages=tuple(stages))

    def enabled(self, name: str) -> CaptionPipeline:
        """Switch a stage on.

        Raises:
            NovaError: If no stage has that name.  Silent success on an unknown
                name is how a typo becomes a mysteriously unpositioned caption.
        """
        return replace(self, disabled=self.disabled - {_known(self, name)})

    def disabled_stage(self, name: str) -> CaptionPipeline:
        """Switch a stage off, keeping it in the order for later."""
        return replace(self, disabled=self.disabled | {_known(self, name)})

    def without(self, name: str) -> CaptionPipeline:
        """Remove a stage entirely."""
        _known(self, name)
        return replace(
            self,
            stages=tuple(pair for pair in self.stages if pair[0] != name),
            disabled=self.disabled - {name},
        )

    def run(self, document: CaptionDocument, ctx: StageContext) -> Result[CaptionDocument]:
        """Run every enabled stage in order, then validate what came out."""
        current = document
        for name, stage in self.stages:
            if name in self.disabled:
                continue
            apply = getattr(stage, "apply", None)
            if apply is None:
                return failed(
                    NovaError(
                        code=CaptionErrorCode.NOT_A_STAGE,
                        message=f"stage {name!r} has no apply() and is not a stage",
                        domain=ErrorDomain.CAPTION,
                        details={"stage": name},
                    )
                )
            # A stage that cannot go on returns Err; one that raises is a bug
            # and is allowed to reach the caller, because silently swallowing
            # it is how a caption document ends up half-reflowed.
            result = apply(current, ctx)
            error = result.error()
            if error is not None:
                return failed(_attributed(error, name))
            current = result.unwrap()

        problem = validate_caption_document(current)
        if problem:
            return failed(
                NovaError(
                    code=CaptionErrorCode.INVALID_RESULT,
                    message=f"the pipeline produced captions that cannot be rendered: {problem}",
                    domain=ErrorDomain.CAPTION,
                    remedy="Re-run the pipeline, or edit the cue the message names.",
                    retryable=False,
                )
            )
        return ok(current)


def _known(pipeline: CaptionPipeline, name: str) -> str:
    """Check a stage name, or raise: an unknown name is a bug in the caller.

    A typo here would otherwise mean a stage that quietly never runs, which is
    the caption-engine version of a silent data loss.
    """
    if not pipeline.has(name):
        raise NovaInvariantError(
            f"there is no stage named {name!r} in this pipeline; "
            f"registered stages: {', '.join(pipeline.names) or 'none'}"
        )
    return name


def _attributed(error: NovaError, stage: str) -> NovaError:
    """An error from a stage, with the stage's name added.

    A stage that already named itself keeps its own answer; only a stage that
    forgot gets one, which is why this is ``setdefault`` in spirit rather than
    an overwrite.
    """
    if "stage" in error.details:
        return error
    return error.with_details(stage=stage)
