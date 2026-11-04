"""L3 — the Emoji stage: a picture beside the words (ADR-0009 §3).

A viewer reads a caption in about a second and a half. An emoji is read in a
tenth of that, which is why every phone-caption style has one: it says what the
line is about before the words land. This stage puts it there, in the one place
a cue has for it — :attr:`~nova_studio.domain.captions.CaptionSegment.emoji`,
content rather than styling, so it survives a template change and travels with
the text when a cue is re-broken.

How the emoji is chosen is deliberately boring: **a map from words to emoji**,
matched against the cue's own words, longest phrase first. Boring is the point. A
sentiment model would be a network call in the middle of a pure pipeline, would
need weights no CI machine has, and would be wrong in ways nobody could predict
or correct. A map is data: a project adds its own, a plugin ships one for a
trade, a user deletes the entry that annoys them, and every one of those is a
change anyone can read.

Three decisions are worth stating:

**Concrete words only.** The default map holds nouns and unambiguous emotions —
"coffee", "birthday", "pizza", "sad". It does not hold "no", "yes" or "time":
those are sentence particles before they are pictures, and a cross on every
"no" is the kind of touch that makes a professional caption look automated.

**The longest phrase wins.** "good morning" gets one sunrise, not a sun and a
morning. Matching a run of words first is what keeps a phrase from being read
as its parts.

**An emoji already there is kept.** Deciding is this stage's job; re-deciding
over a human's choice is not. A cue that carries an emoji — from the inspector,
from a plugin, from a previous run — is left alone.

What it will not do: it never changes a word, never re-times a cue, never
touches a locked segment, and never puts a space in the field, because a run of
pictures is one glyph string and text belongs in the text.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from types import MappingProxyType
from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.result import Result, ok

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

    from nova_studio.domain.captions import CaptionDocument, CaptionSegment, CaptionWord
    from nova_studio.services.captions.pipeline import StageContext

__all__ = [
    "DEFAULT_EMOJI",
    "DEFAULT_EMOJI_RULES",
    "EmojiDecorator",
    "EmojiRules",
    "decorate_segment",
    "emoji_for",
]

#: What a word is worth a picture of.
#:
#: Concrete on purpose. Adding to this is a data change a project or a plugin
#: makes for itself (:meth:`EmojiRules.with_mapping`); the test of an entry is
#: whether a professional captioner would put it there.
DEFAULT_EMOJI: Final[Mapping[str, str]] = MappingProxyType(
    {
        "baby": "👶",
        "beach": "🏖️",
        "beer": "🍺",
        "birthday": "🎂",
        "book": "📖",
        "camera": "📷",
        "car": "🚗",
        "cat": "🐱",
        "coffee": "☕",
        "computer": "💻",
        "dog": "🐶",
        "fire": "🔥",
        "flight": "✈️",
        "flower": "🌸",
        "food": "🍽️",
        "football": "⚽",
        "game": "🎮",
        "gift": "🎁",
        "good luck": "🍀",
        "good morning": "🌅",
        "good night": "🌙",
        "guitar": "🎸",
        "happy": "😊",
        "happy birthday": "🎂",
        "heart": "❤️",
        "home": "🏠",
        "idea": "💡",
        "keyboard": "⌨️",
        "love": "❤️",
        "merry christmas": "🎄",
        "money": "💰",
        "moon": "🌙",
        "mountain": "⛰️",
        "movie": "🎬",
        "new year": "🎊",
        "music": "🎵",
        "party": "🎉",
        "phone": "📱",
        "pizza": "🍕",
        "plane": "✈️",
        "rain": "🌧️",
        "rocket": "🚀",
        "sad": "😢",
        "school": "🏫",
        "sleep": "😴",
        "snow": "❄️",
        "star": "⭐",
        "sun": "☀️",
        "thank you": "🙏",
        "tree": "🌳",
        "video": "🎬",
        "wedding": "💍",
        "wine": "🍷",
        "won": "🏆",
    }
)


@dataclass(frozen=True, slots=True, kw_only=True)
class EmojiRules:
    """Which words get a picture, and how many a line may carry."""

    #: Word or phrase → emoji. Keys are compared lower case, punctuation
    #: trimmed, whatever the caller wrote.
    #:
    #: A factory rather than a default because a mapping is not hashable, and
    #: it hands back the same shared object every time, so the common case costs
    #: no copy at all.
    mapping: Mapping[str, str] = field(default_factory=lambda: DEFAULT_EMOJI)
    #: The most emoji one cue may carry.
    max_per_segment: int = 1
    #: Match a run of words before a single word.
    phrases: bool = True
    #: The longest phrase worth looking for.
    max_phrase_words: int = 3
    #: Leave a cue that already carries an emoji alone.
    keep_existing: bool = True

    def __post_init__(self) -> None:
        if self.max_per_segment < 0:
            raise NovaInvariantError(
                f"max_per_segment must not be negative, got {self.max_per_segment}"
            )
        if self.max_phrase_words < 1:
            raise NovaInvariantError(
                f"max_phrase_words must be at least 1, got {self.max_phrase_words}"
            )

    def with_mapping(self, mapping: Mapping[str, str]) -> EmojiRules:
        """The same rules, with these words added to the map.

        How a project says what it is about: a channel's own vocabulary, a
        trade's own shorthand, one person's running joke.
        """
        return replace(self, mapping={**self.mapping, **mapping})

    def without_words(self, *words: str) -> EmojiRules:
        """The same rules, with these words no longer decorated."""
        gone = {" ".join(_word(token) for token in word.split()) for word in words}
        return replace(
            self, mapping={key: value for key, value in self.mapping.items() if key not in gone}
        )


#: The rules a fresh decorator is built with.
DEFAULT_EMOJI_RULES: Final[EmojiRules] = EmojiRules()


@dataclass(frozen=True, slots=True, kw_only=True)
class EmojiDecorator:
    """The Emoji stage: give each cue the picture that goes with its words.

    A value rather than a function so a pipeline can carry its own settings —
    the same class in one pipeline decorates nothing and in another decorates
    every cue that mentions coffee.
    """

    #: The stage's name in the pipeline.
    name: str = "emoji"
    rules: EmojiRules = field(default_factory=EmojiRules)

    def apply(self, document: CaptionDocument, ctx: StageContext) -> Result[CaptionDocument]:
        """Decorate every unlocked cue that has an emoji coming to it."""
        lookup = _lookup(self.rules)
        rebuilt = tuple(
            segment
            if segment.locked or (self.rules.keep_existing and segment.emoji)
            else decorate_segment(segment, self.rules, lookup=lookup)
            for segment in document.segments
        )
        return ok(replace(document, segments=rebuilt).reindexed())


def decorate_segment(
    segment: CaptionSegment,
    rules: EmojiRules = DEFAULT_EMOJI_RULES,
    *,
    lookup: Mapping[str, str] | None = None,
) -> CaptionSegment:
    """One cue with its emoji set, or left exactly as it was.

    Left as it was when nothing in it is worth a picture — and also when it
    already carries one and the rules say to keep it, because deciding again is
    not this stage's business. With :attr:`EmojiRules.keep_existing` off, the
    stage owns the field outright: a cue that earns nothing is cleared.
    """
    if rules.keep_existing and segment.emoji:
        return segment
    emoji = emoji_for(segment.words, rules, lookup=lookup)
    if not emoji and rules.keep_existing:
        # Nothing earned and nothing to take away: leave the cue exactly as it was.
        return segment
    return segment.with_emoji(emoji)


def emoji_for(
    words: Sequence[CaptionWord],
    rules: EmojiRules = DEFAULT_EMOJI_RULES,
    *,
    lookup: Mapping[str, str] | None = None,
) -> str:
    """The emoji a line earns, as one string — empty when it earns none.

    ``lookup`` is the normalised map, for a caller that has already built one
    (the stage does, once for the whole document rather than once per cue).
    """
    table = _lookup(rules) if lookup is None else lookup
    source = tuple(words)
    found: list[str] = []
    index = 0
    while index < len(source) and len(found) < rules.max_per_segment:
        matched = _match_at(source, index, table, rules)
        if matched is None:
            index += 1
            continue
        emoji, length = matched
        if emoji not in found:
            found.append(emoji)
        index += length
    return "".join(found)


def _match_at(
    words: tuple[CaptionWord, ...],
    at: int,
    table: Mapping[str, str],
    rules: EmojiRules,
) -> tuple[str, int] | None:
    """The longest phrase starting here that the map knows, and how long it is."""
    longest = min(rules.max_phrase_words, len(words) - at) if rules.phrases else 1
    for length in range(longest, 0, -1):
        phrase = " ".join(_word(word.text) for word in words[at : at + length])
        emoji = table.get(phrase)
        if emoji:
            return emoji, length
    return None


def _lookup(rules: EmojiRules) -> Mapping[str, str]:
    """The map with its keys normalised, so "Good Morning," is "good morning".

    The default is normalised once at import: it is the map nearly every project
    uses, and rebuilding it per cue would be work with no answer in it.
    """
    if rules.mapping is DEFAULT_EMOJI:
        return _NORMALISED_DEFAULT
    return {
        " ".join(_word(token) for token in key.split()): value
        for key, value in rules.mapping.items()
    }


def _word(token: str) -> str:
    """A token as it is matched: lower case, punctuation trimmed from the ends."""
    return token.strip("""!"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~""").casefold()


_NORMALISED_DEFAULT: Final[Mapping[str, str]] = {
    " ".join(_word(token) for token in key.split()): value for key, value in DEFAULT_EMOJI.items()
}
