"""Pin the domain colour vocabulary to the toolchain that produced it.

Provenance: every value was read from the bundled FFmpeg 7.0.2 — the
``av_color_*_name`` tables in libavutil, plus an encode/decode round-trip
through libx264 — on 2026-09-24.  PyAV 18.1 re-exports the same numbers as
Python enums, which is what this file compares against.

If it fails after a toolchain bump, the domain and the decoder disagree about
what a colour tag *means*: a "limited range" frame could become full range, or
HDR10 could be tagged with the wrong curve, and neither error is visible until
someone grades footage.  Reconcile the domain vocabulary — do not widen, skip
or delete the test.
"""

from __future__ import annotations

from enum import IntEnum

from av.video.reformatter import (
    ColorPrimaries as AvPrimaries,
    ColorRange as AvRange,
    Colorspace as AvSpace,
    ColorTrc as AvTrc,
)

from nova_studio.domain.media import (
    ColourPrimaries,
    ColourRange,
    ColourSpace,
    ColourTransfer,
)


def _assert_pyav_is_covered(
    domain: type[IntEnum],
    pyav: type[IntEnum],
    *,
    ignore: frozenset[str] = frozenset(),
) -> None:
    """Every *canonical* PyAV member must resolve, with the same number, in us.

    Canonical iteration on purpose: PyAV's ``__members__`` additionally carries
    lowercase convenience aliases (``itu709``, ``bt2020``, ...) used for string
    lookup, and grouping aliases that do not all agree with the signal values
    FFmpeg actually writes — most notably ``Colorspace.SMPTE170M = 5``, where
    FFmpeg has 5 = bt470bg and 6 = smpte170m (verified by encode/decode
    round-trip and ``av_color_space_name``).  We follow FFmpeg; a test that
    demanded PyAV's aliases would be pinning a mistake — see the dedicated
    divergence test below.

    The domain may hold *more* members than PyAV exposes — that direction is
    safe: the adapter can represent everything the decoder emits.  The reverse
    would be data loss.
    """
    for member in pyav:
        if member.name in ignore:
            continue
        assert member.name in domain.__members__, (
            f"{domain.__name__} lacks PyAV member {member.name}"
        )
        domain_value = domain.__members__[member.name].value
        assert domain_value == member.value, (
            f"{domain.__name__}.{member.name} is {domain_value}, PyAV/FFmpeg say {member.value}"
        )


def test_colour_range_matches_pyav() -> None:
    # NB is FFmpeg's count sentinel (AVCOL_RANGE_NB), not a value any file
    # carries: av_color_range_name(3) returns NULL, so the domain omits it.
    _assert_pyav_is_covered(ColourRange, AvRange, ignore=frozenset({"NB"}))


def test_colour_space_matches_pyav() -> None:
    _assert_pyav_is_covered(ColourSpace, AvSpace)


def test_colour_primaries_match_pyav() -> None:
    _assert_pyav_is_covered(ColourPrimaries, AvPrimaries)


def test_colour_transfer_matches_pyav() -> None:
    _assert_pyav_is_covered(ColourTransfer, AvTrc)


def test_we_follow_ffmpeg_where_pyav_aliases_disagree() -> None:
    """PyAV groups SMPTE170M with bt470bg (5); the container signal is 6.

    Evidence, 2026-09-24: encoding ``-colorspace smpte170m`` with FFmpeg 7.0.2
    and decoding the result yields ``frame.colorspace == 6``, and
    ``av_color_space_name(6)`` reads back ``"smpte170m"`` while ``(5)`` reads
    ``"bt470bg"``.  Copying PyAV's alias would tag every SD NTSC file as
    bt470bg — visually identical today, wrong the moment a conversion treats
    the two matrices differently.  PyAV's value is asserted as-shipped so a
    PyAV fix flips this test rather than silently changing meaning.
    """
    assert AvSpace.SMPTE170M.value == 5  # PyAV's grouping alias, as shipped
    assert ColourSpace.SMPTE170M == 6  # FFmpeg's signal value, as verified
    assert ColourSpace(6) is ColourSpace.SMPTE170M
    assert ColourSpace(5) is ColourSpace.BT470BG


def test_the_values_we_measured_beyond_pyav_are_still_present() -> None:
    """Members PyAV does not expose canonically but FFmpeg 7.0.2 does.

    smpte170m is the SD/NTSC matrix and shows up constantly in real footage;
    bt2020c, ictcp and the chroma-derived matrices appear in HDR and wide-gamut
    masters.  Losing any of them would make an otherwise valid file
    un-representable — the adapter would have to coerce the tag and silently
    change what the picture means.
    """
    for member in (
        ColourSpace.SMPTE170M,
        ColourSpace.YCGCO,
        ColourSpace.BT2020_CL,
        ColourSpace.SMPTE2085,
        ColourSpace.CHROMA_DERIVED_NC,
        ColourSpace.CHROMA_DERIVED_C,
        ColourSpace.ICTCP,
        ColourSpace.IPT_C2,
        ColourSpace.YCGCO_RE,
        ColourSpace.YCGCO_RO,
        ColourPrimaries.RESERVED0,
        ColourTransfer.RESERVED0,
    ):
        assert isinstance(member, IntEnum)
    assert ColourSpace.SMPTE170M == 6
    assert ColourSpace.ICTCP == 14
