"""L3 — the Break stage: turning a stream of words into cues people can read.

A transcription arrives as a wall of words with timestamps. Nobody can read
that: a cue has to fit on two lines, stay long enough to be read, leave fast
enough not to be re-read, and — the part every auto-caption tool gets wrong —
**break where a sentence does**, not wherever the character budget runs out.

So this stage is a greedy fill with four constraints and two preferences.

Constraints — a cue that violates one is not a cue:

* **No more than ``max_lines`` lines** of at most ``max_line_chars``, measured
  with the domain's :func:`~nova_studio.domain.captions.wrap_caption`, so the
  breaking rule is one rule and not two.
* **No longer than ``max_duration_ms``.** A cue that sits for nine seconds stops
  being a caption and becomes a paragraph.
* **At least ``min_duration_ms``**, extended *forwards* only and never into the
  next cue: a cue the eye cannot land on is worse than a slightly late one.
* **No faster than the reading rate.** Characters per second is the measure that
  actually predicts whether something can be read (ADR-0009 §2).

Preferences — a cue that ignores one is still valid, just worse:

* **Never mix speakers.** Two people in one cue leaves the reader to work out
  who is talking, which is the engine's job, not theirs.
* **Break at punctuation** once the cue can stand alone. Backing off to the last
  sentence end is what separates a caption from a word-wrap.

Two rules about the user's work:

* **A locked cue is passed through untouched.** Locking is how an editor says
  "I have fixed this line"; re-flowing it is the fastest way there is to lose
  hours of corrections (ADR-0009 §7).
* **Word timings are preserved, never invented.** Cues are built from the words
  they contain, so karaoke and per-word animation keep working after a re-break.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.result import Result, ok
from nova_studio.domain.captions import (
    CAPTION_MIN_DURATION_MS,
    CaptionSegment,
    CaptionWord,
    wrap_caption,
)
from nova_studio.services.captions.timing import chars_per_second, held_until

if TYPE_CHECKING:
    from nova_studio.domain.captions import CaptionDocument
    from nova_studio.services.captions.pipeline import StageContext

__all__ = [
    "DEFAULT_MAX_DURATION_MS",
    "DEFAULT_MIN_DURATION_MS",
    "MIN_WORDS_BEFORE_BACKOFF",
    "CueBreaker",
]

#: A cue is never on screen for longer than this: long enough to read two lines
#: twice, short enough that the picture is not competing with a paragraph.
DEFAULT_MAX_DURATION_MS: Final[int] = 7_000
#: Below about a second the eye cannot land on the text before it goes, however
#: short the text is (ADR-0009 §2).
DEFAULT_MIN_DURATION_MS: Final[int] = CAPTION_MIN_DURATION_MS
#: Backing off to punctuation only happens once a cue is long enough to stand
#: on its own; below this, a break is taken wherever the budget ran out.
MIN_WORDS_BEFORE_BACKOFF: Final[int] = 4
#: Sentence ends, plus the clause breaks a reader is happy to stop at.
_BREAK_AFTER: Final[tuple[str, ...]] = (".", "!", "?", "…", ";", ",", ":", ")")


@dataclass(frozen=True, slots=True, kw_only=True)
class CueBreaker:
    """The Break stage: group a document's words into readable cues.

    A value rather than a function so a project can carry its own settings — a
    TikTok-style cut wants two-second cues where a documentary wants seven.
    """

    #: The stage's name in the pipeline.
    name: str = "break"
    max_duration_ms: int = DEFAULT_MAX_DURATION_MS
    min_duration_ms: int = DEFAULT_MIN_DURATION_MS
    #: How far back a break may move to land on punctuation.
    backoff_words: int = MIN_WORDS_BEFORE_BACKOFF

    def __post_init__(self) -> None:
        if self.max_duration_ms < 1:
            raise NovaInvariantError(
                f"max_duration_ms must be positive, got {self.max_duration_ms}"
            )
        if self.min_duration_ms < 0:
            raise NovaInvariantError(
                f"min_duration_ms must not be negative, got {self.min_duration_ms}"
            )
        if self.backoff_words < 0:
            raise NovaInvariantError(
                f"backoff_words must not be negative, got {self.backoff_words}"
            )

    def apply(self, document: CaptionDocument, ctx: StageContext) -> Result[CaptionDocument]:
        """Re-break every unlocked segment, leaving locked ones exactly as they are."""
        rebuilt: list[CaptionSegment] = []
        for segment in document.segments:
            if segment.locked or not segment.words:
                rebuilt.append(segment)
                continue
            rebuilt.extend(self._cues_for(segment, ctx))
        return ok(replace(document, segments=tuple(rebuilt)).reindexed())

    # -- the fill ----------------------------------------------------------

    def _cues_for(
        self,
        segment: CaptionSegment,
        ctx: StageContext,
    ) -> tuple[CaptionSegment, ...]:
        words = segment.words
        cues: list[CaptionSegment] = []
        taken = 0
        while taken < len(words):
            filled = self._fill(words[taken:], ctx)
            count = self._back_off(words[taken : taken + filled])
            group = words[taken : taken + count]
            taken += count
            cues.append(self._cue(group, segment, next_start=_next_start(words, taken)))
        return tuple(cues)

    def _fill(self, words: tuple[CaptionWord, ...], ctx: StageContext) -> int:
        """How many of ``words`` fit in one cue."""
        speaker = words[0].speaker
        for count in range(1, len(words) + 1):
            group = words[:count]
            if count > 1 and group[-1].speaker != speaker:
                return count - 1
            if not self._acceptable(group, ctx):
                # One, even when the first word alone breaks a limit: a cue that
                # is too long or too fast is a thing the user can fix, and a
                # fill that returns zero is an infinite loop.
                return max(1, count - 1)
        return len(words)

    def _acceptable(self, group: tuple[CaptionWord, ...], ctx: StageContext) -> bool:
        """Whether these words make a cue a reader could actually read."""
        text = " ".join(word.text for word in group)
        lines = wrap_caption(text, max_chars=ctx.max_line_chars, max_lines=ctx.max_lines)
        if len(lines) > ctx.max_lines or any(len(line) > ctx.max_line_chars for line in lines):
            return False
        if group[-1].end_ms - group[0].start_ms > self.max_duration_ms:
            return False
        return (
            chars_per_second(text, group[0].start_ms, group[-1].end_ms) <= ctx.max_reading_rate_cps
        )

    def _back_off(self, group: tuple[CaptionWord, ...]) -> int:
        """Move a break back to punctuation, when the cue can afford it.

        Only ever *shortens* a cue, and only when what is left is a sentence
        worth showing alone: a two-word fragment followed by a forty-word one is
        worse than an even split.
        """
        if len(group) <= self.backoff_words:
            return len(group)
        last = len(group) - 1
        floor = max(1, last - self.backoff_words)
        for index in range(last - 1, floor - 1, -1):
            if group[index].text.rstrip().endswith(_BREAK_AFTER):
                return index + 1
        return len(group)

    def _cue(
        self,
        group: tuple[CaptionWord, ...],
        segment: CaptionSegment,
        *,
        next_start: int | None,
    ) -> CaptionSegment:
        """Build one cue from a group of words, carrying their timings with it."""
        start_ms = group[0].start_ms
        end_ms = held_until(
            start_ms,
            group[-1].end_ms,
            min_duration_ms=self.min_duration_ms,
            next_start=next_start,
        )
        return CaptionSegment(
            index=0,  # the document reindexes
            start_ms=start_ms,
            end_ms=end_ms,
            text=" ".join(word.text for word in group),
            words=group,
            speaker=_speaker_of(group, segment),
            layer_id=segment.layer_id,
            position=segment.position,
            style_overrides=segment.style_overrides,
            confidence=segment.confidence,
        )


def _speaker_of(group: tuple[CaptionWord, ...], segment: CaptionSegment) -> str | None:
    """Whose line this is: the words' say-so, or failing that, the cue's.

    A cue never holds two speakers (the fill sees to that), so the only question
    is whether the words carry a name at all.
    """
    named = {word.speaker for word in group if word.speaker}
    return next(iter(named)) if len(named) == 1 else segment.speaker


def _next_start(words: tuple[CaptionWord, ...], taken: int) -> int | None:
    """When the next word starts, so a lengthened cue cannot swallow it."""
    return words[taken].start_ms if taken < len(words) else None
