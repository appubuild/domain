"""L3 — house styles: the four looks, and what they do to a cue.

A caption look is a *preset*, not a class hierarchy — ADR-0009 §5 says styling is
data, and data is what a plugin can ship, a user can fork and a template picker
can list without this module being recompiled. So a look is a frozen value that
answers three questions and nothing else:

* **How the text is broken** (:meth:`CaptionLook.rules`) — a TikTok caption is
  20 characters a line because it is read on a phone held at arm's length, not
  because a different breaker is better at it.
* **Where it sits** (:meth:`CaptionLook.position`) — an anchor in the safe area,
  so a nudge means the same thing in a 480 p proxy and a 4 K master.
* **How it looks and moves** (:meth:`CaptionLook.overrides`) — a flat mapping,
  because the styling stage and the plugins that follow it contribute keys this
  module has not been written yet.

The four presets are the ones people actually ask for by name:

| Template | Where | Case | Animation | Why |
| --- | --- | --- | --- | --- |
| `NETFLIX` | bottom, centred | as spoken | none | The broadcast default: unobtrusive, two lines, never the reason a viewer looks away. |
| `TIKTOK` | middle, centred | UPPERCASE | bounce, word highlight | Read on a phone, often with sound off: big, punchy, and the active word pops. |
| `PODCAST` | middle, centred | as spoken | karaoke, speaker names | A clip of a conversation needs to say *who* is talking. |
| `GAMING` | bottom, left | as spoken | slide, boxed | Must not cover the crosshair or the HUD, and must survive a busy frame. |

Applying a look (:func:`apply_look`) is where the one real trap is: **a word's
characters must join to make the word**, so changing a cue's case means
rebuilding its words, not just its text. A look that upper-cased the text and
left the characters alone would build a document the domain refuses to load.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import StrEnum
from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.captions import (
    CaptionAnchor,
    CaptionPosition,
    CaptionSegment,
    CaptionWord,
)
from nova_studio.services.captions.segmentation import CueRules

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

__all__ = [
    "DEFAULT_TEMPLATE",
    "LOOKS",
    "Backdrop",
    "CaptionLook",
    "CaptionTemplate",
    "TextCase",
    "WordAnimation",
    "apply_look",
    "look_for",
]


class CaptionTemplate(StrEnum):
    """A named house style."""

    #: The broadcast default: two lines, bottom centre, as spoken.
    NETFLIX = "netflix"
    #: Big, upper-case, middle of the frame, active word popping.
    TIKTOK = "tiktok"
    #: A conversation: karaoke, and the speaker named.
    PODCAST = "podcast"
    #: Bottom left, boxed, out of the way of a HUD.
    GAMING = "gaming"
    #: Nothing applied: for projects that style their captions themselves.
    PLAIN = "plain"


class TextCase(StrEnum):
    """What a look does to the letters."""

    NONE = "none"
    UPPER = "upper"
    LOWER = "lower"
    TITLE = "title"


class WordAnimation(StrEnum):
    """How words arrive.

    ``KARAOKE`` is the odd one out: it needs word timings, and :func:`apply_look`
    quietly falls back to no animation on a cue that does not have them, because
    a karaoke caption with no word timings is a caption that never lights up.
    """

    NONE = "none"
    #: Words colour up as they are spoken.
    KARAOKE = "karaoke"
    #: Each word slides in from the edge of the cue.
    SLIDE = "slide"
    #: Each word overshoots and settles.
    BOUNCE = "bounce"
    #: Each word scales up from nothing.
    ZOOM = "zoom"


class Backdrop(StrEnum):
    """What sits behind the text so it stays readable on any picture."""

    NONE = "none"
    #: A solid rounded box.
    BOX = "box"
    #: A contrasting outline, the broadcast convention.
    OUTLINE = "outline"
    #: A soft shadow, for looks that want no hard edge.
    SHADOW = "shadow"


@dataclass(frozen=True, slots=True, kw_only=True)
class CaptionLook:
    """One house style, as data."""

    template: CaptionTemplate
    anchor: CaptionAnchor = CaptionAnchor.BOTTOM_CENTER
    max_lines: int = 2
    max_chars_per_line: int = 42
    text_case: TextCase = TextCase.NONE
    word_animation: WordAnimation = WordAnimation.NONE
    #: Whether the word being spoken is emphasised.  Karaoke implies it.
    highlight_active_word: bool = False
    backdrop: Backdrop = Backdrop.NONE
    #: Cap height as a fraction of the safe area's height, so a look scales
    #: with the frame instead of being re-tuned per resolution.
    font_size_ratio: float = 0.045
    font_weight: int = 400
    line_spacing: float = 1.2
    #: Whether to prefix a cue with the name of whoever is speaking.
    show_speaker_names: bool = False
    #: Offset from the anchor, as a fraction of the safe area.
    x: float = 0.0
    y: float = 0.0

    def __post_init__(self) -> None:
        if self.max_lines < 1:
            raise NovaInvariantError(f"max_lines must be at least 1, got {self.max_lines}")
        if self.max_chars_per_line < 1:
            raise NovaInvariantError(
                f"max_chars_per_line must be at least 1, got {self.max_chars_per_line}"
            )
        if not 0.0 < self.font_size_ratio <= 1.0:
            raise NovaInvariantError(
                f"font_size_ratio must be within (0, 1], got {self.font_size_ratio}"
            )
        if not 100 <= self.font_weight <= 900:
            raise NovaInvariantError(
                f"font_weight must be within [100, 900], got {self.font_weight}"
            )
        if self.line_spacing <= 0:
            raise NovaInvariantError(f"line_spacing must be positive, got {self.line_spacing}")
        if not -1.0 <= self.x <= 1.0 or not -1.0 <= self.y <= 1.0:
            raise NovaInvariantError(f"the offset must be within [-1, 1], got ({self.x}, {self.y})")

    def rules(self) -> CueRules:
        """The breaking rules this look implies."""
        return CueRules(max_lines=self.max_lines, max_chars_per_line=self.max_chars_per_line)

    def position(self) -> CaptionPosition:
        """Where a cue of this look sits."""
        return CaptionPosition(anchor=self.anchor, x=self.x, y=self.y)

    def overrides(self) -> Mapping[str, object]:
        """The style keys the renderer's caption stage consumes (ADR-0009 §5).

        Flat and stringly-typed on purpose: the styling stage and any plugin
        that follows it contribute keys this module has not been written yet.
        """
        return {
            "template": self.template.value,
            "text_case": self.text_case.value,
            "word_animation": self.word_animation.value,
            "highlight_active_word": self.highlight_active_word,
            "backdrop": self.backdrop.value,
            "font_size_ratio": self.font_size_ratio,
            "font_weight": self.font_weight,
            "line_spacing": self.line_spacing,
            "show_speaker_names": self.show_speaker_names,
        }

    def text_of(self, text: str) -> str:
        """``text`` with this look's case applied."""
        if self.text_case is TextCase.UPPER:
            return text.upper()
        if self.text_case is TextCase.LOWER:
            return text.lower()
        if self.text_case is TextCase.TITLE:
            return text.title()
        return text


#: A look per template.  Frozen tuple of pairs rather than a dict so that the
#: order a template picker shows them in is declared here and not sorted later.
LOOKS: Final[tuple[tuple[CaptionTemplate, CaptionLook], ...]] = (
    (
        CaptionTemplate.NETFLIX,
        CaptionLook(template=CaptionTemplate.NETFLIX, backdrop=Backdrop.OUTLINE),
    ),
    (
        CaptionTemplate.TIKTOK,
        CaptionLook(
            template=CaptionTemplate.TIKTOK,
            anchor=CaptionAnchor.MIDDLE_CENTER,
            max_chars_per_line=20,
            text_case=TextCase.UPPER,
            word_animation=WordAnimation.BOUNCE,
            highlight_active_word=True,
            backdrop=Backdrop.SHADOW,
            font_size_ratio=0.07,
            font_weight=700,
            line_spacing=1.1,
        ),
    ),
    (
        CaptionTemplate.PODCAST,
        CaptionLook(
            template=CaptionTemplate.PODCAST,
            anchor=CaptionAnchor.MIDDLE_CENTER,
            max_chars_per_line=32,
            word_animation=WordAnimation.KARAOKE,
            highlight_active_word=True,
            backdrop=Backdrop.BOX,
            font_size_ratio=0.06,
            font_weight=700,
            show_speaker_names=True,
        ),
    ),
    (
        CaptionTemplate.GAMING,
        CaptionLook(
            template=CaptionTemplate.GAMING,
            anchor=CaptionAnchor.BOTTOM_LEFT,
            max_chars_per_line=38,
            word_animation=WordAnimation.SLIDE,
            highlight_active_word=True,
            backdrop=Backdrop.BOX,
            font_size_ratio=0.04,
        ),
    ),
    (CaptionTemplate.PLAIN, CaptionLook(template=CaptionTemplate.PLAIN)),
)

#: What a new project starts on.
DEFAULT_TEMPLATE: Final[CaptionTemplate] = CaptionTemplate.NETFLIX


def look_for(template: CaptionTemplate) -> CaptionLook:
    """The look behind a template name.

    Every template has one, so this cannot fail — an unknown style is a project
    from a newer build, and it falls back to :attr:`DEFAULT_TEMPLATE` rather
    than refusing to open (ADR-0015 rule 3).
    """
    for candidate, look in LOOKS:
        if candidate is template:
            return look
    return look_for(DEFAULT_TEMPLATE)


def apply_look(
    cues: Sequence[CaptionSegment],
    look: CaptionLook,
) -> tuple[CaptionSegment, ...]:
    """Return these cues wearing this look.

    A cue the user has **locked** is left exactly as it is: locking is the
    promise that a re-style will not move it (ADR-0009 §7).  Everything else
    gains the look's position, its style keys and its case — and, when the case
    changes, words rebuilt so that their characters still join to make them.
    """
    return tuple(_wear(cue, look) for cue in cues)


def _wear(cue: CaptionSegment, look: CaptionLook) -> CaptionSegment:
    if cue.locked:
        return cue
    text = look.text_of(_with_speaker(cue, look))
    return replace(
        cue,
        text=text,
        words=tuple(_reword(word, look) for word in cue.words),
        position=look.position(),
        style_overrides=_overrides_for(cue, look),
    )


def _overrides_for(cue: CaptionSegment, look: CaptionLook) -> Mapping[str, object]:
    """The look's style keys, with the ones this cue cannot honour removed.

    Karaoke needs word timings. A cue that has none — hand-typed, or imported
    from a format that keeps only the line — would be a caption that never
    lights up, so the animation and the highlight are dropped rather than
    rendered as a promise the cue cannot keep.
    """
    overrides = dict(look.overrides())
    if look.word_animation is WordAnimation.KARAOKE and not cue.has_word_timings:
        overrides["word_animation"] = WordAnimation.NONE.value
        overrides["highlight_active_word"] = False
    return overrides


def _with_speaker(cue: CaptionSegment, look: CaptionLook) -> str:
    """Prefix the speaker's name when the look asks for it."""
    if not look.show_speaker_names or not cue.speaker:
        return cue.text
    if cue.text.startswith(f"{cue.speaker}:"):
        return cue.text
    return f"{cue.speaker}: {cue.text}"


def _reword(word: CaptionWord, look: CaptionLook) -> CaptionWord:
    """A word with the look's case, its characters rebuilt to match.

    The domain invariant is exact: a word's characters must join to make the
    word. Upper-casing the text alone would build a document that refuses to
    load, so the word is rebuilt through :meth:`CaptionWord.of`, which derives
    the characters again.
    """
    text = look.text_of(word.text)
    if text == word.text:
        return word
    return CaptionWord.of(
        text,
        word.start_ms,
        word.end_ms,
        confidence=word.confidence,
        speaker=word.speaker,
        highlight=word.highlight,
    )
