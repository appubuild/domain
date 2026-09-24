"""L2 — media: what a piece of footage *is*, without touching a file.

Three things live here, all named by the architecture rather than invented: the
colour vocabulary, :class:`FrameBuffer`, and the asset/probe record that lets a
project survive a moved media folder.

**Colour** — ADR-0007 §6: decode to a known colourspace, tag every frame with
``(space, range, primaries, transfer)``, and convert explicitly at the
compositor boundary.  The four enums below are container-level signalling
values.  Every number was read back from the bundled FFmpeg 7.0.2 — via
libavutil's ``av_color_*_name`` tables and an encode/decode round-trip through
libx264 — on 2026-09-24, and ``tests/media/test_av_colour_contract.py`` pins
them against PyAV's enums so a toolchain bump cannot drift silently.  These
values are stable ABI (part of libavutil's public API); member names follow
FFmpeg's C constants, with aliases for PyAV's spellings and for the shorthand
the industry actually uses (``PQ``, ``HLG``).

**FrameBuffer** — ADR-0007 §1: a thin typed wrapper over a NumPy array plus
its colour metadata.  It is the currency between decoder, compositor and the
AnimationBaker.  It performs *no* conversion (that is the compositor's job,
explicitly, at its boundary) and *no* I/O (this ring's rule).

The ``NDArray`` alias is re-exported here on purpose: ``ports`` may mention
exactly one third-party type — ``numpy.ndarray`` — but it imports that type
from *this* module rather than from numpy, so the frame representation has a
single home (``ports/__init__`` rule 2).

Invariant discipline: bad pixels raise :class:`NovaInvariantError` at
construction — wrong rank, wrong dtype, wrong channel count and empty images
are states no decoder may produce, so a caller supplying them has a bug, not a
user error.  Colour metadata read back from a corrupt stored document raises
the same way; ``infra`` translates that into ``Err(...)`` on load, keeping the
domain's two error channels intact.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from decimal import Decimal
from enum import IntEnum, StrEnum
from fractions import Fraction
from pathlib import PurePath
from typing import Any, Final, TypeAlias

import numpy as np
import numpy.typing as npt

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.ident import EntityId
from nova_studio.core.temporal import Rational, Rounding, Timebase, frames_to_seconds

__all__ = [
    "AssetKind",
    "AssetLinkState",
    "AudioBuffer",
    "AudioSamples",
    "AudioStreamInfo",
    "ColourMeta",
    "ColourPrimaries",
    "ColourRange",
    "ColourSpace",
    "ColourTransfer",
    "ContentHash",
    "ContentHashAlgorithm",
    "FrameBuffer",
    "MediaAsset",
    "MediaInfo",
    "NDArray",
    "VideoStreamInfo",
]

#: The frame representation.  Re-exported so ``ports`` signatures can mention
#: buffers without importing numpy directly (ADR-0002 rule 2).
NDArray: TypeAlias = npt.NDArray[np.uint8]


class ColourSpace(IntEnum):
    """Chroma matrix coefficients as signalled in the container (``AVCOL_SPC``).

    Verified against FFmpeg 7.0.2 ``av_color_space_name``: 0 gbr, 1 bt709,
    2 unspecified/unknown, 3 reserved, 4 fcc, 5 bt470bg, 6 smpte170m,
    7 smpte240m, 8 ycgco, 9 bt2020nc, 10 bt2020c, 11 smpte2085,
    12 chroma-derived-nc, 13 chroma-derived-c, 14 ictcp, 15 ipt-c2,
    16 ycgco-re, 17 ycgco-ro.
    """

    GBR = 0
    BT709 = 1
    ITU709 = 1  # PyAV's spelling of BT709
    UNSPECIFIED = 2
    RESERVED = 3
    FCC = 4
    BT470BG = 5
    ITU601 = 5  # PyAV's spelling of BT470BG (the 625-line ITU-R BT.601 variant)
    SMPTE170M = 6
    SMPTE240M = 7
    YCGCO = 8
    BT2020_NCL = 9
    BT2020 = 9  # PyAV's spelling of BT2020_NCL (non-constant luminance)
    BT2020_CL = 10
    SMPTE2085 = 11
    CHROMA_DERIVED_NC = 12
    CHROMA_DERIVED_C = 13
    ICTCP = 14
    IPT_C2 = 15
    YCGCO_RE = 16
    YCGCO_RO = 17


class ColourPrimaries(IntEnum):
    """Colour primaries / white point (``AVCOL_PRI``).

    Verified against FFmpeg 7.0.2 ``av_color_primaries_name``: 0 reserved,
    1 bt709, 2 unspecified/unknown, 3 reserved, 4 bt470m, 5 bt470bg,
    6 smpte170m, 7 smpte240m, 8 film, 9 bt2020, 10 smpte428, 11 smpte431,
    12 smpte432, 22 ebu3213.
    """

    RESERVED0 = 0
    BT709 = 1
    UNSPECIFIED = 2
    RESERVED = 3
    BT470M = 4
    BT470BG = 5
    SMPTE170M = 6
    SMPTE240M = 7
    FILM = 8
    BT2020 = 9
    SMPTE428 = 10
    SMPTE431 = 11
    SMPTE432 = 12
    EBU3213 = 22


class ColourTransfer(IntEnum):
    """Transfer characteristics / gamma curve (``AVCOL_TRC``).

    Verified against FFmpeg 7.0.2 ``av_color_transfer_name``: 0 reserved,
    1 bt709, 2 unspecified/unknown, 3 reserved, 4 bt470m (gamma 2.2),
    5 bt470bg (gamma 2.8), 6 smpte170m, 7 smpte240m, 8 linear, 9 log100,
    10 log316, 11 iec61966-2-4, 12 bt1361e, 13 iec61966-2-1, 14 bt2020-10,
    15 bt2020-12, 16 smpte2084 (PQ), 17 smpte428, 18 arib-std-b67 (HLG).
    """

    RESERVED0 = 0
    BT709 = 1
    UNSPECIFIED = 2
    RESERVED = 3
    BT470M = 4
    GAMMA22 = 4  # PyAV's spelling of BT470M
    BT470BG = 5
    GAMMA28 = 5  # PyAV's spelling of BT470BG
    SMPTE170M = 6
    SMPTE240M = 7
    LINEAR = 8
    LOG = 9
    LOG_SQRT = 10
    IEC61966_2_4 = 11
    BT1361_ECG = 12
    IEC61966_2_1 = 13
    BT2020_10 = 14
    BT2020_12 = 15
    SMPTE2084 = 16
    PQ = 16  # what everyone calls SMPTE2084 (Perceptual Quantizer, HDR10)
    SMPTE428 = 17
    ARIB_STD_B67 = 18
    HLG = 18  # what everyone calls ARIB STD-B67 (broadcast HDR)


class ColourRange(IntEnum):
    """Luma and colour sample range (``AVCOL_RANGE``).

    Verified against FFmpeg 7.0.2 ``av_color_range_name``: 0 unspecified,
    1 limited (ffprobe prints ``tv``, the C constant is ``MPEG``), 2 full
    (ffprobe prints ``pc``, the C constant is ``JPEG``).  Aliases keep both
    vocabularies readable; iteration yields only the canonical three.
    """

    UNSPECIFIED = 0
    LIMITED = 1
    MPEG = 1  # FFmpeg C name
    TV = 1  # ffprobe display name
    FULL = 2
    JPEG = 2  # FFmpeg C name
    PC = 2  # ffprobe display name


@dataclass(frozen=True, slots=True)
class ColourMeta:
    """The four tags every frame carries (ADR-0007 §6).

    ``to_wire``/``from_wire`` speak the canonical JSON of the project format
    (ADR-0015): integers, exactly these four keys, nothing else.  Conversion
    between tags is never performed here — this object only says what the
    pixels *are*.
    """

    space: ColourSpace = ColourSpace.UNSPECIFIED
    range: ColourRange = ColourRange.UNSPECIFIED
    primaries: ColourPrimaries = ColourPrimaries.UNSPECIFIED
    transfer: ColourTransfer = ColourTransfer.UNSPECIFIED

    @property
    def is_unspecified(self) -> bool:
        """True when no tag carries information — the file never said.

        A compositor treats this as "choose a defined default and convert
        explicitly" rather than as a distinct colourspace.
        """
        return (
            self.space is ColourSpace.UNSPECIFIED
            and self.range is ColourRange.UNSPECIFIED
            and self.primaries is ColourPrimaries.UNSPECIFIED
            and self.transfer is ColourTransfer.UNSPECIFIED
        )

    def to_wire(self) -> dict[str, int]:
        """Serialise to the canonical JSON mapping (keys as in ADR-0007 §6)."""
        return {
            "space": int(self.space),
            "range": int(self.range),
            "primaries": int(self.primaries),
            "transfer": int(self.transfer),
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> ColourMeta:
        """Rebuild from what :meth:`to_wire` wrote.

        Raises:
            NovaInvariantError: On a missing, extra, mistyped or unknown field.
                A corrupt probe summary must not half-construct a colour tag;
                callers in ``infra`` turn this into ``Err(...)`` when loading
                a project rather than letting a bad file crash the editor.
        """
        expected = ("space", "range", "primaries", "transfer")
        if set(data) != set(expected):
            raise NovaInvariantError(
                "colour metadata fields must be exactly "
                f"{expected}, got {sorted(str(key) for key in data)}"
            )
        values: dict[str, int] = {}
        for key in expected:
            raw = data[key]
            if isinstance(raw, bool) or not isinstance(raw, int):
                raise NovaInvariantError(
                    f"colour metadata {key!r} must be an int, got {type(raw).__name__}"
                )
            values[key] = raw
        try:
            return cls(
                space=ColourSpace(values["space"]),
                range=ColourRange(values["range"]),
                primaries=ColourPrimaries(values["primaries"]),
                transfer=ColourTransfer(values["transfer"]),
            )
        except ValueError as error:
            raise NovaInvariantError(f"unknown colour metadata value: {error}") from error


@dataclass(frozen=True, slots=True, eq=False)
class FrameBuffer:
    """A decoded frame: pixels plus the colour they were tagged with.

    Shape contract: ``height x width x channels``, ``uint8``, channels in
    {1, 3, 4}.  Anything else raises :class:`NovaInvariantError` — the decoder
    adapters are required to normalise before handing a frame over, so a
    violation here is a bug in the adapter, not a property of the media.

    ``eq`` is deliberately disabled: dataclass equality would call
    ``bool(pixels)`` on a NumPy array, which raises for any image larger than
    one pixel.  Equality is therefore identity; when content equality is
    wanted, compare with ``numpy.array_equal(a.pixels, b.pixels)`` — and note
    that two separately decoded copies of the same timestamp are equal in
    content but not in identity, which is usually the distinction a test
    actually cares about.
    """

    pixels: NDArray
    colour: ColourMeta = ColourMeta()

    def __post_init__(self) -> None:
        # getattr with a default keeps mypy from proving the failure branch
        # unreachable (warn_unreachable is on): a plugin or a wire caller can
        # pass anything, and the invariant must be checked at runtime.
        shape: Any = getattr(self.pixels, "shape", None)
        dtype: Any = getattr(self.pixels, "dtype", None)
        if shape is None or dtype is None:
            raise NovaInvariantError(
                f"FrameBuffer.pixels must be a NumPy array, got {type(self.pixels).__name__}"
            )
        if len(shape) != 3:
            raise NovaInvariantError(f"FrameBuffer.pixels must be HxWxC, got shape {shape}")
        height, width, channels = shape
        if height < 1 or width < 1:
            raise NovaInvariantError(f"FrameBuffer.pixels must not be empty, got shape {shape}")
        if channels not in (1, 3, 4):
            raise NovaInvariantError(
                f"FrameBuffer.pixels must have 1, 3 or 4 channels, got {channels}"
            )
        if dtype != np.uint8:
            raise NovaInvariantError(
                f"FrameBuffer.pixels must be uint8, got {dtype}; wider types are "
                "converted at the compositor boundary, not here"
            )

    @property
    def height(self) -> int:
        """Rows of pixels."""
        return int(self.pixels.shape[0])

    @property
    def width(self) -> int:
        """Columns of pixels."""
        return int(self.pixels.shape[1])

    @property
    def channels(self) -> int:
        """1 = single channel (alpha/mask), 3 = RGB, 4 = RGBA."""
        return int(self.pixels.shape[2])

    def with_colour(self, colour: ColourMeta) -> FrameBuffer:
        """Return a buffer with new colour tags, sharing pixel storage.

        Zero-copy on purpose: tagging differs, pixels do not.  The original is
        untouched (the buffer is frozen), so a pipeline can branch on colour
        without cloning a 4K frame.
        """
        return replace(self, colour=colour)


class AssetLinkState(StrEnum):
    """Whether a referenced media file is where the project says it is.

    A missing asset is a first-class state, not an error: the project opens,
    plays what it can, and offers a relink workflow (ADR-0015 rule 3).  The
    distinction between "missing" and "corrupt" belongs to the probe stage;
    here we only know whether the path resolves.
    """

    LINKED = "linked"
    MISSING = "missing"


class AssetKind(StrEnum):
    """What a referenced file *is*, as decided by the probe — never by its suffix.

    Suffixes lie: ``.mov`` files carry ProRes, HEVC or only audio; a ``.mp4`` may
    be a still with a cover art stream; a ``.png`` is a legitimate timeline clip.
    The probe decides, and everything downstream (which panel offers the asset,
    which streams a clip may bind to) reads this field rather than guessing from
    a name.
    """

    VIDEO = "video"
    AUDIO = "audio"
    IMAGE = "image"
    UNKNOWN = "unknown"


class ContentHashAlgorithm(StrEnum):
    """Digest algorithms a project record may name.

    SHA-256 is what ADR-0015 mandates for ``checksum.json`` and for asset
    identity.  The enum exists so the algorithm travels *with* the digest: a
    file recorded years ago stays verifiable when the default changes, and a
    hash read back from an old project is never silently reinterpreted.
    """

    SHA256 = "sha256"


#: Hex length of each supported digest.
_DIGEST_HEX_LENGTH: Final[dict[ContentHashAlgorithm, int]] = {ContentHashAlgorithm.SHA256: 64}

#: Lowercase only. A canonical wire form (ADR-0015) needs one spelling, and
#: ``hashlib.hexdigest()`` already produces this one.
_HEX_DIGITS: Final[frozenset[str]] = frozenset("0123456789abcdef")


@dataclass(frozen=True, slots=True)
class ContentHash:
    """The identity of a file's bytes, independent of its name or location.

    This is what lets a project survive a moved media folder: the asset is
    matched by content, not by path, so relinking can *prove* it found the same
    footage instead of hoping (ADR-0015 rule 3).
    """

    digest: str
    algorithm: ContentHashAlgorithm = ContentHashAlgorithm.SHA256

    def __post_init__(self) -> None:
        expected = _DIGEST_HEX_LENGTH.get(self.algorithm)
        if expected is None:
            raise NovaInvariantError(f"unsupported digest algorithm {self.algorithm!r}")
        if len(self.digest) != expected or not set(self.digest) <= _HEX_DIGITS:
            raise NovaInvariantError(
                f"{self.algorithm} digest must be {expected} lowercase hex characters, "
                f"got {self.digest!r}"
            )

    def __str__(self) -> str:
        """``sha256:<digest>`` — the form shown in the relink dialog."""
        return f"{self.algorithm}:{self.digest}"

    def to_wire(self) -> dict[str, str]:
        """Serialise to the canonical JSON mapping."""
        return {"algorithm": str(self.algorithm), "digest": self.digest}

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> ContentHash:
        """Rebuild from what :meth:`to_wire` wrote."""
        _reject_unknown_fields(data, {"algorithm", "digest"})
        raw_algorithm = _wire_str(data, "algorithm")
        try:
            algorithm = ContentHashAlgorithm(raw_algorithm)
        except ValueError as error:
            raise NovaInvariantError(f"unknown digest algorithm {raw_algorithm!r}") from error
        return cls(digest=_wire_str(data, "digest"), algorithm=algorithm)


@dataclass(frozen=True, slots=True)
class VideoStreamInfo:
    """Everything the timeline needs to know about one video stream.

    A container may hold several video streams (a proxy track, a cover art
    stream, a stereo pair).  The asset keeps them all and the clip binds to one
    by index, which is why ``index`` is part of the identity of a stream rather
    than a positional accident.

    Still images are described with ``frame_count == 1`` and a nominal
    ``1/1`` timebase: a still has no rate of its own, and the timeline — not the
    file — decides how long it is shown.
    """

    codec_name: str
    width: int
    height: int
    timebase: Timebase
    index: int = 0
    frame_count: int = 0
    pixel_format: str = ""
    colour: ColourMeta = ColourMeta()
    rotation: int = 0
    sample_aspect_ratio: Rational = Fraction(1)

    def __post_init__(self) -> None:
        if self.width <= 0 or self.height <= 0:
            raise NovaInvariantError(
                f"video stream dimensions must be positive, got {self.width}x{self.height}"
            )
        if self.index < 0:
            raise NovaInvariantError(f"stream index must not be negative, got {self.index}")
        if self.frame_count < 0:
            raise NovaInvariantError(f"frame_count must not be negative, got {self.frame_count}")
        if self.rotation not in (0, 90, 180, 270):
            raise NovaInvariantError(
                f"rotation must be 0, 90, 180 or 270 degrees, got {self.rotation}"
            )
        if self.sample_aspect_ratio <= 0:
            raise NovaInvariantError(
                f"sample aspect ratio must be positive, got {self.sample_aspect_ratio}"
            )

    @property
    def duration_seconds(self) -> float:
        """Stream duration, converted through the canonical frame maths."""
        return frames_to_seconds(self.frame_count, self.timebase)

    @property
    def is_rotated(self) -> bool:
        """True when display swaps the axes (a phone held sideways)."""
        return self.rotation in (90, 270)

    @property
    def display_width(self) -> int:
        """Width as it should be shown: sample aspect ratio and rotation applied."""
        return self._display_size()[0]

    @property
    def display_height(self) -> int:
        """Height as it should be shown: sample aspect ratio and rotation applied."""
        return self._display_size()[1]

    def _display_size(self) -> tuple[int, int]:
        # Anamorphic footage stores non-square pixels (1440x1080 with a 4:3 SAR
        # is 1920x1080 on screen).  Decimal keeps the multiplication exact and
        # the rounding mode is stated, never implicit (ADR-0006).
        sar = Fraction(self.sample_aspect_ratio)
        width = Decimal(self.width) * Decimal(sar.numerator) / Decimal(sar.denominator)
        height = Decimal(self.height)
        if self.is_rotated:
            width, height = height, width
        return (
            Rounding.NEAREST_EVEN.apply(width),
            Rounding.NEAREST_EVEN.apply(height),
        )

    def to_wire(self) -> dict[str, object]:
        """Serialise to the canonical JSON mapping."""
        return {
            "index": self.index,
            "codec": self.codec_name,
            "width": self.width,
            "height": self.height,
            "timebase": self.timebase.to_dict(),
            "frames": self.frame_count,
            "pix_fmt": self.pixel_format,
            "rotation": self.rotation,
            "sar": [self.sample_aspect_ratio.numerator, self.sample_aspect_ratio.denominator],
            "colour": self.colour.to_wire(),
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> VideoStreamInfo:
        """Rebuild from what :meth:`to_wire` wrote."""
        _reject_unknown_fields(data, _VIDEO_STREAM_FIELDS)
        timebase_raw = data["timebase"]
        if not isinstance(timebase_raw, Mapping):
            raise NovaInvariantError("timebase must be a mapping of num/den")
        sar_raw = data["sar"]
        if not isinstance(sar_raw, Sequence) or len(sar_raw) != 2:
            raise NovaInvariantError("sar must be a two-element [num, den] pair")
        colour_raw = data["colour"]
        if not isinstance(colour_raw, Mapping):
            raise NovaInvariantError("colour must be a mapping")
        numerator = _wire_int_in(sar_raw, 0, "sar")
        denominator = _wire_int_in(sar_raw, 1, "sar")
        if denominator == 0:
            raise NovaInvariantError("sar denominator must not be zero")
        try:
            timebase = Timebase.from_dict(_wire_int_mapping(timebase_raw, "timebase"))
        except (KeyError, TypeError, ValueError) as error:
            raise NovaInvariantError(f"invalid timebase in stream summary: {error}") from error
        return cls(
            index=_wire_int(data, "index"),
            codec_name=_wire_str(data, "codec"),
            width=_wire_int(data, "width"),
            height=_wire_int(data, "height"),
            timebase=timebase,
            frame_count=_wire_int(data, "frames"),
            pixel_format=_wire_str(data, "pix_fmt"),
            rotation=_wire_int(data, "rotation"),
            sample_aspect_ratio=Fraction(numerator, denominator),
            colour=ColourMeta.from_wire(colour_raw),
        )


@dataclass(frozen=True, slots=True)
class AudioStreamInfo:
    """Everything the timeline needs to know about one audio stream.

    Multi-track files are ordinary (a camera's four channels, a music bed plus
    an interview), so the asset keeps a tuple of these and a clip binds to one
    by index — the same rule as video.
    """

    codec_name: str
    sample_rate: int
    channels: int
    index: int = 0
    sample_count: int = 0
    sample_format: str = ""
    channel_layout: str = ""

    def __post_init__(self) -> None:
        if self.sample_rate <= 0:
            raise NovaInvariantError(f"sample_rate must be positive, got {self.sample_rate}")
        if self.channels <= 0:
            raise NovaInvariantError(f"channels must be positive, got {self.channels}")
        if self.index < 0:
            raise NovaInvariantError(f"stream index must not be negative, got {self.index}")
        if self.sample_count < 0:
            raise NovaInvariantError(f"sample_count must not be negative, got {self.sample_count}")

    @property
    def duration_seconds(self) -> float:
        """Stream duration in seconds, derived from the sample count."""
        return self.sample_count / self.sample_rate

    def to_wire(self) -> dict[str, object]:
        """Serialise to the canonical JSON mapping."""
        return {
            "index": self.index,
            "codec": self.codec_name,
            "sample_rate": self.sample_rate,
            "channels": self.channels,
            "samples": self.sample_count,
            "sample_fmt": self.sample_format,
            "layout": self.channel_layout,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> AudioStreamInfo:
        """Rebuild from what :meth:`to_wire` wrote."""
        _reject_unknown_fields(data, _AUDIO_STREAM_FIELDS)
        return cls(
            index=_wire_int(data, "index"),
            codec_name=_wire_str(data, "codec"),
            sample_rate=_wire_int(data, "sample_rate"),
            channels=_wire_int(data, "channels"),
            sample_count=_wire_int(data, "samples"),
            sample_format=_wire_str(data, "sample_fmt"),
            channel_layout=_wire_str(data, "layout"),
        )


@dataclass(frozen=True, slots=True)
class MediaInfo:
    """A probe summary: what the file said about itself (ADR-0015 ``media/index.json``).

    This is the *only* part of a probe that is persisted.  It is deliberately
    narrow — geometry, rate, codec names, colour, duration — and contains
    nothing that only a live container could answer (no open handles, no
    decoder state).  Storing it is what lets a project open, lay out its
    timeline and show correct placeholders while the originals are still
    missing (ADR-0015 rule 3).

    ``metadata`` is informational container tags (encoder, title, reel name).
    It is shown to the user and never influences decoding, so it is the one
    field a probe may lose without consequence.  It is treated as read-only:
    the object is frozen, but a mapping is not, and nothing in the editor
    mutates a probe summary after it is built.
    """

    kind: AssetKind
    container_format: str = ""
    duration_seconds: float = 0.0
    bit_rate: int = 0
    video: tuple[VideoStreamInfo, ...] = ()
    audio: tuple[AudioStreamInfo, ...] = ()
    subtitle_count: int = 0
    other_stream_count: int = 0
    metadata: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.duration_seconds < 0:
            raise NovaInvariantError(f"duration must not be negative, got {self.duration_seconds}")
        if self.bit_rate < 0:
            raise NovaInvariantError(f"bit_rate must not be negative, got {self.bit_rate}")
        if self.subtitle_count < 0 or self.other_stream_count < 0:
            raise NovaInvariantError("stream counts must not be negative")
        if self.kind is AssetKind.VIDEO or self.kind is AssetKind.IMAGE:
            if not self.video:
                raise NovaInvariantError(f"{self.kind} probe must carry a video stream")
        elif self.kind is AssetKind.AUDIO and not self.audio:
            raise NovaInvariantError("audio probe must carry an audio stream")

    @property
    def has_video(self) -> bool:
        """True when at least one video stream was found."""
        return bool(self.video)

    @property
    def has_audio(self) -> bool:
        """True when at least one audio stream was found."""
        return bool(self.audio)

    def primary_video(self) -> VideoStreamInfo | None:
        """The stream a new clip binds to by default."""
        return self.video[0] if self.video else None

    def primary_audio(self) -> AudioStreamInfo | None:
        """The stream a new audio clip binds to by default."""
        return self.audio[0] if self.audio else None

    def stream(self, index: int) -> VideoStreamInfo | AudioStreamInfo | None:
        """Look a stream up by its container index, in either flavour."""
        streams: tuple[VideoStreamInfo | AudioStreamInfo, ...] = (*self.video, *self.audio)
        for stream in streams:
            if stream.index == index:
                return stream
        return None

    def to_wire(self) -> dict[str, object]:
        """Serialise to the canonical JSON mapping."""
        return {
            "kind": str(self.kind),
            "container": self.container_format,
            "duration_s": self.duration_seconds,
            "bit_rate": self.bit_rate,
            "video": [stream.to_wire() for stream in self.video],
            "audio": [stream.to_wire() for stream in self.audio],
            "subtitle_streams": self.subtitle_count,
            "other_streams": self.other_stream_count,
            "metadata": dict(sorted(self.metadata.items())),
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> MediaInfo:
        """Rebuild from what :meth:`to_wire` wrote."""
        _reject_unknown_fields(data, _MEDIA_INFO_FIELDS)
        raw_kind = _wire_str(data, "kind")
        try:
            kind = AssetKind(raw_kind)
        except ValueError as error:
            raise NovaInvariantError(f"unknown asset kind {raw_kind!r}") from error
        raw_video = data["video"]
        raw_audio = data["audio"]
        raw_metadata = data["metadata"]
        if not isinstance(raw_video, Sequence) or isinstance(raw_video, str | bytes):
            raise NovaInvariantError("video must be a list of stream summaries")
        if not isinstance(raw_audio, Sequence) or isinstance(raw_audio, str | bytes):
            raise NovaInvariantError("audio must be a list of stream summaries")
        if not isinstance(raw_metadata, Mapping):
            raise NovaInvariantError("metadata must be a mapping")
        metadata: dict[str, str] = {}
        for key, value in raw_metadata.items():
            if not isinstance(key, str) or not isinstance(value, str):
                raise NovaInvariantError("metadata keys and values must be strings")
            metadata[key] = value
        return cls(
            kind=kind,
            container_format=_wire_str(data, "container"),
            duration_seconds=_wire_number(data, "duration_s"),
            bit_rate=_wire_int(data, "bit_rate"),
            video=tuple(
                VideoStreamInfo.from_wire(stream)
                for stream in raw_video
                if isinstance(stream, Mapping)
            ),
            audio=tuple(
                AudioStreamInfo.from_wire(stream)
                for stream in raw_audio
                if isinstance(stream, Mapping)
            ),
            subtitle_count=_wire_int(data, "subtitle_streams"),
            other_stream_count=_wire_int(data, "other_streams"),
            metadata=metadata,
        )


#: Decoded audio samples: ``(n_samples, n_channels)``, float32, nominal ±1.0.
AudioSamples: TypeAlias = npt.NDArray[np.float32]


@dataclass(frozen=True, slots=True, eq=False)
class AudioBuffer:
    """A block of decoded audio: samples plus the rate they were captured at.

    Interleaved ``(n_samples, n_channels)`` float32 in the nominal ±1.0 range.
    Decoders produce planar data; normalising here means everything downstream
    — waveform peaks, loudness, mixing, the export muxer — sees one layout.

    ``eq`` is disabled for the same reason as :class:`FrameBuffer`: dataclass
    equality would call ``bool()`` on a NumPy array and raise.  Identity is the
    default comparison; content equality uses ``numpy.array_equal``.

    Non-finite samples are *not* validated: a NaN check costs a full pass over
    every buffer on the decode path, and a corrupt sample belongs to the
    decoder's error channel, not to a construction invariant.
    """

    samples: AudioSamples
    sample_rate: int

    def __post_init__(self) -> None:
        shape: Any = getattr(self.samples, "shape", None)
        dtype: Any = getattr(self.samples, "dtype", None)
        if shape is None or dtype is None:
            raise NovaInvariantError(
                f"AudioBuffer.samples must be a NumPy array, got {type(self.samples).__name__}"
            )
        if len(shape) != 2:
            raise NovaInvariantError(
                f"AudioBuffer.samples must be (n_samples, n_channels), got shape {shape}"
            )
        if shape[1] < 1:
            raise NovaInvariantError(f"AudioBuffer must have at least one channel, got {shape}")
        if dtype != np.float32:
            raise NovaInvariantError(
                f"AudioBuffer.samples must be float32, got {dtype}; conversion happens "
                "in the decoder adapter, not here"
            )
        if self.sample_rate <= 0:
            raise NovaInvariantError(
                f"AudioBuffer.sample_rate must be positive, got {self.sample_rate}"
            )

    @property
    def frame_count(self) -> int:
        """Number of sample frames (rows); channels are columns."""
        return int(self.samples.shape[0])

    @property
    def channels(self) -> int:
        """Channel count."""
        return int(self.samples.shape[1])

    @property
    def duration_seconds(self) -> float:
        """Duration of this block."""
        return self.frame_count / self.sample_rate

    @property
    def is_empty(self) -> bool:
        """True when the block carries no samples (end of stream)."""
        return self.frame_count == 0

    @property
    def peak(self) -> float:
        """Largest absolute sample value, or 0.0 for an empty block.

        Waveform rendering meters against this; it is computed on demand rather
        than stored because most blocks are decoded, mixed and discarded without
        anyone asking.
        """
        if self.is_empty:
            return 0.0
        return float(np.max(np.abs(self.samples)))

    def to_mono(self) -> AudioBuffer:
        """Downmix to one channel by averaging (never by taking one channel).

        Averaging is what a listener hears when channels are summed; picking a
        channel would make a waveform disagree with the audio.
        """
        if self.channels == 1:
            return self
        mixed = np.asarray(self.samples.mean(axis=1, dtype=np.float32), dtype=np.float32)
        mono: AudioSamples = mixed.reshape(-1, 1)
        return AudioBuffer(samples=mono, sample_rate=self.sample_rate)

    def slice(self, start: int, stop: int | None = None) -> AudioBuffer:
        """Return a zero-copy view of a sample range.

        Negative indices follow Python slicing, so ``buffer.slice(-1024)`` means
        "the last 1024 samples".
        """
        view = self.samples[start:stop]
        return AudioBuffer(samples=view, sample_rate=self.sample_rate)


@dataclass(frozen=True, slots=True)
class MediaAsset:
    """A reference to a media file, and what we last knew about it.

    The asset is the unit of identity in a project: clips reference
    ``asset_id``, never a path, so moving a folder is one relink rather than a
    hundred edits (ADR-0015 rule 3).  The path is stored as recorded — this is
    the one place absolute user paths are allowed to live — and the content hash
    is what makes a relink provable rather than hopeful.

    State transitions are explicit methods, not attribute assignment, because
    two fields are coupled: a hash change invalidates the probe summary, and
    silently keeping a stale probe is how an editor ends up laying out a
    timeline against geometry the file no longer has.
    """

    asset_id: EntityId
    path: str
    kind: AssetKind = AssetKind.UNKNOWN
    content_hash: ContentHash | None = None
    link_state: AssetLinkState = AssetLinkState.LINKED
    probe: MediaInfo | None = None

    def __post_init__(self) -> None:
        if not self.path:
            raise NovaInvariantError("a media asset must carry a path")

    @property
    def is_linked(self) -> bool:
        """True when the recorded path resolved on last check."""
        return self.link_state is AssetLinkState.LINKED

    @property
    def is_probed(self) -> bool:
        """True when a probe summary is available (possibly from a previous session)."""
        return self.probe is not None

    @property
    def display_name(self) -> str:
        """File name shown in the media panel; the directory is not repeated.

        ``PurePath`` is pure string work — no filesystem access — so this stays
        inside the domain's no-I/O rule.
        """
        return PurePath(self.path).name

    def mark_missing(self) -> MediaAsset:
        """Record that the path no longer resolves.

        The probe summary is deliberately kept: it is what lets the timeline
        keep its geometry and show the right-sized placeholder while the user
        relinks (ADR-0015 rule 3).
        """
        return replace(self, link_state=AssetLinkState.MISSING)

    def relink(
        self,
        new_path: str,
        *,
        content_hash: ContentHash | None = None,
        probe: MediaInfo | None = None,
    ) -> MediaAsset:
        """Point the asset at ``new_path`` and return the updated asset.

        The coupling that matters: a probe summary is only valid for the bytes
        it was taken from.  Relinking without supplying a hash discards both the
        hash and the probe, because we can no longer claim to know what the file
        contains.  Supplying a hash *equal to the recorded one* proves it is the
        same footage, so the existing probe survives; supplying a different hash
        drops it and forces a re-probe.

        Raises:
            NovaInvariantError: On an empty path.
        """
        if not new_path:
            raise NovaInvariantError("a media asset must carry a path")
        same_content = content_hash is not None and content_hash == self.content_hash
        next_probe = probe if probe is not None else (self.probe if same_content else None)
        return replace(
            self,
            path=new_path,
            content_hash=content_hash,
            probe=next_probe,
            link_state=AssetLinkState.LINKED,
        )

    def with_probe(self, info: MediaInfo) -> MediaAsset:
        """Attach a fresh probe summary, adopting the kind it discovered."""
        return replace(self, probe=info, kind=info.kind)

    def with_hash(self, content_hash: ContentHash) -> MediaAsset:
        """Attach a content hash, keeping the probe unless the hash contradicts it.

        The normal import order is *probe the bytes, then hash them*, so the
        first hash arrives when a probe is already present and must not discard
        it.  A hash that differs from one already on record means the file was
        replaced after the probe was taken, and stale geometry is worse than
        none: the timeline would lay itself out against dimensions the file no
        longer has.
        """
        contradicts = self.content_hash is not None and content_hash != self.content_hash
        return replace(self, content_hash=content_hash, probe=None if contradicts else self.probe)

    def to_wire(self) -> dict[str, object]:
        """Serialise to one ``media/index.json`` entry (ADR-0015)."""
        return {
            "asset_id": str(self.asset_id),
            "path": self.path,
            "kind": str(self.kind),
            "link_state": str(self.link_state),
            "content_hash": self.content_hash.to_wire() if self.content_hash else None,
            "probe": self.probe.to_wire() if self.probe else None,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> MediaAsset:
        """Rebuild from what :meth:`to_wire` wrote."""
        _reject_unknown_fields(data, _MEDIA_ASSET_FIELDS)
        raw_kind = _wire_str(data, "kind")
        raw_state = _wire_str(data, "link_state")
        raw_hash = data["content_hash"]
        raw_probe = data["probe"]
        if raw_hash is not None and not isinstance(raw_hash, Mapping):
            raise NovaInvariantError("content_hash must be a mapping or null")
        if raw_probe is not None and not isinstance(raw_probe, Mapping):
            raise NovaInvariantError("probe must be a mapping or null")
        try:
            kind = AssetKind(raw_kind)
            link_state = AssetLinkState(raw_state)
        except ValueError as error:
            raise NovaInvariantError(f"unknown asset value: {error}") from error
        return cls(
            asset_id=EntityId(_wire_str(data, "asset_id")),
            path=_wire_str(data, "path"),
            kind=kind,
            content_hash=ContentHash.from_wire(raw_hash) if raw_hash is not None else None,
            link_state=link_state,
            probe=MediaInfo.from_wire(raw_probe) if raw_probe is not None else None,
        )


#: Canonical field sets, pinned so that adding a field to ``to_wire`` without
#: teaching ``from_wire`` about it fails loudly instead of dropping data.
_VIDEO_STREAM_FIELDS: Final[set[str]] = {
    "index",
    "codec",
    "width",
    "height",
    "timebase",
    "frames",
    "pix_fmt",
    "rotation",
    "sar",
    "colour",
}
_AUDIO_STREAM_FIELDS: Final[set[str]] = {
    "index",
    "codec",
    "sample_rate",
    "channels",
    "samples",
    "sample_fmt",
    "layout",
}
_MEDIA_INFO_FIELDS: Final[set[str]] = {
    "kind",
    "container",
    "duration_s",
    "bit_rate",
    "video",
    "audio",
    "subtitle_streams",
    "other_streams",
    "metadata",
}
_MEDIA_ASSET_FIELDS: Final[set[str]] = {
    "asset_id",
    "path",
    "kind",
    "link_state",
    "content_hash",
    "probe",
}


# -- wire helpers -------------------------------------------------------------
#
# Strict, because a probe summary comes from a file: half-parsing one would give
# the timeline geometry that looks valid and is wrong.


def _reject_unknown_fields(data: Mapping[str, object], expected: set[str]) -> None:
    if set(data) != expected:
        raise NovaInvariantError(
            f"fields must be exactly {sorted(expected)}, got {sorted(str(key) for key in data)}"
        )


def _wire_int(data: Mapping[str, object], key: str) -> int:
    raw = data[key]
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise NovaInvariantError(f"{key!r} must be an int, got {type(raw).__name__}")
    return raw


def _wire_int_in(data: Sequence[object], position: int, key: str) -> int:
    raw = data[position]
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise NovaInvariantError(f"{key!r} must hold ints, got {type(raw).__name__}")
    return raw


def _wire_str(data: Mapping[str, object], key: str) -> str:
    raw = data[key]
    if not isinstance(raw, str):
        raise NovaInvariantError(f"{key!r} must be a str, got {type(raw).__name__}")
    return raw


def _wire_int_mapping(data: Mapping[str, object], key: str) -> dict[str, int]:
    """Validate a nested ``{str: int}`` mapping (the timebase of a stream)."""
    result: dict[str, int] = {}
    for name, raw in data.items():
        if not isinstance(name, str):
            raise NovaInvariantError(f"{key!r} keys must be strings")
        if isinstance(raw, bool) or not isinstance(raw, int):
            raise NovaInvariantError(f"{key}.{name} must be an int, got {type(raw).__name__}")
        result[name] = raw
    return result


def _wire_number(data: Mapping[str, object], key: str) -> float:
    raw = data[key]
    if isinstance(raw, bool) or not isinstance(raw, int | float):
        raise NovaInvariantError(f"{key!r} must be a number, got {type(raw).__name__}")
    return float(raw)
