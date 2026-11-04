"""L2 — captions: the authoring model (ADR-0009 §2, §7, §8).

This is the document the user edits.  It is *not* a transcript:
:mod:`nova_studio.domain.asr` is what a model said, and this is what the editor
holds — cues, words, characters, layers, style overrides, revisions and the
overlay of human edits.  The pipeline turns a :class:`~nova_studio.domain.asr.Transcript`
into a :class:`CaptionDocument`; nothing after that point may overwrite what a
person corrected.

Four decisions carry the weight:

1. **Three granularities, all first-class.**  ``CaptionSegment`` → ``CaptionWord``
   → ``CaptionChar``.  Character timings are what make letter-by-letter animation
   possible, and they are derived by
   :func:`split_chars` when a provider supplies only word timings — a weighted
   proportional split, since a vowel really is held longer than a consonant.
   Every derived character is marked :attr:`CaptionChar.estimated` so the UI can
   say so instead of presenting a guess as a measurement.
2. **Time is integer milliseconds**, as in ``domain/asr.py``: a caption knows the
   edit rate only through the timeline it is committed to.  Frames are computed
   once, at that boundary (:meth:`CaptionSegment.frame_range`), with a stated
   rounding mode.
3. **Human edits are a delta overlay, not a rewrite.**  A re-transcription
   produces a new *base* revision; :func:`merge_deltas` re-attaches the user's
   corrections by alignment key and returns, explicitly, what it could not
   re-attach.  The one destructive rule is deliberate and reported: a text edit
   on a segment that carries word timings discards those timings, because
   timings that no longer describe the words are exactly the "silently wrong
   caption" the ADR forbids.  They are listed in
   :attr:`CaptionMergeOutcome.timings_dropped`, never dropped quietly.
4. **Nothing is validated by hope.**  :func:`validate_caption_document` returns a
   sentence describing the first thing that is wrong — overlapping cues, a cue
   too short to read, a cue read faster than anyone can read, words outside their
   cue.  A document that fails it must not reach the renderer.

Deliberately not here: how a cue is *drawn*.  Typography, decoration and
animation are data — :class:`CaptionTemplate` and friends — and the object that
turns a template plus a document into keyframes is the ``AnimationBaker``
(ADR-0009 §6).  Those arrive with the styling module; this file is the text, the
time and the truth of the user's edits.
"""

from __future__ import annotations

import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Final

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.temporal import Rounding, Timebase
from nova_studio.domain._wire import (
    optional_float as _optional_float,
    optional_int as _optional_int,
    optional_str as _optional_str,
    reject_unknown_fields as _reject_unknown_fields,
    wire_float as _wire_float,
    wire_int as _wire_int,
    wire_mappings as _wire_mappings,
    wire_str as _wire_str,
)
from nova_studio.domain.asr import frames_for_ms

__all__ = [
    "ALIGNMENT_KEY_BUCKET_MS",
    "CAPTION_DOCUMENT_VERSION",
    "CAPTION_MAX_CPS",
    "CAPTION_MAX_LINES",
    "CAPTION_MAX_LINE_CHARS",
    "CAPTION_MIN_DURATION_MS",
    "DEFAULT_LAYER_ID",
    "DEFAULT_MERGE_TOLERANCE_MS",
    "CaptionAnchor",
    "CaptionChar",
    "CaptionDelta",
    "CaptionDeltaKind",
    "CaptionDocument",
    "CaptionLayer",
    "CaptionLayerKind",
    "CaptionMergeOutcome",
    "CaptionPosition",
    "CaptionRect",
    "CaptionRevision",
    "CaptionSegment",
    "CaptionTarget",
    "CaptionWord",
    "RevisionOrigin",
    "SafeArea",
    "alignment_key",
    "graphemes",
    "merge_deltas",
    "normalise_text",
    "reading_rate_cps",
    "split_chars",
    "validate_caption_document",
    "wrap_caption",
]

#: Bumped only with a migration; the store refuses a newer version rather than
#: guessing at it (ADR-0015 rule 5).
CAPTION_DOCUMENT_VERSION: Final[int] = 1

#: Below this, a cue cannot be read — the eye needs about half a second to
#: register and read a line.
CAPTION_MIN_DURATION_MS: Final[int] = 500

#: Reading-speed ceiling in characters per second.  Broadcast practice sits near
#: 17; 20 is the point past which viewers report falling behind.
CAPTION_MAX_CPS: Final[int] = 20

#: Characters per line before a cue is broken.  42 is the usual broadcast
#: figure for a 16:9 frame at a readable size.
CAPTION_MAX_LINE_CHARS: Final[int] = 42

#: Lines a single cue may occupy.
CAPTION_MAX_LINES: Final[int] = 2

#: The layer every segment belongs to unless it says otherwise.
DEFAULT_LAYER_ID: Final[str] = "primary"

#: Alignment keys bucket the start time, so a re-transcription that shifts a
#: cue by a few hundred milliseconds still resolves to the same key.
ALIGNMENT_KEY_BUCKET_MS: Final[int] = 500

#: How far from its original timing a correction may drift and still be
#: re-attached by text match (ADR-0009 §7).
DEFAULT_MERGE_TOLERANCE_MS: Final[int] = 2_000

#: Character-class weights for the proportional split (ADR-0009 §2).  A vowel
#: is held longer than a consonant; a CJK glyph or an emoji is wider than a
#: letter; punctuation is barely held at all.
_VOWELS: Final[frozenset[str]] = frozenset("aeiouyàáâãäåèéêëìíîïòóôõöùúûüýÿæœɑəɐɛɪɔʊʌ")
_WEIGHT_SPACE: Final[float] = 0.25
_WEIGHT_PUNCTUATION: Final[float] = 0.35
_WEIGHT_CONSONANT: Final[float] = 1.0
_WEIGHT_UPPERCASE: Final[float] = 1.1
_WEIGHT_VOWEL: Final[float] = 1.35
_WEIGHT_WIDE: Final[float] = 1.6

#: Thousands of a weight unit: the split is integer arithmetic on scaled
#: weights so the last character ends exactly on the word's end (ADR-0006 —
#: never lose a millisecond to rounding).
_WEIGHT_SCALE: Final[int] = 1_000


class CaptionDeltaKind(StrEnum):
    """What a human edit changed (ADR-0009 §7)."""

    #: The words were corrected.
    TEXT = "text"
    #: The cue was moved or resized on the timeline.
    TIMING = "timing"
    #: The cue was removed.
    DELETE = "delete"
    #: A cue the user added by hand.
    INSERT = "insert"
    #: A per-cue style override.
    STYLE = "style"


class CaptionTarget(StrEnum):
    """Which granularity a delta addresses."""

    SEGMENT = "segment"
    WORD = "word"
    CHAR = "char"


class CaptionAnchor(StrEnum):
    """Where a cue sits in the frame, before any smart positioning.

    Smart positioning (speaker side, face avoidance, collision resolution) is a
    pipeline stage; this is the anchor it starts from, and the one a user
    overrides when they want a cue somewhere specific.
    """

    TOP_LEFT = "top-left"
    TOP_CENTER = "top-center"
    TOP_RIGHT = "top-right"
    MIDDLE_LEFT = "middle-left"
    MIDDLE_CENTER = "middle-center"
    MIDDLE_RIGHT = "middle-right"
    BOTTOM_LEFT = "bottom-left"
    BOTTOM_CENTER = "bottom-center"
    BOTTOM_RIGHT = "bottom-right"


class CaptionLayerKind(StrEnum):
    """Why a layer exists, which decides how exporters treat it."""

    #: The captions the viewer is meant to read.
    PRIMARY = "primary"
    #: A second language; exported as a separate track, not interleaved.
    TRANSLATION = "translation"
    #: Non-speech description: ``[applause]``, speaker names, sound effects.
    COMMENTARY = "commentary"
    #: Anything a plugin or a user defined.
    CUSTOM = "custom"


class RevisionOrigin(StrEnum):
    """Where a revision came from, so history is readable."""

    #: Produced by a speech provider.
    ASR = "asr"
    #: Imported from an SRT, VTT, JSON or text file.
    IMPORT = "import"
    #: Typed by a human.
    MANUAL = "manual"
    #: A re-transcription merged with surviving human edits.
    MERGE = "merge"


# -- text handling ------------------------------------------------------------


def graphemes(text: str) -> tuple[str, ...]:
    """Split ``text`` into user-perceived characters.

    One emoji, one accented letter and one CJK glyph are each *one* character,
    which matters because caption animation animates characters: splitting a
    flag into two regional indicators or a "é" into "e" plus a combining mark
    would show as a broken glyph mid-animation.

    This is not full UAX #29 — that needs a table several megabytes large — but
    it handles the cases that actually occur: combining marks, enclosing marks,
    zero-width joiners, variation selectors, skin-tone modifiers and regional
    indicator pairs.
    """
    clusters: list[str] = []
    current = ""
    for char in text:
        if current and _continues_cluster(current, char):
            current += char
        else:
            if current:
                clusters.append(current)
            current = char
    if current:
        clusters.append(current)
    return tuple(clusters)


def _continues_cluster(current: str, char: str) -> bool:
    if current.endswith("\u200d"):
        return True
    if unicodedata.combining(char):
        return True
    if unicodedata.category(char) in {"Mn", "Mc", "Me"}:
        return True
    if char in {"\u200d", "\ufe0f", "\ufe0e"}:
        return True
    if 0x1F3FB <= ord(char) <= 0x1F3FF:
        return True
    return _is_regional_indicator(char) and len(current) == 1 and _is_regional_indicator(current)


def _is_regional_indicator(char: str) -> bool:
    return len(char) == 1 and 0x1F1E6 <= ord(char) <= 0x1F1FF


def _char_weight(char: str) -> float:
    """How long a character is held, relative to a lowercase consonant."""
    head = char[0]
    if head.isspace():
        return _WEIGHT_SPACE
    if not head.isalnum():
        return _WEIGHT_PUNCTUATION
    if unicodedata.east_asian_width(head) in {"W", "F"}:
        return _WEIGHT_WIDE
    if head.lower() in _VOWELS:
        return _WEIGHT_VOWEL
    if head.isupper():
        return _WEIGHT_UPPERCASE
    return _WEIGHT_CONSONANT


def split_chars(text: str, start_ms: int, end_ms: int) -> tuple[CaptionChar, ...]:
    """Derive character timings by weighted proportional split (ADR-0009 §2).

    Used when a provider supplies word timings but not character timings.  The
    result is an approximation and every character is marked
    :attr:`~CaptionChar.estimated`, so the UI can show "estimated" and a later
    forced-alignment pass can replace it with real timings.

    The split is exact: the last character ends on ``end_ms``, so a word's
    characters can never drift past the word they belong to.
    """
    if end_ms < start_ms:
        raise NovaInvariantError(f"end_ms ({end_ms}) must not precede start_ms ({start_ms})")
    grams = graphemes(text)
    if not grams:
        return ()
    duration = end_ms - start_ms
    scaled = [max(1, round(_char_weight(gram) * _WEIGHT_SCALE)) for gram in grams]
    total = sum(scaled)
    chars: list[CaptionChar] = []
    elapsed = 0
    boundary = start_ms
    for gram, weight in zip(grams, scaled, strict=True):
        elapsed += weight
        next_boundary = start_ms + (duration * elapsed) // total
        chars.append(CaptionChar(text=gram, start_ms=boundary, end_ms=next_boundary))
        boundary = next_boundary
    return tuple(chars)


def normalise_text(text: str) -> str:
    """Fold text to the form alignment keys and word matching compare on.

    Case-folded, compatibility-normalised, punctuation stripped and whitespace
    collapsed, so that ``"Hello, world!"`` and ``"hello world"`` are the same
    string — which is what lets a correction survive a re-transcription that
    re-punctuated the sentence.
    """
    folded = unicodedata.normalize("NFKC", text).casefold()
    kept = [char if char.isalnum() else " " for char in folded]
    return " ".join("".join(kept).split())


def alignment_key(text: str, start_ms: int) -> str:
    """The stable key a human edit is filed under (ADR-0009 §7).

    Normalised text plus a *bucketed* start time.  Bucketing is what makes the
    key stable: a re-transcription that places a cue 300 ms later produces the
    same key, so the correction re-attaches instead of being orphaned.
    """
    if start_ms < 0:
        raise NovaInvariantError(f"start_ms must not be negative, got {start_ms}")
    bucket = (start_ms // ALIGNMENT_KEY_BUCKET_MS) * ALIGNMENT_KEY_BUCKET_MS
    return f"{normalise_text(text)}@{bucket}"


def reading_rate_cps(segment: CaptionSegment) -> float:
    """Characters per second for one cue.

    The number a caption editor shows in red.  Zero-duration cues read as
    infinitely fast rather than dividing by zero.
    """
    seconds = segment.duration_ms / 1000
    if seconds <= 0:
        return float("inf")
    return len(graphemes(segment.text)) / seconds


def wrap_caption(
    text: str,
    *,
    max_chars: int = CAPTION_MAX_LINE_CHARS,
    max_lines: int = CAPTION_MAX_LINES,
) -> tuple[str, ...]:
    """Break ``text`` into balanced lines.

    The rule a caption breaker needs: lines are balanced rather than greedily
    filled, because two lines of 21 read far better than one of 40 and one of 2.

    Text is never truncated.  If it cannot fit in ``max_lines`` lines, more
    lines are returned — dropping words silently is the one thing a caption
    breaker must never do; the caller splits the cue instead.

    CJK and other scriptio continua have no spaces to break on, so such text is
    broken between characters.
    """
    if max_chars < 1:
        raise NovaInvariantError(f"max_chars must be at least 1, got {max_chars}")
    if max_lines < 1:
        raise NovaInvariantError(f"max_lines must be at least 1, got {max_lines}")
    collapsed = " ".join(text.split())
    if not collapsed:
        return ()
    if len(graphemes(collapsed)) <= max_chars:
        return (collapsed,)

    total = len(graphemes(collapsed))
    tokens = (
        graphemes(collapsed) if _breaks_between_characters(collapsed) else tuple(collapsed.split())
    )
    joiner = "" if _breaks_between_characters(collapsed) else " "
    needed = max(2, -(-total // max_chars))
    budget = max(1, -(-total // needed))

    lines: list[str] = []
    current: list[str] = []
    current_len = 0
    for token in tokens:
        # Measure the line as it will be drawn, separator included: a budget
        # spent on characters alone lets a ten-word line overshoot by nine
        # spaces.
        addition = len(graphemes(token)) + (len(joiner) if current else 0)
        if current and current_len + addition > budget:
            lines.append(joiner.join(current))
            current = [token]
            current_len = len(graphemes(token))
        else:
            current.append(token)
            current_len += addition
    if current:
        lines.append(joiner.join(current))
    return tuple(lines)


def _wrap_tokens(text: str) -> tuple[str, ...]:
    if _breaks_between_characters(text):
        return graphemes(text)
    return tuple(text.split())


def _breaks_between_characters(text: str) -> bool:
    """Whether the text has no word boundaries to break on (CJK, Thai, …)."""
    if " " in text:
        return False
    return any(unicodedata.east_asian_width(char) in {"W", "F"} for char in graphemes(text))


# -- geometry -----------------------------------------------------------------


@dataclass(frozen=True, slots=True, kw_only=True)
class SafeArea:
    """Margins, as fractions of the frame, that captions must stay inside.

    A caption at the very edge of a 16:9 frame is cropped by a 4:3 display, by
    a TV's overscan, and by a phone's rounded corner.  Fractions rather than
    pixels because the same document is rendered in a 480 p proxy and a 4 K
    export.
    """

    left: float = 0.05
    right: float = 0.05
    top: float = 0.05
    bottom: float = 0.10

    def __post_init__(self) -> None:
        # The 0.45 ceiling is the real guard: two margins at the cap still leave
        # ten per cent of the frame, so no combination can swallow it.
        for name in ("left", "right", "top", "bottom"):
            value = getattr(self, name)
            if not 0.0 <= value <= 0.45:
                raise NovaInvariantError(f"{name} must be within [0, 0.45], got {value}")

    def inset(self, width: int, height: int) -> CaptionRect:
        """The drawable rectangle, in integer pixels, for a frame this size."""
        if width <= 0 or height <= 0:
            raise NovaInvariantError(f"frame must be positive, got {width}x{height}")
        left = round(self.left * width)
        top = round(self.top * height)
        right = width - round(self.right * width)
        bottom = height - round(self.bottom * height)
        return CaptionRect(x=left, y=top, width=max(0, right - left), height=max(0, bottom - top))

    def to_wire(self) -> dict[str, object]:
        """A JSON-ready mapping."""
        return {
            "left": self.left,
            "right": self.right,
            "top": self.top,
            "bottom": self.bottom,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> SafeArea:
        """Rebuild from :meth:`to_wire`, rejecting unknown fields."""
        _reject_unknown_fields(data, _SAFE_AREA_FIELDS)
        return cls(
            left=_wire_float(data, "left"),
            right=_wire_float(data, "right"),
            top=_wire_float(data, "top"),
            bottom=_wire_float(data, "bottom"),
        )


@dataclass(frozen=True, slots=True)
class CaptionRect:
    """An axis-aligned box in frame pixels.

    The vocabulary collision resolution needs: a cue's plate and another cue's
    plate either overlap or they do not, and the resolver pushes one of them.
    """

    x: int
    y: int
    width: int
    height: int

    def __post_init__(self) -> None:
        if self.width < 0 or self.height < 0:
            raise NovaInvariantError(f"a rect must not be negative, got {self.width}x{self.height}")

    @property
    def right(self) -> int:
        """The exclusive right edge."""
        return self.x + self.width

    @property
    def bottom(self) -> int:
        """The exclusive bottom edge."""
        return self.y + self.height

    def overlaps(self, other: CaptionRect) -> bool:
        """Whether the two boxes share any pixel.

        Touching edges do not count: two cues stacked exactly against each other
        are the normal case, and calling that a collision would push every line
        of a two-line cue apart.
        """
        return (
            self.x < other.right
            and other.x < self.right
            and self.y < other.bottom
            and other.y < self.bottom
        )

    def shifted(self, dx: int, dy: int) -> CaptionRect:
        """The same box, moved."""
        return CaptionRect(x=self.x + dx, y=self.y + dy, width=self.width, height=self.height)


@dataclass(frozen=True, slots=True, kw_only=True)
class CaptionPosition:
    """Where one cue is placed, when it is not placed by the pipeline."""

    anchor: CaptionAnchor = CaptionAnchor.BOTTOM_CENTER
    #: Horizontal and vertical offset from the anchor, as a fraction of the
    #: *safe area*, not of the frame — so a nudge means the same thing at any
    #: resolution.
    x: float = 0.0
    y: float = 0.0
    rotation_deg: float = 0.0
    safe_area: SafeArea = SafeArea()

    def __post_init__(self) -> None:
        if not -1.0 <= self.x <= 1.0:
            raise NovaInvariantError(f"x must be within [-1, 1], got {self.x}")
        if not -1.0 <= self.y <= 1.0:
            raise NovaInvariantError(f"y must be within [-1, 1], got {self.y}")
        if not -180.0 <= self.rotation_deg <= 180.0:
            raise NovaInvariantError(
                f"rotation_deg must be within [-180, 180], got {self.rotation_deg}"
            )

    def to_wire(self) -> dict[str, object]:
        """A JSON-ready mapping."""
        return {
            "anchor": self.anchor.value,
            "x": self.x,
            "y": self.y,
            "rotation_deg": self.rotation_deg,
            "safe_area": self.safe_area.to_wire(),
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> CaptionPosition:
        """Rebuild from :meth:`to_wire`, rejecting unknown fields."""
        _reject_unknown_fields(data, _POSITION_FIELDS)
        area = data["safe_area"]
        if not isinstance(area, Mapping):
            raise NovaInvariantError(f"'safe_area' must be a mapping, got {type(area).__name__}")
        return cls(
            anchor=CaptionAnchor(_wire_str(data, "anchor")),
            x=_wire_float(data, "x"),
            y=_wire_float(data, "y"),
            rotation_deg=_wire_float(data, "rotation_deg"),
            safe_area=SafeArea.from_wire(area),
        )


# -- the three granularities --------------------------------------------------


@dataclass(frozen=True, slots=True, kw_only=True)
class CaptionChar:
    """One user-perceived character with its own timing.

    Characters are what make letter-by-letter animation possible (ADR-0009 §2):
    a mode that animates letters is not a special case, it is the same baker
    running one granularity down.
    """

    text: str
    start_ms: int
    end_ms: int
    #: ``True`` when the timing came from :func:`split_chars` rather than from a
    #: measurement.  Shown in the UI as "estimated", so a derived guess is never
    #: presented as fact.
    estimated: bool = True

    def __post_init__(self) -> None:
        if len(graphemes(self.text)) != 1:
            raise NovaInvariantError(
                f"a CaptionChar holds exactly one character, got {self.text!r}"
            )
        if self.start_ms < 0:
            raise NovaInvariantError(f"start_ms must not be negative, got {self.start_ms}")
        if self.end_ms < self.start_ms:
            raise NovaInvariantError(
                f"end_ms ({self.end_ms}) must not precede start_ms ({self.start_ms})"
            )

    @property
    def duration_ms(self) -> int:
        """How long the character is held."""
        return self.end_ms - self.start_ms

    def shifted(self, delta_ms: int) -> CaptionChar:
        """The same character, moved by ``delta_ms``."""
        return replace(self, start_ms=self.start_ms + delta_ms, end_ms=self.end_ms + delta_ms)

    def to_wire(self) -> dict[str, object]:
        """A JSON-ready mapping."""
        return {
            "text": self.text,
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
            "estimated": self.estimated,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> CaptionChar:
        """Rebuild from :meth:`to_wire`, rejecting unknown fields."""
        _reject_unknown_fields(data, _CHAR_FIELDS)
        return cls(
            text=_wire_str(data, "text"),
            start_ms=_wire_int(data, "start_ms"),
            end_ms=_wire_int(data, "end_ms"),
            estimated=bool(data["estimated"]),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class CaptionWord:
    """One word with its timing, and optionally its characters."""

    text: str
    start_ms: int
    end_ms: int
    #: Provider confidence in the recognised text, ``0.0``–``1.0``.
    confidence: float | None = None
    speaker: str | None = None
    chars: tuple[CaptionChar, ...] = ()
    #: Marked for emphasis — the karaoke and highlight modes act on these.
    highlight: bool = False

    def __post_init__(self) -> None:
        if not self.text.strip():
            raise NovaInvariantError("a word must have text")
        if self.start_ms < 0:
            raise NovaInvariantError(f"start_ms must not be negative, got {self.start_ms}")
        if self.end_ms < self.start_ms:
            raise NovaInvariantError(
                f"end_ms ({self.end_ms}) must not precede start_ms ({self.start_ms})"
            )
        if self.confidence is not None and not 0.0 <= self.confidence <= 1.0:
            raise NovaInvariantError(f"confidence must be within [0, 1], got {self.confidence}")
        if self.chars:
            if "".join(char.text for char in self.chars) != self.text:
                raise NovaInvariantError(
                    f"the characters of {self.text!r} must join to make the word"
                )
            previous = self.start_ms
            for char in self.chars:
                if char.start_ms < previous:
                    raise NovaInvariantError(f"characters of {self.text!r} are out of order")
                if char.start_ms < self.start_ms or char.end_ms > self.end_ms:
                    raise NovaInvariantError(f"a character of {self.text!r} lies outside the word")
                previous = char.end_ms

    @classmethod
    def of(
        cls,
        text: str,
        start_ms: int,
        end_ms: int,
        *,
        with_chars: bool = True,
        confidence: float | None = None,
        speaker: str | None = None,
        highlight: bool = False,
    ) -> CaptionWord:
        """Build a word, deriving character timings unless told not to.

        Providers that supply real character timings pass ``chars=`` with
        ``estimated=False`` instead; this factory is the path for the common
        case, where only the word is timed.
        """
        return cls(
            text=text,
            start_ms=start_ms,
            end_ms=end_ms,
            confidence=confidence,
            speaker=speaker,
            highlight=highlight,
            chars=split_chars(text, start_ms, end_ms) if with_chars else (),
        )

    @property
    def duration_ms(self) -> int:
        """How long the word is spoken."""
        return self.end_ms - self.start_ms

    @property
    def has_char_timings(self) -> bool:
        """Whether every character carries its own timing."""
        return bool(self.chars)

    @property
    def has_measured_char_timings(self) -> bool:
        """Whether those character timings were measured, not derived."""
        return bool(self.chars) and not any(char.estimated for char in self.chars)

    def with_chars(self, chars: Sequence[CaptionChar]) -> CaptionWord:
        """The same word, with real character timings attached."""
        return replace(self, chars=tuple(chars))

    def shifted(self, delta_ms: int) -> CaptionWord:
        """The same word and its characters, moved by ``delta_ms``."""
        return replace(
            self,
            start_ms=self.start_ms + delta_ms,
            end_ms=self.end_ms + delta_ms,
            chars=tuple(char.shifted(delta_ms) for char in self.chars),
        )

    def to_wire(self) -> dict[str, object]:
        """A JSON-ready mapping."""
        return {
            "text": self.text,
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
            "confidence": self.confidence,
            "speaker": self.speaker,
            "chars": [char.to_wire() for char in self.chars],
            "highlight": self.highlight,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> CaptionWord:
        """Rebuild from :meth:`to_wire`, rejecting unknown fields."""
        _reject_unknown_fields(data, _WORD_FIELDS)
        chars = data["chars"]
        if not isinstance(chars, list):
            raise NovaInvariantError(f"'chars' must be a list, got {type(chars).__name__}")
        parsed = tuple(
            CaptionChar.from_wire(item) if isinstance(item, Mapping) else _bad_char(item)
            for item in chars
        )
        return cls(
            text=_wire_str(data, "text"),
            start_ms=_wire_int(data, "start_ms"),
            end_ms=_wire_int(data, "end_ms"),
            confidence=_optional_float(data, "confidence"),
            speaker=_optional_str(data, "speaker"),
            chars=parsed,
            highlight=bool(data["highlight"]),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class CaptionSegment:
    """One cue: text, timing, words, and whatever the user overrode.

    A segment is the unit the viewer reads and the unit the editor commits to
    the timeline as a clip (ADR-0009 §8).
    """

    index: int
    start_ms: int
    end_ms: int
    text: str
    words: tuple[CaptionWord, ...] = ()
    speaker: str | None = None
    layer_id: str = DEFAULT_LAYER_ID
    position: CaptionPosition | None = None
    #: Per-cue style deltas layered over the template.  A mapping rather than a
    #: typed object because templates and plugins both contribute keys the
    #: styling module has not been written yet — and because styling is data
    #: (ADR-0009 §5), not a class hierarchy.
    style_overrides: Mapping[str, object] | None = None
    #: A locked cue is never re-flowed, re-broken or overwritten by a
    #: re-transcription.
    locked: bool = False
    confidence: float | None = None
    #: An emoji shown beside the cue's text, put there by the Emoji stage
    #: (ADR-0009 §3). Empty means none.
    #:
    #: This is **content, not styling**: it travels with the text when a cue is
    #: re-broken or re-timed, it is what an editor edits in the inspector, and
    #: the template decides where and how it is drawn. Keeping it out of
    #: ``style_overrides`` is what stops a template change from deleting the
    #: emoji an editor chose — and what lets a project saved before this field
    #: existed still open (see ``services/projects/migrations.py``).
    emoji: str = ""

    def __post_init__(self) -> None:
        if self.index < 0:
            raise NovaInvariantError(f"index must not be negative, got {self.index}")
        if self.start_ms < 0:
            raise NovaInvariantError(f"start_ms must not be negative, got {self.start_ms}")
        if self.end_ms < self.start_ms:
            raise NovaInvariantError(
                f"end_ms ({self.end_ms}) must not precede start_ms ({self.start_ms})"
            )
        if not self.text.strip():
            raise NovaInvariantError(f"segment {self.index} must have text")
        if self.confidence is not None and not 0.0 <= self.confidence <= 1.0:
            raise NovaInvariantError(f"confidence must be within [0, 1], got {self.confidence}")
        if any(character.isspace() for character in self.emoji):
            # One run of characters, drawn as one glyph or a short row of them.
            # Spaces would make it text, and text belongs in ``text``.
            raise NovaInvariantError(f"an emoji must not contain whitespace, got {self.emoji!r}")
        previous = self.start_ms
        for word in self.words:
            if word.start_ms < previous:
                raise NovaInvariantError(
                    f"segment {self.index} has words that start before the previous ends"
                )
            if word.start_ms < self.start_ms or word.end_ms > self.end_ms:
                raise NovaInvariantError(
                    f"segment {self.index} has a word that lies outside the segment"
                )
            previous = word.end_ms
        if self.words and normalise_text(" ".join(word.text for word in self.words)) not in (
            normalise_text(self.text)
        ):
            raise NovaInvariantError(f"segment {self.index} has words that are not in its text")

    @property
    def duration_ms(self) -> int:
        """How long the cue is on screen."""
        return self.end_ms - self.start_ms

    @property
    def has_word_timings(self) -> bool:
        """Whether the cue's words are timed — required for karaoke."""
        return bool(self.words)

    @property
    def has_char_timings(self) -> bool:
        """Whether every word has measured or derived character timings."""
        return all(word.has_char_timings for word in self.words) if self.words else False

    @property
    def word_count(self) -> int:
        """How many words the cue holds."""
        return len(self.words)

    @property
    def char_count(self) -> int:
        """How many user-perceived characters the cue holds."""
        if self.words:
            return sum(len(graphemes(word.text)) for word in self.words)
        return len(graphemes(self.text))

    @property
    def key(self) -> str:
        """The alignment key this cue is filed under (:func:`alignment_key`)."""
        return alignment_key(self.text, self.start_ms)

    def reading_rate(self) -> float:
        """Characters per second; see :func:`reading_rate_cps`."""
        return reading_rate_cps(self)

    def lines(
        self,
        *,
        max_chars: int = CAPTION_MAX_LINE_CHARS,
        max_lines: int = CAPTION_MAX_LINES,
    ) -> tuple[str, ...]:
        """The cue's text, broken into lines (:func:`wrap_caption`)."""
        return wrap_caption(self.text, max_chars=max_chars, max_lines=max_lines)

    def frame_range(
        self,
        timebase: Timebase,
        rounding: Rounding = Rounding.FLOOR,
    ) -> tuple[int, int]:
        """The cue's first and last frame on a timeline (ADR-0006).

        The start rounds down — a caption includes the frame it starts on — and
        the end is exclusive, so a one-frame cue is ``(n, n + 1)`` rather than
        an empty range.
        """
        start = frames_for_ms(self.start_ms, timebase, rounding)
        end = max(start + 1, frames_for_ms(self.end_ms, timebase, rounding))
        return (start, end)

    def with_text(self, text: str) -> CaptionSegment:
        """Replace the text, discarding word timings that no longer describe it.

        Timings that refer to words that are not there are the worst possible
        state: the caption looks right and is wrong.  Re-align to get them back;
        :func:`merge_deltas` reports every cue this happened to.
        """
        return replace(self, text=text, words=())

    def with_timing(self, start_ms: int, end_ms: int) -> CaptionSegment:
        """Move or resize the cue, carrying its words and characters with it.

        A word that would stick out of the new span is dropped rather than
        clipped: a clipped word claims the speaker stopped mid-word, which is a
        lie the viewer can see.  Re-aligning restores it.
        """
        delta = start_ms - self.start_ms
        kept = tuple(
            word
            for word in (word.shifted(delta) for word in self.words)
            if word.start_ms >= start_ms and word.end_ms <= end_ms
        )
        return replace(self, start_ms=start_ms, end_ms=end_ms, words=kept)

    def shifted(self, delta_ms: int) -> CaptionSegment:
        """Move the cue and everything inside it by ``delta_ms``."""
        return self.with_timing(self.start_ms + delta_ms, self.end_ms + delta_ms)

    def with_style(self, overrides: Mapping[str, object] | None) -> CaptionSegment:
        """Set or clear the per-cue style overrides."""
        return replace(self, style_overrides=dict(overrides) if overrides else None)

    def with_emoji(self, emoji: str) -> CaptionSegment:
        """Set or clear the cue's emoji."""
        return replace(self, emoji=emoji.strip())

    def to_wire(self) -> dict[str, object]:
        """A JSON-ready mapping."""
        return {
            "index": self.index,
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
            "text": self.text,
            "words": [word.to_wire() for word in self.words],
            "speaker": self.speaker,
            "layer_id": self.layer_id,
            "position": self.position.to_wire() if self.position else None,
            "style_overrides": dict(self.style_overrides) if self.style_overrides else None,
            "locked": self.locked,
            "confidence": self.confidence,
            "emoji": self.emoji,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> CaptionSegment:
        """Rebuild from :meth:`to_wire`, rejecting unknown fields."""
        _reject_unknown_fields(data, _SEGMENT_FIELDS)
        words = data["words"]
        if not isinstance(words, list):
            raise NovaInvariantError(f"'words' must be a list, got {type(words).__name__}")
        position = data["position"]
        if position is not None and not isinstance(position, Mapping):
            raise NovaInvariantError(
                f"'position' must be a mapping or null, got {type(position).__name__}"
            )
        style = data["style_overrides"]
        if style is not None and not isinstance(style, Mapping):
            raise NovaInvariantError(
                f"'style_overrides' must be a mapping or null, got {type(style).__name__}"
            )
        return cls(
            index=_wire_int(data, "index"),
            start_ms=_wire_int(data, "start_ms"),
            end_ms=_wire_int(data, "end_ms"),
            text=_wire_str(data, "text"),
            words=tuple(
                CaptionWord.from_wire(item) if isinstance(item, Mapping) else _bad_word(item)
                for item in words
            ),
            speaker=_optional_str(data, "speaker"),
            layer_id=_wire_str(data, "layer_id"),
            position=CaptionPosition.from_wire(position) if position is not None else None,
            style_overrides=dict(style) if style is not None else None,
            locked=bool(data["locked"]),
            confidence=_optional_float(data, "confidence"),
            emoji=_wire_str(data, "emoji"),
        )


# -- layers, revisions, deltas ------------------------------------------------


@dataclass(frozen=True, slots=True, kw_only=True)
class CaptionLayer:
    """One track of captions: a language, a purpose, or a user's own track."""

    layer_id: str
    name: str = ""
    language: str = ""
    kind: CaptionLayerKind = CaptionLayerKind.PRIMARY
    visible: bool = True
    locked: bool = False

    def __post_init__(self) -> None:
        if not self.layer_id:
            raise NovaInvariantError("layer_id must not be empty")

    @classmethod
    def primary(cls, language: str = "") -> CaptionLayer:
        """The layer every document has unless it says otherwise."""
        return cls(layer_id=DEFAULT_LAYER_ID, name="Primary", language=language)

    def to_wire(self) -> dict[str, object]:
        """A JSON-ready mapping."""
        return {
            "layer_id": self.layer_id,
            "name": self.name,
            "language": self.language,
            "kind": self.kind.value,
            "visible": self.visible,
            "locked": self.locked,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> CaptionLayer:
        """Rebuild from :meth:`to_wire`, rejecting unknown fields."""
        _reject_unknown_fields(data, _LAYER_FIELDS)
        return cls(
            layer_id=_wire_str(data, "layer_id"),
            name=_wire_str(data, "name"),
            language=_wire_str(data, "language"),
            kind=CaptionLayerKind(_wire_str(data, "kind")),
            visible=bool(data["visible"]),
            locked=bool(data["locked"]),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class CaptionRevision:
    """One generation of a document's base text (ADR-0009 §7)."""

    revision_id: str
    created_ms: int
    origin: RevisionOrigin = RevisionOrigin.MANUAL
    label: str = ""
    parent_id: str | None = None
    provider: str | None = None
    model: str | None = None

    def __post_init__(self) -> None:
        if not self.revision_id:
            raise NovaInvariantError("revision_id must not be empty")
        if self.created_ms < 0:
            raise NovaInvariantError(f"created_ms must not be negative, got {self.created_ms}")

    def to_wire(self) -> dict[str, object]:
        """A JSON-ready mapping."""
        return {
            "revision_id": self.revision_id,
            "created_ms": self.created_ms,
            "origin": self.origin.value,
            "label": self.label,
            "parent_id": self.parent_id,
            "provider": self.provider,
            "model": self.model,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> CaptionRevision:
        """Rebuild from :meth:`to_wire`, rejecting unknown fields."""
        _reject_unknown_fields(data, _REVISION_FIELDS)
        return cls(
            revision_id=_wire_str(data, "revision_id"),
            created_ms=_wire_int(data, "created_ms"),
            origin=RevisionOrigin(_wire_str(data, "origin")),
            label=_wire_str(data, "label"),
            parent_id=_optional_str(data, "parent_id"),
            provider=_optional_str(data, "provider"),
            model=_optional_str(data, "model"),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class CaptionDelta:
    """One human edit, filed under an alignment key (ADR-0009 §7).

    A delta is *not* a patch against the current text; it is a statement of what
    the user wanted, kept independently of the base so it survives a new base.
    ``before`` is retained so the review list can show what changed and the
    editor can offer to undo just that edit.
    """

    key: str
    kind: CaptionDeltaKind
    target: CaptionTarget = CaptionTarget.SEGMENT
    before: str | None = None
    after: str | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    style: Mapping[str, object] | None = None
    created_ms: int = 0
    revision_id: str | None = None

    def __post_init__(self) -> None:
        if not self.key:
            raise NovaInvariantError("a delta must have an alignment key")
        if self.kind in (CaptionDeltaKind.TEXT, CaptionDeltaKind.INSERT) and self.after is None:
            raise NovaInvariantError(f"a {self.kind} delta needs the new text in 'after'")
        if self.kind is CaptionDeltaKind.TIMING and (self.start_ms is None or self.end_ms is None):
            raise NovaInvariantError("a timing delta needs both start_ms and end_ms")
        if self.kind is CaptionDeltaKind.STYLE and self.style is None:
            raise NovaInvariantError("a style delta needs the overrides in 'style'")

    def to_wire(self) -> dict[str, object]:
        """A JSON-ready mapping."""
        return {
            "key": self.key,
            "kind": self.kind.value,
            "target": self.target.value,
            "before": self.before,
            "after": self.after,
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
            "style": dict(self.style) if self.style else None,
            "created_ms": self.created_ms,
            "revision_id": self.revision_id,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> CaptionDelta:
        """Rebuild from :meth:`to_wire`, rejecting unknown fields."""
        _reject_unknown_fields(data, _DELTA_FIELDS)
        style = data["style"]
        if style is not None and not isinstance(style, Mapping):
            raise NovaInvariantError(
                f"'style' must be a mapping or null, got {type(style).__name__}"
            )
        return cls(
            key=_wire_str(data, "key"),
            kind=CaptionDeltaKind(_wire_str(data, "kind")),
            target=CaptionTarget(_wire_str(data, "target")),
            before=_optional_str(data, "before"),
            after=_optional_str(data, "after"),
            start_ms=_optional_int(data, "start_ms"),
            end_ms=_optional_int(data, "end_ms"),
            style=dict(style) if style is not None else None,
            created_ms=_wire_int(data, "created_ms"),
            revision_id=_optional_str(data, "revision_id"),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class CaptionMergeOutcome:
    """What :func:`merge_deltas` did, including what it could not do."""

    segments: tuple[CaptionSegment, ...]
    applied: tuple[CaptionDelta, ...] = ()
    unmatched: tuple[CaptionDelta, ...] = ()
    #: Keys whose word timings were discarded because a text edit invalidated
    #: them.  Reported, never silent (ADR-0009 §7).
    timings_dropped: tuple[str, ...] = ()

    @property
    def all_reattached(self) -> bool:
        """Whether every correction found a home."""
        return not self.unmatched

    @property
    def needs_review(self) -> bool:
        """Whether the user must look at anything before trusting the result."""
        return bool(self.unmatched or self.timings_dropped)


def merge_deltas(
    segments: Sequence[CaptionSegment],
    deltas: Sequence[CaptionDelta],
    *,
    tolerance_ms: int = DEFAULT_MERGE_TOLERANCE_MS,
) -> CaptionMergeOutcome:
    """Re-apply human edits to a freshly transcribed base (ADR-0009 §7).

    Re-transcription is the moment a caption tool destroys hours of work.  This
    is the antidote: each delta is matched to a cue

    1. by exact alignment key — the normal case, where the text and the bucketed
       time survived;
    2. failing that, by normalised text within ``tolerance_ms`` of the delta's
       original position — for when the new transcription punctuated
       differently or drifted a little.

    A delta that matches neither is returned in :attr:`unmatched` for the review
    list.  Silently guessing would be worse than asking: a correction attached
    to the wrong cue is a wrong caption with the user's name on it.  An
    ``INSERT`` is the exception: it needs no match, because it *is* the cue —
    it is appended rather than re-attached.

    Order is respected: deltas apply to the result of the ones before them, so a
    text edit followed by a timing edit on the same cue both land.  That is
    achieved by *anchoring*: once a delta has been applied to a cue, later
    deltas carrying the same key go to the same cue, even though the first edit
    changed its text and therefore its alignment key.
    """
    working = list(segments)
    applied: list[CaptionDelta] = []
    unmatched: list[CaptionDelta] = []
    dropped: list[str] = []
    anchored: dict[str, CaptionSegment] = {}

    for delta in deltas:
        if delta.kind is CaptionDeltaKind.INSERT:
            inserted = _segment_from_insert(delta, len(working))
            working.append(inserted)
            anchored[delta.key] = inserted
            applied.append(delta)
            continue

        index = _index_of(working, anchored.get(delta.key))
        if index is None:
            match = _match_delta(working, delta, tolerance_ms)
            index = None if match is None else match[0]
        if index is None:
            unmatched.append(delta)
            continue

        updated = _apply_delta(working[index], delta)
        if updated is None:
            working.pop(index)
            anchored.pop(delta.key, None)
        else:
            if delta.kind is CaptionDeltaKind.TEXT and working[index].words:
                dropped.append(delta.key)
            working[index] = updated
            anchored[delta.key] = updated
        applied.append(delta)

    ordered = sorted(working, key=lambda segment: (segment.start_ms, segment.end_ms))
    return CaptionMergeOutcome(
        segments=tuple(
            replace(segment, index=position) for position, segment in enumerate(ordered)
        ),
        applied=tuple(applied),
        unmatched=tuple(unmatched),
        timings_dropped=tuple(dict.fromkeys(dropped)),
    )


def _index_of(segments: Sequence[CaptionSegment], anchored: CaptionSegment | None) -> int | None:
    """Where the cue a delta was already applied to is now.

    Identity, not index: cues are renumbered and reordered as deltas land, so
    remembering a position would point at the wrong cue after the first insert.
    """
    if anchored is None:
        return None
    for index, segment in enumerate(segments):
        if segment is anchored:
            return index
    return None


def _match_delta(
    segments: Sequence[CaptionSegment],
    delta: CaptionDelta,
    tolerance_ms: int,
) -> tuple[int, int] | None:
    for index, segment in enumerate(segments):
        if segment.key == delta.key:
            return (index, 0)
    text = delta.key.split("@", 1)[0]
    if not text:
        return None
    best: tuple[int, int] | None = None
    for index, segment in enumerate(segments):
        if normalise_text(segment.text) != text:
            continue
        distance = abs(segment.start_ms - _bucket_of(delta.key))
        if distance <= tolerance_ms and (best is None or distance < best[1]):
            best = (index, distance)
    return best


def _bucket_of(key: str) -> int:
    _, _, raw = key.rpartition("@")
    return int(raw) if raw.isdigit() else 0


def _apply_delta(segment: CaptionSegment, delta: CaptionDelta) -> CaptionSegment | None:
    if delta.kind is CaptionDeltaKind.DELETE:
        return None
    if delta.kind is CaptionDeltaKind.TEXT:
        return segment.with_text(delta.after or "")
    if delta.kind is CaptionDeltaKind.TIMING:
        return segment.with_timing(delta.start_ms or 0, delta.end_ms or segment.end_ms)
    if delta.kind is CaptionDeltaKind.STYLE:
        return segment.with_style(delta.style)
    raise NovaInvariantError(f"unhandled delta kind {delta.kind}")


def _segment_from_insert(delta: CaptionDelta, index: int) -> CaptionSegment:
    """The cue an ``INSERT`` delta adds.

    A cue the user typed has no original to be matched against, so it is
    re-created from the delta itself.  It lands on the primary layer; moving it
    elsewhere is a later edit, and one the user makes deliberately.
    """
    start_ms = delta.start_ms or 0
    end_ms = delta.end_ms if delta.end_ms is not None else start_ms + CAPTION_MIN_DURATION_MS
    return CaptionSegment(
        index=index,
        start_ms=start_ms,
        end_ms=end_ms,
        text=delta.after or "",
        layer_id=DEFAULT_LAYER_ID,
    )


# -- the document -------------------------------------------------------------


@dataclass(frozen=True, slots=True, kw_only=True)
class CaptionDocument:
    """The authoring source of truth for a project's captions (ADR-0009 §8).

    Committed to the timeline, each segment becomes a clip on a caption track;
    this document stays the source, and a reconciler keeps the two in step
    inside one transaction.
    """

    segments: tuple[CaptionSegment, ...] = ()
    layers: tuple[CaptionLayer, ...] = (CaptionLayer.primary(),)
    language: str = ""
    revisions: tuple[CaptionRevision, ...] = ()
    #: The overlay of human edits, kept across revisions.
    edits: tuple[CaptionDelta, ...] = ()
    version: int = CAPTION_DOCUMENT_VERSION

    def __post_init__(self) -> None:
        if not self.layers:
            raise NovaInvariantError("a document must have at least one layer")
        known = {layer.layer_id for layer in self.layers}
        for segment in self.segments:
            if segment.layer_id not in known:
                raise NovaInvariantError(
                    f"segment {segment.index} is on layer {segment.layer_id!r}, "
                    "which this document does not define"
                )

    @classmethod
    def of(cls, *segments: CaptionSegment, language: str = "") -> CaptionDocument:
        """A document from cues, with the default primary layer."""
        return cls(
            segments=tuple(replace(segment, index=index) for index, segment in enumerate(segments)),
            language=language,
        )

    @property
    def is_empty(self) -> bool:
        """Whether there is anything to show."""
        return not self.segments

    @property
    def segment_count(self) -> int:
        """How many cues the document holds."""
        return len(self.segments)

    @property
    def word_count(self) -> int:
        """How many timed words the document holds."""
        return sum(segment.word_count for segment in self.segments)

    @property
    def char_count(self) -> int:
        """How many user-perceived characters the document holds."""
        return sum(segment.char_count for segment in self.segments)

    @property
    def duration_ms(self) -> int:
        """The end of the last cue.  Zero for an empty document."""
        return max((segment.end_ms for segment in self.segments), default=0)

    @property
    def speakers(self) -> tuple[str, ...]:
        """Every speaker named, in first-heard order."""
        return tuple(
            dict.fromkeys(
                segment.speaker for segment in self.segments if segment.speaker is not None
            )
        )

    @property
    def current_revision(self) -> CaptionRevision | None:
        """The newest revision, or ``None`` for a document that has none yet."""
        return self.revisions[-1] if self.revisions else None

    @property
    def text(self) -> str:
        """Every cue's text, one per line."""
        return "\n".join(segment.text for segment in self.segments)

    def segment_at(self, at_ms: int) -> CaptionSegment | None:
        """The cue on screen at ``at_ms``, or ``None`` between cues."""
        for segment in self.segments:
            if segment.start_ms <= at_ms < segment.end_ms:
                return segment
        return None

    def segments_between(self, start_ms: int, end_ms: int) -> tuple[CaptionSegment, ...]:
        """Every cue that overlaps ``[start_ms, end_ms)``."""
        if end_ms < start_ms:
            raise NovaInvariantError(f"end_ms ({end_ms}) must not precede start_ms ({start_ms})")
        return tuple(
            segment
            for segment in self.segments
            if segment.start_ms < end_ms and segment.end_ms > start_ms
        )

    def on_layer(self, layer_id: str) -> tuple[CaptionSegment, ...]:
        """Every cue on one layer."""
        return tuple(segment for segment in self.segments if segment.layer_id == layer_id)

    def reindexed(self) -> CaptionDocument:
        """The document with cue indices renumbered from zero, in time order.

        Indices are presentation order, not identity, so any operation that adds,
        removes or reorders cues ends with this.
        """
        ordered = sorted(self.segments, key=lambda segment: (segment.start_ms, segment.end_ms))
        return replace(
            self,
            segments=tuple(replace(segment, index=index) for index, segment in enumerate(ordered)),
        )

    def with_segments(self, segments: Sequence[CaptionSegment]) -> CaptionDocument:
        """The document carrying a new set of cues, renumbered."""
        return replace(
            self,
            segments=tuple(replace(segment, index=index) for index, segment in enumerate(segments)),
        )

    def with_edits(self, edits: Sequence[CaptionDelta]) -> CaptionDocument:
        """The document carrying a new edit overlay."""
        return replace(self, edits=tuple(edits))

    def with_revision(self, revision: CaptionRevision) -> CaptionDocument:
        """The document with one more revision appended to its history."""
        return replace(self, revisions=(*self.revisions, revision))

    def validate(self) -> str:
        """``""`` when the document is showable, otherwise the first problem."""
        return validate_caption_document(self)

    def to_wire(self) -> dict[str, object]:
        """A JSON-ready mapping: exactly what goes into the project file."""
        return {
            "version": self.version,
            "language": self.language,
            "layers": [layer.to_wire() for layer in self.layers],
            "segments": [segment.to_wire() for segment in self.segments],
            "revisions": [revision.to_wire() for revision in self.revisions],
            "edits": [delta.to_wire() for delta in self.edits],
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> CaptionDocument:
        """Rebuild from :meth:`to_wire`, rejecting unknown fields."""
        _reject_unknown_fields(data, _DOCUMENT_FIELDS)
        version = _wire_int(data, "version")
        if version > CAPTION_DOCUMENT_VERSION:
            raise NovaInvariantError(
                f"caption document version {version} is newer than the {CAPTION_DOCUMENT_VERSION} "
                "this build understands"
            )
        return cls(
            version=version,
            language=_wire_str(data, "language"),
            layers=tuple(CaptionLayer.from_wire(entry) for entry in _wire_mappings(data, "layers")),
            segments=tuple(
                CaptionSegment.from_wire(entry) for entry in _wire_mappings(data, "segments")
            ),
            revisions=tuple(
                CaptionRevision.from_wire(entry) for entry in _wire_mappings(data, "revisions")
            ),
            edits=tuple(CaptionDelta.from_wire(entry) for entry in _wire_mappings(data, "edits")),
        )


def validate_caption_document(document: CaptionDocument) -> str:
    """Return ``""`` or a sentence saying the first thing that is wrong.

    The checks are the ones a document can fail *after* construction — order,
    overlaps, readability — because construction already refuses the states it
    can see (empty text, negative time, words outside their cue).

    A document that fails this must not reach the renderer: what it describes is
    captions that overlap, flash past, or cannot be read.
    """
    for position, segment in enumerate(document.segments):
        if segment.index != position:
            return f"segment {position} has index {segment.index}; indices must be sequential"
        if position > 0:
            previous = document.segments[position - 1]
            if segment.start_ms < previous.end_ms:
                return (
                    f"segment {segment.index} starts at {segment.start_ms} ms, before "
                    f"segment {previous.index} ends at {previous.end_ms} ms"
                )
        if segment.duration_ms < CAPTION_MIN_DURATION_MS:
            return (
                f"segment {segment.index} lasts {segment.duration_ms} ms, below the "
                f"{CAPTION_MIN_DURATION_MS} ms minimum"
            )
        rate = reading_rate_cps(segment)
        if rate > CAPTION_MAX_CPS:
            return (
                f"segment {segment.index} is read at {rate:.1f} characters per second, "
                f"above the {CAPTION_MAX_CPS} cps ceiling"
            )
    return ""


# -- wire helpers -------------------------------------------------------------

_SAFE_AREA_FIELDS: Final[set[str]] = {"left", "right", "top", "bottom"}
_POSITION_FIELDS: Final[set[str]] = {"anchor", "x", "y", "rotation_deg", "safe_area"}
_CHAR_FIELDS: Final[set[str]] = {"text", "start_ms", "end_ms", "estimated"}
_WORD_FIELDS: Final[set[str]] = {
    "text",
    "start_ms",
    "end_ms",
    "confidence",
    "speaker",
    "chars",
    "highlight",
}
_SEGMENT_FIELDS: Final[set[str]] = {
    "index",
    "start_ms",
    "end_ms",
    "text",
    "words",
    "speaker",
    "layer_id",
    "position",
    "style_overrides",
    "locked",
    "confidence",
    "emoji",
}
_LAYER_FIELDS: Final[set[str]] = {"layer_id", "name", "language", "kind", "visible", "locked"}
_REVISION_FIELDS: Final[set[str]] = {
    "revision_id",
    "created_ms",
    "origin",
    "label",
    "parent_id",
    "provider",
    "model",
}
_DELTA_FIELDS: Final[set[str]] = {
    "key",
    "kind",
    "target",
    "before",
    "after",
    "start_ms",
    "end_ms",
    "style",
    "created_ms",
    "revision_id",
}
_DOCUMENT_FIELDS: Final[set[str]] = {
    "version",
    "language",
    "layers",
    "segments",
    "revisions",
    "edits",
}


def _bad_char(item: object) -> CaptionChar:
    raise NovaInvariantError(f"each character must be a mapping, got {type(item).__name__}")


def _bad_word(item: object) -> CaptionWord:
    raise NovaInvariantError(f"each word must be a mapping, got {type(item).__name__}")
