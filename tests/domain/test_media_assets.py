"""The media record: hashes, stream summaries, probe summaries, audio, assets.

These are the objects that outlive a session — they are what ``media/index.json``
stores (ADR-0015) and what the timeline reads to lay itself out.  Two properties
carry most of the value here and both are easy to lose:

1. **Wire fidelity.**  A probe summary written by one version and read by
   another must describe the same footage.  Every ``to_wire``/``from_wire`` pair
   is round-tripped, and every malformed document is rejected with
   ``NovaInvariantError`` rather than half-parsed — a timeline laid out against
   silently-truncated geometry is the worst failure mode in the app.

2. **Coupled state.**  A hash and a probe summary describe the same bytes. When
   one changes, the other must follow; the relink tests pin exactly that,
   because "the path moved but the probe says 1920x1080" is only true if the
   content is provably the same.

Nothing here touches the filesystem: ``PurePath`` does string work, and the
arrays are synthetic.
"""

from __future__ import annotations

import json
from fractions import Fraction
from typing import TYPE_CHECKING, Any

import numpy as np
import pytest

from nova_studio.core import Timebase
from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.media import (
    AssetKind,
    AssetLinkState,
    AudioBuffer,
    AudioStreamInfo,
    ColourMeta,
    ColourRange,
    ColourSpace,
    ContentHash,
    ContentHashAlgorithm,
    MediaAsset,
    MediaInfo,
    VideoStreamInfo,
)

if TYPE_CHECKING:
    from collections.abc import Mapping

pytestmark = pytest.mark.unit

#: A syntactically valid SHA-256 digest.
DIGEST = "ab" * 32
OTHER_DIGEST = "cd" * 32


def _video(**overrides: Any) -> VideoStreamInfo:
    defaults: dict[str, Any] = {
        "codec_name": "h264",
        "width": 1920,
        "height": 1080,
        "timebase": Timebase.of(30),
        "frame_count": 300,
        "pixel_format": "yuv420p",
    }
    return VideoStreamInfo(**{**defaults, **overrides})


def _audio(**overrides: Any) -> AudioStreamInfo:
    defaults: dict[str, Any] = {
        "codec_name": "aac",
        "sample_rate": 48_000,
        "channels": 2,
        "sample_count": 480_000,
    }
    return AudioStreamInfo(**{**defaults, **overrides})


def _info(**overrides: Any) -> MediaInfo:
    defaults: dict[str, Any] = {
        "kind": AssetKind.VIDEO,
        "container_format": "mov,mp4,m4a,3gp,3g2,mj2",
        "duration_seconds": 10.0,
        "bit_rate": 1_000_000,
        "video": (_video(),),
        "audio": (_audio(),),
    }
    return MediaInfo(**{**defaults, **overrides})


def _round_trip(wire: Mapping[str, Any]) -> Mapping[str, Any]:
    """Force a real JSON boundary: no tuples, no enums, no Python-only types."""
    return json.loads(json.dumps(wire))


class TestContentHash:
    def test_a_valid_digest_is_accepted(self) -> None:
        digest = ContentHash(DIGEST)
        assert digest.algorithm is ContentHashAlgorithm.SHA256
        assert str(digest) == f"sha256:{DIGEST}"

    def test_the_algorithm_travels_with_the_digest(self) -> None:
        """An old project stays verifiable when the default algorithm changes."""
        wire = ContentHash(DIGEST).to_wire()
        assert wire == {"algorithm": "sha256", "digest": DIGEST}
        assert ContentHash.from_wire(_round_trip(wire)) == ContentHash(DIGEST)

    @pytest.mark.parametrize(
        "digest",
        [
            "AB" * 32,  # uppercase: canonical JSON needs one spelling
            "ab" * 31,  # too short
            "ab" * 33,  # too long
            "zz" * 32,  # not hex
            "",
        ],
    )
    def test_a_malformed_digest_is_rejected(self, digest: str) -> None:
        with pytest.raises(NovaInvariantError):
            ContentHash(digest)

    def test_an_unknown_algorithm_is_rejected_on_read(self) -> None:
        with pytest.raises(NovaInvariantError, match="unknown digest algorithm"):
            ContentHash.from_wire({"algorithm": "md5", "digest": DIGEST})

    def test_missing_and_extra_fields_are_rejected(self) -> None:
        with pytest.raises(Exception, match="fields must be exactly"):
            ContentHash.from_wire({"digest": DIGEST})
        with pytest.raises(Exception, match="fields must be exactly"):
            ContentHash.from_wire({"algorithm": "sha256", "digest": DIGEST, "salt": "x"})

    def test_two_hashes_of_the_same_bytes_are_equal(self) -> None:
        assert ContentHash(DIGEST) == ContentHash(DIGEST)
        assert ContentHash(DIGEST) != ContentHash(OTHER_DIGEST)


class TestVideoStreamInfo:
    def test_duration_uses_the_canonical_frame_maths(self) -> None:
        stream = _video(timebase=Timebase.of(30_000, 1_001), frame_count=30_000)
        assert stream.duration_seconds == pytest.approx(1001.0, abs=1e-6)

    def test_anamorphic_footage_reports_its_display_size(self) -> None:
        """1440x1080 with a 4:3 sample aspect ratio is 1920x1080 on screen."""
        stream = _video(width=1440, height=1080, sample_aspect_ratio=Fraction(4, 3))
        assert (stream.display_width, stream.display_height) == (1920, 1080)

    def test_rotation_swaps_the_display_axes(self) -> None:
        stream = _video(width=1920, height=1080, rotation=90)
        assert stream.is_rotated
        assert (stream.display_width, stream.display_height) == (1080, 1920)

    def test_180_degrees_does_not_swap_the_axes(self) -> None:
        stream = _video(width=1920, height=1080, rotation=180)
        assert not stream.is_rotated
        assert (stream.display_width, stream.display_height) == (1920, 1080)

    @pytest.mark.parametrize(
        ("overrides", "fragment"),
        [
            ({"width": 0}, "dimensions must be positive"),
            ({"height": -1080}, "dimensions must be positive"),
            ({"frame_count": -1}, "frame_count must not be negative"),
            ({"index": -1}, "stream index must not be negative"),
            ({"rotation": 45}, "rotation must be 0, 90, 180 or 270"),
            ({"sample_aspect_ratio": Fraction(0)}, "sample aspect ratio must be positive"),
        ],
    )
    def test_invariants_are_checked_at_construction(
        self, overrides: dict[str, Any], fragment: str
    ) -> None:
        with pytest.raises(NovaInvariantError, match=fragment):
            _video(**overrides)

    def test_the_wire_form_survives_a_json_boundary(self) -> None:
        stream = _video(
            index=1,
            rotation=270,
            sample_aspect_ratio=Fraction(4, 3),
            colour=ColourMeta(space=ColourSpace.BT709, range=ColourRange.LIMITED),
        )
        restored = VideoStreamInfo.from_wire(_round_trip(stream.to_wire()))
        assert restored == stream
        assert restored.sample_aspect_ratio == Fraction(4, 3)
        assert restored.timebase == Timebase.of(30)

    @pytest.mark.parametrize(
        ("mutation", "fragment"),
        [
            ({"width": True}, "must be an int"),
            ({"timebase": {"num": 30}}, "invalid timebase"),
            ({"timebase": {"num": 0, "den": 1}}, "invalid timebase"),
            ({"timebase": {"num": "30", "den": 1}}, "must be an int"),
            ({"sar": [4]}, "two-element"),
            ({"sar": [4, 0]}, "denominator must not be zero"),
            ({"sar": ["4", 3]}, "must hold ints"),
            ({"colour": {"space": 1}}, "fields must be exactly"),
            ({"rotation": "ninety"}, "must be an int"),
        ],
    )
    def test_a_corrupt_stream_summary_is_rejected(
        self, mutation: dict[str, Any], fragment: str
    ) -> None:
        wire = dict(_video().to_wire()) | mutation
        with pytest.raises(NovaInvariantError, match=fragment):
            VideoStreamInfo.from_wire(wire)

    def test_adding_a_field_without_teaching_the_reader_fails(self) -> None:
        wire = dict(_video().to_wire()) | {"bit_depth": 10}
        with pytest.raises(Exception, match="fields must be exactly"):
            VideoStreamInfo.from_wire(wire)


class TestAudioStreamInfo:
    def test_duration_derives_from_the_sample_count(self) -> None:
        assert _audio(sample_rate=48_000, sample_count=48_000).duration_seconds == 1.0

    @pytest.mark.parametrize(
        ("overrides", "fragment"),
        [
            ({"sample_rate": 0}, "sample_rate must be positive"),
            ({"channels": 0}, "channels must be positive"),
            ({"sample_count": -1}, "sample_count must not be negative"),
        ],
    )
    def test_invariants_are_checked_at_construction(
        self, overrides: dict[str, Any], fragment: str
    ) -> None:
        with pytest.raises(NovaInvariantError, match=fragment):
            _audio(**overrides)

    def test_the_wire_form_survives_a_json_boundary(self) -> None:
        stream = _audio(index=2, channel_layout="stereo", sample_format="fltp")
        assert AudioStreamInfo.from_wire(_round_trip(stream.to_wire())) == stream

    def test_a_corrupt_summary_is_rejected(self) -> None:
        wire = dict(_audio().to_wire()) | {"sample_rate": "48000"}
        with pytest.raises(Exception, match="must be an int"):
            AudioStreamInfo.from_wire(wire)


class TestMediaInfo:
    def test_primary_streams_are_the_first_of_each_kind(self) -> None:
        second_audio = _audio(index=1, channels=1)
        info = _info(audio=(_audio(index=0), second_audio))
        assert info.primary_audio() is info.audio[0]
        assert info.primary_video() is info.video[0]
        assert info.has_video and info.has_audio

    def test_streams_are_found_by_container_index(self) -> None:
        info = _info(audio=(_audio(index=3),))
        assert info.stream(3) is info.audio[0]
        assert info.stream(0) is info.video[0]
        assert info.stream(99) is None

    def test_a_file_without_video_reports_none(self) -> None:
        info = MediaInfo(kind=AssetKind.AUDIO, audio=(_audio(),))
        assert not info.has_video
        assert info.primary_video() is None

    @pytest.mark.parametrize(
        ("info_kwargs", "fragment"),
        [
            ({"kind": AssetKind.VIDEO, "video": ()}, "must carry a video stream"),
            ({"kind": AssetKind.IMAGE, "video": ()}, "must carry a video stream"),
            ({"kind": AssetKind.AUDIO, "audio": ()}, "must carry an audio stream"),
            (
                {"kind": AssetKind.UNKNOWN, "duration_seconds": -1.0},
                "duration must not be negative",
            ),
            ({"kind": AssetKind.UNKNOWN, "bit_rate": -1}, "bit_rate must not be negative"),
            (
                {"kind": AssetKind.UNKNOWN, "subtitle_count": -1},
                "stream counts must not be negative",
            ),
        ],
    )
    def test_the_kind_must_match_the_streams(
        self, info_kwargs: dict[str, Any], fragment: str
    ) -> None:
        with pytest.raises(NovaInvariantError, match=fragment):
            MediaInfo(**info_kwargs)

    def test_a_still_image_is_described_with_one_frame(self) -> None:
        """A still has no rate of its own; the timeline decides how long it lasts."""
        still = _info(
            kind=AssetKind.IMAGE,
            video=(_video(width=1080, height=1920, timebase=Timebase.of(1), frame_count=1),),
            audio=(),
            container_format="png_pipe",
        )
        assert still.primary_video() is not None
        assert still.primary_video().frame_count == 1

    def test_the_wire_form_survives_a_json_boundary(self) -> None:
        info = _info(
            video=(_video(index=0), _video(index=1, width=640, height=360)),
            audio=(_audio(index=2),),
            subtitle_count=2,
            other_stream_count=1,
            metadata={"encoder": "Lavf60.16.100", "title": "A roll"},
        )
        restored = MediaInfo.from_wire(_round_trip(info.to_wire()))
        assert restored == info
        assert len(restored.video) == 2
        assert restored.video[1].width == 640

    def test_metadata_is_serialised_in_a_stable_order(self) -> None:
        """Canonical JSON: two saves of an unchanged probe are byte-identical."""
        first = _info(metadata={"b": "2", "a": "1"}).to_wire()
        second = _info(metadata={"a": "1", "b": "2"}).to_wire()
        assert json.dumps(first) == json.dumps(second)

    @pytest.mark.parametrize(
        ("mutation", "fragment"),
        [
            ({"kind": "footage"}, "unknown asset kind"),
            ({"video": {}}, "must be a list"),
            ({"audio": "none"}, "must be a list"),
            ({"metadata": {"a": 1}}, "must be strings"),
            ({"duration_s": "ten"}, "must be a number"),
            ({"duration_s": True}, "must be a number"),
        ],
    )
    def test_a_corrupt_summary_is_rejected(self, mutation: dict[str, Any], fragment: str) -> None:
        with pytest.raises(NovaInvariantError, match=fragment):
            MediaInfo.from_wire(dict(_info().to_wire()) | mutation)


class TestAudioBuffer:
    @staticmethod
    def _buffer(samples: list[list[float]], rate: int = 48_000) -> AudioBuffer:
        return AudioBuffer(samples=np.array(samples, dtype=np.float32), sample_rate=rate)

    def test_shape_and_rate_describe_the_block(self) -> None:
        buffer = self._buffer([[0.0, 0.0]] * 1024)
        assert (buffer.frame_count, buffer.channels) == (1024, 2)
        assert buffer.duration_seconds == pytest.approx(1024 / 48_000)

    @pytest.mark.parametrize(
        ("samples", "rate", "fragment"),
        [
            (np.zeros(10, dtype=np.float32), 48_000, "must be \\(n_samples, n_channels\\)"),
            (np.zeros((2, 2, 2), dtype=np.float32), 48_000, "must be \\(n_samples, n_channels\\)"),
            (np.zeros((4, 2), dtype=np.float64), 48_000, "must be float32"),
            (np.zeros((4, 0), dtype=np.float32), 48_000, "at least one channel"),
            (np.zeros((4, 2), dtype=np.float32), 0, "sample_rate must be positive"),
            ([[0.0, 0.0]], 48_000, "must be a NumPy array"),
        ],
    )
    def test_bad_blocks_are_rejected(self, samples: Any, rate: int, fragment: str) -> None:
        with pytest.raises(NovaInvariantError, match=fragment):
            AudioBuffer(samples=samples, sample_rate=rate)

    def test_mono_downmix_averages_rather_than_picking_a_channel(self) -> None:
        buffer = self._buffer([[1.0, -1.0], [0.5, 0.5]])
        mono = buffer.to_mono()
        assert mono.channels == 1
        assert mono.samples.ravel().tolist() == [0.0, 0.5]

    def test_downmixing_mono_returns_the_same_buffer(self) -> None:
        buffer = self._buffer([[0.25], [0.75]])
        assert buffer.to_mono() is buffer

    def test_peak_is_the_largest_absolute_sample(self) -> None:
        assert self._buffer([[0.5, -0.9]]).peak == pytest.approx(0.9)

    def test_an_empty_block_is_empty_and_peak_free(self) -> None:
        empty = AudioBuffer(samples=np.zeros((0, 2), dtype=np.float32), sample_rate=48_000)
        assert empty.is_empty
        assert empty.peak == 0.0

    def test_slice_is_a_view_following_python_slicing(self) -> None:
        buffer = self._buffer([[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]])
        assert buffer.slice(1, 3).frame_count == 2
        assert buffer.slice(-1).frame_count == 1
        # Zero-copy: the view shares storage with the original.
        view = buffer.slice(0, 1)
        view.samples[0, 0] = 0.9
        assert buffer.samples[0, 0] == 0.9


class TestMediaAsset:
    ID = "01999999-0000-7000-8000-000000000000"

    @staticmethod
    def _asset(**overrides: Any) -> MediaAsset:
        defaults: dict[str, Any] = {
            "asset_id": TestMediaAsset.ID,
            "path": "/media/A roll/clip.mp4",
        }
        return MediaAsset(**{**defaults, **overrides})

    # -- identity ---------------------------------------------------------

    def test_the_display_name_omits_the_directory(self) -> None:
        assert self._asset().display_name == "clip.mp4"

    def test_a_path_is_required(self) -> None:
        with pytest.raises(Exception, match="must carry a path"):
            MediaAsset(asset_id=self.ID, path="")

    def test_a_new_asset_is_linked_and_unprobed(self) -> None:
        asset = self._asset()
        assert asset.is_linked
        assert not asset.is_probed
        assert asset.kind is AssetKind.UNKNOWN

    def test_probing_reveals_the_kind(self) -> None:
        asset = self._asset().with_probe(_info(kind=AssetKind.VIDEO))
        assert asset.kind is AssetKind.VIDEO
        assert asset.is_probed

    # -- link state -------------------------------------------------------

    def test_mark_missing_keeps_the_probe_for_placeholder_geometry(self) -> None:
        """The timeline still lays itself out while the user relinks."""
        asset = self._asset().with_probe(_info())
        missing = asset.mark_missing()
        assert not missing.is_linked
        assert missing.link_state is AssetLinkState.MISSING
        assert missing.is_probed

    def test_relinking_with_the_same_hash_keeps_the_probe(self) -> None:
        asset = self._asset().with_probe(_info()).with_hash(ContentHash(DIGEST))
        moved = asset.mark_missing().relink("/new/clip.mp4", content_hash=ContentHash(DIGEST))
        assert moved.is_linked
        assert moved.is_probed
        assert moved.path == "/new/clip.mp4"

    def test_relinking_without_a_hash_discards_both(self) -> None:
        """A path change with no proof of content is not evidence of same media."""
        asset = self._asset().with_probe(_info()).with_hash(ContentHash(DIGEST))
        moved = asset.relink("/new/clip.mp4")
        assert moved.content_hash is None
        assert not moved.is_probed

    def test_relinking_to_different_content_drops_the_probe(self) -> None:
        asset = self._asset().with_probe(_info()).with_hash(ContentHash(DIGEST))
        moved = asset.relink("/new/other.mp4", content_hash=ContentHash(OTHER_DIGEST))
        assert moved.content_hash == ContentHash(OTHER_DIGEST)
        assert not moved.is_probed

    def test_relinking_may_supply_a_fresh_probe(self) -> None:
        asset = self._asset()
        fresh = _info(duration_seconds=42.0)
        moved = asset.relink("/new/clip.mp4", probe=fresh)
        assert moved.probe == fresh
        assert moved.kind is AssetKind.UNKNOWN  # kind follows with_probe, not relink

    def test_relinking_requires_a_path(self) -> None:
        with pytest.raises(Exception, match="must carry a path"):
            self._asset().relink("")

    def test_rehashing_unchanged_content_keeps_the_probe(self) -> None:
        asset = self._asset().with_probe(_info()).with_hash(ContentHash(DIGEST))
        assert asset.with_hash(ContentHash(DIGEST)).is_probed

    def test_rehashing_changed_content_drops_the_probe(self) -> None:
        asset = self._asset().with_probe(_info()).with_hash(ContentHash(DIGEST))
        assert not asset.with_hash(ContentHash(OTHER_DIGEST)).is_probed

    # -- persistence ------------------------------------------------------

    def test_the_wire_form_survives_a_json_boundary(self) -> None:
        asset = self._asset().with_hash(ContentHash(DIGEST)).with_probe(_info())
        restored = MediaAsset.from_wire(_round_trip(asset.to_wire()))
        assert restored == asset
        assert restored.asset_id == asset.asset_id

    def test_an_unprobed_missing_asset_round_trips_with_nulls(self) -> None:
        asset = self._asset().mark_missing()
        wire = asset.to_wire()
        assert wire["content_hash"] is None and wire["probe"] is None
        restored = MediaAsset.from_wire(_round_trip(wire))
        assert restored.link_state is AssetLinkState.MISSING
        assert not restored.is_probed

    @pytest.mark.parametrize(
        ("mutation", "fragment"),
        [
            ({"kind": "footage"}, "unknown asset value"),
            ({"link_state": "gone"}, "unknown asset value"),
            ({"content_hash": "ab" * 32}, "must be a mapping or null"),
            ({"probe": "{}"}, "must be a mapping or null"),
            ({"asset_id": 1}, "must be a str"),
        ],
    )
    def test_a_corrupt_entry_is_rejected(self, mutation: dict[str, Any], fragment: str) -> None:
        with pytest.raises(NovaInvariantError, match=fragment):
            MediaAsset.from_wire(dict(self._asset().to_wire()) | mutation)
