"""L2 — media: what a piece of footage *is*, without touching a file.

Two things live here, both named by the architecture rather than invented:
the colour vocabulary and :class:`FrameBuffer`.

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

from dataclasses import dataclass, replace
from enum import IntEnum, StrEnum
from typing import TYPE_CHECKING, Any, TypeAlias

import numpy as np
import numpy.typing as npt

from nova_studio.core.errors import NovaInvariantError

if TYPE_CHECKING:
    # Annotations only (from __future__ import annotations keeps them lazy):
    # Mapping never needs to exist at runtime in this ring.
    from collections.abc import Mapping

__all__ = [
    "AssetLinkState",
    "ColourMeta",
    "ColourPrimaries",
    "ColourRange",
    "ColourSpace",
    "ColourTransfer",
    "FrameBuffer",
    "NDArray",
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
