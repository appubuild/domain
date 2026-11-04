"""Export intent and toolchain capability.

The failure mode this module exists to prevent is an export that dies halfway
through because the spec asked for something the machine cannot do.  Every
invariant tested here is one that would otherwise be discovered by an encoder
at frame 40 000 of a two-hour render:

* a codec the container cannot carry,
* odd dimensions with 4:2:0 chroma,
* a CRF value outside the codec's range,
* lossless requested from a codec that has no such mode,
* hardware encoding asked for on a machine with none.

Capability is modelled as *measured*, never assumed — an empty
``ToolchainCapabilities`` is a machine about which nothing is known, and
``describe_missing`` writes the sentence the user reads instead of "export
failed".
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.core import Timebase
from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.export import (
    AudioCodec,
    AudioEncodeSpec,
    ContainerFormat,
    HardwareAccel,
    OutputSpec,
    RateControl,
    RateControlMode,
    RenderStats,
    ToolchainCapabilities,
    VideoCodec,
    VideoEncodeSpec,
)
from nova_studio.domain.media import ColourMeta, ColourRange, ColourSpace

if TYPE_CHECKING:
    from collections.abc import Mapping

pytestmark = pytest.mark.unit


def _video(**overrides: Any) -> VideoEncodeSpec:
    codec = overrides.get("codec", VideoCodec.H264)
    # Mezzanine codecs have no constant-quality mode, so the default control has
    # to follow the codec rather than the other way round.
    mezzanine = codec in (VideoCodec.PRORES, VideoCodec.DNXHD)
    defaults: dict[str, Any] = {
        "codec": codec,
        "width": 1920,
        "height": 1080,
        "timebase": Timebase.of(30),
        "rate_control": RateControl.lossless() if mezzanine else RateControl.for_crf(20),
    }
    return VideoEncodeSpec(**{**defaults, **overrides})


def _audio(**overrides: Any) -> AudioEncodeSpec:
    defaults: dict[str, Any] = {
        "codec": AudioCodec.AAC,
        "sample_rate": 48_000,
        "channels": 2,
        "bit_rate": 192_000,
    }
    return AudioEncodeSpec(**{**defaults, **overrides})


def _spec(**overrides: Any) -> OutputSpec:
    defaults: dict[str, Any] = {"container": ContainerFormat.MP4, "video": _video()}
    return OutputSpec(**{**defaults, **overrides})


def _round_trip(wire: Mapping[str, Any]) -> Mapping[str, Any]:
    return json.loads(json.dumps(wire))


class TestEncoderNames:
    @pytest.mark.parametrize(
        ("codec", "expected"),
        [
            (VideoCodec.H264, "libx264"),
            (VideoCodec.HEVC, "libx265"),
            (VideoCodec.VP9, "libvpx-vp9"),
            (VideoCodec.AV1, "libaom-av1"),
            (VideoCodec.PRORES, "prores_ks"),
        ],
    )
    def test_a_codec_resolves_to_its_measured_software_encoder(
        self, codec: VideoCodec, expected: str
    ) -> None:
        assert _video(codec=codec).encoder_name == expected

    def test_hardware_is_used_when_the_family_has_an_encoder_for_the_codec(self) -> None:
        spec = _video(codec=VideoCodec.HEVC, hardware=HardwareAccel.NVENC)
        assert spec.encoder_name == "hevc_nvenc"

    def test_hardware_falls_back_to_software_for_a_codec_it_cannot_encode(self) -> None:
        """Asking for NVENC VP9 must not fail; it must quietly use libvpx."""
        spec = _video(codec=VideoCodec.VP9, hardware=HardwareAccel.NVENC)
        assert spec.encoder_name == "libvpx-vp9"

    def test_audio_resolves_to_its_software_encoder(self) -> None:
        assert _audio(codec=AudioCodec.MP3).encoder_name == "libmp3lame"


class TestRateControl:
    def test_crf_is_constant_quality(self) -> None:
        control = RateControl.for_crf(18)
        assert control.mode is RateControlMode.CRF and control.crf == 18

    def test_cbr_and_vbr_carry_bit_rates(self) -> None:
        assert RateControl.for_cbr(8_000_000).bit_rate == 8_000_000
        vbr = RateControl.for_vbr(6_000_000, max_bit_rate=9_000_000)
        assert (vbr.bit_rate, vbr.max_bit_rate) == (6_000_000, 9_000_000)

    @pytest.mark.parametrize(
        ("build", "fragment"),
        [
            (lambda: RateControl(mode=RateControlMode.CRF), "requires a crf value"),
            (lambda: RateControl.for_crf(64), "between 0 and 63"),
            (lambda: RateControl.for_cbr(0), "positive bit_rate"),
            (
                lambda: RateControl(mode=RateControlMode.CRF, crf=20, bit_rate=1_000),
                "must not also set a bit rate",
            ),
            (
                lambda: RateControl.for_vbr(9_000_000, max_bit_rate=1_000_000),
                "must not be below",
            ),
            (
                lambda: RateControl(mode=RateControlMode.LOSSLESS, crf=0),
                "takes neither crf nor bit rate",
            ),
        ],
    )
    def test_contradictory_instructions_are_refused(self, build: Any, fragment: str) -> None:
        with pytest.raises(NovaInvariantError, match=fragment):
            build()

    def test_the_wire_form_survives_a_json_boundary(self) -> None:
        control = RateControl.for_vbr(6_000_000, max_bit_rate=9_000_000)
        assert RateControl.from_wire(_round_trip(control.to_wire())) == control

    def test_nulls_round_trip(self) -> None:
        control = RateControl.for_crf(20)
        wire = control.to_wire()
        assert wire["bit_rate"] is None
        assert RateControl.from_wire(_round_trip(wire)) == control

    def test_a_corrupt_control_is_rejected(self) -> None:
        with pytest.raises(NovaInvariantError, match="unknown rate control mode"):
            RateControl.from_wire(dict(RateControl.for_crf(20).to_wire()) | {"mode": "vq"})


class TestVideoEncodeSpec:
    def test_bit_depth_is_read_from_the_pixel_format(self) -> None:
        assert _video(pixel_format="yuv420p").bit_depth == 8
        assert _video(pixel_format="yuv420p10le").bit_depth == 10

    def test_mezzanine_codecs_are_recognised(self) -> None:
        assert _video(codec=VideoCodec.PRORES).is_intermediate
        assert not _video().is_intermediate

    def test_the_frame_rate_comes_from_the_timebase(self) -> None:
        assert _video(timebase=Timebase.of(25)).frame_rate == 25.0

    @pytest.mark.parametrize(
        ("overrides", "fragment"),
        [
            ({"width": 1}, "at least 2x2"),
            ({"width": 1921}, "requires even dimensions"),
            ({"height": 1081}, "requires even dimensions"),
            ({"pixel_format": "yuv422p", "width": 1921}, "requires an even width"),
            ({"gop_size": -1}, "must not be negative"),
            ({"rate_control": RateControl.for_crf(52)}, "between 0 and 51"),
            (
                {"codec": VideoCodec.PRORES, "rate_control": RateControl.for_crf(20)},
                "no constant-quality",
            ),
            ({"rate_control": RateControl.lossless()}, "no lossless mode"),
        ],
    )
    def test_impossible_specs_are_refused(self, overrides: dict[str, Any], fragment: str) -> None:
        with pytest.raises(NovaInvariantError, match=fragment):
            _video(**overrides)

    def test_ten_bit_and_422_specs_are_allowed(self) -> None:
        assert _video(pixel_format="yuv420p10le").bit_depth == 10
        assert _video(pixel_format="yuv422p", width=1920).encoder_name == "libx264"

    def test_lossless_is_allowed_for_a_mezzanine_codec(self) -> None:
        spec = _video(codec=VideoCodec.PRORES, rate_control=RateControl.lossless())
        assert spec.is_intermediate

    def test_the_wire_form_survives_a_json_boundary(self) -> None:
        spec = _video(
            codec=VideoCodec.HEVC,
            pixel_format="yuv420p10le",
            colour=ColourMeta(space=ColourSpace.BT2020_NCL, range=ColourRange.LIMITED),
            gop_size=60,
            preset="slow",
            hardware=HardwareAccel.QSV,
        )
        assert VideoEncodeSpec.from_wire(_round_trip(spec.to_wire())) == spec

    @pytest.mark.parametrize(
        ("mutation", "fragment"),
        [
            ({"codec": "h265"}, "unknown encode value"),
            ({"hardware": "cuda"}, "unknown encode value"),
            ({"width": "1920"}, "must be an int"),
            ({"timebase": {"num": "30", "den": 1}}, "must be an int"),
            ({"rate_control": "crf20"}, "rate_control must be a mapping"),
            ({"extra": 1}, "fields must be exactly"),
        ],
    )
    def test_a_corrupt_spec_is_rejected(self, mutation: dict[str, Any], fragment: str) -> None:
        with pytest.raises(NovaInvariantError, match=fragment):
            VideoEncodeSpec.from_wire(dict(_video().to_wire()) | mutation)


class TestAudioEncodeSpec:
    def test_pcm_has_no_bit_rate(self) -> None:
        with pytest.raises(NovaInvariantError, match="PCM has no bit rate"):
            _audio(codec=AudioCodec.PCM_S16LE, bit_rate=1_411_200)

    def test_invariants_are_checked(self) -> None:
        with pytest.raises(NovaInvariantError, match="sample_rate must be positive"):
            _audio(sample_rate=0)
        with pytest.raises(NovaInvariantError, match="channels must be positive"):
            _audio(channels=0)

    def test_the_wire_form_survives_a_json_boundary(self) -> None:
        spec = _audio(codec=AudioCodec.OPUS, sample_rate=48_000, channels=1, bit_rate=96_000)
        assert AudioEncodeSpec.from_wire(_round_trip(spec.to_wire())) == spec


class TestOutputSpec:
    @pytest.mark.parametrize(
        ("container", "codec", "allowed"),
        [
            (ContainerFormat.MP4, VideoCodec.H264, True),
            (ContainerFormat.MP4, VideoCodec.VP9, False),
            (ContainerFormat.WEBM, VideoCodec.VP9, True),
            (ContainerFormat.WEBM, VideoCodec.H264, False),
            (ContainerFormat.MKV, VideoCodec.PRORES, True),
            (ContainerFormat.MOV, VideoCodec.PRORES, True),
            (ContainerFormat.WAV, VideoCodec.H264, False),
        ],
    )
    def test_container_and_codec_must_agree(
        self, container: ContainerFormat, codec: VideoCodec, allowed: bool
    ) -> None:
        if allowed:
            assert _spec(container=container, video=_video(codec=codec)).container is container
        else:
            with pytest.raises(NovaInvariantError, match="cannot carry"):
                _spec(container=container, video=_video(codec=codec))

    def test_webm_accepts_opus_and_rejects_aac(self) -> None:
        assert _spec(
            container=ContainerFormat.WEBM,
            video=_video(codec=VideoCodec.VP9),
            audio=_audio(codec=AudioCodec.OPUS),
        ).has_audio
        with pytest.raises(NovaInvariantError, match="cannot carry"):
            _spec(
                container=ContainerFormat.WEBM,
                video=_video(codec=VideoCodec.VP9),
                audio=_audio(codec=AudioCodec.AAC),
            )

    def test_faststart_is_only_for_mp4_and_mov(self) -> None:
        assert _spec(faststart=True).faststart
        with pytest.raises(NovaInvariantError, match="mp4 and mov only"):
            _spec(container=ContainerFormat.MKV, faststart=True)

    def test_the_muxer_name_is_what_ffmpeg_calls_it(self) -> None:
        assert _spec(container=ContainerFormat.MKV).muxer_name == "matroska"
        assert _spec(container=ContainerFormat.MP4).muxer_name == "mp4"

    def test_the_wire_form_survives_a_json_boundary(self) -> None:
        spec = _spec(audio=_audio(), faststart=True)
        assert OutputSpec.from_wire(_round_trip(spec.to_wire())) == spec

    def test_audio_may_be_absent(self) -> None:
        spec = _spec()
        assert not spec.has_audio
        assert spec.to_wire()["audio"] is None
        assert OutputSpec.from_wire(_round_trip(spec.to_wire())).audio is None

    def test_a_corrupt_spec_is_rejected(self) -> None:
        with pytest.raises(NovaInvariantError, match="faststart must be a bool"):
            OutputSpec.from_wire(dict(_spec().to_wire()) | {"faststart": "yes"})
        with pytest.raises(NovaInvariantError, match="unknown container"):
            OutputSpec.from_wire(dict(_spec().to_wire()) | {"container": "avi"})


class TestToolchainCapabilities:
    #: A machine that can do software H.264 in 8-bit only.
    MODEST = ToolchainCapabilities(
        ffmpeg_version="7.0.2",
        encoders=frozenset({"libx264", "aac"}),
        pixel_formats=frozenset({"yuv420p", "rgb24"}),
    )

    def test_a_spec_is_encodable_when_every_piece_is_present(self) -> None:
        spec = _spec(audio=_audio())
        assert self.MODEST.can_encode(spec)
        assert self.MODEST.describe_missing(spec) == ""

    def test_a_missing_video_encoder_is_named(self) -> None:
        spec = _spec(video=_video(codec=VideoCodec.HEVC))
        assert self.MODEST.describe_missing(spec) == "this build has no libx265 encoder"

    def test_a_missing_pixel_format_is_named(self) -> None:
        spec = _spec(video=_video(pixel_format="yuv420p10le"))
        assert "cannot convert to yuv420p10le" in self.MODEST.describe_missing(spec)

    def test_missing_hardware_is_named(self) -> None:
        spec = _spec(video=_video(hardware=HardwareAccel.NVENC))
        assert self.MODEST.describe_missing(spec) == (
            "nvenc hardware encoding is not available on this machine"
        )

    def test_a_missing_audio_encoder_is_named(self) -> None:
        spec = _spec(container=ContainerFormat.MKV, audio=_audio(codec=AudioCodec.OPUS))
        assert self.MODEST.describe_missing(spec) == "this build has no libopus encoder"

    def test_hardware_capability_is_matched_by_the_name_ffmpeg_reports(self) -> None:
        """FFmpeg prints ``cuda`` for NVENC; the enum says ``nvenc``."""
        with_cuda = ToolchainCapabilities(hwaccels=frozenset({"cuda", "vdpau"}))
        assert with_cuda.supports_hardware(HardwareAccel.NVENC)
        assert with_cuda.supports_hardware(HardwareAccel.QSV) is False

    def test_an_unknown_machine_can_encode_nothing(self) -> None:
        """Nothing probed yet means nothing promised — the opposite of assuming."""
        assert not ToolchainCapabilities().can_encode(_spec())
        assert ToolchainCapabilities().describe_missing(_spec()) == (
            "this build has no libx264 encoder"
        )


class TestRenderStats:
    def test_throughput_is_reported(self) -> None:
        stats = RenderStats(frames_written=600, bytes_written=1_000_000, elapsed_ms=10_000)
        assert stats.frames_per_second == pytest.approx(60.0)

    def test_nothing_measured_means_no_throughput(self) -> None:
        assert RenderStats().frames_per_second == 0.0
