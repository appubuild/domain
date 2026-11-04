"""L3 — the Refine stage: a transcript as spoken, turned into text as read.

Speech is not writing. An ASR engine faithfully reports what a person said,
which includes the "um" before every answer, the false start that stops and
begins again, and the third attempt at a word. Captioning those is not
faithfulness — it is noise the viewer has to read around, and every professional
captioner takes it out by hand. This stage is that hand, and the reason it is a
stage and not a setting: it is a pure function from one document to the next, it
can be switched off per pipeline, and a plugin can replace it (ADR-0009 §3).

What it does, in the order it does it:

1. **Phrase repeats** — "we're going to we're going to start" keeps one copy.
   The most visible disfluency and the one that survives every other cleanup.
2. **Stutters** — "I I I went" keeps one "I".
3. **Fillers** — "um", "uh", "er" and their cousins, wherever they stand.
4. **Tidying** — collapsed whitespace, no space before punctuation, a capital at
   the start of each sentence.

What it deliberately does **not** do, and why:

* **It never changes a word it keeps.** No spelling correction, no grammar, no
  expanding "gonna" to "going to". A caption that says something the speaker did
  not is a worse failure than a caption with an "um" in it, and the first is the
  one an editor cannot see.
* **It never re-times a segment.** A segment keeps its span; tightening it to the
  first surviving word would move a caption the editor may already have nudged,
  and the Break stage sets cue boundaries from word spans anyway.
* **It never raises a cue's confidence.** A dropped low-confidence filler leaves
  the document no more certain than it was. Claiming certainty it did not
  measure is how a review pass skips the line that needs one.
* **A locked segment is passed through untouched**, because locked means the
  user's line, not the engine's to clean.

Two rules are the whole risk surface, and both are set to the side of leaving
text alone:

* A word repeated **twice** is kept: "very very good" is emphasis, not a
  stutter, and collapsing it changes what the speaker meant. Three or more of
  the same word in a row is a stutter in any accent
  (:attr:`RefineRules.min_repeat_run`).
* A filler set is **small on purpose**. A missing entry costs a filler that
  survives, which a human can delete in a second; a wrong entry deletes a real
  word, which a human may never notice.

The timings of what is removed are not wasted: a stutter's surviving word keeps
its start and stretches to the end of the run, so karaoke highlight covers the
stutter instead of leaving a hole where it was (ADR-0009 §2 — per-word and
per-letter animation is the point of keeping words at all).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from itertools import pairwise
from string import punctuation
from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.result import Result, ok

if TYPE_CHECKING:
    from collections.abc import Iterable

    from nova_studio.domain.captions import CaptionDocument, CaptionSegment, CaptionWord
    from nova_studio.services.captions.pipeline import StageContext

__all__ = [
    "DEFAULT_FILLERS",
    "DEFAULT_REFINE_RULES",
    "FILLERS_BY_LANGUAGE",
    "RefineRules",
    "Refiner",
    "is_filler",
    "refine_segment",
    "refine_words",
    "tidy_text",
]

#: Words that carry no meaning in English speech.
#:
#: Small on purpose, and "hmm", "mm-hmm", "huh" and "yeah" are deliberately
#: **absent**: those are answers, and deleting a speaker's answer is not a
#: cleanup. `FILLERS_BY_LANGUAGE` extends this for a language the caller names.
DEFAULT_FILLERS: Final[frozenset[str]] = frozenset(
    {"um", "umm", "uhm", "uh", "uhh", "er", "erm", "err", "eh", "ehh", "ah", "ahh"}
)

#: Per-language additions to the default set, for a caller that knows what it is
#: transcribing. Keys are BCP-47 primary language subtags; a language that is
#: not here simply gets the defaults, which is the safe direction.
FILLERS_BY_LANGUAGE: Final[dict[str, frozenset[str]]] = {
    "de": frozenset({"äh", "ähm"}),
    "es": frozenset({"eh", "em"}),
    "fr": frozenset({"euh", "heu"}),
    "it": frozenset({"eh", "emm"}),
    "nl": frozenset({"eh", "em"}),
    "pt": frozenset({"eh", "emm"}),
}

#: Punctuation stripped from both ends of a token before it is compared, so
#: "Um," is recognised as the filler "um".
_STRIPPED: Final[str] = punctuation + "‘’“”…–—"

#: A sentence ends here, for capitalisation.
_SENTENCE_END: Final[re.Pattern[str]] = re.compile(r"(?<=[.!?])\s+")

_SPACE_BEFORE_PUNCTUATION: Final[re.Pattern[str]] = re.compile(r"\s+([,.;:!?])")
#: "world.How" is two sentences; "e.g." and "3.5" are not, which is why this
#: asks for two letters before the full stop and a letter after it.
_MISSING_SPACE_AFTER_SENTENCE: Final[re.Pattern[str]] = re.compile(
    r"(?<=[^\W\d_]{2}[.!?])(?=[^\W\d_])"
)
#: A digit after a comma is a thousand separator, not a missing space.
_MISSING_SPACE_AFTER_CLAUSE: Final[re.Pattern[str]] = re.compile(r"(?<=[,;:!?])(?=[^\W\d_])")
_LEADING_JUNK: Final[re.Pattern[str]] = re.compile(r"^[,;:]+")
_WHITESPACE: Final[re.Pattern[str]] = re.compile(r"\s+")


@dataclass(frozen=True, slots=True, kw_only=True)
class RefineRules:
    """What the Refine stage takes out, and what it leaves alone.

    Every field is something an editor has an opinion about, so every field is
    data: a documentary house style that keeps every "um" and a TikTok one that
    keeps none differ by one object, not by a second code path (ADR-0009 §5's
    principle, applied to text rather than to type).
    """

    #: Words to drop wherever they stand.
    fillers: frozenset[str] = DEFAULT_FILLERS
    #: Drop a word repeated this many times or more in a row.
    min_repeat_run: int = 3
    #: Collapse an immediate repetition of a run of words (a false start).
    phrase_repeats: bool = True
    #: The longest run of words a false start may be made of.
    max_phrase_words: int = 4
    #: Collapse whitespace, unglue punctuation, capitalise sentences.
    tidy_punctuation: bool = True
    #: Drop a segment left with nothing worth reading.
    drop_empty_segments: bool = True

    def __post_init__(self) -> None:
        if self.min_repeat_run < 2:
            raise NovaInvariantError(
                f"min_repeat_run must be at least 2, got {self.min_repeat_run}"
            )
        if not 1 <= self.max_phrase_words <= 12:
            raise NovaInvariantError(
                f"max_phrase_words must be in [1, 12], got {self.max_phrase_words}"
            )

    def with_fillers(self, *words: str) -> RefineRules:
        """The same rules, with these words added to the filler set.

        A project's own vocabulary — a presenter's verbal tic, a podcast's
        catchphrase — arrives here rather than by editing this module.
        """
        return replace(self, fillers=self.fillers | {_normal(word) for word in words})

    def without_fillers(self, *words: str) -> RefineRules:
        """The same rules, with these words no longer treated as fillers."""
        return replace(self, fillers=self.fillers - {_normal(word) for word in words})

    def for_language(self, language: str) -> RefineRules:
        """The same rules, with the fillers of a language added.

        A language nobody has written a set for is not an error: it gets the
        defaults, which miss a foreign filler rather than delete a real word.
        """
        extra = FILLERS_BY_LANGUAGE.get(language.strip().lower().split("-")[0], frozenset())
        return replace(self, fillers=self.fillers | extra) if extra else self


#: The rules a fresh refiner is built with.
DEFAULT_REFINE_RULES: Final[RefineRules] = RefineRules()


@dataclass(frozen=True, slots=True, kw_only=True)
class Refiner:
    """The Refine stage: clean a document's text, keeping its words and time.

    A value rather than a function so a pipeline can carry its own settings —
    the same class in one pipeline leaves everything in and in another takes out
    every filler.

    ``StageContext.language`` is *not* read here: a stage that silently widens
    the rules the caller chose is a stage with a hidden setting. The caller says
    ``RefineRules().for_language("de")`` if that is what it wants.
    """

    #: The stage's name in the pipeline.
    name: str = "refine"
    rules: RefineRules = field(default_factory=RefineRules)

    def apply(self, document: CaptionDocument, ctx: StageContext) -> Result[CaptionDocument]:
        """Clean every unlocked segment, dropping the ones left with nothing."""
        rebuilt: list[CaptionSegment] = []
        for segment in document.segments:
            if segment.locked:
                # Locked means the user's line, not the engine's to clean.
                rebuilt.append(segment)
                continue
            refined = refine_segment(segment, self.rules)
            if refined is not None:
                rebuilt.append(refined)
        return ok(replace(document, segments=tuple(rebuilt)).reindexed())


def refine_segment(segment: CaptionSegment, rules: RefineRules) -> CaptionSegment | None:
    """One cleaned segment, or ``None`` when nothing worth reading is left.

    ``None`` is the honest answer for a segment that was nothing but fillers:
    keeping it would put an empty caption on screen, and inventing text to fill
    it is not this stage's job.
    """
    kept, dropped = _refined(segment.words, rules)
    text = _text_for(segment, kept, dropped, rules)
    if rules.drop_empty_segments and not _readable(text):
        return None
    if not text:
        # An empty caption is not a caption. A caller that asked to keep
        # everything keeps what the segment had rather than a blank line.
        text = segment.text
    return replace(segment, text=text, words=kept)


def refine_words(
    words: tuple[CaptionWord, ...] | list[CaptionWord],
    rules: RefineRules,
) -> tuple[CaptionWord, ...]:
    """The words worth reading, with the stutters and fillers taken out.

    The surviving word objects are the caller's own — same confidence, same
    speaker, same characters, same highlight flag — because a cleanup that
    rebuilt the words would throw away everything the stages after this one
    need (ADR-0009 §2).
    """
    return _refined(words, rules)[0]


def _refined(
    words: tuple[CaptionWord, ...] | list[CaptionWord], rules: RefineRules
) -> tuple[tuple[CaptionWord, ...], tuple[CaptionWord, ...]]:
    """``(kept, dropped)`` from one pass, so neither is guessed afterwards.

    Fillers go first — not merely before the other rules in the loop, but out
    of the sequence entirely: taking "um" out is what lets "go to the, um, go to
    the" be recognised as the false start it is.
    """
    source = tuple(words)
    dropped: list[CaptionWord] = [word for word in source if is_filler(word, rules)]
    survivors: tuple[CaptionWord, ...] = tuple(
        word for word in source if not is_filler(word, rules)
    )
    kept: list[CaptionWord] = []
    index = 0
    while index < len(survivors):
        if rules.phrase_repeats:
            repeated = _repeated_run(survivors, index, rules)
            if repeated:
                kept.extend(survivors[index : index + repeated])
                dropped.extend(survivors[index + repeated : index + 2 * repeated])
                index += 2 * repeated
                continue
        run = _identical_run(survivors, index, rules)
        if run:
            kept.append(_absorbed(survivors[index : index + run]))
            dropped.extend(survivors[index + 1 : index + run])
            index += run
            continue
        kept.append(survivors[index])
        index += 1
    return tuple(kept), tuple(dropped)


def is_filler(word: CaptionWord, rules: RefineRules) -> bool:
    """Whether a word carries no meaning and should go."""
    return _normal(word.text) in rules.fillers


def tidy_text(text: str) -> str:
    """Text as it is read: one space between words, punctuation where it
    belongs, a capital where a sentence starts.

    Applied to text that already exists — never to words, which are left exactly
    as the provider reported them.
    """
    collapsed = _WHITESPACE.sub(" ", text).strip()
    unglued = _SPACE_BEFORE_PUNCTUATION.sub(r"\1", collapsed)
    spaced = _MISSING_SPACE_AFTER_CLAUSE.sub(" ", _MISSING_SPACE_AFTER_SENTENCE.sub(" ", unglued))
    return _capitalised(_LEADING_JUNK.sub("", spaced).strip())


# -- the rules, one at a time -------------------------------------------------


def _repeated_run(words: tuple[CaptionWord, ...], at: int, rules: RefineRules) -> int:
    """The length of a run of words that immediately repeats itself.

    "we're going to we're going to start" repeats a run of three. Longest match
    wins, so a three-word false start is not mistaken for three one-word
    stutters — and the comparison is on normalised text, so "We're" matches
    "we're".
    """
    remaining = len(words) - at
    for length in range(min(rules.max_phrase_words, remaining // 2), 1, -1):
        first = [_normal(word.text) for word in words[at : at + length]]
        second = [_normal(word.text) for word in words[at + length : at + 2 * length]]
        if first == second and len(set(first)) > 1:
            # Two distinct words at least: one word four times is a stutter,
            # not a false start, and the stutter rule is the one for it.
            return length
    return 0


def _identical_run(words: tuple[CaptionWord, ...], at: int, rules: RefineRules) -> int:
    """How many times the word at ``at`` repeats itself, or ``0`` once."""
    token = _normal(words[at].text)
    if not token:
        return 0
    run = 1
    while at + run < len(words) and _normal(words[at + run].text) == token:
        run += 1
    return run if run >= rules.min_repeat_run else 0


def _absorbed(run: tuple[CaptionWord, ...]) -> CaptionWord:
    """One word standing for a stutter, covering the whole run's span.

    The first word's start, the last word's end: the highlight sweeps across the
    stutter instead of stopping where it began. Its characters stay inside it,
    because the span only ever grows.
    """
    return replace(run[0], end_ms=run[-1].end_ms)


# -- text ---------------------------------------------------------------------


def _text_for(
    segment: CaptionSegment,
    kept: tuple[CaptionWord, ...],
    dropped: tuple[CaptionWord, ...],
    rules: RefineRules,
) -> str:
    """The segment's text with the same words gone that went from its words."""
    if not segment.words:
        # Nothing to rebuild from: tidy what is already there.
        return tidy_text(segment.text) if rules.tidy_punctuation else segment.text
    joined = " ".join(word.text for word in kept)
    if not dropped or _same_words(segment):
        # A token carries its own punctuation, so the joined survivors *are*
        # the text minus the fillers.
        text = joined
    else:
        # The text and the words disagree — a human added punctuation, or the
        # provider did not punctuate its tokens. Take the words out of the text
        # rather than rebuilding it, so nothing a human wrote is lost.
        text = _without_words(segment.text, dropped)
    return tidy_text(text) if rules.tidy_punctuation else text


def _same_words(segment: CaptionSegment) -> bool:
    """Whether the segment's text is exactly its words joined by spaces."""
    joined = " ".join(word.text for word in segment.words)
    return _WHITESPACE.sub(" ", segment.text).strip() == _WHITESPACE.sub(" ", joined).strip()


def _without_words(text: str, dropped: Iterable[CaptionWord]) -> str:
    """Text with each dropped word's token taken out of it, once."""
    for word in dropped:
        token = re.escape(_normal(word.text))
        if token:
            text = re.sub(rf"(?i)(?<!\w){token}[{re.escape(_STRIPPED)}]*(?!\w)", "", text, count=1)
    return text


def _capitalised(text: str) -> str:
    """A capital at the start of every sentence, and nowhere else.

    Only the first letter is touched: never lowering anything is what keeps a
    proper noun, an acronym and a brand name exactly as the provider heard
    them. A capital is *not* added after an initial — "U.S.A. is big", "see
    e.g. this" — because "U.S.A. Is big" is the kind of error a viewer notices,
    and a lower-case word after an abbreviation is not.
    """
    parts = _SENTENCE_END.split(text)
    capitalised = [_capitalise(parts[0])]
    for previous, part in pairwise(parts):
        capitalised.append(part if _ends_with_initial(previous) else _capitalise(part))
    return " ".join(capitalised)


def _ends_with_initial(sentence: str) -> bool:
    """Whether a sentence ends in one letter and a full stop: "e.g.", "U.S.A."."""
    tokens = sentence.split()
    if not tokens:
        return False
    tail = tokens[-1].rstrip(".").split(".")[-1]
    return len(tail) == 1 and tail.isalpha()


def _capitalise(sentence: str) -> str:
    if not sentence:
        return sentence
    if sentence.casefold() == "i":
        # A lower-case i that starts a sentence is wrong in every Latin script.
        return "I"
    head = sentence[0]
    return head.upper() + sentence[1:] if head.isalpha() else sentence


def _readable(text: str) -> bool:
    """Whether there is anything to read, punctuation aside."""
    return any(character.isalnum() for character in text)


def _normal(token: str) -> str:
    """A token as it is compared: lower case, punctuation trimmed."""
    return token.strip(_STRIPPED).casefold()
