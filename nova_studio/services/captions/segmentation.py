"""L3 — cue building: which words a viewer reads together.

A transcript is a stream of words with times. Captions are *cues*: a handful of
words that appear, are read, and leave. Everything about whether a caption is
comfortable to watch is decided by the two seconds of policy in this file, so it
is policy as data (:class:`CueRules`) and pure functions over it — no provider,
no audio, no clock.

The rules come from how reading actually works, not from what is easy to code:

* **A cue holds what fits, not what arrived.**  Two lines of 42 is the broadcast
  convention because an eye can take it in one fixation; a third line is a cue
  the viewer has to re-read.
* **A cue lasts as long as it takes to read it, and no longer.**  The reading
  rate cap (:attr:`CueRules.max_reading_rate_cps`) is the one that catches the
  real failure: a fast speaker produces a perfectly-sized 6-second cue containing
  nine words nobody can finish.
* **A cue is held long enough to read.**  The minimum on-screen time is a house
  rule; the rest of the hold comes from the rate cap, so a single word said too
  quickly to read stays up long enough to read — unless the next line has
  already begun.
* **Silence ends a cue; punctuation prefers to.**  A 700 ms gap is a sentence
  boundary the transcript already found, and ending on a full stop is what makes
  captions feel typographical rather than mechanical — but only when the cue has
  been on screen long enough to read, so a burst of short sentences does not
  strobe.
* **Nothing is ever dropped.**  A word longer than the whole cue is a cue of its
  own. Silently truncating text is the one thing a caption builder must never do;
  the viewer is reading it, and half a word is worse than a long line.

Where each piece lives: *wrapping one cue's text into balanced lines* is
``domain/captions.wrap_caption``; *deriving a word's character timings* is
``domain/captions.split_chars``; both are domain facts about text. Deciding
**which words go together** is a workflow opinion, so it is here.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.asr import Transcript, TranscriptWord
from nova_studio.domain.captions import (
    CaptionSegment,
    CaptionWord,
    graphemes,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

__all__ = [
    "DEFAULT_CUE_RULES",
    "CueRules",
    "build_cues",
]


@dataclass(frozen=True, slots=True, kw_only=True)
class CueRules:
    """How to break a stream of words into cues.

    Every field is a thing a caption editor argues about, so every field is
    data rather than a constant: a podcast house style and a TikTok one differ
    by one of these objects, not by a second code path.
    """

    #: Characters per line before the text wraps.  Measured in *graphemes*, so
    #: one emoji or one accented letter counts as one.
    max_chars_per_line: int = 42
    #: Lines on screen at once.  Two, because three is a paragraph.
    max_lines: int = 2
    #: The longest a cue may stay up, however slowly it was spoken.
    max_duration_ms: int = 7_000
    #: The shortest a cue may stay up.  Below about a second, a caption is a
    #: flash: the eye registers that something changed and not what it said.
    min_duration_ms: int = 1_000
    #: Reading rate ceiling, characters per second.  21 is broadcast; 25 is
    #: already hard work.
    max_reading_rate_cps: float = 21.0
    #: A gap this long between words ends the cue: silence is the sentence
    #: boundary the transcript already found.
    silence_break_ms: int = 700
    #: Whether to prefer ending a cue on sentence-ending punctuation.
    punctuation_break: bool = True

    def __post_init__(self) -> None:
        if self.max_chars_per_line < 1:
            raise NovaInvariantError(
                f"max_chars_per_line must be at least 1, got {self.max_chars_per_line}"
            )
        if self.max_lines < 1:
            raise NovaInvariantError(f"max_lines must be at least 1, got {self.max_lines}")
        if self.max_duration_ms < 1:
            raise NovaInvariantError(
                f"max_duration_ms must be at least 1, got {self.max_duration_ms}"
            )
        if self.min_duration_ms < 0:
            raise NovaInvariantError(
                f"min_duration_ms must not be negative, got {self.min_duration_ms}"
            )
        if self.max_reading_rate_cps <= 0:
            raise NovaInvariantError(
                f"max_reading_rate_cps must be positive, got {self.max_reading_rate_cps}"
            )
        if self.silence_break_ms < 0:
            raise NovaInvariantError(
                f"silence_break_ms must not be negative, got {self.silence_break_ms}"
            )

    @property
    def max_chars(self) -> int:
        """How many characters one cue may hold."""
        return self.max_chars_per_line * self.max_lines


#: What a fresh install builds: the broadcast default, which is also what the
#: Netflix style guide asks for — two lines, 42 characters, 21 characters a
#: second.
DEFAULT_CUE_RULES: Final[CueRules] = CueRules()

#: Punctuation that ends a sentence.  A cue is allowed to end here.
_TERMINALS: frozenset[str] = frozenset({".", "!", "?", "…", "。", "！", "？"})


def build_cues(
    transcript: Transcript,
    rules: CueRules = DEFAULT_CUE_RULES,
) -> tuple[CaptionSegment, ...]:
    """Break a transcript into cues.

    Args:
        transcript: What an ASR provider returned, normalised.  Word timings are
            used when they exist; when they do not, the words of a segment are
            spread proportionally across the segment's own span, which is an
            estimate and is marked as such on every character.
        rules: The house style to break to.

    Returns:
        Cues in time order, contiguous where the speech was, and never
        overlapping. A cue's end is the last word's end, held longer when the
        text needs longer to read — but only as far as the next cue allows.
    """
    cues: list[CaptionSegment] = []
    index = 0

    for segment in transcript.segments:
        words = segment.words or _spread(segment.text, segment.start_ms, segment.end_ms)
        if not words:
            continue

        group: list[TranscriptWord] = []
        for word in words:
            if group and _breaks_before(group, word, rules):
                cues.append(_cue(group, index, speaker=segment.speaker, limit=segment.end_ms))
                index += 1
                group = []
            group.append(word)
            if _closes_after(group, rules):
                cues.append(_cue(group, index, speaker=segment.speaker, limit=segment.end_ms))
                index += 1
                group = []
        if group:
            cues.append(_cue(group, index, speaker=segment.speaker, limit=segment.end_ms))
            index += 1

    return tuple(_stretch(cues, rules))


# -- the break tests ----------------------------------------------------------


def _breaks_before(
    group: Sequence[TranscriptWord],
    next_word: TranscriptWord,
    rules: CueRules,
) -> bool:
    """Whether ``next_word`` starts a new cue.

    Silence is checked here, before the word joins: a gap is a property of the
    space between two words, not of the group either of them is in.
    """
    previous = group[-1]
    if next_word.start_ms - previous.end_ms >= rules.silence_break_ms:
        return True
    text = " ".join([*(word.text for word in group), next_word.text])
    return len(graphemes(text)) > rules.max_chars


def _closes_after(group: Sequence[TranscriptWord], rules: CueRules) -> bool:
    """Whether the group should be closed now that its last word has joined."""
    start, end = group[0].start_ms, group[-1].end_ms
    if end - start > rules.max_duration_ms:
        return True
    text = " ".join(word.text for word in group)
    if len(graphemes(text)) >= rules.max_chars:
        return True
    if _reading_rate(text, start, end) > rules.max_reading_rate_cps:
        return True
    if rules.punctuation_break and end - start >= rules.min_duration_ms:
        return group[-1].text.rstrip().endswith(tuple(_TERMINALS))
    return False


def _reading_rate(text: str, start_ms: int, end_ms: int) -> float:
    """Characters per second.  A zero-length cue reads as infinitely fast."""
    duration = end_ms - start_ms
    if duration <= 0:
        return float("inf")
    return len(graphemes(text)) / (duration / 1000)


# -- building one cue ---------------------------------------------------------


def _cue(
    group: Sequence[TranscriptWord],
    index: int,
    *,
    speaker: str | None,
    limit: int,
) -> CaptionSegment:
    """One cue from one group of words."""
    start = group[0].start_ms
    end = min(group[-1].end_ms, limit)
    if end <= start:
        end = start
    text = " ".join(word.text for word in group)
    speakers = {word.speaker for word in group if word.speaker}
    confidences = [word.confidence for word in group]
    return CaptionSegment(
        index=index,
        start_ms=start,
        end_ms=end,
        text=text,
        words=tuple(
            CaptionWord.of(
                word.text,
                min(word.start_ms, end),
                min(word.end_ms, end),
                confidence=word.confidence,
                speaker=word.speaker,
            )
            for word in group
        ),
        speaker=(speakers.pop() if len(speakers) == 1 else (speaker if not speakers else None)),
        confidence=min(confidences) if confidences else None,
    )


def _stretch(cues: list[CaptionSegment], rules: CueRules) -> list[CaptionSegment]:
    """Hold every cue on screen long enough, without ever overlapping.

    "Long enough" is two things: the house minimum, and long enough to read the
    text at the rate cap. The second matters for a cue that cannot be made
    smaller — a single word said quickly is a cue of its own, and the only way
    to make it readable is to leave it up.

    Both extensions are bounded the same way: a caption that outlives the next
    line is a caption sitting on top of the next line, which is the bug this
    pass exists to prevent. A cue with no room keeps the timing the speaker
    gave it; you cannot read a word slower than it was said.
    """
    stretched: list[CaptionSegment] = []
    for position, cue in enumerate(cues):
        wanted = max(
            cue.start_ms + rules.min_duration_ms,
            cue.start_ms + _time_to_read(cue.text, rules),
        )
        following = cues[position + 1] if position + 1 < len(cues) else None
        if following is not None:
            wanted = min(wanted, following.start_ms)
        wanted = min(wanted, cue.start_ms + rules.max_duration_ms)
        stretched.append(cue if wanted <= cue.end_ms else replace(cue, end_ms=wanted))
    return stretched


def _time_to_read(text: str, rules: CueRules) -> int:
    """Milliseconds the text needs on screen at the rate cap, rounded up."""
    return math.ceil(len(graphemes(text)) / rules.max_reading_rate_cps * 1000)


# -- words without timings ----------------------------------------------------


def _spread(text: str, start_ms: int, end_ms: int) -> tuple[TranscriptWord, ...]:
    """Give every word of an untimed stretch a proportional share of its span.

    A provider that returns no word timings still returns text, and a caption
    built from it is better than no caption.  The split is weighted by word
    length — a long word is held longer than "a" — and is exact: the last word
    ends where the stretch ends, so derived timings can never run past the
    segment they came from.
    """
    words = text.split()
    if not words:
        return ()
    duration = end_ms - start_ms
    weights = [max(1, len(graphemes(word))) for word in words]
    total = sum(weights)
    built: list[TranscriptWord] = []
    elapsed = 0
    boundary = start_ms
    for word, weight in zip(words, weights, strict=True):
        elapsed += weight
        next_boundary = start_ms + (duration * elapsed) // total
        built.append(TranscriptWord(text=word, start_ms=boundary, end_ms=next_boundary))
        boundary = next_boundary
    return tuple(built)


def _estimated_words(text: str, start_ms: int, end_ms: int) -> tuple[CaptionWord, ...]:
    """Words with derived character timings, for a caller building cues by hand.

    The domain marks every character :attr:`~CaptionChar.estimated`, which is
    what lets a later forced-alignment pass replace them with real timings
    without pretending it did not change anything.
    """
    return tuple(
        CaptionWord.of(word.text, word.start_ms, word.end_ms)
        for word in _spread(text, start_ms, end_ms)
    )
