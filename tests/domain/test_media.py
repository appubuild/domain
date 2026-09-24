"""L2 media vocabulary tests: colour tags, FrameBuffer invariants, link state.

No FFmpeg, no GPU, no files — the domain ring's promise, made testable.
"""

from __future__ import annotations

import json
from dataclasses import FrozenInstanceError

import numpy as np
import pytest

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.media import (
    AssetLinkState,
    ColourMeta,
    ColourPrimaries,
    ColourRange,
    ColourSpace,
    ColourTransfer,
    FrameBuffer,
)

CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


class TestColourSpace:
    def test_values_match_container_signalling(self) -> None:
        """The numbers a muxer writes, pinned independently of any library."""
        assert ColourSpace.GBR == 0
        assert ColourSpace.BT709 == 1
        assert ColourSpace.UNSPECIFIED == 2
        assert ColourSpace.FCC == 4
        assert ColourSpace.BT470BG == 5
        assert ColourSpace.SMPTE170M == 6
        assert ColourSpace.SMPTE240M == 7
        assert ColourSpace.YCGCO == 8
        assert ColourSpace.BT2020_NCL == 9
        assert ColourSpace.BT2020_CL == 10
        assert ColourSpace.ICTCP == 14

    def test_pyav_spellings_resolve_to_the_same_members(self) -> None:
        assert ColourSpace.ITU709 is ColourSpace.BT709
        assert ColourSpace.ITU601 is ColourSpace.BT470BG
        assert ColourSpace.BT2020 is ColourSpace.BT2020_NCL

    def test_aliases_do_not_pollute_iteration(self) -> None:
        """Iteration is what walks the vocabulary; aliases must not leak."""
        names = [member.name for member in ColourSpace]
        assert "ITU709" not in names
        assert "BT2020" not in names  # alias of BT2020_NCL
        assert len(names) == 18  # every verified value, no duplicates

    def test_lookup_rejects_unknown_values(self) -> None:
        with pytest.raises(ValueError):
            ColourSpace(99)


class TestColourPrimaries:
    def test_values_match_container_signalling(self) -> None:
        assert ColourPrimaries.BT709 == 1
        assert ColourPrimaries.UNSPECIFIED == 2
        assert ColourPrimaries.BT470M == 4
        assert ColourPrimaries.FILM == 8
        assert ColourPrimaries.BT2020 == 9
        assert ColourPrimaries.SMPTE432 == 12
        assert ColourPrimaries.EBU3213 == 22

    def test_reserved_slots_exist_so_no_tag_is_lost(self) -> None:
        """A file carrying 0 or 3 is representable rather than a lookup crash."""
        assert ColourPrimaries(0) is ColourPrimaries.RESERVED0
        assert ColourPrimaries(3) is ColourPrimaries.RESERVED


class TestColourTransfer:
    def test_values_match_container_signalling(self) -> None:
        assert ColourTransfer.BT709 == 1
        assert ColourTransfer.LINEAR == 8
        assert ColourTransfer.IEC61966_2_1 == 13
        assert ColourTransfer.BT2020_10 == 14
        assert ColourTransfer.SMPTE2084 == 16
        assert ColourTransfer.ARIB_STD_B67 == 18

    def test_industry_shorthand_aliases(self) -> None:
        """Editors say PQ and HLG; the container says SMPTE2084 and ARIB."""
        assert ColourTransfer.PQ is ColourTransfer.SMPTE2084
        assert ColourTransfer.HLG is ColourTransfer.ARIB_STD_B67

    def test_pyav_gamma_spellings_resolve(self) -> None:
        assert ColourTransfer.GAMMA22 is ColourTransfer.BT470M
        assert ColourTransfer.GAMMA28 is ColourTransfer.BT470BG

    def test_bt1361_keeps_the_ecg_name(self) -> None:
        assert ColourTransfer.BT1361_ECG == 12


class TestColourRange:
    def test_values_and_aliases(self) -> None:
        assert ColourRange.UNSPECIFIED == 0
        assert ColourRange.LIMITED == 1
        assert ColourRange.FULL == 2
        assert ColourRange.MPEG is ColourRange.LIMITED
        assert ColourRange.TV is ColourRange.LIMITED
        assert ColourRange.JPEG is ColourRange.FULL
        assert ColourRange.PC is ColourRange.FULL

    def test_iteration_yields_exactly_the_canonical_three(self) -> None:
        assert [member.name for member in ColourRange] == [
            "UNSPECIFIED",
            "LIMITED",
            "FULL",
        ]


class TestColourMeta:
    def test_defaults_are_unspecified(self) -> None:
        meta = ColourMeta()
        assert meta.is_unspecified
        assert meta.space is ColourSpace.UNSPECIFIED
        assert meta.range is ColourRange.UNSPECIFIED

    def test_a_single_defined_tag_disables_unspecified(self) -> None:
        meta = ColourMeta(space=ColourSpace.BT709)
        assert not meta.is_unspecified

    def test_the_object_is_frozen(self) -> None:
        meta = ColourMeta()
        with pytest.raises(FrozenInstanceError):
            meta.space = ColourSpace.BT2020_NCL  # type: ignore[misc]

    def test_to_wire_shape_and_types(self) -> None:
        wire = ColourMeta(
            space=ColourSpace.BT709,
            range=ColourRange.LIMITED,
            primaries=ColourPrimaries.BT709,
            transfer=ColourTransfer.BT709,
        ).to_wire()
        assert wire == {"space": 1, "range": 1, "primaries": 1, "transfer": 1}
        assert all(type(value) is int for value in wire.values())

    def test_wire_round_trips_through_canonical_json(self) -> None:
        """ADR-0015 stores canonical JSON; the round trip must be lossless."""
        original = ColourMeta(
            space=ColourSpace.BT2020_NCL,
            range=ColourRange.FULL,
            primaries=ColourPrimaries.BT2020,
            transfer=ColourTransfer.PQ,
        )
        wire = json.loads(json.dumps(original.to_wire()))
        assert ColourMeta.from_wire(wire) == original

    def test_from_wire_rejects_missing_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="exactly"):
            ColourMeta.from_wire({"space": 1, "range": 1, "primaries": 1})

    def test_from_wire_rejects_extra_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="exactly"):
            ColourMeta.from_wire(
                {"space": 1, "range": 1, "primaries": 1, "transfer": 1, "extra": 0}
            )

    def test_from_wire_rejects_mistyped_fields(self) -> None:
        with pytest.raises(NovaInvariantError, match="must be an int"):
            ColourMeta.from_wire({"space": "bt709", "range": 1, "primaries": 1, "transfer": 1})
        # ``True`` is an int subclass; accepting it would let JSON ``true``
        # silently mean "limited range".
        with pytest.raises(NovaInvariantError, match="must be an int"):
            ColourMeta.from_wire({"space": True, "range": 1, "primaries": 1, "transfer": 1})

    def test_from_wire_rejects_unknown_values(self) -> None:
        with pytest.raises(NovaInvariantError, match="unknown colour"):
            ColourMeta.from_wire({"space": 99, "range": 1, "primaries": 1, "transfer": 1})


class TestFrameBuffer:
    @staticmethod
    def _frame(height: int = 4, width: int = 6, channels: int = 3) -> np.ndarray:
        return np.zeros((height, width, channels), dtype=np.uint8)

    def test_geometry_properties(self) -> None:
        buffer = FrameBuffer(pixels=self._frame(720, 1280, 4))
        assert buffer.height == 720
        assert buffer.width == 1280
        assert buffer.channels == 4

    def test_colour_defaults_to_unspecified(self) -> None:
        buffer = FrameBuffer(pixels=self._frame())
        assert buffer.colour.is_unspecified

    def test_accepts_the_three_supported_channel_counts(self) -> None:
        for channels in (1, 3, 4):
            assert FrameBuffer(pixels=self._frame(channels=channels)).channels == channels

    def test_rejects_wrong_rank(self) -> None:
        with pytest.raises(NovaInvariantError, match="HxWxC"):
            FrameBuffer(pixels=np.zeros((4, 6), dtype=np.uint8))

    def test_rejects_wrong_dtype(self) -> None:
        """Wider types would silently double memory and break uint8 pipelines."""
        with pytest.raises(NovaInvariantError, match="uint8"):
            FrameBuffer(pixels=np.zeros((4, 6, 3), dtype=np.uint16))

    def test_rejects_wrong_channel_count(self) -> None:
        with pytest.raises(NovaInvariantError, match="channels"):
            FrameBuffer(pixels=self._frame(channels=2))

    def test_rejects_empty_images(self) -> None:
        with pytest.raises(NovaInvariantError, match="empty"):
            FrameBuffer(pixels=self._frame(height=0))

    def test_rejects_non_arrays(self) -> None:
        with pytest.raises(NovaInvariantError, match="NumPy array"):
            FrameBuffer(pixels=[[0, 0, 0]])  # type: ignore[arg-type]

    def test_is_frozen(self) -> None:
        buffer = FrameBuffer(pixels=self._frame())
        with pytest.raises(FrozenInstanceError):
            buffer.colour = ColourMeta()  # type: ignore[misc]

    def test_slots_forbid_attribute_creation(self) -> None:
        buffer = FrameBuffer(pixels=self._frame())
        assert not hasattr(buffer, "__dict__")
        # TypeError, not AttributeError: dataclass(slots=True) generates
        # __setattr__ via super(), and CPython raises TypeError when the name
        # is not a slot.  Either way the write is refused — what matters is
        # that no ``buffer.surprise`` can come into existence.
        with pytest.raises((AttributeError, FrozenInstanceError, TypeError)):
            buffer.surprise = 1  # type: ignore[attr-defined]

    def test_equality_is_identity_by_design(self) -> None:
        """Documented escape from the bool(array) trap (see the class docstring)."""
        pixels = self._frame()
        same_object = FrameBuffer(pixels=pixels)
        assert same_object == same_object  # identity
        copy = FrameBuffer(pixels=self._frame())
        assert same_object != copy  # content-equal, not identity-equal
        assert np.array_equal(same_object.pixels, copy.pixels)

    def test_with_colour_shares_pixels_and_leaves_the_original_alone(self) -> None:
        original = FrameBuffer(pixels=self._frame())
        tagged = original.with_colour(ColourMeta(space=ColourSpace.BT709))
        assert tagged.pixels is original.pixels  # zero-copy
        assert original.colour.is_unspecified  # frozen original untouched
        assert tagged.colour.space is ColourSpace.BT709
        assert tagged is not original

    def test_with_the_same_colour_still_returns_a_new_object(self) -> None:
        """Pipelines may tag unconditionally; identity churn is not the concern."""
        original = FrameBuffer(pixels=self._frame())
        tagged = original.with_colour(original.colour)
        assert tagged is not original
        assert tagged.colour == original.colour


class TestAssetLinkState:
    def test_states_are_json_friendly_strings(self) -> None:
        assert isinstance(AssetLinkState.MISSING, str)
        assert json.dumps(AssetLinkState.MISSING) == '"missing"'
        assert json.dumps(AssetLinkState.LINKED) == '"linked"'

    def test_missing_is_a_first_class_state_not_an_error_sentinel(self) -> None:
        """ADR-0015 rule 3: a project with a missing asset still opens."""
        assert AssetLinkState("missing") is AssetLinkState.MISSING
        assert set(AssetLinkState) == {AssetLinkState.LINKED, AssetLinkState.MISSING}

    def test_states_are_not_booleans_in_disguise(self) -> None:
        """So ``if asset.link_state:`` cannot mean three different things."""
        assert AssetLinkState.LINKED is not True
        assert AssetLinkState.MISSING is not False
        assert isinstance(AssetLinkState.LINKED, str)


def test_the_ndarray_alias_is_exported_for_ports() -> None:
    """ports rule 2: buffers are typed via this alias, never via numpy directly."""
    from nova_studio.domain import media as media_module

    assert "NDArray" in media_module.__all__
    assert media_module.NDArray is not None
