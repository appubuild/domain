"""L3 — cue building: which words a viewer reads together.

A transcript is a stream of words with times. Captions are *cues*: a handful of
words that appear, are read, and leave. Everything about whether a caption is
comfortable to watch is decided by the two seconds of policy in this file, so it
is policy as data (:class:`CueRules`) and pure functions over it — no provider,
no audio, no clock.

The rules come from how reading actually works, not from what is easy to code:

* **A cue holds what fits, not what arrived.** Two lines of 42 is the broadcast
  convention because an eye can take it in one fixation; a third line is a cue
  the viewer has to re-read.
* **A cue lasts as long as it takes to read it, and no longer.** The reading
  rate cap (:attr:`CueRules.max_reading_rate_cps`) is the one that catches the
  real failure: a fast speaker produces a perfectly-sized 6-second cue containing
  nine words nobody can finish.
* **A cue is held long enough to read.** The minimum on-screen time is a house
  rule; the rest of the hold comes from the rate cap, so a single word said too
  quickly to read stays up long enough to read — unless the next line has
  already begun.
* **Silence ends a cue; punctuation prefers to.** A 700 ms gap is a sentence
  boundary the transcript already found, and ending on a full stop is what makes
  captions feel typographical rather than mechanical — but only when the cue has
  been on screen long enough to read, so a burst of short sentences does not
  strobe.
* **A speaker change ends a cue.** Two people in one caption leaves the reader
  to work out who is talking, which is the engine's job, not theirs.
* **Nothing is ever dropped.** A word longer than the whole cue is a cue of its
  own. Silently truncating text is the one thing a caption builder must never
  do; the viewer is reading it, and half a word is worse than a long line.

Two shapes of the same rule
---------------------------

:func:`cue_spans` is the core: words in, groups of words with their times out.
It works over *any* timed word — a provider's
:class:`~nova_studio.domain.asr.TranscriptWord` or the document's
:class:`~nova_studio.domain.captions.CaptionWord` — and hands back the very
objects it was given, so a re-break never rebuilds a word and never loses the
character timings karaoke needs.

:func:`build_cues` wraps it for the common case: a transcript in, cues out, with
the domain's own :class:`~nova_studio.domain.captions.CaptionSegment`, derived
character timings, per-word speakers and a confidence that is the worst word in
the cue rather than the best. It groups each transcript segment on its own — a
segment boundary is a cue boundary — and then stretches the whole run at once,
because "never overlap the next cue" is a promise about the run and not about
one segment.

Where each piece lives: *wrapping one cue's text into balanced lines* is
``domain/captions.wrap_caption``; *deriving a word's character timings* is
``domain/captions.split_chars``; *holding a cue on screen* is
:func:`services.captions.timing.held_until`; *how fast a cue reads* is
:func:`services.captions.timing.chars_per_second`. Deciding **which words go
together** is a workflow opinion, so it is here.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Final, Generic, Protocol, TypeVar

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.asr import Transcript, TranscriptWord
from nova_studio.domain.captions import (
    CAPTION_MAX_CPS,
    CAPTION_MAX_LINE_CHARS,
    CAPTION_MAX_LINES,
    CaptionSegment,
    CaptionWord,
    graphemes,
)
from nova_studio.services.captions.timing import chars_per_second, held_until, time_to_read

if TYPE_CHECKING:
    from collections.abc import Sequence

__all__ = [
    "DEFAULT_CUE_RULES",
    "CueRules",
    "CueSpan",
    "TimedWord",
    "build_cues",
    "cue_spans",
]


class TimedWord(Protocol):
    """The least a word must answer for the breaker to group it.

    Both :class:`~nova_studio.domain.asr.TranscriptWord` and
    :class:`~nova_studio.domain.captions.CaptionWord` satisfy it, which is what
    lets one rule break a transcript and re-break a document — and why this is a
    protocol and not a base class: neither of those two should have to inherit
    from anything to be broken.

    Read-only here on purpose: both words are frozen values, and a protocol that
    demanded settable attributes would be satisfied by neither of them.
    """

    @property
    def text(self) -> str: ...

    @property
    def start_ms(self) -> int: ...

    @property
    def end_ms(self) -> int: ...

    @property
    def speaker(self) -> str | None: ...


Word = TypeVar("Word", bound=TimedWord)


@dataclass(frozen=True, slots=True, kw_only=True)
class CueRules:
    """How to break a stream of words into cues.

    Every field is a thing a caption editor argues about, so every field is
    data rather than a constant: a podcast house style and a TikTok one differ
    by one of these objects, not by a second code path.
    """

    #: Characters per line before the text wraps.  Measured in *graphemes*, so
    #: one emoji or one accented letter counts as one.
    max_chars_per_line: int = CAPTION_MAX_LINE_CHARS
    #: Lines on screen at once.  Two, because three is a paragraph.
    max_lines: int = CAPTION_MAX_LINES
    #: The longest a cue may stay up, however slowly it was spoken.
    max_duration_ms: int = 7_000
    #: The shortest a cue may stay up.  Below about a second, a caption is a
    #: flash: the eye registers that something changed and not what it said.
    min_duration_ms: int = 1_000
    #: Reading rate ceiling, characters per second.  Twenty is the domain's
    #: ceiling (:data:`~nova_studio.domain.captions.CAPTION_MAX_CPS`), and it is
    #: the authority here on purpose: a breaker allowed to produce a cue the
    #: document validator refuses is a breaker with a bug, not a house style.
    max_reading_rate_cps: float = float(CAPTION_MAX_CPS)
    #: A gap this long between words ends the cue: silence is the sentence
    #: boundary the transcript already found.
    silence_break_ms: int = 700
    #: Whether to prefer ending a cue on sentence-ending punctuation.
    punctuation_break: bool = True
    #: Whether a change of speaker ends the cue.  Off only for the rare look
    #: that labels speakers inside one line (``- Alice: hello - Bob: hi``).
    speaker_break: bool = True

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


#: What a fresh install builds: the broadcast default — two lines of 42, at the
#: domain's reading-rate ceiling.
DEFAULT_CUE_RULES: Final[CueRules] = CueRules()

#: Punctuation that ends a sentence.  A cue is allowed to end here.
_TERMINALS: Final[frozenset[str]] = frozenset({".", "!", "?", "…", "。", "！", "？"})


@dataclass(frozen=True, slots=True)
class CueSpan(Generic[Word]):
    """One cue's worth of words, and when it is on screen.

    The words are the *same objects* the caller passed in, so a caller holding
    :class:`~nova_studio.domain.captions.CaptionWord` values keeps their
    character timings, their confidence and their highlight flags through a
    re-break.
    """

    words: tuple[Word, ...]
    start_ms: int
    end_ms: int

    @property
    def text(self) -> str:
        """The words, joined the way a viewer will read them."""
        return " ".join(word.text for word in self.words)

    @property
    def duration_ms(self) -> int:
        """How long the cue is on screen."""
        return self.end_ms - self.start_ms


def cue_spans(
    words: Sequence[Word],
    rules: CueRules = DEFAULT_CUE_RULES,
) -> tuple[CueSpan[Word], ...]:
    """Group ``words`` into cues, each held long enough to be read.

    The two halves of the job are separate on purpose: *grouping* looks only at
    what was said and how fast, and *stretching* then gives every group the time
    it needs. Keeping them apart is what makes "this cue is too short to read"
    one rule rather than a condition repeated at every break.
    """
    return _stretch(_groups(words, rules), rules)


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
    groups: list[tuple[TranscriptWord, ...]] = []
    speakers: list[str | None] = []
    for segment in transcript.segments:
        words = segment.words or _spread(segment.text, segment.start_ms, segment.end_ms)
        for group in _groups(words, rules):
            groups.append(group)
            speakers.append(segment.speaker)

    spans = _stretch(groups, rules)
    return tuple(
        _cue(span, index, speaker=speaker)
        for index, (span, speaker) in enumerate(zip(spans, speakers, strict=True))
    )


# -- grouping ----------------------------------------------------------------


def _groups(words: Sequence[Word], rules: CueRules) -> tuple[tuple[Word, ...], ...]:
    """Which words go together, before anyone asks how long they are held."""
    groups: list[tuple[Word, ...]] = []
    group: list[Word] = []
    for word in words:
        if group and _breaks_before(group, word, rules):
            groups.append(tuple(group))
            group = []
        group.append(word)
        if _closes_after(group, rules):
            groups.append(tuple(group))
            group = []
    if group:
        groups.append(tuple(group))
    return tuple(groups)


def _breaks_before(group: Sequence[Word], next_word: Word, rules: CueRules) -> bool:
    """Whether ``next_word`` starts a new cue.

    Silence and speaker are checked here, before the word joins: both are
    properties of the space between two words, not of the group either of them
    is in.
    """
    previous = group[-1]
    if next_word.start_ms - previous.end_ms >= rules.silence_break_ms:
        return True
    if rules.speaker_break and next_word.speaker and next_word.speaker != previous.speaker:
        return True
    joined = " ".join([*(word.text for word in group), next_word.text])
    return len(graphemes(joined)) > rules.max_chars


def _closes_after(group: Sequence[Word], rules: CueRules) -> bool:
    """Whether the group should be closed now that its last word has joined."""
    start, end = group[0].start_ms, group[-1].end_ms
    if end - start > rules.max_duration_ms:
        return True
    text = " ".join(word.text for word in group)
    if len(graphemes(text)) >= rules.max_chars:
        return True
    if chars_per_second(text, start, end) > rules.max_reading_rate_cps:
        return True
    if rules.punctuation_break and end - start >= rules.min_duration_ms:
        return group[-1].text.rstrip().endswith(tuple(_TERMINALS))
    return False


# -- stretching --------------------------------------------------------------


def _stretch(
    groups: Sequence[tuple[Word, ...]],
    rules: CueRules,
) -> tuple[CueSpan[Word], ...]:
    """Hold every group on screen long enough, without ever overlapping.

    "Long enough" is two things: the house minimum, and long enough to read the
    text at the rate cap. The second matters for a group that cannot be made
    smaller — a single word said quickly is a cue of its own, and the only way
    to make it readable is to leave it up.

    Both extensions are bounded the same way: a caption that outlives the next
    line is a caption sitting on top of the next line, which is the bug this
    pass exists to prevent. A cue with no room keeps the timing the speaker gave
    it; you cannot read a word slower than it was said.
    """
    spans: list[CueSpan[Word]] = []
    for position, group in enumerate(groups):
        start_ms = group[0].start_ms
        text = " ".join(word.text for word in group)
        wanted = max(rules.min_duration_ms, time_to_read(text, rules.max_reading_rate_cps))
        following = groups[position + 1] if position + 1 < len(groups) else None
        spans.append(
            CueSpan(
                words=group,
                start_ms=start_ms,
                end_ms=held_until(
                    start_ms,
                    group[-1].end_ms,
                    min_duration_ms=wanted,
                    next_start=following[0].start_ms if following else None,
                    max_duration_ms=rules.max_duration_ms,
                ),
            )
        )
    return tuple(spans)


# -- building one cue ---------------------------------------------------------


def _cue(
    span: CueSpan[TranscriptWord],
    index: int,
    *,
    speaker: str | None,
) -> CaptionSegment:
    """One document cue from one span of transcript words.

    A cue is not clipped to the transcript segment it came from: the segment's
    end is where the provider heard the speech stop, and a cue that stops being
    readable there — a two-hundred-millisecond fragment — is the failure the
    minimum on-screen time exists to prevent. What bounds it instead is the next
    cue, which :func:`_stretch` already did.
    """
    speakers = {word.speaker for word in span.words if word.speaker}
    confidences = [word.confidence for word in span.words]
    return CaptionSegment(
        index=index,
        start_ms=span.start_ms,
        end_ms=span.end_ms,
        text=span.text,
        words=tuple(
            CaptionWord.of(
                word.text,
                word.start_ms,
                word.end_ms,
                confidence=word.confidence,
                speaker=word.speaker,
            )
            for word in span.words
        ),
        # The words agree, or nobody is named: a cue spanning two speakers is
        # only possible with speaker_break off, and it cannot claim either.
        speaker=(speakers.pop() if len(speakers) == 1 else (speaker if not speakers else None)),
        confidence=min(confidences) if confidences else None,
    )


# -- words without timings ----------------------------------------------------


def _spread(text: str, start_ms: int, end_ms: int) -> tuple[TranscriptWord, ...]:
    """Give every word of an untimed stretch a proportional share of its span.

    A provider that returns no word timings still returns text, and a caption
    built from it is better than no caption. The split is weighted by word
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
