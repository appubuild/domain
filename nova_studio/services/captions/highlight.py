"""L3 — the Highlight stage: which words a viewer's eye should land on.

A caption is read in about a second and a half, and in that time a viewer takes
one thing away. Every captioning style that works on a phone — karaoke, the
popping word, the number that flashes — is the same idea: something in the line
is *the* word, and the styling says so. `CaptionWord.highlight` is that flag
(ADR-0009 §2), and this stage is what sets it.

It is a stage and not a renderer setting because deciding is separable from
drawing: the templates and the animation baker consume the flag, and this module
knows nothing about either. A plugin can replace it with a sentiment model, a
keyword list from a brief, or nothing at all (ADR-0009 §3).

Five signals, each switchable, each worth the weight it carries:

1. **Numbers** — "47", "3.5", "1,000". The most reliably interesting thing in a
   line, and the one every phone-caption style already emphasises.
2. **Quantities** — a number *and* the unit beside it: "5 minutes", "30%". The
   unit is highlighted with the number because "5 minutes" is one idea.
3. **Held words** — a word the speaker stressed, read from the timings we
   already have: much longer than the speaker's median word. No model, no
   lexicon, and it is the only signal here that hears the performance rather
   than reading the words.
4. **Names** — a proper noun, on its first mention only. The second time, the
   viewer has met them.
5. **Repeated terms** — what a speaker says three times is what they are
   talking about, once stop words are out of the way.

Why weights and a cap rather than a list of rules that fire in order: a line can
be interesting in several ways at once, and a cue with six highlighted words is
a cue with none — the eye has nowhere to go. Every candidate is scored, the
best two win (:attr:`HighlightRules.max_per_segment`), and the order is
deterministic, so the same document always styles the same way.

What it will not do:

* **Never unset a highlight.** One the user or an earlier stage set is kept, and
  it does not spend the cap: a human's choice outranks a heuristic's.
* **Never touch a locked segment**, for the reason every stage has.
* **Never highlight a filler.** If Refine is switched off, an "um" is still not
  the word of the line.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from statistics import median
from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.result import Result, ok
from nova_studio.services.captions.refine import DEFAULT_FILLERS

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

    from nova_studio.domain.captions import CaptionDocument, CaptionSegment, CaptionWord
    from nova_studio.services.captions.pipeline import StageContext

__all__ = [
    "DEFAULT_HIGHLIGHT_RULES",
    "DEFAULT_STOP_WORDS",
    "DEFAULT_UNITS",
    "HighlightRules",
    "Highlighter",
    "held_words",
    "highlight_segment",
    "highlight_words",
    "is_number",
    "term_counts",
    "term_counts_of",
]

#: Words too common to be a subject. Smaller than a real stop-word list on
#: purpose: this is not a search index, and a word missing from it costs a
#: highlight nobody wanted rather than one somebody did.
DEFAULT_STOP_WORDS: Final[frozenset[str]] = frozenset(
    {
        "a",
        "about",
        "after",
        "all",
        "also",
        "am",
        "an",
        "and",
        "any",
        "are",
        "as",
        "at",
        "be",
        "because",
        "been",
        "but",
        "by",
        "can",
        "do",
        "does",
        "did",
        "for",
        "from",
        "get",
        "go",
        "going",
        "got",
        "had",
        "has",
        "have",
        "he",
        "her",
        "here",
        "him",
        "his",
        "how",
        "i",
        "if",
        "in",
        "into",
        "is",
        "it",
        "its",
        "just",
        "know",
        "like",
        "me",
        "my",
        "no",
        "not",
        "now",
        "of",
        "on",
        "one",
        "or",
        "our",
        "out",
        "over",
        "really",
        "said",
        "say",
        "she",
        "so",
        "some",
        "than",
        "that",
        "the",
        "their",
        "them",
        "then",
        "there",
        "they",
        "this",
        "to",
        "up",
        "us",
        "was",
        "we",
        "were",
        "what",
        "when",
        "which",
        "who",
        "why",
        "will",
        "with",
        "you",
        "your",
    }
)

#: Units that turn a number into a quantity. Data, so a project can add its own
#: ("views", "subscribers", a currency, a unit of its own trade).
DEFAULT_UNITS: Final[frozenset[str]] = frozenset(
    {
        "%",
        "percent",
        "degrees",
        "dollars",
        "euros",
        "feet",
        "g",
        "gb",
        "grams",
        "hours",
        "inches",
        "kg",
        "kilometres",
        "kilometers",
        "km",
        "lb",
        "liters",
        "litres",
        "m",
        "meters",
        "metres",
        "miles",
        "minutes",
        "months",
        "pounds",
        "seconds",
        "tb",
        "weeks",
        "years",
    }
)

#: How much each signal is worth. Ordinal, not a probability: the only thing
#: these numbers do is order the candidates in one line.
_SCORE_NUMBER: Final[int] = 3
_SCORE_HELD: Final[int] = 2
_SCORE_NAME: Final[int] = 2
_SCORE_SHOUTED: Final[int] = 2
_SCORE_QUANTITY: Final[int] = 2
_SCORE_REPEATED: Final[int] = 1

_DIGIT: Final[re.Pattern[str]] = re.compile(r"\d")
_TRAILING_PUNCTUATION: Final[re.Pattern[str]] = re.compile(r"[^\w%]+$")


@dataclass(frozen=True, slots=True, kw_only=True)
class HighlightRules:
    """Which words are worth the viewer's eye, and how many at a time.

    Every field is something a house style has an opinion about, so every field
    is data (ADR-0009 §5): a podcast that highlights nothing and a TikTok that
    highlights a number every time differ by one object.
    """

    #: Highlight a token containing a digit.
    numbers: bool = True
    #: Highlight the unit that stands beside a number.
    quantities: bool = True
    #: Highlight a word said in capitals.
    shouted: bool = True
    #: Highlight a word the speaker held much longer than their median word.
    held_words: bool = True
    #: How much longer, as a multiple of the speaker's median word.
    held_factor: float = 2.5
    #: ...and never below this, so a fast talker is not all emphasis.
    held_min_ms: int = 220
    #: Highlight a proper noun the first time it is said.
    names: bool = True
    #: Highlight a term the speaker keeps coming back to.
    repeated_terms: bool = True
    #: How many times before a term is the subject of the piece.
    min_term_repeats: int = 3
    #: How long a word must be to count as a term.
    min_term_chars: int = 4
    #: The most words one cue may highlight.
    max_per_segment: int = 2
    #: Never highlight a filler, even one Refine left behind.
    skip_fillers: bool = True
    #: A highlight already set is kept, and does not spend the cap.
    respect_existing: bool = True
    #: Words too common to be the subject of a line.
    stop_words: frozenset[str] = DEFAULT_STOP_WORDS
    #: Units that make a number into a quantity.
    units: frozenset[str] = DEFAULT_UNITS

    def __post_init__(self) -> None:
        if self.max_per_segment < 0:
            raise NovaInvariantError(
                f"max_per_segment must not be negative, got {self.max_per_segment}"
            )
        if self.held_factor < 1.0:
            raise NovaInvariantError(f"held_factor must be at least 1.0, got {self.held_factor}")
        if self.min_term_repeats < 2:
            raise NovaInvariantError(
                f"min_term_repeats must be at least 2, got {self.min_term_repeats}"
            )

    def with_stop_words(self, *words: str) -> HighlightRules:
        """The same rules, with these words treated as too common to highlight."""
        return replace(self, stop_words=self.stop_words | {_term(word) for word in words})

    def without_stop_words(self, *words: str) -> HighlightRules:
        """The same rules, with these words eligible after all."""
        return replace(self, stop_words=self.stop_words - {_term(word) for word in words})

    def with_units(self, *words: str) -> HighlightRules:
        """The same rules, counting these words as units beside a number.

        A project's own quantities: "subscribers", a currency, a unit of a
        trade. Data here, not a change to this module.
        """
        return replace(self, units=self.units | {_term(word) for word in words})

    def without_units(self, *words: str) -> HighlightRules:
        """The same rules, with these words no longer read as units."""
        return replace(self, units=self.units - {_term(word) for word in words})


#: The rules a fresh highlighter is built with.
DEFAULT_HIGHLIGHT_RULES: Final[HighlightRules] = HighlightRules()


@dataclass(frozen=True, slots=True, kw_only=True)
class Highlighter:
    """The Highlight stage: mark the words a line is about.

    A value rather than a function so a pipeline can carry its own settings —
    the same class in one pipeline marks nothing and in another marks the number
    in every cue.
    """

    #: The stage's name in the pipeline.
    name: str = "highlight"
    rules: HighlightRules = field(default_factory=HighlightRules)

    def apply(self, document: CaptionDocument, ctx: StageContext) -> Result[CaptionDocument]:
        """Mark every unlocked segment, leaving locked ones exactly as they are."""
        counts = term_counts(document, self.rules)
        typical = _median_duration(document)
        rebuilt: list[CaptionSegment] = []
        seen: set[str] = set()
        for segment in document.segments:
            before = frozenset(seen)
            seen.update(_term(word.text) for word in segment.words)
            if segment.locked:
                rebuilt.append(segment)
                continue
            rebuilt.append(
                replace(
                    segment,
                    words=highlight_words(
                        segment.words,
                        self.rules,
                        counts=counts,
                        median_ms=typical,
                        seen=before,
                    ),
                )
            )
        return ok(replace(document, segments=tuple(rebuilt)).reindexed())


def highlight_segment(
    segment: CaptionSegment,
    rules: HighlightRules = DEFAULT_HIGHLIGHT_RULES,
    *,
    counts: Mapping[str, int] | None = None,
    median_ms: int | None = None,
    seen: frozenset[str] = frozenset(),
) -> CaptionSegment:
    """One segment with its words marked.

    Used by the stage and by anything that wants to mark one line on its own —
    an inspector panel previewing "what would this style emphasise here?".
    """
    return replace(
        segment,
        words=highlight_words(
            segment.words,
            rules,
            counts=counts if counts is not None else term_counts_of(segment.words, rules),
            median_ms=median_ms,
            seen=seen,
        ),
    )


def highlight_words(
    words: Sequence[CaptionWord],
    rules: HighlightRules = DEFAULT_HIGHLIGHT_RULES,
    *,
    counts: Mapping[str, int] | None = None,
    median_ms: int | None = None,
    seen: frozenset[str] = frozenset(),
) -> tuple[CaptionWord, ...]:
    """The same words, with the best of them marked.

    The word objects that come back are the caller's own — same text, timings,
    characters and confidence — with ``highlight`` set on the ones that won.
    Nothing else about them changes, because everything the stages after this
    one need is on them (ADR-0009 §2).

    A highlight already set is kept by default; with
    :attr:`HighlightRules.respect_existing` off, this stage takes the cue over
    completely and a mark that does not make the cut is taken back.
    """
    source = tuple(words)
    if not source:
        return source
    tally = counts if counts is not None else term_counts_of(source, rules)
    typical = median_ms if median_ms is not None else _median_of(source)
    held = held_words(source, typical, rules)

    scored: list[tuple[int, int]] = []  # (index, score)
    heard: set[str] = set(seen)
    for index, word in enumerate(source):
        term = _term(word.text)
        before = frozenset(heard)
        heard.add(term)
        if rules.respect_existing and word.highlight:
            continue
        if rules.skip_fillers and term in DEFAULT_FILLERS:
            continue
        score = _score(index, source, rules, tally, held, before)
        if score:
            scored.append((index, score))
    scored.sort(key=lambda pair: (-pair[1], pair[0]))
    chosen = {index for index, _ in scored[: rules.max_per_segment]}

    return tuple(
        replace(
            word,
            highlight=index in chosen or (word.highlight and rules.respect_existing),
        )
        for index, word in enumerate(source)
    )


def term_counts(
    document: CaptionDocument, rules: HighlightRules = DEFAULT_HIGHLIGHT_RULES
) -> Mapping[str, int]:
    """How often each term is said across a whole document.

    Counted over the document rather than the cue, because "what is this about"
    is a question about the whole piece — and a term said once per cue for five
    cues is the subject of all of them.
    """
    return term_counts_of(
        tuple(word for segment in document.segments for word in segment.words), rules
    )


def term_counts_of(
    words: Sequence[CaptionWord], rules: HighlightRules = DEFAULT_HIGHLIGHT_RULES
) -> Mapping[str, int]:
    """How often each eligible term appears in these words."""
    tally: dict[str, int] = {}
    for word in words:
        term = _term(word.text)
        if _is_term(term, rules):
            tally[term] = tally.get(term, 0) + 1
    return tally


def held_words(
    words: Sequence[CaptionWord], typical_ms: int, rules: HighlightRules = DEFAULT_HIGHLIGHT_RULES
) -> frozenset[int]:
    """Which words the speaker held, by index.

    A duration is evidence, not a measurement of stress — but a word two and a
    half times longer than the speaker's median is one they leaned on, and we
    already have the timings. Empty when :attr:`HighlightRules.held_words` is
    off or when the words are too short for the comparison to mean anything.
    """
    if not rules.held_words or typical_ms <= 0:
        return frozenset()
    threshold = max(rules.held_min_ms, rules.held_factor * typical_ms)
    return frozenset(
        index
        for index, word in enumerate(words)
        if word.duration_ms >= threshold and _term(word.text) not in DEFAULT_FILLERS
    )


def is_number(token: str) -> bool:
    """Whether a token carries a number: "47", "3.5", "1,000", "30%"."""
    return bool(_DIGIT.search(token))


# -- scoring -----------------------------------------------------------------


def _score(
    index: int,
    words: tuple[CaptionWord, ...],
    rules: HighlightRules,
    tally: Mapping[str, int],
    held: frozenset[int],
    seen: frozenset[str],
) -> int:
    """How much a word deserves the eye. ``0`` means it does not.

    ``seen`` holds every term already said, including the ones earlier in this
    very cue: a name is new once, and the second "Nova" in one line is not a
    second introduction.
    """
    token = words[index].text
    if rules.numbers and is_number(token):
        return _SCORE_NUMBER
    if rules.quantities and index and is_number(words[index - 1].text) and _is_unit(token, rules):
        return _SCORE_QUANTITY
    if index in held:
        return _SCORE_HELD
    if rules.names and _is_name(token, index, seen):
        return _SCORE_NAME
    if rules.shouted and _is_shouted(token):
        return _SCORE_SHOUTED
    if rules.repeated_terms and tally.get(_term(token), 0) >= rules.min_term_repeats:
        return _SCORE_REPEATED
    return 0


def _is_name(token: str, index: int, seen: frozenset[str]) -> bool:
    """A proper noun, the first time it is said.

    The first word of a line is not evidence: Refine capitalises the start of a
    sentence, so every cue would have one. Nor is a single capital letter, which
    is almost always "I".
    """
    if index == 0 or len(token) < 2 or not token[:1].isupper():
        return False
    if _is_shouted(token):
        return False  # that is emphasis, and it has its own weight
    return _term(token) not in seen


def _is_shouted(token: str) -> bool:
    """A word said in capitals: "NEVER", "STOP"."""
    letters = [character for character in token if character.isalpha()]
    return len(letters) > 1 and all(character.isupper() for character in letters)


def _is_unit(token: str, rules: HighlightRules) -> bool:
    return _term(token) in rules.units


def _is_term(term: str, rules: HighlightRules) -> bool:
    """Whether a term is eligible to be the subject of a piece.

    Fillers are excluded for the same reason they are never marked, unless the
    caller has said to treat them like any other word
    (:attr:`HighlightRules.skip_fillers`).
    """
    return (
        len(term) >= rules.min_term_chars
        and term not in rules.stop_words
        and not is_number(term)
        and (not rules.skip_fillers or term not in DEFAULT_FILLERS)
    )


def _term(token: str) -> str:
    """A token as it is counted and compared: lower case, punctuation trimmed."""
    return _TRAILING_PUNCTUATION.sub("", token).strip().casefold()


def _median_duration(document: CaptionDocument) -> int:
    """How long the speaker's words typically are, across the whole document."""
    durations = [word.duration_ms for segment in document.segments for word in segment.words]
    return int(median(durations)) if durations else 0


def _median_of(words: Sequence[CaptionWord]) -> int:
    durations = [word.duration_ms for word in words]
    return int(median(durations)) if durations else 0
