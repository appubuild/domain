"""L3 — the Bake stage: caption animation as the editor's own keyframes.

ADR-0009 §6 says animation is *baked into keyframes* by an `AnimationBaker`
that evaluates a spec against segment, word and character intervals, and emits
the same keyframe structures the rest of the editor uses. That sentence is the
whole reason the two things a viewer must never be able to tell apart — preview
and export — cannot drift: both read the same `Animatable` objects, and a
caption's motion is not a second animation system running beside the timeline's.

Three consequences are worth stating, because they are the ones that pay for
the design:

* **A baked caption is inspectable.** The keyframes are real
  :class:`~nova_studio.domain.animation.Animatable` parameters, so the
  Properties panel can show them and an editor can drag them. "Editable by hand
  after baking" is not a promise about a UI; it is a property of the output.
* **Modes are presets, not code paths.** Karaoke, TikTok, Netflix and the rest
  are :class:`AnimationSpec` values — the same baker, different data. A plugin
  contributes a mode by registering a spec, not by forking the stage.
* **Nothing here draws.** Where a word sits is `Position`'s business, what it
  looks like is the template's, and this module only says how it *moves*.

What is baked, per piece of text (a word, or a letter when a spec asks for it):

* ``opacity`` — how present it is. A piece that slides, zooms or bounces fades
  up as it arrives; before it arrives it is at zero, because
  :meth:`Animatable.at` holds the first keyframe's value.
* ``scale`` — how big it is, from `zoom_from` to full size.
* ``offset`` — how far it is from where it belongs, in **line heights**, so it
  means the same thing at any font size.
* ``fill`` — 0 → 1 across the piece while it is spoken. This is the karaoke
  parameter: the renderer decides what a filled word looks like, which is what
  keeps the colour a template's choice rather than this module's.

Two decisions that a caller might otherwise trip over:

**Bake ends the pipeline; its product is not a document.** Every other stage
takes a `CaptionDocument` to a `CaptionDocument`. This one takes a document to
keyframes, so the runner calls :meth:`AnimationBaker.bake` after the run
instead of registering it as one more stage. :meth:`AnimationBaker.apply`
exists so the name is not a special case when a pipeline *is* built with a
"bake" entry: it passes the document through untouched, and the keyframes come
from :meth:`bake`.

**A mode nobody knows is an error, not a fall-back.** A template written by a
newer build can name a mode this one has never heard of; silently baking
"none" would export a caption that looks nothing like the preview the user
approved. It fails with `NS-CAPTION-4014` and names the mode.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from types import MappingProxyType
from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import ErrorDomain, NovaError, NovaInvariantError
from nova_studio.core.result import Result, failed, ok
from nova_studio.core.temporal import Rounding
from nova_studio.domain.animation import Animatable, Interpolation, Keyframe
from nova_studio.domain.asr import frames_for_ms
from nova_studio.services.captions.codes import CaptionErrorCode
from nova_studio.services.captions.styles import WordAnimation

if TYPE_CHECKING:
    from collections.abc import Mapping

    from nova_studio.core.temporal import Timebase
    from nova_studio.domain.captions import CaptionDocument, CaptionSegment, CaptionWord
    from nova_studio.services.captions.pipeline import StageContext
    from nova_studio.services.captions.styles import CaptionLook

__all__ = [
    "DEFAULT_BAKE_SPEC",
    "PARAM_FILL",
    "PARAM_OFFSET",
    "PARAM_OPACITY",
    "PARAM_SCALE",
    "SPECS",
    "AnimationBaker",
    "AnimationSpec",
    "BakedCaptions",
    "BakedCue",
    "BakedPiece",
    "Granularity",
    "spec_for",
]

#: How present a piece of text is.
PARAM_OPACITY: Final[str] = "opacity"
#: How big it is, as a multiple of its laid-out size.
PARAM_SCALE: Final[str] = "scale"
#: How far it is from where it belongs, in line heights: ``(x, y)``.
PARAM_OFFSET: Final[str] = "offset"
#: 0 → 1 while the piece is being spoken. What karaoke reads.
PARAM_FILL: Final[str] = "fill"


class Granularity(StrEnum):
    """What the baker animates: whole words, or one letter at a time."""

    WORD = "word"
    CHAR = "char"


@dataclass(frozen=True, slots=True, kw_only=True)
class AnimationSpec:
    """How words arrive, as data.

    Every field is something a captioner argues about, so every field is a
    value: a mode is not a branch in the baker, it is one of these (ADR-0009
    §6 — "Modes are *spec presets*, not code paths").
    """

    mode: WordAnimation = WordAnimation.NONE
    #: Whether letters arrive one at a time inside each word.
    granularity: Granularity = Granularity.WORD
    #: How long a piece takes to arrive.
    enter_ms: int = 160
    #: How far a sliding piece travels, in line heights.
    slide_lines: float = 0.75
    #: Where a zooming or bouncing piece starts, as a fraction of full size.
    zoom_from: float = 0.6
    #: The size a bouncing piece overshoots to on its way in: ``1.0`` is no
    #: overshoot, ``1.18`` is the eighteen per cent a phone caption uses.
    overshoot: float = 1.18
    #: The gap between the letters of one word.
    stagger_ms: int = 30
    #: The whole cue fading in, which is what keeps a caption from appearing
    #: with a snap. Zero is "no fade", and is the broadcast default.
    cue_fade_in_ms: int = 0
    cue_fade_out_ms: int = 0
    #: The curve a piece arrives on.
    easing: Interpolation = Interpolation.EASE_OUT

    def __post_init__(self) -> None:
        if self.enter_ms < 0:
            raise NovaInvariantError(f"enter_ms must not be negative, got {self.enter_ms}")
        if not 0.0 < self.zoom_from <= 1.0:
            raise NovaInvariantError(f"zoom_from must be within (0, 1], got {self.zoom_from}")
        if self.overshoot < 1.0:
            raise NovaInvariantError(f"overshoot must be at least 1.0, got {self.overshoot}")
        if self.slide_lines < 0.0:
            raise NovaInvariantError(f"slide_lines must not be negative, got {self.slide_lines}")
        if self.stagger_ms < 0:
            raise NovaInvariantError(f"stagger_ms must not be negative, got {self.stagger_ms}")
        if self.cue_fade_in_ms < 0 or self.cue_fade_out_ms < 0:
            raise NovaInvariantError("a cue fade must not be negative")


#: What each mode means. The baker has no ``if mode is`` anywhere in it beyond
#: this table and the four functions it names — a new mode is a new row.
SPECS: Final[Mapping[WordAnimation, AnimationSpec]] = MappingProxyType(
    {
        WordAnimation.NONE: AnimationSpec(mode=WordAnimation.NONE),
        WordAnimation.KARAOKE: AnimationSpec(mode=WordAnimation.KARAOKE, enter_ms=0),
        WordAnimation.SLIDE: AnimationSpec(
            mode=WordAnimation.SLIDE, enter_ms=140, slide_lines=0.75
        ),
        WordAnimation.BOUNCE: AnimationSpec(
            mode=WordAnimation.BOUNCE, enter_ms=200, overshoot=1.18
        ),
        WordAnimation.ZOOM: AnimationSpec(mode=WordAnimation.ZOOM, enter_ms=160, zoom_from=0.6),
    }
)

#: The spec a baker is built with: no animation at all.
DEFAULT_BAKE_SPEC: Final[AnimationSpec] = SPECS[WordAnimation.NONE]


def spec_for(mode: str | WordAnimation) -> Result[AnimationSpec]:
    """The spec a mode names.

    Returns ``Err`` for a mode this build has never heard of — a template from
    a newer Nova Studio, or a typo in one — because baking "none" instead would
    export a caption that looks nothing like the preview it was approved in.
    """
    try:
        known = WordAnimation(str(mode))
    except ValueError:
        return failed(
            NovaError(
                code=CaptionErrorCode.UNKNOWN_ANIMATION_MODE,
                message=f"there is no caption animation mode named {str(mode)!r}",
                domain=ErrorDomain.CAPTION,
                remedy=(
                    "Choose one of "
                    f"{', '.join(option.value for option in WordAnimation)}, "
                    "or update Nova Studio to open this template."
                ),
                details={"mode": str(mode)},
                retryable=False,
            )
        )
    return ok(SPECS[known])


# -- what comes out ----------------------------------------------------------


@dataclass(frozen=True, slots=True)
class BakedPiece:
    """One animated run of text: a word, or one letter of one word."""

    segment_index: int
    word_index: int
    #: ``None`` for a whole word, the letter's index for a letter.
    char_index: int | None = None
    text: str = ""
    start_frame: int = 0
    end_frame: int = 0
    parameters: tuple[Animatable, ...] = ()

    @property
    def is_letter(self) -> bool:
        """Whether this is one letter rather than a whole word."""
        return self.char_index is not None

    def parameter(self, name: str) -> Animatable | None:
        """The parameter with this name, if the piece carries one."""
        return next((item for item in self.parameters if item.name == name), None)


@dataclass(frozen=True, slots=True)
class BakedCue:
    """One cue's animation: its own fade, and the pieces inside it."""

    segment_index: int
    start_frame: int
    end_frame: int
    text: str
    #: The mode this cue was baked with, for the Properties panel to show.
    mode: str
    pieces: tuple[BakedPiece, ...] = ()
    #: The cue as a whole: the fade in and out, if the spec asks for one.
    parameters: tuple[Animatable, ...] = ()

    @property
    def keyframe_count(self) -> int:
        """How many keyframes this cue carries, all told."""
        own = sum(len(parameter.keyframes) for parameter in self.parameters)
        inside = sum(
            len(parameter.keyframes) for piece in self.pieces for parameter in piece.parameters
        )
        return own + inside

    def parameter(self, name: str) -> Animatable | None:
        """The cue-level parameter with this name, if there is one."""
        return next((item for item in self.parameters if item.name == name), None)


@dataclass(frozen=True, slots=True)
class BakedCaptions:
    """A document's animation, as keyframes the editor already understands."""

    timebase: Timebase
    cues: tuple[BakedCue, ...] = ()

    def cue(self, segment_index: int) -> BakedCue | None:
        """The animation of one cue, if it has any."""
        return next((cue for cue in self.cues if cue.segment_index == segment_index), None)

    def pieces_at(self, frame: int) -> tuple[BakedPiece, ...]:
        """Every piece on screen at ``frame`` — what a renderer asks for."""
        return tuple(
            piece
            for cue in self.cues
            if cue.start_frame <= frame < cue.end_frame
            for piece in cue.pieces
        )

    @property
    def keyframe_count(self) -> int:
        """How many keyframes the whole document carries."""
        return sum(cue.keyframe_count for cue in self.cues)


# -- the baker ---------------------------------------------------------------


@dataclass(frozen=True, slots=True, kw_only=True)
class AnimationBaker:
    """The Bake stage: a caption document in, keyframes out.

    A value rather than a function so a pipeline can carry its own settings —
    the same class in one project bakes nothing and in another bounces every
    word in.
    """

    #: The stage's name in the pipeline.
    name: str = "bake"
    #: What to bake when no cue and no look says otherwise.
    spec: AnimationSpec = field(default_factory=lambda: DEFAULT_BAKE_SPEC)

    # -- the stage -------------------------------------------------------

    def apply(self, document: CaptionDocument, ctx: StageContext) -> Result[CaptionDocument]:
        """The document, untouched.

        Bake ends the pipeline and its product is not a document, so there is
        nothing for the next stage to receive. This exists so a pipeline built
        with a ``"bake"`` entry is not a special case; the keyframes come from
        :meth:`bake`.
        """
        return ok(document)

    # -- the work --------------------------------------------------------

    def bake(
        self,
        document: CaptionDocument,
        *,
        timebase: Timebase,
        look: CaptionLook | None = None,
    ) -> Result[BakedCaptions]:
        """Bake every cue into keyframes.

        The mode comes from the cue's own ``style_overrides`` when it has one,
        then from the look, then from the baker's own spec — because an editor
        who set one cue to bounce and left the rest alone meant exactly that.
        """
        cues: list[BakedCue] = []
        for index, segment in enumerate(document.segments):
            resolved = self._spec_for(segment, look)
            error = resolved.error()
            if error is not None:
                return failed(error)
            cues.append(bake_cue(segment, resolved.unwrap(), timebase, index))
        return ok(BakedCaptions(timebase=timebase, cues=tuple(cues)))

    def _spec_for(self, segment: CaptionSegment, look: CaptionLook | None) -> Result[AnimationSpec]:
        named = (segment.style_overrides or {}).get("word_animation")
        if named is not None:
            resolved = spec_for(str(named))
            if resolved.is_err():
                error = resolved.unwrap_err()
                return failed(
                    NovaError(
                        code=CaptionErrorCode.UNKNOWN_ANIMATION_MODE,
                        message=f"cue {segment.index}: {error.message}",
                        domain=error.domain,
                        remedy=error.remedy,
                        details={**error.details, "segment": segment.index},
                        retryable=False,
                    )
                )
            return resolved
        if look is not None:
            return spec_for(look.word_animation)
        return ok(self.spec)


def bake_cue(
    segment: CaptionSegment,
    spec: AnimationSpec,
    timebase: Timebase,
    index: int | None = None,
) -> BakedCue:
    """One cue, baked.

    ``index`` defaults to the cue's own, which is what the baker wants; a
    caller baking one line on its own can say which cue it stands for.
    """
    start = frames_for_ms(segment.start_ms, timebase, Rounding.FLOOR)
    end = max(start + 1, frames_for_ms(segment.end_ms, timebase, Rounding.FLOOR))
    return BakedCue(
        segment_index=segment.index if index is None else index,
        start_frame=start,
        end_frame=end,
        text=segment.text,
        mode=spec.mode.value,
        pieces=_pieces(segment, spec, timebase),
        parameters=_cue_parameters(start, end, spec, timebase),
    )


# -- pieces ------------------------------------------------------------------


def _pieces(
    segment: CaptionSegment, spec: AnimationSpec, timebase: Timebase
) -> tuple[BakedPiece, ...]:
    pieces: list[BakedPiece] = []
    for word_index, word in enumerate(segment.words):
        letters = word.chars if spec.granularity is Granularity.CHAR else ()
        if not letters:
            pieces.append(_piece(segment, word, word_index, None, spec, timebase, 0))
            continue
        stagger = frames_for_ms(spec.stagger_ms, timebase, Rounding.FLOOR)
        pieces.extend(
            _piece(segment, word, word_index, char_index, spec, timebase, char_index * stagger)
            for char_index in range(len(letters))
        )
    return tuple(pieces)


def _piece(
    segment: CaptionSegment,
    word: CaptionWord,
    word_index: int,
    char_index: int | None,
    spec: AnimationSpec,
    timebase: Timebase,
    stagger_frames: int,
) -> BakedPiece:
    """One piece of text, with the parameters its mode asks for."""
    start_ms, end_ms = _span(word, char_index)
    start = frames_for_ms(start_ms, timebase, Rounding.FLOOR)
    end = max(start + 1, frames_for_ms(end_ms, timebase, Rounding.FLOOR))
    arrives = start + stagger_frames
    enter = frames_for_ms(spec.enter_ms, timebase, Rounding.FLOOR)
    return BakedPiece(
        segment_index=segment.index,
        word_index=word_index,
        char_index=char_index,
        text=word.chars[char_index].text if char_index is not None else word.text,
        start_frame=start,
        end_frame=end,
        parameters=(
            _fill(arrives, end, spec),
            _scale(arrives, enter, spec),
            _offset(arrives, enter, spec),
            _opacity(arrives, enter, spec),
        ),
    )


def _span(word: CaptionWord, char_index: int | None) -> tuple[int, int]:
    """When this piece is spoken: the word's interval, or one letter's."""
    if char_index is None or not word.chars:
        return word.start_ms, word.end_ms
    char = word.chars[char_index]
    return char.start_ms, char.end_ms


def _fill(start: int, end: int, spec: AnimationSpec) -> Animatable:
    """0 → 1 while the piece is spoken. Karaoke, and only karaoke."""
    if spec.mode is not WordAnimation.KARAOKE or end <= start:
        return Animatable.constant(PARAM_FILL, 0.0)
    return Animatable(
        name=PARAM_FILL,
        value=(0.0,),
        keyframes=(
            Keyframe.at(start, 0.0, interpolation=Interpolation.LINEAR),
            Keyframe.at(end, 1.0),
        ),
    )


def _scale(start: int, enter: int, spec: AnimationSpec) -> Animatable:
    """How big the piece is as it arrives."""
    if spec.mode is WordAnimation.ZOOM:
        return Animatable(
            name=PARAM_SCALE,
            value=(spec.zoom_from,),
            keyframes=(
                Keyframe.at(start, spec.zoom_from, interpolation=spec.easing),
                Keyframe.at(start + max(1, enter), 1.0),
            ),
        )
    if spec.mode is WordAnimation.BOUNCE:
        # Three keyframes rather than one overshooting curve, so the overshoot
        # is a value an editor can see in the Properties panel and drag — which
        # is the whole promise of baking into the editor's own keyframes.
        travel = max(2, enter)
        return Animatable(
            name=PARAM_SCALE,
            value=(spec.zoom_from,),
            keyframes=(
                Keyframe.at(start, spec.zoom_from, interpolation=Interpolation.EASE_OUT),
                Keyframe.at(
                    start + travel * 3 // 5, spec.overshoot, interpolation=Interpolation.EASE_IN_OUT
                ),
                Keyframe.at(start + travel, 1.0),
            ),
        )
    return Animatable.constant(PARAM_SCALE, 1.0)


def _offset(start: int, enter: int, spec: AnimationSpec) -> Animatable:
    """How far the piece sits from where it belongs as it arrives."""
    if spec.mode is WordAnimation.SLIDE:
        return Animatable(
            name=PARAM_OFFSET,
            value=(0.0, spec.slide_lines),
            keyframes=(
                Keyframe.at(start, 0.0, spec.slide_lines, interpolation=spec.easing),
                Keyframe.at(start + max(1, enter), 0.0, 0.0),
            ),
        )
    return Animatable.constant(PARAM_OFFSET, 0.0, 0.0)


def _opacity(start: int, enter: int, spec: AnimationSpec) -> Animatable:
    """How present the piece is as it arrives.

    Karaoke does not fade: the word is already on screen, waiting to be filled,
    and a karaoke caption whose words are invisible until they are spoken is
    unreadable.
    """
    if spec.mode in (WordAnimation.SLIDE, WordAnimation.ZOOM, WordAnimation.BOUNCE):
        return Animatable(
            name=PARAM_OPACITY,
            value=(0.0,),
            keyframes=(
                Keyframe.at(start, 0.0, interpolation=spec.easing),
                Keyframe.at(start + max(1, enter), 1.0),
            ),
        )
    return Animatable.constant(PARAM_OPACITY, 1.0)


def _cue_parameters(
    start: int, end: int, spec: AnimationSpec, timebase: Timebase
) -> tuple[Animatable, ...]:
    """The cue as a whole: the fade in and out, when the spec asks for one."""
    fade_in = frames_for_ms(spec.cue_fade_in_ms, timebase, Rounding.FLOOR)
    fade_out = frames_for_ms(spec.cue_fade_out_ms, timebase, Rounding.FLOOR)
    if not fade_in and not fade_out:
        return (Animatable.constant(PARAM_OPACITY, 1.0),)
    keyframes = [Keyframe.at(start, 0.0, interpolation=Interpolation.EASE_OUT)]
    if fade_in:
        keyframes.append(Keyframe.hold(start + fade_in, 1.0))
    if fade_out:
        keyframes.append(
            Keyframe.at(
                max(start + fade_in, end - fade_out), 1.0, interpolation=Interpolation.EASE_IN
            )
        )
        keyframes.append(Keyframe.at(end, 0.0))
    return (
        Animatable(
            name=PARAM_OPACITY,
            value=(1.0,),
            keyframes=tuple(sorted(keyframes, key=lambda item: item.frame)),
        ),
    )
